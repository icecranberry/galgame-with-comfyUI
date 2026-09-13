// 角色图片聚合（共享服务）。
// 调用方：GET /api/characters/:id/recent-images（头像/立绘选取，按存在性过滤）、
//        GET /api/images/gallery?character=（相册按角色筛选，与磁盘扫描结果求交集）。
// 新增图片落库渠道时在 collectCharacterImageUrls 里加一个查询，两个入口同步生效。
import { getDb } from '../db/index.js';

/**
 * 收集某角色全部渠道的图片 URL（按新到旧、去重，不做磁盘存在性检查）。
 * @param {number|string} characterId
 * @param {{ limit?: number }} opts 每个渠道的查询条数上限；选取器场景用默认值，
 *        相册筛选场景传大值以避免漏掉老图
 * @returns {string[]}
 */
export function collectCharacterImageUrls(characterId, { limit = 120 } = {}) {
  const db = getDb();
  const characterIdNum = Number(characterId);
  const conversationId = `char_${characterId}`;

  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (typeof u !== 'string' || !u.trim() || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  // 1. 生图任务登记：所有以 char_{id} 为前缀的渠道（私聊配图 / 送礼 / 主动聊天 / 立绘 /
  //    日程拍照 / AI 头像 / 奇遇 / 朋友圈 / 信箱 / 梦境等），新到旧统一收口
  const taskRows = db.prepare(`
    SELECT output_paths FROM image_tasks
    WHERE status = 'done' AND output_paths IS NOT NULL
      AND (conversation_id = ? OR conversation_id GLOB ?)
    ORDER BY COALESCE(finished_at, created_at) DESC LIMIT ?
  `).all(conversationId, `${conversationId}_*`, limit);
  for (const row of taskRows) {
    try {
      for (const u of JSON.parse(row.output_paths)) push(u);
    } catch {}
  }

  // 2. 私聊气泡配图（兜底：用户上传、未登记任务的图片）
  const chatRows = db.prepare(`
    SELECT images FROM messages
    WHERE conversation_id = ? AND images IS NOT NULL
    ORDER BY id DESC LIMIT ?
  `).all(conversationId, limit);
  for (const row of chatRows) {
    try {
      for (const u of JSON.parse(row.images)) push(u);
    } catch {}
  }

  // 3. 朋友圈配图（新图已入 image_tasks，这里兜底老数据）
  const momentRows = db.prepare(`
    SELECT images FROM moment_posts
    WHERE character_id = ? AND status = 'done' AND images IS NOT NULL
    ORDER BY created_at DESC LIMIT ?
  `).all(characterIdNum, limit);
  for (const row of momentRows) {
    try {
      for (const u of JSON.parse(row.images)) push(u);
    } catch {}
  }

  // 4. 表情包
  const emojiRows = db.prepare(`
    SELECT image_path FROM character_emojis
    WHERE character_id = ? AND status = 'done' AND image_path IS NOT NULL AND image_path != ''
    ORDER BY id DESC LIMIT ?
  `).all(characterIdNum, limit);
  for (const row of emojiRows) push(row.image_path);

  // 5. 梦境配图
  const dreamRows = db.prepare(`
    SELECT image_path FROM character_dreams
    WHERE character_id = ? AND image_path IS NOT NULL AND image_path != ''
    ORDER BY id DESC LIMIT ?
  `).all(characterIdNum, limit);
  for (const row of dreamRows) push(row.image_path);

  // 6. 奇遇事件图（当前事件 + 历史结案图）
  const eventRows = db.prepare(`
    SELECT image AS u, created_at AS t FROM character_events
    WHERE character_id = ? AND image IS NOT NULL AND image != ''
    UNION ALL
    SELECT final_image AS u, ended_at AS t FROM event_history
    WHERE character_id = ? AND final_image IS NOT NULL AND final_image != ''
    ORDER BY t DESC LIMIT ?
  `).all(characterIdNum, characterIdNum, limit);
  for (const row of eventRows) push(row.u);

  // 7. 信箱信件（角色画像与插图；信纸底纹 paper_path 不属于角色图，不收录）
  const mailRows = db.prepare(`
    SELECT portrait_path, illustration_path FROM mailbox_letters
    WHERE character_id = ?
      AND ((portrait_path IS NOT NULL AND portrait_path != '')
        OR (illustration_path IS NOT NULL AND illustration_path != ''))
    ORDER BY created_at DESC LIMIT ?
  `).all(characterIdNum, limit);
  for (const row of mailRows) {
    push(row.portrait_path);
    push(row.illustration_path);
  }

  // 8. 角色当前头像与立绘
  const char = db.prepare('SELECT avatar_path, standing_url FROM characters WHERE id = ?').get(characterIdNum);
  if (char) {
    push(char.avatar_path);
    push(char.standing_url);
  }

  return urls;
}
