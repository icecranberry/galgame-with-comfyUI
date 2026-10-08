// 路由自动挂载（架构加固 P2）—— 让"新功能"不再改 app.js。
//
// ── 设计：存量白名单 + 新文件约定式，两条路分开 ──────────────
// 为什么不用"全部按约定自动挂"一招？
//   现有 27 个路由文件的挂载点**不是**文件名的机械映射：
//     · `expressionStandings` / `chat` 挂在 `/api` 根（路径里带 /characters/:id）
//     · `emoji` 挂在 `/api/characters/emoji`（必须早于 `/api/characters` 挂载）
//     · `worldMap` 挂 `/api/worldmap`（无驼峰），`userEmoji` 挂 `/api/user-emoji`
//   强行反推 = 改行为。所以存量走**显式表**（LEGACY_MOUNTS），一字不差地保留，
//   从此不再新增条目；**新功能走约定式**，文件名 → `/api/<kebab>`，零改动。
//
// ── 给后续新增路由的约定（不需要动本文件）──────────────────
//   1. 在 `src/routes/` 建 `<名字>.js`，默认导出 Express Router。
//   2. 挂载点默认 = `/api/` + 文件名的 kebab-case
//      （`drawingBoard.js` → `/api/drawing-board`）。
//   3. 要自定义挂载点，在**你自己的文件**里写：
//        export const mount = '/api/draw';
//      仍然不用动本文件、更不用动 app.js。
//   4. 不想被自动挂载（纯工具模块放这目录）→ 文件名以 `_` 开头。
//
// ── 三条不可回退的约定 ──────────────────────────────────
// ① **声明的文件必须存在**：LEGACY_MOUNTS 里写了的文件找不到就抛错。
//    少挂一个路由 = 接口集体 404，静默降级代价太大（红线 0）。
// ② **挂载后必须复核**：复核 app 的实际挂载面与声明表逐项一致，
//    不一致就抛。防"改了代码以为生效了，其实被静默跳过"。
// ③ **顺序按声明表**：`/api/characters/emoji` 必须在 `/api/characters` 之前，
//    表里的行序就是挂载序，不要按字母重排。

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 存量挂载表 —— **只读，不要再加行**。行序 = 挂载序。
 * 新路由请走约定式（见文件头说明）。
 */
export const LEGACY_MOUNTS = [
  { file: 'expressionStandings.js', base: '/api', note: '立绘/表情状态：路径自带 /characters/:id' },
  { file: 'chat.js', base: '/api', note: '/api/characters/:id/chat、/api/characters/:id/messages' },
  { file: 'memory.js', base: '/api/memory' },
  { file: 'images.js', base: '/api/images' },
  // ⚠ 必须早于 characters.js（同前缀更长的先挂）
  { file: 'emoji.js', base: '/api/characters/emoji', note: '表情包管理（必须早于 /api/characters）' },
  { file: 'userEmoji.js', base: '/api/user-emoji' },
  { file: 'characters.js', base: '/api/characters' },
  { file: 'config.js', base: '/api/config' },
  { file: 'moments.js', base: '/api/moments' },
  { file: 'relationships.js', base: '/api/relationships' },
  { file: 'userRelationships.js', base: '/api/user-relationships' },
  { file: 'portraits.js', base: '/api/portraits' },
  { file: 'notifications.js', base: '/api/notifications' },
  { file: 'events.js', base: '/api/events' },
  { file: 'stream.js', base: '/api/stream' },
  { file: 'schedule.js', base: '/api/schedule' },
  { file: 'workflows.js', base: '/api/workflows' },
  { file: 'mailbox.js', base: '/api/mailbox' },
  { file: 'groups.js', base: '/api/groups' },
  { file: 'library.js', base: '/api/library' },
  { file: 'items.js', base: '/api/items' },
  { file: 'loot.js', base: '/api/loot' },
  { file: 'newspaper.js', base: '/api/newspaper' },
  { file: 'media.js', base: '/api/media' },
  { file: 'cleanup.js', base: '/api/cleanup' },
  { file: 'worldMap.js', base: '/api/worldmap', note: '注意：URL 无驼峰' },
  { file: 'town.js', base: '/api/town' },
  // 不在此目录，但同样纳入本表 —— 免得"路由有两处入口"的认知负担
  { module: '../maibot-bridge/router.js', base: '/api/maibot' },
];

/** 被忽略的文件（不自动挂载） */
const IGNORED_PATTERNS = [
  /^_/,              // 下划线开头 = 该目录下的工具模块
  /\.test\.js$/,     // 同目录测试
];

/** 文件名 → 默认挂载点：/api + kebab-case 文件名 */
export function defaultBaseFor(basename) {
  const stem = basename.replace(/\.js$/, '');
  const kebab = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
  return `/api/${kebab}`;
}

/**
 * 扫描 routes/ 下"未被存量表覆盖"的新文件，按约定算出挂载点。
 * 返回 [{file, base, module, source:'convention'}] 或带自定义 mount 的 [{...,source:'declared'}]。
 */
