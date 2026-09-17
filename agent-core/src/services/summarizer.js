/**
 * 滚动摘要生成器
 *
 * 每个会话每 10 条 assistant 消息触发一次摘要生成（含主动聊天消息）。
 * 新摘要 = LLM(上一段摘要 + 记录窗口)；窗口与滑动窗口同拍：
 * 从摘要自己的 checkpoint 之后取记录，再按「最后 interval 条触发角色消息」截断，
 * 一次只总结刚滑出上下文窗口的那一批轮次（与记忆整理互相独立，不共享窗口起点）。
 * 滚动摘要只用于上下文压缩，不进入长期记忆索引。
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { DIRECT_IMG_LINE_RE, stripLegacyPromptJson } from '../utils/groupImagePrompt.js';
import { buildAnalysisUserContent, buildChatLogBlock, buildSharedAnalysisSystemPrompt } from './chatLogPrompt.js';

/**
 * 摘要前过滤生图 prompt：
 * - 旧格式 {"prompt":"..."} JSON 块：只移除块本身，保留同一行里的对话文本；
 * - 群聊新格式 {description} 或 [名字]: {description}：整行剔除。
 */
export function stripPromptJson(content, { groupFormat = false } = {}) {
  let text = stripLegacyPromptJson(content);
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    const separator = trimmed.match(/^\[?[^:：\[\]]{1,20}\]?\s*[:：]\s*([\s\S]*)$/);
    const body = (separator ? separator[1] : trimmed).trim();
    if (!body) return null;
    if (groupFormat) {
      const direct = body.match(DIRECT_IMG_LINE_RE);
      if (direct) {
        const prompt = direct[1].trim();
        if (prompt && !/^["'“”]?prompt["'“”]?\s*:/i.test(prompt)) return null;
      }
    }
    return line;
  }).filter(line => line !== null && line.trim() !== '').join('\n');
}

/** 去掉末尾还没有 assistant 回复的 user 消息（群聊流式回复未完成的一轮）。 */
export function trimUnrepliedUserMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let end = list.length;
  while (end > 0 && list[end - 1].role === 'user') end--;
  return list.slice(0, end);
}

const SUMMARIZE_INTERVAL = 10; // 每 10 条 assistant 消息触发一次

// 顺序即缓存：<chat_log> 排在任务与变量之前（见 buildSummaryMessages），这里只留后置部分
const SUMMARY_TASK_PROMPT = `【上一段摘要】（更早的对话，已压缩过，不要重复它已经写明的信息）
{{previous_summary}}

你是对话摘要生成器。请以第三人称、客观分析师的角度工作，禁止使用任何角色扮演语气、禁止对用户说话、禁止输出情感回应。

把 <chat_log> 里的这段对话压缩成 200-400 字的摘要，只保留关键信息：讨论的主要话题、达成的结论、重要的用户信息、未完成的事项。
只输出这段摘要本身，不要前缀、标题或解释。`;

/**
 * 摘要的完整请求：与记忆整理共用同一份共享 system 块、同一份 <chat_log> 渲染，
 * 且记录块同样排在任务之前。记录正文只在两边恰好取到同一批消息时才逐字节一致，
 * 其余情况共享的是 system 块与前缀结构。
 */
export function buildSummaryMessages({ previousSummary = '', chatLogBlock = '' } = {}) {
  const task = SUMMARY_TASK_PROMPT.replace('{{previous_summary}}', previousSummary || '（新对话开始）');
  return [
    { role: 'system', content: buildSharedAnalysisSystemPrompt() },
    { role: 'user', content: buildAnalysisUserContent(chatLogBlock, task) },
  ];
}

/**
 * 摘要批次的起点下标：从末尾往前数到第 interval 条触发角色消息。
 *
 * 摘要与「携带上下文消息记忆轮数」（滑动窗口）同拍：窗口滑出多少，就总结多少。
 * 不足 interval 条时返回 -1，调用方视为「还不需要摘要」。
 * 纯函数，刻意不依赖 DB / LLM，便于单测。
 */
export function pickSummaryBatchStart(messages, { triggerRole = 'assistant', interval = SUMMARIZE_INTERVAL } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const step = Number.isInteger(interval) && interval > 0 ? interval : SUMMARIZE_INTERVAL;
  let triggerCount = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role !== triggerRole) continue;
    triggerCount++;
    if (triggerCount >= step) return i;
  }
  return -1;
}

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
  // 默认按 assistant 消息计数；群聊按每轮一条 assistant raw 计数（用户/主动/冷场都算一轮）。
  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role = ?
  `).get(conversationId, checkpointEndId, triggerRole);

  if (count < interval) return null;

  const previousSummary = lastSummary?.summary || '（新对话开始）';
  // 取摘要自己的 checkpoint 之后的记录。起点固定为 checkpointEndId，
  // 不跟随记忆整理的 checkpoint —— 整理点一旦停滞，窗口会回溯上千条消息。
  const allUnsummarized = db.prepare(`
    SELECT id, role, content FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user','assistant')
    ORDER BY id ASC
  `).all(conversationId, checkpointEndId);

  // 群聊按用户轮次计数时，用户消息在 LLM 流式回复开始前就已写库；
  // 末尾若还有未收到 assistant 回复的 user，说明该轮还没输出完，不参与摘要。
  const completedMessages = trimUnrepliedUserMessages(allUnsummarized);

  // 截到「最后 interval 条触发角色消息」覆盖的那一段：正好是刚滑出上下文窗口的批次。
  // end_msg_id 随之推到该批末尾，旧数据不会重复进入下一次摘要。
  const batchStart = pickSummaryBatchStart(completedMessages, { triggerRole, interval });
  if (batchStart < 0) return null;
  const recentMessages = completedMessages.slice(batchStart);
  if (recentMessages.length === 0) return null;

  const chatLogBlock = buildChatLogBlock(recentMessages, { userName, characterName });

  // 调用 DeepSeek 生成摘要
  let summary;
  try {
    summary = await chatSync(
      buildSummaryMessages({ previousSummary, chatLogBlock }),
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
