/**
 * /api/stream 端到端验证：真实 HTTP SSE 连接 + unifiedStreamBus 广播，
 * 确认 schedule_changed 事件从总线走到连接上（模拟前端 consumeSSE 的解析口径）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.DB_PATH = ':memory:';
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';

test('schedule_changed reaches a real /api/stream connection', async t => {
  const { getDb, closeDb } = await import('../src/db/index.js');
  const editor = await import('../src/services/scheduleEditor.js');
  const schedMgr = await import('../src/services/scheduleManager.js');
  const streamRoutes = (await import('../src/routes/stream.js')).default;
  const db = getDb();
  t.after(() => closeDb());

  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('ssetest', 'SSE测试', '旅客')`).run();
  const charId = db.prepare('SELECT id FROM characters WHERE name = \'ssetest\'').get().id;
  db.prepare('INSERT INTO schedule_templates (character_id, schedule_json) VALUES (?, ?)').run(charId, JSON.stringify([
    { startTime: '00:00', endTime: '23:59', activity: '自由活动', location: '家', replyDelay: 0, tags: [], description: 'x' },
  ]));
  schedMgr.ensureTodaySchedule(charId);

  const app = express();
  app.use('/api/stream', streamRoutes);
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;

  // 前端同款：fetch SSE 流，逐块解析 event/data
  const abort = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: abort.signal });
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const received = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const readPromise = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        received.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
  })();

  // 等连接建立（connected 事件）
  for (let i = 0; i < 50 && !received.some(e => e.includes('event: connected')); i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(received.some(e => e.includes('event: connected')), '应先收到 connected');

  // 触发日程变更广播
  const result = editor.applyScheduleChange(charId, {
    startTime: '12:00', endTime: '13:00', activity: 'SSE约定', location: '餐厅', replyDelay: 0, tags: [], description: 'x',
  }, new Date(new Date().setHours(10, 0, 0, 0)));
  assert.equal(result.ok, true, JSON.stringify(result));

  for (let i = 0; i < 50 && !received.some(e => e.includes('event: schedule_changed')); i++) {
    await new Promise(r => setTimeout(r, 20));
  }

  const evt = received.find(e => e.includes('event: schedule_changed'));
  assert.ok(evt, 'SSE 连接上应收到 schedule_changed，实际收到: ' + JSON.stringify(received).slice(0, 400));
  const dataLine = evt.split('\n').find(l => l.startsWith('data: '));
  const payload = JSON.parse(dataLine.slice('data: '.length));
  assert.equal(payload.character_id, charId);
  assert.equal(payload.display_name, 'SSE测试');
  assert.equal(payload.activity, 'SSE约定');

  // 手动编辑同样广播
  const manual = editor.updateScheduleActivity(charId, 0, { activity: '手动改的活动' });
  assert.equal(manual.ok, true);
  for (let i = 0; i < 50 && !received.some(e => e.includes('手动改的活动')); i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  const manualEvt = received.filter(e => e.includes('event: schedule_changed'))
    .find(e => e.includes('手动改的活动'));
  assert.ok(manualEvt, '手动编辑也应广播 schedule_changed');
  const manualPayload = JSON.parse(manualEvt.split('\n').find(l => l.startsWith('data: ')).slice('data: '.length));
  assert.equal(manualPayload.activity, '手动改的活动');
  assert.equal(manualPayload.display_name, 'SSE测试');

  // 排入未来某天的约定也广播（带 target_date）
  editor.queueScheduleChange(charId, '2099-01-01', {
    startTime: '18:00', endTime: '19:00', activity: '明天的约定', location: 'x', replyDelay: 0, tags: [], description: 'x',
  });
  for (let i = 0; i < 50 && !received.some(e => e.includes('明天的约定')); i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  const queuedEvt = received.filter(e => e.includes('event: schedule_changed'))
    .find(e => e.includes('明天的约定'));
  assert.ok(queuedEvt, '入队未来的约定也应广播 schedule_changed');
  const queuedPayload = JSON.parse(queuedEvt.split('\n').find(l => l.startsWith('data: ')).slice('data: '.length));
  assert.equal(queuedPayload.target_date, '2099-01-01');

  // 断开连接，让读取循环退出、进程得以结束
  abort.abort();
  await readPromise.catch(() => {});
});
