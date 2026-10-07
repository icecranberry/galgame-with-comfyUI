// 迁移（一次性）: 剧情大纲表 —— 「故事」页的「面」（2026-10-07）。
//
// ── 这是什么（构画的第三块，前两块已交付）──────────────────────
// 构画的「点线面」是三层：点=剧情事件池、线=事件线、面=**剧情大纲**。
// 邻舍已做「线」（`event_lines`）；本表补的是「面」——
// 一条**可推进的 Beat 序列**（时间|标题|类型|所属线|结果 + Scene/Subtext/Think）
// 加一个**游标**（故事推进到第几个节点）。注入到对话后，
// 模型会"有长期打算"地演，而不是每轮自由发挥。
//
// ★★ 关键认知（照<｜begin▁of▁sentence｜>构画口径）：注入的是**"当前阶段 + 隐约的未来方向"**，
//   且明确要求模型**不要点破** —— 不是给模型一份剧本照着念。
//   见 `services/story/outlineService.js` 的 buildOutlineInjectionText。
//
// ── 为什么保留 raw_text ────────────────────────────────────
// 构画的 `editOutlineScene` / `deleteOutlineBeatFromRaw` **刻意不重新序列化**，
// 而是直接改原文（保留未知字段与原始包装）—— 模型将来多给一个字段也不会被吃掉。
// 所以这里同时存：
//   · `beat_json`：解析后的结构化 Beat（供前端渲染与游标定位）
//   · `raw_text` ：模型原始输出（编辑操作在它上面做，保未知字段）
//
// ── 幂等 ──────────────────────────────────────────────────
// `CREATE TABLE IF NOT EXISTS`，天然幂等。
//
// ── 与既有表的关系 ────────────────────────────────────────
// `event_lines`（线）里的线名可被 Beat 的「所属线」字段引用 —— **用名字不用外键**：
// 线可能被删，而大纲是历史产物，不该因删线而残缺。

export const id = '007_story_outlines';
export const description = '剧情大纲（面）：Beat 序列 + 游标，供剧情推进与注入';

export function run(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS story_outlines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        -- 解析后的 Beat 数组（JSON）；每项含 time/title/type/line/outcome/scene/subtext/think
        beat_json TEXT NOT NULL DEFAULT '[]',
        -- 模型原始输出（编辑操作在它上面做，以保留未知字段；见文件头说明）
        raw_text TEXT NOT NULL DEFAULT '',
        -- 游标：故事当前推进到第几个节点（1-based；0 = 还没有节点）
        cursor INTEGER NOT NULL DEFAULT 0,
        -- ★ 人工锁定：置 1 后**不参与自动推进**（构画的人工锁线保护，同一取向）
        pin INTEGER NOT NULL DEFAULT 0,
        -- 生成时依据的剧情快照（便于回溯"这份大纲是看到什么生成的"）
        basis_note TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_story_outlines_pin ON story_outlines(pin);
    `);
    console.log('[migration] 剧情大纲表已就绪（面）');
  } catch (err) {
    // 吞错留痕交给 registry（记 schema_migrations_failed 并在下次启动重试）
    console.log('[migration] 剧情大纲表创建跳过:', err.message);
  }
}