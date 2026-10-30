import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { audioPath } from './voiceAssets.js';

const root = new URL('../../assets/voices/', import.meta.url);
let catalog;
const getCatalog = () => catalog ||= JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8'));
export function builtinVoice(id) {
  const voice = getCatalog().find(item => item.id === id);
  if (!voice) throw new Error('内置声音不存在');
  return voice;
}
export const builtinVoicePath = id => fileURLToPath(new URL(builtinVoice(id).file, root));
// Saved bundled references retain this identity even after bundled audio changes.
export const localVoiceSource = sampleId => String(sampleId || '').startsWith('builtin-') ? 'builtin' : 'upload';
export const listBuiltinVoices = () => getCatalog().map(({ id, name, description, duration, sha256 }) => ({ id, name, description, duration, reference_url: `/api/tts/builtin-voices/${id}/audio?v=${sha256}` }));
export async function importBuiltinVoice(id) {
  const voice = builtinVoice(id);
  const data = await fs.readFile(builtinVoicePath(id));
  const hash = createHash('sha256').update(data).digest('hex');
  if (hash !== voice.sha256) throw new Error('内置声音文件不完整，请恢复应用文件');
  const sampleId = `builtin-${hash}`;
  const relative = `references/${hash}.wav`;
  await fs.mkdir(audioPath('references'), { recursive: true });
  // Restore a missing/damaged copy without changing the shared bundled source.
  let saved;
  try { saved = await fs.readFile(audioPath(relative)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!saved || !saved.equals(data)) {
    const temporary = audioPath(`references/${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, data); await fs.rename(temporary, audioPath(relative)); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration)
    VALUES(?,?,?,?,?,?)`).run(sampleId, relative, relative, relative, hash, voice.duration);
  return db.prepare('SELECT * FROM voice_samples WHERE id=?').get(sampleId);
}
