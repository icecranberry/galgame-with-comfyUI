/**
 * 群聊 API
 *
 * GET    /api/groups                 群列表（含成员、未读数）
 * POST   /api/groups                 建群 { name?, topic?, member_ids }
 * PATCH  /api/groups/:id             改名/主题/成员调整
 * DELETE /api/groups/:id             解散（级联清理消息/记忆/摘要/向量）
 * GET    /api/groups/:id/messages    全部消息（含发言角色信息）
 * POST   /api/groups/:id/seen        清未读
 * POST   /api/groups/:id/chat        用户发言 → SSE 流式返回本轮剧本
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import {
  groupConvId, getGroupWithMembers, writeGroupUserMessage, runGroupRound, isGroupRoundRunning,
  truncateRoundAfter, invalidateGroupTranscriptBoundary, isGroupPostProcessing,
} from '../services/groupChatEngine.js';
import { undoLastGroupRound } from '../services/groupRoundUndo.js';
import { deleteByConversation } from '../services/vectorClient.js';
import { broadcast } from '../services/unifiedStreamBus.js';
import { beginTurn } from '../services/llmTelemetry.js';

const router = Router();

function toISODate(sqliteDT) {
  if (!sqliteDT) return sqliteDT;
  return sqliteDT.replace(' ', 'T') + '.000Z';
}

function serializeGroup(group) {
  const db = getDb();
  const unread = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE conversation_id = ? AND role = 'assistant' AND created_at > COALESCE(?, '1970-01-01')
  `).get(groupConvId(group.id), group.last_seen_at).c;
  return {
    id: group.id,
    name: group.name,
    topic: group.topic || '',
    created_by: group.created_by,
    creator_character_id: group.creator_character_id,
    idle_enabled: !!group.idle_enabled,
    last_message_at: toISODate(group.last_message_at),
    created_at: toISODate(group.created_at),
    unread,
    members: group.members.map(m => ({
      id: m.id, display_name: m.display_name, avatar_path: m.avatar_path,
    })),
  };
}

// GET /api/groups — 群列表
router.get('/', (req, res) => {
  const db = getDb();
  const groups = db.prepare(
    `SELECT * FROM group_chats ORDER BY last_message_at DESC NULLS LAST, id DESC`
  ).all();
  res.json({
    groups: groups.map(g => serializeGroup({ ...g, members: getGroupWithMembers(g.id)?.members || [] })),
  });
});

// POST /api/groups — 建群
router.post('/', (req, res) => {
  const { name, topic, member_ids } = req.body || {};
  if (!Array.isArray(member_ids) || member_ids.length < 2) {
    return res.status(400).json({ error: '群聊至少需要 2 个角色成员' });
  }
  const db = getDb();
  const chars = member_ids.map(id => db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(id)).filter(Boolean);
  if (chars.length < 2) {
    return res.status(400).json({ error: '成员角色不存在' });
  }

  const groupName = (name || '').trim() || chars.map(c => c.display_name).slice(0, 3).join('、') + (chars.length > 3 ? '等' : '') + '的群聊';
  const result = db.prepare(`
    INSERT INTO group_chats (name, topic, created_by, next_idle_at, last_seen_at)
    VALUES (?, ?, 'user', datetime('now', '+' || (60 + abs(random()) % 120) || ' minutes'), datetime('now'))
  `).run(groupName, (topic || '').trim());
  const groupId = result.lastInsertRowid;

  const insertMember = db.prepare(`INSERT OR IGNORE INTO group_members (group_id, character_id) VALUES (?, ?)`);
  for (const c of chars) insertMember.run(groupId, c.id);

  const group = getGroupWithMembers(groupId);
  res.json({ group: serializeGroup(group) });
});

// PATCH /api/groups/:id — 更新群设置
router.patch('/:id', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.id, 10);
  const group = db.prepare('SELECT * FROM group_chats WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: '群不存在' });

  const { name, topic, member_ids, add_member_ids, remove_member_ids } = req.body || {};

  let replacementMemberIds = null;
  if (member_ids !== undefined) {
    if (!Array.isArray(member_ids)) return res.status(400).json({ error: 'member_ids 必须是数组' });
    replacementMemberIds = [...new Set(member_ids.map(Number).filter(Number.isInteger))];
  } else if (Array.isArray(add_member_ids) || Array.isArray(remove_member_ids)) {
    const currentIds = db.prepare(`SELECT character_id FROM group_members WHERE group_id = ?`).pluck().all(groupId);
    const nextIds = new Set(currentIds);
    for (const id of (add_member_ids || []).map(Number).filter(Number.isInteger)) nextIds.add(id);
    for (const id of (remove_member_ids || []).map(Number).filter(Number.isInteger)) nextIds.delete(id);
    replacementMemberIds = [...nextIds];
  }

  if (replacementMemberIds !== null) {
    if (replacementMemberIds.length < 2) return res.status(400).json({ error: '群聊至少保留 2 个角色成员' });
    const placeholders = replacementMemberIds.map(() => '?').join(',');
    const validCount = db.prepare(`SELECT COUNT(*) AS c FROM characters WHERE id IN (${placeholders})`).get(...replacementMemberIds).c;
    if (validCount !== replacementMemberIds.length) return res.status(400).json({ error: '成员角色不存在' });
  }

  const updateGroup = db.transaction(() => {
    if (name !== undefined) db.prepare(`UPDATE group_chats SET name = ? WHERE id = ?`).run(String(name).trim() || group.name, groupId);
    if (topic !== undefined) db.prepare(`UPDATE group_chats SET topic = ? WHERE id = ?`).run(String(topic).trim(), groupId);
    if (replacementMemberIds !== null) {
      db.prepare(`DELETE FROM group_members WHERE group_id = ?`).run(groupId);
      const insert = db.prepare(`INSERT INTO group_members (group_id, character_id) VALUES (?, ?)`);
      for (const id of replacementMemberIds) insert.run(groupId, id);
    }
  });
  updateGroup();

  res.json({ group: serializeGroup(getGroupWithMembers(groupId)) });
});

// DELETE /api/groups/:id/messages/last-round — 撤回最后一轮用户消息和角色回复
router.delete('/:id/messages/last-round', async (req, res, next) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: '无效的群聊 ID' });
  if (isGroupRoundRunning(groupId)) {
    return res.status(409).json({ error: '当前回复或图片还没有生成完成，请稍后再撤回' });
  }
  if (isGroupPostProcessing(groupId)) {
    return res.status(409).json({ error: '正在整理本轮记忆，请稍后再撤回' });
  }

  try {
    const result = await undoLastGroupRound(groupId);
    if (result.notFound) return res.status(404).json({ error: '群不存在' });

    invalidateGroupTranscriptBoundary(groupId);
    broadcast('group_round_undone', {
      group_id: groupId,
      deleted: result.deleted,
      last_message_at: toISODate(result.lastMessageAt),
    });
    res.json({
      ...result,
      last_message_at: toISODate(result.lastMessageAt),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id — 解散群
router.delete('/:id', (req, res, next) => {
  const db = getDb();
  const groupId = parseInt(req.params.id, 10);
  const conversationId = groupConvId(groupId);
  try {
    db.prepare(`DELETE FROM memory_fragments WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM image_tasks WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM raw_messages WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM group_chats WHERE id = ?`).run(groupId);
    invalidateGroupTranscriptBoundary(groupId);
    deleteByConversation(conversationId).catch(err =>
      console.error(`[groups] chroma cleanup failed for ${conversationId}:`, err.message));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id/messages — 全部消息
router.get('/:id/messages', (req, res) => {
  const db = getDb();
  const groupId = parseInt(req.params.id, 10);
  const group = getGroupWithMembers(groupId);
  if (!group) return res.status(404).json({ error: '群不存在' });

  const messages = db.prepare(`
    SELECT m.id, m.role, m.content, m.images, m.seq, m.created_at,
           m.speaker_character_id, c.display_name AS speaker_name, c.avatar_path AS speaker_avatar
    FROM messages m
    LEFT JOIN characters c ON c.id = m.speaker_character_id
    WHERE m.conversation_id = ?
    ORDER BY m.id ASC
  `).all(groupConvId(groupId)).map(m => ({ ...m, created_at: toISODate(m.created_at) }));

  res.json({ group: serializeGroup(group), messages });
});

// POST /api/groups/:id/seen — 清未读
router.post('/:id/seen', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE group_chats SET last_seen_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// POST /api/groups/:id/nudge — 冷场续聊：用户在群里停留但没人说话，触发角色接着聊
// 消息经统一 SSE 总线（group_message）推送，本接口只返回结果统计
router.post('/:id/nudge', async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const group = getGroupWithMembers(groupId);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (isGroupRoundRunning(groupId)) return res.json({ ok: false, busy: true });

  beginTurn(groupConvId(groupId));
  try {
    const { messages, busy } = await runGroupRound(groupId, {
      trigger: 'lull',
      emit: (event, data) => {
        if (event === 'group_msg') broadcast('group_message', data);
        if (event === 'generate_start') broadcast('group_image_start', data);
        if (event === 'generate_done') broadcast('group_image_done', data);
        if (event === 'generate_error') broadcast('group_image_error', data);
      },
    });
    res.json({ ok: true, busy: !!busy, count: messages.length });
  } catch (err) {
    console.error(`[groups] nudge error for group ${groupId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/chat — 用户发言，SSE 返回本轮剧本
// body: { messages: [{text, client_msg_id}] } 或兼容旧版 { message, client_msg_id }
//       truncate_after_msg_id: 用户打断播放时，抛弃该 id 之后未上屏的分句（同步清库）
router.post('/:id/chat', async (req, res) => {
  const { message, client_msg_id, messages: batch, truncate_after_msg_id } = req.body || {};
  const items = Array.isArray(batch) && batch.length > 0
    ? batch.filter(m => m && typeof m.text === 'string' && m.text.trim())
    : (typeof message === 'string' && message.trim() ? [{ text: message, client_msg_id }] : []);
  if (items.length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  const groupId = parseInt(req.params.id, 10);
  const group = getGroupWithMembers(groupId);
  if (!group) return res.status(404).json({ error: '群不存在' });

  // 开启本轮 LLM 调用统计（剧本生成 + 生图 prompt + 摘要/记忆提取后处理）
  beginTurn(groupConvId(groupId));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  req.socket.setTimeout(0);
  res.setTimeout(0);
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // 打断截断：上一轮仍在生成时跳过（引擎还在写新行，删了也白删）
    if (Number.isInteger(truncate_after_msg_id) && !isGroupRoundRunning(groupId)) {
      truncateRoundAfter(groupId, truncate_after_msg_id);
    }

    for (const item of items) {
      const { msgId, duplicate } = writeGroupUserMessage(groupId, item.text, item.client_msg_id);
      send('msg_saved', {
        id: msgId, role: 'user', client_msg_id: item.client_msg_id || null,
        created_at: new Date().toISOString(), duplicate: !!duplicate,
      });
    }

    send('response_start', {});
    await runGroupRound(groupId, {
      trigger: 'user',
      userMessage: items.map(i => i.text).join('\n'),
      emit: (event, data) => {
        send(event, data);
        // 同步广播到统一 SSE 总线：其他页面（未打开该群）也能收到红点/新消息/图片
        if (event === 'group_msg') broadcast('group_message', data);
        if (event === 'generate_start') broadcast('group_image_start', data);
        if (event === 'generate_done') broadcast('group_image_done', data);
        if (event === 'generate_error') broadcast('group_image_error', data);
      },
    });
    send('response_end', {});
  } catch (err) {
    console.error(`[groups] chat error for group ${groupId}:`, err.message);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

export default router;
