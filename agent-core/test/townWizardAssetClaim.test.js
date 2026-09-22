import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = ':memory:';
// 向导存档指到临时文件，测试不碰 agent-core/data/town/init-state.json
const STATE_FILE = path.join(os.tmpdir(), `town-wizard-claim-state-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
globalThis.fetch = async url => { throw Error(`wizard claim fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
// 认领与布图都不该发模型 / 生图请求；端点指到打不通的本地端口兜底
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'wizard-claim-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const init = await import('../src/services/town/townInitService.js');

// 回归背景：向导 UI 的地皮 / 建筑 / 道具是前端逐张调素材库接口（POST /api/town/assets）生成的，
// 不走 /init/samples 与 /init/batch，于是 job.assetIds 一直是空名单，布图必然误判「素材不足」。
// 现在两层兜底：1) 素材生成成功时认领进本镇名单；2) 名单丢失时按本次蓝图声明的 key 兜底，绝不退回全库。

/** 向导开始时间：兜底认领的时间基准 */
const WIZARD_STARTED_AT = '2026-09-22T16:06:38.016Z';

/** 本次向导蓝图：地皮 / 道路 / 建筑 / 道具齐备（布图至少需要这三类） */
const BLUEPRINT = {
  styleTags: '苔绒幻想',
  groundAssets: [{ key: 'moss_lawn', name: '苔绒草地', variants: 2 }],
  roadAssets: [{ key: 'pebble_path', name: '圆卵石小径' }],
  buildings: [
    { key: 'shared_dwelling', name: '混种族合租房', footprint: { w: 3, h: 2 } },
    { key: 'slime_lodge', name: '史莱姆透明宿屋', footprint: { w: 3, h: 2 } },
  ],
  props: [{ key: 'exposed_bench', name: '开档长椅' }],
  npcs: [{ displayName: '白底黑子', job: '居民', brief: '常盘台的学生' }],
};

/** 另一座镇（老镇）的素材：只是躺在同一个素材库里，不该被本镇选中 */
const OLD_TOWN = [
  { kind: 'ground', key: 'grass_01_01', name: '青草地 01', createdAt: '2026-09-15 02:00:00' },
  { kind: 'road', key: 'stone_road', name: '石板主街', createdAt: '2026-09-15 02:00:00' },
  { kind: 'building', key: 'inn', name: '旅店', footprint: { w: 3, h: 2 }, createdAt: '2026-09-15 02:00:00' },
  { kind: 'prop', key: 'oak_tree', name: '橡树', createdAt: '2026-09-15 02:00:00' },
];

/** 本次向导蓝图对应的素材（模拟前端从素材库接口逐张生成） */
const NEW_TOWN = [
  { kind: 'ground', key: 'moss_lawn_01', name: '苔绒草地 01', createdAt: '2026-09-22 16:07:04' },
  { kind: 'ground', key: 'moss_lawn_02', name: '苔绒草地 02', createdAt: '2026-09-22 16:07:25' },
  { kind: 'road', key: 'pebble_path', name: '圆卵石小径', createdAt: '2026-09-22 16:08:56' },
  { kind: 'building', key: 'shared_dwelling', name: '混种族合租房', footprint: { w: 3, h: 2 }, createdAt: '2026-09-22 16:09:48' },
  { kind: 'building', key: 'slime_lodge', name: '史莱姆透明宿屋', footprint: { w: 3, h: 2 }, createdAt: '2026-09-22 16:13:29' },
  { kind: 'prop', key: 'exposed_bench', name: '开档长椅', createdAt: '2026-09-22 16:15:43' },
];

function seedAssets(db, specs) {
  const insert = db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status, created_at)
    VALUES (?, ?, ?, '/town-assets/test.png', ?, NULL, 'ready', ?)`);
  return specs.map(s => {
    const meta = { desc: s.name };
    if (s.footprint) meta.footprint = s.footprint;
    return Number(insert.run(s.kind, s.key, s.name, JSON.stringify(meta), s.createdAt || '2026-09-22 16:07:04').lastInsertRowid);
  });
}

/** 向导停在「素材就绪、等布图」这一步；assetIds 默认空，模拟漏认领的存档 */
function seedWizardJob(extra = {}) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    status: 'batch_pending',
    createdAt: WIZARD_STARTED_AT,
    config: { worldSettingId: null, npcCount: 1, mapCols: 30, mapRows: 30 },
    blueprint: BLUEPRINT,
    assetIds: [],
    sampleAssetIds: [],
    progress: { stage: 'batch', done: 0, total: 0, current: '' },
    draftMap: null,
    npcIds: [],
    warnings: [],
    targetMapId: null,
    ...extra,
  }));
  init.restoreInitJob();
}

/** 落盘存档里的本镇名单 */
function persistedAssetIds() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).assetIds || [];
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

function setupTest() {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai',
    aiLayoutOptimize: false, buildingDensity: 30, propDensity: 20 });
  const db = getDb();
  db.prepare('DELETE FROM town_assets').run();
  return db;
}

after(() => {
  closeDb();
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
});

test('素材库链路产出的素材会被认领进本镇名单，老镇素材不混入', async () => {
  const db = setupTest();
  const oldIds = seedAssets(db, OLD_TOWN);
  seedWizardJob();
  const newIds = seedAssets(db, NEW_TOWN);

  // 模拟 POST /api/town/assets（或 regenerate）生成成功后的回调
  assert.deepEqual(init.claimWizardAssets(newIds).sort((a, b) => a - b), [...newIds].sort((a, b) => a - b));
  assert.deepEqual([...persistedAssetIds()].sort((a, b) => a - b), [...newIds].sort((a, b) => a - b), '名单应记下这批素材');

  // 居民 / 立绘不是布图素材，不进名单
  const [npcId] = seedAssets(db, [{ kind: 'npc', key: 'npc_1_down', name: '居民 down' }]);
  assert.deepEqual(init.claimWizardAssets([npcId]), []);
  assert.equal(persistedAssetIds().includes(npcId), false, '居民素材不进布图名单');

  await init.generateLayout();
  assert.equal(init.getInitState().status, 'confirm', '名单齐全后布图应成功');
  const used = layerAssetIds(init.getInitPreview().layers);
  assert.ok(used.size >= 4, `布局确实铺开了素材（实际 ${used.size} 张）`);
  assert.deepEqual([...used].filter(id => oldIds.includes(id)), [], '老镇素材不能出现在本镇布局里');
  for (const id of used) assert.ok(newIds.includes(id), `素材 #${id} 不属于本镇名单`);
});

