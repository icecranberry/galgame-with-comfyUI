import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { migrateTownMultiMapSchema } = await import('../src/db/index.js');

// 老库形态（单图）：town_maps 没有 status，town_locations.key 全库唯一，town_agent_state 主键只有 agent_key
function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE town_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grid_cols INTEGER NOT NULL,
      grid_rows INTEGER NOT NULL,
      layers_json TEXT,
      tile_size INTEGER DEFAULT 32,
      world_setting_id INTEGER,
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE town_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      kind TEXT NOT NULL DEFAULT 'place' CHECK(kind IN ('home','place','outdoor')),
      grid_x INTEGER NOT NULL,
      grid_y INTEGER NOT NULL,
      radius INTEGER NOT NULL DEFAULT 2,
      ambient TEXT DEFAULT '',
      object_id INTEGER,
      business_kind TEXT,
      capabilities_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE town_agent_state (
      agent_key TEXT PRIMARY KEY,
      grid_x INTEGER,
      grid_y INTEGER,
      path_json TEXT DEFAULT '[]',
      current_location_id INTEGER,
      activity_text TEXT DEFAULT '',
      updated_at DATETIME
    );
    CREATE TABLE town_npcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER,
      display_name TEXT NOT NULL,
      job TEXT DEFAULT ''
    );
    CREATE TABLE town_characters (
      character_id INTEGER PRIMARY KEY,
      town_enabled INTEGER DEFAULT 1,
      home_location_id INTEGER
    );
    CREATE TABLE town_players (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      grid_x INTEGER,
      grid_y INTEGER
    );

    INSERT INTO town_maps (name, grid_cols, grid_rows, version) VALUES ('老镇', 20, 20, 3);
    INSERT INTO town_locations (map_id, key, name, kind, grid_x, grid_y, business_kind) VALUES
      (1, 'plaza', '中央广场', 'place', 4, 4, NULL),
      (1, 'cafe', '咖啡馆', 'place', 9, 9, 'cafe');
    INSERT INTO town_npcs (map_id, display_name, job) VALUES (NULL, '茶娘阿圆', '茶摊主'), (1, '面包师傅', '面包师');
    INSERT INTO town_characters (character_id, town_enabled, home_location_id) VALUES (1, 1, 2), (2, 1, NULL);
    INSERT INTO town_players (id, display_name, grid_x, grid_y) VALUES ('me', '玩家', 4, 5);
    INSERT INTO town_agent_state (agent_key, grid_x, grid_y, current_location_id, activity_text) VALUES
      ('me', 4, 5, 1, '在广场'),
      ('npc:1', 4, 6, 1, '摆摊');
  `);
  return db;
}

test('迁移把单图老库补成多图：归属回填、key 图内唯一、快照按图分桶', () => {
  const db = legacyDb();

  migrateTownMultiMapSchema(db);

  // 旧地图获得出行目录需要的 status
  const map = db.prepare('SELECT * FROM town_maps WHERE id = 1').get();
  assert.equal(map.status, 'ready');
  assert.equal(map.version, 3, '版本号是运行时状态，不因迁移重置');

  // 居民：向导提前建档（map_id 为空）的历史行落到默认图；已有归属不动
  assert.equal(db.prepare('SELECT map_id FROM town_npcs WHERE id = 1').get().map_id, 1);
  assert.equal(db.prepare('SELECT map_id FROM town_npcs WHERE id = 2').get().map_id, 1);

  // 角色：优先按住宅所在图回填，缺住宅落到默认图
  assert.equal(db.prepare('SELECT map_id FROM town_characters WHERE character_id = 1').get().map_id, 1);
  assert.equal(db.prepare('SELECT map_id FROM town_characters WHERE character_id = 2').get().map_id, 1);

  // 玩家所在地图 = 聚焦口径的权威来源
  assert.equal(db.prepare("SELECT map_id FROM town_players WHERE id = 'me'").get().map_id, 1);

  // 运行时快照整批归入默认图，内容与行 id 逐字保留
  const snapshots = db.prepare('SELECT * FROM town_agent_state ORDER BY agent_key').all();
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots.map(s => [s.agent_key, s.map_id]), [['me', 1], ['npc:1', 1]]);
  assert.equal(snapshots[0].grid_x, 4);
  assert.equal(snapshots[1].activity_text, '摆摊');

  // 地点行 id 保留，且 key 变成图内唯一：第二张图可以再用同样的 key
  const plaza = db.prepare("SELECT * FROM town_locations WHERE map_id = 1 AND key = 'plaza'").get();
  assert.equal(plaza.id, 1);
  assert.equal(plaza.name, '中央广场');
  assert.equal(db.prepare("SELECT business_kind FROM town_locations WHERE key = 'cafe'").get().business_kind, 'cafe');
  db.prepare('INSERT INTO town_maps (id, name, grid_cols, grid_rows, version) VALUES (2, ?, 10, 10, 1)').run('海边的镇');
  db.prepare("INSERT INTO town_locations (map_id, key, name, kind, grid_x, grid_y) VALUES (2, 'plaza', '渡口', 'place', 1, 1)").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM town_locations WHERE key = 'plaza'").get().n, 2);

  // 幂等：重复跑不报错、不重建、不丢数据
  migrateTownMultiMapSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_locations').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_agent_state').get().n, 2);
  assert.ok(db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'town_agent_state'`).get().sql
    .includes('PRIMARY KEY (agent_key, map_id)'));
  db.close();
});

test('没有地图的库：旧快照无归属可依，直接清空而不是悬空', () => {
  const db = legacyDb();
  db.exec('DELETE FROM town_agent_state; DELETE FROM town_maps;');
  migrateTownMultiMapSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_agent_state').get().n, 0);
  assert.ok(db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'town_agent_state'`).get().sql
    .includes('PRIMARY KEY (agent_key, map_id)'));
  db.close();
});