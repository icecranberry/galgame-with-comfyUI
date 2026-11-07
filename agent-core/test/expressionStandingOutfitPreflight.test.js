import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('network forbidden in outfit preflight tests'); };
const { getDb } = await import('../src/db/index.js');
const service = await import('../src/services/expressionStandingService.js');
const { recoverExpressionStandingJobs } = await import('../src/db/expressionStandingSchema.js');
const db = getDb();
db.prepare('DELETE FROM characters').run();
afterEach(() => db.prepare('DELETE FROM characters').run());
after(() => db.close());

function add(name, description) {
  const id = Number(db.prepare('INSERT INTO characters(name,display_name,base_prompt) VALUES(?,?,?)').run(name, name, '你是测试角色。\n## 你的外观\n白色制服，银发蓝瞳').lastInsertRowid);
  if (description !== undefined) db.prepare('INSERT INTO character_outfits(character_id,name,description,scene) VALUES(?,?,?,?)').run(id, '便装', description, 'casual');
  return id;
}
async function finished(jobId, status) {
  for (let i = 0; i < 300; i++) {
    const job = db.prepare('SELECT * FROM expression_standing_jobs WHERE id=?').get(jobId);
    if (status ? job.status === status : ['done', 'failed', 'partial_failed'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('standing job did not reach expected status');
}
function dependencies(calls = []) {
  return {
    promptGenerator: async (char, slots, requirement, persona, scene) => {
      calls.push({ id: char.id, persona, scene, requirement });
      return new Map(slots.map(slot => [slot.id, 'A character wearing an outfit.']));
    },
    imageGenerator: async () => { throw new Error('fixture: no image generation'); },
    touchLinesGenerator: async () => { throw new Error('fixture: no touch generation'); },
    outfitGenerator: async () => { throw new Error('unexpected outfit generation'); },
  };
}

test('preflight lists only missing/blank outfits and filters complete or busy characters for the requested mode', async () => {
  const missing = add('missing'), blank = add('blank', '  '), ready = add('ready', 'Red dress');
  const all = service.previewStandingBatches({ mode: 'all', outfitScene: 'casual' });
  assert.deepEqual(all.missingCharacters.map(char => char.id), [missing, blank]);
  assert.equal(all.targetCount, 3);
  assert.equal(all.sceneLabel, '私服');
  assert.deepEqual(service.previewCharacterStandingBatch(ready, { outfitScene: 'casual' }).missingCharacters, []);
  assert.deepEqual(service.previewStandingBatches({ mode: 'all', outfitScene: 'work' }).missingCharacters, []);
  for (const slot of service.standingSlots()) db.prepare("INSERT INTO character_expression_standings(character_id,slot_id,image_url) VALUES(?,?,?)").run(missing, slot.id, '/existing.png');
  assert.deepEqual(service.previewStandingBatches({ mode: 'missing', outfitScene: 'casual' }).missingCharacters.map(char => char.id), [blank]);
  const task = service.startStandingBatch(blank, { slotIds: ['normal'], outfitScene: 'casual', missingOutfitPolicy: 'fallback' }, dependencies());
  assert.deepEqual(service.previewStandingBatches({ mode: 'missing', outfitScene: 'casual' }).missingCharacters, []);
  await finished(task.jobId);
});

test('missing outfits cannot submit any jobs without an explicit choice, including mixed batches', () => {
  const id = add('missing'); add('ready', 'Existing clothing');
  assert.throws(() => service.startStandingBatch(id, { outfitScene: 'casual' }, dependencies()), error => error.status === 409);
  assert.throws(() => service.startAllStandingBatches({ mode: 'all', outfitScene: 'casual' }, dependencies()), error => error.status === 409);
  assert.throws(() => service.startStandingBatch(id, { outfitScene: 'casual', missingOutfitPolicy: 'skip' }), error => error.status === 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM expression_standing_jobs').get().n, 0);
});

test('skip completion still generates missing characters using default appearance and preserves ready clothing', async () => {
  const missing = add('missing'), ready = add('ready', 'Red casual dress');
  const calls = [];
  const result = service.startAllStandingBatches({ mode: 'all', outfitScene: 'casual', missingOutfitPolicy: 'fallback', requirement: '黑发' }, dependencies(calls));
  for (const task of result.started) await finished(task.jobId);
  assert.equal(result.started.length, 2);
  assert.equal(calls.find(call => call.id === missing).scene, 'work');
  assert.match(calls.find(call => call.id === missing).persona, /白色制服/);
  assert.equal(calls.find(call => call.id === ready).scene, 'casual');
  assert.match(calls.find(call => call.id === ready).persona, /Red casual dress/);
  assert.ok(calls.every(call => call.requirement === '黑发'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM character_outfits WHERE character_id=?').get(missing).n, 0);
});

test('automatic completion saves only the selected missing scene before prompting and never replaces existing clothes', async () => {
  const id = add('missing', ''); add('ready', 'User clothing');
  const calls = [], designed = [];
  const deps = { ...dependencies(calls), outfitGenerator: async (char, opts) => {
    designed.push(char.id);
    assert.deepEqual(opts.scenes, ['casual']);
    assert.match(opts.baseAppearance, /白色制服/);
    return [{ scene: 'casual', name: '便装', description: 'New red dress' }, { scene: 'home', name: '多余', description: 'Must not save' }];
  } };
  const result = service.startAllStandingBatches({ mode: 'all', outfitScene: 'casual', missingOutfitPolicy: 'generate' }, deps);
  for (const task of result.started) await finished(task.jobId);
  assert.deepEqual(designed, [id]);
  assert.match(calls.find(call => call.id === id).persona, /New red dress/);
  assert.equal(calls.find(call => call.id === id).scene, 'casual');
  assert.equal(db.prepare("SELECT count(*) AS n FROM character_outfits WHERE scene='home'").get().n, 0);
  const saved = JSON.parse(db.prepare('SELECT request_json FROM expression_standing_jobs WHERE character_id=?').get(id).request_json);
  assert.equal(saved.missingOutfitPolicy, 'generate');
  assert.equal(saved.promptsReady, true);
  assert.match(saved.persona, /New red dress/);
});

test('failed completion stops before prompts or images and does not silently fall back', async () => {
  const id = add('missing'), calls = [];
  const task = service.startStandingBatch(id, { slotIds: ['normal'], outfitScene: 'sleep', missingOutfitPolicy: 'generate' }, dependencies(calls));
  const job = await finished(task.jobId);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /自动补全服装失败/);
  assert.deepEqual(calls, []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM character_outfits').get().n, 0);
});

test('stop during completion saves clothing but waits for resume before prompts; concurrent edits win', async () => {
  const id = add('missing'); let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const calls = [];
  const task = service.startStandingBatch(id, { slotIds: ['normal'], outfitScene: 'casual', missingOutfitPolicy: 'generate' }, {
    ...dependencies(calls), outfitGenerator: async () => { await waiting; return [{ scene: 'casual', name: '便装', description: 'Generated clothes' }]; },
  });
  await finished(task.jobId, 'outfits');
  service.controlStandingBatch(id, task.jobId, 'stop');
  db.prepare('INSERT INTO character_outfits(character_id,name,description,scene) VALUES(?,?,?,?)').run(id, '用户', 'User edited clothes', 'casual');
  release(); await finished(task.jobId, 'paused');
  assert.deepEqual(calls, []);
  service.controlStandingBatch(id, task.jobId, 'resume');
  await finished(task.jobId);
  assert.match(calls[0].persona, /User edited clothes/);
  assert.doesNotMatch(calls[0].persona, /Generated clothes/);
});

test('restart during clothing completion restores the decision and completes the missing outfit', async () => {
  const id = add('interrupted');
  db.prepare("INSERT INTO expression_standing_jobs(id,character_id,slots_json,status,request_json) VALUES(?,?,'[\"normal\"]','outfits',?)").run('outfit-restart', id, JSON.stringify({ outfitScene: 'casual', persona: null, missingOutfitPolicy: 'generate', promptsReady: false, requirement: 'green eyes' }));
  recoverExpressionStandingJobs(db);
  const calls = [];
  const task = service.controlStandingBatch(id, 'outfit-restart', 'resume', {
    ...dependencies(calls), outfitGenerator: async () => [{ scene: 'casual', name: '便装', description: 'Recovered clothing' }],
  });
  await finished(task.jobId);
  assert.match(calls[0].persona, /Recovered clothing/);
  assert.equal(calls[0].requirement, 'green eyes');
});

for (const policy of ['generate', 'fallback', 'existing']) test(`paused restart applies edited direction and clothing (${policy})`, async () => {
  const id = add('paused-edit', policy === 'existing' ? 'Existing red dress' : undefined);
  const calls = [], designed = [];
  const task = service.startStandingBatch(id, { slotIds: ['normal'], requirement: 'old direction' }, {
    ...dependencies(calls),
    outfitGenerator: async (_, options) => {
      designed.push(options.scenes);
      return [{ scene: 'casual', name: '新私服', description: 'New blue dress' }];
    },
  });
  service.controlStandingBatch(id, task.jobId, 'stop');
  const paused = await finished(task.jobId, 'paused');
  const preview = service.previewCharacterStandingBatch(id, { outfitScene: 'casual' });
  assert.equal(preview.targetCount, 1);
  assert.equal(preview.missingCharacters.length, policy === 'existing' ? 0 : 1);
  const options = { requirement: '  new direction  ', outfitScene: 'casual' };
  if (policy !== 'existing') {
    assert.throws(() => service.controlStandingBatch(id, task.jobId, 'restart', undefined, options), /缺少所选服装/);
    assert.equal((await finished(task.jobId, 'paused')).request_json, paused.request_json);
    options.missingOutfitPolicy = policy;
  }
  service.controlStandingBatch(id, task.jobId, 'restart', undefined, options);
  const job = await finished(task.jobId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requirement, 'new direction');
  assert.equal(calls[0].scene, policy === 'fallback' ? 'work' : 'casual');
  assert.match(calls[0].persona, policy === 'fallback' ? /白色制服/ : policy === 'existing' ? /Existing red dress/ : /New blue dress/);
  assert.deepEqual(designed, policy === 'generate' ? [['casual']] : []);
  const snapshot = JSON.parse(job.request_json);
  assert.equal(snapshot.requirement, 'new direction');
  assert.equal(snapshot.outfitScene, calls[0].scene);
  assert.equal(snapshot.persona, calls[0].persona);
});

test('resume ignores draft direction and keeps the original request', async () => {
  const id = add('resume-original'), calls = [];
  const task = service.startStandingBatch(id, { slotIds: ['normal'], requirement: 'original direction' }, dependencies(calls));
  service.controlStandingBatch(id, task.jobId, 'stop');
  await finished(task.jobId, 'paused');
  service.controlStandingBatch(id, task.jobId, 'resume', undefined, { requirement: 'draft direction', outfitScene: 'casual' });
  await finished(task.jobId);
  assert.equal(calls[0].requirement, 'original direction');
  assert.equal(calls[0].scene, 'work');
});
