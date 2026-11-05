import { randomUUID } from 'node:crypto';
// A batch owns its frozen target list and item results. Confirmation is supplied independently.
export function createBatchTasks(repo, { validate, needsConfirmation, changes, execute }) {
  const { db } = repo;
  const controllers = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS god_batches (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
  db.prepare("UPDATE god_batches SET status='interrupted' WHERE status='running'").run();
  const decode = row => row && ({ ...row, items: JSON.parse(row.items_json), items_json: undefined });
  const list = session => db.prepare('SELECT b.* FROM god_batches b JOIN god_runs r ON r.id=b.run_id WHERE r.session_id=? AND r.deleted_at IS NULL ORDER BY b.created_at,b.id').all(session).map(decode);
  const save = row => db.prepare('UPDATE god_batches SET status=?,items_json=? WHERE id=?').run(row.status, JSON.stringify(row.items), row.id);
  async function start(args, ctx) {
    const all = db.prepare('SELECT id,display_name FROM characters ORDER BY id').all();
    const targets = args.character_ids ? all.filter(c => args.character_ids.includes(c.id)) : all;
    if (!targets.length || targets.length > 1000 || (args.character_ids && targets.length !== args.character_ids.length)) throw new Error('角色范围无效或超过单批 1000 人');
    const common = JSON.parse(args.arguments_json);
    const overrides = args.per_character_json ? JSON.parse(args.per_character_json) : {};
    if (!common || typeof common !== 'object' || Array.isArray(common) || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('批量参数必须是 JSON 对象');
    if (Object.keys(overrides).some(id => !targets.some(c => String(c.id) === id))) throw new Error('逐人参数包含目标范围之外的角色');
    const operations = targets.map(c => ({ name: args.tool_name, label: c.display_name, args: { ...common, ...overrides[c.id], character_id: c.id } }));
    operations.forEach(operation=>validate(operation,ctx));
    const title = args.title || `批量处理 ${targets.length} 位角色`;
    if (operations.some(operation => needsConfirmation(operation.name, operation.args))) return changes.create(ctx.runId, title, operations, ctx.signal);
    const row = { id: randomUUID(), run_id: ctx.runId, title, status: 'running', items: operations.map(o => ({ ...o, status: 'pending' })) };
    db.prepare('INSERT INTO god_batches VALUES (?,?,?,?,?,?)').run(row.id, ctx.runId, title, row.status, JSON.stringify(row.items), repo.timestamp());
    const controller = new AbortController();
    controllers.set(row.id, controller);
    ctx = { ...ctx, signal: AbortSignal.any([controller.signal, ...(ctx.signal ? [ctx.signal] : []), AbortSignal.timeout(600000)]) };
    // Independent of model tool count; execute serially with cancellation between items.
    void (async () => {
      for (let i = 0; i < row.items.length; i++) {
        const item = row.items[i];
        if (ctx.signal?.aborted) { item.status = 'cancelled'; save(row); continue; }
        item.status = 'running'; save(row);
        try { item.result = await execute(item, { ...ctx, callId: `batch:${row.id}:${i}`, effectKey: `batch:${row.id}:${i}` }); item.status = 'done'; }
        catch (err) { item.status = err.uncertain ? 'uncertain' : 'failed'; item.error = err.message; }
        save(row);
      }
      row.status = row.items.every(i => i.status === 'done') ? 'done' : 'partial'; save(row);
    })().catch(err => { row.status = 'failed'; row.error = err.message; save(row); }).finally(() => controllers.delete(row.id));
    return { status: 'accepted', batch_id: row.id, count: targets.length, note: '已开始批量处理，请查看工作卡的逐项结果。' };
  }
  function stop(id) { controllers.get(id)?.abort(); return { ok: true }; }
  return { start, list, stop };
}
