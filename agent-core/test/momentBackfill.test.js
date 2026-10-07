import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { getDb, closeDb } = await import('../src/db/index.js');
const { startMomentBackfill, stopMomentBackfill, isMomentBackfillRunning } = await import('../src/services/momentBackfill.js');
const { getEditTask } = await import('../src/services/imageEditTasks.js');
const { backfillDay } = await import('../src/services/momentBackfillPlan.js');
const sqlTime = date => date.toISOString().slice(0, 19).replace('T', ' ');

test('补发跳过今日两条、禁用角色；保留未到期日程，拒绝重复任务，失败后释放锁', async t => {
  const db = getDb();
  t.after(closeDb);
  db.prepare('UPDATE characters SET moments_disabled = 1').run();
  const seed = (name, disabled = 0) => {
    const id = Number(db.prepare(`INSERT INTO characters (name, display_name, base_prompt, moments_disabled, next_schedule_refresh_at)
      VALUES (?, ?, '测试人格', ?, datetime('now', '+2 days'))`).run(name, name, disabled).lastInsertRowid);
    db.prepare('INSERT INTO schedule_templates (character_id, schedule_json) VALUES (?, ?)').run(id,
      JSON.stringify([{ startTime: '00:00', endTime: '24:00', activity: '测试活动', location: '家', replyDelay: 0 }]));
    return id;
  };
  const empty = seed('empty'), one = seed('one'), two = seed('two'), disabled = seed('disabled', 1);
  const stamp = sqlTime(backfillDay().start);
  for (const id of [one, two, two]) db.prepare("INSERT INTO moment_posts (character_id, content, status, created_at) VALUES (?, '已发', 'done', ?)").run(id, stamp);
  // 昨天的成功帖与今日失败帖均不占今日两条门槛。
  db.prepare("INSERT INTO moment_posts (character_id, content, status, created_at) VALUES (?, '', 'done', datetime(?, '-1 day'))").run(empty, stamp);
  db.prepare("INSERT INTO moment_posts (character_id, content, status) VALUES (?, '', 'failed')").run(empty);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const id = startMomentBackfill(async (character, opts) => {
    calls.push({ character, opts });
    await gate;
  });
  assert.ok(isMomentBackfillRunning());
  assert.throws(() => startMomentBackfill(() => {}), { status: 409 });
  release();
  while (isMomentBackfillRunning()) await new Promise(resolve => setImmediate(resolve));
  for (const characterId of [empty, one]) assert.ok([2, 3].includes(calls.filter(c => c.character.id === characterId).length));
  assert.ok(calls.every(c => ![two, disabled].includes(c.character.id)));
  assert.ok(calls.every(c => c.opts.backfill && c.opts.activity.activity === '测试活动' && c.opts.postedAt <= new Date()));
  assert.equal(getEditTask(id).status, 'ready');
  assert.match(getEditTask(id).result.summary, /跳过 1 位/);
  const failedId = startMomentBackfill(async () => { throw new Error('模拟失败'); });
  while (isMomentBackfillRunning()) await new Promise(resolve => setImmediate(resolve));
  assert.equal(getEditTask(failedId).status, 'failed');
  assert.match(getEditTask(failedId).error, /模拟失败/);
  // 停止正在发帖的任务：本条完成，后续不再开始，锁在本条完成前保留。
  let finishPost, enteredPost;
  const entered = new Promise(resolve => { enteredPost = resolve; });
  const pending = new Promise(resolve => { finishPost = resolve; });
  let started = 0;
  const stoppedId = startMomentBackfill(async () => {
    started++;
    enteredPost();
    await pending;
  });
  await entered;
  assert.throws(() => stopMomentBackfill('old-task-id'), { status: 409 });
  stopMomentBackfill(stoppedId);
  stopMomentBackfill(stoppedId); // 重复停止幂等。
  assert.equal(getEditTask(stoppedId).progress.phase, 'stopping');
  assert.ok(isMomentBackfillRunning());
  finishPost();
  while (isMomentBackfillRunning()) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 1);
  assert.equal(getEditTask(stoppedId).result.cancelled, true);
  assert.match(getEditTask(stoppedId).result.summary, /已补发 1 条/);

  // 准备阶段停止不能启动任何生成。
  let releaseIdle;
  const idle = new Promise(resolve => { releaseIdle = resolve; });
  const waitingId = startMomentBackfill(async () => { assert.fail('停止后不能生成'); }, { waitForIdle: () => idle });
  stopMomentBackfill(waitingId);
  releaseIdle();
  while (isMomentBackfillRunning()) await new Promise(resolve => setImmediate(resolve));
  assert.equal(getEditTask(waitingId).result.cancelled, true);

});
