/**
 * 记忆整理与对话摘要的共享前缀：两个调用共用同一份 system 块，
 * 记录块都排在任务指令之前（buildAnalysisUserContent），前缀结构一致时才命中缓存。
 * 窗口互相独立：整理按自己的阈值推进，摘要按「最后 interval 条触发角色消息」
 * 自行截断（pickSummaryBatchStart），因此记录正文只在两边恰好取到同一批消息时
 * 才逐字节一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GROUP_LOG_LABEL, buildChatLogBlock, buildChatLogLines, buildSharedAnalysisSystemPrompt } from '../src/services/chatLogPrompt.js';
import { buildCurationMessages } from '../src/services/memoryExtractor.js';
import { buildSummaryMessages, pickSummaryBatchStart } from '../src/services/summarizer.js';

const MESSAGES = [
  { role: 'user', content: '今天去公园了' },
  { role: 'assistant', content: '好呀！\n{"prompt":"1girl, park, sunny"}' },
];
const NAMES = { userName: '小明', characterName: '小夏' };

function commonPrefixLength(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

test('两个调用共用同一份 system 块', () => {
  const curation = buildCurationMessages({ transcript: 'log' });
  const summary = buildSummaryMessages({ previousSummary: '上一段', chatLogBlock: '<chat_log>\nlog\n</chat_log>' });
  assert.equal(curation[0].role, 'system');
  assert.equal(summary[0].role, 'system');
  assert.equal(curation[0].content, buildSharedAnalysisSystemPrompt());
  assert.equal(curation[0].content, summary[0].content);
});

test('同一批消息在两个调用里渲染成逐字节一致的 <chat_log>', () => {
  const block = buildChatLogBlock(MESSAGES, NAMES);
  const curationUser = buildCurationMessages({ transcript: buildChatLogLines(MESSAGES, NAMES) })[1].content;
  const summaryUser = buildSummaryMessages({ previousSummary: '（新对话开始）', chatLogBlock: block })[1].content;
  assert.ok(block.includes('<chat_log>'));
  assert.ok(curationUser.includes(block));
  assert.ok(summaryUser.includes(block));
});

test('记录块排在任务之前：同一段记录在两个调用里整段落进公共前缀', () => {
  const block = buildChatLogBlock(MESSAGES, NAMES);
  const curationUser = buildCurationMessages({ transcript: buildChatLogLines(MESSAGES, NAMES) })[1].content;
  const summaryUser = buildSummaryMessages({ previousSummary: '上一段摘要', chatLogBlock: block })[1].content;
  const prefix = curationUser.slice(0, commonPrefixLength(curationUser, summaryUser));
  assert.equal(prefix.trimEnd(), block, '同一段记录必须整段落在公共前缀里');
});

test('摘要：记录正文是变量，任务指令与上一段摘要都排在记录块之后', () => {
  const first = buildSummaryMessages({ previousSummary: '摘要甲', chatLogBlock: '<chat_log>\n日志甲\n</chat_log>' })[1].content;
  const second = buildSummaryMessages({ previousSummary: '摘要乙', chatLogBlock: '<chat_log>\n日志乙\n</chat_log>' })[1].content;
  assert.ok(first.startsWith('<chat_log>'), '记录块必须排在 user 内容最前面');
  assert.ok(first.indexOf('你是对话摘要生成器') > first.indexOf('</chat_log>'), '任务指令必须排在记录块之后');
  assert.ok(first.includes('摘要甲'), '上一段摘要仍要出现在请求里');
  const prefix = first.slice(0, commonPrefixLength(first, second));
  assert.ok(prefix.includes('<chat_log>'), '记录块开头落在公共前缀里');
  assert.ok(!prefix.includes('你是对话摘要生成器'), '任务指令是调用各自的，不进公共前缀');
  assert.ok(!prefix.includes('摘要甲'), '上一段摘要是变量，不能进公共前缀');
  assert.ok(!prefix.includes('日志甲'), '记录正文是变量，不能进公共前缀');
});

test('整理：时间窗口/旧记忆/任务指令都排在记录块之后', () => {
  const first = buildCurationMessages({
    transcript: '日志甲',
    related: [{ memory_id: 'm1', memory_type: 'knowledge', judgment: '旧记忆甲', tags: [] }],
    timeRange: '2026-01-01 ~ 2026-01-02',
    v3: true,
  })[1].content;
  const second = buildCurationMessages({ transcript: '日志乙', v3: true })[1].content;
  assert.ok(first.startsWith('<chat_log>'), '记录块必须排在 user 内容最前面');
  assert.ok(first.indexOf('你是聊天长期记忆整理器') > first.indexOf('</chat_log>'), '任务指令必须排在记录块之后');
  const prefix = first.slice(0, commonPrefixLength(first, second));
  assert.ok(!prefix.includes('你是聊天长期记忆整理器'), '任务指令是调用各自的，不进公共前缀');
  assert.ok(!prefix.includes('只返回严格 JSON'), '输出契约排在记录之后，不进公共前缀');
  assert.ok(!prefix.includes('2026-01-01'), '时间窗口是变量，不能进公共前缀');
  assert.ok(!prefix.includes('旧记忆甲'), '旧记忆是变量，不能进公共前缀');
  assert.ok(!prefix.includes('日志甲'), '记录正文是变量，不能进公共前缀');
});

test('群聊记录的发言者标签由共享常量给出，避免两个调用各写一套', () => {
  const block = buildChatLogBlock(
    [{ role: 'assistant', content: '[琪亚娜]: 本小姐现在在干嘛' }],
    { userName: '我', characterName: GROUP_LOG_LABEL },
  );
  assert.ok(block.includes(`[${GROUP_LOG_LABEL}]`));
  assert.equal(block, '<chat_log>\n[群聊记录] [琪亚娜]: 本小姐现在在干嘛\n</chat_log>');
});

test('摘要批次起点＝从末尾倒数第 interval 条触发角色消息', () => {
  const messages = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
    { role: 'assistant', content: 'a3' },
  ];
  assert.equal(pickSummaryBatchStart(messages, { interval: 2 }), 3, '倒数第 2 条 assistant 的下标');
  assert.equal(pickSummaryBatchStart(messages, { interval: 3 }), 1);
  assert.equal(pickSummaryBatchStart(messages, { interval: 1 }), 5, '窗口只含最后一条 assistant 之后不截断');
});

test('不足 interval 条触发角色消息时返回 -1，调用方视为还不需要摘要', () => {
  assert.equal(pickSummaryBatchStart([
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
  ], { interval: 2 }), -1);
  assert.equal(pickSummaryBatchStart([], { interval: 1 }), -1);
  assert.equal(pickSummaryBatchStart(null, { interval: 1 }), -1);
});

test('触发角色可切到 user（多角色混杂），interval 非法时回退默认', () => {
  const messages = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
  ];
  assert.equal(pickSummaryBatchStart(messages, { triggerRole: 'user', interval: 2 }), 0);
  assert.equal(pickSummaryBatchStart(messages, { triggerRole: 'user', interval: 1 }), 2);
  // 非正整数 / 未传 interval → 回退 SUMMARIZE_INTERVAL(10)，此处不足 10 条
  assert.equal(pickSummaryBatchStart(messages, { interval: 0 }), -1);
  assert.equal(pickSummaryBatchStart(messages, { interval: -3 }), -1);
  assert.equal(pickSummaryBatchStart(messages), -1);
});

// 输出被 max_tokens 截断后的精简重发只允许改「条数上限」那一行指令：
// 共享前缀（system + <chat_log> + 其余指令）一旦被动过，整段缓存就没了。
test('被截断后的精简重发不动共享前缀', () => {
  const transcript = buildChatLogLines(MESSAGES, NAMES);
  const block = buildChatLogBlock(MESSAGES, NAMES);
  const normal = buildCurationMessages({ transcript })[1].content;
  const compact = buildCurationMessages({ transcript, compact: true })[1].content;
  assert.notEqual(normal, compact, '精简重发要真的换掉指令，否则重发没有意义');
  assert.ok(compact.startsWith(block), '记录块必须原样留在 user 内容最前面');
  const prefix = normal.slice(0, commonPrefixLength(normal, compact));
  assert.ok(prefix.includes(block), '记录块整段落在公共前缀里');
  assert.ok(!prefix.includes('最多输出'), '只有条数上限那一行不同，其余指令仍留在公共前缀里');
});
