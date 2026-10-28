import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechServiceRestarter } from '../src/services/speechServiceProcess.js';

const ready = { online: true, compatible: true, ready: true };
const options = { platform: 'win32', env: {}, exclusive: work => work(), sleep: async () => {} };

test('offline restart waits for the GPU slot, deduplicates requests and checks the new service', async () => {
  let release, calls = 0, checks = 0;
  const slot = new Promise(resolve => { release = resolve; });
  const restart = createSpeechServiceRestarter({ ...options,
    env: { TTS_SERVICE_URL: 'http://localhost:7862', TTS_RUNTIME_DIR: 'D:/custom tts/runtime' },
    exclusive: async work => { await slot; return work(); },
    run: async (file, args, config) => {
      calls++;
      assert.equal(file, 'powershell.exe');
      assert.equal(args.at(-1), '7862');
      assert.equal(args.includes('-RuntimeDir'), false, 'legacy external paths must not redirect deployment');
      assert.match(args[args.indexOf('-File') + 1], /tts-service[\\/]restart.ps1$/);
      assert.equal(config.windowsHide, true);
      assert.equal(args[args.indexOf('-ModelVersion') + 1], '2.0');
    }, model: () => '2.0', health: async () => ++checks === 1 ? { online: false } : ready });
  const first = restart(), second = restart();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 0);
  release(); assert.deepEqual(await first, ready);
  assert.equal(calls, 1); assert.equal(checks, 2);
});

test('remote endpoints and unsupported hosts never launch or stop local processes', async () => {
  for (const url of ['http://example.com:7861', 'https://localhost:7861', 'http://localhost:7861/api', 'http://user:pass@localhost:7861']) {
    const restart = createSpeechServiceRestarter({ ...options, env: { TTS_SERVICE_URL: url }, run: () => assert.fail('must not execute') });
    await assert.rejects(restart(), /仅支持本机/);
  }
  await assert.rejects(createSpeechServiceRestarter({ ...options, platform: 'linux' })(), /Windows/);
});

test('launch failure surfaces diagnostics and permits a later retry', async () => {
  let calls = 0;
  const restart = createSpeechServiceRestarter({ ...options, health: async () => ready,
    run: async () => { if (++calls === 1) throw Object.assign(new Error('exit 1'), { stderr: 'runtime missing' }); } });
  await assert.rejects(restart(), /runtime missing/);
  assert.deepEqual(await restart(), ready);
});

test('an online service with missing models is returned honestly; unreachable startup is bounded', async () => {
  const status = { online: true, compatible: true, ready: false, error: '模型不完整' };
  assert.deepEqual(await createSpeechServiceRestarter({ ...options, run: async () => {}, health: async () => status })(), status);
  let checks = 0;
  await assert.rejects(createSpeechServiceRestarter({ ...options, run: async () => {},
    health: async () => { checks++; return { online: false }; } })(), /仍无法连接/);
  assert.equal(checks, 20);
});
