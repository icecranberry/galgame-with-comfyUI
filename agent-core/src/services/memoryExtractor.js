import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { hybridSearch } from './memorySearch.js';
import { applyMemoryActions, getCheckpoint, setCheckpoint } from './memory/memoryRepository.js';
import { isMemoryV3Enabled } from './memory/memoryConfig.js';
import { cleanChatText } from '../maibot-bridge/textCleaner.js';

const conversationQueues = new Map();
const CURATE_EVERY_N_MESSAGES = 40; // 每 40 句整理一次长期记忆

export function curateChatMemories(options) {
  const key = options.conversationId;
  const previous = conversationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => curateNow(options));
  const tracked = current.finally(() => {
    if (conversationQueues.get(key) === tracked) conversationQueues.delete(key);
  });
  conversationQueues.set(key, tracked);
  return tracked;
}

export function selectMemorySourceRows(db, conversationId, { afterRawId = 0, throughRawId }) {
  return db.prepare(`
    SELECT id, role, content, created_at FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND id <= ?
    ORDER BY id ASC
  `).all(conversationId, afterRawId, throughRawId);
}

async function curateNow({ conversationId, throughRawMsgId, characterName = '', userName = '' }) {
  const db = getDb();
  const checkpoint = getCheckpoint(conversationId);
  if (throughRawMsgId <= checkpoint.last_raw_msg_id) return [];
  const messages = selectMemorySourceRows(db, conversationId, {
    afterRawId: checkpoint.last_raw_msg_id,
    throughRawId: throughRawMsgId,
  });
  if (!messages.some(item => item.role === 'user') || !messages.some(item => item.role === 'assistant')) return [];
  if (messages.length < CURATE_EVERY_N_MESSAGES) {
    console.log(`[memoryExtractor] skip curation: ${messages.length} 条 < ${CURATE_EVERY_N_MESSAGES} 条阈值，继续累积`);
    return [];
  }

  const startId = messages[0].id;
  const endId = messages[messages.length - 1].id;
  const sourceMessageId = db.prepare(`SELECT id FROM messages WHERE conversation_id = ? AND raw_id = ? ORDER BY id LIMIT 1`).get(conversationId, startId)?.id || null;
  const transcript = messages.map(item => `[${item.role === 'user' ? (userName || 'user') : (characterName || item.role)}] ${cleanChatText(item.content)}`).join('\n');
  // v3 事件时间：取窗口内最后一条 user 消息时间（服务端事实来源，不让 LLM 猜时间）
  const lastUserRow = [...messages].reverse().find(item => item.role === 'user');
  const eventTime = lastUserRow?.created_at || messages[messages.length - 1]?.created_at || null;
  const timeRange = messages[0]?.created_at && eventTime ? `${messages[0].created_at} ~ ${eventTime}` : '';
  setCheckpoint(conversationId, checkpoint.last_raw_msg_id, 'processing', null);

  try {
    const related = await hybridSearch(transcript, { conversationId, topK: 12, timeoutMs: 20000 });
    const prompt = buildMemoryCurationPrompt({ transcript, related, timeRange });
    let raw = await chatSync([{ role: 'user', content: prompt }], {
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      label: '聊天记忆整理',
    });
    const actions = parseMemoryActions(raw);
    const saved = applyMemoryActions({ conversationId, sourceRawStartId: startId, sourceRawEndId: endId, sourceMessageId, actions, eventTime });
    setCheckpoint(conversationId, endId, 'idle', null);
    console.log(`[memoryExtractor] curated ${saved.length} memories for ${conversationId}, raw ${startId}-${endId}`);
    return saved;
  } catch (error) {
    setCheckpoint(conversationId, checkpoint.last_raw_msg_id, 'failed', String(error.message).slice(0, 500));
    console.error('[memoryExtractor] curation failed:', error.message);
    return [];
  }
}

