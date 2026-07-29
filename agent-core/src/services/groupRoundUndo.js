import { getDb } from '../db/index.js';
import { deleteVector } from './vectorClient.js';
import { deleteImageFileByUrl } from './imagePaths.js';

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
  const group = db.prepare(`
    SELECT id, COALESCE(rag_last_extracted_raw_id, 0) AS rag_last_extracted_raw_id
    FROM group_chats WHERE id = ?
  `).get(groupId);
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

  const fragmentRows = db.prepare(`
    SELECT id, chroma_id, source_msg_id, source_raw_start_id, source_raw_end_id
    FROM memory_fragments
    WHERE conversation_id = ? AND (
      (source_raw_start_id IS NOT NULL AND source_raw_end_id IS NOT NULL
        AND source_raw_start_id <= ? AND source_raw_end_id >= ?)
      ${messageIdClause ? `OR source_msg_id IN (${messageIdClause})` : ''}
    )
  `).all(conversationId, round.endRawId, round.startRawId, ...messageIds);

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
    if (fragmentRows.length > 0) {
      const ids = fragmentRows.map(row => row.id);
      db.prepare(`DELETE FROM memory_fragments WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }
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

    const previousRawId = db.prepare(`
      SELECT COALESCE(MAX(id), 0) AS id FROM raw_messages
      WHERE conversation_id = ? AND id < ?
    `).get(conversationId, round.startRawId).id;
    let ragBoundary = group.rag_last_extracted_raw_id >= round.startRawId
      ? previousRawId
      : group.rag_last_extracted_raw_id;

    const rangedStarts = fragmentRows.map(row => row.source_raw_start_id).filter(Number.isInteger);
    if (rangedStarts.length > 0) {
      const firstAffectedRawId = Math.min(...rangedStarts);
      ragBoundary = db.prepare(`
        SELECT COALESCE(MAX(id), 0) AS id FROM raw_messages
        WHERE conversation_id = ? AND id < ?
      `).get(conversationId, firstAffectedRawId).id;
    } else if (fragmentRows.some(row => !row.source_raw_start_id)) {
      ragBoundary = 0;
    }

    const pendingRounds = countCompletedUserRounds(db, conversationId, ragBoundary);
    const lastMessageAt = db.prepare(`
      SELECT MAX(created_at) AS value FROM messages WHERE conversation_id = ?
    `).get(conversationId).value;
    db.prepare(`
      UPDATE group_chats
      SET rag_last_extracted_raw_id = ?, rag_user_rounds_pending = ?, last_message_at = ?
      WHERE id = ?
    `).run(ragBoundary, pendingRounds, lastMessageAt, groupId);

    return { ragBoundary, pendingRounds, lastMessageAt };
  });

  const state = transaction();
  await Promise.allSettled(
    fragmentRows.filter(row => row.chroma_id).map(row => deleteVector(row.chroma_id))
  );

  for (const url of imageUrls) {
    const stillReferenced = db.prepare(`SELECT 1 FROM messages WHERE images LIKE ? LIMIT 1`).get(`%${url}%`);
    if (stillReferenced) continue;
    try {
      deleteImageFileByUrl(url);
    } catch (err) {
      console.error(`[groups] failed to delete withdrawn image ${url}:`, err.message);
    }
  }

  if (imageUrls.length > 0) {
    import('../routes/images.js')
      .then(({ invalidateGalleryCache }) => invalidateGalleryCache())
      .catch(() => {});
  }

  return {
    ok: true,
    deleted: {
      type: round.type,
      raws: raws.filter(row => row.id >= round.startRawId && row.id <= round.endRawId).length,
      messages: messageRows.length,
      memories: fragmentRows.length,
      images: imageUrls.length,
    },
    lastMessageAt: state.lastMessageAt,
    ragBoundary: state.ragBoundary,
    pendingRounds: state.pendingRounds,
  };
}
