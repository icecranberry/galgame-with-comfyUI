// 迁移（一次性）: 「按日子类型的日程方案」——支持工作日 / 休息日两套日程（2026-10-07）。
//
// ── 用户需求 ────────────────────────────────────────────────
// 「是否可以设置 1 周 7 天的**工作日和休息日差异**？」
//
// ── 现状（为什么需要新表）────────────────────────────────────
// 现在一个角色只有**一套** `schedule_templates`（`UNIQUE(character_id)`），
// `snapshotTodaySchedule()` 把它原样复制给每一天 → **七天一模一样**，没有工作日/休息日之分。
// 而那张表被 **11 处**代码按"一个角色一行"读取（含 `eventSchedule` 的事件重放、
// 台账 `scheduleLedger` 的错别字统计），**改它的主键形态风险很高**。
//
// ── 所以这样设计 ────────────────────────────────────────────
//   · `schedule_templates` **保持不变**，继续充当"**默认日历**"（没配日型时每天都用它，
//     且不带 day_type 生成时也写它 → 既有行为逐字节不变）。
//   · 新增 `schedule_day_plans`：**按日子类型**的额外方案。快照当天日程时按
//     `日期 → 星期 → 日子类型` 优先取它，取不到回落默认日历。
//   · 这样"差异"是**纯增量**：没配过的角色行为完全同现在；配过的角色按周循环生效。
//
// ⚠ 只存 day_type（`workday` / `restday`），**不存具体星期几** ——
//   哪几天算工作日/休息日由 `utils/scheduleDayType.js` 单点决定（红线 8：同一口径只留一份定义），
//   将来要加"单双周"或"自定义"只改那一个文件，不用动数据。
// ⚠ 全部 `CREATE TABLE IF NOT EXISTS`，天然幂等（红线 13）。

export const id = '006_schedule_day_plans';
export const description = '按日子类型（工作日/休息日）的日程方案表';

export function run(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schedule_day_plans (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        day_type      TEXT NOT NULL,
        schedule_json TEXT NOT NULL DEFAULT '[]',
        direction     TEXT,
        generated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        version       INTEGER DEFAULT 1,
        UNIQUE(character_id, day_type)
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_day_plans_char ON schedule_day_plans(character_id);
    `);
    console.log('[migration] 按日型的日程方案表就绪（schedule_day_plans）');
  } catch (err) {
    console.log('[migration] 按日型的日程方案表跳过:', err.message);
  }
}