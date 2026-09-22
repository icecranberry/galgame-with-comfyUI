import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DB_PATH = ':memory:';
// 向导存档指到临时文件，测试不碰 agent-core/data/town/init-state.json
const STATE_FILE = path.join(os.tmpdir(), `town-wizard-claim-route-state-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;

const require = createRequire(import.meta.url);
const sharp = require('sharp');

/** 一张「白底 + 居中色块」的假产物：让素材后处理管线有内容可抠、可裁 */
const base = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
const block = await sharp({ create: { width: 220, height: 180, channels: 4, background: { r: 200, g: 80, b: 60, alpha: 1 } } }).png().toBuffer();
const FAKE_PNG = await sharp(base).composite([{ input: block, top: 166, left: 146 }]).png().toBuffer();

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
}

// 只放行 ComfyUI 协议的假响应，其余网络请求一律拒绝：测试里不该有真实模型 / 生图流量
// （对本测试自己起的 HTTP 服务器要放行，否则连路由都打不到）
const realFetch = globalThis.fetch;
let serverPort = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (serverPort && u.includes(`127.0.0.1:${serverPort}`)) return realFetch(url, opts);
  if (u.includes('/api/prompt')) return jsonResponse({ prompt_id: 'p1' });
  if (u.includes('/history/p1')) {
    return jsonResponse({ p1: { status: { completed: true }, outputs: { 9: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } } } });
  }
  if (u.includes('/view')) return new Response(FAKE_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  throw new Error(`wizard claim route fixture forbids network: ${u}`);
};

const { config } = await import('../src/config.js');
config.comfyui.url = 'http://127.0.0.1:9';
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'wizard-claim-route-test';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const init = await import('../src/services/town/townInitService.js');
const express = (await import('express')).default;
const townRoutes = (await import('../src/routes/town.js')).default;

// 回归背景：向导 UI 逐张调 POST /api/town/assets 生成素材，这条链路过去不认领，
// job.assetIds 永远是空名单，第 8 步布图必然报「素材不足」。这里守住「路由成功后必须认领」。

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

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api/town', townRoutes);
const server = app.listen(0);
serverPort = server.address().port;

function persistedAssetIds() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).assetIds || [];
}

/** 向导停在「素材就绪、等布图」这一步；assetIds 默认空，模拟漏认领的存档 */
function seedWizardJob() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    status: 'batch_pending',
    createdAt: '2026-09-22T16:06:38.016Z',
    config: { worldSettingId: null, npcCount: 1, mapCols: 30, mapRows: 30 },
    blueprint: BLUEPRINT,
    assetIds: [],
    sampleAssetIds: [],
    progress: { stage: 'batch', done: 0, total: 0, current: '' },
    draftMap: null,
    npcIds: [],
    warnings: [],
    targetMapId: null,
  }));
  init.restoreInitJob();
}

/** 老镇素材：躺在同一个素材库里，不该被认领 */
function seedOldTownAsset(db) {
  const meta = JSON.stringify({ desc: '旅店', footprint: { w: 3, h: 2 } });
  return Number(db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status, created_at)
    VALUES ('building', 'inn', '旅店', '/town-assets/test.png', ?, NULL, 'ready', '2026-09-15 02:00:00')`).run(meta).lastInsertRowid);
}

function postJson(pathname, body) {
  return realFetch(`http://127.0.0.1:${serverPort}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

function setup() {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { aiLayoutOptimize: false, buildingDensity: 30, propDensity: 20 });
  const db = getDb();
  db.prepare('DELETE FROM town_assets').run();
  seedWizardJob();
  return db;
}

after(() => {
  server.close();
  closeDb();
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
});

test('POST /api/town/assets 生成成功后把素材认领进本镇名单', async () => {
  const db = setup();
  const oldId = seedOldTownAsset(db);

  const res = await postJson('/api/town/assets', {
    kind: 'building',
    key: 'shared_dwelling',
    name: '混种族合租房',
    desc: 'a shared dwelling',
    meta: { footprint: { w: 3, h: 2 }, useLlmPrompt: false },
  });
  assert.equal(res.status, 200);
  const { asset } = await res.json();
  assert.ok(asset?.id, '素材应生成成功');
  assert.equal(asset.status, 'ready');

  assert.ok(persistedAssetIds().includes(asset.id), '路由成功后必须把素材记进本镇名单');
  assert.equal(persistedAssetIds().includes(oldId), false, '老镇素材不该被顺带认领');
});

test('POST /api/town/assets/:id/regenerate 同样认领进本镇名单', async () => {
  const db = setup();
  // 名单丢失的存档里，本次向导复用的素材还没被记名
  const reusedId = seedOldTownAsset(db);

  const res = await postJson(`/api/town/assets/${reusedId}/regenerate`, {});
  assert.equal(res.status, 200);
  const { asset } = await res.json();
  assert.equal(asset?.id, reusedId);

  assert.ok(persistedAssetIds().includes(reusedId), '重生成成功后也必须认领');
});