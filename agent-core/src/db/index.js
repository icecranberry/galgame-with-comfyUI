import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { initSettingsHandle, loadSystemSettings } from './settings.js';
import { initWorldRepository } from './worldRepository.js';
import { seedAll } from './seedData.js';
import { DEFAULT_EVENT_TYPES } from './seedEventTypes.js';
import { DEFAULT_MOMENT_TOPICS } from './seedTopics.js';
import { IMAGE_PROMPT_KNOWLEDGE, IMAGE_PROMPT_KNOWLEDGE_VERSION } from './imagePromptKnowledgeData.js';

let db;

export function getDb() {
  if (!db) {
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    -- 原始完整消息表（LLM 上下文用，不拆分）
    CREATE TABLE IF NOT EXISTS raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      prompt TEXT,
      client_msg_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 分句展示消息表（前端用，每个气泡一条）
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      raw_id INTEGER REFERENCES raw_messages(id),
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      images TEXT,
      seq INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- MaiBot 桥接：最新一份记忆整理（覆盖式，供 MaiBot 主聊天流注入）
    CREATE TABLE IF NOT EXISTS maibot_latest_memory (
      session_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 记忆碎片表（事实/偏好/情绪）
    CREATE TABLE IF NOT EXISTS memory_fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      source_msg_id INTEGER REFERENCES messages(id),
      source_raw_start_id INTEGER,
      source_raw_end_id INTEGER,
      fragment_type TEXT NOT NULL CHECK(fragment_type IN ('fact','preference','emotion')),
      content TEXT NOT NULL,
      entities TEXT DEFAULT '[]',
      chroma_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 滚动摘要表
    CREATE TABLE IF NOT EXISTS rolling_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      start_msg_id INTEGER NOT NULL,
      end_msg_id INTEGER NOT NULL,
      summary TEXT NOT NULL,
      checkpoint_version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- 情绪快照表（每 conversation 仅保留最新一条）
    CREATE TABLE IF NOT EXISTS emotion_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL UNIQUE,
      after_msg_id INTEGER REFERENCES messages(id),
      valence REAL NOT NULL DEFAULT 0.5,
      arousal REAL NOT NULL DEFAULT 0.5,
      dominance REAL NOT NULL DEFAULT 0.5,
      mood_valence REAL DEFAULT 0.5,
      mood_arousal REAL DEFAULT 0.5,
      mood_dominance REAL DEFAULT 0.5,
      dominant_emotion TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 生图任务表
    CREATE TABLE IF NOT EXISTS image_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      source_msg_id INTEGER REFERENCES messages(id),
      prompt_original TEXT NOT NULL,
      prompt_refined TEXT,
      style TEXT,
      resolution TEXT DEFAULT '1024x1024',
      workflow_template TEXT,
      comfyui_prompt_id TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
      output_paths TEXT DEFAULT '[]',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS image_prompt_preparations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene TEXT NOT NULL DEFAULT 'chat',
      prompt_original TEXT NOT NULL,
      prompt_refined TEXT NOT NULL,
      knowledge_ids TEXT NOT NULL DEFAULT '[]',
      knowledge_version TEXT,
      retrieval_mode TEXT NOT NULL DEFAULT 'fallback',
      retrieval_snapshot TEXT NOT NULL DEFAULT '{}',
      optimization_status TEXT NOT NULL DEFAULT 'fallback',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 生图提示词知识库（独立于聊天记忆，仅供生图 prompt 生产链检索）
    CREATE TABLE IF NOT EXISTS image_prompt_knowledge (
      knowledge_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      search_terms TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      executable_tags TEXT NOT NULL DEFAULT '[]',
      scenes TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      version TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 全局规则表（追加到每个角色的 system prompt 末尾）
    CREATE TABLE IF NOT EXISTS global_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      rule_content TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 系统设置表（画师串/分辨率/功能开关，替代 .env 中的对应字段）
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 朋友圈帖子表
    CREATE TABLE IF NOT EXISTS moment_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      prompt TEXT,
      style TEXT,
      resolution TEXT DEFAULT '1600x1200',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','generating','done','failed')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 朋友圈评论表
    CREATE TABLE IF NOT EXISTS moment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES moment_posts(id) ON DELETE CASCADE,
      author_type TEXT NOT NULL CHECK(author_type IN ('user','character')),
      author_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 朋友圈点赞表（单用户：每个帖子最多一个赞，UNIQUE 约束 + toggle）
    CREATE TABLE IF NOT EXISTS moment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES moment_posts(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id)
    );

    -- 朋友圈未读计数已迁移为时序方案（last_moments_seen_at）
    -- moment_unread 表如有残留，由下方 migrateMomentUnreadToTimestamp() 清理

    -- 用户关系表（用户 → 角色，用户为单例无 user_id，每个角色唯一一条）
    CREATE TABLE IF NOT EXISTS user_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      relationship_text TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id)
    );

    -- 用户画像表（角色视角下的用户特征，AI 自动从对话中提取）
    -- trait_type: appearance(外貌) / personality(性格) / preference(偏好)
    CREATE TABLE IF NOT EXISTS user_portraits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      trait_type TEXT NOT NULL CHECK(trait_type IN ('appearance','personality','preference')),
      content TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source_msg_id INTEGER REFERENCES messages(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, trait_type, content)
    );

    -- 世界观收藏表（多套设定，可切换激活）
    CREATE TABLE IF NOT EXISTS world_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      is_active INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 角色关系表（有向：from → to，关系文本存储在 relationship_text 中）
    CREATE TABLE IF NOT EXISTS character_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      to_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      relationship_text TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(from_character_id, to_character_id)
    );

    -- 角色配置表
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      base_prompt TEXT NOT NULL,
      avatar_path TEXT,
      emotion_baseline TEXT NOT NULL DEFAULT '{"valence":0.5,"arousal":0.5,"dominance":0.5}',
      moments_disabled INTEGER DEFAULT 0,
      short_prompt TEXT,
      artist_override TEXT,
      handwriting_font TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 画师串收藏夹
    CREATE TABLE IF NOT EXISTS artist_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      artist TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 奇遇事件表（每角色同时最多一个活跃事件）
    CREATE TABLE IF NOT EXISTS character_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      event_type_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','open','engaged','completed','expired','cancelled')),
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image TEXT,
      prompt TEXT,
      style TEXT,
      resolution TEXT DEFAULT '1600x1200',
      choice_a TEXT NOT NULL DEFAULT '',
      choice_b TEXT NOT NULL DEFAULT '',
      choice_c_label TEXT NOT NULL DEFAULT '自由行动',
      current_branch INTEGER DEFAULT 0,
      max_branches INTEGER DEFAULT 3,
      choice_history TEXT DEFAULT '[]',
      summary TEXT DEFAULT '',
      engaged INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_interaction_at DATETIME,
      half_time_notified INTEGER DEFAULT 0,
      error_message TEXT
    );

    -- 日程模板表（每个角色一条，LLM 生成后缓存）
    CREATE TABLE IF NOT EXISTS schedule_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
      schedule_json TEXT NOT NULL DEFAULT '[]',
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      version INTEGER DEFAULT 1
    );

    -- 每日日程实例表（从 template 快照，独立于模板可微调）
    CREATE TABLE IF NOT EXISTS daily_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      schedule_date TEXT NOT NULL,
      schedule_json TEXT NOT NULL DEFAULT '[]',
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, schedule_date)
    );

    -- 消息回复队列表（延迟回复 + 睡眠合并）
    CREATE TABLE IF NOT EXISTS reply_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL,
      user_raw_msg_id INTEGER NOT NULL,
      user_msg_id INTEGER NOT NULL,
      user_content TEXT NOT NULL,
      client_msg_id TEXT,
      scheduled_reply_at DATETIME NOT NULL,
      status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','processing','done','cancelled')),
      reply_raw_msg_id INTEGER,
      reply_msg_ids TEXT DEFAULT '[]',
      current_activity TEXT,
      delay_minutes INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    );

    -- 奇遇事件历史表
    CREATE TABLE IF NOT EXISTS event_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      event_type_key TEXT,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      final_image TEXT,
      summary TEXT NOT NULL DEFAULT '',
      choice_history TEXT DEFAULT '[]',
      total_branches INTEGER DEFAULT 0,
      engaged INTEGER DEFAULT 0,
      outcome TEXT DEFAULT 'expired' CHECK(outcome IN ('completed','expired','cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 梦境表（睡眠会话内共享；talk_schedule 为本次睡眠已排定的梦话时刻 ISO 数组）
    CREATE TABLE IF NOT EXISTS character_dreams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      dream_type TEXT,
      content TEXT NOT NULL,
      image_prompt TEXT,
      image_path TEXT,
      dream_talks TEXT DEFAULT '[]',
      talk_schedule TEXT DEFAULT '[]',
      talks_emitted INTEGER DEFAULT 0,
      status TEXT DEFAULT 'generating' CHECK(status IN ('generating','ready','failed')),
      sleep_until DATETIME,
      shared_at DATETIME,
      shared_via TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dreams_char_created ON character_dreams(character_id, created_at DESC);

    -- 信箱信件表
    CREATE TABLE IF NOT EXISTS mailbox_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK(direction IN ('user_to_char','char_to_user')),
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      reply_content TEXT DEFAULT '',
      content_short TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      reply_at DATETIME,
      paper_path TEXT DEFAULT '',
      portrait_path TEXT DEFAULT '',
      illustration_path TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      replied_at DATETIME,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    -- 逐小时天气缓存表（仅保留 24 条，weather_time 为 HH:00）
    CREATE TABLE IF NOT EXISTS weather_hourly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weather_time TEXT NOT NULL UNIQUE,
      weather_text TEXT NOT NULL,
      temperature TEXT NOT NULL,
      wind_speed TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 群聊表（conversation_id = 'group_' || id，消息复用 raw_messages/messages 双表）
    CREATE TABLE IF NOT EXISTS group_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      topic TEXT DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','character')),
      creator_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      idle_enabled INTEGER DEFAULT 1,
      next_idle_at DATETIME,
      idle_budget INTEGER DEFAULT 2,
      idle_budget_date TEXT,
      idle_budget_used INTEGER DEFAULT 0,
      last_message_at DATETIME,
      last_seen_at DATETIME,
      rag_last_extracted_raw_id INTEGER DEFAULT 0,
      rag_user_rounds_pending INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 群成员表
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, character_id)
    );

    -- 奇遇事件类型库（系统 default + 用户自定义 custom）
    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 20,
      urgency INTEGER NOT NULL DEFAULT 1,
      fun_from TEXT NOT NULL DEFAULT '[]',
      desc TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'default' CHECK(source IN ('default','custom')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 朋友圈话题库（系统 default + 用户自定义 custom）
    CREATE TABLE IF NOT EXISTS moment_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      desc TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'default' CHECK(source IN ('default','custom')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 只补齐历史 NULL；保留用户显式关闭后台闲聊的 idle_enabled=0。
  db.prepare(`UPDATE group_chats SET idle_enabled = 1 WHERE idle_enabled IS NULL`).run();

  // FTS5 external content table — drop & recreate to handle schema changes
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='id'
    );
  `);

  // Triggers to keep FTS5 index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_raw ON messages(raw_id);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_conv ON raw_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_fragments_conv ON memory_fragments(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_fragments_type ON memory_fragments(fragment_type);
    CREATE INDEX IF NOT EXISTS idx_summaries_conv ON rolling_summaries(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_summaries_checkpoint ON rolling_summaries(conversation_id, end_msg_id);

    CREATE INDEX IF NOT EXISTS idx_image_tasks_conv ON image_tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_image_prompt_knowledge_category ON image_prompt_knowledge(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_image_prompt_knowledge_priority ON image_prompt_knowledge(priority DESC);
    CREATE INDEX IF NOT EXISTS idx_moment_posts_character ON moment_posts(character_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_moment_posts_created ON moment_posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_moment_posts_filter ON moment_posts(status);
    CREATE INDEX IF NOT EXISTS idx_moment_comments_post ON moment_comments(post_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_user_rels_char ON user_relationships(character_id);
    CREATE INDEX IF NOT EXISTS idx_portraits_char ON user_portraits(character_id);
    CREATE INDEX IF NOT EXISTS idx_portraits_type ON user_portraits(trait_type);
    CREATE INDEX IF NOT EXISTS idx_char_rels_from ON character_relationships(from_character_id);
    CREATE INDEX IF NOT EXISTS idx_char_rels_to ON character_relationships(to_character_id);
    CREATE INDEX IF NOT EXISTS idx_ce_char_status ON character_events(character_id, status);
    CREATE INDEX IF NOT EXISTS idx_ce_expires ON character_events(expires_at);
    CREATE INDEX IF NOT EXISTS idx_eh_char ON event_history(character_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ds_char_date ON daily_schedules(character_id, schedule_date);
    CREATE INDEX IF NOT EXISTS idx_rq_scheduled ON reply_queue(scheduled_reply_at, status);
    CREATE INDEX IF NOT EXISTS idx_rq_character ON reply_queue(character_id, status);
    CREATE INDEX IF NOT EXISTS idx_weather_lookup ON weather_hourly(weather_time);
    CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_char ON group_members(character_id);
    CREATE INDEX IF NOT EXISTS idx_group_chats_idle ON group_chats(next_idle_at, idle_enabled);
  `);

  // Partial unique index for raw_messages client_msg_id (SQLite 3.8+)
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_client_msg ON raw_messages(client_msg_id) WHERE client_msg_id IS NOT NULL`);
  } catch (err) {
    console.log('[db] idx_raw_client_msg skipped:', err.message);
  }

  // Partial unique index: 每角色最多一个活跃事件
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_event ON character_events(character_id) WHERE status IN ('pending','open','engaged')`);
  } catch (err) {
    console.log('[db] idx_one_active_event skipped:', err.message);
  }

  // 迁移: characters 表新增 next_moment_at 列
  migrateMomentsSchema(db);

  // 迁移: moment_unread 计数 → 时序方案 (last_moments_seen_at)
  migrateMomentUnreadToTimestamp(db);

  // 迁移: 好感度系统 — user_relationships 和 emotion_snapshots 新增 affinity 列
  migrateAffinitySchema(db);

  // 迁移: characters 表新增 next_proactive_at 和 proactive_disabled 列（主动聊天）
  migrateProactiveSchema(db);

  // 迁移: emotion_snapshots 改为每 conversation 仅保留最新一条（UNIQUE 约束 + 清理历史）
  migrateEmotionSnapshotsUnique(db);

  // 迁移: 好感度回归系统 — user_relationships 加 last_interaction_at + gift_history 表
  migrateAffinityRegressionSchema(db);

  // 迁移: artist_favorites.artist 加 UNIQUE 约束（防止重复收藏）
  migrateArtistFavoritesUnique(db);

  // 迁移: characters 表新增 events_disabled 列（奇遇系统）
  migrateEventsSchema(db);

  // 迁移: 防打扰模式 — characters 表新增 dnd_original_state 列
  migrateDisturbSchema(db);

  // 迁移: 日程系统 — characters 表新增 schedule 相关列
  migrateScheduleSchema(db);

  // 迁移: moment_comments 新增 auto_trigger + thread_root_id（朋友圈关系网互动）
  migrateMomentAutoTrigger(db);

  // 系统设置迁移: 清理历史遗留键（idempotent，需在种子注入前执行）
  migrateSystemSettings(db);

  // 迁移: 绘图知识词库保留可直接注入的结构化 tag。
  migrateImagePromptKnowledgeSchema(db);

  // 迁移: PAI 风格聊天记忆单元、全文索引、提取 checkpoint 与索引任务
  migrateChatMemoryV2Schema(db);

  // 迁移: 叫醒系统 — characters 表新增 wake 相关列
  migrateWakeSchema(db);

  // 迁移: characters 表新增 lora 列
  migrateLoraSchema(db);

  // characters 表新增 loras JSON 列
  migrateLorasArraySchema(db);

  // characters 表新增角色单独画师串列
  migrateArtistOverrideSchema(db);

  // 迁移: 将 global_rules.world_setting 移至 world_settings 表（多套世界观）
  migrateWorldSettings(db);

  // 迁移: LLM 多配置切换（需在 seed 之后，确保 DB 已初始化）
  migrateLlmProfiles(db);

  // 迁移: 信箱系统
  migrateMailboxSchema(db);

  // 迁移: 手写字体 — characters 表新增 handwriting_font 列
  migrateHandwritingFont(db);

  // 迁移: 角色聊天背景 — characters 表新增 chat_bg_path 列
  migrateChatBgSchema(db);

  // 迁移: 奇遇强调降格 — character_events 表新增 emphasis_delivered 列
  migrateEventEmphasisSchema(db);

  // 迁移: 摘要 checkpoint 版本标记；旧摘要边界不可信，不能直接用于历史截断
  migrateRollingSummaryCheckpointSchema(db);

  // 迁移: 誓约系统 — user_relationships 表新增 is_oath 列
  migrateOathSchema(db);

  // 迁移: 交叉角色引用 — character_events 表新增 referenced_character_ids 列
  migrateEventCrossRef(db);

  // 迁移: 群聊系统 — raw_messages/messages 新增 speaker_character_id 列
  migrateGroupChatSchema(db);

  // 迁移: 移除 user_portraits 的 appearance 维度（用户外观由 config.user.appearance 自述，
  // 不再需要角色视角提取；幂等清理，每次启动执行。表的 CHECK 枚举保留 'appearance' 不重建表，无害）
  try {
    const r = db.prepare(`DELETE FROM user_portraits WHERE trait_type = 'appearance'`).run();
    if (r.changes > 0) console.log(`[db] migration: removed ${r.changes} appearance portrait row(s)`);
  } catch (err) {
    console.log('[db] appearance portrait cleanup skipped:', err.message);
  }

  // 迁移: 梦境系统已改为常驻逻辑（无开关），清理残留的 flag 设置行
  try {
    db.prepare(`DELETE FROM system_settings WHERE setting_key = 'feature_dreams'`).run();
  } catch (err) {
    console.log('[db] feature_dreams cleanup skipped:', err.message);
  }

  // 种子: 注入全部初始数据（仅首次运行生效）
  seedAll(db);

  // 种子: 奇遇事件类型库 + 朋友圈话题库（INSERT OR IGNORE，仅插入缺失的系统条目，不覆盖用户编辑）
  seedEventLibraries(db);

  // 图片提示词知识使用独立版本化种子；版本升级时只覆盖内置同 ID 条目，保留用户自建条目。
  seedImagePromptKnowledge(db);

  // 系统设置: 注入句柄并从 DB 加载覆盖 config 内存（DB 优先于代码默认值）
  initSettingsHandle(db);
  loadSystemSettings(db);
  initWorldRepository(db);

  // 重建 FTS5 索引
  rebuildFtsIndex(db);

  // 启动时 FTS 写入测试：部分损坏场景下 SELECT 能过但 INSERT 会炸，提前修复
  try {
    db.prepare(`INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', -1, 'fts_write_test')`).run();
  } catch (writeErr) {
    if (writeErr.code === 'SQLITE_CORRUPT_VTAB') {
      console.log('[db] FTS5 write-test failed at startup, force rebuilding...');
      // 用导出的 repairFtsIndex 不行（circular），直接内联重建
      db.exec(`DROP TRIGGER IF EXISTS messages_ai`);
      db.exec(`DROP TRIGGER IF EXISTS messages_ad`);
      db.exec(`DROP TRIGGER IF EXISTS messages_au`);
      db.exec(`DROP TABLE IF EXISTS messages_fts`);
      db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='id')`);
      db.exec(`CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content); END;`);
      db.exec(`CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content); END;`);
      db.exec(`CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content); INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content); END;`);
      // 全量重建索引
      const msgs = db.prepare(`SELECT id, content FROM messages`).all();
      const insert = db.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`);
      for (const m of msgs) insert.run(m.id, m.content);
      console.log(`[db] FTS5 startup force-rebuild: ${msgs.length} messages indexed`);
    } else {
      throw writeErr;
    }
  }
}

