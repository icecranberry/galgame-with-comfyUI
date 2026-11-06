import { Router } from 'express';
import { getDb } from '../db/index.js';
import { residenceState } from '../db/cohabitationRepository.js';

const router = Router();
const failure = message => Object.assign(new Error(message), { status: 400 });
function roomName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 60) throw failure('房间名称需为 1～60 个字');
  return name;
}
function characterExists(db, value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || !db.prepare("SELECT id FROM characters WHERE id=?").get(id)) throw failure('角色不存在');
  return id;
}
const run = fn => (req, res) => { try { res.json(fn(req, getDb())); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };
router.get('/', run((_req, db) => ({
  ...residenceState(db),
  characters: db.prepare("SELECT id,display_name,avatar_path FROM characters ORDER BY id").all(),
})));
router.post('/rooms', run((req, db) => db.transaction(() => {
  const name = roomName(req.body.name || '宿舍');
  const member = req.body.characterId == null ? null : characterExists(db, req.body.characterId);
  const id = Number(db.prepare('INSERT INTO cohabitation_rooms(name) VALUES(?)').run(name).lastInsertRowid);
  if (member) db.prepare(`INSERT INTO cohabitation_members(character_id,room_id) VALUES(?,?)
    ON CONFLICT(character_id) DO UPDATE SET room_id=excluded.room_id`).run(member, id);
  return { id, ...residenceState(db) };
})()));
router.put('/rooms/:id', run((req, db) => {
  const changed = db.prepare('UPDATE cohabitation_rooms SET name=? WHERE id=?').run(roomName(req.body.name), Number(req.params.id));
  if (!changed.changes) throw failure('房间不存在');
  return residenceState(db);
}));
router.delete('/rooms/:id', run((req, db) => {
  db.prepare('DELETE FROM cohabitation_rooms WHERE id=?').run(Number(req.params.id));
  return residenceState(db);
}));
router.put('/members/:id', run((req, db) => db.transaction(() => {
  const id = characterExists(db, req.params.id);
  if (req.body.roomId == null) db.prepare('DELETE FROM cohabitation_members WHERE character_id=?').run(id);
  else {
    const roomId = Number(req.body.roomId);
    if (!db.prepare('SELECT id FROM cohabitation_rooms WHERE id=?').get(roomId)) throw failure('房间不存在');
    db.prepare(`INSERT INTO cohabitation_members(character_id,room_id) VALUES(?,?)
      ON CONFLICT(character_id) DO UPDATE SET room_id=excluded.room_id`).run(id, roomId);
  }
  return residenceState(db);
})()));
export default router;
