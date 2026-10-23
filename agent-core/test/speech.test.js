import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { speechText, speechCacheKey, speechParams, MODEL_VERSION } from '../src/services/speechText.js';
import { createGpuQueue } from '../src/services/gpuQueue.js';
import { migrateTtsSchema, recoverSpeechJobs } from '../src/db/ttsSchema.js';

test('dialogue cleanup keeps speech and removes stage directions/internal material', () => {
  assert.equal(speechText('你好！[emoji:开心]（挥手）*坐下*<think>secret</think>![图片](x.png)\n今天好吗？'), '你好！ 今天好吗？');
  assert.equal(speechText('[图片:cat]<image>cat</image>（笑）'), '');
  assert.equal(speechText('I am here. 日本語も話せます。'), 'I am here. 日本語も話せます。');
  assert.equal(speechText('**你好**，*挥手*我是[邻舍](https://example.com)。'), '你好，我是邻舍。');
  assert.equal(speechText('【自定义表情】你好[开心]', ['自定义表情', '开心']), '你好');
});
test('cache covers reference, model, text and synthesis defaults; parameter order is irrelevant', () => {
  const base = speechCacheKey('你好', 'hash', speechParams());
  assert.equal(base, speechCacheKey('你好', 'hash', { duration_factor: 1, speed: 1, language: 'zh' }));
  for (const key of [speechCacheKey('好', 'hash', speechParams()), speechCacheKey('你好', 'other', speechParams()),
    speechCacheKey('你好', 'hash', speechParams({ speed: 1.2 })), speechCacheKey('你好', 'hash', speechParams(), 'other-model')]) assert.notEqual(base, key);
  assert.equal(speechParams({ speed: 2 }).duration_factor, 0.5);
  for (const speed of [0, -1, NaN, Infinity, 3]) assert.throws(() => speechParams({ speed }));
  assert.throws(() => speechParams({ language: 'unknown' }));
});
test('GPU FIFO does not overlap, does not starve images, and recovers from failures', async () => {
  const run = createGpuQueue(), order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = run(async () => { order.push('speech'); await gate; throw new Error('OOM'); });
  const failed = assert.rejects(first, /OOM/);
  const image = run(async () => { order.push('image'); });
  const second = run(async () => { order.push('speech2'); });
  await Promise.resolve(); assert.deepEqual(order, ['speech']);
  release(); await Promise.all([failed, image, second]);
  assert.deepEqual(order, ['speech', 'image', 'speech2']);
});
test('schema recovery and deletion preserve reference assets', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec('CREATE TABLE characters(id INTEGER PRIMARY KEY); CREATE TABLE messages(id INTEGER PRIMARY KEY); INSERT INTO characters VALUES(1); INSERT INTO messages VALUES(1);');
  migrateTtsSchema(db); migrateTtsSchema(db);
  db.exec(`INSERT INTO voice_samples(id,original_path,preview_path,duration) VALUES('s','a','b',10);
    INSERT INTO voices(id,name,sample_id,character_id) VALUES('v','日常','s',1);
    INSERT INTO character_voices VALUES(1,'v',1);
    INSERT INTO speech_jobs(id,cache_key,text,voice_id,voice_version,sample_id,model_version,params,status)
      VALUES('j','key','你好','v',1,'s','model','{}','generating');
    INSERT INTO message_speech VALUES(1,'j');`);
  assert.throws(() => db.prepare("DELETE FROM voices WHERE id='v'").run(), /FOREIGN KEY/);
  recoverSpeechJobs(db);
  assert.equal(db.prepare('SELECT status FROM speech_jobs').pluck().get(), 'failed');
  db.exec('DELETE FROM characters; DELETE FROM messages; DELETE FROM voices;');
  assert.equal(db.prepare('SELECT count(*) FROM message_speech').pluck().get(), 0);
  assert.equal(db.prepare('SELECT count(*) FROM voice_samples').pluck().get(), 1);
  assert.equal(db.prepare('SELECT count(*) FROM speech_jobs').pluck().get(), 1);
  db.close();
});

