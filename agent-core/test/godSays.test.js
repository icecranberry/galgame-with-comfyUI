import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository, effectKey, ANGEL_PERSONA } from '../src/services/godSays/repository.js';
import { createAngelPersonaService } from '../src/services/godSays/angelPersona.js';
import { normalizePersonalities } from '../src/services/godSays/angelPersonalities.js';
import { createWorldEventService, worldEventContext } from '../src/services/godSays/worldEvents.js';
import { createGodHistory } from '../src/services/godSays/history.js';
import { createGodTools, validateToolArgs, GOD_TOOLS } from '../src/services/godSays/tools.js';
import { runGodAgent } from '../src/services/godSays/agent.js';
import { buildAgentRequest, readAgentResponse } from '../src/llm/agentStream.js';

function fixture(t, time = '2026-10-30T15:59:00.000Z') {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,short_prompt TEXT,base_prompt TEXT,schedule_enabled INTEGER);
    CREATE TABLE group_chats(id INTEGER PRIMARY KEY,name TEXT,topic TEXT);
    CREATE TABLE group_members(id INTEGER PRIMARY KEY,group_id INTEGER,character_id INTEGER);
    CREATE TABLE moment_posts(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,content TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY,raw_id INTEGER,content TEXT);
    INSERT INTO characters VALUES (1,'a','阿晴','温柔','温柔',1),(2,'b','小雨','好奇','好奇',1),(3,'c','明月','安静','安静',1);
    INSERT INTO group_chats VALUES (1,'邻里茶话会','日常'),(2,'晚风','闲聊');
    INSERT INTO group_members VALUES (1,1,1),(2,1,2),(3,2,3);`);
  migrateGodSaysSchema(db);
  migrateGodSaysSchema(db);
  let clock = new Date(time);
  const repo = createGodRepository(db, { now: () => clock });
  t.after(() => db.close());
  return { db, repo, setTime: value => { clock = new Date(value); } };
}

test('deleting one full turn removes replay and memories, preserves other turns and committed world events', async t => {
  const { db, repo } = fixture(t);
  const first = repo.start('delete-first', '需要删除的秘密').run;
  repo.message(first, 'assistant', '旧回复', { reasoning: '旧思考' });
  repo.finish(first.id, 'completed');
  const second = repo.start('delete-second', '保留的下一轮').run;
  assert.throws(() => repo.deleteTurn(first.id), { status: 409 });
  repo.message(second, 'assistant', '仍然保留');
  repo.finish(second.id, 'completed');
  db.prepare("INSERT INTO god_world_events(effect_key,run_id,title,fact,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .run('committed-event', first.id, '彩虹', '天空已有彩虹', repo.timestamp(), repo.timestamp());
  db.prepare("UPDATE god_sessions SET summary='旧摘要',memories_json='[{}]',context_summary='旧压缩记忆',context_last_message=100 WHERE id=?").run(first.session_id);
  assert.equal(repo.deleteTurn(first.id).ok, true);
  assert.deepEqual(repo.snapshot(first.session_id).runs.map(r => r.id), [second.id]);
  for (const table of ['god_messages', 'god_run_events', 'god_tool_calls']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE run_id=?`).get(first.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_world_events').get().n, 1);
  assert.throws(() => repo.start('delete-first', '需要删除的秘密'), { status: 409 });
  assert.equal(repo.deleteTurn(first.id).ok, true, 'repeat deletion is harmless');
  const session = repo.snapshot(first.session_id).session;
  assert.equal(session.summary, ''); assert.equal(session.memories_json, '[]'); assert.equal(session.context_summary, '');
  const history = await createGodHistory(repo).contextHistory(first.session_id);
  assert.deepEqual(history.messages.map(m => m.content), ['保留的下一轮', '仍然保留']);
  db.prepare("UPDATE god_sessions SET summary_status='running' WHERE id=?").run(first.session_id);
  assert.equal(repo.deleteTurn(second.id).ok, true, 'legacy summary status must not block deletion');
  assert.throws(() => repo.deleteTurn('missing'), { status: 404 });
});

