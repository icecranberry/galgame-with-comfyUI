import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { worldEventContext } from '../src/services/godSays/worldEvents.js';
import { buildChatContext } from '../src/services/contextAssembler.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';

const activeOnly = { activeOnly: true };
const at = value => new Date(`2026-11-03T${value}Z`);
function fixture(t) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE god_world_events (
    id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'world', status TEXT DEFAULT 'active',
    title TEXT, fact TEXT, character_ids TEXT, created_at TEXT, expires_at TEXT
  )`);
  t.after(() => db.close());
  const add = (id, options = {}) => db.prepare(`INSERT INTO god_world_events
    (id,kind,status,title,fact,character_ids,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)`).run(
    id, options.kind || 'world', options.status || 'active', `事件${id}`, `事实${id}`,
    options.scope ? JSON.stringify(options.scope) : null,
    options.start || at('01:00:00').toISOString(), options.end || at('04:00:00').toISOString());
  return { db, add };
}
const facts = block => block ? JSON.parse(block.split('\n').at(-2)) : [];

test('resident facts appear at start, disappear exactly at expiry; angel retains past facts', t => {
  const { db, add } = fixture(t);
  add(1, { start: '2026-11-03T01:00:00Z', end: '2026-11-03T04:00:00Z' });
  assert.equal(worldEventContext(db, [1], at('00:59:59.999'), activeOnly), '');
  const started = worldEventContext(db, [1], at('01:00:00'), activeOnly);
  assert.match(started, /事实1/);
  assert.equal(worldEventContext(db, [2], at('03:59:59.999'), activeOnly), started,
    'same global facts are byte-identical across characters and time within the lifetime');
  assert.equal(worldEventContext(db, [1], at('04:00:00'), activeOnly), '');
  assert.equal(worldEventContext(db, [1], at('04:00:00.001'), activeOnly), '');
  assert.match(worldEventContext(db, null, at('04:00:01')), /已经结束，只能作为过去见闻/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM god_world_events').get().n, 1);
});

test('ended/superseded facts and tasks are excluded; scope is applied before the six-fact cap', t => {
  const { db, add } = fixture(t);
  for (let id = 1; id <= 8; id++) add(id);
  add(9, { scope: [1] });
  add(10, { kind: 'task' });
  add(11, { status: 'ended' });
  for (let id = 12; id <= 50; id++) add(id, { scope: [99] });
  assert.deepEqual(facts(worldEventContext(db, [2], at('02:00:00'), activeOnly)).map(row => row.id), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(facts(worldEventContext(db, [2, 1], at('02:00:00'), activeOnly)).map(row => row.id), [4, 5, 6, 7, 8, 9]);
  db.prepare("UPDATE god_world_events SET status='ended' WHERE id=9").run();
  assert.doesNotMatch(worldEventContext(db, [1], at('02:00:00'), activeOnly), /事实9/);
});

// 执行真实组装片段并替换 IO，避免加载路由时启动生产数据库、LLM 或生图任务。
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const between = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing prompt assembly boundaries: ${start}`);
  return source.slice(a, b);
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = (code, deps) => new AsyncFunction(...Object.keys(deps), code)(...Object.values(deps));
const capture = async (messages, options) => ({ messages, options });
const residentWrapper = read('services/godSays/worldContext.js').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');

test('shared resident entry point opts into active-only filtering', t => {
  const { db, add } = fixture(t);
  const now = new Date();
  add(1, { start: new Date(now.getTime() - 3600000).toISOString(), end: new Date(now.getTime() - 1).toISOString() });
  const getContext = new Function('getDb', 'worldEventContext', `${residentWrapper}; return getGodWorldContext;`)(() => db, worldEventContext);
  assert.equal(getContext([1]), '');
  assert.match(worldEventContext(db, null, now), /事实1/);
});

