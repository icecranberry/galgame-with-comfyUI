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
export function buildChatContext({ stableBlocks = [], summaryBlock = null, history = [], dynamicBlocks = [], userPrefix = '' } = {}) {
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
  const prefixText = String(userPrefix || '').trim();
  if (dynamicText || prefixText) {
    const reverseIdx = [...messages].reverse().findIndex(m => m.role === 'user');
    if (reverseIdx >= 0) {
      const latestUserIdx = messages.length - 1 - reverseIdx;
      const originalContent = messages[latestUserIdx].content;
      const dynamicPart = dynamicText
        ? `<dynamic_context>\n${dynamicText}\n</dynamic_context>\n\n${originalContent}`
        : originalContent;
      messages[latestUserIdx] = {
        role: 'user',
        content: prefixText ? `${prefixText}\n\n${dynamicPart}` : dynamicPart,
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

// ── 阶段四：dynamicBlocks token 预算（docs/memory-upgrade-plan.md §7.1）──
//
// stableBlocks 不预算（必留，前缀缓存友好性不动）；只对 dynamicBlocks 生效。
// 降级顺序（逐级生效，全程有 degraded 记录，无静默截断）：
//   1. <active_chat_history> 轮数减半（保留较新的后半）
//   2. <rag_memories>/<memory_recall_result> 条目裁到 3 条（重新编号）
//   3. 按优先级从尾部整块丢弃（低优先级先丢；rag 类块永不丢弃）

export function estimateTokens(text = '') {
  const s = String(text ?? '');
  if (!s) return 0;
  let cjk = 0;
  let other = '';
  for (const ch of s) {
    if (/[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff\u2018\u2019\u201c\u201d]/.test(ch)) cjk++;
    else other += ch;
  }
  const words = other.trim() ? other.trim().split(/\s+/).length : 0;
  return Math.ceil(cjk / 1.6 + words * 1.3);
}

// 块优先级：数值越小越重要（rag 类永不整块丢弃）
const BLOCK_PRIORITY = Object.freeze({
  rag_memories: 1,
  memory_recall_result: 1,
  time_context: 2,
  active_chat_history: 3,
});
const DEFAULT_BLOCK_PRIORITY = 4;

export function blockTag(block) {
  const match = String(block || '').match(/^\s*<([a-z_]+)>/i);
  return match ? match[1].toLowerCase() : null;
}

// <active_chat_history> 内层行减半：保留较新的后半（历史行格式 `[名字]: 内容`）
function halveActiveHistory(block) {
  const lines = String(block).split('\n');
  if (lines.length < 3 || !lines[0].includes('<active_chat_history>')) return null;
  const closing = lines[lines.length - 1].includes('</active_chat_history>') ? lines.pop() : null;
  const inner = lines.slice(1);
  if (inner.length < 2) return null;
  const kept = inner.slice(Math.floor(inner.length / 2));
  const next = ['<active_chat_history>', ...kept];
  if (closing) next.push(closing);
  return next.join('\n');
}

// rag 类块条目裁剪：只保留前 maxItems 条编号行（重新编号），非编号行（收尾防呆语）原样保留
function trimNumberedBlock(block, maxItems = 3) {
  const lines = String(block).split('\n');
  const bodyStart = lines.findIndex(line => /^\d+\.\s/.test(line));
  if (bodyStart < 0) return null;
  const numbered = [];
  const tail = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (/^\d+\.\s/.test(lines[i])) numbered.push(lines[i]);
    else tail.push(lines[i]);
  }
  if (numbered.length <= maxItems) return null;
  const kept = numbered.slice(0, maxItems).map((line, index) => line.replace(/^\d+\./, `${index + 1}.`));
  const next = [...lines.slice(0, bodyStart), ...kept, ...tail];
  return next.join('\n');
}

/**
 * 对 dynamicBlocks 应用 token 预算。纯函数（不修改入参数组）。
 * @returns {{ blocks: string[], tokensBefore: number, tokensAfter: number, degraded: string[] }}
 */
export function applyContextBudget({ blocks = [], budgetTokens = 8000 } = {}) {
  const working = blocks.map(String);
  const totalOf = (arr) => arr.reduce((sum, block) => sum + estimateTokens(block), 0);
  const tokensBefore = totalOf(working);
  const degraded = [];
  if (tokensBefore <= budgetTokens) {
    return { blocks: working, tokensBefore, tokensAfter: tokensBefore, degraded };
  }

  // 降级 1：活跃历史轮数减半
  const historyIdx = working.findIndex(block => blockTag(block) === 'active_chat_history');
  if (historyIdx >= 0) {
    const halved = halveActiveHistory(working[historyIdx]);
    if (halved) {
      working[historyIdx] = halved;
      degraded.push('active_chat_history 轮数减半');
    }
  }
  let tokensAfter = totalOf(working);
  if (tokensAfter <= budgetTokens) return { blocks: working, tokensBefore, tokensAfter, degraded };

  // 降级 2：rag 类块条目裁到 3 条
  for (let i = 0; i < working.length; i++) {
    const tag = blockTag(working[i]);
    if (tag === 'rag_memories' || tag === 'memory_recall_result') {
      const trimmed = trimNumberedBlock(working[i], 3);
      if (trimmed) {
        working[i] = trimmed;
        degraded.push(`${tag} 条目裁至 3 条`);
      }
    }
  }
  tokensAfter = totalOf(working);
  if (tokensAfter <= budgetTokens) return { blocks: working, tokensBefore, tokensAfter, degraded };

  // 降级 3：按优先级从尾部整块丢弃（低优先级先丢；同优先级靠后的先丢；rag 类不丢）
  const droppable = working
    .map((block, index) => ({ index, priority: BLOCK_PRIORITY[blockTag(block)] ?? DEFAULT_BLOCK_PRIORITY, tag: blockTag(block) }))
    .filter(item => item.priority > 1)
    .sort((a, b) => a.priority - b.priority || b.index - a.index);
  const dropped = new Set();
  for (const item of droppable) {
    tokensAfter -= estimateTokens(working[item.index]);
    dropped.add(item.index);
    degraded.push(`整块丢弃 <${item.tag || '无标签块'}>`);
    if (tokensAfter <= budgetTokens) break;
  }
  return { blocks: working.filter((_, index) => !dropped.has(index)), tokensBefore, tokensAfter, degraded };
}


