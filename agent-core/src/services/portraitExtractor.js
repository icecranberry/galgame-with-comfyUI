/**
 * 用户画像提取器
 *
 * 每 10 条用户消息触发一次，从对话中提取用户的外貌、性格、偏好特征，
 * 以角色视角存入 user_portraits 表。
 *
 * 每个角色独立维护其"眼中"的用户画像，反映该角色对用户的独特认知。
 */

import { getDb, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';

const EXTRACT_INTERVAL = 10; // 每 10 条用户消息触发

const EXTRACT_PROMPT = `[系统指令] 你是一个纯信息提取工具，不是角色扮演角色。请以第三人称、客观分析师的角度工作，禁止使用任何角色扮演语气、禁止对用户说话、禁止输出情感回应。只输出被要求的结构化结果。

你是一个用户特征分析器。从以下对话中，提取关于"用户（user）"的特征描述。

从三个维度分析：
- appearance: 用户的**外貌特征**（发色、发型、体型、穿着风格、气质等）
- personality: 用户的**性格特征**（开朗、冷淡、温柔、毒舌、急性子等）
- preference: 用户的**偏好习惯**（喜欢的食物、爱好、口头禅、习惯性行为等）

已有的用户画像供参考（避免重复添加已记录的内容）：
{{existing_portraits}}

规则：
1. 只提取对话中**明确提到或强烈暗示**的用户特征，不要臆想
2. 每条特征一句话简洁描述，10-30 字
3. 只输出 JSON 数组，不要任何其他内容
4. 如果已有画像已涵盖某个特征，不要重复添加
5. 每个维度最多输出一个，优先最有特点的

输出格式：
[{"type":"appearance","content":"白发，身高大约170cm"},{"type":"personality","content":"性格冷静，喜欢理性分析"}]

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
    WHERE conversation_id = ? AND role = 'user' AND is_deleted = 0
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
    WHERE conversation_id = ? AND role = 'user' AND is_deleted = 0
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
      { temperature: 0.3, max_tokens: 600, label: '提取用户画像' }
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
    newTraits = JSON.parse(raw);
    if (!Array.isArray(newTraits)) newTraits = [];
  } catch (err) {
    console.error('[portraitExtractor] JSON parse failed:', err.message);
    return 0;
  }

  if (newTraits.length === 0) return 0;

  // 获取 source_msg_id（最近的 assistant 消息 ID）
  const lastMsg = db.prepare(`
    SELECT id FROM messages
    WHERE conversation_id = ? AND role = 'assistant' AND is_deleted = 0
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);
  const sourceMsgId = lastMsg?.id || null;

  // 写入 user_portraits 表（UNIQUE 约束防重复）
  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_portraits (character_id, trait_type, content, confidence, source_msg_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  let added = 0;
  for (const trait of newTraits) {
    const type = normalizeType(trait.type);
    if (!type || !trait.content || typeof trait.content !== 'string') continue;
    const content = trait.content.trim();
    if (content.length < 3) continue;

    try {
      const result = insert.run(characterId, type, content, 0.5, sourceMsgId);
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
  if (t === 'appearance') return 'appearance';
  if (t === 'personality' || t === 'persona') return 'personality';
  if (t === 'preference' || t === 'pref') return 'preference';
  return null;
}
