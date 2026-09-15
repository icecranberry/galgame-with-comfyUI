import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = ':memory:';
// 向导存档指到临时文件，测试不碰 agent-core/data/town/init-state.json
const STATE_FILE = path.join(os.tmpdir(), `town-layout-scope-state-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
globalThis.fetch = async url => { throw Error(`layout scope fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
// 布图这一步一次模型都不该发；端点指到打不通的本地端口兜底
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'layout-scope-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const init = await import('../src/services/town/townInitService.js');

// 多地图回归：全世界共用一张 town_assets 表，新镇的自动布图曾经 listAssets() 取全量，
// 于是小镇 B 的布局里混进了小镇 A 的草地、石板路和全部建筑（用户实测）。
// 现在只认「本次向导产出的那一批素材」。

/** 老镇（A）已经摆在自己地图上的那一套素材 */
const OLD_TOWN = [
  { kind: 'ground', key: 'grass_01_01', name: '青草地 01' },
  { kind: 'ground', key: 'grass_01_02', name: '青草地 02' },
  { kind: 'road', key: 'stone_road', name: '石板主街' },
  { kind: 'building', key: 'inn', name: '旅店', footprint: { w: 3, h: 2 } },
  { kind: 'building', key: 'bakery', name: '面包房', footprint: { w: 3, h: 2 } },
  { kind: 'prop', key: 'oak_tree', name: '橡树' },
  { kind: 'prop', key: 'bench', name: '长椅' },
];

/** 本次向导（B）蓝图清单里的素材（含蓝图规范化时补的 supplier / workshop 职责建筑） */
const NEW_TOWN = [
  { kind: 'ground', key: 'ceramic_tile_01_01', name: '学园陶瓷地砖 01' },
  { kind: 'ground', key: 'ceramic_tile_01_02', name: '学园陶瓷地砖 02' },
  { kind: 'road', key: 'magnetic_road_01', name: '磁感通勤道' },
  { kind: 'building', key: 'ability_tavern', name: '念动咖啡厅', footprint: { w: 3, h: 2 } },
  { kind: 'building', key: 'student_dorm', name: '学员集体宿舍', footprint: { w: 3, h: 2 } },
  { kind: 'building', key: 'supplier', name: '材料补给站', footprint: { w: 3, h: 2 } },
  { kind: 'building', key: 'workshop', name: '手作工坊', footprint: { w: 3, h: 2 } },
  { kind: 'prop', key: 'quantum_oak_01', name: '量子共振橡树' },
  { kind: 'prop', key: 'charging_bench_01', name: '电磁充电长椅' },
];

/** 键名与 NEW_TOWN 逐一对齐：批量步据此认领「这一批」素材 */
const BLUEPRINT = {
  styleTags: '学园冷光',
  groundAssets: [{ key: 'ceramic_tile_01', name: '学园陶瓷地砖', variants: 2 }],
  roadAssets: [{ key: 'magnetic_road_01', name: '磁感通勤道' }],
  buildings: [
    { key: 'ability_tavern', name: '念动咖啡厅', footprint: { w: 3, h: 2 } },
    { key: 'student_dorm', name: '学员集体宿舍', footprint: { w: 3, h: 2 } },
  ],
  props: [{ key: 'quantum_oak_01', name: '量子共振橡树' }, { key: 'charging_bench_01', name: '电磁充电长椅' }],
  npcs: [{ displayName: '白井黑子', job: '居民', brief: '常盘台的学生' }],
};

function seedAssets(db, specs) {
  const insert = db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
    VALUES (?, ?, ?, '/town-assets/test.png', ?, NULL, 'ready')`);
  return specs.map(s => {
    const meta = { desc: s.name };
    if (s.footprint) meta.footprint = s.footprint;
    return Number(insert.run(s.kind, s.key, s.name, JSON.stringify(meta)).lastInsertRowid);
  });
}

/** 向导已停在「素材就绪、等布图」这一步（工作台里由批量生图推进到这里） */
function seedWizardJob(blueprint) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    status: 'batch_pending',
    config: { worldSettingId: null, npcCount: 1, mapCols: 30, mapRows: 30 },
    blueprint,
    progress: { stage: 'batch', done: 0, total: 0, current: '' },
    draftMap: null,
    npcIds: [],
    warnings: [],
    targetMapId: null,
  }));
  init.restoreInitJob();
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

test('再建一座镇：自动布图只用本镇的素材，不混进老镇的', async t => {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai', aiLayoutOptimize: false });

  const db = getDb();
  t.after(() => { closeDb(); if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); });

  const oldIds = seedAssets(db, OLD_TOWN);
  const newIds = seedAssets(db, NEW_TOWN);
  assert.ok(Math.max(...oldIds) < Math.min(...newIds), '老镇素材 id 更小：不做隔离时布图必然先挑到它');

  seedWizardJob(BLUEPRINT);
  await init.startBatch();
  assert.deepEqual(init.getInitState().warnings, [], '批量步没有生成失败');

  await init.generateLayout();
  assert.equal(init.getInitState().status, 'confirm', '布图完成，停在确认步');

  const used = layerAssetIds(init.getInitPreview().layers);
  assert.ok(used.size >= 4, `布局确实铺开了素材（实际 ${used.size} 张）`);
  assert.deepEqual([...used].filter(id => oldIds.includes(id)), [], '新镇布局里不能出现老镇的素材');
  for (const id of used) {
    assert.ok(newIds.includes(id), `素材 #${id} 不属于本次向导产出的那一批`);
  }
});
