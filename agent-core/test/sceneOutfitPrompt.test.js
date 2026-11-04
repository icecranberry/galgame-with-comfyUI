import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneOutfitMessages, buildSceneOutfitRequest, normalizeDesignScenes, parseSceneOutfitDesign } from '../src/services/sceneOutfitPrompt.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';

const context = { systemRules: '固定系统规则与世界观', worldRule: '固定世界观强化', persona: '人物甲的人设', displayName: '甲', baseAppearance: 'Existing appearance, unchanged.' };

test('世界书保留角色和世界观边界，动态要求只影响尾部', () => {
  const world = '<world_setting>海岛世界</world_setting>';
  const book = normalizeBook({ entries: {
    0: { uid: 0, constant: true, position: 0, content: 'BEFORE_PERSONA' },
    1: { uid: 1, constant: false, key: ['橙色'], position: 4, depth: 0, content: 'DYNAMIC_OUTFIT' },
  } }).document;
  const request = buildSceneOutfitRequest({ ...context, systemRules: world, instruction: '改成橙色', scenes: ['casual'] });
  const options = { ...request.lorebook, worldText: world, cachePlacement: true };
  assert.deepEqual(applyLorebookLayout(request.messages, { entries: [] }, options).messages, request.messages);
  const result = applyLorebookLayout(request.messages, evaluateBook(book, {}, { history: request.lorebook.history }), options);
  assert.deepEqual(result.messages.map(m => m.role), request.messages.map(m => m.role));
  const joined = result.messages.map(m => m.content).join('\n');
  assert.ok(joined.indexOf('BEFORE_PERSONA') < joined.indexOf('【本次角色人设】'));
  assert.ok(joined.indexOf('DYNAMIC_OUTFIT') > joined.indexOf('【默认外观'));
  assert.ok(result.placements.length >= 2);
});

test('修改要求和已有槽位只进入动态尾部，世界书锚点来自实际消息', () => {
  for (const worldRule of ['', context.worldRule]) {
    const first = buildSceneOutfitRequest({ ...context, worldRule, scenes: ['casual'] });
    const second = buildSceneOutfitRequest({ ...context, worldRule, scenes: ['casual'], instruction: '把私服改成橙色',
      currentOutfits: [{ scene: 'casual', name: '旧私服', description: 'Old casual.' }, { scene: 'sleep', name: '睡衣', description: 'Do not include.' }] });
    const boundary = first.lorebook.cacheBoundary;
    assert.deepEqual(first.messages.slice(0, boundary.index + 1), second.messages.slice(0, boundary.index + 1));
    assert.deepEqual(second.lorebook.personaTexts, [second.messages[boundary.index].content]);
    assert.equal(boundary.offset, first.messages[boundary.index].content.length);
    assert.deepEqual(second.lorebook.staticTexts, second.messages.slice(0, boundary.index).map(m => m.content));
    assert.match(second.messages.at(-2).content, /Old casual/);
    assert.doesNotMatch(JSON.stringify(second.messages), /Do not include/);
    assert.match(second.messages.at(-1).content, /把私服改成橙色/);
    assert.equal(second.messages.filter(m => m.role === 'user').length, 1);
    assert.deepEqual(second.lorebook.history, second.messages.slice(boundary.index + 1));
  }
});

test('short_prompt 加入角色资料，保持静态前缀与默认外观不变；空值省略', () => {
  const baseline = buildSceneOutfitMessages(context);
  const messages = buildSceneOutfitMessages({ ...context, shortPrompt: '  优雅的裁衣师，偏好金色纹饰。  ' });
  assert.deepEqual(messages.slice(0, 3), baseline.slice(0, 3));
  assert.match(messages[3].content, /人物甲的人设/);
  assert.ok(messages[3].content.endsWith('【角色简述（short_prompt）】\n优雅的裁衣师，偏好金色纹饰。'));
  assert.deepEqual(messages.slice(4), baseline.slice(4));
  for (const shortPrompt of [undefined, null, '', '  ']) {
    assert.deepEqual(buildSceneOutfitMessages({ ...context, shortPrompt }), baseline);
  }
});

test('角色和目标场景改变时静态前缀逐字节稳定，变量在后，user 仅收尾', () => {
  const first = buildSceneOutfitMessages(context);
  const second = buildSceneOutfitMessages({ ...context, persona: '人物乙的人设', displayName: '乙', baseAppearance: 'Other appearance.', scenes: ['sleep'] });
  assert.deepEqual(first.slice(0, 3), second.slice(0, 3));
  assert.match(first[3].content, /人物甲的人设/);
  assert.match(first[4].content, /Existing appearance, unchanged\./);
  assert.equal(first.at(-1).role, 'user');
  assert.equal(second.at(-1).content, '请设计 sleep，严格按规定 JSON 输出，仅包含这些场景。');
  // 静态提示中的完整 JSON 示例本身必须可解析，且只含三套。
  const example = JSON.parse(first[2].content.match(/\{"outfits":.*\}/)[0]);
  assert.deepEqual(example.outfits.map(o => o.scene), ['casual', 'home', 'sleep']);
  const identityAndBody = 'Cyrene (Honkai: Star Rail) has soft pastel pink hair in a fluffy shoulder-length bob with small white horn-like accessories, bright blue eyes, wearing ';
  assert.ok(example.outfits.every(o => o.description.startsWith(identityAndBody)));
  assert.match(example.outfits.find(o => o.scene === 'sleep').description, /barefoot/);
});

test('无世界观省略强化层；必须提供默认外观，禁止请求重新生成 work', () => {
  const messages = buildSceneOutfitMessages({ ...context, worldRule: '' });
  assert.equal(messages.length, 5);
  assert.throws(() => buildSceneOutfitMessages({ ...context, baseAppearance: ' ' }), /缺少默认外观/);
  assert.throws(() => normalizeDesignScenes(['work', 'casual']), /默认外观不可重新生成/);
  assert.throws(() => normalizeDesignScenes([]), /只支持设计/);
});

test('模型额外返回 work 时过滤掉，完整保留超过旧 300 字符上限的自然语言', () => {
  const description = 'Wearing a softly fitted cotton dress with delicate embroidery. '.repeat(8).trim();
  const raw = JSON.stringify({ outfits: ['work', 'casual', 'home', 'sleep'].map(scene => ({ scene, name: '衣服', description })) });
  const result = parseSceneOutfitDesign(raw);
  assert.deepEqual(result.map(o => o.scene), ['casual', 'home', 'sleep']);
  assert.equal(result[0].description, description);
  assert.deepEqual(parseSceneOutfitDesign(raw, ['sleep']).map(o => o.scene), ['sleep']);
});

test('缺失、重复或空描述报错，不用通用兜底覆盖角色原来的服装', () => {
  const row = { scene: 'casual', name: '私服', description: 'Wearing a cotton dress.' };
  assert.throws(() => parseSceneOutfitDesign(JSON.stringify({ outfits: [row] })), /不完整/);
  assert.throws(() => parseSceneOutfitDesign(JSON.stringify({ outfits: [row, row] }), ['casual']), /重复/);
  assert.throws(() => parseSceneOutfitDesign(JSON.stringify({ outfits: [{ ...row, description: '' }] }), ['casual']), /不完整/);
});
