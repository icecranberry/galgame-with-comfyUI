import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, applyContextBudget, blockTag } from '../src/services/contextAssembler.js';

// ── estimateTokens：中文 字数/1.6 + 英文 词数×1.3 ──

test('estimateTokens 中英文分别估算', () => {
  assert.equal(estimateTokens('你好世界呀'), Math.ceil(5 / 1.6));            // 5 个中文字
  assert.equal(estimateTokens('hello world'), Math.ceil(2 * 1.3));          // 2 个英文词
  const mixed = estimateTokens('你好 world');
  assert.ok(mixed >= Math.ceil(2 / 1.6) + Math.ceil(1 * 1.3) - 2);          // 混合在两者之和附近
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
});

test('blockTag 提取块标签', () => {
  assert.equal(blockTag('<rag_memories>\n1. x\n</rag_memories>'), 'rag_memories');
  assert.equal(blockTag('没有标签的普通块'), null);
  assert.equal(blockTag(''), null);
});

// ── applyContextBudget 降级顺序 ──

function historyBlock(lines) {
  return `<active_chat_history>\n${lines.join('\n')}\n</active_chat_history>`;
}
function ragBlock(n) {
  const lines = Array.from({ length: n }, (_, i) => `${i + 1}. [知识|饮食] 记忆条目${i}她不吃香菜这是很长的一句话`);
  return `<rag_memories>\n${lines.join('\n')}\n</rag_memories>`;
}
function fillerBlock(tag, text) {
  return `<${tag}>\n${text}\n</${tag}>`;
}

test('applyContextBudget：未超预算原样返回且不改写入参', () => {
  const blocks = [fillerBlock('user_portrait', '短的画像'), ragBlock(2)];
  const snapshot = [...blocks];
  const result = applyContextBudget({ blocks, budgetTokens: 100000 });
  assert.deepEqual(result.blocks, blocks);
  assert.deepEqual(blocks, snapshot);                 // 纯函数：入参不被修改
  assert.deepEqual(result.degraded, []);
  assert.equal(result.tokensBefore, result.tokensAfter);
});

test('applyContextBudget：第一级——活跃历史轮数减半（保留较新的后半）', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `[用户]: 第${i}句`);
  const blocks = [historyBlock(lines), fillerBlock('user_portrait', '简短画像')];
  // 预算设为"只比减半后略高"，迫使降级 1 生效且不触发后续降级
  const halved = historyBlock(lines.slice(5));
  const target = Math.ceil((estimateTokens(halved) + estimateTokens(fillerBlock('user_portrait', '简短画像'))) * 1.1);
  const result = applyContextBudget({ blocks, budgetTokens: target });
  assert.deepEqual(result.degraded, ['active_chat_history 轮数减半']);
  const history = result.blocks.find(b => blockTag(b) === 'active_chat_history');
  assert.ok(history.includes('第9句'));   // 保留较新的一半
  assert.ok(!history.includes('第2句'));  // 较旧的一半被裁
  assert.ok(result.tokensAfter <= target);
});

test('applyContextBudget：第二级——rag 条目裁到 3 条并重新编号，防呆收尾保留', () => {
  const rag = `<rag_memories>\n${Array.from({ length: 6 }, (_, i) => `${i + 1}. 条目${i}内容很长很长很长很长`).join('\n')}\n（没想起来的部分就自然地说不记得，不要编造。）\n</rag_memories>`;
  const blocks = [rag];
  const trimmedGuess = applyContextBudget({ blocks: [rag], budgetTokens: 4 });  // 极小预算逼出全部降级
  // rag 不可整块丢弃，因此最终块仍在
  assert.ok(trimmedGuess.blocks.length >= 1);
  assert.ok(trimmedGuess.degraded.some(d => d.includes('rag_memories 条目裁至 3 条')));
  const kept = trimmedGuess.blocks[0];
  assert.ok(kept.includes('1. 条目0'));
  assert.ok(kept.includes('3. 条目2'));
  assert.ok(!kept.includes('4. 条目3'));
  assert.ok(kept.includes('不要编造'));  // 非编号收尾行保留
});

test('applyContextBudget：第三级——低优先级整块先丢，rag 类永不丢弃', () => {
  const blocks = [
    ragBlock(3),
    fillerBlock('schedule_context', '今天下午她在上班'.repeat(10)),
    fillerBlock('recent_moments', '朋友圈内容很长很长很长很长很长'.repeat(10)),
    fillerBlock('user_portrait', '画像内容中等长度'.repeat(10)),
    historyBlock(['[用户]: hi', '[角色]: 你好呀']),
  ];
  const ragTokens = estimateTokens(blocks[0]);
  const result = applyContextBudget({ blocks, budgetTokens: ragTokens + 5 });
  const tags = result.blocks.map(blockTag);
  assert.ok(tags.includes('rag_memories'));               // rag 永不丢
  // 优先级 4 的块先丢（schedule_context/user_portrait/recent_moments 都是无标签优先级）
  assert.ok(!tags.includes('schedule_context'));
  assert.ok(result.degraded.some(d => d.includes('整块丢弃')));
  assert.ok(result.tokensAfter <= ragTokens + estimateTokens(blocks[0]) + 20);
});

test('applyContextBudget：极小预算下也不静默——degraded 有完整记录', () => {
  const blocks = [ragBlock(5), historyBlock(Array.from({ length: 8 }, (_, i) => `[用户]: 消息${i}内容`)), fillerBlock('dialogue_rules', '规则块')];
  const result = applyContextBudget({ blocks, budgetTokens: 1 });
  assert.ok(result.degraded.length >= 3);                 // 三级降级都发生
  assert.ok(result.blocks.some(b => blockTag(b) === 'rag_memories'));
  assert.ok(result.tokensAfter < result.tokensBefore);
});
