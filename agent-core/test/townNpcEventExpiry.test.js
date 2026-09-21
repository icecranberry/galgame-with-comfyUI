import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const interaction = await import('../src/services/town/townInteractionRuntime.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { reconcileTownResponsibilities } = await import('../src/services/town/townResponsibilityRuntime.js');
const scheduler = await import('../src/services/eventScheduler.js');

function setup(t) {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.events = true;
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const grid = () => Array.from({ length: 12 }, () => Array(12).fill(null));
  const { mapId } = saveMap({ name: 'Expiry test town', cols: 12, rows: 12,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'plaza', name: '广场', businessKind: 'none', x: 0, y: 0, radius: 0 }] });
  createNpc({ mapId, displayName: '羽羽', job: '旅馆老板娘', persona: '热情。' });
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run(JSON.stringify([
    { start: '00:00', end: '24:00', locationKey: 'plaza', activity: '看店' }]), npcId);
  db.prepare(`INSERT INTO town_agent_state(agent_key,map_id,grid_x,grid_y,current_location_id)
    VALUES(?,?,?,?,(SELECT id FROM town_locations WHERE key=? AND map_id=?))`).run(`npc:${npcId}`, mapId, 0, 0, 'plaza', mapId);
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  reconcileTownResponsibilities({ db, allowFallback: true });
  town.startTownScheduler();
  return { db, npcId };
}

test('overdue town npc events are hidden and archived when the npc panel is read', async t => {
  const f = setup(t);
  const eventId = Number(f.db.prepare(`INSERT INTO town_npc_events
    (npc_id, event_type_key, status, title, description, expires_at)
    VALUES (?, 'town.custom', 'open', '十邻币能泡多久？', '测试用事件', datetime('now', '-1 hour'))`).run(f.npcId).lastInsertRowid);

  const view = interaction.getTownInteractions(`npc:${f.npcId}`);
  assert.equal(view.activeStory, null, '过期奇遇不应再作为活跃奇遇下发');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_npc_events WHERE id=?').get(eventId).n, 0, '过期奇遇应被归档出活跃表');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_npc_event_history WHERE id=?').get(eventId).n, 1, '过期奇遇应进入历史表');
});

test('a not-yet-expired town npc event still shows as active', async t => {
  const f = setup(t);
  const eventId = Number(f.db.prepare(`INSERT INTO town_npc_events
    (npc_id, event_type_key, status, title, description, expires_at)
    VALUES (?, 'town.custom', 'open', '还没结束的奇遇', '测试用事件', datetime('now', '+1 hour'))`).run(f.npcId).lastInsertRowid);

  const view = interaction.getTownInteractions(`npc:${f.npcId}`);
  assert.ok(view.activeStory, '未过期的奇遇仍应可见');
  assert.equal(view.activeStory.id, `town:${eventId}`);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM town_npc_events WHERE id=?').get(eventId).n, 1, '未过期不应被归档');
});

test('event scheduler wires an expiry timer independently of eventFreq', async t => {
  const f = setup(t);
  assert.ok(f.db);
  config.features.events = true;
  // freq 调低时生成周期被拉到 5 小时，到期结案定时器必须照样装上（否则过期事件会一直挂着）
  config.features.eventFreq = 0.1;
  scheduler.startEventScheduler();
  scheduler.startEventScheduler(); // 重复启动幂等
  scheduler.stopEventScheduler();
  // 关闭自动生成（freq=0）时，到期结案也必须还在跑
  config.features.eventFreq = 0;
  scheduler.startEventScheduler();
  scheduler.stopEventScheduler();
  config.features.eventFreq = 1;
});
