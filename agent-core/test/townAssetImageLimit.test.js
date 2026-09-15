import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`town asset limit fixture forbids network: ${url}`); };

const { MAX_ASSET_IMAGE_SIDE, fitWithinMaxSide } = await import('../src/services/town/townAssetService.js');

/** 立绘级大图：HiresFix 按设置放大后就是这个量级 */
function solidImage(width, height) {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
}

// 回归背景：保存前端编辑产物（POST /api/town/assets/:id/image）过去对超过 2048px 的图直接
// 400「图片尺寸异常」，HiresFix 放大后的立绘存不回去。现在口径是：能存就存，超上限等比缩小。
test('未超过上限的编辑产物原样存下', async () => {
  const buffer = await solidImage(MAX_ASSET_IMAGE_SIDE, 900);
  const fitted = await fitWithinMaxSide(buffer);
  assert.equal(fitted.resized, false);
  assert.equal(fitted.buffer, buffer);
  assert.deepEqual([fitted.width, fitted.height], [MAX_ASSET_IMAGE_SIDE, 900]);
});

test('超过上限的编辑产物等比缩小，不报错', async () => {
  const buffer = await solidImage(6000, 3000);
  const fitted = await fitWithinMaxSide(buffer);
  assert.equal(fitted.resized, true);
  assert.deepEqual([fitted.width, fitted.height], [MAX_ASSET_IMAGE_SIDE, MAX_ASSET_IMAGE_SIDE / 2]);
  const meta = await sharp(fitted.buffer).metadata();
  assert.equal(meta.width, fitted.width);
  assert.equal(meta.height, fitted.height);
  assert.equal(meta.hasAlpha, true, '缩小后仍保留透明通道');
});

test('解码不了的图才报尺寸异常', async () => {
  await assert.rejects(() => fitWithinMaxSide(Buffer.from('not an image')), /图片尺寸异常/);
});
