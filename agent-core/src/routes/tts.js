import express from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { importAudio, cropAudio, audioPath, audioUrl } from '../services/voiceAssets.js';
import { speechParams } from '../services/speechText.js';
import { ttsHealth } from '../services/indexTtsClient.js';
import { recoverSpeechGpu } from '../services/speechGpu.js';
import { getSpeechSettings, setSpeechSettings, requestSpeech, speakMessage, publicJob, getSpeechJob, cancelSpeech } from '../services/speechService.js';

const router = express.Router();
const route = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };
const id = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('无效的 ID'); return n; };
const sampleView = s => ({ id: s.id, duration: s.duration, peaks: s.peaks,
  preview_url: audioUrl(s.preview_path), reference_url: s.reference_path ? audioUrl(s.reference_path) : null,
  warnings: JSON.parse(s.warnings || '[]') });

router.get('/settings', route((req, res) => res.json(getSpeechSettings())));
router.put('/settings', route((req, res) => {
  if (typeof req.body.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  res.json(setSpeechSettings(req.body.enabled));
}));
router.get('/health', route(async (req, res) => res.json(await ttsHealth())));
router.get('/bindings', route((req, res) => {
  res.json(getDb().prepare('SELECT c.character_id,c.voice_id,c.enabled,v.name FROM character_voices c JOIN voices v ON v.id=c.voice_id').all());
}));
router.post('/recover', route(async (req, res) => res.json(await recoverSpeechGpu())));
router.post('/samples', express.raw({ type: 'application/octet-stream', limit: '25mb' }), route(async (req, res) => {
  const s = await importAudio(req.body);
  getDb().prepare('INSERT INTO voice_samples(id,original_path,preview_path,duration) VALUES(?,?,?,?)').run(s.id, s.original_path, s.preview_path, s.duration);
  res.status(201).json(sampleView(s));
}));
router.post('/samples/:id/crop', route(async (req, res) => {
  const original = getDb().prepare('SELECT * FROM voice_samples WHERE id=? AND reference_path IS NULL').get(req.params.id);
  if (!original) throw new Error('原音素材不存在');
  const s = await cropAudio(original, req.body.start, req.body.end, req.body.denoise === true);
  getDb().prepare(`INSERT INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration,start_seconds,end_seconds,warnings)
    VALUES(@id,@original_path,@preview_path,@reference_path,@content_hash,@duration,@start_seconds,@end_seconds,@warnings)`).run({
    id:s.id, original_path:s.original_path, preview_path:s.preview_path, reference_path:s.reference_path, content_hash:s.content_hash,
    duration:s.duration, start_seconds:s.start_seconds, end_seconds:s.end_seconds, warnings:s.warnings,
  });
  res.status(201).json(sampleView(s));
}));
router.get('/voices', route((req, res) => {
  res.json(getDb().prepare('SELECT v.*, s.reference_path FROM voices v JOIN voice_samples s ON s.id=v.sample_id ORDER BY v.created_at DESC').all()
    .map(({ reference_path, ...v }) => ({ ...v, reference_url: audioUrl(reference_path) })));
}));
function voiceFields(body) {
  const params = speechParams(body);
  const name = String(body.name || '日常声音').trim().slice(0, 80);
  const sample = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(body.sample_id || '');
  if (!sample?.reference_path) throw new Error('请先处理参考音频');
  return { name, sample_id: sample.id, language: params.language, speed: params.speed,
    notes: String(body.notes || '').slice(0, 1000), transcript: String(body.transcript || '').slice(0, 2000) };
}
router.post('/voices', route((req, res) => {
  const voice = { id: randomUUID(), ...voiceFields(req.body) };
  getDb().prepare('INSERT INTO voices(id,name,sample_id,language,speed,notes,transcript) VALUES(@id,@name,@sample_id,@language,@speed,@notes,@transcript)').run(voice);
  res.status(201).json(voice);
}));
router.put('/voices/:id', route((req, res) => {
  const voice = { id: req.params.id, ...voiceFields(req.body) };
  const result = getDb().prepare('UPDATE voices SET name=@name,sample_id=@sample_id,language=@language,speed=@speed,notes=@notes,transcript=@transcript,version=version+1 WHERE id=@id').run(voice);
  if (!result.changes) throw new Error('音色不存在');
  res.json(voice);
}));
router.delete('/voices/:id', route((req, res) => {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM character_voices WHERE voice_id=?').get(req.params.id)) throw new Error('音色仍被角色使用，请先解除绑定');
  db.prepare('DELETE FROM voices WHERE id=?').run(req.params.id);
  // Immutable samples and synthesis records remain retained, including shared originals.
  res.json({ ok: true });
}));
router.get('/characters/:id', route((req, res) => {
  const binding = getDb().prepare('SELECT c.*,v.name FROM character_voices c JOIN voices v ON v.id=c.voice_id WHERE character_id=?').get(id(req.params.id));
  res.json(binding || null);
}));
router.put('/characters/:id', route((req, res) => {
  const characterId = id(req.params.id), db = getDb();
  if (!db.prepare('SELECT 1 FROM characters WHERE id=?').get(characterId)) throw new Error('角色不存在');
  if (req.body.voice_id === null) db.prepare('DELETE FROM character_voices WHERE character_id=?').run(characterId);
  else {
    if (!db.prepare('SELECT 1 FROM voices WHERE id=?').get(req.body.voice_id || '')) throw new Error('音色不存在');
    db.prepare('INSERT OR REPLACE INTO character_voices(character_id,voice_id,enabled) VALUES(?,?,1)').run(characterId, req.body.voice_id);
  }
  res.json({ ok: true });
}));
router.post('/preview', route((req, res) => res.status(202).json(requestSpeech({ voiceId: req.body.voice_id, sampleId: req.body.sample_id, text: req.body.text, params: req.body }))));
router.post('/characters/:id/messages/:messageId', route((req, res) => res.status(202).json(speakMessage(id(req.params.id), id(req.params.messageId)))));
router.get('/characters/:id/messages', route((req, res) => {
  const jobs = getDb().prepare(`SELECT j.*, m.id AS message_id FROM message_speech ms JOIN messages m ON m.id=ms.message_id
    JOIN speech_jobs j ON j.id=ms.job_id WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 500`).all(`char_${id(req.params.id)}`);
  res.json(jobs.map(j => ({ ...publicJob(j), message_id: j.message_id })));
}));
router.get('/jobs/:id', route((req, res) => {
  const job = publicJob(getSpeechJob(req.params.id));
  if (!job) return res.status(404).json({ error: '语音任务不存在' });
  res.json(job);
}));
router.post('/jobs/:id/cancel', route((req, res) => res.json(cancelSpeech(req.params.id))));
router.get('/audio/:kind/:file', (req, res) => {
  if (!['previews', 'references', 'generated'].includes(req.params.kind) || !/^[a-f0-9-]+\.wav$/.test(req.params.file)) return res.sendStatus(404);
  res.sendFile(audioPath(`${req.params.kind}/${req.params.file}`));
});
router.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '音频文件不能超过 25MB' });
  next(error);
});
export default router;
