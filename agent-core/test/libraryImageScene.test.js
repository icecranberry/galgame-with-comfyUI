import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibraryImageInput } from '../src/services/libraryImageScene.js';

test('两个事件库接受图片与可选补充要求', () => {
  for (const type of ['event-types', 'topics']) {
    assert.equal(validateLibraryImageInput({ type, image: 'data:image/png;base64,aGVsbG8=', direction: ' 雨后 ' }).direction, '雨后');
    assert.equal(validateLibraryImageInput({ type, image: 'data:image/jpeg;base64,aGVsbG8=' }).direction, '');
  }
});

test('拒绝远程地址、非法格式、超限图片及错误参数', () => {
  const valid = { type: 'topics', image: 'data:image/png;base64,aGVsbG8=' };
  for (const patch of [
    { image: 'https://example.com/image.png' },
    { image: 'data:image/svg+xml;base64,aGVsbG8=' },
    { image: 'data:image/png;base64,???' },
    { image: 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024) },
    { type: 'unknown' }, { direction: {} }, { direction: '字'.repeat(4001) },
  ]) assert.throws(() => validateLibraryImageInput({ ...valid, ...patch }), { status: 400 });
});
