import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildChatContext, createPromptCacheKey, getCheckpointHistory, saveLlmContextSnapshot, PROMPT_REVISION, stableSerialize, sha256 } from '../src/services/contextAssembler.js';

describe('contextAssembler', () => {
  describe('buildChatContext', () => {
    it('应该返回 messages 数组和 metadata', () => {
      const result = buildChatContext({
        stableBlocks: ['[block1]', '[block2]'],
        history: [{ role: 'user', content: 'hello' }],
        dynamicBlocks: ['[dynamic1]'],
      });
      assert.ok(Array.isArray(result.messages));
      assert.ok(result.messages.length >= 2);
      assert.ok(result.metadata);
      assert.equal(result.metadata.revision, PROMPT_REVISION);
      assert.ok(result.metadata.requestHash);
    });

    it('稳定块应转换为 system 消息且顺序一致', () => {
      const { messages } = buildChatContext({
        stableBlocks: ['规则A', '规则B'],
        history: [],
      });
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, 'system');
      assert.equal(messages[0].content, '规则A');
      assert.equal(messages[1].role, 'system');
      assert.equal(messages[1].content, '规则B');
    });

    it('摘要块应放在稳定块之后、历史之前', () => {
      const { messages } = buildChatContext({
        stableBlocks: ['稳定块'],
        summaryBlock: '摘要内容',
        history: [{ role: 'user', content: '历史' }],
      });
      assert.equal(messages.length, 3);
      assert.equal(messages[0].content, '稳定块');
      assert.equal(messages[1].content, '摘要内容');
      assert.equal(messages[2].content, '历史');
    });

    it('动态块应附加到最新 user 消息', () => {
      const { messages } = buildChatContext({
        stableBlocks: [],
        history: [
          { role: 'user', content: '第一条' },
          { role: 'assistant', content: '回复' },
        ],
        dynamicBlocks: ['动态上下文'],
      });
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      assert.ok(lastUser.content.includes('<dynamic_context>'));
      assert.ok(lastUser.content.includes('动态上下文'));
    });

    it('无 user 消息时动态块不附加', () => {
      const { messages } = buildChatContext({
        stableBlocks: ['规则'],
        history: [{ role: 'assistant', content: 'assistant only' }],
        dynamicBlocks: ['动态'],
      });
      assert.equal(messages.length, 2);
      const allContent = messages.map(m => m.content).join('');
      // 没有 user 消息，动态块不应出现
      assert.ok(!allContent.includes('<dynamic_context>'));
    });

    it('历史消息应被克隆（不改原始引用）', () => {
      const original = [{ role: 'user', content: '原内容' }];
      const { messages } = buildChatContext({
        stableBlocks: [],
        history: original,
        dynamicBlocks: ['动态'],
      });
      // 原始对象不应被修改
      assert.equal(original[0].content, '原内容');
      // 动态块应附加到克隆后的消息
      const userMsg = messages.find(m => m.role === 'user');
      assert.ok(userMsg.content.includes('<dynamic_context>'));
    });
  });

  describe('stablePrefixHash', () => {
    it('相同稳定块应产生相同 hash', () => {
      const a = buildChatContext({ stableBlocks: ['规则1', '规则2'], history: [{ role: 'user', content: '你好' }] });
      const b = buildChatContext({ stableBlocks: ['规则1', '规则2'], history: [{ role: 'user', content: '不同消息' }] });
      assert.equal(a.metadata.stablePrefixHash, b.metadata.stablePrefixHash);
    });

    it('不同稳定块应产生不同 hash', () => {
      const a = buildChatContext({ stableBlocks: ['规则A'], history: [] });
      const b = buildChatContext({ stableBlocks: ['规则B'], history: [] });
      assert.notEqual(a.metadata.stablePrefixHash, b.metadata.stablePrefixHash);
    });

    it('仅历史不同时稳定 hash 应相同', () => {
      const a = buildChatContext({ stableBlocks: ['稳定'], history: [{ role: 'user', content: '历史1' }] });
      const b = buildChatContext({ stableBlocks: ['稳定'], history: [{ role: 'user', content: '历史2' }] });
      assert.equal(a.metadata.stablePrefixHash, b.metadata.stablePrefixHash);
    });

    it('摘要不同时稳定 hash 不变（摘要单独计为 fullPrefixHash）', () => {
      const base = { stableBlocks: ['稳定'], history: [] };
      const a = buildChatContext({ ...base, summaryBlock: '摘要1' });
      const b = buildChatContext({ ...base, summaryBlock: '摘要2' });
      assert.equal(a.metadata.stablePrefixHash, b.metadata.stablePrefixHash);
      // fullPrefixHash 应不同（含摘要）
      assert.notEqual(a.metadata.fullPrefixHash, b.metadata.fullPrefixHash);
    });
  });

  describe('requestHash', () => {
    it('不同动态块应产生不同 requestHash', () => {
      const base = { stableBlocks: ['稳定'], history: [{ role: 'user', content: '消息' }] };
      const a = buildChatContext({ ...base, dynamicBlocks: ['动态1'] });
      const b = buildChatContext({ ...base, dynamicBlocks: ['动态2'] });
      assert.notEqual(a.metadata.requestHash, b.metadata.requestHash);
    });

    it('全部相同应产生相同 requestHash', () => {
      const opts = {
        stableBlocks: ['A', 'B'],
        summaryBlock: '摘要',
        history: [{ role: 'user', content: '消息' }, { role: 'assistant', content: '回复' }],
        dynamicBlocks: ['动态'],
      };
      const a = buildChatContext(opts);
      const b = buildChatContext(opts);
      assert.equal(a.metadata.requestHash, b.metadata.requestHash);
    });
  });

  describe('stableSerialize', () => {
    it('相同结构应序列化一致', () => {
      const a = stableSerialize([{ role: 'system', content: 'hello' }]);
      const b = stableSerialize([{ role: 'system', content: 'hello' }]);
      assert.equal(a, b);
    });

    it('字段顺序不同应序列化一致', () => {
      const a = stableSerialize({ b: 2, a: 1 });
      const b = stableSerialize({ a: 1, b: 2 });
      assert.equal(a, b);
    });
  });

  describe('createPromptCacheKey', () => {
    it('同一会话与 revision 应稳定，且不泄露会话原文', () => {
      const keyA = createPromptCacheKey('char_42');
      const keyB = createPromptCacheKey('char_42');
      assert.equal(keyA, keyB);
      assert.ok(!keyA.includes('char_42'));
    });

    it('会话或 revision 变化时 key 应变化', () => {
      assert.notEqual(createPromptCacheKey('char_1'), createPromptCacheKey('char_2'));
      assert.notEqual(createPromptCacheKey('char_1', 'v1'), createPromptCacheKey('char_1', 'v2'));
    });
  });

  describe('saveLlmContextSnapshot', () => {
    it('应幂等保存本轮实际记忆文本快照', () => {
      const db = new Database(':memory:');
      db.exec(`CREATE TABLE llm_context_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_raw_msg_id INTEGER NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        character_id INTEGER,
        summary_id INTEGER,
        checkpoint_end_msg_id INTEGER DEFAULT 0,
        memory_snapshot TEXT DEFAULT '[]',
        dynamic_context TEXT DEFAULT '',
        prompt_revision TEXT NOT NULL,
        stable_prefix_hash TEXT NOT NULL,
        history_prefix_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL
      )`);
      const snapshot = {
        userRawMsgId: 7,
        conversationId: 'char_1',
        characterId: 1,
        memorySnapshot: [{ id: 3, content: '用户喜欢咖啡' }],
        dynamicContext: '<rag_memories>用户喜欢咖啡</rag_memories>',
        promptRevision: PROMPT_REVISION,
        stablePrefixHash: 'stable',
        historyPrefixHash: 'history',
        requestHash: 'request',
      };
      saveLlmContextSnapshot(db, snapshot);
      saveLlmContextSnapshot(db, { ...snapshot, dynamicContext: '重试时变化' });
      const row = db.prepare('SELECT * FROM llm_context_snapshots').get();
      assert.equal(JSON.parse(row.memory_snapshot)[0].content, '用户喜欢咖啡');
      assert.equal(row.dynamic_context, snapshot.dynamicContext);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM llm_context_snapshots').get().count, 1);
    });
  });
});
