import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { speechParams, speechVoiceEffects, speechCacheKey, MODEL_VERSION, VOICE_EFFECT_DEFAULTS } from '../src/services/speechText.js';

test('voice design validates strict parameters and isolates all effects in the cache', () => {
  const baseline = speechParams();
  assert.deepEqual(baseline.voice_effects, VOICE_EFFECT_DEFAULTS);
  const key = speechCacheKey('你好', 'reference', baseline);
  for (const effects of [{ pitch: 2 }, { resonance: -10 }, { brightness: 3 }, { thickness: 2 }, { clarity: -2 }, { air: 3 }]) {
    assert.notEqual(speechCacheKey('你好', 'reference', speechParams({ voice_effects: effects })), key);
  }
  assert.equal(speechCacheKey('你好', 'reference', speechParams({ voice_effects: { brightness: 0, resonance: 0, pitch: 0 } })), key);
  assert.deepEqual(speechVoiceEffects('{"pitch":1}'), { ...VOICE_EFFECT_DEFAULTS, pitch: 1 });
  for (const input of [[], null, { pitch: true }, { pitch: '2' }, { pitch: NaN }, { resonance: 16 }, { brightness: -7 }, { thickness: 7 }, { clarity: NaN }, { air: true }, { unknown: 1 }]) {
    assert.throws(() => speechVoiceEffects(input));
  }
});

