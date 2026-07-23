import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyOptionalLlmParams } from '../src/llm/llmRequestOptions.js';

describe('LLM optional request parameters', () => {
  it('默认不发送供应商可选字段', () => {
    const params = applyOptionalLlmParams({ model: 'test', stream: true });
    assert.equal('stream_options' in params, false);
    assert.equal('prompt_cache_key' in params, false);
  });

  it('仅显式启用后发送 usage 和 cache key', () => {
    const params = applyOptionalLlmParams({ model: 'test', stream: true }, {
      streamUsage: true,
      promptCache: true,
      cacheKey: 'chat-v2-hash',
    });
    assert.deepEqual(params.stream_options, { include_usage: true });
    assert.equal(params.prompt_cache_key, 'chat-v2-hash');
  });

  it('启用缓存但没有 key 时不发送空字段', () => {
    const params = applyOptionalLlmParams({}, { promptCache: true });
    assert.equal('prompt_cache_key' in params, false);
  });
});
