import express from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { importAudio, cropAudio, audioPath, audioUrl } from '../services/voiceAssets.js';
import { speechParams } from '../services/speechText.js';
import { ttsHealth } from '../services/indexTtsClient.js';
import { restartSpeechService } from '../services/speechServiceProcess.js';
import { recoverSpeechGpu } from '../services/speechGpu.js';
import { getSpeechSettings, setSpeechSettings, requestSpeech, speakMessage, publicJob, getSpeechJob, cancelSpeech, clearSpeechCache } from '../services/speechService.js';
import { getApiVoice, saveApiVoice, notifyStandingVoiceChanged } from '../services/speechConfig.js';
import { listApiSamples, importApiSample, createApiClone, listLocalApiVoices, reuseLocalApiVoice } from '../services/speechApiAssets.js';
import { localSpeechModels } from '../services/speechLocalModels.js';
import { listBuiltinVoices, builtinVoicePath, importBuiltinVoice, localVoiceSource } from '../services/builtinVoices.js';
import { prepareVoiceReference, baseVoiceSample } from '../services/voiceReferences.js';

const router = express.Router();
const route = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message, ...(e.code === 'VOICE_NOT_CONFIGURED' ? { code: e.code } : {}) }); } };
const id = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('无效的 ID'); return n; };
const sampleView = s => ({ id: s.id, duration: s.duration, peaks: s.peaks,
  preview_url: audioUrl(s.preview_path), reference_url: s.reference_path ? audioUrl(s.reference_path) : null,
  warnings: JSON.parse(s.warnings || '[]') });
const voiceView = voiceId => {
  const { reference_path, ...voice } = getDb().prepare('SELECT v.*, s.reference_path FROM voices v JOIN voice_samples s ON s.id=v.sample_id WHERE v.id=?').get(voiceId);
  const sample = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(voice.sample_id);
  return { ...voice, ...speechParams(voice), source: localVoiceSource(voice.sample_id), reference_url: audioUrl(reference_path), base_reference_url: audioUrl(baseVoiceSample(sample).reference_path) };
};

