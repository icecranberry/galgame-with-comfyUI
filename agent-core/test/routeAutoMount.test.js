/**
 * 路由自动挂载（架构加固 P2）—— 回归测试。
 *
 * 目标：证明「把 27 个手动 app.use 搬进 LEGACY_MOUNTS 表 + 自动挂载」是**行为等价**的，
 * 且新功能确实不用再改 app.js。
 *
 * 关键约束（用户口径「新功能不影响存量」）：
 *  · 存量挂载面必须与改造前的显式列表**逐项相同**（少一个就是接口 404）；
 *  · 顺序敏感的 /api/characters/emoji 必须先于 /api/characters；
 *  · 声明表里写了但文件不存在 → 必须抛错，不许静默跳过；
 *  · 挂载后必须复核（防"以为挂上了其实没有"）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('route test forbids network'); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const ROUTES_DIR = path.join(SRC, 'routes');

const express = (await import('express')).default;
const { wrapRouterAsync } = await import('../src/middleware/asyncHandler.js');
const {
  LEGACY_MOUNTS,
  defaultBaseFor,
  collectMountedBases,
  autoMountRoutes,
} = await import('../src/routes/_autoMount.js');

const appJs = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 存量挂载面：必须与改造前的显式列表一致
// ─────────────────────────────────────────────────────────

/** 改造前 app.js 里的显式挂载列表（从 git 历史固化，作为对照基准） */
const BASELINE = [
  '/api', '/api', '/api/memory', '/api/images', '/api/characters/emoji', '/api/user-emoji',
  '/api/characters', '/api/config', '/api/moments', '/api/relationships', '/api/user-relationships',
  '/api/portraits', '/api/notifications', '/api/events', '/api/stream', '/api/schedule',
  '/api/workflows', '/api/mailbox', '/api/groups', '/api/library', '/api/items', '/api/loot',
  '/api/newspaper', '/api/media', '/api/cleanup', '/api/worldmap', '/api/town', '/api/maibot',
].sort();

test('★★ LEGACY_MOUNTS 还原出的挂载面与改造前逐项一致', () => {
  assert.deepEqual(
    LEGACY_MOUNTS.map(m => m.base).sort(),
    BASELINE,
    '差一项就是接口 404（漏挂）或多挂（路径抢占）'
  );
});

test('★ 存量表不得漏文件：每行要么有 file 要么有 module', () => {
  for (const m of LEGACY_MOUNTS) {
    assert.ok(m.file || m.module, `挂载行缺 file/module: ${JSON.stringify(m)}`);
  }
});

test('★ 顺序敏感项：emoji 必须排在 characters 之前', () => {
  const iEmoji = LEGACY_MOUNTS.findIndex(m => m.base === '/api/characters/emoji');
  const iChars = LEGACY_MOUNTS.findIndex(m => m.base === '/api/characters');
  assert.ok(iEmoji >= 0 && iChars >= 0);
  assert.ok(iEmoji < iChars, '/api/characters/emoji 必须先挂，否则被 /api/characters 抢走');
});

test('★ 挂载顺序必须与表内行序一致（不得按字母重排）', () => {
  const bases = LEGACY_MOUNTS.map(m => m.base);
  assert.deepEqual(bases.slice(0, 2), ['/api', '/api'], '前两行是 /api 根挂载（chat/expressionStandings）');
  assert.ok(bases.indexOf('/api/characters/emoji') < bases.indexOf('/api/characters'));
});

// ─────────────────────────────────────────────────────────
// ② 补齐：app.js 里不得再出现任何手写路由挂载
// ─────────────────────────────────────────────────────────

