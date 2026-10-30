import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { audioPath } from './voiceAssets.js';
import { localVoiceSource } from './builtinVoices.js';
import { speechParams, REFERENCE_DESIGN_VERSION } from './speechText.js';
const pending = new Map();
export function baseVoiceSample(sample) {
  if (!sample.base_sample_id) return sample;
  const base = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(sample.base_sample_id);
  if (!base?.reference_path || base.base_sample_id) throw new Error('基础声音素材不存在');
  return base;
}
export function referenceDesign(input) {
  const { speed, voice_effects } = speechParams(input);
  return { speed, voice_effects };
}
export async function prepareVoiceReference(sample, input) {
  if (localVoiceSource(sample.id) !== 'builtin') return sample;
  const base = baseVoiceSample(sample), design = referenceDesign(input);
  if (design.speed === 1 && Object.values(design.voice_effects).every(value => value === 0)) return base;
  const key = createHash('sha256').update(JSON.stringify({ base: base.content_hash, design, version: REFERENCE_DESIGN_VERSION })).digest('hex');
  const id = `builtin-designed-${key}`;
  if (pending.has(id)) return pending.get(id);
  const work = (async () => {
    const existing = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(id);
    if (existing && await fs.access(audioPath(existing.reference_path)).then(() => true, () => false)) return existing;
    const { wav, duration } = await new Promise((resolve, reject) => {
      let received = false;
      const worker = new Worker(new URL('./voiceReferenceWorker.js', import.meta.url), { workerData: { file: audioPath(base.reference_path), parameters: { ...design.voice_effects, speed: design.speed } } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('参考声音处理超时，请重试')); }, 60000);
      worker.once('message', result => { received = true; clearTimeout(timer); if (result.error) reject(new Error(result.error)); else resolve(result); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.once('exit', () => { clearTimeout(timer); if (!received) reject(new Error('参考声音处理失败')); });
    });
    const data = Buffer.from(wav), hash = createHash('sha256').update(data).digest('hex');
    const relative = `references/${key}.wav`, temporary = audioPath(`references/${randomUUID()}.tmp`);
    await fs.mkdir(audioPath('references'), { recursive: true });
    try { await fs.writeFile(temporary, data); await fs.rename(temporary, audioPath(relative)); }
    finally { await fs.rm(temporary, { force: true }); }
    getDb().prepare(`INSERT OR IGNORE INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration,base_sample_id)
      VALUES(?,?,?,?,?,?,?)`).run(id, base.original_path, base.preview_path, relative, hash, duration, base.id);
    return getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(id);
  })();
  pending.set(id, work);
  try { return await work; } finally { pending.delete(id); }
}
