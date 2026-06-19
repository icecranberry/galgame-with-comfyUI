/**
 * 主动对话调度器 (Proactive Chat Scheduler)
 *
 * 每个角色根据三个因素决定主动发起对话的时机：
 *   1. 距上次聊天时间 → 越久越主动（sigmoid）
 *   2. 好感度 (affinity) → 越高越亲密、频繁
 *   3. VAD 情绪 → 综合情绪影响主动性
 *
 * 三个因素加权融合为 proactive_score (0~1)，映射到下次主动发起的时间间隔。
 * 行为模式完全模仿 momentScheduler：
 *   - 每 5 分钟扫描一次
 *   - 每次只处理一个角色（排队）
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';
import { config } from '../config.js';
import {
  loadEmotionState, getCompositeEmotion, loadAffinity,
  stateToPrompt, affinityToPrompt,
} from './emotionEngine.js';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟

let timer = null;
let processing = false;

// ── Helper: ISO ↔ SQLite datetime ──

function toSQLiteDate(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

// ── 评分函数 ──

/**
 * sigmoid 函数
 * @param {number} x 输入值
 * @param {number} midpoint 中点（拐点）
 * @param {number} steepness 陡峭度
 * @returns {number} 0~1
 */
function sigmoid(x, midpoint, steepness) {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

/**
 * 计算角色的主动发起评分 (0~1)
 *
 * 三个因素的加权：
 *   - timeScore (50%): 距上次聊天时间越久，越主动
 *   - affinityScore (30%): 好感度越高越主动
 *   - vadScore (20%): 综合情绪中 valence 高 + arousal 高 = 更想聊天
 *
 * @param {number} hoursSince - 距上次聊天小时数
 * @param {number} affinity - 好感度 (0~100)
 * @param {{ valence: number, arousal: number, dominance: number }} compositeVad - 综合 VAD
 * @returns {number} 0~1
 */
function computeProactiveScore(hoursSince, affinity, compositeVad) {
  if (hoursSince == null) hoursSince = 999; // 从未聊过 → 极高分数

  // timeScore: sigmoid, midpoint=12h, steepness=0.2 → 2h 约 0.12, 12h 约 0.5, 48h 约 0.999
  const timeScore = sigmoid(hoursSince, 12, 0.2);

  // affinityScore: 归一化到 0~1
  const affinityScore = Math.max(0, Math.min(1, affinity / 100));

  // vadScore: 综合情绪对主动性的影响
  //   valence > 0 → 愉快想聊; arousal > 0 → 精神想动; dominance > 0 → 自信主动
  //   归一化到 0~1（VAD 原始范围 valence -1~1, arousal/dominance 0~1）
  const vNorm = (compositeVad.valence + 1) / 2; // -1~1 → 0~1
  const aNorm = compositeVad.arousal;            // 0~1
  const dNorm = compositeVad.dominance;          // 0~1
  const vadScore = vNorm * 0.4 + aNorm * 0.35 + dNorm * 0.25;

  // 加权融合
  const score = timeScore * 0.50 + affinityScore * 0.30 + vadScore * 0.20;
  return Math.max(0, Math.min(1, score));
}

/**
 * 将 proactive_score 映射到下次发起间隔（小时）
 *
 * score=0 → 48h（几乎不主动）
 * score=0.5 → 26h（中等）
 * score=1 → 4h（非常主动）
 *
 * @param {number} score 0~1
 * @returns {number} 间隔小时数
 */
function scoreToIntervalHours(score) {
  return Math.max(4, 48 - score * 44);
}

// ── LLM 开场白生成 ──

/**
 * 以角色口吻生成一句自然的主动开场白
 *
 * @param {object} character - characters 表行
 * @param {number} affinity - 好感度
 * @param {object} compositeVad - 综合 VAD { valence, arousal, dominance }
 * @param {string|null} lastMessageAt - 上次聊天时间 (ISO)
 * @param {string|null} recentSummary - 最近对话摘要（可选）
 * @returns {Promise<string>} 生成的文本
 */
async function generateGreeting(character, affinity, compositeVad, lastMessageAt, recentSummary) {
  const conversationId = `char_${character.id}`;

  // 1. 获取情绪状态的自然语言描述
  const emotionState = loadEmotionState(conversationId, JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}'));
  const emotionText = stateToPrompt(emotionState);

  // 2. 好感度文本片段
  const affinityText = affinityToPrompt(affinity);

  // 3. 距上次聊天时间描述
  let timeDesc = '你们还没有聊过天';
  if (lastMessageAt) {
    const hoursAgo = (Date.now() - new Date(lastMessageAt).getTime()) / 3600000;
    if (hoursAgo < 1) timeDesc = '不到一小时前刚聊过';
    else if (hoursAgo < 24) timeDesc = `大约 ${Math.round(hoursAgo)} 小时前聊过`;
    else timeDesc = `大约 ${Math.round(hoursAgo / 24)} 天前聊过`;
  }

  const userName = config.user.nickname || '你';

  const systemPrompt = `你是一个角色扮演 AI。接下来，你将扮演以下角色，主动向 "${userName}" 发起一段对话。

【角色人格】
${character.base_prompt}

${affinityText ? `【角色对你的态度】\n${affinityText}\n` : ''}${emotionText ? `【角色当前状态】\n${emotionText}\n` : ''}
【上次聊天时间】
${timeDesc}

${recentSummary ? `【最近对话摘要】\n${recentSummary}\n` : ''}
【当前时间】
${new Date().toISOString()}

请以角色的口吻，生成一句自然的口语化开场白（15~50 字）。
可以提及最近的共同话题、关心 ${userName}、分享你此刻的心情或想法。
要求：
- 仅输出对话文字，不要包含任何动作描写、括号、格式标记
- 自然口语化，像是突然想到就发了一条消息
- 符合角色性格、当前情绪、好感度状态
- 绝对不要使用括号描述动作，例如（笑了笑）`;

  try {
    const result = await chatSync(
      [{ role: 'system', content: systemPrompt }],
      { temperature: 0.85, max_tokens: 128 }
    );

    let greeting = (result || '').trim();
    // 清理可能的引号包裹
    greeting = greeting.replace(/^["'「」『』]|["'「」『』]$/g, '').trim();
    // 如果太长，截取到第一个句号/感叹号/问号处
    const maxLen = 80;
    if (greeting.length > maxLen) {
      const cutMatch = greeting.match(/^.{1,80}[。！？!?～~]/);
      if (cutMatch) greeting = cutMatch[0];
      else greeting = greeting.slice(0, maxLen) + '…';
    }
    if (greeting.length < 5) {
      // 太短了，说明 LLM 没正经输出；兜底
      return `${userName}，在干嘛呢？`;
    }
    return greeting;
  } catch (err) {
    console.error(`[proactiveChatScheduler] generateGreeting failed for ${character.display_name}:`, err.message);
    // 兜底问候语
    return `${userName}，在干嘛呢？`;
  }
}

// ── 写入主动消息 ──

/**
 * 将角色的主动发起消息写入 DB
 *
 * @param {object} character
 * @param {string} content - 消息文本
 * @returns {{ rawId: number, msgId: number }}
 */
function writeProactiveMessage(character, content) {
  const db = getDb();
  const conversationId = `char_${character.id}`;

  // 写入 raw_messages（完整消息）
  const rawResult = db.prepare(
    `INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'assistant', ?)`
  ).run(conversationId, content);
  const rawId = rawResult.lastInsertRowid;

  // 写入 messages（分句展示）
  const msgResult = db.prepare(
    `INSERT INTO messages (conversation_id, raw_id, role, content, seq) VALUES (?, ?, 'assistant', ?, 0)`
  ).run(conversationId, rawId, content);
  const msgId = msgResult.lastInsertRowid;

  console.log(`[proactiveChatScheduler] Written proactive message for ${character.display_name}: raw=${rawId}, msg=${msgId}`);

  return { rawId, msgId };
}

/**
 * 更新角色的 next_proactive_at 时间
 *
 * @param {number} characterId
 * @param {number} score - proactive_score (0~1)
 */
function updateNextProactiveAt(characterId, score) {
  const db = getDb();
  const intervalHours = scoreToIntervalHours(score);
  // 加入随机抖动 ±30%，避免所有角色扎堆
  const jitter = 0.7 + Math.random() * 0.6;
  const delayMs = intervalHours * 3600_000 * jitter;
  const nextAt = new Date(Date.now() + delayMs).toISOString();

  db.prepare('UPDATE characters SET next_proactive_at = ? WHERE id = ?')
    .run(toSQLiteDate(nextAt), characterId);

  console.log(`[proactiveChatScheduler] ${characterId}: score=${score.toFixed(3)}, interval=${intervalHours.toFixed(1)}h (jitter=${jitter.toFixed(2)}), next=${nextAt}`);
}

/**
 * 初始化首次 next_proactive_at：给所有 proactive_disabled=0 且 next_proactive_at 为 NULL 的角色设置首次时间
 */
function initializeFirstTimes() {
  const db = getDb();
  const chars = db.prepare(
    'SELECT id FROM characters WHERE proactive_disabled = 0 AND next_proactive_at IS NULL'
  ).all();

  if (chars.length === 0) return;

  let count = 0;
  for (const c of chars) {
    // 首次主动聊天在 30min ~ 4h 内随机
    const delay = 0.5 * 3600_000 + Math.random() * 3.5 * 3600_000;
    const nextAt = new Date(Date.now() + delay).toISOString();
    db.prepare('UPDATE characters SET next_proactive_at = ? WHERE id = ?')
      .run(toSQLiteDate(nextAt), c.id);
    count++;
  }
  console.log(`[proactiveChatScheduler] Initialized ${count} character(s) with first proactive times`);
}

// ── 核心 tick ──

async function tick() {
  if (processing) {
    console.log('[proactiveChatScheduler] Previous tick still processing, skip this tick');
    return;
  }

  // 功能未开启时跳过
  if (!config.features.proactiveChat) return;

  const db = getDb();
  try {
    // 找下一个需要主动聊天的角色
    const candidate = db.prepare(`
      SELECT * FROM characters
      WHERE proactive_disabled = 0
        AND (next_proactive_at IS NULL OR next_proactive_at <= datetime('now'))
      ORDER BY next_proactive_at ASC NULLS FIRST
      LIMIT 1
    `).get();

    if (!candidate) {
      // 没有待定角色，但可能有首次初始化需要
      initializeFirstTimes();
      return;
    }

    processing = true;
    const conversationId = `char_${candidate.id}`;
    console.log(`[proactiveChatScheduler] Processing ${candidate.display_name}...`);

    // 1. 获取上次聊天时间
    const lastMsg = db.prepare(`
      SELECT created_at FROM messages
      WHERE conversation_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(conversationId);

    const lastMessageAt = lastMsg ? toISO(lastMsg.created_at) : null;
    let hoursSince = null;
    if (lastMessageAt) {
      hoursSince = (Date.now() - new Date(lastMessageAt).getTime()) / 3600000;
    }

    // 2. 获取当前好感度
    const affinity = loadAffinity(candidate.id);

    // 3. 获取当前 VAD 情绪
    const emotionBaseline = JSON.parse(candidate.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}');
    const emotionState = loadEmotionState(conversationId, emotionBaseline);
    const compositeVad = getCompositeEmotion(emotionState);

    // 4. 计算 proactive_score
    const score = computeProactiveScore(hoursSince, affinity, compositeVad);
    console.log(`[proactiveChatScheduler] ${candidate.display_name}: hoursSince=${hoursSince}, affinity=${affinity}, vad=(${compositeVad.valence.toFixed(2)},${compositeVad.arousal.toFixed(2)},${compositeVad.dominance.toFixed(2)}), score=${score.toFixed(3)}`);

    // 5. 获取最近对话摘要（取最近1条，提供话题引导）
    let recentSummary = null;
    try {
      const summary = db.prepare(`
        SELECT summary FROM rolling_summaries
        WHERE conversation_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(conversationId);
      if (summary) recentSummary = summary.summary;
    } catch (_) { /* ignore */ }

    // 6. 生成开场白
    const greeting = await generateGreeting(candidate, affinity, compositeVad, lastMessageAt, recentSummary);
    console.log(`[proactiveChatScheduler] ${candidate.display_name} greeting: "${greeting}"`);

    // 7. 写入消息到 DB
    writeProactiveMessage(candidate, greeting);

    // 8. 更新下次时间
    updateNextProactiveAt(candidate.id, score);

    console.log(`[proactiveChatScheduler] Done: ${candidate.display_name}`);
  } catch (err) {
    console.error('[proactiveChatScheduler] tick error:', err.message);
  } finally {
    processing = false;
  }
}

// ── 启动/停止 ──

export function startProactiveChatScheduler() {
  console.log('[proactiveChatScheduler] Starting (interval:', CHECK_INTERVAL / 60000, 'min)');

  // 启动后先等 60 秒再首次检查，让服务稳定并确保 DB 迁移已完成
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL);
  }, 60_000);
}

export function stopProactiveChatScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[proactiveChatScheduler] Stopped');
  }
}
