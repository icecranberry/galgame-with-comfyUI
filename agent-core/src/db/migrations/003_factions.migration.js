// 迁移（一次性）: 「派系与组织」模块 —— 三张表（派系 / 成员 / 势力关系）。
//
// ── 这个迁移解决什么问题 ────────────────────────────────────────
// 酒馆页原本只有两块：「我的关系图」（人↔人、人↔我）与「世界观设置」（世界背景）。
// 本模块补第三块：**势力格局**（派系↔派系、角色↔派系）—— 三者是正交维度，不合并。
//
// 与「角色文件夹」的区别（**不要合并**）：
//   · 角色文件夹 = 用户侧分类（单层、一对一、纯手动、"我怎么找角色"）；
//   · 派系与组织 = 世界观侧归属（可层级、**多对多**、带职务与关系、"这个世界怎么运转"）。
//
// ── 设计要点 ──────────────────────────────────────────────────
// · `factions.parent_id` 支持层级（组织 → 支部/部门）；删除父级时子级 **置 NULL**（不级联删）。
// · `faction_members` 是**多对多**：一个角色可同时属多个组织（黑帮 + 公司 + 教会线人）。
// · `faction_relations` 记势力之间的关系与强度（同盟/敌对/中立/从属/竞争）。
// · 派系是**世界观实例专属**（二相乐园 ≠ 武装JK世界）→ 带 `world_slug`；
//   结构化定义随 `world-projects/<slug>/project.json` 的 `factions` 槽位走（镜像，见 worldProjectLibrary）。
//
// ⚠ 全部 `CREATE TABLE IF NOT EXISTS`，天然幂等（老库升级到本机制时 schema_migrations 为空、
//   所有已登记迁移都会跑一次，见红线 13）。

export const id = '003_factions';
export const description = '派系与组织：factions / faction_members / faction_relations 三张表';

export function run(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS factions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        slug          TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL DEFAULT '其他',
        parent_id     INTEGER REFERENCES factions(id) ON DELETE SET NULL,
        summary       TEXT NOT NULL DEFAULT '',
        description   TEXT NOT NULL DEFAULT '',
        color         TEXT,
        icon          TEXT,
        world_slug    TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        origin        TEXT NOT NULL DEFAULT 'manual',
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS faction_members (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        faction_id    INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
        character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        role          TEXT NOT NULL DEFAULT '',
        rank          INTEGER NOT NULL DEFAULT 5,
        note          TEXT NOT NULL DEFAULT '',
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(faction_id, character_id, role)
      );

      CREATE TABLE IF NOT EXISTS faction_relations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        from_faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
        to_faction_id   INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
        relation        TEXT NOT NULL,
        strength        INTEGER NOT NULL DEFAULT 50,
        note            TEXT NOT NULL DEFAULT '',
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_faction_id, to_faction_id)
      );

      CREATE INDEX IF NOT EXISTS idx_factions_parent ON factions(parent_id);
      CREATE INDEX IF NOT EXISTS idx_factions_world ON factions(world_slug);
      CREATE INDEX IF NOT EXISTS idx_faction_members_faction ON faction_members(faction_id);
      CREATE INDEX IF NOT EXISTS idx_faction_members_char ON faction_members(character_id);
      CREATE INDEX IF NOT EXISTS idx_faction_relations_from ON faction_relations(from_faction_id);
      CREATE INDEX IF NOT EXISTS idx_faction_relations_to ON faction_relations(to_faction_id);
    `);
    console.log('[migration] 派系与组织：factions / faction_members / faction_relations 就绪');
  } catch (err) {
    // 吞错留痕交给 registry（记 schema_migrations_failed 并在下次启动重试）
    console.log('[migration] 派系与组织建表跳过:', err.message);
  }
}
