import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { once } from 'node:events';
import { queryStudioCatalog } from '../src/services/photoStudioCatalog.js';
import { createPhotoStudioService } from '../src/services/photoStudioService.js';
import { getStudioBackgrounds } from '../src/services/photoStudioBackgrounds.js';
import { migratePhotoStudioSchema } from '../src/db/photoStudioSchema.js';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodTools, validateToolArgs } from '../src/services/godSays/tools.js';
import { moduleTool, buildModuleRequest, executeModuleTool } from '../src/services/godSays/moduleTools.js';
import { createGodLocalApi, publicToolData } from '../src/services/godSays/localApi.js';
import { studioPhotoRequestId, studioPhotoResult, executeStudioPhoto } from '../src/services/godSays/studioPhotos.js';

const poses = [
  { id: 'solo-calibrated', system: '全身单人', category: '坐姿', name: '窗边阅读', angle: '正面', posePrompt: 'character 1 sits beside a window, reading a book.' },
  { id: 'pair-calibrated', system: '双人', category: '站姿', name: '并肩', angle: '侧面', posePrompt: 'character 1 stands on the left of character 2, holding hands.' },
];
const job = (status = 'running', extra = {}) => ({ id: 'godstudio_fixture', image_task_id: 3, status, stage: status,
  character_id: 1, pose_id: poses[0].id, width: 1152, height: 2048, ...extra });

test('照相馆目录支持人数、组合筛选与有界分页，拒绝畸形查询', () => {
  const entries = Array.from({ length: 120 }, (_, i) => ({ ...poses[i % 2], id: `pose-${i}` }));
  const result = queryStudioCatalog(entries, { person_count: '1', query: '窗边 正面', offset: '20', limit: '10' }, { poses: true });
  assert.equal(result.total, 60);
  assert.equal(result.entries.length, 10);
  assert.equal(result.entries[0].id, 'pose-40');
  assert.equal(result.has_more, true);
  assert.deepEqual(queryStudioCatalog(poses, { id: poses[1].id }, { poses: true }).entries, [poses[1]]);
  assert.equal(queryStudioCatalog(poses, { person_count: '2', angle: '正面' }, { poses: true }).total, 0);
  for (const query of [{ limit: '51' }, { offset: '-1' }, { limit: ['2'] }, { person_count: '3' }, { query: {} }, { query: 'x'.repeat(201) }, { unknown: 'x' }]) {
    assert.throws(() => queryStudioCatalog(entries, query, { poses: true }), { status: 400 });
  }
  const backgrounds = queryStudioCatalog(getStudioBackgrounds().entries, { query: '包豪斯' });
  assert.equal(backgrounds.entries[0].id, 'bg-001');
});

test('照相馆工具固定映射原接口，操作编号稳定且参数不能代写姿势或外貌', () => {
  const entry = moduleTool('generate_studio_photo');
  const args = { character_id: 1, second_character_id: 2, pose_id: poses[1].id, background_id: 'bg-001', outfit_scene: 'casual', width: 1024, height: 1024, polish_prompt: true };
  validateToolArgs(entry.definition.function.parameters, args);
  const request = buildModuleRequest(entry, args, { effectKey: 'same-operation' });
  assert.deepEqual(request, { method: 'POST', path: '/api/photo-studio/jobs', stream: false, body: {
    id: studioPhotoRequestId('same-operation'), characterId: 1, secondCharacterId: 2, poseId: poses[1].id, backgroundId: 'bg-001', strictParticipants: true, outfitScene: 'casual', width: 1024, height: 1024, polishPrompt: true,
  } });
  assert.match(request.body.id, /^[a-zA-Z0-9_-]{8,100}$/);
  assert.notEqual(studioPhotoRequestId('different-operation'), request.body.id);
  assert.throws(() => buildModuleRequest(entry, args), /操作编号/);
  for (const extra of [{ customPose: {} }, { appearanceOverride: '替代外观' }, { customBackgroundPrompt: '替代背景' }, { character_id: 0 }, { width: 256 }]) {
    assert.throws(() => validateToolArgs(entry.definition.function.parameters, { ...args, ...extra }));
  }
  assert.match(buildModuleRequest(moduleTool('search_photo_studio_poses'), { person_count: 2 }).path, /person_count=2&compact=1&limit=20$/);
});

