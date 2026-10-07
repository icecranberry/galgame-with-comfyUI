/**
 * 角色「移动方式」（超能力移动豁免）—— 回归测试。
 *
 * 用户诉求（2026-10-06）：「部分角色可能有超能力移动的机制，这个在 LLM 生成日程的时候是否能够实现？」
 * 用户裁定（三档中的**二档**）：
 *   ① 建角色级结构化字段，约束层与校验都按它改口径；
 *   ② **不建模代价**（不做次数上限、不做冷却）——有能力就不受限；
 *   ③ 台账**按能力分级**：有能力即不报 `teleport`。
 *
 * 改动前的事实：系统把「不许瞬移」写成**绝对规则**，三处口径相互矛盾 ——
 *   ① 约束层写「换场时间不得明显小于上表数值……不要出现瞬移」（对超能力角色是反的）；
 *   ② 通勤复算记成「换场时间不足」；
 *   ③ 台账报 `teleport`。
 * ★ 实测全库 68 个角色当时**无一声明移动类超能力**（唯一像的「银狼·空间」实为"空间站"），
 *   所以本功能是**为将来接角色预留能力**，不是修既有数据。
 *
 * 本测试守四件事（按风险排序）：
 *  ① ★★ **默认不改行为** —— `normal` / 未传 / 非法值时，约束层输出必须与改动前**逐字节一致**，
 *     复算与台账照旧。这是项目红线，一旦破了就是"全库 68 个普通角色行为被静默改变"。
 *  ② **判据单一真源** —— 三处调用点共用 `characterTransitMode`，禁止各自写一份。
 *  ③ **豁免真的生效** —— teleport 时约束层改写口径、复算跳过、台账不报 teleport。
 *  ④ **不引入代价机制** —— 按用户裁定，不应出现次数上限/冷却之类的东西。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`transitMode test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

const {
  TRANSIT_MODES, DEFAULT_TRANSIT_MODE,
  normalizeTransitMode, isTransitExempt, transitModeLabel,
} = await import('../src/services/characterTransitMode.js');
const { buildScheduleConstraintBlock, checkTransitFeasibility } = await import('../src/services/scheduleGenerator.js');
const { auditSchedule } = await import('../src/services/scheduleLedger.js');

const genSrc = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
const ledgerSrc = fs.readFileSync(path.join(SRC, 'services/scheduleLedger.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/characters.js'), 'utf8');
const schedRouteSrc = fs.readFileSync(path.join(SRC, 'routes/schedule.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(SRC, 'db/index.js'), 'utf8');

// 一份真实的通勤边（形状取自 world_map_transit 的注入格式）
const TRANSIT = [
  { line_id: 'A', line_name: 'A 城际线', from_stop: '珠星站', to_stop: '防御部站', minutes: 34, mode: 'rail' },
  { line_id: 'B', line_name: 'B 环线', from_stop: '鸽川站', to_stop: '绘世学院', minutes: 44, mode: 'rail' },
];
const BASE = { transitEdges: TRANSIT, areas: ['鸽川区'] };

// ─────────────────────────────────────────────────────────
// ① ★★ 默认不改行为（最高风险）
// ─────────────────────────────────────────────────────────

test('★★ 未传移动方式 → 约束层与「显式 normal」逐字节一致', () => {
  const omitted = buildScheduleConstraintBlock({ ...BASE });
  const normal = buildScheduleConstraintBlock({ ...BASE, transitMode: 'normal' });
  assert.equal(omitted, normal, '未传时应等价于 normal —— 否则存量角色行为被静默改变');
});

test('★★ 默认档保留旧口径原文（不得悄悄改写普通角色的约束）', () => {
  const s = buildScheduleConstraintBlock({ ...BASE, transitMode: 'normal' });
  assert.match(s, /不得明显小于上表数值/, 'normal 必须保留原有硬口径');
  assert.match(s, /这种瞬移/, 'normal 必须保留"不要瞬移"提示');
  assert.ok(!/具有超常移动能力/.test(s), 'normal 不得出现豁免话术');
});

test('★★ 非法/脏值一律回落 normal（绝不因脏值改变行为）', () => {
  for (const bad of ['', '  ', null, undefined, 'TELEPORT_X', 'teleportt', 0, {}, []]) {
    assert.equal(normalizeTransitMode(bad), DEFAULT_TRANSIT_MODE, `「${String(bad)}」应回落 normal`);
    assert.equal(isTransitExempt(bad), false, `「${String(bad)}」不应被当作豁免`);
  }
});

test('默认档定义必须是 normal 且唯一', () => {
  assert.equal(DEFAULT_TRANSIT_MODE, 'normal');
  const keys = TRANSIT_MODES.map(m => m.key);
  assert.equal(keys.filter(k => k === 'normal').length, 1, 'normal 必须恰好一个');
  assert.equal(keys[0], 'normal', 'normal 应排在首位（UI 默认项）');
  for (const m of TRANSIT_MODES) assert.ok(m.label && m.hint, `${m.key} 应有 label 与 hint`);
});

// ─────────────────────────────────────────────────────────
// ② 判据单一真源
// ─────────────────────────────────────────────────────────

test('★★ 三处调用点必须共用同一判据（禁止各写一份）', () => {
  assert.match(genSrc, /from '\.\/characterTransitMode\.js'/, 'scheduleGenerator 应从唯一真源导入');
  assert.match(ledgerSrc, /from '\.\/characterTransitMode\.js'/, 'scheduleLedger 应从唯一真源导入');
  assert.match(genSrc, /isTransitExempt\(/, '约束层/复算应调 isTransitExempt');
  assert.match(ledgerSrc, /isTransitExempt\(/, '台账应调 isTransitExempt');
  // 不得在别处重写一份"什么算豁免"的判断
  assert.ok(!/===\s*'teleport'/.test(genSrc), 'scheduleGenerator 不得硬编码 teleport 判断');
  assert.ok(!/===\s*'teleport'/.test(ledgerSrc), 'scheduleLedger 不得硬编码 teleport 判断');
});

test('★ 档位列表只在后端定义一份，经 regenerate-options 下发', () => {
  assert.match(schedRouteSrc, /transitModes:\s*TRANSIT_MODES/, 'regenerate-options 应下发 transitModes');
  assert.match(schedRouteSrc, /from '\.\.\/services\/characterTransitMode\.js'/, '路由应从唯一真源导入');
  // 前端不另抄一份：这里只校验后端有下发，前端渲染由真机验收覆盖
});

// ─────────────────────────────────────────────────────────
// ③ 豁免真的生效
// ─────────────────────────────────────────────────────────

test('★★ 豁免档位 → 约束层改写通勤口径（不再说"不得明显小于"）', () => {
  for (const mode of ['teleport', 'flight', 'unrestricted']) {
    const s = buildScheduleConstraintBlock({ ...BASE, transitMode: mode });
    assert.ok(!/不得明显小于上表数值/.test(s), `${mode} 不该再说"不得明显小于"`);
    assert.match(s, /具有超常移动能力/, `${mode} 应说明具备超常移动能力`);
    // ★ 用户裁定「不建模代价」：但要求**交代怎么到的**，避免写成凭空出现
    assert.match(s, /不要写成"凭空出现"|不要写成“凭空出现”/, `${mode} 应要求交代移动方式`);
  }
});

test('★ 豁免仍保留通勤基线表本身（世界还在，多数时候仍正常走动）', () => {
  const s = buildScheduleConstraintBlock({ ...BASE, transitMode: 'teleport' });
  assert.match(s, /【区域通勤基线/, '附表应保留');
  assert.match(s, /珠星站 → 防御部站 约 34 分/, '附表内容应保留');
});

test('★★ 豁免档位 → 通勤复算直接跳过（不产生假告警）', () => {
  // 构造一次明显的"跨区瞬移"：上一段在鸽川、下一段立刻在绘世学院。
  // ⚠ 必须用**表里有直连边**的站对（鸽川站→绘世学院 44 分）——复算只核直连边，
  //   用"需转乘"的站对（如珠星站→绘世学院）根本不会触发，会得到一个假绿的测试。
  const acts = [
    { startTime: '10:00', endTime: '11:00', activity: '逛夜街', location: '鸽川区·鸽川站', replyDelay: 0, description: 'x'.repeat(10) },
    { startTime: '11:00', endTime: '12:00', activity: '上课', location: '绘世学院·教室', replyDelay: 0, description: 'x'.repeat(10) },
  ];
  const normalIssues = checkTransitFeasibility(acts, TRANSIT, null, 'normal');
  const teleportIssues = checkTransitFeasibility(acts, TRANSIT, null, 'teleport');
  assert.ok(normalIssues.length > 0, 'normal 应照旧报出换场问题（证明测试样本确实违规）');
  assert.equal(teleportIssues.length, 0, 'teleport 应跳过复算');
  // 未传时与 normal 一致（默认不改行为）
  assert.deepEqual(checkTransitFeasibility(acts, TRANSIT, null, undefined), normalIssues);
});

test('★★ 豁免档位 → 台账不报 teleport，但其余审计项照常', () => {
  const acts = [
    { startTime: '08:00', endTime: '12:00', activity: '逛夜街', location: '鸽川区·鸽川站', replyDelay: 0, description: '很短的描述' },
    { startTime: '12:00', endTime: '16:00', activity: '上课', location: '绘世学院·教室', replyDelay: 0, description: 'x'.repeat(12) },
    { startTime: '16:00', endTime: '23:00', activity: '熬夜', location: '绘世学院·教室', replyDelay: 0, description: 'x'.repeat(12) },
  ];
  const transfer = new Map([['鸽川区→绘世学院', 44]]);
  const ctx = { transferMinutes: transfer };

  const normal = auditSchedule(acts, { ...ctx, transitMode: 'normal' });
  assert.ok(normal.issues.some(i => i.code === 'teleport'), 'normal 应报 teleport（证明样本确实违规）');

  const exempt = auditSchedule(acts, { ...ctx, transitMode: 'teleport' });
  assert.ok(!exempt.issues.some(i => i.code === 'teleport'), '豁免档位不该报 teleport');
  // ★ 其余审计项不受影响：睡眠不足照报（用户裁定是"按能力分级"，不是"整体放行"）
  assert.ok(exempt.issues.some(i => i.code === 'sleep-short'), '豁免不得连带屏蔽其他审计项');
  assert.ok(exempt.issues.some(i => i.code === 'thin-desc'), '豁免不得连带屏蔽其他审计项');
});

test('★ 未传 transitMode 时台账与 normal 完全一致（默认不改行为）', () => {
  const acts = [
    { startTime: '08:00', endTime: '12:00', activity: 'a', location: '鸽川区·鸽川站', replyDelay: 0, description: 'x'.repeat(12) },
    { startTime: '12:00', endTime: '16:00', activity: 'b', location: '绘世学院·教室', replyDelay: 0, description: 'x'.repeat(12) },
  ];
  const transfer = new Map([['鸽川区→绘世学院', 44]]);
  const a = auditSchedule(acts, { transferMinutes: transfer, transitMode: 'normal' });
  const b = auditSchedule(acts, { transferMinutes: transfer });
  assert.deepEqual(b.issues.map(i => i.code), a.issues.map(i => i.code), '未传应与 normal 同码');
});

// ─────────────────────────────────────────────────────────
// ④ 接线完整性
// ─────────────────────────────────────────────────────────

test('★★ 生成路径必须从角色行读移动方式（自动生成不带 options，只认 options 会静默丢豁免）', () => {
  assert.match(genSrc, /character\?\.transit_mode/, 'generateSchedule 应从角色行兜底读 transit_mode');
});

test('★★ 角色 API 接受 transit_mode 且经唯一真源规范化后落库', () => {
  assert.match(routeSrc, /transit_mode/, 'PUT /characters/:id 应接受 transit_mode');
  assert.match(routeSrc, /normalizeTransitMode\(transit_mode\)/, '落库前必须规范化（防脏值写入导致判据分叉）');
});

test('★ DB 迁移新增 transit_mode 列（不写 DEFAULT，存量保持 NULL）', () => {
  assert.match(dbSrc, /add\('transit_mode'/, '缺少 transit_mode 列迁移');
  const idx = dbSrc.indexOf("add('transit_mode'");
  const seg = dbSrc.slice(idx, idx + 200);
  assert.ok(!/DEFAULT/.test(seg), '不应写 DEFAULT —— 存量行需保持 NULL 以维持"未设置"语义');
});

// ─────────────────────────────────────────────────────────
// ⑤ 用户裁定：不建模代价
// ─────────────────────────────────────────────────────────

test('★ 不引入代价机制（用户裁定：有能力就不受限）', () => {
  const src = fs.readFileSync(path.join(SRC, 'services/characterTransitMode.js'), 'utf8');
  for (const bad of ['maxUses', 'cooldown', 'dailyLimit', 'cost', 'budget']) {
    assert.ok(!new RegExp(bad, 'i').test(src), `不该出现代价字段 ${bad}`);
  }
  // 档位表只有 key/label/hint 三个字段
  for (const m of TRANSIT_MODES) {
    assert.deepEqual(Object.keys(m).sort(), ['hint', 'key', 'label'], `${m.key} 字段应恰为 key/label/hint`);
  }
});

test('transitModeLabel 能给出可读标签，非法值回落默认标签', () => {
  assert.match(transitModeLabel('teleport'), /瞬移/);
  assert.match(transitModeLabel('flight'), /飞行/);
  assert.match(transitModeLabel('nonsense'), /普通/);
  assert.match(transitModeLabel(undefined), /普通/);
});
// ─────────────────────────────────────────────────────────
// ⑥ 载荷语义：只传豁免档位，normal/非法值一律"省略"
// ─────────────────────────────────────────────────────────

const { readScheduleOptions } = await import('../src/routes/schedule.js');

test('★★ 载荷解析：normal / 非法 / 未传 一律不写入 options（保持"未设置"语义）', () => {
  for (const body of [{ transitMode: 'normal' }, { transitMode: 'TYPO' }, { transitMode: '' }, { transitMode: null }, {}]) {
    const o = readScheduleOptions(body);
    assert.equal(o.transitMode, undefined, `${JSON.stringify(body)} 不应写入 transitMode`);
  }
});

test('★ 载荷解析：豁免档位写入 options', () => {
  for (const mode of ['teleport', 'flight', 'unrestricted']) {
    const o = readScheduleOptions({ transitMode: mode });
    assert.equal(o.transitMode, mode, `${mode} 应写入 options`);
  }
});

test('★ 前端只在豁免档位时传该字段（normal 不传，避免无谓差异）', () => {
  const view = fs.readFileSync(path.join(SRC, '../../web-ui/src/views/ScheduleView.vue'), 'utf8');
  assert.match(view, /regenTransitExempt\.value\s*\?\s*\{\s*transitMode/, '应仅在豁免档位时传 transitMode');
});

test('★ 前端档位列表来自后端下发，不硬编码', () => {
  const view = fs.readFileSync(path.join(SRC, '../../web-ui/src/views/ScheduleView.vue'), 'utf8');
  assert.match(view, /d\.transitModes/, '应从 regenerate-options 读取档位');
  assert.ok(!/key:\s*'teleport'/.test(view), '前端不应自己抄一份档位定义');
});