/**
 * 种子：奇遇事件类型库 + 朋友圈话题库
 * 仅插入缺失的系统条目（INSERT OR IGNORE），不覆盖用户对已有条目的编辑；
 * 软删除（is_active=0）的条目行仍存在，因此不会在下次启动时复活。
 */
function seedEventLibraries(db) {
  // 事件类型库
  const seedEventType = db.prepare(`
    INSERT OR IGNORE INTO event_types (key, name, duration_min, urgency, fun_from, desc, source, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 'default', 1)
  `);
  let eventCount = 0;
  for (const e of DEFAULT_EVENT_TYPES) {
    const result = seedEventType.run(
      e.key, e.name, e.durationMin ?? 20, e.urgency ?? 1,
      JSON.stringify(e.funFrom ?? []), e.desc ?? ''
    );
    if (result.changes > 0) eventCount++;
  }
  if (eventCount > 0) console.log(`[seed] event_types: ${eventCount} seeded`);

  // 朋友圈话题库
  const seedTopic = db.prepare(`
    INSERT OR IGNORE INTO moment_topics (name, desc, source, is_active)
    VALUES (?, ?, 'default', 1)
  `);
  let topicCount = 0;
  for (const t of DEFAULT_MOMENT_TOPICS) {
    const result = seedTopic.run(t.name, t.desc ?? '');
    if (result.changes > 0) topicCount++;
  }
  if (topicCount > 0) console.log(`[seed] moment_topics: ${topicCount} seeded`);
}

