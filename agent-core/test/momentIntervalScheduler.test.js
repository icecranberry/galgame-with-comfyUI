import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const { getSetting } = await import('../src/db/settings.js');
const sched = await import('../src/services/momentScheduler.js');
const { getMomentIntervalSchedule } = await import('../src/services/momentIntervalScheduler.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');
const router = (await import('../src/routes/config.js')).default;
const MINUTE = 60_000;

function saveFrequency(value, mode = 'interval') {
  return new Promise((resolve, reject) => {
    const req = { method: 'PUT', url: '/moment-freq', body: { value, mode } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    router.handle(req, res, error => reject(error || new Error('Route not found')));
  });
}

function setup(t) {
  const db = getDb();
  const previous = { ...config.features };
  const previousTown = { ...config.town };
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  t.after(() => {
    sched.stopMomentScheduler();
    sched.setMomentPostGenerator(null);
    sched.setTownNpcPostGenerator(null);
    Object.assign(config.features, previous);
    Object.assign(config.town, previousTown);
    closeDb();
  });
  config.features.momentFreq = 1;
  config.features.momentFreqMode = 'default';
  config.features.town = false;
  db.prepare('UPDATE characters SET moments_disabled = 1').run();
  db.prepare('UPDATE town_npcs SET moments_disabled = 1').run();
  const calls = [];
  sched.setMomentPostGenerator(async (character, options) => {
    calls.push({ key: `character:${character.id}`, options });
  });
  sched.setTownNpcPostGenerator(async npc => calls.push({ key: `npc:${npc.id}` }));
  function addCharacter(name, nextAt = '2099-01-01 00:00:00') {
    return Number(db.prepare(`INSERT INTO characters (name, display_name, base_prompt, next_moment_at)
      VALUES (?, ?, '旅客', ?)`).run(name, name, nextAt).lastInsertRowid);
  }
  const state = () => JSON.parse(getSetting('moment_interval_schedule'));
  return { db, calls, addCharacter, state, advance: ms => { now += ms; } };
}

test('5 分钟档每次只选一人，忽略旧排期，到点前不发且不连续选同一人', async t => {
  const { db, calls, addCharacter, advance, state } = setup(t);
  addCharacter('过去', '2000-01-01 00:00:00');
  addCharacter('未来');
  addCharacter('未排期', null);
  const before = db.prepare('SELECT id, next_moment_at FROM characters').all();
  assert.equal((await saveFrequency(24)).status, 200);
  assert.equal(state().nextAt, Date.now() + 5 * MINUTE);
  assert.deepEqual(db.prepare('SELECT id, next_moment_at FROM characters').all(), before, '不能把全体角色重排到同一时间段');
  advance(5 * MINUTE - 1);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 0, '即使有过期排期，也不提前发');
  advance(1);
  await sched.runSchedulerTick();
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].key, calls[1].key);
});

test('全部角色原本都要等很久时，到点仍生成；没有旧的到期角色也不跳过', async t => {
  const { calls, addCharacter, advance } = setup(t);
  const id = addCharacter('未来角色');
  await saveFrequency(24);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`character:${id}`]);
});

test('改慢只重置全局计时，重复保存与重启不推迟，离线不累计补发', async t => {
  const { calls, addCharacter, advance, state } = setup(t);
  addCharacter('长间隔', '2000-01-01 00:00:00');
  await saveFrequency(24);
  advance(MINUTE);
  await saveFrequency(1 / 18);
  const expected = state();
  assert.equal(expected.nextAt, Date.now() + 36 * 60 * MINUTE);
  advance(MINUTE);
  await saveFrequency(1 / 18);
  sched.startMomentScheduler();
  sched.stopMomentScheduler();
  assert.deepEqual(getMomentIntervalSchedule(), expected, '重启恢复持久化的同一排期');
  await sched.runSchedulerTick();
  assert.equal(calls.length, 0);
  advance(36 * 60 * MINUTE * 10);
  await sched.runSchedulerTick();
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1, '错过十个周期也只发一条');
});

