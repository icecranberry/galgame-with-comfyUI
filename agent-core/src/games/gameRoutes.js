import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/index.js';
import { getSetting, setSetting } from '../db/settings.js';
import { createGameManager } from './gameManager.js';
import { createGameImporter } from './gameImporter.js';
import { githubTransport, normalizeGithubProxy } from '../services/githubTransport.js';
import { promoteGameMedia } from './gameMedia.js';
import { MEDIA_DIR, inside, removeManaged, regularFile, validId, bad } from './gamePaths.js';

const devBootId = process.env.LINSHE_GAME_DEV === '1' ? randomUUID() : null;
let manager, importer;
export function initGames() {
  if (!manager) {
    manager = createGameManager(getDb());
    importer = createGameImporter(manager, { fetchImpl: githubTransport.fetch, settings: {
      get: () => { try { return JSON.parse(getSetting('games_github') || '{}'); } catch { return {}; } },
      set: value => setSetting('games_github', JSON.stringify(value)),
    } });
    for (const error of manager.scan()) console.warn('[games]', error);
  }
  return manager;
}
export async function closeGames() { if (manager) await manager.close(); }
export function createGameRoutes({ getManager = initGames, getImporter = () => importer, github = githubTransport } = {}) {
let manager, importerInstance;
const run = fn => (req, res, next) => { Promise.resolve().then(() => { manager = getManager(); importerInstance = getImporter(); return fn(req, res, next); }).catch(next); };
const router = express.Router();
router.get('/', run((_req, res) => res.json(manager.repo.list().map(manager.publicGame))));
router.get('/community/discover', run(async (req, res) => res.json(await importerInstance.discover(req.query.refresh === '1'))));
router.get('/settings', run(async (_req, res) => res.json({
  ...importerInstance.publicSettings(),
  ...await github.resolveSettings(),
})));
router.put('/settings', run(async (req, res) => {
  const input = req.body || {};
  const proxyUrl = input.proxyUrl === undefined ? undefined : normalizeGithubProxy(input.proxyUrl);
  const settings = importerInstance.saveSettings(input);
  if (proxyUrl !== undefined) github.setProxy(proxyUrl);
  res.json({ ...settings, ...await github.resolveSettings() });
}));
router.post('/import/github', run(async (req, res) => res.status(201).json(await importerInstance.installGitHub(req.body?.url, req.body?.replace === true))));
router.post('/import/zip', express.raw({ type: ['application/zip', 'application/octet-stream', 'application/x-zip-compressed'], limit: '50mb' }), run(async (req, res) => {
  let password;
  try { password = decodeURIComponent(req.get('X-Game-Zip-Password') || ''); }
  catch { throw bad('ZIP 密码格式无效'); }
  res.status(201).json(await importerInstance.installZip(req.body, { replace: req.query.replace === '1', password }));
}));
router.get('/:gameId/events', run((req, res) => {
  const id = req.params.gameId;
  const devPreview = req.query.dev === '1' && devBootId;
  if (devPreview) validId(id);
  else manager.get(id);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders(); res.write(':connected\n\n');
  if (devPreview) res.write(`retry: 750\nevent: game-host-ready\ndata: ${devBootId}\n\n`);
  const send = event => { if (event.gameId === id) res.write(`data: ${JSON.stringify({ type: event.type, data: event.data })}\n\n`); };
  manager.events.on('update', send);
  const timer = setInterval(() => res.write(':keepalive\n\n'), 25000); timer.unref();
  req.on('close', () => { clearInterval(timer); manager.events.off('update', send); });
}));
router.get('/:gameId', run((req, res) => {
  const game = manager.publicGame(manager.get(req.params.gameId, { disabled: true }));
  res.json(req.query.dev === '1' ? { ...game, devBootId } : game);
}));
router.patch('/:gameId', run(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') throw bad('enabled 必须为布尔值');
  res.json(await manager.enable(req.params.gameId, req.body.enabled));
}));
router.post('/:gameId/update', run(async (req, res) => res.json(await importerInstance.updateGitHub(req.params.gameId))));
router.delete('/:gameId', run(async (req, res) => { await manager.uninstall(req.params.gameId, req.query.clearData === '1'); res.json({ ok: true }); }));
router.post('/:gameId/sdk/bridge', run(async (req, res) => res.json(await manager.context(req.params.gameId).bridgeTools.call(req.body?.toolName, req.body?.args))));
router.post('/:gameId/sdk/llm', run(async (req, res) => res.json({ content: await manager.context(req.params.gameId).llm.chat(req.body?.messages, req.body?.options) })));
router.post('/:gameId/sdk/image', run(async (req, res) => res.json(await manager.context(req.params.gameId).imageService.generate(req.body))));
router.post('/:gameId/media/promote-to-album', run(async (req, res) => { manager.get(req.params.gameId); res.json(await promoteGameMedia(manager.repo, req.params.gameId, req.body || {})); }));
function savePermission(id) {
  const game = manager.get(id);
  if (!game.manifest.permissions.includes('save:rw')) throw bad('游戏没有声明存档权限', 403);
  return game;
}
router.get('/:gameId/sessions', run((req, res) => { savePermission(req.params.gameId); res.json(manager.repo.sessions(req.params.gameId)); }));
router.get('/:gameId/sessions/:sessionId', run((req, res) => {
  const game = savePermission(req.params.gameId);
  if (game.source === 'official' && game.id === 'trpg-simulator') throw bad('请通过跑团状态接口读取卷宗', 403);
  const session = manager.repo.session(game.id, req.params.sessionId);
  if (!session) throw bad('存档不存在', 404);
  res.json(session);
}));
const save = run((req, res) => {
  const game = savePermission(req.params.gameId);
  if (game.source === 'official' && game.id === 'trpg-simulator') throw bad('跑团存档由规则引擎保存，请从游戏内操作', 403);
  res.json(manager.repo.write(game.id, req.params.sessionId || req.body?.sessionId, req.body?.title, req.body?.state, req.body?.revision));
});
router.post('/:gameId/sessions', save);
router.post('/:gameId/sessions/:sessionId', save);
router.delete('/:gameId/sessions/:sessionId', run(async (req, res) => {
  savePermission(req.params.gameId);
  manager.repo.deleteSession(req.params.gameId, req.params.sessionId);
  removeManaged(inside(MEDIA_DIR, req.params.gameId), req.params.sessionId);
  res.json({ ok: true });
}));
router.use('/:gameId/ext', run(async (req, res, next) => {
  manager.get(req.params.gameId);
  const { router: extension } = await manager.load(req.params.gameId);
  extension(req, res, next);
}));
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  if (status >= 500) console.error(`[games] ${req.method} ${req.path}:`, error.message);
  // Provider errors can echo credentials; preserve the host's 5xx boundary.
  res.status(status).json({ error: status < 500 ? error.message : error.gameMessage || '游戏服务执行失败，请查看邻舍运行日志后重试', code: error.gameCode });
});
return router;
}
export default createGameRoutes();