test('向导不在进行中时不认领素材', async () => {
  const db = setupTest();
  const [id] = seedAssets(db, [NEW_TOWN[0]]);

  init.cancelInit();
  assert.equal(init.getInitState().status, 'idle');
  assert.deepEqual(init.claimWizardAssets([id]), [], '没有进行中的向导就不该认领');

  seedWizardJob({ status: 'done' });
  assert.deepEqual(init.claimWizardAssets([id]), [], '已开镇的存档不再认领新素材');
});

test('名单丢失时按蓝图 key 兜底认本镇素材，不退回全库', async () => {
  const db = setupTest();
  const oldIds = seedAssets(db, OLD_TOWN);
  const newIds = seedAssets(db, NEW_TOWN);
  seedWizardJob(); // 旧口径存档：assetIds 与 sampleAssetIds 都是空的

  await init.generateLayout();
  assert.equal(init.getInitState().status, 'confirm', '兜底应让布图照常成功');
  const used = layerAssetIds(init.getInitPreview().layers);
  assert.ok(used.size >= 4, `兜底后确实铺开了素材（实际 ${used.size} 张）`);
  for (const id of used) assert.ok(newIds.includes(id), `素材 #${id} 不属于本次蓝图`);
  assert.deepEqual([...used].filter(id => oldIds.includes(id)), [], '蓝图 key 对不上的老镇素材不能被兜底认领');
});

test('兜底优先只认向导开始之后创建的素材', async () => {
  const db = setupTest();
  // 同世界观再建一座镇：蓝图 key 与老镇相同，老素材更早、本次向导新出的更晚
  const staleIds = seedAssets(db, NEW_TOWN.map(s => ({ ...s, createdAt: '2026-09-15 02:00:00' })));
  const freshIds = seedAssets(db, NEW_TOWN);
  seedWizardJob();

  await init.generateLayout();
  assert.equal(init.getInitState().status, 'confirm');
  const used = layerAssetIds(init.getInitPreview().layers);
  assert.ok(used.size >= 4);
  for (const id of used) assert.ok(freshIds.includes(id), `素材 #${id} 应来自本次向导`);
  assert.deepEqual([...used].filter(id => staleIds.includes(id)), [], '同名的老素材不该被认领');
});

test('蓝图 key 一张都对不上时仍然报素材不足，不退回全库', async () => {
  const db = setupTest();
  seedAssets(db, OLD_TOWN);
  seedWizardJob();

  await assert.rejects(init.generateLayout(), /素材不足/);
  assert.equal(init.getInitState().status, 'failed');
  assert.equal(init.getInitPreview(), null, '素材不足时不产出混入其他小镇的预览');
});
test('存量存档自愈：卡在「素材不足」的向导升级后直接回到可布图', async () => {
  const db = setupTest();
  const oldIds = seedAssets(db, OLD_TOWN);
  const newIds = seedAssets(db, NEW_TOWN);
  // 3.4.7 卡住的存档：状态 failed、名单空、素材其实已经生成好了
  seedWizardJob({ status: 'failed', error: '本次小镇可用素材不足，请先完成批量生成；自动布局只使用本镇素材' });

  assert.equal(init.getInitState().status, 'layout_pending', '升级后应自愈成可布图');
  assert.equal(init.getInitState().error, null);
  assert.deepEqual([...persistedAssetIds()].sort((a, b) => a - b), [...newIds].sort((a, b) => a - b),
    '自愈要把兜底认领固化进名单（后续落库也用它）');

  await init.generateLayout();
  assert.equal(init.getInitState().status, 'confirm', '自愈后自动推进应能直接布图');
  const used = layerAssetIds(init.getInitPreview().layers);
  assert.ok(used.size >= 4);
  for (const id of used) assert.ok(newIds.includes(id));
  assert.deepEqual([...used].filter(id => oldIds.includes(id)), [], '老镇素材不能混入');
});

test('存量存档自愈不会在素材真不够时放宽口径', async () => {
  const db = setupTest();
  seedAssets(db, OLD_TOWN); // key 与蓝图对不上
  seedWizardJob({ status: 'failed', error: '本次小镇可用素材不足，请先完成批量生成；自动布局只使用本镇素材' });

  assert.equal(init.getInitState().status, 'failed', '兜底认不到足够素材就保持 failed');
  assert.deepEqual(persistedAssetIds(), [], '没有可认领的素材时不该写名单');
});

test('其它原因的布图失败不触发自愈', async () => {
  const db = setupTest();
  seedAssets(db, NEW_TOWN);
  seedWizardJob({ status: 'failed', error: '布图展开失败：街区路网为空' });

  assert.equal(init.getInitState().status, 'failed', '非「素材不足」的失败保持原样');
  assert.deepEqual(persistedAssetIds(), []);
});