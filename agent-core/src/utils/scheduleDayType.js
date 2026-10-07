/**
 * scheduleDayType —— 「某一天算工作日还是休息日」的**唯一真源**（2026-10-07）。
 *
 * ── 为什么单独成文件（红线 8：同一口径只留一份定义）──────────────
 * "哪天是休息日"会被多处使用：日程快照按日型取方案、生成时的提示词要写明今天是什么日子、
 * 将来可能还要给朋友圈/报纸用。**一旦出现两份实现，必然漂移** ——
 * 典型后果就是"界面按休息日排、生成时却按工作日写"。
 *
 * ⚠ 这里只定义**日子类型**（workday / restday），不碰"具体是星期几"的文案；
 *   星期几的显示另有 `timeLight` / `newspaperService` 等处，勿在本文重复造轮子。
 *
 * ⚠ **不内置任何世界观知识**（红线 12）：七天里哪几天休息是**通用**设定，
 *   不指向任何具体世界；将来若要按世界观自定义，应把规则搬到
 *   `data/world-projects/<slug>/project.json`，本文件只保留默认实现。
 */

/** 日子类型枚举 —— 与 `schedule_day_plans.day_type` 取值一致 */
export const DAY_TYPES = ['workday', 'restday'];

export const DAY_TYPE_LABEL = {
  workday: '工作日',
  restday: '休息日',
};

/**
 * 由 `Date` 取"日子类型"。
 *
 * 默认口径：**周六、周日 = 休息日**，其余 = 工作日。
 * （这是通用惯例，不涉及任何世界观专名。）
 *
 * @param {Date} [date] 目标日期，默认取当前本地时间
 * @returns {'workday'|'restday'}
 */
export function dayTypeOf(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 'workday';   // 非法日期按工作日兜底，不抛（调用方多在快照热路径）
  const wd = d.getDay();                              // 0=周日, 6=周六
  return (wd === 0 || wd === 6) ? 'restday' : 'workday';
}

/** 归一化外部传入的 day_type；不认识的值一律回落 `workday`（与 normalizeLineStage 同口径：不抛错） */
export function normalizeDayType(value) {
  const v = String(value ?? '').trim();
  return DAY_TYPES.includes(v) ? v : 'workday';
}

/** 中文标签（用于注入提示词与界面显示） */
export function dayTypeLabel(value) {
  return DAY_TYPE_LABEL[normalizeDayType(value)];
}