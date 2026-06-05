/**
 * 情绪引擎 — 自建 VAD 三维模型
 *
 * 双层设计:
 *   - 长期心情底色 (mood):  decay=0.98，几十轮才明显变化
 *   - 实时瞬间情绪 (instant): decay=0.85，每轮更新
 *   - 最终情绪 = mood × 0.4 + instant × 0.6
 *
 * 刺激评估:
 *   - 规则表处理高频场景（快、免费）
 *   - DeepSeek 兜底复杂场景（准）
 */

import { getDb } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';

// ── 常量 ──

const DECAY_INSTANT = 0.85;    // 瞬间情绪衰减率
const DECAY_MOOD = 0.98;       // 长期心情衰减率
const MOOD_WEIGHT = 0.4;       // 长期心情权重
const INSTANT_WEIGHT = 0.6;    // 瞬间情绪权重

const DEFAULT_STATE = {
  valence: 0.5,    // 愉悦度 [-1, 1]
  arousal: 0.5,    // 唤醒度 [0, 1]
  dominance: 0.5,  // 支配度 [0, 1]
};

/**
 * 创建初始情绪状态
 */
export function createEmotionState(baseline = {}) {
  const base = { ...DEFAULT_STATE, ...baseline };
  return {
    mood: { valence: base.valence, arousal: base.arousal, dominance: base.dominance },
    instant: { valence: base.valence, arousal: base.arousal, dominance: base.dominance },
  };
}

/**
 * 从对话历史中加载最近的情绪快照，还原状态。
 * 如果没有历史，返回基于角色基线的初始状态。
 */
