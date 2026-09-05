/**
 * 素材后处理单测：像素化尺寸 + 连通抠白（白衣物保护 / alpha 二值化 / 容差）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { pixelate, removeWhiteBackground, postProcessAsset } from '../src/services/town/assetPostProcess.js';

/** 构造测试图：白底 + 中央红色方块 + 中央被红圈包裹的白色内芯（模拟白色衣物） */
async function makeTestImage(size = 64) {
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#ffffff"/>
      <rect x="8" y="8" width="${size - 16}" height="${size - 16}" fill="#cc2222"/>
      <rect x="${size / 2 - 6}" y="${size / 2 - 6}" width="12" height="12" fill="#ffffff"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('pixelate 输出目标尺寸的小图', async () => {
  const src = await makeTestImage(64);
  const out = await pixelate(src, 16, 16);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 16);
  assert.equal(meta.height, 16);
  assert.equal(meta.format, 'png');
});

test('pixelate 非整数尺寸抛错', async () => {
  const src = await makeTestImage(8);
  await assert.rejects(() => pixelate(src, 0, 8));
  await assert.rejects(() => pixelate(src, 8.5, 8));
});

test('removeWhiteBackground 抠掉四边连通白底，保留内部白色区块', async () => {
  const src = await makeTestImage(64);
  const out = await removeWhiteBackground(src);
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];

  // 四角：背景 → 透明
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(63, 0), 0);
  assert.equal(alphaAt(0, 63), 0);
  assert.equal(alphaAt(63, 63), 0);
  // 红色边缘：前景 → 不透明
  assert.equal(alphaAt(9, 32), 255);
  // 中央白色内芯：被红圈包裹、不与四边连通 → 连通性保护，保持不透明（白衣物不被误抠）
  assert.equal(alphaAt(32, 32), 255);
});

test('removeWhiteBackground alpha 严格二值化（0 或 255）', async () => {
  const src = await makeTestImage(32);
  const out = await removeWhiteBackground(src);
  const { data } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    assert.ok(data[i] === 0 || data[i] === 255, `alpha at ${i} = ${data[i]}`);
  }
});

test('removeWhiteBackground 高容差把暖白底也抠掉', async () => {
  const svg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" fill="#f5f0e8"/>
    <circle cx="16" cy="16" r="8" fill="#3344aa"/>
  </svg>`;
  const src = sharp(Buffer.from(svg)).png().toBuffer();
  const strict = await removeWhiteBackground(await src, 8);   // 255-8=247：暖白底(245)不够亮 → 保留
  const meta = await sharp(strict).raw().toBuffer({ resolveWithObject: true });
  assert.equal(meta.data[3], 255); // 左上角仍不透明

  const loose = await removeWhiteBackground(await src, 30);   // 255-30=225：暖白底(245,240,232)全命中 → 抠掉
  const { data, info } = await sharp(loose).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0);               // 左上角透明
  assert.equal(data[(16 * info.width + 16) * 4 + 3], 255); // 中心圆不透明
});

test('postProcessAsset 抠白 + 像素化串联（建筑规格）', async () => {
  const src = await makeTestImage(512);
  const out = await postProcessAsset(src, { targetW: 80, targetH: 64, removeBg: true });
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 80);
  assert.equal(info.height, 64);
  assert.equal(data[3], 0); // 左上角已透明
});
