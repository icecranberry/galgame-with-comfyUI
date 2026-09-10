/**
 * 用户画像提取器
 *
 * 每 10 条用户消息触发一次，从对话中提取用户的性格与偏好特征，
 * 以角色视角存入 user_portraits 表（appearance 维度已移除，用户外观由 config.user.appearance 自述）。
 *
 * 每个角色独立维护其"眼中"的用户画像，反映该角色对用户的独特认知。
 *
 * 去重口径：一次提取只做一次批量嵌入（全部待写入特征 + 相关维度的全部已有画像），
 * 而不是每条新特征都重新嵌入一遍已有画像——后者是 O(N) 次重复远端调用，N 随画像增长。
 */

import { getDb, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { embedBatch } from './vectorClient.js';

const EXTRACT_INTERVAL = 10; // 每 10 条用户消息触发
const SIMILARITY_THRESHOLD = 0.85; // 余弦相似度阈值，超过即判定为语义重复

/**
 * 余弦相似度（对 L2 归一化向量等价于点积）
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // 向量已 L2 归一化，|a| = |b| = 1
}

/**
 * 向量相似度去重（批量版）
 *
 * @param {number} characterId
 * @param {{ type: string, content: string }[]} candidates 已通过格式校验的待写入特征
 * @returns {Promise<{ type: string, content: string }[]>} 过滤掉语义重复后的特征
 */
async function filterDuplicates(characterId, candidates) {
  if (candidates.length === 0) return [];
  const db = getDb();
  const existingRows = db.prepare(`
    SELECT trait_type, content FROM user_portraits WHERE character_id = ?
  `).all(characterId);
  const existingByType = new Map();
  for (const row of existingRows) {
    if (!existingByType.has(row.trait_type)) existingByType.set(row.trait_type, new Set());
    existingByType.get(row.trait_type).add(row.content);
  }

  // 字面完全相同的（UNIQUE 约束本来也会拒绝）直接丢弃，不浪费一次嵌入
  const kept = candidates.filter(item => !existingByType.get(item.type)?.has(item.content));
  if (kept.length === 0) return [];

  const texts = kept.map(item => item.content);
  const existingSlots = []; // [{ type, textIndex }]
  for (const type of new Set(kept.map(item => item.type))) {
    for (const content of existingByType.get(type) || []) {
      existingSlots.push({ type, textIndex: texts.length });
      texts.push(content);
    }
  }
  if (existingSlots.length === 0) return kept;

  let embeddings;
  try {
    embeddings = await embedBatch(texts);
  } catch (err) {
    // 向量服务不可用 → 静默回退，仅靠 UNIQUE 约束
    console.warn('[portraitExtractor] vector service unavailable, skip similarity check:', err.message);
    return kept;
  }
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return kept;

  return kept.filter((item, index) => {
    for (const slot of existingSlots) {
      if (slot.type !== item.type) continue;
      if (cosineSimilarity(embeddings[index], embeddings[slot.textIndex]) > SIMILARITY_THRESHOLD) return false;
    }
    return true;
  });
}

const EXTRACT_PROMPT = `[系统指令] 你是一个纯信息提取工具，不是角色扮演角色。请以第三人称、客观分析师的角度工作，禁止使用任何角色扮演语气、禁止对用户说话、禁止输出情感回应。只输出被要求的结构化结果。

你是一个用户特征分析器。从以下对话中，提取关于"用户（user）"的特征描述。

从两个维度分析：
- personality: 用户的**性格特征**（开朗、冷淡、温柔、毒舌、急性子等）
- preference: 用户的**偏好习惯**（喜欢的食物、爱好、口头禅、习惯性行为等）

已有的用户画像供参考（避免重复添加已记录的内容）：
{{existing_portraits}}

规则：
1. 只提取对话中**明确提到或强烈暗示**的用户特征，不要臆想
2. 每条特征一句话简洁描述，10-30 字
3. 只输出 JSON 对象，不要任何其他内容
4. 如果已有画像已涵盖某个特征，不要重复添加
5. 每个维度最多输出一个，优先最有特点的

输出格式：
{"traits":[{"type":"personality","content":"性格冷静，喜欢理性分析"}]}

对话内容：
{{messages}}`;

/**
 * 检查并提取用户画像
 *
 * @param {string} conversationId - 会话 ID
 * @param {number} characterId - 角色 ID
 * @returns {Promise<number>} 新增的特征数量
 */
export async function maybeExtractPortrait(conversationId, characterId) {
  const db = getDb();

  // 统计用户消息数
  const { count } = db.prepare(`
    SELECT COUNT(*) as count FROM raw_messages
    WHERE conversation_id = ? AND role = 'user'
  `).get(conversationId);

  // 每 EXTRACT_INTERVAL 条用户消息触发一次
  if (count < EXTRACT_INTERVAL || count % EXTRACT_INTERVAL !== 0) {
    return 0;
  }

  // 获取现有的用户画像（该角色视角下）
  const existing = db.prepare(`
    SELECT trait_type, content FROM user_portraits
    WHERE character_id = ?
    ORDER BY trait_type
  `).all(characterId);
  const existingText = existing.length > 0
    ? existing.map(r => `[${r.trait_type}] ${r.content}`).join('\n')
    : '（暂无记录）';

  // 取最近 10 条用户消息作为提取上下文（触发间隔 = 10，刚好覆盖一次区间）
  const recent = db.prepare(`
    SELECT 'user' AS role, content FROM raw_messages
    WHERE conversation_id = ? AND role = 'user'
    ORDER BY id DESC LIMIT 10
  `).all(conversationId).reverse();

  if (recent.length === 0) return 0;

  const messagesText = recent
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n');

  // 调用 LLM 提取
  let raw;
  try {
    raw = await chatSync(
      [
        { role: 'system', content: getSystemRules({ roleplay: false }) },
        {
          role: 'user',
          content: EXTRACT_PROMPT
            .replace('{{existing_portraits}}', existingText)
            .replace('{{messages}}', messagesText),
        },
      ],
      { temperature: 0.3, max_tokens: 600, response_format: { type: 'json_object' }, label: '提取用户画像' }
    );
  } catch (err) {
    console.error('[portraitExtractor] LLM call failed:', err.message);
    return 0;
  }

  // 解析 JSON
  let newTraits;
  try {
    raw = raw.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }
    const parsed = JSON.parse(raw);
    newTraits = Array.isArray(parsed) ? parsed : (parsed.traits || []);
    if (!Array.isArray(newTraits)) newTraits = [];
  } catch (err) {
    console.error('[portraitExtractor] JSON parse failed:', err.message);
    return 0;
  }

  const candidates = newTraits
    .map(trait => ({
      type: normalizeType(trait?.type),
      content: typeof trait?.content === 'string' ? trait.content.trim() : '',
    }))
    .filter(item => item.type && item.content.length >= 3);

  if (candidates.length === 0) return 0;

  // 获取 source_msg_id（最近的 assistant 消息 ID）
  const lastMsg = db.prepare(`
    SELECT id FROM messages
    WHERE conversation_id = ? AND role = 'assistant'
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);
  const sourceMsgId = lastMsg?.id || null;

  // 写入 user_portraits 表（UNIQUE 约束防重复）
  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_portraits (character_id, trait_type, content, confidence, source_msg_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  let unique = candidates;
  try {
    unique = await filterDuplicates(characterId, candidates);
  } catch (err) {
    // 去重异常 → 静默回退，继续走 UNIQUE 约束
    console.warn('[portraitExtractor] dedupe failed, fall back to UNIQUE constraint:', err.message);
  }

  let added = 0;
  for (const trait of unique) {
    try {
      const result = insert.run(characterId, trait.type, trait.content, 0.5, sourceMsgId);
      if (result.changes > 0) added++;
    } catch (err) {
      // UNIQUE 冲突忽略
      if (!err.message?.includes('UNIQUE')) {
        console.error('[portraitExtractor] insert failed:', err.message);
      }
    }
  }

  if (added > 0) {
    console.log(`[portraitExtractor] added ${added} new portrait entries for character ${characterId}`);
  }

  return added;
}

function normalizeType(type) {
  const t = (type || '').toLowerCase();
  if (t === 'personality' || t === 'persona') return 'personality';
  if (t === 'preference' || t === 'pref') return 'preference';
  return null;
}
