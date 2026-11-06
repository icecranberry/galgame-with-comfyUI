import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getGodRuntime, angelActivity } from '../services/godSays/runtime.js';
import { parseJson } from '../services/godSays/repository.js';
import { saveBase64Image } from '../services/imagePaths.js';
import { config } from '../config.js';
import { godToolCatalog } from '../services/godSays/tools.js';
import { ANGEL_PERSONALITIES } from '../services/godSays/angelPersonalities.js';

const router = Router();
router.get('/state', (req, res) => {
  const r = getGodRuntime();
  const sessionId = req.query.session ? Number(req.query.session) : null;
  if (sessionId !== null && (!Number.isSafeInteger(sessionId) || sessionId < 1)) return res.status(400).json({ error: '日期标识无效' });
  const state = r.repo.snapshot(sessionId);
  const schedule = state.angel.schedule;
  state.scheduleEnabled = config.features.schedule !== false;
  state.activity = state.scheduleEnabled ? angelActivity(schedule, r.repo.now(), r.repo.timeZone) : null;
  state.worldEvents = state.session.id ? r.world.list(null, state.session.id) : [];
  state.toolCatalog = godToolCatalog();
  state.changes = r.tools.changes.list(state.session.id);
  state.batches = r.tools.batches.list(state.session.id);
  state.angelPersonalities = ANGEL_PERSONALITIES;
  res.json(state);
  // 尚未召唤天使时，先由前端引导选性格；不自动生成默认人格与日程。
  if (state.writable && state.angel.summoned) void r.ensureSchedule(state.session).catch(err => console.warn('[天使日程]', err.message));
});
router.get('/work', (req, res) => {
  const r = getGodRuntime();
  const session = Number(req.query.session);
  if (!Number.isSafeInteger(session) || session < 1) return res.status(400).json({ error: '会话编号无效' });
  res.json({ changes: r.tools.changes.list(session), batches: r.tools.batches.list(session) });
});
router.post('/batches/:id/stop', (req, res) => res.json(getGodRuntime().tools.batches.stop(req.params.id)));
router.post('/changes/:id/decision', async (req, res, next) => {
  try { res.json(await getGodRuntime().tools.changes.decide(req.params.id, req.body?.version, req.body?.decision)); }
  catch (err) { next(err); }
});
router.get('/sessions', (req, res) => {
  const { repo } = getGodRuntime();
  const before = typeof req.query.before === 'string' ? req.query.before : '9999-12-31';
  const beforeId = req.query.before_id ? Number(req.query.before_id) : null;
  if (beforeId !== null && (!Number.isSafeInteger(beforeId) || beforeId < 1)) return res.status(400).json({ error: '会话标识无效' });
  res.json(repo.listSessions(before, beforeId));
});
router.post('/sessions', (req, res) => res.json(getGodRuntime().repo.newSession()));
// 旧客户端不再读取记忆或启动总结请求。
router.get('/memories', (req, res) => res.json([]));
router.post('/sessions/:id/summarize', (req, res) => res.status(410).json({ error: '神说已停用记忆总结' }));
const IMAGE_DATA_URI = /^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BASE64 = 10 * 1024 * 1024;
// 图片消息使用 chat 目录落盘，返回可供历史回看的 /images/... URL；模型侧仍用原始 data URI。
function imageExtension(mime) {
  const value = String(mime || '').toLowerCase();
  return value === 'jpeg' || value === 'jpg' ? 'jpg' : value;
}
router.post('/runs', (req, res) => {
  const { client_id, text, images, session_id = null } = req.body || {};
  if (session_id !== null && (!Number.isSafeInteger(session_id) || session_id < 1)) return res.status(400).json({ error: '会话编号无效' });
  if (typeof client_id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(client_id) || typeof text !== 'string' || !text.trim() || text.length > 20000) return res.status(400).json({ error: '请填写有效消息（最多两万字）' });
  let imageUrls = [];
  const imageDataUris = [];
  if (images !== undefined) {
    if (!Array.isArray(images)) return res.status(400).json({ error: '图片格式无效，请上传图片文件' });
    if (images.length > MAX_IMAGE_COUNT) return res.status(400).json({ error: '最多只能附加 4 张图片' });
    for (const dataUri of images) {
      if (typeof dataUri !== 'string' || !IMAGE_DATA_URI.test(dataUri)) return res.status(400).json({ error: '图片格式无效，仅支持 PNG、JPG、WebP、GIF、AVIF' });
      const comma = dataUri.indexOf(',');
      if (comma < 0 || dataUri.length - comma - 1 > MAX_IMAGE_BASE64) return res.status(400).json({ error: '单张图片过大（最多 10MB）' });
    }
    for (const dataUri of images) {
      const mime = dataUri.match(/^data:image\/([a-z0-9.+-]+);base64,/i)?.[1];
      imageUrls.push(saveBase64Image('chat', `${randomUUID()}.${imageExtension(mime)}`, dataUri));
      imageDataUris.push(dataUri);
    }
  }
  res.json(getGodRuntime().start(client_id, text.trim(), { urls: imageUrls, dataUris: imageDataUris, sessionId: session_id }));
});
router.post('/runs/:id/stop', (req, res) => res.json(getGodRuntime().cancel(req.params.id)));
router.delete('/runs/:id', (req, res) => {
  const r = getGodRuntime();
  const active = r.repo.db.prepare("SELECT 1 FROM god_changes WHERE run_id=? AND status='applying' UNION ALL SELECT 1 FROM god_batches WHERE run_id=? AND status='running' LIMIT 1").get(req.params.id, req.params.id);
  if (active) return res.status(409).json({ error: '这轮仍有工作正在执行，请先停止批量任务或等待提交结束' });
  const result = r.repo.deleteTurn(req.params.id);
  r.repo.db.prepare("UPDATE god_changes SET status='rejected' WHERE run_id=? AND status='pending'").run(req.params.id);
  res.json(result);
});
router.get('/angel', (req, res) => res.json(getGodRuntime().repo.ensureAngel()));
router.post('/angel/summon', async (req, res, next) => {
  try {
    const raw = req.body?.personalities;
    if (raw !== undefined && !Array.isArray(raw)) return res.status(400).json({ error: '请选择天使的性格' });
    const custom = req.body?.custom;
    if (custom !== undefined && typeof custom !== 'string') return res.status(400).json({ error: '自定义要求格式无效' });
    if (typeof custom === 'string' && custom.trim().length > 800) return res.status(400).json({ error: '自定义要求最多 800 字' });
    const angel = await getGodRuntime().summon({ personalities: raw, custom });
    res.json({ ...angel, system_role: 'angel' });
  } catch (err) { next(err); }
});
router.put('/angel', (req, res) => res.json(getGodRuntime().repo.updateAngel(req.body)));
router.post('/angel/outfits/draft', (req,res,next) => {
  getGodRuntime().images.outfitDraft(req.body).then(result=>res.json(result)).catch(next);
});
router.get('/angel/image-jobs', (req, res) => res.json(getGodRuntime().images.list()));
router.post('/angel/image-jobs', (req, res, next) => {
  if (!['avatar', 'standing', 'peek', 'outfits'].includes(req.body?.kind)) return res.status(400).json({ error: '图片任务类型无效' });
  const r = getGodRuntime();
  const prepare = req.body?.kind === 'peek' ? r.ensureSchedule(r.repo.today({ persist: false })) : r.ensurePersona();
  Promise.resolve(prepare).then(() => res.status(202).json(r.images.start(req.body))).catch(next);
});
router.get('/angel/image-jobs/:id', (req, res) => {
  const job = getGodRuntime().images.get(req.params.id);
  if (!job) return res.status(404).json({ error: '图片任务不存在' });
  res.json(job);
});
router.post('/angel/avatar', (req, res, next) => { getGodRuntime().images.upload('avatar', req.body?.base64).then(angel => res.json(angel)).catch(next); });
router.post('/angel/standing', (req, res, next) => { getGodRuntime().images.upload('standing', req.body?.base64, req.body?.scene).then(angel => res.json(angel)).catch(next); });
router.delete('/angel/standing', (req, res, next) => { getGodRuntime().images.upload('standing', null, req.query.scene).then(angel => res.json(angel)).catch(next); });
router.post('/angel/clothing-draft', (req, res, next) => { getGodRuntime().images.clothingDraft(req.body).then(result => res.json(result)).catch(next); });
router.get('/world-events', (req, res) => res.json(getGodRuntime().world.list(null, Number(req.query.session) || null)));
router.get('/activity', (req, res) => {
  const r = getGodRuntime();
  const angel = r.repo.ensureAngel();
  res.json({ angel, scheduleEnabled: config.features.schedule !== false, activity: config.features.schedule === false ? null : angelActivity(angel.schedule, r.repo.now(), r.repo.timeZone) });
});
router.post('/world-events/:id/retry', (req, res) => res.json(getGodRuntime().world.retry(Number(req.params.id))));