export function seedImagePromptKnowledge(db) {
  const currentVersion = db.prepare(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'image_prompt_knowledge_version'`
  ).pluck().get();
  if (currentVersion === IMAGE_PROMPT_KNOWLEDGE_VERSION) return;

  const upsert = db.prepare(`
    INSERT INTO image_prompt_knowledge (
      knowledge_id, category, title, search_terms, content, executable_tags, scenes,
      is_default, priority, version, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(knowledge_id) DO UPDATE SET
      category = excluded.category,
      title = excluded.title,
      search_terms = excluded.search_terms,
      content = excluded.content,
      executable_tags = excluded.executable_tags,
      scenes = excluded.scenes,
      is_default = excluded.is_default,
      priority = excluded.priority,
      version = excluded.version,
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP
  `);
  const seed = db.transaction(() => {
    for (const item of IMAGE_PROMPT_KNOWLEDGE) {
      upsert.run(
        item.knowledgeId,
        item.category,
        item.title,
        item.searchTerms,
        item.content,
        JSON.stringify(item.executableTags || []),
        JSON.stringify(item.scenes),
        item.isDefault ? 1 : 0,
        item.priority,
        IMAGE_PROMPT_KNOWLEDGE_VERSION,
      );
    }
    db.prepare(`
      UPDATE image_prompt_knowledge
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE knowledge_id LIKE 'ipk.lib.%' AND version <> ?
    `).run(IMAGE_PROMPT_KNOWLEDGE_VERSION);
    db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, updated_at)
      VALUES ('image_prompt_knowledge_version', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = CURRENT_TIMESTAMP
    `).run(IMAGE_PROMPT_KNOWLEDGE_VERSION);
  });
  seed();
  console.log(`[db] image prompt knowledge seeded: ${IMAGE_PROMPT_KNOWLEDGE.length} items, version=${IMAGE_PROMPT_KNOWLEDGE_VERSION}`);
}

/**
 * 迁移: emotion_snapshots 改为每 conversation 仅保留最新一条
 * - 清理历史数据（只保留每个 conversation_id 的 max(id)）
 * - 将 conversation_id 改为 UNIQUE 约束（如果尚未）
 */