export function loadEmotionState(conversationId, baseline) {
  const db = getDb();
  const snapshot = db.prepare(`
    SELECT * FROM emotion_snapshots
    WHERE conversation_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(conversationId);

  if (snapshot) {
    return {
      mood: {
        valence: snapshot.mood_valence ?? snapshot.valence,
        arousal: snapshot.mood_arousal ?? snapshot.arousal,
        dominance: snapshot.mood_dominance ?? snapshot.dominance,
      },
      instant: {
        valence: snapshot.valence,
        arousal: snapshot.arousal,
        dominance: snapshot.dominance,
      },
    };
  }

  return createEmotionState(baseline || DEFAULT_STATE);
}

/**
 * 保存情绪快照到数据库
 */
export function saveEmotionSnapshot(conversationId, afterMsgId, state, dominantEmotion) {
  const db = getDb();
  db.prepare(`
    INSERT INTO emotion_snapshots (conversation_id, after_msg_id,
      valence, arousal, dominance,
      mood_valence, mood_arousal, mood_dominance,
      dominant_emotion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversationId, afterMsgId,
    round(state.instant.valence), round(state.instant.arousal), round(state.instant.dominance),
    round(state.mood.valence), round(state.mood.arousal), round(state.mood.dominance),
    dominantEmotion
  );
}

/**
 * 核心：情绪演化 — 衰减 + 刺激叠加
 */
export function evolveEmotion(state, delta, baseline = DEFAULT_STATE) {
  // 瞬间情绪: 衰减 + 回归基线 + 刺激
  const instant = {
    valence:  clamp(state.instant.valence * DECAY_INSTANT + baseline.valence * (1 - DECAY_INSTANT) + (delta.valence || 0), -1, 1),
    arousal:  clamp(state.instant.arousal * DECAY_INSTANT + baseline.arousal * (1 - DECAY_INSTANT) + (delta.arousal || 0), 0, 1),
    dominance: clamp(state.instant.dominance * DECAY_INSTANT + baseline.dominance * (1 - DECAY_INSTANT) + (delta.dominance || 0), 0, 1),
  };

  // 长期心情: 慢衰减 + 刺激弱影响
  const mood = {
    valence:  clamp(state.mood.valence * DECAY_MOOD + baseline.valence * (1 - DECAY_MOOD) + (delta.valence || 0) * 0.3, -1, 1),
    arousal:  clamp(state.mood.arousal * DECAY_MOOD + baseline.arousal * (1 - DECAY_MOOD) + (delta.arousal || 0) * 0.3, 0, 1),
    dominance: clamp(state.mood.dominance * DECAY_MOOD + baseline.dominance * (1 - DECAY_MOOD) + (delta.dominance || 0) * 0.3, 0, 1),
  };

  return { instant, mood };
}

/**
 * 获取综合情绪（加权混合）
 */
export function getCompositeEmotion(state) {
  return {
    valence:  state.instant.valence * INSTANT_WEIGHT + state.mood.valence * MOOD_WEIGHT,
    arousal:  state.instant.arousal * INSTANT_WEIGHT + state.mood.arousal * MOOD_WEIGHT,
    dominance: state.instant.dominance * INSTANT_WEIGHT + state.mood.dominance * MOOD_WEIGHT,
  };
}

// ── 刺激评估 ──

const RULE_TABLE = [
  // [中文关键词, {valence, arousal, dominance}, 主导情绪]
  // 正面
  [/谢谢|感谢|多谢|你真棒|太好了|厉害|牛|👍/i,  { valence: 0.12, arousal: 0.05, dominance: 0.03 }, 'joy'],
  [/好可爱|萌|喜欢|爱|太美了|好看/i,   { valence: 0.10, arousal: 0.08, dominance: 0.02 }, 'joy'],
  [/哈哈|笑|好笑|有趣|幽默/i,          { valence: 0.15, arousal: 0.10, dominance: 0.05 }, 'joy'],
  [/真好|不错|很棒|满意|nice/i,        { valence: 0.08, arousal: 0.03, dominance: 0.02 }, 'joy'],
  [/兴奋|激动|期待/i,                   { valence: 0.10, arousal: 0.15, dominance: 0.05 }, 'joy'],

  // 负面
  [/无聊|没意思|无趣|boring/i,         { valence: -0.08, arousal: -0.10, dominance: -0.03 }, 'boredom'],
  [/生气|愤怒|混蛋|滚|😡/i,            { valence: -0.20, arousal: 0.15, dominance: 0.05 }, 'anger'],
  [/难过|伤心|哭|😢|😭/i,              { valence: -0.15, arousal: -0.05, dominance: -0.10 }, 'sadness'],
  [/害怕|恐怖|吓|担心|焦虑/i,           { valence: -0.10, arousal: 0.12, dominance: -0.10 }, 'fear'],
  [/不对|错了|不好|差|烂|糟糕/i,        { valence: -0.08, arousal: 0.02, dominance: -0.02 }, 'disappointment'],
  [/烦|讨厌|厌恶|恶心/i,               { valence: -0.12, arousal: 0.05, dominance: 0.02 }, 'disgust'],

  // 特殊
  [/惊喜|哇|哦！|天哪|居然/i,           { valence: 0.08, arousal: 0.12, dominance: 0.0 }, 'surprise'],
  [/累|困|疲惫|休息/i,                  { valence: -0.02, arousal: -0.15, dominance: -0.05 }, 'fatigue'],
  [/好奇|为什么|怎么|？/i,              { valence: 0.02, arousal: 0.08, dominance: 0.02 }, 'curiosity'],
];

/**
 * 规则表快速评估
 * @returns {{ delta, dominantEmotion } | null} 匹配到时返回，否则 null
 */
function ruleBasedEvaluate(userMsg) {
  for (const [pattern, delta, emotion] of RULE_TABLE) {
    if (pattern.test(userMsg)) {
      return { delta: { ...delta }, dominantEmotion: emotion };
    }
  }
  return null;
}

/**
 * DeepSeek 精细评估（兜底）
 */
async function llmEvaluate(userMsg, assistantMsg) {
  const prompt = `分析以下一轮对话对 AI 角色情绪的影响。只返回 JSON。

规则:
- valence (愉悦度): -1到1, 正面互动 +0.05~0.2, 负面 -0.05~0.2
- arousal (唤醒度): 0到1, 兴奋/紧张 +0.05~0.15, 平淡/疲惫 -0.05~0.15
- dominance (支配度): 0到1, 被夸/掌控 +0.02~0.1, 被批评/无力 -0.02~0.1
- dominant_emotion: joy|sadness|anger|fear|surprise|disgust|curiosity|neutral

用户: "${userMsg.slice(0, 500)}"
AI: "${assistantMsg.slice(0, 500)}"

返回JSON: {"delta":{"valence":0.00,"arousal":0.00,"dominance":0.00},"dominant_emotion":"neutral","reason":"简短原因"}`;

  try {
    let raw = await chatSync(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, max_tokens: 150 }
    );
    raw = raw.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }
    const parsed = JSON.parse(raw);
    return {
      delta: {
        valence:  clamp(parsed.delta?.valence || 0, -0.3, 0.3),
        arousal:  clamp(parsed.delta?.arousal || 0, -0.3, 0.3),
        dominance: clamp(parsed.delta?.dominance || 0, -0.3, 0.3),
      },
      dominantEmotion: parsed.dominant_emotion || 'neutral',
    };
  } catch (err) {
    console.error('[emotionEngine] LLM evaluate failed:', err.message);
    return { delta: { valence: 0.01, arousal: 0, dominance: 0 }, dominantEmotion: 'neutral' };
  }
}