test('editing angel profile persists independently, validates input and refreshes only changed persona schedules', t => {
  const { db, repo } = fixture(t);
  repo.ensureAngel();
  const residents = db.prepare('SELECT * FROM characters').all();
  const input = { display_name: '星羽', persona: '完整的自定义天使人设', emotion_baseline: { valence: 0.6, arousal: 0.4, dominance: 0.5 } };
  assert.equal(repo.updateAngel(input).display_name, '星羽');
  assert.equal(createGodRepository(db).ensureAngel().persona, input.persona);
  db.prepare("UPDATE god_angel SET schedule_generated_at='today' WHERE id=1").run();
  repo.updateAngel({ ...input, display_name: '天使' });
  assert.equal(repo.ensureAngel().schedule_generated_at, 'today');
  repo.updateAngel({ ...input, persona: '修改后的完整人设' });
  assert.equal(repo.ensureAngel().schedule_generated_at, null);
  assert.deepEqual(db.prepare('SELECT * FROM characters').all(), residents);
  for (const bad of [{ ...input, persona: '' }, { ...input, display_name: 'x'.repeat(41) }, { ...input, emotion_baseline: { valence: 3 } }, null]) assert.throws(() => repo.updateAngel(bad), { status: 400 });
  assert.equal(repo.ensureAngel().persona, '修改后的完整人设');
});

test('upgrading early god tables adds missing columns without losing conversations or events', t => {
  const { db, repo } = fixture(t);
  const run = repo.start('legacy-upgrade', '今天过得怎么样？').run;
  repo.message(run, 'assistant', '我在云庭等您。');
  repo.finish(run.id, 'completed');
  for (const column of ['schedule_json', 'context_summary', 'context_last_message', 'summary_attempts']) db.exec(`ALTER TABLE god_sessions DROP COLUMN ${column}`);
  db.exec('ALTER TABLE god_runs DROP COLUMN deleted_at');
  db.exec('ALTER TABLE god_world_events DROP COLUMN kind');
  for (const column of ['persona_generated_at', 'persona_error', 'emotion_baseline']) db.exec(`ALTER TABLE god_angel DROP COLUMN ${column}`);
  migrateGodSaysSchema(db);
  migrateGodSaysSchema(db);
  const session = repo.snapshot().session;
  assert.equal(session.schedule_json, '[]');
  assert.equal(session.context_summary, '');
  assert.equal(session.summary_attempts, 0);
  assert.equal(session.context_last_message, 0);
  assert.equal(repo.snapshot().messages.length, 2);
  assert.equal(repo.snapshot().runs[0].status, 'completed');
  assert.ok(db.prepare('PRAGMA table_info(god_world_events)').all().some(c => c.name === 'kind'));
  assert.equal(repo.ensureAngel().persona_generated_at, null);
  assert.equal(repo.ensureAngel().persona, ANGEL_PERSONA);
  assert.doesNotThrow(() => db.prepare('UPDATE god_sessions SET schedule_json=? WHERE id=?').run('[{"activity":"整理星图"}]', session.id));
});

const generatedPersona = `你是天使。\n## 你的身份\n你守着云庭的信件，记得每封信的折角和每个愿望的来处。\n## 你的性格\n你说话轻快而认真，喜欢先听完再回答；嘴上抱怨星图太乱，还是会把每条线都理好。遇到不知道的事情会坦白承认。\n## 你的好恶\n你喜欢热茶和日出，讨厌空口许诺，也怕错过神的呼唤。\n## 你的外观\n你有浅金短发、白色羽翼和一圈柔光的光环，衣袖边别着收信用的小银夹。`;
test('angel persona generates once without emotion baseline, survives reload and invalidates only the current schedule template', async t => {
  const { db, repo } = fixture(t);
  repo.ensureAngel();
  db.prepare("UPDATE god_angel SET summoned_at='2026-01-01T00:00:00.000Z' WHERE id=1").run();
  const session = repo.today();
  db.prepare("UPDATE god_angel SET schedule_json='[{}]',schedule_generated_at='2026-10-30',emotion_baseline='legacy' WHERE id=1").run();
  db.prepare("UPDATE god_sessions SET schedule_json='[{}]' WHERE id=?").run(session.id);
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const requests = [];
  const ensure = createAngelPersonaService(repo, async options => { requests.push(options); await ready; return { basePrompt: generatedPersona, emotionBaseline: '{"valence":0.5}' }; });
  const first = ensure(); const second = ensure();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].personalities, ['gentle']);
  assert.equal(requests[0].custom, '');
  assert.equal(requests[0].extraContext, undefined);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.persona, generatedPersona); assert.equal(b.persona, generatedPersona);
  assert.equal(a.emotion_baseline, null);
  assert.equal(a.schedule_generated_at, null);
  assert.equal(a.schedule_json, '[{}]');
  assert.equal(db.prepare('SELECT schedule_json FROM god_sessions WHERE id=?').get(session.id).schedule_json, '[{}]');
  const reloaded = createAngelPersonaService(repo, async () => assert.fail('saved persona must not regenerate'));
  assert.equal((await reloaded()).persona, generatedPersona);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM characters').get().n, 3, 'system angel is never recruited as a neighbor');
});

