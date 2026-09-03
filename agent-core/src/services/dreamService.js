/**
 * 梦境服务 — 用户触发的当场造梦：角色睡梦中被 user 发消息叫住时，
 * 当场生成一场梦（叙述）→ 现编一句梦话应答 → 现场 ComfyUI 生成梦境配图。
 *
 * 无入睡预生成、无预置内容、无主动推送。Zzz 由调用方在生成失败时兜底。
 *
 * 对外 API:
 * - ensureDreamOnDemand(characterId, sleepUntil)        按需造梦（幂等 + await；失败返回 null）
 * - getCurrentDream(characterId)                         当前睡眠会话的 ready 梦（叫醒注入等出口用）
 * - getFreshUnsharedDream(characterId)                   未分享且当天有效的梦（睡醒回复/主动分享用）
 * - markDreamShared(dreamId, via)                        标记梦已被正式提及（via: wake/wake_reply/proactive）
 * - generateLiveDreamMurmur(characterId, userMessage)    当场 LLM 现编一句梦话 + 配套生图提示词
 * - decorateDreamImagePrompt(prompt)                     叠加梦境风格后缀
 * - onCharacterWake(characterId)                         自然醒后加速主动推送
 *
 * 依赖方向: db / llm / builtinRules / emotionEngine
 * 不 import scheduleManager —— 睡眠/temp-woken 状态全部 SQL 直查，避免与其→本模块的钩子引用成环。
 */

