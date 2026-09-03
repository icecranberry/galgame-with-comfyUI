import { getDb } from '../db/index.js';
import { rollbackMemoriesFromRawId } from './memory/memoryRepository.js';
import { deleteImageFileByUrl } from './imagePaths.js';
import { invalidateGalleryCache } from './galleryCache.js';

function parseImageUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function inferLastGroupRound(rawsDesc) {
  const raws = (rawsDesc || []).filter(row => row && (row.role === 'user' || row.role === 'assistant'));
  if (raws.length === 0) return null;

  const latest = raws[0];
  let startRawId = latest.id;
  let type = latest.role === 'assistant' ? 'assistant_only' : 'user_round';

  for (let index = 1; index < raws.length && raws[index].role === 'user'; index++) {
    startRawId = raws[index].id;
    type = 'user_round';
  }

  return { startRawId, endRawId: latest.id, type };
}

function countCompletedUserRounds(db, conversationId, afterRawId) {
  const rows = db.prepare(`
    SELECT role FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user', 'assistant')
    ORDER BY id ASC
  `).all(conversationId, afterRawId);

  let hasPendingUsers = false;
  let rounds = 0;
  for (const row of rows) {
    if (row.role === 'user') {
      hasPendingUsers = true;
    } else if (hasPendingUsers) {
      rounds++;
      hasPendingUsers = false;
    }
  }
  return rounds;
}

export async function undoLastGroupRound(groupId) {
  const db = getDb();
  const conversationId = `group_${groupId}`;
  const group = db.prepare(`SELECT id FROM group_chats WHERE id = ?`).get(groupId);
  if (!group) return { notFound: true };

  const raws = db.prepare(`
    SELECT id, role FROM raw_messages
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY id DESC
  `).all(conversationId);
  const round = inferLastGroupRound(raws);
  if (!round) return { ok: true, deleted: null, lastMessageAt: null };

  const messageRows = db.prepare(`
    SELECT id, images FROM messages
    WHERE conversation_id = ? AND raw_id BETWEEN ? AND ?
  `).all(conversationId, round.startRawId, round.endRawId);
  const messageIds = messageRows.map(row => row.id);
  const imageUrls = [...new Set(messageRows.flatMap(row => parseImageUrls(row.images)))];
  const messageIdClause = messageIds.length > 0 ? messageIds.map(() => '?').join(',') : null;

  const rolledBackMemories = rollbackMemoriesFromRawId(conversationId, round.startRawId);
  const checkpointBoundary = db.prepare(`
    SELECT COALESCE(last_raw_msg_id, 0) AS id
    FROM memory_extraction_checkpoints WHERE conversation_id = ?
  `).get(conversationId)?.id || 0;

  const linkedTaskRows = messageIdClause
    ? db.prepare(`SELECT id FROM image_tasks WHERE conversation_id = ? AND source_msg_id IN (${messageIdClause})`)
      .all(conversationId, ...messageIds)
    : [];
  const linkedTaskIds = new Set(linkedTaskRows.map(row => row.id));
  if (imageUrls.length > 0) {
    const legacyTasks = db.prepare(`
      SELECT id, output_paths FROM image_tasks
      WHERE conversation_id = ? AND source_msg_id IS NULL
    `).all(conversationId);
    for (const task of legacyTasks) {
      if (parseImageUrls(task.output_paths).some(url => imageUrls.includes(url))) linkedTaskIds.add(task.id);
    }
  }

  const transaction = db.transaction(() => {
    if (linkedTaskIds.size > 0) {
      const ids = [...linkedTaskIds];
      db.prepare(`DELETE FROM image_tasks WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ? AND end_msg_id >= ?`)
      .run(conversationId, round.startRawId);
    db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND raw_id BETWEEN ? AND ?`)
      .run(conversationId, round.startRawId, round.endRawId);
    db.prepare(`DELETE FROM raw_messages WHERE conversation_id = ? AND id BETWEEN ? AND ?`)
      .run(conversationId, round.startRawId, round.endRawId);

    const pendingRounds = countCompletedUserRounds(db, conversationId, checkpointBoundary);
    const lastMessageAt = db.prepare(`
      SELECT MAX(created_at) AS value FROM messages WHERE conversation_id = ?
    `).get(conversationId).value;
    db.prepare(`
      UPDATE group_chats
      SET rag_user_rounds_pending = ?, last_message_at = ?
      WHERE id = ?
    `).run(pendingRounds, lastMessageAt, groupId);

    return { ragBoundary: checkpointBoundary, pendingRounds, lastMessageAt };
  });

  const state = transaction();

  for (const url of imageUrls) {
    // 表情包是角色的共享资产，撤回消息不删文件
    if (String(url).includes('/images/emoji/')) continue;
    const stillReferenced = db.prepare(`SELECT 1 FROM messages WHERE images LIKE ? LIMIT 1`).get(`%${url}%`);
    if (stillReferenced) continue;
    try {
      deleteImageFileByUrl(url);
    } catch (err) {
      console.error(`[groups] failed to delete withdrawn image ${url}:`, err.message);
    }
  }

  if (imageUrls.length > 0) {
    try { invalidateGalleryCache(); } catch { /* 缓存失效失败不影响主流程 */ }
  }

  return {
    ok: true,
    deleted: {
      type: round.type,
      raws: raws.filter(row => row.id >= round.startRawId && row.id <= round.endRawId).length,
      messages: messageRows.length,
      memories: rolledBackMemories,
      images: imageUrls.length,
    },
    lastMessageAt: state.lastMessageAt,
    ragBoundary: state.ragBoundary,
    pendingRounds: state.pendingRounds,
  };
}
