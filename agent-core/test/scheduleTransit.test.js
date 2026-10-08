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
// ══════════════════════════════════════════════════════════
// C. D1：全选多区域时「画面行」必须被配额压住（2026-10-06 用户裁定）
// ══════════════════════════════════════════════════════════

test('★ D1：画面行按区域数配额递减，勾满时总量被压到可控范围', async () => {
  const { scenePromptCap } = await import('../src/services/scheduleGenerator.js');
  // 配额随区域数递减（勾得越多、每区展开越少）
  assert.ok(scenePromptCap(1) > scenePromptCap(4), '区域少时应给得更多');
  assert.ok(scenePromptCap(4) > scenePromptCap(14), '区域多时应给得更少');
  assert.ok(scenePromptCap(14) >= 1, '勾满时每区仍应至少给 1 条（不能退化成 0 —— 那就退回"只有裸地名"）');
});

test('★ D1：画面行只来自勾选区域（不得掺入未勾选区域的画面）', () => {
  const scenesByArea = { 二维市: ['a', 'b'], 鸽川区: ['c', 'd'] };
  const promptsByArea = {
    二维市: [{ name: 'a', prompt: 'A-scene-prompt' }, { name: 'b', prompt: 'B-scene-prompt' }],
    鸽川区: [{ name: 'c', prompt: 'C-scene-prompt' }, { name: 'd', prompt: 'D-scene-prompt' }],
    未勾选区: [{ name: 'z', prompt: 'Z-SHOULD-NOT-APPEAR' }],
  };
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea, promptsByArea });
  assert.ok(s.includes('二维市'), '应含勾选区域');
  assert.ok(!s.includes('Z-SHOULD-NOT-APPEAR'), '未勾选区域的画面行不得出现');
});

test('★ D1：被配额裁掉的画面行，其地名仍须列出（模型要知道有这个地点）', () => {
  const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const oneArea = names.map(n => ({ name: n, prompt: `scene-${n}` }));
  // 传很多区域把配额压到最低
  const areaNames = ['二维市', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const scenesByArea = {}, promptsByArea = {};
  for (const a of areaNames) { scenesByArea[a] = names; promptsByArea[a] = oneArea; }
  const s = buildScheduleConstraintBlock({ areas: areaNames, scenesByArea, promptsByArea });
  assert.ok(s.includes('p8'), '被裁掉的 p8 地名仍应出现（只裁画面细节，不裁地名）');
  assert.ok(s.includes('另有画面细节'), '应有"未展开"的说明，避免模型以为这些地点没画面');
});
