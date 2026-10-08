/**
 * 日程地点属性（准入 / 分区 / 场景提示词）—— 回归测试
 *
 * 覆盖 03-日程改进方案 里问题 1/2/3/5 的落点。这些都是**容易回退**的语义：
 *   · 未标注 access 必须按「可去」处理（否则一次迁移把全图地点关光）
 *   · restricted/private 默认不进候选池（这就是"谢不谢绝外人"的开关）
 *   · 用户显式放行的受限地点必须能进池、且带原因标注
 *   · 用户取消勾选的地点**必须真的不进池**（排除优先于一切）
 *   · zone 必须逐点映射，不能整区一刀切
 *
 * 用内存库跑：不碰真库、不调 LLM。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `linshe-placeattrs-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`placeAttrs test forbids network: ${url}`); };

const {
  normalizeAccess, normalizeZone, isAccessibleByDefault, accessReason,
  pickSchedulePlaces, resolveEffectiveAccess, ACCESS_LEVELS, ZONE_LEVELS, ZONE_OUTFIT_HINT,
} = await import('../src/services/worldMapService.js');
const { buildScheduleConstraintBlock } = await import('../src/services/scheduleGenerator.js');

test('normalizeAccess：非法值落空串（不做猜测性兜底）', () => {
  assert.equal(normalizeAccess('public'), 'public');
  assert.equal(normalizeAccess('restricted'), 'restricted');
  assert.equal(normalizeAccess('PUBLIC'), '', '大小写敏感：不认识的写法落空串，不猜');
  assert.equal(normalizeAccess('weird'), '');
  assert.equal(normalizeAccess(null), '');
  assert.equal(normalizeAccess(undefined), '');
  assert.equal(normalizeAccess(123), '');
});

test('normalizeZone：非法值落空串', () => {
  assert.equal(normalizeZone('residence'), 'residence');
  assert.equal(normalizeZone('activity'), 'activity');
  assert.equal(normalizeZone('private_transit'), 'private_transit');
  assert.equal(normalizeZone('home'), '', '「home」是服装 key 不是 zone，不该被接受');
  assert.equal(normalizeZone(''), '');
});

test('★ 未标注（空串）按「可去」处理 —— 否则一次迁移会把全图地点关光', () => {
  assert.equal(isAccessibleByDefault(''), true);
  assert.equal(isAccessibleByDefault(null), true, 'null 也应按未标注处理');
  assert.equal(isAccessibleByDefault('public'), true);
  assert.equal(isAccessibleByDefault('restricted'), false);
  assert.equal(isAccessibleByDefault('private'), false);
  assert.equal(isAccessibleByDefault('time_window'), false, 'time_window 另有通道，不算"默认可去"');
});

test('accessReason：给出可直接给模型看的原因文案', () => {
  assert.equal(accessReason({ access: 'restricted' }), '谢绝外人／需身份');
  assert.equal(accessReason({ access: 'private' }), '某角色的私人空间');
  assert.match(accessReason({ access: 'time_window', open_at: '18:00', close_at: '02:00' }), /18:00–02:00/);
  assert.equal(accessReason({ access: 'time_window' }), '仅特定时段开放');
  assert.equal(accessReason({ access: 'public' }), '');
});

test('★ pickSchedulePlaces：restricted/private 默认不进候选池', () => {
  const places = [
    { name: '嬉步街', access: 'public' },
    { name: '无名桥', access: '' },              // 未标注 → 可去
    { name: '珠星总部', access: 'restricted' },
    { name: '某人的公寓', access: 'private' },
    { name: '夜市档', access: 'time_window', open_at: '18:00', close_at: '02:00' },
  ];
  const r = pickSchedulePlaces(places, new Set());
  const names = r.included.map(p => p.name);
  assert.deepEqual(names, ['嬉步街', '无名桥', '夜市档'], '受限的不能进池；未标注的必须能进');
  assert.deepEqual(r.excluded.map(x => x.name).sort(), ['某人的公寓', '珠星总部']);
  // time_window 进池但必须带标注（否则模型不知道它有时段）
  const tw = r.included.find(p => p.name === '夜市档');
  assert.match(tw.note, /18:00–02:00/);
});

test('★ pickSchedulePlaces：用户排除优先于一切（连 public 都被划掉）', () => {
  const places = [
    { name: '嬉步街', access: 'public' },
    { name: '无名桥', access: 'public' },
  ];
  const r = pickSchedulePlaces(places, new Set(['嬉步街']));
  assert.deepEqual(r.included.map(p => p.name), ['无名桥'], '被排除的地点绝不能进池');
  assert.ok(r.excluded.some(x => x.name === '嬉步街' && x.why === 'user-excluded'));
});

test('★ pickSchedulePlaces：全部被排除时返回空池（调用方必须能区分，别静默当"没约束"）', () => {
  const r = pickSchedulePlaces([{ name: 'A', access: 'public' }], new Set(['A']));
  assert.equal(r.included.length, 0);
  assert.equal(r.excluded.length, 1, '空池必须能从 excluded 里看出原因');
});

test('★★ 子区受限时其下场景继承受限（`幻月秘庭` 是 lv2 且整区谢绝外人）', () => {
  const places = [{ name: '秘庭前廊·仪式经路', access: '' }];
  const r = pickSchedulePlaces(places, new Set(), 'restricted');
  assert.equal(r.included.length, 0, '父级受限、子项未标注 → 必须继承受限');
  assert.equal(r.excluded[0].reason, '谢绝外人／需身份');
});

test('★★ 子项显式 public 可以解锁父级的受限 —— 否则「车站谢绝外人」这种错会静默发生', () => {
  // 实测踩过：曾把「珠星集团CBD区」整区标受限，结果里面的「珠星站」也被关掉。
  // 「珠星站」显式 public 后必须能进池。
  const places = [{ name: '珠星站', access: 'public' }, { name: '机铠设计室', access: '' }];
  const r = pickSchedulePlaces(places, new Set(), 'restricted');
  assert.deepEqual(r.included.map(p => p.name), ['珠星站'], '显式 public 必须解锁');
  assert.deepEqual(r.excluded.map(p => p.name), ['机铠设计室']);
});

test('★ 父级未标注时不影响子项（不能因为父级空就把子项当受限）', () => {
  const r = pickSchedulePlaces([{ name: '泊地站', access: '' }], new Set(), '');
  assert.equal(r.included.length, 1);
  assert.equal(r.excluded.length, 0);
});

// ─────────────────────────────────────────────────────────
// ★★ 2026-10-07 用户实报：「玩家自己新建的地点，区域勾了私人空间后仍然受限，
//    而 AGENT 创建的正常」——这条揭出两个真缺陷，下面把两者都钉住。
// ─────────────────────────────────────────────────────────

test('★★★ private **不得**从父区继承（它是归属属性，不是准入属性）', () => {
  // 实测数据：「翡翠的私人生态舰」区域级 access=private，其下 7 个舱室自己都没标注。
  // 旧代码把 private 一路继承 → 7 个舱室全被判成「某角色的私人空间」不可去。
  // 语义上「典当品陈列长廊」是营业场所、「异星生态庭院」是景观舱，
  // 不该因为是"翡翠的船"就整个进不去 —— private 的语义是**单点归属**（某个角色的房间）。
  const places = [{ name: '典当品陈列长廊', access: '' }, { name: '异星生态庭院', access: '' }];
  const r = pickSchedulePlaces(places, new Set(), 'private');
  assert.equal(r.included.length, 2, '区域标 private 时，未标注的子地点应当**可去**');
  assert.equal(r.excluded.length, 0);
});

test('★★★ restricted 仍然继承（与 private 区分开，别一起改掉）', () => {
  // 「幻月秘庭」整区谢绝外人 —— 这种必须继续继承，否则整区会被放行。
  const places = [{ name: '秘庭前廊·仪式经路', access: '' }];
  const r = pickSchedulePlaces(places, new Set(), 'restricted');
  assert.equal(r.included.length, 0, 'restricted 必须继承 —— 这是它与 private 的关键差别');
  // 且**显式标注 private 的单点**依然要挡（只有"继承来的 private"才不挡）
  const r2 = pickSchedulePlaces([{ name: '某人的卧室', access: 'private' }], new Set(), '');
  assert.equal(r2.included.length, 0, '显式标了 private 的单点仍应被挡');
});

test('★★★ 用户显式勾选的受限地点必须**真的进候选集**（不是只加一句注释）', () => {
  // 旧实现：勾选只生成 forcedPlaces（给模型看的注释行），地点名**不进 scenesByArea**；
  // 而渲染层遇到"本区无可用地点"会整区跳过 → 用户看到的是"勾了完全没用"。
  const places = [{ name: '重力安保核心', access: 'private' }];
  const r = pickSchedulePlaces(places, new Set(), '', new Set(['重力安保核心']));
  assert.deepEqual(r.included.map(p => p.name), ['重力安保核心'], '勾选后必须进池');
  assert.equal(r.annotated.length, 1, '应记为"需标注"');
  assert.match(r.included[0].note, /本次用户已显式指定/, '标注必须写明是用户显式指定，否则模型见"私人"仍会自己排除');
});

test('★ 排除优先于显式放行（勾选与划掉同时存在时，划掉赢）', () => {
  const places = [{ name: '重力安保核心', access: 'private' }];
  const r = pickSchedulePlaces(places, new Set(['重力安保核心']), '', new Set(['重力安保核心']));
  assert.equal(r.included.length, 0, '用户划掉必须优先于勾选');
  assert.equal(r.excluded[0].why, 'user-excluded');
});

test('★★★ 准入继承只能有**一份实现**（唯一真源 `resolveEffectiveAccess`）', () => {
  // 上面那个 bug 有**两个**独立成因，其中一个是"同一口径写了两遍"（项目红线 8）：
  //   · `pickSchedulePlaces`（决定生成时能不能去）
  //   · `routes/schedule.js` 的 `decorated`（决定前端界面显示能不能去）
  // 两份逻辑各自演化 → 界面与生成结果不一致，用户看到"界面说不能去"的错觉。
  // 本测试用源码扫描钉住：路由里不得再出现自己的继承判断。
  const src = fs.readFileSync(new URL('../src/routes/schedule.js', import.meta.url), 'utf8');
  assert.match(src, /resolveEffectiveAccess/, '路由应调用唯一真源');
  // 旧写法：`areaBlocked && own === '' ? areaAccess : own`（自己拼一遍继承）
  assert.ok(!/areaBlocked\s*&&\s*own\s*===\s*''\s*\?\s*areaAccess\s*:\s*own/.test(src),
    '不得再自己拼继承逻辑 —— 必须取 `resolveEffectiveAccess` 的结果');
});

test('★★ resolveEffectiveAccess：继承标记必须准确（前端据此显示「所在区域受限」）', () => {
  assert.deepEqual(resolveEffectiveAccess('', 'restricted'), { access: 'restricted', inherited: true },
    '未标注 + 父区 restricted → 继承受限，且标记为继承');
  assert.deepEqual(resolveEffectiveAccess('', 'private'), { access: '', inherited: false },
    '未标注 + 父区 private → **不继承**（这是本轮修的核心）');
  assert.deepEqual(resolveEffectiveAccess('public', 'restricted'), { access: 'public', inherited: false },
    '显式 public 解锁父级受限，且不算继承');
  assert.deepEqual(resolveEffectiveAccess('private', 'restricted'), { access: 'private', inherited: false },
    '自己标了 private 就按自己的走（父区是 restricted 也不改写它）');
});

test('约束块：准入禁令段在无区域时也可用（问题 2 的"不依赖 areas"落点）', () => {
  const s = buildScheduleConstraintBlock({
    accessNotes: [{ name: '珠星总部', area: '珠星集团CBD区', note: '谢绝外人／需身份' }],
  });
  assert.ok(s, '只有准入禁令也应当生成约束块');
  assert.match(s, /准入禁令/);
  assert.match(s, /珠星集团CBD区 · 珠星总部/);
  assert.match(s, /以本条为准/, '必须声明优先于上文那段硬编码散文');
});

test('★ 约束块：accessNotes 为空时不生成禁令段，且整体仍可为 null（默认不改行为）', () => {
  assert.equal(buildScheduleConstraintBlock({ accessNotes: [] }), null);
  assert.equal(buildScheduleConstraintBlock({}), null);
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] } });
  assert.ok(s);
  assert.doesNotMatch(s, /准入禁令/, '没有标注就不该出现这一段 —— 否则等于往提示词里塞空话');
});

test('约束块：准入标注与场景提示词都要注入，模型才不用猜', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市'],
    scenesByArea: { 二维市: ['泊地站', '夜市档'] },
    notesByArea: { 二维市: [{ name: '夜市档', note: '仅 18:00–02:00 时段开放' }] },
    promptsByArea: { 二维市: [{ name: '嬉步街', prompt: 'narrow neon alley, wet asphalt' }] },
  });
  assert.match(s, /仅 18:00–02:00 时段开放/);
  assert.match(s, /narrow neon alley, wet asphalt/);
  assert.match(s, /准入限制/);
});

test('★ 约束块：zone 段只在真的带了 zone 数据时才出现', () => {
  const without = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] } });
  assert.doesNotMatch(without, /地点性质与着装/);

  const withZ = buildScheduleConstraintBlock({
    areas: ['二维市'], scenesByArea: { 二维市: ['A'] }, zonesByArea: { 二维市: ['residence'] },
  });
  assert.match(withZ, /地点性质与着装/);
  assert.match(withZ, /居住区域/);
  assert.match(withZ, /不要自行推断/, '必须明确告诉模型这是数据、不是让它猜');
});

test('约束块：用户显式放行的受限地点标注成「本次已显式指定」', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市'],
    scenesByArea: { 二维市: ['泊地站'] },
    forcedPlaces: [{ name: '珠星总部', area: '二维市', note: '谢绝外人／需身份' }],
  });
  assert.match(s, /珠星总部/);
  assert.match(s, /谢绝外人／需身份/);
  assert.match(s, /本次用户已显式指定/);
});

test('常量：zone → 服装 key 的映射是稳定的（改动会破坏服装联动）', () => {
  assert.equal(ZONE_OUTFIT_HINT.residence, 'home');
  assert.equal(ZONE_OUTFIT_HINT.activity, 'work');
  assert.equal(ZONE_OUTFIT_HINT.private_transit, 'nude');
  assert.equal(ACCESS_LEVELS.length, 4);
  assert.equal(ZONE_LEVELS.length, 3);
});

// ─────────────────────────────────────────────────────────
// T6（2026-10-06）：地名清单不得再硬编码在提示词散文里
// ─────────────────────────────────────────────────────────

test('★★ T6：`scheduleInst` 不再列举会漂移的地名黑名单，改为"以地图数据为准"', () => {
  // 原散文写「不写进去的地方：珠星集团CBD区、海原电视塔、非仪式期的幻月秘庭」——
  // 与地图矛盾：CBD 在地图里是 public，且其下「珠星站」还是线路 A 的车站，
  // 照散文执行会把车站也排除掉。凡"地图数据之外的清单"都会这样漂移。
  const src = fs.readFileSync(new URL('../src/services/scheduleGenerator.js', import.meta.url), 'utf8');
  // 取 scheduleInst 模板（从声明到下一个 `;` 结束）
  const inst = src.match(/const scheduleInst = `[\s\S]*?`;/)?.[0] || '';
  assert.ok(inst.length > 500, '应能截出 scheduleInst 模板');
  assert.doesNotMatch(inst, /不写进去的地方/, 'scheduleInst 里不应再有"不写进去的地方"这句硬编码清单');
  // ★ 2026-10-07：更进一步 —— scheduleInst 里**不得出现任何具体地名**，
  //   连"以地图数据为准"那类举例也一并去掉，改为指引到本次注入的区域清单。
  assert.doesNotMatch(inst, /珠星集团CBD区/, 'scheduleInst 不应点名「珠星集团CBD区」（它与地图 public 冲突）');
  for (const t of ['二维市', '鸽川', '绘世学院', '世界尽头酒馆', '馋嘴胡同', '滨河道']) {
    assert.ok(!inst.includes(t), `scheduleInst 不应内置地名「${t}」——应改为从地图/区域清单读`);
  }
  assert.match(inst, /专门给某地加限制|以它为准|主要活动区域/, '应改为"以本次注入的地图数据为准"的口径');
});

test('★ T6：地图里受限地点是唯一真源（collectAccessNotes 只读地图、不另抄清单）', () => {
  const src = fs.readFileSync(new URL('../src/routes/schedule.js', import.meta.url), 'utf8');
  const fn = src.match(/function collectAccessNotes[\s\S]*?\n}/)?.[0] || '';
  assert.ok(fn, 'collectAccessNotes 应存在');
  // 它必须从地图读（loadScheduleAreas），而不是引用任何写死的地名数组
  assert.match(fn, /loadScheduleAreas\(/, 'collectAccessNotes 必须从地图读');
  assert.match(fn, /normalizeAccess\(/, '必须按 access 语义判定，而非按名字');
  // 不得断言"任何中文"（理由文案『仅限特定对象/整个区域』是中文标签，不是地名）；
  // 也先剥掉注释（函数体内的说明注释会举地名为例，那是文档不是清单）。
  const codeOnly = fn.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const name of ['珠星', '海原电视塔', '幻月秘庭', '泊地站', '鸽川']) {
    assert.ok(!codeOnly.includes(name), `collectAccessNotes 不应硬编码地点名「${name}」——应完全由地图 access 驱动`);
  }
});

test.after(() => { try { fs.unlinkSync(TMP); } catch { /* 忽略 */ } });