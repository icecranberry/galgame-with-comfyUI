import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { EventEmitter } from 'node:events';
import { builtinModules } from 'node:module';
import { createGameRepository } from './gameRepository.js';
import { createGameBridge } from './gameBridge.js';
import { createGameServices } from './gameServices.js';
import { getTrpgCast, getTrpgPlayer } from './trpgProfiles.js';
import { standingSlots } from '../services/expressionStandingAssets.js';
import { ROOT_DIR, OFFICIAL_DIR, COMMUNITY_DIR, MEDIA_DIR, inside, validId, validateManifest, regularFile, removeManaged, bad } from './gamePaths.js';

export function createGameManager(db, { officialDir = OFFICIAL_DIR, communityDir = COMMUNITY_DIR, mediaDir = MEDIA_DIR, bridge = createGameBridge(db), services = createGameServices } = {}) {
  const repo = createGameRepository(db), plugins = new Map(), loading = new Map(), changing = new Set(), events = new EventEmitter();
  events.setMaxListeners(100);
  const appVersion = (() => { try { return fs.readFileSync(path.join(ROOT_DIR, 'VERSION'), 'utf8').trim(); } catch { return '0.0.0'; } })();
  function readManifest(dir, options) {
    const file = regularFile(dir, 'game.json');
    if (fs.statSync(file).size > 128 * 1024) throw bad('game.json 过大');
    const manifest = validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')), options);
    regularFile(dir, manifest.entry);
    if (manifest.serverEntry) {
      const code = fs.readFileSync(regularFile(dir, manifest.serverEntry), 'utf8');
      // Packaging check, not a Node.js security sandbox. Imported backend code is
      // trusted local code and still has Node's built-in filesystem capabilities.
      const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
      if (imports.some(specifier => !builtinModules.includes(specifier.replace(/^node:/, '')))) throw bad('后端插件须打包为单文件 ESM，仅允许 Node 内置模块依赖');
    }
    return manifest;
  }
  function compatible(manifest) {
    const minimum = (manifest.minAppVersion || '0.0.0').split('.').map(Number), actual = appVersion.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((actual[i] || 0) !== minimum[i]) return (actual[i] || 0) > minimum[i]; }
    return true;
  }
  const manifestOf = row => JSON.parse(row.manifest_json);
  function get(id, { disabled = false } = {}) {
    const row = repo.game(id);
    if (!row?.installed) throw bad('游戏未安装', 404);
    if (!disabled && (!row.enabled || changing.has(id))) throw bad('游戏已停用或正在更新', 409);
    const manifest = manifestOf(row);
    if (!disabled && !compatible(manifest)) throw bad(`此游戏需要邻舍 ${manifest.minAppVersion} 或更高版本`, 409);
    return { ...row, manifest };
  }
  function publicGame(row) {
    const manifest = manifestOf(row);
    return { ...manifest, source: row.source, repoUrl: row.repo_url, enabled: !!row.enabled, compatible: compatible(manifest),
      entryUrl: `/game-assets/${row.id}/${manifest.entry}`, coverUrl: manifest.cover ? `/game-assets/${row.id}/${manifest.cover}` : null };
  }
  const hasDataDirectory = id => fs.existsSync(inside(mediaDir, id));
  const occupied = id => repo.claims(id).filter(row =>
    row.source === 'official' || row.installed || row.has_sessions || hasDataDirectory(row.id));

  function communityInstallStatus(id, { source, repoUrl, zipFingerprint }) {
    const owners = occupied(id);
    if (owners.some(row => row.source === 'official') || fs.existsSync(inside(officialDir, id))) return 'official';
    if (!owners.length) return hasDataDirectory(id) ? 'conflict' : 'available';
    const [owner] = owners;
    if (owners.length > 1 || owner.id !== id || owner.source !== source) return 'conflict';
    const sameSource = source === 'github'
      ? repoUrl && owner.repo_url?.toLowerCase() === repoUrl.toLowerCase()
      : zipFingerprint && owner.zip_fingerprint === zipFingerprint;
    if (!sameSource) return 'conflict';
    return owner.installed ? 'installed' : 'available';
  }

  function scan() {
    const errors = [];
    for (const [root, source] of [[officialDir, 'official'], [communityDir, 'zip']]) {
      if (!fs.existsSync(root)) continue;
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        if (!item.isDirectory() || item.name.startsWith('.')) continue;
        try {
          validId(item.name);
          const old = repo.game(item.name);
          const dir = inside(root, item.name), manifest = readManifest(dir, { allowMissingNsfw: Boolean(old?.installed) });
          if (manifest.id !== item.name) throw bad('目录名与游戏编号不一致');
          if (source !== 'official' && old?.source === 'official') throw bad('社区包不能覆盖官方游戏');
          const official = source === 'official';
          const conflict = occupied(manifest.id).some(row =>
            row.id !== manifest.id || (row.source === 'official') !== official || (!official && !row.installed));
          if (conflict || (!old && hasDataDirectory(manifest.id))) throw bad('游戏 ID 冲突，无法确认本地目录与保留数据的来源一致', 409);
          // An existing install may be rescanned in place. A newly found folder
          // cannot claim the origin of a previously uninstalled package.
          const current = old?.installed ? old : null;
          repo.register(manifest, official ? source : current?.source || source, dir, current?.repo_url, current?.zip_fingerprint);
        } catch (error) { errors.push(`${item.name}: ${error.message}`); }
      }
    }
    return errors;
  }
  function context(id) {
    const game = get(id);
    const assertPermission = permission => {
      if (!get(id).manifest.permissions.includes(permission)) throw bad(`游戏没有声明 ${permission} 权限`, 403);
    };
    const host = services(id, repo, assertPermission);
    const gameDataDir = inside(mediaDir, validId(id));
    fs.mkdirSync(gameDataDir, { recursive: true });
    return { gameId: id, gameDataDir, events: { emit: (type, data) => events.emit('update', { gameId: id, type, data }) },
      bridgeTools: { definitions: bridge.definitions, call: (...args) => { assertPermission('bridge:read'); return bridge.call(...args); } },
      ...host,
      // A scoped repository instead of the application's unrestricted SQLite handle.
      db: { list: () => { assertPermission('save:rw'); return repo.sessions(id); }, load: sessionId => { assertPermission('save:rw'); return repo.session(id, sessionId); }, write: (...args) => { assertPermission('save:rw'); return repo.write(id, ...args); } },
      scenarios: () => {
        const dir = path.join(game.install_path, 'scenarios');
        return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^[\w-]+\.json$/.test(n)).map(n => JSON.parse(fs.readFileSync(regularFile(game.install_path, `scenarios/${n}`), 'utf8'))) : [];
      },
      // Long-term memory is an explicit end-of-game operation of the official
      // simulator, never exposed as a generic bridge capability or REST SDK call.
      ...(game.source === 'official' && id === 'trpg-simulator' ? {
        playerProfile: getTrpgPlayer,
        expressionSlots: () => standingSlots(db),
        castAssets: () => { assertPermission('bridge:read'); return getTrpgCast(db); },
        async remember(sessionId, investigators, title, summary) {
          if (!repo.session(id, sessionId)) throw bad('存档不存在', 404);
          const { applyMemoryActions } = await import('../services/memory/memoryRepository.js');
          for (const c of investigators) if (Number.isSafeInteger(c.characterId)) applyMemoryActions({ conversationId: `char_${c.characterId}`, sourceRawStartId: null, sourceRawEndId: null,
            dedupeKey: `game:${id}:${sessionId}`, actions: [{ action: 'create', memory: { memoryType: 'event', subject: 'character',
              judgment: `和伙伴们游玩了桌游／剧本杀《${title}》。这是虚构游戏经历，不能当作现实遭遇。${summary}`.slice(0, 2000), tags: ['桌游', '跑团', title], importance: 2 } }] });
        },
      } : {}),
    };
  }
  async function load(id) {
    if (plugins.has(id)) return plugins.get(id);
    if (loading.has(id)) return loading.get(id);
    const game = get(id);
    const promise = (async () => {
      const router = Router();
      const originalRoute = router.route.bind(router);
      router.route = (...args) => {
        const route = originalRoute(...args);
        if (!route.gameWrapped) {
          route.gameWrapped = true;
          for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'head', 'options']) {
            const register = route[method].bind(route);
            const wrap = handler => Array.isArray(handler) ? handler.map(wrap) : typeof handler !== 'function' || handler.length === 4 ? handler
              : (req, res, next) => { try { Promise.resolve(handler(req, res, next)).catch(next); } catch (error) { next(error); } };
            route[method] = (...handlers) => register(...handlers.map(wrap));
          }
        }
        return route;
      };
      // Wrap at registration time, including handlers added after initialization.
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'use']) {
        const register = router[method].bind(router);
        const wrap = handler => Array.isArray(handler) ? handler.map(wrap) : typeof handler !== 'function' || handler.length === 4 ? handler
          : (req, res, next) => { try { Promise.resolve(handler(req, res, next)).catch(next); } catch (error) { next(error); } };
        router[method] = (...args) => register(...args.map(wrap));
      }
      let lifecycle, pluginContext;
      if (game.manifest.serverEntry) {
        const file = regularFile(game.install_path, game.manifest.serverEntry);
        const module = await import(`${pathToFileURL(file).href}?generation=${Date.now()}-${Math.random()}`);
        if (typeof module.default !== 'function') throw bad('游戏后端必须默认导出注册函数');
        pluginContext = context(id);
        try { lifecycle = await module.default({ ...pluginContext, router }); }
        catch (error) { pluginContext.dispose?.(); throw error; }
        lifecycle = { onUnload: lifecycle?.onUnload || module.onUnload };
      }
      const plugin = { router, lifecycle, dispose: pluginContext?.dispose };
      plugins.set(id, plugin); return plugin;
    })().finally(() => loading.delete(id));
    loading.set(id, promise); return promise;
  }
  async function unload(id) {
    if (loading.has(id)) await loading.get(id);
    const plugin = plugins.get(id);
    try { if (plugin?.lifecycle?.onUnload) await plugin.lifecycle.onUnload(); }
    finally { plugin?.dispose?.(); plugins.delete(id); }
  }
  async function uninstall(id, clearData = true) {
    const row = get(id, { disabled: true });
    if (row.source === 'official') throw bad('官方游戏随主程序更新，可停用但不能卸载');
    if (changing.has(id)) throw bad('游戏正在进行其他操作，请稍后重试', 409);
    changing.add(id);
    try {
      await unload(id);
      removeManaged(communityDir, id);
      db.transaction(() => {
        if (clearData) db.prepare('DELETE FROM game_sessions WHERE game_id=?').run(id);
        db.prepare('UPDATE installed_games SET installed=0 WHERE id=?').run(id);
      })();
      if (clearData) removeManaged(mediaDir, id);
    } finally { changing.delete(id); }
  }
  return { repo, scan, get, readManifest, compatible, publicGame, communityInstallStatus, context, load, unload, uninstall, changing, events, officialDir, communityDir,
    async enable(id, enabled) {
      get(id, { disabled: true });
      if (changing.has(id)) throw bad('游戏正在进行其他操作，请稍后重试', 409);
      changing.add(id);
      try { if (!enabled) await unload(id); db.prepare('UPDATE installed_games SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id); return publicGame(repo.game(id)); }
      finally { changing.delete(id); }
    },
    async close() { for (const id of new Set([...plugins.keys(), ...loading.keys()])) await unload(id); },
  };
}
