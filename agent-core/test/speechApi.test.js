import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { apiConnection, apiVoiceParams, apiSpeechBody, apiSpeechCacheKey, fetchApiSpeech } from '../src/services/speechApiClient.js';
import { migrateTtsSchema } from '../src/db/ttsSchema.js';

test('reference protocol omits voice and fingerprints audio and transcript independently', () => {
  const p = { source: 'references', voice: 'retained-id', references: [{ sample_id: '12345678-abcd-abcd-abcd-123456789abc', text: '原文' }] };
  const c = { endpoint: 'http://localhost/speech', model: 'clone' }, refs = [{ audio: 'sha256:abc', text: '原文' }];
  assert.deepEqual(apiSpeechBody('你好', c, p, refs), { model: 'clone', input: '你好', references: refs, speed: 1, response_format: 'mp3' });
  const key = apiSpeechCacheKey(1, '你好', c, p, refs);
  for (const changed of [[{ audio: 'sha256:def', text: '原文' }], [{ audio: 'sha256:abc', text: '另一段原文' }]]) assert.notEqual(key, apiSpeechCacheKey(1, '你好', c, p, changed));
  assert.equal(apiSpeechBody('你好', c, { ...p, source: 'voice' }, refs).references, undefined);
  for (const changed of [{ ...p, references: [] }, { ...p, references: [{ sample_id: '../file', text: 'x' }] }, { ...p, references: [{ ...p.references[0], text: 'x'.repeat(4001) }] }, { voice: 'x', extra: { references: [] } }]) assert.throws(() => apiVoiceParams(changed));
  assert.equal(apiVoiceParams({ ...p, references: [{ ...p.references[0], text: '' }] }).references[0].text, '');
  assert.throws(() => apiConnection({ ...c, upload_endpoint: 'file:///secret' }));
});

function wav(seconds = 2) {
  const rate = 8000, bytes = rate * seconds * 2, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  for (let i = 0; i < rate * seconds; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 4000), 44 + i * 2);
  return buffer;
}

test('API protocol validates input, protects reserved fields and isolates cache dimensions', () => {
  const connection = apiConnection({ endpoint: 'http://localhost:8000/v1/audio/speech', model: 'tts-1' });
  const profile = apiVoiceParams({ voice: 'nova', speed: 1.2, instructions: '温柔', extra: { language: 'zh' } });
  assert.deepEqual(apiSpeechBody('你好', connection, profile), { model: 'tts-1', input: '你好', voice: 'nova', speed: 1.2, instructions: '温柔', language: 'zh', response_format: 'mp3' });
  for (const value of [{ voice: '' }, { voice: 'a', speed: 9 }, { voice: 'a', extra: [] }, { voice: 'a', extra: '{' }, { voice: 'a', extra: { input: 'override' } }, { voice: 'a', extra: { stream: true } }]) assert.throws(() => apiVoiceParams(value));
  for (const endpoint of ['file:///tmp/a', 'https://user:password@example.com', 'bad']) assert.throws(() => apiConnection({ endpoint, model: 'tts-1' }));
  const key = apiSpeechCacheKey(1, '你好', connection, profile);
  for (const args of [[2, '你好', connection, profile], [1, '再见', connection, profile],
    [1, '你好', { ...connection, endpoint: connection.endpoint + '/other' }, profile],
    [1, '你好', { ...connection, model: 'other' }, profile],
    ...[{ voice: 'alloy' }, { speed: 2 }, { instructions: '开心' }, { extra: { language: 'en' } }].map(change => [1, '你好', connection, { ...profile, ...change }])]) assert.notEqual(apiSpeechCacheKey(...args), key);
  assert.equal(apiSpeechCacheKey(1, '你好', connection, { ...profile, extra: { a: 1, b: 2 } }), apiSpeechCacheKey(1, '你好', connection, { ...profile, extra: { b: 2, a: 1 } }));
});

function legacySpeechDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY); CREATE TABLE messages(id INTEGER PRIMARY KEY);
    INSERT INTO characters VALUES(1); INSERT INTO messages VALUES(1);
    CREATE TABLE voice_samples(id TEXT PRIMARY KEY,original_path TEXT,preview_path TEXT,duration REAL);
    INSERT INTO voice_samples VALUES('sample','original','preview',10);
    CREATE TABLE speech_jobs(id TEXT PRIMARY KEY, cache_key TEXT NOT NULL, text TEXT NOT NULL,
      voice_id TEXT NOT NULL, voice_version INTEGER NOT NULL, sample_id TEXT NOT NULL REFERENCES voice_samples(id),
      model_version TEXT NOT NULL, params TEXT NOT NULL, status TEXT NOT NULL,output_path TEXT,error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO speech_jobs(id,cache_key,text,voice_id,voice_version,sample_id,model_version,params,status)
      VALUES('old','key','hello','voice',1,'sample','local','{}','completed');
    CREATE TABLE message_speech(message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,job_id TEXT REFERENCES speech_jobs(id));
    INSERT INTO message_speech VALUES(1,'old');`);
  return db;
}

test('nullable sample migration preserves existing jobs, message links and foreign keys', () => {
  const db = legacySpeechDatabase();
  const old = db.prepare('SELECT * FROM speech_jobs').get();
  migrateTtsSchema(db); migrateTtsSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM speech_jobs').get(), old);
  assert.equal(db.prepare('SELECT job_id FROM message_speech').pluck().get(), 'old');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare('PRAGMA table_info(speech_jobs)').all().find(c => c.name === 'sample_id').notnull, 0);
  db.close();
});

test('unrelated legacy foreign-key violations do not block speech migration or change existing rows', () => {
  const db = legacySpeechDatabase();
  try {
    db.pragma('foreign_keys=OFF');
    db.exec(`CREATE TABLE memory_fragments(id INTEGER PRIMARY KEY, character_id INTEGER REFERENCES characters(id));
      INSERT INTO memory_fragments VALUES(10,999);`);
    db.pragma('foreign_keys=ON');
    const violations = db.pragma('foreign_key_check');
    const old = db.prepare('SELECT * FROM speech_jobs').get();
    migrateTtsSchema(db); migrateTtsSchema(db);
    assert.deepEqual(db.pragma('foreign_key_check'), violations, 'unrelated legacy data remains untouched');
    assert.deepEqual(db.prepare('SELECT * FROM memory_fragments').get(), { id: 10, character_id: 999 });
    assert.deepEqual(db.prepare('SELECT * FROM speech_jobs').get(), old);
    assert.equal(db.prepare('SELECT job_id FROM message_speech').pluck().get(), 'old');
    assert.equal(db.pragma('table_info(speech_jobs)').find(c => c.name === 'sample_id').notnull, 0);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  } finally { db.close(); }
});

for (const table of ['speech_jobs', 'message_speech']) {
  test(`speech migration still rejects broken ${table} links and rolls back without data loss`, () => {
    const db = legacySpeechDatabase();
    try {
      db.pragma('foreign_keys=OFF');
      db.exec(table === 'speech_jobs' ? "UPDATE speech_jobs SET sample_id='missing'" : "UPDATE message_speech SET job_id='missing'");
      db.pragma('foreign_keys=ON');
      const oldJob = db.prepare('SELECT * FROM speech_jobs').get();
      const oldLink = db.prepare('SELECT * FROM message_speech').get();
      assert.throws(() => migrateTtsSchema(db), new RegExp(`完整性检查失败：${table}`));
      assert.deepEqual(db.prepare('SELECT * FROM speech_jobs').get(), oldJob);
      assert.deepEqual(db.prepare('SELECT * FROM message_speech').get(), oldLink);
      assert.equal(db.pragma('table_info(speech_jobs)').find(c => c.name === 'sample_id').notnull, 1);
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='speech_jobs_new'").get(), undefined);
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    } finally { db.close(); }
  });
}

test('HTTP API voices synthesize without samples, retain local profiles and support cancellation/retry', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linshe-api-tts-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.TTS_AUDIO_DIR = path.join(dir, 'audio');
  const { getDb, closeDb } = await import('../src/db/index.js');
  const { default: express } = await import('express');
  const { default: router } = await import('../src/routes/tts.js');
  const app = express(); app.use(express.json({ limit: '10mb' }));
  const received = []; let upstream = 'ok', release;
  const uploads = []; let uploadResult = { uri: 'speech:test-clone' };
  app.post('/upload-voice', express.raw({ type: 'multipart/form-data', limit: '25mb' }), async (req, res) => {
    const form = await new Response(req.body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
    uploads.push({ model: form.get('model'), name: form.get('customName'), text: form.get('text'),
      file: Buffer.from(await form.get('file').arrayBuffer()), authorization: req.headers.authorization });
    if (uploadResult === 'error') return res.status(401).send('secret-do-not-show');
    res.json(uploadResult);
  });
  app.post('/upstream', async (req, res) => {
    received.push({ body: req.body, authorization: req.headers.authorization });
    if (upstream === 'delay') await new Promise(resolve => { release = resolve; });
    if (upstream === 'error') return res.status(401).send('do not expose credentials');
    if (upstream === 'json') return res.json({ error: 'not audio' });
    res.type('audio/mpeg').send(Buffer.from('ID3mock-audio-response'));
  });
  app.use('/api/tts', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { release?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); closeDb(); await fs.rm(dir, { recursive: true, force: true }); });
  const request = async (route, body, method = body === undefined ? 'GET' : 'POST', status = 200) => {
    const response = await fetch(`${base}/api/tts${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  };
  const terminal = async job => {
    for (let n = 0; n < 100 && ['queued', 'generating'].includes(job.status); n++) {
      await new Promise(resolve => setTimeout(resolve, 10)); job = await request(`/jobs/${job.id}`);
    }
    assert.ok(!['queued', 'generating'].includes(job.status)); return job;
  };
  const db = getDb();
  const characterId = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt) VALUES(?,?,?)').run('api-test', '测试', 'test').lastInsertRowid);
  db.prepare("INSERT INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration) VALUES('local-sample','o','p','references/local.wav','hash',10)").run();
  await fs.mkdir(path.join(dir, 'audio/references'), { recursive: true });
  await fs.writeFile(path.join(dir, 'audio/references/local.wav'), wav());
  db.prepare("INSERT INTO voices(id,name,sample_id,character_id,generation_params) VALUES('local-voice','本地声音','local-sample',?,?)").run(characterId, '{"top_p":0.7}');
  db.prepare("INSERT INTO character_voices VALUES(?,'local-voice',1)").run(characterId);
  const local = db.prepare("SELECT * FROM voices WHERE id='local-voice'").get();
  const settings = await request('/settings', { enabled: true, mode: 'api', api: { endpoint: base + '/upstream', model: 'test-model', key: 'test-secret' } }, 'PUT');
  assert.equal(settings.api.has_key, true); assert.ok(!JSON.stringify(settings).includes('test-secret'));
  const profile = { voice: 'nova', speed: 1.3, instructions: '温柔', extra: { language: 'zh' } };
  await request(`/characters/${characterId}/api-voice`, profile, 'PUT');
  assert.equal((await request(`/characters/${characterId}`)).name, 'nova');
  assert.equal((await request(`/characters/${characterId}?mode=local`)).voice_id, 'local-voice');
  const messageId = Number(db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,'assistant','你好（挥手）')").run(`char_${characterId}`).lastInsertRowid);
  const route = `/characters/${characterId}/messages/${messageId}`;
  const done = await terminal(await request(route, {}, 'POST', 202));
  assert.equal(done.status, 'completed'); assert.match(done.audio_url, /\.mp3$/);
  assert.equal((await fetch(base + done.audio_url)).headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(received[0], { authorization: 'Bearer test-secret', body: { language: 'zh', model: 'test-model', input: '你好', voice: 'nova', speed: 1.3, response_format: 'mp3', instructions: '温柔' } });
  assert.equal(db.prepare('SELECT sample_id FROM speech_jobs WHERE id=?').pluck().get(done.id), null);
  assert.equal((await request(route, {}, 'POST', 202)).id, done.id);
  const otherCharacter = Number(db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('api-group-other','群成员','persona')").run().lastInsertRowid);
  const groupMessage = Number(db.prepare("INSERT INTO messages(conversation_id,role,content,speaker_character_id) VALUES('group_921','assistant','群聊里的声音',?)").run(otherCharacter).lastInsertRowid);
  const privateMessage = Number(db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,'assistant','未配置声音')").run(`char_${otherCharacter}`).lastInsertRowid);
  const groupRoute = `/groups/921/characters/${otherCharacter}/messages/${groupMessage}`;
  const beforeMissing = received.length;
  assert.equal((await request(groupRoute, {}, 'POST', 400)).code, 'VOICE_NOT_CONFIGURED');
  assert.equal((await request(`/characters/${otherCharacter}/messages/${privateMessage}`, {}, 'POST', 400)).code, 'VOICE_NOT_CONFIGURED');
  assert.equal(received.length, beforeMissing, 'missing voices never contact the synthesis provider');
  await request(`/characters/${otherCharacter}/api-voice`, { voice: 'alloy' }, 'PUT');
  const groupDone = await terminal(await request(groupRoute, {}, 'POST', 202));
  assert.equal(groupDone.status, 'completed');
  assert.equal(received.at(-1).body.voice, 'alloy', 'group playback uses the speaker profile, not another member');
  assert.equal((await request('/groups/921/messages')).find(job => job.message_id === groupMessage).id, groupDone.id);
  assert.equal((await request('/groups/922/messages')).length, 0);
  await request(`/groups/921/characters/${characterId}/messages/${groupMessage}`, {}, 'POST', 400);
  await request(`/groups/922/characters/${otherCharacter}/messages/${groupMessage}`, {}, 'POST', 400);
  await request(`/characters/${otherCharacter}/messages/${groupMessage}`, {}, 'POST', 400);
  const preview = await terminal(await request('/preview', { character_id: characterId, text: '你好', api_params: { ...profile, voice: 'draft' } }, 'POST', 202));
  assert.notEqual(preview.id, done.id); assert.equal(received.at(-1).body.voice, 'draft');
  assert.equal((await request(`/characters/${characterId}/api-voice`)).params.voice, 'nova');
  await request('/settings', { mode: 'local' }, 'PUT');
  assert.equal((await request(`/characters/${characterId}`)).voice_id, 'local-voice');
  assert.deepEqual(db.prepare("SELECT * FROM voices WHERE id='local-voice'").get(), local);
  await request('/settings', { mode: 'api' }, 'PUT');
  assert.equal((await request(route, {}, 'POST', 202)).id, done.id);
  upstream = 'error';
  const body = { character_id: characterId, text: '失败后重试', api_params: profile };
  const failed = await terminal(await request('/preview', body, 'POST', 202));
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /401/); assert.ok(!failed.error.includes('credentials'));
  upstream = 'ok'; assert.equal((await terminal(await request('/preview', body, 'POST', 202))).status, 'completed');
  upstream = 'json';
  await assert.rejects(fetchApiSpeech('test', { endpoint: base + '/upstream', model: 'x' }, profile, ''), /未返回音频/);
  upstream = 'delay';
  const pending = await request('/preview', { ...body, text: '取消测试' }, 'POST', 202);
  for (let n = 0; n < 100 && !release; n++) await new Promise(resolve => setTimeout(resolve, 5));
  await request(`/jobs/${pending.id}/cancel`, {}); release();
  assert.equal((await terminal(pending)).status, 'cancelled');
  assert.ok(!JSON.stringify(db.prepare('SELECT params FROM speech_jobs').all()).includes('test-secret'));
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb();
  assert.equal((await request('/settings')).mode, 'api');
  assert.equal((await request('/settings')).api.has_key, true);
  assert.deepEqual((await request(`/characters/${characterId}/api-voice`)).params, profile);
  assert.deepEqual(getDb().prepare("SELECT * FROM voices WHERE id='local-voice'").get(), local);

  // Cloning assets and remote IDs live separately from every local recording.
  const uploadSample = async (buffer, status = 201) => {
    const response = await fetch(`${base}/api/tts/characters/${characterId}/api-samples?name=reference.wav`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  };
  upstream = 'ok';
  await request('/settings', { mode: 'local' }, 'PUT');
  await uploadSample(wav(), 400);
  await request('/settings', { mode: 'api', api: { endpoint: base + '/upstream', model: 'clone-model', upload_endpoint: base + '/upload-voice' } }, 'PUT');
  const sample = await uploadSample(wav());
  assert.match(sample.preview_url, /previews\/.*\.wav$/);
  assert.equal((await fetch(base + sample.preview_url)).status, 200);
  await uploadSample(wav(31), 400);
  await uploadSample(Buffer.from('not audio'), 400);
  assert.equal((await request(`/characters/${characterId}/api-samples`)).length, 1);
  const refProfile = { ...profile, source: 'references', references: [{ sample_id: sample.id, text: '参考文本' }] };
  await request(`/characters/${characterId}/api-voice`, refProfile, 'PUT');
  assert.equal((await request(`/characters/${characterId}`)).name, '参考音频克隆');
  const refJob = await terminal(await request(route, {}, 'POST', 202));
  assert.equal(refJob.status, 'completed'); assert.notEqual(refJob.id, done.id);
  const wire = received.at(-1).body;
  assert.equal(Object.hasOwn(wire, 'voice'), false); assert.equal(wire.references[0].text, '参考文本');
  assert.match(wire.references[0].audio, /^data:audio\/wav;base64,/);
  assert.ok(!getDb().prepare('SELECT params FROM speech_jobs WHERE id=?').get(refJob.id).params.includes('base64'));
  const changed = await terminal(await request('/preview', { character_id: characterId, text: '你好', api_params: { ...refProfile, references: [{ sample_id: sample.id, text: '另一个文本' }] } }, 'POST', 202));
  assert.notEqual(changed.id, refJob.id);
  const otherId = Number(getDb().prepare('INSERT INTO characters(name,display_name,base_prompt) VALUES(?,?,?)').run('other', '另一个角色', 'other').lastInsertRowid);
  await request(`/characters/${otherId}/api-voice`, refProfile, 'PUT', 400);
  await request('/preview', { character_id: otherId, text: '越权', api_params: refProfile }, 'POST', 400);
  await request(`/characters/${otherId}/api-clones`, { sample_id: sample.id, text: '原文', name: 'name' }, 'POST', 400);
  const cloneBody = { sample_id: sample.id, text: '参考文本', name: '测试声音' };
  const cloned = await request(`/characters/${characterId}/api-clones`, cloneBody, 'POST', 201);
  assert.equal(cloned.voice, 'speech:test-clone'); assert.equal(uploads.length, 1);
  assert.equal(uploads[0].model, 'clone-model'); assert.equal(uploads[0].name, '测试声音'); assert.equal(uploads[0].text, '参考文本');
  assert.equal(uploads[0].authorization, 'Bearer test-secret'); assert.equal(uploads[0].file.toString('ascii', 0, 4), 'RIFF');
  // Creation alone leaves the active character profile untouched.
  assert.equal((await request(`/characters/${characterId}/api-voice`)).params.source, 'references');
  uploadResult = { unexpected: 'shape' };
  assert.match((await request(`/characters/${characterId}/api-clones`, cloneBody, 'POST', 400)).error, /uri/);
  uploadResult = 'error';
  const badUpload = await request(`/characters/${characterId}/api-clones`, cloneBody, 'POST', 400);
  assert.match(badUpload.error, /401/); assert.ok(!badUpload.error.includes('secret-do-not-show'));
  await request(`/characters/${characterId}/api-voice`, { ...refProfile, source: 'voice', voice: cloned.voice }, 'PUT');
  const cloneJob = await terminal(await request(route, {}, 'POST', 202));
  assert.equal(cloneJob.status, 'completed'); assert.equal(received.at(-1).body.voice, cloned.voice); assert.equal(received.at(-1).body.references, undefined);
  upstream = 'delay'; release = undefined;
  const switching = await request('/preview', { character_id: characterId, text: '切换模式取消旧任务', api_params: refProfile }, 'POST', 202);
  for (let n = 0; n < 100 && !release; n++) await new Promise(resolve => setTimeout(resolve, 5));
  await request('/settings', { mode: 'local' }, 'PUT');
  release?.();
  assert.equal((await terminal(switching)).status, 'cancelled');
  assert.deepEqual(getDb().prepare("SELECT * FROM voices WHERE id='local-voice'").get(), local);
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM voice_samples').get().n, 1);
  closeDb();
  const retained = await request(`/characters/${characterId}/api-samples`);
  assert.equal(retained[0].clones[0].voice, cloned.voice);
  assert.equal((await request(`/characters/${characterId}/api-voice`)).params.references[0].sample_id, sample.id);
  assert.equal((await request('/settings')).api.upload_endpoint, base + '/upload-voice');
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);
  const originalSample = getDb().prepare("SELECT * FROM voice_samples WHERE id='local-sample'").get();
  await request('/settings', { mode: 'api' }, 'PUT');
  const localList = await request(`/characters/${characterId}/api-local-voices`);
  assert.equal(localList[0].id, 'local-voice'); assert.equal(localList[0].transcript, '');
  const reused = await request(`/characters/${characterId}/api-samples/from-local`, { voice_id: 'local-voice' }, 'POST', 201);
  assert.equal(reused.source, 'local'); assert.equal(reused.transcript, '');
  assert.equal((await request(`/characters/${characterId}/api-samples/from-local`, { voice_id: 'local-voice' }, 'POST', 201)).id, reused.id);
  assert.equal((await request(`/characters/${otherId}/api-local-voices`)).length, 0);
  await request(`/characters/${otherId}/api-samples/from-local`, { voice_id: 'local-voice' }, 'POST', 400);
  const noTextProfile = { source: 'references', voice: '', references: [{ sample_id: reused.id, text: '' }] };
  upstream = 'ok'; uploadResult = { uri: 'speech:local-clone' };
  await request(`/characters/${characterId}/api-voice`, noTextProfile, 'PUT');
  const localRefJob = await terminal(await request('/preview', { character_id: characterId, api_params: noTextProfile, text: '复用本地音频' }, 'POST', 202));
  assert.equal(localRefJob.status, 'completed'); assert.equal(received.at(-1).body.references[0].text, '');
  const cloneFromLocal = await request(`/characters/${characterId}/api-clones`, { sample_id: reused.id }, 'POST', 201);
  assert.equal(cloneFromLocal.voice, 'speech:local-clone'); assert.equal(uploads.at(-1).text, ''); assert.equal(uploads.at(-1).name, local.name);
  assert.deepEqual(getDb().prepare("SELECT * FROM voice_samples WHERE id='local-sample'").get(), originalSample);
  assert.deepEqual(getDb().prepare("SELECT * FROM voices WHERE id='local-voice'").get(), local);
  assert.deepEqual(await fs.readFile(path.join(dir, 'audio/references/local.wav')), wav());
  await request('/settings', { local_model: 'bad-version' }, 'PUT', 400);
  await request('/settings', { local_model: '2.5' }, 'PUT', 400);
  getDb().prepare("INSERT OR REPLACE INTO system_settings(setting_key,setting_value) VALUES ('tts_local_model','2.5')").run();
  assert.equal((await request('/settings')).local_model, '2.0', 'old 2.5 selections migrate without losing voice data');
  getDb().prepare("INSERT OR REPLACE INTO system_settings(setting_key,setting_value) VALUES ('tts_local_model','voxcpm-2.0')").run();
  assert.equal((await request('/settings')).local_model, '2.0', 'removed model selections migrate without losing voice data');
  await request('/settings', { local_model: 'voxcpm-2.0' }, 'PUT', 400);
  await request('/settings', { local_model: '2.0' }, 'PUT');
  closeDb(); assert.equal((await request('/settings')).local_model, '2.0');
  await request('/settings', { local_model: '2.0', mode: 'local' }, 'PUT');
  assert.equal((await request(`/characters/${characterId}`)).voice_id, 'local-voice');
});
