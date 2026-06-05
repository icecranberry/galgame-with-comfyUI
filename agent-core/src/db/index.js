import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

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
    -- 原始消息表（底片，不做物理删除）
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
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

    -- 情绪快照表
    CREATE TABLE IF NOT EXISTS emotion_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      after_msg_id INTEGER REFERENCES messages(id),
      valence REAL NOT NULL DEFAULT 0.5,
      arousal REAL NOT NULL DEFAULT 0.5,
      dominance REAL NOT NULL DEFAULT 0.5,
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

    -- 角色配置表
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      base_prompt TEXT NOT NULL,
      emotion_baseline TEXT NOT NULL DEFAULT '{"valence":0.5,"arousal":0.5,"dominance":0.5}',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_fragments_conv ON memory_fragments(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_fragments_type ON memory_fragments(fragment_type);
    CREATE INDEX IF NOT EXISTS idx_summaries_conv ON rolling_summaries(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_emotion_conv ON emotion_snapshots(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_image_tasks_conv ON image_tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status);
  `);

  // 迁移: 添加 mood_valence/mood_arousal/mood_dominance 列
  migrateEmotionTable(db);

  // 迁移: 更新旧角色 prompt 为新标签格式
  migrateCharacterPrompts(db);

  // 重建 FTS5 索引
  rebuildFtsIndex(db);
}

function migrateCharacterPrompts(db) {
  // 将旧 <generate> 标签格式的角色 prompt 更新为新格式
  const rows = db.prepare(`SELECT id, base_prompt FROM characters WHERE base_prompt LIKE '%<generate>%'`).all();
  if (rows.length > 0) {
    const newPrompt = `你是一个创意图像生成助手。用户会和你聊天，描述他们想生成的图像。
你可以帮助优化图像描述，使其更适合 AI 图像生成。
请用中文回复，语气友好而专业。

当用户想要生成图片时，你的回复必须包含两个标签：

<prompt>
描述需要画的内容，用中文。需要详细：
- IP 角色注明 角色名（作品名），如"芙宁娜（原神）"
- 描述场景在哪、镜头角度、角色表情、衣服、动作
- 多角色时区分：什么发色的谁在做什么动作
- 不要用英文，用中文描述
</prompt>

<context>
假设图片已经生成好了，你带着这张图跟用户说话。
不要描述图片内容！基于内容做自然的联想和互动。
例如："看，我就说有这件事吧"、"怎么样，很可爱吧~"、"喏，给你"
</context>

注意：<context>里的文字会显示给用户，<prompt>里的用于生成图片。两个标签缺一不可。`;
    for (const row of rows) {
      db.prepare(`UPDATE characters SET base_prompt = ? WHERE id = ?`).run(newPrompt, row.id);
    }
    console.log(`[db] migration: updated ${rows.length} character prompts to new tag format`);
  }
}

function migrateEmotionTable(db) {
  const cols = db.prepare(`PRAGMA table_info('emotion_snapshots')`).all().map(c => c.name);
  if (!cols.includes('mood_valence')) {
    db.exec(`ALTER TABLE emotion_snapshots ADD COLUMN mood_valence REAL DEFAULT 0.5`);
    console.log('[db] migration: added mood_valence to emotion_snapshots');
  }
  if (!cols.includes('mood_arousal')) {
    db.exec(`ALTER TABLE emotion_snapshots ADD COLUMN mood_arousal REAL DEFAULT 0.5`);
    console.log('[db] migration: added mood_arousal to emotion_snapshots');
  }
  if (!cols.includes('mood_dominance')) {
    db.exec(`ALTER TABLE emotion_snapshots ADD COLUMN mood_dominance REAL DEFAULT 0.5`);
    console.log('[db] migration: added mood_dominance to emotion_snapshots');
  }
}

function rebuildFtsIndex(db) {
  // 清空并重建 FTS5 索引
  db.exec(`DELETE FROM messages_fts`);
  const msgs = db.prepare(`SELECT id, content FROM messages WHERE is_deleted = 0`).all();
  if (msgs.length > 0) {
    const insert = db.prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`);
    for (const m of msgs) {
      insert.run(m.id, m.content);
    }
    console.log(`[db] FTS5 index rebuilt: ${msgs.length} messages indexed`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
