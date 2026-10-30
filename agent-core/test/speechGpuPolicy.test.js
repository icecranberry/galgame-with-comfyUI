import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalGpuUrl, readSpeechGpuMemory, speechGpuPolicy } from '../src/services/speechGpuPolicy.js';

const local = { env: {}, comfyUrl: 'http://127.0.0.1:8188' };
test('auto admission uses free memory, a cold-model budget and inference headroom', async () => {
  for (const [free, loaded, shared] of [[8192, false, true], [8191, false, false], [2048, true, true], [2047, true, false], [null, false, false]]) {
    assert.deepEqual(await speechGpuPolicy({ loaded }, { ...local, memory: async () => free }), { shared, guard: true });
  }
  assert.equal((await speechGpuPolicy({}, { ...local, env: { TTS_GPU_BUDGET_MB: '4096', TTS_GPU_RESERVE_MB: '1024' }, memory: async () => 5120 })).shared, true);
  assert.equal((await speechGpuPolicy({}, { ...local, env: { TTS_GPU_BUDGET_MB: '-1', TTS_GPU_RESERVE_MB: 'bad' }, memory: async () => 8191 })).shared, false);
});

test('remote image servers are independent; explicit exclusive mode preserves old guard behavior', async () => {
  const remote = { env: {}, comfyUrl: 'https://images.example:8188', memory: () => assert.fail('no local probe needed') };
  assert.deepEqual(await speechGpuPolicy({}, remote), { shared: true, guard: false });
  assert.deepEqual(await speechGpuPolicy({}, { ...remote, env: { TTS_GPU_MODE: 'exclusive' } }), { shared: false, guard: true });
  assert.equal(isLocalGpuUrl('http://localhost:8188'), true);
  assert.equal(isLocalGpuUrl('http://[::1]:8188'), true);
  assert.equal(isLocalGpuUrl('http://127.0.0.2:8188'), true);
  assert.equal(isLocalGpuUrl(remote.comfyUrl), false);
});

test('GPU probe never sums cards or guesses an ambiguous CUDA device', async () => {
  const run = async () => ({ stdout: '0, GPU-zero, 9000\n1, GPU-one, 2000\n' });
  assert.equal(await readSpeechGpuMemory({}, run), null);
  assert.equal(await readSpeechGpuMemory({ CUDA_VISIBLE_DEVICES: '1,0' }, run), 2000);
  assert.equal(await readSpeechGpuMemory({ CUDA_VISIBLE_DEVICES: 'GPU-zero' }, run), 9000);
  assert.equal(await readSpeechGpuMemory({ CUDA_VISIBLE_DEVICES: '-1' }, run), null);
  assert.equal(await readSpeechGpuMemory({}, async () => ({ stdout: '0, GPU-zero, 5300\n' })), 5300);
  assert.equal(await readSpeechGpuMemory({}, async () => ({ stdout: '0, GPU-zero, N/A\n' })), null);
  assert.equal(await readSpeechGpuMemory({}, async () => { throw new Error('unavailable'); }), null);
});
