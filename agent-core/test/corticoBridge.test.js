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
  labImageTask: ({ conversationId, desc }) => { labDraws.push(desc); return Number(db.prepare("INSERT INTO image_tasks(conversation_id,prompt_original,status) VALUES(?,?,'running')").run(conversationId, desc).lastInsertRowid); },
  speech: args => { speechArguments = args; return { id: 'speech-fixture', status: 'queued' }; },
  deriveStyle: async base => { derivedPrompts.push(base); return { behavior_style: `derived:${base.slice(0, 4)}`, reply_style: '温和**回复限制在30字内**' }; },
}));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/cortico`;
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
let characterId, derivedPrompts = [], labDraws = [];
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await localFetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

test('setup defaults, validation and persistence', async () => {
  characterId = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,short_prompt) VALUES(?,?,?,?)').run('cortico-test', '星星', '你是星星。\n## 你的外观\n银发蓝眼。', '星星性格温和。').lastInsertRowid);
  const initial = await request('/admin/settings');
  assert.equal(initial.data.settings.enabled, true);
  assert.equal(initial.data.token, undefined);
  assert.equal((await request('/health')).data.ok, true);
  assert.equal((await request('/admin/settings', { method: 'PUT', body: { enabled: false, character_id: characterId } })).data.settings.enabled, true);
  assert.equal((await request('/admin/settings', { method: 'PUT', body: { public_url: 'javascript:alert(1)' } })).status, 400);
  assert.match((await request('/admin/settings', { method: 'PUT', body: { public_url: 'invalid-url' } })).data.error, /服务根地址/);
  const saved = await request('/admin/settings', { method: 'PUT', body: { enabled: true, character_id: characterId } });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(getSetting('cortico_bridge')).character_id, characterId);
  assert.equal((await request('/admin/settings')).data.settings.character_id, characterId);
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
  await request('/admin/settings', { method: 'PUT', body: { inject_persona: false } });
  assert.equal((await request('/bootstrap')).data.persona, null);
  await request('/admin/settings', { method: 'PUT', body: { inject_persona: true } });
});

test('persona styles derive per character and persist into bootstrap and admin persona', async () => {
  // 提炼端点是纯预览：返回风格但不落库。
  const preview = await request('/admin/derive-style', { method: 'POST', body: {} });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.character_id, characterId);
  assert.equal(preview.data.behavior_style, 'derived:你是星星');
  assert.deepEqual(derivedPrompts, ['你是星星。\n## 你的外观\n银发蓝眼。']);
  assert.equal((await request('/bootstrap')).data.persona.reply_style, '');
  const blankId = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,short_prompt) VALUES(?,?,?,?)').run('cortico-blank', '空白', '', '').lastInsertRowid);
  assert.match((await request('/admin/derive-style', { method: 'POST', body: { character_id: blankId } })).data.error, /没有人格卡片/);
  assert.equal((await request('/admin/derive-style', { method: 'POST', body: { character_id: 999999 } })).status, 404);
  assert.match((await request('/admin/settings', { method: 'PUT', body: { behavior_style: 5 } })).data.error, /必须是字符串/);
  await request('/admin/settings', { method: 'PUT', body: { behavior_style: '冷静行动', reply_style: '温和说话' } });
  const styled = (await request('/bootstrap')).data.persona;
  assert.equal(styled.behavior_style, '冷静行动');
  assert.equal(styled.reply_style, '温和说话');
  const adminPersona = (await request(`/admin/persona/${characterId}`)).data;
  assert.equal(adminPersona.behavior_style, '冷静行动');
  assert.equal(adminPersona.reply_style, '温和说话');
  // 只提交一段时另一段保留原值。
  await request('/admin/settings', { method: 'PUT', body: { reply_style: '简短说话' } });
  assert.deepEqual((await request(`/admin/persona/${characterId}`)).data, { ...adminPersona, reply_style: '简短说话' });
  // 风格按角色独立存储：切换角色各自取各自的。
  const otherId = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt,short_prompt) VALUES(?,?,?,?)').run('cortico-style-other', '月亮', '你是月亮。', '月亮安静。').lastInsertRowid);
  await request('/admin/settings', { method: 'PUT', body: { character_id: otherId, behavior_style: '月夜行动', reply_style: '安静说话' } });
  const switched = (await request('/bootstrap')).data.persona;
  assert.equal(switched.name, '月亮');
  assert.equal(switched.behavior_style, '月夜行动');
  await request('/admin/settings', { method: 'PUT', body: { character_id: characterId } });
  const restored = (await request('/bootstrap')).data.persona;
  assert.equal(restored.behavior_style, '冷静行动');
  assert.equal(restored.reply_style, '简短说话');
});

test('clear-context proxies Cortico session storage clear and reports failures', async () => {
  const cleared = [];
  let clearStatus = 200;
  const webui = express();
  webui.post('/api/storage/clear', (req, res) => { cleared.push(req.query); res.status(clearStatus).json(clearStatus === 200 ? { ok: true, result: '已清空' } : { error: 'boom' }); });
  const webuiServer = webui.listen(0, '127.0.0.1');
  await new Promise(resolve => webuiServer.once('listening', resolve));
  const previousPort = (await request('/admin/settings')).data.settings.webui_port;
  try {
    await request('/admin/settings', { method: 'PUT', body: { webui_port: webuiServer.address().port } });
    // 成功路径需要真实 fetch 访问本机 mock；结束后立即还原 stub。
    globalThis.fetch = localFetch;
    assert.equal((await request('/admin/clear-context', { method: 'POST' })).status, 200);
    assert.deepEqual(cleared, [{ owner: 'core', key: 'session' }]);
    clearStatus = 500;
    const failing = await request('/admin/clear-context', { method: 'POST' });
    assert.equal(failing.status, 502);
    assert.match(failing.data.error, /HTTP 500：boom/);
    globalThis.fetch = async () => { throw new Error('External services must not be called in bridge tests'); };
    const unreachable = await request('/admin/clear-context', { method: 'POST' });
    assert.equal(unreachable.status, 502);
    assert.match(unreachable.data.error, /无法连接 Cortico/);
  } finally {
    await request('/admin/settings', { method: 'PUT', body: { webui_port: previousPort } });
    await new Promise(resolve => webuiServer.close(resolve));
  }
});

test('every read tool works with empty state; invalid dates and write aliases are rejected', async () => {
  for (const path of ['/characters', '/character', '/appearance', '/moments', '/schedule', '/newspaper', '/diary', '/world']) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.data)}`);
  }
  assert.equal((await request('/newspaper?date=2026-02-30')).status, 400);
  assert.equal((await request('/diary?date=nope')).status, 400);
  for (const path of ['/moments/stream', '/moments/generate']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/moments/1/like', { method: 'POST', body: {} })).status, 404);
});

