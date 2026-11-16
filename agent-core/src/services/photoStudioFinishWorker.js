import { parentPort, workerData } from 'node:worker_threads';
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { renderStudioFinish } from '../shared/photoStudioFinishRenderer.js';

try {
  // Decode AVIF/WebP and orientation with the same installed image backend before drawing.
  const input = await sharp(Buffer.from(workerData.bytes), { limitInputPixels: 40_000_000 }).rotate().png().toBuffer();
  const image = await loadImage(input);
  const canvas = renderStudioFinish(image, workerData.recipe, { createCanvas, createPath: data => new Path2D(data) });
  parentPort.postMessage({ png: await canvas.encode('png') });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
