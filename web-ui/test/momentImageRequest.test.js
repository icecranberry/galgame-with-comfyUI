import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendMomentImageRequest,
  extractMomentImageRequest,
  stripMomentImageRequest,
} from '../src/utils/momentImageRequest.js';

test('moment image request append and strip are reversible', () => {
  const stored = appendMomentImageRequest('夜市真热闹', '雨天霓虹街角');
  assert.equal(stored, '夜市真热闹\n[[imgreq]]雨天霓虹街角[[/imgreq]]');
  assert.equal(stripMomentImageRequest(stored), '夜市真热闹');
  assert.equal(extractMomentImageRequest(stored), '雨天霓虹街角');
});

test('moment image request can carry an image-only post and tolerate malformed input', () => {
  const stored = appendMomentImageRequest('', '早晨的咖啡杯');
  assert.equal(stored, '[[imgreq]]早晨的咖啡杯[[/imgreq]]');
  assert.equal(stripMomentImageRequest(stored), '');
  assert.equal(extractMomentImageRequest('[[imgreq]]忘记闭合'), '忘记闭合');
  assert.equal(extractMomentImageRequest('普通正文'), '');
  assert.equal(stripMomentImageRequest('普通正文'), '普通正文');
});