test('2 小时与默认同值但模式不同；默认恢复逐人到期调度，关闭不发', async t => {
  const { calls, addCharacter, advance, state } = setup(t);
  addCharacter('到期角色', '2000-01-01 00:00:00');
  await saveFrequency(1, 'interval');
  assert.equal(state().nextAt, Date.now() + 120 * MINUTE);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 0);
  await saveFrequency(1, 'default');
  assert.equal(state(), null);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1);
  await saveFrequency(0);
  advance(120 * MINUTE);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1);
  await saveFrequency(24);
  assert.equal(state().nextAt, Date.now() + 5 * MINUTE);
});

test('自定义档不绕过禁发、休眠、临时叫醒、奇遇和生成锁，无人可发时稍后检查', async t => {
  const { db, calls, addCharacter, advance } = setup(t);
  const disabled = addCharacter('禁发');
  const sleeping = addCharacter('休眠');
  const awake = addCharacter('临时醒来');
  const event = addCharacter('奇遇中');
  const generating = addCharacter('生成中');
  db.prepare('UPDATE characters SET moments_disabled = 1 WHERE id = ?').run(disabled);
  db.prepare('UPDATE characters SET is_sleeping = 1 WHERE id = ?').run(sleeping);
  db.prepare("UPDATE characters SET temporary_wake_until = datetime('now', '+1 hour') WHERE id = ?").run(awake);
  db.prepare(`INSERT INTO character_events (character_id, event_type_key, status, expires_at)
    VALUES (?, 'test', 'open', datetime('now', '+1 hour'))`).run(event);
  db.prepare("INSERT INTO moment_posts (character_id, content, status) VALUES (?, '', 'generating')").run(generating);
  await saveFrequency(24);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 0);
  db.prepare('UPDATE characters SET is_sleeping = 0 WHERE id = ?').run(sleeping);
  advance(30_000);
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`character:${sleeping}`]);
});

test('生成中不并发；途中切档后旧任务不能覆盖新排期', async t => {
  const { addCharacter, advance, state } = setup(t);
  addCharacter('慢生成');
  let release;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let count = 0;
  sched.setMomentPostGenerator(async () => { count++; started(); await pending; });
  await saveFrequency(24);
  advance(5 * MINUTE);
  const tick = sched.runSchedulerTick();
  await began;
  try {
    await sched.runSchedulerTick();
    assert.equal(count, 1);
    await saveFrequency(4);
    const changed = state();
    release();
    await tick;
    assert.deepEqual(state(), changed);
    assert.equal(changed.nextAt, Date.now() + 30 * MINUTE);
  } finally { release(); await tick; }
});

test('生成失败限速重试，耗时超过间隔也不马上连发追赶', async t => {
  const { calls, addCharacter, advance, state } = setup(t);
  addCharacter('重试角色');
  let attempts = 0;
  sched.setMomentPostGenerator(async () => { attempts++; throw new Error('offline'); });
  await saveFrequency(24);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  await sched.runSchedulerTick();
  assert.equal(attempts, 1);
  assert.equal(state().nextAt, Date.now() + MINUTE);
  sched.setMomentPostGenerator(async () => { calls.push('done'); advance(11 * MINUTE); });
  advance(MINUTE);
  await sched.runSchedulerTick();
  assert.equal(state().nextAt, Date.now() + 5 * MINUTE);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1);
});

