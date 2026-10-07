/**
 * 「地图 · 一站式地点编辑」——回归测试。
 *
 * 用户口径（2026-10-07）：
 *   「我的期望是一站式、一页式进行人工编辑工作……你的『编辑』和『取消』本质上就是
 *     折叠当前地点的详细编辑区块，功能位置发生变化，非常反人类。」
 *
 * 病根：此前是**两态切换**（浏览态按钮「编辑/修正/删除」↔ 编辑态按钮「修正/取消/保存」），
 * 而「编辑」「取消」只是折叠开关。按钮**换位置换组合**，用户每次要重新找。
 * 而且树形点进来直接是编辑态、点位图点进来是浏览态 —— 同一件事两种长相。
 *
 * 本测试守四件事：
 *  ① **不得再有第二态**（`editingInline` 这类开关不得复活）；
 *  ② 选中即灌表单（`selectPlace` 必须调用 `openEdit`）；
 *  ③ 保存/撤销**位置与组合固定**，且保存是"字段 + 生活地点"一次提交；
 *  ④ 未保存改动必须显式可见（`editDirty` + 「未保存」徽标），不能靠态切换表达。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/WorldMapView.vue'), 'utf8');

/** 取某个函数的源码段（边界=下一个顶层函数声明 / 注释块） */
function fnBody(src, name) {
  const re = new RegExp(`(?:export )?(?:async )?function ${name}\\(`);
  const hit = re.exec(src);
  if (!hit) return '';
  const i = hit.index;
  const rest = src.slice(i + 10);
  const m = rest.search(/\n(?:\/\*\*|\/\/ ─|(?:export )?(?:async )?function )/);
  return src.slice(i, m > -1 ? i + 10 + m : i + 4000);
}

// ─────────────────────────────────────────────────────────
// ① 不得再有第二态
// ─────────────────────────────────────────────────────────

test('★★★ 不得再有 "编辑态" 开关（`editingInline` 不得复活）', () => {
  // 它是两态结构的标志物：有它就必然有"进入/退出编辑"两个动作与两套按钮。
  // ⚠ 必须**同时剥掉块注释**（`/** */`）—— 新代码的注释里会提到它的旧名字作历史说明。
  const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\beditingInline\b/.test(code),
    '不应再出现 editingInline —— 表单显隐应只由 selected 决定');
});

test('★★★ 不得再有「编辑」按钮（选中即编辑，没有"进入编辑"这一步）', () => {
  assert.ok(!/>\s*编辑\s*</.test(view), '「编辑」按钮应已移除（表单常驻，不需要"进入编辑"）');
  // ⚠ 检查 `cancelEdit` 时必须**同时剥掉块注释** —— 我在新函数注释里提了它的旧名字作历史说明，
  //   只清 `//` 行注释会把它算成"还活着"（实测踩过）。
  const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bcancelEdit\b/.test(code), '「取消」应已替换为语义准确的「撤销」(onUndoEdit)');
  assert.match(code, /function onUndoEdit/, '应存在 onUndoEdit（撤销）');
});

test('★★ 表单必须常驻渲染（不能再被 v-if 折叠）', () => {
  // 地点表单容器：不可再有 v-if 开关；它现在无条件渲染
  const m = view.match(/<!-- ── 地点信息（常驻表单）── -->[\s\S]{0,220}/);
  assert.ok(m, '应有"常驻表单"区块');
  assert.ok(!/v-if=/.test(m[0]), '常驻表单不得带 v-if —— 那等于把两态带回来');
  // 且不再有 v-if="!editingInline" 这类反向折叠
  assert.ok(!/v-if="!editingInline"/.test(view), '不该再有 editingInline 反向条件');
});

// ─────────────────────────────────────────────────────────
// ② 选中即灌表单
// ─────────────────────────────────────────────────────────

