import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { hybridSearch } from './memorySearch.js';
import { applyMemoryActions, getCheckpoint, setCheckpoint } from './memory/memoryRepository.js';

const conversationQueues = new Map();

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

async function curateNow({ conversationId, throughRawMsgId, characterPrompt = '', characterName = '', userName = '' }) {
  const db = getDb();
  const checkpoint = getCheckpoint(conversationId);
  if (throughRawMsgId <= checkpoint.last_raw_msg_id) return [];
  const messages = db.prepare(`
    SELECT id, role, content FROM raw_messages
    WHERE conversation_id = ? AND id > ? AND id <= ?
    ORDER BY id ASC
  `).all(conversationId, checkpoint.last_raw_msg_id, throughRawMsgId);
  if (!messages.some(item => item.role === 'user') || !messages.some(item => item.role === 'assistant')) return [];

  const startId = messages[0].id;
  const endId = messages[messages.length - 1].id;
  const sourceMessageId = db.prepare(`SELECT id FROM messages WHERE conversation_id = ? AND raw_id = ? ORDER BY id LIMIT 1`).get(conversationId, startId)?.id || null;
  const transcript = messages.map(item => `[${item.role === 'user' ? (userName || 'user') : (characterName || item.role)}] ${stripPromptJson(item.content)}`).join('\n');
  setCheckpoint(conversationId, checkpoint.last_raw_msg_id, 'processing', null);

  try {
    const related = await hybridSearch(transcript, { conversationId, topK: 12 });
    const prompt = buildMemoryCurationPrompt({ transcript, characterPrompt, related });
    let raw = await chatSync([{ role: 'user', content: prompt }], {
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      label: '聊天记忆整理',
    });
    const actions = parseMemoryActions(raw);
    const saved = applyMemoryActions({ conversationId, sourceRawStartId: startId, sourceRawEndId: endId, sourceMessageId, actions });
    setCheckpoint(conversationId, endId, 'idle', null);
    console.log(`[memoryExtractor] curated ${saved.length} memories for ${conversationId}, raw ${startId}-${endId}`);
    return saved;
  } catch (error) {
    setCheckpoint(conversationId, checkpoint.last_raw_msg_id, 'failed', String(error.message).slice(0, 500));
    console.error('[memoryExtractor] curation failed:', error.message);
    return [];
  }
}

export function buildMemoryCurationPrompt({ transcript, characterPrompt = '', related = [] }) {
  const existing = related.length
    ? related.map(item => `- ${item.memory_id} | ${item.memory_type} | ${item.judgment} | tags=${JSON.stringify(item.tags)}`).join('\n')
    : '（无相关旧记忆）';
  return `你是聊天长期记忆整理器。只保存未来对话仍有价值、可独立理解的信息，不保存密码、密钥、一次性请求、泛化寒暄、角色固有设定或生图提示词。\n\n记忆类型：\n- knowledge：稳定事实、身份、偏好、关系或项目状态\n- skill：能力、方法、工具使用经验\n- emotion：稳定情绪偏好或与长期事件绑定的态度\n- event：确实发生且未来仍需保持连续性的事件\n\n动作约束：\n- create：新记忆，sourceMemoryIds 必须为空\n- update：替代一条旧记忆，sourceMemoryIds 必须正好 1 个\n- merge：合并至少两条旧记忆，sourceMemoryIds 至少 2 个\n- 没有值得记忆的信息时 memoryActions 返回 []\n- 不得引用下面列表之外的 memoryId\n- 不输出 importance、confidence 或自由评分\n\n每条 memory 格式：\n{"memoryType":"knowledge|skill|emotion|event","subject":"user|character|relationship|assistant","judgment":"一句独立、清楚的判断句","reasoning":"只写支撑判断的对话依据","tags":["独立稳定词元"]}\n\n<character_known_info>\n${characterPrompt || '（无）'}\n</character_known_info>\n\n<related_memories>\n${existing}\n</related_memories>\n\n<new_round>\n${transcript}\n</new_round>\n\n只返回严格 JSON：{"memoryActions":[{"action":"create|update|merge","sourceMemoryIds":[],"memory":{...}}]}`;
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
export async function extractMemoryFragments(conversationId, _userMsgId, assistantRawMsgId, options = {}) {
  return curateChatMemories({ conversationId, throughRawMsgId: assistantRawMsgId, ...options });
}
