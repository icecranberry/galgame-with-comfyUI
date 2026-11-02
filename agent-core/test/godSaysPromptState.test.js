import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodMemory } from '../src/services/godSays/memory.js';
import { createGodPromptState } from '../src/services/godSays/promptState.js';
import { buildGodChatContext } from '../src/services/godSays/promptBuilder.js';
import { createPresetRuntime } from '../src/services/presets/runtime.js';
import { createNarrativeRuntime } from '../src/services/presets/narrative.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';

function fixture(t) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE moment_posts(id INTEGER PRIMARY KEY); CREATE TABLE raw_messages(id INTEGER PRIMARY KEY)');
  migrateGodSaysSchema(db);
  migrateGodSaysSchema(db);
  let now = new Date('2026-11-02T01:00:00Z');
  const repo = createGodRepository(db, { now: () => now });
  const memory = createGodMemory(repo, () => assert.fail('no intraday summary'));
  const input = { prompts: ['固定预设规则', '{{setvar::x::{{lastusermessage}}}}', '本轮要求：{{getvar::x}} {{random::甲::乙}}', '后续规则'].map((content, i) => ({ identifier: `${i}`, content })) };
  let compiled = 0, committed = 0, activePreset = { document: input };
  const preset = createPresetRuntime({ getActivePreset: async () => activePreset,
    getContext: async (messages, opts) => ({ lastUserMessage: opts.lorebook.history.at(-1).content, random: () => (++compiled % 2) / 2 }) });
  const book = normalizeBook({ entries: {
    0: { uid: 0, constant: true, position: 0, content: '常驻世界书' },
    1: { uid: 1, constant: false, key: ['彩虹'], position: 5, content: '条件示例世界书' },
    2: { uid: 2, constant: false, key: ['天气'], position: 0, content: '条件角色前条目' },
  } }).document;
  const narrative = createNarrativeRuntime({ preset: preset.prepare, lorebook: async (messages, opts) => {
    const activation = evaluateBook(book, {}, { history: opts.history });
    const result = applyLorebookLayout(messages, activation, { ...opts, cachePlacement: false });
    return { messages: result.messages, report: result, commit() { committed++; } };
  } }).prepareNarrativePrompt;
  const state = () => createGodPromptState(repo, narrative);
  const prepare = async (run, overrides = {}, service = state(), signal) => {
    const history = await memory.contextHistory(run.session_id, { includeIds: true });
    const context = buildGodChatContext({ systemRules: '固定规则', agentRules: '工具规则',
      angel: { persona: '天使人设', display_name: '天使' }, now: new Date(run.created_at), history,
      recall: { summary: '昨日摘要' }, schedule: [{ startTime: '00:00', endTime: '23:59', activity: '整理信件' }], ...overrides });
    return service.prepare(run, context, history, signal);
  };
  t.after(() => db.close());
  return { db, repo, memory, prepare, state, narrative, setPreset: value => { activePreset = value; },
    setTime: value => { now = new Date(value); }, counts: () => ({ compiled, committed }) };
}

test('three turns strictly append frozen user contexts, presets, lore, images and native tool signatures across restart', async t => {
  const f = fixture(t);
  const first = f.repo.start('first', '看看彩虹').run;
  const png = 'data:image/png;base64,AAAA';
  const a = await f.prepare(first, { images: [png] });
  a.commit();
  assert.equal(a.messages[1].content, '固定预设规则');
  assert.match(a.messages.at(-2).content, /本轮要求：看看彩虹/);
  assert.match(JSON.stringify(a.messages.at(-1)), /条件示例世界书/);
  const original = structuredClone(a.messages);
  const again = await f.prepare(first, { now: new Date('2026-11-02T05:00:00Z') });
  assert.deepEqual(again.messages, original);
  assert.equal(f.counts().compiled, 1, 'snapshot retries must not reroll macros');
  const call = { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'inspect_work', arguments: '{}' } }],
    reasoning_content: '核对', vertex_parts: [{ functionCall: { name: 'inspect_work', args: {} }, thoughtSignature: 'signed' }] };
  const { role, content, tool_calls, ...provider } = call;
  f.repo.message(first, role, content, { tool_calls, provider });
  f.repo.message(first, 'tool', '{"done":true}', { tool_call_id: 'call-1' });
  f.repo.message(first, 'assistant', '查好了');
  f.repo.finish(first.id, 'completed');
  f.setTime('2026-11-02T03:00:00Z');
  const second = f.repo.start('second', '看看天气').run;
  const b = await f.prepare(second, { recall: { summary: '归档刚完成的新摘要' },
    schedule: [{ startTime: '00:00', endTime: '23:59', activity: '送信' }] }, f.state());
  assert.deepEqual(b.messages.slice(0, a.messages.length), original);
  assert.deepEqual(b.messages.slice(a.messages.length, a.messages.length + 3), [call,
    { role: 'tool', content: '{"done":true}', tool_call_id: 'call-1' }, { role: 'assistant', content: '查好了' }]);
  assert.match(JSON.stringify(b.messages.at(-1)), /送信/);
  assert.match(JSON.stringify(b.messages.at(-1)), /条件角色前条目/);
  assert.equal(JSON.stringify(b.messages).split('常驻世界书').length - 1, 1);
  assert.equal(JSON.stringify(b.messages).split(png).length - 1, 1);
  f.repo.message(second, 'assistant', '今天天气晴');
  f.repo.finish(second.id, 'completed');
  const third = f.repo.start('third', '继续').run;
  const c = await f.prepare(third);
  assert.deepEqual(c.messages.slice(0, b.messages.length), b.messages);
  assert.deepEqual(f.repo.snapshot(first.session_id).messages.filter(m => m.role === 'user').map(m => m.content), ['看看彩虹', '看看天气', '继续']);
  assert.equal(f.counts().compiled, 3);
});

