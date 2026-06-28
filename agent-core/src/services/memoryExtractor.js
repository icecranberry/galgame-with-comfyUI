/**
 * 记忆碎片提取器
 *
 * 每轮对话后异步提取事实、偏好、情绪碎片，
 * 向量化存入 ChromaDB，元信息存入 SQLite。
 *
 * 提取范围覆盖对话双方：
 * - 用户侧：个人信息、偏好、经历
 * - 角色侧：对话中动态暴露的新信息（不在角色已有设定中的）
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { upsertVector, embedBatch } from './vectorClient.js';

// ── 向量去重 ──

/** 余弦相似度（对 L2 归一化向量等价于点积） */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // 向量已 L2 归一化
}

const SIMILARITY_THRESHOLD = 0.85; // 批次内去重阈值

// ── 数量控制 ──

const MAX_PER_TYPE = 2;   // 每种类型最多保留
const MAX_TOTAL = 6;      // 单批次最多保留

// ── Prompt 构建 ──

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
- entities 必须是对话参与方之外的**具体、有区分度的名词**
  好的实体示例：「马卡龙」「女高音演出」「枫丹歌剧院」「草莓奶油三明治」「洛丽塔裙子」
  坏的实体示例：「礼物」「心情」「神明」「肛塞」「屁眼」「香蕉」
- 对话参与方（${nameList}）绝对禁止作为实体
- **实体多样性**：每条碎片的实体应分布在不同的语义域（食物、地点、活动、物品、服饰等），
  禁止所有碎片共用同一实体或同一类道具/玩具
- 如果一条碎片去掉参与方名字后找不到任何具体实体，就**不要提取**
</entity_rules>

提取维度：
- fact: 参与方陈述的**可验证的个人信息或经历**。
  好的示例：「用户曾在东京留学三年」「神代明日香今天自己做了草莓奶油三明治」
  坏的示例：「用户想看肛塞崩出来」→ 这是对话行为/请求，不是个人信息
- preference: 参与方**明确表达**的喜欢/讨厌/习惯，指向具体对象。
  好的示例：「用户喜欢草莓口味的甜点」「神代明日香喜欢做三明治」
  坏的示例：「用户喜欢看色情表演」→ 缺乏具体有区分度的对象
- emotion: 只在情绪与**具体事件或转折点**强绑定时提取

提取范围：
- **用户侧**：用户的个人信息、偏好、经历
- **角色侧**：对话中角色**新暴露**的动态信息（不在 <known_info> 中的），
  如"今天做了XX""最近在学YY""下周要去ZZ"——这类信息能增强未来对话的连贯性

**关键区分**：
"用户说了什么/要求了什么" = 对话行为 → 不是长期记忆
"用户是什么样的人/经历过什么/喜欢什么" = 个人信息 → 才是长期记忆
同理，"角色说了什么" vs "角色新暴露了什么信息"也要区分

**数量控制**：
- 每种类型最多 2 条，总数最多 6 条
- 宁缺毋滥：没有值得提取的就返回空数组 []
- 优先提取实体更有区分度、对未来对话延续价值更高的信息

禁止提取：
- 角色设定中已有的信息
- 泛化情绪描述："用户情绪愉快""气氛轻松""XX用调侃语气回应"
- 对话行为本身："用户要求XX""角色表演了XX""用户想看XX"——这不算长期记忆
- 模板化、普适匹配的内容
- 同一实体的重复变体（如都围绕同一个道具的不同角度描述）

每条碎片格式：
{"type":"fact|preference|emotion","content":"简洁的一句话描述（15-30字）","entities":["具体实体1","实体2"]}

对话内容：
${messagesText}

