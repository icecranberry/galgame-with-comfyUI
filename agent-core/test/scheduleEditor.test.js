import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const editor = await import('../src/services/scheduleEditor.js');
const special = await import('../src/services/scheduleSpecialMoment.js');
const schedMgr = await import('../src/services/scheduleManager.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');

config.dbPath = ':memory:';

function insertCharWithSchedule(db, displayName, activities) {
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES (?, ?, '旅客')`)
    .run(`char_${displayName}`, displayName);
  const char = db.prepare('SELECT id FROM characters WHERE display_name = ?').get(displayName);
  db.prepare('INSERT INTO schedule_templates (character_id, schedule_json) VALUES (?, ?)')
    .run(char.id, JSON.stringify(activities));
  // 派生当日快照（与线上 ensureTodaySchedule 同源）
  schedMgr.ensureTodaySchedule(char.id);
  return char.id;
}

function loadSchedule(db, characterId) {
  const row = db.prepare(
    'SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = DATE(\'now\', \'localtime\')'
  ).get(characterId);
  return row ? JSON.parse(row.schedule_json) : null;
}

const BASE_DAY = [
  { startTime: '07:00', endTime: '12:00', activity: '上午工作', location: '事务所', replyDelay: 0, tags: ['工作'], description: '伏案工作。' },
  { startTime: '12:00', endTime: '13:00', activity: '午餐', location: '餐厅', replyDelay: 0, tags: ['日常'], description: '吃午饭。' },
  { startTime: '13:00', endTime: '18:00', activity: '下午外出', location: '街区', replyDelay: 0, tags: ['外出'], description: '外出办事。' },
  { startTime: '18:00', endTime: '22:00', activity: '晚间休闲', location: '公寓', replyDelay: 0, tags: ['休闲'], description: '在家休息。' },
  { startTime: '22:00', endTime: '07:00', activity: '就寝安眠', location: '公寓卧室', replyDelay: -1, tags: ['睡眠'], description: '沉入睡眠。' },
];

const fmtMin = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 构造一个包含当前时刻、且不跨午夜的时间窗（HH:MM），供特殊队列扫描测试用 */
function inWindowSlot(duration = 30) {
  const curMin = new Date().getHours() * 60 + new Date().getMinutes();
  const start = Math.min(Math.max(curMin, 0), 1439 - duration);
  return [fmtMin(start), fmtMin(start + duration)];
}

/** 构造今天固定时刻的 Date（applyScheduleChange 支持 now 注入，测试不受运行时刻影响） */
function todayAt(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

test('updateScheduleActivity marks the entry edited and queues it for the special moment', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '编辑测试', BASE_DAY);

  // 手动编辑只改内容：不传时间 → 沿用原条目时间段
  const result = editor.updateScheduleActivity(charId, 1, {
    activity: '午餐——和用户的约定', location: '咖啡店', description: '如约碰面。',
  });
  assert.equal(result.ok, true);

  const schedule = loadSchedule(db, charId);
  assert.equal(schedule[1].activity, '午餐——和用户的约定');
  assert.equal(schedule[1].startTime, '12:00', '手动编辑不改时间');
  assert.equal(schedule[1].endTime, '13:00', '手动编辑不改时间');
  assert.equal(schedule[1].edited, 1);
  assert.equal(schedule[1].specialMomentStatus, 'pending');
  assert.equal(schedule[1].location, '咖啡店');
  // 其余条目不动
  assert.equal(schedule[0].activity, '上午工作');
  assert.equal(schedule[0].edited, undefined);
});

test('updateScheduleActivity rejects invalid patches', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '非法编辑', BASE_DAY);

  assert.equal(editor.updateScheduleActivity(charId, 0, { startTime: '25:00', endTime: '26:00', activity: 'x' }).ok, false);
  assert.equal(editor.updateScheduleActivity(charId, 0, { activity: '' }).ok, false);
  assert.equal(editor.updateScheduleActivity(charId, 99, { activity: 'x' }).ok, false);
});

test('updateScheduleActivity preserves cross-midnight blocks (manual edit of a sleep entry)', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '睡眠编辑', BASE_DAY);
  const sleepIdx = BASE_DAY.findIndex(a => a.replyDelay === -1);

  // 手动编辑睡眠块的文案：跨天时段（22:00~07:00）必须原样保留，不能被当成非法时间拒掉
  const result = editor.updateScheduleActivity(charId, sleepIdx, { activity: '改名后的睡眠' });
  assert.equal(result.ok, true);
  const sleep = loadSchedule(db, charId).find(a => a.activity === '改名后的睡眠');
  assert.ok(sleep);
  assert.equal(sleep.startTime, '22:00');
  assert.equal(sleep.endTime, '07:00');
  assert.equal(sleep.edited, 1);
});

test('applyScheduleChange broadcasts schedule_changed via unified SSE bus', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '广播测试', BASE_DAY);
  const bus = await import('../src/services/unifiedStreamBus.js');

  const writes = [];
  const fakeRes = { write: chunk => writes.push(chunk) };
  bus.addClient(fakeRes);
  try {
    const result = editor.applyScheduleChange(charId, {
      startTime: '12:00', endTime: '13:00', activity: '广播约定', location: '餐厅', replyDelay: 0, tags: [], description: 'x',
    }, todayAt(10));
    assert.equal(result.ok, true);
  } finally {
    bus.removeClient(fakeRes);
  }

  const evt = writes.find(w => w.includes('event: schedule_changed'));
  assert.ok(evt, '应广播 schedule_changed 事件');
  const dataLine = evt.split('\n').find(l => l.startsWith('data: '));
  const payload = JSON.parse(dataLine.slice('data: '.length));
  assert.equal(payload.character_id, charId);
  assert.equal(payload.display_name, '广播测试');
  assert.equal(payload.activity, '广播约定');
  assert.equal(payload.start_time, '12:00');
});

test('applyScheduleChange replaces overlapping blocks and keeps 24h coverage', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '合并测试', BASE_DAY);
  const now = todayAt(10); // 上午 10 点执行改日程

  // 12:00-15:30 与「午餐」「下午外出」重叠 → 两条被裁剪，插入新条目
  const result = editor.applyScheduleChange(charId, {
    startTime: '12:00', endTime: '15:30', activity: '和用户的约会', location: '游乐园', replyDelay: 0,
    tags: ['约会'], description: '两人如约在游乐园碰面。',
  }, now);
  assert.equal(result.ok, true, JSON.stringify(result));

  const schedule = loadSchedule(db, charId);
  const byStart = Object.fromEntries(schedule.map(a => [a.startTime, a]));
  // 被裁剪的邻居保留前/后段
  assert.equal(byStart['07:00'].activity, '上午工作');
  assert.equal(byStart['07:00'].endTime, '12:00');
  assert.equal(byStart['12:00'].activity, '和用户的约会');
  assert.equal(byStart['12:00'].edited, 1);
  assert.equal(byStart['12:00'].specialMomentStatus, 'pending');
  assert.equal(byStart['15:30'].activity, '下午外出');
  assert.equal(byStart['15:30'].endTime, '18:00');
  // 中午的旧午餐条目被替换掉
  assert.equal(schedule.some(a => a.activity === '午餐'), false);
  // 24 小时无空档
  const sorted = [...schedule].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].endTime >= sorted[i].startTime,
      `gap/overlap between ${sorted[i - 1].endTime} and ${sorted[i].startTime}`);
  }
  assert.equal(sorted[0].startTime, '00:00');
});

test('applyScheduleChange caps day-spanning appointments and never leaves zero-length ghosts', async t => {
  const db = getDb();
  t.after(() => closeDb());
  // 复现线上事故：日程里有 LLM 用 00:00 表示「当天午夜收尾」的条目，
  // 约定从凌晨 00:57 开始、endTime 被写成 23:59（霸占全天）
  const charId = insertCharWithSchedule(db, '全天封顶', [
    { startTime: '10:00', endTime: '19:00', activity: '白天营业', location: '店里', replyDelay: 0, tags: [], description: 'x' },
    { startTime: '19:00', endTime: '00:00', activity: '深夜泡吧——梦魔酒馆续摊', location: '酒馆', replyDelay: 0, tags: [], description: 'x' },
    { startTime: '00:00', endTime: '10:00', activity: '就寝安眠', location: '公寓', replyDelay: -1, tags: ['睡眠'], description: 'x' },
  ]);

  const result = editor.applyScheduleChange(charId, {
    startTime: '00:57', endTime: '23:59', activity: '夜宵——和冰乐的深夜续摊', location: '街边小摊',
    replyDelay: 0, tags: ['夜宵'], description: '边吃边聊到天亮。',
  }, todayAt(0, 57));
  assert.equal(result.ok, true, JSON.stringify(result));

  const schedule = loadSchedule(db, charId);
  // 时长封顶：00:57 + 6 小时 = 06:57，而不是霸占全天
  const party = schedule.find(a => a.activity.startsWith('夜宵'));
  assert.ok(party);
  assert.equal(party.startTime, '00:57');
  assert.equal(party.endTime, '06:57');
  // 白天的条目完好无损，没有任何 00:00~00:00 幽灵块
  assert.ok(schedule.some(a => a.activity === '白天营业' && a.startTime === '10:00' && a.endTime === '19:00'));
  assert.ok(schedule.every(a => !(a.startTime === '00:00' && a.endTime === '00:00')));
  assert.equal(schedule.some(a => a.edited === 1 && a.activity.startsWith('夜宵')), true);
  // 无空档
  const linear = [...schedule].filter(a => a.endTime > a.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < linear.length; i++) {
    assert.ok(linear[i - 1].endTime >= linear[i].startTime,
      `gap between ${linear[i - 1].endTime} and ${linear[i].startTime}`);
  }
});

test('applyScheduleChange splits a cross-midnight sleep block when the appointment overlaps it', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '跨午夜测试', BASE_DAY);

  const result = editor.applyScheduleChange(charId, {
    startTime: '23:00', endTime: '23:59', activity: '深夜散步', location: '河边', replyDelay: 0,
    tags: ['夜间'], description: '两人沿着河边散步。',
  }, todayAt(20));
  assert.equal(result.ok, true);

  const schedule = loadSchedule(db, charId);
  const sleepBlocks = schedule.filter(a => a.replyDelay === -1);
  // 睡眠块被拆成上半夜（22:00~23:00）与下半夜（00:00~07:00）两段
  const starts = sleepBlocks.map(a => a.startTime).sort();
  assert.deepEqual(starts, ['00:00', '22:00']);
  assert.ok(sleepBlocks.some(a => a.startTime === '22:00' && a.endTime === '23:00'));
  assert.ok(sleepBlocks.some(a => a.startTime === '00:00' && a.endTime === '07:00'));
  assert.ok(schedule.some(a => a.activity === '深夜散步' && a.edited === 1));
});

test('applyScheduleChange refuses appointments whose slot already passed', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '过期测试', [
    { startTime: '00:00', endTime: '01:00', activity: '凌晨刷手机', location: '床上', replyDelay: 0, tags: [], description: '刷手机。' },
    { startTime: '01:00', endTime: '00:00', activity: '就寝', location: '卧室', replyDelay: -1, tags: ['睡眠'], description: '睡觉。' },
  ]);
  const result = editor.applyScheduleChange(charId, {
    startTime: '00:00', endTime: '00:30', activity: '已过去的约定', location: '某处', replyDelay: 0, tags: [], description: 'x',
  }, todayAt(16));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('applyScheduleChange accepts cross-midnight appointments by clamping to 23:59', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '跨零点约定', BASE_DAY);

  // LLM 对深夜约定常输出 23:47~00:40 → 截至 23:59，照常合并并进入特殊队列
  const result = editor.applyScheduleChange(charId, {
    startTime: '23:47', endTime: '00:40', activity: '宵夜——和冰乐的深夜小摊之约', location: '街角夜宵摊',
    replyDelay: 0, tags: ['宵夜'], description: '两人在夜宵摊边吃边聊。',
  }, todayAt(23));
  assert.equal(result.ok, true, JSON.stringify(result));

  const schedule = loadSchedule(db, charId);
  const late = schedule.find(a => a.activity.startsWith('宵夜'));
  assert.ok(late, '跨零点约定应被合并进日程');
  assert.equal(late.startTime, '23:47');
  assert.equal(late.endTime, '23:59');
  assert.equal(late.edited, 1);
  // 睡眠块上半段被裁到 22:00~23:47，下半段保留 00:00~07:00
  assert.ok(schedule.some(a => a.replyDelay === -1 && a.startTime === '22:00' && a.endTime === '23:47'));
  assert.ok(schedule.some(a => a.replyDelay === -1 && a.startTime === '00:00' && a.endTime === '07:00'));

  // 非跨零点的错乱输出（结束早于开始、且结束不在凌晨）仍然拒绝
  const bad = editor.applyScheduleChange(charId, {
    startTime: '19:00', endTime: '18:00', activity: '错乱约定', location: 'x', replyDelay: 0, tags: [], description: 'x',
  }, todayAt(10));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_activity');
});

test('special moment queue: in-window entries are dispatched, past entries expire, sent marks persist', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '队列测试', BASE_DAY);
  // 手动写入三种状态的条目：待发送（时段内）、待发送（已过期）、普通条目
  const [inWinStart, inWinEnd] = inWindowSlot(30);

  const schedule = loadSchedule(db, charId);
  schedule.push(
    { startTime: inWinStart, endTime: inWinEnd, activity: '时段内约定', location: '公园', replyDelay: 0, tags: [], description: '', edited: 1, specialMomentStatus: 'pending' },
    { startTime: '00:00', endTime: '00:10', activity: '已过时约定', location: '公园', replyDelay: 0, tags: [], description: '', edited: 1, specialMomentStatus: 'pending' },
  );
  db.prepare('UPDATE daily_schedules SET schedule_json = ? WHERE character_id = ?')
    .run(JSON.stringify(schedule), charId);

  const generated = [];
  special.setSpecialScheduleMomentGenerator(async item => {
    generated.push(item);
    editor.updateSpecialMomentStatus(item.characterId, item.activity.startTime, 'sent');
  });
  await special.runSpecialMomentCheck();

  assert.equal(generated.length, 1);
  assert.equal(generated[0].activity.activity, '时段内约定');
  assert.equal(generated[0].characterId, charId);

  const after = loadSchedule(db, charId);
  const inWin = after.find(a => a.activity === '时段内约定');
  const expired = after.find(a => a.activity === '已过时约定');
  assert.equal(inWin.specialMomentStatus, 'sent');
  assert.equal(expired.specialMomentStatus, 'expired', '过时不候：启动/扫描时已过时段直接标记 expired');

  // 重复扫描不会再次发送
  await special.runSpecialMomentCheck();
  assert.equal(generated.length, 1);
});

test('pending schedule changes: today applies, tomorrow waits, past expires, wiped snapshot re-applies', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '队列跨天', BASE_DAY);
  const now = todayAt(10);
  const todayKey = getLocalDateKey(now);
  const tomorrowKey = getLocalDateKey(new Date(now.getTime() + 86400000));

  // 明天的约定：入队等待，不动今天日程
  editor.queueScheduleChange(charId, tomorrowKey, {
    startTime: '18:00', endTime: '19:00', activity: '明晚的饭约', location: '餐厅', replyDelay: 0, tags: [], description: 'x',
  });
  // 过期的约定：直接判 expired
  editor.queueScheduleChange(charId, '2020-01-01', {
    startTime: '12:00', endTime: '13:00', activity: '很旧的约定', location: 'x', replyDelay: 0, tags: [], description: 'x',
  });
  // 今天的约定：立即应用
  editor.queueScheduleChange(charId, todayKey, {
    startTime: '12:00', endTime: '13:00', activity: '今天的饭约', location: '餐厅', replyDelay: 0, tags: [], description: 'x',
  });

  editor.ensurePendingScheduleChanges(now);

  let schedule = loadSchedule(db, charId);
  assert.equal(schedule.some(a => a.activity === '明晚的饭约'), false, '明天的约定不能进今天的日程');
  assert.ok(schedule.some(a => a.edited === 1 && a.activity === '今天的饭约' && a.specialMomentStatus === 'pending'));
  const statuses = Object.fromEntries(
    db.prepare('SELECT target_date, status FROM pending_schedule_changes').all().map(r => [r.target_date, r.status])
  );
  assert.equal(statuses[tomorrowKey], 'pending');
  assert.equal(statuses['2020-01-01'], 'expired', '过时不候');
  assert.equal(statuses[todayKey], 'applied');

  // 模拟夜间日程刷新整包重写快照（覆盖掉已应用的约定）→ 再次 ensure 重新合并
  db.prepare(`
    UPDATE daily_schedules
    SET schedule_json = (SELECT schedule_json FROM schedule_templates WHERE character_id = ?)
    WHERE character_id = ?
  `).run(charId, charId);
  assert.equal(loadSchedule(db, charId).some(a => a.edited), false);

  editor.ensurePendingScheduleChanges(now);
  schedule = loadSchedule(db, charId);
  assert.ok(schedule.some(a => a.edited === 1 && a.activity === '今天的饭约'), '被刷新冲掉的约定要重新合并回去');
  assert.equal(loadSchedule(db, charId).some(a => a.activity === '明晚的饭约'), false);
});

test('failed special moment generation falls back to pending for retry', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const charId = insertCharWithSchedule(db, '重试测试', BASE_DAY);
  const [inWinStart, inWinEnd] = inWindowSlot(40);

  const schedule = loadSchedule(db, charId);
  schedule.push(
    { startTime: inWinStart, endTime: inWinEnd, activity: '会失败的约定', location: '公园', replyDelay: 0, tags: [], description: '', edited: 1, specialMomentStatus: 'pending' },
  );
  db.prepare('UPDATE daily_schedules SET schedule_json = ? WHERE character_id = ?')
    .run(JSON.stringify(schedule), charId);

  let attempts = 0;
  special.setSpecialScheduleMomentGenerator(async () => {
    attempts++;
    throw new Error('LLM down');
  });
  await special.runSpecialMomentCheck();
  assert.equal(attempts, 1);
  const after = loadSchedule(db, charId);
  assert.equal(after.find(a => a.activity === '会失败的约定').specialMomentStatus, 'pending', '失败回退 pending，窗口内下轮重试');
});