test('deletion removes request fragments and midnight starts an independent prefix', async t => {
  const f = fixture(t);
  const first = f.repo.start('delete', '要删除的内容').run;
  await f.prepare(first);
  f.repo.finish(first.id, 'completed');
  const second = f.repo.start('keep', '保留').run;
  const saved = await f.prepare(second);
  f.repo.finish(second.id, 'completed');
  f.repo.deleteTurn(first.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM god_prompt_turns').get().n, 1);
  const third = f.repo.start('after-delete', '新输入').run;
  const replay = await f.prepare(third);
  assert.doesNotMatch(JSON.stringify(replay.messages), /要删除的内容/);
  assert.ok(replay.messages.some(m => JSON.stringify(m) === JSON.stringify(saved.messages.at(-1))));
  f.repo.finish(third.id, 'completed');
  f.setTime('2026-11-03T01:00:00Z');
  await createGodMemory(f.repo, async () => JSON.stringify({ summary: '昨日摘要', memories: [] })).archive();
  const tomorrow = f.repo.start('tomorrow', '新一天').run;
  const next = await f.prepare(tomorrow, { systemRules: '次日规则' });
  assert.match(next.messages[0].content, /次日规则/);
  assert.doesNotMatch(JSON.stringify(next.messages), /新输入|本轮要求：保留/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM god_prompt_prefixes').get().n, 2);
});

test('legacy history is kept raw and aborted preparation cannot persist a snapshot', async t => {
  const f = fixture(t);
  const legacy = f.repo.start('legacy', '旧原话').run;
  f.repo.message(legacy, 'assistant', '旧回复');
  f.repo.finish(legacy.id, 'completed');
  const run = f.repo.start('upgrade', '新原话').run;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.prepare(run, {}, f.state(), controller.signal), { name: 'AbortError' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM god_prompt_turns').get().n, 0);
  const prepared = await f.prepare(run);
  const old = prepared.messages.find(m => m.role === 'user');
  assert.deepEqual(old, { role: 'user', content: '旧原话' });
  f.repo.finish(run.id, 'completed');
  const later = f.repo.start('later', '继续').run;
  const next = await f.prepare(later);
  assert.deepEqual(next.messages.slice(0, prepared.messages.length), prepared.messages);
});

test('explicit profile and preset changes take effect as appended updates, including enabling and disabling presets', async t => {
  const f = fixture(t);
  f.setPreset(null);
  const first = f.repo.start('no-preset', '你好').run;
  const a = await f.prepare(first);
  f.repo.finish(first.id, 'completed');
  f.setPreset({ document: { prompts: [{ identifier: 'a', content: '新固定预设' }] } });
  const second = f.repo.start('enable-preset', '继续').run;
  const b = await f.prepare(second, { systemRules: '更新后的基础规则' });
  assert.deepEqual(b.messages.slice(0, a.messages.length), a.messages);
  assert.match(b.messages.at(-3).content, /基础规则与角色资料已更新[\s\S]*更新后的基础规则/);
  assert.match(b.messages.at(-2).content, /附加预设固定规则已更新[\s\S]*新固定预设/);
  f.repo.finish(second.id, 'completed');
  const third = f.repo.start('same-settings', '不变').run;
  const c = await f.prepare(third, { systemRules: '更新后的基础规则' });
  assert.deepEqual(c.messages.slice(0, b.messages.length), b.messages);
  assert.equal(c.messages.length, b.messages.length + 1, 'unchanged static configuration adds no duplicate system');
  f.repo.finish(third.id, 'completed');
  f.setPreset(null);
  const fourth = f.repo.start('disable-preset', '停用后').run;
  const d = await f.prepare(fourth, { systemRules: '更新后的基础规则' });
  assert.deepEqual(d.messages.slice(0, c.messages.length), c.messages);
  assert.match(d.messages.at(-2).content, /附加预设已停用/);
});

test('request guard refuses a processor that rewrites frozen history', async t => {
  const f = fixture(t);
  const first = f.repo.start('before-bad-processor', '你好').run;
  await f.prepare(first);
  f.repo.finish(first.id, 'completed');
  const second = f.repo.start('bad-processor', '继续').run;
  const bad = createGodPromptState(f.repo, async (messages, opts, presetOpts) => {
    const prepared = await f.narrative(messages, opts, presetOpts);
    prepared.messages[0] = { ...prepared.messages[0], content: 'changed prefix' };
    return prepared;
  });
  await assert.rejects(f.prepare(second, {}, bad), /严格追加校验失败/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM god_prompt_turns').get().n, 1);
});

test('unchanged daily schedule is sent once while each immutable turn keeps its own send time, including images', async t => {
  const f = fixture(t);
  f.setPreset(null);
  let previous = [];
  for (let i = 0; i < 3; i++) {
    f.setTime(`2026-11-02T0${i + 1}:00:00Z`);
    const run = f.repo.start(`schedule-once-${i}`, `第${i}条`).run;
    // 日程生成或排队耗时不能把发送时间替换成请求准备时间。
    f.setTime(`2026-11-02T0${i + 1}:30:00Z`);
    const prepared = await f.prepare(run, i !== 1 ? { images: [`data:image/png;base64,${i}`] } : {}, f.state());
    assert.deepEqual(prepared.messages.slice(0, previous.length), previous);
    const request = JSON.stringify(prepared.messages);
    assert.equal(request.split('<schedule_context>').length - 1, 1);
    assert.equal(request.split('<time_context>').length - 1, i + 1);
    assert.match(JSON.stringify(prepared.messages.at(-1)), new RegExp(`本条用户消息发送时间.*${String(i + 9).padStart(2, '0')}:00`));
    if (i) assert.doesNotMatch(JSON.stringify(prepared.messages.at(-1)), /<schedule_context>|整理信件/);
    assert.match(request, /以最新一条 user 的发送时间作为本轮时间参考/);
    previous = structuredClone(prepared.messages);
    f.repo.finish(run.id, 'completed');
  }
});

test('schedule changes append one update, repeat updates are omitted and deleting its source restores necessary context', async t => {
  const f = fixture(t);
  const a = f.repo.start('schedule-initial', '开始').run;
  await f.prepare(a);
  f.repo.finish(a.id, 'completed');
  const changed = { schedule: [{ startTime: '00:00', endTime: '23:59', activity: '日程已改为送信' }] };
  const b = f.repo.start('schedule-change', '改了').run;
  const updated = await f.prepare(b, changed);
  assert.match(JSON.stringify(updated.messages.at(-1)), /日程更新：以下版本替代此前日程/);
  f.repo.finish(b.id, 'completed');
  const c = f.repo.start('schedule-same', '继续').run;
  const same = await f.prepare(c, changed);
  assert.doesNotMatch(JSON.stringify(same.messages.at(-1)), /<schedule_context>/);
  assert.equal(JSON.stringify(same.messages).split('<schedule_context>').length - 1, 2);
  f.repo.finish(c.id, 'completed');
  f.repo.deleteTurn(b.id);
  const d = f.repo.start('schedule-deleted', '再问').run;
  const restored = await f.prepare(d, changed);
  assert.match(JSON.stringify(restored.messages.at(-1)), /日程更新[\s\S]*日程已改为送信/);
});

test('legacy snapshots without schedule metadata stop duplicating schedules without rewriting prior requests', async t => {
  const f = fixture(t);
  const first = f.repo.start('old-snapshot', '旧快照').run;
  const a = await f.prepare(first, { images: ['data:image/png;base64,old'] });
  const row = f.db.prepare('SELECT * FROM god_prompt_turns').get();
  const snapshot = JSON.parse(row.payload_json);
  delete snapshot.scheduleBlock;
  f.db.prepare('UPDATE god_prompt_turns SET payload_json=? WHERE message_id=?').run(JSON.stringify(snapshot), row.message_id);
  f.repo.finish(first.id, 'completed');
  const second = f.repo.start('after-upgrade', '升级后').run;
  const b = await f.prepare(second);
  assert.deepEqual(b.messages.slice(0, a.messages.length), a.messages);
  assert.equal(JSON.stringify(b.messages).split('<schedule_context>').length - 1, 1);
});
