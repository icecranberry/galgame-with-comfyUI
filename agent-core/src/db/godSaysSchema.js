// 神说拥有独立的系统角色和会话，绝不进入普通角色的随机社交候选池。
export function migrateGodSaysSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS god_angel (
      id INTEGER PRIMARY KEY CHECK(id = 1), display_name TEXT NOT NULL,
      persona TEXT NOT NULL, schedule_json TEXT NOT NULL DEFAULT '[]',
      schedule_generated_at TEXT, schedule_error TEXT
    );
    CREATE TABLE IF NOT EXISTS god_sessions (
      id INTEGER PRIMARY KEY, day TEXT NOT NULL, time_zone TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open', summary TEXT NOT NULL DEFAULT '',
      memories_json TEXT NOT NULL DEFAULT '[]', summary_status TEXT NOT NULL DEFAULT 'pending',
      summary_error TEXT, summary_attempt_at TEXT, summary_attempts INTEGER NOT NULL DEFAULT 0,
      context_summary TEXT NOT NULL DEFAULT '', context_last_message INTEGER NOT NULL DEFAULT 0,
      schedule_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
      UNIQUE(day, seq)
    );
    CREATE TABLE IF NOT EXISTS god_runs (
      id TEXT PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES god_sessions(id),
      client_id TEXT NOT NULL UNIQUE, input TEXT NOT NULL, images_json TEXT, status TEXT NOT NULL DEFAULT 'running',
      error TEXT, created_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS god_one_running_session ON god_runs(session_id) WHERE status = 'running';
    CREATE TABLE IF NOT EXISTS god_messages (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES god_sessions(id),
      run_id TEXT NOT NULL REFERENCES god_runs(id), role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', reasoning TEXT NOT NULL DEFAULT '',
      tool_calls TEXT, tool_call_id TEXT, provider_json TEXT,
      status TEXT NOT NULL DEFAULT 'done', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS god_messages_session ON god_messages(session_id, id);
    CREATE TABLE IF NOT EXISTS god_tool_calls (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES god_runs(id),
      effect_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, args_json TEXT NOT NULL,
      status TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS god_run_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES god_runs(id),
      type TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS god_run_events_run ON god_run_events(run_id, seq);
    CREATE TABLE IF NOT EXISTS god_world_events (
      id INTEGER PRIMARY KEY, effect_key TEXT NOT NULL UNIQUE, run_id TEXT REFERENCES god_runs(id),
      title TEXT NOT NULL, fact TEXT NOT NULL, character_ids TEXT, kind TEXT NOT NULL DEFAULT 'world',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, supersedes_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS god_world_deliveries (
      id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES god_world_events(id),
      kind TEXT NOT NULL, target_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, result_json TEXT, error TEXT,
      next_attempt_at TEXT NOT NULL, UNIQUE(event_id, kind, target_id)
    );
    CREATE TABLE IF NOT EXISTS god_angel_image_jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
      request_json TEXT NOT NULL, result_json TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS god_angel_one_image_kind ON god_angel_image_jobs(kind) WHERE status='running';
  `);
  // CREATE IF NOT EXISTS 不会升级已经落地的早期表，逐列补齐且保留原始对话。
  const additions = {
    god_runs: { deleted_at: 'TEXT', images_json: 'TEXT' },
    god_angel: {
      persona_generated_at: 'TEXT',
      persona_error: 'TEXT',
      emotion_baseline: 'TEXT',
      avatar_path: 'TEXT',
      standing_url: 'TEXT',
      scene_outfits_json: "TEXT NOT NULL DEFAULT '[]'",
      scene_standings_json: "TEXT NOT NULL DEFAULT '[]'",
      personalities_json: "TEXT NOT NULL DEFAULT '[]'",
      summoned_at: 'TEXT',
    },
    god_sessions: {
      summary_attempts: 'INTEGER NOT NULL DEFAULT 0',
      context_summary: "TEXT NOT NULL DEFAULT ''",
      context_last_message: 'INTEGER NOT NULL DEFAULT 0',
      schedule_json: "TEXT NOT NULL DEFAULT '[]'",
      seq: 'INTEGER NOT NULL DEFAULT 0',
    },
    god_world_events: { kind: "TEXT NOT NULL DEFAULT 'world'" },
  };
  for (const [table, columns] of Object.entries(additions)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  // 业务结果携带关联键，重启后可以核对是否已经发布，避免盲目重放。
  for (const table of ['moment_posts', 'raw_messages']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'god_delivery_key')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN god_delivery_key TEXT`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_god_delivery ON ${table}(god_delivery_key) WHERE god_delivery_key IS NOT NULL`);
  }
  // 早期版本一天只能存一条会话（day UNIQUE）。重新召唤需要同一天保留多条对话，
  // 唯一约束升级为 (day, seq)；已落地的旧表须重建才能去掉内联 UNIQUE。
  const sessionTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='god_sessions'").get();
  if (sessionTable && /day\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sessionTable.sql)) {
    const fkWasOn = db.pragma('foreign_keys', { simple: true });
    if (fkWasOn) db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE god_sessions_rebuild (
          id INTEGER PRIMARY KEY, day TEXT NOT NULL, time_zone TEXT NOT NULL,
          seq INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open', summary TEXT NOT NULL DEFAULT '',
          memories_json TEXT NOT NULL DEFAULT '[]', summary_status TEXT NOT NULL DEFAULT 'pending',
          summary_error TEXT, summary_attempt_at TEXT, summary_attempts INTEGER NOT NULL DEFAULT 0,
          context_summary TEXT NOT NULL DEFAULT '', context_last_message INTEGER NOT NULL DEFAULT 0,
          schedule_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
          UNIQUE(day, seq)
        );
        INSERT INTO god_sessions_rebuild
          (id,day,time_zone,seq,status,summary,memories_json,summary_status,summary_error,summary_attempt_at,
           summary_attempts,context_summary,context_last_message,schedule_json,created_at)
        SELECT id,day,time_zone,COALESCE(seq,0),status,summary,memories_json,summary_status,summary_error,summary_attempt_at,
           summary_attempts,context_summary,context_last_message,schedule_json,created_at FROM god_sessions;
        DROP TABLE god_sessions;
        ALTER TABLE god_sessions_rebuild RENAME TO god_sessions;
      `);
    } finally { if (fkWasOn) db.pragma('foreign_keys = ON'); }
  }
  // 请求快照独立保存，界面/归档仍读取用户原话，不暴露内部提示词或重复存整段历史。
  db.exec(`
    CREATE TABLE IF NOT EXISTS god_prompt_prefixes (
      session_id INTEGER PRIMARY KEY REFERENCES god_sessions(id) ON DELETE CASCADE,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS god_prompt_turns (
      message_id INTEGER PRIMARY KEY REFERENCES god_messages(id) ON DELETE CASCADE,
      payload_json TEXT NOT NULL
    );
  `);
}
