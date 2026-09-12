import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');

config.dbPath = ':memory:';
config.features.eventFreq = 1;

test('startup cleanup heals stuck town npc processing flags and story offers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const db = getDb();
  t.after(() => { scheduler.stopEventScheduler(); closeDb(); });
  const scheduler = await import('../src/services/eventScheduler.js');

  db.prepare("INSERT INTO town_npcs(map_id, display_name) VALUES(1,'小孙')").run();
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  db.prepare("INSERT INTO town_npcs(map_id, display_name) VALUES(1,'小周')").run();
  const npcId2 = db.prepare('SELECT max(id) id FROM town_npcs').get().id;

  // 卡死的 processing（中断于 6 分钟前）→ 应清零；刚发起的 processing（1 分钟前）→ 应保留
  db.prepare(`INSERT INTO town_npc_events(npc_id,status,title,description,expires_at,processing,created_at,last_interaction_at)
    VALUES(?,'engaged','旧僵事件','描述','2099-01-01 00:00:00',1, datetime('now','-30 minutes'), datetime('now','-6 minutes'))`).run(npcId);
  const staleId = db.prepare('SELECT max(id) id FROM town_npc_events').get().id;
  db.prepare(`INSERT INTO town_npc_events(npc_id,status,title,description,expires_at,processing,created_at)
    VALUES(?,'open','首幕生成中','描述','2099-01-01 00:00:00',1, datetime('now','-1 minutes'))`).run(npcId2);
  const freshId = db.prepare('SELECT max(id) id FROM town_npc_events').get().id;

  // 崩溃残留的 generating 邀请：带 event_id（finish 未跑完）与不带 event_id 各一条 → 都应放回 offered
  // （interaction_offers 的时间戳与生产一致，用 epoch 毫秒）
  const staleMs = Date.now() - 30 * 60000;
  db.prepare(`INSERT INTO town_interaction_offers(request_id,world_id,world_epoch,actor_id,player_actor_id,kind,character_id,
    status,spec_json,created_at,expires_at,updated_at,event_id)
    VALUES('req-a','w1',1,'actor:1','me','story',NULL,'generating','{}', ?, ?, ?, ?)`).run(staleMs, staleMs + 60000, staleMs, staleId);
  db.prepare(`INSERT INTO town_interaction_offers(request_id,world_id,world_epoch,actor_id,player_actor_id,kind,character_id,
    status,spec_json,created_at,expires_at,updated_at,event_id)
    VALUES('req-b','w1',1,'actor:2','me','story',NULL,'generating','{}', ?, ?, ?, NULL)`).run(staleMs, staleMs + 60000, staleMs);

  scheduler.startEventScheduler();

  assert.equal(db.prepare('SELECT processing FROM town_npc_events WHERE id=?').get(staleId).processing, 0,
    'a processing flag stuck for 6 minutes is released');
  assert.equal(db.prepare('SELECT processing FROM town_npc_events WHERE id=?').get(freshId).processing, 1,
    'a branch that just started is not interrupted');
  const offers = db.prepare("SELECT request_id, status FROM town_interaction_offers WHERE request_id IN ('req-a','req-b') ORDER BY request_id").all();
  assert.deepEqual(offers, [{ request_id: 'req-a', status: 'offered' }, { request_id: 'req-b', status: 'offered' }],
    'stale generating offers are released even when an event row was already created');
});
