import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`global lora test forbids network: ${url}`); };

const { migrateGlobalLoraScenes } = await import('../src/db/settings.js');
const { filterGlobalLoras } = await import('../src/services/imageSkill.js');

// 群聊（v2.4.0）与立绘上线之前，全局 LoRA 弹窗只提供这五个场景；
// 存量里 scenes 恰好是这五项、或五项 + 后补的 group 时，是"漏了新场景"
// 而不是"显式排除"，装载时补齐。
const LEGACY_FIVE = ['chat', 'moments', 'events', 'mailbox', 'schedule'];
const LEGACY_SIX = [...LEGACY_FIVE, 'group'];
const CURRENT_SEVEN = [...LEGACY_FIVE, 'group', 'portrait'];
const SCENES_WITH_STICKER = [...CURRENT_SEVEN, 'sticker'];

test('存量全局 LoRA 恰好是旧五项场景时补上 group 与 portrait', () => {
  const out = migrateGlobalLoraScenes([
    { path: 'a.safetensors', weight: 0.8, scenes: [...LEGACY_FIVE] },
    // 顺序不同仍视为同一集合
    { path: 'b.safetensors', scenes: ['schedule', 'mailbox', 'events', 'moments', 'chat'] },
  ]);

  assert.deepEqual(out[0].scenes, CURRENT_SEVEN);
  assert.equal(out[1].scenes.includes('group'), true);
  assert.equal(out[1].scenes.includes('portrait'), true);
  assert.equal(out[0].path, 'a.safetensors', '其余字段保持不动');
  assert.equal(out[0].weight, 0.8);
});

test('只补过 group 的旧六项场景再补上 portrait', () => {
  const out = migrateGlobalLoraScenes([
    { path: 'a.safetensors', scenes: [...LEGACY_SIX] },
    // 顺序不同仍视为同一集合
    { path: 'b.safetensors', scenes: ['group', 'schedule', 'mailbox', 'events', 'moments', 'chat'] },
  ]);

  assert.deepEqual(out[0].scenes, CURRENT_SEVEN);
  assert.deepEqual(out[1].scenes, CURRENT_SEVEN);
});

test('迁移不回写 DB，每次装载重跑也不重复追加', () => {
  const first = migrateGlobalLoraScenes([{ path: 'a.safetensors', scenes: [...LEGACY_FIVE] }]);
  const second = migrateGlobalLoraScenes(first);
  const third = migrateGlobalLoraScenes(second);

  assert.deepEqual(second[0].scenes, CURRENT_SEVEN);
  assert.deepEqual(third[0].scenes, CURRENT_SEVEN);
  assert.equal(third[0], second[0], '已是最新场景集合时保持原对象');
});

test('非旧集合的配置原样保留', () => {
  const partial = [{ path: 'a.safetensors', scenes: ['chat'] }];
  const extra = [{ path: 'c.safetensors', scenes: [...LEGACY_FIVE, 'group', 'dream'] }];
  const current = [{ path: 'd.safetensors', scenes: [...CURRENT_SEVEN] }];

  assert.deepEqual(migrateGlobalLoraScenes(partial)[0].scenes, ['chat']);
  assert.deepEqual(migrateGlobalLoraScenes(extra)[0].scenes, [...LEGACY_FIVE, 'group', 'dream']);
  assert.equal(migrateGlobalLoraScenes(current)[0], current[0], '已含 portrait 的七项集合不受影响');
});

test('loras 不是数组、或单项没有 scenes 时不动', () => {
  assert.equal(migrateGlobalLoraScenes(null), null);
  assert.equal(migrateGlobalLoraScenes(undefined), undefined);

  const noScenes = { path: 'a.safetensors' };
  const badScenes = { path: 'b.safetensors', scenes: 'chat' };
  const out = migrateGlobalLoraScenes([noScenes, badScenes]);

  assert.equal(out[0], noScenes, '无 scenes 的项保持原对象');
  assert.equal(out[1], badScenes, 'scenes 非数组的项保持原对象');
});

test('filterGlobalLoras: 群聊场景选中带 group 的 LoRA，只有旧五项的落选', () => {
  const base = { weight: 1, enabled: true };
  const out = filterGlobalLoras([
    { ...base, path: 'group-ok.safetensors', scenes: [...LEGACY_SIX] },
    { ...base, path: 'legacy-only.safetensors', scenes: [...LEGACY_FIVE] },
  ], 'group');

  assert.deepEqual(out.map(l => l.path), ['group-ok.safetensors']);
});

test('filterGlobalLoras: 立绘场景选中带 portrait 的 LoRA，只挂 chat 的落选', () => {
  const base = { weight: 1, enabled: true };
  const out = filterGlobalLoras([
    { ...base, path: 'portrait-ok.safetensors', scenes: [...CURRENT_SEVEN] },
    { ...base, path: 'chat-only.safetensors', scenes: ['chat'] },
    { ...base, path: 'town-only.safetensors', scenes: ['town'] },
  ], 'portrait');

  assert.deepEqual(out.map(l => l.path), ['portrait-ok.safetensors']);
});

test('filterGlobalLoras: scenes 缺失或空数组 = 所有场景生效', () => {
  const base = { weight: 1, enabled: true };
  const out = filterGlobalLoras([
    { ...base, path: 'no-scenes.safetensors' },
    { ...base, path: 'empty-scenes.safetensors', scenes: [] },
  ], 'portrait');

  assert.deepEqual(out.map(l => l.path), ['no-scenes.safetensors', 'empty-scenes.safetensors']);
});

test('filterGlobalLoras: 关闭的 LoRA 与空路径始终跳过；无场景不做过滤', () => {
  const disabled = filterGlobalLoras([
    { path: 'off.safetensors', enabled: false, scenes: ['portrait'] },
    { path: '', enabled: true, scenes: ['portrait'] },
  ], 'portrait');
  assert.deepEqual(disabled, []);

  const noScene = filterGlobalLoras([
    { path: 'legacy-only.safetensors', weight: 1, enabled: true, scenes: [...LEGACY_FIVE] },
  ], undefined);
  assert.deepEqual(noScene.map(l => l.path), ['legacy-only.safetensors']);
});

test('filterGlobalLoras: sticker scene only uses LoRAs explicitly enabled for stickers', () => {
  const base = { weight: 1, enabled: true };
  const out = filterGlobalLoras([
    { ...base, path: 'sticker-ok.safetensors', scenes: SCENES_WITH_STICKER },
    { ...base, path: 'default-off.safetensors', scenes: [...CURRENT_SEVEN] },
    { ...base, path: 'chat-only.safetensors', scenes: ['chat'] },
  ], 'sticker');

  assert.deepEqual(out.map(l => l.path), ['sticker-ok.safetensors']);
});
