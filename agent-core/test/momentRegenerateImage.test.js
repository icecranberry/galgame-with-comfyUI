import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { config } = await import('../src/config.js');
const { DEFAULT_MOMENT_IMAGE_PROMPT } = await import('../src/services/momentResponseParser.js');
const { splitMomentImagePrompts, parseMomentResolution } = await import('../src/routes/moments.js');

// 补图复用帖子落库的 prompt / resolution，这里锁死「拆得回、拆不坏」的口径

test('splitMomentImagePrompts 按 --- 分隔线拆回逐张提示词', () => {
  assert.deepEqual(splitMomentImagePrompts('a cat\n---\na dog'), ['a cat', 'a dog']);
  assert.deepEqual(splitMomentImagePrompts('第一条\n --- \n第二条'), ['第一条', '第二条']);
  assert.deepEqual(splitMomentImagePrompts('solo prompt'), ['solo prompt']);
  assert.deepEqual(splitMomentImagePrompts('  两侧留白  '), ['两侧留白']);
});

test('splitMomentImagePrompts 空提示词回退默认风景提示词', () => {
  for (const empty of ['', '   ', null, undefined]) {
    assert.deepEqual(splitMomentImagePrompts(empty), [DEFAULT_MOMENT_IMAGE_PROMPT]);
  }
});

test('splitMomentImagePrompts 与落库 join(\'\\n---\\n\') 往返一致', () => {
  const prompts = ['第一张', '第二张', '第三张'];
  assert.deepEqual(splitMomentImagePrompts(prompts.join('\n---\n')), prompts);
});

test('parseMomentResolution 解析 WxH 尺寸', () => {
  assert.deepEqual(parseMomentResolution('1600x1200'), { width: 1600, height: 1200 });
  assert.deepEqual(parseMomentResolution(' 512x768 '), { width: 512, height: 768 });
});

test('parseMomentResolution 缺失或非法时回退当前配置尺寸', () => {
  const fallback = { width: config.comfyui.momentsWidth, height: config.comfyui.momentsHeight };
  for (const bad of ['', null, undefined, '1600', '1600*1200', '1600X1200', 'axb', '1600x']) {
    assert.deepEqual(parseMomentResolution(bad), fallback);
  }
});
