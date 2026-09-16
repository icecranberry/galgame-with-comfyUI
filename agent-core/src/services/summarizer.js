/**
 * 滚动摘要生成器
 *
 * 每个会话每 10 条 assistant 消息触发一次摘要生成（含主动聊天消息）。
 * 新摘要 = LLM(上一段摘要 + 记录窗口)；窗口起点对齐记忆整理的 checkpoint（pickWindowStartId），
 * 两个调用取到同一段记录、渲染后逐字节一致，才能互相命中前缀缓存。
 * 滚动摘要只用于上下文压缩，不进入长期记忆索引。
 */

import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { DIRECT_IMG_LINE_RE, stripLegacyPromptJson } from '../utils/groupImagePrompt.js';
import { buildAnalysisUserContent, buildChatLogBlock, buildSharedAnalysisSystemPrompt } from './chatLogPrompt.js';
import { getCheckpoint } from './memory/memoryRepository.js';

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
 * 且记录块同样排在任务之前，两个调用因此能互相复用前缀缓存。
 */
export function buildSummaryMessages({ previousSummary = '', chatLogBlock = '' } = {}) {
  const task = SUMMARY_TASK_PROMPT.replace('{{previous_summary}}', previousSummary || '（新对话开始）');
  return [
    { role: 'system', content: buildSharedAnalysisSystemPrompt() },
    { role: 'user', content: buildAnalysisUserContent(chatLogBlock, task) },
  ];
}

/**
 * 摘要窗口起点：正常情况下与记忆整理的 checkpoint 对齐（两边记录正文逐字节一致，可互相命中前缀缓存）。
 * 记忆未启用、从未整理、或整理点反而落在摘要点之后（整理失败）时退回摘要自己的 checkpoint，保持原口径。
 */
export function pickWindowStartId({ summaryCheckpoint = 0, memoryCheckpoint = 0, memoryEnabled = false } = {}) {
  const summaryStart = summaryCheckpoint || 0;
  if (summaryStart <= 0 || !memoryEnabled) return summaryStart;
  const memoryStart = memoryCheckpoint || 0;
  return memoryStart > 0 && memoryStart < summaryStart ? memoryStart : summaryStart;
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

  // 窗口起点与记忆整理对齐；触发节奏仍按摘要自己的 checkpoint，不随整理走动。
  // 与整理链路的开关口径一致（chat.js / groupChatEngine 都按 truthy 判断）
  const memoryEnabled = !!config.features.memory;
  const windowStartId = pickWindowStartId({
    summaryCheckpoint: checkpointEndId,
    memoryCheckpoint: memoryEnabled ? (getCheckpoint(conversationId).last_raw_msg_id || 0) : 0,
    memoryEnabled,
  });
  const previousSummary = lastSummary?.summary || '（新对话开始）';
  // 获取窗口内的记录（与记忆整理同一段，渲染后逐字节一致）
  const allUnsummarized = db.prepare(`
    SELECT id, role, content FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND role IN ('user','assistant')
    ORDER BY id ASC
  `).all(conversationId, windowStartId);

  // 群聊按用户轮次计数时，用户消息在 LLM 流式回复开始前就已写库；
  // 末尾若还有未收到 assistant 回复的 user，说明该轮还没输出完，不参与摘要。
  //
  // 窗口整段交给模型，不再按「最后 interval 轮」截断：截断会让摘要与记忆整理的记录正文对不上，
  // 两边就无法复用前缀缓存。要总结的区间由【上一段摘要】＋「不要重复它已写明的信息」界定，
  // 窗口本身已由摘要触发间隔（对齐时由整理的 40 条阈值）兜住长度。
  const recentMessages = trimUnrepliedUserMessages(allUnsummarized);
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
