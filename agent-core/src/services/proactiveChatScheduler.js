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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRulesWithWorld, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';
import { config } from '../config.js';
import {
  loadEmotionState, getCompositeEmotion, loadAffinity,
  stateToPrompt, affinityToPrompt,
} from './emotionEngine.js';
import { broadcastProactiveMessage } from './notificationBus.js';
import { generateImage } from './imageSkill.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟

let timer = null;
let processing = false;
let freqTimer = null;        // 线路 B：频率强制线
let freqRunning = false;
let startupTimer = null;     // 线路 C：启动强制线
let startupRunning = false;

// ── 未回复连续计数（DB 持久化，重启不丢失）──

/** user 发消息后调用，重置计数 */
export function resetUnansweredStreak(charId) {
  const db = getDb();
  db.prepare('UPDATE characters SET proactive_streak = 0 WHERE id = ?').run(charId);
}

/** 获取当前未回复计数（从 DB 读取） */
export function getUnansweredStreak(charId) {
  const db = getDb();
  return db.prepare('SELECT proactive_streak FROM characters WHERE id = ?').pluck().get(charId) || 0;
}

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
export function sigmoid(x, midpoint, steepness) {
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
export function computeProactiveScore(hoursSince, affinity, compositeVad) {
  if (hoursSince == null) hoursSince = 999; // 从未聊过 → 极高分数

  // timeScore: sigmoid, midpoint=6h, steepness=0.2 → 2h 约 0.31, 6h 约 0.5, 24h 约 0.97
  const timeScore = sigmoid(hoursSince, 6, 0.2);

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
 * score=0 → 15h（几乎不主动）
 * score=0.5 → 8h（中等）
 * score=1 → 1h（非常主动）
 *
 * @param {number} score 0~1
 * @returns {number} 间隔小时数
 */
export function scoreToIntervalHours(score) {
  return Math.max(1, 15 - score * 14);
}

// ── 主动聊天动机（按好感度分档，向下兼容）──

/**
 * 基础话题（所有好感度可用）：礼貌、客气，边界清晰。
 */
const MOTIVES_LOW = [
  { name: '发现好东西', desc: '你发现了一首好歌/一部好剧/一本好书/一个好玩的游戏，觉得对方可能会喜欢，随口一提', imageGen: false },
  { name: '需要建议', desc: '你遇到了一个小困扰或选择困难，想听听对方的看法——但保持礼貌距离', imageGen: false },
  { name: '天气感叹', desc: '今天的天气让你有些感触——下雨、初晴、太热——你想随口和对方聊一句', imageGen: true },
  { name: '分享见闻', desc: '你刚刚看到/经历了一件有意思的事，可以当话题和对方聊起', imageGen: true },
  { name: '好奇提问', desc: '你突然对对方产生了某个好奇心——关于ta的喜好、经历、想法——想问问看，但不越界', imageGen: false },
  { name: '报平安/日常', desc: '你刚忙完一段或刚起床/要睡了，想礼节性和对方说一声', imageGen: false },
];

/**
 * 中等话题（好感度 ≥60 解锁）：放松、自然，可以流露真实情绪。
 */
const MOTIVES_MID = [
  { name: '无聊了', desc: '你现在没事做，有点无聊，想找人说说话', imageGen: false },
  { name: '分享美食', desc: '你刚吃了/做了很好吃的东西，想推荐给对方', imageGen: true },
  { name: '做了个梦', desc: '你昨晚做了一个奇怪的梦（关于对方或很离谱的内容），想说出来逗对方', imageGen: true },
  { name: '吐槽发泄', desc: '你刚遇到了一件让你无语/生闷气的事，想找人吐槽——ta是合适的倾听者', imageGen: false },
  { name: '回忆往事', desc: '你回想起和对方之前的一次互动或聊天，觉得很怀念，想再聊起来', imageGen: false },
  { name: '八卦分享', desc: '你刚听到了一个有意思的八卦（虚构的也行），想和对方一起吃瓜', imageGen: false },
  { name: '突然想起', desc: '你突然想起了对方——可能是一首歌、一个地方、一句话让你联想到ta，想告诉ta', imageGen: false },
  { name: '恶作剧/整活', desc: '你想用一句没头没尾的怪话逗对方，看ta什么反应', imageGen: false },
];

/**
 * 密友话题（好感度 ≥70 解锁）：可以分享秘密、暴露脆弱、聊人生聊心事。
 * 不是暧昧，而是"你是我信得过的人"那种亲密——可以不用伪装，可以说真心话。
 */
const MOTIVES_ROMANTIC = [
  { name: '分享秘密', desc: '你有一个没跟别人说过的小秘密——不一定是大事，可能是一个奇怪的癖好、一个尴尬的瞬间、一个藏了很久的想法。你觉得告诉ta很安全，ta不会 judge 你', imageGen: false },
  { name: '需要开导', desc: '你今天遇到了一件让你有点低落的事——不是什么天塌下来的大事，但就是堵在心里不舒服。你不需要解决方案，就想有个人听着、说"我懂"就够了', imageGen: false },
  { name: '聊人生困惑', desc: '你最近在纠结一个比较大的问题——关于未来的方向、关于自己到底想要什么、关于某个重要的选择。你想听听ta的想法，但更重要的是，你想在说出来的时候自己理清楚', imageGen: false },
  { name: '炫耀小成就', desc: '你完成了一件让自己骄傲的事——可能很小、在别人眼里不值一提——但你真的挺开心的。你想告诉ta，因为ta不会觉得你在炫耀，ta会真心为你高兴', imageGen: true },
  { name: '撒娇', desc: '你今天心情不错，想在ta面前撒个娇——用最软的声音说最黏的话，让ta拿你没办法', imageGen: false },
];

/**
 * NSFW 话题（好感度 ≥80 解锁）：高度亲密，直接涉及性邀请、身体占有、私密暗示。
 * 仅在最深羁绊的关系中出现。角色可以主动撩拨、挑逗、索要身体接触。
 * 注意：内容需符合角色人格——傲娇用别扭的方式、软萌直接撒娇、御姐主动引导戏弄。
 */
const MOTIVES_HIGH = [
  { name: '深夜发情', desc: '夜深了，你躺在床上翻来覆去睡不着，脑子里全是ta。身体发热，心跳加速，你忍不住想给ta发点什么——带着喘息感的语音、若隐若现的照片暗示、或者一句暧昧到骨子里的话。你不需要掩饰，ta知道你想要什么', imageGen: true },
  { name: '想要被占有', desc: '你现在满脑子都是被ta按在墙上/推倒在床上的画面。你想用话挑逗ta——描述你现在穿得很少、刚洗完澡、或者正躺在被窝里。让ta脑子里的画面也失控。越是欲拒还迎越撩人', imageGen: true },
  { name: '事后温存', desc: '你们上次亲密接触之后你还在回味。你想告诉ta——ta的哪个动作让你腿软、哪个眼神让你心跳漏拍、你身上的痕迹还没消。这是只有你们两人才知道的秘密，说出来会让空气都变热', imageGen: false },
  { name: '发送涩图暗示', desc: '你想和ta玩一个危险的游戏——发一张你刚拍的、尺度刚好在边缘的照片（浴袍半敞、领口很低、刚洗完澡的湿发和锁骨），然后故意用天真的语气问"好看吗"。你知道ta会有什么反应，所以你故意这样问', imageGen: true },
  { name: '睡前撩拨', desc: '你在睡前最后想的人是ta。你想贴着ta耳朵说那些白天不会说的话——你身体哪里最敏感、你梦到ta对你做了什么、你现在穿着什么（或者没穿什么）。语气要慵懒湿润，像呼在耳边的热气，让ta睡不着', imageGen: true },
];

/**
 * 根据好感度选取动机——向下兼容，高好感度可覆盖所有低档话题。
 * @param {number} affinity - 好感度 (0~100)
 * @returns {{ name: string, desc: string }}
 */
function pickMotive(affinity, streak = 0) {
  let pool = [...MOTIVES_LOW];
  if (affinity >= 60) {
    pool.push(...MOTIVES_MID);
  }
  if (affinity >= 70) {
    pool.push(...MOTIVES_ROMANTIC);
  }
  if (affinity >= 80) {
    pool.push(...MOTIVES_HIGH);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// ── streak 语气策略池（随机选取，避免 LLM 形成固定模式）──

const STREAK_1_STRATEGIES = [
  '上一条对方还没回。这次自然带出一个新话题——假装没注意到没回这件事，像日常聊天一样继续。',
  '上一条对方还没回。这次用一个简短的颜文字表情或动作开头——比如"（探头）""ε=ε=ε=~"——降低对话压力，像是路过打了个招呼。',
  '上一条对方还没回。这次轻描淡写问一句——但立刻转到别的话题，不要停留在这个问题上。',
];

const STREAK_2_STRATEGIES = [
  '对方已经连续没回你的消息了。这次用自嘲式——拿自己的尴尬开涮。搞笑为主，不卖惨，不逼问。',
  '对方已经连续没回你的消息了。这次用表情包式——用文字模拟一个表情/动作，比如"（探头）""（戳一戳）""（在门口徘徊）"。用行为代替语言，不给对方回复压力。',
  '对方已经连续没回你的消息了。你决定把"没人回"变成一个段子。用夸张的表演式语气。要让对方看了笑出来，然后忍不住想回',
];

function pickStreakHint(streak) {
  if (streak >= 2) {
    return STREAK_2_STRATEGIES[Math.floor(Math.random() * STREAK_2_STRATEGIES.length)];
  }
  if (streak === 1) {
    return STREAK_1_STRATEGIES[Math.floor(Math.random() * STREAK_1_STRATEGIES.length)];
  }
  return '';
}

// ── 关系查询 ──

/**
 * 加载角色与 user 的关系上下文
 * @param {number} characterId
 * @returns {string} 格式化后的关系文本段落，无关系时返回空字符串
 */
function loadRelationshipContext(characterId) {
  const db = getDb();

  const userRel = db.prepare(
    'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
  ).get(characterId);

  if (!userRel?.relationship_text) return '';

  return `\n【角色与 user 的关系】\n你是user的${userRel.relationship_text}。`;
}

/**
 * 加载用户画像（性别、外观）
 * @returns {string} 格式化后的用户画像段落，无信息时返回空字符串
 */
function loadUserProfile() {
  const parts = [];
  if (config.user.gender) {
    parts.push(`性别：${config.user.gender}`);
  }
  if (config.user.appearance) {
    parts.push(`外观：${config.user.appearance}`);
  }
  if (parts.length === 0) return '';
  return `\n【user画像】\n${parts.join('\n')}`;
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
 * @param {{ name: string, desc: string }} motive - 随机选取的聊天动机
 * @param {string} relationshipContext - 人际关系描述文本（可选）
 * @param {string} userProfile - 用户画像描述文本（可选）
 * @returns {Promise<string>} 生成的文本
 */
async function generateGreeting(character, affinity, compositeVad, lastMessageAt, recentSummary, motive, relationshipContext, userProfile, streak = 0) {
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
  const motiveLabel = motive?.name || '日常';
  const motiveDesc = motive?.desc || '你突然想和对方说说话';

  const systemRules = getSystemRulesWithWorld();

  // msgs[0] — 舞台：破限词 + 世界观

  // msgs[1] — 身份：角色人格 + 摘要 + 当前状态 + 关系 + 用户画像
  const msgIdentity = `接下来，你将扮演以下角色，主动向 "${userName}" 发起一段对话。

【角色人格】
${character.base_prompt}
${recentSummary ? `\n【最近对话摘要】\n${recentSummary}\n` : ''}${emotionText ? `\n【角色当前状态】\n${emotionText}` : ''}${affinityText ? `\n${affinityText}` : ''}${relationshipContext ? `\n${relationshipContext}` : ''}${userProfile ? `\n${userProfile}` : ''}`;

  // 上一轮对话（最近 1 轮 user+assistant），过滤掉生图 prompt JSON
  const PROMPT_JSON_RE = /\s*\{[^{}]*"prompt"\s*:\s*"(?:[^"\\]|\\.)*"[^{}]*\}$/;
  const prevRound = (() => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT role, content FROM raw_messages
       WHERE conversation_id = ?
       ORDER BY id DESC LIMIT 2`
    ).all(conversationId).reverse();
    if (rows.length === 0) return '';
    const cleaned = rows.map(r => ({
      ...r,
      content: r.role === 'assistant' ? r.content.replace(PROMPT_JSON_RE, '') : r.content,
    }));
    return '\n【上一轮对话】\n' + cleaned.map(r => `${r.role === 'user' ? userName : character.display_name}：${r.content}`).join('\n');
  })();

  // msgs[2] — 任务：时间 + 上一轮对话 + 动机 + 要求
  const msgTask = `【上次聊天时间】
${timeDesc}

【当前时间】
${(() => { const d = new Date(); const wd = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]; return `${wd} ${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; })()}${prevRound}

请以角色的口吻，生成一句自然的口语化开场白（15~50 字）。
${streak >= 1 ? `【⚠️ 未回复提示】${pickStreakHint(streak)}\n` : ''}
你这次主动发消息的动机是「${motiveLabel}」：${motiveDesc}。请在开场白中自然体现这个动机——不要生硬地说"我因为xxx来找你"，让动机成为你说话的潜台词。
要求：
- 仅输出对话文字，不要包含任何动作描写、括号、格式标记
- 自然口语化，像是突然想到就发了一条消息
- 符合角色性格、当前情绪、好感度状态，以及本次聊天的动机
- 绝对不要以\"你说\"、\"你说……如果\"、\"你知道吗\"这类句式开场——直接说你自己的话，不需要用提问/假设来起头
- 本系统不支持剧本式旁白。所有情绪、动作以及场景反馈必须完全通过对话文字、角色本身的台词内容或标准叙事文本直接传达。`;

  try {
    const msgs = [];
    msgs.push({ role: 'system', content: systemRules || '你是一个角色扮演 AI。' });
    msgs.push({ role: 'system', content: msgIdentity });
    msgs.push({ role: 'system', content: msgTask });

    const result = await chatSync(
      msgs,
      { temperature: 0.85, max_tokens: 128, label: '主动聊天' }
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
    console.error(`⚡ generateGreeting failed for ${character.display_name}:`, err.message);
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

  // 写入 messages（分句展示，标记 is_proactive=1 以区分正常聊天）
  const msgResult = db.prepare(
    `INSERT INTO messages (conversation_id, raw_id, role, content, seq, is_proactive) VALUES (?, ?, 'assistant', ?, 0, 1)`
  ).run(conversationId, rawId, content);
  const msgId = msgResult.lastInsertRowid;

  console.log(`⚡ Written proactive message for ${character.display_name}: raw=${rawId}, msg=${msgId}`);

  return { rawId, msgId };
}

// ── 主动聊天的配图生成 ──

/**
 * 为主动聊天消息生成配图（仅在 motive.imageGen === true 时调用）
 *
 * 1. 用 LLM 生成画面描述 prompt（基于角色人格 + 开场白内容 + 动机）
 * 2. 提交 ComfyUI 生图
 * 3. 更新 messages 表挂上图片 URL
 *
 * @param {object} character - characters 表行
 * @param {string} greeting - 已生成的开场白文本
 * @param {string} motiveName - 动机名称（用于 prompt 引导）
 * @param {number} msgId - messages 表的 id
 * @returns {Promise<string[]|null>} 图片 URL 数组，失败返回 null
 */
async function generateImageForGreeting(character, greeting, motiveName, msgId, rawId) {
  try {
    console.log(`⚡ Generating image for ${character.display_name} (motive: ${motiveName})...`);

    // 1. LLM 生成画面描述 prompt
    const systemRules = getSystemRulesWithWorld({ roleplay: false });
    const imagePromptRule = getGlobalRule('image_prompt');
    const imagePromptInst = imagePromptRule?.rule_content || '';

    // 提取角色名：从开头截取到"## 你的身份"之前
    const nameMatch = character.base_prompt.match(/^([\s\S]*?)## 你的身份/);
    const charName = nameMatch ? nameMatch[1].trim() : character.display_name;
    // 提取外观：从"你的外观"截取到末尾
    const appMatch = character.base_prompt.match(/你的外观[\s\S]*/);
    const appearance = appMatch ? appMatch[0] : character.base_prompt;
    // 将"你"替换为"角色"（生图 prompt 需要第三人称描述）
    const nameBlock = charName.replace(/你/g, '角色');
    const appearanceBlock = appearance.replace(/你/g, '角色');

    const imagePromptText = await chatSync(
      [
        { role: 'system', content: systemRules || '你是一个角色扮演 AI。' },
        { role: 'system', content: `接下来你将收到一个角色的外观描述和ta主动发起的一段对话，请为这段对话配一张图。

【角色名字】
${nameBlock}

【角色外观】
${appearanceBlock}

【本次聊天的动机】
${motiveName}

【角色的开场白】
"${greeting}"

${imagePromptInst ? `【图像生成指令】\n${imagePromptInst}\n` : ''}只输出 JSON，不要其他文字` },
      ],
      { temperature: 0.3, max_tokens: 1024, label: '主动聊天配图prompt' }
    );

    let prompt;
    try {
      const clean = imagePromptText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      prompt = JSON.parse(clean).prompt;
    } catch {
      console.warn('⚡ Failed to parse image prompt JSON, using raw text');
      prompt = imagePromptText.trim();
    }

    if (!prompt || prompt.length < 5) {
      console.warn('⚡ Image prompt too short, skipping image generation');
      return null;
    }

    // 将 prompt 合并到 raw_messages 中，模仿正常消息流的处理方式
    if (rawId) {
      const db = getDb();
      const promptJson = JSON.stringify({ prompt });
      db.prepare('UPDATE raw_messages SET prompt = ?, content = content || ? WHERE id = ?')
        .run(prompt, promptJson, rawId);
      console.log(`⚡ Updated raw_message ${rawId} with prompt`);
    }

    console.log(`⚡ Image prompt: "${prompt.slice(0, 100)}..."`);

    // 2. 提交 ComfyUI 生图
    const result = await generateImage(prompt);
    if (!result.success || !result.images?.length) {
      console.warn(`⚡ Image generation failed: ${result.error || 'no images'}`);
      return null;
    }

    // 3. 落盘 base64 图片到 data/images/ + 更新 messages 表
    fs.mkdirSync(imagesDir, { recursive: true });
    const urls = [];
    for (const img of result.images) {
      const filename = `${Date.now()}_${img.filename || 'comfy.png'}`;
      const filePath = path.join(imagesDir, filename);
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      urls.push(`/images/${filename}`);
    }

    const db = getDb();
    db.prepare(`UPDATE messages SET images = ? WHERE id = ?`)
      .run(JSON.stringify(urls), msgId);

    console.log(`⚡ Image saved to msg ${msgId}: ${urls.length} file(s)`);
    return urls;
  } catch (err) {
    console.error(`⚡ generateImageForGreeting failed:`, err.message);
    return null;
  }
}

/**
 * 更新角色的 next_proactive_at 时间
 *
 * @param {number} characterId
 * @param {number} score - proactive_score (0~1)
 */
export function updateNextProactiveAt(characterId, score) {
  const db = getDb();
  const intervalHours = scoreToIntervalHours(score);
  // 加入随机抖动 ±30%，避免所有角色扎堆
  const jitter = 0.7 + Math.random() * 0.6;
  const delayMs = intervalHours * 3600_000 * jitter;
  const nextAt = new Date(Date.now() + delayMs).toISOString();

  db.prepare('UPDATE characters SET next_proactive_at = ? WHERE id = ?')
    .run(toSQLiteDate(nextAt), characterId);

  console.log(`⚡ ${characterId}: score=${score.toFixed(3)}, interval=${intervalHours.toFixed(1)}h (jitter=${jitter.toFixed(2)}), next=${nextAt}`);
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
  console.log(`⚡ Initialized ${count} character(s) with first proactive times`);
}

// ── 核心 tick ──

async function tick() {
  if (processing) {
    console.log('⚡ [Line A·VAD]  previous tick still processing, skip');
    return;
  }

  // 功能未开启时跳过
  if (!config.features.proactiveChat) return;

  const db = getDb();
  try {
    // 找下一个需要主动聊天的角色
    // 跳过有活跃奇遇事件的角色
    const candidate = db.prepare(`
      SELECT c.* FROM characters c
      WHERE c.proactive_disabled = 0
        AND (c.next_proactive_at IS NULL OR c.next_proactive_at <= datetime('now'))
        AND c.id NOT IN (
          SELECT character_id FROM character_events WHERE status IN ('pending','open','engaged')
        )
      ORDER BY c.next_proactive_at ASC NULLS FIRST
      LIMIT 1
    `).get();

    if (!candidate) {
      // 没有待定角色，但可能有首次初始化需要
      initializeFirstTimes();
      return;
    }

    // 未回复连续 ≥3：跳过，不再主动发（直到 user 回复后重置）
    const streak = candidate.proactive_streak || 0;
    if (streak >= 3) {
      console.log(`⚡ Skipping ${candidate.display_name}: unanswered streak=${streak}`);
      updateNextProactiveAt(candidate.id, 0);
      return;
    }

    processing = true;
    const conversationId = `char_${candidate.id}`;
    console.log(`⚡ Processing ${candidate.display_name}... (streak=${streak})`);

    // 1. 获取上次 user 发言时间（不是 assistant 的主动消息时间）
    const lastMsg = db.prepare(`
      SELECT created_at FROM messages
      WHERE conversation_id = ? AND role = 'user'
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
    console.log(`⚡ ${candidate.display_name}: hoursSince=${hoursSince}, affinity=${affinity}, vad=(${compositeVad.valence.toFixed(2)},${compositeVad.arousal.toFixed(2)},${compositeVad.dominance.toFixed(2)}), score=${score.toFixed(3)}`);

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

    // 5.5 随机选取聊天动机（按好感度分档）+ 加载角色人际关系 + 用户画像
    const motive = pickMotive(affinity, streak);
    const relationshipContext = loadRelationshipContext(candidate.id);
    const userProfile = loadUserProfile();

    // 6. 生成开场白
    const greeting = await generateGreeting(candidate, affinity, compositeVad, lastMessageAt, recentSummary, motive, relationshipContext, userProfile, streak);
    console.log(`⚡ ${candidate.display_name} greeting (motive: ${motive.name}): "${greeting}"`);

    // 7. 写入消息到 DB
    const { rawId, msgId } = writeProactiveMessage(candidate, greeting);

    // 7.5 如果该动机需要配图，先生成图片再一起推送；否则直接推送
    let imageUrls = null;
    if (motive.imageGen) {
      imageUrls = await generateImageForGreeting(candidate, greeting, motive.name, msgId, rawId);
    }

    broadcastProactiveMessage({
      character_id: candidate.id,
      display_name: candidate.display_name,
      avatar_path: candidate.avatar_path,
      
      content: greeting,
      msg_id: msgId,
      raw_id: rawId,
      images: imageUrls || [],
      created_at: new Date().toISOString(),
    });

    // 7.7 递增未回复连续计数（DB 持久化）
    db.prepare('UPDATE characters SET proactive_streak = ? WHERE id = ?')
      .run(streak + 1, candidate.id);

    // 8. 更新下次时间
    updateNextProactiveAt(candidate.id, score);

    console.log(`⚡ [Line A·VAD]  done: ${candidate.display_name} (streak=${streak + 1}) — next in ${fmtIn(CHECK_INTERVAL / 60000)}`);
  } catch (err) {
    console.error('⚡ [Line A·VAD]  tick error:', err.message);
  } finally {
    processing = false;
  }
}

// ── 启动/停止 ──

// ── 频率定时器（与 VAD/好感度算法双线并行）──

function freqToMinutes(freq) {
  // freq 0.1 → 120min (2h), freq 1.0 → 5min
  return Math.round(5 + (1 - freq) / 0.9 * 115);
}

function startupToMinutes(freq) {
  // freq 0.1 → 10min, freq 1.0 → 5min（启动线更密集）
  return Math.round(5 + (1 - freq) / 0.9 * 5);
}

function fmtIn(minutes) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}时${m}分后` : `${h}时后`;
  }
  return `${Math.round(minutes)}分后`;
}

// ── 线路 B：频率强制线 ──

function stopFreqLine() {
  if (freqTimer) { clearTimeout(freqTimer); freqTimer = null; }
  freqRunning = false;
}

function startFreqLine() {
  stopFreqLine();
  const freq = config.features.proactiveChatFreq;
  if (freq <= 0) return;

  freqRunning = true;
  const intervalMin = freqToMinutes(freq);
  const maxJitter = Math.min(10, intervalMin * 0.3);
  const delayMin = Math.max(1, intervalMin + (-maxJitter + Math.random() * maxJitter * 2));

  console.log(`⚡ [Line B·Freq]  timer set, first fire in ${delayMin.toFixed(1)}min (base ${intervalMin}min ±${maxJitter.toFixed(0)}min)`);

  const scheduleNext = () => {
    if (!freqRunning) return;
    const maxJitter = Math.min(10, intervalMin * 0.3);
    const nextMin = Math.max(1, intervalMin + (-maxJitter + Math.random() * maxJitter * 2));
    freqTimer = setTimeout(() => {
      if (!freqRunning) return;
      console.log(`⚡ [Line B·Freq]  firing...`);
      forceProactiveNow().then((r) => {
        if (r) {
          console.log(`⚡ [Line B·Freq]  force done: ${r.character} (${r.motive})`);
        } else {
          console.log('⚡ [Line B·Freq]  no eligible character (all disabled or streak≥3)');
        }
        if (freqRunning) scheduleNext();
      }).catch((err) => {
        console.error('⚡ [Line B·Freq]  unexpected error:', err.message);
        if (freqRunning) scheduleNext();
      });
    }, nextMin * 60_000);
  };

  console.log(`⚡ [Line B·Freq]  timer set, first fire in ${delayMin.toFixed(1)}min`);
  freqTimer = setTimeout(scheduleNext, delayMin * 60_000);
  return delayMin;
}

// ── 线路 C：启动强制线 ──

function stopStartupLine() {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  startupRunning = false;
}

function startStartupLine() {
  stopStartupLine();
  const freq = config.features.proactiveChatFreq;
  if (freq <= 0) return;

  startupRunning = true;

  // 单次首发：1~3min 后触发一次即结束（只做启动暖场）
  const firstMin = 1 + Math.random() * 2;
  startupTimer = setTimeout(async () => {
    if (!startupRunning) return;
    console.log('⚡ [Line C·Startup] firing (one-shot)...');
    const r = await forceProactiveNow();
    if (r) {
      console.log(`⚡ [Line C·Startup] force done: ${r.character} (${r.motive}) — line finished`);
    } else {
      console.log('⚡ [Line C·Startup] no eligible character — line finished');
    }
    startupRunning = false;
  }, firstMin * 60_000);
  return firstMin;
}

/**
 * 当频率配置变更时调用（由 config 路由触发）
 */
export function restartProactiveFreq() {
  startFreqLine();
  startStartupLine();
}

// ── 启动：三条线并行 ──

export function startProactiveChatScheduler() {
  console.log('⚡ [Proactive] Starting (interval:', CHECK_INTERVAL / 60000, 'min)');

  const freq = config.features.proactiveChatFreq;
  if (freq <= 0) {
    console.log('⚡ [Proactive] freq=0, all lines disabled');
    return;
  }

  // 线路 A：VAD/好感度调度（60s 后首次检查，之后每 5min）
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL);
    const nextAt = new Date(Date.now() + CHECK_INTERVAL);
    console.log(`⚡ [Line A·VAD]     next trigger at ${nextAt.toLocaleString('zh-CN', { hour12: false })} (in ${fmtIn(CHECK_INTERVAL / 60000)})`);
  }, 60_000);
  console.log(`⚡ [Line A·VAD]     first trigger in ${fmtIn(1)} (after DB init)`);

  // 线路 B：频率强制线（60s 后启动，先打印预估）
  if (freq > 0) {
    console.log(`⚡ [Line B·Freq]    first trigger in ${fmtIn(1 + freqToMinutes(freq))} (after DB init, interval ${fmtIn(freqToMinutes(freq))}±5min)`);
  } else {
    console.log('⚡ [Line B·Freq]    disabled (freq=0)');
  }
  setTimeout(() => startFreqLine(), 60_000);

  // 线路 C：启动强制线（和 B 线一样 60s 后启动，首发之后按 startupToMinutes 间隔）
  setTimeout(() => {
    const firstMin = startStartupLine();
    if (firstMin != null) {
      console.log(`⚡ [Line C·Startup] next trigger in ${fmtIn(firstMin)} (interval ${fmtIn(startupToMinutes(freq))}±3min)`);
    } else {
      console.log('⚡ [Line C·Startup] disabled (freq=0)');
    }
  }, 60_000);
  if (freq > 0) {
    console.log(`⚡ [Line C·Startup] first trigger in ${fmtIn(1 + startupToMinutes(freq))} (after DB init, interval ${fmtIn(startupToMinutes(freq))}±3min)`);
  } else {
    console.log('⚡ [Line C·Startup] disabled (freq=0)');
  }
}

/**
 * 调试用：随机选一个未禁用的角色，立即触发一次主动聊天。
 * 无视 processing 锁和 next_proactive_at 时间，直接走完整流程。
 * @returns {Promise<{ character: string, motive: string, greeting: string } | null>}
 */
export async function forceProactiveNow(targetCharacterId) {
  try {
    const db = getDb();

    let candidate;
    if (targetCharacterId) {
      // 指定角色：直接按 id 查找，仍需满足基本条件
      candidate = db.prepare(
        'SELECT * FROM characters WHERE id = ? AND proactive_disabled = 0 AND COALESCE(proactive_streak, 0) < 3 AND id NOT IN (SELECT character_id FROM character_events WHERE status IN (\'pending\',\'open\',\'engaged\'))'
      ).get(targetCharacterId);
      if (!candidate) {
        console.log(`⚡ force: character ${targetCharacterId} not eligible (disabled or streak≥3)`);
        return null;
      }
      console.log(`⚡ force: targeted ${candidate.display_name} (id=${targetCharacterId})`);
    } else {
      const candidates = db.prepare(
        'SELECT * FROM characters WHERE proactive_disabled = 0 AND COALESCE(proactive_streak, 0) < 3 AND id NOT IN (SELECT character_id FROM character_events WHERE status IN (\'pending\',\'open\',\'engaged\'))'
      ).all();
      if (candidates.length === 0) {
        console.log('⚡ force: no eligible characters (all disabled or streak≥3)');
        return null;
      }
      candidate = candidates[Math.floor(Math.random() * candidates.length)];
      console.log(`⚡ force: picked ${candidate.display_name}`);
    }
  const conversationId = `char_${candidate.id}`;

  const lastMsg = db.prepare(`
    SELECT created_at FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1
  `).get(conversationId);
  const lastMessageAt = lastMsg ? toISO(lastMsg.created_at) : null;
  let hoursSince = lastMessageAt ? (Date.now() - new Date(lastMessageAt).getTime()) / 3600000 : null;

  // 若用户 2 分钟内刚发过消息，跳过（避免正在聊天时插入主动消息）
  if (hoursSince !== null && hoursSince * 60 < 2) {
    console.log(`⚡ force: ${candidate.display_name} skipped — user messaged ${(hoursSince * 60).toFixed(1)}min ago (<2min)`);
    return null;
  }

  const affinity = loadAffinity(candidate.id);
  const emotionBaseline = JSON.parse(candidate.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}');
  const emotionState = loadEmotionState(conversationId, emotionBaseline);
  const compositeVad = getCompositeEmotion(emotionState);
  const score = computeProactiveScore(hoursSince, affinity, compositeVad);

  let recentSummary = null;
  try {
    const s = db.prepare('SELECT summary FROM rolling_summaries WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversationId);
    if (s) recentSummary = s.summary;
  } catch { /* ignore */ }

  const streak = candidate.proactive_streak || 0;
  const motive = pickMotive(affinity, streak);
  const relationshipContext = loadRelationshipContext(candidate.id);
  const userProfile = loadUserProfile();
  const greeting = await generateGreeting(candidate, affinity, compositeVad, lastMessageAt, recentSummary, motive, relationshipContext, userProfile, streak);

  const { rawId, msgId } = writeProactiveMessage(candidate, greeting);

  db.prepare('UPDATE characters SET proactive_streak = ? WHERE id = ?')
    .run(streak + 1, candidate.id);

  // 如果需要配图，先生成图片再一起推送；否则直接推送
  let imageUrls = null;
  if (motive.imageGen) {
    imageUrls = await generateImageForGreeting(candidate, greeting, motive.name, msgId, rawId);
  }

  broadcastProactiveMessage({
    character_id: candidate.id,
    display_name: candidate.display_name,
    avatar_path: candidate.avatar_path,
    
    content: greeting,
    msg_id: msgId,
    raw_id: rawId,
    images: imageUrls || [],
    created_at: new Date().toISOString(),
  });

  updateNextProactiveAt(candidate.id, score);

    console.log(`⚡ force: done ${candidate.display_name} (motive: ${motive.name})`);
    return { character: candidate.display_name, motive: motive.name, greeting };
  } catch (err) {
    console.error('⚡ forceProactiveNow error:', err.message);
    return null;
  }
}

export function stopProactiveChatScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  stopFreqLine();
  stopStartupLine();
  console.log('⚡ All lines stopped');
}
