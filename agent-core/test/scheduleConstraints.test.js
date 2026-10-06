import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`scheduleConstraints test forbids network: ${url}`); };

const {
  NSFW_BANDS,
  SLEEP_TYPES,
  nsfwBandOf,
  explicitTextOf,
  buildScheduleConstraintBlock,
} = await import('../src/services/scheduleGenerator.js');

// 覆盖范围：
// 1) 默认（不传任何选项）必须返回 null —— 这是「默认不改行为」的硬保证
// 2) NSFW 五档：50 档必须与 scheduleInst 写死的「3~5 / ≥2」一致
// 3) 关闭档必须显式覆盖上文的「必须有 3~6 个性时段」下限
// 4) 区域块：带真实地名、硬/软约束措辞、以及「以本次指定为准」的冲突声明
// 5) 睡眠类型：非法键被忽略

test('不传任何选项 → null（不加约束层，行为与上线前一致）', () => {
  assert.equal(buildScheduleConstraintBlock(), null);
  assert.equal(buildScheduleConstraintBlock({}), null);
  // 空数组 / 非法值同样不加
  assert.equal(buildScheduleConstraintBlock({ areas: [] }), null);
  assert.equal(buildScheduleConstraintBlock({ areas: ['  ', ''] }), null);
  assert.equal(buildScheduleConstraintBlock({ nsfwRatio: 'abc' }), null);
  assert.equal(buildScheduleConstraintBlock({ sleepType: 'auto' }), null);
  assert.equal(buildScheduleConstraintBlock({ sleepType: 'not_a_type' }), null);
  assert.equal(buildScheduleConstraintBlock({ nsfwRatio: null }), null);
});

test('nsfwBandOf：靠档就近，越界钳到两端', () => {
  assert.equal(nsfwBandOf(0).label, '关闭');
  assert.equal(nsfwBandOf(10).label, '关闭', '0~12 靠 0 档更近');
  assert.equal(nsfwBandOf(25).label, '少量');
  assert.equal(nsfwBandOf(50).label, '标准');
  assert.equal(nsfwBandOf(75).label, '密集');
  assert.equal(nsfwBandOf(100).label, '极高');
  assert.equal(nsfwBandOf(-30).label, '关闭');
  assert.equal(nsfwBandOf(300).label, '极高');
  assert.equal(nsfwBandOf('x'), null);
  assert.equal(nsfwBandOf(undefined), null);
});

test('NSFW 标准档(50) 必须与 scheduleInst 写死的数量一致', () => {
  const std = NSFW_BANDS.find(b => b.at === 50);
  assert.equal(std.sexCount, '3~5', '改这里必须同步改 scheduleInst，否则「不动滑块」会改变既有行为');
  // ★ 50 档的 explicit 已改为区间 0~2（用户口径：括号内指实质行为数量）。
  assert.equal(std.explicitMin, 0);
  assert.equal(std.explicitMax, 2);
  // ★★ 但**文案下限必须是 2** —— scheduleInst 原文是「≥2 个是实质行为」。
  //    若按区间拼成「0~2 个」，模型会以为下限是 0 而降低密度 →「不动滑块」也改变了行为。
  //    这个 explicitFloor 是「区间」之外的**第二重语义**，删它等于回退。
  assert.equal(std.explicitFloor, 2, 'explicitFloor 是兼容 scheduleInst 原文的文案下限，删它＝「不动滑块」也变行为');
});

test('NSFW 五档的实质行为区间应为用户给定口径（0~1/0~2/1~3/2~5）', () => {
  const band = (at) => NSFW_BANDS.find(b => b.at === at);
  assert.deepEqual([band(25).explicitMin, band(25).explicitMax], [0, 1]);
  assert.deepEqual([band(50).explicitMin, band(50).explicitMax], [0, 2]);
  assert.deepEqual([band(75).explicitMin, band(75).explicitMax], [1, 3]);
  assert.deepEqual([band(100).explicitMin, band(100).explicitMax], [2, 5]);
  // 关闭档仍是单点 0
  assert.deepEqual([band(0).explicitMin, band(0).explicitMax], [0, 0]);
  // 只有 50 档带 explicitFloor（它是唯一与 scheduleInst 原文有冲突的口径）
  assert.equal(NSFW_BANDS.filter(b => Number.isFinite(b.explicitFloor)).length, 1);
});

