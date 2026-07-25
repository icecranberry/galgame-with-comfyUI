import crypto from 'node:crypto';
import { stripPromptJson } from './summarizer.js';

export const PROMPT_REVISION = 'chat-context-v3';
export const MAX_UNCOMPACTED_MESSAGES = 60;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function stableSerialize(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function cloneMessage(message) {
  return { role: message.role, content: String(message.content ?? '') };
}

/**
 * 组装模型请求上下文。
 *
 * @param {string[]}  stableBlocks   稳定前缀：数组每项为一整条 system content，顺序即为请求中 system 顺序
 * @param {string}    [summaryBlock] 最新摘要文本（可选），置于稳定块之后、历史之前
 * @param {object[]}  history        不可变历史消息数组，[{ role, content }]
 * @param {string[]}  dynamicBlocks  本轮动态上下文块，会以 <dynamic_context> 标签附加到最新 user 消息尾部
 * @returns {{ messages: object[], metadata: object }}
 */
export function buildChatContext({ stableBlocks = [], summaryBlock = null, history = [], dynamicBlocks = [] } = {}) {
  const stableMessages = stableBlocks.filter(Boolean).map(content => ({ role: 'system', content: String(content) }));
  const historyMessages = history.map(cloneMessage);

  // 摘要块放在稳定块之后、历史之前
  let summaryMessage = null;
  if (summaryBlock) {
    summaryMessage = { role: 'system', content: String(summaryBlock) };
  }

  const messages = [];
  messages.push(...stableMessages);
  if (summaryMessage) messages.push(summaryMessage);
  messages.push(...historyMessages);

  // 动态上下文块附加到最新 user 消息
  const dynamicText = dynamicBlocks.filter(Boolean).join('\n\n');
  if (dynamicText) {
    const reverseIdx = [...messages].reverse().findIndex(m => m.role === 'user');
    if (reverseIdx >= 0) {
      const latestUserIdx = messages.length - 1 - reverseIdx;
      const originalContent = messages[latestUserIdx].content;
      messages[latestUserIdx] = {
        role: 'user',
        content: `<dynamic_context>\n${dynamicText}\n</dynamic_context>\n\n${originalContent}`,
      };
    }
  }

  // hash：稳定前缀不含摘要和历史
  const stablePrefixHash = sha256(stableSerialize(stableMessages));
  // 完整前缀含摘要
  const fullPrefixMessages = [...stableMessages];
  if (summaryMessage) fullPrefixMessages.push(summaryMessage);
  const fullPrefixHash = sha256(stableSerialize(fullPrefixMessages));
  // 历史 hash
  const historyPrefixHash = sha256(stableSerialize(historyMessages));
  // 最终请求 hash
  const requestHash = sha256(stableSerialize(messages));

  return {
    messages,
    metadata: {
      revision: PROMPT_REVISION,
      stablePrefixHash,
      fullPrefixHash,
      historyPrefixHash,
      requestHash,
      dynamicSnapshot: dynamicText,
    },
  };
}

/**
 * 从 DB 读取 checkpoint 摘要及之后的不可变历史。
 * checkpoint 为 rolling_summaries 中最新一条带有效 end_msg_id 的记录。
 */
export function getCheckpointHistory(db, conversationId, maxMessages = MAX_UNCOMPACTED_MESSAGES) {
  const checkpoint = db.prepare(`
    SELECT id, end_msg_id, summary
    FROM rolling_summaries
    WHERE conversation_id = ? AND end_msg_id > 0 AND checkpoint_version = 1
    ORDER BY end_msg_id DESC, id DESC LIMIT 1
  `).get(conversationId);

  // 正常情况下摘要每 ~20 条消息（10 条 assistant）推进；60 条上限只在连续摘要失败时兜底，避免请求无限增长。
  const history = db.prepare(`
    SELECT role, content, created_at FROM (
      SELECT id, role, content, created_at
      FROM raw_messages
      WHERE conversation_id = ? AND id > ? AND role IN ('user', 'assistant')
      ORDER BY id DESC LIMIT ?
    )
    ORDER BY id ASC
  `).all(conversationId, checkpoint?.end_msg_id || 0, maxMessages);

  return { checkpoint, history };
}

/**
 * 获取二分历史：按分界线拆分为 checkpoint 历史 + 活跃聊天历史（滑动窗口）。
 *
 * checkpoint 边界由 rolling_summaries.end_msg_id 决定：
 *   - id > end_msg_id  → unsummarized（活跃侧）
 *   - id ≤ end_msg_id  → summarized（已摘要，可进入 checkpoint 历史）
 *
 * 活跃窗口取最新的 unsummarized 轮次（0~maxActiveRounds），
 * checkpoint 历史取 summarized 轮次补足到 maxTotalRounds。
 *
 * @param {object} db
 * @param {string} conversationId
 * @param {number} [maxActiveRounds=10]  活跃聊天历史最多保留轮数
 * @param {number} [maxCheckpointRounds=10] checkpoint 历史保留 assistant 条数
 * @returns {{ checkpoint, checkpointHistory, checkpointRounds, activeText, activeRounds }}
 */
export function getSplitHistory(db, conversationId, maxActiveRounds = 10, maxCheckpointRounds = 10, { userName = 'user', characterName = 'assistant' } = {}) {
  // 1. 找到最新摘要分界线（冻结点）
  const checkpoint = db.prepare(`
    SELECT id, end_msg_id, summary
    FROM rolling_summaries
    WHERE conversation_id = ? AND end_msg_id > 0 AND checkpoint_version = 1
    ORDER BY end_msg_id DESC, id DESC LIMIT 1
  `).get(conversationId);

  const afterId = checkpoint?.end_msg_id || 0;

  // ── 2. 活跃窗口：未摘要消息 (id > afterId)，按时间顺序，最多显示 maxActiveRounds 条 assistant ──
  const tailMsgs = [];
  const activeFetchLimit = maxActiveRounds * 3; // 覆盖 10 条 assistant + 穿插的 user
  const activeRaw = db.prepare(`
    SELECT id, role, content FROM (
      SELECT id, role, content FROM raw_messages
      WHERE conversation_id = ? AND id > ? AND role IN ('user', 'assistant')
      ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC
  `).all(conversationId, afterId, activeFetchLimit);

  // 剔除末尾未回复的 user 消息（当前输入），不计入活跃窗口
  const unrepliedUser = activeRaw.length > 0 && activeRaw[activeRaw.length - 1].role === 'user'
    ? activeRaw.pop() : null;
  if (unrepliedUser) {
    tailMsgs.push({ role: 'user', content: stripPromptJson(unrepliedUser.content) });
  }

  // 从尾部向前数 maxActiveRounds 条 assistant，截取对应消息段
  let activeAsstCount = 0;
  let activeSliceStart = activeRaw.length;
  for (let i = activeRaw.length - 1; i >= 0; i--) {
    if (activeRaw[i].role === 'assistant') {
      activeAsstCount++;
      if (activeAsstCount >= maxActiveRounds) { activeSliceStart = i; break; }
    }
  }
  // assistant 不足 maxActiveRounds 条时，取全部消息
  if (activeSliceStart === activeRaw.length) activeSliceStart = 0;
  const displayMsgs = activeRaw.slice(activeSliceStart);
  const activeRounds = displayMsgs.filter(m => m.role === 'assistant').length;

  let activeText = '';
  if (displayMsgs.length > 0) {
    const lines = displayMsgs.map(m => {
      const label = m.role === 'user' ? `[${userName}]` : `[${characterName}]`;
      return `${label}: ${stripPromptJson(m.content)}`;
    });
    activeText = `<active_chat_history>\n${lines.join('\n')}\n</active_chat_history>`;
  }

  // ── 3. checkpoint 历史：已摘要消息 (id ≤ afterId)，固定 10 条 assistant ──
  let checkpointHistory = [];
  let checkpointRounds = 0;

  if (afterId > 0) {
    const checkpointFetchLimit = maxCheckpointRounds * 3; // 覆盖 10 条 assistant
    const checkpointRaw = db.prepare(`
      SELECT id, role, content FROM (
        SELECT id, role, content FROM raw_messages
        WHERE conversation_id = ? AND id <= ? AND role IN ('user', 'assistant')
        ORDER BY id DESC LIMIT ?
      ) ORDER BY id ASC
    `).all(conversationId, afterId, checkpointFetchLimit);

    // 从尾部向前数 10 条 assistant，截取对应消息段
    let asstCount = 0;
    let sliceStart = checkpointRaw.length;
    for (let i = checkpointRaw.length - 1; i >= 0; i--) {
      if (checkpointRaw[i].role === 'assistant') {
        asstCount++;
        if (asstCount >= maxCheckpointRounds) { sliceStart = i; break; }
      }
    }
    // assistant 不足 maxCheckpointRounds 条时，取全部消息
    if (sliceStart === checkpointRaw.length) sliceStart = 0;

    const checkpointMsgs = checkpointRaw.slice(sliceStart);
    checkpointRounds = asstCount;
    checkpointHistory = checkpointMsgs.map(m => ({
      role: m.role,
      content: stripPromptJson(m.content),
    }));
  }

  // ── 4. 追加当前用户消息到 history 末尾 ──
  checkpointHistory.push(...tailMsgs);

  return {
    checkpoint,
    checkpointHistory,
    checkpointRounds,
    activeText,
    activeRounds,
  };
}


