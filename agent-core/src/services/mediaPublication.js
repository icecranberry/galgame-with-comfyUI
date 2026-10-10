import { getDb } from '../db/index.js';
import { broadcast } from './unifiedStreamBus.js';

// NULL = 待发布；0 = 升级前已展示的旧内容（沿用 id 游标）；正数 = 实际发布顺序。
export const MEDIA_PUBLICATION_ORDER = 'COALESCE(NULLIF(p.published_seq, 0), p.id)';

export function mediaImagesReady(post) {
  let payload;
  try { payload = JSON.parse(post.payload_json || 'null'); } catch { return false; }
  const ready = item => !String(item?.image_prompt || '').trim() || !!item?.image;
  if (payload?.portal) return Array.isArray(payload.sections) && payload.sections.every(ready);
  return ready(post) && (!Array.isArray(payload?.panels) || payload.panels.every(ready));
}

export function isMediaPostPublished(postId) {
  return !!getDb().prepare('SELECT 1 FROM media_posts WHERE id = ? AND published_seq IS NOT NULL').get(postId);
}

/** 发布一次：配图齐全后才分配游标，晚完成的旧草稿仍排在最新位置。 */
export function publishMediaPostIfReady(postId) {
  const db = getDb();
  const published = db.transaction(() => {
    const post = db.prepare('SELECT * FROM media_posts WHERE id = ?').get(postId);
    if (!post || post.published_seq !== null || !mediaImagesReady(post)) return null;
    const previous = Number(db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'media_publication_sequence'").pluck().get()) || 0;
    const lastId = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'media_posts'").pluck().get() || 0;
    const seq = Math.max(previous, lastId) + 1;
    const payload = JSON.parse(post.payload_json || 'null');
    const cover = post.image || (payload?.portal ? payload.sections.find(section => section.image)?.image : null) || null;
    db.prepare("INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES ('media_publication_sequence', ?)").run(String(seq));
    db.prepare("UPDATE media_posts SET published_seq = ?, image = ?, image_status = 'done', image_error = NULL WHERE id = ? AND published_seq IS NULL").run(seq, cover, postId);
    return { outletId: post.outlet_id, postId, count: 1 };
  })();
  if (published) broadcast('media_new_posts', published);
  return !!published;
}