test('angel persona failure keeps the seed, rejects incomplete output and retries after cooldown', async t => {
  const { db, repo, setTime } = fixture(t);
  repo.ensureAngel();
  db.prepare("UPDATE god_angel SET summoned_at='2026-01-01T00:00:00.000Z' WHERE id=1").run();
  let attempts = 0;
  const ensure = createAngelPersonaService(repo, async () => {
    attempts++;
    return { basePrompt: attempts === 1 ? '不完整' : generatedPersona };
  });
  await assert.rejects(ensure(), /未返回完整/);
  assert.equal(repo.ensureAngel().persona, ANGEL_PERSONA);
  assert.equal(repo.ensureAngel().persona_generated_at, null);
  assert.match(repo.ensureAngel().persona_error, /未返回完整/);
  await assert.rejects(ensure(), /暂未生成/);
  assert.equal(attempts, 1);
  setTime('2026-10-30T16:05:00.000Z');
  assert.equal((await ensure()).persona, generatedPersona);
  assert.equal(repo.ensureAngel().persona_error, null);
});

test('existing custom angel persona is preserved without generation', async t => {
  const { db, repo } = fixture(t);
  repo.ensureAngel();
  db.prepare('UPDATE god_angel SET persona=? WHERE id=1').run(generatedPersona);
  const ensure = createAngelPersonaService(repo, async () => assert.fail('custom persona must not be overwritten'));
  assert.equal((await ensure()).persona, generatedPersona);
  assert.ok(repo.ensureAngel().persona_generated_at);
});

test('summon stores selected personalities and forces persona regeneration', async t => {
  const { db, repo } = fixture(t);
  repo.ensureAngel();
  db.prepare('UPDATE god_angel SET persona=?,persona_generated_at=? WHERE id=1').run(generatedPersona, '2026-01-01T00:00:00.000Z');
  const requests = [];
  const ensure = createAngelPersonaService(repo, async options => {
    requests.push(options);
    return { basePrompt: generatedPersona.replace('你说话轻快而认真', '你说话傲娇又嘴硬、还爱装作不在意'), emotionBaseline: '{"valence":0.5}' };
  });
  const angel = await ensure({ force: true, personalities: ['tsundere', 'clumsy'] });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].personalities, ['tsundere', 'clumsy']);
  assert.deepEqual(JSON.parse(db.prepare('SELECT personalities_json FROM god_angel WHERE id=1').get().personalities_json), ['tsundere', 'clumsy']);
  assert.equal(angel.summoned, true);
  assert.deepEqual(normalizePersonalities([]), ['gentle']);
  assert.deepEqual(normalizePersonalities(['ghost', 'tsundere']), ['tsundere']);
});

test('angel persona merges the god custom requirement', async t => {
  const { db, repo } = fixture(t);
  repo.ensureAngel();
  db.prepare('UPDATE god_angel SET persona=?,persona_generated_at=? WHERE id=1').run(generatedPersona, '2026-01-01T00:00:00.000Z');
  const requests = [];
  const ensure = createAngelPersonaService(repo, async options => { requests.push(options); return { basePrompt: generatedPersona }; });
  await ensure({ force: true, personalities: ['gentle'], custom: '希望她戴金色发饰，说话轻声细语' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].custom, '希望她戴金色发饰，说话轻声细语');
});

