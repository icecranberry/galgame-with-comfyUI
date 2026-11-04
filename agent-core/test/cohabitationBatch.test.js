import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.DB_PATH = ':memory:';
const { config } = await import('../src/config.js'); config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const { startScheduleBatch, cancelScheduleBatch, maybeStartScheduledBatch, maybeInitializeSchedule } = await import('../src/services/scheduleBatch.js');
const { planResidence, buildCohabitationRequest, validateCohabitationResult } = await import('../src/services/cohabitationPlanner.js');
const { readCohabitationPlan, listResidences, readTemplate, residenceState } = await import('../src/db/cohabitationRepository.js');
const { generateSchedule, snapshotTodaySchedule } = await import('../src/services/scheduleGenerator.js');
const { getCurrentActivity, invalidateCache } = await import('../src/services/scheduleManager.js');
const { scheduleImageContext, scheduleMomentCompanions } = await import('../src/services/scheduleParticipants.js');
const { refresh } = await import('../src/services/characterSearch.js');
const { applySharedActivities } = await import('../src/services/cohabitationSchedule.js');
const { buildPromptProfile } = await import('../src/services/lorebook/promptProfile.js');
let db;
const ids = [];
before(() => {
  const log = console.log; console.log = () => {};
  try { db = getDb(); } finally { console.log = log; }
  for (const name of ['阿甲', '阿乙', '阿丙', '阿丁']) {
    ids.push(Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,short_prompt,loras) VALUES(?,?,?,?,?)')
      .run(name, name, `## 人格\n${name}喜欢闲聊。\n## 你的外观\n你留着银色短发。`, `${name}喜欢做饭与散步。`, JSON.stringify([{ name: name + '.safetensors', strength: 0.7 }])).lastInsertRowid));
  }
  for (const [i, name] of ['晨光居室', '晚风居室'].entries()) {
    const room = db.prepare('INSERT INTO cohabitation_rooms(name) VALUES(?)').run(name).lastInsertRowid;
    for (const id of ids.slice(i * 2, i * 2 + 2)) db.prepare('INSERT INTO cohabitation_members VALUES(?,?)').run(id, room);
  }
  db.prepare('INSERT INTO character_relationships(from_character_id,to_character_id,relationship_text) VALUES(?,?,?)').run(ids[0], ids[2], '竞争对手，偶尔相约讨论');
  refresh();
});
after(() => closeDb());
const base = (room, offset = 0) => [
  { startTime: '00:00', endTime: offset ? '08:00' : '06:00', activity: '睡眠', location: room.name, replyDelay: -1, description: '安稳睡眠。', sleepAtHome: true },
  { startTime: offset ? '08:00' : '06:00', endTime: '22:00', activity: '日常活动', location: '街区', replyDelay: 0, description: '处理工作与生活。' },
  { startTime: '22:00', endTime: '00:00', activity: '睡眠', location: room.name, replyDelay: -1, description: '安稳睡眠。', sleepAtHome: true },
];
function generated(character, _direction, options) {
  const acts = base(options.cohabitation.room, character.id === ids[1]);
  return Promise.resolve({ schedule_json: JSON.stringify(applySharedActivities(acts.map(a => a.replyDelay === -1 ? { ...a, residence: options.cohabitation.room } : a), options.cohabitation.events, character.id)) });
}

