/**
 * 日程活动名去「——」八股 —— 回归测试。
 *
 * 用户诉求（2026-10-06）：「LLM 的日程生成需要 去 AI 八股'——'」。
 *
 * 事实基线（改动前实测）：
 *   · `daily_schedules` 全库 **582 条活动里 542 条带 `——`，占 93.1%**；
 *   · 用法高度统一：`活动名——补充说明`，且补充说明与 `description` 高度重复；
 *   · `description` 字段 0/582 含破折号 —— 八股**只**出现在活动名上；
 *   · 不存在单破折号 / ascii `--` 变体（均为 0）—— 即这完全是自家提示词示范句教出来的。
 *
 * 因此本测试守四件事：
 *  ① **运行时归一化**：LLM 若仍输出破折号，落库前必须被收敛成纯标题。
 *  ② **主干不被误伤**：破折号出现在正文而非标题分界时，只能抹符号、不能截断。
 *  ③ **边界安全**：空值 / 非字符串 / 无破折号输入一律原样返回，不抛错。
 *  ④ **提示词不再教坏**：scheduleInst 的示范句与自检项里不得再有「活动——说明」范式。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`activityTitle test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

const { normalizeActivityTitle } = await import('../src/utils/activityTitle.js');
const genSrc = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
const apptSrc = fs.readFileSync(path.join(SRC, 'services/appointmentDetector.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(SRC, 'db/index.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 运行时归一化：存量里的真实样本必须被收敛
// ─────────────────────────────────────────────────────────

test('★ 全库真实样本：取破折号前主干，去掉解说尾巴', () => {
  const cases = [
    ['深夜直播——假面剧场的即兴演出', '深夜直播'],
    ['打烊后清点愿宝——顺带破解计分板', '打烊后清点愿宝'],
    ['补觉——通宵后的长睡', '补觉'],
    ['赌场夜班——逆兔女郎端酒', '赌场夜班'],
    ['后段卡座——被熟客叫去坐一会儿', '后段卡座'],
    ['深夜直播——鸽川区顶楼露台的红灯机位', '深夜直播'],
    ['世界尽头酒馆——常去的卡座吃晚饭', '世界尽头酒馆'],
    ['起床梳洗——换回出门装', '起床梳洗'],
    ['异常防御部执勤——旧案卷宗复核', '异常防御部执勤'],
    ['回家洗澡——顺手解决一下', '回家洗澡'],
    ['与用户的约会——火锅', '与用户的约会'],
  ];
  for (const [input, want] of cases) {
    assert.equal(normalizeActivityTitle(input), want, `「${input}」应归一化为「${want}」`);
  }
});

test('★ 归一化后不含任何破折号变体', () => {
  const inputs = [
    '深夜直播——假面剧场的即兴演出',
    '补觉—通宵后的长睡',
    '赌场夜班 – 端酒陪桌',
    '收工 -- 结算',
  ];
  for (const s of inputs) {
    const out = normalizeActivityTitle(s);
    assert.ok(!/——|—|–|--/.test(out), `「${s}」归一化后仍含破折号：「${out}」`);
  }
});

test('无破折号的活动名原样保留（不误伤正常标题）', () => {
  for (const s of ['群交派对', '补觉安眠', '深夜直播', '滨河道散步', '泡面加蛋的午饭']) {
    assert.equal(normalizeActivityTitle(s), s);
  }
});

// ─────────────────────────────────────────────────────────
// ② 主干不被误伤
// ─────────────────────────────────────────────────────────

test('★ 主干过短时只抹符号、不截断（「补——睡」不该变成「补」）', () => {
  assert.equal(normalizeActivityTitle('补——睡'), '补睡');
});

test('以破折号开头的活动名：去掉前导符号而非清空', () => {
  assert.equal(normalizeActivityTitle('—— 午睡'), '午睡');
  assert.ok(normalizeActivityTitle('—— 午睡').length > 0);
});

test('主干仍过长时才做保守截断（上限 16 字）', () => {
  const out = normalizeActivityTitle('标题很长的活动——这一整段说明其实很长已经超过十四字的限制');
  assert.equal(out, '标题很长的活动');
  assert.ok(out.length <= 16);
  // 长度适中且无分隔符的长名字不该被硬砍
  assert.equal(normalizeActivityTitle('异常防御部执勤记录整理'), '异常防御部执勤记录整理');
});

test('拖尾标点被清掉', () => {
  assert.equal(normalizeActivityTitle('深夜直播——'), '深夜直播');
  assert.equal(normalizeActivityTitle('深夜直播，'), '深夜直播');
});

// ─────────────────────────────────────────────────────────
// ③ 边界安全
// ─────────────────────────────────────────────────────────

test('空值 / 非字符串输入不抛错', () => {
  for (const v of [null, undefined, '', '   ', 0, NaN, {}]) {
    assert.doesNotThrow(() => normalizeActivityTitle(v));
    assert.equal(typeof normalizeActivityTitle(v), 'string');
  }
  assert.equal(normalizeActivityTitle(null), '');
  assert.equal(normalizeActivityTitle('   '), '');
});

test('run 结果绝不为空 —— 归一化不会把一条活动名清成空串', () => {
  const samples = [
    '深夜直播——假面剧场的即兴演出', '补觉——通宵后的长睡', '—— 午睡',
    '群交派对', '睡眠——不省人事', 'A——B',
  ];
  for (const s of samples) {
    assert.ok(normalizeActivityTitle(s).length > 0, `「${s}」被清空了`);
  }
});

// ─────────────────────────────────────────────────────────
// ④ 提示词不再教坏
// ─────────────────────────────────────────────────────────

test('★★ scheduleInst 的 activity 字段说明不再示范破折号', () => {
  // 抓「"activity": "…"」这一行的示范句
  const line = genSrc.split('\n').find(l => /"activity":\s*"简短活动名/.test(l));
  assert.ok(line, '未找到 activity 字段说明行');
  assert.ok(!line.includes('——'), `activity 字段示范句仍带破折号：${line}`);
  assert.ok(line.includes('4~10'), 'activity 字段应声明长度约束');
});

test('★★ few-shot JSON 示例里的 activity 全部不含破折号', () => {
  // 完整 JSON 示例那一行
  const line = genSrc.split('\n').find(l => l.trim().startsWith('{"activities":[') && l.includes('startTime'));
  assert.ok(line, '未找到 few-shot JSON 示例行');
  const acts = [...line.matchAll(/"activity":"([^"]*)"/g)].map(m => m[1]);
  assert.ok(acts.length >= 3, `示例活动数异常：${acts.length}`);
  for (const a of acts) {
    assert.ok(!a.includes('——'), `示例里的活动名仍带破折号：「${a}」`);
    assert.ok(a.length <= 14, `示例活动名过长：「${a}」(${a.length} 字)`);
  }
});

test('★★ 自检清单新增「activity 无破折号」一项', () => {
  assert.ok(/逐条检查 activity/.test(genSrc), '自检清单缺少 activity 检查项');
  assert.ok(/没有一条包含「——」/.test(genSrc), '自检项未明确禁止「——」');
});

test('★ 明确写出「禁止用破折号」的规则段', () => {
  assert.ok(/禁止用破折号/.test(genSrc), '缺少禁止破折号的显式规则');
  // 规则段应给出正/反例（❌ 反例 / ✅ 正例）
  assert.ok(/❌/.test(genSrc) && /✅/.test(genSrc), '规则段缺少正反例');
});

test('★ 约会检测提示词同样不再示范破折号', () => {
  const line = apptSrc.split('\n').find(l => /"activity"：/.test(l));
  assert.ok(line, '未找到约会 activity 字段说明');
  assert.ok(!line.includes('——'), `约会 activity 示范句仍带破折号：${line}`);
});

test('提示词模板里没有因新增反引号而破坏模板字符串', () => {
  // 反引号会截断 JS 模板字符串；这里做静态计数（成对性）
  const backticks = (genSrc.match(/`/g) || []).length;
  assert.equal(backticks % 2, 0, 'scheduleGenerator.js 的反引号不成对，模板字符串可能被截断');
});

// ─────────────────────────────────────────────────────────
// ⑤ 存量清理迁移
// ─────────────────────────────────────────────────────────

test('★★ 存量清理迁移存在、带一次性标记、且跳过用户手改条目', () => {
  assert.ok(
    /function migrateScheduleActivityTitleDedash/.test(dbSrc),
    '缺少存量清理迁移函数'
  );
  assert.ok(
    /schedule_activity_dedash_v1/.test(dbSrc),
    '缺少一次性标记，会导致每次启动都扫全表'
  );
  assert.ok(
    /migrateScheduleActivityTitleDedash\(db\)/.test(dbSrc),
    '迁移函数未被调用'
  );
  // 用户手改过的条目必须尊重
  assert.ok(
    /if \(a\.edited\) continue;/.test(dbSrc),
    '清理迁移未跳过 edited 条目 —— 会覆盖用户手改的活动名'
  );
  // 清理范围必须覆盖两个表
  assert.ok(/daily_schedules/.test(dbSrc) && /schedule_templates/.test(dbSrc));
});

test('★ 清理迁移复用同一份归一化实现（单一真源，禁止另写一套）', () => {
  assert.ok(
    /import \{ normalizeActivityTitle \} from '\.\.\/utils\/activityTitle\.js'/.test(dbSrc),
    'db/index.js 未复用 normalizeActivityTitle'
  );
  assert.ok(
    /import \{ normalizeActivityTitle \} from '\.\.\/utils\/activityTitle\.js'/.test(genSrc),
    'scheduleGenerator.js 未复用 normalizeActivityTitle'
  );
});

test('★★ 生成路径接入归一化（校验后落库前）', () => {
  assert.ok(
    /act\.activity = after;/.test(genSrc),
    'parseAndValidateSchedule 未把归一化结果写回活动名'
  );
});