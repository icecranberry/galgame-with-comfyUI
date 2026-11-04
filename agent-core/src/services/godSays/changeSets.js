import { randomUUID, createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
// Confirmation is a durable business object, independent of the model run and batch scheduler.
export function createChangeSets(repo, { prepare, apply, snapshot }) {
  const { db } = repo;
  db.exec(`CREATE TABLE IF NOT EXISTS god_changes (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    version TEXT NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  for (const row of db.prepare("SELECT * FROM god_changes WHERE status='applying'").all()) {
    const items = JSON.parse(row.items_json).map(i => i.status === 'applying' ? { ...i, status: 'uncertain' } : i);
    db.prepare("UPDATE god_changes SET status='uncertain',items_json=? WHERE id=?").run(JSON.stringify(items), row.id);
  }
  const decode = row => row && ({ ...row, items: JSON.parse(row.items_json), items_json: undefined });
  const get = id => decode(db.prepare('SELECT * FROM god_changes WHERE id=?').get(id));
  const save = row => db.prepare('UPDATE god_changes SET status=?,items_json=? WHERE id=?').run(row.status, JSON.stringify(row.items), row.id);
  const list = session => db.prepare('SELECT c.* FROM god_changes c JOIN god_runs r ON r.id=c.run_id WHERE r.session_id=? AND r.deleted_at IS NULL ORDER BY c.created_at,c.id').all(session).map(decode);
  async function create(runId, title, operations, signal) {
    const items = [];
    for (const operation of operations) {
      signal?.throwIfAborted();
      const before = snapshot(operation);
      const prepared = await prepare(operation, signal, before);
      if (digest(snapshot(prepared)) !== digest(before)) throw failure('生成期间原内容已变化，请重新生成草稿');
      items.push({ ...prepared, before, status: 'pending' });
    }
    signal?.throwIfAborted();
    const id = randomUUID();
    const version = digest(items);
    db.prepare('INSERT INTO god_changes VALUES (?,?,?,?,?,?,?)').run(id, runId, title, 'pending', version, JSON.stringify(items), repo.timestamp());
    return { status: 'awaiting_confirmation', change_id: id, count: items.length, note: '具体内容已经准备好，尚未修改业务数据。请用户在变更卡中确认；模型不能代为确认。' };
  }
  async function decide(id, version, decision) {
    const row = get(id);
    if (!row) throw failure('变更不存在', 404);
    if (!db.prepare('SELECT id FROM god_runs WHERE id=? AND deleted_at IS NULL').get(row.run_id)) throw failure('所属对话已删除');
    if (row.version !== version) throw failure('草稿版本已改变，请重新查看');
    if (!['approve', 'reject'].includes(decision)) throw failure('无效的确认操作', 400);
    if (row.status !== 'pending') return row;
    if (decision === 'reject') { row.status = 'rejected'; save(row); return row; }
    // Check the whole snapshot before starting; per-item checks also run immediately before submission.
    const unchanged = item => { try { return digest(snapshot(item)) === digest(item.before); } catch { return false; } };
    if (row.items.some(item => !unchanged(item))) {
      row.status = 'conflict'; save(row); throw failure('原数据已改变，请重新生成草稿');
    }
    if (!db.prepare("UPDATE god_changes SET status='applying' WHERE id=? AND status='pending'").run(id).changes) return get(id);
    row.status = 'applying';
    // No model call after approval. Only these frozen operations can be submitted.
    for (let i = 0; i < row.items.length; i++) {
      const item = row.items[i];
      try {
        if (!unchanged(item)) { item.status = 'conflict'; item.error = '原数据已改变'; continue; }
        item.status = 'applying'; save(row);
        item.result = await apply(item, { runId: row.run_id, effectKey: `change:${row.id}:${i}`, assertCurrent: () => { if (!unchanged(item)) throw failure('原数据已改变，请重新生成草稿'); } });
        item.status = 'done';
      } catch (err) { item.status = err.uncertain ? 'uncertain' : 'failed'; item.error = err.message; }
      finally { save(row); }
    }
    row.status = row.items.every(i => i.status === 'done') ? 'done' : 'partial'; save(row);
    return row;
  }
  return { create, decide, get, list };
}
