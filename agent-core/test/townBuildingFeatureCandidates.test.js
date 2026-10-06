/**
 * 管理端候选清单与同名建筑组（用户口径 2026-10-07）：
 *   - 清单只收录特殊建筑（meta.special），普通建筑不出现；
 *   - 同名建筑功能共享一份配置，清单按名称去重（已配置实例优先为代表）；
 *   - 改用途描述 / 启停 / 生成整组同步。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const runtime = await import('../src/services/town/townBuildingFeatureRuntime.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const {
  setupTownEnvironment, buildTown, installCompiledConfig,
} = await import('./helpers/townBuildingFeatureFixture.js');

const fortuneGenerated = {
  schemaVersion: 1, supportLevel: 'supported', interpretation: '一座每天抽一支签看看今日小运道的小杂货铺，别无其他',
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

function buildSharedTown(env) {
  return buildTown({
    ...env,
    withAssets: true,
    buildings: [
      { key: 'shop_a', name: '奶油杂货铺', businessKind: 'none', featureDesc: '售卖奶油色小杂货，每天抽一张签。' },
      { key: 'shop_b', name: '奶油杂货铺', businessKind: 'none', featureDesc: '另一间奶油杂货铺，也每天抽一张签。' },
      { key: 'home', name: '普通民居', businessKind: 'none', featureDesc: '普通住房。', special: false },
    ],
  });
}

test('候选清单只收录特殊建筑，同名去重并优先已配置代表', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;  const { mapId } = buildSharedTown(env);

  // 未配置时：同名两间只出一个代表（先出现的 shop_a），普通民居不出现
  let list = runtime.listTownBuildingFeatureCandidates({ mapId });
  assert.deepEqual(list.map(b => [b.title, b.locationKey]), [['奶油杂货铺', 'shop_a']]);

  // 配置 shop_b 后：代表切换到已配置的 shop_b
  const context = env.runtime.getTownEconomyContext();
  const sourceB = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'shop_b' });
  const compiled = await installCompiledConfig(env, sourceB, fortuneGenerated);
  list = runtime.listTownBuildingFeatureCandidates({ mapId });
  assert.equal(list.length, 1);
  assert.equal(list[0].locationKey, 'shop_b');
  assert.equal(list[0].status, 'ready');
  assert.equal(list[0].features[0].featureId, compiled.features[0].featureId);
});

test('改用途描述整组同步：同名副本落同一份配置且漂移状态一致', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;  const { mapId } = buildSharedTown(env);
  const context = env.runtime.getTownEconomyContext();
  const sourceA = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'shop_a' });
  await installCompiledConfig(env, sourceA, fortuneGenerated);

  // 改代表描述：shop_b 的用途描述同步，且被整组复制建档（此前从未配置）
  runtime.updateTownBuildingFeatureDescription({ mapId, locationKey: 'shop_a', description: '整组统一的店铺描述，每天抽一张签。' });
  const siblingDesc = db.prepare('SELECT feature_desc FROM town_locations WHERE map_id = ? AND key = ?').get(mapId, 'shop_b');
  assert.equal(siblingDesc.feature_desc, '整组统一的店铺描述，每天抽一张签。');
  const repProfile = db.prepare('SELECT * FROM town_building_feature_profiles WHERE building_instance_id LIKE ?').get(`%:shop_a`);
  const siblingProfile = db.prepare('SELECT * FROM town_building_feature_profiles WHERE building_instance_id LIKE ?').get(`%:shop_b`);
  assert.ok(siblingProfile, '同名副本整组建档');
  assert.equal(siblingProfile.compiled_json, repProfile.compiled_json);
  assert.equal(siblingProfile.source_hash, repProfile.source_hash, '漂移状态整组一致（同为 stale）');
  const siblingSource = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'shop_b' });
  assert.equal(runtime.listTownBuildingFeatureCandidates({ mapId })[0].status, 'stale');
  // 副本经过同一漂移判定：stale 而不是 ready
  assert.equal(
    (await import('../src/services/town/townBuildingFeatureService.js')).effectiveStatus(siblingSource, siblingProfile),
    'stale');
});

test('停用与启用同步到同名副本', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;  const { mapId } = buildSharedTown(env);
  const context = env.runtime.getTownEconomyContext();
  const sourceB = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'shop_b' });
  await installCompiledConfig(env, sourceB, fortuneGenerated);
  // 先整组建档（与生成后的组内复制同路径）：shop_a 由此获得同一份配置；
  // 描述沿用建档时的文本，整组不产生漂移，启停后能恢复回 ready
  runtime.updateTownBuildingFeatureDescription({ mapId, locationKey: 'shop_b', description: '另一间奶油杂货铺，也每天抽一张签。' });

  runtime.setTownBuildingFeatureEnabled({ mapId, locationKey: 'shop_b', enabled: false });
  const statuses = () => db.prepare(
    'SELECT building_instance_id, status FROM town_building_feature_profiles WHERE building_instance_id LIKE ? ORDER BY building_instance_id')
    .all('%:shop_%');
  assert.deepEqual(statuses().map(r => r.status), ['disabled', 'disabled']);

  runtime.setTownBuildingFeatureEnabled({ mapId, locationKey: 'shop_b', enabled: true });
  // 启用恢复走既有语义：disabled 行恢复为 stale（无漂移也如此），关键是整组一致
  assert.deepEqual(statuses().map(r => r.status), ['stale', 'stale']);
});
