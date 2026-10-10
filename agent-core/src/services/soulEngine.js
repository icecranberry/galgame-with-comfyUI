/**
 * 灵魂引擎 — 角色的「自我认知」状态层（四维能量槽）
 *
 * 与邻舍既有的两条状态轴并存、互不替代：
 *   - VAD 情绪（emotionEngine）：反应性情绪（此刻心情），按 conversation，每轮衰减
 *   - 好感度 affinity：对特定对话者的关系深度，按 character
 *   - 灵魂四维（本模块）：倾向性自我认知（我是怎样的存在），按 character，慢变量、弹性回归
 *
 * 算法移植自 astrbot_plugin_angel_memory/core/soul/soul_state.py，三处刻意改动：
 *   1. 全局单例 → 按 character_id 键控（源插件多角色会串味）
 *   2. 纯内存态 → 落库 soul_states（跨会话、跨重启延续，否则不构成「长期记忆驱动的人设」）
 *   3. 不暴露 min/max 配置项（源插件那四个属性定义了却无消费方，是死配置）
 *
 * 四维（位序固定）：
 *   RecallDepth      回忆量倾向 → 召回 topK
 *   ImpressionDepth  记住量倾向 → curation 条数上限
 *   ExpressionDesire 发言长度倾向 → 回复长度档位
 *   Creativity       思维发散倾向 → 只进提示词（不接温度）
 *
 * 开关：config.features.soul（默认关）。关闭时所有对外入口返回 null/''，
 * 不落库、不共鸣、不改行为参数，行为与迁移前逐字节一致。
 */

import { getDb } from '../db/index.js';
import { config } from '../config.js';

export const DIMENSIONS = ['RecallDepth', 'ImpressionDepth', 'ExpressionDesire', 'Creativity'];

// 弹性 / 强度参数（与源实现一致）
const ELASTICITY_FACTOR = 0.1;   // 离 mid 越远，指数弹性越小（越难继续偏离）
const REGRESSION_FACTOR = 0.1;   // 总是向 mid 回归的线性力
const REFLECT_STRENGTH = 1.0;    // 主动反思强度
const RESONATE_STRENGTH = 0.3;   // 被动共鸣强度
const ENERGY_SOFT_LIMIT = 20.0;  // 能量软限制
const TANH_K = 0.3;              // 橡皮筋映射敏感度

// min/max 硬编码（不暴露配置）；mid 可配，见 config.soul.mids
const DIMENSION_BOUNDS = Object.freeze({
  RecallDepth:      { min: 1, max: 20 },
  ImpressionDepth:  { min: 1, max: 10 },
  ExpressionDesire: { min: 0, max: 1 },
  Creativity:       { min: 0, max: 1 },
});
const INTEGER_DIMENSIONS = new Set(['RecallDepth', 'ImpressionDepth']);

export const DEFAULT_MIDS = Object.freeze({
  RecallDepth: 7,
  ImpressionDepth: 3,
  ExpressionDesire: 0.5,
  Creativity: 0.7,
});

// 回复长度档位（ExpressionDesire 决定；上限 60 字，与既有最高档一致，防止灵魂拉满时脱缰）
const REPLY_LENGTH_TIERS = Object.freeze([
  { below: 0.25, hint: '10~25个汉字' },
  { below: 0.5,  hint: '10~35个汉字' },
  { below: 0.75, hint: '10~45个汉字' },
  { below: Infinity, hint: '10~60个汉字' },
]);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function resolveMids() {
  const configured = config?.soul?.mids || {};
  const mids = {};
  for (const dim of DIMENSIONS) {
    const value = Number(configured[dim]);
    mids[dim] = Number.isFinite(value) ? value : DEFAULT_MIDS[dim];
  }
  return mids;
}

/** 开关：默认关。关闭时所有对外入口一律不产生副作用。 */
export function isSoulEnabled() {
  return config?.features?.soul === true;
}

// ── 核心算法（可独立测试，不依赖 DB） ──

export class SoulState {
  constructor(mids = {}) {
    this.mids = { ...DEFAULT_MIDS, ...mids };
    this.energy = {
      RecallDepth: 0.0,
      ImpressionDepth: 0.0,
      ExpressionDesire: 0.0,
      Creativity: 0.0,
    };
  }

  /**
   * 弹性变动量：方向性变动 × 指数弹性 + 向 mid 的线性回归力。
   * 离 mid 越远越难推动；无论方向如何，总有一股回归 mid 的力。
   */
  calculateElasticDelta(currentEnergy, direction, mid, baseStrength) {
    const distanceToMid = Math.abs(currentEnergy - mid);
    const elasticity = Math.exp(-ELASTICITY_FACTOR * distanceToMid);
    const directionalDelta = direction * baseStrength * elasticity;
    const regressionForce = (mid - currentEnergy) * REGRESSION_FACTOR;
    return directionalDelta + regressionForce;
  }

