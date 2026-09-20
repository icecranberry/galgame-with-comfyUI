import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOMENT_SINGLE_FOCUS_RULE,
  buildMomentMotiveDirective,
  buildMomentScheduleContext,
  buildMomentMultiImageRule,
  MOMENT_RECORD_BACKDROP_RULE,
} from './momentForms.js';

test('single focus rule synthesizes schedule and motive into one coherent scene', () => {
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /单中心/);
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /两个同等重要的构成条件/);
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /在同一场景或同一段连续经历里共同成立/);
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /禁止把日程、经历、旧动态、世界观分别写成几个独立段落/);
});

test('motive directive states the selected subject without restating system rules', () => {
  const directive = buildMomentMotiveDirective('发现一个很喜欢的小东西');
  assert.match(directive, /【本次发圈动因】发现一个很喜欢的小东西/);
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

test('background records remain supplementary to the synthesized main scene', () => {
  assert.match(MOMENT_RECORD_BACKDROP_RULE, /最多选取一条/);
  assert.match(MOMENT_RECORD_BACKDROP_RULE, /禁止逐条概括/);
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