function migrateEmotionSnapshotsUnique(db) {
  try {
    const tableInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'emotion_snapshots'`).get();
    if (!tableInfo) return; // 表不存在，CREATE TABLE 会建新的

    // 删除历史数据：每个 conversation_id 只保留最新一条
    const deleted = db.prepare(`
      DELETE FROM emotion_snapshots
      WHERE id NOT IN (SELECT MAX(id) FROM emotion_snapshots GROUP BY conversation_id)
    `).run();
    if (deleted.changes > 0) {
      console.log(`[db] emotion_snapshots cleaned: ${deleted.changes} old snapshots removed`);
    }

    // 如果 conversation_id 还没有 UNIQUE 约束，重建表
    if (!/UNIQUE/.test(tableInfo.sql)) {
      db.exec(`
        CREATE TABLE emotion_snapshots_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL UNIQUE,
          after_msg_id INTEGER REFERENCES messages(id),
          valence REAL NOT NULL DEFAULT 0.5,
          arousal REAL NOT NULL DEFAULT 0.5,
          dominance REAL NOT NULL DEFAULT 0.5,
          mood_valence REAL DEFAULT 0.5,
          mood_arousal REAL DEFAULT 0.5,
          mood_dominance REAL DEFAULT 0.5,
          dominant_emotion TEXT,
          affinity REAL,
          affinity_delta REAL,
          reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO emotion_snapshots_new SELECT * FROM emotion_snapshots;
        DROP TABLE emotion_snapshots;
        ALTER TABLE emotion_snapshots_new RENAME TO emotion_snapshots;
      `);
      console.log('[db] emotion_snapshots rebuilt with UNIQUE constraint');
    }
  } catch (err) {
    console.log('[db] migrateEmotionSnapshotsUnique error:', err.message);
  }
}

function migrateImagePromptKnowledgeSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(image_prompt_knowledge)`).all();
    if (!cols.some(column => column.name === 'executable_tags')) {
      db.exec(`ALTER TABLE image_prompt_knowledge ADD COLUMN executable_tags TEXT NOT NULL DEFAULT '[]'`);
      console.log('[db] Added image_prompt_knowledge.executable_tags column');
    }
  } catch (err) {
    console.log('[db] migrateImagePromptKnowledgeSchema error:', err.message);
  }
}

function migrateRollingSummaryCheckpointSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(rolling_summaries)`).all();
    if (!cols.some(c => c.name === 'checkpoint_version')) {
      // 旧算法的 end_msg_id 可能超过实际摘要范围；新增列时将历史记录标为 0。
      db.exec(`ALTER TABLE rolling_summaries ADD COLUMN checkpoint_version INTEGER NOT NULL DEFAULT 0`);
    }
  } catch (err) {
    console.log('[db] migrateRollingSummaryCheckpointSchema error:', err.message);
  }
}

function migrateMomentsSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'next_moment_at')) {
      db.exec(`ALTER TABLE characters ADD COLUMN next_moment_at DATETIME`);
      console.log('[db] Added characters.next_moment_at column');
    }
    if (!cols.find(c => c.name === 'moments_disabled')) {
      db.exec(`ALTER TABLE characters ADD COLUMN moments_disabled INTEGER DEFAULT 0`);
      console.log('[db] Added characters.moments_disabled column (default 0)');
    }
  } catch (err) {
    console.log('[db] migrateMomentsSchema error:', err.message);
  }
}

function migrateEventsSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'events_disabled')) {
      db.exec(`ALTER TABLE characters ADD COLUMN events_disabled INTEGER DEFAULT 0`);
      console.log('[db] Added characters.events_disabled column (default 0)');
    }

    // character_events 加 processing 列：标记分支生成进行中，防止切页后重复提交
    const ceCols = db.prepare(`PRAGMA table_info(character_events)`).all();
    if (!ceCols.find(c => c.name === 'processing')) {
      db.exec(`ALTER TABLE character_events ADD COLUMN processing INTEGER DEFAULT 0`);
      console.log('[db] Added character_events.processing column (default 0)');
    }
  } catch (err) {
    console.log('[db] migrateEventsSchema error:', err.message);
  }
}

/**
 * 迁移: 奇遇强调降格 — character_events 表新增 emphasis_delivered 列
 * 0 = 首轮强调尚未触发，1 = 已触发过首轮强调（后续降格为日程同级）
 */
function migrateEventEmphasisSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(character_events)`).all();
    if (!cols.find(c => c.name === 'emphasis_delivered')) {
      db.exec(`ALTER TABLE character_events ADD COLUMN emphasis_delivered INTEGER DEFAULT 0`);
      console.log('[db] Added character_events.emphasis_delivered column (default 0)');
    }
  } catch (err) {
    console.log('[db] migrateEventEmphasisSchema error:', err.message);
  }
}

/**
 * 迁移: 防打扰模式 — characters 表新增 dnd_original_state 列
 * 存储被 DND 覆盖前的原始状态 JSON: {"moments_disabled":0,"proactive_disabled":0,"events_disabled":0}
 * NULL 表示该角色当前未被 DND 覆盖
 */
function migrateDisturbSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'dnd_original_state')) {
      db.exec(`ALTER TABLE characters ADD COLUMN dnd_original_state TEXT`);
      console.log('[db] Added characters.dnd_original_state column');
    }
  } catch (err) {
    console.log('[db] migrateDisturbSchema error:', err.message);
  }
}

/**
 * 迁移: 日程系统 — characters 表新增 schedule 相关列
 */
function migrateScheduleSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'schedule_enabled')) {
      db.exec(`ALTER TABLE characters ADD COLUMN schedule_enabled INTEGER DEFAULT 1`);
      console.log('[db] Added characters.schedule_enabled column (default 1)');
    }
    if (!cols.find(c => c.name === 'is_sleeping')) {
      db.exec(`ALTER TABLE characters ADD COLUMN is_sleeping INTEGER DEFAULT 0`);
      console.log('[db] Added characters.is_sleeping column (default 0)');
    }
    if (!cols.find(c => c.name === 'sleep_until')) {
      db.exec(`ALTER TABLE characters ADD COLUMN sleep_until DATETIME`);
      console.log('[db] Added characters.sleep_until column');
    }
    if (!cols.find(c => c.name === 'next_schedule_refresh_at')) {
      db.exec(`ALTER TABLE characters ADD COLUMN next_schedule_refresh_at DATETIME`);
      console.log('[db] Added characters.next_schedule_refresh_at column');
    }
  } catch (err) {
    console.log('[db] migrateScheduleSchema error:', err.message);
  }
}

/**
 * 迁移: 叫醒系统 — characters 表新增 wake 相关列
 */
function migrateWakeSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'wake_attempts')) {
      db.exec(`ALTER TABLE characters ADD COLUMN wake_attempts INTEGER DEFAULT 0`);
      console.log('[db] Added characters.wake_attempts column (default 0)');
    }
    if (!cols.find(c => c.name === 'was_door_woken')) {
      db.exec(`ALTER TABLE characters ADD COLUMN was_door_woken INTEGER DEFAULT 0`);
      console.log('[db] Added characters.was_door_woken column (default 0)');
    }
    if (!cols.find(c => c.name === 'temporary_wake_until')) {
      db.exec(`ALTER TABLE characters ADD COLUMN temporary_wake_until DATETIME`);
      console.log('[db] Added characters.temporary_wake_until column');
    }
    if (!cols.find(c => c.name === 'wake_mode')) {
      db.exec(`ALTER TABLE characters ADD COLUMN wake_mode TEXT`);
      console.log('[db] Added characters.wake_mode column');
    }
  } catch (err) {
    console.log('[db] migrateWakeSchema error:', err.message);
  }
}

/**
 * 迁移: moment_comments 新增 auto_trigger + thread_root_id（朋友圈关系网互动）
 */