/**
 * 评估一轮对话对情绪的影响
 * 规则表优先 → DeepSeek 兜底
 *
 * @param {string} userMsg
 * @param {string} assistantMsg
 * @returns {Promise<{delta: object, dominantEmotion: string}>}
 */
export async function evaluateStimulus(userMsg, assistantMsg) {
  const ruleResult = ruleBasedEvaluate(userMsg);
  if (ruleResult) {
    return ruleResult;
  }
  return llmEvaluate(userMsg, assistantMsg);
}

// ── 情绪 → Prompt ──

const EMOTION_LABELS = {
  joy: '愉悦', sadness: '悲伤', anger: '愤怒',
  fear: '不安', surprise: '惊讶', disgust: '厌烦',
  curiosity: '好奇', boredom: '倦怠', fatigue: '疲惫',
  disappointment: '失望', neutral: '平和',
};

/**
 * 将情绪状态翻译为自然语言 prompt 片段
 */
export function emotionToPrompt(state, dominantEmotion = null) {
  const comp = getCompositeEmotion(state);
  const lines = [];

  // 愉悦度 → 心情
  if (comp.valence > 0.6) lines.push('心情非常愉快');
  else if (comp.valence > 0.2) lines.push('心情不错');
  else if (comp.valence < -0.5) lines.push('情绪低落，有些消沉');
  else if (comp.valence < -0.1) lines.push('心情不太好');
  // 在 [-0.1, 0.2] 之间不额外描述心情

  // 唤醒度 → 精力
  if (comp.arousal > 0.7) lines.push('精力充沛，反应活跃');
  else if (comp.arousal > 0.55) lines.push('精神不错');
  else if (comp.arousal < 0.25) lines.push('感到困倦疲惫');
  else if (comp.arousal < 0.4) lines.push('有些疲惫');

  // 支配度 → 语气姿态
  if (comp.dominance > 0.7) lines.push('语气自信果断');
  else if (comp.dominance < 0.25) lines.push('语气温和顺从，不太主动');

  // 主导情绪标签
  if (dominantEmotion && dominantEmotion !== 'neutral') {
    const label = EMOTION_LABELS[dominantEmotion] || dominantEmotion;
    lines.push(`当前情绪主导: ${label}`);
  }

  if (lines.length === 0) return '';

  // 添加情绪状态作为角色内部状态提示
  return `\n[角色当前状态]\n${lines.join('；')}。请在回复中自然地体现这些情绪状态（但不要直接说出它们）。`;
}

/**
 * 输出调试用的情绪仪表盘文本
 */
export function emotionDashboard(state, dominantEmotion) {
  const comp = getCompositeEmotion(state);
  return [
    `mood:     V=${comp.valence.toFixed(2)} A=${comp.arousal.toFixed(2)} D=${comp.dominance.toFixed(2)}`,
    `dominant: ${dominantEmotion || 'neutral'}`,
  ].join(' | ');
}

// ── helpers ──

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