import { getDb, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { IMAGE_PROMPT_RULE, getWorldIntegrationRule } from '../builtinRules.js';
import { loadEmotionState, getCompositeEmotion, loadOath, loadAffinity } from './emotionEngine.js';
import { buildCharacterPersona } from './characterPersona.js';

// 梦境配图风格后缀（dreamcore 超现实氛围，叠加在 LLM 生成的 imagePrompt 之后）
const DREAM_STYLE_SUFFIX = ', dreamcore, surreal scenery, ethereal soft lighting, hazy dream atmosphere, soft focus, floating fragments';

const DREAM_TYPE_DESC = {
  about_user: '一个关于对方的梦——对方出现在梦里，场景与你们之间的经历、关系或情感有关',
  memory_remix: '一个由记忆碎片扭曲重组的梦——熟悉的场景和事件被混搭、变形、张冠李戴',
  absurd: '一个荒诞离谱的梦——完全不合逻辑的场景跳跃，醒来会觉得莫名其妙',
  nightmare: '一个噩梦——令人不安、后怕或焦虑的梦境，但不到惊醒的程度',
  sweet: '一个甜蜜的梦——温暖、幸福、心动的梦境',
  spicy: '一个春梦——暧昧旖旎、脸红心跳的梦境，含蓄而有张力',
};

// ── 小工具 ──

/** SQLite datetime 字符串（'YYYY-MM-DD HH:MM:SS' UTC）→ Date */
function parseSqliteDate(s) {
  if (!s) return null;
  const str = String(s);
  const d = new Date(str.replace(' ', 'T') + (str.endsWith('Z') ? '' : 'Z'));
  return isNaN(d.getTime()) ? null : d;
}

/** ISO → SQLite datetime 字符串（next_proactive_at 等列的存储格式） */
function toSQLiteDate(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

function getLatestDream(characterId) {
  return getDb().prepare(
    'SELECT * FROM character_dreams WHERE character_id = ? ORDER BY id DESC LIMIT 1'
  ).get(characterId);
}

function dreamAgeHours(dream) {
  const created = parseSqliteDate(dream.created_at);
  if (!created) return Infinity;
  return (Date.now() - created.getTime()) / 3600000;
}

// ── 按需造梦（用户触发）──

/**
 * 按需造梦：用户在角色睡梦中发消息时调用，为本睡眠会话当场生成一场梦并等待完成。
 * 幂等：已存在本会话（created_at <14h 且 status≠failed）的梦则直接返回。
 * 选梦型 + 采样素材 + 单次 LLM 调用，落库后返回 ready 行。
 * 失败返回 null（调用方走 Zzz 兜底）。梦境配图由应答路径现场生成后回填 image_path。
 */
export async function ensureDreamOnDemand(characterId, sleepUntil = null) {
  const db = getDb();

  // 幂等检查（含 generating 占位行，天然防并发重复生成）
  const latest = getLatestDream(characterId);
  if (latest && latest.status !== 'failed' && dreamAgeHours(latest) < 14) {
    return getCurrentDream(characterId);
  }

  // 先落一行 generating 占位
  const insertResult = db.prepare(
    `INSERT INTO character_dreams (character_id, content, status, sleep_until)
     VALUES (?, '', 'generating', ?)`
  ).run(characterId, sleepUntil || null);
  const dreamId = insertResult.lastInsertRowid;

  try {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!character) throw new Error(`character ${characterId} not found`);

    // 1. 选梦型（代码侧加权随机）+ 2. 采样素材 + 3. 单次 LLM 调用
    const conversationId = `char_${characterId}`;
    const affinity = loadAffinity(characterId);
    const emotionBaseline = JSON.parse(character.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}');
    let valence = 0;
    try {
      valence = getCompositeEmotion(loadEmotionState(conversationId, emotionBaseline)).valence;
    } catch { /* 情绪读取失败按中性处理 */ }
    const isOath = !!loadOath(characterId);
    const dreamType = pickDreamType(affinity, valence, isOath);
    const materials = sampleMaterials(db, characterId, conversationId);
    const generated = await generateDreamWithLLM(character, dreamType, materials);

    db.prepare(
      `UPDATE character_dreams
       SET dream_type = ?, content = ?, image_prompt = ?, status = 'ready'
       WHERE id = ?`
    ).run(generated.type, generated.content, generated.imagePrompt, dreamId);

    console.log(`[dream] ${character.display_name} 当场做了一个梦 (${generated.type}): "${generated.content.slice(0, 40)}${generated.content.length > 40 ? '…' : ''}"`);
    return db.prepare('SELECT * FROM character_dreams WHERE id = ?').get(dreamId);
  } catch (err) {
    db.prepare(`UPDATE character_dreams SET status = 'failed' WHERE id = ?`).run(dreamId);
    console.warn(`[dream] on-demand generation failed for character ${characterId}:`, err.message);
    return null;
  }
}

/**
 * 选梦型：代码侧加权随机。
 * memory_remix/absurd 基础权重；about_user 随 affinity 上升（<40 不出现）；
 * nightmare 随 VAD valence 走低上升；sweet 随 valence 走高上升；
 * spicy 仅 loadOath() && affinity≥85 时入池。
 */
function pickDreamType(affinity, valence, isOath) {
  const pool = [
    { type: 'memory_remix', w: 3 },
    { type: 'absurd', w: 2 },
  ];
  if (affinity >= 40) {
    pool.push({ type: 'about_user', w: Math.min(5, (affinity - 40) / 12 + 1) });
  }
  pool.push({ type: 'nightmare', w: Math.max(0, (0.1 - valence) * 6) });
  pool.push({ type: 'sweet', w: Math.max(0, (valence - 0.2) * 6) });
  if (isOath && affinity >= 85) {
    pool.push({ type: 'spicy', w: 2 });
  }

  const total = pool.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return 'memory_remix';
  let roll = Math.random() * total;
  for (const p of pool) {
    roll -= p.w;
    if (roll <= 0) return p.type;
  }
  return 'memory_remix';
}

/**
 * 采样素材（固定三源，有则注入）：
 * 1. 最近一个事件 — event_history 最新一条（标题 + 摘要）
 * 2. 最近一次聊天记忆总结 — rolling_summaries 最新一条
 * 3. 最近一条朋友圈 — moment_posts 最新一条已发布帖
 */
function sampleMaterials(db, characterId, conversationId) {
  const parts = [];

  const event = db.prepare(
    `SELECT title, summary FROM event_history
     WHERE character_id = ? AND title != ''
     ORDER BY id DESC LIMIT 1`
  ).get(characterId);
  if (event) {
    const summaryText = event.summary ? `——${String(event.summary).slice(0, 200)}` : '';
    parts.push(`- 最近发生的事件：「${event.title}」${summaryText}`);
  }

  const summary = db.prepare(
    'SELECT summary FROM rolling_summaries WHERE conversation_id = ? ORDER BY id DESC LIMIT 1'
  ).get(conversationId);
  if (summary) parts.push(`- 最近聊天的整体印象：${String(summary.summary).slice(0, 200)}`);

  const post = db.prepare(
    `SELECT content FROM moment_posts
     WHERE character_id = ? AND status = 'done'
     ORDER BY id DESC LIMIT 1`
  ).get(characterId);
  if (post?.content) parts.push(`- 最近发的朋友圈：${String(post.content).slice(0, 150)}`);

  return parts;
}

/**
 * 组装梦境系 LLM 调用的分层 system 消息（对齐全库规范）：
 *   system0 = 破甲 + 世界观注入（getSystemRulesWithWorld）
 *   system1 = 世界观强化（有世界观时，photo 域——两次调用都会产出 imagePrompt）
 *   system2 = 生图规则（IMAGE_PROMPT_RULE）
 *   system3 = 人物简介 + 外观（short_prompt + base_prompt 的「## 你的外观」段到末尾）
 */
function buildDreamSystemLayers(character) {
  const msgs = [];

  // system0: 破甲 + 世界观
  msgs.push({ role: 'system', content: getSystemRulesWithWorld() || '你是一个角色扮演 AI。' });

  // system1: 世界观强化（有世界观时才注入）
  try {
    if (getWorldSetting()) {
      msgs.push({ role: 'system', content: getWorldIntegrationRule('photo') });
    }
  } catch { /* 规则缺失非致命 */ }

  // system2: 生图规则（两个调用都要求输出 imagePrompt）
  msgs.push({ role: 'system', content: `【生图规则】\n${IMAGE_PROMPT_RULE.rule_content}` });

  // system3: 人物简介 + 外观（short_prompt + base_prompt 的「## 你的外观」段到末尾，含生效外观注入）
  msgs.push({ role: 'system', content: buildCharacterPersona(character, { variant: 'short', joiner: '\n\n' }) });

  return msgs;
}

/** 单次 LLM 调用生成梦，输出 JSON {type, content, imagePrompt}。解析兜底：剥围栏→JSON.parse→正则提取→失败抛错（置 status='failed'，不重试）。梦话不预置——说出口的那一刻才现编。 */
async function generateDreamWithLLM(character, dreamType, materialParts) {
  const msgs = buildDreamSystemLayers(character);
  msgs.push({
    role: 'user',
    content: `【当前状态】你睡着了，正在做一场「${DREAM_TYPE_DESC[dreamType] || DREAM_TYPE_DESC.absurd}」的梦。

【可扭曲的素材】
${materialParts.length > 0 ? materialParts.join('\n') : '-（没有具体素材，自由发挥）'}

要求：
- 第一人称叙述这场梦，80~150 字
- 遵循梦的逻辑：场景可以跳跃、变形、时间错乱、不合理，但梦里的你觉得一切都很合理
- 素材可以扭曲、混搭、张冠李戴，不要照搬原句
- 禁止解梦，禁止解释这个梦意味着什么
- 只输出 JSON，不要输出任何其他内容

输出格式：
{"type":"${dreamType}","content":"第一人称梦境叙述","imagePrompt":"英文生图提示词，描述梦境画面"}

其中 imagePrompt 用英文描述梦境的超现实画面。`,
  });

  const raw = await chatSync(msgs, { temperature: 0.82, max_tokens: 1000, label: '梦境生成' });
  const parsed = parseDreamJson(raw);
  if (!parsed || typeof parsed.content !== 'string' || parsed.content.trim().length < 10) {
    throw new Error('dream LLM output unparseable');
  }

  return {
    type: DREAM_TYPE_DESC[parsed.type] ? parsed.type : dreamType,
    content: parsed.content.trim(),
    imagePrompt: (typeof parsed.imagePrompt === 'string' && parsed.imagePrompt.trim()) ? parsed.imagePrompt.trim() : null,
  };
}

function parseDreamJson(raw) {
  if (!raw) return null;  const text = String(raw).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* fallthrough */ }
  }
  return null;
}