const event = '<world_events>\n共同事实\n[{"id":1,"fact":"彩虹"}]\n</world_events>';
async function momentPrompt({ context = event, who = '甲', variable = '晴天，一张图', world = true } = {}) {
  const source = read('routes/moments.js');
  const assembly = between(source, "  const msgs = [{ role: 'system', content: permissionPrompt }];", "  let text = '', imagePrompt");
  const request = between(source, '  const result = await chatWithPreset(msgs, {', '  // 解析 LLM 输出');
  const result = await execute(`${assembly}\n${request}\nreturn result;`, {
    permissionPrompt: '固定规则', worldSetting: world ? '世界观' : '', getWorldIntegrationRule: () => '世界观强化',
    postingStablePrefix: '固定发布规则\n', postingTask: `固定发布规则\n${variable}`,
    getGodWorldContext: () => context, character: { id: 1, display_name: who }, buildCharacterPersona: () => `人设${who}`,
    scheduleWithUser: false, multiPersons: [], selectedTopic: null, userMsg: `发朋友圈${variable}`,
    chatWithPreset: capture, scheduleContext: variable,
  });
  return { messages: result.messages, options: result.options.lorebook };
}
async function privatePrompt({ context = event, who = '甲', variable = '晴天', world = true } = {}) {
  const source = read('routes/chat.js');
  const assembly = between(source, '    const godWorldContext = getGodWorldContext([Number(characterId)]);', '    // Memory v3');
  const request = between(source, '    const { messages: originalBaseMsgs, metadata } = buildChatContext({', '    const baseMsgs = lorebookTurn.messages;');
  return execute(`${assembly}\n${request}\nreturn lorebookTurn;`, {
    getGodWorldContext: () => context, characterId: 1, character: { base_prompt: `人设${who}` },
    stageContent: world ? '固定规则和世界观' : '', charBaseContent: `人设${who}\n状态${variable}`, formatContextBlock: '固定格式',
    buildChatContext, preSummarySystem: '聊天规则', summaryBlock: `摘要${variable}`, preHistoryMessages: [],
    checkpointHistory: [{ role: 'user', content: '之前' }, { role: 'assistant', content: '之前回复' }, { role: 'user', content: `现在${variable}` }],
    budgetedBlocks: [`天气${variable}`], prepareNarrativePrompt: capture,
    buildConversationLorebookContext: () => ({}), db: {}, conversationId: 'char_1', chatUserName: '用户',
    userRawMsgId: 3, activeSegments: [],
  });
}
async function groupPrompt({ context = event, who = '甲', variable = '晴天', world = true } = {}) {
  const source = read('services/groupChatEngine.js');
  const builder = between(source, 'export function buildGroupContext(', '// ── 后台闲聊上下文').replace('export function', 'function');
  const request = between(source, '  const originalMsgs = buildGroupContext(group, directiveBlocks);', '  const msgs = lorebookTurn.messages;');
  const db = { prepare: () => ({ all: () => [{ id: 1, role: 'user', content: variable }], get: () => ({ n: 1 }) }) };
  return execute(`${builder}\n${request}\nreturn lorebookTurn;`, {
    getDb: () => db, db, groupConvId: () => 'group_1', conversationId: 'group_1',
    getSystemRules: () => world ? '固定规则' : '', getWorldSetting: () => world ? '世界观' : '',
    buildGroupCard: () => `<group_info>成员${who}</group_info>`, buildProtocolBlock: () => '固定协议',
    getGodWorldContext: () => context, getRecentSummaries: () => [{ summary: `摘要${variable}` }],
    buildTranscript: () => ({ transcript: `历史${variable}`, segments: [] }),
    group: { id: 1, members: [{ id: 1, name: who }] }, directiveBlocks: [`时间${variable}`],
    prepareNarrativePrompt: capture, trigger: 'user',
  });
}

for (const [name, build] of [['moments', momentPrompt], ['private chat', privatePrompt], ['group chat', groupPrompt]]) {
  test(`${name}: world facts precede persona and changing inputs, without rewriting history or unsafe lore anchors`, async () => {
    for (const world of [true, false]) {
      const a = await build({ world });
      const b = await build({ who: '乙', variable: '雨天，三张图', world });
      const index = a.messages.findIndex(message => message.content === event);
      assert.ok(index >= 0);
      assert.equal(a.messages[index].role, 'system');
      assert.deepEqual(a.messages.slice(0, index + 1), b.messages.slice(0, index + 1));
      assert.ok(a.messages.findIndex(message => message.content.includes('人设甲') || message.content.includes('成员甲')) > index);
      assert.equal(JSON.stringify(a.messages).split('<world_events>').length - 1, 1);
      assert.ok(a.options.cacheBoundary.index <= index);
      if (a.options.cacheBoundary.index === index) assert.equal(a.options.cacheBoundary.offset, 0);
      const ended = await build({ context: '', world });
      assert.doesNotMatch(JSON.stringify(ended.messages), /<world_events>/);
      assert.deepEqual(a.messages.filter(m => m.role !== 'system'), ended.messages.filter(m => m.role !== 'system'));
      assert.ok(ended.messages.every(m => m.content));

      // 常驻世界书不能被这个有期限的区块带到后面；条件条目只能影响动态尾部。
      const book = normalizeBook({ entries: {
        0: { uid: 0, constant: true, position: 1, content: '常驻条目' },
        1: { uid: 1, key: ['命中'], position: 0, content: '条件条目' },
      } }).document;
      const inject = input => applyLorebookLayout(a.messages,
        evaluateBook(book, {}, { history: [{ role: 'user', content: input }] }), { ...a.options, cachePlacement: true });
      const hit = inject('命中'), miss = inject('没有');
      const eventIndex = hit.messages.findIndex(m => m.content.includes('<world_events>'));
      assert.deepEqual(hit.messages.slice(0, eventIndex + 1), miss.messages.slice(0, eventIndex + 1));
      const prefix = hit.messages.slice(0, eventIndex).map(m => m.content).join('\n')
        + hit.messages[eventIndex].content.split('<world_events>')[0];
      assert.match(prefix, /常驻条目/);
      assert.match(JSON.stringify(hit.messages.slice(eventIndex + 1)), /条件条目/);
    }
  });
}