test('自定义档不抽取镇民；镇民只按原排期发帖且不占角色名额', async t => {
  const { db, calls, addCharacter, advance, state } = setup(t);
  config.features.town = true;
  config.town.npcMomentsDisabled = false;
  const npcId = Number(db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled, next_moment_at)
    VALUES (1, '定时镇民', '店员', 1, '2099-01-01 00:00:00')`).run().lastInsertRowid);
  await saveFrequency(24);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  assert.deepEqual(calls, [], '无人可发时也不能抽未来到期的镇民补位');
  const charId = addCharacter('角色');
  advance(30_000);
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`character:${charId}`]);
  const planned = state();
  db.prepare("UPDATE town_npcs SET next_moment_at = datetime('now', '-1 minute') WHERE id = ?").run(npcId);
  advance(30_000);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1, '镇民仍按 5 分钟检查，不随快速档每 30 秒派发');
  advance(4 * MINUTE);
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`character:${charId}`, `npc:${npcId}`]);
  assert.deepEqual(state(), planned, '镇民发帖不消耗或推迟角色名额');
  db.prepare("INSERT INTO moment_posts (npc_id, content, status) VALUES (?, '动态', 'done')").run(npcId);
  advance(30_000);
  await sched.runSchedulerTick();
  assert.equal(calls.at(-1).key, `character:${charId}`);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  await sched.runSchedulerTick();
  assert.equal(calls.filter(call => call.key === `npc:${npcId}`).length, 1, '镇民仍遵守每日上限');
});

test('慢速档不影响镇民默认排期，关闭档同时停止角色和镇民，重开后恢复', async t => {
  const { db, calls, addCharacter, state, advance } = setup(t);
  config.features.town = true;
  config.town.npcMomentsDisabled = false;
  addCharacter('角色', '2000-01-01 00:00:00');
  const npcId = Number(db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled, next_moment_at)
    VALUES (1, '默认镇民', '店员', 1, '2000-01-01 00:00:00')`).run().lastInsertRowid);
  await saveFrequency(1 / 18);
  const planned = state();
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`npc:${npcId}`]);
  assert.deepEqual(state(), planned);
  await saveFrequency(0);
  const newNpcId = Number(db.prepare(`INSERT INTO town_npcs (map_id, display_name, town_enabled)
    VALUES (1, '关闭期间新增镇民', 1)`).run().lastInsertRowid);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`npc:${npcId}`], '角色和镇民即使到期也不能发');
  assert.equal(db.prepare('SELECT next_moment_at FROM town_npcs WHERE id = ?').get(newNpcId).next_moment_at, null,
    '关闭期间也不初始化镇民排期');
  await saveFrequency(1 / 18);
  await sched.runSchedulerTick();
  assert.deepEqual(calls.map(call => call.key), [`npc:${npcId}`, `npc:${npcId}`], '重新开启后镇民恢复默认调度');
  config.town.npcMomentsDisabled = true;
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 2, '镇民自身的关闭开关仍然有效');
});

test('自定义档下新镇民仍按默认首次 1~4 小时初始化', async t => {
  const { db, calls } = setup(t);
  config.features.town = true;
  config.town.npcMomentsDisabled = false;
  const npcId = Number(db.prepare(`INSERT INTO town_npcs (map_id, display_name, town_enabled)
    VALUES (1, '新镇民', 1)`).run().lastInsertRowid);
  await saveFrequency(24);
  await sched.runSchedulerTick();
  const next = db.prepare('SELECT next_moment_at FROM town_npcs WHERE id = ?').get(npcId).next_moment_at;
  const delay = Date.parse(next.replace(' ', 'T') + 'Z') - Date.now();
  assert.ok(delay >= 3600_000 - 1000 && delay <= 4 * 3600_000);
  assert.deepEqual(calls, []);
});

test('报纸吐槽在自定义档也等待全局名额，不额外插入一条', async t => {
  const { db, calls, addCharacter, advance } = setup(t);
  const id = addCharacter('报纸主角');
  addCharacter('其他人', '2000-01-01 00:00:00');
  db.prepare(`INSERT INTO town_newspapers
    (publish_date, name, edition, items_json, character_id, character_event_json, moment_done, complaint_after)
    VALUES (?, '日报', 1, '[]', ?, ?, 0, datetime('now', '-1 minute'))`)
    .run(getLocalDateKey(), id, JSON.stringify({ title: '店铺开业', content: '开业了', note: '你在忙开业' }));
  await saveFrequency(24);
  await sched.runSchedulerTick();
  assert.equal(calls.length, 0);
  advance(5 * MINUTE);
  await sched.runSchedulerTick();
  await sched.runSchedulerTick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, `character:${id}`);
  assert.ok(calls[0].options.forcedTopic);
});
