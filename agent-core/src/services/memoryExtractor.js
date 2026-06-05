/**
 * 记忆碎片提取器
 *
 * 每轮对话后异步提取事实、偏好、情绪碎片，
 * 向量化存入 ChromaDB，元信息存入 SQLite。
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';
import { upsertVector } from './vectorClient.js';

const EXTRACT_PROMPT = `从以下对话中提取关键记忆碎片。返回严格的 JSON 数组。

提取三种类型：
- fact: 用户陈述的客观事实（个人信息、经历、知识等）
- preference: 用户的偏好、兴趣、喜欢或讨厌的事物
- emotion: 对话中体现的用户情绪状态

每条碎片格式：
{"type": "fact|preference|emotion", "content": "简洁的一句话描述", "entities": ["相关实体1", "实体2"]}

对话内容：
{{messages}}

只返回 JSON 数组，不要任何其他内容。`;

/**
 * 从最近一轮对话中提取记忆碎片
 *
 * @param {string} conversationId
 * @param {number} userMsgId - 用户消息 ID
 * @param {number} assistantMsgId - AI 回复 ID
 */
export async function extractMemoryFragments(conversationId, userMsgId, assistantMsgId) {
  const db = getDb();

  // 获取最近两轮对话作为提取上下文
  const recent = db.prepare(`
    SELECT role, content FROM messages
    WHERE conversation_id = ? AND is_deleted = 0
    ORDER BY id DESC LIMIT 6
  `).all(conversationId).reverse();

  if (recent.length === 0) return [];

  const messagesText = recent
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n');

  let fragments;
  try {
    let raw = await chatSync(
      [{ role: 'user', content: EXTRACT_PROMPT.replace('{{messages}}', messagesText) }],
      { temperature: 0.3, max_tokens: 1024 }
    );
    // 处理 DeepSeek 可能返回的 markdown code fence
    raw = raw.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }
    fragments = JSON.parse(raw);
    if (!Array.isArray(fragments)) fragments = [];
  } catch (err) {
    console.error('[memoryExtractor] extraction failed:', err.message);
    return [];
  }

  const saved = [];

  for (const frag of fragments) {
    if (!frag.content || !frag.type) continue;

    // 归一化类型
    const type = normalizeType(frag.type);
    if (!type) continue;

    const entities = JSON.stringify(frag.entities || []);

    try {
      // 向量化 + 存入 ChromaDB
      const chromaId = await upsertVector(
        null, // 自动生成 ID
        frag.content,
        {
          conversation_id: conversationId,
          fragment_type: type,
          entities: frag.entities || [],
        },
        type
      );

      // 存入 SQLite
      db.prepare(`
        INSERT INTO memory_fragments (conversation_id, source_msg_id, fragment_type, content, entities, chroma_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conversationId, userMsgId, type, frag.content, entities, chromaId);

      saved.push({ type, content: frag.content, chromaId });
    } catch (err) {
      console.error('[memoryExtractor] save fragment failed:', err.message);
    }
  }

  if (saved.length > 0) {
    console.log(`[memoryExtractor] extracted ${saved.length} fragments from conv ${conversationId}`);
  }

  return saved;
}

function normalizeType(type) {
  const t = type.toLowerCase();
  if (t === 'fact') return 'fact';
  if (t === 'preference' || t === 'pref') return 'preference';
  if (t === 'emotion' || t === 'emo') return 'emotion';
  return null;
}
