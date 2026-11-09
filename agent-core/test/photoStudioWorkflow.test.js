import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoStudioPrompt, DEFAULT_PHOTO_STUDIO_DIMENSIONS, isPairPose, photoStudioDimensions } from '../src/services/photoStudioWorkflow.js';

test('Anima prompt combines the calibrated pose, selected character appearance and optional direction', () => {
  const prompt = buildPhotoStudioPrompt({
    pose: { posePrompt: 'seated on the floor, leaning back, one knee raised' },
    characters: [{ name: '青鸟', appearance: 'short silver hair, blue eyes, red coat' }],
    instruction: 'warm afternoon light',
  });
  assert.match(prompt, /solo, one character/);
  assert.match(prompt, /one knee raised/);
  assert.match(prompt, /青鸟, short silver hair, blue eyes, red coat/);
  assert.match(prompt, /warm afternoon light/);
  assert.ok(prompt.startsWith('(solo, one character)'));
  assert.match(prompt, /\(seated on the floor, leaning back, one knee raised\)/);
  assert.match(prompt, /\(青鸟, short silver hair, blue eyes, red coat\)/);
  assert.match(prompt, /\(warm afternoon light\)$/);
  assert.doesNotMatch(prompt, /<\/?(?:composition|pose|character_\d|direction)>/);
  assert.doesNotMatch(prompt, /Picture 1|Qwen|reference image/i);
});

test('pair descriptions wrap each identity together with its own assigned pose role', () => {
  const pose = {
    system: '双人缠绵', id: 'pair60_P051_front', posePrompt: 'character 2 whispers to character 1',
    characterRoles: ['standing in front, hand on partner cheek', 'standing behind character 1, hand on partner hip'],
  };
  assert.equal(isPairPose(pose), true);
  const prompt = buildPhotoStudioPrompt({
    pose,
    characters: [{ name: 'A', appearance: 'black hair' }, { name: 'B', appearance: 'white hair' }],
  });
  assert.match(prompt, /two characters, exactly two people/);
  assert.match(prompt, /A, black hair/);
  assert.match(prompt, /B, white hair/);
  assert.match(prompt, /\(A, black hair; standing in front, hand on partner cheek\)/);
  assert.match(prompt, /\(B, white hair; standing behind A, hand on partner hip\)/);
  assert.ok(prompt.indexOf('(B whispers to A)') < prompt.indexOf('(A, black hair'));
  assert.ok(prompt.indexOf('(A, black hair') < prompt.indexOf('(B, white hair'));
  assert.doesNotMatch(prompt, /character\s+[12]/i);
  assert.doesNotMatch(prompt, /<\/?(?:composition|pose|character_\d|direction)>/);
  assert.equal(isPairPose({ system: '全身单人', id: 'full_single_P001_front' }), false);
});

test('pose person indices are replaced with selected character names before image preparation', () => {
  const prompt = buildPhotoStudioPrompt({
    pose: { posePrompt: 'character 1 stands in front while character 2 leans closer' },
    characters: [{ name: '琪亚娜' }, { name: '芽衣' }],
  });
  assert.match(prompt, /\(琪亚娜 stands in front while 芽衣 leans closer\)/);
  assert.doesNotMatch(prompt, /character\s+[12]/i);
});

test('uncalibrated poses never generate an incomplete prompt', () => {
  assert.throws(() => buildPhotoStudioPrompt({ pose: {}, characters: [{ name: 'A' }] }), /尚未校准/);
});

test('photo dimensions default to 1200 by 1600 and preserve user-selected eight-pixel steps', () => {
  assert.deepEqual(DEFAULT_PHOTO_STUDIO_DIMENSIONS, { width: 1200, height: 1600 });
  assert.deepEqual(photoStudioDimensions(), { width: 1200, height: 1600 });
  assert.deepEqual(photoStudioDimensions(1288, 1736), { width: 1288, height: 1736 });
  assert.throws(() => photoStudioDimensions(1201, 1600), /8 的倍数/);
  assert.throws(() => photoStudioDimensions(256, 1600), /512–2048/);
});
