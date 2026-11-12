import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

process.env.DB_PATH = ':memory:';
const extractorUrl = new URL('../src/services/memoryExtractor.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === extractorUrl && specifier === './memorySearch.js') {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('export const hybridSearch = async () => [];')}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const requests = [];
const responses = [];
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://memory-thinking-test.invalid/v1/chat/completions');
  requests.push(JSON.parse(options.body));
  assert.ok(responses.length, 'unexpected LLM request');
  const { content, finishReason = 'stop' } = responses.shift();
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
  }), { headers: { 'content-type': 'application/json' } });
};
await import('openai/shims/web');
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
Object.assign(config.llm, {
  freeEgg: false,
  connectionType: 'openai',
  baseURL: 'https://memory-thinking-test.invalid/v1',
  apiKey: 'test-only',
  model: 'qwen-test',
  thinkingMode: 'enabled',
  headers: {},
  extraBody: { thinking: { type: 'enabled' }, enable_thinking: true, chat_template_kwargs: { enable_thinking: true } },
});
const { getDb, closeDb } = await import('../src/db/index.js');
const { curateChatMemories, curateAccumulatedMemory } = await import('../src/services/memoryExtractor.js');
const { getCheckpoint } = await import('../src/services/memory/memoryRepository.js');
const { runPortraitSuggestionTask } = await import('../src/services/memory/memoryConsolidation.js');
const { chatSync } = await import('../src/llm/llm-client.js');
after(() => { hooks.deregister(); closeDb(); });

function verifyRequests(count) {
  assert.equal(requests.length, count);
  assert.equal(responses.length, 0);
  for (const request of requests.splice(0)) {
    assert.deepEqual(request.thinking, { type: 'disabled' });
    assert.equal(request.enable_thinking, false);
    assert.equal(request.chat_template_kwargs.enable_thinking, false);
  }
  assert.equal(config.llm.thinkingMode, 'enabled');
  assert.equal(config.llm.extraBody.thinking.type, 'enabled');
  assert.equal(config.llm.extraBody.chat_template_kwargs.enable_thinking, true);
}

test('聊天记忆提取的主请求、截断重发和 JSON 回退均强制关闭思考', async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const db = getDb();
  const conversationId = 'group_memory_thinking';
  const insert = db.prepare('INSERT INTO raw_messages(conversation_id, role, content) VALUES (?, ?, ?)');
  let throughRawMsgId;
  for (let i = 0; i < 40; i++) {
    throughRawMsgId = Number(insert.run(conversationId, i % 2 ? 'assistant' : 'user', `记忆测试对话 ${i}`).lastInsertRowid);
  }
  responses.push(
    { content: '{"memoryActions":[', finishReason: 'length' },
    { content: 'not JSON' },
    { content: '{"memoryActions":[]}' },
  );
  assert.deepEqual(await curateChatMemories({ conversationId, throughRawMsgId }), []);
  assert.equal(getCheckpoint(conversationId).last_raw_msg_id, throughRawMsgId);
  assert.equal(getCheckpoint(conversationId).status, 'idle');
  assert.equal(requests[0].response_format, undefined);
  assert.equal(requests[1].response_format, undefined);
  assert.deepEqual(requests[2].response_format, { type: 'json_object' });
  verifyRequests(3);
});

test('MaiBot 兼容记忆提取强制关闭思考', async t => {
  t.mock.method(console, 'log', () => {});
  responses.push({ content: '{"memoryActions":[]}' });
  assert.equal(await curateAccumulatedMemory({ accumulatedText: '[用户] 我喜欢咖啡。' }), '');
  verifyRequests(1);
});

test('画像建议强制关闭思考，覆盖全局与自定义请求参数', async t => {
  t.mock.method(console, 'log', () => {});
  responses.push({ content: '{"suggestions":[]}' });
  const result = await runPortraitSuggestionTask({
    conversations: [{ characterId: 7, conversationId: 'char_7', memories: [{ memory_id: 'mem_test', judgment: '用户喜欢咖啡', importance: 4 }] }],
    llmBudgetRemaining: 1,
    deps: { db: getDb(), chatSync },
  });
  assert.equal(result.llmFailures, 0);
  assert.equal(result.llmCalls, 1);
  verifyRequests(1);
});
