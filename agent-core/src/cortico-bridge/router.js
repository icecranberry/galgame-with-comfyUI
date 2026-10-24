/** Cortico 专用边界：配置沿用邻舍管理接口；Cortico World 请求使用独立 Bearer Token。 */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getDb, getWorldSetting } from '../db/index.js';
import { getBridgeSettings, ensureBridgeToken, rotateBridgeToken, validToken, saveBridgeSettings } from './settings.js';
import { buildCharacterAppearanceSection } from '../services/characterPersona.js';
import { getActiveOutfits, listCharacterOutfits } from '../services/outfitService.js';
import { getTodaySchedule, getCurrentActivity } from '../services/scheduleManager.js';
import { getTodayNewspaperForFrontend, getNewspaperByDate } from '../services/newspaperService.js';
import { getDiary, isDiaryGenerating } from '../services/diaryGenerator.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { requestSpeech, getSpeechJob, publicJob } from '../services/speechService.js';
import { extractImagePrompt } from '../maibot-bridge/prompt.js';
import { startImageTask, getTask } from '../maibot-bridge/generate.js';
import momentsRouter from '../routes/moments.js';
import eventsRouter from '../routes/events.js';
import { listTownBuildingFeatureEvents } from '../services/town/townBuildingFeatureRuntime.js';

