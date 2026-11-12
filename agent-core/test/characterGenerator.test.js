import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stub = source => `data:text/javascript,${encodeURIComponent(source)}`;
const fixture = stub(`
  export const state = { calls: [], searches: [], result: '', exists: false, rules: '世界规则' };
  export const config = { llm: { model: 'fixture-model' } };
  export const getDb = () => ({ prepare: () => ({ get: () => state.exists ? { id: 1 } : undefined }) });
  export const getSystemRulesWithWorld = () => state.rules;
  export const chatSync = async (messages, options) => { state.calls.push({ messages, options }); return state.result; };
  export const searchCharacterReference = async description => { state.searches.push(description); return { text: '网络资料'.repeat(160), referenceImage: 'data:image/png;base64,cG9ydHJhaXQ=' }; };
`);
const { state } = await import(fixture);
const source = readFileSync(new URL('../src/services/characterGenerator.js', import.meta.url), 'utf8')
  .replace(/from '[^']+'/g, `from ${JSON.stringify(fixture)}`);
const { runPersonaGeneration } = await import(stub(source));
const persona = '你是天使。\n## 你的身份\n你是云庭信使。\n## 你的性格\n' + '你认真而好奇，喜欢核对每封信的收件人。'.repeat(8) + '\n## 你的好恶\n你喜欢星图。\n## 你的外观\n你有白羽和光环。';

test('shared generator keeps reference data outside the stable prefix and parses the standard persona', async t => {
  t.mock.method(console, 'log', () => {});
  state.calls.length = 0;
  state.searches.length = 0;
  state.result = `天使\nAngel\n{"valence":0.6,"arousal":0.4,"dominance":0.5}\n${persona}`;
  const signal = new AbortController().signal;
  const result = await runPersonaGeneration({ description: ' 天使 ', extraContext: '独有身份资料',
    extraContextLabel: '天使身份约束', skipWebSearch: true, label: '创造角色:天使', signal, retries: 0, maxRetries: 0, timeout: 120000 });
  assert.equal(result.basePrompt, persona);
  assert.equal(result.displayName, '天使');
  assert.equal(result.charName, 'angel');
  assert.equal(JSON.parse(result.emotionBaseline).valence, 0.6);
  assert.equal(state.searches.length, 0);
  const { messages, options } = state.calls[0];
  assert.deepEqual(messages.map(m => m.role), ['system', 'system', 'user']);
  assert.equal(messages.at(-1).content, '天使');
  assert.match(messages[1].content, /独有身份资料/);
  assert.ok(!options.lorebook.staticTexts.join('').includes('独有身份资料'));
  assert.equal(messages[1].content.slice(0, options.lorebook.cacheBoundary.offset), options.lorebook.staticTexts[0]);
  assert.equal(options.lorebook.cacheBoundary.index, 1);
  assert.deepEqual(options.lorebook.history, [{ role: 'user', content: '天使' }]);
  assert.equal(options.signal, signal);
  assert.equal(options.label, '创造角色:天使');
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, 120000);
});

test('ordinary character generation retains web references, name deduplication and incomplete-output rejection', async t => {
  t.mock.method(console, 'log', () => {});
  state.result = `天使\nAngel\n{"valence":0.6,"arousal":0.4,"dominance":0.5}\n${persona}`;
  state.exists = true;
  state.rules = '';
  state.searches.length = 0;
  const result = await runPersonaGeneration({ description: '某作品角色' });
  assert.deepEqual(state.searches, ['某作品角色']);
  assert.equal(result.searchFound, true);
  assert.equal(result.referenceImage, 'data:image/png;base64,cG9ydHJhaXQ=');
  assert.match(result.charName, /^angel_\d+$/);
  const { messages, options } = state.calls.at(-1);
  assert.deepEqual(messages.map(m => m.role), ['system', 'user']);
  assert.equal(options.label, '创造角色');
  assert.equal(options.lorebook.cacheBoundary.index, 0);
  assert.ok(!options.lorebook.staticTexts[0].includes('网络资料'));
  assert.ok(!JSON.stringify(messages).includes('data:image'));
  state.result = '天使\nAngel\n{}\n内容太短';
  await assert.rejects(runPersonaGeneration({ description: '天使', skipWebSearch: true }), /人格不完整/);
});

test('cached search and imported cards do not repeat the image scrape', async () => {
  state.result = `天使\nAngel\n{}\n${persona}`;
  state.searches.length = 0;
  const result = await runPersonaGeneration({ description: '天使', cachedSearchContext: '缓存资料'.repeat(160) });
  assert.equal(result.referenceImage, '');
  assert.equal(state.searches.length, 0);
  const imported = await runPersonaGeneration({ description: '天使', skipWebSearch: true });
  assert.equal(imported.referenceImage, '');
});
