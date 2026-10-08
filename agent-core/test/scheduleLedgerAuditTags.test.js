/**
 * 日程台账「归档折叠」+「自有住处豁免」+「小标签可编辑」—— 回归测试。
 *
 * 用户口径（2026-10-06）：
 *  ① 台账里**归档角色应默认全折叠**（归档＝不参与主动行为，日程只是历史留痕）。
 *  ② 「地点不可直达 / 进入受限地点」的告警，很多是**角色回到自己的专属住处**导致的假阳性
 *     —— 私宅本来就常被标 private/restricted，也不在公交网上。角色**自己的住处必须豁免**这两项。
 *  ③ 「编辑日程」弹窗缺**小标签（tags）**编辑 —— 标签会进 UI 与检索，不能只由模型生成。
 *
 * 本测试守三类回退：豁免集没接库、路由把 tags 丢了、UI 没接线。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`ledger test forbids network: ${url}`); };

const ledgerSrc = fs.readFileSync(path.join(SRC, 'services/scheduleLedger.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/schedule.js'), 'utf8');
const drawer = fs.readFileSync(path.join(WEB_SRC, 'components/CharacterDetailDrawer.vue'), 'utf8');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/ScheduleView.vue'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 归档角色在台账里默认折叠
// ─────────────────────────────────────────────────────────

test('★ 台账：归档角色默认折叠（需显式开关才显示），与左侧栏同一口径', () => {
  // 前端必须有「显示归档」的开关状态，且默认 false
  assert.match(view, /ledgerShowArchived\s*=\s*ref\(false\)/, 'ledgerShowArchived 必须默认 false（默认折叠）');
  // ledgerRows 必须真的按 archived 过滤
  const rows = view.match(/const ledgerRows[\s\S]*?\n\}\)/)?.[0] || '';
  assert.match(rows, /archived/, 'ledgerRows 应依据 archived 过滤');
  assert.match(rows, /ledgerShowArchived\.value/, 'ledgerRows 应受开关控制');
});

test('★ 台账：折叠数要给出来（避免"有些角色怎么不见了"的困惑）', () => {
  assert.match(view, /ledgerArchivedCount/, '应统计被折叠的归档角色数并显示');
  assert.match(view, /ledger-show-archived|ledgerShowArchived/, '应有可操作的开关');
});

// ─────────────────────────────────────────────────────────
// ② 自有住处豁免（消除假阳性）
// ─────────────────────────────────────────────────────────

test('★★ auditSchedule 支持 ownPlaces 豁免（自己的住处不算闯入受限/不可直达）', () => {
  const fn = ledgerSrc.match(/export function auditSchedule[\s\S]*?\n  return \{/)?.[0] || '';
  assert.ok(fn, '应能截出 auditSchedule 主体');
  assert.match(fn, /ctx\.ownPlaces/, '应读取 ownPlaces 豁免集');
  assert.match(fn, /const isOwn/, '应计算"是否落在自己的住处"');
  // 两项检查都必须被 isOwn 守卫
  assert.match(fn, /if \(!isOwn\)[\s\S]{0,200}forbidden-place/, '受限地点检查应被 isOwn 守卫');
  assert.match(fn, /if \(!isOwn\)[\s\S]{0,400}unreachable-place/, '不可直达检查应被 isOwn 守卫');
});

test('★★ auditCharacter 从角色资料读 home_place/sleep_place/home_area 并并入豁免集', () => {
  // ⚠ 断言只认"这三个字段都在 SELECT 里"，不锁死列顺序/结尾 —— 2026-10-06 追加
//   transit_mode（超能力移动豁免）后原断言（要求紧跟 FROM）会误报，属测试过紧而非代码出错。
  assert.match(ledgerSrc, /home_place[\s\S]{0,60}?sleep_place[\s\S]{0,60}?home_area[\s\S]{0,40}?FROM characters/, '应读角色住处的三个字段');
  assert.match(ledgerSrc, /ownPlaces\.size/, '应据住处构造 ownPlaces');
  assert.match(ledgerSrc, /charCtx/, '应把角色豁免集并入 ctx 后传给 auditSchedule');
});

test('★ 豁免只影响这两项，不影响其它检查（不能借豁免放行所有问题）', () => {
  const fn = ledgerSrc.match(/export function auditSchedule[\s\S]*?\n  return \{/)?.[0] || '';
  // thin-desc / no-location 不得被 isOwn 影响
  const thin = fn.match(/thin-desc[\s\S]{0,80}/)?.[0] || '';
  assert.ok(!/isOwn/.test(thin), '描述过薄不应受住处豁免影响');
});

// ─────────────────────────────────────────────────────────
// ③ 小标签（tags）可编辑
// ─────────────────────────────────────────────────────────

test('★★ 路由：PUT /:id/activity 必须透传 tags（否则手改的标签被静默丢弃）', () => {
  const seg = routeSrc.match(/router\.put\('\/:characterId\/activity'[\s\S]*?\n\}\);/)?.[0] || '';
  assert.ok(seg, '应能截出 activity 更新路由');
  assert.match(seg, /description, tags \}/, '解构必须包含 tags');
  assert.match(seg, /updateScheduleActivity\([^)]*tags/, '调用时应把 tags 传给服务层');
});

test('★ 服务层：sanitizeActivityInput 仍保留 tags，且限制最多 6 个', () => {
  const editorSrc = fs.readFileSync(path.join(SRC, 'services/scheduleEditor.js'), 'utf8');
  const fn = editorSrc.match(/export function sanitizeActivityInput[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /tags/, '应处理 tags');
  assert.match(fn, /slice\(0,\s*6\)/, '标签应限制最多 6 个（与前端同口径）');
});

test('★ 前端：编辑日程弹窗有小标签编辑器（添加/移除 + 上限守卫）', () => {
  assert.match(drawer, /小标签/, '弹窗应有「小标签」区');
  assert.match(drawer, /editForm\.tags/, '表单应含 tags 数组');
  assert.match(drawer, /function addTag/, '应有添加标签逻辑');
  assert.match(drawer, /function removeTag/, '应能移除标签');
  // 上限守卫
  const addFn = drawer.match(/function addTag[\s\S]*?\n\}/)?.[0] || '';
  assert.match(addFn, />=\s*6/, '添加时应守 6 个上限');
  // 打开编辑时要把已有 tags 灌进表单
  const openFn = drawer.match(/function openEdit[\s\S]*?\n\}/)?.[0] || '';
  assert.match(openFn, /editForm\.tags\s*=/, '打开编辑应回填已有标签');
});

test('★ 前端：保存时把 tags 一起提交（不能只提交活动/地点/描述）', () => {
  const save = drawer.match(/async function saveEdit[\s\S]*?\n\}/)?.[0] || '';
  assert.match(save, /\.\.\.editForm|\btags\b/, '保存应带上 tags（当前用展开 editForm，天然包含）');
});

// ─────────────────────────────────────────────────────────
// ★ 行为验证：真跑 auditSchedule，证明豁免真的生效
// ─────────────────────────────────────────────────────────

const { auditSchedule } = await import('../src/services/scheduleLedger.js');

const ownHomeAct = [{
  startTime: '23:00', endTime: '07:00',
  activity: '睡觉', location: '绘世学院 · 宿舍生活区', replyDelay: -1,
  description: '她在自己的房间里睡下，窗帘没拉严。',
}];

test('★★ 行为：角色回到自己住处（受限/不可直达）→ 不报 forbidden-place / unreachable-place', () => {
  const ctx = {
    forbiddenPlaces: new Set(['宿舍生活区']),
    noTransferPlaces: new Set(['宿舍生活区']),
    ownPlaces: new Set(['宿舍生活区']),
  };
  const r = auditSchedule(ownHomeAct, ctx);
  const codes = r.issues.map(i => i.code);
  assert.ok(!codes.includes('forbidden-place'), '自己的住处不该报「进入受限地点」');
  assert.ok(!codes.includes('unreachable-place'), '自己的住处不该报「地点不可直达」');
});

test('★★ 行为：同一地点若**不是**自己的住处 → 仍照常报错（豁免不能过度）', () => {
  const ctx = {
    forbiddenPlaces: new Set(['宿舍生活区']),
    noTransferPlaces: new Set(['宿舍生活区']),
    ownPlaces: new Set(['别的地方']),      // 不包含该地点
  };
  const r = auditSchedule(ownHomeAct, ctx);
  const codes = r.issues.map(i => i.code);
  assert.ok(codes.includes('forbidden-place'), '非自有住处仍应报「进入受限地点」');
  assert.ok(codes.includes('unreachable-place'), '非自有住处仍应报「地点不可直达」');
});

test('★ 行为：豁免走 area 命中同样生效（住处记的是所属区）', () => {
  const ctx = {
    forbiddenPlaces: new Set(['绘世学院']),   // 区域级受限
    ownPlaces: new Set(['绘世学院']),         // 该角色的住处所属区
  };
  const acts = [{ startTime: '10:00', endTime: '12:00', activity: '回家', location: '绘世学院', replyDelay: 0, description: '她回到学院里的住处。' }];
  const r = auditSchedule(acts, ctx);
  assert.ok(!r.issues.map(i => i.code).includes('forbidden-place'), '按区域命中豁免也应生效');
});

test('★ 行为：不传 ownPlaces 时行为与上线前一致（默认不改行为）', () => {
  const ctx = { forbiddenPlaces: new Set(['宿舍生活区']), noTransferPlaces: new Set(['宿舍生活区']) };
  const r = auditSchedule(ownHomeAct, ctx);
  const codes = r.issues.map(i => i.code);
  assert.ok(codes.includes('forbidden-place'), '未传豁免集时应照常报错（保持既有行为）');
});