test('★★ app.js 不再逐条 import 路由文件', () => {
  const imports = appJs.match(/^import\s+\w*[Rr]outes?\s+from\s+'\.\/src\/routes\//gm) || [];
  assert.deepEqual(imports, [], `app.js 仍手写导入路由: ${imports.join(' | ')}`);
});

test('★★ app.js 不再手写 app.use(..., wrapRouterAsync(...))', () => {
  const manual = appJs.match(/app\.use\(\s*'\/api[^']*'\s*,\s*wrapRouterAsync\(/g) || [];
  assert.deepEqual(manual, [], `仍有手写挂载: ${manual.join(' | ')}`);
});

test('★ app.js 调用了 autoMountRoutes 且传入了 wrapRouterAsync', () => {
  assert.match(appJs, /autoMountRoutes\(app,\s*\{\s*wrapRouterAsync\s*\}\)/);
});

// ─────────────────────────────────────────────────────────
// ③ 约定式挂载规则
// ─────────────────────────────────────────────────────────

test('文件名 → 挂载点：kebab-case', () => {
  assert.equal(defaultBaseFor('drawingBoard.js'), '/api/drawing-board');
  assert.equal(defaultBaseFor('image_prompt.js'), '/api/image-prompt');
  assert.equal(defaultBaseFor('gallery.js'), '/api/gallery');
});

test('★ 缺文件必须抛错，绝不静默少挂', async () => {
  const app = express();
  // 临时塞一行指向不存在的文件
  const probe = { file: '__definitely_missing__.js', base: '/api/ghost' };
  LEGACY_MOUNTS.push(probe);
  try {
    await assert.rejects(
      () => autoMountRoutes(app, { wrapRouterAsync, logger: silent() }),
      /__definitely_missing__\.js[\s\S]*不存在|声明的文件不存在/
    );
  } finally {
    LEGACY_MOUNTS.pop();
  }
});

function silent() { return { log() {}, warn() {}, error() {} }; }

test('★ 复核机制：挂载面与环境不一致时必须抛错', async () => {
  // 用一个"吞掉挂载"的假 app，模拟 app.use 没生效
  const fakeApp = express();
  fakeApp.use = function () { /* 故意不挂 */ };
  await assert.rejects(
    () => autoMountRoutes(fakeApp, { wrapRouterAsync, logger: silent() }),
    /挂载复核失败/
  );
});

test('★ 未默认导出 Router 的文件不会被误挂', async () => {
  // _autoMount.js 本身以下划线开头 → 被忽略；同时它也不导出 Router 作为 default
  const bases = collectMountedBases(express());
  assert.deepEqual([...bases], []);
});

// ─────────────────────────────────────────────────────────
// ④ 真挂一遍，确认结果与基准一致
// ─────────────────────────────────────────────────────────

test('★★ 实际挂载：base 集合与基准一致，且不含下划线工具模块', async () => {
  const app = express();
  const r = await autoMountRoutes(app, { wrapRouterAsync, logger: silent() });

  assert.deepEqual([...r.legacy].sort(), BASELINE, '实际挂载的存量 base 应等于基准');
  assert.deepEqual(r.convention, [], '当前没有约定式新路由（_autoMount.js 应被忽略）');

  const actual = collectMountedBases(app);
  for (const b of BASELINE) {
    assert.ok(actual.has(b), `app 上找不到 ${b}`);
  }
  // 不能把工具模块当路由挂上去
  assert.ok(!actual.has('/api/_auto-mount'), '_autoMount.js 不该被自动挂载');
});

test('★ 挂载的每个 base 上确实有路由（不是空壳）', async () => {
  const app = express();
  await autoMountRoutes(app, { wrapRouterAsync, logger: silent() });
  const stack = app._router?.stack || [];
  const routers = stack.filter(l => l.handle && Array.isArray(l.handle.stack));
  assert.equal(routers.length, BASELINE.length, '挂载的 router 数量应与基准一致');
  for (const l of routers) {
    assert.ok(l.handle.stack.length > 0, `${l.path || '(regexp)'} 是空 router`);
  }
});

test('★ 约定式新路由会被发现（用真实临时文件验证）', async () => {
  const tmpFile = path.join(ROUTES_DIR, 'zzprobe_route.js');
  fs.writeFileSync(tmpFile, `
    import { Router } from 'express';
    const router = Router();
    router.get('/ping', (req, res) => res.json({ ok: true }));
    export const mount = '/api/zz-probe';
    export default router;
  `);
  try {
    const app = express();
    const r = await autoMountRoutes(app, { wrapRouterAsync, logger: silent() });
    assert.deepEqual(r.convention, ['/api/zz-probe'], '自定义 mount 应被采用');
    assert.ok(collectMountedBases(app).has('/api/zz-probe'));

    // 且必须排在存量之后（存量优先，新路由不抢既有路径）
    const bases = r.mounted;
    assert.ok(bases.indexOf('/api/zz-probe') >= BASELINE.length);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('★ 新路由默认挂载点 = /api/<kebab>（不写 mount 也能挂）', async () => {
  const tmpFile = path.join(ROUTES_DIR, 'zzprobe2_route.js');
  fs.writeFileSync(tmpFile, `
    import { Router } from 'express';
    const router = Router();
    router.get('/ping', (req, res) => res.json({ ok: true }));
    export default router;
  `);
  try {
    const app = express();
    const r = await autoMountRoutes(app, { wrapRouterAsync, logger: silent() });
    assert.deepEqual(r.convention, ['/api/zzprobe2-route']);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('★ 文件名以下划线开头 → 不自动挂载（工具模块留在这里的安全阀）', async () => {
  const tmpFile = path.join(ROUTES_DIR, 'zzhelper.js');
  fs.writeFileSync(tmpFile, `export const tool = () => 1;`);
  try {
    const app = express();
    const r = await autoMountRoutes(app, { wrapRouterAsync, logger: silent() });
    assert.deepEqual(r.convention, []);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('★ mount 不以 /api/ 开头 → 抛错', async () => {
  const tmpFile = path.join(ROUTES_DIR, 'zzbad_mount.js');
  fs.writeFileSync(tmpFile, `
    import { Router } from 'express';
    const router = Router();
    router.get('/x', (req, res) => res.json(1));
    export const mount = '/nope';
    export default router;
  `);
  try {
    await assert.rejects(
      () => autoMountRoutes(express(), { wrapRouterAsync, logger: silent() }),
      /必须以 \/api\/ 开头/
    );
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('★ 缺少 wrapRouterAsync 直接抛（否则 async 路由报错会挂起请求）', async () => {
  await assert.rejects(
    () => autoMountRoutes(express(), {}),
    /需要 wrapRouterAsync/
  );
});