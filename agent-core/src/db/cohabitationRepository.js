/** 居室归属永久保存；共同生活计划只保留当前一轮（含可恢复的生成草稿）。 */
export function migrateCohabitationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cohabitation_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cohabitation_members (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES cohabitation_rooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS cohabitation_plan (
      id INTEGER PRIMARY KEY CHECK(id=1), data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schedule_refresh_cycle (
      id INTEGER PRIMARY KEY CHECK(id=1), next_refresh_at TEXT,
      retry_at TEXT, last_batch_id TEXT
    );
  `);
  if (!db.prepare('PRAGMA table_info(schedule_refresh_cycle)').all().some(c => c.name === 'applied_residences_json')) {
    db.exec('ALTER TABLE schedule_refresh_cycle ADD COLUMN applied_residences_json TEXT');
  }
}

export function listResidences(db) {
  const rooms = db.prepare('SELECT id,name FROM cohabitation_rooms ORDER BY id').all();
  const members = db.prepare('SELECT character_id,room_id FROM cohabitation_members ORDER BY character_id').all();
  return rooms.map(room => ({ ...room, memberIds: members.filter(m => m.room_id === room.id).map(m => m.character_id) }));
}

// 居室推理顺序随机，比较时只看名称、归属，不把数组顺序当作变更。
function residenceSnapshot(rooms) {
  return JSON.stringify(rooms.map(r => ({ id: r.id, name: r.name, memberIds: [...r.memberIds].sort((a, b) => a - b) })).sort((a, b) => a.id - b.id));
}

export function residenceState(db) {
  const rooms = listResidences(db);
  const applied = db.prepare('SELECT applied_residences_json FROM schedule_refresh_cycle WHERE id=1').get()?.applied_residences_json;
  // 兼容升级前已经成功发布的一轮；未发布过的居室均等待下轮应用。
  const previous = applied == null ? readCohabitationPlan(db) : null;
  const baseline = applied ?? residenceSnapshot(previous?.status === 'done' ? previous.rooms : []);
  return { rooms, pendingChanges: residenceSnapshot(rooms) !== baseline };
}

/** 仅随全体日程成功发布而更新，不能在开始生成或单人重排时清除待生效状态。 */
export function saveAppliedResidences(db, rooms) {
  db.prepare(`INSERT INTO schedule_refresh_cycle(id,applied_residences_json) VALUES(1,?)
    ON CONFLICT(id) DO UPDATE SET applied_residences_json=excluded.applied_residences_json`).run(residenceSnapshot(rooms));
}

export function readCohabitationPlan(db) {
  const row = db.prepare('SELECT data_json FROM cohabitation_plan WHERE id=1').get();
  return row ? JSON.parse(row.data_json) : null;
}

export function saveCohabitationPlan(db, plan) {
  db.prepare(`INSERT INTO cohabitation_plan(id,data_json) VALUES(1,?)
    ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(plan));
}

export function readTemplate(db, id) {
  const row = db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=?').get(id);
  return row ? JSON.parse(row.schedule_json) : [];
}

/** 单人重排从已发布模板读取约定，不读取可能尚未发布的新一轮草稿。 */
export function publishedCohabitationContext(db, id) {
  const schedule = readTemplate(db, id);
  return {
    room: schedule.find(a => a.residence)?.residence || null,
    events: [...new Map(schedule.filter(a => a.sharedEventId).map(a => [a.sharedEventId, {
      ...a, startTime: a.sharedStartTime || a.startTime, endTime: a.sharedEndTime || a.endTime,
    }])).values()],
  };
}
