import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const runtime = await import('../src/services/town/townBuildingFeatureRuntime.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const trade = await import('../src/services/town/buildingFeatures/trade.js');
const {
  setupTownEnvironment, buildTown, installCompiledConfig, arriveAt, seedPlayerWallet,
} = await import('./helpers/townBuildingFeatureFixture.js');

function shopConfig(extraFeatures = [], extraResources = []) {
  return {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '收购并出售居民闲置物品的小旧货铺，兼收旧货',
    unsupported: [], resources: [{
      key: 'old_lamp', name: '旧街灯', description: '一盏擦得很亮的小旧街灯，据说到了晚上会发出暖黄色的光。',
      itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null,
    }, ...extraResources],
    features: [{
      key: 'sell_goods', templateId: 'item_purchase', templateVersion: 1,
      title: '买下旧街灯', description: '买下那盏擦得很亮的旧街灯，直接放进背包带走。',
      evidence: { source: 'building.description', quote: '出售居民闲置物品' },
      priceTier: 'free',
      params: { offers: [{ resourceKey: 'old_lamp', label: '旧街灯', priceTier: 'basic' }] },
      presentation: { opening: '货架上摆着擦得锃亮的旧物件，愿意的话慢慢挑。', success: '{targetName}买下了{optionLabel}。', empty: '货架空了，改天再来。' },
    }, ...extraFeatures],
  };
}

test('purchase: real stock, real wallet, idempotent replay and last-item race', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'shop', name: '旧货铺', businessKind: 'supplier', operatorJob: '货郎',
      featureDesc: '出售居民闲置物品，偶尔也回收一些旧货。' }],
  });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'shop' });
  const compiled = await installCompiledConfig(env, source, shopConfig());
  const featureId = compiled.features[0].featureId;
  seedPlayerWallet(env.runtime, 100);
  const { scope } = await arriveAt(env, now, places[0]);
  const wallet = () => env.runtime.getTownWallet().balance;
  const before = wallet();

  const buy = (idem) => {
    const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'shop', featureId,
      selection: { offerKey: 'old_lamp' }, ...scope });
    return runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'shop', featureId,
      quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: idem,
      selection: { offerKey: 'old_lamp' } });
  };

  const op1 = buy('buy-1');
  assert.equal(op1.status, 'committed');
  assert.equal(op1.price, 5, 'basic tier = 5 gold');
  assert.equal(wallet(), before - 5);
  const stockAfterFirst = db.prepare(
    "SELECT quantity, reserved FROM town_resource_stocks WHERE owner_key LIKE ?").get(`building-stock:${mapId}:shop:%`);
  assert.equal(stockAfterFirst.quantity, 2, 'opening stock 3, one unit consumed');
  const item1 = db.prepare("SELECT * FROM backpack_items WHERE source_id = ? AND retired_at IS NULL").get(`bf:${mapId}:shop:old_lamp`);
  assert.ok(item1, 'goods delivered into the backpack');

  // 幂等重放：不重复扣款、不重复发货
  const replay = buy('buy-1');
  assert.equal(replay.operationId, op1.operationId);
  assert.equal(wallet(), before - 5);
  assert.equal(db.prepare("SELECT count(*) n FROM backpack_items WHERE source_id = ?").get(`bf:${mapId}:shop:old_lamp`).n, 1);

  // 买到只剩最后一件：库存归零后拒绝
  buy('buy-2'); buy('buy-3');
  assert.equal(wallet(), before - 15);
  assert.throws(() => buy('buy-4'), err => err.code === 'OUT_OF_STOCK', 'empty shelf must refuse');
  assert.equal(wallet(), before - 15, 'refused sale does not charge');

  // 重生成配置不补货：开业预算一次性消费
  const { ensureOpeningResources } = trade;
  const economy = env.runtime.getTownEconomyContext().economy;
  const stockBefore = db.prepare(
    "SELECT quantity FROM town_resource_stocks WHERE owner_key LIKE ?").get(`building-stock:${mapId}:shop:%`).quantity;
  ensureOpeningResources({ db, economy, scope: { ...scope, idempotencyKey: 'regen-1' },
    buildingInstanceId: `${mapId}:shop`, resourceKeys: ['old_lamp'] });
  assert.equal(db.prepare(
    "SELECT quantity FROM town_resource_stocks WHERE owner_key LIKE ?").get(`building-stock:${mapId}:shop:%`).quantity,
    stockBefore, 'regeneration never restocks');
});

