import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import Database from 'better-sqlite3';
import { Router } from 'express';

// 执行真实服务/路由源码，仅替换 import 边界；绝不加载生产 DB/config/后台任务。
function isolatedModule(relativePath, dependencies, exports) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const names = [];
  const body = source.replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, (_, imports) => {
    names.push(...imports.split(',').map(name => name.trim()).filter(Boolean));
    return '';
  }).replace(/export function /g, 'function ').replace(/export \{ router as default \};/, '');
  assert.doesNotMatch(body, /\bimport\s/);
  return compileFunction(`${body}\nreturn { ${exports.join(', ')} };`, names)(
    ...names.map(name => dependencies[name] || (() => { throw new Error(`Unexpected dependency: ${name}`); })),
  );
}

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE town_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, grid_cols INTEGER, grid_rows INTEGER,
      layers_json TEXT, tile_size INTEGER, world_setting_id INTEGER, version INTEGER
    );
    CREATE TABLE town_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL REFERENCES town_maps(id),
      key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, aliases_json TEXT NOT NULL DEFAULT '[]',
      kind TEXT NOT NULL DEFAULT 'place' CHECK(kind IN ('home','place','outdoor')),
      grid_x INTEGER NOT NULL, grid_y INTEGER NOT NULL, radius INTEGER NOT NULL DEFAULT 2,
      ambient TEXT DEFAULT '', object_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE town_npcs (id INTEGER PRIMARY KEY, home_location_id INTEGER);
    CREATE TABLE town_characters (character_id INTEGER PRIMARY KEY, home_location_id INTEGER REFERENCES town_locations(id));
    CREATE TABLE town_agent_state (agent_key TEXT PRIMARY KEY, current_location_id INTEGER);
    CREATE TABLE business_fixture (id INTEGER PRIMARY KEY, location_id INTEGER REFERENCES town_locations(id));
  `);
  const events = [];
  const service = isolatedModule('../src/services/town/townMapService.js', {
    getDb: () => db,
    broadcastTownMapUpdated: event => {
      assert.equal(db.inTransaction, false, 'broadcast must follow commit');
      assert.equal(db.prepare('SELECT version FROM town_maps WHERE id = ?').get(event.mapId).version, event.version);
      events.push(event);
    },
  }, ['saveMap', 'getMapPayload']);
  const save = (overrides = {}) => service.saveMap({
    name: '测试小镇', cols: 4, rows: 4,
    layers: { ground: Array.from({ length: 4 }, () => Array(4).fill(null)) }, ...overrides,
  });
  const locations = () => db.prepare('SELECT * FROM town_locations ORDER BY id').all();
  const snapshot = () => JSON.stringify(['town_maps', 'town_locations', 'town_npcs', 'town_characters', 'town_agent_state']
    .map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  return { db, events, service, save, locations, snapshot };
}

const cafe = { key: 'cafe', name: '咖啡馆', x: 1, y: 2, objectId: 7 };
const home = { key: 'home', name: '住宅', kind: 'home', x: 3, y: 3 };

test('POI 按 key 原位更新：重排、改名、搬迁、重复保存保留 id 和商店/住宅引用', t => {
  const f = fixture(t);
  f.save({ locations: [cafe, home] });
  const [oldCafe, oldHome] = f.locations();
  f.db.prepare('INSERT INTO business_fixture VALUES (1, ?)').run(oldCafe.id);
  f.db.prepare('INSERT INTO town_npcs VALUES (1, ?)').run(oldHome.id);
  f.db.prepare('INSERT INTO town_characters VALUES (1, ?)').run(oldHome.id);
  const updated = { ...cafe, id: oldCafe.id, name: '新咖啡馆', aliases: ['咖啡屋'], x: 0, y: 0, radius: 0, objectId: 9, ambient: '安静' };
  for (let i = 0; i < 2; i++) f.save({ locations: [home, updated] });
  const current = f.service.getMapPayload().locations;
  assert.deepEqual(current.find(loc => loc.key === 'cafe'), { ...updated, kind: 'place' });
  assert.equal(current.find(loc => loc.key === 'home').id, oldHome.id);
  assert.equal(f.locations()[0].created_at, oldCafe.created_at);
  assert.equal(f.db.prepare('SELECT location_id FROM business_fixture').get().location_id, oldCafe.id);
  assert.equal(f.db.prepare('SELECT home_location_id FROM town_npcs').get().home_location_id, oldHome.id);
  assert.equal(f.db.prepare('SELECT home_location_id FROM town_characters').get().home_location_id, oldHome.id);
  assert.deepEqual(f.events.map(event => event.version), [1, 2, 3]);
});

test('省略/null 保留地点，[] 清空当前地图并只解除被删地点的引用', t => {
  const f = fixture(t);
  f.save({ locations: [home] });
  const [oldHome] = f.locations();
  f.save();
  f.save({ locations: null });
  assert.deepEqual(f.locations(), [oldHome]);
  f.db.exec(`INSERT INTO town_maps (id, name) VALUES (2, '其他地图');
    INSERT INTO town_locations (id, map_id, key, name, grid_x, grid_y) VALUES (99, 2, 'other', '其他地点', 0, 0);
    INSERT INTO town_npcs VALUES (1, ${oldHome.id}), (2, 99);
    INSERT INTO town_characters VALUES (1, ${oldHome.id}), (2, 99);
    INSERT INTO town_agent_state VALUES ('npc:1', ${oldHome.id}), ('npc:2', 99);`);
  f.save({ locations: [] });
  assert.deepEqual(f.locations().map(loc => loc.id), [99]);
  for (const table of ['town_npcs', 'town_characters']) {
    assert.deepEqual(f.db.prepare(`SELECT home_location_id FROM ${table}`).all().map(row => row.home_location_id), [null, 99]);
  }
  assert.deepEqual(f.db.prepare('SELECT current_location_id FROM town_agent_state').all().map(row => row.current_location_id), [null, 99]);
});

test('全量集合可同时增删地点，保留未删除地点 id，新建 id 不复用旧引用', t => {
  const f = fixture(t);
  f.save({ locations: [cafe, home] });
  const [oldCafe, oldHome] = f.locations();
  f.save({ locations: [cafe, { key: 'park', name: '公园' }] });
  assert.equal(f.locations()[0].id, oldCafe.id);
  assert.ok(f.locations()[1].id > oldHome.id);
});

test('非法集合、重复 key、id/key 冲突不会部分保存或广播', t => {
  const f = fixture(t);
  f.save({ locations: [cafe, home] });
  const [oldCafe, oldHome] = f.locations();
  const before = f.snapshot();
  for (const locations of [
    {}, '', [null], [{ key: ' ', name: '空 key' }], [{ key: 'x' }], [cafe, cafe],
    [{ ...cafe, id: oldHome.id }], [{ ...cafe, id: String(oldCafe.id) }],
    [{ ...cafe, id: oldCafe.id, key: 'renamed' }],
    [cafe, { key: 'new', name: '新地点', id: 999 }],
    [{ ...cafe, name: '临时修改' }, { ...home, kind: 'invalid' }],
  ]) {
    assert.throws(() => f.save({ name: '不得保存', locations }));
    assert.equal(f.snapshot(), before);
    assert.equal(f.events.length, 1);
  }
});

test('其他地图同 key 不可劫持，约束冲突回滚新地图内容', t => {
  const f = fixture(t);
  f.save({ locations: [cafe] });
  f.db.exec(`INSERT INTO town_maps (id, name) VALUES (2, '其他地图');
    INSERT INTO town_locations (map_id, key, name, grid_x, grid_y) VALUES (2, 'other', '其他地点', 0, 0);`);
  const before = f.snapshot();
  assert.throws(() => f.save({ locations: [{ key: 'other', name: '冲突' }] }), /UNIQUE/);
  assert.equal(f.snapshot(), before);
  assert.equal(f.events.length, 1);
});

test('被业务外键引用的地点删除失败，地图版本、住宅和位置引用全部回滚', t => {
  const f = fixture(t);
  f.save({ locations: [cafe] });
  const [{ id }] = f.locations();
  f.db.exec(`INSERT INTO business_fixture VALUES (1, ${id});
    INSERT INTO town_npcs VALUES (1, ${id}); INSERT INTO town_characters VALUES (1, ${id});
    INSERT INTO town_agent_state VALUES ('npc:1', ${id});`);
  const before = f.snapshot();
  assert.throws(() => f.save({ locations: [] }), /FOREIGN KEY/);
  assert.equal(f.snapshot(), before);
  assert.equal(f.events.length, 1);
});

test('首次保存失败无残留；旧 v1 地图升级保留地图及地点 id', t => {
  const f = fixture(t);
  assert.throws(() => f.save({ locations: [{ ...cafe, kind: 'invalid' }] }));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_maps').get().n, 0);
  assert.equal(f.events.length, 0);
  f.db.exec(`INSERT INTO town_maps (id, name, world_setting_id) VALUES (12, '旧地图', 6);
    INSERT INTO town_locations (id, map_id, key, name, grid_x, grid_y) VALUES (42, 12, 'cafe', '旧店', 1, 1);`);
  const result = f.save({ locations: [cafe] });
  assert.equal(result.mapId, 12);
  assert.equal(result.version, 1);
  assert.equal(f.locations()[0].id, 42);
  assert.equal(f.service.getMapPayload().worldSettingId, 6);
});

test('PUT /town/map 透传 locations，失败返回 400 且不刷新运行时', t => {
  const f = fixture(t);
  let reloads = 0;
  const { router } = isolatedModule('../src/routes/town.js', {
    Router, saveMap: f.service.saveMap, reloadTown: () => { reloads++; },
  }, ['router']);
  const handler = router.stack.find(layer => layer.route?.path === '/map' && layer.route.methods.put).route.stack[0].handle;
  function put(extra) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    handler({ body: { name: 'HTTP 地图', cols: 1, rows: 1, layers: { ground: [[null]] }, ...extra } }, response);
    return response;
  }
  assert.equal(put({ locations: [cafe] }).statusCode, 200);
  const [{ id }] = f.locations();
  assert.equal(put({ locations: [{ ...cafe, id, name: 'HTTP 更新' }] }).statusCode, 200);
  assert.equal(f.locations()[0].name, 'HTTP 更新');
  assert.equal(f.locations()[0].id, id);
  put({});
  put({ locations: null });
  assert.equal(f.locations()[0].id, id);
  const before = f.snapshot();
  assert.equal(put({ locations: {} }).statusCode, 400);
  assert.equal(f.snapshot(), before);
  assert.equal(reloads, 4);
  assert.equal(put({ locations: [] }).statusCode, 200);
  assert.equal(f.locations().length, 0);
  assert.equal(reloads, 5);
});

function confirmFixture(t) {
  const f = fixture(t);
  f.db.exec(`
    ALTER TABLE town_npcs ADD COLUMN map_id INTEGER;
    ALTER TABLE town_npcs ADD COLUMN display_name TEXT;
    ALTER TABLE town_npcs ADD COLUMN routine_json TEXT DEFAULT '[]';
    CREATE TABLE town_npc_chat_messages (npc_id INTEGER REFERENCES town_npcs(id), content TEXT);
    CREATE TABLE town_players (id TEXT PRIMARY KEY, display_name TEXT, appearance_desc TEXT);
  `);
  const job = {
    config: { worldSettingId: 8 }, npcIds: [],
    blueprint: { npcs: [], styleTags: 'pixel' },
    draftMap: { name: '向导小镇', cols: 4, rows: 4, layers: { ground: [[null]] }, locations: [cafe, home] },
  };
  const calls = { routine: [], playerSprites: [], npcSprites: [], persisted: 0, created: [] };
  const dependencies = {
    job, enqueueStep: fn => Promise.resolve().then(fn), getDb: () => f.db, saveMap: f.service.saveMap,
    setStatus: status => { job.status = status; }, getInitState: () => ({ status: job.status }),
    persistJob: () => { calls.persisted++; }, config: { user: { nickname: '测试玩家', gender: '女', appearance: '短发' } },
    createNpc: data => {
      calls.created.push(data);
      const result = f.db.prepare('INSERT INTO town_npcs (map_id, display_name) VALUES (?, ?)').run(data.mapId, data.displayName);
      return { id: Number(result.lastInsertRowid), ...data };
    },
    generateRoutine: async (npc, keys) => { calls.routine.push({ npc, keys }); return [{ locationKey: 'home' }]; },
    spawnPlayerSprites: (...args) => calls.playerSprites.push(args),
    generateNpcSprites: async id => { calls.npcSprites.push(id); },
    broadcastTownMapUpdated: event => f.events.push(event),
  };
  // 仅执行 confirmInit 的真实函数体，避免模块初始化读取真实 init-state.json 或加载 LLM。
  const source = readFileSync(new URL('../src/services/town/townInitService.js', import.meta.url), 'utf8');
  const start = source.indexOf('export function confirmInit()');
  const end = source.indexOf('/** 玩家正/背像素精灵', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end).replace('export function', 'function');
  const confirm = compileFunction(`${body}\nreturn confirmInit;`, Object.keys(dependencies))(...Object.values(dependencies));
  return { ...f, job, calls, confirm };
}

test('confirmInit 复用向导居民：稳定 POI/家地址，出生点覆盖，清理旧名单和移动状态', async t => {
  const f = confirmFixture(t);
  f.save({ locations: [cafe, home, { key: 'removed', name: '待删除住宅' }] });
  const [oldCafe, oldHome, removed] = f.locations();
  f.db.exec(`
    INSERT INTO business_fixture VALUES (1, ${oldCafe.id});
    INSERT INTO town_characters VALUES (1, ${oldHome.id}), (2, ${removed.id});
    INSERT INTO town_npcs (id, map_id, display_name, home_location_id, routine_json) VALUES
      (11, 99, '保留家', ${oldHome.id}, '[{"old":true}]'),
      (12, 99, '搬家', ${oldHome.id}, '[]'),
      (13, 99, '家被拆', ${removed.id}, '[]'),
      (14, 99, '旧名单', ${oldHome.id}, '[]');
    INSERT INTO town_npc_chat_messages VALUES (11, '保留聊天'), (14, '删除聊天');
    INSERT INTO town_agent_state VALUES ('npc:11', ${oldHome.id});
    INSERT INTO town_players VALUES ('me', '原玩家名', '旧外观');
  `);
  f.job.npcIds = [11, 12, 13];
  f.job.draftMap.locations = [{ ...home, name: '新住宅', x: 0 }, cafe];
  f.job.draftMap.npcSpawns = [
    { npcRef: '搬家', locationKey: 'cafe' }, { npcRef: '家被拆', locationKey: 'missing' },
  ];
  await f.confirm();
  assert.equal(f.job.status, 'done');
  assert.equal(f.calls.persisted, 1);
  assert.deepEqual(f.locations().map(loc => loc.id), [oldCafe.id, oldHome.id]);
  assert.deepEqual(f.db.prepare('SELECT home_location_id FROM town_characters ORDER BY character_id').all()
    .map(row => row.home_location_id), [oldHome.id, null]);
  assert.deepEqual(f.db.prepare('SELECT id, map_id, home_location_id FROM town_npcs ORDER BY id').all(), [
    { id: 11, map_id: 1, home_location_id: oldHome.id },
    { id: 12, map_id: 1, home_location_id: oldCafe.id },
    { id: 13, map_id: 1, home_location_id: null },
  ]);
  assert.equal(f.db.prepare('SELECT routine_json FROM town_npcs WHERE id = 11').get().routine_json, '[{"old":true}]');
  assert.deepEqual(f.db.prepare('SELECT npc_id FROM town_npc_chat_messages').all(), [{ npc_id: 11 }]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_agent_state').get().n, 0);
  assert.deepEqual(f.db.prepare('SELECT * FROM town_players').get(), { id: 'me', display_name: '原玩家名', appearance_desc: '测试玩家，女，短发' });
  assert.equal(f.calls.routine.length, 0);
  assert.equal(f.calls.created.length, 0);
  assert.deepEqual(f.calls.npcSprites, [11, 12, 13]);
  assert.deepEqual(f.calls.playerSprites, [['测试玩家，女，短发', 'pixel']]);
  await f.confirm();
  assert.deepEqual(f.locations().map(loc => loc.id), [oldCafe.id, oldHome.id]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_npcs').get().n, 3);
});

test('confirmInit 首次开镇按蓝图新建居民并用已保存 POI id 分配住宅/生成作息', async t => {
  const f = confirmFixture(t);
  f.job.blueprint.npcs = [{ displayName: '新居民', persona: '友善', job: '店员' }, { displayName: '无出生点' }];
  f.job.draftMap.npcSpawns = [{ npcRef: '新居民', locationKey: 'home' }];
  await f.confirm();
  const homeId = f.locations().find(loc => loc.key === 'home').id;
  const npcs = f.db.prepare('SELECT * FROM town_npcs ORDER BY id').all();
  assert.equal(npcs[0].home_location_id, homeId);
  assert.equal(npcs[1].home_location_id, null);
  assert.ok(npcs.every(npc => npc.map_id === 1 && npc.routine_json === '[{"locationKey":"home"}]'));
  assert.equal(f.calls.created[0].persona, '友善');
  assert.equal(f.calls.created[0].job, '店员');
  assert.equal(f.calls.routine.length, 2);
  assert.ok(f.calls.routine[0].keys.includes('cafe'));
  assert.ok(f.calls.routine[0].keys.includes('home'));
  assert.equal(f.db.prepare('SELECT display_name FROM town_players').get().display_name, '测试玩家');
  assert.equal(f.service.getMapPayload().worldSettingId, 8);
  assert.equal(f.job.status, 'done');
});

test('confirmInit 旧草稿省略 locations 仍表示空布局，清除旧住宅引用', async t => {
  const f = confirmFixture(t);
  f.save({ locations: [home] });
  f.db.prepare('INSERT INTO town_characters VALUES (1, ?)').run(f.locations()[0].id);
  delete f.job.draftMap.locations;
  await f.confirm();
  assert.equal(f.locations().length, 0);
  assert.equal(f.db.prepare('SELECT home_location_id FROM town_characters').get().home_location_id, null);
  assert.equal(f.job.status, 'done');
});

test('confirmInit 无草稿或 POI 保存失败时不清移动状态、不生成居民/素材、不标记完成', async t => {
  const f = confirmFixture(t);
  f.save({ locations: [home] });
  f.db.prepare("INSERT INTO town_agent_state VALUES ('me', ?)").run(f.locations()[0].id);
  const draft = f.job.draftMap;
  f.job.draftMap = null;
  assert.equal((await f.confirm()).ok, false);
  const before = f.snapshot();
  f.job.draftMap = { ...draft, locations: [home, home] };
  await assert.rejects(f.confirm(), /重复/);
  assert.equal(f.snapshot(), before);
  assert.notEqual(f.job.status, 'done');
  assert.equal(f.calls.persisted, 0);
  assert.equal(f.calls.created.length, 0);
  assert.equal(f.calls.playerSprites.length, 0);
  assert.equal(f.calls.npcSprites.length, 0);
  assert.equal(f.events.length, 1);
});
