import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.DB_PATH = ':memory:';
const localFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External services must not be called in bridge tests'); };
const { getDb } = await import('../src/db/index.js');
const { getSetting } = await import('../src/db/settings.js');
const { createCorticoRouter, toolCatalog } = await import('../src/cortico-bridge/router.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');
const db = getDb();
let imageCalls = 0, speechArguments;
const app = express();
app.use(express.json());
app.use('/api/cortico', createCorticoRouter({
  imagePrompt: async () => { imageCalls++; await new Promise(resolve => setTimeout(resolve, 20)); return 'test scene'; },
  imageTask: ({ conversationId, prompt }) => Number(db.prepare("INSERT INTO image_tasks(conversation_id,prompt_original,status) VALUES(?,?,'running')").run(conversationId, prompt).lastInsertRowid),
  speech: args => { speechArguments = args; return { id: 'speech-fixture', status: 'queued' }; },
}));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/cortico`;
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
let token, characterId;
async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const response = await localFetch(base + path, { method, headers: { ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

test('setup defaults, validation, persistence and strict authentication', async () => {
  characterId = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,short_prompt) VALUES(?,?,?,?)').run('cortico-test', '星星', '你是星星。\n## 你的外观\n银发蓝眼。', '星星性格温和。').lastInsertRowid);
  const initial = await request('/admin/settings', { auth: false });
  token = initial.data.token;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(initial.data.settings.enabled, false);
  assert.equal((await request('/health', { auth: false })).status, 401);
  assert.equal((await request('/health', { headers: { Authorization: token } })).status, 401);
  assert.equal((await request('/health')).status, 403);
  assert.equal((await request('/admin/settings', { auth: false, method: 'PUT', body: { enabled: true } })).status, 400);
  assert.equal((await request('/admin/settings', { auth: false, method: 'PUT', body: { public_url: 'javascript:alert(1)' } })).status, 400);
  assert.match((await request('/admin/settings', { auth: false, method: 'PUT', body: { public_url: 'invalid-url' } })).data.error, /服务根地址/);
  const saved = await request('/admin/settings', { auth: false, method: 'PUT', body: { enabled: true, character_id: characterId } });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(getSetting('cortico_bridge')).character_id, characterId);
  assert.equal((await request('/admin/settings', { auth: false })).data.settings.character_id, characterId);
  assert.equal((await request('/health')).data.ok, true);
});

test('stable initial persona excludes dynamic outfits; appearance uses shared assembly', async () => {
  const before = (await request('/bootstrap')).data;
  db.prepare('INSERT INTO global_outfits(name,description,enabled) VALUES(?,?,1)').run('节日服饰', 'red coat');
  const after = (await request('/bootstrap')).data;
  assert.equal(before.persona.system_prompt, after.persona.system_prompt);
  assert.match(after.persona.system_prompt, /银发蓝眼/);
  const appearance = await request('/appearance');
  assert.equal(appearance.status, 200);
  assert.match(appearance.data.appearance, /red coat/);
  assert.equal((await request('/character?character_id=999999')).status, 404);
  assert.equal((await request('/character?character_id=nope')).status, 400);
  await request('/admin/settings', { auth: false, method: 'PUT', body: { inject_persona: false } });
  assert.equal((await request('/bootstrap')).data.persona, null);
  await request('/admin/settings', { auth: false, method: 'PUT', body: { inject_persona: true } });
});

test('every read tool works with empty state; invalid dates and write aliases are rejected', async () => {
  for (const path of ['/characters', '/character', '/appearance', '/moments', '/events', '/schedule', '/newspaper', '/diary', '/world']) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.data)}`);
  }
  assert.equal((await request('/newspaper?date=2026-02-30')).status, 400);
  assert.equal((await request('/diary?date=nope')).status, 400);
  for (const path of ['/moments/stream', '/events/stream', '/moments/generate', '/events/generate']) assert.equal((await request(path)).status, 404);
  for (const path of ['/moments/1/like', '/events/1/choose']) assert.equal((await request(path, { method: 'POST', body: {} })).status, 404);
});

