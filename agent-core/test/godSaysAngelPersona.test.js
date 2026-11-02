import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAngelPersonaRequest, parseAngelPersonaOutput, ANGEL_CREATION_IDENTITY, ANGEL_CREATION_RULES } from '../src/services/godSays/angelPersonaPrompt.js';
import { ANGEL_PERSONALITIES, personalityPrompt } from '../src/services/godSays/angelPersonalities.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';
import { getWorldIntegrationRule } from '../src/builtinRules.js';

const world = '<world_setting>世界由浮岛组成，居民以星砂记录往事。</world_setting>';
const environment = { stageRules: `稳定基础规则\n\n${world}`, hasWorld: true };
const persona = `你是天使。
## 你的身份
你来自浮岛之间的云庭，习惯从细微的情绪变化中理解心意。过往的离别使你格外珍惜承诺，却不常把旧事挂在嘴边。
## 你的性格
- 你语气轻柔，表达简洁。
- 你渴望安定，也尊重独立。
- 你外在沉静，内心却充满好奇。
- 你在失约时会显露出难得的固执。
## 你的好恶
你偏爱晨光与安静，排斥敷衍，害怕遗忘重要的约定。
## 你的外观
你有浅金长发与灰蓝眼睛，身形修长；穿白色长袍，背生洁白双翼，头顶柔光环。`;

test('angel creation separates world reinforcement, stable identity and dynamic choices with one final user', () => {
  const request = buildAngelPersonaRequest({ personalities: ['chunibyo', 'mesugaki'], custom: '  银色发饰  ' }, environment);
  const { messages, lorebook } = request;
  assert.equal(messages[0].content, environment.stageRules);
  assert.match(messages[1].content, /<world_integration[\s\S]*人格卡的身份经历/);
  assert.equal(messages[2].content, ANGEL_CREATION_RULES);
  assert.equal(messages[3].content, ANGEL_CREATION_IDENTITY);
  assert.match(messages[4].content, /中二[\s\S]*雌小鬼[\s\S]*【本次自定义要求】\n银色发饰$/);
  assert.equal(messages.filter(m => m.role === 'user').length, 1);
  assert.match(messages.at(-1).content, /严格遵循 <world_setting> 的设定/);
  const joined = messages.map(m => m.content).join('\n');
  assert.equal(joined.split('常驻云庭').length - 1, 1);
  assert.match(joined, /纯白色长袍[\s\S]*一双洁白羽翼、头顶光环/);
  assert.doesNotMatch(joined, /VAD|valence|arousal|dominance|第一手素材|第[1234]行|巡视云庭|封印之境/);
  assert.deepEqual(lorebook.personaTexts, [ANGEL_CREATION_IDENTITY]);
  assert.match(lorebook.history[0].content, /银色发饰/);
});

test('changing selections and custom input never changes the stable prefix, with or without world and stage layers', () => {
  for (const env of [environment, { stageRules: '基础规则', hasWorld: false }, {}]) {
    const first = buildAngelPersonaRequest({ personalities: ['gentle'] }, env);
    const second = buildAngelPersonaRequest({ personalities: ['sharp'], custom: '蓝色披帛' }, env);
    const { index, offset } = first.lorebook.cacheBoundary;
    assert.deepEqual(first.lorebook.cacheBoundary, second.lorebook.cacheBoundary);
    assert.deepEqual(first.messages.slice(0, index), second.messages.slice(0, index));
    assert.equal(first.messages[index].content.slice(0, offset), second.messages[index].content.slice(0, offset));
    assert.equal(offset, first.messages[index].content.length);
    assert.notEqual(first.messages[index + 1].content, second.messages[index + 1].content);
    assert.ok(!second.lorebook.staticTexts.some(text => text.includes('蓝色披帛')));
    if (!env.hasWorld) assert.doesNotMatch(first.messages.map(m => m.content).join('\n'), /world_integration|<world_setting>/);
  }
});

