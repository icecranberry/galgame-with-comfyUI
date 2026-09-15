import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');

// 「生成小镇」的第一步就是 resetWorld()：townInitService.startInit 会先调它清掉旧世界
// （地图/居民/相遇历史/道具锁/经济预留），再跑蓝图。回归背景：resetWorld 曾调用没有 import 的
// getTownLifeRuntime()，于是任何一次小镇初始化都在清理道具锁时抛 ReferenceError，
// /api/town/init/start 回 500，向导卡在第一步。
test('resetWorld 能独立完成世界重置：清空地图、推进 epoch', async t => {
  config.dbPath = ':memory:';
  config.features.town = true;
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); });

  db.prepare('INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES (?, ?, ?)')
    .run('旧镇', 32, 32);
  const before = db.prepare('SELECT epoch FROM town_world_state WHERE singleton = 1').get();

  const result = town.resetWorld();

  assert.equal(result.ok, true);
  assert.equal(result.worldEpoch, before.epoch + 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_maps').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_npcs').get().n, 0);
});
