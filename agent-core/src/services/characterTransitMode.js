/**
 * characterTransitMode.js —— 角色「移动方式」的**唯一真源**。
 *
 * ── 为什么需要它（2026-10-06 用户诉求）──
 *
 * 有角色在设定上具备超能力移动（瞬移 / 飞行 / 空间跳跃）。但系统此前把
 * 「不许瞬移」写成了**绝对规则**，三处口径相互打架：
 *   ① 约束层（`buildScheduleConstraintBlock`）写「换场时间不得明显小于上表数值……
 *      不要出现"刚在城东吃完早饭、下一段立刻出现在城西"这种**瞬移**」——
 *      对一个会瞬移的角色，这句话**正是反的**；
 *   ② 通勤复算（`checkTransitFeasibility`）把它记成「换场时间不足」；
 *   ③ 日程台账（`auditSchedule` 的 `teleport` 项）报「无换场时间」。
 *
 * 用户裁定（三档中的**二档**）：
 *   · 建角色级结构化字段，约束层与校验都按它改口径；
 *   · **不建模代价**（不做次数上限、不做冷却）——有能力就不受限；
 *   · 台账**按能力分级**：有能力即不报 `teleport`。
 *
 * ── 设计红线 ────────────────────────────────────────────
 * ★ **默认 `normal` = 上线前行为**：不选该字段的角色，三处输出必须与改动前
 *   逐字节一致（约束层不出现新句子、校验照旧、台账照旧）。
 * ★ 本文件是**唯一真源**：约束层、复算校验、日程台账三处一律调用这里，
 *   禁止各自写一份判断（改一处漏一处 —— 项目红线 8）。
 */

/** 可选移动方式。`normal` 必须是默认，且是唯一"受通勤表约束"的档位。 */
export const TRANSIT_MODES = [
  {
    key: 'normal',
    label: '普通（受通勤约束）',
    hint: '按地图通勤表核验换场时间；瞬移会被记成「换场时间不足」。',
  },
  {
    key: 'teleport',
    label: '瞬移 / 空间跳跃',
    hint: '不受通勤表限制，但仍要在描述里交代怎么到的。',
  },
  {
    key: 'flight',
    label: '飞行 / 高速移动',
    hint: '不受通勤表限制，换场时间可大幅压缩。',
  },
  {
    key: 'unrestricted',
    label: '不受限（其他）',
    hint: '其他形式的超常移动，一律豁免通勤约束。',
  },
];

const KEYS = new Set(TRANSIT_MODES.map(m => m.key));

/** 默认档：`normal`。任何解析失败一律回落到它。 */
export const DEFAULT_TRANSIT_MODE = 'normal';

/**
 * 规范化移动方式。
 * @param {unknown} value 原始值（可能来自 DB / 请求体 / undefined）
 * @returns {string} 合法 key；非法或缺失一律回落 `normal`
 */
export function normalizeTransitMode(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return KEYS.has(s) ? s : DEFAULT_TRANSIT_MODE;
}

/**
 * 该角色是否**豁免通勤约束**（不受通勤表限制）。
 *
 * 这是三处调用点的统一判据 —— 约束层用它决定是否改口径，
 * 复算校验与台账用它决定是否跳过。
 *
 * @param {unknown} mode 移动方式
 * @returns {boolean}
 */
export function isTransitExempt(mode) {
  return normalizeTransitMode(mode) !== DEFAULT_TRANSIT_MODE;
}

/** 该移动方式的中文标签（用于提示词与台账展示） */
export function transitModeLabel(mode) {
  const key = normalizeTransitMode(mode);
  return (TRANSIT_MODES.find(m => m.key === key) || {}).label || '普通（受通勤约束）';
}