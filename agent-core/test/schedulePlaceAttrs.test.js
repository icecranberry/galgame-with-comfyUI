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
  pickSchedulePlaces, ACCESS_LEVELS, ZONE_LEVELS, ZONE_OUTFIT_HINT,
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

test.after(() => { try { fs.unlinkSync(TMP); } catch { /* 忽略 */ } });