test('exchange and recycle: one-for-one atomic swap, bounded prices, no arbitrage', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  // 单模板口径：交换与回收分属两栋建筑
  const { mapId, places } = buildTown({
    ...env,
    buildings: [
      { key: 'swap_post', name: '换物小摊', businessKind: 'supplier', operatorJob: '货郎',
        featureDesc: '拿一件指定物品来，换走摊上的一件小旧货，一件只换一件。' },
      { key: 'buyback', name: '旧货回收铺', businessKind: 'supplier', operatorJob: '货郎',
        featureDesc: '收一些闲置旧物，按行情换成金币。' },
    ],
  });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'swap_post' });
  // 需要可接受的目录键：手工发布一个物品模板
  db.prepare(`INSERT INTO item_templates (world_id, template_id, version, effect_key, name, description, payload_json, rarity, tradable)
    VALUES (?, 'mood_patch', 1, 'mood_fix', '心情修补贴', '贴一下就会开心起来的小贴纸。', '{}', 'common', 1)`)
    .run(source.worldId);

  const swapGenerated = {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '用一件指定物品换一件摊上收藏小旧货的交换小摊，童叟无欺',
    unsupported: [], resources: [{
      key: 'old_lamp', name: '旧街灯', description: '一盏擦得很亮的小旧街灯，据说到了晚上会发出暖黄色的光。',
      itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null,
    }],
    features: [{
      key: 'swap', templateId: 'item_exchange', templateVersion: 1,
      title: '以物换物', description: '拿一件心情修补贴来，换走柜台上的一件小旧货。',
      evidence: { source: 'building.description', quote: '一件指定物品' },
      priceTier: 'free',
      params: { offers: [{ acceptCatalogKey: 'catalog_mood_patch', giveResourceKey: 'old_lamp', label: '换走旧街灯' }] },
      presentation: { opening: '柜台边摆着装换物的小筐，规矩是一件换一件，童叟无欺。', success: '{targetName}换到了{optionLabel}。', empty: '换物筐空了。' },
    }],
  };
  const recycleGenerated = {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '收购街坊闲置旧物并按行情付金币的回收小铺，绝不高价收',
    unsupported: [], resources: [],
    features: [{
      key: 'recycle', templateId: 'item_recycle', templateVersion: 1,
      title: '卖掉闲置', description: '把不需要的旧物卖给铺子，按行情换几个金币。',
      evidence: { source: 'building.description', quote: '按行情换成金币' },
      priceTier: 'free',
      params: { acceptCatalogKeys: ['catalog_mood_patch'], valuationTier: 'premium' },
      presentation: { opening: '掌柜眯着眼睛打量来客的背包，看有没有能收的旧货。', success: '收下了{itemName}，付了{price}金币。', empty: '今天不收货。' },
    }],
  };
  const swapSource = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'swap_post' });
  const buybackSource = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'buyback' });
  const swapCompiled = await installCompiledConfig(env, swapSource, swapGenerated);
  const recycleCompiled = await installCompiledConfig(env, buybackSource, recycleGenerated);
  const swapFeature = swapCompiled.features[0];
  const recycleFeature = recycleCompiled.features[0];
  seedPlayerWallet(env.runtime, 100);
  const wallet = () => env.runtime.getTownWallet().balance;

  // 给玩家一件可交换的物品（npc-stock 来源带已知买入价 15）
  const stockId = db.prepare(
    `INSERT INTO town_npc_stock (world_id, npc_id, template_id, template_version, effect_key, price,
      custom_name, custom_desc, rolled_at, next_roll_at) VALUES (?, 1, 't', 1, 'mood_fix', 15, '心情修补贴', '测试', datetime('now'), datetime('now'))`)
    .run(source.worldId).lastInsertRowid;
  const playerItemId = db.prepare(
    `INSERT INTO backpack_items (effect_key, name, description, rarity, status, payload_json, owner_key,
      source_type, world_id, source_id, source_index, template_id, collected_at, acquired_at, version)
     VALUES ('mood_fix', '心情修补贴', '贴一下就会开心起来。', 'common', 'ready', '{}', 'me',
       'trade', ?, ?, 0, 'mood_patch', datetime('now'), datetime('now'), 1)`)
    .run(source.worldId, `npc-stock:${stockId}`).lastInsertRowid;

  // 到达换物小摊执行交换
  now.value += 60000;
  const { scope: swapScope } = await arriveAt(env, now, places[0]);
  const swapQuote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'swap_post', featureId: swapFeature.featureId,
    selection: { optionKey: 'old_lamp', itemIds: [Number(playerItemId)] }, ...swapScope });
  assert.equal(swapQuote.price, 0, 'exchange is free (one for one)');
  const swapOp = runtime.executeTownBuildingFeature({ ...swapScope, mapId, locationKey: 'swap_post',
    featureId: swapFeature.featureId, quoteId: swapQuote.quoteId, quoteExpiresAt: swapQuote.expiresAt,
    idempotencyKey: 'swap-1', selection: { optionKey: 'old_lamp', itemIds: [Number(playerItemId)] } });
  assert.equal(swapOp.status, 'committed');
  assert.ok(db.prepare('SELECT retired_at FROM backpack_items WHERE id = ?').get(Number(playerItemId)).retired_at,
    'accepted item retired, kept for traceability');
  const swappedItem = db.prepare("SELECT * FROM backpack_items WHERE source_id = ? ORDER BY id DESC").get(`bf:${mapId}:swap_post:old_lamp`);
  assert.ok(swappedItem, 'goods granted');
  assert.equal(db.prepare(
    "SELECT quantity FROM town_resource_stocks WHERE owner_key LIKE ?").get(`building-stock:${mapId}:swap_post:%`).quantity, 2);

  // 回收：报价 = min(估值档, 已知买入价)，杜绝低价买入高价回收
  // 回收目录只收 mood_patch——再给玩家一件（换出去的那件 lamp 不在目录内，应被拒）
  now.value += 60000;
  const { scope: buybackScope } = await arriveAt(env, now, places[1]);
  assert.throws(() => runtime.quoteTownBuildingFeature({ mapId, locationKey: 'buyback',
    featureId: recycleFeature.featureId, selection: { itemIds: [Number(swappedItem.id)] }, ...buybackScope }),
    err => err.code === 'INVALID_SELECTION', 'goods outside the accept catalog must be refused');
  const recycleItemId = db.prepare(
    `INSERT INTO backpack_items (effect_key, name, description, rarity, status, payload_json, owner_key,
      source_type, world_id, source_id, source_index, template_id, collected_at, acquired_at, version)
     VALUES ('mood_fix', '心情修补贴', '贴一下就会开心起来。', 'common', 'ready', '{}', 'me',
       'trade', ?, ?, 1, 'mood_patch', datetime('now'), datetime('now'), 1)`)
    .run(source.worldId, `npc-stock:${stockId}`).lastInsertRowid;
  const recycleQuote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'buyback', featureId: recycleFeature.featureId,
    selection: { itemIds: [Number(recycleItemId)] }, ...buybackScope });
  const valueOfNewGoods = recycleQuote.price;
  const cap = trade.lookupBuyPriceCap(db,
    db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(Number(recycleItemId)));
  assert.equal(valueOfNewGoods, cap, 'quote equals the server-side capped valuation');
  // 换出去的旧灯（无目录模板）若被回收，只能按 basic 档兜底——套利被封死
  assert.equal(trade.lookupBuyPriceCap(db,
    db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(Number(swappedItem.id))), 5);
  // 高价物品按已知买入价封顶（npc-stock 来源价 15）
  assert.equal(trade.lookupBuyPriceCap(db,
    db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(Number(recycleItemId))), 15);

  // 已被锁定的物品不可交易
  db.prepare('UPDATE backpack_items SET locked_by = ? WHERE id = ?').run('other-op', Number(recycleItemId));
  assert.throws(() => runtime.quoteTownBuildingFeature({ mapId, locationKey: 'buyback',
    featureId: recycleFeature.featureId, selection: { itemIds: [Number(recycleItemId)] }, ...buybackScope }),
    err => err.code === 'INVALID_SELECTION');
});

