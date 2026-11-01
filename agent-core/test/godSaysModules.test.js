import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { GOD_TOOLS, createGodTools, validateToolArgs } from '../src/services/godSays/tools.js';
import { GOD_MODULE_TOOLS, moduleTool, buildModuleRequest, executeModuleTool } from '../src/services/godSays/moduleTools.js';
import { createGodLocalApi, publicToolData, readChatStream } from '../src/services/godSays/localApi.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodMemory } from '../src/services/godSays/memory.js';
import { createWorldEventService } from '../src/services/godSays/worldEvents.js';

test('capability registry has unique bounded native tools and validates identifiers, booleans and member lists', () => {
  assert.ok(GOD_TOOLS.length > 70 && GOD_TOOLS.length <= 128);
  assert.equal(new Set(GOD_TOOLS.map(t => t.function.name)).size, GOD_TOOLS.length);
  assert.ok(new Set(GOD_MODULE_TOOLS.map(t => t.module)).size >= 20);
  assert.ok(GOD_MODULE_TOOLS.every(t => t.module !== '小镇' && !t.path.startsWith('/api/town/')));
  for (const tool of GOD_TOOLS) {
    assert.equal(tool.function.parameters.additionalProperties, false);
    assert.doesNotThrow(() => JSON.stringify(tool));
  }
  const enabled = moduleTool('set_outfit_enabled').definition.function.parameters;
  assert.throws(() => validateToolArgs(enabled, { character_id: 1, outfit_id: 1, enabled: 'false' }), /布尔/);
  const group = moduleTool('create_group').definition.function.parameters;
  assert.throws(() => validateToolArgs(group, { name: '群', member_ids: [1, 1] }), /列表/);
  assert.throws(() => validateToolArgs(group, { name: '群', member_ids: [1] }), /列表/);
  assert.throws(() => validateToolArgs(group, { name: '群', member_ids: [1, 2], path: '/api/shutdown' }), /不支持/);
});

test('module mapping keeps path IDs out of bodies, maps query names and keeps private-chat idempotency key', () => {
  assert.deepEqual(buildModuleRequest(moduleTool('send_letter'), { character_id: 3, title: '晚风', content: '你好' }), {
    method: 'POST', path: '/api/mailbox/send', body: { character_id: 3, title: '晚风', content: '你好' }, stream: false,
  });
  assert.deepEqual(buildModuleRequest(moduleTool('set_outfit_enabled'), { character_id: 3, outfit_id: 7, enabled: false }).body, { enabled: 0 });
  assert.equal(buildModuleRequest(moduleTool('search_gallery'), { character_id: 3 }).path, '/api/images/gallery?character=3&limit=20');
  const request = buildModuleRequest(moduleTool('send_private_message'), { character_id: 3, message: '你好' }, { effectKey: 'same-operation' });
  assert.deepEqual(request.body, { message: '你好', image_mode: 'off', client_msg_id: 'god-same-operation' });
  assert.equal(request.path, '/api/characters/3/chat');
  assert.throws(() => buildModuleRequest(moduleTool('read_encounter'), { event_id: '..' }), /编号/);
});