test('moments pagination, event detail and saved schedule share application data', async () => {
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO moment_posts(character_id,content,status) VALUES(?,?,'done')").run(characterId, `动态${i}`);
  const feed = (await request('/moments?limit=2')).data;
  assert.equal(feed.posts.length, 2);
  assert.equal(feed.hasMore, true);
  const post = (await request(`/moments/${feed.posts[0].id}`)).data;
  assert.equal(post.content, '动态2');
  assert.ok(Array.isArray(post.comments));
  assert.equal((await request(`/moments?limit=2&before_id=${feed.posts[1].id}`)).data.posts.length, 1);
  const otherId = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,short_prompt) VALUES(?,?,?,?)').run('cortico-other', '月亮', '你是月亮。', '月亮性格安静。').lastInsertRowid);
  const otherPostId = Number(db.prepare("INSERT INTO moment_posts(character_id,content,status) VALUES(?,?,'done')").run(otherId, '别人的动态').lastInsertRowid);
  const mine = (await request(`/moments?character_id=${characterId}`)).data.posts;
  assert.equal(mine.length, 3);
  assert.ok(mine.every(p => p.character_id === characterId));
  assert.deepEqual((await request(`/moments?character_id=${otherId}`)).data.posts.map(p => p.content), ['别人的动态']);
  assert.equal((await request('/moments?character_id=999999')).status, 404);
  assert.equal((await request('/moments?character_id=nope')).status, 400);
  assert.equal((await request('/moments')).data.posts.length, 4);
  db.prepare('UPDATE moment_posts SET images = ? WHERE id = ?').run(JSON.stringify(['/images/moments/a.png', '/images/moments/b.png']), otherPostId);
  assert.deepEqual((await request(`/moments/${otherPostId}/images`)).data, { id: otherPostId, images: ['/images/moments/a.png', '/images/moments/b.png'] });
  assert.equal((await request('/moments/999999/images')).status, 404);
  const eventId = Number(db.prepare("INSERT INTO character_events(character_id,event_type_key,status,title,expires_at) VALUES(?,'test','open','偶遇',datetime('now','+1 day'))").run(characterId).lastInsertRowid);
  assert.equal((await request(`/events/by-id/${eventId}`)).data.title, '偶遇');
  assert.equal((await request('/events/by-id/town%3A999999')).data.error, 'event_not_found');
  assert.equal((await request('/events/by-id/bfeat%3A999999')).data.error, 'event_not_found');
  db.prepare('INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES(?,?,?)').run(characterId, getLocalDateKey(), JSON.stringify([{ startTime: '00:00', endTime: '23:59', activity: '阅读', replyDelay: 0 }]));
  assert.equal((await request('/schedule')).data.activities[0].activity, '阅读');
});

test('permissions apply to discovery and execution, and disabled bridge rejects tools', async () => {
  await request('/admin/settings', { auth: false, method: 'PUT', body: { tools: ['characters'] } });
  assert.ok((await request('/bootstrap')).data.tools.every(t => t.group === 'characters'));
  for (const path of ['/moments', '/appearance', '/events', '/schedule', '/diary', '/newspaper', '/world']) assert.equal((await request(path)).status, 403);
  assert.equal((await request('/generate', { method: 'POST', body: {} })).status, 403);
  await request('/admin/settings', { auth: false, method: 'PUT', body: { enabled: false } });
  assert.equal((await request('/bootstrap')).status, 403);
  await request('/admin/settings', { auth: false, method: 'PUT', body: { enabled: true, tools: [...new Set(toolCatalog.map(t => t.group))] } });
});

test('image requests coalesce retries, survive rereads and isolate MaiBot tasks', async () => {
  const body = { requirement: '在花园拍照', session_id: 'qq:GroupMessage:1', request_id: 'message-1' };
  const [a, b] = await Promise.all([request('/generate', { method: 'POST', body }), request('/generate', { method: 'POST', body })]);
  assert.equal(a.status, 202); assert.equal(b.status, 202);
  assert.equal(a.data.task_id, b.data.task_id); assert.equal(imageCalls, 1);
  assert.equal((await request('/generate', { method: 'POST', body })).data.task_id, a.data.task_id);
  assert.equal(imageCalls, 1);
  db.prepare("UPDATE image_tasks SET status='done',output_paths=? WHERE id=?").run(JSON.stringify(['/images/test.png']), a.data.task_id);
  assert.equal((await request(`/tasks/${a.data.task_id}`)).data.image.url, '/images/test.png');
  const other = Number(db.prepare("INSERT INTO image_tasks(conversation_id,prompt_original,status) VALUES('maibot_x','other','running')").run().lastInsertRowid);
  assert.equal((await request(`/tasks/${other}`)).status, 404);
  assert.equal((await request('/generate', { method: 'POST', body: { ...body, request_id: '' } })).status, 400);
});

test('TTS validates text and uses the selected character binding', async () => {
  assert.equal((await request('/tts', { method: 'POST', body: { text: '你好' } })).status, 400);
  // Foreign keys remain enabled: create actual voice/sample rows.
  db.prepare("INSERT INTO voice_samples(id,original_path,preview_path,duration,reference_path) VALUES('sample','original.wav','preview.wav',3,'reference.wav')").run();
  db.prepare("INSERT INTO voices(id,character_id,name,sample_id) VALUES('voice',?,'日常','sample')").run(characterId);
  db.prepare("INSERT INTO character_voices(character_id,voice_id,enabled) VALUES(?,'voice',1)").run(characterId);
  const response = await request('/tts', { method: 'POST', body: { text: '你好' } });
  assert.equal(response.status, 202);
  assert.deepEqual(speechArguments, { characterId, voiceId: 'voice', text: '你好' });
  assert.equal((await request('/tts', { method: 'POST', body: { text: 'x'.repeat(1001) } })).status, 400);
});

test('admin surface rejects cross-site access; token rotation revokes previous token', async () => {
  assert.equal((await request('/admin/settings')).status, 403);
  assert.equal((await request('/admin/settings', { auth: false, headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const next = await request('/admin/rotate-token', { auth: false, method: 'POST' });
  assert.notEqual(next.data.token, token);
  assert.equal((await request('/health')).status, 401);
  token = next.data.token;
  assert.equal((await request('/health')).status, 200);
});