// ── 查询 / 标记 ──

/** 当前睡眠会话的 ready 梦（created_at <14h，最新一条）。 */
export function getCurrentDream(characterId) {
  const dream = getLatestDream(characterId);
  if (!dream || dream.status !== 'ready') return null;
  if (dreamAgeHours(dream) >= 14) return null;
  return dream;
}

/** 未分享且当天有效（ready、shared_at IS NULL、created_at <16h）的梦。 */
export function getFreshUnsharedDream(characterId) {
  const dream = getCurrentDream(characterId);
  if (!dream) return null;
  if (dream.shared_at != null) return null;
  if (dreamAgeHours(dream) >= 16) return null;
  return dream;
}

/** 首次被正式提及的时间/渠道（wake / wake_reply / proactive）。 */
export function markDreamShared(dreamId, via) {
  getDb().prepare(
    `UPDATE character_dreams SET shared_at = datetime('now'), shared_via = ? WHERE id = ? AND shared_at IS NULL`
  ).run(via, dreamId);
}

// ── 当场现编梦话（所有梦话的唯一来源，无预置）──

/**
 * 当场生成一句梦话 + 配套生图提示词（单次 LLM 调用）。
 * userMessage 有值 = 睡中被消息叫住的应答（声音渗进梦里）；
 * 为 null = 定时夜话（睡到半梦半醒自己嘟囔一句）。
 * 失败返回 null（调用方按各自场景静默跳过或走 Zzz 兜底）。
 */
