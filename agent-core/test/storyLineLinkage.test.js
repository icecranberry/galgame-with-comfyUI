import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`storyLineInjection test forbids network: ${url}`); };

/**
 * 「线 → prompt 注入」与「面 → 线 弱关联」—— 回归测试（2026-10-07 用户裁定）。
 *
 * ★ 为什么值得钉：
 *   ① 注入**直接改聊天提示词**，错了会污染所有对话且很难察觉；
 *   ② 弱关联涉及"改线名 → 大纲里的引用变孤儿"这种**静默**失效，
 *      不改的话用户只会觉得"名字对不上了"却找不到原因。
 */

const svc = await import('../src/services/story/eventLineService.js');

const mkLine = (over = {}) => ({
  id: 1, name: '测试线', stage: '延展', terminal: false,
  when: '第 3 天', agency: 'world', stall: false, pin: false, adult: false,
  desc: '这条线在讲什么', next: '下一步走向',
  participantIds: [], places: [], derivedFrom: null,
  ...over,
});

// ── 一、注入 ────────────────────────────────────────────────

test('★★ 只挑「该角色参与」的线（不做名字模糊匹配、不塞无关线）', () => {
  const lines = [
    mkLine({ id: 1, name: 'A', participantIds: [7, 8] }),
    mkLine({ id: 2, name: 'B', participantIds: [9] }),
    mkLine({ id: 3, name: 'C', participantIds: [] }),
  ];
  const got = svc.pickLinesForCharacter(7, lines);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, 'A');
});

test('★ 名字出现但没参与 → 不算相关（避免把无关线塞进来）', () => {
  const lines = [mkLine({ id: 1, name: 'someone-else', desc: '提到了 7 号', participantIds: [99] })];
  assert.equal(svc.pickLinesForCharacter(7, lines).length, 0);
});

test('★ 超限要截断（并让调用方能用 total 显式告知）', () => {
  const lines = Array.from({ length: svc.LINE_INJECT_MAX + 3 }, (_, i) =>
    mkLine({ id: i + 1, name: `L${i}`, participantIds: [7] }));
  assert.equal(svc.pickLinesForCharacter(7, lines).length, svc.LINE_INJECT_MAX);
});

test('★ 非法 characterId 安全返回空', () => {
  assert.deepEqual(svc.pickLinesForCharacter(null, [mkLine({ participantIds: [1] })]), []);
  assert.deepEqual(svc.pickLinesForCharacter('abc', [mkLine({ participantIds: [1] })]), []);
});

test('★★ 注入文本必须带「不要点破」的纪律（与「面」同口径）', () => {
  const text = svc.buildLineInjectionText([mkLine({ participantIds: [7] })]);
  assert.match(text, /切勿直接引用或点破/, '必须明令不要照念');
  assert.match(text, /测试线/, '要带上线名');
  assert.match(text, /延展/, '要带阶段');
});

test('★ 终态线只给状态、不给 desc/next（已经没什么可推进）', () => {
  const text = svc.buildLineInjectionText([
    mkLine({ name: '已了结线', stage: '收束', terminal: true, participantIds: [7] }),
  ]);
  assert.match(text, /已了结线/);
  assert.match(text, /收束/);
  assert.ok(!/这条线在讲什么/.test(text), '终态线不该再给 desc');
  assert.ok(!/下一步走向/.test(text), '终态线不该再给 next');
});

test('★ 空输入 → 空串（不注入，调用方据此跳过）', () => {
  assert.equal(svc.buildLineInjectionText([]), '');
  assert.equal(svc.buildLineInjectionText(null), '');
});

test('★ 超限时注入文本要显式说明"还有几条没列出"（红线 0，不静默）', () => {
  const picked = [mkLine({ name: 'A', participantIds: [7] })];
  const text = svc.buildLineInjectionText(picked, { total: 4 });
  assert.match(text, /另有 3 条/, '被截断必须告知，不能悄悄少给');
});

// ── 二、弱关联 ──────────────────────────────────────────────

test('★★ 精确匹配才能算引用（「线A」不得误命中「线A·分部」）', () => {
  const beats = [{ line: '线A' }, { line: '线A·分部' }, { line: ' 线A ' }];
  assert.deepEqual(svc.findBeatsReferencingLine(beats, '线A'), [0, 2],
    'trim 后全等才算；前缀相同的另一条线不能被算进去');
});

test('★ 空名/空 Beat 安全', () => {
  assert.deepEqual(svc.findBeatsReferencingLine([], 'x'), []);
  assert.deepEqual(svc.findBeatsReferencingLine([{ line: '' }], 'x'), []);
  assert.deepEqual(svc.findBeatsReferencingLine([{ line: 'x' }], ''), []);
});

test('★★ 改名同步只动 Beat 行的「所属线」段，且保留原始包装与未知字段', () => {
  const raw = [
    '<outline_widget>',
    'Beat: 第 3 天|标题甲|主线|旧线名|结果甲',
    'Scene: 场景甲',
    'Subtext: 题记甲',
    'Think: 作用甲',
    'Extra: 模型将来多加的字段（必须原样保留）',
    'Beat: 第 5 天|标题乙|支线|别条线|结果乙',
    '</outline_widget>',
  ].join('\n');
  const r = svc.renameLineInOutlineRaw(raw, '旧线名', '新线名');
  assert.equal(r.changed, 1);
  assert.match(r.raw, /<outline_widget>/, '原始包装必须保留');
  assert.match(r.raw, /<\/outline_widget>/, '闭合标签必须保留');
  assert.match(r.raw, /\|新线名\|/, '目标段要改成新名');
  assert.ok(!/旧线名/.test(r.raw), '旧名不该残留');
  assert.match(r.raw, /Extra: 模型将来多加的字段（必须原样保留）/, '未知字段必须原样保留');
  assert.match(r.raw, /别条线/, '其他线的名字不能被误改');
  // ★ 最小改动：改名不能顺带改格式（段内原有空格必须原样保留）
  assert.match(r.raw, /\|新线名\|/, '不应平白多出空格（只换名字，不动两侧空白）');
  assert.ok(!/\| 新线名 \|/.test(r.raw), '改名不该变成改格式');
});

test('★ 改名同步：名字不在大纲里时 changed=0、原文逐字不变', () => {
  const raw = 'Beat: t|标题|类型|别的线|结果\nScene: s';
  const r = svc.renameLineInOutlineRaw(raw, '不存在的线', '新名');
  assert.equal(r.changed, 0);
  assert.equal(r.raw, raw);
});

test('★ 改名同步：旧名==新名 / 空值 → 不做任何改动', () => {
  const raw = 'Beat: t|标题|类型|同名|结果';
  assert.equal(svc.renameLineInOutlineRaw(raw, '同名', '同名').changed, 0);
  assert.equal(svc.renameLineInOutlineRaw(raw, '', 'x').changed, 0);
  assert.equal(svc.renameLineInOutlineRaw(raw, 'x', '').changed, 0);
});

test('★ 改名同步：容忍 markdown 装饰前缀（> # * -）', () => {
  const raw = '> Beat: t|标题|类型|旧名|结果';
  const r = svc.renameLineInOutlineRaw(raw, '旧名', '新名');
  assert.equal(r.changed, 1);
  assert.match(r.raw, /^> Beat:/, '装饰前缀要保留');
  assert.match(r.raw, /新名/);
});