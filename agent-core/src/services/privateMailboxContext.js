export const MAILBOX_CONTEXT_AGE = '1 month';

/**
 * 私聊动态上下文用的近期信件。
 * 已完成往来按回信时间取最新；超过一个月的旧信不再作为聊天语料。
 * @param {import('better-sqlite3').Database} db
 */
export function listRecentMailboxLetters(db, {
  characterId,
  limit = 2,
  letterAge = MAILBOX_CONTEXT_AGE,
} = {}) {
  return db.prepare(`
    SELECT content, content_short, reply_content,
           CAST(julianday('now') - julianday(replied_at) AS INTEGER) AS days_ago
    FROM mailbox_letters
    WHERE character_id = ? AND direction = 'char_to_user' AND status = 'completed'
      AND content != '' AND reply_content != ''
      AND replied_at IS NOT NULL
      AND replied_at >= datetime('now', '-' || ?)
    ORDER BY replied_at DESC
    LIMIT ?
  `).all(characterId, letterAge, limit);
}
