import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createPhotoStudioService } from '../src/services/photoStudioService.js';
import { getStudioBackgrounds } from '../src/services/photoStudioBackgrounds.js';
import { migratePhotoStudioSchema } from '../src/db/photoStudioSchema.js';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { moduleTool, buildModuleRequest, executeModuleTool } from '../src/services/godSays/moduleTools.js';

const poses = [
  { id: 'solo-a', system: '单人', name: '回眸', angle: '正面', posePrompt: 'character 1 turns toward the camera, smiling.' },
  { id: 'solo-b', system: '单人', name: '坐姿', angle: '侧面', posePrompt: 'character 1 sits on a chair, reading.' },
  { id: 'pair-a', system: '双人', name: '并肩', angle: '正面', posePrompt: 'character 1 stands to the left of character 2, holding hands.' },
  { id: 'pair-b', system: '双人', name: '对坐', angle: '侧面', posePrompt: 'character 1 and character 2 sit facing each other.' },
  { id: 'uncalibrated', system: '单人', posePrompt: '' },
];
const appearances = {
  work: 'Seraph has golden hair, amber eyes and white wings, wearing a white robe.',
  casual: 'Seraph has golden hair, amber eyes and white wings, wearing a blue jacket.',
  home: 'Seraph has golden hair, amber eyes and white wings, wearing a green sweater.',
  sleep: 'Seraph has golden hair, amber eyes and white wings, wearing pink pajamas.',
};

function fixture(t, options = {}) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,base_prompt TEXT,short_prompt TEXT,loras TEXT,pinned INTEGER DEFAULT 0);
    CREATE TABLE character_outfits(id INTEGER PRIMARY KEY,character_id INTEGER,scene TEXT,description TEXT);
    CREATE TABLE image_tasks(id INTEGER PRIMARY KEY,prompt_original TEXT,prompt_refined TEXT,status TEXT,output_paths TEXT,workflow_template TEXT,finished_at TEXT,error_message TEXT);
    CREATE TABLE moment_posts(id INTEGER PRIMARY KEY);
    CREATE TABLE raw_messages(id INTEGER PRIMARY KEY);`);
  db.prepare('INSERT INTO characters(id,name,display_name,base_prompt,loras) VALUES(1,?,?,?,?)').run('Alice', '居民甲',
    '居民人格。\n## 你的外观\nAlice has black hair and green eyes, wearing a black coat.', JSON.stringify([{ path: 'alice.safetensors', weight: 0.7, triggerWord: 'alice-tag' }]));
  db.prepare('INSERT INTO character_outfits(character_id,scene,description) VALUES(1,?,?)').run('casual', 'Alice has black hair and green eyes, wearing a yellow dress.');
  migrateGodSaysSchema(db);
  migratePhotoStudioSchema(db);
  db.prepare('INSERT INTO god_angel(id,display_name,persona,scene_outfits_json) VALUES(1,?,?,?)').run('天使星羽',
    `天使人格与居民无关。\n## 你的外观\n${appearances.work}`, JSON.stringify(Object.entries(appearances).filter(([scene]) => scene !== 'work').map(([scene, description]) => ({ scene, name: scene, description }))));
  const renders = [], draws = [];
  const studio = createPhotoStudioService({ database: () => db, catalog: async () => poses, capability: async () => ({ available: true }),
    random: values => { draws.push(values.map(value => value.id)); return values[0]; },
    render: async (prompt, settings) => { renders.push({ prompt, settings }); return { success: true, wfMode: 'turbo', images: [{ base64: 'fixture' }] }; },
    save: async (_, id) => `/images/photo_studio/${id}.png`, publish: () => {}, ...options,
  });
  return { db, studio, renders, draws };
}

