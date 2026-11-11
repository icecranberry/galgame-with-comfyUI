import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLorebook } from '../src/services/lorebook/runtime.js';
import { getSystemRules } from '../src/db/worldRepository.js';
import { buildStudioPolishRequest, parseStudioPolish, STUDIO_POLISH_RULES, getStudioPolishContext, buildStudioClothingTranslationRequest, splitStudioTags, studioPoseTags, polishStudioPrompt } from '../src/services/photoStudioPolish.js';
import { IMAGE_PROMPT_RULE } from '../src/builtinRules.js';

test('studio rewriting excludes worlds and lorebooks and places image rules after the stable task requirements', async () => {
  const context = getStudioPolishContext();
  assert.equal(context.systemRules, getSystemRules({ roleplay: false }));
  assert.ok(!Object.hasOwn(context, 'worldId'));
  assert.ok(!Object.hasOwn(context, 'worldRule'));
  const first = buildStudioPolishRequest({ personas: ['persona A'], prompt: 'pose A, outfit A', polishInstruction: '暖色光线', worldRule: 'must not appear' });
  const second = buildStudioPolishRequest({ personas: ['persona B'], prompt: 'pose B, outfit B', polishInstruction: '冷色光线' });
  assert.deepEqual(first.messages.slice(0, 3), second.messages.slice(0, 3));
  assert.deepEqual(first.messages.slice(0, 3), [
    { role: 'system', content: getSystemRules({ roleplay: false }) },
    { role: 'system', content: STUDIO_POLISH_RULES },
    { role: 'system', content: IMAGE_PROMPT_RULE.rule_content },
  ]);
  assert.equal(first.messages[3].content, 'persona A');
  assert.match(first.messages.at(-2).content, /^【初步画面提示词】/);
  assert.match(first.messages.at(-1).content, /【任务额外需求】\n暖色光线/);
  assert.equal(first.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(first.messages.at(-1).role, 'user');
  assert.doesNotMatch(JSON.stringify(first.messages), /最终拼装稿|must not appear|world_setting|world_integration/);
  assert.equal(first.lorebook, false);
  const prepared = await prepareLorebook(first.messages, first.lorebook);
  assert.equal(prepared.messages, first.messages);
  assert.ok(first.messages.every(message => message.content.trim()));
  assert.doesNotMatch(buildStudioPolishRequest({ prompt: 'a portrait', polishInstruction: '  ' }).messages.at(-1).content, /任务额外需求/);
});

test('polished output must be usable English prompt text', () => {
  const prompt = 'Alice sits on the floor, leaning back, wearing a blue dress.';
  assert.equal(parseStudioPolish(`  ${prompt}  `), prompt);
  for (const invalid of ['', 'sorry', '```text\n' + prompt + '\n```', '{"prompt":"' + prompt + '"}', '这是润色结果：' + prompt]) {
    assert.throws(() => parseStudioPolish(invalid), /有效的英文提示词/);
  }
});

test('photo polishing accepts prose, rejects assembly labels and validates exact tags', () => {
  const refined = 'Alice wears striped_shirt, leaning_back with (arms_up:1.2) before a red wall.';
  const tags = ['striped_shirt', 'leaning_back', '(arms_up:1.2)'];
  assert.equal(parseStudioPolish(refined, tags), refined);
  assert.equal(parseStudioPolish(refined.replace('before', '\n\nbefore'), tags), refined);
  for (const label of ['Pose:', 'Character 1 — Appearance:', 'Character 2 — Outfit:', 'Clothing tags:', 'Custom clothing:', 'Background:', 'Direction:']) {
    assert.throws(() => parseStudioPolish(`${label} ${refined}`, tags), /拼装标记/);
  }
  for (const tag of tags) assert.throws(() => parseStudioPolish(refined.replace(tag, 'changed'), tags), /遗漏.*tag/);
  assert.throws(() => parseStudioPolish('Alice wears a miniskirt before a red wall.', ['skirt']), /遗漏.*tag/);
  assert.equal(parseStudioPolish('Alice is sitting in a red silk dress before a wall.', ['sitting', 'red silk']), 'Alice is sitting in a red silk dress before a wall.');
  assert.throws(() => parseStudioPolish('Alice stands in a blue silk dress before a wall.', ['sitting', 'red silk']), /遗漏.*tag/);
});

test('polish material contains clothing overrides and protected tags outside the stable prefix', () => {
  const request = buildStudioPolishRequest({ systemRules: 'rules', personas: ['short persona'],
    prompt: 'Character 1 — Outfit: Replace default clothes.\nClothing tags: (striped_shirt)', requiredTags: ['striped_shirt', 'arms_up'] });
  assert.match(request.messages.at(-2).content, /Clothing tags: \(striped_shirt\)/);
  assert.match(request.messages.at(-2).content, /必须逐字保留的 tag.*\nstriped_shirt\narms_up/s);
  assert.match(STUDIO_POLISH_RULES, /用户额外指定.*>.*>.*默认服装/);
  assert.match(STUDIO_POLISH_RULES, /删除原服装中冲突的衣物/);
});

test('tag bundles allow reordering and prose clauses are not mistaken for verbatim pose tags', () => {
  const clothing = splitStudioTags('striped_shirt, blue skirt, (long sleeves:1.2)');
  const pose = studioPoseTags('the chin lifted and both hands resting near the shoulders with the elbows out, low camera looking upward, upper-body view, arms_up, sitting, hands on hips, (leaning back:1.2)');
  assert.deepEqual(clothing, ['striped_shirt', 'blue skirt', '(long sleeves:1.2)']);
  assert.deepEqual(pose, ['upper-body view', 'arms_up', 'sitting', 'hands on hips', '(leaning back:1.2)']);
  const output = 'Sitting in a blue skirt and striped_shirt with (long sleeves:1.2), Alice rests under soft light.';
  assert.equal(parseStudioPolish(output, [...clothing, 'sitting']), output);
  assert.equal(parseStudioPolish('Alice is sitting in a red\nsilk dress beside the window.', ['red silk']), 'Alice is sitting in a red silk dress beside the window.');
});

test('a genuinely missing tag gets one corrective request with the same prefix and sole final user', async () => {
  const calls = [];
  const input = { prompt: 'A studio portrait, upper-body view.', requiredTags: ['upper-body view'], context: { systemRules: 'rules', model: 'test' } };
  const corrected = 'Alice wears a blue dress, upper-body view in soft light.';
  assert.equal(await polishStudioPrompt(input, { chat: async (messages, options) => {
    calls.push({ messages, options });
    return calls.length === 1 ? 'Alice wears a blue dress in soft light.' : corrected;
  } }), corrected);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].messages.slice(0, -1), calls[1].messages.slice(0, -1));
  assert.equal(calls[1].messages.filter(message => message.role === 'user').length, 1);
  assert.match(calls[1].messages.at(-1).content, /上次结果遗漏.*\nupper-body view/s);
  let attempts = 0;
  await assert.rejects(polishStudioPrompt(input, { chat: async () => { attempts++; return 'Alice wears a blue dress in soft light.'; } }), { code: 'STUDIO_MISSING_TAGS' });
  assert.equal(attempts, 2, 'failed repair must not loop or return an invalid prompt');
  attempts = 0;
  await assert.rejects(polishStudioPrompt(input, { chat: async () => { attempts++; throw new Error('offline'); } }), /offline/);
  assert.equal(attempts, 1, 'network failures are not tag corrections');
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
