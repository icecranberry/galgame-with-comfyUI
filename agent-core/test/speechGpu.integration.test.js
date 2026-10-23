import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Explicit opt-in: real local GPU, installed guard/API, and three reference WAVs.
// Never touches the user's database or changes their character bindings.
test('real TTS: voices, cache, long text, idle unload and Anima GPU handoff', {
  skip: process.env.RUN_TTS_GPU_TESTS !== '1', timeout: 1800000,
}, async t => {
  process.env.DB_PATH = ':memory:';
  const { getDb, closeDb } = await import('../src/db/index.js');
  const { config } = await import('../src/config.js');
  const service = await import('../src/services/speechService.js');
  const assets = await import('../src/services/voiceAssets.js');
  const gpu = await import('../src/services/speechGpu.js');
  const { ttsHealth } = await import('../src/services/indexTtsClient.js');
  const exec = promisify(execFile), files = new Set(), report = { cases: [], gpu_total_peak_mib: 0 };
  const comfy = config.comfyui.url.replace(/\/+$/, '');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function memory() {
    const { stdout } = await exec('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true });
    return Number(stdout.trim().split(/\r?\n/)[0]);
  }
  let measuring = false;
  const sampler = setInterval(async () => {
    if (measuring) return;
    measuring = true;
    try { report.gpu_total_peak_mib = Math.max(report.gpu_total_peak_mib, await memory()); } catch { /* diagnostic only */ }
    finally { measuring = false; }
  }, 1000);
  const db = getDb();
  t.after(async () => {
    clearInterval(sampler);
    try { await gpu.recoverSpeechGpu(); report.final_health = await ttsHealth(); report.gpu_after_unload_mib = await memory(); }
    finally {
      for (const row of db.prepare('SELECT id FROM speech_jobs').all()) {
        files.add(`generated/${row.id}.wav`); files.add(`generated/${row.id}.partial.wav`);
      }
      await Promise.all([...files].map(file => fs.rm(assets.audioPath(file), { force: true })));
      closeDb();
      if (process.env.TTS_TEST_REPORT) await fs.writeFile(process.env.TTS_TEST_REPORT, JSON.stringify(report, null, 2));
    }
  });
  const health = await ttsHealth();
  assert.ok(health.online && health.ready && health.compatible, JSON.stringify(health));
  await gpu.recoverSpeechGpu();
  report.gpu_baseline_mib = await memory();
  const refs = JSON.parse(process.env.TTS_TEST_REFERENCES || '[]');
  assert.equal(refs.length, 3, 'TTS_TEST_REFERENCES must contain three local WAV paths');
  const characters = [];
  for (const [i, file] of refs.entries()) {
    const original = await assets.importAudio(await fs.readFile(file));
    files.add(original.original_path); files.add(original.preview_path);
    const sample = await assets.cropAudio(original, 0, Math.min(12, original.duration));
    files.add(sample.reference_path);
    db.prepare(`INSERT INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration)
      VALUES(?,?,?,?,?,?)`).run(sample.id, sample.original_path, sample.preview_path, sample.reference_path, sample.content_hash, sample.duration);
    db.prepare('INSERT INTO voices(id,name,sample_id) VALUES(?,?,?)').run(`gpu-voice-${i}`, `GPU fixture ${i}`, sample.id);
    const id = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt) VALUES(?,?,?)').run(`gpu-test-${i}`, `GPU fixture ${i}`, 'test').lastInsertRowid);
    db.prepare('UPDATE voices SET character_id=? WHERE id=?').run(id, `gpu-voice-${i}`);
    db.prepare('INSERT INTO character_voices(character_id,voice_id) VALUES(?,?)').run(id, `gpu-voice-${i}`);
    characters.push(id);
  }
  service.setSpeechSettings(true);
  async function terminal(job, label) {
    const start = Date.now();
    for (;;) {
      const result = service.getSpeechJob(job.id);
      if (!['queued', 'generating'].includes(result.status)) {
        const row = { label, status: result.status, error: result.error, seconds: (Date.now() - start) / 1000 };
        report.cases.push(row); t.diagnostic(JSON.stringify(row));
        assert.equal(result.status, 'completed', result.error || label);
        const bytes = await fs.readFile(assets.audioPath(result.output_path));
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.ok(bytes.length > 1000);
        return result;
      }
      assert.ok(Date.now() - start < 660000, `${label} timed out`);
      await delay(200);
    }
  }
  for (const [i, id] of characters.entries()) {
    const message = Number(db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,'assistant',?)").run(`char_${id}`, '今天的天气很好。等忙完手里的事情，我们一起去街角走走吧。').lastInsertRowid);
    const job = service.speakMessage(id, message);
    const result = await terminal(job, i === 0 ? 'cold' : `voice-switch-${i}`);
    assert.equal(result.voice_id, `gpu-voice-${i}`);
    assert.equal(service.speakMessage(id, message).id, job.id, 'repeat must reuse cached job');
    assert.throws(() => service.speakMessage(characters[(i + 1) % 3], message), /不属于/);
  }
  const longText = '清晨的小镇渐渐醒来。阳光照在窗台上，街角的咖啡馆飘来香气。我整理好桌上的书，准备出门散步，看看今天会遇到怎样有趣的事情。'.repeat(20).slice(0, 1000);
  assert.equal(longText.length, 1000);
  await terminal(service.requestSpeech({ characterId: characters[0], voiceId: 'gpu-voice-0', text: longText }), '1000-characters');
  assert.throws(() => service.requestSpeech({ characterId: characters[0], voiceId: 'gpu-voice-0', text: longText + '字' }), /1000/);
  const invalidPrompt = () => fetch(`${comfy}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: {} }) });
  assert.equal((await invalidPrompt()).status, 423, 'lease must reject external image submissions');
  await delay(10 * 60 * 1000 + 2500);
  assert.equal((await ttsHealth()).worker_alive, false, 'idle timeout must terminate the real worker');
  assert.notEqual((await invalidPrompt()).status, 423, 'idle timeout must release ComfyUI');
  report.cases.push({ label: 'idle-unload-and-external-prompt-guard', status: 'passed' });

  // Small real Anima image exercises the same model loading/offloading path.
  const workflow = JSON.parse(await fs.readFile(process.env.TTS_TEST_IMAGE_WORKFLOW, 'utf8'));
  const samplerNode = Object.values(workflow).find(node => node.class_type === 'KSampler');
  assert.ok(samplerNode, 'image fixture must contain a KSampler');
  const submitImage = async () => {
    const response = await fetch(`${comfy}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.prompt_id;
  };
  const imageDone = async id => {
    const start = Date.now();
    for (;;) {
      const history = await (await fetch(`${comfy}/history/${id}`)).json();
      if (history[id]) { assert.equal(history[id].status.status_str, 'success', JSON.stringify(history[id].status)); return; }
      assert.ok(Date.now() - start < 300000, 'Anima timed out'); await delay(300);
    }
  };
  const imageId = await submitImage();
  // Wait for the external job to enter the actual execution queue.
  for (let i = 0; i < 100; i++) {
    const q = await (await fetch(`${comfy}/queue`)).json();
    if (q.queue_running.some(item => item[1] === imageId)) break;
    assert.ok(i < 99, 'Anima did not start'); await delay(100);
  }
  const pending = service.requestSpeech({ characterId: characters[1], voiceId: 'gpu-voice-1', text: '图片已经画好了，现在轮到我说话。' });
  await delay(500);
  assert.equal(service.getSpeechJob(pending.id).status, 'queued', 'TTS must wait for the running external image');
  assert.equal((await ttsHealth()).worker_alive, false, 'TTS must not load over the running image');
  await imageDone(imageId);
  await terminal(pending, 'external-image-to-speech');
  assert.equal((await invalidPrompt()).status, 423);
  const start = Date.now();
  await gpu.withImageGpu(async () => {
    assert.equal((await ttsHealth()).worker_alive, false, 'image must start only after worker exit');
    samplerNode.inputs.seed++;
    await imageDone(await submitImage());
  });
  report.cases.push({ label: 'speech-to-image', status: 'passed', seconds: (Date.now() - start) / 1000 });
  t.diagnostic(JSON.stringify(report));
});