export function buildMemoryCurationPrompt({ transcript, related = [], timeRange = '', v3 = isMemoryV3Enabled() }) {
  const existing = related.length
    ? related.map(item => `- ${item.memory_id} | ${item.memory_type} | ${item.judgment} | tags=${JSON.stringify(item.tags)}`).join('\n')
    : '（无相关旧记忆）';
  const common = `你是聊天长期记忆整理器。只保存未来对话仍有价值、可独立理解的信息，不保存密码、密钥、一次性请求、泛化寒暄、角色固有设定或生图提示词。

记忆类型：
- knowledge：稳定事实、身份、偏好、关系或项目状态
- skill：能力、方法、工具使用经验
- emotion：稳定情绪偏好或与长期事件绑定的态度
- event：确实发生且未来仍需保持连续性的事件

动作约束：
- create：新记忆，sourceMemoryIds 必须为空
- update：替代一条旧记忆，sourceMemoryIds 必须正好 1 个
- merge：合并至少两条旧记忆，sourceMemoryIds 至少 2 个
- 没有值得记忆的信息时 memoryActions 返回 []
- 不得引用下面列表之外的 memoryId`;

  // v2 回滚分支：与历史 prompt 逐字兼容（含禁评分约束）
  const v2Format = `- 不输出 importance、confidence 或自由评分

每条 memory 格式：
{"memoryType":"knowledge|skill|emotion|event","subject":"user|character|relationship|assistant","judgment":"一句独立、清楚的判断句","reasoning":"只写支撑判断的对话依据","tags":["独立稳定词元"]}`;

  // v3 分支：MMS 多重表示（检索单元 keywords/perspectives/episodicNote + 注入单元 semanticNote）
  // + 实体/三元组抽取。新字段全部可选：模型偷懒不输出时落库自动降级为 v2 形态。
  const v3Format = `每条 memory 格式：
{"memoryType":"knowledge|skill|emotion|event","subject":"user|character|relationship|assistant","judgment":"一句独立、清楚的判断句","reasoning":"只写支撑判断的对话依据","tags":["独立稳定词元"],"keywords":["检索关键词"],"perspectives":["认知视角标签"],"episodicNote":"何时何地发生了什么","semanticNote":"可独立转述的事实句","importance":3,"entities":[{"name":"具体名词","role":"subject|object|mention"}],"triple":{"subject":"主体","predicate":"谓词","object":"客体"}}

扩展字段说明（全部可省略，宁可留空不要编造）：
- keywords：3~8 个，用户将来想问起这件事时最可能打的词；tags 是主题归类，keywords 是检索入口，两者可以不同
- perspectives：2~5 个认知视角标签，如：饮食习惯/童年/健康/工作/金钱/关系/旅行，让同一条记忆能从不同角度被想起
- episodicNote：情景信息（大约何时、在哪、发生了什么），event/emotion 类必写，只记事实不写评价
- semanticNote：把这条记忆提炼成一句可直接向他人转述的话，与 judgment 意思一致但更口语化；写不出就用空字符串
- importance：1（琐碎）~5（重大：重大事件、强烈偏好、重要关系节点）
- entities：具体的人名/地名/事物名；代词（她/他/我/你/它）和抽象概念不算；没有就给 []
- triple：仅当存在清晰的主谓宾事实（如 她-讨厌-香菜、他-承诺-周末看电影）才输出，谓词尽量是单个词；没有就省略整个 triple 字段`;

  const timeBlock = timeRange ? `\n<window_time>\n${timeRange}\n</window_time>\n` : '\n';
  return `${common}\n\n${v3 ? v3Format : v2Format}\n${timeBlock}<related_memories>\n${existing}\n</related_memories>\n\n<new_round>\n${transcript}\n</new_round>\n\n只返回严格 JSON：{"memoryActions":[{"action":"create|update|merge","sourceMemoryIds":[],"memory":{...}}]}`;
}

export function parseMemoryActions(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(text);
  const actions = parsed.memoryActions ?? parsed.actions ?? [];
  if (!Array.isArray(actions)) throw new Error('memoryActions 必须是数组');
  return actions.slice(0, 8);
}

function stripPromptJson(content) {
  return String(content || '').replace(/\s*\{["']prompt["']:\s*"(?:[^"\\]|\\.)*"\s*\}/gs, '').trim();
}

// 旧调用兼容；新代码应传 raw assistant id。

export async function curateAccumulatedMemory({ accumulatedText, characterName = '', userName = '用户' }) {
  // 不落库的记忆整理：把累积对话整理成判断句列表，用于 MaiBot 主聊天流注入。
  // 该路径只消费 judgment，强制 v2 精简格式，避免为不落库的扩展字段浪费输出 token。
  const prompt = buildMemoryCurationPrompt({ transcript: accumulatedText, related: [], v3: false });
  const raw = await chatSync([{ role: 'user', content: prompt }], {
    temperature: 0.2,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    label: '聊天记忆整理',
  });
  const actions = parseMemoryActions(raw);
  const lines = actions
    .map((item) => {
      const memory = item?.memory ?? {};
      const type = memory.memoryType ?? 'knowledge';
      return `- [${type}] ${memory.judgment ?? ''}`.trim();
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : '';
}

export async function extractMemoryFragments(conversationId, _userMsgId, assistantRawMsgId, options = {}) {
  return curateChatMemories({ conversationId, throughRawMsgId: assistantRawMsgId, ...options });
}