function migrateMomentAutoTrigger(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(moment_comments)`).all();
    if (!cols.find(c => c.name === 'auto_trigger')) {
      db.exec(`ALTER TABLE moment_comments ADD COLUMN auto_trigger INTEGER DEFAULT 0`);
      console.log('[db] Added moment_comments.auto_trigger column (default 0)');
    }
    if (!cols.find(c => c.name === 'thread_root_id')) {
      db.exec(`ALTER TABLE moment_comments ADD COLUMN thread_root_id INTEGER DEFAULT NULL`);
      console.log('[db] Added moment_comments.thread_root_id column (nullable)');
    }
  } catch (err) {
    console.log('[db] migrateMomentAutoTrigger error:', err.message);
  }
}

/**
 * 迁移: 好感度系统 — user_relationships 和 emotion_snapshots 新增 affinity 列
 */
function migrateAffinitySchema(db) {
  try {
    // user_relationships 表
    const urCols = db.prepare(`PRAGMA table_info(user_relationships)`).all();
    if (!urCols.find(c => c.name === 'affinity')) {
      db.exec(`ALTER TABLE user_relationships ADD COLUMN affinity REAL DEFAULT 50`);
      console.log('[db] Added user_relationships.affinity column (default 50)');
      // 已有关系的行设置为默认值 50
      db.prepare(`UPDATE user_relationships SET affinity = 50 WHERE affinity IS NULL`).run();
    }

    // emotion_snapshots 表
    const esCols = db.prepare(`PRAGMA table_info(emotion_snapshots)`).all();
    if (!esCols.find(c => c.name === 'affinity')) {
      db.exec(`ALTER TABLE emotion_snapshots ADD COLUMN affinity REAL`);
      console.log('[db] Added emotion_snapshots.affinity column');
    }
    if (!esCols.find(c => c.name === 'affinity_delta')) {
      db.exec(`ALTER TABLE emotion_snapshots ADD COLUMN affinity_delta REAL`);
      console.log('[db] Added emotion_snapshots.affinity_delta column');
    }
    if (!esCols.find(c => c.name === 'reason')) {
      db.exec(`ALTER TABLE emotion_snapshots ADD COLUMN reason TEXT`);
      console.log('[db] Added emotion_snapshots.reason column');
    }
  } catch (err) {
    console.log('[db] migrateAffinitySchema error:', err.message);
  }
}

/**
 * 迁移: characters 表新增 proactive 相关列
 * - next_proactive_at: 下次主动聊天时间
 * - proactive_disabled: 是否禁用主动聊天
 * - proactive_last_read_at: 用户最后一次查看该角色主动消息的时间（用于未读红点判断）
 */
function migrateProactiveSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'next_proactive_at')) {
      db.exec(`ALTER TABLE characters ADD COLUMN next_proactive_at DATETIME`);
      console.log('[db] Added characters.next_proactive_at column');
    }
    if (!cols.find(c => c.name === 'proactive_disabled')) {
      db.exec(`ALTER TABLE characters ADD COLUMN proactive_disabled INTEGER DEFAULT 0`);
      console.log('[db] Added characters.proactive_disabled column (default 0)');
    }
    if (!cols.find(c => c.name === 'proactive_last_read_at')) {
      db.exec(`ALTER TABLE characters ADD COLUMN proactive_last_read_at DATETIME`);
      console.log('[db] Added characters.proactive_last_read_at column');
    }
    if (!cols.find(c => c.name === 'proactive_streak')) {
      db.exec(`ALTER TABLE characters ADD COLUMN proactive_streak INTEGER DEFAULT 0`);
      console.log('[db] Added characters.proactive_streak column (default 0)');
    }

    // messages 表：is_proactive 标记主动聊天消息
    const msgCols = db.prepare(`PRAGMA table_info(messages)`).all();
    if (!msgCols.find(c => c.name === 'is_proactive')) {
      db.exec(`ALTER TABLE messages ADD COLUMN is_proactive INTEGER DEFAULT 0`);
      console.log('[db] Added messages.is_proactive column (default 0)');
    }
    // messages 表：event_id 关联奇遇事件（仅分句展示表，不污染 raw_messages）
    if (!msgCols.find(c => c.name === 'event_id')) {
      db.exec(`ALTER TABLE messages ADD COLUMN event_id INTEGER DEFAULT NULL`);
      console.log('[db] Added messages.event_id column (nullable, no FK)');
    }
  } catch (err) {
    console.log('[db] migrateProactiveSchema error:', err.message);
  }
}

/**
 * 迁移: 好感度回归系统
 * - user_relationships 表新增 last_interaction_at（记录最近一次互动时间）
 * - 新建 gift_history 表（送礼记录，含冷却检查）
 */
function migrateAffinityRegressionSchema(db) {
  try {
    // user_relationships 表
    const urCols = db.prepare(`PRAGMA table_info(user_relationships)`).all();
    if (!urCols.find(c => c.name === 'last_interaction_at')) {
      db.exec(`ALTER TABLE user_relationships ADD COLUMN last_interaction_at DATETIME`);
      console.log('[db] Added user_relationships.last_interaction_at column');
    }

    // gift_history 表：全局冷却（跟系统不跟角色），仅需 gift_type + created_at
    const ghCols = db.prepare(`PRAGMA table_info(gift_history)`).all();
    const hasCharId = ghCols.some(c => c.name === 'character_id');
    if (ghCols.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS gift_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          gift_type TEXT NOT NULL CHECK(gift_type IN ('small','large')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('[db] Created gift_history table (global cooldown)');
    } else if (hasCharId) {
      // 迁移：去掉 character_id，改为全局冷却，每种礼物只保留最新一条
      db.exec(`DROP TABLE IF EXISTS gift_history_new`);
      db.exec(`CREATE TABLE gift_history_new (id INTEGER PRIMARY KEY AUTOINCREMENT, gift_type TEXT NOT NULL CHECK(gift_type IN ('small','large')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.exec(`INSERT INTO gift_history_new (gift_type, created_at) SELECT gift_type, MAX(created_at) FROM gift_history GROUP BY gift_type`);
      db.exec(`DROP TABLE gift_history`);
      db.exec(`ALTER TABLE gift_history_new RENAME TO gift_history`);
      console.log('[db] gift_history migrated to global cooldown (removed character_id, deduplicated)');
    }

    // 启动时去重：每种礼物只保留最新一条
    for (const type of ['small', 'large']) {
      const rows = db.prepare(`SELECT id FROM gift_history WHERE gift_type = ? ORDER BY id DESC`).all(type);
      if (rows.length > 1) {
        const keepId = rows[0].id;
        db.prepare(`DELETE FROM gift_history WHERE gift_type = ? AND id != ?`).run(type, keepId);
        console.log(`[db] gift_history pruned ${rows.length - 1} old ${type} row(s), kept #${keepId}`);
      }
    }
  } catch (err) {
    console.log('[db] migrateAffinityRegressionSchema error:', err.message);
  }
}

/**
 * 迁移: artist_favorites.artist 加 UNIQUE 约束（防止重复收藏）
 */
function migrateArtistFavoritesUnique(db) {
  try {
    db.exec(`CREATE UNIQUE INDEX idx_artist_fav_artist ON artist_favorites(artist)`);
    console.log('[db] Added UNIQUE index on artist_favorites.artist');
  } catch (err) {
    // 索引已存在则忽略
    if (!err.message.includes('already exists')) {
      console.log('[db] migrateArtistFavoritesUnique error:', err.message);
    }
  }
}

/**
 * 迁移: moment_unread 计数 → 时序方案 (last_moments_seen_at)
 *
 * 旧方案：moment_unread 表中维护一个 count 整数，broadcastNewPost +1，markRead 清零。
 * 新方案：system_settings 中存 last_moments_seen_at 时间戳，
 *         未读数 = COUNT(*) FROM moment_posts WHERE created_at > last_moments_seen_at。
 *
 * 迁移时尽可能保留旧计数的语义：如果旧 count = N，则 last_moments_seen_at
 * 设为第 N 篇最旧未读帖子的 created_at（即从该帖之后开始算未读）。
 */
