import { readTemplate } from '../db/cohabitationRepository.js';
import { splitResidenceSleep } from './cohabitationSchedule.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { reapplyActiveEventSchedule } from './eventSchedule.js';

export function writeScheduleTemplate(db, id, schedule) {
  db.prepare(`INSERT INTO schedule_templates(character_id,schedule_json,version) VALUES(?,?,1)
    ON CONFLICT(character_id) DO UPDATE SET schedule_json=excluded.schedule_json,version=schedule_templates.version+1,generated_at=CURRENT_TIMESTAMP`)
    .run(id, JSON.stringify(schedule));
}

export function refreshResidenceDailySleep(db, characterId) {
  const room = readTemplate(db, characterId).find(a => a.residence)?.residence;
  if (!room) return [Number(characterId)];
  const date = getLocalDateKey();
  const schedules = {};
  const names = Object.fromEntries(db.prepare('SELECT id,display_name FROM characters').all().map(c => [c.id, c.display_name]));
  for (const id of room.memberIds) {
    let row = db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id=? AND schedule_date=?').get(id, date);
    if (!row) {
      const template = db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=?').get(id);
      if (template) {
        db.prepare('INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES(?,?,?)').run(id, date, template.schedule_json);
        reapplyActiveEventSchedule(id, db);
        row = db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id=? AND schedule_date=?').get(id, date);
      }
    }
    if (row) schedules[id] = JSON.parse(row.schedule_json);
  }
  const updated = splitResidenceSleep(schedules, [room], names);
  for (const [id, schedule] of Object.entries(updated)) db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=? AND schedule_date=?').run(JSON.stringify(schedule), id, date);
  return room.memberIds;
}

/** 单人重排只重算同住者睡眠注释；同住者的清醒活动、手动修改保持原样。 */
export function persistIndividualSchedule(db, character, schedule, room) {
  const ids = room ? room.memberIds : [Number(character.id)];
  const names = Object.fromEntries(db.prepare('SELECT id,display_name FROM characters').all().map(c => [c.id, c.display_name]));
  const templates = Object.fromEntries(ids.map(id => [id, id === Number(character.id) ? schedule : readTemplate(db, id)]));
  const rooms = room ? [room] : [];
  const updated = splitResidenceSleep(templates, rooms, names);
  const changed = [];
  db.transaction(() => {
    for (const id of ids) {
      if (!updated[id]?.length) continue;
      if (id === Number(character.id) || JSON.stringify(updated[id]) !== JSON.stringify(templates[id])) {
        writeScheduleTemplate(db, id, updated[id]); changed.push(id);
      }
    }
    const today = getLocalDateKey();
    const daily = Object.fromEntries(ids.map(id => {
      const row = db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id=? AND schedule_date=?').get(id, today);
      return [id, id === Number(character.id) ? updated[id] : row ? JSON.parse(row.schedule_json) : templates[id]];
    }));
    const splitDaily = splitResidenceSleep(daily, rooms, names);
    for (const id of ids) {
      if (id === Number(character.id) || !splitDaily[id]?.length) continue;
      db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=? AND schedule_date=?').run(JSON.stringify(splitDaily[id]), id, today);
    }
  })();
  return { schedule: updated[character.id] || schedule, changed };
}
