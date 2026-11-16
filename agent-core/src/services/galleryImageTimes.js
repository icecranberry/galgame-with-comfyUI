import { getDb } from '../db/index.js';

// 相册身份不随 PNG → AVIF 改变；保留目录，避免不同渠道的同名图片串时间。
export function galleryImageKey(url) {
  if (typeof url !== 'string') return null;
  let clean = url.split('?')[0];
  try { clean = decodeURIComponent(clean); } catch {}
  if (!/^\/images\/(?:[^/]+\/)?[^/]+\.(png|avif|jpe?g|webp|gif)$/i.test(clean)
    || clean.startsWith('/images/.pending/') || /[\\\u0000-\u001f]/.test(clean)) return null;
  return clean.replace(/\.(png|avif)$/i, '.png');
}

function timestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  // SQLite CURRENT_TIMESTAMP/datetime('now') 为 UTC，不能按服务器本地时区解析。
  const text = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value;
  const result = Date.parse(text);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function filenameTime(name, now) {
  // 只识别应用自身的命名，不能把任意 ComfyUI 文件名里的种子误认作时间。
  if (!/^(?:\d{13}_|(?:event|town_event|gift|moment|np|media|avatar_gen|standing|char|diary|paper|portrait|illustration|peek|town_service|npc_stock)_)/.test(name)) return null;
  const matches = [...name.matchAll(/(?:^|_)(\d{13})(?=[_.]|$)/g)];
  const match = /^(?:peek|char|diary|paper|portrait|illustration)_/.test(name) ? matches.at(-1) : matches[0];
  const time = match ? Number(match[1]) : null;
  return time >= Date.UTC(2000, 0, 1) && time <= now ? time : null;
}

// 任务完成时间最接近成片时间；其余业务记录用于未登记任务的旧图片。
const SOURCES = [
  ['image_tasks', ['output_paths'], ['finished_at', 'created_at'], 0],
  ['photo_studio_jobs', ['output_url'], ['finished_at', 'created_at'], 0],
  ['messages', ['images'], ['created_at'], 1],
  ['moment_posts', ['images'], ['created_at'], 1],
  ['character_events', ['image'], ['created_at'], 1],
  ['event_history', ['final_image'], ['ended_at', 'created_at'], 1],
  ['character_dreams', ['image_path'], ['created_at'], 1],
  ['mailbox_letters', ['paper_path', 'portrait_path', 'illustration_path'], ['replied_at', 'created_at'], 1],
  ['character_diaries', ['images'], ['created_at'], 1],
  ['god_runs', ['images_json'], ['created_at'], 1],
];

function collectBusinessTimes(db, missing) {
  const found = new Map();
  function collect(value, time, priority, source) {
    if (typeof value === 'string') {
      const key = galleryImageKey(value);
      if (key && missing.has(key)) {
        const previous = found.get(key);
        if (!previous || priority < previous.priority || (priority === previous.priority && time < previous.time)) {
          found.set(key, { time, priority, source });
        }
      } else if (/^\s*[\[{]/.test(value)) {
        try { collect(JSON.parse(value), time, priority, source); } catch {}
      }
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, time, priority, source);
    }
  }
  for (const [table, fields, times, priority] of SOURCES) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    const availableFields = fields.filter(field => columns.has(field));
    const availableTimes = times.filter(field => columns.has(field));
    if (!availableFields.length || !availableTimes.length) continue;
    const timeSql = availableTimes.length === 1 ? availableTimes[0] : `COALESCE(${availableTimes.join(',')})`;
    const query = `SELECT ${availableFields.join(',')}, ${timeSql} AS image_time FROM ${table}
      WHERE ${availableFields.map(field => `${field} IS NOT NULL`).join(' OR ')}`;
    for (const row of db.prepare(query).iterate()) {
      const time = timestamp(row.image_time);
      if (!time) continue;
      for (const field of availableFields) collect(row[field], time, priority, table);
    }
  }
  return found;
}

/** 新图片成功保存时登记一次；原位覆盖、格式转换绝不更新这个时间。 */
export function rememberGalleryImageTime(url, time = Date.now(), db = getDb()) {
  const key = galleryImageKey(url);
  const createdAt = timestamp(time);
  if (!key || !createdAt) return;
  db.prepare('INSERT OR IGNORE INTO gallery_image_times(image_key, created_at_ms, time_source) VALUES (?, ?, ?)')
    .run(key, createdAt, 'added');
}

/** 批量为旧图补齐固定时间；只处理尚未登记的图片，后续不随更强的线索重新排序。 */
export function assignGalleryImageTimes(images, db = getDb()) {
  if (!images.length) return images;
  const select = db.prepare('SELECT created_at_ms FROM gallery_image_times WHERE image_key = ?');
  const known = new Map();
  const missing = new Set();
  for (const image of images) {
    const key = galleryImageKey(image.url);
    if (!key || known.has(key)) continue;
    const row = select.get(key);
    if (row) known.set(key, row.created_at_ms);
    else missing.add(key);
  }
  if (missing.size) {
    const business = collectBusinessTimes(db, missing);
    const now = Date.now();
    const insert = db.prepare('INSERT OR IGNORE INTO gallery_image_times(image_key, created_at_ms, time_source) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (const image of images) {
        const key = galleryImageKey(image.url);
        if (!missing.has(key) || known.has(key)) continue;
        const recorded = business.get(key);
        const named = filenameTime(image.name || image.url.split('/').pop(), now);
        const fileTimes = [timestamp(image.mtime), timestamp(image.birthtime)].filter(Boolean);
        const createdAt = recorded?.time ?? named ?? (fileTimes.length ? Math.min(...fileTimes) : now);
        const source = recorded?.source ?? (named ? 'filename' : fileTimes.length ? 'file' : 'first_seen');
        insert.run(key, createdAt, source);
        known.set(key, select.get(key).created_at_ms);
      }
    })();
  }
  for (const image of images) image.createdAt = known.get(galleryImageKey(image.url)) ?? timestamp(image.mtime) ?? Date.now();
  return images;
}

export function forgetGalleryImageTime(url, db = getDb()) {
  const key = galleryImageKey(url);
  if (key) db.prepare('DELETE FROM gallery_image_times WHERE image_key = ?').run(key);
}

export function compareGalleryImages(a, b) {
  const timeOrder = b.createdAt - a.createdAt;
  if (timeOrder) return timeOrder;
  const aKey = galleryImageKey(a.url) || a.url;
  const bKey = galleryImageKey(b.url) || b.url;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}