只返回 JSON 数组，不要任何其他内容。`;
}

// ── 主入口 ──

/**
 * 从最近一轮对话中提取记忆碎片
 *
 * @param {string} conversationId
 * @param {number} userMsgId - 用户消息 ID
 * @param {number} assistantMsgId - AI 回复 ID
 * @param {object} options
 * @param {string} options.characterPrompt - 角色的已有设定，用于排除已知信息
 * @param {string[]} options.participantNames - 对话参与方名字，会被排除出实体列表
 * @param {string} [options.characterName] - 角色显示名，用于替换对话中的 [assistant] 标签
 * @param {string} [options.userName] - 用户名，用于替换对话中的 [user] 标签
 */
export async function extractMemoryFragments(conversationId, userMsgId, assistantMsgId, { characterPrompt = '', participantNames = [], characterName = '', userName = '' } = {}) {
  const db = getDb();

  // 获取最近十轮对话作为提取上下文（从 raw_messages 取完整消息）
  // 每 10 条用户消息触发一次提取，取 20 行 = 10 轮（user + assistant 各一条）
  const recent = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT 20
  `).all(conversationId).reverse();

  if (recent.length === 0) return [];

  // 将 [assistant]/[user] 替换为实际名字，提升 LLM 对对话参与方的理解
  const roleToName = {
    'assistant': characterName || 'assistant',
    'user': userName || 'user',
  };
  const messagesText = recent
    .map(m => `[${roleToName[m.role] || m.role}]: ${stripPromptJson(m.content)}`)
    .join('\n');

  let fragments;
  try {
    const prompt = buildExtractPrompt(characterPrompt, participantNames, messagesText);
    let raw = await chatSync(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, max_tokens: 1024, label: 'RAG记忆提取助手' }
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

  // ── 后处理管线 ──

  // 阶段 1：类型归一化 + 实体过滤 + 通用内容过滤
  let filtered = [];
  const typeCounts = { fact: 0, preference: 0, emotion: 0 };

  for (const frag of fragments) {
    if (!frag.content || !frag.type) continue;

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

    // 阶段 2 预处理：每类型最多 2 条（先按出现顺序截断，去重后再精筛）
    if (typeCounts[type] >= MAX_PER_TYPE) continue;
    typeCounts[type]++;

    filtered.push({ type, content: frag.content.trim(), entities: fragEntities });
  }

  if (filtered.length === 0) return [];

  // 阶段 2：批次内语义去重（向量相似度 > SIMILARITY_THRESHOLD 的只保留第一条）
  filtered = await deduplicateBatch(filtered);

  // 阶段 3：最终数量限制（总上限 6 条）
  if (filtered.length > MAX_TOTAL) {
    filtered = filtered.slice(0, MAX_TOTAL);
  }

  // ── 持久化 ──

  const saved = [];

  for (const frag of filtered) {
    const entities = JSON.stringify(frag.entities);

    try {
      // 向量化 + 存入 ChromaDB
      const chromaId = await upsertVector(
        null, // 自动生成 ID
        frag.content,
        {
          conversation_id: conversationId,
          fragment_type: frag.type,
          entities: frag.entities,
        },
        frag.type
      );

      // 存入 SQLite
      db.prepare(`
        INSERT INTO memory_fragments (conversation_id, source_msg_id, fragment_type, content, entities, chroma_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conversationId, userMsgId, frag.type, frag.content, entities, chromaId);

      saved.push({ type: frag.type, content: frag.content, chromaId });
    } catch (err) {
      console.error('[memoryExtractor] save fragment failed:', err.message);
    }
  }

  if (saved.length > 0) {
    console.log(`[memoryExtractor] extracted ${saved.length} fragments (from ${fragments.length} raw) from conv ${conversationId}`);
  }

  return saved;
}

// ── 辅助函数 ──

/** 去掉消息中的 {"prompt":"..."} JSON 标签（可能出现在开头、中间或末尾），避免长篇英文生图 prompt 干扰提取 */
function stripPromptJson(content) {
  // (?:[^"\\]|\\.) 正确跳过 JSON 字符串内的转义引号，避免提前截断
  // g 全局标志：一条消息可能有多个 prompt JSON
  // 不加 $ 锚点：prompt JSON 经常出现在消息开头（后面还有中文回复）
  return content.replace(/\s*\{["']prompt["']:\s*"(?:[^"\\]|\\.)*"\s*\}/gs, '');
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
    // 泛化情绪 / 气氛描述
    /情绪愉快/, /心情很好/, /心情.*好/, /气氛轻松/, /气氛.*轻松/,
    /调侃语气/, /假装生气/, /假装.*生气/, /戏弄后的原谅/,
    /喜欢看到.*开心/, /看到.*开心的样子/, /珍视.*陪伴/,
    /以.*语气回应/, /回应.*情绪/, /表现出.*开心/,
    // 对话行为伪装成信息（"用户要求/想看/让角色做XX"）
    /用户要求/, /用户.*让.*做/, /角色表演了/,
    // 过短的内容缺乏信息量
    /^.{1,14}$/,
    // 纯感官/情绪描述缺乏具体实体锚点
    /^.{1,20}?(好爽|好舒服|好开心|好难过|很爽|很舒服|很开心|很棒).{0,10}$/,
  ];
  return genericPatterns.some(p => p.test(content));
}

/**
 * 批次内语义去重
 *
 * 对单批次提取结果做向量相似度去重，
 * 相似度 > SIMILARITY_THRESHOLD 的只保留第一条（按出现顺序）。
 * 向量服务不可用时静默回退，不做去重。
 */
async function deduplicateBatch(fragments) {
  if (fragments.length <= 1) return fragments;

  const contents = fragments.map(f => f.content);
  let embeddings;
  try {
    embeddings = await embedBatch(contents);
  } catch (err) {
    // 向量服务不可用 → 静默回退
    console.warn('[memoryExtractor] vector service unavailable for batch dedup:', err.message);
    return fragments;
  }

  const keep = [];
  const keptIndices = [];

  for (let i = 0; i < fragments.length; i++) {
    let isDuplicate = false;
    for (const j of keptIndices) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim > SIMILARITY_THRESHOLD) {
        isDuplicate = true;
        console.log(
          '[memoryExtractor] dedup: skip similar —',
          `"${fragments[i].content.slice(0, 30)}..." ≈ "${fragments[j].content.slice(0, 30)}..."`,
          `(sim=${sim.toFixed(3)})`
        );
        break;
      }
    }
    if (!isDuplicate) {
      keep.push(fragments[i]);
      keptIndices.push(i);
    }
  }

  return keep;
}
