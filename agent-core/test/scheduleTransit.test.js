/**
 * 区域通勤注入 + 生图「正面位不该出背面视角」回归测试。
 *
 * 覆盖两批 2026-10-05 的修复：
 *  A. 通勤基线注入（问题 6）—— 后端算好给模型，不让 LLM 猜距离；
 *     且**没数据时不出现**（默认不改行为）。
 *  B. 体位软偏好不得被"顺带提到的部位词"误触发（用户实报：扛腿位画成肢体扭曲）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`test forbids network: ${url}`); };

const { buildScheduleConstraintBlock } = await import('../src/services/scheduleGenerator.js');
const { SEX_POSITIONS } = await import('../src/data/sexPositions.js');

// ══════════════════════════════════════════════════════════
// A. 区域通勤注入
// ══════════════════════════════════════════════════════════

const EDGES = [
  { line_id: 'A', line_name: '城际线', from_stop: '珠星站', to_stop: '泊地站', mode: 'rail', km: 29.87, minutes: 60, seq: 0 },
  { line_id: 'W', line_name: '水路线', from_stop: '海原站', to_stop: '鸽泉港', mode: 'water', km: 25.2, minutes: 92, seq: 0 },
  { line_id: 'W', line_name: '水路线', from_stop: '鸽泉港', to_stop: '渡画泉隐', mode: 'water', km: 37.2, minutes: 132, seq: 1 },
];

test('★ 通勤基线：传了边就注入，且写明「后端已算好、不得小于」', () => {
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] }, transitEdges: EDGES });
  assert.ok(s);
  assert.match(s, /区域通勤基线/, '必须出现通勤段');
  assert.match(s, /珠星站 → 泊地站 约 60 分/);
  assert.match(s, /不得明显小于上表数值/);
  assert.match(s, /瞬移/, '要明确禁止瞬移，否则模型仍会"城东吃完早饭瞬移城西"');
});

test('★ 通勤基线：没传边时整段不出现（默认不改行为）', () => {
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] } });
  assert.doesNotMatch(s, /区域通勤基线/);
  // 空数组同样不出现
  const s2 = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] }, transitEdges: [] });
  assert.doesNotMatch(s2, /区域通勤基线/);
});

test('★ 通勤基线：水路存在时必须提示"长线，当天别再塞跨区活动"', () => {
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] }, transitEdges: EDGES });
  assert.match(s, /水路线是\*\*长线\*\*/);
  assert.match(s, /5\.5 小时|半天以上/);
});

test('★ 通勤基线：只有轨道时不额外出现水路警告', () => {
  const railOnly = EDGES.filter(e => e.mode === 'rail');
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] }, transitEdges: railOnly });
  assert.match(s, /区域通勤基线/);
  assert.doesNotMatch(s, /长线/);
});

test('★ 通勤基线：按线路分组列出，不混成一条长串', () => {
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['A'] }, transitEdges: EDGES });
  const aLine = s.slice(s.indexOf('- A '), s.indexOf('- W '));
  assert.match(aLine, /珠星站 → 泊地站/);
  assert.doesNotMatch(aLine, /鸽泉港/, 'A 线段里不该混入 W 线的站');
});

// ══════════════════════════════════════════════════════════
// B. 体位软偏好不得被部位词误触发
// ══════════════════════════════════════════════════════════

test('★★ 正面位（missionary）不得被判为"背面视角更自然"', () => {
  // 这就是用户报的「肢体扭曲」：068 扛腿位 prompt 里有 "her ass"，曾被 from behind ×4 拉高，
  // 与 missionary 的面对面构图打架。
  const p068 = SEX_POSITIONS.find(p => p.no === '068');
  assert.ok(p068, '068 扛leg位应存在');
  assert.match(p068.prompt, /\bass\b/i, '其 prompt 确实含 ass（这是当初的误触发源）');
  const soft = /from behind|reverse cowgirl|doggy|all fours|prone|from the back/;
  assert.doesNotMatch(p068.prompt, soft, '去掉 ass 后，068 不该再命中背面视角的软偏好');
});

test('★ 真正的背向体位仍能命中（不能被矫枉过正）', () => {
  const soft = /from behind|reverse cowgirl|doggy|all fours|prone|from the back/;
  const should = ['017', '016', '050', '031', '053'];  // 后入跪位/后入卧位/床上背面骑乘/叠女后入/坐姿后入
  for (const no of should) {
    const p = SEX_POSITIONS.find(x => x.no === no);
    assert.ok(p, `${no} 应存在`);
    const txt = `${p.prompt || ''} ${(p.core || []).join(' ')} ${p.name}`;
    assert.ok(soft.test(txt), `${no} ${p.name} 应仍能命中背面视角软偏好`);
  }
});

test('★ from behind 必须有 block 挡住 missionary（只靠 soft 降权不够）', async () => {
  const { ENV_DIMENSIONS } = await import('../src/data/galleryEnvironment.js');
  const view = ENV_DIMENSIONS.find(d => d.key === 'view');
  assert.ok(view, 'view 维度应存在');
  const fb = (view.pool || []).find(t => t.en === 'from behind');
  assert.ok(fb, 'from behind 应存在');
  assert.ok(fb.block, 'from behind 必须有 block —— 软偏好只在候选间调概率，候选唯一时照样必选');
  assert.ok(fb.block.test('the girl is lying on her back ... missionary ...'), 'block 应命中 missionary');
  assert.ok(!fb.block.test('she is on all fours, doggystyle'), 'block 不该命中真正的后体位');
});