export const toolCatalog = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
export function createCorticoRouter({ imagePrompt = extractImagePrompt, imageTask = startImageTask, speech = requestSpeech } = {}) {
  const router = Router();
  const asyncRoute = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  const positiveId = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw Object.assign(new Error('无效的 ID'), { status: 400 });
    return n;
  };
  const limit = value => Math.min(50, Math.max(1, Number.parseInt(value, 10) || 10));
  function character(value) {
    const id = value === undefined || value === '' ? getBridgeSettings().character_id : positiveId(value);
    const row = id && getDb().prepare('SELECT * FROM characters WHERE id=?').get(id);
    if (!row) throw Object.assign(new Error('角色不存在，请在邻舍选择初始角色或传入 character_id'), { status: 404 });
    return row;
  }
  function dateKey(value) {
    if (!value) return getLocalDateKey();
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Object.assign(new Error('日期须为有效的 YYYY-MM-DD'), { status: 400 });
    return value;
  }
  function persona() {
    const settings = getBridgeSettings();
    if (!settings.inject_persona || !settings.character_id) return null;
    const c = getDb().prepare('SELECT * FROM characters WHERE id=?').get(settings.character_id);
    if (!c) return null;
    // 初始聊天人格仅使用人物卡；动态衣装通过工具按需查询，不写入稳定前缀。
    return { character_id: c.id, name: c.display_name || c.name, system_prompt: c.base_prompt || c.short_prompt || '' };
  }
  const characterList = () => getDb().prepare('SELECT id,name,display_name,avatar_path FROM characters ORDER BY id').all();

  // 管理接口不向跨站浏览器开放，也不接受插件 Token 代替管理入口。
  router.use('/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('Sec-Fetch-Site') === 'cross-site' || req.get('Authorization')) return res.status(403).json({ error: '请通过邻舍设置页管理集成' });
    const origin = req.get('Origin');
    if (origin) {
      try {
        // Vite 开发代理会改写 Host，允许同主机的开发端口。
        const from = new URL(origin), to = new URL(`${req.protocol}://${req.get('host')}`);
        if (from.origin !== to.origin && !(from.port === '5173' && ['localhost', '127.0.0.1', '[::1]'].includes(from.hostname) && ['localhost', '127.0.0.1', '[::1]'].includes(to.hostname))) return res.status(403).json({ error: '不允许跨站修改集成' });
      } catch { return res.sendStatus(403); }
    }
    next();
  });
  router.get('/admin/settings', (req, res) => res.json({ settings: getBridgeSettings(), token: ensureBridgeToken(), characters: characterList(), tools: toolCatalog }));
  router.put('/admin/settings', (req, res) => {
    try { res.json({ settings: saveBridgeSettings(req.body || {}, getDb()) }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/admin/rotate-token', (req, res) => res.json({ token: rotateBridgeToken() }));
  router.get('/admin/persona/:id', (req, res) => {
    const c = character(req.params.id);
    res.json({ character_id: c.id, name: c.display_name || c.name, system_prompt: c.base_prompt || c.short_prompt || '' });
  });

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const authorization = req.get('Authorization') || '';
    if (!/^Bearer /i.test(authorization) || !validToken(authorization.slice(7))) return res.status(401).json({ error: '邻舍桥接 Token 无效' });
    if (!getBridgeSettings().enabled) return res.status(403).json({ error: 'Cortico 集成尚未启用' });
    next();
  });
  const allow = group => (req, res, next) => getBridgeSettings().tools.includes(group) ? next() : res.status(403).json({ error: `邻舍已关闭 ${group} 工具` });
  router.get('/health', (req, res) => res.json({ ok: true, service: 'cortico-bridge', version: 1 }));
  router.get('/bootstrap', (req, res) => res.json({ persona: persona(), tools: toolCatalog.filter(t => getBridgeSettings().tools.includes(t.group)) }));
  router.get('/characters', allow('characters'), (req, res) => res.json({ characters: characterList() }));
  router.get('/character', allow('characters'), (req, res) => {
    const c = character(req.query.character_id);
    res.json({ id: c.id, name: c.name, display_name: c.display_name, persona: c.base_prompt || c.short_prompt || '', avatar_path: c.avatar_path });
  });
  router.get('/appearance', allow('appearance'), (req, res) => {
    const c = character(req.query.character_id);
    res.json({ character_id: c.id, appearance: buildCharacterAppearanceSection(c), active: getActiveOutfits(c.id), outfits: listCharacterOutfits(c.id) });
  });
  router.get('/schedule', allow('schedule'), (req, res) => {
    const c = character(req.query.character_id);
    res.json({ character_id: c.id, date: getLocalDateKey(), activities: getTodaySchedule(c.id) || [], current_activity: getCurrentActivity(c.id) });
  });
  router.get('/newspaper', allow('newspaper'), (req, res) => res.json({ newspaper: req.query.date ? getNewspaperByDate(dateKey(req.query.date)) : getTodayNewspaperForFrontend() }));
  router.get('/diary', allow('diary'), (req, res) => {
    const c = character(req.query.character_id), date = dateKey(req.query.date);
    res.json({ character_id: c.id, date, diary: getDiary(c.id, date), generating: isDiaryGenerating(c.id, date) });
  });
  router.get('/world', allow('world'), (req, res) => res.json({ world: getWorldSetting() || null }));

  // GET /api/cortico/moments/:id/images — 朋友圈配图地址列表；World 取回后以回执附件交给 Persona 发送
  router.get('/moments/:id/images', allow('moments'), (req, res) => {
    const id = positiveId(req.params.id);
    const post = getDb().prepare("SELECT id, images FROM moment_posts WHERE id = ? AND status = 'done'").get(id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ id: post.id, images: JSON.parse(post.images || '[]') });
  });

  // 复用主界面序列化（含 NPC 奇遇、朋友圈评论）；严格白名单阻止写入与 SSE。
  router.use('/moments', allow('moments'), (req, res, next) => {
    if (req.method !== 'GET' || !/^\/(?:[1-9]\d*)?$/.test(req.path)) return res.sendStatus(404);
    req.query.limit = limit(req.query.limit);
    // 省略 character_id 保持全镇动态；传入时校验角色存在，语义与其余工具一致
    if (req.query.character_id !== undefined && req.query.character_id !== '') {
      req.query.character_id = String(character(req.query.character_id).id);
    }
    next();
  }, momentsRouter);
  router.get('/events/by-id/:id', allow('events'), (req, res, next) => {
    if (!/^bfeat:[1-9]\d*$/.test(req.params.id)) return next();
    const event = listTownBuildingFeatureEvents().find(item => item.id === req.params.id);
    if (!event) return res.status(404).json({ error: 'event_not_found' });
    res.json(event);
  });
  router.use('/events', allow('events'), (req, res, next) => {
    if (req.method !== 'GET' || !/^\/(?:by-id\/(?:town:)?[1-9]\d*)?$/.test(decodeURIComponent(req.path))) return res.sendStatus(404);
    const send = res.json.bind(res), count = limit(req.query.limit);
    res.json = data => send(req.path === '/' ? { active: data.active?.slice(0, count) || [], history: data.history?.slice(0, count) || [], has_more: (data.active?.length || 0) > count || (data.history?.length || 0) > count } : data);
    next();
  }, eventsRouter);

  // 请求幂等：同一插件消息重试不重复消耗生图额度，独立命名空间隔离 MaiBot 任务。
  const pendingImages = new Map();
  router.post('/generate', allow('images'), asyncRoute(async (req, res) => {
    const { requirement, session_id, request_id } = req.body || {};
    if (typeof requirement !== 'string' || !requirement.trim() || requirement.length > 4000 || typeof session_id !== 'string' || !session_id || session_id.length > 500 || typeof request_id !== 'string' || !request_id || request_id.length > 200) return res.status(400).json({ error: 'requirement（1–4000 字）、session_id、request_id 必填' });
    const c = character(req.body.character_id);
    const key = createHash('sha256').update(JSON.stringify([session_id, request_id, c.id, requirement])).digest('hex');
    const conversationId = `cortico_${key}`;
    const existing = getDb().prepare('SELECT id FROM image_tasks WHERE conversation_id=? ORDER BY id DESC LIMIT 1').get(conversationId);
    if (existing) return res.json({ task_id: existing.id, status: getTask(existing.id)?.status });
    if (!pendingImages.has(key)) {
      if (pendingImages.size >= 4) return res.status(429).json({ error: '生图请求较多，请稍后重试' });
      pendingImages.set(key, (async () => {
        const prompt = await imagePrompt({ character: c, user_message: requirement, context: [], reply_text: '' });
        if (!prompt) throw new Error('生图描述生成失败');
        return imageTask({ character: c, conversationId, prompt, ragQuery: requirement });
      })().finally(() => pendingImages.delete(key)));
    }
    res.status(202).json({ task_id: await pendingImages.get(key), status: 'running' });
  }));
  router.get('/tasks/:id', allow('images'), (req, res) => {
    const id = positiveId(req.params.id);
    const row = getDb().prepare("SELECT id FROM image_tasks WHERE id=? AND conversation_id GLOB 'cortico_*'").get(id);
    if (!row) return res.status(404).json({ error: 'Cortico 生图任务不存在' });
    res.json(getTask(id));
  });
  router.post('/tts', allow('tts'), (req, res) => {
    const c = character(req.body?.character_id), text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) return res.status(400).json({ error: '朗读文字须为 1–1000 字' });
    const binding = getDb().prepare('SELECT voice_id FROM character_voices WHERE character_id=? AND enabled=1').get(c.id);
    if (!binding) return res.status(400).json({ error: '请先在邻舍为该角色配置音色' });
    res.status(202).json(speech({ characterId: c.id, voiceId: binding.voice_id, text }));
  });
  router.get('/speech/:id', allow('tts'), (req, res) => {
    const job = publicJob(getSpeechJob(req.params.id));
    if (!job) return res.status(404).json({ error: '语音任务不存在' });
    res.json(job);
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 400).json({ error: error.message || 'Cortico 桥接请求失败' });
  });
  return router;
}
export default createCorticoRouter();
