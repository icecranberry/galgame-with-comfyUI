import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data', 'images');
const AVATARS_DIR = path.resolve(__dirname, '..', '..', 'data', 'avatars');

export const IMAGE_CATEGORIES = {
  chat:      { dir: 'chat',      label: '聊天' },
  moments:   { dir: 'moments',   label: '朋友圈' },
  events:    { dir: 'events',    label: '奇遇' },
  gifts:     { dir: 'gifts',     label: '送礼' },
  avatargen: { dir: 'avatargen', label: '头像' },
  peek:      { dir: 'peek',      label: '日程' },
  mailbox:   { dir: 'mailbox',   label: '信箱' },
  chatbg:    { dir: 'chatbg',    label: '聊天背景' },
  emoji:     { dir: 'emoji',     label: '表情包' },
  items:     { dir: 'items',     label: '道具' },
  standing:  { dir: 'standing',  label: '立绘' },
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

/**
 * 本地图片 URL 是否仍能被静态服务命中（存在性检查必须与 app.js 的静态挂载口径一致）：
 * /images/**（含 .pending 子目录与历史根目录）、/avatars/** 映射到磁盘后检查文件；
 * .png URL 命中同名 .avif（压缩后替换）也算存在；处理百分号编码（表情包中文文件名），
 * 解码结果限制在目录内防编码逃逸；映射不了的形态（data:/外链等）一律视为存在。
 */
export function imageUrlExists(url) {
  const cleanUrl = String(url || '').replace(/\?.*$/, '');
  let decoded;
  try { decoded = decodeURIComponent(cleanUrl); } catch { decoded = cleanUrl; }

  if (decoded.startsWith('/avatars/')) {
    const filePath = path.resolve(AVATARS_DIR, '.' + decoded.slice('/avatars'.length));
    return filePath.startsWith(AVATARS_DIR + path.sep) && fs.existsSync(filePath);
  }

  const imgMatch = decoded.match(/^\/images\/(.+)$/);
  if (imgMatch) {
    // 与 imageAvifFallback 相同的接受面：解码后必须仍落在数据目录内（防 %2e%2e 编码逃逸）
    const filePath = path.resolve(DATA_DIR, imgMatch[1]);
    if (!filePath.startsWith(DATA_DIR + path.sep)) return false;
    if (fs.existsSync(filePath)) return true;
    // PNG 已被 AVIF 压缩替换时，按 .png URL 请求会由回退中间件返回 .avif 内容
    if (/\.png$/i.test(filePath)) return fs.existsSync(filePath.replace(/\.png$/i, '.avif'));
    return false;
  }

  return true;
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

  // 文件名白名单提取：仅接受字母/数字/点/横线/下划线/空格的纯文件名，
  // 从源头杜绝任何路径穿越形态（`..`、路径分隔符都会匹配失败直接返回 false）
  const m = /^([\w.\- ]+)$/.exec(cleanUrl.split('/').pop() || '');
  if (!m) return false;
  const filename = m[1];

  const dir = getImageDir(category);
  const filePath = path.join(dir, filename);
  // 双保险：解析后的真实路径必须仍位于目录内
  if (path.resolve(filePath) !== path.resolve(dir, filename)) return false;
  if (!path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) return false;
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
