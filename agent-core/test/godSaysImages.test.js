import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { studioDimensions, saveStudioChatImages } from '../src/services/studioChatImages.js';
import { moduleTool, buildModuleRequest, executeModuleTool } from '../src/services/godSays/moduleTools.js';
import { validateToolArgs } from '../src/services/godSays/tools.js';
import { createGodLocalApi } from '../src/services/godSays/localApi.js';
import express from 'express';
import { once } from 'node:events';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodTools } from '../src/services/godSays/tools.js';
import { runGodAgent } from '../src/services/godSays/agent.js';
import { buildGodChatContext } from '../src/services/godSays/promptBuilder.js';

const settings = { width: 832, height: 1216, momentsWidth: 1024, momentsHeight: 1024, eventWidth: 1600, eventHeight: 1200 };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
function fixture(t) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE image_tasks(id INTEGER PRIMARY KEY,conversation_id TEXT,prompt_original TEXT,prompt_refined TEXT,style TEXT,resolution TEXT,
    workflow_template TEXT,comfyui_prompt_id TEXT,status TEXT,output_paths TEXT,finished_at TEXT)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-god-images-'));
  t.after(() => { db.close(); assert.equal(path.dirname(dir), fs.realpathSync(os.tmpdir())); fs.rmSync(dir, { recursive: true }); });
  const deps = {
    save(category, filename, data) { assert.equal(category, 'chat'); fs.writeFileSync(path.join(dir, filename), Buffer.from(data.split(',')[1], 'base64')); return `/images/chat/${filename}`; },
    remove(url) { fs.unlinkSync(path.join(dir, path.basename(url))); },
  };
  return { db, dir, deps };
}

test('image tool directly uses the studio endpoint, omits default dimensions, and validates custom overrides', () => {
  const tool = moduleTool('generate_image');
  const defaults = buildModuleRequest(tool, { prompt: '云庭里看彩虹的天使' });
  assert.equal(defaults.path, '/api/images/test-style');
  assert.deepEqual(defaults.body, { sceneDesc: '云庭里看彩虹的天使', mode: 'chat', saveToChat: true });
  assert.deepEqual(studioDimensions(defaults.body, settings), { width: 832, height: 1216 });
  const custom = buildModuleRequest(tool, { prompt: '横幅', width: 1536, height: 1024, artist: 'soft watercolor' });
  assert.deepEqual(studioDimensions(custom.body, settings), { width: 1536, height: 1024 });
  assert.equal(custom.body.artist, 'soft watercolor');
  assert.deepEqual(studioDimensions({ height: 768 }, settings), { width: 832, height: 768 });
  assert.equal(settings.width, 832, 'per-image overrides never modify shared settings');
  for (const value of [0, -1, 200, 4097, 1024.5, '1024']) {
    assert.throws(() => validateToolArgs(tool.definition.function.parameters, { prompt: '图', width: value }));
    assert.throws(() => studioDimensions({ width: value }, settings), /整数像素/);
  }
  assert.throws(() => validateToolArgs(tool.definition.function.parameters, { prompt: '图', saveToChat: false }), /不支持/);
});

test('image tool carries queried character identities separately from scene prose', async () => {
  const tool = moduleTool('generate_image');
  const args = { prompt: '流萤坐在窗边看书', character_ids: [1076] };
  validateToolArgs(tool.definition.function.parameters, args);
  const result = await executeModuleTool(tool, args, {}, async request => {
    assert.deepEqual(request.body, {
      sceneDesc: args.prompt, character_ids: [1076], mode: 'chat', saveToChat: true,
    });
    return { status: 200, data: { success: true } };
  });
  assert.equal(result.data.success, true);
  assert.match(tool.definition.function.description, /已知角色必须保留真实姓名/);
  for (const character_ids of [[], [0], [-1], ['1076'], [1.5], [1076, 1076], Array.from({ length: 31 }, (_, i) => i + 1)]) {
    assert.throws(() => validateToolArgs(tool.definition.function.parameters, { prompt: '看书', character_ids }));
  }
});

