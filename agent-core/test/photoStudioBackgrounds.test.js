import test from 'node:test';
import assert from 'node:assert/strict';
import { getStudioBackgrounds, resolveStudioBackground, buildStudioBackgroundRequest, DEFAULT_STUDIO_BACKGROUND } from '../src/services/photoStudioBackgrounds.js';
import { buildPhotoStudioPrompt } from '../src/services/photoStudioWorkflow.js';

test('background library contains 320 distinct bilingual scenes across sixteen balanced categories', () => {
  const { entries, categories } = getStudioBackgrounds();
  assert.equal(entries.length, 320);
  assert.equal(categories.length, 16);
  for (const field of ['id', 'label', 'prompt']) assert.equal(new Set(entries.map(entry => entry[field])).size, 320, field);
  for (const category of categories) assert.equal(entries.filter(entry => entry.category === category.value).length, 20);
  for (const entry of entries) {
    assert.match(entry.label, /[\u4e00-\u9fff]/);
    assert.match(entry.description, /[\u4e00-\u9fff]/);
    assert.match(entry.prompt, /^[\x20-\x7e]+$/);
    assert.ok(entry.prompt.split(/\s+/).length >= 20, entry.id);
    assert.equal(resolveStudioBackground({ backgroundId: entry.id }), entry.prompt);
  }
});

test('new everyday categories and solid-color shadow instructions are available', () => {
  const { entries, categories } = getStudioBackgrounds();
  for (const category of ['卧室', '家庭', '学校', '办公室', '几何图案', '纯色']) {
    assert.ok(categories.some(item => item.value === category));
  }
  for (const entry of entries.filter(item => item.category === '纯色')) {
    assert.match(entry.label, /强烈阴影/);
    assert.match(entry.description, /强烈阴影/);
    assert.match(entry.prompt, /hard directional lighting.*strong, sharply defined cast shadows/);
    assert.match(entry.prompt, /cast shadows of the subject directly onto the flat color field/);
    assert.doesNotMatch(entry.prompt, /\bstudio\b|\bwall\b|\bfloor\b|\bseamless\b/i);
  }
});

test('former texture backgrounds use anime geometric patterns instead of physical materials', () => {
  const { entries, categories } = getStudioBackgrounds();
  assert.ok(!categories.some(item => item.value === '简单纹理'));
  const patterns = entries.filter(item => item.category === '几何图案');
  assert.deepEqual(patterns.map(entry => entry.id), Array.from({ length: 20 }, (_, index) => `bg-${281 + index}`));
  for (const entry of patterns) {
    assert.match(entry.prompt, /flat two-dimensional geometric pattern background for an anime illustration/);
    assert.doesNotMatch(entry.prompt, /\b(linen|canvas|paper|plaster|sandstone|microcement|leather|aluminum|wood|cork|marble|terrazzo|glass|felt|glaze|suede)\b|film grain/i);
    assert.doesNotMatch(entry.description, /纤维|毛孔|石屑|绒毛|材质/);
  }
  const prompts = patterns.map(entry => entry.prompt).join('\n');
  for (const motif of ['polka dots', 'checkerboard', 'stripes', 'diamonds', 'rays', 'speed lines']) {
    assert.ok(prompts.includes(motif), motif);
  }
});

test('background resolver rejects unknown, ambiguous and untranslated input', () => {
  assert.equal(resolveStudioBackground(), DEFAULT_STUDIO_BACKGROUND);
  assert.equal(resolveStudioBackground({ customBackgroundPrompt: '  ' }), DEFAULT_STUDIO_BACKGROUND);
  assert.match(DEFAULT_STUDIO_BACKGROUND, /white background/);
  assert.equal(resolveStudioBackground({ customBackgroundPrompt: '  A rainy alley.  ' }), 'A rainy alley.');
  for (const input of [{ backgroundId: 'missing' }, { backgroundId: [] }, { customBackgroundPrompt: {} },
    { backgroundId: 'bg-001', customBackgroundPrompt: 'forest' }, { customBackgroundPrompt: '雨夜街道' },
    { customBackgroundPrompt: 'a'.repeat(4001) }, { customBackgroundPrompt: '```scene```' }]) {
    assert.throws(() => resolveStudioBackground(input), error => error.status === 400);
  }
});

test('background extends the assembled prompt without changing the pose, appearance or no-background path', () => {
  const input = { pose: { posePrompt: 'seated on a stone bench' }, characters: [{ name: 'Alice', appearance: 'Alice wears a blue dress.' }], instruction: 'soft light' };
  const original = buildPhotoStudioPrompt(input);
  assert.equal(buildPhotoStudioPrompt({ ...input, backgroundPrompt: '' }), original);
  assert.equal(buildPhotoStudioPrompt({ ...input, backgroundPrompt: 'A quiet rose garden.' }), 'Pose: seated on a stone bench\n\nCharacter 1 — Appearance: Alice wears a blue dress.\n\nBackground: A quiet rose garden.\n\nDirection: soft light');
});

test('custom background requests keep a stable prefix and scan only dynamic material and the final user', () => {
  for (const worldRule of ['', 'world integration']) {
    const first = buildStudioBackgroundRequest({ systemRules: 'rules <world_setting>world</world_setting>', worldRule, description: '雨夜街道' });
    const second = buildStudioBackgroundRequest({ systemRules: 'rules <world_setting>world</world_setting>', worldRule, description: '雪山湖畔' });
    const boundary = first.lorebook.cacheBoundary;
    assert.deepEqual(first.messages.slice(0, boundary.index + 1), second.messages.slice(0, boundary.index + 1));
    assert.equal(boundary.offset, first.messages[boundary.index].content.length);
    assert.deepEqual(first.lorebook.staticTexts, first.messages.slice(0, boundary.index + 1).map(message => message.content));
    assert.deepEqual(first.lorebook.personaTexts, []);
    assert.deepEqual(first.lorebook.history, first.messages.slice(boundary.index + 1));
    assert.equal(first.messages.filter(message => message.role === 'user').length, 1);
    assert.equal(first.messages.at(-1).role, 'user');
    assert.match(first.messages.at(-2).content, /雨夜街道/);
    assert.match(first.messages[boundary.index].content, /不描写人物/);
  }
  for (const description of ['', ' ', null, 'a'.repeat(1501)]) assert.throws(() => buildStudioBackgroundRequest({ description, systemRules: 'rules' }), error => error.status === 400);
});
