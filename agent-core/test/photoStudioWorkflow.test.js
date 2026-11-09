import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoStudioPrompt, DEFAULT_PHOTO_STUDIO_DIMENSIONS, isPairPose, photoStudioDimensions } from '../src/services/photoStudioWorkflow.js';

test('the final prompt contains only the pose, one appearance per actor and optional direction', () => {
  const prompt = buildPhotoStudioPrompt({
    pose: { posePrompt: 'seated on the floor, one knee raised' },
    characters: [{ name: 'Bluebird', appearance: 'Bluebird (Game) has silver hair, blue eyes, wearing a red coat.' }],
    instruction: 'warm afternoon light',
  });
  assert.equal(prompt, '(seated on the floor, one knee raised)\n\n(Bluebird (Game) has silver hair, blue eyes, wearing a red coat.)\n\n(warm afternoon light)');
  assert.doesNotMatch(prompt, /preserve|exactly|solo|identity|Bluebird, Bluebird/);
});

test('pair poses bind English identities once without repeating per-actor actions or generic rules', () => {
  const pose = {
    system: '双人缠绵', id: 'pair60_P051_front', posePrompt: 'character 2 whispers to character 1',
    characterRoles: ['standing in front, hand on partner cheek', 'standing behind character 1, hand on partner hip'],
  };
  const prompt = buildPhotoStudioPrompt({
    pose,
    characters: [{ name: 'Alice', appearance: 'black hair' }, { name: 'Beatrice', appearance: 'white hair' }],
  });
  assert.equal(prompt, '(Beatrice whispers to Alice)\n\n(Alice, black hair)\n\n(Beatrice, white hair)');
  assert.equal(isPairPose(pose), true);
  assert.equal(isPairPose({ system: '全身单人', id: 'full_single_P001_front' }), false);
});

test('legacy Chinese aliases and numbered actors resolve to English names', () => {
  const prompt = buildPhotoStudioPrompt({
    pose: { posePrompt: '琪亚娜 stands in front while character 2 leans closer to 琪亚娜' },
    characters: [{ name: 'Kiana', aliases: ['琪亚娜'], appearance: 'Kiana has white hair.' }, { name: 'Mei', aliases: ['芽衣'], appearance: '芽衣 has purple hair.' }],
  });
  assert.equal(prompt, '(Kiana stands in front while Mei leans closer to Kiana)\n\n(Kiana has white hair.)\n\n(Mei has purple hair.)');
  assert.doesNotMatch(prompt, /琪亚娜|芽衣|character\s+[12]/i);
});

test('uncalibrated poses and missing appearances cannot generate an incomplete prompt', () => {
  assert.throws(() => buildPhotoStudioPrompt({ pose: {}, characters: [{ name: 'A' }] }), /尚未校准/);
  assert.throws(() => buildPhotoStudioPrompt({ pose: { posePrompt: 'standing' }, characters: [{ name: 'A' }] }), /缺少外观/);
});

test('photo dimensions default to 1200 by 1600 and preserve user-selected eight-pixel steps', () => {
  assert.deepEqual(DEFAULT_PHOTO_STUDIO_DIMENSIONS, { width: 1200, height: 1600 });
  assert.deepEqual(photoStudioDimensions(), { width: 1200, height: 1600 });
  assert.deepEqual(photoStudioDimensions(1288, 1736), { width: 1288, height: 1736 });
  assert.throws(() => photoStudioDimensions(1201, 1600), /8 的倍数/);
  assert.throws(() => photoStudioDimensions(256, 1600), /512–2048/);
});
