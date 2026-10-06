/**
 * 店铺已不承载特殊奇遇：town_building_feature_events 历史行由迁移函数在每次启动时
 * 强制清空（幂等）。本用例验证：插行 → 再跑迁移 → 表清空；再跑一次 → 仍为空。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTownEnvironment } from './helpers/townBuildingFeatureFixture.js';
import { migrateTownBuildingFeatureSchema } from '../src/db/townBuildingFeatureSchema.js';

function insertLegacyEventRow(db) {
  db.prepare(`INSERT INTO town_building_feature_events
    (world_id, world_epoch, map_id, building_instance_id, feature_id, status, title, description, opening, options_json, expires_at)
    VALUES ('w1', 1, 1, 'building:test', 'outfit_change', 'open', '旧模板事件', '旧描述', '旧开场', '[]', datetime('now', '+1 day'))`)
    .run();
}

test('migrateTownBuildingFeatureSchema wipes legacy town_building_feature_events rows on every run', async (t) => {
  const { db } = await setupTownEnvironment(t);

  // 启动迁移本身已把表清空（getDb 时执行过一次）
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_building_feature_events').get().n, 0);

  // 模拟遗留库：迁移之后再插一行历史事件
  insertLegacyEventRow(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_building_feature_events').get().n, 1);

  // 再跑一次迁移 → 表必须清空
  migrateTownBuildingFeatureSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_building_feature_events').get().n, 0);

  // 幂等：空表再跑一次仍为 0，且不报错
  migrateTownBuildingFeatureSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_building_feature_events').get().n, 0);
});