test('operator funds bound payouts; missing operator blocks paid features', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'shop', name: '旧货铺', businessKind: 'supplier', operatorJob: '货郎',
      featureDesc: '出售居民闲置物品，偶尔也回收一些旧货。' }],
  });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'shop' });
  const compiled = await installCompiledConfig(env, source, shopConfig());
  seedPlayerWallet(env.runtime, 500);
  const { scope } = await arriveAt(env, now, places[0]);
  const featureId = compiled.features[0].featureId;
  const operatorAccountId = db.prepare('SELECT account_id FROM economy_accounts WHERE owner_key = ?').get(`building:${mapId}:shop`).account_id;
  const operatorBalance = () => db.prepare('SELECT balance FROM economy_accounts WHERE account_id = ?').get(operatorAccountId).balance;
  const buy = (idem) => {
    const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'shop', featureId,
      selection: { offerKey: 'old_lamp' }, ...scope });
    return runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'shop', featureId,
      quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: idem,
      selection: { offerKey: 'old_lamp' } });
  };
  buy('fund-1');
  assert.equal(operatorBalance(), 205, 'opening funds 200 + the payment lands in the building account');
  // 经营者更换：操作绑定原经营者快照，新操作用新账户（这里只验证资金进入建筑账户而非个人钱包）
  const npcAccount = db.prepare("SELECT count(*) n FROM economy_accounts WHERE owner_key LIKE 'actor:%'").get().n;
  buy('fund-2');
  assert.equal(operatorBalance(), 210);
  assert.equal(db.prepare("SELECT count(*) n FROM economy_accounts WHERE owner_key LIKE 'actor:%'").get().n,
    npcAccount, 'no personal wallet created for the operator');
});

