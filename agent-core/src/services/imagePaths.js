import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data', 'images');

export const IMAGE_CATEGORIES = {
  chat:      { dir: 'chat',      label: '聊天' },
  moments:   { dir: 'moments',   label: '朋友圈' },
  events:    { dir: 'events',    label: '奇遇' },
  gifts:     { dir: 'gifts',     label: '送礼' },
  avatargen: { dir: 'avatargen', label: '头像' },
  peek:      { dir: 'peek',      label: '日程' },
  mailbox:   { dir: 'mailbox',   label: '信箱' },
  emoji:     { dir: 'emoji',     label: '表情包' },
  items:     { dir: 'items',     label: '道具' },
};

export const LEGACY_CATEGORY = 'history';
export const LEGACY_DIR = DATA_DIR;
export const LEGACY_URL_PREFIX = '/images';

export const PENDING_DIR = path.join(DATA_DIR, '.pending');

export function getPendingDir() {
  return PENDING_DIR;
}

export function getImageDir(category) {
  if (category === LEGACY_CATEGORY) return LEGACY_DIR;
  const cat = IMAGE_CATEGORIES[category];
  if (!cat) throw new Error(`Unknown image category: ${category}`);
  return path.join(DATA_DIR, cat.dir);
}

export function buildImageUrl(category, filename) {
  if (category === LEGACY_CATEGORY) return `${LEGACY_URL_PREFIX}/${filename}`;
  const cat = IMAGE_CATEGORIES[category];
  if (!cat) throw new Error(`Unknown image category: ${category}`);
  return `/images/${cat.dir}/${filename}`;
}

export function extractCategoryFromUrl(url) {
  const match = url.match(/^\/images\/([^/]+)\/([^/]+)$/);
  if (match) {
    const folder = match[1];
    for (const [cat, info] of Object.entries(IMAGE_CATEGORIES)) {
      if (info.dir === folder) return cat;
    }
    return null;
  }
  if (url.match(/^\/images\/[^/]+$/)) return LEGACY_CATEGORY;
  return null;
}

export function saveBase64Image(category, filename, dataUri) {
  const dir = getImageDir(category);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  const base64 = dataUri.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return buildImageUrl(category, filename);
}

export function deleteImageFileByUrl(url) {
  const cleanUrl = String(url || '').replace(/\?.*$/, '');
  const category = extractCategoryFromUrl(cleanUrl);
  if (!category) return false;

  const filename = cleanUrl.split('/').pop();
  if (!filename || path.basename(filename) !== filename) return false;

  const filePath = path.join(getImageDir(category), filename);
  let removed = false;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    removed = true;
  }
  // AVIF 压缩会把原 PNG 换成同名 .avif；按 .png URL 删除时把孪生文件一并清掉
  if (/\.png$/i.test(filename)) {
    const avifTwin = filePath.replace(/\.png$/i, '.avif');
    if (fs.existsSync(avifTwin)) {
      try { fs.unlinkSync(avifTwin); } catch {}
      removed = true;
    }
  }
  return removed;
}

export function getAllImageDirs() {
  const dirs = [{ category: LEGACY_CATEGORY, dir: LEGACY_DIR, urlPrefix: LEGACY_URL_PREFIX }];
  for (const [cat, info] of Object.entries(IMAGE_CATEGORIES)) {
    dirs.push({
      category: cat,
      dir: path.join(DATA_DIR, info.dir),
      urlPrefix: `/images/${info.dir}`,
      label: info.label,
    });
  }
  return dirs;
}
