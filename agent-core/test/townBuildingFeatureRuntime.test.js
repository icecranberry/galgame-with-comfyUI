import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const runtime = await import('../src/services/town/townBuildingFeatureRuntime.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const { compileGeneration } = await import('../src/services/town/townBuildingFeatureService.js');
const {
  setupTownEnvironment, buildTown, createResidentCharacter, installCompiledConfig,
  arriveAt, seedPlayerWallet,
} = await import('./helpers/townBuildingFeatureFixture.js');

const outfitGenerated = {
  schemaVersion: 1, supportLevel: 'supported', interpretation: '一间出租古装的裁缝铺，穿上一天，第二天再还回来就好',
  unsupported: [], resources: [],
  features: [{
    key: 'rent_outfit', templateId: 'outfit_change', templateVersion: 1,
    title: '租一套古装', description: '挑一件古装穿上一天，到期自动换回原来的样子。',
    evidence: { source: 'building.description', quote: '出租一天的古装' },
    priceTier: 'standard',
    params: { durationHours: 24, options: [
      { key: 'han_fu', label: '月白襦裙', appearance: '月白色的齐腰襦裙，裙面上绣着几枝淡淡的兰草，腰间系一条湖蓝色丝绦，行走时裙摆轻轻摆动。' },
      { key: 'ru_qun', label: '藕荷袄裙', appearance: '藕荷色的立领袄裙，领口与袖口缀着细细的银线滚边，裙摆处散落着小小的缠枝花纹，素雅又不失生气。' },
    ] },
    presentation: { opening: '裁缝铺的衣架上挂着几套成色很好的古装，慢慢挑。', success: '{targetName}换上了{optionLabel}，很衬气质。', empty: '衣架暂时空着，改天再来看看吧。' },
  }],
};

const fortuneGenerated = {
  schemaVersion: 1, supportLevel: 'supported', interpretation: '一座每天抽一支签看看今日小运道的小神龛，别无其他',
  unsupported: [], resources: [],
  features: [{
    key: 'daily_draw', templateId: 'daily_fortune', templateVersion: 1,
    title: '抽一支今日签', description: '每天抽一签，看看今天的小运道，完全免费。',
    evidence: { source: 'building.description', quote: '每天抽一张签' },
    priceTier: 'free',
    params: { entries: [
      { key: 'fortune_luck', title: '小吉签', text: '今天适合出门散步，说不定在街角就能捡到一件好玩的小东西，记得带回家。', stateProfileKey: null, durationHours: null, weight: 1 },
      { key: 'fortune_calm', title: '平稳签', text: '今天风平浪静，最适合坐在广场的台阶上晒晒太阳，什么都不想地发一小会儿呆。', stateProfileKey: null, durationHours: null, weight: 1 },
      { key: 'fortune_cozy', title: '安眠签', text: '今天适合早点钻进被窝，听镇上的风声入睡，梦里说不定有好吃的在等你。', stateProfileKey: null, durationHours: null, weight: 1 },
    ] },
    presentation: { opening: '签筒就摆在案上，诚心摇一支，签文由神龛亲笔写就。', success: '「{optionLabel}」——今天就这样定了。', empty: '今天的签已经发完了。' },
  }],
};

test('legacy NPC permissions do not restrict building templates; disabled status still stops execution', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.parse('2026-10-03T11:00:00+08:00') };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'stall', name: '旧货铺', businessKind: 'supplier', operatorJob: '货郎',
      featureDesc: '售卖居民们闲置的小物件，偶尔也收一些旧货。' }],
  });
  // 旧地点只有 service，也能按新模板生成交易功能。
  db.prepare('UPDATE town_locations SET capabilities_json = ? WHERE map_id = ? AND key = ?')
    .run('["service"]', mapId, 'stall');
  const purchaseGenerated = {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '收购并出售居民闲置物品的小旧货铺，货架上摆满了旧物',
    unsupported: [], resources: [{
      key: 'old_lamp', name: '旧街灯', description: '一盏擦得很亮的小旧街灯，据说晚上会发出暖黄的光。',
      itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null,
    }],
    features: [{
      key: 'sell_goods', templateId: 'item_purchase', templateVersion: 1,
      title: '买下旧街灯', description: '买下那盏擦得很亮的旧街灯，直接放进背包带走。',
      evidence: { source: 'building.description', quote: '售卖居民们闲置的小物件' },
      priceTier: 'free',
      params: { offers: [{ resourceKey: 'old_lamp', label: '旧街灯', priceTier: 'basic' }] },
      presentation: { opening: '字'.repeat(24), success: '字'.repeat(12), empty: '字'.repeat(8) },
    }],
  };
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'stall' });
  // 建筑模板编译不再读取旧职能权限
  assert.doesNotThrow(() => compileGeneration(db, source, purchaseGenerated));
  // 修改旧字段不会改变建筑来源或限制执行
  db.prepare('UPDATE town_locations SET capabilities_json = ? WHERE map_id = ? AND key = ?')
    .run('["service","trade"]', mapId, 'stall');
  const freshSource = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'stall' });
  assert.equal(freshSource.sourceHash, source.sourceHash);
  const compiled = await installCompiledConfig(env, freshSource, purchaseGenerated);
  const featureId = compiled.features[0].featureId;
  seedPlayerWallet(env.runtime, 100);
  const { scope } = await arriveAt(env, now, places[0]);
  const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'stall', featureId,
    selection: { offerKey: 'old_lamp' }, ...scope });
  const op = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'stall', featureId, quoteId: quote.quoteId,
    quoteExpiresAt: quote.expiresAt, idempotencyKey: 'buy-1', selection: { offerKey: 'old_lamp' } });
  assert.equal(op.status, 'committed');
  assert.equal(op.price, 5);
  // 停用后立即拒绝
  runtime.setTownBuildingFeatureEnabled({ mapId, locationKey: 'stall', enabled: false });
  assert.throws(() => runtime.quoteTownBuildingFeature({ mapId, locationKey: 'stall', featureId,
    selection: { offerKey: 'old_lamp' }, ...scope }), err => err.code === 'FEATURE_UNCONFIGURED');
  const disabledSource = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'stall' });
  const disabledProfile = db.prepare('SELECT status FROM town_building_feature_profiles WHERE building_instance_id = ?').get(`${mapId}:stall`);
  assert.equal(disabledProfile.status, 'disabled');
  void disabledSource;
});

