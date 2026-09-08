import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import Database from 'better-sqlite3';
import { centralPersonaFixture } from './fixtures/townAppearanceFixture.js';
import { createTownAppearanceSignature, townAssetAppearanceStatus } from '../src/services/town/townAppearanceSignature.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Execute unchanged production function bodies. Only dependency boundaries are replaced;
// never load production module initializers, singleton DB, files or real model clients.
function functionsFrom(file, names, dependencies, extra = '') {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const body = names.map(name => {
    const match = source.match(new RegExp(`^(?:export )?(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, `missing function ${name}`);
    return match[0].replace(/^export /, '');
  }).join('\n').replace(/await import\('[^']+'\)/g, 'await dynamicDependencies()');
  return compileFunction(`${body}\nreturn { ${names.join(',')}${extra} };`, Object.keys(dependencies))(...Object.values(dependencies));
}

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE town_world_state(world_id TEXT, epoch INTEGER);
    INSERT INTO town_world_state VALUES ('caller-world',1);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY, character_id INTEGER, persona TEXT, display_name TEXT,
      job TEXT, created_at TEXT, sprite_ready INTEGER);
    INSERT INTO town_npcs VALUES(7,NULL,'original persona','NPC','店员','original',0);
    CREATE TABLE characters(id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, base_prompt TEXT,
      short_prompt TEXT, standing_url TEXT, created_at TEXT);
    INSERT INTO characters VALUES(8,'角色','角色','原人格','简短人格',NULL,'original');`);
  const world = () => {
    const row = db.prepare('SELECT * FROM town_world_state').get();
    return { worldId: row.world_id, epoch: row.epoch };
  };
  const calls = { prompt: 0, assets: [], deleted: [], progress: [], persisted: 0 };
  const assets = new Map();
  let pause = null;
  const stopped = deferred();
  async function checkpoint(stage) {
    if (pause?.stage !== stage) return;
    const pending = pause; pause = null;
    pending.entered.resolve();
    await pending.release.promise;
    if (pending.error) throw pending.error;
  }
  const dependencies = {
    ...centralPersonaFixture(db), createTownAppearanceSignature, townAssetAppearanceStatus,
    getDb: () => db, captureTownAssetWorld: world, SPRITE_DIRECTIONS: ['down', 'up'],
    npcAppearanceInfo: () => 'fixture NPC', npcAppearanceSection: () => 'fixture appearance',
    playerAppearanceInfo: () => 'fixture player', getWorldStyleTags: () => 'pixel',
    getAssetsByKey: keys => keys.map(key => assets.get(key)).filter(Boolean),
    listAssets: () => [...assets.values()],
    generateSpritePrompt: async () => { calls.prompt++; await checkpoint('prompt'); return 'sprite prompt'; },
    generatePortraitPrompt: async () => { calls.prompt++; await checkpoint('prompt'); return 'portrait prompt'; },
    createAsset: async args => {
      assert.deepEqual(args.expectedWorld, world(), 'caller must propagate its captured world');
      calls.assets.push(args); await checkpoint('asset');
      args.appearanceGuard?.assertCurrent();
      const result = { id: calls.assets.length, ...args, meta: {...args.meta,
        ...(args.appearanceGuard?{appearanceSource:args.appearanceGuard.source}:{})}, status: 'ready', image_path: '/fixture.png' };
      assets.set(args.key, result); return result;
    },
    regenerateAsset: async (id, args) => {
      assert.deepEqual(args.expectedWorld, world());
      calls.assets.push({ id, ...args }); await checkpoint('asset');
      args.appearanceGuard?.assertCurrent();
      const prior=[...assets.values()].find(a=>a.id===id);
      const result={...prior,id,...args,meta:{...prior?.meta,...(args.appearanceGuard?{appearanceSource:args.appearanceGuard.source}:{})},status:'ready',image_path:'/fixture.png'};
      if (prior) assets.set(prior.key,result);
      return result;
    },
    deleteAsset: id => calls.deleted.push(id),
    dynamicDependencies: async () => ({ buildCharacterPersona: () => 'fixture persona',
      playerAppearanceInfo: () => 'fixture player', generateSpritePrompt: dependencies.generateSpritePrompt }),
    console: { warn: () => stopped.resolve(), log: () => {} },
  };
  const npc = functionsFrom('../src/services/town/townNpcService.js', [
    'npcToDto', 'getNpc', 'captureNpcAppearance', 'imageGenerationGuard', 'generateNpcSprites', 'generateNpcPortrait', 'generateCharacterPortrait',
    'getPlayerKit', 'regeneratePlayerSprite', 'regeneratePlayerKit', 'regeneratePlayerPortrait',
  ], dependencies);
  return { db, world, dependencies, calls, npc, assets, stopped,
    advance: () => db.exec('UPDATE town_world_state SET epoch = epoch + 1'),
    pauseAt(stage, error) { pause = { stage, entered: deferred(), release: deferred(), error }; return pause; },
  };
}
const stale = { code: 'TOWN_ASSET_STALE' };

test('explicit character/NPC generation refreshes unknown/stale ready assets but skips current ones',async t=>{
  const f=fixture(t);
  f.db.exec('UPDATE town_npcs SET character_id=8');
  const state={generation:1,meta:new Map()};
  const service=functionsFrom('../src/services/town/townService.js',['generateCharacterSprites'],{
    ...f.dependencies,state,spriteUrlsByKey:()=>({})});
  f.assets.set('char_8_down',{id:70,key:'char_8_down',status:'ready',meta:{},image_path:'/legacy.png'});
  await service.generateCharacterSprites(8,{refreshAppearance:true});const first=f.calls.prompt;assert.equal(first,2);
  await service.generateCharacterSprites(8);assert.equal(f.calls.prompt,first);
  await f.npc.generateNpcSprites(7);const withNpc=f.calls.prompt;
  assert.equal(f.npc.getNpc(7).sprites.down.appearanceStatus,'current');
  f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,8,'2999-01-01')");
  assert.equal(f.npc.getNpc(7).sprites.down.appearanceStatus,'needs_update');
  await service.generateCharacterSprites(8,{refreshAppearance:true});await f.npc.generateNpcSprites(7,{refreshAppearance:true});
  assert.equal(f.calls.prompt,withNpc+4);assert.equal(f.npc.getNpc(7).sprites.down.appearanceStatus,'current');
});

test('default missing-sprite generation preserves historical ready image; explicit refresh updates it',async t=>{
  for (const kind of ['character','npc']) await t.test(kind,async t=>{
    const f=fixture(t),state={generation:1,meta:new Map()};
    const service=functionsFrom('../src/services/town/townService.js',['generateCharacterSprites'],{
      ...f.dependencies,state,spriteUrlsByKey:()=>({})});
    const key=kind==='character'?'char_8_down':'npc_7_down';
    const legacy={id:70,key,status:'ready',image_path:'/legacy.png',meta:{}};f.assets.set(key,legacy);
    const generate=options=>kind==='character'?service.generateCharacterSprites(8,options):f.npc.generateNpcSprites(7,options);
    await generate();assert.equal(f.calls.prompt,1);assert.deepEqual(f.assets.get(key),legacy);
    await generate({refreshAppearance:'true'});assert.equal(f.calls.prompt,1);
    await generate({refreshAppearance:true});assert.equal(f.calls.prompt,2);assert.ok(f.assets.get(key).meta.appearanceSource);
    await generate({refreshAppearance:true});assert.equal(f.calls.prompt,2);
  });
});

test('character listing annotates per-asset status lazily and leaves standing permanently unknown',async t=>{
  const f=fixture(t);
  f.db.exec("ALTER TABLE characters ADD COLUMN avatar_path TEXT; CREATE TABLE town_characters(character_id INTEGER,town_enabled INTEGER); INSERT INTO town_characters VALUES(8,1)");
  const state={generation:1,meta:new Map(),agents:new Map()};
  const service=functionsFrom('../src/services/town/townService.js',['generateCharacterSprites','listTownCharacters'],{
    ...f.dependencies,state,spriteUrlsByKey:()=>({})});
  assert.deepEqual(service.listTownCharacters()[0].appearanceStatus,{sprites:{down:'unknown',up:'unknown'},portrait:'unknown',standing:'unknown'});
  await service.generateCharacterSprites(8);assert.equal(service.listTownCharacters()[0].appearanceStatus.sprites.down,'current');
  f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,8,'2999-01-01')");
  assert.equal(service.listTownCharacters()[0].appearanceStatus.sprites.down,'needs_update');
  f.db.exec("UPDATE characters SET standing_url='/standing.png'");const before=f.calls.prompt;
  assert.equal((await f.npc.generateCharacterPortrait(8)).reused,true);assert.equal(f.calls.prompt,before);
  assert.equal(service.listTownCharacters()[0].appearanceStatus.standing,'unknown');
});

test('NPC/player/character portrait outer prompts cannot create/delete assets after world reset', async t => {
  for (const [name, args] of [
    ['generateNpcSprites', [7, { force: true }]], ['generateNpcPortrait', [7]],
    ['generateCharacterPortrait', [8]], ['regeneratePlayerSprite', ['down']],
    ['regeneratePlayerKit', []], ['regeneratePlayerPortrait', []],
  ]) await t.test(name, async t => {
    const f = fixture(t);
    const pause = f.pauseAt('prompt');
    const rejected = assert.rejects(f.npc[name](...args), stale);
    await pause.entered.promise;
    f.advance(); pause.release.resolve(); await rejected;
    assert.equal(f.calls.assets.length, 0);
    assert.equal(f.calls.deleted.length, 0);
    assert.equal(f.calls.prompt, 1);
    assert.equal(f.db.prepare('SELECT sprite_ready FROM town_npcs').get().sprite_ready, 0);
  });
});

test('NPC checks after asset await and on rejected prompt; does not continue or mark sprites ready', async t => {
  for (const stage of ['asset', 'prompt']) await t.test(stage, async t => {
    const f = fixture(t);
    const pause = f.pauseAt(stage, stage === 'prompt' ? new Error('backend failure') : null);
    const rejected = assert.rejects(f.npc.generateNpcSprites(7), stale);
    await pause.entered.promise;
    f.advance(); pause.release.resolve(); await rejected;
    assert.equal(f.calls.prompt, 1);
    assert.equal(f.db.prepare('SELECT sprite_ready FROM town_npcs').get().sprite_ready, 0);
  });
});

test('same-world NPC identity/persona replacement rejects old outer prompt', async t => {
  const f = fixture(t);
  const pause = f.pauseAt('prompt');
  const rejected = assert.rejects(f.npc.generateNpcPortrait(7), stale);
  await pause.entered.promise;
  f.db.exec("UPDATE town_npcs SET persona = 'replacement persona'");
  pause.release.resolve(); await rejected;
  assert.equal(f.calls.assets.length, 0);
});

test('normal NPC sprites and player kit retain sequence and use one captured world', async t => {
  const f = fixture(t);
  const result = await f.npc.generateNpcSprites(7);
  assert.equal(result.spriteReady, true);
  assert.equal(f.db.prepare('SELECT sprite_ready FROM town_npcs').get().sprite_ready, 1);
  await f.npc.regeneratePlayerKit();
  assert.deepEqual(f.calls.assets.map(a => a.key), ['npc_7_down', 'npc_7_up', 'player_down', 'player_up', 'player_portrait']);
  assert.ok(f.calls.assets.every(a => a.expectedWorld.epoch === 1));
  await assert.rejects(f.npc.regeneratePlayerKit({ expectedWorld: { worldId: 'caller-world', epoch: 9 } }), stale);
  assert.equal(f.calls.assets.length, 5);
});

test('townService character generation guards reload generation before asset calls and memory updates', async t => {
  for (const stage of ['prompt', 'asset']) await t.test(stage, async t => {
    const f = fixture(t);
    const state = { generation: 1, meta: new Map([['char:8', { sprites: 'original' }]]) };
    const service = functionsFrom('../src/services/town/townService.js', ['generateCharacterSprites'], {
      ...f.dependencies, state, buildCharacterAppearanceSection: () => 'fixture', spriteUrlsByKey: () => 'new',
    });
    const pause = f.pauseAt(stage);
    const rejected = assert.rejects(service.generateCharacterSprites(8), stale);
    await pause.entered.promise;
    state.generation++; pause.release.resolve(); await rejected;
    assert.equal(state.meta.get('char:8').sprites, 'original');
    assert.equal(f.calls.prompt, 1);
  });
});

function wizardFixture(t) {
  const f = fixture(t);
  const item = key => ({ key, name: key, desc: key });
  const job = { blueprint: { styleTags: '', groundAssets: [item('grass')], roadAssets: [item('road')],
    buildings: [item('cafe')], props: [item('bench')] }, config: { worldSettingId: null, mapCols: 4, mapRows: 4 },
    warnings: [], progress: {}, sampleAssetIds: [], status: 'samples_pending' };
  const deps = { ...f.dependencies, job, jobChain: Promise.resolve(),
    persistJob: () => { f.calls.persisted++; },
    setStatus: status => { job.status = status; }, getInitState: () => ({ status: job.status }),
    broadcastTownInitProgress: info => f.calls.progress.push(info),
    getWorldSetting: () => null, townPromptSystemMessages: () => [],
    buildLayoutOutputStructure: () => '', buildLayoutTaskRequirements: () => '',
    expandLayout: () => ({ warnings: [] }),
    safeJsonParse: text => JSON.parse(text),
    chatSync: async () => { await f.dependencies.generateSpritePrompt(); return '{"prompts":{"grass":"new","road":"new"}}'; },
  };
  const wizard = functionsFrom('../src/services/town/townInitService.js', [
    'enqueueStep', 'captureInitGenerationGuard', 'generateSamples', 'expandBatchJobs', 'startBatch',
    'generateAssetPrompts', 'generateLayout', 'spawnPlayerSprites',
  ], deps, ', replaceJob: next => { job = next; }');
  return { ...f, job, wizard };
}

test('wizard sample/batch cancellation or epoch change stops remaining generation and persistence', async t => {
  for (const method of ['generateSamples', 'startBatch']) {
    for (const cancel of [false, true]) await t.test(`${method} cancel=${cancel}`, async t => {
      const f = wizardFixture(t);
      const pause = f.pauseAt('asset');
      const rejected = assert.rejects(f.wizard[method](), stale);
      await pause.entered.promise;
      if (cancel) f.wizard.replaceJob({ blueprint: null, status: 'idle' }); else f.advance();
      const saved = f.calls.persisted;
      const broadcasts = f.calls.progress.length;
      pause.release.resolve(); await rejected;
      assert.equal(f.calls.assets.length, 1);
      assert.equal(f.calls.persisted, saved);
      assert.equal(f.calls.progress.length, broadcasts);
      assert.deepEqual(f.job.warnings, []);
    });
  }
});

test('wizard queued task captures job before enqueue and refuses cancelled replacement', async t => {
  const f = wizardFixture(t);
  const pending = f.wizard.generateSamples();
  f.wizard.replaceJob({ blueprint: null, status: 'idle' });
  await assert.rejects(pending, stale);
  assert.equal(f.calls.assets.length, 0);
  assert.equal(f.calls.persisted, 0);
});

test('wizard prompt/layout results never overwrite cancelled draft or persist progress', async t => {
  for (const method of ['generateAssetPrompts', 'generateLayout']) await t.test(method, async t => {
    const f = wizardFixture(t);
    for (let i = 0; i < 4; i++) f.assets.set(`asset-${i}`, { id: i, kind: 'ground', status: 'ready' });
    const pause = f.pauseAt('prompt');
    const rejected = assert.rejects(f.wizard[method](), stale);
    await pause.entered.promise;
    f.wizard.replaceJob({ blueprint: null, status: 'idle' });
    pause.release.resolve(); await rejected;
    assert.equal(f.job.blueprint.groundAssets[0].desc, 'grass');
    assert.equal(f.job.draftMap, undefined);
    assert.equal(f.calls.persisted, 0);
  });
});

test('wizard background player task stops on cancellation before create and second direction', async t => {
  const f = wizardFixture(t);
  const pause = f.pauseAt('prompt');
  f.wizard.spawnPlayerSprites('player', 'pixel');
  await pause.entered.promise;
  f.wizard.replaceJob({ blueprint: null, status: 'idle' });
  pause.release.resolve();
  await f.stopped.promise;
  assert.equal(f.calls.assets.length, 0);
  assert.equal(f.calls.prompt, 1);
});

test('normal wizard sample and batch completion retain progress semantics', async t => {
  const f = wizardFixture(t);
  assert.equal((await f.wizard.generateSamples()).status, 'batch_pending');
  assert.equal(f.job.sampleAssetIds.length, 3);
  assert.equal((await f.wizard.startBatch()).status, 'layout_pending');
  assert.equal(f.calls.assets.length, 4);
  assert.equal(f.job.progress.done, 1);
});