test('居室API搬迁保持唯一，拖到新建格在同一事务创建并入住，删除释放成员', async t => {
  const app = express(); app.use(express.json()); app.use('/rooms', (await import('../src/routes/cohabitation.js')).default);
  const server = app.listen(0); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/rooms`;
  const post = await fetch(url + '/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '临时居室', characterId: ids[0] }) });
  assert.equal(post.status, 200); const data = await post.json();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cohabitation_members WHERE character_id=?').get(ids[0]).n, 1);
  await fetch(url + '/rooms/' + data.id, { method: 'DELETE' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cohabitation_members WHERE character_id=?').get(ids[0]).n, 0);
  db.prepare('INSERT INTO cohabitation_members VALUES(?,1)').run(ids[0]);
});

test('两居室串行传递跨居室约定，完成后统一发布；多人资料/LoRA沿用参与者ID', async () => {
  const inputs = []; let inside = 0;
  const planner = async input => {
    assert.equal(inside++, 0); inputs.push(input);
    const request = buildCohabitationRequest(input);
    const raw = { activities: inputs.length === 1 ? [{ startTime: '14:00', endTime: '15:00', activity: '共同讨论', location: '咖啡馆', participantIds: [ids[0], ids[2]], description: '阿甲和阿丙讨论近期的问题。' }] : [] };
    if (inputs.length === 2) assert.deepEqual(input.events[0].participantIds, [ids[0], ids[2]]);
    assert.ok(request.messages.every(m => !m.content.includes('银色短发')), '居室规划不带外观');
    const result = validateCohabitationResult(raw, { ...request, ...input }); inside--; return result;
  };
  const result = await startScheduleBatch({ db, random: () => 0.99, planner, generator: generated }).promise;
  assert.equal(inputs.length, 2); assert.equal(result.events.length, 1);
  for (const id of [ids[0], ids[2]]) assert.equal(readTemplate(db, id).filter(a => a.sharedEventId).length, 1);
  const shared = readTemplate(db, ids[0]).find(a => a.sharedEventId);
  assert.equal(scheduleMomentCompanions(ids[0], shared)[0].otherId, ids[2]);
  const image = scheduleImageContext(db.prepare('SELECT * FROM characters WHERE id=?').get(ids[0]), shared);
  assert.equal(image.others[0].id, ids[2]); assert.equal(image.imageOptions.loras.length, 2);
  assert.ok(image.crossReference.includes('银色短发'));
  assert.equal(readCohabitationPlan(db).status, 'done');
  assert.equal(new Set(db.prepare("SELECT next_schedule_refresh_at FROM characters WHERE name!='default'").all().map(c => c.next_schedule_refresh_at)).size, 1);
});

test('失败不部分发布，恢复跳过已经完成的居室和个人草稿', async () => {
  const beforeTemplates = db.prepare('SELECT * FROM schedule_templates ORDER BY character_id').all();
  let planned = 0, generatedCount = 0;
  const planner = async () => { planned++; return []; };
  await assert.rejects(startScheduleBatch({ db, planner, generator: async (...args) => {
    if (++generatedCount === 2) throw new Error('测试中的网络中断');
    return generated(...args);
  } }).promise, /网络中断/);
  assert.deepEqual(db.prepare('SELECT * FROM schedule_templates ORDER BY character_id').all(), beforeTemplates);
  assert.equal(Object.keys(readCohabitationPlan(db).drafts).length, 1);
  let resumed = 0;
  await startScheduleBatch({ db, resume: true, planner: async () => { throw new Error('不应重复规划'); }, generator: async (...args) => { resumed++; return generated(...args); } }).promise;
  assert.equal(planned, 2); assert.equal(resumed, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cohabitation_plan').get().n, 1);
});

test('单人重排复用已发布共同约定，只重新计算同居者睡眠，刷新周期不变', async () => {
  const beforeCycle = db.prepare('SELECT * FROM schedule_refresh_cycle').get();
  const beforePlan = readCohabitationPlan(db);
  const character = db.prepare('SELECT * FROM characters WHERE id=?').get(ids[0]);
  const room = listResidences(db)[0];
  const result = await generateSchedule(character, '', { chat: async () => JSON.stringify({ activities: base(room, 1) }) });
  assert.ok(JSON.parse(result.schedule_json).some(a => a.participantIds?.includes(ids[1])));
  assert.deepEqual(db.prepare('SELECT * FROM schedule_refresh_cycle').get(), beforeCycle);
  assert.deepEqual(readCohabitationPlan(db), beforePlan);
  invalidateCache(ids[1]);
  const activity = getCurrentActivity(ids[1], new Date(new Date().setHours(1, 0, 0, 0)));
  assert.equal(activity.sleepEndTime, '08:00');
});

test('取消不保存已生成的个人日程，原模板继续可用', async () => {
  const beforeTemplates = db.prepare('SELECT * FROM schedule_templates ORDER BY character_id').all();
  const result = await startScheduleBatch({ db, planner: async () => [], generator: async (...args) => { cancelScheduleBatch(); return generated(...args); } }).promise;
  assert.equal(result.cancelled, true);
  assert.deepEqual(db.prepare('SELECT * FROM schedule_templates ORDER BY character_id').all(), beforeTemplates);
});

test('时间冲突、非法参与者被拒绝，单个居室重试沿用已占用事实', async () => {
  const characters = db.prepare("SELECT * FROM characters WHERE name!='default'").all();
  const room = listResidences(db)[1];
  const occupied = { startTime: '14:00', endTime: '15:00', participantIds: [ids[0], ids[2]], activity: '已约定' };
  const input = { room, characters, relationships: db.prepare('SELECT * FROM character_relationships').all(), events: [occupied], batchId: 'test' };
  let calls = 0;
  const result = await planResidence(input, { chat: async (messages) => {
    assert.ok(messages.some(m => m.content.includes('已约定')));
    if (++calls === 1) return JSON.stringify({ activities: [{ ...occupied, location: '街区', description: '冲突活动' }] });
    return '{"activities":[]}';
  } });
  assert.equal(calls, 2); assert.deepEqual(result, []);
});

test('规划加载全体室友short及全部方向关系，但不注入室外人格；动态资料不改变静态前缀', () => {
  const characters = db.prepare("SELECT * FROM characters WHERE name!='default'").all();
  const room = listResidences(db)[0];
  const relationships = db.prepare('SELECT * FROM character_relationships').all();
  const input = { room, characters, relationships, events: [], batchId: 'prefix-a', eligibleCharacterIds: ids.filter(id => id !== ids[1]) };
  const a = buildCohabitationRequest(input);
  assert.ok(a.messages.some(m => m.content.includes(characters[1].short_prompt)), '关闭自动日程的室友仍加载short');
  assert.ok(!a.messages.some(m => m.content.includes(characters[2].short_prompt)), '外部联系人不补人格');
  assert.ok(a.messages.some(m => m.content.includes('竞争对手')));
  assert.ok(!a.candidateIds.has(ids[1]), '不为关闭自动重排者安排新承诺');
  const b = buildCohabitationRequest({ ...input, direction: '新的方向', batchId: 'prefix-b', events: [{ startTime: '12:00', endTime: '13:00', participantIds: [ids[0], ids[2]], activity: '午餐', location: '食堂' }] });
  assert.deepEqual(a.messages.slice(0, a.lorebook.cacheBoundary.index + 1), b.messages.slice(0, b.lorebook.cacheBoundary.index + 1));
  assert.equal(a.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(a.messages.at(-1).role, 'user');
  const profile = buildPromptProfile(a.messages, a.lorebook);
  assert.deepEqual(profile.stableAnchors.afterCharacter, profile.anchors.afterCharacter);
  assert.equal(profile.cacheBoundary.index, a.messages.findIndex(m => m.content.includes('【本次共同生活资料】')) - 1);
});

test('共同活动最多三人，室外对象计入总人数，超限输出通过重试修正', async () => {
  const characters = db.prepare("SELECT * FROM characters WHERE name!='default'").all();
  const input = {
    room: { id: 999, name: '人数校验', memberIds: [ids[0]] }, characters,
    relationships: ids.slice(1).map(id => ({ from_character_id: ids[0], to_character_id: id, relationship_text: '同事' })),
    events: [], batchId: 'participant-limit',
  };
  const request = buildCohabitationRequest(input);
  const activity = { startTime: '14:00', endTime: '15:00', activity: '共同散步', location: '公园', participantIds: [...ids], description: '大家沿公园的小路散步，交流最近的见闻。' };
  const validate = participantIds => validateCohabitationResult({ activities: [{ ...activity, participantIds }] }, { ...input, ...request });
  assert.equal(validate(ids.slice(0, 2))[0].participantIds.length, 2);
  assert.equal(validate(ids.slice(0, 3))[0].participantIds.length, 3);
  assert.throws(() => validate(ids), /最多3人/);
  assert.throws(() => validate([ids[0]]), /参与/);
  let calls = 0;
  const result = await planResidence(input, { chat: async messages => {
    calls++;
    assert.match(messages.find(m => m.content.includes('字段约束')).content, /participantIds为2～3个/);
    if (calls === 1) return { activities: [activity] };
    assert.match(messages.at(-1).content, /上次输出未通过校验：.*最多3人/);
    return { activities: [{ ...activity, participantIds: ids.slice(0, 3) }] };
  } });
  assert.equal(calls, 2);
  assert.deepEqual(result[0].participantIds, ids.slice(0, 3));
});

test('共同计划使用朋友圈句式表达有向关系，保留室外关系原文和动态缓存边界', () => {
  const characters = db.prepare("SELECT * FROM characters WHERE name!='default'").all();
  const input = {
    room: { id: 999, name: '关系校验', memberIds: ids.slice(0, 2) }, characters, events: [], batchId: 'relation-text',
    relationships: [
      { from_character_id: ids[0], to_character_id: ids[2], relationship_text: '一直暗恋的学姐' },
      { from_character_id: ids[2], to_character_id: ids[0], relationship_text: '互相看不顺眼的同事' },
      { from_character_id: ids[0], to_character_id: ids[1], relationship_text: '从小一起长大的死党' },
      { from_character_id: ids[2], to_character_id: ids[3], relationship_text: '不涉及室友的关系' },
    ],
  };
  const request = buildCohabitationRequest(input);
  const dynamic = request.messages[request.lorebook.cacheBoundary.index + 1].content;
  assert.match(dynamic, /阿丙是阿甲的一直暗恋的学姐/);
  assert.match(dynamic, /阿甲是阿丙的互相看不顺眼的同事/);
  assert.match(dynamic, /阿乙是阿甲的从小一起长大的死党/);
  assert.ok(!dynamic.includes('不涉及室友的关系'));
  assert.ok(!dynamic.includes('"relationships":['));
  assert.ok(request.lorebook.history[0].content.includes('阿丙是阿甲的一直暗恋的学姐'));
  assert.ok(!request.messages.some(m => m.content.includes(characters[2].short_prompt)));
  const changed = buildCohabitationRequest({ ...input, relationships: [] });
  assert.deepEqual(request.messages.slice(0, request.lorebook.cacheBoundary.index + 1), changed.messages.slice(0, changed.lorebook.cacheBoundary.index + 1));
  assert.match(changed.messages.at(-2).content, /未提供关系。/);
});

test('模型重复输出已确认约定时去重，新增非法参与者仍拒绝', async () => {
  const room = listResidences(db)[1];
  const event = { sharedEventId: 'previous:1', startTime: '14:00', endTime: '15:00', participantIds: [ids[0], ids[2]], activity: '共同讨论', location: '咖啡馆', description: '阿甲和阿丙讨论近期的问题。' };
  const input = { room, characters: db.prepare("SELECT * FROM characters WHERE name!='default'").all(), relationships: db.prepare('SELECT * FROM character_relationships').all(), events: [event], batchId: 'duplicate' };
  let calls = 0;
  assert.deepEqual(await planResidence(input, { chat: async () => { calls++; return JSON.stringify({ activities: [event] }); } }), []);
  assert.equal(calls, 1);
  const request = buildCohabitationRequest(input);
  assert.throws(() => validateCohabitationResult({ activities: [{ ...event, startTime: '16:00', endTime: '17:00', participantIds: [ids[2], 999999] }] }, { ...input, ...request }), /参与/);
});

test('单人重排保留真实共同约定；到分钟边界立即更新同睡成员；关闭自动重排者保留已约活动', async () => {
  let planned = 0;
  const planner = input => {
    planned++;
    if (planned !== 1) return [];
    return validateCohabitationResult({ activities: [{ startTime: '14:00', endTime: '15:00', participantIds: [ids[0], ids[2]], activity: '共同讨论', location: '咖啡馆', description: '阿甲和阿丙讨论近期的问题。' }] }, { ...input, ...buildCohabitationRequest(input) });
  };
  await startScheduleBatch({ db, random: () => .99, planner, generator: generated }).promise;
  const beforePlan = readCohabitationPlan(db), beforeCycle = db.prepare('SELECT * FROM schedule_refresh_cycle').get();
  const original = readTemplate(db, ids[0]).find(a => a.sharedEventId);
  await generateSchedule(db.prepare('SELECT * FROM characters WHERE id=?').get(ids[0]), '', { chat: async () => JSON.stringify({ activities: base(listResidences(db)[0]) }) });
  snapshotTodaySchedule(ids[0]);
  assert.deepEqual(readTemplate(db, ids[0]).find(a => a.sharedEventId), original);
  assert.deepEqual(readCohabitationPlan(db), beforePlan);
  assert.deepEqual(db.prepare('SELECT * FROM schedule_refresh_cycle').get(), beforeCycle);
  const at = (h, m) => new Date(new Date().setHours(h, m, 0, 0));
  invalidateCache(ids[1]);
  assert.ok(getCurrentActivity(ids[1], at(5, 59)).participantIds.includes(ids[0]));
  assert.deepEqual(getCurrentActivity(ids[1], at(6, 0)).participantIds, [ids[1]]);
  assert.equal(getCurrentActivity(ids[1], at(6, 0)).sleepEndTime, '08:00');
  db.prepare('UPDATE characters SET schedule_enabled=0 WHERE id=?').run(ids[2]);
  const disabledAwake = readTemplate(db, ids[2]).filter(a => a.replyDelay !== -1);
  const called = [];
  await startScheduleBatch({ db, kind: 'automatic', planner: async () => [], generator: (...args) => { called.push(args[0].id); return generated(...args); } }).promise;
  assert.ok(!called.includes(ids[2]));
  assert.deepEqual(readTemplate(db, ids[2]).filter(a => a.replyDelay !== -1), disabledAwake);
  assert.equal(readTemplate(db, ids[0]).find(a => a.sharedEventId)?.sharedEventId, original.sharedEventId);
  db.prepare('UPDATE characters SET schedule_enabled=1 WHERE id=?').run(ids[2]);
});

test('整轮刷新只由全局到期触发，失败退避期间不重复消耗，关闭功能不触发', () => {
  const previous = config.features.schedule; config.features.schedule = true;
  let calls = 0;
  const start = args => { calls++; assert.equal(args.kind, 'automatic'); return { promise: Promise.resolve() }; };
  const now = new Date();
  try {
    db.prepare("UPDATE schedule_refresh_cycle SET next_refresh_at='2999-01-01 00:00:00',retry_at=NULL").run();
    assert.equal(maybeStartScheduledBatch({ db, now, start }), null);
    db.prepare("UPDATE schedule_refresh_cycle SET next_refresh_at='2000-01-01 00:00:00',retry_at='2999-01-01 00:00:00'").run();
    assert.equal(maybeStartScheduledBatch({ db, now, start }), null);
    db.prepare('UPDATE schedule_refresh_cycle SET retry_at=NULL').run();
    assert.ok(maybeStartScheduledBatch({ db, now, start }));
    config.features.schedule = false;
    assert.equal(maybeStartScheduledBatch({ db, now, start }), null);
    assert.equal(calls, 1);
  } finally { config.features.schedule = previous; }
});

test('生成中约定变化使旧草稿失效，继续安排会重建计划，避免反复重试旧冲突', async () => {
  let changed = false, roomCalls = 0;
  const planner = async () => { roomCalls++; return []; };
  await assert.rejects(startScheduleBatch({ db, direction: '保留这个方向', planner, generator: async (...args) => {
    if (!changed) {
      changed = true;
      const row = db.prepare('SELECT schedule_date,schedule_json FROM daily_schedules WHERE character_id=? ORDER BY schedule_date DESC LIMIT 1').get(ids[0]);
      const daily = JSON.parse(row.schedule_json);
      daily.find(a => a.replyDelay !== -1 && !a.sharedEventId).edited = 1;
      db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=? AND schedule_date=?').run(JSON.stringify(daily), ids[0], row.schedule_date);
    }
    return generated(...args);
  } }).promise, /约定发生变化/);
  const failed = readCohabitationPlan(db);
  assert.equal(failed.invalidated, true);
  await startScheduleBatch({ db, resume: true, planner, generator: generated }).promise;
  const completed = readCohabitationPlan(db);
  assert.notEqual(completed.id, failed.id);
  assert.equal(completed.direction, '保留这个方向');
  assert.equal(roomCalls, 4);
  assert.equal(completed.status, 'done');
});

test('重新启用一个角色仅初始化本人，复用已发布计划和全局周期', async () => {
  const plan = readCohabitationPlan(db), cycle = db.prepare('SELECT * FROM schedule_refresh_cycle').get();
  const previous = config.features.schedule; config.features.schedule = true;
  db.prepare('UPDATE characters SET next_schedule_refresh_at=NULL WHERE id=?').run(ids[0]);
  let count = 0;
  try {
    const task = maybeInitializeSchedule({ db, generator: character => {
      count++; assert.equal(character.id, ids[0]);
      return generateSchedule(character, '', { chat: async () => JSON.stringify({ activities: base(listResidences(db)[0]) }) });
    } });
    assert.ok(task);
    assert.equal(maybeInitializeSchedule({ db }), null, '初始化在途时不能再提交一次');
    assert.deepEqual(await task, { characterId: ids[0] });
    assert.equal(count, 1);
    assert.deepEqual(readCohabitationPlan(db), plan);
    assert.deepEqual(db.prepare('SELECT * FROM schedule_refresh_cycle').get(), cycle);
    assert.equal(db.prepare('SELECT next_schedule_refresh_at AS at FROM characters WHERE id=?').get(ids[0]).at, cycle.next_refresh_at);
  } finally { config.features.schedule = previous; }
});

test('单人独居且没有可邀约对象时直接留给个人日程，不浪费一次LLM调用', async () => {
  const character = db.prepare('SELECT * FROM characters WHERE id=?').get(ids[0]);
  const result = await planResidence({ room: { id: 999, name: '独居', memberIds: [character.id] }, characters: [character], relationships: [], events: [], batchId: 'solo' }, {
    chat: async () => { throw new Error('没有共同活动候选，不应调用LLM'); },
  });
  assert.deepEqual(result, []);
});

test('居室待生效状态跨草稿保留，只有成功发布使用的版本才能消除提示', async () => {
  const run = extra => startScheduleBatch({ db, planner: async () => [], generator: generated, ...extra }).promise;
  await run();
  assert.equal(residenceState(db).pendingChanges, false, '随机居室顺序不算修改');
  const [first, second] = listResidences(db);
  const rename = name => db.prepare('UPDATE cohabitation_rooms SET name=? WHERE id=?').run(name, first.id);
  rename('新门牌'); assert.equal(residenceState(db).pendingChanges, true);
  rename(first.name); assert.equal(residenceState(db).pendingChanges, false, '改回原名自动取消提示');
  db.prepare('UPDATE cohabitation_members SET room_id=? WHERE character_id=?').run(second.id, first.memberIds[0]);
  assert.equal(residenceState(db).pendingChanges, true);
  db.prepare('UPDATE cohabitation_members SET room_id=? WHERE character_id=?').run(first.id, first.memberIds[0]);
  assert.equal(residenceState(db).pendingChanges, false);
  const empty = db.prepare("INSERT INTO cohabitation_rooms(name) VALUES('新增空房')").run().lastInsertRowid;
  assert.equal(residenceState(db).pendingChanges, true);
  db.prepare('DELETE FROM cohabitation_rooms WHERE id=?').run(empty);
  assert.equal(residenceState(db).pendingChanges, false);
  // 模拟升级前只有成功计划、没有独立生效快照的数据库。
  db.prepare('UPDATE schedule_refresh_cycle SET applied_residences_json=NULL').run();
  assert.equal(residenceState(db).pendingChanges, false);
  await assert.rejects(run({ generator: async () => { throw new Error('验收失败'); } }), /验收失败/);
  assert.equal(residenceState(db).pendingChanges, false, '失败草稿覆盖旧计划后仍保留原生效基准');
  rename('等待生效');
  assert.equal(residenceState(db).pendingChanges, true);
  await assert.rejects(run({ generator: async () => { throw new Error('验收失败'); } }), /验收失败/);
  assert.equal(residenceState(db).pendingChanges, true);
  await run({ generator: async (...args) => { cancelScheduleBatch(); return generated(...args); } });
  assert.equal(residenceState(db).pendingChanges, true, '取消仍保留提示');
  await generateSchedule(db.prepare('SELECT * FROM characters WHERE id=?').get(ids[0]), '', { chat: async () => JSON.stringify({ activities: base(first) }) });
  assert.equal(residenceState(db).pendingChanges, true, '单人重排不清除提示');
  let edited = false;
  await run({ generator: async (...args) => {
    assert.equal(residenceState(db).pendingChanges, true, '生成中不能提前视为生效');
    if (!edited) { rename('生成期间再次修改'); edited = true; }
    return generated(...args);
  } });
  assert.equal(residenceState(db).pendingChanges, true, '生成过程中追加的修改仍需等待下一轮');
  await run();
  assert.equal(residenceState(db).pendingChanges, false);
});