async function completed(studio, id) {
  for (let n = 0; n < 30; n++) {
    const job = studio.job(id);
    if (job.status !== 'running') { assert.equal(job.status, 'done', job.error); return job; }
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('fixture render did not complete');
}

test('天使自拍按四个槽位直接读取自己的外观和衣柜，不借用同编号居民资料', async t => {
  const { db, studio, renders } = fixture(t);
  const before = db.prepare('SELECT * FROM god_angel WHERE id=1').get();
  for (const scene of Object.keys(appearances)) {
    const id = `angel-solo-${scene}`;
    await studio.submit({ id, characterId: 'angel', poseId: 'solo-a', backgroundId: 'bg-001', outfitScene: scene, strictParticipants: true });
    const job = await completed(studio, id);
    const render = renders.at(-1);
    assert.ok(render.prompt.includes(appearances[scene]));
    assert.doesNotMatch(render.prompt, /Alice|black hair|yellow dress/);
    if (scene !== 'work') assert.doesNotMatch(render.prompt, /white robe/);
    assert.deepEqual(render.settings.loras, []);
    assert.equal(job.character_id, null);
    assert.equal(job.character_kind, 'angel');
    assert.equal(job.character_name, '天使星羽');
  }
  assert.deepEqual(db.prepare('SELECT * FROM god_angel WHERE id=1').get(), before, '拍摄不改写天使档案或服装');
  db.prepare('UPDATE god_angel SET persona=? WHERE id=1').run('新人格。\n## 你的外观\nSeraph has silver hair, wearing a red cape.');
  const latest = await studio.preview({ characterId: 'angel', poseId: 'solo-a' });
  assert.match(latest.prompt, /silver hair.*red cape/);
  assert.doesNotMatch(latest.prompt, /golden hair/);
});

test('天使可作为主角或搭档与居民合照，各自服装、动作归属和 LoRA 不混用', async t => {
  const { studio, renders } = fixture(t);
  for (const firstAngel of [true, false]) {
    const id = `angel-pair-${firstAngel}`;
    await studio.submit({ id, characterId: firstAngel ? 'angel' : 1, secondCharacterId: firstAngel ? 1 : 'angel',
      poseId: 'pair-a', outfitScene: 'casual', secondOutfitScene: 'casual', strictParticipants: true });
    const job = await completed(studio, id);
    const { prompt, settings } = renders.at(-1);
    assert.match(prompt, /Pose: (?:Seraph stands to the left of Alice|Alice stands to the left of Seraph), holding hands/);
    assert.match(prompt, /Character [12] — Appearance:.*golden hair.*blue jacket/);
    assert.match(prompt, /Character [12] — Appearance:.*black hair.*yellow dress/);
    assert.doesNotMatch(prompt, /white robe|black coat/);
    assert.deepEqual(settings.loras, [{ path: 'alice.safetensors', weight: 0.7, triggerWord: 'alice-tag' }]);
    assert.equal(firstAngel ? job.character_id : job.character2_id, null);
    assert.equal(firstAngel ? job.character_kind : job.character2_kind, 'angel');
    assert.equal(firstAngel ? job.character2_id : job.character_id, 1);
  }
});

test('神说省略姿势和背景时后端按人数随机抽库，并在任务重试时冻结选择', async t => {
  const { studio, draws, renders } = fixture(t);
  for (const second_character_id of [undefined, 1]) {
    const args = { special_character: 'angel', ...(second_character_id ? { second_character_id } : {}) };
    const request = buildModuleRequest(moduleTool('generate_studio_photo'), args, { effectKey: `random-${second_character_id}` });
    assert.equal(request.body.poseId, 'random');
    assert.equal(request.body.backgroundId, 'random');
    await studio.submit(request.body);
    const job = await completed(studio, request.body.id);
    assert.equal(job.pose_id, second_character_id ? 'pair-a' : 'solo-a');
    assert.equal(job.background_id, 'bg-001');
    assert.ok(job.prompt.includes(getStudioBackgrounds().entries[0].prompt));
    const candidates = draws.at(-1);
    assert.deepEqual(candidates, second_character_id ? ['pair-a', 'pair-b'] : ['solo-a', 'solo-b']);
    const count = draws.length, rendered = renders.length;
    await studio.submit(request.body);
    assert.equal(draws.length, count, '同一任务重试不重新抽库');
    assert.equal(renders.length, rendered, '同一任务不重复生图');
    assert.equal(studio.job(job.id).prompt, job.prompt);
  }
});

test('明确指定的姿势和背景不随机，缺少可用人数姿势时直接失败', async t => {
  const { studio, draws } = fixture(t);
  await studio.submit({ id: 'explicit-angel-shot', characterId: 'angel', poseId: 'solo-b', backgroundId: 'bg-002' });
  const job = await completed(studio, 'explicit-angel-shot');
  assert.equal(job.pose_id, 'solo-b');
  assert.equal(job.background_id, 'bg-002');
  assert.equal(draws.length, 0);
  const empty = fixture(t, { catalog: async () => poses.filter(pose => pose.system === '单人') });
  await assert.rejects(empty.studio.submit({ id: 'no-pair-available', characterId: 'angel', secondCharacterId: 1, poseId: 'random' }), /双人姿势/);
  assert.equal(empty.db.prepare('SELECT COUNT(*) count FROM image_tasks').get().count, 0);
});

test('缺失天使、外观或选定服装，以及重复天使和人数冲突都在生图前拒绝', async t => {
  const { studio, db, renders } = fixture(t);
  const base = { id: 'invalid-angel-shot', characterId: 'angel', poseId: 'solo-a', strictParticipants: true };
  for (const input of [{ secondCharacterId: 'angel', poseId: 'pair-a' }, { secondCharacterId: 1 }, { poseId: 'pair-a' }, { outfitScene: 'invalid' }]) {
    await assert.rejects(studio.submit({ ...base, ...input }), { status: 400 });
  }
  db.prepare('UPDATE god_angel SET scene_outfits_json=? WHERE id=1').run('[]');
  await assert.rejects(studio.submit({ ...base, outfitScene: 'sleep' }), /尚未配置/);
  db.prepare('UPDATE god_angel SET persona=? WHERE id=1').run('只有人格，没有外观。');
  await assert.rejects(studio.submit(base), /外观/);
  db.prepare('DELETE FROM god_angel').run();
  await assert.rejects(studio.submit(base), /召唤天使/);
  assert.equal(renders.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM image_tasks').get().count, 0);
});

test('天使工具互斥身份参数不能混填，查询结果保留天使身份和实际随机选择', async t => {
  const { studio } = fixture(t);
  const entry = moduleTool('generate_studio_photo'), ctx = { effectKey: 'angel-tool' };
  for (const args of [{}, { character_id: 1, special_character: 'angel' }, { special_character: 'angel', second_special_character: 'angel' },
    { character_id: 1, second_character_id: 1 }, { special_character: 'angel', second_character_id: 1, second_special_character: 'angel' }]) {
    assert.throws(() => buildModuleRequest(entry, args, ctx), /主角|位置|不同角色/);
  }
  const api = async request => {
    if (request.method === 'POST') return { status: 202, data: { job: await studio.submit(request.body) } };
    assert.ok(request.path.startsWith('/api/photo-studio/jobs/'), '随机拍摄不查询固定姿势目录');
    return { status: 200, data: { job: studio.job(request.path.split('/').at(-1)) } };
  };
  const result = await executeModuleTool(entry, { special_character: 'angel', second_character_id: 1, outfit_scene: 'home' }, ctx, api);
  assert.equal(result.data.success, true);
  assert.equal(result.data.special_character, 'angel');
  assert.equal(result.data.character_id, null);
  assert.equal(result.data.second_character_id, 1);
  assert.equal(result.data.pose_id, 'pair-a');
  assert.equal(result.data.background_id, 'bg-001');
  const read = await executeModuleTool(moduleTool('read_studio_photo'), { job_id: result.data.job_id }, {}, api);
  assert.deepEqual(read.data, result.data);
});

test('旧拍摄记录升级后完整保留，可记录没有居民编号的天使任务，迁移可重复执行', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE photo_studio_jobs (
    id TEXT PRIMARY KEY, character_id INTEGER NOT NULL, character2_id INTEGER, pose_id TEXT NOT NULL,
    character_name TEXT NOT NULL, character2_name TEXT, pose_name TEXT NOT NULL,
    image_task_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'preparing', prompt TEXT NOT NULL, width INTEGER, height INTEGER,
    output_url TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
    CREATE INDEX idx_photo_studio_created ON photo_studio_jobs(created_at);
    INSERT INTO photo_studio_jobs(rowid,id,character_id,character2_id,character_name,character2_name,pose_id,pose_name,image_task_id,status,progress,stage,prompt,width,height,output_url,created_at,finished_at)
      VALUES(7,'old-photo',1,2,'甲','乙','old-pose','旧姿势',11,'done',1,'done','old prompt',1152,2048,'/images/photo_studio/old.png','2026-11-01','2026-11-01');`);
  const before = db.prepare('SELECT rowid,* FROM photo_studio_jobs').get();
  migratePhotoStudioSchema(db);
  migratePhotoStudioSchema(db);
  const after = db.prepare('SELECT rowid,* FROM photo_studio_jobs').get();
  for (const [key, value] of Object.entries(before)) assert.equal(after[key], value, key);
  assert.equal(after.character_kind, 'resident');
  assert.equal(after.background_id, '');
  db.prepare("UPDATE photo_studio_jobs SET character_id=NULL,character_kind='angel' WHERE id='old-photo'").run();
  assert.equal(db.prepare('SELECT character_id FROM photo_studio_jobs').get().character_id, null);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_photo_studio_created'").get());
});
