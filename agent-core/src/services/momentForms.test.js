import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMomentMotiveDirective,
  buildMomentScheduleContext,
  buildMomentMultiImageRule,
} from './momentForms.js';

test('motive directive states the selected subject without restating system rules', () => {
  const directive = buildMomentMotiveDirective('发现一个很喜欢的小东西');
  assert.match(directive, /【本次发朋友圈动因】发现一个很喜欢的小东西/);
  assert.doesNotMatch(directive, /同等重要/);
  assert.equal(buildMomentMotiveDirective(' '), '');
});

test('schedule context states only the current place and activity (no prose description)', () => {
  const prompt = buildMomentScheduleContext('林', {
    location: '书房',
    activity: '整理书架',
    description: '随手翻到一本旧书',
  });
  assert.match(prompt, /【此刻正在做】林此刻正在书房整理书架/);
  // ★ 默认不注入 description：日程描述常逐字照抄 <world_setting> 例句，会被模型复读进正文
  assert.doesNotMatch(prompt, /随手翻到一本旧书/);
  assert.doesNotMatch(prompt, /同等重要/);
  assert.equal(buildMomentScheduleContext('', { location: '书房', activity: '整理书架' }), '');
});

test('schedule context can opt into the description as explicitly-marked background', () => {
  const prompt = buildMomentScheduleContext('林', {
    location: '书房',
    activity: '整理书架',
    description: '随手翻到一本旧书',
  }, { withDescription: true });
  assert.match(prompt, /整理书架/);
  assert.match(prompt, /背景：随手翻到一本旧书/);
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
