/**
 * 地图地点编辑 —— 「内联编辑置顶」+「AI 生成画面描述」的回归测试。
 *
 * 用户口径（2026-10-06）：地图树形是**地点编辑页**，编辑直接做在最上层，
 * 不要「点编辑再弹窗」；并给「画面描述」一个 AI 自动生成按钮（写完名称/类型/简介后生成生图 TAG）。
 *
 * 守三类风险：
 *  ① **编辑入口不得回退成弹窗** —— 树里点节点应直接进可编辑态。
 *  ② **AI 生成不得直接落库** —— 只填表单，用户确认（保存）才写库（同论坛马甲取向）。
 *  ③ **接线完整** —— 服务端函数 / 路由 / 前端 API / UI 按钮四处，漏一处功能静默失效。
 *     ⚠ 尤其守 `router.post('/places/scene-prompt')` 必须注册在 `/places/:placeId` **之前**，
 *       否则字面路径会被参数路由吞掉（本项目反复踩过的坑）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

const svc = fs.readFileSync(path.join(SRC, 'services/worldMapService.js'), 'utf8');
const route = fs.readFileSync(path.join(SRC, 'routes/worldMap.js'), 'utf8');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/WorldMapView.vue'), 'utf8');
const api = fs.readFileSync(path.join(WEB_SRC, 'api/index.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 内联编辑置顶（不再「点编辑再弹窗」）
// ─────────────────────────────────────────────────────────

test('★ 树里点节点直接进可编辑态（编辑做在最上层，不再需要先点「编辑」）', () => {
  // ⚠ 2026-10-07 更新：一站式编辑后**没有"编辑态"这个开关了**，也不再按模式区分 ——
  //   选中即灌表单。所以断言从"带 edit 意图"改为"无条件 openEdit"。
  const fn = view.match(/function onNodeClick[\s\S]*?\n(?:function|\/\*)/)?.[0] || '';
  assert.ok(fn, 'onNodeClick 应存在');
  assert.match(fn, /selectPlace\(n\)/, '树里点节点应直接选中（选中即编辑）');
  // selectPlace 必须无条件灌表单（不再有 opts.edit 这个两态残留）
  const sp = view.match(/function selectPlace[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(sp, 'selectPlace 应存在');
  assert.match(sp, /openEdit\(/, 'selectPlace 必须直接打开编辑表单');
  assert.ok(!/opts\.edit/.test(sp), '不应再有 opts.edit 分支 —— 那会把两态结构带回来');
});

test('★ 一站式：点位图与树形**行为一致**（不再有"树才可编辑"的差别）', () => {
  // 这是 2026-10-07 用户口径的核心：同一件事不该有两种长相。
  // 点位图通过 @select="selectPlace" 走同一个函数 → 自然一致。
  assert.match(view, /@select="selectPlace"/, '点位图应复用同一个 selectPlace');
  const fn = view.match(/function onNodeClick[\s\S]*?\n(?:function|\/\*)/)?.[0] || '';
  assert.ok(!/viewMode\.value === 'tree'/.test(fn),
    '不应再按视图模式区分是否编辑 —— 两种视图应当一致');
});

test('★ 编辑态也显示下级地点（一边改一边看上下文，不被表单挡掉）', () => {
  // 「下级地点」区块不得再被 editingInline 包裹（原实现用 <template v-if="!editingInline"> 罩住）
  const lower = view.match(/下级地点[\s\S]{0,300}?wd-sect/)?.[0] || '';
  assert.ok(lower.length > 0, '应能找到下级地点区块');
  // 关键：该 div 的 v-if 不能含 editingInline
  const block = view.match(/<div v-if="([^"]+)" class="wd-sect">\s*<p class="wd-sect-title">下级地点/);
  assert.ok(block, '下级地点区块应存在且为独立 div');
  assert.ok(!/editingInline/.test(block[1]), `下级地点不应受编辑态隐藏（实际 v-if="${block[1]}"）`);
});

// ─────────────────────────────────────────────────────────
// ② AI 生成不落库（只填表单）
// ─────────────────────────────────────────────────────────

test('★★ AI 生成只填表单、不落库（用户确认才保存）', () => {
  const fn = view.match(/async function onGenerateScenePrompt[\s\S]*?\n}/)?.[0] || '';
  assert.ok(fn, 'onGenerateScenePrompt 应存在');
  // 只写进表单字段，不得调 updateWorldMapPlace
  assert.match(fn, /src\.scenePrompt = /, '生成结果应写进表单字段');
  assert.ok(!/updateWorldMapPlace|addWorldMapPlace/.test(fn), '生成时不得直接落库（保存由用户点）');
  // 名称空时要拦住并提示（不能悄悄生成个空描述）
  assert.match(fn, /请先填写名称/, '名称为空应提示，而不是发无意义的请求');
});

test('服务端：名称缺失 → 400（不是 500，也不是静默返回空）', () => {
  assert.match(svc, /请先填写名称/, '缺名称应抛清晰错误');
  // 该错误应带 statusCode 400（route 的 fail 会据此返回 400）
  const fn = svc.match(/export async function generateScenePrompt[\s\S]*?\n}/)?.[0] || '';
  assert.match(fn, /statusCode:\s*400/, '缺名称应为 400');
});

test('服务端：生成要求英文、不写人、词数上限（与建站口径一致）', () => {
  const fn = svc.match(/export async function generateScenePrompt[\s\S]*?\n}/)?.[0] || '';
  assert.match(fn, /全英文输出/, '必须强制英文（生图模型不吃中文）');
  assert.match(fn, /不得出现任何中文字符/, '必须显式禁止中文字符（实测吐过 "dazzling愿力 glow"）');
  assert.match(fn, /不要写人/, '必须禁止写人（只描述画面环境）');
  assert.match(fn, /scene_prompt/, '应产出 scene_prompt 字段');
  // 词数上限与 clampText 限制
  assert.match(fn, /clampText\([^)]*,\s*400\)/, '应按既有口径截断到 400（与 upsertPlace 的 scene_prompt 一致）');
});

test('★★ 出口兜底：残留的 CJK 字符必须被剔除（不能把中文喂进英文生图模型）', () => {
  const fn = svc.match(/export async function generateScenePrompt[\s\S]*?\n}/)?.[0] || '';
  // 必须有「剔除中文/CJK」这一步（\\u4e00-\\u9fff 之类）
  assert.match(fn, /\\u4e00-\\u9fff/, '应有 CJK 字符剔除（出口兜底）');
  // 逻辑自检：模拟模型不听话吐了中文
  const clean = (s) => s.replace(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/g, ' ')
    .replace(/\s*,\s*/g, ', ').replace(/(?:,\s*){2,}/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  assert.equal(clean('dazzling愿力 glow, 星穹 tower'), 'dazzling glow, tower',
    '中文应被剔除，且不留多余逗号/空格');
  assert.equal(clean('neon city, 灯笼 lanterns'), 'neon city, lanterns');
});

