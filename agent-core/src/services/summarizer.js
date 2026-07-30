/**
 * 滚动摘要生成器
 *
 * 每个会话每 10 条 assistant 消息触发一次摘要生成（含主动聊天消息）。
 * 新摘要 = LLM(上一段摘要 + 最近 10 轮对话)。
 * 滚动摘要只用于上下文压缩，不进入长期记忆索引。
 */

import { getDb, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';

/** 去掉消息中的 {"prompt":"..."} JSON 标签（可能在开头/中间/末尾），避免长篇英文生图 prompt 干扰摘要提取 */
export function stripPromptJson(content) {
  return content.replace(/\s*\{["']prompt["']:\s*"(?:[^"\\]|\\.)*"\s*\}/gs, '');
}

const SUMMARIZE_INTERVAL = 10; // 每 10 条 assistant 消息触发一次

const SUMMARY_PROMPT = `[系统指令] 你是一个纯信息提取工具，不是角色扮演角色。请以第三人称、客观分析师的角度工作，禁止使用任何角色扮演语气、禁止对用户说话、禁止输出情感回应。只输出被要求的结构化结果。

你是一个对话摘要生成器。请将以下对话片段压缩为 200-400 字的摘要，只保留关键信息。

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
/**
 * @param {string} conversationId
 * @param {{ characterName?: string, userName?: string, triggerRole?: 'user'|'assistant', interval?: number }} [nameHints]
 */
export async function maybeSummarize(conversationId, nameHints = {}) {
  const userName = nameHints.userName || 'user';
  const characterName = nameHints.characterName || 'assistant';
  const triggerRole = nameHints.triggerRole === 'user' ? 'user' : 'assistant';
  const interval = Number.isInteger(nameHints.interval) && nameHints.interval > 0
    ? nameHints.interval
    : SUMMARIZE_INTERVAL;
  const db = getDb();

  // 最新摘要即 compaction checkpoint；只统计 checkpoint 之后的消息。
  const lastSummary = db.prepare(`
    SELECT id, summary, end_msg_id FROM rolling_summaries
    WHERE conversation_id = ? AND checkpoint_version = 1
    ORDER BY end_msg_id DESC, id DESC LIMIT 1
  `).get(conversationId);
  const checkpointEndId = lastSummary?.end_msg_id || 0;
  // 默认按 assistant 消息计数；群聊可改为按用户发言轮次计数。
  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role = ?
  `).get(conversationId, checkpointEndId, triggerRole);

  if (count < interval) return null;

  const previousSummary = lastSummary?.summary || '（新对话开始）';
  // 获取所有未摘要消息
  const allUnsummarized = db.prepare(`
    SELECT id, role, content FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user','assistant')
    ORDER BY id ASC
  `).all(conversationId, checkpointEndId);

  // 取最后 interval 条触发角色消息覆盖的消息段，afterId 推到末尾截断全部旧数据。
  let triggerCount = 0;
  let batchStart = 0;
  for (let i = allUnsummarized.length - 1; i >= 0; i--) {
    if (allUnsummarized[i].role === triggerRole) {
      triggerCount++;
      if (triggerCount >= interval) { batchStart = i; break; }
    }
  }
  const recentMessages = allUnsummarized.slice(batchStart);
  if (recentMessages.length === 0) return null;

  const recentText = recentMessages
    .map(m => {
      const label = m.role === 'user' ? userName : characterName;
      return `[${label}]: ${stripPromptJson(m.content)}`;
    })
    .join('\n');

  // 调用 DeepSeek 生成摘要
  let summary;
  try {
    summary = await chatSync(
      [
        { role: 'system', content: getSystemRules({ roleplay: false }) },
        {
          role: 'user',
          content: SUMMARY_PROMPT
            .replace('{{previous_summary}}', previousSummary)
            .replace('{{recent_messages}}', recentText),
        },
      ],
      { temperature: 0.5, max_tokens: 800, label: '对话摘要提取助手' }
    );
  } catch (err) {
    console.error('[summarizer] generation failed:', err.message);
    return null;
  }

  // 确定实际被摘要的消息 ID 范围。end_msg_id 必须取最后一条 assistant，不能取末尾 user。
  const firstMsg = recentMessages[0];
  const lastAsst = [...recentMessages].reverse().find(m => m.role === 'assistant');
  const lastMsg = lastAsst || recentMessages[recentMessages.length - 1];
  const summaryIndex = (db.prepare(`
    SELECT COUNT(*) AS count FROM rolling_summaries WHERE conversation_id = ?
  `).get(conversationId)?.count || 0) + 1;

  // 保存摘要
  db.prepare(`
    INSERT INTO rolling_summaries (conversation_id, start_msg_id, end_msg_id, summary, checkpoint_version)
    VALUES (?, ?, ?, ?, 1)
  `).run(conversationId, firstMsg.id, lastMsg.id, summary);

  console.log(`[summarizer] generated summary #${summaryIndex} for conv ${conversationId} (${recentMessages.length} msgs)`);

  return summary;
}

/**
 * 获取会话的最近摘要（用于构建 system prompt）
 * 返回包含 id / end_msg_id / summary 的记录数组。
 */
export function getRecentSummaries(conversationId, limit = 3) {
  const db = getDb();
  return db.prepare(`
    SELECT id, end_msg_id, summary FROM rolling_summaries
    WHERE conversation_id = ? AND end_msg_id > 0 AND checkpoint_version = 1
    ORDER BY end_msg_id DESC, id DESC LIMIT ?
  `).all(conversationId, limit);
}
