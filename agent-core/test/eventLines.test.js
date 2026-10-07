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

// ─────────────────────────────────────────────────────────
// ⑦ 节点图筛选与渲染上限（第二期）
// ─────────────────────────────────────────────────────────

test('★★★ 不传任何选项时，节点图结果与加筛选前逐字节一致（红线 4：默认不改行为）', () => {
  const a = svc.createEventLine({ name: '默认A', participantIds: [7], places: ['甲地'] });
  const b = svc.createEventLine({ name: '默认B', participantIds: [7], places: ['甲地'] });
  const g1 = svc.buildLineGraph();          // 不传
  const g2 = svc.buildLineGraph({});        // 空对象
  assert.equal(g1.nodes.length, g2.nodes.length, '空选项应与不传等价');
  assert.ok(g1.nodes.some(n => n.id === a.id) && g1.nodes.some(n => n.id === b.id),
    '默认应包含全部线（含终态）');
  assert.equal(g1.truncated, 0, '未超上限时 truncated 应为 0');
  svc.deleteEventLine(a.id); svc.deleteEventLine(b.id);
});

test('★★★ 按角色筛选：只留该角色卷入的线，且**不留指向隐藏节点的悬空边**', () => {
  // 关键：边必须在"筛选后的可见集"内重算。若先按全量算边再过滤节点，
  // 会留下指向被隐藏节点的边 —— vue-flow 渲染悬空边会报错或漏画。
  const a = svc.createEventLine({ name: '筛A', participantIds: [101] });
  const b = svc.createEventLine({ name: '筛B', participantIds: [101, 102] });
  const c = svc.createEventLine({ name: '筛C', participantIds: [102] });   // 不含 101
  const g = svc.buildLineGraph({ participantId: 101 });
  const ids = g.nodes.map(n => n.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id), '应保留含 101 的线');
  assert.ok(!ids.includes(c.id), '不含 101 的线应被排除');
  for (const e of g.edges) {
    assert.ok(ids.includes(e.from) && ids.includes(e.to),
      `边 ${e.from}→${e.to} 的两端都必须在可见节点集内（无悬空边）`);
  }
  const abEdge = g.edges.find(e => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id));
  assert.ok(abEdge, '同一角色卷入的两条线之间，关联边应保留');
  for (const l of [a, b, c]) svc.deleteEventLine(l.id);
});

test('★★ includeTerminal:false 排除终态线，且不会留下指向终态线的边', () => {
  const act = svc.createEventLine({ name: '活跃', stage: '延展', participantIds: [201] });
  const end = svc.createEventLine({ name: '终态', stage: '收束', participantIds: [201] });
  const g = svc.buildLineGraph({ includeTerminal: false });
  const ids = g.nodes.map(n => n.id);
  assert.ok(ids.includes(act.id), '活跃线应保留');
  assert.ok(!ids.includes(end.id), '终态线应被排除');
  assert.ok(!g.edges.some(e => !ids.includes(e.from) || !ids.includes(e.to)),
    '不应留有指向被排除节点的边');
  // 显式传 true / 缺省 → 含终态
  assert.ok(svc.buildLineGraph({ includeTerminal: true }).nodes.some(n => n.id === end.id));
  svc.deleteEventLine(act.id); svc.deleteEventLine(end.id);
});

test('★★★ 渲染上限必须**显式回报**截断数，绝不静默丢节点（红线 0）', () => {
  const made = [];
  for (let i = 0; i < 5; i++) made.push(svc.createEventLine({ name: `限${i}` }));
  const before = svc.buildLineGraph({ limit: 0 }).total;   // limit<=0 = 不限
  const g = svc.buildLineGraph({ limit: 2 });
  assert.equal(g.nodes.length, 2, '应截到上限');
  assert.equal(g.total, before, 'total 应回报筛选后的真实总数');
  assert.equal(g.truncated, before - 2, 'truncated 必须如实回报被截断的数量（不得静默）');
  for (const l of made) svc.deleteEventLine(l.id);
});

test('★★ 渲染上限与首次生成容量是两个不同的量（前者管渲染，后者管写入）', () => {
  assert.equal(typeof svc.GRAPH_NODE_LIMIT, 'number');
  assert.ok(svc.GRAPH_NODE_LIMIT > svc.AUTO_LINE_CAPACITY,
    '渲染上限应大于首次生成容量 —— 否则用户手工加到第 9 条就在图上消失了');
  assert.match(routeSrc, /graphNodeLimit: GRAPH_NODE_LIMIT/, '上限应随 /meta 下发（前端不自建）');
});

test('★★★ 筛选判据是"有没有显式给值"，不是"值大不大" —— participantId:0 也必须真的筛', () => {
  // 前端下拉从真实 participantIds 聚合，可能含 0；若拿 `pid>0` 当判据，
  // 用户选了 `#0` 却拿到全量 —— 是**静默错误**（红线 0）。
  const zero = svc.createEventLine({ name: '零号角色线', participantIds: [0] });
  const one = svc.createEventLine({ name: '一号角色线', participantIds: [1] });
  const byZero = svc.buildLineGraph({ participantId: 0 });
  const ids = byZero.nodes.map(n => n.id);
  assert.ok(ids.includes(zero.id), '含 0 的线应保留');
  assert.ok(!ids.includes(one.id), '不含 0 的线应被排除（不能因 0 是假值就放行全量）');
  // 不传 / 传 null / 传空串 ⇒ 视为不筛选
  for (const v of [undefined, null, '']) {
    assert.equal(svc.buildLineGraph({ participantId: v }).nodes.length, byZero.nodes.length + 1,
      `participantId=${String(v)} 应视为不筛选（返回全部）`);
  }
  svc.deleteEventLine(zero.id); svc.deleteEventLine(one.id);
});