test('resummon defers saving a new same-day session until its first message', t => {
  const { db, repo } = fixture(t);
  repo.ensureAngel();
  const first = repo.snapshot().session;
  assert.equal(first.seq, 0);
  // 空对话：重新召唤仍是未保存的草稿。
  assert.equal(repo.summonSession().id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 0);
  // 当天已有对话：重新召唤另开一条同日新会话
  const { run } = repo.start('resummon-001', '今天的第一句');
  repo.message(run, 'assistant', '好');
  repo.finish(run.id, 'completed');
  const next = repo.summonSession();
  assert.equal(next.id, null);
  assert.equal(next.day, first.day);
  assert.equal(next.seq, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 1);
  assert.equal(repo.snapshot().session.id, null);
  assert.equal(repo.summonSession().seq, 1, 'repeated summons do not create more sessions');
  assert.equal(repo.snapshot(run.session_id).current, false);
  const second = repo.start('resummon-002', '新天使的第一句').run;
  assert.notEqual(second.session_id, run.session_id);
  assert.equal(repo.snapshot().session.seq, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 2);
});

test('reading empty days does not save history; legacy empty archives are excluded and cleaned', async t => {
  const { repo, db, setTime } = fixture(t);
  const empty = repo.snapshot();
  assert.equal(empty.session.id, null);
  assert.equal(empty.current, true);
  assert.deepEqual(empty.runs, []);
  repo.snapshot();
  repo.summonSession();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 0);
  const legacy = repo.today();
  db.prepare("UPDATE god_sessions SET summary='当天没有对话。',summary_status='done' WHERE id=?").run(legacy.id);
  setTime('2026-10-31T02:00:00Z');
  assert.deepEqual(repo.listSessions(), []);
  assert.equal(repo.snapshot().session.id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 0);
  const run = repo.start('first-real-message', '你好').run;
  assert.equal(repo.snapshot().session.id, run.session_id);
  assert.deepEqual(repo.listSessions().map(s => s.preview), ['你好']);
  repo.finish(run.id, 'failed');
  assert.equal(repo.listSessions().length, 1, 'a failed reply still preserves the user message');
});

test('deleting the final turn removes history and skips archiving without losing idempotency', async t => {
  const { repo, db, setTime } = fixture(t);
  const run = repo.start('delete-only-message', '删除的对话').run;
  repo.finish(run.id, 'completed');
  repo.deleteTurn(run.id);
  assert.deepEqual(repo.listSessions(), []);
  setTime('2026-10-31T02:00:00Z');
  assert.equal(db.prepare('SELECT summary FROM god_sessions WHERE id=?').get(run.session_id).summary, '');
  assert.throws(() => repo.start('delete-only-message', '删除的对话'), { status: 409 });
});

async function* chunks(values) { yield* values; }
const delta = (data, finish_reason = null) => ({ choices: [{ delta: data, finish_reason }] });

test('sessions survive midnight with singleton angel, idempotent sends and conflict rejection', async t => {
  const { db, repo, setTime } = fixture(t);
  assert.equal(repo.ensureAngel().id, repo.ensureAngel().id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM characters').get().n, 3, 'angel never enters ordinary character pool');
  const { run } = repo.start('request-001', '彩虹');
  assert.equal(repo.start('request-001', '彩虹').duplicate, true);
  assert.throws(() => repo.start('request-001', '别的消息'), /另一条/);
  assert.throws(() => repo.start('request-002', '你好'), /仍在回应/);
  setTime('2026-10-30T16:01:00.000Z');
  assert.equal(repo.today().id, run.session_id);
  assert.throws(() => repo.start('during-rollover', '等待回复'), /仍在回应/);
  repo.message(run, 'assistant', '旧日回复');
  repo.finish(run.id, 'completed');
  const next = repo.start('request-003', '新的一天').run;
  assert.equal(run.session_id, next.session_id);
  const late = repo.message(run, 'assistant', '旧日回复');
  assert.equal(late.session_id, run.session_id);
  assert.equal(repo.today().day, '2026-10-30', 'creation date is preserved');
  repo.finish(next.id, 'completed');
  assert.equal(createGodRepository(db, { now: () => new Date('2026-11-02T00:00:00Z') }).snapshot().session.id, run.session_id, 'restart also retains the active conversation');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 1);
});

