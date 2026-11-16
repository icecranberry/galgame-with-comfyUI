import { getDb } from '../db/index.js';
import { broadcast } from './unifiedStreamBus.js';

// The database owns the batch. A browser, SSE subscriber or reveal animation
// is never required to submit the next shot. One worker services the darkroom.
export function createPhotoStudioQueue({ studio, finishes, database = getDb, publish = broadcast, interval = 800 }) {
  let timer, enabled = false, busy = false;
  const db = () => database();
  const active = () => db().prepare("SELECT * FROM photo_studio_batches WHERE status IN ('running','stopping') ORDER BY rowid LIMIT 1").get();
  const row = id => db().prepare('SELECT rowid AS sequence, * FROM photo_studio_batches WHERE id = ?').get(id);
  const shotId = (id, index) => `${id}-${index}`;

  function get(id) {
    const batch = row(id);
    if (!batch) return null;
    const { input_json, finish_recipe, ...result } = batch;
    const jobs = db().prepare('SELECT id FROM photo_studio_jobs WHERE batch_id = ? ORDER BY batch_index').all(id).map(({ id }) => studio.job(id));
    return { ...result, jobs, completed: jobs.filter(job => job.status === 'done').length,
      job_ids: Array.from({ length: batch.total }, (_, i) => shotId(id, i + 1)) };
  }
  function current() {
    const latest = active() || db().prepare('SELECT id FROM photo_studio_batches ORDER BY rowid DESC LIMIT 1').get();
    return latest ? get(latest.id) : null;
  }
  function notify(id) { publish('photo_studio_batch', { batch: get(id) }); }
  function finish(id, status, error = null) {
    db().prepare("UPDATE photo_studio_batches SET status=?, error=?, revision=revision+1, finished_at=datetime('now') WHERE id=?").run(status, error, id);
    notify(id);
  }
  function schedule(delay = interval) {
    if (!enabled || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void tick().catch(error => console.error('[photoStudio] 连拍调度失败:', error.message)).finally(() => { if (enabled && active()) schedule(); });
    }, delay);
    timer.unref?.();
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      let batch = active();
      if (!batch) return;
      if (batch.current_job_id) {
        const job = studio.job(batch.current_job_id);
        if (job?.status === 'running') return;
        if (batch.status === 'stopping') { finish(batch.id, 'stopped'); return; }
        if (job?.status === 'failed') { finish(batch.id, 'failed', job.error || '拍摄失败，已停止后续连拍'); return; }
        if (job?.status === 'done') {
          db().prepare('UPDATE photo_studio_batches SET current_job_id=NULL, revision=revision+1 WHERE id=?').run(batch.id);
          batch = row(batch.id);
          notify(batch.id);
        }
        // A reserved shot with no job survived a restart during preparation.
        // Reuse its deterministic ID; never reserve a second slot for it.
      }
      if (batch.status === 'stopping') { finish(batch.id, 'stopped'); return; }
      if (!batch.current_job_id && batch.next_index >= batch.total) { finish(batch.id, 'done'); return; }
      if (db().prepare("SELECT 1 FROM photo_studio_jobs WHERE status='running' LIMIT 1").get()) return;
      if (!batch.current_job_id) {
        const index = batch.next_index + 1;
        db().prepare('UPDATE photo_studio_batches SET current_job_id=?, next_index=?, revision=revision+1 WHERE id=?')
          .run(shotId(batch.id, index), index, batch.id);
        batch = row(batch.id);
        notify(batch.id);
      }
      try {
        await studio.submit({ ...JSON.parse(batch.input_json), id: batch.current_job_id },
          { id: batch.id, index: batch.next_index, finishRecipe: batch.finish_recipe });
        db().prepare('UPDATE photo_studio_batches SET revision=revision+1 WHERE id=?').run(batch.id);
        notify(batch.id);
      } catch (error) {
        if (row(batch.id)?.status === 'stopping') finish(batch.id, 'stopped');
        else finish(batch.id, 'failed', error.message);
      }
    } finally { busy = false; }
  }
  async function submit({ id, count, input }) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id || '')) throw Object.assign(new Error('连拍请求编号无效'), { status: 400 });
    const previous = get(id);
    if (previous) return previous;
    if (!Number.isInteger(count) || count < 1 || count > 10 || !input || typeof input !== 'object' || Array.isArray(input)) {
      throw Object.assign(new Error('连拍数量必须是 1–10 张，并提供拍摄配置'), { status: 400 });
    }
    // Freeze request data before awaiting validation. Random actors remain
    // unresolved in this snapshot and are selected independently per shot.
    const snapshot = JSON.stringify(input);
    await studio.preview(JSON.parse(snapshot));
    const created = db().transaction(() => {
      if (row(id)) return false;
      if (active() || db().prepare("SELECT 1 FROM photo_studio_jobs WHERE status='running' LIMIT 1").get()) {
        throw Object.assign(new Error('已有拍摄任务，请等待完成或停止后续拍摄'), { status: 409 });
      }
      const defaults = finishes.defaults();
      db().prepare('INSERT INTO photo_studio_batches(id,total,input_json,finish_recipe) VALUES (?,?,?,?)')
        .run(id, count, snapshot, defaults.enabled ? JSON.stringify(defaults.recipe) : null);
      return true;
    })();
    if (created) notify(id);
    schedule(0);
    return get(id);
  }
  function stop(id) {
    const batch = row(id);
    if (!batch) throw Object.assign(new Error('找不到这组连拍'), { status: 404 });
    if (batch.status === 'running') {
      db().prepare("UPDATE photo_studio_batches SET status='stopping', revision=revision+1 WHERE id=?").run(id);
      notify(id);
      schedule(0);
    }
    return get(id);
  }
  function start() { enabled = true; schedule(0); }
  function dispose() { enabled = false; clearTimeout(timer); timer = undefined; }
  return { submit, stop, get, current, start, dispose, tick };
}
