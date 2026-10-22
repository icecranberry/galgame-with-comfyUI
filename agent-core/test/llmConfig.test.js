import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { defaultMaxTokens, normalizeModelCapabilities, isValidMaxTokens } from '../src/llm/modelCapabilities.js';

test('official, known text models and unknown models get appropriate defaults', () => {
  assert.equal(defaultMaxTokens('https://api.deepseek.com/v1/', 'deepseek-flash'), 393216);
  assert.equal(defaultMaxTokens('https://api.deepseek.com.evil.invalid', 'other'), 8192);
  assert.equal(defaultMaxTokens('https://relay.invalid/v1', 'deepseek-v4.1-flash'), 32768);
  for (const model of ['gemini-2.5-pro', 'gemini-2.5-flash-lite', 'google/gemini-3.1-pro-preview']) {
    assert.equal(defaultMaxTokens('', model), 65536);
  }
  for (const model of ['gemini-2.0-flash', 'gemini-2.5-flash-image', 'gemini-3-live', 'unknown']) {
    assert.equal(defaultMaxTokens('', model), 8192);
  }
  for (const value of [0, -1, '', '65536', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(isValidMaxTokens(value), false);
});

test('model discovery preserves output limits, never mistakes input/context limits for output limits', () => {
  const caps = normalizeModelCapabilities([
    { id: 'deepseek-flash', max_output_tokens: 393216, context_window: 1048576 },
    { name: 'models/gemini-2.5-pro', outputTokenLimit: 65536, inputTokenLimit: 1048576 },
    { id: 'relay', top_provider: { max_completion_tokens: 32768 } },
    { id: 'unknown', context_length: 1000000 },
    { id: 'invalid', max_output_tokens: -1 },
    'bare-name', null,
  ]);
  assert.deepEqual({ ...caps }, {
    'deepseek-flash': { maxTokens: 393216 }, 'gemini-2.5-pro': { maxTokens: 65536 }, relay: { maxTokens: 32768 },
  });
});

const stub = source => `data:text/javascript,${encodeURIComponent(source)}`;
const settingsUrl = stub('export const values = new Map(); export const getSetting = key => values.get(key); export const setSetting = (key, value) => values.set(key, value);');
const fsUrl = stub("export let saved = ''; export default { existsSync: () => true, readFileSync: () => saved, writeFileSync: (_path, text) => { saved = text; } };");
const settings = await import(settingsUrl);
const memoryFs = await import(fsUrl);
const configUrl = new URL('../src/config.js', import.meta.url);
const imports = {
  dotenv: stub('export default { config() {} };'), fs: fsUrl,
  './db/settings.js': settingsUrl,
  './services/weatherSource.js': stub('export const notifyWeatherSourceChange = () => {};'),
  './services/novelaiClient.js': new URL('../src/services/novelaiClient.js', import.meta.url).href,
  './llm/modelCapabilities.js': new URL('../src/llm/modelCapabilities.js', import.meta.url).href,
  './llm/vertex-client.js': new URL('../src/llm/vertex-client.js', import.meta.url).href,
};
const source = "const fixtureEnv = {};\n" + readFileSync(configUrl, 'utf8')
  .replaceAll('process.env', 'fixtureEnv')
  .replace('fileURLToPath(import.meta.url)', JSON.stringify(fileURLToPath(configUrl)))
  .replace(/from '([^']+)'/g, (match, specifier) => imports[specifier] ? `from ${JSON.stringify(imports[specifier])}` : match);
const runtime = await import(stub(source));

test('NovelAI native protocol, proxy and normalized key persist and reload', async () => {
  runtime.updateComfyConfig({ novelaiApiFormat: 'native', novelaiProxyUrl: ' http://127.0.0.1:7890 ', novelaiUrl: 'https://relay.example/ai/generate-image/', novelaiApiKey: ' Bearer test-novelai-key ' });
  assert.equal(settings.values.get('novelai_api_format'), 'native');
  assert.equal(settings.values.get('novelai_proxy_url'), 'http://127.0.0.1:7890');
  assert.equal(runtime.getNovelaiApiKey(), 'test-novelai-key');
  const settingsSource = readFileSync(new URL('../src/db/settings.js', import.meta.url), 'utf8')
    .replace("'../config.js'", JSON.stringify(stub(source)));
  const { loadSystemSettings } = await import(stub(settingsSource));
  runtime.config.comfyui.novelaiApiFormat = 'relay';
  runtime.config.comfyui.novelaiProxyUrl = '';
  loadSystemSettings({ prepare: () => ({ all: () => [...settings.values].map(([setting_key, setting_value]) => ({ setting_key, setting_value })) }) });
  assert.equal(runtime.config.comfyui.novelaiApiFormat, 'native');
  assert.equal(runtime.config.comfyui.novelaiProxyUrl, 'http://127.0.0.1:7890');
  runtime.updateComfyConfig({ novelaiProxyUrl: '', clearNovelaiApiKey: true });
  assert.equal(settings.values.get('novelai_proxy_url'), '');
  assert.equal(runtime.getNovelaiApiKey(), '');
});

test('LLM save route forwards Vertex fields, returns only public config and rejects invalid JSON', () => {
  const routes = readFileSync(new URL('../src/routes/config.js', import.meta.url), 'utf8');
  const route = routes.slice(routes.indexOf("router.put('/llm',"), routes.indexOf('// PUT /api/config/llm/free-egg'));
  let handler, resets = 0, syncs = 0;
  new Function('router', 'updateLlmConfig', 'resetClient', 'config', 'PRESET_LLM_URLS', 'updateFeatureFlag', 'syncActiveLlmProfile', 'getLlmConfig', route)(
    { put(_path, fn) { handler = fn; } }, runtime.updateLlmConfig, () => resets++, runtime.config, [], () => {}, () => syncs++, runtime.getLlmConfig,
  );
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  handler({ body: { connectionType: 'vertexai', vertexRegion: 'global' } }, response);
  assert.equal(response.body.connectionType, 'vertexai');
  assert.equal(response.body.vertexServiceAccount, undefined);
  assert.equal(resets, 1);
  assert.equal(syncs, 1);
  handler({ body: { connectionType: 'openai', vertexServiceAccount: '{invalid' } }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(runtime.config.llm.connectionType, 'vertexai');
  assert.equal(resets, 1);
  assert.equal(syncs, 1);
  runtime.config.llm.connectionType = 'openai';
});

test('Vertex credentials persist privately, survive free mode and stay isolated across profiles', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = JSON.stringify({ type: 'service_account', project_id: 'test-project', client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const { config, getLlmConfig, getLlmProfiles, addLlmProfile, activateLlmProfile, updateLlmConfig, syncActiveLlmProfile, updateFreeEggEnabled } = runtime;
  const profile = addLlmProfile('vertex').profile;
  assert.equal(profile.vertexServiceAccount, undefined);
  activateLlmProfile(profile.id);
  assert.equal(updateLlmConfig({ connectionType: 'vertexai', vertexRegion: 'global', vertexServiceAccount: account, model: 'gemini-2.5-pro' }).ok, true);
  syncActiveLlmProfile();
  assert.equal(getLlmConfig().hasApiKey, true);
  assert.equal(getLlmConfig().hasVertexServiceAccount, true);
  assert.equal(config.llm.vertexServiceAccount, account);
  assert.equal(settings.values.get('llm_vertex_service_account'), account);
  for (const result of [getLlmConfig(), getLlmProfiles()]) assert.equal(JSON.stringify(result).includes('PRIVATE KEY'), false);
  const before = getLlmConfig();
  assert.equal(updateLlmConfig({ connectionType: 'openai', vertexServiceAccount: '{invalid' }).ok, false);
  assert.deepEqual(getLlmConfig(), before);
  assert.equal(updateLlmConfig({ connectionType: 'openai', headers: '{invalid' }).ok, false);
  assert.deepEqual(getLlmConfig(), before);
  updateLlmConfig({ vertexServiceAccount: '' });
  assert.equal(config.llm.vertexServiceAccount, account);
  updateFreeEggEnabled(true);
  assert.equal(config.llm.connectionType, 'openai');
  updateFreeEggEnabled(false);
  assert.equal(config.llm.connectionType, 'vertexai');
  settings.values.set('llm_profiles', JSON.stringify([...JSON.parse(settings.values.get('llm_profiles')), { id: 'legacy', name: 'legacy' }]));
  activateLlmProfile('legacy');
  assert.equal(config.llm.connectionType, 'openai');
  assert.equal(config.llm.vertexServiceAccount, '');
  activateLlmProfile(profile.id);
  assert.equal(config.llm.vertexServiceAccount, account);
  // Restore the initial fixture for the existing tests below.
  settings.values.clear();
  Object.assign(config.llm, { connectionType: 'openai', vertexServiceAccount: '', model: 'deepseek-flash', maxTokens: null });
});

test('MAX_tokens persists, round-trips profiles and survives free mode; invalid updates are rejected before mutation', () => {
  const { config, getLlmConfig, updateLlmConfig, addLlmProfile, activateLlmProfile, syncActiveLlmProfile, updateFreeEggEnabled } = runtime;
  assert.equal(getLlmConfig().maxTokens, 393216);
  assert.equal(getLlmConfig().thinkingMode, 'disabled');
  assert.equal(updateLlmConfig({ maxTokens: 65536, thinkingMode: 'enabled' }).ok, true);
  assert.match(memoryFs.saved, /LLM_MAX_TOKENS=65536/);
  assert.equal(getLlmConfig().maxTokens, 65536);
  const profile = addLlmProfile('manual').profile;
  assert.equal(profile.maxTokens, 65536);
  activateLlmProfile(profile.id);
  updateLlmConfig({ maxTokens: 12000 });
  syncActiveLlmProfile();
  updateLlmConfig({ maxTokens: 24000 });
  activateLlmProfile(profile.id);
  assert.equal(config.llm.maxTokens, 12000);
  assert.equal(config.llm.thinkingMode, 'enabled');
  updateFreeEggEnabled(true);
  assert.equal(config.llm.maxTokens, 8192);
  assert.equal(config.llm.thinkingMode, 'disabled');
  updateFreeEggEnabled(false);
  assert.equal(config.llm.maxTokens, 12000);
  assert.equal(config.llm.thinkingMode, 'enabled');
  const before = getLlmConfig();
  assert.equal(updateLlmConfig({ baseURL: 'https://wrong.invalid', maxTokens: -1 }).ok, false);
  assert.deepEqual(getLlmConfig(), before);
  settings.values.set('llm_profiles', JSON.stringify([{ id: 'legacy', name: 'old', baseURL: 'https://relay.invalid/v1', model: 'gemini-2.5-pro' }]));
  activateLlmProfile('legacy');
  assert.equal(getLlmConfig().maxTokens, 65536);
  assert.equal(getLlmConfig().thinkingMode, 'disabled');
  assert.match(memoryFs.saved, /LLM_MAX_TOKENS=65536/);
});

test('NovelAI profiles snapshot the current config, switch cleanly and follow later edits', () => {
  const { config, getNovelaiProfiles, getActiveNovelaiProfileId, addNovelaiProfile,
    activateNovelaiProfile, updateComfyConfig, deleteNovelaiProfile, getNovelaiApiKey } = runtime;
  settings.values.clear();
  updateComfyConfig({
    novelaiApiFormat: 'relay', novelaiUrl: 'https://relay-a.example', novelaiModel: 'nai-diffusion-4-5-full',
    novelaiArtist: '@aaa', novelaiWidth: 832, novelaiHeight: 1216, novelaiSteps: 20,
    novelaiQualityPrompt: 'quality a', novelaiNegativePrompt: 'negative a', novelaiApiKey: 'key-a',
  });
  // 首次读取自动用当前配置生成「默认配置」，界面永远有一套生效中的配置
  const initial = getNovelaiProfiles();
  assert.equal(initial.length, 1);
  assert.equal(initial[0].name, '默认配置');
  assert.equal(initial[0].hasApiKey, true);
  assert.equal(JSON.stringify(initial).includes('key-a'), false);
  const defaultId = getActiveNovelaiProfileId();
  assert.equal(defaultId, initial[0].id);

  // 新增配置＝复制当前这套（含密钥），名称与快照内容都独立
  const created = addNovelaiProfile('中转 B').profile;
  assert.equal(created.name, '中转 B');
  assert.equal(created.apiFormat, 'relay');
  assert.equal(created.url, 'https://relay-a.example');
  assert.equal(created.steps, 20);
  assert.equal(created.qualityPrompt, 'quality a');
  assert.equal(created.apiKey, undefined);
  assert.equal(created.hasApiKey, true);
  assert.equal(getNovelaiProfiles().length, 2);

  // 在 B 上改参数：自动回写 B，不影响 A
  assert.equal(activateNovelaiProfile(created.id).ok, true);
  assert.equal(getActiveNovelaiProfileId(), created.id);
  updateComfyConfig({ novelaiUrl: 'https://relay-b.example', novelaiModel: 'nai-diffusion-4-5-curated', novelaiSteps: 33, novelaiApiKey: 'key-b' });
  const afterEdit = getNovelaiProfiles().find(profile => profile.id === created.id);
  assert.equal(afterEdit.url, 'https://relay-b.example');
  assert.equal(afterEdit.model, 'nai-diffusion-4-5-curated');
  assert.equal(afterEdit.steps, 33);

  // 切回 A：整套参数与密钥一起还原，并写回持久化的单项设置
  activateNovelaiProfile(defaultId);
  assert.equal(config.comfyui.novelaiUrl, 'https://relay-a.example');
  assert.equal(config.comfyui.novelaiModel, 'nai-diffusion-4-5-full');
  assert.equal(config.comfyui.novelaiSteps, 20);
  assert.equal(config.comfyui.novelaiQualityPrompt, 'quality a');
  assert.equal(config.comfyui.novelaiArtist, '@aaa');
  assert.equal(getNovelaiApiKey(), 'key-a');
  assert.equal(settings.values.get('novelai_url'), 'https://relay-a.example');

  activateNovelaiProfile(created.id);
  assert.equal(config.comfyui.novelaiUrl, 'https://relay-b.example');
  assert.equal(getNovelaiApiKey(), 'key-b');

  // 删除守卫：不存在的配置报错；删掉激活配置后回落到剩下的那套；最后一套不可删
  assert.equal(deleteNovelaiProfile('missing').ok, false);
  assert.equal(deleteNovelaiProfile(created.id).ok, true);
  assert.equal(getNovelaiProfiles().length, 1);
  assert.equal(getActiveNovelaiProfileId(), defaultId);
  assert.equal(config.comfyui.novelaiUrl, 'https://relay-a.example');
  assert.equal(getNovelaiApiKey(), 'key-a');
  assert.equal(deleteNovelaiProfile(defaultId).ok, false);
  settings.values.clear();
});
