/**
 * 工作日 / 休息日差异 —— 回归测试（2026-10-07 用户需求）。
 *
 * 用户原话：「是否可以设置 1 周 7 天的**工作日和休息日差异**？」
 *
 * ── 这道测试要钉住的不变量（都是会静默出错的地方）─────────────
 *   · **没配过日型的角色行为必须一字节不变**（红线 4：长驻功能默认关闭）；
 *   · 星期几 → 日子类型的判定只许有**一份**实现（红线 8）；
 *   · 取"今天该用哪套日程"只许有**一份**实现（两处各写一份必然漂移）；
 *   · 清空日程时必须把日型方案一起清（否则"清空了却还在"）。
 *
 * ⚠ 全程用临时库 + 临时项目库目录，不碰真库、不调 LLM。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-daytype-'));
process.env.DB_PATH = path.join(TMP_DIR, 'agent.db');
process.env.LINSHE_WORLD_PROJECTS_DIR = path.join(TMP_DIR, 'world-projects');
globalThis.fetch = async url => { throw new Error(`dayType test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
const { runRegisteredMigrations } = await import('../src/db/migrationRegistry.js');
const { getDb } = await import('../src/db/index.js');
await loadFeatureMigrations();
runRegisteredMigrations(getDb());

const dt = await import('../src/utils/scheduleDayType.js');
const sg = await import('../src/services/scheduleGenerator.js');

const db = getDb();

function newCharacter(name) {
  const r = db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES (?, ?, ?)`)
    .run(name, name, '你是测试角色。');
  return Number(r.lastInsertRowid);
}
const TPL = JSON.stringify([{ start: '09:00', end: '18:00', activity: '上班' }]);

// ─────────────────────────────────────────────────────────
// ① 日子类型判定：唯一真源
// ─────────────────────────────────────────────────────────

test('★★★ 周六/周日 = 休息日，其余 = 工作日', () => {
  // 2026-10-05 是周一；用固定日期，避免"跑测试那天恰好是周末"导致结论随机
  const days = [
    ['2026-10-05', 'workday'],  // 一
    ['2026-10-06', 'workday'],  // 二
    ['2026-10-07', 'workday'],  // 三
    ['2026-10-08', 'workday'],  // 四
    ['2026-10-09', 'workday'],  // 五
    ['2026-10-10', 'restday'],  // 六
    ['2026-10-11', 'restday'],  // 日
  ];
  for (const [d, want] of days) {
    const date = new Date(`${d}T12:00:00`);
    assert.equal(dt.dayTypeOf(date), want, `${d} 应为 ${want}`);
  }
});

test('★★ 非法输入不抛错（调用方在快照热路径上）', () => {
  assert.equal(dt.dayTypeOf(new Date('nonsense')), 'workday');
  assert.equal(dt.normalizeDayType('乱写'), 'workday', '不认识的值回落 workday，不抛');
  assert.equal(dt.normalizeDayType('restday'), 'restday');
  assert.equal(dt.dayTypeLabel('restday'), '休息日');
});

test('★★ 枚举只有工作/休息两种（防止有人再加第三种却不改判定）', () => {
  assert.deepEqual(dt.DAY_TYPES.slice().sort(), ['restday', 'workday']);
});

// ─────────────────────────────────────────────────────────
// ② 迁移与落库
// ─────────────────────────────────────────────────────────

test('★★★ 迁移 006：schedule_day_plans 表就绪，且 (character_id, day_type) 唯一', () => {
  const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_day_plans'`).get();
  assert.ok(t, '缺 schedule_day_plans 表');
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='schedule_day_plans'`).get().sql;
  assert.match(sql, /UNIQUE\(character_id, day_type\)/i, '同一角色同一日子类型只该有一套');
});

// ─────────────────────────────────────────────────────────
// ③ 取"今天该用哪套"：唯一真源，且没配就回落默认日历
// ─────────────────────────────────────────────────────────

test('★★★ 没配日型 → 取到默认日历（行为与从前一致）', () => {
  const cid = newCharacter('没配日型者');
  db.prepare('INSERT INTO schedule_templates (character_id, schedule_json) VALUES (?, ?)').run(cid, TPL);

  const workday = sg.resolveScheduleTemplateFor(db, cid, new Date('2026-10-05T12:00:00'));
  assert.equal(workday.source, 'default');
  assert.equal(workday.json, TPL);

  const weekend = sg.resolveScheduleTemplateFor(db, cid, new Date('2026-10-10T12:00:00'));
  assert.equal(weekend.source, 'default', '没配休息日方案时，周末也用默认日历');
});

test('★★★ 配了休息日方案 → 周六取休息日、周三取默认（差异真的生效）', () => {
  const cid = newCharacter('配了日型者');
  db.prepare('INSERT INTO schedule_templates (character_id, schedule_json) VALUES (?, ?)').run(cid, TPL);
  const REST = JSON.stringify([{ start: '11:00', end: '23:00', activity: '休息、逛街' }]);
  db.prepare('INSERT INTO schedule_day_plans (character_id, day_type, schedule_json) VALUES (?, ?, ?)')
    .run(cid, 'restday', REST);

  const sat = sg.resolveScheduleTemplateFor(db, cid, new Date('2026-10-10T12:00:00'));
  assert.equal(sat.source, 'day-plan');
  assert.equal(sat.dayType, 'restday');
  assert.equal(sat.json, REST);

  const wed = sg.resolveScheduleTemplateFor(db, cid, new Date('2026-10-07T12:00:00'));
  assert.equal(wed.source, 'default', '工作日没配方案时回落默认日历');
  assert.equal(wed.json, TPL);
});

test('★★ 两套都配 → 各取各的，不串', () => {
  const cid = newCharacter('两套都配者');
  const W = JSON.stringify([{ activity: '通勤上班' }]);
  const R = JSON.stringify([{ activity: '在家躺平' }]);
  db.prepare('INSERT INTO schedule_day_plans (character_id, day_type, schedule_json) VALUES (?, ?, ?)').run(cid, 'workday', W);
  db.prepare('INSERT INTO schedule_day_plans (character_id, day_type, schedule_json) VALUES (?, ?, ?)').run(cid, 'restday', R);
  assert.equal(sg.resolveScheduleTemplateFor(db, cid, new Date('2026-10-07T12:00:00')).json, W);
  assert.equal(sg.resolveScheduleTemplateFor(db, cid, new Date('2026-10-10T12:00:00')).json, R);
});

test('★★★ 没有任何日程的角色 → null（不能造出空日程）', () => {
  const cid = newCharacter('啥都没有者');
  assert.equal(sg.resolveScheduleTemplateFor(db, cid, new Date()), null);
});

// ─────────────────────────────────────────────────────────
// ④ 接线与防漂移（静态）
// ─────────────────────────────────────────────────────────

test('★★★ 取模板只许有一份实现：两个调用方都用 resolveScheduleTemplateFor', () => {
  const gen = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  const mgr = fs.readFileSync(path.join(SRC, 'services/scheduleManager.js'), 'utf8');
  assert.match(gen, /resolveScheduleTemplateFor\(db, characterId/, 'snapshotTodaySchedule 应用唯一真源');
  assert.match(mgr, /resolveScheduleTemplateFor\(db, characterId/, 'scheduleManager 的 fallback 应用同一函数');
  // ⚠ scheduleManager 不得再自己写一份"查 schedule_templates"的回退（那就是第二份实现）
  const fb = mgr.slice(mgr.indexOf('fallback: 取'), mgr.indexOf('reapplyActiveEventSchedule', mgr.indexOf('fallback: 取')));
  assert.ok(!/FROM schedule_templates/.test(fb), 'fallback 里不得再直查 schedule_templates');
});

test('★★ 日子类型绝不进共享常量 scheduleInst（会打穿 LLM 前缀缓存）', () => {
  const gen = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  const i = gen.indexOf('const scheduleInst =');
  const inst = gen.slice(i, i + 6000);
  assert.ok(!/工作日|休息日|dayType/.test(inst), 'scheduleInst 里不得出现日子类型相关字样');
  // 注入点必须在约束层函数体里
  const cbi = gen.indexOf('export function buildScheduleConstraintBlock');
  const body = gen.slice(cbi, gen.indexOf('if (!parts.length) return null;', cbi));
  assert.match(body, /【今天是/, '约束层里应有"今天是…"那一段');
});

test('★★★ 没配日型时提示词不变：dayType 为空则整段不出现', async () => {
  const gen = await import('../src/services/scheduleGenerator.js');
  const empty = gen.buildScheduleConstraintBlock({});
  assert.ok(!empty || !empty.includes('【今天是'), '不传 dayType 时不得出现"今天是…"');
  const withDay = gen.buildScheduleConstraintBlock({ dayType: 'restday' });
  assert.ok(withDay.includes('【今天是休息日】'), '传了才出现');
  assert.match(withDay, /不排.*工作/s, '休息日要明确"不排常规工作"');
});

test('★★ 清空日程必须连按日型的方案一起清（否则"清空了却还在"）', () => {
  const route = fs.readFileSync(path.join(SRC, 'routes/schedule.js'), 'utf8');
  const seg = route.slice(route.indexOf('清空日程数据'), route.indexOf('清空日程数据') + 700);
  assert.match(seg, /DELETE FROM daily_schedules/, '应清当天快照');
  assert.match(seg, /DELETE FROM schedule_templates/, '应清默认日历');
  assert.match(seg, /DELETE FROM schedule_day_plans/, '★ 必须连按日型的方案一起清');
});

test('★★ 前端只在选了日子类型时才传（不选 = 后端不写日型）', () => {
  const view = fs.readFileSync(path.resolve(__dirname, '../../web-ui/src/views/ScheduleView.vue'), 'utf8');
  assert.match(view, /\.\.\.\(regenDayType\.value \? \{ dayType: regenDayType\.value \} : \{\}\)/, '仅选中时携带');
  // 档位来自后端，前端不写死中文
  assert.match(view, /regenDayTypeOptions/, '档位应来自后端 regenerate-options');
});