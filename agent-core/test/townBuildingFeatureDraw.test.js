import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const runtime = await import('../src/services/town/townBuildingFeatureRuntime.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const draw = await import('../src/services/town/buildingFeatures/draw.js');
const {
  setupTownEnvironment, buildTown, createResidentCharacter, installCompiledConfig,
  arriveAt, seedPlayerWallet,
} = await import('./helpers/townBuildingFeatureFixture.js');

function poolConfig() {
  return {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '转动一次橱窗里的抽奖机，从有限奖池拿走一件小货',
    unsupported: [], resources: [
      { key: 'prize_a', name: '海星发卡', description: '一枚海星形状的发卡，别在头发上会轻轻闪。', itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null },
      { key: 'prize_b', name: '贝壳哨子', description: '一枚能吹出海浪声的小贝壳哨子，握在手里凉凉的，很适合夏天的傍晚。', itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null },
    ],
    features: [{
      key: 'lucky_machine', templateId: 'pool_draw', templateVersion: 1,
      title: '转动抽奖机', description: '投币转动抽奖机，从今日奖池里拿走抽中的一件。',
      evidence: { source: 'building.description', quote: '从有限奖池' },
      priceTier: 'basic',
      params: { pool: [{ resourceKey: 'prize_a', weight: 1 }, { resourceKey: 'prize_b', weight: 3 }],
        dailyLimit: 2, reveal: 'card' },
      presentation: { opening: '抽奖机的玻璃橱窗里摆满了小货品，投一枚金币就能转动一次。', success: '「{itemName}」归你了！', empty: '今日奖池已经空了。' },
    }],
  };
}

function fortuneConfig(withState) {
  return {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '每天抽一支签看看今日小运道的小神龛，仅此而已',
    unsupported: [], resources: [],
    features: [{
      key: 'daily_draw', templateId: 'daily_fortune', templateVersion: 1,
      title: '抽一支今日签', description: '每天抽一签，看看今天的小运道，完全免费。',
      evidence: { source: 'building.description', quote: '每天抽一张签' },
      priceTier: 'free',
      params: { entries: [
        { key: 'fortune_luck', title: '小吉签', text: '今天适合出门散步，说不定在街角就能捡到一件好玩的小东西，记得带回家。', stateProfileKey: withState ? 'tipsy' : null, durationHours: withState ? 6 : null, weight: 1 },
        { key: 'fortune_calm', title: '平稳签', text: '今天风平浪静，最适合坐在广场的台阶上晒晒太阳，什么都不想地发一小会儿呆。', stateProfileKey: null, durationHours: null, weight: 1 },
        { key: 'fortune_cozy', title: '安眠签', text: '今天适合早点钻进被窝，听镇上的风声入睡，梦里说不定有好吃的在等你。', stateProfileKey: null, durationHours: null, weight: 1 },
      ] },
      presentation: { opening: '签筒就摆在案上，诚心摇一支，今日的签文由神龛亲笔写就。', success: '「{optionLabel}」——今天就这样定了。', empty: '今天的签已经发完了。' },
    }],
  };
}

test('pool_draw: fixed seed, bounded weights by stock, empty pool refuses to charge', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'machine', name: '海边杂货摊', businessKind: 'supplier', operatorJob: '货郎',
      featureDesc: '摆着一台从有限奖池抽奖的旧机器，每天限量。' }],
  });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'machine' });
  const compiled = await installCompiledConfig(env, source, poolConfig());
  const featureId = compiled.features[0].featureId;
  seedPlayerWallet(env.runtime, 100);
  const { scope } = await arriveAt(env, now, places[0]);
  const wallet = () => env.runtime.getTownWallet().balance;
  const before = wallet();

  const drawOnce = (idem) => {
    const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'machine', featureId,
      selection: {}, ...scope });
    return runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'machine', featureId,
      quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: idem, selection: {} });
  };

  // 种子在操作创建时持久化；重试路径不重抽（结果已绑定操作行）
  const op1 = drawOnce('draw-1');
  assert.equal(op1.status, 'committed');
  assert.ok(op1.seed, 'server-side seed persisted');
  assert.ok(['海星发卡', '贝壳哨子'].includes(op1.result.itemName));
  assert.equal(wallet(), before - 5, 'basic entry fee charged');
  assert.ok(db.prepare('SELECT 1 FROM backpack_items WHERE id = ?').get(op1.result.itemId), 'prize delivered');

  // 每日 2 次；库存共 6 件，抽完前允许第 2 次
  now.value += 60000;
  const op2 = drawOnce('draw-2');
  assert.equal(op2.status, 'committed');
  // 每日上限 2：第 3 次拒绝
  now.value += 60000;
  assert.throws(() => drawOnce('draw-3'), err => err.code === 'DAILY_LIMIT');
  assert.equal(wallet(), before - 10);

  // 单元级：固定种子结果确定；空奖池拒绝
  const pool = [{ resourceKey: 'a', weight: 2 }, { resourceKey: 'b', weight: 5 }];
  const first = draw.drawFromPool({ seed: 'seed-x', pool, availability: { a: 1, b: 1 } });
  assert.equal(draw.drawFromPool({ seed: 'seed-x', pool, availability: { a: 1, b: 1 } }).resourceKey, first.resourceKey,
    'same seed yields same result');
  assert.throws(() => draw.drawFromPool({ seed: 'seed-x', pool, availability: { a: 0, b: 0 } }),
    err => err.code === 'OUT_OF_STOCK', 'empty pool refuses');
  // 库存清零的资源不参与有效权重
  const onlyB = new Set(Array.from({ length: 30 }, () => draw.drawFromPool({ seed: `s${Math.random()}`,
    pool, availability: { a: 0, b: 9 } }).resourceKey));
  assert.deepEqual([...onlyB], ['b'], 'out-of-stock prize excluded from effective weights');
});

