import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { compressDataUriToAvif } from '../src/services/imageTranscode.js';

test('compressDataUriToAvif 转成 AVIF 并限制最长边', async () => {
  const png = await sharp({
    create: { width: 2200, height: 1200, channels: 3, background: { r: 40, g: 90, b: 160 } },
  }).png().toBuffer();
  const source = 'data' + ':' + 'image' + '/png;base64,' + png.toString('base64');

  const result = await compressDataUriToAvif(source);
  assert.equal(result.ext, '.avif');
  assert.ok(result.dataUri.length < source.length);

  const output = Buffer.from(result.dataUri.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'heif');
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1047);
});

test('compressDataUriToAvif 编码无收益时保留原图与扩展名', async () => {
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();
  const source = 'data' + ':' + 'image' + '/png;base64,' + png.toString('base64');

  const result = await compressDataUriToAvif(source);
  assert.equal(result.dataUri, source);
  assert.equal(result.ext, '.png');
});
