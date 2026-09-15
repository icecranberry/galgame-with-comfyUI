import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = ':memory:';
const STATE_FILE = path.join(os.tmpdir(), `town-map-reset-state-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
globalThis.fetch = async url => { throw Error(`map reset fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'map-reset-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { saveMap, getMapRow } = await import('../src/services/town/townMapService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const router = (await import('../src/routes/town.js')).default;

// 多地图回归：管理面板危险区的「重新初始化」曾经调 resetWorld()，于是一按下去
// 世界里**所有**小镇的地图、地点、居民、相遇一起没了。它自己的文案写的是「清除当前地图」，
// 行为必须和文案一致：只清当前这一座，别的镇原样留着。

const COLS = 30, ROWS = 30;

/** 直接驱动 express router（DELETE /maps/:id 会把结果 res.json 出来） */
function call(method, url) {
  return new Promise((resolve, reject) => {
    const req = { method, url, body: undefined, query: {} };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
    };
    router.handle(req, res, err => (err ? reject(err) : resolve({ status: 404, payload: null })));
  });
}

function seedGroundAsset(db, key, name) {
  return Number(db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
    VALUES ('ground', ?, ?, '/town-assets/test.png', '{}', NULL, 'ready')`).run(key, name).lastInsertRowid);
}

/** 一座镇：一张铺满自己地皮的图 + 一个广场 POI */
function makeTown(db, name, groundAssetId, plazaX) {
  const ground = Array.from({ length: ROWS }, () => Array(COLS).fill(groundAssetId));
  const road = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const { mapId } = saveMap({ create: true, name, cols: COLS, rows: ROWS,
    layers: { ground, road, objects: [] },
    locations: [{ key: 'plaza', name: `${name}广场`, x: plazaX, y: 15, radius: 3 }] });
  return mapId;
}

function addEncounter(db, mapId, a, b, summary) {
  return Number(db.prepare('INSERT INTO town_encounters (map_id, char_a, char_b, status, summary) VALUES (?, ?, ?, ?, ?)')
    .run(mapId, a, b, 'done', summary).lastInsertRowid);
}

test('重新初始化一座小镇：只清这一座，别的镇的地图/居民/相遇原样保留', async t => {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); });

  const keepGround = seedGroundAsset(db, 'grass_01_01', '青草地 01');
  const dropGround = seedGroundAsset(db, 'ceramic_tile_01_01', '学园陶瓷地砖 01');

  const keepTown = makeTown(db, '留下的镇', keepGround, 10);
  const dropTown = makeTown(db, '要重来的镇', dropGround, 20);
  assert.notEqual(keepTown, dropTown);

  const keepNpcs = ['留甲', '留乙'].map(n => createNpc({ mapId: keepTown, displayName: n, job: '居民', routine: [] }).id);
  const dropNpcs = ['删甲', '删乙'].map(n => createNpc({ mapId: dropTown, displayName: n, job: '居民', routine: [] }).id);

  db.prepare('INSERT INTO town_npc_chat_messages (npc_id, role, content) VALUES (?, ?, ?)').run(keepNpcs[0], 'user', '留下镇的对话');
  db.prepare('INSERT INTO town_npc_chat_messages (npc_id, role, content) VALUES (?, ?, ?)').run(dropNpcs[0], 'user', '该跟着镇一起消失的对话');

  addEncounter(db, keepTown, -1, -2, '留下镇的相遇');
  const doomedEncounter = addEncounter(db, dropTown, -3, -4, '要重来镇的相遇');
  db.prepare('INSERT INTO town_chat_messages (encounter_id, speaker_char_id, content) VALUES (?, ?, ?)')
    .run(doomedEncounter, -3, '这句话该跟着镇一起消失');

  db.prepare('INSERT INTO town_agent_state (agent_key, map_id, grid_x, grid_y) VALUES (?, ?, 1, 1)').run('npc:1', keepTown);
  db.prepare('INSERT INTO town_agent_state (agent_key, map_id, grid_x, grid_y) VALUES (?, ?, 2, 2)').run('npc:3', dropTown);

  // 玩家正站在要重来的那座镇上，且是唯一一帧「未落座」以外的可能状态
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 20, 20, ?)")
    .run(dropTown);

  town.startTownScheduler();
  town.touchTownViewer();
  assert.equal(town.getTownMaps().currentMapId, dropTown);

  const before = getMapRow(keepTown);
  const result = await call('DELETE', `/maps/${dropTown}`);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.mapId, dropTown);

  // 1) 目标镇被清干净
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_maps WHERE id = ?').get(dropTown).n, 0, '地图行已删');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_npcs WHERE map_id = ?').get(dropTown).n, 0, '居民已清');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_locations WHERE map_id = ?').get(dropTown).n, 0, 'POI 已清');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_encounters WHERE map_id = ?').get(dropTown).n, 0, '相遇已清');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_agent_state WHERE map_id = ?').get(dropTown).n, 0, '运行态快照已清');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_npc_chat_messages WHERE npc_id = ?').get(dropNpcs[0]).n, 0, '它的居民聊天已清');

  // 2) 另一个镇一根汗毛都没动
  const after = getMapRow(keepTown);
  assert.notEqual(after, null, '别的镇的地图必须还在');
  assert.equal(after.name, '留下的镇');
  assert.deepEqual(after.layers.ground, before.layers.ground, '别的镇的地面图层逐格不变');
  assert.deepEqual(after.layers.objects, before.layers.objects, '别的镇的摆放不变');
  assert.deepEqual(db.prepare('SELECT display_name FROM town_npcs WHERE map_id = ? ORDER BY id').all(keepTown)
    .map(r => r.display_name), ['留甲', '留乙'], '别的镇的居民还在');
  assert.deepEqual(db.prepare('SELECT name FROM town_locations WHERE map_id = ? ORDER BY id').all(keepTown)
    .map(r => r.name), ['留下的镇广场'], '别的镇的 POI 还在');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_encounters WHERE map_id = ?').get(keepTown).n, 1, '别的镇的相遇记录还在');
  // loadState 会顺带把存活各图的居民重新落一份运行态快照，所以这里认「我那一条还在」而不是总数
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_agent_state WHERE map_id = ? AND agent_key = ?')
    .get(keepTown, 'npc:1').n, 1, '别的镇的运行态快照还在');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_npc_chat_messages WHERE npc_id = ?')
    .get(keepNpcs[0]).n, 1, '别的镇的居民聊天还在');

  // 3) 素材库不随镇删除（批量生图按 key 幂等复用，别的镇还要用）
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_assets').get().n, 2, '两张素材都还在');

  // 4) 玩家被安置到还活着的镇上，且和快照/目录口径一致
  assert.equal(db.prepare("SELECT map_id FROM town_players WHERE id = 'me'").get().map_id, keepTown, '玩家落到还活着的镇');
  assert.equal(town.getTownMaps().currentMapId, keepTown);
  assert.equal(town.getTownState().mapId, keepTown, '快照跟着玩家走');
  assert.equal(town.getTownState().map.id, keepTown);
});

test('重新初始化一座小镇：图上没有玩家时也不动玩家所在的另一座镇', async t => {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); });

  const aGround = seedGroundAsset(db, 'grass_01_01', '青草地 01');
  const bGround = seedGroundAsset(db, 'ceramic_tile_01_01', '学园陶瓷地砖 01');
  const homeTown = makeTown(db, '玩家住的镇', aGround, 10);
  const idleTown = makeTown(db, '空着的镇', bGround, 20);
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 10, 10, ?)")
    .run(homeTown);

  town.startTownScheduler();
  town.touchTownViewer();

  const result = await call('DELETE', `/maps/${idleTown}`);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_maps WHERE id = ?').get(idleTown).n, 0);
  assert.equal(db.prepare("SELECT map_id FROM town_players WHERE id = 'me'").get().map_id, homeTown, '玩家不会被搬走');
  assert.equal(town.getTownMaps().currentMapId, homeTown);
  assert.notEqual(getMapRow(homeTown), null);
});

test('重新初始化：地图 id 无效或不存在时给出 400，不误删任何镇', async t => {
  config.dbPath = ':memory:';
  config.features.town = true;
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); });

  const ground = seedGroundAsset(db, 'grass_01_01', '青草地 01');
  const onlyTown = makeTown(db, '唯一的镇', ground, 10);

  assert.equal((await call('DELETE', '/maps/9999')).status, 400);
  assert.equal((await call('DELETE', '/maps/abc')).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM town_maps').get().n, 1, '没有镇被删掉');
  assert.notEqual(getMapRow(onlyTown), null);
});