test('world targets are frozen, busy groups queue, retries only failed recipients, and shared facts obey scope/expiry', async t => {
  const { repo, db, setTime } = fixture(t);
  let busy = true; let fail = true;
  const posts = []; const groups = [];
  const world = createWorldEventService(repo, { random: () => 0.4, groupBusy: () => busy,
    publishMoment: async id => { posts.push(id); if (fail) throw new Error('临时失败'); return { id: 9 }; },
    discussGroup: async id => { groups.push(id); return { id: 20 }; },
  });
  const { run } = repo.start('world-test', '彩虹');
  const args = { title: '彩虹', fact: '所有人都看到巨大的彩虹', moment_count: 1, group_count: 1 };
  const event = world.create(args, { runId: run.id, effectKey: 'world-1' });
  assert.deepEqual(world.create(args, { runId: run.id, effectKey: 'world-1' }).deliveries, event.deliveries);
  assert.match(worldEventContext(db, [3], repo.now()), /巨大的彩虹/, 'not selected to post still witnesses global event');
  await world.tick();
  assert.equal(world.list(event.id)[0].deliveries.find(d => d.kind === 'group').status, 'pending');
  busy = false; fail = false;
  await world.tick();
  world.retry(event.id); await world.tick();
  assert.equal(posts.length, 2); assert.equal(groups.length, 1, 'successful group is never repeated on retry');
  assert.ok(world.list(event.id)[0].deliveries.every(d => d.status === 'done'));
  const scoped = world.create({ title: '私人的光', fact: '仅阿晴看见光', character_ids: [1], moment_count: 0, group_count: 0 }, { runId: run.id, effectKey: 'world-2' });
  assert.doesNotMatch(worldEventContext(db, [2], repo.now()), /仅阿晴看见光/);
  assert.match(worldEventContext(db, [1], repo.now()), /仅阿晴看见光/);
  world.create({ title: '光散去', fact: '光消失', supersedes_id: scoped.id, moment_count: 0, group_count: 0 }, { runId: run.id, effectKey: 'world-3' });
  assert.equal(world.list(scoped.id)[0].active, false);
  world.queue('group', 1, '讨论咖啡', { runId: run.id, effectKey: 'instruction-1' });
  assert.doesNotMatch(worldEventContext(db, [1], repo.now()), /讨论咖啡/, 'commands must not become physical facts');
  setTime('2026-10-31T03:00:00.000Z');
  assert.equal(world.list(event.id)[0].active, false);
  assert.match(worldEventContext(db, [3], repo.now()), /已经结束/);
});

test('delivery recovery reconciles committed side effects without reposting', t => {
  const { repo, db } = fixture(t);
  const world = createWorldEventService(repo);
  const { run } = repo.start('recover-world', '彩虹');
  const event = world.create({ title: '彩虹', fact: '彩虹', moment_count: 1, group_count: 1 }, { runId: run.id, effectKey: 'r1' });
  db.prepare("UPDATE god_world_deliveries SET status='running'").run();
  const post = event.deliveries.find(d => d.kind === 'moment');
  const group = event.deliveries.find(d => d.kind === 'group');
  db.prepare("INSERT INTO moment_posts(id,status,god_delivery_key) VALUES (1,'done',?)").run(`god:delivery:${post.id}`);
  db.prepare("INSERT INTO raw_messages(id,content,god_delivery_key) VALUES (1,'部分回应',?)").run(`god:delivery:${group.id}`);
  db.exec("INSERT INTO messages VALUES (1,1,'我看见了！')");
  world.recover();
  assert.ok(world.list(event.id)[0].deliveries.every(d => d.status === 'done'));
  assert.equal(world.list(event.id)[0].deliveries.find(d => d.kind === 'group').result.partial, true);
});

test('full history ignores legacy compaction and continues across midnight', async t => {
  const { repo, db, setTime } = fixture(t);
  const memory = createGodHistory(repo);
  const expected = [];
  let sessionId;
  for (let i = 0; i < 5; i++) {
    const input = `第${i}轮：${'长对话'.repeat(5000)}`;
    const run = repo.start(`full-day-${i}`, input).run;
    sessionId = run.session_id;
    expected.push({ role: 'user', content: input });
    repo.message(run, 'assistant', `答复${i}`);
    expected.push({ role: 'assistant', content: `答复${i}` });
    repo.finish(run.id, 'completed');
  }
  assert.deepEqual((await memory.contextHistory(sessionId)).messages, expected);
  db.prepare("UPDATE god_sessions SET context_summary='旧版压缩摘要',context_last_message=99999 WHERE id=?").run(sessionId);
  assert.deepEqual(await memory.contextHistory(sessionId), { messages: expected });
  setTime('2026-10-30T16:01:00.000Z');
  assert.equal(repo.today({ persist: false }).id, sessionId);
  const next = repo.start('new-day-full-history', '新的一天').run;
  assert.equal(next.session_id, sessionId);
  assert.deepEqual((await memory.contextHistory(sessionId)).messages, [...expected, { role: 'user', content: '新的一天' }]);
});