function migrateMomentUnreadToTimestamp(db) {
  try {
    // 检查旧表是否存在
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'moment_unread'`
    ).get();

    if (!tableExists) {
      // 全新安装：直接种子默认值（epoch，所有帖子都视为已读）
      seedLastMomentsSeenAt(db, new Date(0).toISOString());
      return;
    }

    // 读旧计数
    const oldRow = db.prepare(`SELECT count FROM moment_unread WHERE id = 1`).get();
    const oldCount = oldRow ? oldRow.count : 0;

    let lastSeenAt;
    if (oldCount > 0) {
      // 第 N 篇最旧未读帖子 = 按时间升序的第 oldCount 篇（跳过已读的）
      // OFFSET oldCount - 1：第 1 篇未读是最旧的未读帖
      const boundary = db.prepare(
        `SELECT created_at FROM moment_posts WHERE status = 'done' ORDER BY created_at DESC LIMIT 1 OFFSET ?`
      ).get(oldCount);

      if (boundary && boundary.created_at) {
        // last_moments_seen_at = 边界帖的 created_at（created_at > last_seen 会包含该帖及更新的）
        // 为了让 COUNT(*) WHERE created_at > last_seen 刚好 = oldCount，
        // 设 last_seen = 边界帖 created_at 的前一秒
        const boundaryDate = new Date(boundary.created_at.replace(' ', 'T') + 'Z');
        boundaryDate.setSeconds(boundaryDate.getSeconds() - 1);
        lastSeenAt = boundaryDate.toISOString();
      } else {
        // 没有帖子，置为当前时间
        lastSeenAt = new Date().toISOString();
      }
    } else {
      // count = 0：全部已读，设为当前时间
      lastSeenAt = new Date().toISOString();
    }

    seedLastMomentsSeenAt(db, lastSeenAt);
    console.log(`[db] migrateMomentUnreadToTimestamp: old count=${oldCount} → last_seen=${lastSeenAt}`);

    // 删除旧表
    db.exec(`DROP TABLE IF EXISTS moment_unread`);
    console.log('[db] Dropped legacy moment_unread table');
  } catch (err) {
    console.log('[db] migrateMomentUnreadToTimestamp error:', err.message);
  }
}

/** 种子 last_moments_seen_at（如已存在则保留现有值） */
function seedLastMomentsSeenAt(db, defaultValue) {
  db.prepare(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)`
  ).run('last_moments_seen_at', defaultValue);
}

function rebuildFtsIndex(db) {
  // ── 轻量完整性检查：不每次清空重建，只在确实损坏或计数不一致时才处理 ──
  let ftsOk = false;
  let ftsCount = 0;
  try {
    ftsCount = db.prepare(`SELECT count(*) AS c FROM messages_fts`).get().c;
    ftsOk = true;
  } catch (err) {
    if (err.code === 'SQLITE_CORRUPT_VTAB') {
      console.log('[db] FTS5 table corrupted, recreating...');
      // 先删触发器（它们依赖 messages_fts）
      db.exec(`DROP TRIGGER IF EXISTS messages_ai`);
      db.exec(`DROP TRIGGER IF EXISTS messages_ad`);
      db.exec(`DROP TRIGGER IF EXISTS messages_au`);
      // 删掉损坏的虚拟表
      db.exec(`DROP TABLE IF EXISTS messages_fts`);
      // 重建
      db.exec(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='id'
        );
      `);
      // 重建触发器
      db.exec(`
        CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `);
      db.exec(`
        CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
      `);
      db.exec(`
        CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
      `);
    } else {
      throw err;
    }
  }

  // 只在 FTS 损坏或计数不一致时才全量重建
  const msgCount = db.prepare(`SELECT count(*) AS c FROM messages`).get().c;
  if (!ftsOk || ftsCount !== msgCount) {
    if (ftsOk) {
      // 表完好但计数不一致 — 清空后重建
      try {
        db.exec(`DELETE FROM messages_fts`);
      } catch (delErr) {
        console.log('[db] DELETE FROM messages_fts failed, dropping and recreating...');
        db.exec(`DROP TABLE IF EXISTS messages_fts`);
        db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='id')`);
      }
    }
    const msgs = db.prepare(`SELECT id, content FROM messages`).all();
    if (msgs.length > 0) {
      const insert = db.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`);
      for (const m of msgs) {
        insert.run(m.id, m.content);
      }
      console.log(`[db] FTS5 index rebuilt: ${msgs.length} messages indexed`);
    }
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * 强制重建 FTS5 索引。当写入操作（DELETE/INSERT/UPDATE on messages）
 * 因 FTS 虚拟表损坏（SQLITE_CORRUPT_VTAB）而失败时，路由层可调用此函数
 * 完全重建 FTS 表结构和索引，之后重试原操作即可成功。
 */
export function repairFtsIndex() {
  const database = getDb();
  console.log('[db] repairFtsIndex: full FTS rebuild...');

  // 1. 删触发器（它们依赖 messages_fts）
  database.exec(`DROP TRIGGER IF EXISTS messages_ai`);
  database.exec(`DROP TRIGGER IF EXISTS messages_ad`);
  database.exec(`DROP TRIGGER IF EXISTS messages_au`);

  // 2. 删损坏的虚拟表
  database.exec(`DROP TABLE IF EXISTS messages_fts`);

  // 3. 重建 FTS 表结构
  database.exec(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='id'
    );
  `);

  // 4. 重建触发器
  database.exec(`
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
  database.exec(`
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
  `);
  database.exec(`
    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);

  // 5. 全量重建索引
  const msgs = database.prepare(`SELECT id, content FROM messages`).all();
  if (msgs.length > 0) {
    const insert = database.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`);
    for (const m of msgs) {
      insert.run(m.id, m.content);
    }
    console.log(`[db] repairFtsIndex: ${msgs.length} messages re-indexed`);
  }
  console.log('[db] repairFtsIndex: done');
}

// ── 世界观 / 全局规则仓储已下沉到 db/worldRepository.js（缩小本模块体积）──
// 函数由 worldRepository 提供，此处兼容再导出；db 句柄在 getDb() 打开时注入。
export {
  getActiveGlobalRules,
  getWorldSetting,
  getSystemRulesWithWorld,
  getGlobalRule,
  getSystemRules,
  listWorldSettings,
  getActiveWorldSetting,
  getWorldSettingById,
  createWorldSetting,
  updateWorldSetting,
  deleteWorldSetting,
  activateWorldSetting,
} from './worldRepository.js';

// ── 系统设置已下沉到 db/settings.js（打破 config↔db 循环依赖）──
// getSetting/setSetting/SETTING_TO_CONFIG/loadSystemSettings 均由 settings.js 提供，
// 此处仅做兼容再导出，既有 import 路径不受影响。
export { getSetting, setSetting, SETTING_TO_CONFIG } from './settings.js';

/**
 * 迁移: characters 表新增 lora 列（仅保留 custom_workflow 和 loras）
 */
function migrateLoraSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'custom_workflow')) {
      db.exec(`ALTER TABLE characters ADD COLUMN custom_workflow TEXT`);
      console.log('[db] Added characters.custom_workflow column');
    }
  } catch (err) {
    console.log('[db] migrateLoraSchema error:', err.message);
  }
}

/**
 * characters 表 loras JSON 列
 * 格式: [{"path":"xxx.safetensors","weight":1,"triggerWord":"xxx"}]
 */
function migrateLorasArraySchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'loras')) {
      db.exec(`ALTER TABLE characters ADD COLUMN loras TEXT DEFAULT '[]'`);
      console.log('[db] Added characters.loras column (JSON array, default [])');
    }
  } catch (err) {
    console.log('[db] migrateLorasArraySchema error:', err.message);
  }
}

/**
 * characters 表 artist_override 列（角色单独画师串，非空时覆盖系统画师串）
 */
function migrateArtistOverrideSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'artist_override')) {
      db.exec(`ALTER TABLE characters ADD COLUMN artist_override TEXT`);
      console.log('[db] Added characters.artist_override column');
    }
  } catch (err) {
    console.log('[db] migrateArtistOverrideSchema error:', err.message);
  }
}

// 迁移: LLM 多套配置切换 — 从当前 .env 生成默认 profile
function migrateLlmProfiles(db) {
  try {
    const existing = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'llm_profiles'`).get();
    if (existing) return;

    const now = new Date().toISOString();
    const defaultProfile = {
      id: 'p_' + Date.now(),
      name: '默认配置',
      apiKey: config.llm.apiKey || '',
      baseURL: config.llm.baseURL || 'https://api.deepseek.com',
      model: config.llm.model || 'deepseek-v4-flash',
      headers: config.llm.headers || {},
      extraBody: config.llm.extraBody || {},
      serializeBackgroundLLM: config.features.serializeBackgroundLLM || false,
      mergeMessages: config.features.mergeMessages || false,
      backgroundConcurrency: config.features.backgroundLLMMaxConcurrency || 3,
      createdAt: now,
    };

    const profiles = [defaultProfile];
    db.prepare(`INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
      .run('llm_profiles', JSON.stringify(profiles));
    db.prepare(`INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
      .run('active_llm_profile_id', defaultProfile.id);
    console.log('[db] migrateLlmProfiles: created default profile from current config');
  } catch (err) {
    console.log('[db] migrateLlmProfiles error:', err.message);
  }
}

