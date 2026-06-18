/**
 * 记忆碎片提取器
 *
 * 每轮对话后异步提取事实、偏好、情绪碎片，
 * 向量化存入 ChromaDB，元信息存入 SQLite。
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';
import { upsertVector } from './vectorClient.js';

function buildExtractPrompt(characterPrompt, participantNames, messagesText) {
  const nameList = participantNames.length > 0
    ? participantNames.map(n => `"${n}"`).join('、')
    : '无';

  return `从以下对话中提取**新增的、有长期记忆价值**的关键信息。返回严格的 JSON 数组。

<known_info>
以下是角色的已有设定，**不要重复提取角色设定中已有的信息**：
${characterPrompt || '（无）'}
</known_info>

<entity_rules>
- entities 必须是对话参与方之外的**具体、有区分度的名词**。
  好的实体示例：「马卡龙」「女高音演出」「枫丹歌剧院」「玫瑰味蛋糕」
  坏的实体示例：「芙宁娜」「冰乐」「user」「礼物」「心情」「神明」
- 对话参与方（${nameList}）绝对禁止作为实体
- 如果一条碎片去掉参与方名字后找不到任何具体实体，就**不要提取**
</entity_rules>

提取规则：
- fact: 用户陈述的**具体的、可验证的**个人信息或经历。必须有对话参与方之外的明确实体
- preference: 用户的**明确表达**的偏好。必须有具体对象（如"喜欢XX""讨厌YY"）
- emotion: 只在情绪与**具体事件或转折点**强绑定时才提取（如"因为XX事件而YY"）

禁止提取：
- 角色设定中已有的信息（见上方 <known_info>）
- 泛化情绪描述：如"用户情绪愉快""XX假装生气""气氛轻松""用调侃语气回应"
- 无具体对象的偏好：如"XX喜欢看到用户开心的样子"
- 任何能普适匹配大量对话的模板化内容

每条碎片格式：
{"type":"fact|preference|emotion","content":"简洁的一句话描述","entities":["具体实体1","实体2"]}

对话内容：
${messagesText}

只返回 JSON 数组，不要任何其他内容。`;
}

/**
 * 从最近一轮对话中提取记忆碎片
 *
 * @param {string} conversationId
 * @param {number} userMsgId - 用户消息 ID
 * @param {number} assistantMsgId - AI 回复 ID
 * @param {object} options
 * @param {string} options.characterPrompt - 角色的已有设定，用于排除已知信息
 * @param {string[]} options.participantNames - 对话参与方名字，会被排除出实体列表
 */
export async function extractMemoryFragments(conversationId, userMsgId, assistantMsgId, { characterPrompt = '', participantNames = [] } = {}) {
  const db = getDb();

  // 获取最近十轮对话作为提取上下文（从 raw_messages 取完整消息）
  // 每 10 条用户消息触发一次提取，取 20 行 = 10 轮（user + assistant 各一条）
  const recent = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT 20
  `).all(conversationId).reverse();

  if (recent.length === 0) return [];

  const messagesText = recent
    .map(m => `[${m.role}]: ${stripPromptJson(m.content)}`)
    .join('\n');

  let fragments;
  try {
    const prompt = buildExtractPrompt(characterPrompt, participantNames, messagesText);
    let raw = await chatSync(
      [{ role: 'user', content: prompt }],
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

    // 质量控制：必须有至少一个具体实体（排除参与方名字）
    const fragEntities = (frag.entities || []).filter(
      e => !participantNames.includes(e)
    );
    if (fragEntities.length === 0) {
      console.log('[memoryExtractor] skip: no specific entities —', frag.content.slice(0, 40));
      continue;
    }

    // 质量控制：过滤通用模板化内容
    if (isGenericContent(frag.content)) {
      console.log('[memoryExtractor] skip: generic —', frag.content.slice(0, 40));
      continue;
    }

    const entities = JSON.stringify(fragEntities);

    try {
      // 向量化 + 存入 ChromaDB
      const chromaId = await upsertVector(
        null, // 自动生成 ID
        frag.content,
        {
          conversation_id: conversationId,
          fragment_type: type,
          entities: fragEntities,
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

/** 去掉消息末尾的 {"prompt":"..."} JSON 标签，避免长篇英文生图 prompt 干扰提取 */
function stripPromptJson(content) {
  return content.replace(/\s*\{["']prompt["']:\s*".*?"\s*\}\s*$/s, '');
}

function normalizeType(type) {
  const t = type.toLowerCase();
  if (t === 'fact') return 'fact';
  if (t === 'preference' || t === 'pref') return 'preference';
  if (t === 'emotion' || t === 'emo') return 'emotion';
  return null;
}

/** 检测模板化通用内容，这类碎片缺乏特异性，不应入库 */
function isGenericContent(content) {
  const genericPatterns = [
    /情绪愉快/, /心情很好/, /心情.*好/, /气氛轻松/, /气氛.*轻松/,
    /调侃语气/, /假装生气/, /假装.*生气/, /戏弄后的原谅/,
    /喜欢看到.*开心/, /看到.*开心的样子/, /珍视.*陪伴/,
    /以.*语气回应/, /回应.*情绪/, /表现出.*开心/,
    /^.{1,10}$/,  // 过短的内容（≤10字）缺乏信息量
  ];
  return genericPatterns.some(p => p.test(content));
}
