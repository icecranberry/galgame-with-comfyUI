import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createGodTools } from '../src/services/godSays/tools.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodLocalApi } from '../src/services/godSays/localApi.js';
import { godCommitGuard } from '../src/services/godSays/commitGuard.js';

test('scene outfit tool uses the actual generation API and saves only reviewed slots', async t => {
  t.mock.method(console, 'log', () => {});
  process.env.DB_PATH = ':memory:';
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).endsWith('/object_info')) return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('External network forbidden');
    return nativeFetch(url, options);
  });
  const { config } = await import('../src/config.js');
  config.dbPath = ':memory:';
  const { getDb } = await import('../src/db/index.js');
  const db = getDb();
  const persona = '来自星海的旅人，喜欢橙色。\n\n## 你的外观\nFirefly (Honkai: Star Rail) has silver hair, green eyes, wearing a white dress.';
  for (const id of [1, 2]) db.prepare('INSERT INTO characters(id,name,display_name,base_prompt,short_prompt) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,base_prompt=excluded.base_prompt,short_prompt=excluded.short_prompt').run(id, `c${id}`, `角色${id}`, persona, '温柔的旅人');
  const insert = db.prepare('INSERT INTO character_outfits(character_id,scene,name,description) VALUES (?,?,?,?)');
  for (const scene of ['work', 'casual', 'home', 'sleep']) insert.run(1, scene, scene, `old-${scene}`);
  insert.run(1, null, '独立形态', '不变');
  const all = () => db.prepare('SELECT id,character_id,scene,name,description FROM character_outfits ORDER BY id').all();
  const before = all();
  const llmRequests = [], generationRequests = [];
  let invalid = false, duringGeneration;
  const description = 'Firefly (Honkai: Star Rail) has silver hair, green eyes, wearing an orange dress with ' + 'delicate embroidery, '.repeat(97) + 'flat shoes.';
  assert.ok(description.length > 2000 && description.length <= 2400);
  const app = express();
  app.use(express.json());
  app.use(godCommitGuard);
  app.post('/v1/chat/completions', (req, res) => {
    llmRequests.push(req.body);
    const scenes = req.body.messages.at(-1).content.match(/请设计 ([a-z、]+)，/)[1].split('、');
    duringGeneration?.();
    const outfits = invalid ? [] : scenes.map(scene => ({ scene, name: '橙色服装', description }));
    res.json({ id: 'fixture', model: 'fixture', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ outfits }) } }] });
  });
  app.use('/api/characters', (req, _res, next) => { if (req.path.endsWith('/outfits/generate')) generationRequests.push(req.body); next(); });
  app.use('/api/characters', (await import('../src/routes/characters.js')).default);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  Object.assign(config.llm, { apiKey: 'fixture', baseURL: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', freeEgg: false, connectionType: 'openai', headers: {}, extraBody: {} });
  config.features.mergeMessages = false;
  const api = createGodLocalApi({ port: server.address().port });
  const repo = createGodRepository(db);
  const run = repo.start('scene-outfits', '给角色设计私服').run;
  const tools = createGodTools(repo, {}, {}, { api });
  let calls = 0;
  const execute = (args, name = 'generate_scene_outfits') => tools.execute({ id: `call-${calls++}`, function: { name, arguments: JSON.stringify(args) } }, run.id, 0);

  await t.test('generation obeys existing rules, previews full results, confirmation saves exactly once', async () => {
    const result = await execute({ character_id: 1, scenes: ['casual'], instruction: '把私服改成橙色，保留其他细节' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.status, 'awaiting_confirmation');
    assert.deepEqual(all(), before);
    assert.equal(generationRequests[0].save, false);
    assert.equal(generationRequests[0].generateImages, false);
    assert.match(generationRequests[0].baseAppearance, /silver hair/);
    const messages = llmRequests[0].messages;
    assert.match(messages.map(m => m.content).join('\n'), /一整段连贯英文/);
    assert.match(messages.map(m => m.content).join('\n'), /old-casual/);
    assert.doesNotMatch(messages.map(m => m.content).join('\n'), /old-home|old-sleep/);
    assert.match(messages.at(-1).content, /把私服改成橙色/);
    assert.equal(messages.filter(m => m.role === 'user').length, 1);
    const draft = tools.changes.get(result.value.change_id);
    assert.equal(draft.items[0].preview[1].before, 'old-casual');
    assert.equal(draft.items[0].preview[1].after, description);
    assert.equal((await tools.changes.decide(draft.id, draft.version, 'approve')).status, 'done');
    assert.equal(all().find(o => o.scene === 'casual').description, description);
    assert.deepEqual(all().filter(o => o.scene !== 'casual'), before.filter(o => o.scene !== 'casual'));
    assert.equal(db.prepare('SELECT base_prompt FROM characters WHERE id=1').get().base_prompt, persona);
    await tools.changes.decide(draft.id, draft.version, 'approve');
    assert.equal(llmRequests.length, 1);
    assert.equal(all().filter(o => o.scene === 'casual').length, 1);
  });

  await t.test('missing slot can be previewed then cancelled without creating any record', async () => {
    const result = await execute({ character_id: 2, scenes: ['sleep'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    const draft = tools.changes.get(result.value.change_id);
    assert.equal(draft.items[0].preview[1].before, '');
    await tools.changes.decide(draft.id, draft.version, 'reject');
    assert.equal(all().filter(o => o.character_id === 2).length, 0);
  });

  await t.test('target changes block confirmation; unrelated slots do not block or get overwritten', async () => {
    const first = await execute({ character_id: 1, scenes: ['home'], instruction: '设计新的居家服' });
    const draft = tools.changes.get(first.value.change_id);
    db.prepare("UPDATE character_outfits SET description='手动修改' WHERE character_id=1 AND scene='home'").run();
    await assert.rejects(tools.changes.decide(draft.id, draft.version, 'approve'), { status: 409 });
    const second = await execute({ character_id: 1, scenes: ['casual'], instruction: '再设计一套私服' });
    const other = tools.changes.get(second.value.change_id);
    db.prepare("UPDATE character_outfits SET description='新的睡衣' WHERE character_id=1 AND scene='sleep'").run();
    assert.equal((await tools.changes.decide(other.id, other.version, 'approve')).status, 'done');
    assert.equal(all().find(o => o.scene === 'sleep').description, '新的睡衣');
  });

  await t.test('batch targets save only requested slots and never create an exclusive form', async () => {
    const result = await execute({ tool_name: 'generate_scene_outfits', character_ids: [1, 2], arguments_json: JSON.stringify({ scenes: ['home', 'sleep'] }) }, 'batch_characters');
    assert.equal(result.ok, true, JSON.stringify(result));
    const draft = tools.changes.get(result.value.change_id);
    assert.equal(draft.items.length, 2);
    assert.equal((await tools.changes.decide(draft.id, draft.version, 'approve')).status, 'done');
    assert.deepEqual(all().filter(o => o.character_id === 2).map(o => o.scene), ['home', 'sleep']);
    assert.equal(all().filter(o => o.scene == null).length, 1);
  });

  await t.test('invalid scenes, invented final text and partial generation cannot produce drafts', async () => {
    const count = tools.changes.list(run.session_id).length;
    for (const args of [{ character_id: 1, scenes: ['work'] }, { character_id: 1, scenes: ['casual', 'casual'] }, { character_id: 1, scenes: ['casual'], description: 'agent-written' }, { character_id: 1, scenes: ['casual'], save: true }]) {
      assert.equal((await execute(args)).ok, false);
    }
    invalid = true;
    assert.equal((await execute({ character_id: 2, scenes: ['casual'], instruction: '生成缺失的私服' })).ok, false);
    invalid = false;
    assert.equal(tools.changes.list(run.session_id).length, count);
    assert.equal(all().filter(o => o.character_id === 2 && o.scene === 'casual').length, 0);
  });

  await t.test('changes while generation is in flight invalidate its draft', async () => {
    duringGeneration = () => db.prepare("UPDATE characters SET base_prompt='用户更新了人设' WHERE id=2").run();
    const result = await execute({ character_id: 2, scenes: ['casual'], instruction: '生成黄色私服' });
    assert.equal(result.ok, false);
    assert.match(result.error, /生成期间原内容已变化/);
    duringGeneration = null;
  });
});
