import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLocalSpeechModelManager } from '../src/services/speechLocalModels.js';
import { LOCAL_TTS_MODELS, localTtsModel } from '../src/services/localTtsModels.js';
import { speechCacheKey, speechParams, MODEL_VERSION } from '../src/services/speechText.js';

test('IndexTTS 2.0 is the only supported local engine and uses its pinned cache version', () => {
  assert.deepEqual(Object.keys(LOCAL_TTS_MODELS), ['2.0']);
  assert.equal(LOCAL_TTS_MODELS['2.0'].version, MODEL_VERSION);
  assert.equal(LOCAL_TTS_MODELS['2.0'].model_repo, 'IndexTeam/IndexTTS-2');
  assert.throws(() => localTtsModel('voxcpm-2.0'), /不支持/);
  assert.throws(() => localTtsModel('2.5'), /不支持/);
  assert.notEqual(speechCacheKey('你好', 'ref', speechParams()), speechCacheKey('你好', 'ref', speechParams(), 'retired-model'));
});
function fixture(overrides = {}) {
  const state = { mode: 'local', local_model: '2.0' }, children = [], commands = [], changes = [];
  const installed = { '2.0': false };
  const manager = createLocalSpeechModelManager({ platform: 'win32', env: {}, settings: () => ({ ...state }),
    configure: input => { changes.push(input.local_model); Object.assign(state, input); return { ...state }; },
    inspect: async () => Object.entries(installed).map(([id, value]) => ({ id, installed: value })),
    restart: async () => ({ online: true, ready: true, model_version: LOCAL_TTS_MODELS['2.0'].version }),
    launch: (file, args, config) => { commands.push({ file, args, config }); const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); children.push(child); return child; }, ...overrides });
  return { manager, state, installed, children, commands, changes };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('installation deduplicates requests, verifies completion and applies only the installed engine', async () => {
  const f = fixture();
  await assert.rejects(f.manager.use('2.0'), /先安装/); assert.deepEqual(f.changes, []);
  f.manager.install('2.0'); f.manager.install('2.0'); assert.equal(f.commands.length, 1);
  await assert.rejects(f.manager.use('2.0'), /等待/);
  const { args, config } = f.commands[0];
  assert.equal(args.at(-1), '2.0'); assert.equal(config.windowsHide, true); assert.equal(config.env.TTS_LOCAL_MODEL, '2.0');
  f.children[0].stdout.emit('data', 'download progress');
  assert.match((await f.manager.status()).installation.log, /download progress/);
  f.installed['2.0'] = true; f.children[0].emit('close', 0); await flush();
  assert.equal((await f.manager.status()).installation.status, 'completed');
  await f.manager.use('2.0'); assert.equal(f.state.local_model, '2.0');
});
test('download and startup failures remain retryable and clear busy state', async () => {
  let restarts = 0;
  const f = fixture({ restart: async () => { if (++restarts === 1) throw new Error('startup failed'); return { online: true, ready: true }; } });
  f.manager.install('2.0'); f.children[0].emit('close', 1); await flush();
  assert.equal((await f.manager.status()).installation.status, 'failed');
  f.manager.install('2.0'); f.installed['2.0'] = true; f.children[1].emit('close', 0); await flush();
  await assert.rejects(f.manager.use('2.0'), /startup failed/);
  assert.deepEqual(f.changes, ['2.0', '2.0']); assert.equal(restarts, 2); assert.equal((await f.manager.status()).using, null);
});
test('mismatched health is rejected and API mode cannot activate local inference', async () => {
  const f = fixture({ restart: async () => ({ online: true, ready: true, model_version: 'wrong' }) }); f.installed['2.0'] = true;
  await assert.rejects(f.manager.use('2.0'), /所选模型/);
  f.state.mode = 'api'; await assert.rejects(f.manager.use('2.0'), /本地语音模式/);
  for (const id of ['voxcpm-2.0', '2.5', 'bad']) assert.throws(() => f.manager.install(id), /不支持/);
});
