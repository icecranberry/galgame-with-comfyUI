/**
 * 小镇特殊建筑「描述驱动的可执行玩法」持久层（docs/town-special-buildings-plan.md §7）。
 *
 * 身份口径：建筑稳定实例 = town_locations.key（重排时按 key 原地更新、id 不变），
 * 执行上下文总是 world_id + world_epoch + map_id + building_instance_id。
 * 三张表各司其职：
 *   - town_building_feature_profiles  每个世界代次每栋建筑实例一行：来源快照/sourceHash、
 *     原始生成 JSON、编译后配置（稳定功能 ID 与资源绑定）、状态机与生成预算。
 *   - town_building_feature_operations 每次玩家确认执行一行：幂等键、报价、随机种子与
 *     固定抽取结果、钱物/外观结果引用、图片产物引用。状态机见计划 §9.4。
 *   - town_building_feature_usage      仅有限次数/每日签运建稀疏配额行（不逐 tick 写入）。
 *   - town_building_feature_events     非交易功能的奇遇容器（building_feature 来源），
 *     复用奇遇呈现；开场/选项/结果文案来自已编译配置，不逐轮调用模型。
 * Requires the town schema (town_locations) first.
 */
export const BUILDING_FEATURE_PROFILE_STATUSES = [
  'unconfigured', 'generating', 'ready', 'partial', 'unsupported', 'failed', 'stale', 'disabled',
];
export const BUILDING_FEATURE_OPERATION_STATUSES = [
  'pending', 'generating', 'ready', 'committed', 'failed', 'cancelled',
];

/** operations 表体：唯一键覆盖世界代次（计划 §7.3「唯一键至少覆盖作用域」——
 * 世界重置后同幂等键不得命中旧代次操作） */
const OPERATIONS_TABLE_BODY = `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL,
      world_epoch INTEGER NOT NULL,
      map_id INTEGER NOT NULL,
      building_instance_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      profile_revision INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      template_version INTEGER NOT NULL,
      player_actor_id TEXT NOT NULL,
      target_json TEXT,
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      input_json TEXT,
      execution_json TEXT,
      quote_json TEXT,
      quote_expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      random_seed TEXT,
      random_result_json TEXT,
      result_json TEXT,
      event_ref TEXT,
      task_id TEXT,
      output_json TEXT,
      error_code TEXT,
      error_message TEXT,
      reservation_json TEXT,
      llm_calls INTEGER NOT NULL DEFAULT 0,
      image_calls INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(world_id, world_epoch, building_instance_id, player_actor_id, idempotency_key)
    `;

export function migrateTownBuildingFeatureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS town_building_feature_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      world_epoch INTEGER NOT NULL,
      map_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      building_instance_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unconfigured',
      source_json TEXT,
      source_hash TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      registry_version INTEGER NOT NULL DEFAULT 0,
      generation_token TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      generated_json TEXT,
      compiled_json TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      manual INTEGER NOT NULL DEFAULT 0,
      feature_ids_json TEXT,
      resource_bindings_json TEXT,
      opening_budget_json TEXT,
      world_version TEXT,
      operator_actor_id TEXT,
      llm_calls INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      generated_at DATETIME,
      UNIQUE(world_id, world_epoch, building_instance_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bf_profiles_map ON town_building_feature_profiles(map_id, building_instance_id);

    CREATE TABLE IF NOT EXISTS town_building_feature_operations (
      ${OPERATIONS_TABLE_BODY});
    CREATE INDEX IF NOT EXISTS idx_bf_operations_scope ON town_building_feature_operations(world_id, building_instance_id, feature_id, status);

    CREATE TABLE IF NOT EXISTS town_building_feature_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      world_epoch INTEGER NOT NULL,
      map_id INTEGER NOT NULL,
      building_instance_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      player_actor_id TEXT NOT NULL,
      window_date TEXT NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      reserved_count INTEGER NOT NULL DEFAULT 0,
      last_operation_id TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(world_id, building_instance_id, feature_id, player_actor_id, window_date)
    );

    CREATE TABLE IF NOT EXISTS town_building_feature_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      world_epoch INTEGER NOT NULL,
      map_id INTEGER NOT NULL,
      building_instance_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      operation_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      opening TEXT NOT NULL DEFAULT '',
      options_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bf_events_scope ON town_building_feature_events(world_id, building_instance_id, status);
    -- 每栋建筑同一功能同时最多一个活跃模板事件
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_bf_event
      ON town_building_feature_events(world_id, building_instance_id, feature_id) WHERE status IN ('open','engaged');
  `);

  // 老库幂等补列（防护未来扩展；当前建表即含全部列）
  const cols = db.prepare('PRAGMA table_info(town_building_feature_profiles)').all();
  if (cols.length && !cols.find(c => c.name === 'llm_calls')) {
    db.exec('ALTER TABLE town_building_feature_profiles ADD COLUMN llm_calls INTEGER NOT NULL DEFAULT 0');
  }

  // 旧版 operations 表唯一键缺 world_epoch：检测到旧签名时幂等重建（保留全部数据行）
  const opsSql = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'town_building_feature_operations'").get()?.sql || '')
    .replace(/\s+/g, ' ');
  if (opsSql && !opsSql.includes('UNIQUE(world_id, world_epoch, building_instance_id, player_actor_id, idempotency_key)')) {
    db.exec(`
      CREATE TABLE town_building_feature_operations_new (${OPERATIONS_TABLE_BODY});
      INSERT INTO town_building_feature_operations_new SELECT * FROM town_building_feature_operations;
      DROP TABLE town_building_feature_operations;
      ALTER TABLE town_building_feature_operations_new RENAME TO town_building_feature_operations;
      CREATE INDEX IF NOT EXISTS idx_bf_operations_scope
        ON town_building_feature_operations(world_id, building_instance_id, feature_id, status);
    `);
  }

  // 建筑实例上的用户可编辑「用途描述」（来源优先级第 1 位，见计划 §3.1）。
  // town_locations 是核心表：这里只做幂等补列，不改既有语义。
  const locationCols = db.prepare('PRAGMA table_info(town_locations)').all();
  if (locationCols.length && !locationCols.find(c => c.name === 'feature_desc')) {
    db.exec("ALTER TABLE town_locations ADD COLUMN feature_desc TEXT NOT NULL DEFAULT ''");
  }

  // 店铺已不承载特殊奇遇（唯一写入口 acceptTownBuildingFeatureInvitation 已删除），
  // 历史模板事件行每次启动强制清空；空表时为 no-op，保持幂等。读侧（routes/events.js
  // 的活跃事件计数）读到空集是预期行为。
  db.prepare('DELETE FROM town_building_feature_events').run();
}
