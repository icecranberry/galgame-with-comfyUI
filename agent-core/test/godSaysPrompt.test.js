import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGodChatContext, angelActivity, LANGUAGE_RULE } from '../src/services/godSays/promptBuilder.js';
import { buildChatContext } from '../src/services/contextAssembler.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';

const world = '<world_setting>云庭与邻舍</world_setting>';
const angel = { display_name: '天使', persona: '## 你的身份\n你是送信的天使。\n## 你的外观\n你有白羽和光环。' };
const schedule = [
  { startTime: '23:00', endTime: '05:30', activity: '安眠', location: '云庭卧房', description: '羽翼松松垂到床沿。', replyDelay: -1 },
  { startTime: '05:30', endTime: '07:00', activity: '整理星图', location: '观星台', description: '逐一核对星图上的方位。', replyDelay: 0 },
];
const nativeHistory = [
  { role: 'user', content: '看看工作' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'call1', type: 'function', function: { name: 'inspect_work', arguments: '{}' } }],
    reasoning_content: '先核对', reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-signature' }],
    vertex_parts: [{ functionCall: { name: 'inspect_work', args: {} }, thoughtSignature: 'vertex-signature' }] },
  { role: 'tool', tool_call_id: 'call1', content: '{"ok":true,"events":[]}' },
  { role: 'assistant', content: '没有待办。' },
  { role: 'user', content: '你长什么样子' },
];
function build(overrides = {}) {
  return buildGodChatContext({ systemRules: '破甲规则', worldSetting: world, worldIntegrationRule: '融入世界',
    agentRules: '查询实际工具结果再汇报。', angel, schedule,
    now: new Date('2026-10-30T18:25:00Z'), history: { messages: nativeHistory }, ...overrides });
}
const activation = entries => {
  const doc = normalizeBook({ entries: Object.fromEntries(entries.map((entry, uid) => [uid, { uid, constant: true, content: `LORE_${uid}`, ...entry }])) }).document;
  return evaluateBook(doc, {}, { history: [{ role: 'user', content: '命中' }] });
};

test('private-style layers keep language after jailbreak, exact persona, summary before history, and current input last', () => {
  const { messages, lorebookOptions: options } = build({ user: { nickname: '晨曦', appearance: '银色眼睛' },
    history: { messages: nativeHistory, summary: '今天已核对一次工作。' }, recall: { summary: '2026-10-30：聊过云池。', memories: '- 2026-10-30 · 偏好：神喜欢彩虹。' } });
  assert.equal(messages[0].content, `破甲规则\n\n${LANGUAGE_RULE}\n\n${world}`);
  const personaIndex = messages.findIndex(m => m.content === angel.persona);
  assert.ok(personaIndex > 1);
  assert.match(messages[personaIndex - 1].content, /<dialogue_format_rules>/);
  assert.match(messages[personaIndex + 1].content, /<user_relation>[\s\S]*<user_info>[\s\S]*银色眼睛/);
  assert.match(messages[options.historyStart - 2].content, /<dialogue_rules>/);
  assert.match(messages[options.historyStart - 1].content, /往日对话摘要/);
  assert.doesNotMatch(JSON.stringify(messages), /今日对话历史摘要|今天已核对一次工作|rag_memories|神喜欢彩虹/);
  assert.deepEqual(messages.slice(options.historyStart, -1), nativeHistory.slice(0, -1));
  const current = messages.at(-1);
  assert.equal(current.role, 'user');
  assert.match(current.content, /^<dynamic_context>\n<schedule_context>[\s\S]*<time_context>/);
  assert.ok(current.content.endsWith('</dynamic_context>\n\n你长什么样子'));
  assert.equal(messages.filter(m => m.role === 'user').length, 2);
  assert.equal(options.characterDescription, angel.persona);
  assert.deepEqual(options.history, nativeHistory.filter(m => m.role !== 'tool'));
});

