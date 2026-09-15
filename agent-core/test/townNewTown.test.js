import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = ':memory:';
// 向导存档指到临时文件，测试不碰 agent-core/data/town/init-state.json
const STATE_FILE = path.join(os.tmpdir(), `town-init-state-test-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
globalThis.fetch = async url => { throw Error(`new town fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
// 开镇会拉起后台的作息 / 小人流水线。端点指到打不通的本地端口，配合下面预置的成品素材，
// 整条链路一次模型、一次生图都不发（否则测试会真去调用户的 LLM 与 ComfyUI，又慢又要钱）。
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'new-town-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const init = await import('../src/services/town/townInitService.js');
const router = (await import('../src/routes/town.js')).default;

// 再建一座镇：向导名单 → 落库开镇 → 玩家落座，三条线走一遍。
// 两条回归都在这里：①向导名单曾经跨图清空别的镇的居民；②新镇建成后玩家留在旧镇，
// 结果快照看新镇、画布看旧镇（NPC 换了、地图没换）。

/** 直接驱动 express router：POST /init/confirm 的 handler 会把结果 res.json 出来 */
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

/** 已经是完整人格卡（isPersonaCard 要求「你是」开头 + 「## 你的外观」），名单步就不再打模型 */
function personaCard(name, job) {
  return `你是${name}。\n\n## 你的身份\n${job}，在海边小镇过活。\n\n## 你的性格\n- 话不多，做事稳\n\n## 你的爱好\n- 海雾散开的那一刻\n\n## 你的外观\n- 短发，灰蓝色眼睛\n- 深色外套，戴一顶旧帽`;
}

// 三个职责（公告站 / 补给站 / 工坊）由蓝图里的居民各自认领，
// 于是名单步既不会自动补人，也不会因为缺人格卡去打模型
const ROSTER = [
  { displayName: '渡口老板娘', job: '委托员', workplaceKey: 'central_plaza', brief: '守着渡口的小店老板娘' },
  { displayName: '灯塔看守', job: '供货员', workplaceKey: 'supplier', brief: '夜里点灯的老人' },
  { displayName: '修船匠', job: '工坊师傅', workplaceKey: 'workshop', brief: '修船的手艺人' },
];
// 上一版名单留下的孤儿：名单步该清掉它，但只能清「这张图 + 还没归属」的那些
const STALE = '早先的候选人';
const ROUTINE = [{ start: '00:00', end: '24:00', locationKey: 'plaza', activity: '守店' }];

function startWorld(t) {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const { mapId: oldTown } = saveMap({ create: true, name: '老镇', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'plaza', name: '老广场', x: 0, y: 0, radius: 1 }] });
  for (const displayName of ['阿甲', '阿乙']) createNpc({ mapId: oldTown, displayName, job: '居民', routine: [] });
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 0, 0, ?)")
    .run(oldTown);

  town.startTownScheduler();
  town.touchTownViewer();   // 页面在线：聚焦口径（只有聚焦图产生 LLM 演出）才成立
  t.after(() => { town.stopTownScheduler(); closeDb();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); });
  return { db, oldTown, grid };
}

/** 向导已停在「布局生成完、等确认」这一步（工作台里由 LLM 布图产出，这里直接写进存档） */
function seedWizardJob(draftMap, npcIds) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    status: 'confirm',
    config: { worldSettingId: null, npcCount: ROSTER.length, mapCols: 8, mapRows: 8 },
    blueprint: { styleTags: '海边暖光',
      npcs: ROSTER.map(n => ({ ...n, persona: personaCard(n.displayName, n.job) })) },
    progress: { stage: '', done: 0, total: 0, current: '' },
    draftMap,
    npcIds,
    warnings: [],
    targetMapId: null,
  }));
  init.restoreInitJob();
}

