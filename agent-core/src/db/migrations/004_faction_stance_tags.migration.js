// 迁移（一次性）: 「派系与组织」加**态势与标签**字段（2026-10-07）。
//
// ── 为什么加这些字段 ─────────────────────────────────────────────
// 参考用户既有的《剧本 开局态势》数据结构（`50-创意库/…/设定参考/`），一个势力除了"是谁"
// 还要回答"现在什么状态、想干什么、靠什么立足"—— 这些才是**创意写作的抓手**：
//
//   scope   势力范围      「悲泣区·鸽川区」      → 场景该在哪
//   status  状态          「鼎盛 / 稳固 / 困顿」 → 气焰高低，写法不同
//   stance  对玩家的态度  「友好 / 中立 / 冷淡 / 敌对」→ 角色该怎么对"我"
//   goal    当下目标      「把持地下产业…」      → 行为动机（最有指导性）
//   tags    权力支柱      「武力威慑 / 黑灰产业」 → **小标签**，一句话说清它凭什么
//
// ⚠ 红线 12：本迁移只加**空字段**，不含任何世界观专名。建议值（状态/态度/支柱的候选词）
//   全是通用词，定义在 `services/factionService.js`；世界观专属的支柱（如某世界的专有名词）
//   由用户自己填，落在 `data/world-projects/<slug>/project.json` 的镜像里。
//
// ⚠ SQLite 的 `ALTER TABLE ADD COLUMN` **没有 IF NOT EXISTS** —— 所以逐列先查
//   `PRAGMA table_info` 再决定加不加，保证"原本幂等"（红线 13）。

export const id = '004_faction_stance_tags';
export const description = '派系与组织：补 scope/status/stance/goal/tags 五列（态势与小标签）';

const COLUMNS = [
  ['scope', "TEXT NOT NULL DEFAULT ''"],
  ['status', "TEXT NOT NULL DEFAULT '稳固'"],
  ['stance', "TEXT NOT NULL DEFAULT '中立'"],
  ['goal', "TEXT NOT NULL DEFAULT ''"],
  ['tags', "TEXT NOT NULL DEFAULT '[]'"],
];

export function run(db) {
  let tableExists = false;
  try {
    tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='factions'`).get() != null;
  } catch { tableExists = false; }
  if (!tableExists) {
    // 003 还没跑（异常顺序）：跳过，下次启动 003 先建表、004 再补列
    console.log('[migration] 派系态势字段跳过：factions 表还不存在（等 003 先跑）');
    return;
  }

  const existing = new Set(db.prepare('PRAGMA table_info(factions)').all().map(c => c.name));
  const added = [];
  for (const [name, decl] of COLUMNS) {
    if (existing.has(name)) continue;
    try {
      db.exec(`ALTER TABLE factions ADD COLUMN ${name} ${decl}`);
      added.push(name);
    } catch (err) {
      // 单列失败不阻断（下一次启动会重试，因为本迁移未被标记完成）
      console.log(`[migration] 派系字段 ${name} 添加失败：${err.message}`);
    }
  }
  console.log(added.length
    ? `[migration] 派系与组织：已补 ${added.join('/')}`
    : '[migration] 派系与组织：态势字段已是最新');
}