export async function generateLiveDreamMurmur(characterId, userMessage = null) {
  try {
    const db = getDb();
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!character) return null;
    const dream = getCurrentDream(characterId);

    const hasMsg = userMessage != null && String(userMessage).trim();
    const triggerDesc = hasMsg
      ? '你现在正在睡觉做梦。你不会醒来——消息声渗进了梦里，你只是在梦中含糊地嘟囔了一句梦话。'
      : '你现在正在睡觉做梦。你不会醒来——睡到半梦半醒之间，你在梦中含糊地嘟囔了一句梦话。';

    // system0=破甲+世界观 / system1=世界观强化 / system2=生图规则 / system3=人设+外观
    const msgs = buildDreamSystemLayers(character);
    msgs.push({
      role: 'user',
      content: `【当前状态】${triggerDesc}

【你正做着的梦】${dream?.content || '（一片模糊的梦境）'}
${hasMsg ? `
【user 刚发来的消息（你没有真正看到，只是声音搅动了梦境）】${String(userMessage).trim().slice(0, 200)}
` : ''}
只输出 JSON：
{"talk":"...","imagePrompt":"..."}

要求：
- talk：你此刻说出口的梦话，15~40 字，第一人称，大量使用「……」表现含糊、拖长、断断续续的睡意；${hasMsg ? '可以把消息里的词迷迷糊糊揉进梦里，也可以完全沉浸在自己的梦中场景，' : ''}但绝不能像清醒回复
- imagePrompt：英文生图提示词，遵循【生图规则】，描绘你说这句梦话时的梦境画面（超现实、梦幻氛围）`,
    });

    const raw = await chatSync(msgs, { temperature: 0.82, max_tokens: 1000, label: '梦话应答' });
    const parsed = parseDreamJson(raw);
    const talk = (parsed && typeof parsed.talk === 'string') ? parsed.talk.trim().slice(0, 60) : '';
    if (!talk || talk.length < 4) return null;
    return {
      talk,
      imagePrompt: (parsed && typeof parsed.imagePrompt === 'string' && parsed.imagePrompt.trim())
        ? parsed.imagePrompt.trim()
        : (dream?.image_prompt || null),
    };
  } catch (err) {
    console.warn(`[dream] generateLiveDreamMurmur failed for ${characterId}:`, err.message);
    return null;
  }
}

/** 给生图提示词叠加梦境风格后缀（dreamcore 超现实氛围）。 */
export function decorateDreamImagePrompt(prompt) {
  if (!prompt || !prompt.trim()) return null;
  return prompt.trim() + DREAM_STYLE_SUFFIX;
}

// ── 说梦话（独立主动链路）──

// ── 自然醒钩子 ──

/**
 * 自然醒后调用（scheduleManager 自然醒分支触发）：
 * 存在 unshared 梦且 affinity≥60 && proactive_disabled=0 && streak<3 时，
 * 把 next_proactive_at 提前到 now+10~40min（"醒来第一件事想告诉你"）。
 */
export function onCharacterWake(characterId) {
  try {
    const db = getDb();
    const dream = getCurrentDream(characterId);
    if (!dream) return;

    if (dream.shared_at != null) return;
    if (dreamAgeHours(dream) >= 16) return;

    const char = db.prepare('SELECT proactive_disabled, proactive_streak FROM characters WHERE id = ?').get(characterId);
    if (!char || char.proactive_disabled) return;
    if ((char.proactive_streak || 0) >= 3) return;
    if (loadAffinity(characterId) < 60) return;

    const delayMin = 10 + Math.random() * 30;
    const nextAt = new Date(Date.now() + delayMin * 60000).toISOString();
    db.prepare('UPDATE characters SET next_proactive_at = ? WHERE id = ?').run(toSQLiteDate(nextAt), characterId);
    console.log(`[dream] character ${characterId}: unshared dream → proactive accelerated to ~${Math.round(delayMin)}min later`);
  } catch (err) {
    console.warn('[dream] onCharacterWake failed:', err.message);
  }
}
