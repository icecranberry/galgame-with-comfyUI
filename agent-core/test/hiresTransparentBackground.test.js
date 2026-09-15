import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`hires background fixture forbids network: ${url}`); };

const { flattenTransparentOnWhite } = await import('../src/services/imageRefine.js');
const { ASSET_SPECS, fitWithinMaxSide } = await import('../src/services/town/townAssetService.js');
const { postProcessAsset } = await import('../src/services/town/assetPostProcess.js');

/**
 * 抠过图的人像：透明区 RGB 是 0（浏览器 canvas 导出的 PNG 就是这样）。
 * ComfyUI 的 LoadImage 丢掉 alpha 后只剩 RGB，不垫白就会被当成黑底一起重绘。
 */
async function canvasLikeCutout({ width = 32, height = 32, inset = 8 } = {}) {
  const px = Buffer.alloc(width * height * 4);
  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) {
      const o = (y * width + x) * 4;
      px[o] = 200; px[o + 1] = 120; px[o + 2] = 80; px[o + 3] = 255;
    }
  }
  return sharp(px, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** 细化产物：不透明白底上的人物（上传前垫了白，ComfyUI 回来就是这张） */
async function refinedOnWhite({ width, height, inset = 120 }) {
  const px = Buffer.alloc(width * height * 3, 255);
  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) {
      const o = (y * width + x) * 3;
      px[o] = 200; px[o + 1] = 120; px[o + 2] = 80;
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function readPixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    at: (x, y) => [...data.slice((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)],
  };
}

test('透明背景的素材上传前垫成白色，细化工作流不会再读到黑底', async () => {
  const source = await canvasLikeCutout();
  const upload = await flattenTransparentOnWhite(source);
  assert.notEqual(upload, source);
  assert.equal((await sharp(upload).metadata()).hasAlpha, false, '垫白后是不透明图');
  const { at } = await readPixels(upload);
  assert.deepEqual(at(0, 0), [255, 255, 255, 255], '透明区垫成白色');
  assert.deepEqual(at(16, 16), [200, 120, 80, 255], '人物本体保持原样');
});

test('全不透明的素材原样上传，不做多余重编码', async () => {
  const source = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer();
  assert.equal(await flattenTransparentOnWhite(source), source);
});

// 细化产物不再沿用原图 alpha：按素材常规后处理（立绘规格是抠白、不裁内容、轻缩）重新做成成品，
// 再交回素材库给用户微调。立绘放大到 2000 长边也在素材边长上限内，不会被压回出图规格 900×1600。
test('细化产物走素材常规后处理：白底被系统抠成透明，分辨率按细化结果保留', async () => {
  const spec = ASSET_SPECS.portrait;
  const fitted = await fitWithinMaxSide(await refinedOnWhite({ width: 1125, height: 2000 }));
  assert.deepEqual([fitted.resized, fitted.width, fitted.height], [false, 1125, 2000]);

  const out = await postProcessAsset(fitted.buffer, {
    targetW: fitted.width,
    targetH: fitted.height,
    removeBg: spec.removeBg,
    cropContent: !!spec.cropContent,
    smoothResize: true,
  });
  const meta = await sharp(out).metadata();
  assert.equal(meta.hasAlpha, true, '抠白后是透明图');
  const { at } = await readPixels(out);
  assert.equal(at(0, 0)[3], 0, '细化图的白底被抠透明');
  assert.deepEqual(at(562, 1000), [200, 120, 80, 255], '人物本体保留细化结果');
});
