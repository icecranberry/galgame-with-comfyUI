/**
 * 日程台账（长期观测）—— 回归测试
 *
 * 台账的意义是**量化观测八股/稳定性/风险**，一旦统计口径被改错，
 * 给人的观察结论就会整个失真。这里钉住几条最容易悄悄写错的：
 *
 *   ★ totalIssues 必须等于逐角色 risk 计数之和 —— 曾因内层 reduce 误用外层
 *     累加变量（变量遮蔽），每轮 `2*s` 指数放大，接口直接吐 2^44 级天文数字。
 *     这条断言就是那个 bug 的守门人。
 *   · 复读率必须落在 0~100，且同一天互相比较才有意义
 *   · 没有日程的角色不进台账（避免满屏空行）
 *   · 风险码集合是前后端契约（前端 riskLabel 按它做中文映射），改名要同步
 *
 * 用内存库跑：不碰真库、不调 LLM。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `linshe-ledger-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`ledger test forbids network: ${url}`); };

const { getDb } = await import('../src/db/index.js');
const { ledgerOverview, auditCharacter } = await import('../src/services/scheduleLedger.js');

// ── 造一个最小可用的库 ──
const db = getDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY, display_name TEXT, archived INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS daily_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER, schedule_date TEXT, schedule_json TEXT, generated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS schedule_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER, schedule_json TEXT, generated_at TEXT, version INTEGER
  );
`);

function dayActivities(places, prefix = '活动') {
  // 24h 连续覆盖，每条 1 小时，location 用「区域·地点」两级写法
  const arr = {};
  for (let i = 0; i < 24; i++) {
    const hh = String(i).padStart(2, '0');
    const nxt = String((i + 1) % 24).padStart(2, '0');
    arr[String(i)] = {
      startTime: `${hh}:00`,
      endTime: i === 23 ? '24:00' : `${nxt}:00`,
      activity: `${prefix}${i}`,
      location: `测试区·${places[i % places.length]}`,
      description: `这是第${i}段活动的详细描述，用来避免描述过短的风险码。`,
      replyDelay: 0,
    };
  }
  return arr;
}

const insDaily = db.prepare('INSERT INTO daily_schedules (character_id, schedule_date, schedule_json, generated_at) VALUES (?,?,?,?)');
const insTmpl = db.prepare('INSERT INTO schedule_templates (character_id, schedule_json, generated_at, version) VALUES (?,?,?,?)');
// ⚠ characters 真表有 NOT NULL 列（name/display_name/base_prompt/emotion_baseline）——
//   这里跟着真表契约填，别再自造精简表（CREATE TABLE IF NOT EXISTS 不会覆盖既有表）
const insChar = db.prepare('INSERT INTO characters (id, name, display_name, base_prompt, emotion_baseline, archived) VALUES (?,?,?,?,?,?)');
const addChar = (id, name) => insChar.run(id, name, name, '', '', 0);

// 角色 1：两天日程 + 模板（会触发稳定性与复读统计）
addChar(90001, '甲');
insDaily.run(90001, '2026-01-01', JSON.stringify(dayActivities(['A地', 'B地'])), '2026-01-01 08:00:00');
insDaily.run(90001, '2026-01-02', JSON.stringify(dayActivities(['A地', 'B地'])), '2026-01-02 08:00:00');
insTmpl.run(90001, JSON.stringify(dayActivities(['A地', 'B地'])), '2026-01-01 07:00:00', 1);

// 角色 2：只有模板，没有每日快照
addChar(90002, '乙');
insTmpl.run(90002, JSON.stringify(dayActivities(['C地'])), '2026-01-01 07:00:00', 1);

// 角色 3：完全没有日程
addChar(90003, '丙');

test('没有日程的角色不进台账', () => {
  const r = ledgerOverview();
  const names = r.characters.map(c => c.character.name);
  assert.ok(!names.includes('丙'), '未生成过日程的角色不应出现');
  assert.ok(names.includes('甲') && names.includes('乙'), '有日程的应出现');
});

test('★ totalIssues 必须等于逐角色风险计数之和（防变量遮蔽放大）', () => {
  const r = ledgerOverview();
  let sum = 0;
  for (const c of r.characters) for (const x of c.riskByCode) sum += x.count;
  assert.equal(r.summary.totalIssues, sum, '总风险项与逐角色求和必须一致');
  assert.ok(Number.isFinite(r.summary.totalIssues), '不能是 NaN/Infinity');
  assert.ok(r.summary.totalIssues < 100000, `数值应在合理量级，实际 ${r.summary.totalIssues}`);
});

test('复读率与地点集中度必须落在 0~100', () => {
  const r = ledgerOverview();
  for (const c of r.characters) {
    assert.ok(c.cliche.repeat4gram >= 0 && c.cliche.repeat4gram <= 100, `${c.character.name} 复读率越界`);
    assert.ok(c.cliche.topPlaceShare >= 0 && c.cliche.topPlaceShare <= 100, `${c.character.name} 地点集中度越界`);
  }
});

test('完全一致的日程 = 100% 复读（口径不能失真为 0）', () => {
  const a = auditCharacter(90001);
  assert.ok(a, '角色 1 应有台账');
  // 两天日程地点与文案完全一致 → 4-gram 复读率应接近或等于 100
  assert.ok(a.cliche.repeat4gram >= 99, `相同日程应判高复读，实际 ${a.cliche.repeat4gram}%`);
});

test('★ 只有一份 daily 时复读率必须标为「不可测」而非 100%（假阳性）', () => {
  // 角色 90002 只有 template、没有 daily → 没有任何可比对象
  const b = auditCharacter(90002);
  assert.ok(b, '角色 2 应有台账');
  assert.equal(b.cliche.measurable, false, '无 daily 对时 measurable 必须为 false');
  assert.equal(b.cliche.repeat4gram, 0, '不可测时不应报 100% 这种误导值');

  // 角色 90001：2 份 daily → 可测
  const a = auditCharacter(90001);
  assert.equal(a.cliche.measurable, true, '有 ≥2 份 daily 时应可测');
  assert.ok(a.cliche.pairs >= 1, '应至少产生 1 个可比对');
});

test('★ daily 与同源 template 不得计入复读配对（否则单份日程会被判 100%）', () => {
  // 造一个只有 1 份 daily + 同内容 template 的角色（这正是「长夜月」的情形）
  addChar(90004, '丁');
  const same = JSON.stringify(dayActivities(['D地']));
  insDaily.run(90004, '2026-02-01', same, '2026-02-01 08:00:00');
  insTmpl.run(90004, same, '2026-02-01 07:00:00', 1);
  const d = auditCharacter(90004);
  assert.equal(d.cliche.measurable, false, 'daily 与其同源 template 之间无可比性');
  assert.equal(d.cliche.repeat4gram, 0, '同源副本不该被算成 100% 复读');
});

test('风险码集合是前后端契约（改名需同步前端 riskLabel）', () => {
  // 这里只钉住「出现即必须是我们已知的码」，防止新增未映射的码悄悄漏到前端
  const KNOWN = new Set([
    'unreachable-place', 'forbidden-place', 'no-location', 'thin-desc',
    'sleep-short', 'sleep-long', 'bad-time', 'gap', 'overlap', 'gap-start', 'teleport',
  ]);
  const r = ledgerOverview();
  for (const c of r.characters) for (const x of c.riskByCode) {
    assert.ok(KNOWN.has(x.code), `出现未知风险码「${x.code}」，前端无中文映射`);
  }
});

test.after(() => { try { db.close(); } catch {} try { fs.unlinkSync(TMP); } catch {} });