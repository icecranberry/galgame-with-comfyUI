/**
 * 滚动摘要生成器
 *
 * 每个会话每 50 条消息触发一次摘要生成。
 * 新摘要 = LLM(上一段摘要 + 最近 50 条消息)。
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';

const SUMMARIZE_INTERVAL = 50; // 每 50 条消息触发一次

const SUMMARY_PROMPT = `你是一个对话摘要生成器。请将以下对话片段压缩为 200-400 字的摘要，只保留关键信息：

{{previous_summary}}

最近的对话：
{{recent_messages}}

请生成一段连贯的摘要，包含：讨论的主要话题、达成的结论、重要的用户信息、未完成的事项。
只返回摘要文本，不要加前缀。`;

/**
 * 检查是否需要生成摘要，如果是则触发
 *
 * @param {string} conversationId
 * @returns {Promise<string|null>} 新摘要内容，如果不需要则为 null
 */
export async function maybeSummarize(conversationId) {
  const db = getDb();

  // 统计该会话的消息总数（完整消息，非气泡）
  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM raw_messages
    WHERE conversation_id = ? AND is_deleted = 0 AND role IN ('user', 'assistant')
  `).get(conversationId);

  // 统计已有的摘要数量
  const { summary_count } = db.prepare(`
    SELECT COUNT(*) as summary_count FROM rolling_summaries
    WHERE conversation_id = ?
  `).get(conversationId);

  // 计算是否需要生成新摘要
  const coveredMessages = summary_count * SUMMARIZE_INTERVAL;
  if (count - coveredMessages < SUMMARIZE_INTERVAL) {
    return null; // 还没到阈值
  }

  // 获取上一段摘要
  const lastSummary = db.prepare(`
    SELECT summary FROM rolling_summaries
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  const previousSummary = lastSummary?.summary || '（新对话开始）';

  // 确定要摘要的消息范围
  const startId = coveredMessages === 0
    ? null
    : db.prepare(`
        SELECT end_msg_id FROM rolling_summaries
        WHERE conversation_id = ? ORDER BY id DESC LIMIT 1
      `).get(conversationId)?.end_msg_id || null;

  // 获取最近 50 条完整消息
  let recentMessages;
  if (startId) {
    recentMessages = db.prepare(`
      SELECT role, content FROM raw_messages
      WHERE conversation_id = ? AND is_deleted = 0 AND id > ? AND role IN ('user','assistant')
      ORDER BY id ASC LIMIT ?
    `).all(conversationId, startId, SUMMARIZE_INTERVAL);
  } else {
    recentMessages = db.prepare(`
      SELECT role, content FROM raw_messages
      WHERE conversation_id = ? AND is_deleted = 0 AND role IN ('user','assistant')
      ORDER BY id ASC LIMIT ?
    `).all(conversationId, SUMMARIZE_INTERVAL);
  }

  if (recentMessages.length === 0) return null;

  const recentText = recentMessages
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n');

  // 调用 DeepSeek 生成摘要
  let summary;
  try {
    summary = await chatSync(
      [{
        role: 'user',
        content: SUMMARY_PROMPT
          .replace('{{previous_summary}}', previousSummary)
          .replace('{{recent_messages}}', recentText),
      }],
      { temperature: 0.5, max_tokens: 800 }
    );
  } catch (err) {
    console.error('[summarizer] generation failed:', err.message);
    return null;
  }

  // 确定消息 ID 范围
  const firstMsg = recentMessages[0];
  const lastMsg = recentMessages[recentMessages.length - 1];

  // 获取实际的消息 ID（raw_messages）
  const rangeStart = db.prepare(`
    SELECT id FROM raw_messages WHERE conversation_id = ? AND is_deleted = 0
    ORDER BY id ASC LIMIT 1 OFFSET ?
  `).get(conversationId, coveredMessages);

  const rangeEnd = db.prepare(`
    SELECT id FROM raw_messages WHERE conversation_id = ? AND is_deleted = 0
    ORDER BY id ASC LIMIT 1 OFFSET ?
  `).get(conversationId, count - 1);

  // 保存摘要
  db.prepare(`
    INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary)
    VALUES (?, ?, ?, ?)
  `).run(conversationId, rangeStart?.id || 0, rangeEnd?.id || 0, summary);

  console.log(`[summarizer] generated summary #${summary_count + 1} for conv ${conversationId} (${count} msgs)`);

  return summary;
}

/**
 * 获取会话的最近摘要（用于构建 system prompt）
 */
export function getRecentSummaries(conversationId, limit = 3) {
  const db = getDb();
  return db.prepare(`
    SELECT summary FROM rolling_summaries
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(conversationId, limit);
}
