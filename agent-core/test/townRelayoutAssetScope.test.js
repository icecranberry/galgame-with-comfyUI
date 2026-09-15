import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = ':memory:';
const STATE_FILE = path.join(os.tmpdir(), `town-relayout-scope-state-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
globalThis.fetch = async url => { throw Error(`relayout scope fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
// 管理面板的「重新布局」这一步同样不该发模型与生图请求
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'relayout-scope-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { saveMap, getMapRow } = await import('../src/services/town/townMapService.js');
const init = await import('../src/services/town/townInitService.js');

// 管理面板重新布局的多地图回归：素材池曾经取全量，于是重排小镇 A 会被摆上小镇 B 的地皮与建筑。
// 现在只认「这张图自己正在用的那批素材」。

/** 本镇（A）在用的素材 */
const LOCAL = [
  { kind: 'ground', key: 'grass_01_01', name: '青草地 01' },
  { kind: 'ground', key: 'grass_01_02', name: '青草地 02' },
  { kind: 'road', key: 'stone_road', name: '石板主街' },
  { kind: 'building', key: 'inn', name: '旅店', footprint: { w: 3, h: 2 } },
  { kind: 'building', key: 'bakery', name: '面包房', footprint: { w: 3, h: 2 } },
  { kind: 'prop', key: 'oak_tree', name: '橡树' },
  { kind: 'prop', key: 'bench', name: '长椅' },
];

/** 另一座镇（B）的素材：只是躺在同一个素材库里，不该被本镇的自动布局选中 */
const OTHER_TOWN = [
  { kind: 'ground', key: 'ceramic_tile_01_01', name: '学园陶瓷地砖 01' },
  { kind: 'road', key: 'magnetic_road_01', name: '磁感通勤道' },
  { kind: 'building', key: 'ability_tavern', name: '念动咖啡厅', footprint: { w: 3, h: 2 } },
  { kind: 'prop', key: 'quantum_oak_01', name: '量子共振橡树' },
];

const COLS = 30, ROWS = 30;

function seedAssets(db, specs) {
  const insert = db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
    VALUES (?, ?, ?, '/town-assets/test.png', ?, NULL, 'ready')`);
  return specs.map(s => {
    const meta = { desc: s.name };
    if (s.footprint) meta.footprint = s.footprint;
    return Number(insert.run(s.kind, s.key, s.name, JSON.stringify(meta)).lastInsertRowid);
  });
}

/** 图层里引用到的全部素材 id（地皮 / 路面 / 建筑与道具） */
function layerAssetIds(layers) {
  const ids = new Set();
  for (const name of ['ground', 'road']) {
    for (const row of layers?.[name] || []) for (const id of row || []) if (id != null) ids.add(Number(id));
  }
  for (const obj of layers?.objects || []) if (obj?.assetId != null) ids.add(Number(obj.assetId));
  return ids;
}

test('重新布局：只用这张图自己在用的素材，别的镇的素材不参与', async t => {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai',
    aiLayoutOptimize: false, mapSize: COLS });

  const db = getDb();
  const local = seedAssets(db, LOCAL);
  const other = seedAssets(db, OTHER_TOWN);
  assert.equal(other.length > 0, true);

  // 本镇的地图上摆着自己那一整套素材（这是重排时的素材池：「复用现有素材」）
  const ground = Array.from({ length: ROWS }, () => Array(COLS).fill(local[0]));
  for (let y = 0; y < 6; y++) for (let x = 0; x < COLS; x++) ground[y][x] = local[1];
  const road = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let x = 0; x < COLS; x++) road[15][x] = local[2];
  const before = saveMap({ create: true, name: '老镇', cols: COLS, rows: ROWS,
    layers: { ground, road, objects: [
      { id: 1, assetId: local[3], x: 10, y: 10, flip: false },
      { id: 2, assetId: local[4], x: 20, y: 10, flip: false },
      { id: 3, assetId: local[5], x: 6, y: 20, flip: false },
      { id: 4, assetId: local[6], x: 26, y: 24, flip: false },
    ] },
    locations: [{ key: 'plaza', name: '老广场', x: 15, y: 15, radius: 3 }] });
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 15, 15, ?)")
    .run(before.mapId);

  town.startTownScheduler();
  town.touchTownViewer();
  t.after(() => { town.stopTownScheduler(); closeDb(); if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); });

  const result = await init.relayoutWorld();
  assert.equal(result.ok, true, `重新布局应当成功：${result.error || ''}`);
  assert.equal(result.mapId, before.mapId, '重排的是原来那张图');

  const after = getMapRow(before.mapId);
  assert.equal(after.name, '老镇');
  const used = layerAssetIds(after.layers);
  assert.ok(used.size >= 4, `重排后确实铺开了素材（实际 ${used.size} 张）`);
  assert.deepEqual([...used].filter(id => other.includes(id)), [], '别的镇的素材不能出现在本镇的重新布局里');
  for (const id of used) assert.ok(local.includes(id), `素材 #${id} 不属于这张图在用的那一批`);
});