// 迁移: 将 global_rules.world_setting 移至 world_settings 表（idempotent）
function migrateWorldSettings(db) {
  try {
    const existing = db.prepare(`SELECT rule_content FROM global_rules WHERE rule_key = 'world_setting'`).get();
    if (!existing) return;

    const raw = existing.rule_content || '';
    const match = raw.match(/^<world_setting>\s*([\s\S]*?)\s*<\/world_setting>$/);
    const content = match ? match[1] : raw;

    const already = db.prepare(`SELECT id FROM world_settings`).get();
    if (content.trim() && !already) {
      db.prepare(
        `INSERT INTO world_settings (name, content, is_active, sort_order) VALUES (?, ?, 1, 0)`
      ).run('默认世界观', content);
      console.log('[db] migrateWorldSettings: moved existing world_setting to world_settings table');
    }

    // 迁移后删除旧行：残留会导致 getWorldSetting 回退时读到过期世界观
    db.prepare(`DELETE FROM global_rules WHERE rule_key = 'world_setting'`).run();
    console.log('[db] migrateWorldSettings: removed legacy global_rules.world_setting row');
  } catch (err) {
    console.log('[db] migrateWorldSettings error:', err.message);
  }
}

// 迁移: 信箱系统 — mailbox_letters 表（由 CREATE TABLE IF NOT EXISTS 保证，仅新增索引）
function migrateMailboxSchema(db) {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mailbox_character_id ON mailbox_letters(character_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mailbox_status ON mailbox_letters(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mailbox_reply_at ON mailbox_letters(reply_at)`);
    console.log('[db] mailbox indexes ensured');
  } catch (err) {
    console.log('[db] migrateMailboxSchema error:', err.message);
  }
}

/**
 * 迁移: 手写字体 — characters 表新增 handwriting_font 列
 */
function migrateHandwritingFont(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'handwriting_font')) {
      db.exec(`ALTER TABLE characters ADD COLUMN handwriting_font TEXT DEFAULT ''`);
      console.log('[db] Added characters.handwriting_font column');
    }
  } catch (err) {
    console.log('[db] migrateHandwritingFont error:', err.message);
  }
}

/**
 * 迁移: 角色聊天背景 — characters 表新增 chat_bg_path 列
 */
function migrateChatBgSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(characters)`).all();
    if (!cols.find(c => c.name === 'chat_bg_path')) {
      db.exec(`ALTER TABLE characters ADD COLUMN chat_bg_path TEXT`);
      console.log('[db] Added characters.chat_bg_path column');
    }
  } catch (err) {
    console.log('[db] migrateChatBgSchema error:', err.message);
  }
}


function migrateOathSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(user_relationships)`).all();
    if (!cols.find(c => c.name === 'is_oath')) {
      db.exec(`ALTER TABLE user_relationships ADD COLUMN is_oath INTEGER DEFAULT 0`);
      console.log('[db] Added user_relationships.is_oath column (default 0)');
    }
  } catch (err) {
    console.log('[db] migrateOathSchema error:', err.message);
  }
}

/**
 * 迁移: 群聊系统 — raw_messages/messages 新增 speaker_character_id 列
 * NULL = 用户消息或 1 对 1 旧数据；群聊中角色消息填角色 id
 */
function migrateGroupChatSchema(db) {
  try {
    const rawCols = db.prepare(`PRAGMA table_info(raw_messages)`).all();
    if (!rawCols.find(c => c.name === 'speaker_character_id')) {
      db.exec(`ALTER TABLE raw_messages ADD COLUMN speaker_character_id INTEGER DEFAULT NULL`);
      console.log('[db] Added raw_messages.speaker_character_id column');
    }
    const msgCols = db.prepare(`PRAGMA table_info(messages)`).all();
    if (!msgCols.find(c => c.name === 'speaker_character_id')) {
      db.exec(`ALTER TABLE messages ADD COLUMN speaker_character_id INTEGER DEFAULT NULL`);
      console.log('[db] Added messages.speaker_character_id column');
    }

    const fragmentCols = db.prepare(`PRAGMA table_info(memory_fragments)`).all();
    if (!fragmentCols.find(c => c.name === 'source_raw_start_id')) {
      db.exec(`ALTER TABLE memory_fragments ADD COLUMN source_raw_start_id INTEGER DEFAULT NULL`);
      console.log('[db] Added memory_fragments.source_raw_start_id column');
    }
    if (!fragmentCols.find(c => c.name === 'source_raw_end_id')) {
      db.exec(`ALTER TABLE memory_fragments ADD COLUMN source_raw_end_id INTEGER DEFAULT NULL`);
      console.log('[db] Added memory_fragments.source_raw_end_id column');
    }

    const imageTaskCols = db.prepare(`PRAGMA table_info(image_tasks)`).all();
    if (!imageTaskCols.find(c => c.name === 'source_msg_id')) {
      db.exec(`ALTER TABLE image_tasks ADD COLUMN source_msg_id INTEGER DEFAULT NULL`);
      console.log('[db] Added image_tasks.source_msg_id column');
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_image_tasks_source_msg ON image_tasks(source_msg_id)`);

    const groupCols = db.prepare(`PRAGMA table_info(group_chats)`).all();
    if (!groupCols.find(c => c.name === 'rag_last_extracted_raw_id')) {
      db.exec(`ALTER TABLE group_chats ADD COLUMN rag_last_extracted_raw_id INTEGER DEFAULT 0`);
      console.log('[db] Added group_chats.rag_last_extracted_raw_id column');
    }
    if (!groupCols.find(c => c.name === 'rag_user_rounds_pending')) {
      db.exec(`ALTER TABLE group_chats ADD COLUMN rag_user_rounds_pending INTEGER DEFAULT 0`);
      console.log('[db] Added group_chats.rag_user_rounds_pending column');
    }
    // 每群每日后台闲聊预算（默认 2），独立计数；用户发言或跨天重置
    if (!groupCols.find(c => c.name === 'idle_budget')) {
      db.exec(`ALTER TABLE group_chats ADD COLUMN idle_budget INTEGER DEFAULT 2`);
      console.log('[db] Added group_chats.idle_budget column (default 2)');
    }
    db.exec(`UPDATE group_chats SET idle_budget = 2 WHERE idle_budget IS NULL OR idle_budget <= 0`);

    // main v2.4 beta 曾将群聊提取边界保存在 group_chats；升级后只回填到 v2 checkpoint。
    // 同时兼容更早仅通过 source_msg_id 关联 raw 的记忆，且绝不回退已有 checkpoint。
    db.exec(`
      INSERT INTO memory_extraction_checkpoints(conversation_id, last_raw_msg_id, status, last_error, updated_at)
      SELECT
        'group_' || gc.id,
        MAX(
          COALESCE(gc.rag_last_extracted_raw_id, 0),
          COALESCE((
            SELECT MAX(COALESCE(mf.source_raw_end_id, msg.raw_id, 0))
            FROM memory_fragments mf
            LEFT JOIN messages msg ON msg.id = mf.source_msg_id
            WHERE mf.conversation_id = 'group_' || gc.id
          ), 0)
        ),
        'idle',
        NULL,
        CURRENT_TIMESTAMP
      FROM group_chats gc
      WHERE 1 = 1
      ON CONFLICT(conversation_id) DO UPDATE SET
        last_raw_msg_id = MAX(memory_extraction_checkpoints.last_raw_msg_id, excluded.last_raw_msg_id),
        updated_at = CASE
          WHEN excluded.last_raw_msg_id > memory_extraction_checkpoints.last_raw_msg_id THEN CURRENT_TIMESTAMP
          ELSE memory_extraction_checkpoints.updated_at
        END
    `);
  } catch (err) {
    console.log('[db] migrateGroupChatSchema error:', err.message);
  }
}

