// 迁移（一次性）: 事件线表 —— T2「故事」页的数据基础（2026-10-07）。
//
// ── 这是什么（与现有 character_events 的区别）──────────────────
// `character_events` 是**一次性奇遇**（pending→expired，到期即失效），
// 没有"这件事后来怎么样了"的概念。本表补的正是那一层：**一条线跨多天演进**
// （起线→延展→成形→收束/淡出），可人工锁线（锁定后 AI 不得改动）。
//
// ⚠ **不碰 character_events**（用户裁定「不要碰奇遇」）：两表并存，
//   奇遇是"今天遇到一件事"，事件线是"这件事后续怎么发展"。
//   将来是否做"奇遇结束时人工升格为事件线"是**后续独立决定**，本迁移不做。
//
// ── 来源（构画逆向移植）─────────────────────────────────────
// 抄的是 `ST-SevenDaysCal` 的 `business/lines/schema.js` 的**数据结构与阶段机**，
// 保留其真正有价值的部分；**不抄它的"楼层节点"概念**（那是 ST 特有的）。
//
// ── 幂等 ──────────────────────────────────────────────────
// `CREATE TABLE IF NOT EXISTS` + 索引同名前缀，天然幂等。

export const id = '003_event_lines';
export const description = '事件线（T2）：跨天演进的剧情线，含阶段机/锁线/关联';

export function run(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        -- 线名（人工可改；模型首次生成时给）
        name TEXT NOT NULL DEFAULT '',
        -- 阶段：起线/延展/成形/收束/淡出（终态=收束|淡出）
        stage TEXT NOT NULL DEFAULT '起线'
          CHECK(stage IN ('起线','延展','成形','收束','淡出')),
        -- 何时（自由文本，第一期不做故事内历法 —— 那是 T4）
        when_text TEXT NOT NULL DEFAULT '',
        -- 推进方：player（由用户推动）/ world（世界自行演进）
        agency TEXT NOT NULL DEFAULT 'world' CHECK(agency IN ('player','world')),
        -- 停滞标记（线卡住了）
        stall INTEGER NOT NULL DEFAULT 0,
        -- ★ 人工锁线：置 1 后 AI 不得改动本线（构画最值得抄的一处保护）
        pin INTEGER NOT NULL DEFAULT 0,
        -- 成人向分池（与构画的 sfw|nsfw 分池同思路）
        adult INTEGER NOT NULL DEFAULT 0,
        -- 线的内容描述
        desc TEXT NOT NULL DEFAULT '',
        -- 下一步（模型给的推进方向，给下轮生成当锚点）
        next_text TEXT NOT NULL DEFAULT '',
        -- 票据编码（防"每次都生成雷同事件"，同构画的 TICKET-\d+）
        ticket TEXT NOT NULL DEFAULT '',
        -- 参与角色（JSON 数组存角色 id）—— 用于节点图的"关联"边自动计算
        participant_ids TEXT NOT NULL DEFAULT '[]',
        -- 关联地点（JSON 数组存地名）—— 同上
        places TEXT NOT NULL DEFAULT '[]',
        -- 派生自哪条线（人工/后期填；节点图的"派生"边来源）
        derived_from INTEGER REFERENCES event_lines(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_lines_stage ON event_lines(stage);
      CREATE INDEX IF NOT EXISTS idx_event_lines_pin ON event_lines(pin);
    `);
    console.log('[migration] 事件线表已就绪（T2）');
  } catch (err) {
    // 吞错留痕交给 registry（记 schema_migrations_failed 并在下次启动重试）
    console.log('[migration] 事件线表创建跳过:', err.message);
  }
}