export function mountGameAssets(app, getManager = initGames) {
  const run = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, getManager())).catch(next);
  app.get('/docs/linshe_community_game_guide.md', (_req, res) => {
    res.type('text/plain; charset=utf-8').sendFile(fileURLToPath(new URL('../../../docs/linshe_community_game_guide.md', import.meta.url)));
  });
  app.get('/game-sdk.js', (_req, res) => res.type('application/javascript').sendFile(fileURLToPath(new URL('./linshe-game-sdk.js', import.meta.url))));
  app.get('/game-assets/:gameId/*', run((req, res, manager) => {
    const game = manager.get(req.params.gameId);
    const relative = req.params[0];
    // Serve front-end files only. Never expose server sources or scenario secrets.
    const webRoot = path.posix.dirname(game.manifest.entry);
    if ((webRoot !== '.' && !relative.startsWith(`${webRoot}/`)) || /(?:^|\/)(?:game\.json|server|scenarios|\.[^/]+|node_modules)(?:\/|$)/i.test(relative)) throw bad('游戏资源不可访问', 403);
    const file = regularFile(game.install_path, relative);
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (path.extname(file) === '.html') {
      const script = '<script src="/game-sdk.js"></script>';
      const html = fs.readFileSync(file, 'utf8');
      res.type('html').send(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => match + script) : script + html);
    } else res.sendFile(file);
  }));
  app.get('/game-media/:gameId/:sessionId/:filename', run((req, res, manager) => {
    manager.get(req.params.gameId);
    if (!manager.repo.session(req.params.gameId, req.params.sessionId)) throw bad('存档不存在', 404);
    if (!/^[\w-]+\.png$/.test(req.params.filename)) throw bad('无效的图片名称');
    res.sendFile(regularFile(MEDIA_DIR, `${req.params.gameId}/${req.params.sessionId}/${req.params.filename}`));
  }));
}
