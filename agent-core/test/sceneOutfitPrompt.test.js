import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneOutfitMessages, normalizeDesignScenes, parseSceneOutfitDesign } from '../src/services/sceneOutfitPrompt.js';

const context = { systemRules: '固定系统规则与世界观', worldRule: '固定世界观强化', persona: '人物甲的人设', displayName: '甲', baseAppearance: 'Existing appearance, unchanged.' };

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