export async function discoverConventionRoutes() {
  const legacyFiles = new Set(LEGACY_MOUNTS.map(m => m.file).filter(Boolean));
  let entries = [];
  try {
    entries = fs.readdirSync(__dirname, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.js')) continue;
    if (legacyFiles.has(e.name)) continue;
    if (IGNORED_PATTERNS.some(re => re.test(e.name))) continue;

    // 必须是能导出 Router 的模块；用动态 import 判断（顺带把文件加载了）
    const mod = await import(pathToFileURL(path.join(__dirname, e.name)).href);
    const router = mod.default;
    if (!isRouter(router)) continue;   // 不是 Router 的文件静默跳过（如共享常量）

    const declared = typeof mod.mount === 'string' ? mod.mount.trim() : '';
    const base = declared || defaultBaseFor(e.name);
    if (!base.startsWith('/api/')) {
      throw new Error(`[routes] ${e.name} 的 mount 必须以 /api/ 开头，实得: ${declared}`);
    }
    found.push({
      file: e.name,
      base: base.replace(/\/$/, ''),
      modulePath: pathToFileURL(path.join(__dirname, e.name)).href,
      source: declared ? 'declared' : 'convention',
    });
  }
  return found;
}

/** Express Router 判定：路由对象有 stack 数组、且自身是函数 */
function isRouter(v) {
  return typeof v === 'function' && Array.isArray(v.stack);
}

/**
 * 取 app 的路由栈（跨 express 版本）。
 * ⚠ express 4 里访问 `app.router` 在 `_router` 未定义时会**抛错**（不只是打警告），
 *   所以必须先探 `_router`，兜底那步包 try。
 */
function appStack(app) {
  if (Array.isArray(app._router?.stack)) return app._router.stack;
  try { return app.router?.stack || []; } catch { return []; }
}

/** 从 app 的挂载栈里取出所有 router 的 base path（用于复核） */
export function collectMountedBases(app) {
  const stack = appStack(app);
  const bases = new Set();
  const decode = (src) => {
    // regexp.source 里是**字面反斜杠**，形如 ^\/api\/foo\/?(?=\/|$)
    // ① 去头 ^  ② 去尾 \/?(?=\/|$)  ③ 反转义 \x → x
    let s = String(src || '').replace(/^\^/, '');
    s = s.replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
    s = s.replace(/\\(.)/g, '$1');
    return s.replace(/\/$/, '');
  };
  for (const layer of stack) {
    if (!(layer.handle && Array.isArray(layer.handle.stack))) continue;
    if (layer.path) { bases.add(String(layer.path).replace(/\/$/, '') || '/'); continue; }
    if (layer.regexp) {
      const p = decode(layer.regexp.source);
      bases.add(p || '/');
    }
  }
  return bases;
}

/**
 * 自动挂载全部路由（存量按表 + 新文件按约定）。
 *
 * @param {import('express').Express} app
 * @param {{wrapRouterAsync:Function, logger?:Pick<Console,'log'|'warn'|'error'>}} deps
 * @returns {Promise<{legacy:string[], convention:string[], mounted:string[]}>}
 */
export async function autoMountRoutes(app, deps = {}) {
  const log = deps.logger || console;
  const wrap = deps.wrapRouterAsync;
  if (typeof wrap !== 'function') {
    throw new Error('[routes] autoMountRoutes 需要 wrapRouterAsync（否则 async 路由报错会挂起请求）');
  }

  const result = { legacy: [], convention: [], mounted: [] };
  const plan = [];

  // ① 存量表：文件必须存在，缺一个就抛（少挂 = 接口集体 404）
  for (const m of LEGACY_MOUNTS) {
    const relOrAbs = m.module || `./${m.file}`;
    const abs = m.module
      ? path.resolve(__dirname, m.module)
      : path.join(__dirname, m.file);
    if (!fs.existsSync(abs)) {
      throw new Error(`[routes] 存量挂载表声明的文件不存在: ${relOrAbs}（少挂路由会导致接口 404，拒绝启动）`);
    }
    plan.push({ ...m, abs, href: pathToFileURL(abs).href, source: 'legacy' });
  }

  // ② 约定式：新文件
  const extra = await discoverConventionRoutes();
  for (const e of extra) {
    plan.push({ ...e, href: e.modulePath, abs: path.join(__dirname, e.file) });
  }

  // ③ 挂载
  for (const p of plan) {
    const mod = await import(p.href);
    const router = mod.default;
    if (!isRouter(router)) {
      throw new Error(`[routes] ${p.file || p.module} 未默认导出 Express Router`);
    }
    app.use(p.base, wrap(router));
    result.mounted.push(p.base);
    if (p.source === 'legacy') result.legacy.push(p.base);
    else {
      result.convention.push(p.base);
      log.log(`[routes] 自动挂载新路由 ${p.base} ← ${p.file} (${p.source === 'declared' ? '自定义 mount' : '约定'})`);
    }
  }

  // ④ 复核：声明的挂载点必须真的出现在 app 上
  const actual = collectMountedBases(app);
  const missing = result.mounted.filter(b => !actual.has(b));
  if (missing.length) {
    throw new Error(`[routes] 挂载复核失败，以下 base 未出现在 app 挂载栈上: ${missing.join(', ')}`);
  }

  return result;
}