test('legacy migration retains owners and unused recordings without allowing shared bindings', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY, name TEXT, display_name TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY);
    CREATE TABLE voices(id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
    INSERT INTO characters VALUES(1,'elysia','爱莉希雅'),(2,'anby','安比'),(3,'a','同名'),(4,'b','同名');
    INSERT INTO voices VALUES('v','爱莉希雅 · 日常',''),('old','爱莉希雅 · 日常 2',''),
      ('custom','自定义',''),('unknown','未命名',''),('ambiguous','同名 · 日常','');
    CREATE TABLE character_voices(character_id INTEGER PRIMARY KEY REFERENCES characters(id), voice_id TEXT REFERENCES voices(id), enabled INTEGER DEFAULT 1);
    INSERT INTO character_voices VALUES(1,'v',1),(2,'v',1),(3,'custom',1);`);
  migrateTtsSchema(db);
  assert.equal(db.prepare("SELECT character_id FROM voices WHERE id='v'").pluck().get(), 1);
  assert.equal(db.prepare("SELECT character_id FROM voices WHERE id='old'").pluck().get(), 1);
  assert.equal(db.prepare("SELECT character_id FROM voices WHERE id='custom'").pluck().get(), 3);
  assert.equal(db.prepare("SELECT character_id FROM voices WHERE id='unknown'").pluck().get(), null);
  assert.equal(db.prepare("SELECT character_id FROM voices WHERE id='ambiguous'").pluck().get(), null);
  assert.equal(db.prepare('SELECT count(*) FROM character_voices WHERE character_id=2').pluck().get(), 0);
  db.exec("UPDATE voices SET name='改名' WHERE id='old'; DELETE FROM character_voices;");
  migrateTtsSchema(db);
  assert.equal(db.prepare("SELECT character_id FROM voices WHERE id='old'").pluck().get(), 1, 'unbinding and renaming do not erase ownership');
  assert.equal(db.prepare('SELECT count(*) FROM character_voices').pluck().get(), 2, 'legacy characters with voices automatically get a current voice');
  assert.equal(db.prepare('SELECT count(*) FROM voices').pluck().get(), 5, 'migration never deletes recordings');
  db.close();
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linshe-tts-test-'));
process.env.DB_PATH = ':memory:';
process.env.TTS_AUDIO_DIR = root;
const originalFetch = globalThis.fetch;
let inferCount = 0, acquireCount = 0, failInference = false, offline = false, fetchFailure = null;
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.includes(':7861')) {
    if (fetchFailure) throw fetchFailure;
    if (offline) throw new Error('offline');
    if (u.endsWith('/health')) return Response.json({ model_version: MODEL_VERSION, ready: true });
    if (u.endsWith('/unload')) return Response.json({ unloaded: true });
    if (u.endsWith('/synthesize')) {
      inferCount++;
      if (failInference) return Response.json({ error: 'CUDA out of memory' }, { status: 500 });
      const body = JSON.parse(options.body);
      await fs.writeFile(path.join(root, body.output), 'test-wave');
      return Response.json({ ok: true });
    }
  }
  if (u.includes('/linshe/gpu/')) {
    if (u.endsWith('/acquire')) acquireCount++;
    return Response.json({ ok: true });
  }
  throw new Error(`Test forbids unexpected network: ${u}`);
};
const { getDb, closeDb } = await import('../src/db/index.js');
const service = await import('../src/services/speechService.js');
const assets = await import('../src/services/voiceAssets.js');
const gpu = await import('../src/services/speechGpu.js');
after(async () => { await gpu.recoverSpeechGpu(); globalThis.fetch = originalFetch; closeDb(); await fs.rm(root, { recursive: true, force: true }); });

async function terminal(id) {
  for (let i = 0; i < 200; i++) {
    const job = service.getSpeechJob(id);
    if (!['queued', 'generating'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish');
}
test('TTS transport failures explain connection and timeout errors while preserving their cause', async () => {
  const { ttsRequest, ttsHealth } = await import('../src/services/indexTtsClient.js');
  try {
    fetchFailure = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    await assert.rejects(ttsRequest('/health'), error => error.cause === fetchFailure && /无法连接本地语音服务/.test(error.message));
    assert.match((await ttsHealth()).error, /请启动服务后重试/);
    fetchFailure = new DOMException('timed out', 'TimeoutError');
    await assert.rejects(ttsRequest('/health'), /响应超时/);
  } finally { fetchFailure = null; }
});

test('saved bubble identity, dedup, history, cache invalidation, retry and offline isolation', async () => {
  const db = getDb();
  const char = db.prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('tts-test','测试','persona')").run().lastInsertRowid;
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  db.exec(`INSERT INTO voice_samples(id,original_path,preview_path,reference_path,content_hash,duration) VALUES('tts-s','a','b','references/s.wav','hash',10);
    INSERT INTO voices(id,name,sample_id) VALUES('tts-v','日常','tts-s');`);
  db.prepare('UPDATE voices SET character_id=? WHERE id=?').run(char, 'tts-v');
  db.prepare('INSERT INTO character_voices(character_id,voice_id) VALUES(?,?)').run(char, 'tts-v');
  const msg = db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,'assistant','你好呀')").run(`char_${char}`).lastInsertRowid;
  assert.throws(() => service.speakMessage(char, msg), /启用/);
  service.setSpeechSettings(true);
  assert.throws(() => service.speakMessage(char + 1, msg), /不属于/);
  const user = db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,'user','不要读')").run(`char_${char}`).lastInsertRowid;
  assert.throws(() => service.speakMessage(char, user), /不属于/);
  assert.throws(() => service.requestSpeech({ characterId: char, voiceId: 'tts-v', text: '（微笑）' }), /没有可朗读/);
  const first = service.speakMessage(char, msg);
  assert.equal(service.speakMessage(char, msg).id, first.id);
  assert.equal((await terminal(first.id)).status, 'completed');
  assert.equal(inferCount, 1);
  assert.equal(service.speakMessage(char, msg).id, first.id);
  assert.equal(inferCount, 1);
  db.prepare("UPDATE voices SET speed=1.2,version=2 WHERE id='tts-v'").run();
  const changed = service.speakMessage(char, msg);
  assert.notEqual(changed.id, first.id); assert.equal((await terminal(changed.id)).status, 'completed');
  assert.equal(service.getSpeechJob(first.id).voice_version, 1);
  assert.equal(acquireCount, 1, 'consecutive synthesis reuses the lease and loaded worker');
  await gpu.withImageGpu(async () => {});
  failInference = true;
  const failed = service.requestSpeech({ characterId: char, voiceId: 'tts-v', text: '失败测试' });
  assert.match((await terminal(failed.id)).error, /out of memory/);
  failInference = false;
  const retry = service.requestSpeech({ characterId: char, voiceId: 'tts-v', text: '失败测试' });
  assert.notEqual(retry.id, failed.id); assert.equal((await terminal(retry.id)).status, 'completed');
  offline = true;
  const before = acquireCount;
  const unavailable = service.requestSpeech({ characterId: char, voiceId: 'tts-v', text: '服务离线测试' });
  assert.equal((await terminal(unavailable.id)).status, 'failed');
  assert.match(service.getSpeechJob(unavailable.id).error, /无法连接本地语音服务/);
  assert.equal(acquireCount, before, 'offline service must not lock ComfyUI');
  offline = false;
  const cancelled = service.requestSpeech({ characterId: char, voiceId: 'tts-v', text: '取消测试' });
  service.cancelSpeech(cancelled.id);
  assert.equal((await terminal(cancelled.id)).status, 'cancelled');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(service.getSpeechJob(cancelled.id).status, 'cancelled');
});

test('audio import/crop uses bounded decoding, preserves original, and rejects invalid clips', async () => {
  // Two seconds of PCM, no external fixture or model required.
  const frames = 48000, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(i * 2 * Math.PI * 220 / 24000)), 44 + i * 2);
  const sample = await assets.importAudio(wav);
  assert.equal(sample.peaks.length, 240);
  assert.ok(sample.duration >= 1.9);
  const clip = await assets.cropAudio(sample, 0, 1.5);
  assert.ok(clip.content_hash); assert.notEqual(clip.id, sample.id);
  assert.deepEqual(await fs.readFile(assets.audioPath(sample.original_path)), wav);
  await assert.rejects(assets.cropAudio(sample, 1.5, 1), /片段/);
  await assert.rejects(assets.cropAudio(sample, 0, 16), /片段/);
  assert.throws(() => assets.audioPath('../escape'), /无效/);
});

test('browser-style streaming WebM without duration imports and still enforces the duration limit', async () => {
  const exec = promisify(execFile);
  const record = async seconds => (await exec(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=24000',
    '-t', String(seconds), '-c:a', 'libopus', '-live', '1', '-f', 'webm', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
  const sample = await assets.importAudio(await record(2));
  assert.ok(sample.duration > 1.9 && sample.duration < 2.2);
  const probed = await exec(process.env.FFPROBE_PATH || 'ffprobe', ['-v','error','-show_entries','format=duration','-of','json', assets.audioPath(sample.original_path)], { windowsHide: true });
  assert.equal(JSON.parse(probed.stdout).format.duration, undefined);
  await assert.rejects(assets.importAudio(await record(121)), /120/);
});

test('HTTP audio lifecycle, character-owned voices and cross-character guards', async () => {
  const { default: express } = await import('express');
  const { default: router } = await import('../src/routes/tts.js');
  const app = express();
  app.use(express.json()); app.use('/api/tts', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  const request = async (url, body, method = 'POST') => {
    const response = await originalFetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const previewFiles = await fs.readdir(path.join(root, 'previews'));
    const buffer = await fs.readFile(path.join(root, 'previews', previewFiles[0]));
    const upload = await originalFetch(`${base}/samples`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer });
    assert.equal(upload.status, 201);
    const sample = await upload.json();
    assert.equal(sample.peaks.length, 240);
    assert.equal((await request(`/samples/${sample.id}/crop`, { start: 1, end: 0 })).status, 400);
    const crop = await request(`/samples/${sample.id}/crop`, { start: 0, end: 1.5 });
    assert.equal(crop.status, 201);
    const originalMedia = await originalFetch(base.replace('/api/tts', '') + sample.preview_url, { headers: { Range: 'bytes=0-43' } });
    assert.equal(originalMedia.status, 206);
    assert.equal((await originalMedia.arrayBuffer()).byteLength, 44);
    const character = getDb().prepare("SELECT id FROM characters WHERE name='tts-test'").pluck().get();
    const voice = await request('/voices', { character_id: character, sample_id: crop.body.id, name: '接口测试' });
    assert.equal(voice.status, 201);
    assert.equal(voice.body.version, 1);
    assert.equal(voice.body.reference_url, crop.body.reference_url, 'saved voice remains playable when binding needs a retry');
    assert.equal(voice.body.character_id, character);
    const other = Number(getDb().prepare("INSERT INTO characters(name,display_name,base_prompt) VALUES('anby-test','安比','test')").run().lastInsertRowid);
    const ownList = await (await originalFetch(`${base}/voices?character_id=${character}`)).json();
    const otherList = await (await originalFetch(`${base}/voices?character_id=${other}`)).json();
    assert.ok(ownList.some(row => row.id === voice.body.id));
    assert.deepEqual(otherList, []);
    assert.equal((await request('/voices', { sample_id: crop.body.id, name: '无归属' })).status, 400);
    assert.equal((await request(`/characters/${other}`, { voice_id: voice.body.id }, 'PUT')).status, 400);
    assert.equal((await request('/preview', { character_id: other, voice_id: voice.body.id, text: '不能跨角色试听' })).status, 400);
    assert.equal((await request(`/voices/${voice.body.id}`, { character_id: other, sample_id: crop.body.id, name: '不能跨角色修改' }, 'PUT')).status, 400);
    assert.throws(() => service.requestSpeech({ characterId: other, voiceId: voice.body.id, text: '不能绕过接口' }), /不属于/);
    assert.equal((await request('/voices', { sample_id: crop.body.id, name: '   ' })).status, 400);
    const currentVoice = await originalFetch(`${base}/characters/${character}`);
    assert.equal(currentVoice.status, 200);
    assert.equal((await currentVoice.json()).voice_id, voice.body.id);
    assert.equal(await (await originalFetch(`${base}/characters/${other}`)).json(), null);
    const bindings = await (await originalFetch(`${base}/bindings`)).json();
    assert.ok(bindings.some(row => row.character_id === character && row.voice_id === voice.body.id && row.name === '接口测试'));
    assert.equal((await request(`/characters/${character}`, { voice_id: 'tts-v' }, 'PUT')).status, 200);
    assert.equal((await (await originalFetch(`${base}/characters/${character}`)).json()).voice_id, 'tts-v');
    assert.equal((await request(`/characters/${character}`, { voice_id: voice.body.id }, 'PUT')).status, 200);
    const updated = await request(`/voices/${voice.body.id}`, { character_id: character, sample_id: crop.body.id, speed: 1.5 }, 'PUT');
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(updated.body.reference_url, crop.body.reference_url);
    assert.equal(getDb().prepare('SELECT version FROM voices WHERE id=?').pluck().get(voice.body.id), 2);
    assert.equal((await request('/settings', { enabled: 'false' }, 'PUT')).status, 400);
    assert.equal((await request(`/characters/${character}`, { voice_id: null }, 'PUT')).status, 400);
    assert.equal(getDb().prepare('SELECT character_id FROM voices WHERE id=?').pluck().get(voice.body.id), character);
    assert.equal((await request(`/characters/${other}`, { voice_id: voice.body.id }, 'PUT')).status, 400);
    const deleted = await request(`/voices/${voice.body.id}`, {}, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.current_voice.voice_id, 'tts-v', 'deleting the current voice automatically uses the remaining own voice');
    assert.equal((await request('/voices/tts-v', {}, 'DELETE')).body.current_voice, null);
    assert.equal(await (await originalFetch(`${base}/characters/${character}`)).json(), null);
    assert.ok(getDb().prepare('SELECT id FROM voice_samples WHERE id=?').get(crop.body.id));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
