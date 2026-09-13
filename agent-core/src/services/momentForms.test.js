import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOMENT_SINGLE_FOCUS_RULE,
  buildMomentMotiveDirective,
  buildMomentScheduleContext,
  MOMENT_RECORD_BACKDROP_RULE,
} from './momentForms.js';

test('single focus rule synthesizes schedule and motive into one coherent scene', () => {
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /单中心/);
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /两个同等重要的构成条件/);
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /在同一场景或同一段连续经历里共同成立/);
  assert.match(MOMENT_SINGLE_FOCUS_RULE, /禁止把日程、经历、旧动态、世界观分别写成几个独立段落/);
});

test('motive directive keeps the selected subject but requires it inside the current scene', () => {
  const directive = buildMomentMotiveDirective('发现一个很喜欢的小东西');
  assert.match(directive, /本次发圈动因（与此刻正在做同等重要）/);
  assert.match(directive, /同一场景/);
  assert.match(directive, /发现一个很喜欢的小东西/);
  assert.equal(buildMomentMotiveDirective(' '), '');
});

test('current activity is equal source material and cannot be rewritten to fit the motive', () => {
  const prompt = buildMomentScheduleContext('林', {
    location: '书房',
    activity: '整理书架',
    description: '随手翻到一本旧书',
  });
  assert.match(prompt, /此刻正在做（与本次发圈动因同等重要）/);
  assert.match(prompt, /林此刻正在书房整理书架（随手翻到一本旧书）/);
  assert.match(prompt, /不要为了贴合动因而把地点或活动改成另一个/);
  assert.match(prompt, /不要在文末单独补一句汇报/);
  assert.equal(buildMomentScheduleContext('', { location: '书房', activity: '整理书架' }), '');
});

test('background records remain supplementary to the synthesized main scene', () => {
  assert.match(MOMENT_RECORD_BACKDROP_RULE, /最多选取一条/);
  assert.match(MOMENT_RECORD_BACKDROP_RULE, /禁止逐条概括/);
});
