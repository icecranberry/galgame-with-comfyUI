/**
 * 日程编排弹窗三项修复 —— 回归测试。
 *
 * 用户口径（2026-10-07，三条）：
 *  ① 新建「二相乐园之外 → 托帕的私人生态舰」后，编排日程里**一个地点都不出现**；
 *  ② 居家/睡眠地点"难以查找"，要求改为**多级选择栏**、层级按**地图自动匹配**；
 *  ③ 编排弹窗"总是自己弹掉"、"重新打开没有记忆留痕"，
 *     要求右上角加**关闭按钮**（原垃圾桶位置），清空日程移到**侧边栏角色日程右上角**。
 *
 * ① 的根因是硬编码 `level === 3`，②③ 是交互设计问题。本测试把三者的**不变量**钉住，
 * 防止以后有人把层级判据改回数值比较、或把遮罩点击关弹窗改回来。
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
const route = fs.readFileSync(path.join(SRC, 'routes/schedule.js'), 'utf8');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/ScheduleView.vue'), 'utf8');
const drawer = fs.readFileSync(path.join(WEB_SRC, 'components/CharacterDetailDrawer.vue'), 'utf8');
const cascade = fs.readFileSync(path.join(WEB_SRC, 'components/ui/PlaceCascadeSelect.vue'), 'utf8');

function fnBody(src, name) {
  const re = new RegExp(`(?:export )?(?:async )?function ${name}\\(`);
  const hit = re.exec(src);
  if (!hit) return '';
  const i = hit.index;
  const rest = src.slice(i + 10);
  const m = rest.search(/\n(?:export )?(?:async )?function |\n\/\*\* |\n\/\/ ═/);
  return src.slice(i, m > -1 ? i + 10 + m : i + 4000);
}

// ─────────────────────────────────────────────────────────
// ① 地点可用性判据：结构性，不得硬编码 level
// ─────────────────────────────────────────────────────────

test('★★★ 日程地点判定不得硬编码 level 数值（这正是"新区点不开"的根因）', () => {
  const fn = fnBody(svc, 'listAreasForSchedule');
  assert.ok(fn.length > 200, '应能截出 listAreasForSchedule');
  // ★ 曾经的写法：`.filter(s => s.level === LEVEL.SCENE)` ——
  //   用户新建的「托帕的私人生态舰」下面 3 个地点是 lv4，被整批静默丢弃。
  assert.ok(!/\.filter\(s => s\.level === LEVEL\.SCENE\)/.test(svc),
    '不得再用 `s.level === LEVEL.SCENE` 过滤 —— level 是冗余列，历史数据未必等于结构深度');
  assert.match(fn, /collectPlaceNodes/, '应改用"结构性地点判定"');
});

test('★★★ 地点判据必须是"自己像不像地点"，不是"有没有子节点"（狸狸周刊丢失的根因）', async () => {
  const { isSchedulePlaceNode } = await import('../src/services/worldMapService.js');

  // ★ 用户实报：狸狸周刊自己是一家杂志社、下面还挂着「不死神探事务所」——
  //   旧判据"有子节点 ⇒ 容器"把它整条丢掉，界面里就只剩子节点。
  const shopWithChild = {
    name: '狸狸周刊', kind: '杂志社', scene_prompt: 'x', summary: 'y',
    children: [{ name: '不死神探事务所', kind: '事务所' }],
  };
  assert.equal(isSchedulePlaceNode(shopWithChild), true, '自带 kind/场景的节点本身就是地点');

  // 纯分组节点（什么都没有）才只作下钻通道
  const container = { name: '某某片区', children: [{ name: '内部地点', kind: '商店' }] };
  assert.equal(isSchedulePlaceNode(container), false, '无任何地点属性的多子节点 = 容器');

  // 叶子永远算地点
  assert.equal(isSchedulePlaceNode({ name: '光秃秃的叶子' }), true);
  assert.equal(isSchedulePlaceNode(null), false);

  // 判据仍不得依赖 level
  const m = svc.match(/function isSchedulePlaceNode\(node\) \{[\s\S]{0,600}?\n\}/);
  assert.ok(m, '应有 isSchedulePlaceNode');
  // 只看函数体里的可执行行，注释里提到 level 是允许的（说明为什么不用它）
  const body = m[0].split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/level/.test(body), '该函数不得用 level 做判据');
});

test('★★★ collectPlaceNodes：父节点是地点时，父与子**都要**收（两家不同地点）', async () => {
  const { collectPlaceNodes } = await import('../src/services/worldMapService.js');
  const tree = [
    { name: '鸽川大道', kind: '主街' },
    { name: '狸狸周刊', kind: '杂志社', children: [{ name: '不死神探事务所', kind: '事务所' }] },
    { name: '某片区', children: [{ name: '内部商店', kind: '商店' }] },
  ];
  const names = collectPlaceNodes(tree).map(n => n.name);
  assert.deepEqual(names, ['鸽川大道', '狸狸周刊', '不死神探事务所', '内部商店'],
    '有地点属性的父节点要收，其子节点也要收；纯容器只下钻不收自己');
});

test('★★ 向下收集必须有深度上限（防环护栏）', () => {
  const fn = fnBody(svc, 'collectPlaceNodes');
  assert.match(fn, /MAX_PLACE_DEPTH/, '必须有深度上限');
  assert.match(fn, /depth/, '应传递当前深度');
  assert.match(svc, /const MAX_PLACE_DEPTH = \d+/, '常量应有定义');
});

test('★★ 分支不能静默丢内容：多级容器要下钻而不是丢掉', () => {
  const fn = fnBody(svc, 'collectPlaceNodes');
  // 有子节点时必须递归进去，而不是 continue/跳过 —— 否则整棵子树消失
  assert.match(fn, /collectPlaceNodes\(n\.children/, '子节点必须下钻');
  assert.match(fn, /out\.push\(n\)/, '节点必须被收集');
});

// ─────────────────────────────────────────────────────────
// ② 多级级联选择
// ─────────────────────────────────────────────────────────

test('★★★ 固定住处改为多级级联，层级按地图自动匹配（不写死层级名）', () => {
  assert.match(view, /PlaceCascadeSelect/, '应使用级联组件');
  // ★ 关键：不得出现"二维市/鸽川区"这类具体区名（那等于把地图层级抄进了引擎式代码）
  const seg = view.slice(view.indexOf('固定住处'), view.indexOf('固定住处') + 2600);
  assert.ok(!/二维市|鸽川区|喜笑区|悲泣区|星穹列车/.test(seg),
    '固定住处区块不得出现具体地区名 —— 层级必须来自地图数据');
});

test('★★ 级联组件逐级收敛：大地区 → 子地区 → 地点', () => {
  for (const lv of ['大地区', '子地区', '地点']) {
    assert.ok(cascade.includes(lv), `应含「${lv}」这一级`);
  }
  assert.match(cascade, /regionOptions/, '应有大地区级');
  assert.match(cascade, /areaOptions/, '应有子地区级');
  assert.match(cascade, /placeOptions/, '应有地点级');
  // 上级变更必须清掉下级（否则"区换了但地点还是上一个区的"）
  // ⚠ 不写死整行文本，避免被格式化/换行差异误伤
  assert.match(cascade, /watch\(region,[\s\S]{0,120}?area\.value = ''[\s\S]{0,60}?place\.value = ''/,
    '切换大地区必须清空下两级');
  assert.match(cascade, /watch\(area,[\s\S]{0,80}?place\.value = ''/,
    '切换子地区必须清空地点');
});

test('★★ 级联组件必须能反查回填（否则打开时看不到当前设的是哪）', () => {
  assert.match(cascade, /hit = list\.value\.find\(o => o\.name === v\)/, '应能按名反查归属');
  assert.match(cascade, /region\.value = hit\.region/, '应回填大地区');
  // 值不在候选里（地图改过/地点被删）要显式提示，不能显示成空白让人以为没设
  assert.match(cascade, /已不在候选列表里/, '值失效时应有提示');
});

test('★★ 级联组件最后一级仍可搜索（一个子区可能有几十个地点）', () => {
  const seg = cascade.slice(cascade.indexOf('placeOptions'), cascade.indexOf('emitValue'));
  assert.match(cascade, /searchable/, '地点级应可搜索');
});

// ─────────────────────────────────────────────────────────
// ③ 弹窗关闭 / 记忆留痕 / 清空入口迁移
// ─────────────────────────────────────────────────────────

test('★★★ 点遮罩不得关闭编排弹窗（"自己弹掉"的直接原因）', () => {
  const seg = view.slice(view.indexOf('编排日程弹窗'), view.indexOf('编排日程弹窗') + 1400);
  assert.ok(!/@click\.self="showRegenerateModal = false"/.test(view),
    '遮罩点击不得再关闭 —— 弹窗很高，滚轮/滑动极易误触');
  assert.match(view, /<div v-if="showRegenerateModal" class="reset-overlay">/,
    '遮罩应改为无点击处理器');
});

test('★★★ 必须在右上角提供关闭按钮（用户明确要求）', () => {
  assert.match(view, /reset-header-close/, '应有右上角关闭按钮');
  assert.match(view, /function closeRegenModal/, '应有 closeRegenModal');
  // 垃圾桶（清空）不应再出现在弹窗头部
  assert.ok(!/reset-header-clear/.test(view), '弹窗头部的垃圾桶应已移除');
});

test('★★★ 关闭时必须保存已填内容（用户抱怨"没有任何记忆留痕"）', () => {
  const fn = fnBody(view, 'closeRegenModal');
  assert.ok(fn.length > 100, '应能截出 closeRegenModal');
  assert.match(fn, /saveRegenPrefs/, '关闭时应保存选项');
  assert.match(fn, /direction: regenerateDirection/, '方向输入也必须记住（那是用户写的正文）');
});

test('★★ 打开弹窗时要恢复方向输入（否则"留痕"白做）', () => {
  assert.match(view, /regenerateDirection\.value = String\(prefs\?\.direction \|\| ''\)/,
    '应按角色恢复上次写的方向');
  // 而 onRegenerate 不得再清空它
  const fn = fnBody(view, 'onRegenerate');
  assert.ok(!/regenerateDirection\.value = ''/.test(fn),
    'onRegenerate 不得清空方向（会盖掉刚恢复的记忆）');
});

test('★ Esc 关弹窗不得抢下拉面板的 Esc', () => {
  const fn = fnBody(view, 'onRegenEsc');
  assert.match(fn, /ls-select-dropdown/, '下拉面板打开时应把 Esc 让给它');
  assert.match(fn, /closeRegenModal/, '否则才关闭弹窗');
});

test('★★★ 清空日程移到侧边栏角色日程右上角（用户明确要求）', () => {
  assert.match(drawer, /clear-schedule/, '抽屉应发出 clear-schedule 事件');
  assert.match(drawer, /dr-clear/, '应有清空按钮');
  // 且桌面端也要显示（不能像 .dr-close 只在移动端）
  const css = drawer.slice(drawer.indexOf('.dr-clear {'));
  assert.match(css.slice(0, 220), /display: flex/, '.dr-clear 必须常显（桌面端也需要）');
  // 接线
  assert.match(view, /@clear-schedule="onClearFromDrawer"/, '需在视图里接线');
  assert.match(view, /function onClearFromDrawer/, '应有处理函数');
});

test('★ 清空后应关掉抽屉与编排弹窗（日程没了，留着旧时间轴只会困惑）', () => {
  const fn = fnBody(view, 'onClearSchedule');
  assert.match(fn, /drawerOpen\.value = false/, '清空后应关抽屉');
  assert.match(fn, /showRegenerateModal\.value = false/, '清空后应关编排弹窗');
  assert.match(fn, /confirm\(/, '破坏性操作必须二次确认');
});

test('★★ 只在该角色确实有日程时才显示清空按钮', () => {
  assert.match(drawer, /v-if="activities\.length > 0"[\s\S]{0,200}clear-schedule|dr-clear/,
    '没日程可清时不该占位');
});