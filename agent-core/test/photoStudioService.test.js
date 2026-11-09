import test from 'node:test';
import assert from 'node:assert/strict';
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
  const calibrated = catalog.filter(pose => pose.posePrompt);
  assert.deepEqual(calibrated.map(pose => pose.id), [
    'full_single_P001_front', 'full_single_P001_high', 'full_single_P001_low',
    'full_single_P001_side', 'full_single_P001_diag',
    'pair60_P042_front', 'pair60_P051_front', 'pair60_P054_front',
  ]);
  assert.ok(calibrated.slice(0, 5).every(pose => pose.system === '全身单人・标准系' && pose.name === '后仰坐・单膝立起'));
  const studioCatalog = await getRecognizedPoseCatalog();
  assert.deepEqual(studioCatalog.map(pose => pose.id), calibrated.map(pose => pose.id));
  assert.equal(studioCatalog.length, 8);

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
    CREATE TABLE image_tasks (id INTEGER PRIMARY KEY, prompt_original TEXT, prompt_refined TEXT, status TEXT, output_paths TEXT, workflow_template TEXT, finished_at TEXT, error_message TEXT);`);
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

test('pair poses honor an explicit partner or choose a different character at random', async () => {
  const f = await fixture({ random: choices => choices[0] });
  try {
    await f.service.submit({ id: 'pair-request-001', characterId: 1, poseId: 'pair-pose' });
    const randomPair = await waitForJob(f.service, 'pair-request-001');
    assert.equal(randomPair.character_name, 'A');
    assert.equal(randomPair.character2_name, 'B');
    assert.match(randomPair.prompt, /two characters, exactly two people/);
    await f.service.submit({ id: 'pair-request-002', characterId: 1, secondCharacterId: 2, poseId: 'pair-pose' });
    const selectedPair = await waitForJob(f.service, 'pair-request-002');
    assert.equal(selectedPair.character2_name, 'B');
    assert.equal(selectedPair.status, 'done');
    assert.match(selectedPair.prompt, /\(A, appearance of A; standing in front\)/);
    assert.match(selectedPair.prompt, /\(B, appearance of B; standing behind\)/);
    await f.service.submit({ id: 'pair-reverse-001', characterId: 2, secondCharacterId: 1, poseId: 'pair-pose', width: 1288, height: 1736 });
    const reverse = await waitForJob(f.service, 'pair-reverse-001');
    assert.equal(reverse.character_name, 'B');
    assert.equal(reverse.character2_name, 'A');
    assert.match(reverse.prompt, /\(B, appearance of B; standing in front\)/);
    assert.match(reverse.prompt, /\(A, appearance of A; standing behind\)/);
    assert.deepEqual([f.calls[2].options.width, f.calls[2].options.height], [1288, 1736]);
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
