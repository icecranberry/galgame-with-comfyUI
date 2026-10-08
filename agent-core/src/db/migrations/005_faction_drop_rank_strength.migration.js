// 迁移（一次性）: 去掉「派系与组织」里两个**多余的数值栏**（2026-10-07 用户裁定）。
//
// ── 用户原话 ──────────────────────────────────────────────────
// 「我觉得没有必要设置等级数值，与其他势力的关系也不需要数值」
//
// ── 为什么删而不是留着不用 ──────────────────────────────────────
//   · `faction_members.rank`（等级 0-9）：职务（role）已经把"谁大谁小"说清楚了，
//     再要一个 0-9 的数字是**两个口径讲同一件事**，必然漂移；而且用户根本没有可依据的分级标准。
//   · `faction_relations.strength`（强度 0-100）：势力关系只有"是哪种"（同盟/敌对/从属…），
//     拍一个 0-100 的数字既无依据、也不影响任何行为 —— 纯粹是填表负担。
//   留着不用 = 下次改的人不知道它该不该填（"意义不明的栏"）。所以**彻底删列**。
//
// ⚠ SQLite 的 `DROP COLUMN` 需 ≥ 3.35（本项目 better-sqlite3 带 **3.53.2** ✓）。
//   两列都**没有**被索引 / 唯一约束 / 视图 / 触发器引用，可以安全删。
// ⚠ 逐列先查 `PRAGMA table_info`，保证**原本幂等**（红线 13）：重复跑不报错。

export const id = '005_faction_drop_rank_strength';
export const description = '派系与组织：删掉 faction_members.rank 与 faction_relations.strength 两个数值栏';

const DROPS = [
  ['faction_members', 'rank'],
  ['faction_relations', 'strength'],
];

function tableExists(db, table) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) != null;
}

export function run(db) {
  const dropped = [];
  for (const [table, col] of DROPS) {
    if (!tableExists(db, table)) continue;                     // 003 还没跑：等它先建表
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    if (!cols.has(col)) continue;                              // 已删过
    try {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
      dropped.push(`${table}.${col}`);
    } catch (err) {
      // 单列失败不阻断（本迁移不会被标记完成，下次启动重试）
      console.log(`[migration] 删除 ${table}.${col} 失败：${err.message}`);
    }
  }
  console.log(dropped.length
    ? `[migration] 派系与组织：已删数值栏 ${dropped.join('、')}`
    : '[migration] 派系与组织：数值栏已是最新（无需删）');
}
