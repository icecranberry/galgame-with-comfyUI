import crypto from 'node:crypto';

export const PROMPT_REVISION = 'chat-context-v2';
export const MAX_UNCOMPACTED_MESSAGES = 80;

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

export function createPromptCacheKey(conversationId, revision = PROMPT_REVISION) {
  return `chat-${revision}-${sha256(conversationId).slice(0, 32)}`;
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
        content: `${originalContent}\n\n<dynamic_context>\n${dynamicText}\n</dynamic_context>`,
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

  // 正常情况下摘要每 20 条推进；80 条上限只在连续摘要失败时兜底，避免请求无限增长。
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
 * 持久化 LLM 上下文快照到 DB。
 * 按 user_raw_msg_id 唯一写入（幂等：INSERT OR IGNORE）。
 */
export function saveLlmContextSnapshot(db, {
  userRawMsgId, conversationId, characterId = null,
  summaryId = null, checkpointEndMsgId = 0,
  memorySnapshot = [], dynamicContext = '',
  promptRevision, stablePrefixHash, historyPrefixHash, requestHash,
} = {}) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO llm_context_snapshots (
        user_raw_msg_id, conversation_id, character_id,
        summary_id, checkpoint_end_msg_id,
        memory_snapshot, dynamic_context,
        prompt_revision, stable_prefix_hash, history_prefix_hash, request_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userRawMsgId, conversationId, characterId,
      summaryId, checkpointEndMsgId,
      JSON.stringify(memorySnapshot), dynamicContext,
      promptRevision, stablePrefixHash, historyPrefixHash, requestHash,
    );
  } catch (err) {
    console.error('[contextAssembler] save snapshot failed:', err.message);
  }
}