test('local bridge keeps fixed loopback destination, original errors and uncertain write outcomes', async () => {
  const received = [];
  const api = createGodLocalApi({ port: 12345, fetchImpl: async (url, options) => {
    received.push({ url, options });
    return new Response(JSON.stringify({ ok: true, nested: { apiKey: 'never-expose', content: '正文' } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await api({ method: 'GET', path: '/api/items' });
  assert.equal(received[0].url, 'http://127.0.0.1:12345/api/items');
  assert.equal(received[0].options.redirect, 'error');
  assert.deepEqual(result.data, { ok: true, nested: { content: '正文' } });
  await assert.rejects(api({ method: 'GET', path: 'https://example.com/api/items' }), /地址/);
  const invalid = createGodLocalApi({ port: 12345, fetchImpl: async () => new Response('{"error":"库存不足"}', { status: 409, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(invalid({ method: 'POST', path: '/api/items/1/use', body: {} }), e => e.message === '库存不足' && !e.uncertain);
  const lost = createGodLocalApi({ port: 12345, fetchImpl: async () => { throw new Error('连接中断'); } });
  await assert.rejects(lost({ method: 'POST', path: '/api/mailbox/send', body: {} }), e => e.uncertain === true);
  await assert.rejects(lost({ method: 'GET', path: '/api/items' }), e => !e.uncertain);
});

test('chat stream returns saved replies, retains partial result and refuses to claim an unconfirmed reply', async () => {
  const raw = ['event: token\ndata: {"content":"晚上好"}\n\n', 'event: msg_saved\ndata: {"id":1,"role":"user"}\n\n', 'event: msg_saved\ndata: {"id":2,"role":"assistant","content":"晚上好"}\n\n', 'event: error\ndata: {"message":"后续生成中断"}\n\n'].join('');
  const bytes = new TextEncoder().encode(raw);
  const response = new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }));
  const result = await readChatStream(response);
  assert.equal(result.reply, '晚上好');
  assert.equal(result.messages.length, 2);
  assert.equal(result.partial, true);
  await assert.rejects(readChatStream(new Response('event: token\ndata: {"content":"未保存"}\n\n')), e => e.uncertain === true);
});

test('accepted async work remains pending and large module data has explicit bounded truncation', async () => {
  const value = await executeModuleTool(moduleTool('generate_image'), { prompt: '彩虹' }, {}, async () => ({ status: 202, data: { task_id: 4, status: 'running' } }));
  assert.equal(value.status, 'accepted');
  assert.equal(value.data.task_id, 4);
  assert.match(value.note, /确认是否实际完成/);
  const clean = publicToolData({ rows: Array.from({ length: 200 }, () => ({ content: '云'.repeat(10000) })), nested: { password: 'secret' } });
  assert.ok(JSON.stringify(clean).length < 70000);
  assert.equal(clean._truncated, true);
  assert.doesNotMatch(JSON.stringify(clean), /secret/);
});

test('real module routes create groups, letters, relations, library entries and outfits through the agent ledger', async t => {
  process.env.DB_PATH = ':memory:';
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).endsWith('/object_info')) return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('External network forbidden in this test');
    return nativeFetch(url, options);
  });
  const { config } = await import('../src/config.js');
  config.dbPath = ':memory:';
  const { getDb } = await import('../src/db/index.js');
  const db = getDb();
  db.prepare("INSERT INTO characters(id,name,display_name,base_prompt) VALUES (2,'a','阿晴','温柔'),(3,'b','小雨','好奇'),(4,'c','晨星','安静')").run();
  const app = express();
  app.use(express.json());
  const contracts = [];
  const mounts = { emoji: '/api/characters/emoji', expressionStandings: '/api', chat: '/api',
    groups: '/api/groups', mailbox: '/api/mailbox', relationships: '/api/relationships', library: '/api/library', characters: '/api/characters',
    items: '/api/items', diary: '/api/diaries', config: '/api/config', media: '/api/media', presets: '/api/presets',
    schedule: '/api/schedule', moments: '/api/moments', events: '/api/events', portraits: '/api/portraits', memory: '/api/memory',
    images: '/api/images', newspaper: '/api/newspaper', tts: '/api/tts' };
  for (const [route, mount] of Object.entries(mounts)) {
    const router = (await import(`../src/routes/${route}.js`)).default;
    for (const layer of router.stack) {
      if (!layer.route || typeof layer.route.path !== 'string') continue;
      for (const method of Object.keys(layer.route.methods)) contracts.push(`${method.toUpperCase()} ${mount}${layer.route.path === '/' ? '' : layer.route.path}`.replace(/:[a-zA-Z_][\w]*/g, ':id'));
    }
    app.use(mount, router);
  }
  for (const entry of GOD_MODULE_TOOLS) {
    const contract = `${entry.method} ${entry.path}`.replace(/:[a-zA-Z_][\w]*/g, ':id');
    assert.ok(contracts.includes(contract), `${entry.name} must map to an actual registered route: ${contract}`);
  }
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const api = createGodLocalApi({ port: server.address().port });
  const repo = createGodRepository(db);
  const run = repo.start('module-integration', '安排邻舍的事情').run;
  const tools = createGodTools(repo, createWorldEventService(repo), createGodMemory(repo, async () => ''), { api });
  let index = 0;
  const execute = async (name, args) => tools.execute({ id: `module-${index++}`, function: { name, arguments: JSON.stringify(args) } }, run.id, index);
  const created = await execute('create_group', { name: '彩虹茶话会', topic: '一起看彩虹', member_ids: [2, 3] });
  assert.equal(created.ok, true, JSON.stringify(created));
  const groupId = created.value.data.group.id;
  assert.equal((await execute('create_group', { name: '彩虹茶话会', topic: '一起看彩虹', member_ids: [2, 3] })).value.data.group.id, groupId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_chats').get().n, 1, 'write tool does not create duplicate groups');
  assert.equal((await execute('add_group_members', { group_id: groupId, member_ids: [4] })).ok, true);
  assert.equal((await execute('list_groups', {})).value.data.groups[0].members.length, 3);
  const conv = `group_${groupId}`;
  const rawId = db.prepare("INSERT INTO raw_messages(conversation_id,role,content) VALUES (?,'assistant','见闻')").run(conv).lastInsertRowid;
  for (let i = 0; i < 7; i++) db.prepare("INSERT INTO messages(conversation_id,raw_id,role,content,seq) VALUES (?,?,'assistant',?,?)").run(conv, rawId, `消息${i}`, i);
  const recent = await execute('read_group_chat', { group_id: groupId, limit: 2 });
  assert.deepEqual(recent.value.data.messages.map(m => m.content), ['消息5', '消息6']);
  const all = await api({ method: 'GET', path: `/api/groups/${groupId}/messages` });
  assert.equal(all.data.messages.length, 7, 'existing UI unpaged behavior remains compatible');
  const letter = await execute('send_letter', { character_id: 2, title: '晚风', content: '一起看彩虹吧。' });
  assert.equal(letter.ok, true, JSON.stringify(letter));
  assert.equal(letter.value.status, 'accepted');
  assert.equal((await execute('list_letters', {})).value.data.letters[0].status, 'pending');
  const relation = await execute('create_relationship', { from_character_id: 2, to_character_id: 3, relationship_text: '一起看彩虹的朋友' });
  assert.equal(relation.ok, true, JSON.stringify(relation));
  assert.equal((await execute('update_relationship', { relationship_id: relation.value.data.relationship.id, relationship_text: '互相信任的朋友' })).ok, true);
  assert.match(JSON.stringify((await execute('read_relationships', { character_id: 2 })).value), /互相信任/);
  assert.equal((await execute('create_moment_topic', { name: '云庭的彩虹', desc: '谈谈眼前的彩虹' })).ok, true);
  assert.equal((await execute('create_event_type', { name: '意外的见闻', desc: '在熟悉的街角发现新的事物' })).ok, true);
  const outfit = await execute('create_outfit', { character_id: 2, name: '云白披肩', description: '轻柔的云白色披肩' });
  assert.equal(outfit.ok, true, JSON.stringify(outfit));
  assert.equal((await execute('set_outfit_enabled', { character_id: 2, outfit_id: outfit.value.data.id, enabled: true })).ok, true);
  assert.equal(db.prepare('SELECT enabled FROM character_outfits WHERE id=?').get(outfit.value.data.id).enabled, 1);
  assert.equal((await execute('read_backpack', {})).ok, true);
  assert.equal((await execute('list_diaries', { character_id: 2, limit: 10 })).ok, true);
  const world = await execute('create_world_setting', { name: '云庭', content: '云庭是神与天使交谈的地方。' });
  assert.equal(world.ok, true, JSON.stringify(world));
  assert.equal((await execute('activate_world_setting', { world_id: world.value.data.item.id })).ok, true);
  const media = await execute('create_media_outlet', { name: '晚风周刊', prompt: '记录邻里见闻。' });
  assert.equal(media.ok, true, JSON.stringify(media));
  assert.equal((await execute('create_media_board', { outlet_id: media.value.data.id, name: '街角', desc: '街角趣事' })).ok, true);
  const emoji = await execute('create_emoji_set', { character_id: 2, name: '云庭表情' });
  assert.equal(emoji.ok, true, JSON.stringify(emoji));
  assert.equal((await execute('set_emoji_set_enabled', { set_id: emoji.value.data.set.id, enabled: true })).ok, true);
  for (const name of ['list_prompt_presets', 'list_world_settings', 'list_media_outlets', 'read_media_posts', 'list_emoji_categories']) {
    assert.equal((await execute(name, {})).ok, true, name);
  }
  const capabilities = await execute('list_capabilities', { module: '信箱' });
  assert.ok(capabilities.value.tools.some(tool => tool.name === 'send_letter'));
});
