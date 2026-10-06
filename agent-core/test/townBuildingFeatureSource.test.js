import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const serviceModule = await import('../src/services/town/townBuildingFeatureService.js');
const {
  setupTownEnvironment, buildTown,
} = await import('./helpers/townBuildingFeatureFixture.js');

test('source priority: user description wins, asset meta fills, blank stays blank', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const { mapId } = buildTown({
    ...env, withAssets: true,
    assetDesc: { well: '一口能听见回声的老井，往里丢一枚饰品就能换到小东西。', gazebo: '一座挂着沉默铜钟的观景亭子。' },
    buildings: [
      { key: 'well', name: '回声交换井', businessKind: 'none', featureDesc: '用一枚指定饰品，换一件井中取出的小物。' },
      { key: 'gazebo', name: '静默钟楼', businessKind: 'none' },
    ],
  });
  const context = env.runtime.getTownEconomyContext();
  const well = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'well' });
  assert.equal(well.title, '回声交换井');
  assert.equal(well.description, '用一枚指定饰品，换一件井中取出的小物。');
  assert.equal(well.descriptionSource, 'location.feature_desc', 'user-written purpose wins over asset meta');
  assert.equal(well.assetId != null, true, 'asset linkage resolved through map object');

  // 无手填描述时回填素材 meta.desc；都没有则空值（不从外观提示词编造）
  const gazebo = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'gazebo' });
  assert.equal(gazebo.descriptionSource, 'asset.meta.desc');
  assert.ok(gazebo.description.length > 0);

  // sourceHash：用途/标题变化 → 哈希变化；ambient 变化 → 不变
  const hash1 = sourceModule.computeSourceHash(well);
  db.prepare('UPDATE town_locations SET feature_desc = ? WHERE map_id = ? AND key = ?')
    .run('现在只听回声，不再交换东西。', mapId, 'well');
  const well2 = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'well' });
  assert.notEqual(sourceModule.computeSourceHash(well2), hash1, 'purpose change drifts the hash');
  db.prepare('UPDATE town_locations SET ambient = ? WHERE map_id = ? AND key = ?')
    .run('傍晚有风。', mapId, 'well');
  const well3 = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'well' });
  assert.equal(sourceModule.computeSourceHash(well3), sourceModule.computeSourceHash(well2),
    'ambient is a weak hint and not part of the hash');
});

test('instance isolation: same asset on two maps keeps independent identities', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const first = buildTown({
    ...env, withAssets: true, assetDesc: { cafe: '海边小咖啡馆，老板会拉花。' },
    buildings: [{ key: 'cafe', name: '咖啡馆', businessKind: 'cafe' }],
  });
  const second = buildTown({
    ...env, withAssets: true, assetDesc: { cafe: '另一张镇上的咖啡馆素材。' },
    buildings: [{ key: 'cafe', name: '咖啡馆二号', businessKind: 'cafe' }],
  });
  const context = env.runtime.getTownEconomyContext();
  const a = sourceModule.resolveBuildingFeatureSource(context, { mapId: first.mapId, locationKey: 'cafe' });
  const b = sourceModule.resolveBuildingFeatureSource(context, { mapId: second.mapId, locationKey: 'cafe' });
  assert.notEqual(a.buildingInstanceId, b.buildingInstanceId,
    'building instance id is scoped by map (key stays unique per map)');
  assert.notEqual(a.sourceHash, b.sourceHash, 'different instances have different identities');
  assert.notEqual(a.assetId, b.assetId, 'map copy creates a new asset instance');

  // 配置/库存/操作不得跨实例共享：给 a 装配配置后 b 仍是 unconfigured
  const profileA = serviceModule.ensureProfile(db, a);
  assert.equal(profileA.building_instance_id, `${first.mapId}:cafe`);
  const { getDb } = await import('../src/db/index.js');
  void getDb;
  const rows = db.prepare('SELECT building_instance_id FROM town_building_feature_profiles').all();
  assert.equal(rows.length, 1, 'profile is scoped per (world, epoch, instance)');

  // 重排保持：location key 原地更新（id 不变），来源身份保持
  const locationBefore = db.prepare('SELECT id FROM town_locations WHERE map_id = ? AND key = ?')
    .get(first.mapId, 'cafe');
  const { saveMap } = await import('../src/services/town/townMapService.js');
  const grid = () => Array.from({ length: 14 }, () => Array(14).fill(null));
  // 真实重排：对象换新位置，location 按原 objectId 重新绑定
  const layersRaw = db.prepare('SELECT layers_json FROM town_maps WHERE id = ?').get(first.mapId);
  const originalObjects = JSON.parse(layersRaw.layers_json).objects;
  saveMap({ mapId: first.mapId, name: '建筑功能测试镇#1', cols: 14, rows: 14,
    layers: { ground: grid(), road: grid(), objects: originalObjects.map(o => ({ ...o, x: 9, y: 9 })) },
    locations: [{ key: 'cafe', name: '咖啡馆', businessKind: 'cafe', x: 9, y: 9, radius: 0, objectId: originalObjects[0].id }] });
  const locationAfter = db.prepare('SELECT id FROM town_locations WHERE map_id = ? AND key = ?')
    .get(first.mapId, 'cafe');
  assert.equal(locationAfter.id, locationBefore.id, 'relayout preserves the location row');
  const aAgain = sourceModule.resolveBuildingFeatureSource(context, { mapId: first.mapId, locationKey: 'cafe' });
  assert.equal(aAgain.sourceHash, a.sourceHash, 'relayout does not drift the identity');
});

test('ownerless buildings: no operator resolved; description admin path works', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const { mapId } = buildTown({
    ...env,
    buildings: [
      { key: 'shop', name: '旧货铺', businessKind: 'supplier', operatorJob: '货郎', featureDesc: '卖旧货。' },
      { key: 'plaza', name: '中央广场', businessKind: 'none' },
    ],
  });
  const context = env.runtime.getTownEconomyContext();
  const shop = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'shop' });
  assert.equal(shop.operator, undefined, 'buildings are ownerless: no operator is resolved at all');
  const plaza = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'plaza' });
  assert.equal(plaza.operator, undefined, 'ownerless holds for every building');

  serviceModule.setBuildingFeatureDescription(db, { mapId, locationKey: 'shop', description: '改后的描述：兼收旧货。' });
  assert.throws(() => serviceModule.setBuildingFeatureDescription(db, { mapId, locationKey: 'nope', description: 'x' }),
    err => err.code === 'LOCATION_NOT_FOUND');
});
