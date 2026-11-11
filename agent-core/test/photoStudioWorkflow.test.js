import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoStudioPrompt, appendPhotoStudioOutfits, DEFAULT_PHOTO_STUDIO_DIMENSIONS, isPairPose, photoStudioDimensions } from '../src/services/photoStudioWorkflow.js';

test('the final prompt contains only the pose, one appearance per actor and optional direction', () => {
  const prompt = buildPhotoStudioPrompt({
    pose: { posePrompt: 'seated on the floor, one knee raised' },
    characters: [{ name: 'Bluebird', identityTag: 'Bluebird (Game)', appearance: 'Bluebird (Game) has silver hair, blue eyes, wearing a red coat.' }],
    instruction: 'warm afternoon light',
  });
  assert.equal(prompt, 'Pose: seated on the floor, one knee raised\n\nCharacter 1 — Appearance: Bluebird \\(Game\\) has silver hair, blue eyes, wearing a red coat.\n\nDirection: warm afternoon light');
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
  assert.equal(prompt, 'Pose: Beatrice whispers to Alice\n\nCharacter 1 — Appearance: Alice, black hair\n\nCharacter 2 — Appearance: Beatrice, white hair');
  assert.equal(isPairPose(pose), true);
  assert.equal(isPairPose({ system: '全身单人', id: 'full_single_P001_front' }), false);
});

test('legacy Chinese aliases and numbered actors resolve to English names', () => {
  const prompt = buildPhotoStudioPrompt({
    pose: { posePrompt: '琪亚娜 stands in front while character 2 leans closer to 琪亚娜' },
    characters: [{ name: 'Kiana', aliases: ['琪亚娜'], appearance: 'Kiana has white hair.' }, { name: 'Mei', aliases: ['芽衣'], appearance: '芽衣 has purple hair.' }],
  });
  assert.equal(prompt, 'Pose: Kiana stands in front while Mei leans closer to Kiana\n\nCharacter 1 — Appearance: Kiana has white hair.\n\nCharacter 2 — Appearance: Mei has purple hair.');
  assert.doesNotMatch(prompt, /琪亚娜|芽衣/);
});

test('uncalibrated poses and missing appearances cannot generate an incomplete prompt', () => {
  assert.throws(() => buildPhotoStudioPrompt({ pose: {}, characters: [{ name: 'A' }] }), /尚未校准/);
  assert.throws(() => buildPhotoStudioPrompt({ pose: { posePrompt: 'standing' }, characters: [{ name: 'A' }] }), /缺少外观/);
});

test('mechanical assembly escapes IP tags exactly once and preserves unrelated weighted tags', () => {
  for (const identity of ['Alice (Game)', 'Alice \\(Game\\)']) {
    const prompt = buildPhotoStudioPrompt({ pose: { posePrompt: 'standing' }, characters: [{
      name: 'Alice', identityTag: 'Alice (Game)', appearance: `${identity} has blue eyes, (red coat:1.2).`,
    }] });
    assert.equal(prompt, 'Pose: standing\n\nCharacter 1 — Appearance: Alice \\(Game\\) has blue eyes, (red coat:1.2).');
  }
});

test('photo dimensions default to 9:16 at 1152 by 2048 and preserve user-selected eight-pixel steps', () => {
  assert.deepEqual(DEFAULT_PHOTO_STUDIO_DIMENSIONS, { width: 1152, height: 2048 });
  assert.deepEqual(photoStudioDimensions(), { width: 1152, height: 2048 });
  assert.deepEqual(photoStudioDimensions(1288, 1736), { width: 1288, height: 1736 });
  assert.throws(() => photoStudioDimensions(1201, 1600), /8 的倍数/);
  assert.throws(() => photoStudioDimensions(256, 1600), /512–2048/);
});


test('outfit blocks follow their own appearance sections before the background and keep raw tags intact', () => {
  const base = buildPhotoStudioPrompt({ pose: { posePrompt: 'standing together' }, characters: [{ name: 'Alice', appearance: 'blue eyes' }, { name: 'Bella', appearance: 'dark hair' }], backgroundPrompt: 'A red wall.' });
  const one = 'Character 1 — Outfit: Replace original clothes.\nClothing tags: striped_shirt, wet_shirt';
  const two = 'Character 2 — Outfit: Replace original clothes.\nCustom clothing: red silk';
  const output = appendPhotoStudioOutfits(base, [one, two]);
  assert.equal(output, 'Pose: standing together\n\nCharacter 1 — Appearance: Alice, blue eyes\n\n' + one + '\n\nCharacter 2 — Appearance: Bella, dark hair\n\n' + two + '\n\nBackground: A red wall.');
  assert.equal(appendPhotoStudioOutfits(base, ['', '']), base);
  assert.throws(() => appendPhotoStudioOutfits('unstructured prompt', [one]), /缺少人物外观分段/);
});
