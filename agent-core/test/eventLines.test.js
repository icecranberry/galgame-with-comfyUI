/**
 * T2 事件线服务 —— 回归测试。
 *
 * 来源：ST 插件「构画」逆向移植（`10-投递箱/2026-10-07_ST插件逆向移植评估/`）。
 * 移植的是它的**纯逻辑层**（阶段机 / 别名归一 / 锁线保护 / 容量上限），
 * **不移植**宿主适配层（`setExtensionPrompt`、楼层锚定 —— 邻舍没有这些概念）。
 *
 * ★★ 关键认知（用户已裁定）：构画的"节点"指**聊天楼层**，它的节点图是楼层视角，
 *   对邻舍无意义。本模块的节点 = **事件线本身**。测试里钉住这个区别。
 *
 * ⚠ 全部用内存库，不调 LLM。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(os.tmpdir(), `linshe-eventlines-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`event lines test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const svcSrc = fs.readFileSync(path.join(SRC, 'services/story/eventLineService.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/story.js'), 'utf8');

// 迁移在 app.js 里加载，测试不跑 app.js → 显式按同一序列跑一遍
const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
const { runRegisteredMigrations } = await import('../src/db/migrationRegistry.js');
const { getDb } = await import('../src/db/index.js');
await loadFeatureMigrations();
runRegisteredMigrations(getDb());

const svc = await import('../src/services/story/eventLineService.js');

// ─────────────────────────────────────────────────────────
// ① 阶段机（抄构画的口径）
// ─────────────────────────────────────────────────────────

test('★★ 阶段机与构画同口径（起线/延展/成形/收束/淡出）', () => {
  assert.deepEqual(svc.LINE_STAGES, ['起线', '延展', '成形', '收束', '淡出']);
  assert.deepEqual(svc.TERMINAL_LINE_STAGES, ['收束', '淡出']);
  assert.equal(svc.AUTO_LINE_CAPACITY, 8, '首次生成容量与构画同口径');
});

test('★★★ 阶段别名必须归一（"已完"→收束、"已失败"→淡出）—— 否则模型换个说法就漂移', () => {
  assert.equal(svc.normalizeLineStage('已完成'), '收束');
  assert.equal(svc.normalizeLineStage('已失败'), '淡出');
  assert.equal(svc.normalizeLineStage('萌芽'), '起线');
  assert.equal(svc.normalizeLineStage('发酵'), '延展');
  assert.equal(svc.normalizeLineStage('高潮'), '成形');
  // 英文别名
  assert.equal(svc.normalizeLineStage('completed'), '收束');
  assert.equal(svc.normalizeLineStage('faded'), '淡出');
  // 合法值原样
  for (const s of svc.LINE_STAGES) assert.equal(svc.normalizeLineStage(s), s, `${s} 应原样`);
});

test('★★ 不认识的阶段落「起线」而不是抛错（不能因一个怪值毁掉整条线）', () => {
  assert.equal(svc.normalizeLineStage('某个没见过的说法'), '起线');
  assert.equal(svc.normalizeLineStage(''), '起线');
  assert.equal(svc.normalizeLineStage(null), '起线');
});

test('★ 终态判定（收束/淡出）', () => {
  assert.equal(svc.isTerminalStage('收束'), true);
  assert.equal(svc.isTerminalStage('淡出'), true);
  assert.equal(svc.isTerminalStage('已完成'), true, '别名也应判为终态');
  assert.equal(svc.isTerminalStage('延展'), false);
  assert.equal(svc.isTerminalStage('起线'), false);
});

// ─────────────────────────────────────────────────────────
// ② CRUD 与人工编辑
// ─────────────────────────────────────────────────────────

test('★★ 建/查/改/删事件线', () => {
  const l = svc.createEventLine({ name: '绯英的连环画稿约', stage: '起线', desc: '编辑部邀约', agency: 'player' });
  assert.ok(l.id > 0, '应返回 id');
  assert.equal(l.stage, '起线');
  assert.equal(l.terminal, false);
  assert.equal(l.agency, 'player');

  const got = svc.getEventLine(l.id);
  assert.equal(got.name, '绯英的连环画稿约');

  const upd = svc.updateEventLine(l.id, { stage: '延展', next: '与编辑面谈' });
  assert.equal(upd.stage, '延展');
  assert.equal(upd.next, '与编辑面谈');

  assert.equal(svc.deleteEventLine(l.id), true);
  assert.equal(svc.getEventLine(l.id), null, '删除后应查不到');
});

test('★★★ 人工编辑不受自动护栏约束（含"把阶段从终态改回进行中"）', () => {
  // L10 的教训：护栏只作用于 AI 产出，人工编辑必须原样落库。
  const l = svc.createEventLine({ name: 'X', stage: '延展' });
  const back = svc.updateEventLine(l.id, { stage: '收束' });
  assert.equal(back.stage, '收束');
  const revive = svc.updateEventLine(l.id, { stage: '延展' });
  assert.equal(revive.stage, '延展', '人工应能把已收束的线改回延展（不被"终态不可逆"规则拦住）');
  svc.deleteEventLine(l.id);
});

test('★ 无名事件线必须拒绝（不静默存空名）', () => {
  assert.throws(() => svc.createEventLine({ desc: '没名字' }), /必须有名字/);
  assert.throws(() => svc.createEventLine({ name: '   ' }), /必须有名字/);
});

test('★ 不存在的线：查询返回 null，更新抛错（不静默）', () => {
  assert.equal(svc.getEventLine(999999), null);
  assert.throws(() => svc.updateEventLine(999999, { name: 'x' }), /不存在/);
  assert.equal(svc.deleteEventLine(999999), false);
});

// ─────────────────────────────────────────────────────────
// ③ 锁线保护（构画最值得抄的一处）
// ─────────────────────────────────────────────────────────

test('★★★ 人工锁线：可切换，且状态落库', () => {
  const l = svc.createEventLine({ name: '锁线测试' });
  assert.equal(l.pin, false, '新建默认不锁');
  assert.equal(svc.setEventLinePin(l.id, true), true);
  assert.equal(svc.getEventLine(l.id).pin, true, '锁上后应持久化');
  assert.equal(svc.setEventLinePin(l.id, false), true);
  assert.equal(svc.getEventLine(l.id).pin, false);
  svc.deleteEventLine(l.id);
});

test('★★ 对不存在的线加锁返回 false（不静默成功）', () => {
  assert.equal(svc.setEventLinePin(999999, true), false);
});

// ─────────────────────────────────────────────────────────
// ④ 节点图：边必须**自动算**，不让 AI 生成
// ─────────────────────────────────────────────────────────

test('★★★ 节点图：节点=事件线（不是楼层 —— 这是与构画的关键差别）', () => {
  // 构画的"节点"指聊天楼层；邻舍没有楼层概念，照搬会画出无意义的图。
  const g = svc.buildLineGraph();
  assert.ok(Array.isArray(g.nodes), '应有 nodes');
  assert.ok(Array.isArray(g.edges), '应有 edges');
  if (g.nodes.length) {
    const n = g.nodes[0];
    assert.ok('stage' in n && 'name' in n, '节点应是事件线对象（含 name/stage）');
    assert.ok(!('floorId' in n), '节点不应含楼层概念（那是构画特有的）');
  }
});

test('★★★ 关联边由结构性事实自动算（共享角色/地点），不靠语义推断', () => {
  const a = svc.createEventLine({ name: 'A线', participantIds: [1, 2], places: ['嬉步街'] });
  const b = svc.createEventLine({ name: 'B线', participantIds: [2, 3], places: ['鸽川大道'] });
  const c = svc.createEventLine({ name: 'C线', participantIds: [9], places: ['别处'] });
  const g = svc.buildLineGraph();
  const ab = g.edges.find(e => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id));
  assert.ok(ab, '共享角色 2 的两条线之间必须有边');
  assert.equal(ab.kind, 'related');
  assert.match(ab.label, /同角色/, '边标签应说明关联依据');
  const ac = g.edges.find(e => (e.from === a.id && e.to === c.id) || (e.from === c.id && e.to === a.id));
  assert.equal(ac, undefined, '无共享的线之间**不应**有边（不造假关系）');
  for (const l of [a, b, c]) svc.deleteEventLine(l.id);
});

test('★★ 派生边来自显式字段（derived_from），不猜', () => {
  const p = svc.createEventLine({ name: '父线' });
  const ch = svc.createEventLine({ name: '子线', derivedFrom: p.id });
  const g = svc.buildLineGraph();
  const e = g.edges.find(x => x.from === p.id && x.to === ch.id);
  assert.ok(e, '应生成派生边');
  assert.equal(e.kind, 'derive');
  svc.deleteEventLine(ch.id); svc.deleteEventLine(p.id);
});

test('★ 损坏的 JSON 字段不毁掉整个列表（落空数组）', () => {
  const l = svc.createEventLine({ name: '坏数据容忍' });
  getDb().prepare("UPDATE event_lines SET participant_ids = 'not-json' WHERE id = ?").run(l.id);
  const got = svc.getEventLine(l.id);
  assert.deepEqual(got.participantIds, [], '损坏时应落空数组而非抛错');
  assert.doesNotThrow(() => svc.listEventLines(), '列表也不应因单条坏数据抛错');
  svc.deleteEventLine(l.id);
});

test('★★ 列表排序：活跃线在前、终态在后（便于"当前在推进什么"一目了然）', () => {
  const a = svc.createEventLine({ name: '终态线', stage: '收束' });
  const b = svc.createEventLine({ name: '活跃线', stage: '成形' });
  const list = svc.listEventLines();
  const ia = list.findIndex(x => x.id === a.id);
  const ib = list.findIndex(x => x.id === b.id);
  assert.ok(ib < ia, '活跃线（成形）应排在终态线（收束）之前');
  svc.deleteEventLine(a.id); svc.deleteEventLine(b.id);
});

// ─────────────────────────────────────────────────────────
// ⑤ 容量上限
// ─────────────────────────────────────────────────────────

test('★★ 首次生成限 8 条（超量按原始顺序只取前 8，与构画同口径）', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `线${i + 1}` }));
  assert.equal(svc.limitInitialLines(many, 8, true).length, 8, '首次应截到 8');
  assert.deepEqual(svc.limitInitialLines(many, 8, true).map(x => x.name).slice(0, 2), ['线1', '线2'],
    '应保留**原始顺序**的前 8 个');
});

test('★★★ 非首次（已有线）时**不**限额 —— 否则用户永远加不到 8 条以上', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `线${i + 1}` }));
  assert.equal(svc.limitInitialLines(many, 8, false).length, 12, '非首次不应裁剪');
});

// ─────────────────────────────────────────────────────────
// ⑥ 与奇遇的边界 + 路由约定
// ─────────────────────────────────────────────────────────

test('★★★ 不得读写 character_events（用户裁定"不要碰奇遇"）', () => {
  // ⚠ 必须**剥掉注释**再判：文件头的说明里会提到 `character_events` 来交代边界，
  //   那不叫"引用"。只清 `//` 行注释不够 —— 块注释（`/** */`）也要清（这坑之前踩过）。
  const code = svcSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/character_events/.test(code),
    '事件线服务的**代码**不应触碰奇遇表（两表并存、各管各的）');
});

test('★★ 路由走约定式挂载（文件名 → /api/story），无需改 app.js', () => {
  // 文件名 story.js → /api/story，这是 _autoMount 的约定；
  // 本测试钉住"用默认导出 Router、不自定义 mount"，避免有人加个 mount 让它漂到别处。
  assert.match(routeSrc, /export default router/, '应默认导出 Router（约定式挂载的前提）');
  assert.ok(!/export const mount/.test(routeSrc), '不应自定义 mount —— 保持约定式（/api/story）');
  assert.match(routeSrc, /router\.get\('\/meta'/, '应下发 stages 真源给前端');
  assert.match(routeSrc, /router\.get\('\/graph'/, '应提供节点图接口');
  assert.match(routeSrc, /router\.put\('\/lines\/:id\/pin'/, '应有锁线开关接口');
});

test('★★ 阶段/容量只在后端定义一份（前端经 /meta 渲染，不自建）', () => {
  assert.match(routeSrc, /stages: LINE_STAGES/, 'stages 应来自服务层常量');
  assert.match(routeSrc, /terminalStages: TERMINAL_LINE_STAGES/, '终态应来自服务层常量');
  assert.match(routeSrc, /capacity: AUTO_LINE_CAPACITY/, '容量应来自服务层常量');
});

test('★ 非法输入返回 4xx 而非 5xx（参数问题不该报成服务故障）', () => {
  assert.match(routeSrc, /res\.status\(400\)\.json/, '建线失败应 400');
  assert.match(routeSrc, /code = \/不存在\/\.test\(err\.message\) \? 404 : 400/, '更新应区分 404/400');
});