test('image tool passes angel and resident references together without assigning a resident id to the angel', async () => {
  const tool = moduleTool('generate_image');
  const args = { prompt: '天使和流萤在窗边合照', character_ids: [1076], special_characters: ['angel'] };
  validateToolArgs(tool.definition.function.parameters, args);
  await executeModuleTool(tool, args, {}, async request => {
    assert.deepEqual(request.body, { sceneDesc: args.prompt, character_ids: [1076], special_characters: ['angel'], mode: 'chat', saveToChat: true });
    return { status: 200, data: { success: true } };
  });
  assert.deepEqual(buildModuleRequest(tool, { prompt: '天使的来信', special_characters: [] }).body.special_characters, []);
  for (const special_characters of [null, 'angel', [1], ['unknown'], ['angel', 'angel']]) {
    assert.throws(() => validateToolArgs(tool.definition.function.parameters, { prompt: '合照', special_characters }));
  }
});

test('saved studio images persist as chat URLs and completed task receipts without base64 or provider filenames', t => {
  const { db, dir, deps } = fixture(t);
  const result = saveStudioChatImages(db, { success: true, images: [{ base64: png, filename: '../../bad.png' }], promptId: 'studio-1', wfMode: 'turbo' },
    { prompt: 'angel in clouds', originalPrompt: '云庭的天使', artist: 'watercolor', width: 832, height: 1216 }, deps);
  assert.equal(result.images.length, 1);
  assert.match(result.images[0].url, /^\/images\/chat\/god_[a-f0-9-]+\.png$/);
  assert.ok(fs.existsSync(path.join(dir, result.images[0].filename)));
  assert.doesNotMatch(JSON.stringify(result), /base64|bad\.png/);
  const task = db.prepare('SELECT * FROM image_tasks WHERE id=?').get(result.task_id);
  assert.equal(task.conversation_id, 'god:angel');
  assert.equal(task.status, 'done');
  assert.equal(task.resolution, '832x1216');
  assert.equal(task.prompt_original, '云庭的天使');
  assert.equal(task.comfyui_prompt_id, 'studio-1');
  assert.deepEqual(JSON.parse(task.output_paths), [result.images[0].filename]);
});