test('拍摄先校验姿势人数，缺失搭档或误选单人姿势时不提交生成', async () => {
  for (const [pose, secondCharacterId] of [[poses[0], 2], [poses[1], undefined], [{ ...poses[0], posePrompt: '' }, undefined]]) {
    const calls = [];
    const request = { method: 'POST', path: '/api/photo-studio/jobs', body: { id: 'godstudio_fixture', poseId: pose.id, ...(secondCharacterId ? { secondCharacterId } : {}) } };
    await assert.rejects(executeStudioPhoto(request, {}, async req => { calls.push(req); return { status: 200, data: { poses: [pose] } }; }), /姿势|搭档/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  }
});

test('后台等待仅轮询原任务，超时返回待查询编号；停止不重复提交', async () => {
  const request = { method: 'POST', path: '/api/photo-studio/jobs', body: { id: 'godstudio_fixture', poseId: poses[0].id } };
  let time = 0;
  const calls = [];
  const api = async req => {
    calls.push(req);
    return { status: req.method === 'POST' ? 202 : 200, data: req.path.includes('/catalog') ? { poses } : { job: job() } };
  };
  const pending = await executeStudioPhoto(request, {}, api, { timeoutMs: 5, intervalMs: 2, now: () => time, wait: async ms => { time += ms; } });
  assert.equal(pending.status, 202);
  assert.equal(pending.data.job_id, request.body.id);
  assert.deepEqual(pending.data.images, []);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(calls.filter(call => call.path.endsWith('/jobs/godstudio_fixture')).length > 0);
  const controller = new AbortController();
  await assert.rejects(executeStudioPhoto(request, { signal: controller.signal }, api, { wait: async () => { controller.abort(); } }), { name: 'AbortError' });
  const count = calls.length;
  await assert.rejects(executeStudioPhoto(request, { signal: controller.signal }, api), { name: 'AbortError' });
  assert.equal(calls.length, count, '已停止时不再查询或提交');
  const lost = await executeStudioPhoto(request, {}, async req => {
    if (req.path.includes('/catalog')) return { status: 200, data: { poses } };
    if (req.method === 'POST') return { status: 202, data: { job: job() } };
    throw new Error('状态查询断线');
  }, { wait: async () => {} });
  assert.equal(lost.status, 202);
  assert.equal(lost.data.job_id, request.body.id);
  assert.equal(lost.data.query_error, '状态查询断线');
});

test('失败、无效成片与不匹配的记录不会伪装成功，查询中的任务仍为 accepted', async () => {
  assert.throws(() => studioPhotoResult({ job: job('failed', { error: '暗房离线' }) }), /暗房离线/);
  for (const output_url of ['https://example.com/fake.png', '/images/chat/fake.png', '/images/photo_studio/../fake.png', '']) {
    assert.throws(() => studioPhotoResult({ job: job('done', { output_url }) }), /地址/);
  }
  const result = studioPhotoResult({ job: job('done', { output_url: '/images/photo_studio/result.avif' }) });
  assert.equal(result.success, true);
  assert.throws(() => studioPhotoResult({ job: job('unknown') }), /状态/);
  const running = await executeModuleTool(moduleTool('read_studio_photo'), { job_id: 'godstudio_fixture' }, {}, async () => ({ status: 200, data: { job: job() } }));
  assert.equal(running.status, 'accepted');
  assert.equal(running.data.success, false);
  const request = { body: { id: 'godstudio_fixture', poseId: poses[0].id } };
  await assert.rejects(executeStudioPhoto(request, {}, async req => ({ status: 200, data: req.method === 'GET' ? { poses } : { job: job('done', { id: 'wrong-job' }) } })), /不匹配/);
});

test('真实照相馆目录路由保留旧页面返回格式，神说能分页查全库并取得精简资料', async t => {
  const router = (await import('../src/routes/photoStudio.js')).default;
  const app = express();
  app.use('/api/photo-studio', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const api = createGodLocalApi({ port: server.address().port });
  const full = await api({ method: 'GET', path: '/api/photo-studio/catalog' });
  assert.ok(full.data.poses.length > 20);
  assert.equal(full.data.limit, undefined);
  const first = await executeModuleTool(moduleTool('search_photo_studio_poses'), { person_count: 1 }, {}, api);
  assert.equal(first.data.poses.length, 20);
  assert.ok(first.data.poses.every(pose => pose.person_count === 1 && !Object.hasOwn(pose, 'posePrompt')));
  assert.equal(publicToolData(first.data)._truncated, undefined);
  const second = await executeModuleTool(moduleTool('search_photo_studio_poses'), { person_count: 1, offset: 20 }, {}, api);
  assert.ok(!second.data.poses.some(pose => first.data.poses.some(previous => previous.id === pose.id)));
  const backgrounds = await executeModuleTool(moduleTool('search_photo_studio_backgrounds'), { query: '包豪斯' }, {}, api);
  assert.equal(backgrounds.data.entries[0].id, 'bg-001');
  assert.equal(Object.hasOwn(backgrounds.data.entries[0], 'prompt'), false);
  const original = await fetch(`http://127.0.0.1:${server.address().port}/api/photo-studio/backgrounds`).then(response => response.json());
  assert.equal(original.entries.length, getStudioBackgrounds().entries.length);
  assert.equal(original.limit, undefined);
  const maximumPage = await executeModuleTool(moduleTool('search_photo_studio_poses'), { limit: 50 }, {}, api);
  assert.equal(maximumPage.data.poses.length, 50);
  assert.equal(maximumPage.data._truncated, undefined);
  await assert.rejects(api({ method: 'GET', path: '/api/photo-studio/catalog?limit=999' }), /筛选参数/);
});

test('神说账本通过原照相馆服务拍摄单人和双人，复用背景外观并保留回看与幂等', async t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, base_prompt TEXT, short_prompt TEXT, archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0);
    INSERT INTO characters(id,name,display_name,base_prompt) VALUES (1,'Alice','甲','silver hair, blue eyes'),(2,'Bob','乙','black hair, green eyes');
    CREATE TABLE character_outfits(id INTEGER PRIMARY KEY,character_id INTEGER,scene TEXT,description TEXT);
    CREATE TABLE image_tasks(id INTEGER PRIMARY KEY,prompt_original TEXT,prompt_refined TEXT,status TEXT,output_paths TEXT,workflow_template TEXT,finished_at TEXT,error_message TEXT);
    CREATE TABLE moment_posts(id INTEGER PRIMARY KEY);
    CREATE TABLE raw_messages(id INTEGER PRIMARY KEY);`);
  migratePhotoStudioSchema(db);
  migrateGodSaysSchema(db);
  const rendered = [];
  const studio = createPhotoStudioService({ database: () => db, catalog: async () => poses, capability: async () => ({ available: true }),
    persona: c => c.base_prompt, render: async (prompt, options) => { rendered.push({ prompt, options }); return { success: true, wfMode: 'turbo', images: [{ base64: 'fixture' }] }; },
    save: async (_, id) => `/images/photo_studio/${id}.png`, publish: () => {},
  });
  const app = express();
  app.use(express.json());
  app.get('/api/photo-studio/catalog', (req, res) => res.json({ poses: poses.filter(pose => pose.id === req.query.id) }));
  app.post('/api/photo-studio/jobs', async (req, res) => {
    try { res.status(202).json({ job: await studio.submit(req.body) }); }
    catch (error) { res.status(error.status || 500).json({ error: error.message }); }
  });
  app.get('/api/photo-studio/jobs/:id', (req, res) => res.json({ job: studio.job(req.params.id) }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const api = createGodLocalApi({ port: server.address().port });
  const repo = createGodRepository(db);
  const run = repo.start('studio-integration', '用照相馆为甲和乙拍照').run;
  const tools = createGodTools(repo, {}, { api });
  const call = (id, args) => ({ id, function: { name: 'generate_studio_photo', arguments: JSON.stringify(args) } });
  const soloArgs = { character_id: 1, pose_id: poses[0].id, background_id: 'bg-001', width: 1024, height: 1024 };
  const solo = await tools.execute(call('solo', soloArgs), run.id, 0);
  assert.equal(solo.ok, true, JSON.stringify(solo));
  assert.equal(solo.value.data.success, true);
  assert.match(rendered[0].prompt, /silver hair, blue eyes/);
  assert.ok(rendered[0].prompt.includes(getStudioBackgrounds().entries[0].prompt));
  assert.equal(rendered[0].options.width, 1024);
  assert.equal(rendered[0].options.alreadyPrepared, true);
  const repeat = await tools.execute(call('solo-retry', soloArgs), run.id, 1);
  assert.deepEqual(repeat, solo);
  assert.equal(rendered.length, 1);
  const pair = await tools.execute(call('pair', { character_id: 1, second_character_id: 2, pose_id: poses[1].id }), run.id, 2);
  assert.equal(pair.ok, true, JSON.stringify(pair));
  assert.match(rendered[1].prompt, /Character 2 — Appearance:.*black hair, green eyes/);
  const replay = await executeModuleTool(moduleTool('read_studio_photo'), { job_id: pair.value.data.job_id }, {}, api);
  assert.deepEqual(replay.data.images, pair.value.data.images);
  const persisted = db.prepare('SELECT * FROM image_tasks WHERE id=?').get(pair.value.data.task_id);
  assert.equal(persisted.status, 'done');
  assert.deepEqual(JSON.parse(persisted.output_paths), [pair.value.data.images[0].url]);
  const before = rendered.length;
  const invalid = await tools.execute(call('bad-size', { ...soloArgs, width: 513 }), run.id, 3);
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /8/);
  const same = await tools.execute(call('same-person', { character_id: 1, second_character_id: 1, pose_id: poses[1].id }), run.id, 4);
  assert.equal(same.ok, false);
  assert.match(same.error, /不同角色/);
  assert.equal(rendered.length, before);
});
