/**
 * 「绘图」功能页 —— 回归测试。
 *
 * 用户口径（2026-10-06）：
 *  ① 标签库要能**弹窗**用（原内嵌面板"视觉上很难用"）；
 *  ② 生图 TAG 自由组合应当**独立成一个功能页**，从左侧栏进；
 *  ③ 角色页只保留**人物身体设计**类标签，动作/状态类都搬到本页。
 *
 * 本测试守：
 *  · 绘图页确实存在、路由与左侧栏导航已接上（新增导航项不需要改 indicator —— 它按路由段推导）；
 *  · 词库档位真源在服务端：`mode=body` 与 `mode=draw` 走**同一份分家配置**，
 *    且 draw ⊇ body（绘图页必须是全量，否则"自由组合"就是假的）；
 *  · 角色页组件**不再**自带分类名单（防两处分家配置分叉）；
 *  · 生图复用既有链路，不新增后端路由（防重复实现）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`draw test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

const drawView = fs.readFileSync(path.join(WEB_SRC, 'views/DrawView.vue'), 'utf8');
const mainJs = fs.readFileSync(path.join(WEB_SRC, 'main.js'), 'utf8');
const navBar = fs.readFileSync(path.join(WEB_SRC, 'components/NavBar.vue'), 'utf8');
const sidebar = fs.readFileSync(path.join(WEB_SRC, 'components/Sidebar.vue'), 'utf8');
const apiSrc = fs.readFileSync(path.join(WEB_SRC, 'api/index.js'), 'utf8');
const picker = fs.readFileSync(path.join(WEB_SRC, 'components/AppearanceTraitPicker.vue'), 'utf8');
const charactersRoute = fs.readFileSync(path.join(SRC, 'routes/characters.js'), 'utf8');
const partitionSrc = fs.readFileSync(path.join(SRC, 'db/appearanceTagPartition.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 页面 / 路由 / 导航
// ─────────────────────────────────────────────────────────

test('★★ 绘图页存在，且已在路由表中注册', () => {
  assert.match(mainJs, /import DrawView from '\.\/views\/DrawView\.vue'/, 'main.js 应导入 DrawView');
  assert.match(mainJs, /\{\s*path:\s*'\/draw',\s*component:\s*DrawView\s*\}/, '应有 /draw 路由');
});

test('★★ 左侧栏有「绘图」入口（桌面导航 + 移动端更多菜单都要有）', () => {
  // 用 router-link 起点 + 宽松窗口扫到 nav-label（中间隔着 SVG 图标，别把窗口卡太紧）
  assert.match(navBar, /to="\/draw"[\s\S]{0,900}?nav-label">绘图</, 'NavBar 缺少绘图入口');
  assert.match(sidebar, /to="\/draw"[\s\S]{0,600}?<span>绘图<\/span>/, '移动端更多菜单缺少绘图入口');
});

test('★ 新增导航项不需要改指示器推导（段名即键）', () => {
  // activeNavKey 从路径首段推导；/draw → 'draw'，与 data-nav="draw" 匹配
  assert.match(navBar, /data-nav="draw"/, '必须有 data-nav="draw"，否则指示器匹配不到会隐藏');
  assert.match(navBar, /const SEG_ALIAS[\s\S]{0,120}?route\.path\.split\('\/'\)\[1\]/,
    '指示器必须仍走"段名即键"推导（新增导航项不该需要改这里）');
});

// ─────────────────────────────────────────────────────────
// ② 词库分家：真源唯一 + draw 必须覆盖 body
// ─────────────────────────────────────────────────────────

test('★★ 分家真源唯一：路由与前端都不自带分类名单', () => {
  // 服务端路由只做透传，判定交给唯一真源
  assert.match(charactersRoute, /listAppearanceTraitCatalog\(\{\s*mode\s*\}\)/,
    '路由应把 mode 直接交给 listAppearanceTraitCatalog，不自行过滤');
  assert.match(charactersRoute, /mode\s*===\s*'draw'\s*\?\s*'draw'\s*:\s*'body'/,
    '只认 body/draw 两档，其余一律回落 body');
  // 前端选择器不自带名单
  assert.ok(!/const TRAIT_SECTIONS/.test(picker), '前端不得再维护分类名单（会与服务端分叉）');
});

test('★★ 两个档位强制**同一份**分家配置（防各写一套）', () => {
  // listAppearanceTraitCatalog 必须把 mode 透传给唯一的过滤判定
  const tagSrc = fs.readFileSync(path.join(SRC, 'db/imagePromptTagKnowledgeData.js'), 'utf8');
  assert.match(tagSrc, /listAppearanceTraitCatalog/, '应导出 listAppearanceTraitCatalog');
  assert.match(tagSrc, /isBodyDesignTag|appearanceTagPartition/,
    '必须调用唯一真源的判定函数，不得内联另一套规则');
});

test('★★ draw 词库必须严格覆盖 body（绘图页要的是全量，不是另一个子集）', async () => {
  const { listAppearanceTraitCatalog } = await import('../src/db/imagePromptTagKnowledgeData.js');

  const count = (mode) => listAppearanceTraitCatalog({ mode })
    .reduce((n, s) => n + s.groups.reduce((m, g) => m + g.tags.length, 0), 0);

  const body = count('body');
  const draw = count('draw');

  assert.ok(body > 0, 'body 档不能为空');
  assert.ok(draw > body, `draw(${draw}) 必须严格多于 body(${body})，否则绘图页拿不到动作/状态词`);
  assert.ok(draw > 2000, `draw 应接近全量词库，实测只有 ${draw}`);

  // 逐项包含：body 的每个 tag 都必须出现在 draw 里
  const flatten = (mode) => {
    const set = new Set();
    for (const s of listAppearanceTraitCatalog({ mode })) {
      for (const g of s.groups) for (const t of g.tags) set.add(t.tag);
    }
    return set;
  };
  const b = flatten('body');
  const d = flatten('draw');
  const missing = [...b].filter(t => !d.has(t));
  assert.deepEqual(missing, [], `body 中有 ${missing.length} 个 tag 没进 draw：${missing.slice(0, 8).join(', ')}`);
});

test('★ 分家配置本身不得把「身体特征」整段移出（那是角色页的立身之本）', () => {
  assert.match(partitionSrc, /FULLY_KEPT_SECTIONS[\s\S]{0,200}?身体特征/,
    '「身体特征」应在整段保留白名单里');
});

// ─────────────────────────────────────────────────────────
// ③ 前端接线：复用既有生图链路，不新增后端路由
// ─────────────────────────────────────────────────────────

test('★★ 绘图页复用既有生图接口，不新增后端路由', () => {
  assert.match(drawView, /api\.testStyle\(/, '应复用 test-style 链路');
  // 不得出现只有绘图页用的新端点（如 /images/draw）
  assert.ok(!/request\(['"`]\/images\/draw/.test(apiSrc), '不该新增 /images/draw 专用端点');
});

test('★ API 封装支持 mode=draw（与角色页共用同一函数，靠参数区分）', () => {
  assert.match(apiSrc, /export function getAppearanceTraitCatalog\(mode\)/,
    'getAppearanceTraitCatalog 应接受 mode 参数');
  assert.match(apiSrc, /mode === 'draw' \? '\?mode=draw' : ''/, 'draw 档应拼上 query');
});

test('★ 选择器组件把 mode 透传给接口（角色页/绘图页同一实现）', () => {
  assert.match(picker, /mode:\s*\{\s*type:\s*String,\s*default:\s*'body'\s*\}/,
    'picker 应有 mode prop，默认 body（角色页口径）');
  assert.match(picker, /api\.getAppearanceTraitCatalog\(props\.mode\)/,
    'picker 应把 mode 透传给接口');
  assert.match(drawView, /<AppearanceTraitPicker[\s\S]{0,300}?mode="draw"/,
    '绘图页应显式传 mode="draw"');
});

test('★ 绘图页点选标签写进画面描述（不是另立一份真源）', () => {
  assert.match(drawView, /function syncTagsIntoDesc/, '应有"标签→描述"的同步逻辑');
  const i = drawView.indexOf('function syncTagsIntoDesc');
  const seg = drawView.slice(i, i + 700);
  assert.match(seg, /sceneDesc\.value\s*=/, '必须写入 sceneDesc（真源）');
  assert.match(seg, /includes\(/, '必须跳过已存在的标签（不重复追加）');
});

test('★ 提交条件：有描述或有标签才可生成（空输入不许提交）', () => {
  assert.match(drawView, /const canSubmit = computed\([\s\S]{0,200}?sceneDesc\.value\.trim\(\)\s*\|\|\s*pickedTags\.value\.length/,
    'canSubmit 应要求描述或标签非空');
  assert.match(drawView, /:disabled="!canSubmit"/, '按钮应绑定 canSubmit');
});

test('★★ 图片地址必须兼容 base64 返回（test-style 不给 url 字段）', () => {
  // 实测该接口返回 { base64, filename }；只认 url 会"生成成功但画面空白"
  assert.match(drawView, /function toImageSrc/, '应有统一的图片地址取值函数');
  const i = drawView.indexOf('function toImageSrc');
  const seg = drawView.slice(i, i + 500);
  assert.match(seg, /base64/, '必须优先取 base64');
  assert.match(seg, /url/, '兼底保留 url 形态');
  // 两处赋值都必须走同一个取值器（不许一处写 url 一处写 base64）
  const raw = drawView.match(/images\.value = \(res\.images \|\| \[\]\)\.map\(([^)]*)\)/g) || [];
  assert.ok(raw.length >= 2, `应有两处图片赋值，实测 ${raw.length}`);
  for (const line of raw) {
    assert.match(line, /toImageSrc/, `图片赋值必须走 toImageSrc，实测: ${line}`);
  }
});

// ─────────────────────────────────────────────────────────
// ④ 用户点名的两个具体诉求（弹窗 + 角色页剔除动作状态）
// ─────────────────────────────────────────────────────────

test('★★ 标签库是弹窗（用户明确要求，原内嵌面板"视觉上很难用"）', () => {
  assert.match(picker, /<linshe-modal/, '标签库必须是弹窗');
  assert.match(drawView, /<AppearanceTraitPicker/, '绘图页通过弹窗组件打开标签库');
});

test('★★ 角色页与绘图页的文案要各自说清分工（避免用户困惑标签去哪了）', () => {
  // 角色页提示：动作/状态不在这里，去绘图页
  assert.match(picker, /绘图[\s\S]{0,20}页/, '角色页档位应引导用户去绘图页找动作类标签');
  // 绘图页提示：这里是完整词库
  assert.match(picker, /完整词库/, '绘图页档位应说明这是完整词库');
});