  /**
   * 原子化调整：code 为 4 位二进制（位序 Recall/Impression/Expression/Creativity，1=增 0=减）。
   * mode: 'reflect'（强度 1.0）| 'resonate'（强度 0.3）。非法 code 抛错，由调用方降级。
   */
  adjust(code, mode = 'reflect') {
    if (typeof code !== 'string' || !/^[01]{4}$/.test(code)) {
      throw new Error(`Invalid soul state code: ${code}, must be 4-bit binary string like '1011'`);
    }
    const baseStrength = mode === 'resonate' ? RESONATE_STRENGTH : REFLECT_STRENGTH;
    for (let i = 0; i < DIMENSIONS.length; i++) {
      const dim = DIMENSIONS[i];
      const direction = code[i] === '1' ? 1 : -1;
      const delta = this.calculateElasticDelta(this.energy[dim], direction, this.mids[dim], baseStrength);
      this.energy[dim] = clamp(this.energy[dim] + delta, -ENERGY_SOFT_LIMIT, ENERGY_SOFT_LIMIT);
    }
    return this.getSnapshot();
  }

  /** 被动共鸣：由旧记忆快照平均值与当前值比较生成 code，再按 resonate 强度调整。无快照返回 null。 */
  resonate(snapshots) {
    const code = generateResonateCode(snapshots, this.energy);
    if (!code) return null;
    this.adjust(code, 'resonate');
    return code;
  }

  /** 橡皮筋阻尼映射（Tanh）：无界 energy → 有界物理参数区间。前两维取整，后两维两位小数。 */
  getValue(dimension) {
    if (!DIMENSIONS.includes(dimension)) return 0;
    const { min, max } = DIMENSION_BOUNDS[dimension];
    const mid = this.mids[dimension];
    const energy = this.energy[dimension];
    const raw = energy >= 0
      ? mid + (max - mid) * Math.tanh(TANH_K * energy)
      : mid + (mid - min) * Math.tanh(TANH_K * energy);
    const bounded = clamp(raw, min, max);
    return INTEGER_DIMENSIONS.has(dimension)
      ? Math.round(bounded)
      : Math.round(bounded * 100) / 100;
  }

  /** 当前四维 energy 快照（写入记忆行 / 落库用） */
  getSnapshot() {
    return { ...this.energy };
  }

  toRecord() {
    return {
      recall_depth: this.energy.RecallDepth,
      impression_depth: this.energy.ImpressionDepth,
      expression_desire: this.energy.ExpressionDesire,
      creativity: this.energy.Creativity,
    };
  }

  static fromRecord(row, mids) {
    const state = new SoulState(mids);
    state.energy.RecallDepth = Number(row?.recall_depth) || 0;
    state.energy.ImpressionDepth = Number(row?.impression_depth) || 0;
    state.energy.ExpressionDesire = Number(row?.expression_desire) || 0;
    state.energy.Creativity = Number(row?.creativity) || 0;
    return state;
  }
}

/**
 * 由多个记忆快照生成 4 位共鸣码：每维取快照平均，平均值 > 当前值 → 1，否则 0。
 * 空快照 / 无有效快照返回 null（不调整）。
 */
export function generateResonateCode(snapshots, currentEnergy = {}) {
  const list = Array.isArray(snapshots) ? snapshots.filter(s => s && typeof s === 'object') : [];
  if (list.length === 0) return null;
  let code = '';
  for (const dim of DIMENSIONS) {
    const values = list.filter(s => dim in s).map(s => Number(s[dim])).filter(Number.isFinite);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    code += average > (Number(currentEnergy?.[dim]) || 0) ? '1' : '0';
  }
  return code;
}

// ── 按 character_id 键控的实例缓存与落库 ──

const soulCache = new Map(); // characterId(string) -> SoulState

function soulKey(characterId) {
  return characterId == null || characterId === '' ? null : String(characterId);
}

function persistSoulState(characterId, state) {
  const db = getDb();
  const record = state.toRecord();
  db.prepare(`
    INSERT INTO soul_states (character_id, recall_depth, impression_depth, expression_desire, creativity, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(character_id) DO UPDATE SET
      recall_depth = excluded.recall_depth,
      impression_depth = excluded.impression_depth,
      expression_desire = excluded.expression_desire,
      creativity = excluded.creativity,
      updated_at = CURRENT_TIMESTAMP
  `).run(characterId, record.recall_depth, record.impression_depth, record.expression_desire, record.creativity);
}