function migrateEventCrossRef(db) {
  try {
    let ceCols = db.prepare(`PRAGMA table_info(character_events)`).all();
    if (!ceCols.find(c => c.name === 'referenced_character_ids')) {
      db.exec(`ALTER TABLE character_events ADD COLUMN referenced_character_ids TEXT DEFAULT '[]'`);
      console.log('[db] Added character_events.referenced_character_ids column');
    }
    let ehCols = db.prepare(`PRAGMA table_info(event_history)`).all();
    if (!ehCols.find(c => c.name === 'referenced_character_ids')) {
      db.exec(`ALTER TABLE event_history ADD COLUMN referenced_character_ids TEXT DEFAULT '[]'`);
      console.log('[db] Added event_history.referenced_character_ids column');
    }
  } catch (err) {
    console.log('[db] migrateEventCrossRef error:', err.message);
  }
}

// ── 世界观收藏 CRUD 已下沉到 db/worldRepository.js ──

// 迁移: PAI 风格聊天记忆 v2。保留旧字段供现有管理界面兼容，新增字段作为权威语义。
function migrateChatMemoryV2Schema(db) {
  try {
    const columns = new Set(db.prepare(`PRAGMA table_info(memory_fragments)`).all().map(c => c.name));
    const additions = [
      ['memory_id', 'TEXT'],
      ['memory_type', "TEXT NOT NULL DEFAULT 'knowledge'"],
      ['subject', "TEXT NOT NULL DEFAULT 'user'"],
      ['judgment', "TEXT NOT NULL DEFAULT ''"],
      ['reasoning', "TEXT NOT NULL DEFAULT ''"],
      ['tags', "TEXT NOT NULL DEFAULT '[]'"],
      ['content_hash', 'TEXT'],
      ['status', "TEXT NOT NULL DEFAULT 'active'"],
      ['source_raw_start_id', 'INTEGER'],
      ['source_raw_end_id', 'INTEGER'],
      ['embedding_profile', 'TEXT'],
      ['embedding_state', "TEXT NOT NULL DEFAULT 'disabled'"],
      ['embedding_error', 'TEXT'],
      ['updated_at', 'DATETIME'],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) db.exec(`ALTER TABLE memory_fragments ADD COLUMN ${name} ${definition}`);
    }

    db.exec(`
      UPDATE memory_fragments
      SET memory_id = COALESCE(memory_id, 'legacy_' || id),
          memory_type = CASE fragment_type WHEN 'emotion' THEN 'emotion' ELSE 'knowledge' END,
          judgment = CASE WHEN judgment = '' THEN content ELSE judgment END,
          tags = CASE WHEN tags = '[]' THEN COALESCE(entities, '[]') ELSE tags END,
          status = COALESCE(status, 'active'),
          updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
      WHERE memory_id IS NULL OR judgment = '' OR updated_at IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_fragments_memory_id ON memory_fragments(memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_fragments_active_conv ON memory_fragments(conversation_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_fragments_source_raw ON memory_fragments(conversation_id, source_raw_start_id, source_raw_end_id);

      CREATE TABLE IF NOT EXISTS memory_extraction_checkpoints (
        conversation_id TEXT PRIMARY KEY,
        last_raw_msg_id INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memory_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_memory_id TEXT NOT NULL,
        to_memory_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('update','merge','rollback')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memory_index_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        memory_id TEXT,
        profile TEXT,
        priority INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memory_retrieval_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        query TEXT NOT NULL,
        mode TEXT NOT NULL,
        candidate_sources TEXT NOT NULL DEFAULT '{}',
        memory_ids TEXT NOT NULL DEFAULT '[]',
        fallback_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fragments_fts USING fts5(
        judgment, reasoning, tags,
        content='memory_fragments', content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS memory_fragments_fts_ai AFTER INSERT ON memory_fragments BEGIN
        INSERT INTO memory_fragments_fts(rowid, judgment, reasoning, tags)
        VALUES (new.id, new.judgment, new.reasoning, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_fragments_fts_ad AFTER DELETE ON memory_fragments BEGIN
        INSERT INTO memory_fragments_fts(memory_fragments_fts, rowid, judgment, reasoning, tags)
        VALUES ('delete', old.id, old.judgment, old.reasoning, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_fragments_fts_au AFTER UPDATE OF judgment, reasoning, tags ON memory_fragments BEGIN
        INSERT INTO memory_fragments_fts(memory_fragments_fts, rowid, judgment, reasoning, tags)
        VALUES ('delete', old.id, old.judgment, old.reasoning, old.tags);
        INSERT INTO memory_fragments_fts(rowid, judgment, reasoning, tags)
        VALUES (new.id, new.judgment, new.reasoning, new.tags);
      END;
    `);
    const indexJobColumns = new Set(db.prepare(`PRAGMA table_info(memory_index_jobs)`).all().map(c => c.name));
    if (!indexJobColumns.has('priority')) {
      db.exec(`ALTER TABLE memory_index_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 10`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_index_jobs_queue ON memory_index_jobs(status, priority, id)`);
    const ftsCount = db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments_fts`).get().count;
    const memoryCount = db.prepare(`SELECT COUNT(*) AS count FROM memory_fragments`).get().count;
    if (ftsCount !== memoryCount) {
      db.prepare(`INSERT INTO memory_fragments_fts(memory_fragments_fts) VALUES ('rebuild')`).run();
    }
    db.prepare(`
      INSERT OR IGNORE INTO system_settings(setting_key, setting_value, updated_at)
      VALUES ('memory_settings', ?, CURRENT_TIMESTAMP)
    `).run(JSON.stringify({
      enabled: true,
      topK: 7,
      textCandidates: 24,
      vectorCandidates: 24,
      embedding: { enabled: false, provider: 'custom', baseURL: '', apiKey: '', model: '', dimensions: null, headers: {}, timeoutMs: 8000 },
      reranker: { enabled: false, provider: 'custom', baseURL: '', apiKey: '', model: '', topN: 7, headers: {}, timeoutMs: 8000 },
    }));
  } catch (err) {
    console.error('[db] migrateChatMemoryV2Schema error:', err.message);
    throw err;
  }
}

// 清理历史遗留的 system_settings 键（idempotent）
function migrateSystemSettings(db) {
  // 合并 feature_memoryExtract → feature_memory（v2 迁移）
  const oldExtract = db.prepare(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'feature_memoryExtract'`
  ).get();
  if (oldExtract) {
    if (oldExtract.setting_value === 'true') {
      db.prepare(
        `INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES ('feature_memory', 'true', CURRENT_TIMESTAMP)`
      ).run();
      console.log('[db] migration: merged feature_memoryExtract=true → feature_memory=true');
    }
    db.prepare(`DELETE FROM system_settings WHERE setting_key = 'feature_memoryExtract'`).run();
    console.log('[db] migration: removed orphaned feature_memoryExtract row');
  }

  // 清理旧的 snake_case 键（v1 迁移）
  const OLD_SNAKE_CASE_KEYS = [
    'feature_memory_extract', 'feature_auto_image_judge', 'feature_prompt_optimize',
    'feature_reply_guesses', 'feature_force_image_gen',
  ];
  const cleaned = db.prepare(
    `DELETE FROM system_settings WHERE setting_key IN (${OLD_SNAKE_CASE_KEYS.map(() => '?').join(',')})`
  ).run(...OLD_SNAKE_CASE_KEYS);
  if (cleaned.changes > 0) {
    console.log(`[db] system_settings: cleaned ${cleaned.changes} legacy snake_case key(s)`);
  }
}

// loadSystemSettings 已移至 db/settings.js（config 作为参数传入，避免反向依赖 config 之外的耦合）