test('★★★ 选中地点必须直接灌入编辑表单（不再区分浏览/编辑两态）', () => {
  const fn = fnBody(view, 'selectPlace');
  assert.ok(fn.length > 100, '应能截出 selectPlace');
  assert.match(fn, /openEdit\(/, '选中后必须调用 openEdit 灌表单');
  // 不得再有"按模式决定是否编辑"的分支（那是两态的残留）
  assert.ok(!/opts\.edit/.test(fn), '不应再按 opts.edit 区分 —— 选中即编辑');
});

test('★★★ 切换节点前若有未保存改动必须确认（常驻编辑态下极易误丢）', () => {
  const fn = fnBody(view, 'selectPlace');
  assert.match(fn, /editDirty/, '应检查未保存改动');
  assert.match(fn, /confirm\(/, '有改动时必须让用户确认');
  assert.match(fn, /return false/, '用户选"取消"时必须中止切换（返回 false 供调用方判断）');
});

test('★ 树节点点击要正确处理"用户取消切换"（不能照旧折叠）', () => {
  const fn = fnBody(view, 'onNodeClick');
  assert.match(fn, /selectPlace\([^)]*\)\s*===\s*false/, '应检查 selectPlace 返回值');
  assert.match(fn, /return/, '取消切换时应提前返回，不再折叠');
});

test('★ 修正结果回填不得触发"未保存"确认（用户还没改任何东西）', () => {
  const fn = fnBody(view, 'onPlaceRefined');
  assert.match(fn, /skipConfirm:\s*true/, '回填应跳过确认');
  assert.match(fn, /editDirty\.value\s*=\s*true/, '回填后应标脏，让「保存」亮起');
});

// ─────────────────────────────────────────────────────────
// ③ 保存：位置固定 + 一次提交
// ─────────────────────────────────────────────────────────

test('★★★ 操作按钮位置与组合固定：修正 / 删除 / 撤销 / 保存', () => {
  // 顶部操作区应恰好包含这四个，且顺序稳定（这正是用户要的"功能位置不发生变化"）
  const m = view.match(/<div class="wd-head-ops">([\s\S]*?)<\/div>/);
  assert.ok(m, '应有 wd-head-ops 区块');
  const seg = m[1];
  const order = ['修正', '删除', '撤销', '保存'].map(t => seg.indexOf(`>${t}<`));
  assert.ok(order.every(i => i >= 0), `四个按钮都应存在（实际顺序位置 ${order.join(',')}）`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], '按钮顺序必须稳定（位置不变是本次需求的核心）');
  }
  // 不得再有第二个"保存"按钮（曾有个"保存生活地点"独立按钮，位置还会变）。
  // ⚠ 只在**地点详情区**内统计：「地图设置」弹窗里还有一个「保存」，那是另一个作用域、合理存在。
  const detail = view.slice(view.indexOf('class="wmap-detail"'), view.indexOf('<!-- ── 我的地图列表'));
  const saveCount = (detail.match(/>保存</g) || []).length;
  assert.equal(saveCount, 1, `地点详情区只应有**一个**保存按钮（实际 ${saveCount} 个）`);
});

test('★★★ 保存必须一次提交「地点字段 + 生活地点」（不再两个按钮分开）', () => {
  const fn = fnBody(view, 'onSaveAll');
  assert.ok(fn.length > 300, '应能截出 onSaveAll');
  assert.match(fn, /updateWorldMapPlace/, '应调更新接口');
  assert.match(fn, /pois/, '必须一并提交生活地点');
  assert.match(fn, /editDirty/, '应处理字段改动标记');
  assert.match(fn, /poisDirty/, '应处理生活地点改动标记');
});

test('★★ 旧的独立 savePois 不得复活（同一动作两个入口 = 位置漂移的根源）', () => {
  const code = view.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/function savePois\b/.test(code), 'savePois 应已删除，并入 onSaveAll');
  assert.ok(!/savePois\(/.test(code), '不应再有对 savePois 的调用');
});