test('explicitTextOf：50 档拼「≥ 2」（兼容原文），其余拼区间', () => {
  const band = (at) => NSFW_BANDS.find(b => b.at === at);
  assert.equal(explicitTextOf(band(50)), '≥ 2', '50 档必须拼下限，与 scheduleInst 的「≥2」逐字兼容');
  assert.equal(explicitTextOf(band(25)), '0~1');
  assert.equal(explicitTextOf(band(75)), '1~3');
  assert.equal(explicitTextOf(band(100)), '2~5');
  assert.equal(explicitTextOf(null), '');
  // 生成出来的约束块必须真的用上这个文案（防止函数写了没人调）
  const s = buildScheduleConstraintBlock({ nsfwRatio: 50 });
  assert.match(s, /≥ 2 个/);
  assert.doesNotMatch(s, /0~2 个/, '50 档不能出现 0~2 的文案 —— 那会教模型把下限当 0');
});

test('NSFW 关闭档：必须显式声明覆盖上文的「≥3 个」下限与自检第 1 条', () => {
  const s = buildScheduleConstraintBlock({ nsfwRatio: 0 });
  assert.ok(s);
  assert.match(s, /不安排任何性时段/);
  assert.match(s, /自检第 1 条/);
  assert.match(s, /性时段 = 0/);
  assert.match(s, /人类日常骨架/);
});

test('NSFW 非零档：给出数量并声明「除数量外全部照常适用」', () => {
  const s = buildScheduleConstraintBlock({ nsfwRatio: 75 });
  assert.match(s, /6~8 个/);
  assert.match(s, /≥ 3 个/);
  assert.match(s, /除数量之外的一切要求/);
  // 不能把「性活动必须有来由」等要求一并解除
  assert.match(s, /严禁照抄/);
});

test('区域块：带真实地名清单 + 硬约束措辞 + 冲突以本次为准', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市', '鸽川区'],
    areaStrict: true,
    scenesByArea: { 二维市: ['泊地站', '嬉步街'], 鸽川区: ['鸽川埠'] },
  });
  assert.match(s, /二维市、鸽川区/);
  assert.match(s, /泊地站、嬉步街/);
  assert.match(s, /鸽川埠/);
  assert.match(s, /硬约束/);
  assert.match(s, /以本条的本次指定为准/);
  assert.doesNotMatch(s, /软约束/);
});

test('区域块：软约束措辞；区域无场景时不出现空的地点行', () => {
  const s = buildScheduleConstraintBlock({ areas: ['幻月秘庭'], scenesByArea: { 幻月秘庭: [] } });
  assert.match(s, /软约束/);
  assert.doesNotMatch(s, /真实存在\*\*的地点/);
});

test('睡眠类型：固定后声明「睡眠时间个性化」不适用，但 replyDelay 仍为 -1', () => {
  const s = buildScheduleConstraintBlock({ sleepType: 'stay_up' });
  assert.match(s, /熬夜型/);
  assert.match(s, /凌晨 1-4 点睡/);
  assert.match(s, /replyDelay 仍必须是 -1/);
  assert.match(s, /睡眠时间个性化/);
  assert.ok(SLEEP_TYPES.stay_up.text.length > 0);
});

test('多选项同时生效：外层包裹 schedule_constraints 且声明冲突以本块为准', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市'],
    nsfwRatio: 25,
    sleepType: 'early',
  });
  assert.match(s, /^<schedule_constraints priority="high">/);
  assert.match(s, /<\/schedule_constraints>$/);
  assert.match(s, /本块没提到的部分，上文要求全部照常执行/);
  assert.match(s, /1~2 个/);
  assert.match(s, /早睡早起型/);
});