test('moments pagination and saved schedule share application data', async () => {
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
  db.prepare('INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES(?,?,?)').run(characterId, getLocalDateKey(), JSON.stringify([{ startTime: '00:00', endTime: '23:59', activity: '阅读', replyDelay: 0 }]));
  assert.equal((await request('/schedule')).data.activities[0].activity, '阅读');
});

test('schedule defaults to the surrounding hour and returns the day only on request', async () => {
  const hhmm = min => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  db.prepare('INSERT OR REPLACE INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES(?,?,?)').run(
    characterId,
    getLocalDateKey(),
    JSON.stringify([
      { startTime: hhmm(nowMin + 20), endTime: hhmm(nowMin + 40), activity: '手边的事', replyDelay: 0 },
      { startTime: hhmm(nowMin + 300), endTime: hhmm(nowMin + 330), activity: '很久之后的事', replyDelay: 0 },
    ])
  );
  const nearby = (await request('/schedule')).data;
  assert.equal(nearby.scope, 'nearby');
  assert.match(nearby.time, /^\d{2}:\d{2}$/);
  assert.deepEqual(nearby.activities.map(a => a.activity), ['手边的事']);
  for (const flag of ['full=1', 'full=true']) {
    const full = (await request(`/schedule?${flag}`)).data;
    assert.equal(full.scope, 'full');
    assert.deepEqual(full.activities.map(a => a.activity), ['手边的事', '很久之后的事']);
  }
});

