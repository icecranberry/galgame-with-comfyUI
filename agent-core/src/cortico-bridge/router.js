/** Cortico 专用边界：纯本地集成，无 Token 验证；配置沿用邻舍管理接口。 */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getDb, getWorldSetting } from '../db/index.js';
import { getBridgeSettings, saveBridgeSettings } from './settings.js';
import { buildCharacterAppearanceSection } from '../services/characterPersona.js';
import { getActiveOutfits, listCharacterOutfits } from '../services/outfitService.js';
import { getTodaySchedule, getCurrentActivity } from '../services/scheduleManager.js';
import { getTodayNewspaperForFrontend, getNewspaperByDate } from '../services/newspaperService.js';
import { getDiary, isDiaryGenerating } from '../services/diaryGenerator.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { requestSpeech, getSpeechJob, publicJob } from '../services/speechService.js';
import { extractImagePrompt } from '../maibot-bridge/prompt.js';
import { startImageTask, getTask } from '../maibot-bridge/generate.js';
import { startLabImageTask } from '../services/imageLabScene.js';
import { deriveStyles } from '../maibot-bridge/style.js';
import momentsRouter from '../routes/moments.js';

export const toolCatalog = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
export function createCorticoRouter({ imagePrompt = extractImagePrompt, imageTask = startImageTask, speech = requestSpeech, deriveStyle = deriveStyles, labImageTask = startLabImageTask } = {}) {
  const router = Router();
  const asyncRoute = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  const positiveId = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw Object.assign(new Error('无效的 ID'), { status: 400 });
    return n;
  };
  const limit = value => Math.min(50, Math.max(1, Number.parseInt(value, 10) || 10));
  // 日程默认只回当前时间前后 windowMinutes 分钟内的条目；跨午夜时段（如 23:00~07:00）按平移一天对齐比较
  const nearSchedule = (activities, now, windowMinutes) => {
    const toMinutes = value => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
      return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    };
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return activities.filter(act => {
      const start = toMinutes(act.startTime), end = toMinutes(act.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) return false;
      const [spanStart, spanEnd] = end > start ? [start, end] : [start, end + 1440];
      return [-1440, 0, 1440].some(shift => spanStart + shift <= nowMin + windowMinutes && spanEnd + shift >= nowMin - windowMinutes);
    });
  };
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
    // 行为/表达风格按角色提炼存储，随人物卡一起进前缀。
    const styles = settings.persona_styles[settings.character_id] || {};
    return { character_id: c.id, name: c.display_name || c.name, system_prompt: c.base_prompt || c.short_prompt || '',
      behavior_style: String(styles.behavior_style || ''), reply_style: String(styles.reply_style || '') };
  }
  const characterList = () => getDb().prepare('SELECT id,name,display_name,avatar_path FROM characters ORDER BY id').all();

  // 管理接口不向跨站浏览器开放。
  router.use('/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: '请通过邻舍设置页管理集成' });
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
  router.get('/admin/settings', (req, res) => res.json({ settings: getBridgeSettings(), characters: characterList(), tools: toolCatalog }));
  router.put('/admin/settings', (req, res) => {
    try {
      const previous = getBridgeSettings();
      const settings = saveBridgeSettings(req.body || {}, getDb());
      // 角色或其行为/表达风格变化就让 Cortico 重载 session 前缀，新人格立即生效（保留对话记录）。
      const reload = (() => {
        if (!settings.character_id) return false;
        if (settings.character_id !== previous.character_id) return true;
        const before = previous.persona_styles[settings.character_id] || {};
        const after = settings.persona_styles[settings.character_id] || {};
        return (before.behavior_style || '') !== (after.behavior_style || '') || (before.reply_style || '') !== (after.reply_style || '');
      })();
      if (reload) {
        const url = `http://127.0.0.1:${settings.webui_port}/api/session/reload-prefix`;
        fetch(url, { method: 'POST' })
          .then(r => { if (!r.ok) console.warn(`[cortico-bridge] 前缀重载失败 (HTTP ${r.status})`); })
          .catch(e => console.warn(`[cortico-bridge] 前缀重载请求未送达 (${e.message})，下次重启部署时生效`));
      }
      res.json({ settings });
    }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/admin/persona/:id', (req, res) => {
    const c = character(req.params.id);
    const styles = getBridgeSettings().persona_styles[c.id] || {};
    res.json({ character_id: c.id, name: c.display_name || c.name, system_prompt: c.base_prompt || c.short_prompt || '',
      behavior_style: String(styles.behavior_style || ''), reply_style: String(styles.reply_style || '') });
  });
  // POST /admin/derive-style — 从所选角色的 base_prompt 提炼行为/表达风格（纯预览，不保存）
  router.post('/admin/derive-style', asyncRoute(async (req, res) => {
    try {
      const c = character(req.body?.character_id);
      const base = c.base_prompt || c.short_prompt || '';
      if (!base.trim()) return res.status(400).json({ error: '该角色没有人格卡片，无法提炼风格' });
      const styles = await deriveStyle(base);
      res.json({ character_id: c.id, ...styles });
    } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
  }));
  // POST /admin/clear-context — 清空 Cortico 当前会话的对话记录（清空后按最新人格前缀重开）
  router.post('/admin/clear-context', asyncRoute(async (_req, res) => {
    const port = getBridgeSettings().webui_port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/storage/clear?owner=core&key=session`, { method: 'POST', signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => null);
      if (!response.ok) return res.status(502).json({ error: `Cortico 清空会话失败 (HTTP ${response.status}${data?.error ? `：${data.error}` : ''})` });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: `无法连接 Cortico（${e.message}），请确认它正在运行` });
    }
  }));

  // 纯本地集成恒为启用：桥接不做 Token 验证，只受工具分组约束。
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
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
    const full = ['1', 'true'].includes(String(req.query.full).toLowerCase());
    const activities = getTodaySchedule(c.id) || [];
    const now = new Date();
    res.json({
      character_id: c.id,
      date: getLocalDateKey(),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      scope: full ? 'full' : 'nearby',
      activities: full ? activities : nearSchedule(activities, now, 60),
      current_activity: getCurrentActivity(c.id),
    });
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

  // 复用主界面序列化（含朋友圈评论）；严格白名单阻止写入与 SSE。
  router.use('/moments', allow('moments'), (req, res, next) => {
    if (req.method !== 'GET' || !/^\/(?:[1-9]\d*)?$/.test(req.path)) return res.sendStatus(404);
    req.query.limit = limit(req.query.limit);
    // 省略 character_id 保持全镇动态；传入时校验角色存在，语义与其余工具一致
    if (req.query.character_id !== undefined && req.query.character_id !== '') {
      req.query.character_id = String(character(req.query.character_id).id);
    }
    next();
  }, momentsRouter);

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
  // 泛用画图：复用图片实验室「自由画面描述」链路（画面里提到的角色/用户自动注入外观）。
  router.post('/draw', allow('images'), asyncRoute(async (req, res) => {
    const { requirement, session_id, request_id } = req.body || {};
    if (typeof requirement !== 'string' || !requirement.trim() || requirement.length > 4000 || typeof session_id !== 'string' || !session_id || session_id.length > 500 || typeof request_id !== 'string' || !request_id || request_id.length > 200) return res.status(400).json({ error: 'requirement（1–4000 字）、session_id、request_id 必填' });
    const key = createHash('sha256').update(JSON.stringify([session_id, request_id, requirement])).digest('hex');
    const conversationId = `cortico_lab_${key}`;
    const existing = getDb().prepare('SELECT id FROM image_tasks WHERE conversation_id=? ORDER BY id DESC LIMIT 1').get(conversationId);
    if (existing) return res.json({ task_id: existing.id, status: getTask(existing.id)?.status });
    if (!pendingImages.has(key)) {
      if (pendingImages.size >= 4) return res.status(429).json({ error: '生图请求较多，请稍等重试' });
      pendingImages.set(key, Promise.resolve(labImageTask({ conversationId, desc: requirement })).finally(() => pendingImages.delete(key)));
    }
    res.status(202).json({ task_id: await pendingImages.get(key), status: 'running' });
  }));
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
