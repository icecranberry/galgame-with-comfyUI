import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { getSetting } from '../db/settings.js';
import { audioPath, audioUrl, importAudio } from './voiceAssets.js';
import { apiConnection, uploadApiVoice } from './speechApiClient.js';

function requireApiCharacter(characterId) {
  const db = getDb();
  if (getSetting('tts_mode') !== 'api') throw new Error('请先在音色管理中切换到全局 API 模式');
  if (!db.prepare('SELECT 1 FROM characters WHERE id=?').get(characterId)) throw new Error('角色不存在');
}
export function listApiSamples(characterId) {
  return getDb().prepare('SELECT * FROM api_voice_samples WHERE character_id=? ORDER BY created_at DESC,rowid DESC').all(characterId)
    .map(s => ({ id: s.id, name: s.name, source: s.source, transcript: s.transcript, duration: s.duration, preview_url: audioUrl(s.preview_path),
      clones: getDb().prepare('SELECT id,name,transcript,voice,endpoint,model FROM api_voice_clones WHERE sample_id=? ORDER BY created_at DESC,rowid DESC').all(s.id) }));
}
export function listLocalApiVoices(characterId) {
  return getDb().prepare(`SELECT v.id,v.name,v.transcript,s.duration,s.reference_path FROM voices v
    JOIN voice_samples s ON s.id=v.sample_id WHERE v.character_id=? AND s.reference_path IS NOT NULL ORDER BY v.created_at DESC,v.rowid DESC`).all(characterId)
    .map(({ reference_path, ...voice }) => ({ ...voice, preview_url: audioUrl(reference_path) }));
}
export async function reuseLocalApiVoice(characterId, voiceId) {
  requireApiCharacter(characterId);
  const db = getDb();
  const voice = db.prepare(`SELECT v.name,v.transcript,s.* FROM voices v JOIN voice_samples s ON s.id=v.sample_id
    WHERE v.id=? AND v.character_id=? AND s.reference_path IS NOT NULL`).get(voiceId, characterId);
  if (!voice) throw new Error('本地音色不存在或不属于当前角色');
  if (voice.duration > 30) throw new Error('API 参考音频需在 30 秒以内');
  const buffer = await fs.readFile(audioPath(voice.reference_path));
  const hash = createHash('sha256').update(buffer).digest('hex');
  const existing = db.prepare("SELECT id FROM api_voice_samples WHERE character_id=? AND content_hash=? AND source='local' AND transcript=?").get(characterId, hash, voice.transcript || '');
  if (existing) return listApiSamples(characterId).find(s => s.id === existing.id);
  const sampleId = randomUUID(), preview = `previews/${sampleId}.wav`;
  await fs.mkdir(audioPath('previews'), { recursive: true });
  await fs.writeFile(audioPath(preview), buffer, { flag: 'wx' });
  try {
    requireApiCharacter(characterId);
    db.prepare(`INSERT INTO api_voice_samples(id,character_id,name,original_path,preview_path,content_hash,duration,source,transcript)
      VALUES(?,?,?,?,?,?,?,'local',?)`).run(sampleId, characterId, voice.name, voice.original_path, preview, hash, voice.duration, voice.transcript || '');
  } catch (e) { await fs.rm(audioPath(preview), { force: true }); throw e; }
  return listApiSamples(characterId).find(s => s.id === sampleId);
}
export async function importApiSample(characterId, buffer, name) {
  requireApiCharacter(characterId);
  const sample = await importAudio(buffer);
  try {
    if (sample.duration > 30) throw new Error('API 参考音频请控制在 30 秒以内，建议 8～10 秒清晰对白');
    requireApiCharacter(characterId);
    const hash = createHash('sha256').update(await fs.readFile(audioPath(sample.preview_path))).digest('hex');
    getDb().prepare('INSERT INTO api_voice_samples(id,character_id,name,original_path,preview_path,content_hash,duration) VALUES(?,?,?,?,?,?,?)')
      .run(sample.id, characterId, String(name || '参考音频').trim().slice(0, 120), sample.original_path, sample.preview_path, hash, sample.duration);
  } catch (e) {
    await Promise.all([sample.original_path, sample.preview_path].map(p => fs.rm(audioPath(p), { force: true })));
    throw e;
  }
  return listApiSamples(characterId).find(s => s.id === sample.id);
}
// Resolve ownership before saving, caching or opening any file. Only immutable
// sample IDs and text are persisted in profiles/jobs, never base64 or API keys.
export function resolveApiReferences(characterId, profile) {
  return (profile.references || []).map(ref => {
    const sample = getDb().prepare('SELECT * FROM api_voice_samples WHERE id=? AND character_id=?').get(ref.sample_id, characterId);
    if (!sample) throw new Error('API 参考音频不存在或不属于当前角色');
    return { ...sample, text: ref.text };
  });
}
export async function encodeApiReferences(samples) {
  return Promise.all(samples.map(async sample => {
    let buffer;
    try { buffer = await fs.readFile(audioPath(sample.preview_path)); } catch { throw new Error('API 参考音频文件已丢失，请重新上传'); }
    if (createHash('sha256').update(buffer).digest('hex') !== sample.content_hash) throw new Error('API 参考音频文件已变更，请重新上传');
    return { audio: `data:audio/wav;base64,${buffer.toString('base64')}`, text: sample.text };
  }));
}
export async function createApiClone(characterId, input, settings) {
  requireApiCharacter(characterId);
  let name = String(input.name || '').trim();
  const text = String(input.text || '').trim();
  if (text.length > 4000) throw new Error('参考音频文本最多 4000 字');
  const [sample] = resolveApiReferences(characterId, { references: [{ sample_id: input.sample_id, text }] });
  name ||= sample.name.slice(0, 80);
  if (!name || name.length > 80) throw new Error('音色名称最多 80 字');
  const connection = apiConnection(settings.api), key = getSetting('tts_api_key');
  const [reference] = await encodeApiReferences([sample]);
  const voice = await uploadApiVoice(connection, key, { buffer: Buffer.from(reference.audio.split(',')[1], 'base64'), name, text });
  // Keep successful remote IDs even if the editor was closed while uploading.
  const result = { id: randomUUID(), name, transcript: text, voice, endpoint: connection.endpoint, model: connection.model };
  getDb().prepare('INSERT INTO api_voice_clones(id,sample_id,name,transcript,voice,endpoint,model) VALUES(?,?,?,?,?,?,?)')
    .run(result.id, sample.id, name, text, voice, result.endpoint, result.model);
  return result;
}
