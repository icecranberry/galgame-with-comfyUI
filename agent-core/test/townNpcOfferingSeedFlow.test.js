import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// 端到端验证「确认开镇的最后一步  后台静默生成居民的服务 / 打工 / 商品」。
// LLM 用本地 mock server 顶掉（只回 offers / goods 两类 JSON），数据落真实 schema。
process.env.DB_PATH = ':memory:';
const STATE_FILE = path.join(os.tmpdir(), `town-seed-flow-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
// node:test 的 worker 在高并发下对 stdout 洪泛敏感（会报 deserialize 失败）：本测试连带的模块日志较多，这里静音
console.log = () => {};
console.info = () => {};
console.warn = () => {};

const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
config.features.town = true;
config.features.townLLM = false;
config.comfyui = { ...config.comfyui, url: 'http://127.0.0.1:9' };

//  本地 mock LLM：按请求内容区分「服务项目 / 打工项目 / 货架」 
function startMockLlm() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let messages = [];
      try { messages = JSON.parse(body).messages || []; } catch { /* 忽略坏 body */ }
      const text = messages.map(m => String(m.content || '')).join('\n');
      let content = '{}';
      if (text.includes('打工项目')) {
        content = JSON.stringify({ offers: [{ title: '帮搬木材', description: '把木料搬到后院码好', price: 40 }] });
      } else if (text.includes('服务项目')) {
        content = JSON.stringify({ offers: [{ title: '庭院除草', description: '把后院的杂草清干净', price: 60 }] });
      } else if (text.includes('货架')) {
        content = JSON.stringify({ goods: [{ title: '当天鲜花', description: '当天没卖完的花束', effectKey: 'mood_fix', price: 30, favor: 3, imagePrompt: 'game item icon, flowers' }] });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', created: 0, model: 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const mock = await startMockLlm();
config.llm = { ...config.llm, baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'seed-flow-test' };
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const init = await import('../src/services/town/townInitService.js');
const router = (await import('../src/routes/town.js')).default;
const db = getDb();

function call(method, url, { body = undefined, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, body, query };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
    };
    router.handle(req, res, err => (err ? reject(err) : resolve({ status: 404, payload: null })));
  });
}

function personaCard(name, job) {
  return `你是${name}。\n\n## 你的身份\n${job}，在小镇过活。\n\n## 你的性格\n- 话不多，做事稳\n\n## 你的爱好\n- 清晨的街口\n\n## 你的外观\n- 短发，灰蓝色眼睛\n- 深色外套`;
}const ROUTEROUTINE = [{ start: '00:00', end: '24:00', locationKey: 'home', activity: '休息' }];

// 三位居民：只服务 / 服务+打工 / 只交易。权限决定开镇后后台生成什么。
const ROSTER = [
  { displayName: '花店姑娘', job: '花艺师', brief: '把当天没卖完的花送人', capabilities: ['service'] },
  { displayName: '矿工', job: '矿工', brief: '天天下矿的壮汉', capabilities: ['service', 'work'] },
  { displayName: '杂货掌柜', job: '杂货摊主', brief: '什么都卖的掌柜', capabilities: ['trade'] },
];