test('bundled voices, draft previews, saved playback, ownership and persistence use the same design', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linshe-voice-design-'));
  process.env.DB_PATH = path.join(dir, 'test.db'); process.env.TTS_AUDIO_DIR = path.join(dir, 'audio');
  const realFetch = globalThis.fetch, synthesis = [];
  let effectVersion = 2;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes(':7861')) {
      if (target.endsWith('/health')) return Response.json({ model_version: MODEL_VERSION, voice_effects_version: effectVersion, ready: true, loaded: true });
      if (target.endsWith('/unload')) return Response.json({ unloaded: true });
      if (target.endsWith('/synthesize')) {
        const body = JSON.parse(options.body); synthesis.push(body);
        await fs.mkdir(path.join(dir, 'audio/generated'), { recursive: true });
        await fs.writeFile(path.join(dir, 'audio', body.output), 'fixture-audio');
      }
      return Response.json({ ok: true });
    }
    if (target.includes('/linshe/gpu/') || target.endsWith('/object_info')) return Response.json({});
    return realFetch(url, options);
  };
  const { getDb, closeDb } = await import('../src/db/index.js');
  const { default: express } = await import('express');
  const { default: router } = await import('../src/routes/tts.js');
  const { getSpeechJob, setSpeechSettings } = await import('../src/services/speechService.js');
  const { recoverSpeechGpu } = await import('../src/services/speechGpu.js');
  const app = express(); app.use(express.json()); app.use('/api/tts', router);
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  t.after(async () => {
    await recoverSpeechGpu(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    closeDb(); globalThis.fetch = realFetch; await fs.rm(dir, { recursive: true, force: true });
  });
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST', status = 200) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  };
  const db = getDb();
  setSpeechSettings({ enabled: true, mode: 'local' });
  const character = Number(db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('voice-design','角色','test')").run().lastInsertRowid);
  const catalog = await api('/builtin-voices'); assert.deepEqual(new Set(catalog.map(v => v.id)), new Set(['female', 'male']));
  for (const entry of catalog) {
    const response = await fetch(base.replace('/api/tts', '') + entry.reference_url);
    assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 24000);
  }
  const sample = await api('/builtin-voices/female/sample', {}, 'POST', 201);
  const male = await api('/builtin-voices/male/sample', {}, 'POST', 201);
  assert.notEqual(sample.id, male.id);
  const duplicate = await api('/builtin-voices/female/sample', {}, 'POST', 201);
  assert.equal(sample.id, duplicate.id);
  const effects = { pitch: 1.5, resonance: -7, brightness: 2, thickness: 2, clarity: 1, air: 1.5 };
  const voice = await api('/voices', { character_id: character, sample_id: sample.id, name: '原创声音', speed: 1.1, voice_effects: effects }, 'POST', 201);
  assert.equal(voice.source, 'builtin');
  assert.notEqual(voice.sample_id, sample.id);
  assert.equal(voice.base_reference_url, sample.reference_url);
  assert.notEqual(voice.reference_url, sample.reference_url);
  const { decodeReferenceWav } = await import('../src/services/voiceReferenceDsp.js');
  const savedSample = db.prepare('SELECT * FROM voice_samples WHERE id=?').get(voice.sample_id);
  assert.equal(savedSample.base_sample_id, sample.id);
  const sourceData = await fs.readFile(path.join(dir, 'audio', db.prepare('SELECT reference_path FROM voice_samples WHERE id=?').get(sample.id).reference_path));
  const designedData = await fs.readFile(path.join(dir, 'audio', savedSample.reference_path));
  assert.notDeepEqual(designedData, sourceData);
  const decoded = decodeReferenceWav(designedData);
  assert.ok(Math.abs(decoded.samples.length / decoded.rate - sample.duration / 1.1) < .001);
  assert.ok(decoded.samples.every(x => Number.isFinite(x) && Math.abs(x) <= .951));
  assert.equal((await api(`/voices?character_id=${character}`))[0].source, 'builtin');
  assert.deepEqual(voice.voice_effects, effects); assert.equal(voice.speed, 1.1);
  const preview = await api('/preview', { character_id: character, voice_id: voice.id, text: '草稿对白', speed: .95, voice_effects: { pitch: -2 } }, 'POST', 202);
  const terminal = async (id, expectedStatus = 'completed') => {
    for (let i = 0; i < 1000; i++) {
      const job = getSpeechJob(id); if (!['queued', 'generating'].includes(job.status)) { assert.equal(job.status, expectedStatus, job.error); return job; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('speech job did not complete');
  };
  const draft = await terminal(preview.id);
  assert.deepEqual(JSON.parse(draft.params).reference_design, { speed: .95, voice_effects: { ...VOICE_EFFECT_DEFAULTS, pitch: -2 } });
  assert.deepEqual(JSON.parse(draft.params).voice_effects, VOICE_EFFECT_DEFAULTS);
  assert.equal(JSON.parse(draft.params).speed, 1);
  assert.equal(synthesis.at(-1).duration_factor, 1);
  assert.equal('voice_effects' in synthesis.at(-1), false);
  assert.equal('reference_design' in synthesis.at(-1), false);
  assert.equal(synthesis.at(-1).reference, db.prepare('SELECT reference_path FROM voice_samples WHERE id=?').get(draft.sample_id).reference_path);
  assert.notEqual(draft.sample_id, voice.sample_id);
  assert.deepEqual((await api(`/voices?character_id=${character}`))[0].voice_effects, effects);
  const message = Number(db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,'assistant','保存的对白')").run(`char_${character}`).lastInsertRowid);
  const playback = await api(`/characters/${character}/messages/${message}`, {}, 'POST', 202);
  const spoken = await terminal(playback.id);
  assert.deepEqual(JSON.parse(spoken.params).reference_design, { speed: 1.1, voice_effects: effects });
  assert.equal(spoken.sample_id, voice.sample_id);
  assert.equal(synthesis.at(-1).reference, savedSample.reference_path);
  assert.equal('voice_effects' in synthesis.at(-1), false);
  assert.equal(synthesis.at(-1).speed, 1);
  const updated = await api(`/voices/${voice.id}/parameters`, { character_id: character, speed: 1.2, voice_effects: { pitch: 3, resonance: 8, brightness: -1 } }, 'PUT');
  assert.equal(updated.version, 2); assert.equal(updated.speed, 1.2);
  assert.equal(updated.base_reference_url, sample.reference_url, 'edits retain the original source instead of stacking on the processed WAV');
  assert.equal(db.prepare('SELECT base_sample_id FROM voice_samples WHERE id=?').get(updated.sample_id).base_sample_id, sample.id);
  assert.deepEqual(await fs.readFile(path.join(dir, 'audio', savedSample.reference_path)), designedData, 'previous immutable references stay unchanged');
  const another = await api(`/characters/${character}/messages/${message}`, {}, 'POST', 202);
  assert.notEqual(another.id, playback.id); await terminal(another.id);
  effectVersion = 0;
  const before = synthesis.length;
  const oldService = await api('/preview', { character_id: character, voice_id: voice.id, text: '旧版服务不能静默忽略变声' }, 'POST', 202);
  await terminal(oldService.id);
  assert.equal(synthesis.length, before + 1, 'reference-only design needs no adapter output effects support');
  effectVersion = 1;
  const unsupported = await api('/preview', { character_id: character, voice_id: voice.id, text: '旧版服务不能忽略均衡', voice_effects: { clarity: 2 } }, 'POST', 202);
  await terminal(unsupported.id);
  assert.equal(synthesis.length, before + 2);
  effectVersion = 2;
  await api(`/voices/${voice.id}/parameters`, { character_id: character + 1000, voice_effects: {} }, 'PUT', 400);
  await api(`/voices/${voice.id}/parameters`, { character_id: character, voice_effects: { pitch: 100 } }, 'PUT', 400);
  assert.equal((await api(`/voices?character_id=${character}`))[0].voice_effects.pitch, 3);
  closeDb();
  const reopened = await api(`/voices?character_id=${character}`);
  assert.deepEqual(reopened[0].voice_effects, updated.voice_effects); assert.equal(reopened[0].speed, 1.2);
  assert.equal(reopened[0].source, 'builtin');
  assert.equal((await api(`/characters/${character}?mode=local`)).voice_id, voice.id);
  const restored = await api(`/voices/${voice.id}/parameters`, { character_id: character, speed: 1, voice_effects: {} }, 'PUT');
  assert.equal(restored.sample_id, sample.id, 'restore original uses the original reference exactly');
  assert.equal(restored.reference_url, sample.reference_url);
  // A legacy built-in profile has the original sample plus old stored knobs.
  getDb().prepare('UPDATE voices SET speed=?,voice_effects=? WHERE id=?').run(1.1, JSON.stringify(effects), voice.id);
  const legacy = await api('/preview', { character_id: character, voice_id: voice.id, text: '旧音色也改为参考音频处理' }, 'POST', 202);
  const migrated = await terminal(legacy.id);
  assert.equal(migrated.sample_id, savedSample.id);
  assert.equal('voice_effects' in synthesis.at(-1), false);
  const sameDraft = await api('/preview', { character_id: character, voice_id: voice.id, text: '旧音色也改为参考音频处理' }, 'POST', 202);
  assert.equal(sameDraft.id, legacy.id);
  setSpeechSettings({ enabled: false });
});

test('bundled Chinese samples have verified hashes, PCM metadata and stable source identities', async () => {
  const { createHash } = await import('node:crypto');
  const { localVoiceSource } = await import('../src/services/builtinVoices.js');
  assert.equal(localVoiceSource('builtin-old-immutable-reference'), 'builtin');
  assert.equal(localVoiceSource('uploaded-reference-id'), 'upload');
  const root = new URL('../assets/voices/', import.meta.url);
  const catalog = JSON.parse(await fs.readFile(new URL('catalog.json', root), 'utf8'));
  for (const voice of catalog) {
    assert.equal(voice.language, 'Chinese');
    assert.equal(voice.name, voice.id === 'female' ? '基础女声' : '基础男声');
    if (voice.id === 'female') {
      assert.equal(voice.source_type, 'official_reference_audio');
      assert.equal(voice.source_voice, 'examples/voice_11.wav');
      assert.equal(voice.source_sha256, '82730e38498413d4371a76e841cd91fa2f74843b79ad3b606d45ad8a7b7a736c');
      assert.match(voice.description, /IndexTTS 2.0 官方/);
      assert.equal(voice.transcript, '', 'upstream synthesis test text must not be presented as the reference transcript');
    } else {
      assert.match(voice.transcript, /你好，今天过得怎么样/);
      assert.match(voice.description, /普通话青年/);
    }
    const data = await fs.readFile(new URL(voice.file, root));
    assert.equal(createHash('sha256').update(data).digest('hex'), voice.sha256);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    let duration;
    for (let at = 12; at + 8 <= data.length;) {
      const type = data.toString('ascii', at, at + 4), size = data.readUInt32LE(at + 4);
      if (type === 'fmt ') {
        assert.equal(data.readUInt16LE(at + 8), 1);
        assert.equal(data.readUInt16LE(at + 10), 1);
        assert.equal(data.readUInt32LE(at + 12), voice.sample_rate || 24000);
        assert.equal(data.readUInt16LE(at + 22), 16);
      }
      if (type === 'data') {
        duration = size / ((voice.sample_rate || 24000) * 2);
        if (voice.processed_pcm_sha256) assert.equal(createHash('sha256').update(data.subarray(at + 8, at + 8 + size)).digest('hex'), voice.processed_pcm_sha256);
      }
      at += 8 + size + size % 2;
    }
    assert.ok(duration >= 6 && duration <= 12);
    assert.ok(Math.abs(duration - voice.duration) < .0001);
  }
});
