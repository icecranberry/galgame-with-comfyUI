import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeReferenceWav, encodeReferenceWav, equalizeReference } from '../src/services/voiceReferenceDsp.js';

const tone = (frequency, rate = 48000, seconds = 1) => Float32Array.from({ length: rate * seconds }, (_, i) => .2 * Math.sin(2 * Math.PI * frequency * i / rate));
function frequency(samples, rate) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i);
  return (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0]);
}
test('reference EQ changes the intended bands and preserves finite, limited samples', () => {
  const rms = data => Math.sqrt(data.slice(4000).reduce((sum, x) => sum + x * x, 0) / (data.length - 4000));
  for (const [key, target] of [['thickness', 80], ['clarity', 2800], ['air', 10000]]) {
    const gain = (hz, db) => rms(equalizeReference(tone(hz), 48000, { [key]: db })) / rms(tone(hz));
    for (const db of [-4, 4]) {
      const relative = 20 * Math.log10(gain(target, db) / gain(900, db));
      assert.ok(Math.sign(relative) === Math.sign(db) && Math.abs(relative) > 2, `${key}: ${relative}`);
    }
  }
  const clipped = equalizeReference(new Float32Array(100).fill(1), 48000, {});
  assert.ok(clipped.every(x => Number.isFinite(x) && Math.abs(x) <= .951));
  assert.throws(() => decodeReferenceWav(Buffer.from('invalid')));
});
test('reference worker renders R3 pitch/speed, deduplicates concurrent saves and always rebuilds from the base', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-reference-'));
  process.env.DB_PATH = path.join(dir, 'test.db'); process.env.TTS_AUDIO_DIR = path.join(dir, 'audio');
  const { getDb, closeDb } = await import('../src/db/index.js');
  const { audioPath } = await import('../src/services/voiceAssets.js');
  const { prepareVoiceReference } = await import('../src/services/voiceReferences.js');
  t.after(async () => { closeDb(); await fs.rm(dir, { recursive: true, force: true }); });
  const db = getDb(), raw = encodeReferenceWav(tone(220, 24000, 2), 24000);
  await fs.mkdir(audioPath('references'), { recursive: true });
  await fs.writeFile(audioPath('references/base.wav'), raw);
  db.prepare(`INSERT INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration)
    VALUES('builtin-test','references/base.wav','references/base.wav','references/base.wav',?,2)`).run(createHash('sha256').update(raw).digest('hex'));
  const base = db.prepare("SELECT * FROM voice_samples WHERE id='builtin-test'").get();
  const design = { speed: 1.5, voice_effects: { pitch: 4, resonance: 10, clarity: 2 } };
  const [first, duplicate] = await Promise.all([prepareVoiceReference(base, design), prepareVoiceReference(base, design)]);
  assert.equal(first.id, duplicate.id);
  const wav = await fs.readFile(audioPath(first.reference_path)), decoded = decodeReferenceWav(wav);
  assert.ok(Math.abs(first.duration - 2 / 1.5) < .001);
  assert.ok(Math.abs(frequency(decoded.samples.slice(12000, 36000), decoded.rate) - 220 * 2 ** (4 / 12)) < 3);
  assert.equal(createHash('sha256').update(wav).digest('hex'), first.content_hash);
  assert.deepEqual(await fs.readFile(audioPath(base.reference_path)), raw);
  const second = await prepareVoiceReference(first, { speed: .8, voice_effects: { pitch: -4 } });
  const direct = await prepareVoiceReference(base, { speed: .8, voice_effects: { pitch: -4 } });
  assert.equal(second.id, direct.id);
  assert.equal(second.base_sample_id, base.id);
  assert.equal((await prepareVoiceReference(second, {})).id, base.id);
  await fs.rm(audioPath(second.reference_path));
  const repaired = await prepareVoiceReference(second, { speed: .8, voice_effects: { pitch: -4 } });
  assert.equal(repaired.id, second.id);
  assert.ok((await fs.stat(audioPath(second.reference_path))).size > 24000);
});