test('native stream assembles fragmented tool calls and reasoning; unfinished/invalid JSON cannot execute', async () => {
  const input = [delta({ reasoning_content: '先查询。' }), delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_character', arguments: '{"character_' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: 'id":1}' } }] }, 'tool_calls')];
  const events = []; for await (const e of readAgentResponse(chunks(input))) events.push(e);
  assert.equal(events[0].type, 'reasoning_delta');
  assert.deepEqual(JSON.parse(events.at(-1).message.tool_calls[0].function.arguments), { character_id: 1 });
  assert.equal(events.at(-1).message.reasoning_content, '先查询。');
  await assert.rejects(async () => { for await (const e of readAgentResponse(chunks(input.slice(0, 2)))) void e; }, /提前结束/);
  await assert.rejects(async () => { for await (const e of readAgentResponse(chunks([delta({ tool_calls: [{ index: 0, id: 'bad', function: { name: 'x', arguments: '{' } }] }, 'tool_calls')]))) void e; }, /不完整/);
});

test('thinking is mandatory after overrides and real native tool roles are preserved', () => {
  const messages = [{ role: 'user', content: '你好' }, { role: 'assistant', content: '', tool_calls: [] }, { role: 'tool', tool_call_id: 't', content: '{}' }];
  for (const model of ['deepseek-chat', 'qwen3', 'gpt-5', 'gemini-2.5-pro']) {
    const params = buildAgentRequest(messages, GOD_TOOLS, { model, maxTokens: 8192, thinkingMode: 'disabled', extraBody: { thinking: { type: 'disabled' }, reasoning_effort: 'none', enable_thinking: false, messages: [], stream: false, tools: [] } });
    assert.equal(params.stream, true); assert.equal(params.messages, messages); assert.equal(params.tools, GOD_TOOLS);
    assert.equal(params.reasoning_effort, 'high'); assert.equal(params.enable_thinking, true);
    if (params.thinking) assert.equal(params.thinking.type, 'enabled');
  }
  assert.equal(effectKey('r', 'x', { a: 1, b: 2 }), effectKey('r', 'x', { b: 2, a: 1 }));
  const def = GOD_TOOLS.find(t => t.function.name === 'create_world_event');
  assert.throws(() => validateToolArgs(def.function.parameters, { title: 'x', fact: 'y', group_count: 999 }), /有效整数/);
  assert.throws(() => validateToolArgs(def.function.parameters, { title: 'x', fact: 'y', endpoint: '/any' }), /不支持/);
});

test('agent uses tool results in next turn, effect ledger deduplicates identical calls, and emits replayable events', async t => {
  const { repo, db } = fixture(t);
  let actions = 0;
  const world = createWorldEventService(repo);
  const tools = createGodTools(repo, world, { localDate: () => '2026-10-30', scheduleEnabled: () => true, changeSchedule: () => { actions++; return { ok: true }; } });
  const { run } = repo.start('agent-test', '安排日程');
  const args = { character_id: 1, date: '2026-10-30', start_time: '19:00', end_time: '20:00', activity: '咖啡', location: '咖啡馆', description: '去喝咖啡' };
  let turns = 0;
  async function* stream(messages) {
    if (turns++ === 0) yield { type: 'assistant_end', message: { role: 'assistant', content: '', reasoning_content: '检查安排', tool_calls: [1, 2].map(i => ({ id: `tool${i}`, type: 'function', function: { name: 'set_schedule', arguments: JSON.stringify(args) } })) } };
    else { assert.equal(messages.filter(m => m.role === 'tool').length, 2); yield { type: 'text_delta', text: '已安排。' }; yield { type: 'assistant_end', message: { role: 'assistant', content: '已安排。' } }; }
  }
  await runGodAgent(run, { repo, tools, stream, prepare: async () => ({ messages: [{ role: 'user', content: run.input }] }) });
    assert.equal(actions, 0, '日程修改必须等待确认'); assert.equal(turns, 2);
    const drafts=tools.changes.list(run.session_id);
    assert.equal(drafts.length,1,'相同调用只创建一份草稿');
    await tools.changes.decide(drafts[0].id,drafts[0].version,'approve');
    assert.equal(actions,1);
  assert.equal(db.prepare('SELECT status FROM god_runs WHERE id=?').get(run.id).status, 'completed');
  assert.ok(db.prepare('SELECT seq FROM god_run_events WHERE run_id=?').all(run.id).length >= 8);
  const history = await createGodHistory(repo).contextHistory(run.session_id);
  assert.deepEqual(history.messages.map(m => m.role), ['user', 'assistant', 'tool', 'tool', 'assistant']);
  assert.equal(history.messages[1].reasoning_content, '检查安排');
});

test('cancel during preparation exits promptly; cancel between tools records skipped results and avoids later side effects', async t => {
  const { repo, db } = fixture(t);
  const first = repo.start('cancel-prepare', '你好').run;
  const controller = new AbortController();
  const pending = runGodAgent(first, { repo, tools: {}, stream: () => {}, prepare: () => new Promise(() => {}), signal: controller.signal });
  controller.abort(); await pending;
  assert.equal(db.prepare('SELECT status FROM god_runs WHERE id=?').get(first.id).status, 'cancelled');
  const second = repo.start('cancel-tools', '两件事').run;
  const abort = new AbortController(); let actions = 0;
  await runGodAgent(second, { repo, signal: abort.signal, prepare: async () => ({ messages: [] }),
    tools: { definitions: [], execute: async () => { actions++; abort.abort(); return { ok: true }; } },
    stream: async function* () { yield { type: 'assistant_end', message: { role: 'assistant', content: '', tool_calls: ['a', 'b'].map(id => ({ id, type: 'function', function: { name: 'work', arguments: '{}' } })) } }; },
  });
  assert.equal(actions, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM god_messages WHERE run_id=? AND role='tool'").get(second.id).n, 2);
});

test('restart history omits incomplete tool batches and their orphan results', async t => {
  const { repo } = fixture(t);
  const run = repo.start('interrupted-tools', '两项工作').run;
  repo.message(run, 'assistant', '', { tool_calls: ['one', 'two'].map(id => ({ id, type: 'function', function: { name: 'inspect_neighbors', arguments: '{}' } })) });
  repo.message(run, 'tool', '{"ok":true}', { tool_call_id: 'one' });
  repo.recover();
  const next = repo.start('after-restart', '继续').run;
  const history = await createGodHistory(repo).contextHistory(next.session_id);
  assert.deepEqual(history.messages.map(m => m.role), ['user', 'user']);
});

test('read tools observe fresh state while committed encounter receipts recover as successful', async t => {
  const { repo, db } = fixture(t);
  const run = repo.start('fresh-read-test', '看看').run;
  const tools = createGodTools(repo, createWorldEventService(repo), { localDate: () => repo.day() });
  const call = id => ({ id, function: { name: 'inspect_neighbors', arguments: '{}' } });
  assert.equal((await tools.execute(call('a'), run.id, 0)).value.characters.length, 3);
  db.prepare("INSERT INTO characters(id,name,display_name) VALUES (4,'d','晨星')").run();
  assert.equal((await tools.execute(call('b'), run.id, 1)).value.characters.length, 4);
  db.prepare("INSERT INTO god_tool_calls(id,run_id,effect_key,name,args_json,status,result_json,created_at) VALUES ('saved',?,'saved','create_encounter','{}','running',?,?)").run(run.id, JSON.stringify({ id: 12, status: 'opened', href: '/events?event=12' }), repo.timestamp());
  repo.recover();
  const receipt = db.prepare("SELECT status,result_json FROM god_tool_calls WHERE id='saved'").get();
  assert.equal(receipt.status, 'done');
  assert.deepEqual(JSON.parse(receipt.result_json), { ok: true, value: { id: 12, status: 'opened', href: '/events?event=12' } });
});





test('new conversations reuse a single draft and isolate history without summary work', async t => {
  const { repo, db, setTime } = fixture(t);
  assert.equal(repo.newSession().id, null);
  const first = repo.start('new-first', '旧对话内容').run;
  assert.throws(() => repo.newSession(), { status: 409 });
  repo.finish(first.id, 'completed');
  db.prepare("UPDATE god_sessions SET summary='旧记忆',summary_status='running',memories_json='[]' WHERE id=?").run(first.session_id);
  const draft = repo.newSession();
  assert.equal(draft.id, null);
  for (let i = 0; i < 5; i++) assert.deepEqual(repo.newSession(), draft);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 1);
  assert.equal(repo.snapshot(first.session_id).current, false);
  const second = repo.start('new-second', '新对话内容').run;
  assert.notEqual(second.session_id, first.session_id);
  assert.equal(repo.snapshot().session.seq, 1);
  assert.deepEqual((await createGodHistory(repo).contextHistory(second.session_id)).messages, [{ role: 'user', content: '新对话内容' }]);
  repo.finish(second.id, 'completed');
  setTime('2026-10-31T02:00:00Z');
  assert.equal(repo.snapshot().session.id, second.session_id, 'midnight retains the current conversation');
  assert.equal(repo.newSession().id, null);
  const third = repo.start('new-next-day', '手动开启次日新对话').run;
  assert.notEqual(third.session_id, second.session_id);
  assert.equal(repo.snapshot().session.day, '2026-10-31');
  assert.equal(db.prepare('SELECT summary_attempts FROM god_sessions WHERE id=?').get(first.session_id).summary_attempts, 0);
  assert.equal(GOD_TOOLS.some(t => t.function.name === 'recall_memory'), false);
});

test('same-day conversation pagination does not skip conversations beyond sixty', t => {
  const { repo } = fixture(t);
  for (let i = 0; i < 65; i++) {
    const run = repo.start(`page-${i}`, `对话${i}`).run;
    repo.finish(run.id, 'completed');
    repo.newSession();
  }
  const first = repo.listSessions();
  const last = first.at(-1);
  const second = repo.listSessions(last.day, last.id);
  assert.equal(first.length, 60);
  assert.equal(second.length, 5);
  assert.equal(new Set([...first, ...second].map(s => s.id)).size, 65);
});


test('all conversations remain writable across dates and continuation stays in the selected history', async t => {
  const { repo, db, setTime } = fixture(t);
  const first = repo.start('resume-first', '第一段对话').run;
  repo.message(first, 'assistant', '第一段回复');
  repo.finish(first.id, 'completed');
  repo.newSession();
  const second = repo.start('resume-second', '第二段对话').run;
  repo.finish(second.id, 'completed');
  const oldState = repo.snapshot(first.session_id);
  assert.equal(oldState.current, false);
  assert.equal(oldState.writable, true);
  assert.equal(oldState.session.status, 'archived');
  const resumed = repo.start('resume-followup', '接着第一段说', [], first.session_id).run;
  assert.equal(resumed.session_id, first.session_id);
  assert.throws(() => repo.start('concurrent-followup', '另一段', [], second.session_id), { status: 409 });
  repo.finish(resumed.id, 'completed');
  assert.equal(repo.start('resume-followup', '接着第一段说', [], first.session_id).duplicate, true);
  assert.throws(() => repo.start('resume-followup', '接着第一段说', [], second.session_id), { status: 409 });
  assert.deepEqual((await createGodHistory(repo).contextHistory(first.session_id)).messages.map(m => m.content), ['第一段对话', '第一段回复', '接着第一段说']);
  assert.deepEqual(repo.snapshot(second.session_id).messages.map(m => m.content), ['第二段对话']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_sessions').get().n, 2);
  assert.equal(repo.today({ persist: false }).id, second.session_id, 'continuation must not replace the default/new conversation');
  for (const bad of [0, -1, 1.5, '1']) assert.throws(() => repo.start('invalid-target', '消息', [], bad), { status: 400 });
  assert.throws(() => repo.start('unknown-target', '消息', [], 99999), { status: 404 });
  setTime('2026-10-30T16:01:00Z');
  assert.equal(repo.snapshot(first.session_id).writable, true);
  const followup = repo.start('yesterday-followup', '继续昨日对话', [], first.session_id).run;
  assert.equal(followup.session_id, first.session_id);
  repo.finish(followup.id, 'completed');
  assert.equal(repo.snapshot().session.id, second.session_id);
  assert.equal(repo.start('resume-followup', '接着第一段说', [], first.session_id).duplicate, true, 'retry after midnight retrieves the already accepted result only');
});
