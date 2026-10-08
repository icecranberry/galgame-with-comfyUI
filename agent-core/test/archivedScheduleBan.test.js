import { test } from 'node:test';
import assert from 'node:assert/strict';

// 归档角色**禁止日程**。
//
// 口径：「归档 = 不参与任何主动行为」（主动聊天 / 朋友圈 / 奇遇 / 拉群 / 小镇奇遇），
// 日程也在其列 —— 归档角色不该再花 token 生成，也不该每天重建今日快照。
//
// ── 为什么要专门钉这个 ──
// 项目里有一条**正确的设计约定**：归档不改写 `schedule_enabled` 等四个细分开关
// （否则"归档再取消"会把用户单独设过的偏好一起抹掉），代价是各处选人要**自己**
// 叠加 `archived = 0`。而这种"靠每个调用点自觉"的约定必然会漏 —— 实测就漏了两处
// **写入**（`snapshotTodaySchedule` 与 `getTodayScheduleRaw` 的 fallback），
// 导致 51 个归档角色每天仍被重建快照。
// 所以现在把判据收口成一个函数（`isScheduleForbidden`），并在两个入口拦截。
// 这个测试同时守「拦截存在」和「不乱拦」。

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`archivedScheduleBan test forbids network: ${url}`); };

const { getDb } = await import('../src/db/index.js');
const gen = await import('../src/services/scheduleGenerator.js');
const mgr = await import('../src/services/scheduleManager.js');

const db = getDb();

/** 造一个角色（archived 0/1 可控）。⚠ `name` 是 NOT NULL，必须一起给 */
function mkChar(name, archived = 0) {
  const r = db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt, archived) VALUES (?, ?, ?, ?)`
  ).run(name, name, `你是${name}。## 你的外观\n黑色长发。`, archived);
  return Number(r.lastInsertRowid);
}
function mkTemplate(id, json = '[{"startTime":"00:00","endTime":"24:00","activity":"待机","location":"某处","replyDelay":0,"tags":[],"description":"x"}]') {
  db.prepare(`INSERT OR REPLACE INTO schedule_templates (character_id, schedule_json, version) VALUES (?, ?, 1)`).run(id, json);
}
function snapshotCount(id) {
  return db.prepare('SELECT COUNT(*) AS n FROM daily_schedules WHERE character_id = ?').pluck().get(id);
}
function cleanup(...ids) {
  for (const id of ids) db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}

// ── 判据本身 ──

test('isScheduleForbidden：归档返回 true，未归档返回 false', () => {
  const a = mkChar('__zz_arch_yes', 1);
  const b = mkChar('__zz_arch_no', 0);
  try {
    assert.equal(gen.isScheduleForbidden(a), true);
    assert.equal(gen.isScheduleForbidden(b), false);
  } finally { cleanup(a, b); }
});

test('isScheduleForbidden：角色不存在 / 查库异常时返回 false（不误拦）', () => {
  assert.equal(gen.isScheduleForbidden(99999999), false, '不存在的角色不该被当成"禁止"');
  assert.equal(gen.isScheduleForbidden(null), false);
  assert.equal(gen.isScheduleForbidden(undefined), false);
});

// ── 入口 1：快照 ──

test('★ snapshotTodaySchedule：归档角色**不重建**快照', () => {
  const id = mkChar('__zz_arch_snap', 1);
  mkTemplate(id);
  try {
    const r = gen.snapshotTodaySchedule(id);
    assert.equal(r, null, '归档角色应直接返回 null');
    assert.equal(snapshotCount(id), 0, '不该写入任何快照');
  } finally { cleanup(id); }
});

test('未归档角色照常建快照（回归：别把所有人都拦了）', () => {
  const id = mkChar('__zz_arch_snap_ok', 0);
  mkTemplate(id);
  try {
    const r = gen.snapshotTodaySchedule(id);
    assert.ok(r, '未归档角色应拿到快照内容');
    assert.equal(snapshotCount(id), 1);
  } finally { cleanup(id); }
});

// ── 入口 2：读今日日程的 fallback ──

