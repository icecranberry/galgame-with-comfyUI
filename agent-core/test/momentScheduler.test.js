import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const sched = await import('../src/services/momentScheduler.js');

config.dbPath = ':memory:';

test('scheduler dispatches the earlier-due author and keeps characters and townsfolk in one queue', async t => {
  const db = getDb();
  t.after(() => closeDb());

  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('lin', '林小姐', '旅客')`).run();
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled) VALUES (1, '茶娘阿圆', '茶摊主', 1)`).run();

  // 中和内置种子数据：全部推到未来并禁用，只保留测试主角参与调度
  db.prepare(`UPDATE characters SET moments_disabled = 1, next_moment_at = datetime('now', '+8 hours')`).run();
  db.prepare(`UPDATE town_npcs SET moments_disabled = 1, next_moment_at = datetime('now', '+8 hours')`).run();
  db.prepare(`UPDATE characters SET moments_disabled = 0, next_moment_at = datetime('now', '-2 hours') WHERE name = 'lin'`).run();

  const charCalls = [];
  const npcCalls = [];
  sched.setMomentPostGenerator(async character => { charCalls.push(character.id); });
  sched.setTownNpcPostGenerator(async npc => { npcCalls.push(npc.id); });

  // 角色先到期 → 角色先发
  await sched.runSchedulerTick();
  assert.equal(charCalls.length, 1);
  assert.equal(npcCalls.length, 0, 'character wins when it is the only one due');

  // 角色排到未来，镇民到期 → 轮到镇民
  db.prepare(`UPDATE characters SET next_moment_at = datetime('now', '+8 hours') WHERE name = 'lin'`).run();
  db.prepare(`UPDATE town_npcs SET moments_disabled = 0, next_moment_at = datetime('now', '-1 hour') WHERE display_name = '茶娘阿圆'`).run();
  await sched.runSchedulerTick();
  assert.equal(npcCalls.length, 1);
  assert.equal(charCalls.length, 1);

  // 禁用小镇后不再调度镇民
  const townFeature = config.features.town;
  config.features.town = false;
  db.prepare(`UPDATE town_npcs SET next_moment_at = datetime('now', '-1 hour') WHERE display_name = '茶娘阿圆'`).run();
  try {
    await sched.runSchedulerTick();
    assert.equal(npcCalls.length, 1, 'no npc dispatch while town feature is off');
  } finally {
    config.features.town = townFeature;
  }
});

test('townsfolk are limited to one post per rolling 24 hours', async t => {
  const db = getDb();
  t.after(() => closeDb());

  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled) VALUES (1, '面包师傅', '面包师', 1)`).run();

  const npcCalls = [];
  sched.setTownNpcPostGenerator(async npc => { npcCalls.push(npc.id); });

  // 中和内置种子数据与上一个测试的角色：全部推到未来并禁用，只留测试镇民
  db.prepare(`UPDATE characters SET moments_disabled = 1, next_moment_at = datetime('now', '+8 hours')`).run();
  db.prepare(`UPDATE town_npcs SET moments_disabled = 1, next_moment_at = datetime('now', '+8 hours')`).run();
  db.prepare(`UPDATE town_npcs SET moments_disabled = 0, next_moment_at = datetime('now', '-1 hour') WHERE display_name = '面包师傅'`).run();

  await sched.runSchedulerTick();
  assert.equal(npcCalls.length, 1, 'due townsfolk gets dispatched');

  const npcId = db.prepare(`SELECT id FROM town_npcs WHERE display_name = '面包师傅'`).get().id;

  // 24 小时内已有 done 帖：即使再次到期也不再调度（每人每天最多一条）
  db.prepare(`INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (NULL, ?, '出炉了', 'done')`).run(npcId);
  db.prepare(`UPDATE town_npcs SET next_moment_at = datetime('now', '-1 hour') WHERE id = ?`).run(npcId);
  await sched.runSchedulerTick();
  assert.equal(npcCalls.length, 1, 'townsfolk with a done post within 24h is skipped');

  // 生成中 / 失败帖不占用每日名额，失败重试链路不受影响
  db.prepare(`UPDATE moment_posts SET status = 'failed' WHERE npc_id = ?`).run(npcId);
  await sched.runSchedulerTick();
  assert.equal(npcCalls.length, 2, 'failed post does not consume the daily slot');
});

test('npcMomentsDisabled stops townsfolk scheduling while characters keep posting', async t => {
  const db = getDb();
  t.after(() => closeDb());

  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled) VALUES (1, '店员小周', '店员', 1)`).run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('mei', '梅小姐', '旅客')`).run();

  const charCalls = [];
  const npcCalls = [];
  sched.setMomentPostGenerator(async character => { charCalls.push(character.id); });
  sched.setTownNpcPostGenerator(async npc => { npcCalls.push(npc.id); });

  // 中和内置种子数据：全部推到未来并禁用，只留测试角色与测试镇民
  db.prepare(`UPDATE characters SET moments_disabled = 1, next_moment_at = datetime('now', '+8 hours')`).run();
  db.prepare(`UPDATE town_npcs SET moments_disabled = 1, next_moment_at = datetime('now', '+8 hours')`).run();
  db.prepare(`UPDATE characters SET moments_disabled = 0, next_moment_at = datetime('now', '-2 hours') WHERE name = 'mei'`).run();
  db.prepare(`UPDATE town_npcs SET moments_disabled = 0, next_moment_at = datetime('now', '-1 hour') WHERE display_name = '店员小周'`).run();

  const prev = config.town.npcMomentsDisabled;
  config.town.npcMomentsDisabled = true;
  try {
    await sched.runSchedulerTick();
    assert.equal(npcCalls.length, 0, 'no npc dispatch while the master switch is on');
    assert.equal(charCalls.length, 1, 'character posting is unaffected by the npc switch');
  } finally {
    config.town.npcMomentsDisabled = prev;
  }
  // 测试桩不会给角色重排下次发帖时间，先把它推到未来，确保第二个 tick 轮到镇民
  db.prepare(`UPDATE characters SET next_moment_at = datetime('now', '+8 hours') WHERE name = 'mei'`).run();
  await sched.runSchedulerTick();
  assert.equal(npcCalls.length, 1, 'townsfolk dispatch resumes after the switch turns off');
});
