import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { compressLlmImageInputs, resetLlmImageInputCache } from '../src/services/llmImageInput.js';

test('compressLlmImageInputs 把 data URI 压成 DeepSeek 兼容 WebP', async () => {
  resetLlmImageInputCache();
  const png = await sharp({
    create: { width: 2000, height: 800, channels: 3, background: { r: 20, g: 90, b: 120 } },
  }).png().toBuffer();
  const source = 'data' + ':' + 'image' + '/png;base64,' + png.toString('base64');
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: source } },
    ],
  }];

  const prepared = await compressLlmImageInputs(messages);
  const url = prepared[0].content.find(p => p.type === 'image_url')?.image_url?.url;
  assert.ok(url.startsWith('data' + ':' + 'image' + '/webp;base64,'));
  assert.notEqual(url, source);

  const output = Buffer.from(url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 640);
});

test('compressLlmImageInputs 保留非 data URI 图片', async () => {
  resetLlmImageInputCache();
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: '[image omitted]test' } },
    ],
  }];

  const prepared = await compressLlmImageInputs(messages);
  assert.equal(prepared[0].content.find(p => p.type === 'image_url')?.image_url?.url, '[image omitted]test');
});