test('★ getTodayScheduleRaw 的 fallback：归档角色**不补**当天快照', () => {
  const id = mkChar('__zz_arch_fallback', 1);
  mkTemplate(id);
  try {
    // 先确认没有快照
    assert.equal(snapshotCount(id), 0);
    // 读一次（旧实现会在这里顺手插一条）
    mgr.getTodaySchedule(id);
    assert.equal(snapshotCount(id), 0, '★ 读操作不该给归档角色补快照');
  } finally { cleanup(id); }
});

test('未归档角色读今日日程时会正常派生快照', () => {
  const id = mkChar('__zz_arch_fallback_ok', 0);
  mkTemplate(id);
  try {
    mgr.getTodaySchedule(id);
    assert.equal(snapshotCount(id), 1);
  } finally { cleanup(id); }
});

test('★ 反复读也不累积（归档角色的快照数恒为 0）', () => {
  const id = mkChar('__zz_arch_fallback_loop', 1);
  mkTemplate(id);
  try {
    for (let i = 0; i < 5; i++) mgr.getTodaySchedule(id);
    assert.equal(snapshotCount(id), 0);
  } finally { cleanup(id); }
});

// ── 入口 3：生成 ──

test('★ generateSchedule：归档角色直接跳过（不烧 token）', async () => {
  const id = mkChar('__zz_arch_gen', 1);
  try {
    const r = await gen.generateSchedule({ id, display_name: '__zz_arch_gen', base_prompt: '你是测试角色。' });
    assert.equal(r.skipped, true, '应标记为 skipped');
    assert.equal(r.reason, 'archived');
    assert.equal(r.schedule_json, null);
  } finally { cleanup(id); }
});

test('★ 跳过时是**返回标记**而不是抛错（不能被批量循环当成失败）', async () => {
  const id = mkChar('__zz_arch_gen_nothrow', 1);
  try {
    await assert.doesNotReject(
      () => gen.generateSchedule({ id, display_name: 'x', base_prompt: 'y' }),
      '归档角色不该让 generateSchedule 抛错 —— regenerate-all 的循环会因此中断',
    );
  } finally { cleanup(id); }
});

// ── 启动初始化 ──

test('★ 启动初始化只处理未归档角色（归档的不会被重建快照）', () => {
  const arch = mkChar('__zz_arch_init', 1);
  const live = mkChar('__zz_arch_init_live', 0);
  mkTemplate(arch);
  mkTemplate(live);
  try {
    // 两个都清干净，然后跑一次初始化
    db.prepare('DELETE FROM daily_schedules WHERE character_id IN (?, ?)').run(arch, live);
    mgr.initialize();
    assert.equal(snapshotCount(arch), 0, '★ 归档角色不该在启动时被派生快照');
    assert.ok(snapshotCount(live) >= 1, '未归档角色应照常派生');
  } finally { cleanup(arch, live); }
});

// ── 边界：不该动的数据不能动 ──

test('★ 归档**不清除** schedule_templates（取消归档要能立刻恢复作息）', () => {
  const id = mkChar('__zz_arch_keep_tpl', 1);
  mkTemplate(id);
  try {
    gen.snapshotTodaySchedule(id);
    mgr.getTodaySchedule(id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM schedule_templates WHERE character_id = ?').pluck().get(id);
    assert.equal(n, 1, '模板必须保留 —— 取消归档时不该要求重新烧 token 生成');
  } finally { cleanup(id); }
});

test('★ 归档不依赖 schedule_enabled（开关保持 1 也照样被拦）', () => {
  const id = mkChar('__zz_arch_switch', 1);
  db.prepare('UPDATE characters SET schedule_enabled = 1 WHERE id = ?').run(id);
  mkTemplate(id);
  try {
    assert.equal(gen.isScheduleForbidden(id), true, '判据只看 archived，不看 schedule_enabled');
    assert.equal(gen.snapshotTodaySchedule(id), null);
  } finally { cleanup(id); }
});

test('★ 取消归档后立刻恢复正常（判据读的是当前值，不是缓存）', () => {
  const id = mkChar('__zz_arch_toggle', 1);
  mkTemplate(id);
  try {
    assert.equal(gen.snapshotTodaySchedule(id), null);
    db.prepare('UPDATE characters SET archived = 0 WHERE id = ?').run(id);
    assert.ok(gen.snapshotTodaySchedule(id), '取消归档后应能正常建快照');
    assert.equal(snapshotCount(id), 1);
  } finally { cleanup(id); }
});