/** 把开镇后的后台流水线要用的成品先摆好：有作息就不生成作息，有 ready 小人的就不生图 */
function prestubBackgroundWork(db, npcIds) {
  const insert = db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, world_setting_id, status)
    VALUES (?, ?, ?, '', '{}', NULL, 'ready')`);
  for (const dir of ['down', 'up']) {
    insert.run('player', `player_${dir}`, `玩家 ${dir}`);
    for (const id of npcIds) insert.run('npc', `npc_${id}_${dir}`, `居民 ${id} ${dir}`);
  }
}

/** 向导名单步之前先落库的居民档案：蓝图里那三位，外加一位上一版名单的孤儿 */
function seedWizardRoster(db) {
  const mk = n => createNpc({ mapId: null, displayName: n.displayName, persona: n.persona,
    brief: n.brief, job: n.job, routine: ROUTINE }).id;
  const ids = ROSTER.map(n => mk({ ...n, persona: personaCard(n.displayName, n.job) }));
  mk({ displayName: STALE, persona: personaCard(STALE, '待定'), brief: '', job: '待定' });
  return ids;
}

test('再建一座镇：别镇居民不被清空，建成后玩家直接落在新镇', async t => {
  const { db, oldTown, grid } = startWorld(t);
  const npcsOf = mapId => db.prepare('SELECT display_name FROM town_npcs WHERE map_id = ? ORDER BY id').all(mapId)
    .map(r => r.display_name);
  assert.deepEqual(npcsOf(oldTown), ['阿甲', '阿乙']);

  const wizardIds = seedWizardRoster(db);
  seedWizardJob({
    name: '海边的镇', cols: 8, rows: 8, tileSize: 32,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: '渡口广场', x: 0, y: 0, radius: 1 },
      { key: 'dock', name: '渡口', x: 6, y: 6, radius: 1 },
    ],
    npcSpawns: [{ npcRef: '渡口老板娘', locationKey: 'dock' }],
  }, wizardIds);
  prestubBackgroundWork(db, wizardIds);

  // 名单步：本图名单外的孤儿照清，别的镇的居民不能被这一笔带走
  const roster = await init.commitWizardNpcs();
  assert.deepEqual(roster.wizardNpcs.map(n => n.displayName), ROSTER.map(n => n.displayName));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM town_npcs WHERE display_name = ?').get(STALE).c, 0, '本图名单外的孤儿照清');
  assert.deepEqual(npcsOf(oldTown), ['阿甲', '阿乙'], '向导名单只覆盖这次要建的那张图');

  const applied = await call('POST', '/init/confirm');
  assert.equal(applied.status, 200);
  const newTown = applied.payload.mapId;
  assert.notEqual(newTown, oldTown, '再建一座 = 新建一张图，不覆盖老镇');

  // 新镇有自己的居民与地点，老镇原封不动
  assert.deepEqual(npcsOf(newTown), ROSTER.map(n => n.displayName));
  assert.deepEqual(db.prepare('SELECT name FROM town_locations WHERE map_id = ? ORDER BY id').all(newTown)
    .map(r => r.name), ['渡口广场', '渡口']);
  assert.deepEqual(npcsOf(oldTown), ['阿甲', '阿乙'], '开镇不动别的镇的居民');
  assert.deepEqual(db.prepare('SELECT name FROM town_locations WHERE map_id = ? ORDER BY id').all(oldTown)
    .map(r => r.name), ['老广场']);

  // 落座：玩家搬到新镇，目录、快照、瓦片载荷三处一致（不一致就是 NPC 换了、地图没换）
  assert.equal(db.prepare("SELECT map_id FROM town_players WHERE id = 'me'").get().map_id, newTown);
  assert.equal(town.getTownMaps().currentMapId, newTown);
  const snapshot = town.getTownState();
  assert.equal(snapshot.mapId, newTown);
  assert.equal(snapshot.map.id, newTown);
  assert.equal(snapshot.player !== null, true, '玩家在新镇的场景里');
  assert.equal((await call('GET', '/map')).payload.id, newTown);
  assert.equal(town.isMapFocused(newTown), true, '新镇就是聚焦图（只有聚焦图产生 LLM 演出）');
  assert.equal(town.isMapFocused(oldTown), false, '老镇降级为后台图');
});