test('permissions apply to discovery, content details and media task execution', async () => {
  await request('/admin/settings', { method: 'PUT', body: { tools: ['characters'] } });
  assert.ok((await request('/bootstrap')).data.tools.every(t => t.group === 'characters'));
  for (const path of ['/moments', '/appearance', '/schedule', '/diary', '/newspaper', '/world']) assert.equal((await request(path)).status, 403);
  for (const path of ['/moments/1', '/moments/1/images', '/tasks/1', '/speech/voice-fixture']) assert.equal((await request(path)).status, 403);
  assert.equal((await request('/generate', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/draw', { method: 'POST', body: { requirement: '猫' } })).status, 403);
  assert.equal((await request('/tts', { method: 'POST', body: { text: '你好' } })).status, 403);
  await request('/admin/settings', { method: 'PUT', body: { tools: [...new Set(toolCatalog.map(t => t.group))] } });
});

test('retired events endpoints respond 404 and the events group is dropped from settings', async () => {
  for (const path of ['/events', '/events?limit=2&offset=0', '/events/by-id/123', '/events/by-id/town%3A1', '/events/by-id/bfeat%3A1']) {
    assert.equal((await request(path)).status, 404, path);
  }
  assert.ok(toolCatalog.every(t => t.group !== 'events'));
  // 旧配置/旧客户端里遗留的 events 分组静默剔除，其余分组照常生效。
  const saved = await request('/admin/settings', { method: 'PUT', body: { tools: ['characters', 'events'] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.settings.tools, ['characters']);
  assert.equal((await request('/newspaper')).status, 403);
  await request('/admin/settings', { method: 'PUT', body: { tools: [...new Set(toolCatalog.map(t => t.group))] } });
});

test('newspaper and diary queries return saved dated content without generating it', async () => {
  db.prepare('INSERT INTO town_newspapers(publish_date,name,items_json) VALUES(?,?,?)').run('2026-10-24', '镇上日报', JSON.stringify([{ title: '秋日集市', content: '大家在广场散步。' }]));
  db.prepare("INSERT INTO character_diaries(character_id,diary_date,title,content,images,status) VALUES(?,?,?,?,?,'completed')").run(characterId, '2026-10-24', '晴天', '今天去花园散步。', JSON.stringify(['/images/diary/one.png']));
  const paper = (await request('/newspaper?date=2026-10-24')).data.newspaper;
  assert.equal(paper.items[0].title, '秋日集市');
  const diary = (await request('/diary?date=2026-10-24')).data;
  assert.equal(diary.diary.content, '今天去花园散步。');
  assert.deepEqual(diary.diary.images, ['/images/diary/one.png']);
  assert.equal(diary.generating, false);
  assert.equal((await request('/diary?date=2026-10-23')).data.diary, null);
  assert.equal((await request('/newspaper?date=2026-10-23')).data.newspaper, null);
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

test('draw routes free-form descriptions through the image lab chain', async () => {
  const body = { requirement: '画一只戴帽子的橘猫', session_id: 'qq:GroupMessage:1', request_id: 'draw-1' };
  const [a, b] = await Promise.all([request('/draw', { method: 'POST', body }), request('/draw', { method: 'POST', body })]);
  assert.equal(a.status, 202);
  assert.ok(b.status === 202 || b.status === 200, `b.status=${b.status}`); // 任务落库快的重放走幂等路径
  assert.equal(a.data.task_id, b.data.task_id);
  assert.deepEqual(labDraws, ['画一只戴帽子的橘猫']);
  assert.equal((await request('/draw', { method: 'POST', body })).data.task_id, a.data.task_id);
  // 相同描述换 request_id（world 侧由 nonce 派生）得到新任务；与 /generate 命名空间隔离。
  const redrawn = await request('/draw', { method: 'POST', body: { ...body, request_id: 'draw-2' } });
  assert.notEqual(redrawn.data.task_id, a.data.task_id);
  db.prepare("UPDATE image_tasks SET status='done',output_paths=? WHERE id=?").run(JSON.stringify(['/images/lab.png']), a.data.task_id);
  assert.equal((await request(`/tasks/${a.data.task_id}`)).data.image.url, '/images/lab.png');
  assert.equal((await request('/draw', { method: 'POST', body: { requirement: 'x'.repeat(4001), session_id: 's', request_id: 'r' } })).status, 400);
  assert.equal((await request('/draw', { method: 'POST', body: { session_id: 's', request_id: 'r' } })).status, 400);
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

test('admin surface rejects cross-site access', async () => {
  assert.equal((await request('/admin/settings')).status, 200);
  assert.equal((await request('/admin/settings', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await request('/admin/settings', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
});
