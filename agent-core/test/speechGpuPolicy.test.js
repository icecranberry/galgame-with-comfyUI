import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalAddress, isLocalGpuUrl, readSpeechGpuInfo, readSpeechGpuMemory, speechGpuPolicy } from '../src/services/speechGpuPolicy.js';

const local = { env: {}, comfyUrl: 'http://127.0.0.1:8188', serviceUrl: 'http://127.0.0.1:7861' };
const card = (free, total) => async () => ({ free, total, name: 'NVIDIA GeForce RTX 4090' });

test('both services local: a >=12 GiB card with room runs both models, everything else sequential', async () => {
  // An 8 GiB card never shares, even when completely idle.
  const small = await speechGpuPolicy({}, { ...local, memory: card(7000, 8192) });
  assert.equal(small.shared, false);
  assert.equal(small.lease, true);
  assert.equal(small.guard, true);
  // Exactly 12 GiB is enough; the cold model has to fit as well.
  assert.equal((await speechGpuPolicy({}, { ...local, memory: card(20000, 12288) })).shared, true);
  assert.equal((await speechGpuPolicy({}, { ...local, memory: card(20000, 12287) })).shared, false);
  const big = await speechGpuPolicy({}, { ...local, memory: card(20000, 24564) });
  assert.equal(big.shared, true);
  assert.equal(big.lease, false);
  assert.equal(big.info.name, 'NVIDIA GeForce RTX 4090');
  // A cold start needs the model budget; a warm worker only needs headroom.
  assert.equal((await speechGpuPolicy({}, { ...local, memory: card(3000, 24564) })).shared, false);
  assert.equal((await speechGpuPolicy({ loaded: true }, { ...local, memory: card(3000, 24564) })).shared, true);
  // Unreadable memory falls back to sequencing instead of guessing.
  assert.equal((await speechGpuPolicy({}, { ...local, memory: async () => null })).shared, false);
});

test('budgets stay configurable', async () => {
  const env = { TTS_GPU_SHARED_MIN_MB: '8192', TTS_GPU_BUDGET_MB: '4096', TTS_GPU_RESERVE_MB: '1024' };
  assert.equal((await speechGpuPolicy({}, { ...local, env, memory: card(5200, 8192) })).shared, true);
  assert.equal((await speechGpuPolicy({}, { ...local, env, memory: card(5000, 8192) })).shared, false);
  const fallback = { TTS_GPU_SHARED_MIN_MB: 'bad', TTS_GPU_BUDGET_MB: '-1', TTS_GPU_RESERVE_MB: '0' };
  assert.equal((await speechGpuPolicy({}, { ...local, env: fallback, memory: card(8000, 12288) })).shared, false);
  assert.equal((await speechGpuPolicy({}, { ...local, env: fallback, memory: card(8192, 12288) })).shared, true);
});

test('a remote side never probes the GPU and never asks for a lease', async () => {
  const noProbe = () => assert.fail('must not read GPU memory');
  // Remote ComfyUI + local TTS: an 8 GiB machine is fine.
  const remoteComfy = await speechGpuPolicy({}, { ...local, comfyUrl: 'https://images.example:8188', memory: noProbe });
  assert.deepEqual(
    { shared: remoteComfy.shared, guard: remoteComfy.guard, lease: remoteComfy.lease,
      local_image: remoteComfy.local_image, local_speech: remoteComfy.local_speech },
    { shared: true, guard: false, lease: false, local_image: false, local_speech: true },
  );
  // Local ComfyUI + remote TTS: this machine only renders images.
  const remoteSpeech = await speechGpuPolicy({}, { ...local, serviceUrl: 'http://10.0.0.9:7861', memory: noProbe });
  assert.equal(remoteSpeech.shared, true);
  assert.equal(remoteSpeech.guard, false);
  assert.equal(remoteSpeech.lease, false);
  assert.equal(remoteSpeech.local_speech, false);
  // Both remote: nothing to coordinate here either.
  const bothRemote = await speechGpuPolicy({}, { comfyUrl: 'http://10.0.0.8:8188', serviceUrl: 'http://10.0.0.9:7861', memory: noProbe });
  assert.equal(bothRemote.shared, true);
  assert.equal(bothRemote.guard, false);
});

test('explicit modes skip the probe and address detection is exact', async () => {
  const exclusive = await speechGpuPolicy({}, { ...local, env: { TTS_GPU_MODE: 'exclusive' }, memory: () => assert.fail('no probe') });
  assert.deepEqual({ shared: exclusive.shared, guard: exclusive.guard, lease: exclusive.lease }, { shared: false, guard: true, lease: true });
  const shared = await speechGpuPolicy({}, { ...local, env: { TTS_GPU_MODE: 'shared' }, memory: () => assert.fail('no probe') });
  assert.deepEqual({ shared: shared.shared, guard: shared.guard, lease: shared.lease }, { shared: true, guard: true, lease: false });
  assert.equal(isLocalGpuUrl('http://localhost:8188'), true);
  assert.equal(isLocalGpuUrl('http://[::1]:8188'), true);
  assert.equal(isLocalGpuUrl('http://127.0.0.2:8188'), true);
  assert.equal(isLocalGpuUrl('https://images.example:8188'), false);
  assert.equal(isLocalAddress('not a url'), false);
});

test('GPU probe reads free and total without summing cards or guessing a device', async () => {
  const multi = async () => ({ stdout: '0, GPU-zero, 9000, 16376, NVIDIA A\n1, GPU-one, 2000, 8192, NVIDIA B\n' });
  assert.equal(await readSpeechGpuInfo({}, multi), null);
  assert.deepEqual(await readSpeechGpuInfo({ CUDA_VISIBLE_DEVICES: '1,0' }, multi), { free: 2000, total: 8192, name: 'NVIDIA B' });
  assert.deepEqual(await readSpeechGpuInfo({ CUDA_VISIBLE_DEVICES: 'GPU-zero' }, multi), { free: 9000, total: 16376, name: 'NVIDIA A' });
  assert.equal(await readSpeechGpuInfo({ CUDA_VISIBLE_DEVICES: '-1' }, multi), null);
  const single = async () => ({ stdout: '0, GPU-zero, 5300, 8188, NVIDIA RTX 3060\n' });
  assert.deepEqual(await readSpeechGpuInfo({}, single), { free: 5300, total: 8188, name: 'NVIDIA RTX 3060' });
  assert.equal(await readSpeechGpuMemory({}, single), 5300);
  assert.equal(await readSpeechGpuInfo({}, async () => ({ stdout: '0, GPU-zero, N/A, N/A, X\n' })), null);
  assert.equal(await readSpeechGpuInfo({}, async () => { throw new Error('unavailable'); }), null);
});