test('IP requests retain character identity and current angel duties without changing the stable prefix', () => {
  const original = buildAngelPersonaRequest({}, environment);
  const custom = '让琪亚娜（崩坏3）当天使，保留她原来的性格';
  for (const env of [environment, {}]) {
    const request = buildAngelPersonaRequest({ custom }, env);
    const text = request.messages.map(m => m.content).join('\n');
    assert.match(text, /保留原名、性别、标志性外貌/);
    assert.match(text, /你就是这个角色，也清楚自己现在担任天使/);
    assert.match(text, /默认身份不覆盖明确要求/);
    assert.match(text, /小习惯、闲暇兴趣/);
    assert.doesNotMatch(text, /不要借用现成 IP|一律作废/);
    assert.ok(request.lorebook.history[0].content.includes(custom));
    assert.ok(request.lorebook.staticTexts.every(value => !value.includes(custom)));
    if (env.hasWorld) {
      const boundary = request.lorebook.cacheBoundary.index;
      assert.deepEqual(request.messages.slice(0, boundary + 1), original.messages.slice(0, boundary + 1));
      assert.match(request.messages[1].content, /只对冲突的[\s\S]*作必要适配/);
    }
  }
  // 人格创建的新适配规则不改写其他业务的世界观口径。
  assert.match(getWorldIntegrationRule('interaction'), /一律作废/);
});

test('worldbook anchors locate actual creation identity/world and keep conditional lore in the dynamic tail', () => {
  const request = buildAngelPersonaRequest({ custom: '蓝色披帛' }, environment);
  const entries = [
    { position: 0 }, { position: 1 }, { position: 2 }, { position: 3 },
    { position: 4, depth: 0 }, { position: 4, depth: 0, constant: false, key: ['蓝色披帛'] },
    { position: 5 }, { position: 6 },
  ];
  const document = normalizeBook({ entries: Object.fromEntries(entries.map((entry, uid) => [uid, { uid, constant: true, content: `LORE_${uid}`, ...entry }])) }).document;
  const activation = evaluateBook(document, {}, { history: request.lorebook.history });
  const options = { ...request.lorebook, worldText: world, cachePlacement: true };
  const empty = applyLorebookLayout(request.messages, { entries: [] }, options);
  assert.deepEqual(empty.messages, request.messages);
  const result = applyLorebookLayout(request.messages, activation, options);
  assert.deepEqual(result.messages.map(m => m.role), request.messages.map(m => m.role));
  assert.match(result.messages[0].content, /LORE_2[\s\S]*世界由浮岛组成[\s\S]*LORE_3/);
  const stable = result.messages[request.lorebook.cacheBoundary.index].content;
  assert.match(stable, /LORE_0[\s\S]*【天使身份与形象基准】[\s\S]*LORE_1/);
  for (const id of [4, 6, 7]) assert.ok(stable.includes(`LORE_${id}`));
  assert.doesNotMatch(stable, /蓝色披帛|LORE_5/);
  assert.match(result.messages.at(-1).content, /LORE_5[\s\S]*请严格遵循/);
  assert.ok(result.placements.every(p => p.actualAnchor && Number.isInteger(p.index) && Number.isInteger(p.offset)));
});

test('personality hints describe traits without assigning concrete targets, places or routines', () => {
  const text = ANGEL_PERSONALITIES.map(p => p.hint).join('\n');
  assert.doesNotMatch(text, /你|吾神|云庭|封印之境|小太阳|别过脸|整理星图/);
  const prompt = personalityPrompt(['chunibyo', 'mesugaki']);
  assert.match(prompt, /中二：想象力旺盛/);
  assert.match(prompt, /雌小鬼：顽皮好胜/);
  assert.match(prompt, /不预设具体对象、经历或场景/);
});

test('angel output is the complete persona itself; no name prelude, baseline JSON or empty section is accepted', () => {
  assert.deepEqual(parseAngelPersonaOutput(`\n${persona}\n`), { displayName: '天使', charName: 'angel', basePrompt: persona });
  for (const opening of ['你是琪亚娜（Kiana Kaslana），来自《崩坏3》，现在担任天使。', '你是阿澈，现在担任天使。']) {
    const namedPersona = persona.replace('你是天使。', opening);
    // 业务槽位不随角色来源改变，完整人设保留角色真实姓名。
    assert.deepEqual(parseAngelPersonaOutput(namedPersona), { displayName: '天使', charName: 'angel', basePrompt: namedPersona });
  }
  for (const invalid of [null, '', '你是天使。', `天使\nAngel\n${persona}`, `天使\nAngel\n{"valence":0.5}\n${persona}`,
    `${persona}\n{"arousal":0.5}`, persona.replace('你是天使。', '你是天使。\n这是生成结果。'), persona.replace(/## 你的好恶[\s\S]*?## 你的外观/, '## 你的好恶\n## 你的外观'), `\`\`\`\n${persona}\n\`\`\``]) {
    assert.throws(() => parseAngelPersonaOutput(invalid), /未返回完整/);
  }
});
