import test from 'node:test';
import assert from 'node:assert/strict';
import { recallChatMemories, CHAT_RAG_TIMEOUT_MS } from '../src/services/memory/chatMemoryRecall.js';

test('chat RAG returns completed search results', async () => {
  const expected = [{ memory_id: 'memory-1' }];
  const result = await recallChatMemories('hello', { topK: 7 }, async () => expected);

  assert.deepEqual(result, { results: expected, timedOut: false });
});

test('chat RAG returns empty results after 2.5 seconds', async () => {
  const startedAt = Date.now();
  const result = await recallChatMemories('hello', {}, () => new Promise(() => {}));
  const elapsedMs = Date.now() - startedAt;

  assert.deepEqual(result, { results: [], timedOut: true });
  assert.ok(elapsedMs >= CHAT_RAG_TIMEOUT_MS - 100, `resolved too early: ${elapsedMs}ms`);
  assert.ok(elapsedMs < CHAT_RAG_TIMEOUT_MS + 1000, `resolved too late: ${elapsedMs}ms`);
});
