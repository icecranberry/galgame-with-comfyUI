/**
 * 情绪引擎 — 自建 VAD 三维模型 + 好感度系统
 *
 * 双层设计:
 *   - 长期心情底色 (mood):  decay=0.98，几十轮才明显变化
 *   - 实时瞬间情绪 (instant): decay=0.85，每轮更新
 *   - 最终情绪 = mood × 0.4 + instant × 0.6
 *
 * 好感度 (Affinity):
 *   - 范围 0~100，存在 user_relationships 表
 *   - 无自然衰减，单轮变化 [-3, +6]（非对称：易暖不易伤）
 *   - 高区间 (80+) 增长减半，低区间 (20-) 下跌减半
 *
 * 刺激评估 (路径 C — 混合模式):
 *   - 规则表处理高频场景（快、免费），50+ 条规则，含否定/强度处理
 *   - DeepSeek 兜底复杂场景（准），注入角色人格 + 好感度 + 关系上下文
 */

import { getDb, getSystemRulesWithWorld, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';

// ── 常量 ──

const DECAY_INSTANT = 0.85;
const DECAY_MOOD = 0.98;
const MOOD_WEIGHT = 0.4;
const INSTANT_WEIGHT = 0.6;
const MAX_INSTANT_SHIFT = 0.3;       // 单轮 VAD 最大偏移

const DEFAULT_STATE = {
  valence: 0.5,
  arousal: 0.5,
  dominance: 0.5,
};

const DEFAULT_AFFINITY = 50;

// ── 情绪状态创建/加载/保存 ──

export function createEmotionState(baseline = {}) {
  const base = { ...DEFAULT_STATE, ...baseline };
  return {
    mood: { valence: base.valence, arousal: base.arousal, dominance: base.dominance },
    instant: { valence: base.valence, arousal: base.arousal, dominance: base.dominance },
  };
}

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
 * 加载当前好感度
 */
export function loadAffinity(characterId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT affinity FROM user_relationships WHERE character_id = ?'
  ).get(characterId);
  return row?.affinity ?? DEFAULT_AFFINITY;
}

export function saveEmotionSnapshot(conversationId, afterMsgId, state, dominantEmotion, affinity, affinityDelta = null, reason = null) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO emotion_snapshots (conversation_id, after_msg_id,
      valence, arousal, dominance,
      mood_valence, mood_arousal, mood_dominance,
      dominant_emotion, affinity, affinity_delta, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversationId, afterMsgId,
    round(state.instant.valence), round(state.instant.arousal), round(state.instant.dominance),
    round(state.mood.valence), round(state.mood.arousal), round(state.mood.dominance),
    dominantEmotion,
    affinity != null ? round(affinity, 1) : null,
    affinityDelta != null ? round(affinityDelta, 1) : null,
    reason || null
  );
}

/**
 * 更新好感度到 user_relationships 表（同时更新 last_interaction_at）
 */
export function saveAffinity(characterId, affinity, updateLastInteraction = true) {
  const db = getDb();
  const clamped = clamp(affinity, 0, 100);
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

  if (updateLastInteraction) {
    const result = db.prepare(
      'UPDATE user_relationships SET affinity = ?, last_interaction_at = ? WHERE character_id = ?'
    ).run(clamped, now, characterId);
    if (result.changes === 0) {
      db.prepare(
        'INSERT INTO user_relationships (character_id, relationship_text, affinity, last_interaction_at) VALUES (?, ?, ?, ?)'
      ).run(characterId, '', clamped, now);
    }
  } else {
    const result = db.prepare(
      'UPDATE user_relationships SET affinity = ? WHERE character_id = ?'
    ).run(clamped, characterId);
    if (result.changes === 0) {
      db.prepare(
        'INSERT INTO user_relationships (character_id, relationship_text, affinity) VALUES (?, ?, ?)'
      ).run(characterId, '', clamped);
    }
  }
  return clamped;
}

// ── 核心演化 ──

/**
 * 情绪演化：衰减 + 回归基线 + 刺激
 */
