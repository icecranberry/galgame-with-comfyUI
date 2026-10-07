/**
 * 固定居家/睡眠地点（人类侧指定）—— 回归测试。
 *
 * 用户诉求（2026-10-06）：日程弹窗里应能"选定 1 个地点作为角色的固定居家/睡眠地点"，
 * 否则模型自由发挥会跑偏（同一角色今天住宿舍、明天住酒店、甚至睡街头）。
 *
 * 本测试守三类风险：
 *  ① **默认不改行为** —— 不指定任何地点时，约束块必须与上线前**逐字节一致**（返回 null）。
 *  ② **两个"住处"不许混** —— 角色自己的家（homePlace）与玩家（人类侧）的家（userHome）
 *     是两回事，注入文案里必须并列且互相声明"别混"。
 *  ③ **睡眠可分离** —— sleepPlace 与 homePlace 相同/不同时的措辞必须正确，
 *     否则"住校但睡别处"会被写成自相矛盾的话。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`cadence test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

const { buildScheduleConstraintBlock } = await import('../src/services/scheduleGenerator.js');

// ─────────────────────────────────────────────────────────
// ① 默认不改行为
// ─────────────────────────────────────────────────────────

test('★ 不指定 homePlace → 不出现固定住处段（默认不改行为）', () => {
  assert.equal(buildScheduleConstraintBlock({}), null);
  assert.equal(buildScheduleConstraintBlock(), null);
  // 空串 / 纯空格 = 未指定
  assert.equal(buildScheduleConstraintBlock({ homePlace: '' }), null);
  assert.equal(buildScheduleConstraintBlock({ homePlace: '   ' }), null);
  const s = buildScheduleConstraintBlock({ homePlace: '' });
  assert.ok(s === null, '空串不应产生任何约束段');
});

test('指定 homePlace → 只在有值时才出现这一节', () => {
  const s = buildScheduleConstraintBlock({ homePlace: '宿舍生活区', characterName: '银狼' });
  assert.ok(s, '指定后应生成约束块');
  assert.match(s, /固定住处/);
  assert.match(s, /宿舍生活区/);
  assert.match(s, /银狼/);
});

// ─────────────────────────────────────────────────────────
// ② 两个"住处"不许混
// ─────────────────────────────────────────────────────────

test('★★ 角色住处与玩家住处必须并列且互相声明「别混」', () => {
  const s = buildScheduleConstraintBlock({
    homePlace: '宿舍生活区',
    homeArea: '绘世学院',
    userName: '三月七',
    userHome: '二维市公寓',
    characterName: '银狼',
  });
  // 角色自己的家
  assert.match(s, /银狼 的固定住处/, '应注入"角色自己的住处"这一节');
  // 玩家（人类侧）的家
  assert.match(s, /三月七 的住处/, '应注入"玩家住处"这一节（同名函数已有能力）');
  // 两条必须都声明"别混"，否则模型会把角色写成住玩家家
  assert.match(s, /不是.{0,6}的家|不是用户的家|不是三月七的家/, '角色住处节必须声明它≠玩家住处');
  assert.match(s, /不是角色自己的家/, '玩家住处节必须声明它≠角色住处');
});

test('角色住处节：锚点时段要固定落点，且要求"不要每次换地方"', () => {
  const s = buildScheduleConstraintBlock({ homePlace: '宿舍生活区', characterName: '银狼' });
  // 必须点名这些锚点，否则模型不会去用
  for (const kw of ['起床', '回家', '就寝']) {
    assert.ok(s.includes(kw), `应点名锚点时段「${kw}」`);
  }
  assert.match(s, /不要每次换地方/, '应明确要求落点稳定（治"今天宿舍明天酒店"）');
  // 着装联动：住处的时段按住所内处理
  assert.match(s, /住所内/, '应声明住处内时段按住所内着装');
});

// ─────────────────────────────────────────────────────────
// ③ 睡眠地点可分离
// ─────────────────────────────────────────────────────────

test('★ 只给 homePlace：睡觉默认就在这个落点', () => {
  const s = buildScheduleConstraintBlock({ homePlace: '宿舍生活区', characterName: '银狼' });
  assert.match(s, /睡觉就在这个落点/, '未分设时应声明睡在居家地点');
  assert.doesNotMatch(s, /睡觉固定在「[^」]+」/, '未分设时不应出现"固定在别处"的措辞');
});

test('★ sleepPlace 与 homePlace 不同：必须按 sleepPlace 为准（住校睡别处）', () => {
  const s = buildScheduleConstraintBlock({
    homePlace: '宿舍生活区',
    sleepPlace: '教工宿舍',
    characterName: '银狼',
  });
  assert.match(s, /睡觉固定在「教工宿舍」/, '分设时应点名睡眠落点');
  assert.match(s, /若与居家地点不同，按此为准/, '必须声明冲突时以睡眠地点为准');
});

test('★ sleepPlace 与 homePlace 相同：等价于未分设（措辞一致）', () => {
  const a = buildScheduleConstraintBlock({ homePlace: '宿舍生活区', characterName: '银狼' });
  const b = buildScheduleConstraintBlock({ homePlace: '宿舍生活区', sleepPlace: '宿舍生活区', characterName: '银狼' });
  assert.equal(a, b, '睡眠地点与居家相同时，措辞应与未分设逐字一致（不产生多余歧义）');
});

// ─────────────────────────────────────────────────────────
// ④ 接线：落库字段 + 前端 UI + 选项下发
// ─────────────────────────────────────────────────────────

test('★ DB 迁移：characters 表新增 home_place / sleep_place / home_area 三列', () => {
  const dbSrc = fs.readFileSync(path.join(SRC, 'db/index.js'), 'utf8');
  assert.match(dbSrc, /function migrateCharacterCadenceSchema/, '必须有 migrateCharacterCadenceSchema');
  const block = dbSrc.match(/function migrateCharacterCadenceSchema[\s\S]*?\n}/)?.[0] || '';
  for (const col of ['home_place', 'sleep_place', 'home_area']) {
    assert.ok(block.includes(col), `迁移应加列 ${col}`);
  }
  assert.match(dbSrc, /migrateCharacterCadenceSchema\(db\)/, '迁移必须接入启动调度');
});

test('★ 角色 API：PUT /characters/:id 接受三个新字段', () => {
  const s = fs.readFileSync(path.join(SRC, 'routes/characters.js'), 'utf8');
  assert.match(s, /home_place !== undefined/, 'PUT 应处理 home_place');
  assert.match(s, /sleep_place !== undefined/, 'PUT 应处理 sleep_place');
  assert.match(s, /home_area !== undefined/, 'PUT 应处理 home_area');
});

test('★ 日程选项接口下发 cadenceOptions（否则前端无可选项）', () => {
  const s = fs.readFileSync(path.join(SRC, 'routes/schedule.js'), 'utf8');
  assert.match(s, /cadenceOptions/, 'regenerate-options 应下发 cadenceOptions');
  // 居住性质的地点应带上 zone，供前端排序（把"居住"排前）
  assert.match(s, /zone: p\.zone \|\| ''/, '候选项应带 zone');
});

test('★ 自动生成路径也吃到持久值（不能只在弹窗里生效）', () => {
  const s = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  // generateSchedule 应能从 characters 读 home_place 兜底
  assert.match(s, /SELECT home_place, sleep_place, home_area FROM characters/, 'generateSchedule 应读库兜底');
});

test('前端：日程弹窗有固定住处选择区，且提交时落库 + 随请求发送', () => {
  const v = fs.readFileSync(path.join(WEB_SRC, 'views/ScheduleView.vue'), 'utf8');
  assert.match(v, /固定住处/, '弹窗应有「固定住处」区');
  assert.match(v, /regenHomePlace/, '应有居家地点状态');
  assert.match(v, /regenSleepPlace/, '应有睡眠地点状态');
  // 提交时落库（持久设定）
  assert.match(v, /persistCadenceIfChanged/, '应把选择落库到角色（持久设定）');
  assert.match(v, /home_place: nextHome/, '落库应带 home_place');
  // 生成时随请求发送
  assert.match(v, /homePlace: regenHomePlace\.value/, '生成请求应带 homePlace');
});