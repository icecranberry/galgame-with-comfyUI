import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { migratePhotoStudioSchema } from '../src/db/photoStudioSchema.js';
import { createPhotoStudioService, getPoseCatalog, getRecognizedPoseCatalog } from '../src/services/photoStudioService.js';

const soloPose = { id: 'pose', system: '全身单人・标准系', name: 'Pose', angle: 'Front', posePrompt: 'seated on the floor, leaning back' };
const pairPose = {
  id: 'pair-pose', system: '双人缠绵', name: 'Pair pose', angle: 'Front', posePrompt: 'two people embrace',
  characterRoles: ['standing in front', 'standing behind'],
};

test('the full catalog preserves uncalibrated entries while the studio catalog exposes only recognized poses', async () => {
  const catalog = await getPoseCatalog();
  assert.equal(catalog.length, 1439);
  const { prompts } = JSON.parse(await fs.readFile(new URL('../assets/pose-gallery/pose-prompts.json', import.meta.url), 'utf8'));
  const catalogIds = new Set(catalog.map(pose => pose.id));
  for (const [id, description] of Object.entries(prompts)) {
    assert.ok(catalogIds.has(id), `Unknown pose id: ${id}`);
    if (/^pair/i.test(id)) {
      assert.equal(typeof description?.posePrompt, 'string', id);
      assert.ok(description.posePrompt.trim(), id);
      assert.equal(description.characterRoles?.length, 2, id);
      assert.ok(description.characterRoles.every(role => typeof role === 'string' && role.trim()), id);
    } else {
      assert.equal(typeof description, 'string', id);
      assert.ok(description.trim(), id);
    }
  }
  const calibrated = catalog.filter(pose => pose.posePrompt);
  assert.deepEqual(calibrated.map(pose => pose.id), catalog.filter(pose => Object.hasOwn(prompts, pose.id)).map(pose => pose.id));
  const originalSingleIds = [
    'full_single_P001_front', 'full_single_P001_high', 'full_single_P001_low',
    'full_single_P001_side', 'full_single_P001_diag',
  ];
  assert.ok(originalSingleIds.every(id => calibrated.some(pose => pose.id === id && pose.system === '全身单人・标准系' && pose.name === '后仰坐・单膝立起')));
  const studioCatalog = await getRecognizedPoseCatalog();
  assert.deepEqual(studioCatalog.map(pose => pose.id), calibrated.map(pose => pose.id));
  assert.equal(studioCatalog.length, Object.keys(prompts).length);

  const pair042 = studioCatalog.find(pose => pose.id === 'pair60_P042_front');
  assert.equal(pair042.name, '盘腿相拥');
  assert.match(pair042.posePrompt, /sits on their lap/);
  assert.match(pair042.characterRoles[0], /seated base/);
  assert.match(pair042.characterRoles[1], /seated on character 1's lap/);

  const pair051 = studioCatalog.find(pose => pose.id === 'pair60_P051_front');
  assert.equal(pair051.name, '耳边低语・手触脸颊');
  assert.match(pair051.posePrompt, /back hug/);
  assert.match(pair051.characterRoles[0], /person in front/);
  assert.match(pair051.characterRoles[1], /person behind/);

  const pair054 = studioCatalog.find(pose => pose.id === 'pair60_P054_front');
  assert.equal(pair054.name, '被横抱・背部后仰');
  assert.match(pair054.posePrompt, /bridal carry/);
  assert.match(pair054.characterRoles[0], /carried partner/);
  assert.match(pair054.characterRoles[1], /carrier behind/);
});

async function fixture(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, base_prompt TEXT, short_prompt TEXT, avatar_path TEXT, standing_url TEXT, archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0);
    INSERT INTO characters VALUES (1, 'first', 'A', '', '', NULL, NULL, 0, 1);
    INSERT INTO characters VALUES (2, 'second', 'B', '', '', NULL, NULL, 0, 0);
    CREATE TABLE image_tasks (id INTEGER PRIMARY KEY, prompt_original TEXT, prompt_refined TEXT, status TEXT, output_paths TEXT, workflow_template TEXT, finished_at TEXT, error_message TEXT);
    CREATE TABLE character_outfits (id INTEGER PRIMARY KEY, character_id INTEGER, scene TEXT, description TEXT);`);
  migratePhotoStudioSchema(db);
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toBuffer();
  const calls = [];
  const service = createPhotoStudioService({
    database: () => db,
    catalog: async () => [soloPose, pairPose],
    capability: async () => ({ available: true, engine: 'Anima · base' }),
    persona: character => `appearance of ${character.display_name}`,
    render: async (prompt, options) => { calls.push({ prompt, options }); return { success: true, wfMode: 'base', images: [{ base64: bytes.toString('base64') }] }; },
    save: async () => '/images/photo_studio/test.avif',
    ...overrides,
  });
  return { db, service, calls };
}

const request = { id: 'test-request-123', characterId: 1, poseId: 'pose' };
async function waitForJob(service, id) {
  const deadline = Date.now() + 10000;
  while (service.job(id).status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  return service.job(id);
}

test('studio sends the composed prompt and exact dimensions to the existing Anima generation path', async () => {
  const f = await fixture();
  try {
    await f.service.submit(request);
    await f.service.submit(request);
    const job = await waitForJob(f.service, request.id);
    assert.equal(job.status, 'done');
    assert.equal(job.output_url, '/images/photo_studio/test.avif');
    assert.equal(job.width, 1200);
    assert.equal(job.height, 1600);
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].prompt, /seated on the floor/);
    assert.match(f.calls[0].prompt, /appearance of A/);
    assert.equal(f.calls[0].options.alreadyPrepared, true);
    assert.equal(f.calls[0].options.promptScene, 'standalone');
    assert.deepEqual([f.calls[0].options.width, f.calls[0].options.height], [1200, 1600]);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM image_tasks').get().n, 1);
    const task = f.db.prepare('SELECT status, workflow_template FROM image_tasks').get();
    assert.equal(task.status, 'done');
    assert.equal(task.workflow_template, 'photo-studio-anima-base');
  } finally { f.db.close(); }
});

test('preview and submit use the same concise prompt, and preview never creates a job or image task', async () => {
  const f = await fixture({ persona: undefined });
  try {
    f.db.prepare('UPDATE characters SET display_name = ?, base_prompt = ? WHERE id = 1').run('爱莉希雅', 'Personality\n## 你的外观\nElysia (Honkai Impact 3rd) has pink hair, wearing a white shirt.');
    const preview = await f.service.preview(request);
    assert.equal(preview.prompt, '(seated on the floor, leaning back)\n\n(Elysia (Honkai Impact 3rd) has pink hair, wearing a white shirt.)');
    assert.equal(f.service.list().length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM image_tasks').get().n, 0);
    await f.service.submit(request);
    const job = await waitForJob(f.service, request.id);
    assert.equal(job.prompt, preview.prompt);
    assert.equal(f.calls[0].prompt, preview.prompt);
  } finally { f.db.close(); }
});

test('pair poses honor an explicit partner or choose a different character at random', async () => {
  const f = await fixture({ random: choices => choices[0] });
  try {
    await f.service.submit({ id: 'pair-request-001', characterId: 1, poseId: 'pair-pose' });
    const randomPair = await waitForJob(f.service, 'pair-request-001');
    assert.equal(randomPair.character_name, 'A');
    assert.equal(randomPair.character2_name, 'B');
    assert.doesNotMatch(randomPair.prompt, /preserve|exactly two people/);
    await f.service.submit({ id: 'pair-request-002', characterId: 1, secondCharacterId: 2, poseId: 'pair-pose' });
    const selectedPair = await waitForJob(f.service, 'pair-request-002');
    assert.equal(selectedPair.character2_name, 'B');
    assert.equal(selectedPair.status, 'done');
    assert.match(selectedPair.prompt, /\(first, appearance of A\)/);
    assert.match(selectedPair.prompt, /\(second, appearance of B\)/);
    await f.service.submit({ id: 'pair-reverse-001', characterId: 2, secondCharacterId: 1, poseId: 'pair-pose', width: 1288, height: 1736 });
    const reverse = await waitForJob(f.service, 'pair-reverse-001');
    assert.equal(reverse.character_name, 'B');
    assert.equal(reverse.character2_name, 'A');
    assert.match(reverse.prompt, /\(second, appearance of B\)/);
    assert.match(reverse.prompt, /\(first, appearance of A\)/);
    assert.deepEqual([f.calls[2].options.width, f.calls[2].options.height], [1288, 1736]);
  } finally { f.db.close(); }
});

test('studio defaults to the original clothes and substitutes English names in pair roles', async () => {
  // Using the real persona builder also proves this path never queries automatic/scheduled outfits.
  const f = await fixture({ persona: undefined, catalog: async () => [{ ...pairPose, posePrompt: 'character 2 embraces character 1', characterRoles: ['in front of character 2', 'behind character 1'] }] });
  try {
    f.db.prepare('UPDATE characters SET display_name = ?, base_prompt = ? WHERE id = ?').run('琪亚娜', 'Personality\n## 你的外观\nKiana Kaslana (Honkai Impact 3rd) has white hair, wearing a white uniform.', 1);
    f.db.prepare('UPDATE characters SET display_name = ?, base_prompt = ? WHERE id = ?').run('芽衣', 'Personality\n## 你的外观\nRaiden Mei (Honkai Impact 3rd) has purple hair, wearing a purple uniform.', 2);
    f.db.prepare('INSERT INTO character_outfits (character_id, scene, description) VALUES (?, ?, ?)').run(1, 'sleep', 'Kiana Kaslana (Honkai Impact 3rd) has white hair, wearing pink pajamas.');
    await f.service.submit({ ...request, poseId: 'pair-pose', secondCharacterId: 2 });
    const job = await waitForJob(f.service, request.id);
    assert.equal(job.status, 'done');
    assert.equal(job.character_name, '琪亚娜');
    assert.match(job.prompt, /Raiden Mei embraces Kiana Kaslana/);
    assert.doesNotMatch(job.prompt, /in front of|behind|preserve|exactly two people/);
    assert.match(job.prompt, /white uniform/);
    assert.match(job.prompt, /purple uniform/);
    assert.doesNotMatch(job.prompt, /琪亚娜|芽衣|pajamas/);
  } finally { f.db.close(); }
});

test('each participant uses the complete selected outfit without mixing in default clothes', async () => {
  const f = await fixture({ persona: undefined });
  try {
    f.db.prepare('UPDATE characters SET base_prompt = ?').run('Personality\n## 你的外观\nDefault (Game) has black hair, wearing a uniform.');
    const insert = f.db.prepare('INSERT INTO character_outfits (character_id, scene, description) VALUES (?, ?, ?)');
    insert.run(1, 'casual', 'Kiana (Game) has white hair, wearing a blue dress.');
    insert.run(2, 'sleep', 'Mei (Game) has purple hair, wearing pink pajamas.');
    await f.service.submit({ ...request, poseId: 'pair-pose', secondCharacterId: 2, outfitScene: 'casual', secondOutfitScene: 'sleep' });
    const job = await waitForJob(f.service, request.id);
    assert.match(job.prompt, /\(Kiana \(Game\) has white hair, wearing a blue dress\.\)/);
    assert.match(job.prompt, /\(Mei \(Game\) has purple hair, wearing pink pajamas\.\)/);
    assert.doesNotMatch(job.prompt, /uniform|Default|Personality/);
    assert.match(f.db.prepare('SELECT base_prompt FROM characters WHERE id = 1').get().base_prompt, /uniform/);
  } finally { f.db.close(); }
});

test('studio exposes only configured outfits and rejects missing or invalid outfit selections', async () => {
  const f = await fixture({ persona: undefined });
  try {
    f.db.exec("INSERT INTO character_outfits (character_id, scene, description) VALUES (1, 'home', 'home clothes'), (1, 'sleep', '  '), (1, 'work', 'stale work clothes'), (2, 'casual', 'casual clothes')");
    assert.deepEqual(f.service.listCharacters().map(char => [char.id, char.outfitScenes]), [[1, ['work', 'home']], [2, ['work', 'casual']]]);
    await assert.rejects(f.service.submit({ ...request, outfitScene: 'invalid' }), error => error.status === 400);
    await assert.rejects(f.service.submit({ ...request, outfitScene: 'casual' }), error => error.status === 400 && /尚未配置/.test(error.message));
    await assert.rejects(f.service.submit({ ...request, poseId: 'pair-pose', secondCharacterId: 2, secondOutfitScene: 'sleep' }), error => error.status === 400);
    assert.equal(f.service.list().length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM image_tasks').get().n, 0);
  } finally { f.db.close(); }
});

test('a random partner always uses default clothes and Chinese internal names use English role labels', async () => {
  const f = await fixture({ persona: undefined, random: choices => choices[0] });
  try {
    f.db.prepare('UPDATE characters SET name = ?, base_prompt = ? WHERE id = 1').run('中文姓名', '## 你的外观\nwhite hair, blue eyes, white coat');
    f.db.prepare('UPDATE characters SET base_prompt = ? WHERE id = 2').run('## 你的外观\nblack hair, purple eyes, blue coat');
    await f.service.submit({ ...request, poseId: 'pair-pose', secondOutfitScene: 'sleep' });
    const job = await waitForJob(f.service, request.id);
    assert.equal(job.status, 'done');
    assert.match(job.prompt, /the first character/);
    assert.doesNotMatch(job.prompt, /中文姓名/);
  } finally { f.db.close(); }
});

test('studio records renderer failures and invalid or uncalibrated submissions without an output', async () => {
  const f = await fixture({ render: async () => ({ success: false, error: 'Renderer unavailable' }) });
  try {
    await assert.rejects(f.service.submit({ ...request, width: 1201 }), error => error.status === 400);
    await assert.rejects(f.service.submit({ ...request, poseId: 'missing' }), error => error.status === 400);
    await assert.rejects(f.service.submit({ ...request, poseId: 'uncalibrated' }), error => error.status === 400);
    await f.service.submit(request);
    const job = await waitForJob(f.service, request.id);
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'Renderer unavailable');
    assert.equal(job.output_url, null);
    assert.equal(f.db.prepare('SELECT status FROM image_tasks').get().status, 'failed');
  } finally { f.db.close(); }
});

test('studio refuses unsupported default engine and duplicate pair characters', async () => {
  const unavailable = await fixture({ capability: async () => ({ available: false, error: 'Missing engine' }) });
  try {
    await assert.rejects(unavailable.service.submit(request), error => error.status === 503);
    assert.equal(unavailable.service.list().length, 0);
  } finally { unavailable.db.close(); }

  const duplicate = await fixture();
  try {
    await assert.rejects(duplicate.service.submit({ id: 'pair-request-003', characterId: 1, secondCharacterId: 1, poseId: 'pair-pose' }), error => error.status === 400);
  } finally { duplicate.db.close(); }
});