test('full schedule starts user context without current activity claims and the clock precedes user input', () => {
  const dynamic = build().messages.at(-1).content;
  assert.match(dynamic, /^<dynamic_context>\n<schedule_context>[\s\S]*今日完整日程/);
  assert.match(dynamic, /23:00–05:30 安眠（云庭卧房）/);
  assert.match(dynamic, /羽翼松松垂到床沿/);
  assert.match(dynamic, /过去时段不证明活动已完成/);
  assert.match(dynamic, /未来安排不当成已经发生/);
  assert.match(dynamic, /05:30–07:00 整理星图（观星台）\n  计划情境：逐一核对星图上的方位/);
  assert.doesNotMatch(dynamic, /当前时段|当前活动|你原本在休息|刚被唤醒|"startTime"|"replyDelay"|长期记忆：\[/);
  assert.match(dynamic, /本条用户消息发送时间（Asia\/Shanghai）：2026年10月31日星期六 02:25\n<\/time_context>\n<\/dynamic_context>\n\n你长什么样子$/);
  const later = build({ now: new Date('2026-10-30T21:45:00Z') }).messages.at(-1).content;
  assert.equal(dynamic.split('<time_context>')[0], later.split('<time_context>')[0]);
  assert.equal(angelActivity(schedule, new Date('2026-10-30T21:30:00Z')).activity, '整理星图');
  assert.equal(angelActivity(schedule, new Date('2026-10-30T23:00:00Z')), null);
  assert.doesNotMatch(build({ scheduleEnabled: false }).messages.at(-1).content, /当前活动：|今日完整日程|安眠/);
  assert.match(build({ schedule: [], angel: { ...angel, schedule_error: 'offline' } }).messages.at(-1).content, /日程更新暂未完成[\s\S]*今天暂无日程/);
});

test('new turns append complete native history and refresh context only on the last user', () => {
  const first = build();
  const messages = [...nativeHistory, { role: 'assistant', content: '我有白色羽翼。' }, { role: 'user', content: '现在在干嘛' }];
  const next = build({ history: { messages }, now: new Date('2026-10-30T21:45:00Z'),
    worldContext: '<world_events>彩虹生效中</world_events>',
    work: [{ id: 1, title: '彩虹', kind: 'world', active: true }] });
  assert.deepEqual(next.messages.slice(next.lorebookOptions.historyStart, -1), messages.slice(0, -1));
  assert.deepEqual(first.messages.slice(0, first.lorebookOptions.historyStart), next.messages.slice(0, next.lorebookOptions.historyStart));
  assert.match(next.messages.at(-1).content, /^<dynamic_context>\n<schedule_context>[\s\S]*<world_events>[\s\S]*<god_work>[\s\S]*<time_context>[\s\S]*05:45\n<\/time_context>\n<\/dynamic_context>\n\n现在在干嘛$/);
  assert.equal(next.messages.filter(m => typeof m.content === 'string' && m.content.includes('<dynamic_context>')).length, 1);
});

test('clock, schedule, summaries, memory, and current input cannot change the certified stable prefix', () => {
  for (const worldSetting of [world, '']) {
    const first = build({ worldSetting });
    const second = build({ worldSetting, now: new Date('2026-11-01T03:00:00Z'), schedule: [],
      recall: { summary: '另一日', memories: '另一条记忆' }, history: { summary: '新摘要', messages: [{ role: 'user', content: '继续' }] } });
    assert.equal(first.metadata.stablePrefixHash, second.metadata.stablePrefixHash);
    const boundary = first.lorebookOptions.cacheBoundary;
    assert.deepEqual(first.messages.slice(0, boundary.index + 1), second.messages.slice(0, boundary.index + 1));
    assert.ok(boundary.index < first.lorebookOptions.historyStart);
    assert.equal(first.messages[boundary.index].content.length, boundary.offset);
  }
});

test('native tool IDs, provider signatures, and original stored history survive shared assembly unchanged', () => {
  const original = structuredClone(nativeHistory);
  const { messages, lorebookOptions } = build();
  assert.deepEqual(nativeHistory, original);
  assert.deepEqual(messages[lorebookOptions.historyStart + 1], nativeHistory[1]);
  assert.deepEqual(messages[lorebookOptions.historyStart + 2], nativeHistory[2]);
  const image = { type: 'image_url', image_url: { url: 'test://image' } };
  const multi = buildChatContext({ history: [{ role: 'user', content: [{ type: 'text', text: '附件' }, image], name: '神' }],
    dynamicBlocks: ['时间'], preserveStructuredHistory: true });
  assert.deepEqual(multi.messages[0].content.slice(1), [{ type: 'text', text: '附件' }, image]);
  assert.equal(multi.messages[0].name, '神');
  const ordinary = buildChatContext({ history: [{ role: 'user', content: '你好', name: '旧字段' }], dynamicBlocks: ['时间'] });
  assert.deepEqual(ordinary.messages, [{ role: 'user', content: '<dynamic_context>\n时间\n</dynamic_context>\n\n你好' }]);
});

test('worldbook uses actual persona/world/cache anchors and dynamic tail without altering native calls', () => {
  const original = build();
  const entries = activation([{ position: 0 }, { position: 1 }, { position: 2 }, { position: 3 },
    { position: 4, depth: 5 }, { position: 4, depth: 0, constant: false, key: ['命中'] }]);
  const options = { ...original.lorebookOptions, worldText: world, cachePlacement: true };
  const result = applyLorebookLayout(original.messages, entries, options);
  assert.match(result.messages[0].content, /LORE_2[\s\S]*云庭与邻舍[\s\S]*LORE_3/);
  const personaIndex = original.messages.findIndex(m => m.content === angel.persona);
  assert.match(result.messages[personaIndex].content, /LORE_0[\s\S]*你有白羽和光环[\s\S]*LORE_1/);
  assert.match(result.messages[options.cacheBoundary.index].content, /LORE_4/);
  assert.match(result.messages.at(-1).content, /LORE_5[\s\S]*<\/dynamic_context>\n\n你长什么样子$/);
  assert.deepEqual(result.messages.filter(m => ['assistant', 'tool'].includes(m.role)), nativeHistory.filter(m => ['assistant', 'tool'].includes(m.role)));
  assert.ok(result.placements.every(p => p.actualAnchor && Number.isInteger(p.index)));
  // 按原位置模式定位历史深度时，整个原生调用/结果仍保持相邻。
  for (const depth of [0, 1, 2, 5, 20]) {
    const anchored = applyLorebookLayout(original.messages, activation([{ position: 4, depth }]), { ...options, cachePlacement: false });
    const callIndex = anchored.messages.findIndex(m => m.tool_calls);
    assert.equal(anchored.messages[callIndex + 1].tool_call_id, 'call1');
    assert.deepEqual(anchored.messages[callIndex], nativeHistory[1]);
  }
});

test('work context distinguishes live world facts, pending, failed, uncertain and completed deliveries', () => {
  const { messages } = build({ work: [{ id: 12, title: '彩虹', kind: 'world', active: true, deliveries: [
    { target_name: '阿晴', status: 'done' }, { target_name: '群一', status: 'pending' },
    { target_name: '群二', status: 'failed' }, { target_name: '群三', status: 'uncertain' },
    { target_name: '群四', status: 'done', result: { partial: true } },
  ] }] });
  assert.match(messages.at(-1).content, /世界事实正在生效[\s\S]*阿晴：已完成[\s\S]*群一：等待执行[\s\S]*群二：失败[\s\S]*群三：结果待核对[\s\S]*群四：已产生部分回应/);
  assert.doesNotMatch(build().messages.at(-1).content, /<god_work>|<rag_memories>/);
});


test('current angel wardrobe stays in dynamic context and sleep follows pajamas without changing persona prefix', () => {
  const outfits = [{ scene: 'sleep', sceneLabel: '睡衣', name: '云朵睡衣', description: 'a blue nightdress, barefoot' }];
  const dressed = build({ angel: { ...angel, outfits, scene_outfits_json: JSON.stringify(outfits) } });
  const base = build();
  const boundary = dressed.lorebookOptions.cacheBoundary;
  assert.deepEqual(dressed.messages.slice(0, boundary.index + 1), base.messages.slice(0, boundary.index + 1));
  assert.match(dressed.messages.at(-1).content, /<angel_wardrobe>[\s\S]*云朵睡衣[\s\S]*a blue nightdress, barefoot/);
});