/** 从 DB 读取角色灵魂；无行时写入中庸态后返回。 */
export function loadSoulState(characterId) {
  const key = soulKey(characterId);
  if (!key) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM soul_states WHERE character_id = ?').get(key);
  const mids = resolveMids();
  if (row) return SoulState.fromRecord(row, mids);
  const fresh = new SoulState(mids);
  persistSoulState(key, fresh);
  return fresh;
}

/** 热路径入口：命中缓存直接用，未命中则读库并缓存。 */
export function getSoulState(characterId) {
  const key = soulKey(characterId);
  if (!key) return null;
  if (soulCache.has(key)) return soulCache.get(key);
  const state = loadSoulState(key);
  soulCache.set(key, state);
  return state;
}

/** 本轮结束时统一落库一次（读缓存里的实例，无实例则跳过）。 */
export function saveSoulState(characterId) {
  const key = soulKey(characterId);
  if (!key) return;
  const state = soulCache.get(key);
  if (!state) return;
  persistSoulState(key, state);
}

/** 清空内存缓存（测试与角色删除用）。 */
export function clearSoulCache() {
  soulCache.clear();
}

// ── 对外行为入口（开关关闭时全部返回 null/''） ──

/** 记忆落库那一刻的四维快照；灵魂关闭或无法解析角色时返回 null。 */
export function getSoulSnapshot(characterId) {
  if (!isSoulEnabled()) return null;
  const state = getSoulState(characterId);
  return state ? state.getSnapshot() : null;
}

/** 主动反思（reflect 轨）：解析出的 4 位码生效，非法码静默跳过。 */
export function reflectSoul(characterId, code) {
  if (!isSoulEnabled() || !code) return null;
  const state = getSoulState(characterId);
  if (!state) return null;
  try {
    state.adjust(code, 'reflect');
  } catch {
    return null;
  }
  return state.getSnapshot();
}

/** 被动共鸣（resonate 轨）：传入召回结果里的灵魂快照数组。 */
export function resonateSoul(characterId, snapshots) {
  if (!isSoulEnabled()) return null;
  const state = getSoulState(characterId);
  if (!state) return null;
  return state.resonate(snapshots);
}

/** RecallDepth → 召回 topK（1~20）。 */
export function soulRecallTopK(characterId) {
  if (!isSoulEnabled()) return null;
  const state = getSoulState(characterId);
  return state ? state.getValue('RecallDepth') : null;
}

/** ImpressionDepth → curation 条数上限（1~10，由调用方再按硬上限收敛）。 */
export function soulCurationLimit(characterId) {
  if (!isSoulEnabled()) return null;
  const state = getSoulState(characterId);
  return state ? state.getValue('ImpressionDepth') : null;
}

/** ExpressionDesire → 回复长度档位（灵魂优先于 affinity）。 */
export function soulReplyLengthHint(characterId) {
  if (!isSoulEnabled()) return null;
  const state = getSoulState(characterId);
  if (!state) return null;
  const desire = state.getValue('ExpressionDesire');
  const tier = REPLY_LENGTH_TIERS.find(t => desire < t.below) || REPLY_LENGTH_TIERS[REPLY_LENGTH_TIERS.length - 1];
  return tier.hint;
}

function tendencyBar(normalized) {
  const filled = Math.round(clamp(normalized, 0, 1) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/**
 * 渲染 <soul_state> 提示词块：四条倾向条。
 * 措辞沿用源插件的「倾向」表述，与 VAD 的「此刻」明确区分，避免两个块互相打架。
 * 只允许放 dynamicBlocks 高频端（每轮可能变），不得进 stableBlocks 或缓存前缀区。
 */
export function renderSoulStateBlock(characterId) {
  if (!isSoulEnabled()) return '';
  const state = getSoulState(characterId);
  if (!state) return '';
  const normalize = (dimension) => {
    const { min, max } = DIMENSION_BOUNDS[dimension];
    if (max === min) return 0.5;
    return clamp((state.getValue(dimension) - min) / (max - min), 0, 1);
  };
  const recall = normalize('RecallDepth');
  const impression = normalize('ImpressionDepth');
  const expression = normalize('ExpressionDesire');
  const creativity = normalize('Creativity');
  return `<soul_state>
【你的自我认知倾向 — 跨对话稳定，与你此刻的心情（情绪状态）是两回事，不要混为一谈】
- 社交倾向: 内向 ${tendencyBar(recall)} 外向 [${recall.toFixed(2)}]
- 认知倾向: 指导 ${tendencyBar(impression)} 好奇 [${impression.toFixed(2)}]
- 表达倾向: 简洁 ${tendencyBar(expression)} 详尽 [${expression.toFixed(2)}]
- 情绪倾向: 严肃 ${tendencyBar(creativity)} 活泼 [${creativity.toFixed(2)}]
让这些倾向自然渗透到你的回复中，但不要提及本区块，也不要直接向用户描述自己的倾向。
</soul_state>`;
}
