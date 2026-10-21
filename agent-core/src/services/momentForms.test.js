import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMomentMotiveDirective,
  buildMomentScheduleContext,
  buildMomentMultiImageRule,
  pickMomentFocus,
  buildMomentFocusDirective,
  MOMENT_FORMS,
} from './momentForms.js';

test('motive directive states the selected subject without restating system rules', () => {
  const directive = buildMomentMotiveDirective('发现一个很喜欢的小东西');
  assert.match(directive, /【本次发朋友圈动因】发现一个很喜欢的小东西/);
  assert.doesNotMatch(directive, /同等重要/);
  assert.equal(buildMomentMotiveDirective(' '), '');
});

test('schedule context states only the current place and activity', () => {
  const prompt = buildMomentScheduleContext('林', {
    location: '书房',
    activity: '整理书架',
    description: '随手翻到一本旧书',
  });
  assert.match(prompt, /【此刻正在做】林此刻正在书房整理书架（随手翻到一本旧书）/);
  assert.doesNotMatch(prompt, /同等重要/);
  assert.equal(buildMomentScheduleContext('', { location: '书房', activity: '整理书架' }), '');
});

test('motive-focused schedule omits its description at serialization', () => {
  const prompt = buildMomentScheduleContext('林', {
    location: '书房', activity: '整理书架', description: '用户带着另一个话题前来帮忙',
  }, { includeDescription: false });
  assert.match(prompt, /书房整理书架/);
  assert.doesNotMatch(prompt, /用户|另一个话题|帮忙/);
});

test('custom topics always focus on motive without rolling the system-topic coin', () => {
  assert.equal(pickMomentFocus({ hasSchedule: true, hasMotive: true, topicSource: 'custom',
    random: () => { throw new Error('custom topics must not roll'); } }), 'motive');
});

test('system topics use the exact 50 percent boundary when a schedule exists', () => {
  for (const [roll, expected] of [[0, 'schedule'], [0.499999, 'schedule'], [0.5, 'motive'], [0.999999, 'motive']]) {
    assert.equal(pickMomentFocus({ hasSchedule: true, hasMotive: true, topicSource: 'default', random: () => roll }), expected);
  }
  const noRoll = () => { throw new Error('no competing sources'); };
  assert.equal(pickMomentFocus({ hasSchedule: false, hasMotive: true, random: noRoll }), 'motive');
  assert.equal(pickMomentFocus({ hasSchedule: true, hasMotive: false, random: noRoll }), 'schedule');
  assert.equal(pickMomentFocus({ hasSchedule: false, hasMotive: false, random: noRoll }), 'free');
  assert.equal(pickMomentFocus({ hasSchedule: true, hasMotive: true, explicitTopic: true, random: noRoll }), 'motive');
  assert.match(buildMomentFocusDirective('schedule'), /日程为主，动因为弱参考/);
  assert.match(buildMomentFocusDirective('motive'), /动因为主，简要日程仅作低优先级背景/);
});

test('restored form ranges keep the original lower bounds and double only upper bounds', () => {
  assert.deepEqual(MOMENT_FORMS.map(f => f.len), [
    '5-40字', '1-30字', '15-90字', '10-90字', '15-90字', '1-40字', '1-24字', '5-60字',
  ]);
});

test('multi-image rule asks for a continuous photo sequence with shared anchors', () => {
  const two = buildMomentMultiImageRule(2);
  assert.match(two, /同一段连续经历里的两帧/);
  assert.match(two, /imagePrompt、imagePrompt2/);
  assert.match(two, /同一组连续性锚点/);
  assert.match(two, /第 1 张.*建立场景/);
  assert.match(two, /第 2 张.*推进/);
  assert.match(two, /禁止换活动/);
});

test('three-image rule keeps a complete beginning, middle, and end', () => {
  const three = buildMomentMultiImageRule(3);
  assert.match(three, /第 1 张.*建立场景/);
  assert.match(three, /第 2 张.*推进/);
  assert.match(three, /第 3 张.*收束/);
  assert.match(three, /imagePrompt、imagePrompt2、imagePrompt3/);
});

test('single-image posts do not receive the sequence rule', () => {
  assert.equal(buildMomentMultiImageRule(1), '');
});