// ─────────────────────────────────────────────────────────
// ③ 接线完整 + 路由顺序（防参数路由吞掉字面路径）
// ─────────────────────────────────────────────────────────

test('★ 服务端导出 generateScenePrompt', () => {
  assert.match(svc, /export async function generateScenePrompt/, '应导出 generateScenePrompt');
});

test('★★ 路由顺序：/places/scene-prompt 必须注册在 /places/:placeId 之前', () => {
  const idxScene = route.indexOf("'/places/scene-prompt'");
  const idxParam = route.indexOf("'/places/:placeId'");
  assert.ok(idxScene > -1, '应注册 /places/scene-prompt');
  assert.ok(idxParam > -1, '应存在 /places/:placeId 参数路由');
  assert.ok(idxScene < idxParam,
    '字面路径 /places/scene-prompt 必须早于 /places/:placeId 注册，否则会被参数路由吞掉（本项目既有约定）');
  // 路由应调用服务函数
  assert.match(route, /generateScenePrompt\(req\.body/, '路由应调用服务函数');
});

test('★ 前端 API 与 UI 接线：按钮 → API → 端点', () => {
  assert.match(api, /export function generateWorldMapScenePrompt/, '应导出 generateWorldMapScenePrompt');
  assert.match(api, /\/worldmap\/places\/scene-prompt/, 'API 应指向正确端点');
  // UI：编辑态与新增态都要有「AI 生成」按钮
  const btnCount = (view.match(/onGenerateScenePrompt\('(?:edit|add)'\)/g) || []).length;
  assert.equal(btnCount, 2, `编辑/新增两处都应有 AI 生成按钮（实际 ${btnCount} 处）`);
  assert.match(view, /sceneGenBusy/, '应有独立的生成中状态（不能复用 busy 锁住整个面板）');
});

test('★ 生成按钮在名称为空时禁用（避免点了没反应）', () => {
  const around = view.slice(Math.max(0, view.indexOf("onGenerateScenePrompt('edit')") - 500), view.indexOf("onGenerateScenePrompt('edit')"));
  assert.match(around, /:disabled="!editPlace\.name\.trim\(\)"/, '按钮应在名称为空时禁用');
});