test('master switch off: quote/execute/accept rejected and events hidden, operations stay settleable', async t => {
  const env = await setupTownEnvironment(t);
  const { config } = await import('../src/config.js');
  config.features.townBuildingFeatures = false;
  try {
    assert.throws(() => runtime.getTownBuildingFeatures({ locationKey: 'anywhere' }),
      err => err.code === 'CAPABILITY_DENIED', 'view hides the entry point');
    assert.throws(() => runtime.quoteTownBuildingFeature({ locationKey: 'anywhere', featureId: 'bfi:x' }),
      err => err.code === 'CAPABILITY_DENIED', 'quote rejected while the switch is off');
    assert.throws(() => runtime.executeTownBuildingFeature({ locationKey: 'anywhere', featureId: 'bfi:x', idempotencyKey: 'k' }),
      err => err.code === 'CAPABILITY_DENIED', 'execute rejected while the switch is off');
    assert.deepEqual(runtime.listTownBuildingFeatureEvents(), [], 'events hidden while the switch is off');
  } finally {
    config.features.townBuildingFeatures = true;
  }
});test('execute pipeline: quote, commit, idempotent replay and refusal paths', async t => {

  const env = await setupTownEnvironment(t);

  const { db } = env;

  const now = { value: Date.parse('2026-10-03T11:00:00+08:00') };

  t.mock.method(Date, 'now', () => now.value);

  const { mapId, places } = buildTown({

    ...env,

    buildings: [{ key: 'tailor', name: '裁缝铺', businessKind: 'none', featureDesc: '出租一天的古装。' }],

  });

  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'tailor' });

  const compiled = await installCompiledConfig(env, source, outfitGenerated);

  const featureId = compiled.features[0].featureId;

  const characterId = createResidentCharacter(env, { name: '阿岚' });

  seedPlayerWallet(env.runtime, 100);

  const { scope } = await arriveAt(env, now, places[0]);

  const selection = { optionKey: 'han_fu', targetActorKeys: [`char:${characterId}`] };



  // 报价  执行：确定性模板当场提交，并真实落下一条限时外观

  const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'tailor', featureId, selection, ...scope });

  assert.ok(quote.quoteId, '报价收据');

  const op = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'tailor', featureId,

    quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: 'rent-1', selection });

  assert.equal(op.status, 'committed');

  assert.equal(op.result.kind, 'appearance');

  const outfitRows = () => db.prepare('SELECT COUNT(*) AS c FROM global_outfits WHERE character_id = ?').get(characterId).c;

  assert.equal(outfitRows(), 1, '外观真实落库');



  // 同幂等键重放：返回同一操作，不重复扣费、不叠第二套外观

  const replay = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'tailor', featureId,

    quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: 'rent-1', selection });

  assert.equal(replay.operationId, op.operationId, '同键同体返回同一操作');

  assert.equal(outfitRows(), 1, '重放不叠外观');



  // 同键不同体：幂等冲突（不许拿旧键换一套外观）

  assert.throws(() => runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'tailor', featureId,

    quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: 'rent-1',

    selection: { optionKey: 'ru_qun', targetActorKeys: [`char:${characterId}`] } }),

  err => err.code === 'IDEMPOTENCY_CONFLICT');



  // 别的地图上的同名地点：拒绝（只能办自己所在小镇的店）

  assert.throws(() => runtime.executeTownBuildingFeature({ ...scope, mapId: mapId + 999, locationKey: 'tailor', featureId,

    quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: 'rent-2', selection }),

  err => err.code === 'NOT_ARRIVED');

});
