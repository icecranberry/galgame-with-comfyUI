import sharp from 'sharp';
import { postProcessAsset } from './town/assetPostProcess.js';
import { imageUrlExists } from './imagePaths.js';

const fail = message => Object.assign(new Error(message), { status: 400 });

export function standingSlots(db) {
  return [{ id: 'normal', name: '正常' }, ...db.prepare('SELECT id,emoji_key FROM emoji_categories ORDER BY sort_order,id').all().map(r => ({ id: `emoji:${r.id}`, name: r.emoji_key }))];
}
export function decodeImage(value) {
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(value)) throw fail('需要 PNG、JPEG 或 WebP 图片');
  return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
}
export async function prepareStandingImage(buffer, removeBg = true) {
  let image = sharp(buffer, { limitInputPixels: 67108864 });
  const originalMeta = await image.metadata();
  // Match the town illustration limit, preserving aspect ratio and smooth alpha.
  if (Math.max(originalMeta.width, originalMeta.height) > 4096) {
    buffer = await image.resize(4096, 4096, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    image = sharp(buffer);
  }
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw fail('图片格式无效');
  const stats = await image.stats();
  const transparent = meta.hasAlpha && !stats.isOpaque;
  const output = await postProcessAsset(buffer, { removeBg: removeBg && !transparent });
  const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  const bounds = right >= left ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1, imageWidth: info.width, imageHeight: info.height } : null;
  return { output, bounds };
}

export function availableStandingImages(rows, slots) {
  const validSlots = new Set(slots.map(slot => slot.id));
  return Object.fromEntries(rows.filter(row => validSlots.has(row.slot_id) && row.image_url && imageUrlExists(row.image_url))
    .map(row => [row.slot_id, row.image_url]));
}

export function playerStandingImages(db, slots = standingSlots(db)) {
  const rows = db.prepare('SELECT slot_id, image_url FROM expression_standings WHERE character_id IS NULL').all();
  return availableStandingImages(rows, slots);
}