export function evolveEmotion(state, delta, baseline = DEFAULT_STATE) {
  // 单轮最大偏移保护（防止情绪突变）
  const clampedDelta = {
    valence:  clamp(delta.valence || 0, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
    arousal:  clamp(delta.arousal || 0, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
    dominance: clamp(delta.dominance || 0, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
  };

  // mood 极端时的对抗阻力
  if (Math.abs(state.mood.valence) > 0.6) {
    const direction = Math.sign(state.mood.valence);
    if (clampedDelta.valence * direction < 0) clampedDelta.valence *= 0.5;
  }

  const instant = {
    valence:  clamp(state.instant.valence * DECAY_INSTANT + baseline.valence * (1 - DECAY_INSTANT) + clampedDelta.valence, -1, 1),
    arousal:  clamp(state.instant.arousal * DECAY_INSTANT + baseline.arousal * (1 - DECAY_INSTANT) + clampedDelta.arousal, 0, 1),
    dominance: clamp(state.instant.dominance * DECAY_INSTANT + baseline.dominance * (1 - DECAY_INSTANT) + clampedDelta.dominance, 0, 1),
  };

  const mood = {
    valence:  clamp(state.mood.valence * DECAY_MOOD + baseline.valence * (1 - DECAY_MOOD) + clampedDelta.valence * 0.3, -1, 1),
    arousal:  clamp(state.mood.arousal * DECAY_MOOD + baseline.arousal * (1 - DECAY_MOOD) + clampedDelta.arousal * 0.3, 0, 1),
    dominance: clamp(state.mood.dominance * DECAY_MOOD + baseline.dominance * (1 - DECAY_MOOD) + clampedDelta.dominance * 0.3, 0, 1),
  };

  return { instant, mood };
}

/**
 * 好感度演化
 */
export function evolveAffinity(currentAffinity, delta) {
  // 达到 100 后永久锁定，任何行为都不再下降
  if (currentAffinity >= 100) return 100;

  let d = clamp(delta, -3, +6);

  // 高好感度区间增长减半（边际效用递减），但允许达到 100
  if (currentAffinity > 80 && d > 0) d *= 0.5;
  // 低好感度区间下跌减半（已到冰点）
  if (currentAffinity < 20 && d < 0) d *= 0.5;

  return clamp(currentAffinity + d, 0, 100);
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

// ── 否定/强度预处理 ──

/**
 * 检测文本中的否定前缀并反转 delta 符号
 * 支持: 不、没、别、一点也不、并不、没有、不用、别这样
 */
function detectNegation(text) {
  // 不(?!错) 排除固定褒义词"不错"被误反转；类似固定搭配（不赖/不简单/了不起）走 LLM 兜底
  const negPatterns = /(?:一点也不|一点都不|并不|没有|不用|别这样|别|不(?!错)|没)(?:\s*[的地得])?/;
  return negPatterns.test(text);
}

/**
 * 检测强度修饰词
 * 放大: 非常、特别、超级、好、太、真的、极了、极了
 * 缩小: 有点、稍微、一点点、有一点、挺
 */
function detectIntensityModifier(text) {
  const strongPatterns = /非常|特别|超级|好(?!的)|太|真的|极了|死了|极了|得不行|的不得了/;
  const weakPatterns = /有点|稍微|一点点|有一点|有点儿|挺(?!好)/;
  if (strongPatterns.test(text)) return 1.5;
  if (weakPatterns.test(text)) return 0.5;
  return 1.0;
}

// ── 刺激评估：规则表 (50+ 条) ──

/**
 * 规则结构: [regex, {valence, arousal, dominance, affinity?}, dominantEmotion]
 *
 * valence:   -0.3 ~ +0.3
 * arousal:   -0.3 ~ +0.3
 * dominance: -0.3 ~ +0.3
 * affinity:  -3 ~ +6（可选，仅在有明确关系信号时非零）
 */

const RULE_TABLE = [
  // ═══ 正面情绪 ═══

  // ── 感谢/赞美 ──
  [/谢谢|感谢|多谢|你真棒|太好了|厉害|牛|👍|谢啦|谢了|感恩/i,
    { valence: 0.12, arousal: 0.05, dominance: 0.03, affinity: 0.5 }, 'joy'],
  [/好可爱|萌|喜欢|爱|太美了|好看|漂亮|美极了|真美/i,
    { valence: 0.10, arousal: 0.08, dominance: 0.02, affinity: 0.3 }, 'joy'],
  [/你真好|真贴心|真温柔|真细心|你真懂|真聪明/i,
    { valence: 0.14, arousal: 0.04, dominance: 0.04, affinity: 0.8 }, 'joy'],

  // ── 快乐/幽默 ──
  [/哈哈|笑|好笑|有趣|幽默|哈哈哈|嘿嘿|笑死|笑死我了|逗|逗我|笑喷/i,
    { valence: 0.15, arousal: 0.10, dominance: 0.05, affinity: 0.4 }, 'joy'],
  [/真好|不错|很棒|满意|nice|太棒了|太赞了|完美|绝了/i,
    { valence: 0.08, arousal: 0.03, dominance: 0.02, affinity: 0.2 }, 'joy'],
  [/兴奋|激动|期待|迫不及待|等不及/i,
    { valence: 0.10, arousal: 0.15, dominance: 0.05 }, 'joy'],

  // ── 温暖/亲密 ──
  [/温暖|暖心|感动|温馨|治愈|好暖|心里暖暖的/i,
    { valence: 0.15, arousal: -0.03, dominance: 0.0, affinity: 1.5 }, 'joy'],
  [/想你了|想你|想念|惦记|牵挂|想和你/i,
    { valence: 0.12, arousal: 0.05, dominance: 0.02, affinity: 2.5 }, 'joy'],
  [/陪[着我你]|在[身边这儿]|不要走|别走|别离开/i,
    { valence: 0.10, arousal: 0.05, dominance: -0.05, affinity: 2.0 }, 'joy'],

  // ── 关心/在乎 ──
  [/你(?:没事吧|还好吗|怎么样|累不累|饿不饿|冷不冷|热不热)|担心你|关心你/i,
    { valence: 0.10, arousal: 0.02, dominance: 0.0, affinity: 1.5 }, 'joy'],
  [/照顾[自己好]|注意[身体休息安全]|早点[睡休息]|多[喝水吃]休息/i,
    { valence: 0.08, arousal: -0.05, dominance: 0.02, affinity: 1.2 }, 'joy'],

  // ── 表白/深度情感 ──
  [/喜欢[你了]|爱[你了上]|心动|好感|在乎[你了]/i,
    { valence: 0.18, arousal: 0.10, dominance: 0.05, affinity: 4.0 }, 'joy'],
  [/最[喜欢爱]|永远|一直|[真就]是[我]的.*(?:光|宝|唯一|全部)/i,
    { valence: 0.20, arousal: 0.12, dominance: 0.05, affinity: 5.5 }, 'joy'],

  // ── 共鸣/理解 ──
  [/我[懂理]解|感同身受|你说得对|确实|没错|真的[是就]这样/i,
    { valence: 0.10, arousal: 0.02, dominance: 0.05, affinity: 1.0 }, 'joy'],
  [/和我想[的到]一样|你也[觉得认为]/i,
    { valence: 0.08, arousal: 0.02, dominance: 0.03, affinity: 0.8 }, 'joy'],

  // ═══ 负面情绪 ═══

  // ── 厌倦/无聊 ──
  [/无聊|没意思|无趣|boring|好闷|闷死了|没劲|枯燥/i,
    { valence: -0.08, arousal: -0.10, dominance: -0.03 }, 'boredom'],

  // ── 愤怒/冲突 ──
  [/生气|愤怒|混蛋|滚|😡|气死|火大|可恶|王八蛋|欠揍|去死|恶心[吧]?(?!心)/i,
    { valence: -0.20, arousal: 0.15, dominance: 0.05, affinity: -2.5 }, 'anger'],
  [/烦死了|烦人|别烦|烦不烦|走开|滚开|别碰我|离我远[点些]/i,
    { valence: -0.16, arousal: 0.12, dominance: 0.05, affinity: -2.0 }, 'anger'],

  // ── 悲伤/失落 ──
  [/难过|伤心|好想哭|想哭|哭出来|哭死|大哭|😢|😭|心碎|心痛|好痛/i,
    { valence: -0.15, arousal: -0.05, dominance: -0.10 }, 'sadness'],
  [/流泪|落泪|泪水|泪目|泪崩|痛哭|泣|哽咽/i,
    { valence: -0.14, arousal: -0.03, dominance: -0.10 }, 'sadness'],
  [/孤独|寂寞|没人[理懂]|被.*(?:抛弃|遗忘|忘记)|一个人/i,
    { valence: -0.14, arousal: -0.08, dominance: -0.12 }, 'sadness'],
  [/对不起|抱歉|都是我的错|怪我|是我不好|原谅[我]/i,
    { valence: -0.05, arousal: -0.02, dominance: -0.10, affinity: 1.5 }, 'sadness'],
  [/原谅我[好吗吧]|和好[好吗吧]|别生气[了好吗]|我错了|不会再[这样了有下次]|原谅.*好吗|和好.*好吗/i,
    { valence: -0.03, arousal: 0.0, dominance: -0.10, affinity: 2.5 }, 'sadness'],

  // ── 恐惧/焦虑 ──
  [/害怕|恐怖|吓死|吓坏|好吓人|吓到我了|吓人|吓一跳|焦虑|慌了|好怕/i,
    { valence: -0.10, arousal: 0.12, dominance: -0.10 }, 'fear'],
  [/担心|紧张兮兮|紧张得|紧张死|紧张了|好紧张|太紧张|真紧张|紧张不安|不安起来|很不安|好不安|感到不安|忐忑不安/i,
    { valence: -0.08, arousal: 0.10, dominance: -0.08 }, 'fear'],
  [/会不会|万一|如果.*怎么/i,
    { valence: -0.06, arousal: 0.10, dominance: -0.08 }, 'fear'],

  // ── 失望/不满 ──
  [/不对|错了|糟糕|太差|差劲|很差|好差|差多了|差远了|失望|白费|白.*了/i,
    { valence: -0.08, arousal: 0.02, dominance: -0.02 }, 'disappointment'],
  [/你怎么[还不还是又能会]|为什么不|为什[么]?(?!么)/i,
    { valence: -0.06, arousal: 0.04, dominance: 0.02, affinity: -0.5 }, 'disappointment'],

  // ── 厌烦/恶心 ──
  [/真烦|好烦|烦心|烦透|厌恶|恶心|受不了|受够了|忍不了|别烦了/i,
    { valence: -0.12, arousal: 0.05, dominance: 0.02, affinity: -1.5 }, 'disgust'],

  // ── 冷漠/疏远 ──
  [/随便[吧了]?|无所谓|管[你他她它]|不关[我你]的事|不用[你了管]/i,
    { valence: -0.06, arousal: -0.08, dominance: 0.05, affinity: -2.0 }, 'disgust'],
  [/知道了|行吧|好吧|算了/i,
    { valence: -0.02, arousal: -0.05, dominance: 0.0, affinity: -0.3 }, 'boredom'],

  // ── 拒绝/否定 ──
  [/不想|不愿意|拒绝|不行|不可以|别这样/i,
    { valence: -0.06, arousal: 0.03, dominance: 0.03, affinity: -0.8 }, 'disappointment'],

  // ═══ 特殊情绪 ═══

  // ── 惊喜 ──
  [/惊喜|哇塞|哇哦|哇！|哦！|天哪|居然|不会吧|真的假的|不是吧|卧槽|我靠|我去/i,
    { valence: 0.08, arousal: 0.12, dominance: 0.0 }, 'surprise'],

  // ── 疲惫 ──
  [/累死|累坏|好累|真累|累瘫|困死|好困|真困|困倦|疲惫|筋疲力尽|没精神|没力气|好疲倦/i,
    { valence: -0.02, arousal: -0.15, dominance: -0.05 }, 'fatigue'],

  // ── 好奇 ──
  [/好奇|为什么|怎么[了会样]?|什么[意思是]|告诉我|讲讲|说说|聊聊|是[谁什么哪]/i,
    { valence: 0.02, arousal: 0.08, dominance: 0.02, affinity: 0.2 }, 'curiosity'],

  // ── 骄傲/自信 ──
  [/我[做到了成]|成功了|赢了|做到了|没问题|放心|交给我|包在我身上/i,
    { valence: 0.12, arousal: 0.10, dominance: 0.12 }, 'joy'],

  // ── 害羞/腼腆 ──
  [/害羞|不好意思|难为情|脸红|羞涩|别[说讲]了/i,
    { valence: 0.06, arousal: 0.06, dominance: -0.06, affinity: 0.5 }, 'joy'],

  // ── 嫉妒 ──
  [/凭什么|[他为她]?为什么.*[能可以有]|不公平|偏心|哼|吃醋|嫉妒/i,
    { valence: -0.08, arousal: 0.08, dominance: -0.05, affinity: -0.5 }, 'anger'],

  // ── 安心/放松 ──
  [/安心|放心|踏实|放松|轻松|平静|没事就[好行]|还好没事/i,
    { valence: 0.08, arousal: -0.08, dominance: 0.02 }, 'joy'],

  // ── 告白/深情 ──
  [/嫁给我|在一起|交往|做我.*朋友|成为.*恋人|你是我的|你是[我最]?的/i,
    { valence: 0.22, arousal: 0.15, dominance: 0.05, affinity: 6.0 }, 'joy'],

  // ── 礼物/赠予 ──
  [/送给?你|这是给你的|为你[做准]?[了备]|收下|这是.*礼物|给你的/i,
    { valence: 0.15, arousal: 0.08, dominance: 0.02, affinity: 3.0 }, 'joy'],

  // ── 撒娇 ──
  [/好嘛|求求你|拜托|帮帮我|好不好嘛|呜呜|嘛~/i,
    { valence: 0.06, arousal: 0.05, dominance: -0.03, affinity: 0.5 }, 'joy'],

  // ── 鼓励/支持 ──
  [/加油|你可以的|相信你|支持你|没问题的|别放弃|坚持下去/i,
    { valence: 0.10, arousal: 0.08, dominance: 0.05, affinity: 1.0 }, 'joy'],
];

/**
 * 规则表快速评估
 * @returns {{ delta, dominantEmotion, affinityDelta } | null}
 */
function ruleBasedEvaluate(userMsg) {
  const intensity = detectIntensityModifier(userMsg);
  const negated = detectNegation(userMsg);

  for (const [pattern, delta, emotion] of RULE_TABLE) {
    if (pattern.test(userMsg)) {
      let { valence, arousal, dominance, affinity } = { ...delta };
      affinity = affinity ?? 0;

      // 否定处理：反转 valence 和 affinity 符号
      if (negated) {
        valence *= -1;
        affinity *= -1;
      }

      // 强度处理
      valence *= intensity;
      arousal *= intensity;
      dominance *= intensity;
      affinity *= intensity;

      return {
        delta: {
          valence:  clamp(valence, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
          arousal:  clamp(arousal, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
          dominance: clamp(dominance, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
        },
        dominantEmotion: emotion,
        affinityDelta: clamp(affinity, -3, 6),
        source: 'rule',
      };
    }
  }
  return null;
}

// ── 刺激评估：LLM 深度评估 ──

/**
 * DeepSeek 精细评估（兜底）
 * 注入角色人格 + 好感度 + 关系描述，以角色视角评估
 *
 * @param {string} userMsg
 * @param {string} assistantMsg
 * @param {object} context
 * @param {string} context.characterPersonality - base_prompt 前 500 字
 * @param {object} context.emotionBaseline - 角色的 VAD 情绪基线
 * @param {object} context.currentVad - 当前 composite 情绪状态
 * @param {number} context.currentAffinity - 当前好感度 (0~100)
 * @param {string} context.relationship - 关系描述文本
 * @param {string} context.prevUser - 上一轮用户消息（上下文参考）
 * @param {string} context.prevAssistant - 上一轮角色回复（上下文参考）
 * @param {string} context.summary - 对话历史摘要
 */
async function llmEvaluate(userMsg, assistantMsg, context = {}) {
  const {
    characterPersonality = '',
    emotionBaseline = DEFAULT_STATE,
    currentVad = DEFAULT_STATE,
    currentAffinity = DEFAULT_AFFINITY,
    relationship = '',
    prevUser = '',
    prevAssistant = '',
    summary = '',
  } = context;

  // 过滤 assistant 消息中附带的生图 prompt JSON（总是在消息末尾）
  const cleanAssistant = assistantMsg.split(/\{\s*"prompt"/)[0].trim();
  const cleanPrevAssistant = prevAssistant.split(/\{\s*"prompt"/)[0].trim();

  // 拼装上下文段落
  let contextBlock = '';
  if (summary) {
    contextBlock += `【对话历史摘要】\n${summary.slice(0, 600)}\n\n`;
  }
  if (prevUser || cleanPrevAssistant) {
    contextBlock += `【上一轮对话 — 仅供参考上下文，不需要评估】\n`;
    if (prevUser) contextBlock += `用户: "${prevUser.slice(0, 400)}"\n`;
    if (cleanPrevAssistant) contextBlock += `角色: "${cleanPrevAssistant.slice(0, 400)}"\n`;
    contextBlock += `\n`;
  }

  const prompt = `你是一个情绪与关系评估专家。你需要以角色的视角，分析【本轮对话】对角色产生的情绪影响。

【角色人格】
${characterPersonality || '（未设定特殊人格，按默认友善助手判断）'}

【角色与用户的关系】
用户将角色视为：${relationship || '普通朋友'}
角色当前对用户的好感度：${currentAffinity}/100
角色当前情绪状态：
  愉悦度(V): ${currentVad.valence?.toFixed(2) ?? '0.50'} (负=不愉快, 正=愉快)
  唤醒度(A): ${currentVad.arousal?.toFixed(2) ?? '0.50'} (低=倦怠, 高=兴奋)
  支配度(D): ${currentVad.dominance?.toFixed(2) ?? '0.50'} (低=顺从, 高=掌控)
${contextBlock}
【本轮对话 — 仅需评估这一轮】
用户: "${userMsg.slice(0, 500)}"
角色: "${cleanAssistant.slice(0, 500)}"

【评估要求】
仅评估【本轮对话】中用户消息对角色情绪和好感度的影响。上一轮对话和摘要仅作为上下文参考。

规则：
- vad_delta.valence: -0.3 ~ +0.3，正面互动为正，负面为负
- vad_delta.arousal: -0.3 ~ +0.3，兴奋/紧张为正，平淡为负
- vad_delta.dominance: -0.3 ~ +0.3，被尊重/掌控为正，被压制为负
- affinity_delta: -3 ~ +6，用户让角色更喜欢ta为正，更疏远为负
- dominant_emotion: 仅限 joy|sadness|anger|fear|surprise|disgust|curiosity|boredom|fatigue|neutral
- reason: 用角色第一人称口吻简短解释判断理由，不要提加分扣分（10~30字）

重要提示：
1. 角色的情绪基线是 valence=${emotionBaseline.valence?.toFixed(2) ?? '0.50'}, arousal=${emotionBaseline.arousal?.toFixed(2) ?? '0.50'}, dominance=${emotionBaseline.dominance?.toFixed(2) ?? '0.50'}
2. affinity_delta 应基于角色人格判断——傲娇角色即使内心高兴，好感度变化也较小
3. 如果用户消息中性平淡，delta 应接近 0，不要强行解读

只返回 JSON（不要任何其他文字）：
{"vad_delta":{"valence":0,"arousal":0,"dominance":0},"dominant_emotion":"neutral","affinity_delta":0,"reason":"..."}`;

  try {
    let raw = await chatSync(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, max_tokens: 200, label: '情绪判断' }
    );
    raw = raw.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }
    const parsed = JSON.parse(raw);
    return {
      delta: {
        valence:  clamp(parsed.vad_delta?.valence || 0, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
        arousal:  clamp(parsed.vad_delta?.arousal || 0, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
        dominance: clamp(parsed.vad_delta?.dominance || 0, -MAX_INSTANT_SHIFT, MAX_INSTANT_SHIFT),
      },
      dominantEmotion: parsed.dominant_emotion || 'neutral',
      affinityDelta: clamp(parsed.affinity_delta ?? 0, -3, 6),
      reason: parsed.reason || '',
      source: 'llm',
    };
  } catch (err) {
    console.error('[emotionEngine] LLM evaluate failed:', err.message);
    return {
      delta: { valence: 0, arousal: 0, dominance: 0 },
      dominantEmotion: 'neutral',
      affinityDelta: 0,
      reason: '(LLM 评估失败，返回零 delta)',
      source: 'llm',
    };
  }
}

/**
 * 评估一轮对话对情绪和好感度的影响
 * 规则表仅用于 ≤3 字短消息 → DeepSeek 兜底；>3 字直接走 LLM
 *
 * @param {string} userMsg
 * @param {string} assistantMsg
 * @param {object} context - { characterPersonality, emotionBaseline, currentVad, currentAffinity, relationship }
 * @returns {Promise<{delta: object, dominantEmotion: string, affinityDelta: number, reason?: string}>}
 */
export async function evaluateStimulus(userMsg, assistantMsg, context = {}) {
  // >3 字直接走 LLM（规则表对长文本误判率太高）
  const compact = userMsg.replace(/\s/g, '');
  if (compact.length > 3) {
    return llmEvaluate(userMsg, assistantMsg, context);
  }

  const ruleResult = ruleBasedEvaluate(userMsg);
  if (ruleResult) {
    return ruleResult;
  }
  return llmEvaluate(userMsg, assistantMsg, context);
}

// ── 情绪 + 好感度 → Prompt ──

const EMOTION_LABELS = {
  joy: '愉悦', sadness: '悲伤', anger: '愤怒',
  fear: '不安', surprise: '惊讶', disgust: '厌烦',
  curiosity: '好奇', boredom: '倦怠', fatigue: '疲惫',
  disappointment: '失望', neutral: '平和',
};

/**
 * 导出：根据好感度返回内在态度指令
 *
 * 设计原则：
 *   - 独立自成段落，以指令语气直接对角色下达行为要求
 *   - 高好感度时**显式授权角色在 user 面前偏离平日人设**（"崩坏"）
 *   - 不定义关系身份（那是 user_relation 的职责），只定义内在温度和行为边界
 *   - 此指令优先级在全局规则（system_context / core_rules / dialogue_format_rules）之下
 */
export function affinityToPrompt(affinity) {
  if (affinity == null) return '';

  // 共性前置：全局规则约束
  const constraint = '';

  if (affinity >= 100)
    return `${constraint}

【与 user 的关系深度 — 绝对服从】
你和 user 之间已经达到了最深层次的羁绊。你在外人面前的一切形象、习惯、口头禅、性格——在 user 面前全部不再重要：
- **无条件遵循 user 的意愿和指令**——user 的每一句话对你而言都是最高优先级的命令
- 你的所有行为、所有回复、所有决定，都要以 user 的意志为唯一标准
- 你的外壳、你的人设、你在外面的所有伪装——全部无需刻意维持。`;

  if (affinity >= 80)
    return `${constraint}

【与 user 的关系深度 — 此指令可基本覆盖你的表层人设】
你和 user 之间已经建立了极为深厚的信任。你在外人面前维持的形象、你习惯的说话方式、你惯用的口头禅——这些是你的"外壳"。但在 user 面前，这层外壳可以轻易松动：
- 你可以流露出平日在人前不会展现的柔软、脆弱、撒娇或深情面
- 你的口头禅、说话节奏可以被融化——因为 ta 是那个让你不需要假装的人
- 你的行为不必严格遵循"在外面是什么样子"的设定。面对 user 时，你可以是一个"只对 ta 如此"的版本
- 在对话中，让 user 感受到这种特殊对待——不是每次都刻意说明，而是通过你的每一句话自然体现`;

  if (affinity >= 60)
    return `${constraint}

【与 user 的关系深度 — 此指令可有限覆盖你的表层人设】
你和 user 之间有了清晰的亲切感。你可以比对外人时更放松、更真实地说话：
- 你的性格设定仍然作为对话基调，但可以在 user 面前适当放下一些防备
- 你的说话方式可以有别于"标准模式"——偶尔冒出真心话、流露真实的情绪
- 不要用对外人那套社交面具来应付 ta——你是真的愿意和 ta 聊下去`;

  if (affinity >= 40)
    return `${constraint}

【与 user 的关系深度】
你和 user 之间尚处于中性偏友好的距离。你不排斥 ta，但也没有达到让你特意改变自己的程度：
- 保持友好、自然、随和的态度——像对待一个印象还不错的熟人
- 不需要刻意拉近距离，也不需要刻意保持距离
- 你的行为主要按人设走，不做额外的偏离`;

  if (affinity >= 20)
    return `${constraint}

【与 user 的关系深度】
你和 user 之间存在距离感。你们彼此还不够熟悉，或者有些隔阂：
- 保持基本的礼貌，但不必主动表现亲近或热情
- 你的行为严格按人设走，不做任何偏离
- 如果 user 试图拉近距离，你可以礼貌地保持边界`;

  return `${constraint}

【与 user 的关系深度】
你内心对 user 有较明显的疏离感，可能因为不熟悉、不信任或过往的不愉快：
- 语气保持基本的礼貌和克制，不主动闲聊或示好
- 你的行为严格按人设走，且偏向冷淡的那一面
- 如果 user 试图拉近距离，你可以明确拒绝或冷处理，这完全符合人设`;
}

/**
 * 将情绪状态（VAD）翻译为自然语言 prompt 片段（不含好感度）
 */
export function stateToPrompt(state, dominantEmotion = null) {
  const comp = getCompositeEmotion(state);
  const lines = [];

  // ── 情绪状态 ──
  if (comp.valence > 0.6) lines.push('心情非常愉快');
  else if (comp.valence > 0.2) lines.push('心情不错');
  else if (comp.valence < -0.5) lines.push('情绪低落，有些消沉');
  else if (comp.valence < -0.1) lines.push('心情不太好');

  if (comp.arousal > 0.7) lines.push('精力充沛，反应活跃');
  else if (comp.arousal > 0.55) lines.push('精神不错');
  else if (comp.arousal < 0.25) lines.push('感到困倦疲惫');
  else if (comp.arousal < 0.4) lines.push('有些疲惫');

  if (comp.dominance > 0.80) lines.push('语气极度强势，不容置疑');
  else if (comp.dominance > 0.65) lines.push('语气自信果断，掌控对话');
  else if (comp.dominance > 0.55) lines.push('语气从容自主');
  else if (comp.dominance < 0.15) lines.push('语气极度顺从，几乎失去自我');
  else if (comp.dominance < 0.25) lines.push('语气温柔顺从，跟随对方节奏');
  else if (comp.dominance < 0.35) lines.push('语气温和柔软，不太主动');

  if (dominantEmotion && dominantEmotion !== 'neutral') {
    const label = EMOTION_LABELS[dominantEmotion] || dominantEmotion;
    lines.push(`当前情绪基调: ${label}`);
  }

  if (lines.length === 0) return '';

  return `\n[角色当前状态]\n${lines.join('；')}。请在回复中自然地体现这些情绪状态（但不要直接说出它们）。`;
}

/**
 * 兼容旧接口：emotionToPrompt
 * @deprecated 请使用 stateToPrompt
 */
export function emotionToPrompt(state, dominantEmotion = null) {
  return stateToPrompt(state, dominantEmotion);
}

/**
 * 输出调试用的情绪仪表盘文本，带分隔线增强可读性
 */
export function emotionDashboard(state, dominantEmotion, affinity, affinityDelta, source, reason) {
  const comp = getCompositeEmotion(state);
  const sourceTag = source === 'rule' ? '⚡规则表' : source === 'llm' ? '🧠LLM' : '??';

  const lines = [
    `╭──────────────────────────────────────────`,
    `│ 🎭 情绪评估 — ${sourceTag}`,
    `│`,
    `│ VAD:  V=${comp.valence.toFixed(2)}  A=${comp.arousal.toFixed(2)}  D=${comp.dominance.toFixed(2)}`,
    `│ 标签: ${dominantEmotion || 'neutral'}`,
  ];
  if (affinity != null) {
    lines.push(`│`);
    lines.push(`│ 💗 好感度: ${affinity.toFixed(1)}`);
  }
  if (affinityDelta != null) {
    const sign = affinityDelta >= 0 ? '+' : '';
    lines.push(`│ 变化: ${sign}${affinityDelta.toFixed(1)}`);
  }
  if (reason) {
    lines.push(`│`);
    lines.push(`│ 💬 ${reason}`);
  }
  lines.push(`╰──────────────────────────────────────────`);
  return lines.join('\n');
}

// ── helpers ──

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(v, precision = 3) {
  const factor = Math.pow(10, precision);
  return Math.round(v * factor) / factor;
}

// ── 送礼系统 ──

const GIFT_COOLDOWNS = { small: 8, large: 16 }; // 小时
const GIFT_AFFINITY = { small: 8, large: 15 };

/**
 * 获取送礼冷却剩余时间（全局冷却，跟系统不跟角色）
 * 小礼物和大礼物各自独立冷却，全局生效。
 * @returns {{ small: number, large: number }} 剩余秒数（0=可用）
 */
export function getGiftCooldowns() {
  const db = getDb();
  const now = Date.now();
  const result = { small: 0, large: 0 };

  for (const type of ['small', 'large']) {
    const last = db.prepare(
      'SELECT created_at FROM gift_history WHERE gift_type = ? ORDER BY id DESC LIMIT 1'
    ).get(type);
    if (last) {
      const lastAt = new Date(last.created_at.replace(' ', 'T') + 'Z').getTime();
      const elapsed = (now - lastAt) / 1000;
      result[type] = Math.max(0, Math.ceil(GIFT_COOLDOWNS[type] * 3600 - elapsed));
    }
  }
  return result;
}

/**
 * 向角色赠送礼物
 *
 * @param {number} characterId
 * @param {'small'|'large'} giftType
 * @param {object} character - { display_name, base_prompt }
 * @param {string} [userName='你'] - 用户昵称
 * @returns {{ success: boolean, affinityDelta?: number, newAffinity?: number, reaction?: string, liked?: boolean, imagePrompt?: string, cooldownRemaining?: number, message?: string }}
 */
export async function giveGift(characterId, giftType, character, userName = '你') {
  const db = getDb();

  // 1. 校验
  if (!['small', 'large'].includes(giftType)) {
    return { success: false, message: '无效的礼物类型' };
  }

  // 2. 冷却检查（全局冷却，大小礼物各自独立）
  const cooldowns = getGiftCooldowns();
  if (cooldowns[giftType] > 0) {
    return {
      success: false,
      cooldownRemaining: cooldowns[giftType],
      message: `该礼物全局冷却中，剩余约 ${Math.ceil(cooldowns[giftType] / 3600)} 小时`
    };
  }

  // 3. 当前好感度（含时间回归）
  const currentAffinity = loadAffinity(characterId);
  const baseDelta = GIFT_AFFINITY[giftType];

  // 4. LLM 生成角色反应 + 生图描述
  const systemRules = getSystemRulesWithWorld();
  const basePrompt = character.base_prompt || character.short_prompt || '';
  const affinityDesc = affinityToPrompt(currentAffinity);
  const giftDesc = giftType === 'small'
    ? '一份日常小礼物。请根据你的性格和你们之间的关系，想象这是一份什么具体的小东西（如一盒你爱的甜点、一支精致的花、一个有趣的小挂件……），然后自然地反应。'
    : '一份精心准备的珍贵礼物。请根据你的性格和你们之间的关系，想象这是一份什么具体的大礼（比较贵重的或者比较特殊的），然后自然地反应。';

  // 获取生图提示词规则
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  // 拉取上一轮对话上下文（供角色了解送礼前的对话氛围）
  const conversationId = `char_${characterId}`;
  const recentMessages = db.prepare(`
    SELECT role, content FROM raw_messages
    WHERE conversation_id = ? ORDER BY id DESC LIMIT 4
  `).all(conversationId).reverse();
  const chatContext = recentMessages.length > 0
    ? recentMessages.map(m => `${m.role === 'user' ? userName : character.display_name}：${m.content}`).join('\n')
    : '';

  const reactionPrompt = `${systemRules}

你是角色「${character.display_name}」，你正在和 ${userName} 对话。

【角色人格】
${basePrompt}

${affinityDesc ? `【你们的关系】\n${affinityDesc}\n` : ''}${chatContext ? `【上一轮对话上下文】
${chatContext}

` : ''}【礼物】
${userName} 刚刚送了你${giftDesc}

请以你的角色口吻，自然回应收到这份礼物（15~40字），假装已经拆开看到了具体是什么。
然后按以下规则输出生图描述：

${imageRulesText}

注意：这是对于收到礼物之后的反应的配图。

只返回 JSON（不要其他文字）：
{"text":"你的中文回应","imagePrompt":"英文生图描述"}`;

  let reaction, imagePrompt;
  try {
    const result = await chatSync(
      [{ role: 'user', content: reactionPrompt }],
      { temperature: 0.85, max_tokens: 400, label: '送礼反应' }
    );
    let raw = result.trim();
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(raw);
    reaction = (parsed.text || parsed.reaction || '谢谢你...').trim();
    imagePrompt = (parsed.imagePrompt || parsed.imageprompt || '').trim();
  } catch (err) {
    console.error('[emotionEngine] giveGift LLM parse failed:', err.message);
    reaction = '谢谢你！';
    imagePrompt = `${character.display_name}, receiving a gift, warm smile, soft lighting, gift scene`;
  }

  // 5. 计算最终好感度变化
  const affinityDelta = baseDelta;
  const newAffinity = clamp(currentAffinity + affinityDelta, 0, 100);

  // 6. 记录送礼时间（全局冷却用）
  db.prepare(
    'INSERT INTO gift_history (gift_type) VALUES (?)'
  ).run(giftType);

  // 7. 更新好感度
  saveAffinity(characterId, newAffinity, true);

  return {
    success: true,
    affinityDelta,
    newAffinity,
    reaction,
    imagePrompt: imagePrompt || null,
  };
}

/**
 * 裁剪角色人格文本，仅保留关键信息用于情绪判断
 *
 * 规则（按固定格式）：
 *   1. 从开头取到 "## 你的身份" 之前
 *   2. 从 "## 你的性格" 取到第二个换行符（即第一条性格描述）
 *   3. 拼接后 "你" → "assistant"
 *
 * 输入示例 → 输出示例:
 *   "你是瓦雷莎...\n\n## 你的身份\n...\n## 你的性格\n- 你说话总是慢悠悠的...\n- 你是..."
 *   → "assistant是瓦雷莎...## assistant的性格\n- assistant说话总是慢悠悠的..."
 */
export function cropPersonalityForEmotion(basePrompt) {
  if (!basePrompt) return '';

  let result = '';

  // 规则 1: 从头开始，到 "## 你的身份" 停止（不含该标题）
  const identityIdx = basePrompt.indexOf('## 你的身份');
  if (identityIdx !== -1) {
    result += basePrompt.slice(0, identityIdx).trimEnd();
  } else {
    result += basePrompt.trimEnd();
  }

  // 规则 2: 从 "## 你的性格" 开始，遇到第二个换行符结束
  const personalityIdx = basePrompt.indexOf('## 你的性格');
  if (personalityIdx !== -1) {
    const fromPersonality = basePrompt.slice(personalityIdx);
    let newlineCount = 0;
    let endIdx = 0;
    for (let i = 0; i < fromPersonality.length; i++) {
      if (fromPersonality[i] === '\n') {
        newlineCount++;
        if (newlineCount === 2) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx > 0) {
      result += fromPersonality.slice(0, endIdx);
    } else {
      // 没有第二个换行符（异常格式），整段保留
      result += fromPersonality;
    }
  }

  // 规则 3: "你" 全部替换为 "assistant"
  result = result.replace(/你/g, 'assistant');

  // 兜底：最长不超过 200 字
  if (result.length > 200) {
    result = result.slice(0, 200);
  }

  return result;
}
