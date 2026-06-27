import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { seedAll } from './seedData.js';

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

    -- 记忆碎片表（事实/偏好/情绪）
    CREATE TABLE IF NOT EXISTS memory_fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      source_msg_id INTEGER REFERENCES messages(id),
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
      choice_c_label TEXT NOT NULL DEFAULT '自由发挥',
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
  `);

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

    CREATE INDEX IF NOT EXISTS idx_image_tasks_conv ON image_tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status);
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

  // 系统设置迁移: 清理历史遗留键（idempotent，需在种子注入前执行）
  migrateSystemSettings(db);

  // 种子: 注入全部初始数据（仅首次运行生效）
  seedAll(db);

  // 系统设置: 从 DB 加载覆盖 config 内存（DB 优先于代码默认值）
  loadSystemSettings(db);

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
  } catch (err) {
    console.log('[db] migrateEventsSchema error:', err.message);
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

/**
 * 获取所有激活的全局规则内容（拼接为一个字符串）
 */
// judge_prompt / image_prompt / image_intent 是元规则（非 LLM system prompt 内容），不拼入
// world_setting 单独追加到末尾，也不在批量拼接中
const META_RULE_KEYS = ['image_intent', 'judge_prompt', 'image_prompt'];

export function getActiveGlobalRules() {
  const database = getDb();
  const excludeKeys = [...META_RULE_KEYS, 'world_setting'];
  const rules = database.prepare(
    `SELECT rule_content FROM global_rules WHERE is_active = 1 AND rule_key NOT IN (${excludeKeys.map(() => '?').join(',')})`
  ).all(...excludeKeys);
  return rules.map(r => r.rule_content).join('\n\n');
}

/** 获取世界观（独立消息注入，不拼入全局规则） */
export function getWorldSetting() {
  const world = getGlobalRule('world_setting');
  if (world?.rule_content && world.is_active) {
    return world.rule_content;
  }
  return null;
}

/** getSystemRules() + 世界观拼接，供需要世界设定的调用方使用 */
export function getSystemRulesWithWorld(opts = {}) {
  const rules = getSystemRules(opts);
  const world = getWorldSetting();
  return [rules, world].filter(Boolean).join('\n\n');
}

/** 获取单条全局规则（用于元规则如 judge_prompt） */
export function getGlobalRule(key) {
  const database = getDb();
  return database.prepare(`SELECT * FROM global_rules WHERE rule_key = ?`).get(key);
}

/**
 * 获取系统规则（破限词：system_context + core_rules），统一各场景的 jailbreak。
 *
 * @param {object} [options]
 * @param {boolean} [options.roleplay=true] - 是否包含 `<roleplay>` 内的角色扮演激活指令。
 *   为 false 时仅返回基础上下文（虚构文学定位、创作自由），适用于无需角色扮演的流程。
 */
export function getSystemRules({ roleplay = true } = {}) {
  const rule = getGlobalRule('system_rules');

  // 基础内容
  let base = '';
  if (rule?.rule_content) {
    const content = rule.rule_content;
    const rpMatch = content.match(/<roleplay>([\s\S]*?)<\/roleplay>/);
    if (!rpMatch) {
      base = content;  // 无标签（旧数据），向下兼容
    } else {
      const before = content.slice(0, rpMatch.index).trim();
      // 基础上下文始终保留，roleplay 指令按需包含
      base = roleplay ? before + '\n\n' + rpMatch[1].trim() : before;
    }
  }

  return base;
}

// ── 系统设置（替代 .env 中的画师串/分辨率/功能开关） ──

/** 按 key 读取系统设置 */
export function getSetting(key) {
  const database = getDb();
  return database.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = ?`).pluck().get(key) ?? null;
}

/** 写入单条系统设置 */
export function setSetting(key, value) {
  const database = getDb();
  database.prepare(`INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
    .run(key, String(value));
}

// 需要从 DB 迁移到 config 的字段映射
const SETTING_TO_CONFIG = {
  comfy_artist:            { obj: 'comfyui',   key: 'artist',          type: 'string'  },
  comfy_width:             { obj: 'comfyui',   key: 'width',           type: 'int'     },
  comfy_height:            { obj: 'comfyui',   key: 'height',          type: 'int'     },
  comfy_moments_artist:    { obj: 'comfyui',   key: 'momentsArtist',   type: 'string'  },
  comfy_moments_width:     { obj: 'comfyui',   key: 'momentsWidth',    type: 'int'     },
  comfy_moments_height:    { obj: 'comfyui',   key: 'momentsHeight',   type: 'int'     },
  feature_emotion:               { obj: 'features', key: 'emotion',          type: 'bool' },
  feature_memory:                { obj: 'features', key: 'memory',           type: 'bool' },
  feature_promptOptimize:       { obj: 'features', key: 'promptOptimize',    type: 'bool' },
  feature_replyGuesses:          { obj: 'features', key: 'replyGuesses',     type: 'bool' },
  feature_forceImageGen:               { obj: 'features', key: 'forceImageGen',            type: 'bool' },
  feature_realtimeAffinityDisplay: { obj: 'features', key: 'realtimeAffinityDisplay', type: 'bool' },
  feature_forceImageGen:        { obj: 'features', key: 'forceImageGen',    type: 'bool' },
  feature_realtimeAffinityDisplay: { obj: 'features', key: 'realtimeAffinityDisplay', type: 'bool' },
  feature_proactiveChat:             { obj: 'features', key: 'proactiveChat',          type: 'bool' },
  feature_proactiveChatFreq:         { obj: 'features', key: 'proactiveChatFreq',     type: 'float' },
  feature_events:                    { obj: 'features', key: 'events',               type: 'bool' },
  user_nickname:                   { obj: 'user',     key: 'nickname',          type: 'string' },
  user_gender:                     { obj: 'user',     key: 'gender',            type: 'string' },
  user_appearance:                 { obj: 'user',     key: 'appearance',        type: 'string' },
  user_persona:                    { obj: 'user',     key: 'persona',           type: 'string' },
};

function castValue(raw, type) {
  if (raw == null) return undefined;
  switch (type) {
    case 'int':  { const v = parseInt(raw, 10); return Number.isNaN(v) ? undefined : v; }
    case 'float': { const v = parseFloat(raw); return Number.isNaN(v) ? undefined : v; }
    case 'bool': return raw === 'true' || raw === '1';
    default:     return raw;
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

// 从 DB 读取 system_settings 覆盖 config 内存（DB 优先于代码默认值）
function loadSystemSettings(db) {
  const rows = db.prepare(`SELECT setting_key, setting_value FROM system_settings`).all();
  let applied = 0;
  for (const row of rows) {
    const mapping = SETTING_TO_CONFIG[row.setting_key];
    if (!mapping) continue;
    const value = castValue(row.setting_value, mapping.type);
    if (value !== undefined) {
      config[mapping.obj][mapping.key] = value;
      applied++;
    }
  }
  if (applied > 0) {
    console.log(`[db] system_settings: ${applied} keys applied to config`);
  }
}
