import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLorebook } from '../src/services/lorebook/runtime.js';
import { getSystemRules } from '../src/db/worldRepository.js';
import { buildStudioPolishRequest, parseStudioPolish, STUDIO_POLISH_RULES, buildStudioClothingTranslationRequest } from '../src/services/photoStudioPolish.js';
import { CHARACTER_IMAGE_IDENTITY_RULE, STANDING_IMAGE_PROMPT_RULE } from '../src/builtinRules.js';

test('studio and standing prompts share the IP identity rule without importing standing-only composition limits', () => {
  assert.ok(STANDING_IMAGE_PROMPT_RULE.rule_content.includes(CHARACTER_IMAGE_IDENTITY_RULE));
  assert.ok(STUDIO_POLISH_RULES.includes(CHARACTER_IMAGE_IDENTITY_RULE));
  assert.ok(STUDIO_POLISH_RULES.includes('Name \\(Series\\)'));
  assert.doesNotMatch(STUDIO_POLISH_RULES, /MAX 800|plain white background/);
});

test('studio polishing shares a byte-stable prefix and exposes actual persona and dynamic boundaries', () => {
  for (const worldRule of ['', 'world reinforcement']) {
    const first = buildStudioPolishRequest({ systemRules: 'rules <world_setting>world</world_setting>', worldRule, personas: ['persona A'], prompt: 'pose A, outfit A' });
    const second = buildStudioPolishRequest({ systemRules: 'rules <world_setting>world</world_setting>', worldRule, personas: ['persona B'], prompt: 'pose B, outfit B' });
    const boundary = first.lorebook.cacheBoundary;
    assert.deepEqual(first.messages.slice(0, boundary.index + 1), second.messages.slice(0, boundary.index + 1));
    assert.equal(first.messages[boundary.index].content, STUDIO_POLISH_RULES);
    assert.equal(boundary.offset, STUDIO_POLISH_RULES.length);
    assert.deepEqual(first.lorebook.personaTexts, ['persona A']);
    assert.deepEqual(first.lorebook.staticTexts, first.messages.slice(0, boundary.index + 1).map(message => message.content));
    assert.equal(first.messages.filter(message => message.role === 'user').length, 1);
    assert.equal(first.messages.at(-1).role, 'user');
    assert.match(first.lorebook.history[0].content, /pose A, outfit A/);
    assert.ok(first.messages.every(message => message.content.trim()));
  }
});

test('polished output must be usable English prompt text', () => {
  const prompt = 'Alice sits on the floor, leaning back, wearing a blue dress.';
  assert.equal(parseStudioPolish(`  ${prompt}  `), prompt);
  for (const invalid of ['', 'sorry', '```text\n' + prompt + '\n```', '{"prompt":"' + prompt + '"}', '这是润色结果：' + prompt]) {
    assert.throws(() => parseStudioPolish(invalid), /有效的英文提示词/);
  }
});

test('photo polishing preserves section order and leaves outfit insertion to the application', () => {
  const original = 'Pose: standing\n\nCharacter 1 — Appearance: Alice has blue eyes.\n\nBackground: A red wall.';
  const refined = 'Pose: standing upright\n\nCharacter 1 — Appearance: Alice has bright blue eyes.\n\nBackground: A matte red wall.';
  assert.equal(parseStudioPolish(refined, original), refined);
  for (const invalid of [
    'Alice stands upright in front of a matte red wall.',
    refined.replace('Character 1 — Appearance:', 'Character 2 — Appearance:'),
    refined.replace(/\n\nBackground:[\s\S]*$/, ''),
    refined + '\n\nCharacter 1 — Outfit: an invented dress.',
    'Background: A red wall.\n\nPose: standing\n\nCharacter 1 — Appearance: Alice has blue eyes.',
  ]) assert.throws(() => parseStudioPolish(invalid, original), /分段/);
});


test('custom clothing translation excludes world context, reinforcement and lorebook while keeping a stable prefix', async () => {
  const a = buildStudioClothingTranslationRequest({ brief: '白色衬衫', worldRule: 'world reinforcement must not appear' });
  const b = buildStudioClothingTranslationRequest({ brief: '红色裙子' });
  assert.deepEqual(a.messages.slice(0, 2), b.messages.slice(0, 2));
  assert.equal(a.messages.length, 4);
  assert.equal(a.messages[0].content, getSystemRules({ roleplay: false }));
  assert.ok(a.messages.every(message => !message.content.includes('world reinforcement must not appear')));
  assert.equal(a.lorebook, false);
  const prepared = await prepareLorebook(a.messages, a.lorebook);
  assert.equal(prepared.messages, a.messages);
  assert.equal(a.messages.filter(message => message.role === 'user').length, 1);
  assert.match(a.messages[1].content, /不扩写、不设计搭配/);
  assert.match(a.messages.at(-2).content, /白色衬衫/);
  assert.throws(() => buildStudioClothingTranslationRequest({ brief: '', systemRules: 'rules' }));
});