router.get('/runs/:id/stream', (req, res) => {
  const { repo } = getGodRuntime();
  const run = repo.db.prepare('SELECT * FROM god_runs WHERE id=?').get(req.params.id);
  if (!run || run.deleted_at) return res.status(404).json({ error: '回应不存在' });
  let cursor = Number(req.headers['last-event-id'] || req.query.after || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return res.status(400).json({ error: '流位置无效' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  let timer;
  let heartbeat;
  function flush() {
    const events = repo.db.prepare('SELECT * FROM god_run_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 300').all(run.id, cursor);
    for (const event of events) {
      cursor = event.seq;
      res.write(`id: ${event.seq}\ndata: ${JSON.stringify({ type: event.type, data: parseJson(event.data) })}\n\n`);
    }
    const latest = repo.db.prepare('SELECT status,error FROM god_runs WHERE id=?').get(run.id);
    if (latest.status !== 'running' && events.length < 300) {
      res.write(`data: ${JSON.stringify({ type: 'run_end', data: { id: run.id, ...latest } })}\n\n`);
      clearInterval(timer); clearInterval(heartbeat); res.end();
    }
  }
  timer = setInterval(flush, 80);
  heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
  res.on('close', () => { clearInterval(timer); clearInterval(heartbeat); });
  flush(); // 断开只结束订阅；运行在后台继续，刷新可按 seq 续读。
});
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || '神说暂时无法回应，请稍后再试' });
});
export default router;