test('★★ 撤销必须恢复成"库里已保存"的值，而不是清空', () => {
  const fn = fnBody(view, 'onUndoEdit');
  assert.ok(fn.length > 80, '应能截出 onUndoEdit');
  assert.match(fn, /openEdit\(/, '应从库里数据重新灌一遍');
  assert.match(fn, /fullFlat|map\.value/, '数据源应是当前地图的最新数据');
  // 不得只把表单清空（那是"清空"不是"撤销"）
  assert.ok(!/editPlace\.name\s*=\s*''/.test(fn), '不该手写清空各字段 —— 那是清空不是撤销');
});

// ─────────────────────────────────────────────────────────
// ④ 未保存改动必须显式可见
// ─────────────────────────────────────────────────────────

test('★★★ 必须有"未保存"的显式提示（两态没了之后唯一的可见信号）', () => {
  assert.match(view, /class="wd-dirty"/, '应有未保存徽标');
  assert.match(view, /未保存/, '徽标文字应为「未保存」');
  assert.match(view, /const editDirty = ref\(false\)/, '应有 editDirty 状态');
});

test('★★ 每个可改字段都要标脏（漏一个 → 改了却保存不了，且用户看不出为什么）', () => {
  // 地点表单里的输入项：名称/英文名/类型/简介/画面描述/开放关闭时间/上级
  const need = [
    'editPlace.name', 'editPlace.nameEn', 'editPlace.kind',
    'editPlace.summary', 'editPlace.scenePrompt',
    'editPlace.openAt', 'editPlace.closeAt',
  ];
  /**
   * ⚠ 标脏的写法有**两种**，取决于控件类型，不能用同一个正则去套：
   *   · 原生 input / textarea → `@input="editDirty = true"`
   *   · `linshe-select`（开放/关闭时间是下拉）→ `@update:model-value="editDirty = true"`
   *     （下拉没有原生 input 事件；vue 3 的 kebab 与 camel 两种写法都要认）
   * 之前这里只认 `@input`，于是把「用 linshe-select 正确标了脏」误判成漏标。
   */
  const bind = f => {
    const v = f.replace('.', '\\.');
    const dirty = '@(?:input|update:model-value|update:modelValue)="editDirty = true"';
    return new RegExp(`v-model="${v}"[^>]*${dirty}|${dirty}[^>]*v-model="${v}"`);
  };
  for (const f of need) {
    assert.ok(bind(f).test(view), `${f} 的输入必须标脏 —— 否则改了保存不了`);
  }
  // 准入/分区/上级是点击或下拉，另判
  assert.match(view, /editPlace\.access = [^"]*editDirty = true/, '准入切换要标脏');
  assert.match(view, /editPlace\.zone = [^"]*editDirty = true/, '区域性质切换要标脏');
  assert.match(view, /v-model="editPlace\.parentId"[^>]*@update:modelValue="editDirty = true"/, '上级下拉要标脏');
});

test('★★ 生活地点各项也要标脏（含类型下拉 —— 曾漏掉）', () => {
  const seg = view.slice(view.indexOf('class="wpoi-row"'), view.indexOf('class="wpoi-foot"'));
  const dirtyCount = (seg.match(/poisDirty = true/g) || []).length;
  assert.ok(dirtyCount >= 3, `生活地点的类型/名称/简介都应标脏（实际 ${dirtyCount} 处）`);
});

test('★★ AI 生成画面描述后要标脏（否则用户以为"生成没生效"）', () => {
  const fn = fnBody(view, 'onGenerateScenePrompt');
  assert.match(fn, /editDirty\.value = true/, 'AI 回填后应标脏');
});

test('★ 「保存」在无改动时应不可点（避免"点了没反应"）', () => {
  const m = view.match(/<linshe-button[^>]*@click="onSaveAll"[^>]*>|@click="onSaveAll"[^>]*>/);
  assert.ok(m, '应能定位保存按钮');
  const tag = view.slice(Math.max(0, m.index - 420), m.index + 60);
  assert.match(tag, /:disabled="!editDirty/, '保存按钮应在无改动时禁用');
});