test('feature view carries real shelf stock so the shop can grey out sold-out cells', async t => {
  const env = await setupTownEnvironment(t);
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'shop', name: '旧货铺', businessKind: 'supplier', operatorJob: '货郎',
      featureDesc: '出售居民闲置物品，偶尔也回收一些旧货。' }],
  });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'shop' });
  const compiled = await installCompiledConfig(env, source, shopConfig());
  const featureId = compiled.features[0].featureId;
  seedPlayerWallet(env.runtime, 100);
  const { scope } = await arriveAt(env, now, places[0]);

  const shelfStock = () => runtime.getTownBuildingFeatures({ mapId, locationKey: 'shop' })
    .features.find(f => f.featureId === featureId).stock;
  assert.deepEqual(shelfStock(), { old_lamp: 3 }, 'opening stock 3 is visible in the view');

  // 逐件买空后视图归零——前端缺货格置灰的依据
  for (let i = 0; i < 3; i++) {
    const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'shop', featureId,
      selection: { offerKey: 'old_lamp' }, ...scope });
    runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'shop', featureId,
      quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: `view-buy-${i}`,
      selection: { offerKey: 'old_lamp' } });
  }
  assert.equal(shelfStock().old_lamp, 0, 'sold-out shelf reads 0 in the view');
});

test('lookupBuyPriceCap works on fresh databases (legacy town_npc_functions table removed)', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const worldId = db.prepare('SELECT world_id FROM town_world_state WHERE singleton = 1').get().world_id;
  // 带目录模板但无 npc-stock 来源价的物品：修复前会查询已废弃的 town_npc_functions 表 → SQLITE_ERROR
  const info = db.prepare(`INSERT INTO backpack_items (effect_key, name, description, rarity, status, payload_json, owner_key,
      source_type, world_id, source_id, source_index, template_id, collected_at, acquired_at, version)
     VALUES ('mood_fix', '目录旧物', '回归测试物品。', 'common', 'ready', '{}', 'me',
       'trade', ?, 'regression-seed', 1, 'mood_patch', datetime('now'), datetime('now'), 1)`)
    .run(worldId);
  const item = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(Number(info.lastInsertRowid));
  assert.equal(trade.lookupBuyPriceCap(db, item), 5, 'unknown origin falls back to the basic tier');
});