function prestubAssets(ids) {
  const insert = db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
    VALUES (?, ?, ?, '', '{}', NULL, 'ready')`);
  for (const key of ['player_portrait', 'player_down', 'player_up']) insert.run('player', key, key);
  for (const id of ids) {
    insert.run('npc', `npc_${id}_portrait`, `居民 ${id} 立绘`);
    insert.run('npc', `npc_${id}_down`, `居民 ${id} 正面`);
    insert.run('npc', `npc_${id}_up`, `居民 ${id} 背面`);
  }
}

function seedWizardJob(draftMap, npcIds) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    status: 'confirm',
    config: { worldSettingId: null, npcCount: ROSTER.length, mapCols: 8, mapRows: 8 },
    blueprint: {
      styleTags: '',
      npcs: ROSTER.map(n => ({ ...n, persona: personaCard(n.displayName, n.job) })),
    },
    progress: { stage: '', done: 0, total: 0, current: '' },
    draftMap,
    npcIds,
    warnings: [],
    targetMapId: null,
  }));
  init.restoreInitJob();
}

function offersOf(name, kind) {
  return db.prepare(`SELECT COUNT(*) AS n FROM town_npc_offers o
    JOIN town_npcs n ON n.id = o.npc_id WHERE n.display_name = ? AND o.kind = ?`).get(name, kind).n;
}
function stockOf(name) {
  return db.prepare(`SELECT COUNT(*) AS n FROM town_npc_stock s
    JOIN town_npcs n ON n.id = s.npc_id WHERE n.display_name = ?`).get(name).n;
}

test('确认开镇后，最后一步会在后台补齐居民的打工 / 服务 / 商品', async t => {
  town.startTownScheduler();
  t.after(async () => {
    town.stopTownScheduler();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    await new Promise(resolve => mock.server.close(resolve));
  });

  const npcIds = ROSTER.map(n => createNpc({
    mapId: null,
    displayName: n.displayName,
    persona: personaCard(n.displayName, n.job),
    brief: n.brief,
    job: n.job,
    routine: ROUTEROUTINE,
  }).id);
  // 交易居民提前上货：seed 走幂等分支直接复用，测试不触发异步生图（生成商品由 seed 单测覆盖）
  const traderId = npcIds[ROSTER.findIndex(n => n.capabilities.includes('trade'))];
  const worldId = db.prepare('SELECT world_id FROM town_world_state WHERE singleton = 1').get().world_id;
  const now = Date.now();
  db.prepare("INSERT INTO town_npc_stock (world_id, npc_id, template_id, template_version, effect_key, price, custom_name, custom_desc, image_prompt, image_url, image_status, favor_delta, source, rolled_at, next_roll_at, sold_at) VALUES (?, ?, '', 1, 'mood_fix', 30, '预置鲜花', '开镇前就上好的货', 'game item icon', NULL, 'ready', 3, 'llm', ?, ?, NULL)")
    .run(worldId, traderId, now, now + 3 * 24 * 3600 * 1000);

  prestubAssets(npcIds);

  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  seedWizardJob({
    name: '海边小镇', cols: 8, rows: 8, tileSize: 32,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: '中央广场', x: 0, y: 0, radius: 1 },
      { key: 'shop', name: '杂货铺', x: 4, y: 4, radius: 1 },
    ],
    npcSpawns: [{ npcRef: '花店姑娘', locationKey: 'plaza' }],
  }, npcIds);

  const applied = await call('POST', '/init/confirm');
  assert.equal(applied.status, 200, JSON.stringify(applied.payload));
  const mapId = applied.payload.mapId;
  assert.ok(mapId, '开镇返回地图 id');

  // 后台上料是静默异步的：等它落库（最多 8 秒）
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const total = db.prepare('SELECT COUNT(*) AS n FROM town_npc_offers').get().n;
    if (total >= 3 && stockOf('杂货掌柜') >= 1) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  assert.ok(offersOf('花店姑娘', 'service') >= 1, '服务居民生成了服务项目');
  assert.equal(offersOf('花店姑娘', 'work'), 0, '没有打工权限就没有打工项目');
  assert.ok(offersOf('矿工', 'service') >= 1, '服务 + 打工居民两项都生成（服务）');
  assert.ok(offersOf('矿工', 'work') >= 1, '服务 + 打工居民两项都生成（打工）');
  assert.ok(stockOf('杂货掌柜') >= 1, '交易居民上架了商品');
  assert.equal(stockOf('花店姑娘'), 0, '非交易居民不进货');

  // 居民已经落到新镇，权限口径与开镇一致
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_npcs WHERE map_id = ?').get(mapId).n, ROSTER.length);
});