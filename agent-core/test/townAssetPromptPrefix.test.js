/**
 * 固定前缀口径：
 * - 重新生成不标 verbatim（LLM 产物只是描述正文），由 composeAssetPrompt 按
 *   meta.promptPrefix / 类型默认补回前缀与像素小人硬 tag；verbatim 只留给弹窗手写。
 * - 大立绘例外：固定 'full body, white background'，不套面板里的小人前缀，
 *   素材级 meta.promptPrefix 对它同样无效。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`prefix fixture forbids network: ${url}`); };

const { composeAssetPrompt, resolvePromptPrefix, DEFAULT_PROMPT_PREFIX } = await import('../src/services/town/townAssetService.js');

test('非 verbatim：固定前缀 + 像素小人硬 tag 补在正文前', () => {
  assert.equal(
    composeAssetPrompt({
      kind: 'npc',
      prefix: DEFAULT_PROMPT_PREFIX.npc,
      prompt: 'a girl with silver twin braids',
    }),
    'pixel art, game sprite, mini human sized, full body, chibi, big head, a girl with silver twin braids',
  );
});

test('非 verbatim：前缀里已手写 chibi / big head 时不重复补', () => {
  assert.equal(
    composeAssetPrompt({ kind: 'player', prefix: 'pixel art, chibi, big head', prompt: 'the player character' }),
    'pixel art, chibi, big head, the player character',
  );
});

test('非 verbatim：地砖 / 建筑用各自类型的默认前缀', () => {
  assert.equal(
    composeAssetPrompt({ kind: 'building', prefix: DEFAULT_PROMPT_PREFIX.building, prompt: 'a bakery' }),
    'pixel art, game sprite, white background, a bakery',
  );
});

test('大立绘固定前缀是 full body, white background，且不补硬 tag', () => {
  const prefix = resolvePromptPrefix({ kind: 'portrait' }, DEFAULT_PROMPT_PREFIX.npc);
  assert.equal(prefix, 'full body, white background');
  assert.equal(
    composeAssetPrompt({ kind: 'portrait', prefix, prompt: 'a traveler' }),
    'full body, white background, a traveler',
  );
});

test('大立绘忽略素材级 meta.promptPrefix 与面板传入的前缀', () => {
  // 面板给的是小人前缀（generationDefaultsForAsset 对 portrait 已改成固定值），素材级脏数据也必须无效
  assert.equal(
    resolvePromptPrefix({ kind: 'portrait', meta: { promptPrefix: 'pixel art, game sprite, mini human sized, full body' } }, 'pixel art, game sprite, mini human sized, full body'),
    'full body, white background',
  );
});

test('其余素材：素材级覆盖优先，缺省回落类型配置', () => {
  assert.equal(resolvePromptPrefix({ kind: 'npc', meta: { promptPrefix: 'my custom prefix' } }, DEFAULT_PROMPT_PREFIX.npc), 'my custom prefix');
  assert.equal(resolvePromptPrefix({ kind: 'npc', meta: {} }, DEFAULT_PROMPT_PREFIX.npc), DEFAULT_PROMPT_PREFIX.npc);
  assert.equal(resolvePromptPrefix({ kind: 'ground', meta: {} }, ''), '');
});

test('verbatim：弹窗手写的完整提示词原样送，不补前缀 / 硬 tag', () => {
  assert.equal(
    composeAssetPrompt({ kind: 'npc', prefix: DEFAULT_PROMPT_PREFIX.npc, prompt: 'my full prompt', verbatim: true }),
    'my full prompt',
  );
});