test('daily_fortune: same result per day, target change and refresh never redraw', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  // 与 runtime 测试同一口径：mock 基准取真实时刻（状态到期比较走 SQLite 真实时钟）
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'shrine', name: '星愿神龛', businessKind: 'none', featureDesc: '每天抽一张签，签文会写今天的小运道。' }],
  });
  const characterId = createResidentCharacter(env, { name: '青柠' });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'shrine' });
  const compiled = await installCompiledConfig(env, source, fortuneConfig(false));
  const featureId = compiled.features[0].featureId;
  const { scope } = await arriveAt(env, now, places[0]);

  // 当日种子直接由日期键决定：换目标、换 idempotencyKey 结果一致
  const dayKey = draw.dailyKey({ worldId: scope.worldId, buildingInstanceId: `${mapId}:shrine`,
    featureId, playerActorId: 'player-1' });
  const picked = draw.drawDailyFortune({ seed: dayKey.seed, entries: compiled.features[0].params.entries });
  assert.equal(draw.drawDailyFortune({ seed: dayKey.seed, entries: compiled.features[0].params.entries }).key,
    picked.key, 'same day yields the same fortune');

  const drawOnce = (idem, selection) => {
    const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'shrine', featureId,
      selection, ...scope });
    return runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'shrine', featureId,
      quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: idem, selection });
  };
  const op1 = drawOnce('f-1', {});
  assert.equal(op1.status, 'committed');
  assert.equal(op1.price, 0, 'fortune is free');
  assert.ok(db.prepare('SELECT 1 FROM town_building_feature_usage WHERE building_instance_id = ? AND used_count = 1')
    .get(`${mapId}:shrine`), 'usage row recorded');
  assert.throws(() => drawOnce('f-2', { targetActorKeys: [`char:${characterId}`] }),
    err => err.code === 'DAILY_LIMIT', 'target change cannot bypass one-draw-per-day');
  // 跨设备/刷新语义：同一玩家同一窗口只有一行
  assert.equal(db.prepare('SELECT count(*) n FROM town_building_feature_usage WHERE feature_id = ?').get(featureId).n, 1);

  // 跨日：窗口滚动后可再抽
  now.value += 24 * 3600 * 1000;
  const op2 = drawOnce('f-3', {});
  assert.equal(op2.status, 'committed');

  // 签运附带状态（M2 开放后）：受效目标持久化，状态真实生效
  now.value += 24 * 3600 * 1000;
  const stateCompiled = await installCompiledConfig(env, source, fortuneConfig(true));
  const stateFeatureId = stateCompiled.features[0].featureId;
  const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'shrine', featureId: stateFeatureId,
    selection: { targetActorKeys: [`char:${characterId}`] }, ...scope });
  const op3 = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'shrine',
    featureId: stateFeatureId, quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt,
    idempotencyKey: 'f-4', selection: { targetActorKeys: [`char:${characterId}`] } });
  assert.equal(op3.status, 'committed');
  if (op3.result.stateApplied) {
    assert.equal(op3.result.stateApplied.targetName, '青柠');
    const effect = db.prepare('SELECT * FROM item_effects WHERE id = ?').get(op3.result.stateApplied.effectId);
    assert.ok(effect && effect.character_id === characterId, 'state effect persisted on the target');
  }
});
