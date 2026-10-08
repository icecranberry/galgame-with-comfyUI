/**
 * 日程台账假阳性修复 —— 回归测试。
 *
 * 用户实报（2026-10-06）：「日程的帐台（审计）基本上没用」。
 * 实测台账接口**功能正常**（HTTP 200、68 个角色、明细齐全），34 个问题里 28 个是假阳性，
 * 于是"一打开就是一片红"，信号被噪声淹没。逐条查实四类根因：
 *
 *  ① **「真珠办公室」受限闯入 ×8** —— 地图标 `private`（"谢绝外人"说的是别人进不去），
 *     但真珠**在那里办公**。豁免集只认 home_place/sleep_place/home_area，而这三个字段是 null。
 *  ② **「22:00-24:00」报 `bad-time`（error 级）×2** —— `toMin` 拒绝 `h > 23`，
 *     但 LLM 用 `24:00` 表达"到当天午夜"是**合法写法**。
 *  ③ **同一问题重复计数** —— 「真珠办公室」8 条其实同源（一天 8 个时段都在自己办公室），
 *     展开后 8 条一模一样 —— 这是"点开全是重复"的直接原因。
 *  ④ 睡眠 0 小时属于上述 ①②的连带（解析失败 → span 为 null → 不计入 sleepMin）。
 *
 * 用户裁定：① 加「工作地」字段 ② 解析器接受 24:00 ③ 修到能用（去重合并）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`ledger test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const ledgerSrc = fs.readFileSync(path.join(SRC, 'services/scheduleLedger.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(SRC, 'db/index.js'), 'utf8');
// 工作地回填迁移已迁出到可插拔迁移目录（架构加固 P1）：断言改为扫**迁移实现文件**，
// 否则"实现搬家"会被误报成"迁移丢失"。
const workplaceMigrationSrc = fs.readFileSync(
  path.join(SRC, 'db/migrations/001_character_workplace_seed.migration.js'),
  'utf8'
);
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/characters.js'), 'utf8');

const { auditSchedule } = await import('../src/services/scheduleLedger.js');

// ─────────────────────────────────────────────────────────
// ① 工作地豁免（自有办公处不算闯入）
// ─────────────────────────────────────────────────────────

test('★★ 工作地必须并入豁免集 —— 在自家办公室上班不算闯入', () => {
  const acts = [
    { startTime: '09:00', endTime: '18:00', activity: '办公', location: '珠星集团CBD区·真珠办公室', replyDelay: 0, description: 'x'.repeat(12) },
  ];
  const forbidden = new Set(['真珠办公室']);
  // 未给豁免：应报（证明样本确实会命中）
  const raw = auditSchedule(acts, { forbiddenPlaces: forbidden });
  assert.ok(raw.issues.some(i => i.code === 'forbidden-place'), '未豁免时应报出闯入');
  // 给了工作地豁免：不该报
  const ok = auditSchedule(acts, { forbiddenPlaces: forbidden, ownPlaces: new Set(['真珠办公室']) });
  assert.ok(!ok.issues.some(i => i.code === 'forbidden-place'), '自有工作地不该被报闯入');
});

test('★★ auditCharacter 必须读 work_place 并纳入豁免', () => {
  assert.match(ledgerSrc, /work_place/, '应读 work_place 字段');
  // 必须与住处同处一个豁免循环（同一个 Set），不做来源区分
  const seg = ledgerSrc.match(/const ownPlaces = new Set\(\);[\s\S]{0,400}/)?.[0] || '';
  assert.match(seg, /home_place/, '豁免集应含 home_place');
  assert.match(seg, /work_place/, '豁免集应含 work_place');
});

test('★ DB 迁移：characters 新增 work_place 列', () => {
  assert.match(dbSrc, /add\('work_place'/, '缺少 work_place 列迁移');
});

test('★★ 工作地回填只认「名字开头 + 分类办公」，绝不猜', () => {
  assert.match(workplaceMigrationSrc, /export function run/, '迁移必须导出 run(db)');
  assert.match(workplaceMigrationSrc, /export const id = '001_character_workplace_seed'/, '迁移 id 必须与文件名一致');
  const i = workplaceMigrationSrc.indexOf('export function run');
  const seg = workplaceMigrationSrc.slice(i, i + 2400);
  assert.match(seg, /办公/, '必须限定 category 含「办公」');
  assert.match(seg, /startsWith/, '必须按名字开头匹配');
  // 排除住处类（「三月七的个人房间」不是办公地）
  assert.match(seg, /level = 3|level=3/, '只认 lv3 地点');
  // 不覆盖用户已填
  assert.match(seg, /work_place IS NULL/, '不得覆盖用户已填的工作地');
  assert.match(seg, /character_workplace_seed_v1/, '需要一次性标记');
});

test('★ 工作地回填迁移**不再**在 db/index.js 里重复实现', () => {
  assert.ok(
    !/function migrateCharacterWorkPlaceSeed/.test(dbSrc),
    'db/index.js 不得再保留同名私有实现（会与 migrations/ 版本分叉）'
  );
  assert.ok(
    !/^\s*migrateCharacterWorkPlaceSeed\(db\);/m.test(dbSrc),
    'initSchema 里不得再调用已迁出的迁移（此时插件尚未加载，会静默 no-op）'
  );
});

test('★ 角色 API 接受 work_place', () => {
  assert.match(routeSrc, /work_place/, 'PUT /characters/:id 应接受 work_place');
});

// ─────────────────────────────────────────────────────────
// ② 24:00 必须被接受
// ─────────────────────────────────────────────────────────

test('★★ 「22:00-24:00」不再报 bad-time（LLM 表达"到午夜"的合法写法）', () => {
  const acts = [
    { startTime: '22:00', endTime: '24:00', activity: '夜间安睡', location: '卧房', replyDelay: -1, description: 'x'.repeat(12) },
  ];
  const r = auditSchedule(acts, {});
  assert.ok(!r.issues.some(i => i.code === 'bad-time'), '24:00 不该被当成格式错误');
});

test('★★ 接受 24:00 后睡眠时长必须被正确计入（连带修复）', () => {
  // 22:00→24:00 是 2 小时；再补足到 5h 以上以避开 sleep-short
  const acts = [
    { startTime: '00:00', endTime: '05:00', activity: '睡眠', location: '卧房', replyDelay: -1, description: 'x'.repeat(12) },
    { startTime: '22:00', endTime: '24:00', activity: '睡眠', location: '卧房', replyDelay: -1, description: 'x'.repeat(12) },
  ];
  const r = auditSchedule(acts, {});
  assert.ok(!r.issues.some(i => i.code === 'bad-time'), '不得因 24:00 判格式错');
  // 5h + 2h = 7h，必须被计入（旧口径下 22:00-24:00 整段丢失）
  assert.equal(r.stats.sleepHours, 7, `睡眠应计为 7 小时，实际 ${r.stats.sleepHours}`);
  assert.ok(!r.issues.some(i => i.code === 'sleep-short'), '不应误报睡眠不足');
});

test('★ 非法时间仍要拦（不能因为放宽 24:00 就全都放过）', () => {
  for (const bad of ['25:00', '24:30', '12:60', 'abc', '']) {
    const r = auditSchedule([{ startTime: '09:00', endTime: bad, activity: 'a', location: 'b', replyDelay: 0, description: 'x'.repeat(12) }], {});
    assert.ok(r.issues.some(i => i.code === 'bad-time'), `「${bad}」应仍被拦下`);
  }
});

// ─────────────────────────────────────────────────────────
// ③ 同类问题去重（"点开全是重复"的直接原因）
// ─────────────────────────────────────────────────────────

test('★★ 同一 code + 同一对象在同一份日程里只计一次', () => {
  const acts = [];
  // 造 8 个时段都在同一个受限地点（还原「真珠办公室 ×8」的真实场景）
  for (let i = 0; i < 8; i++) {
    const h = String(9 + i).padStart(2, '0');
    acts.push({ startTime: `${h}:00`, endTime: `${h}:30`, activity: `办公${i}`, location: '珠星集团CBD区·真珠办公室', replyDelay: 0, description: 'x'.repeat(12) });
  }
  const r = auditSchedule(acts, { forbiddenPlaces: new Set(['真珠办公室']) });
  const hits = r.issues.filter(i => i.code === 'forbidden-place');
  // auditSchedule 本身**逐条**报（它是底层体检），去重在 auditCharacter 的聚合层做
  assert.equal(hits.length, 8, 'auditSchedule 逐条报（底层行为不变）');
});

test('★★ auditCharacter 的聚合必须去重（riskByCode 计"问题种类"而非重复条数）', () => {
  assert.match(ledgerSrc, /function pickIssueObject/, '需要取问题对象的辅助函数');
  assert.match(ledgerSrc, /function dedupeIssues/, '需要去重辅助函数');
  assert.match(ledgerSrc, /const agg = new Map\(\)/, '聚合层应通过 Map 去重');
  // latest.issues 也必须去重（否则展开后又是 8 条一样的话）
  assert.match(ledgerSrc, /issues:\s*dedupeIssues\(/, 'latest.issues 必须去重');
  // 去重后仍保留出现次数供参考
  assert.match(ledgerSrc, /occurrences/, '应记录出现次数');
});

test('★ 去重键必须含「对象」而不是只按 code（不同地点的闯入是不同问题）', () => {
  const i = ledgerSrc.indexOf('function pickIssueObject');
  const seg = ledgerSrc.slice(i, i + 600);
  assert.match(seg, /「\(\[\^」\]\+\)」/, '应从 detail 里取被引号括起的对象名');
});

test('★ 总览 totalIssues 现在统计去重后的种类数', () => {
  const i = ledgerSrc.indexOf('const totalIssues');
  const seg = ledgerSrc.slice(i, i + 220);
  assert.match(seg, /riskByCode/, '应从去重后的 riskByCode 汇总');
});

test('★ 前端展示出现次数（让"重复"变成可见信息而不是噪声）', () => {
  const view = fs.readFileSync(path.resolve(__dirname, '../../web-ui/src/views/ScheduleView.vue'), 'utf8');
  assert.match(view, /occurrences/, '前端应展示 occurrences');
  assert.match(view, /已按「同类问题\+同一对象」去重/, '应说明已去重');
});
// ─────────────────────────────────────────────────────────
// ⑤ replyDelay 兜底不得抹平睡眠块（真实数据事故）
// ─────────────────────────────────────────────────────────

const { sanitizeActivityInput } = await import('../src/services/scheduleEditor.js');

test('★★ 未传 replyDelay 时必须沿用原条目值（否则睡眠块被静默改成可回复）', () => {
  // 事故还原：三月七 10-06 快照里「02:00-10:30 睡到自然醒」的 replyDelay 由 -1 变成 0，
  // 带 edited=manual 标记 → 根因是手动编辑路径的兜底 `0` 把原值覆盖了。
  const r = sanitizeActivityInput(
    { startTime: '02:00', endTime: '10:30', activity: '睡到自然醒' },
    { fallback: -1 },
  );
  assert.equal(r.replyDelay, -1, '未传时应沿用原条目的 -1');
});

test('★★ 显式传值优先于兜底（用户真想改成可回复也能改）', () => {
  const r = sanitizeActivityInput(
    { startTime: '02:00', endTime: '10:30', activity: '睡到自然醒', replyDelay: 0 },
    { fallback: -1 },
  );
  assert.equal(r.replyDelay, 0, '显式 0 应被尊重');
});

test('★ 无原值可沿用时才回落 0（新建条目/约定插入）', () => {
  assert.equal(sanitizeActivityInput({ startTime: '09:00', endTime: '10:00', activity: 'x' }).replyDelay, 0);
  assert.equal(sanitizeActivityInput({ startTime: '09:00', endTime: '10:00', activity: 'x' }, { fallback: null }).replyDelay, 0);
});

test('★★ 手动编辑路径必须传 fallback（接线完整性）', () => {
  const src = fs.readFileSync(path.join(SRC, 'services/scheduleEditor.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function updateScheduleActivity'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /fallback:\s*base\.replyDelay/, 'updateScheduleActivity 必须传 base.replyDelay 作兜底');
});

test('★ 台账「睡眠 0 小时」这类告警在修复后应能反映真实数据问题', () => {
  // 这是修复前暴露出的**真问题**（不是台账假阳性）—— 保留告警能力很重要
  const acts = [
    { startTime: '00:00', endTime: '02:00', activity: '深夜翻相册', location: 'a', replyDelay: 0, description: 'x'.repeat(12) },
    { startTime: '02:00', endTime: '10:30', activity: '睡到自然醒', location: 'a', replyDelay: 0, description: 'x'.repeat(12) },
  ];
  const r = auditSchedule(acts, {});
  assert.ok(r.issues.some(i => i.code === 'sleep-short'), '全 0 的日程应报睡眠不足（证明台账仍有信号）');
});