router.get('/settings', route((req, res) => res.json(getSpeechSettings())));
router.put('/settings', route((req, res) => {
  res.json(setSpeechSettings(req.body));
}));
router.delete('/cache', route((req, res) => res.json(clearSpeechCache())));
router.get('/health', route(async (req, res) => res.json(await ttsHealth())));
router.get('/local-models', route(async (req, res) => res.json(await localSpeechModels.status())));
router.post('/local-models/install', route((req, res) => res.status(202).json(localSpeechModels.install(req.body.model))));
router.post('/local-models/use', route(async (req, res) => res.json(await localSpeechModels.use(req.body.model))));
router.get('/bindings', route((req, res) => {
  if (getSpeechSettings().mode === 'api') return res.json(getDb().prepare('SELECT character_id FROM character_api_voices').all().map(row => ({ ...getApiVoice(row.character_id), enabled: 1, mode: 'api' })));
  res.json(getDb().prepare('SELECT c.character_id,c.voice_id,c.enabled,v.name FROM character_voices c JOIN voices v ON v.id=c.voice_id').all());
}));
router.post('/recover', route(async (req, res) => res.json(await recoverSpeechGpu())));
router.post('/restart', route(async (req, res) => res.json(await restartSpeechService())));
router.get('/builtin-voices', route((req, res) => res.json(listBuiltinVoices())));
router.get('/builtin-voices/:id/audio', route((req, res) => res.sendFile(builtinVoicePath(req.params.id))));
router.post('/builtin-voices/:id/sample', route(async (req, res) => res.status(201).json(sampleView(await importBuiltinVoice(req.params.id)))));
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
  const characterId = req.query.character_id === undefined ? null : id(req.query.character_id);
  res.json(getDb().prepare(`SELECT v.*, s.reference_path FROM voices v JOIN voice_samples s ON s.id=v.sample_id
    ${characterId === null ? '' : 'WHERE v.character_id=@characterId'} ORDER BY v.created_at DESC`).all(characterId === null ? {} : { characterId })
    .map(v => voiceView(v.id)));
}));
async function voiceFields(body) {
  const params = speechParams(body);
  const name = String(body.name || '日常声音').trim().slice(0, 80);
  if (!name) throw new Error('请填写音色名称');
  let sample = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(body.sample_id || '');
  if (!sample?.reference_path) throw new Error('请先处理参考音频');
  sample = await prepareVoiceReference(sample, params);
  return { name, sample_id: sample.id, language: params.language, speed: params.speed, generation_params: JSON.stringify(params.generation_params), voice_effects: JSON.stringify(params.voice_effects),
    notes: String(body.notes || '').slice(0, 1000), transcript: String(body.transcript || '').slice(0, 2000) };
}
router.post('/voices', route(async (req, res) => {
  const characterId = id(req.body.character_id);
  if (!getDb().prepare('SELECT 1 FROM characters WHERE id=?').get(characterId)) throw new Error('角色不存在');
  const voice = { id: randomUUID(), character_id: characterId, ...await voiceFields(req.body) };
  const db = getDb();
  db.transaction(() => {
    db.prepare('INSERT INTO voices(id,character_id,name,sample_id,language,speed,notes,transcript,generation_params,voice_effects) VALUES(@id,@character_id,@name,@sample_id,@language,@speed,@notes,@transcript,@generation_params,@voice_effects)').run(voice);
    db.prepare('INSERT OR REPLACE INTO character_voices(character_id,voice_id,enabled) VALUES(?,?,1)').run(characterId, voice.id);
  })();
  notifyStandingVoiceChanged(characterId);
  res.status(201).json(voiceView(voice.id));
}));
router.put('/voices/:id', route(async (req, res) => {
  const existing = getDb().prepare('SELECT * FROM voices WHERE id=? AND character_id=?').get(req.params.id, id(req.body.character_id));
  if (!existing) throw new Error('音色不属于当前角色');
  const voice = { id: req.params.id, ...await voiceFields({ ...existing, ...req.body }) };
  const result = getDb().prepare('UPDATE voices SET name=@name,sample_id=@sample_id,language=@language,speed=@speed,notes=@notes,transcript=@transcript,generation_params=@generation_params,voice_effects=@voice_effects,version=version+1 WHERE id=@id').run(voice);
  if (!result.changes) throw new Error('音色不存在');
  notifyStandingVoiceChanged(existing.character_id);
  res.json(voiceView(voice.id));
}));
router.put('/voices/:id/parameters', route(async (req, res) => {
  const characterId = id(req.body.character_id);
  const existing = getDb().prepare('SELECT * FROM voices WHERE id=? AND character_id=?').get(req.params.id, characterId);
  if (!existing) throw new Error('音色不属于当前角色');
  const params = speechParams({ ...existing, ...req.body });
  const sample = await prepareVoiceReference(getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(existing.sample_id), params);
  getDb().prepare('UPDATE voices SET generation_params=?,voice_effects=?,speed=?,sample_id=?,version=version+1 WHERE id=? AND character_id=?')
    .run(JSON.stringify(params.generation_params), JSON.stringify(params.voice_effects), params.speed, sample.id, req.params.id, characterId);
  notifyStandingVoiceChanged(characterId);
  res.json(voiceView(req.params.id));
}));
router.delete('/voices/:id', route((req, res) => {
  const db = getDb();
  const voice = db.prepare('SELECT * FROM voices WHERE id=?').get(req.params.id);
  if (!voice) throw new Error('音色不存在');
  db.transaction(() => {
    const wasCurrent = db.prepare('SELECT 1 FROM character_voices WHERE voice_id=?').get(voice.id);
    db.prepare('DELETE FROM character_voices WHERE voice_id=?').run(voice.id);
    db.prepare('DELETE FROM voices WHERE id=?').run(voice.id);
    if (wasCurrent && voice.character_id) {
      const next = db.prepare('SELECT id FROM voices WHERE character_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(voice.character_id);
      if (next) db.prepare('INSERT INTO character_voices(character_id,voice_id,enabled) VALUES(?,?,1)').run(voice.character_id, next.id);
    }
  })();
  // Immutable samples and synthesis records remain retained, including shared originals.
  const currentVoice = db.prepare('SELECT c.voice_id,v.name FROM character_voices c JOIN voices v ON v.id=c.voice_id WHERE c.character_id=?').get(voice.character_id);
  notifyStandingVoiceChanged(voice.character_id);
  res.json({ ok: true, current_voice: currentVoice || null });
}));
router.get('/characters/:id', route((req, res) => {
  if (req.query.mode !== 'local' && getSpeechSettings().mode === 'api') return res.json(getApiVoice(id(req.params.id)));
  const binding = getDb().prepare('SELECT c.*,v.name FROM character_voices c JOIN voices v ON v.id=c.voice_id WHERE c.character_id=? AND v.character_id=c.character_id').get(id(req.params.id));
  res.json(binding || null);
}));
router.get('/characters/:id/api-voice', route((req, res) => res.json(getApiVoice(id(req.params.id)))));
router.get('/characters/:id/api-samples', route((req, res) => res.json(listApiSamples(id(req.params.id)))));
router.get('/characters/:id/api-local-voices', route((req, res) => res.json(listLocalApiVoices(id(req.params.id)))));
router.post('/characters/:id/api-samples/from-local', route(async (req, res) => res.status(201).json(await reuseLocalApiVoice(id(req.params.id), req.body.voice_id))));
router.post('/characters/:id/api-samples', express.raw({ type: 'application/octet-stream', limit: '25mb' }), route(async (req, res) => {
  res.status(201).json(await importApiSample(id(req.params.id), req.body, req.query.name));
}));
router.post('/characters/:id/api-clones', route(async (req, res) => {
  res.status(201).json(await createApiClone(id(req.params.id), req.body, getSpeechSettings()));
}));
router.put('/characters/:id/api-voice', route((req, res) => res.json(saveApiVoice(id(req.params.id), req.body))));
router.put('/characters/:id', route((req, res) => {
  const characterId = id(req.params.id), db = getDb();
  if (!db.prepare('SELECT 1 FROM characters WHERE id=?').get(characterId)) throw new Error('角色不存在');
  if (!db.prepare('SELECT 1 FROM voices WHERE id=? AND character_id=?').get(req.body.voice_id || '', characterId)) throw new Error('请选择该角色自己的音色');
  db.prepare('INSERT OR REPLACE INTO character_voices(character_id,voice_id,enabled) VALUES(?,?,1)').run(characterId, req.body.voice_id);
  notifyStandingVoiceChanged(characterId);
  res.json({ ok: true });
}));
router.post('/preview', route((req, res) => res.status(202).json(requestSpeech({ characterId: id(req.body.character_id), voiceId: req.body.voice_id, sampleId: req.body.sample_id, text: req.body.text, params: req.body }))));
router.post('/characters/:id/messages/:messageId', route((req, res) => res.status(202).json(speakMessage(id(req.params.id), id(req.params.messageId)))));
router.post('/groups/:groupId/characters/:id/messages/:messageId', route((req, res) => res.status(202).json(speakMessage(id(req.params.id), id(req.params.messageId), { groupId: id(req.params.groupId) }))));
router.get('/groups/:groupId/messages', route((req, res) => {
  const jobs = getDb().prepare(`SELECT j.*, m.id AS message_id FROM message_speech ms JOIN messages m ON m.id=ms.message_id
    JOIN speech_jobs j ON j.id=ms.job_id WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 500`).all(`group_${id(req.params.groupId)}`);
  res.json(jobs.map(j => ({ ...publicJob(j), message_id: j.message_id })));
}));
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
  if (!['previews', 'references', 'generated'].includes(req.params.kind) || !/^[a-f0-9-]+\.(wav|mp3)$/.test(req.params.file)) return res.sendStatus(404);
  res.sendFile(audioPath(`${req.params.kind}/${req.params.file}`));
});
router.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '音频文件不能超过 25MB' });
  next(error);
});
export default router;
