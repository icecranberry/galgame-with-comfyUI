import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, cacheHitRate, classifyRequestKind } from '../src/services/llmTelemetry.js';

describe('llmTelemetry', () => {
  describe('normalizeUsage', () => {
    it('应解析 OpenAI 格式 (prompt_tokens / completion_tokens)', () => {
      const input = { prompt_tokens: 100, completion_tokens: 50 };
      const result = normalizeUsage(input);
      assert.equal(result.inputTokens, 100);
      assert.equal(result.outputTokens, 50);
    });

    it('应解析 DeepSeek 格式 (input_tokens / output_tokens)', () => {
      const input = { input_tokens: 200, output_tokens: 80 };
      const result = normalizeUsage(input);
      assert.equal(result.inputTokens, 200);
      assert.equal(result.outputTokens, 80);
    });

    it('input_tokens 优先于 prompt_tokens', () => {
      const input = { prompt_tokens: 100, input_tokens: 200 };
      const result = normalizeUsage(input);
      assert.equal(result.inputTokens, 200);
    });

    it('应解析 cached_input_tokens', () => {
      const input = { prompt_tokens: 500, cached_tokens: 300 };
      const result = normalizeUsage(input);
      assert.equal(result.cachedInputTokens, 300);
    });

    it('应解析 DeepSeek prompt_cache_hit_tokens', () => {
      const input = { prompt_tokens: 500, prompt_cache_hit_tokens: 320, prompt_cache_miss_tokens: 180 };
      const result = normalizeUsage(input);
      assert.equal(result.cachedInputTokens, 320);
      assert.equal(result.cacheCreationTokens, 180);
    });

    it('应解析 prompt_tokens_details.cached_tokens', () => {
      const input = {
        prompt_tokens: 500,
        prompt_tokens_details: { cached_tokens: 250 },
      };
      const result = normalizeUsage(input);
      assert.equal(result.cachedInputTokens, 250);
    });

    it('应解析 input_tokens_details.cache_read_input_tokens', () => {
      const input = {
        input_tokens: 600,
        input_tokens_details: { cache_read_input_tokens: 400 },
      };
      const result = normalizeUsage(input);
      assert.equal(result.cachedInputTokens, 400);
    });

    it('cache_creation_tokens 应正确解析', () => {
      const input = { prompt_tokens: 100, cache_creation_input_tokens: 50 };
      const result = normalizeUsage(input);
      assert.equal(result.cacheCreationTokens, 50);
    });

    it('字段缺失时应返回 null', () => {
      const result = normalizeUsage({});
      assert.equal(result.inputTokens, null);
      assert.equal(result.outputTokens, null);
      assert.equal(result.cachedInputTokens, null);
      assert.equal(result.cacheCreationTokens, null);
    });

    it('usage 为 null 时不应崩溃', () => {
      const result = normalizeUsage(null);
      assert.equal(result.inputTokens, null);
    });

    it('usage 为 undefined 时不应崩溃', () => {
      const result = normalizeUsage(undefined);
      assert.equal(result.inputTokens, null);
    });

    it('非数值字段应返回 null', () => {
      const input = { prompt_tokens: 'abc' };
      const result = normalizeUsage(input);
      assert.equal(result.inputTokens, null);
    });
  });

  describe('classifyRequestKind', () => {
    it('保留显式分类，并按标签归类默认 sync 调用', () => {
      assert.equal(classifyRequestKind('chat', '主聊天流'), 'chat');
      assert.equal(classifyRequestKind('sync', '对话摘要提取助手'), 'summary');
      assert.equal(classifyRequestKind('sync', '睡眠瞄一眼prompt生成'), 'image');
      assert.equal(classifyRequestKind('sync', 'RAG记忆提取助手'), 'memory_extract');
    });
  });

  describe('cacheHitRate', () => {
    it('应计算命中率', () => {
      const usage = { prompt_tokens: 100, cached_tokens: 30 };
      const rate = cacheHitRate(usage);
      assert.equal(rate, 0.3);
    });

    it('无缓存时应返回 null', () => {
      const usage = { prompt_tokens: 100 };
      const rate = cacheHitRate(usage);
      assert.equal(rate, null);
    });

    it('input_tokens 为 0 时应返回 null', () => {
      const usage = { prompt_tokens: 0, cached_tokens: 0 };
      const rate = cacheHitRate(usage);
      assert.equal(rate, null);
    });

    it('usage 为 null 时应返回 null', () => {
      const rate = cacheHitRate(null);
      assert.equal(rate, null);
    });
  });
});
