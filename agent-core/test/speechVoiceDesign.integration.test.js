import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Explicitly opt in: uses the running local IndexTTS/ComfyUI GPU coordinator,
// but keeps character/settings/message data in an isolated in-memory database.
test('real IndexTTS clones designed built-in Chinese references without output adjustments', {
  skip: process.env.RUN_TTS_VOICE_DESIGN_TEST !== '1', timeout: 600000,
}, async t => {
  process.env.DB_PATH = ':memory:';
  const { getDb, closeDb } = await import('../src/db/index.js');
  const { default: express } = await import('express');
  const { default: router } = await import('../src/routes/tts.js');
  const { audioPath } = await import('../src/services/voiceAssets.js');
  const { getSpeechJob } = await import('../src/services/speechService.js');
  const { withImageGpu } = await import('../src/services/speechGpu.js');
  const { ttsHealth } = await import('../src/services/indexTtsClient.js');
  const health = await ttsHealth();
  assert.ok(health.online && health.ready && health.compatible, JSON.stringify(health));
  assert.equal(health.voice_effects_version, 2, 'restart the local speech service after updating');
  assert.equal(health.busy, false, 'wait for current synthesis to finish');

  const app = express(); app.use(express.json()); app.use('/api/tts', router);
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  const outputs = new Set();
  t.after(async () => {
    try { await withImageGpu(async () => {}); }
    finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); closeDb();
      // Only remove this test's UUID outputs; shared built-in references remain.
      await Promise.all([...outputs].map(file => fs.rm(audioPath(file), { force: true })));
    }
  });
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  const completed = async (job, label) => {
    const start = Date.now();
    while (['queued', 'generating'].includes(job.status)) {
      assert.ok(Date.now() - start < 420000, `${label} timed out`);
      await new Promise(resolve => setTimeout(resolve, 500));
      job = await api(`/jobs/${job.id}`);
    }
    assert.equal(job.status, 'completed', `${label}: ${job.error}`);
    const row = getSpeechJob(job.id); outputs.add(row.output_path);
    const file = await fs.readFile(audioPath(row.output_path));
    assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.ok(file.length > 24000);
    t.diagnostic(JSON.stringify({ label, seconds: (Date.now() - start) / 1000, bytes: file.length }));
    return row;
  };
  await api('/settings', { enabled: true, mode: 'local' }, 'PUT');
  const db = getDb();
  const character = Number(db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('voice-design-live','声音验证','test')").run().lastInsertRowid);
  const effects = { pitch: 1, resonance: -5, brightness: 1.5, thickness: 1, clarity: 2, air: 1.5 };
  for (const id of ['female', 'male']) {
    const sample = await api(`/builtin-voices/${id}/sample`, {});
    const voice = await api('/voices', { character_id: character, sample_id: sample.id, name: `中文参考${id}`, speed: 1.05, voice_effects: effects });
    assert.equal(voice.source, 'builtin');
    const text = '你好，今天我们一起去街角散步吧。';
    const row = await completed(await api('/preview', { character_id: character, voice_id: voice.id, text }), id);
    assert.deepEqual(JSON.parse(row.params).reference_design, { speed: 1.05, voice_effects: effects });
    assert.ok(Object.values(JSON.parse(row.params).voice_effects).every(value => value === 0));
    assert.equal(JSON.parse(row.params).speed, 1);
    assert.equal(JSON.parse(row.params).duration_factor, 1);
    assert.notEqual(voice.reference_url, voice.base_reference_url);
    assert.equal(row.sample_id, voice.sample_id);
    const cached = await api('/preview', { character_id: character, voice_id: voice.id, text });
    assert.equal(cached.id, row.id); assert.equal(cached.status, 'completed');
  }
});
