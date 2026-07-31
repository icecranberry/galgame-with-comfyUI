import test from 'node:test';
import assert from 'node:assert/strict';
import { stripImagePromptLines } from '../src/services/groupChatEngine.js';

test('group transcript omits direct image prompt lines instead of exposing a placeholder', () => {
  const transcript = [
    '黑岩奈美: 冰乐你再不说话，我就要开始脑补了',
    '黑岩奈美: {1girl, long hair, cute expression}',
    '神代明日香: 奈美你画得也太可爱了吧',
  ].join('\n');

  assert.equal(
    stripImagePromptLines(transcript),
    [
      '黑岩奈美: 冰乐你再不说话，我就要开始脑补了',
      '神代明日香: 奈美你画得也太可爱了吧',
    ].join('\n'),
  );
});

test('group transcript also omits legacy JSON image prompt lines', () => {
  assert.equal(
    stripImagePromptLines('黑岩奈美: {"prompt":"1girl, long hair"}'),
    '',
  );
});