test('invalid results and persistence failures cannot produce a sent-image receipt or leave partial files', t => {
  const { db, dir, deps } = fixture(t);
  const opts = { prompt: 'angel', originalPrompt: '天使', artist: '', width: 832, height: 1216 };
  assert.throws(() => saveStudioChatImages(db, { images: [] }, opts, deps), /没有返回图片/);
  assert.throws(() => saveStudioChatImages(db, { images: [{ base64: png }, { base64: 'bad' }] }, opts, deps), /无效/);
  db.exec("CREATE TRIGGER reject_image BEFORE INSERT ON image_tasks BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(() => saveStudioChatImages(db, { images: [{ base64: png }] }, opts, deps), /test failure/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM image_tasks').get().n, 0);
});

test('the loopback bridge delivers actual image URLs and preserves studio generation failures', async () => {
  const received = [];
  let fail = false;
  const api = createGodLocalApi({ port: 12345, fetchImpl: async (url, options) => {
    received.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(fail ? { success: false, error: '模型暂时不可用' } : { success: true, images: [{ url: '/images/chat/god_123.png', width: 1536, height: 1024 }], task_id: 3 }),
      { headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await executeModuleTool(moduleTool('generate_image'), { prompt: '彩虹', width: 1536, height: 1024 }, {}, api);
  assert.equal(result.status, 'returned', 'image generation must finish before claiming delivery');
  assert.equal(result.data.images[0].url, '/images/chat/god_123.png');
  assert.equal(received[0].url, 'http://127.0.0.1:12345/api/images/test-style');
  assert.equal(received[0].body.mode, 'chat');
  fail = true;
  await assert.rejects(executeModuleTool(moduleTool('generate_image'), { prompt: '再试' }, {}, api), /模型暂时不可用/);
});

test('native image calls persist and replay their actual results without duplicate image generation', async t => {
  const { db, deps } = fixture(t);
  db.exec('CREATE TABLE moment_posts(id INTEGER PRIMARY KEY); CREATE TABLE raw_messages(id INTEGER PRIMARY KEY)');
  migrateGodSaysSchema(db);
  const repo = createGodRepository(db);
  const app = express(); app.use(express.json());
  let generations = 0;
  app.post('/api/images/test-style', (req, res) => {
    generations++;
    assert.equal(req.body.saveToChat, true);
    const dimensions = studioDimensions(req.body, settings);
    const saved = saveStudioChatImages(db, { images: [{ base64: png }], wfMode: 'turbo' },
      { ...dimensions, prompt: 'angel in clouds', originalPrompt: req.body.sceneDesc, artist: '' }, deps);
    res.json({ success: true, ...saved, ...dimensions });
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const tools = createGodTools(repo, {}, { api: createGodLocalApi({ port: server.address().port }) });
  const run = repo.start('send-image-test', '给我一张云庭的照片').run;
  let round = 0;
  const stream = async function* (messages) {
    if (!round++) {
      yield { type: 'assistant_end', message: { role: 'assistant', content: '', tool_calls: ['image1', 'image2'].map(id => ({ id, type: 'function', function: {
        name: 'generate_image', arguments: '{"prompt":"云庭的天使"}',
      } })) } };
    } else {
      const receipt = JSON.parse(messages.at(-1).content);
      assert.equal(receipt.ok, true);
      assert.equal(receipt.value.data.width, 832);
      assert.match(receipt.value.data.images[0].url, /^\/images\/chat\/god_/);
      assert.doesNotMatch(messages.at(-1).content, /base64/);
      yield { type: 'assistant_end', message: { role: 'assistant', content: '吾神，送给您。' } };
    }
  };
  await runGodAgent(run, { repo, tools, stream, prepare: async () => ({ messages: [{ role: 'user', content: run.input }] }) });
  assert.equal(generations, 1);
  const snapshot = repo.snapshot(run.session_id);
  assert.equal(snapshot.runs[0].status, 'completed');
  assert.equal(snapshot.calls.length, 1);
  const image = snapshot.calls[0].result.value.data.images[0];
  assert.equal(image.width, 832); assert.equal(image.height, 1216);
  const replay = db.prepare("SELECT data FROM god_run_events WHERE type='tool' ORDER BY seq DESC LIMIT 1").get();
  assert.equal(JSON.parse(replay.data).result.value.data.images[0].url, image.url);
  assert.equal(repo.start('send-image-test', run.input).duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM image_tasks').get().n, 1);
});

// —— 神说：用户上传图片消息（POST /runs.images）——
// 有图时末条 user 的文本 + 图片 parts 必须共存，且不改变消息条数/历史边界。
const chatAngel = { display_name: '天使', persona: '## 你的身份\n你是送信的天使。' };
const chatHistory = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '吾神安好。' },
  { role: 'user', content: '这几张图你看到了吗' },
];
function buildMessageContext(overrides = {}) {
  return buildGodChatContext({
    systemRules: '破甲规则', worldSetting: '', agentRules: '回答即可。',
    angel: chatAngel, schedule: [], history: { messages: chatHistory },
    now: new Date('2026-11-01T02:00:00Z'), ...overrides,
  });
}

test('有图片时末条 user 变为多模态 parts，文本包含原任务且图片顺序一致', () => {
  const images = ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB'];
  const { messages } = buildMessageContext({ images });
  const last = messages.at(-1);
  assert.equal(last.role, 'user');
  assert.ok(Array.isArray(last.content), '末条 user 的 content 应为数组');
  assert.equal(last.content[0].type, 'text');
  assert.match(last.content[0].text, /^<dynamic_context>/);
  assert.ok(last.content[0].text.includes('这几张图你看到了吗'), '首段文本应包含原任务字符串');
  const imageParts = last.content.filter(part => part.type === 'image_url');
  assert.equal(imageParts.length, images.length, 'image parts 数量应等于图片数');
  assert.deepEqual(imageParts.map(part => part.image_url.url), images, '图片顺序应与传入一致');
});

test('无图片时末条 user 仍是字符串，与改动前逐字节一致', () => {
  const { messages } = buildMessageContext();
  const last = messages.at(-1);
  assert.equal(typeof last.content, 'string');
  assert.match(last.content, /^<dynamic_context>[\s\S]*<\/dynamic_context>\n\n这几张图你看到了吗$/);
});

test('有图片时 messages.length 与 historyStart 保持不变', () => {
  const plain = buildMessageContext();
  const withImages = buildMessageContext({ images: ['data:image/png;base64,AAA'] });
  assert.equal(withImages.messages.length, plain.messages.length);
  assert.equal(withImages.lorebookOptions.historyStart, plain.lorebookOptions.historyStart);
  assert.equal(withImages.lorebookOptions.historyEnd, plain.lorebookOptions.historyEnd);
});
