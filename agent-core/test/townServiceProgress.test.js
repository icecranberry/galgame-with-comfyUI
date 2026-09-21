import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentFromProgress } from '../src/services/town/progressPercent.js';

test('image progress callbacks become 0~100 integers (never NaN)', () => {
  // comfyClient / imageSkill 传的是对象：{ stage, phase, progress: 0~1, step, max }
  assert.equal(percentFromProgress({ stage: 'generating', phase: 'sampling', progress: 0.42 }), 42);
  assert.equal(percentFromProgress({ stage: 'generating', phase: 'done', progress: 1 }), 100);
  // 已经是对数字也接受
  assert.equal(percentFromProgress(0.5), 50);
  assert.equal(percentFromProgress(0.07), 7);
  // 没有进度的阶段（submitting / retrying / executing / waiting）返回 null，不该广播
  assert.equal(percentFromProgress({ stage: 'submitting' }), null);
  assert.equal(percentFromProgress({ stage: 'retrying', attempt: 1 }), null);
  assert.equal(percentFromProgress({ phase: 'executing', node: '3' }), null);
  assert.equal(percentFromProgress({ phase: 'waiting', step: 2, max: 10 }), null);
  // 任何非有限数值都不该被当成百分比这正是 NaN% 的来源
  assert.equal(percentFromProgress(undefined), null);
  assert.equal(percentFromProgress(null), null);
  assert.equal(percentFromProgress({}), null);
  assert.equal(percentFromProgress({ progress: NaN }), null);
  assert.equal(percentFromProgress({ progress: '0.5' }), null);
  // 越界夹住
  assert.equal(percentFromProgress({ progress: -1 }), 0);
  assert.equal(percentFromProgress({ progress: 2 }), 100);
});
