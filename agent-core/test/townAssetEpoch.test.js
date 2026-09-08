import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { compileFunction } from 'node:vm';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { centralPersonaFixture } from './fixtures/townAppearanceFixture.js';
import { createTownAppearanceSignature, townAssetAppearanceStatus } from '../src/services/town/townAppearanceSignature.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'town-asset-epoch-'));
  const db = new Database(':memory:');
  t.after(() => {
    db.close();
    // Only the path returned by mkdtemp, never configured production data.
    fs.rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`CREATE TABLE town_world_state (singleton INTEGER PRIMARY KEY, world_id TEXT, epoch INTEGER);
    INSERT INTO town_world_state VALUES (1, 'asset-world', 1);
    CREATE TABLE town_assets (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, key TEXT, name TEXT,
      image_path TEXT, meta_json TEXT DEFAULT '{}', source_prompt TEXT DEFAULT '',
      world_setting_id INTEGER, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const replacement = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#0000ff' } }).png().toBuffer();
  let pause = null;
  let generates = 0;
  const events = [];
  const hooks = async stage => {
    if (pause?.stage !== stage) return;
    const current = pause;
    pause = null;
    current.entered.resolve();
    await current.release.promise;
    if (current.error) throw current.error;
  };
  function instrumentSharp(...args) {
    const instance = sharp(...args);
    const proxy = new Proxy(instance, { get(target, property) {
      if (property === 'metadata') return async (...params) => { await hooks('metadata'); return target.metadata(...params); };
      if (property === 'toBuffer') return async (...params) => { await hooks('crop'); return target.toBuffer(...params); };
      const value = target[property];
      if (typeof value !== 'function') return value;
      return (...params) => { const result = value.apply(target, params); return result === target ? proxy : result; };
    } });
    return proxy;
  }
  const dependencies = {
    fs, path, fileURLToPath, randomUUID, sharp: instrumentSharp, fixtureDirectory: directory,
    getDb: () => db, config: { comfyui: { artist: '' } },
    generateImageRaw: async () => { generates++; await hooks('generate'); return { success: true, images: [{ base64: png.toString('base64') }] }; },
    generateBuildingPrompt: async () => { await hooks('prompt'); return 'fixture building'; },
    flattenIsoTile: async buffer => { await hooks('flatten'); return buffer; },
    postProcessAsset: async buffer => { await hooks('post'); return buffer; },
    detectTileAnchorY: async () => { await hooks('anchor'); return 0.5; },
    refineImage: async ({ filePath, outPath }) => {
      assert.notEqual(filePath, outPath, 'Hires must never receive the original as its output');
      await hooks('hires');
      fs.writeFileSync(outPath, replacement);
    },
    broadcastTownAssetsUpdated: event => events.push(event),
    getTownGenerationSettings: () => ({ steps: {} }), generationStepForAsset: () => 'props',
    isPortraitAsset: () => false, normalizeTownGenerationLoras: x => x,
  };
  const names = [];
  const source = fs.readFileSync(new URL('../src/services/town/townAssetService.js', import.meta.url), 'utf8')
    .replace(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+'[^']+';/g, (_, named, single) => {
      names.push(...(named ? named.split(',').map(name => name.trim()).filter(Boolean) : [single])); return '';
    })
    .replace(/const __dirname = .*?;/, '')
    .replace(/export const TOWN_ASSETS_DIR = .*?;/, 'const TOWN_ASSETS_DIR = fixtureDirectory;')
    .replace(/export (?=(?:async )?function |const )/g, '');
  assert.doesNotMatch(source, /\bimport\s|import\.meta/);
  const exports = ['captureTownAssetWorld', 'createAsset', 'regenerateAsset', 'deleteAsset', 'generateAssetsBatch',
    'getAssetById', 'saveEditedAssetImage', 'cropAssetImage', 'refineAssetWithHires', 'updateAssetGenerationConfig'];
  const service = compileFunction(`${source}\nreturn { ${exports.join(', ')} };`, [...names, 'fixtureDirectory'])(
    ...names.map(name => { assert.ok(name in dependencies, `unmocked dependency ${name}`); return dependencies[name]; }), directory);
  const insert = (id = 1, imagePath = '/town-assets/original.png') => {
    db.prepare(`INSERT INTO town_assets (id,kind,key,name,image_path,meta_json,source_prompt,status)
      VALUES (?, 'prop', 'fixture', 'fixture', ?, '{}', 'original prompt', 'ready')`).run(id, imagePath);
    fs.writeFileSync(path.join(directory, path.basename(imagePath)), png);
    return service.getAssetById(id);
  };
  const reset = ({ id = 1, imagePath = '/town-assets/new-world.png', bumpEpoch = true } = {}) => {
    if (bumpEpoch) db.exec('UPDATE town_world_state SET epoch = epoch + 1');
    db.exec('DELETE FROM town_assets');
    insert(id, imagePath);
    fs.writeFileSync(path.join(directory, path.basename(imagePath)), replacement);
    events.length = 0;
  };
  return { ...service, db, directory, png, replacement, events, insert, reset,
    generates: () => generates,
    pauseAt(stage, error) {
      pause = { stage, entered: deferred(), release: deferred(), error };
      return pause;
    },
  };
}
const job = (extra = {}) => ({ kind: 'prop', key: 'fixture', name: 'fixture', ...extra });
const stale = { code: 'TOWN_ASSET_STALE' };

function appearanceFixture(f) {
  f.db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,base_prompt TEXT,short_prompt TEXT);
    INSERT INTO characters VALUES(1,'角色','角色','人格\n## 你的外观\n黑发','简介');`);
  const central=centralPersonaFixture(f.db);
  const helper=createTownAppearanceSignature({db:f.db,buildAppearanceSection:central.buildCharacterAppearanceSection,buildPersona:central.buildCharacterPersona});
  return ()=>helper.capture({sourceKind:'character',sourceId:1,mode:'sprite'});
}

test('trusted provenance commits with pixels; same-world outfit change at final metadata await preserves old ready image',async t=>{
  const f=await fixture(t),capture=appearanceFixture(f);f.insert();
  const original=await f.regenerateAsset(1,{prompt:'central generated prompt',appearanceGuard:capture()});
  const oldBytes=fs.readFileSync(path.join(f.directory,path.basename(original.image_path)));
  assert.equal(townAssetAppearanceStatus(original,capture()),'current');
  const pause=f.pauseAt('metadata');
  const pending=f.regenerateAsset(1,{prompt:'another trusted prompt',styleTags:'changed style',promptPrefix:'changed prefix',appearanceGuard:capture()});
  const rejected=assert.rejects(pending,stale);await pause.entered.promise;
  f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,1,'2999-01-01')");f.events.length=0;
  pause.release.resolve();await rejected;
  const after=f.getAssetById(1);assert.equal(after.status,'ready');assert.equal(after.image_path,original.image_path);
  assert.equal(after.source_prompt,original.source_prompt);assert.deepEqual(after.meta.appearanceSource,original.meta.appearanceSource);
  const {_assetOperation:oldToken,...oldMeta}=original.meta;
  const {_assetOperation:newToken,...newMeta}=after.meta;
  assert.notEqual(newToken,oldToken);assert.deepEqual(newMeta,oldMeta);
  assert.equal(townAssetAppearanceStatus(after,capture()),'needs_update');assert.equal(f.events.length,0);
  assert.deepEqual(fs.readFileSync(path.join(f.directory,path.basename(after.image_path))),oldBytes);
});

test('lazy expiry during image generation prevents trusted publication',async t=>{
  const f=await fixture(t),capture=appearanceFixture(f);f.insert();
  f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,1,'2999-01-01')");
  const original=await f.regenerateAsset(1,{prompt:'original blue',appearanceGuard:capture()});
  const pause=f.pauseAt('generate'),pending=f.regenerateAsset(1,{prompt:'blue',styleTags:'changed style',appearanceGuard:capture()});
  const rejected=assert.rejects(pending,stale);await pause.entered.promise;
  f.db.exec("UPDATE global_outfits SET expires_at='2000-01-01'");pause.release.resolve();await rejected;
  const after=f.getAssetById(1);
  assert.equal(after.image_path,original.image_path);assert.equal(after.status,'ready');
  assert.equal(after.source_prompt,original.source_prompt);
  const {_assetOperation:oldToken,...oldMeta}=original.meta;
  const {_assetOperation:newToken,...newMeta}=after.meta;
  assert.notEqual(newToken,oldToken);assert.deepEqual(newMeta,oldMeta);
  assert.equal(townAssetAppearanceStatus(after,capture()),'needs_update');
});

test('appearance stale rollback preserves generation config saved during the await, including same-value saves and resets', async t => {
  for (const config of [
    {artist:'saved artist',loras:[{name:'saved',strength:0.7}],promptPrefix:'saved prefix'},
    {artist:'request artist',loras:[],promptPrefix:'request prefix'},
    {artist:null,loras:null,promptPrefix:null},
    {artist:'only artist saved'},
  ]) await t.test(JSON.stringify(config), async t => {
    const f=await fixture(t),capture=appearanceFixture(f);f.insert();
    const original=await f.regenerateAsset(1,{prompt:'original',artist:'original artist',promptPrefix:'original prefix',appearanceGuard:capture()});
    const pause=f.pauseAt('generate');
    const pending=f.regenerateAsset(1,{prompt:'refresh',artist:'request artist',promptPrefix:'request prefix',appearanceGuard:capture()});
    const rejected=assert.rejects(pending,stale);await pause.entered.promise;
    const saved=f.updateAssetGenerationConfig(1,config);
    f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,1,'2999-01-01')");
    pause.release.resolve();await rejected;
    const after=f.getAssetById(1);
    for(const key of ['artist','loras','promptPrefix']) {
      const expected=Object.hasOwn(config,key)?saved.meta:original.meta;
      assert.deepEqual(after.meta[key],expected[key],key);
      assert.equal(Object.hasOwn(after.meta,key),Object.hasOwn(expected,key),`${key} reset`);
    }
    assert.equal(after.status,'ready');assert.equal(after.image_path,original.image_path);
    assert.equal(after.source_prompt,original.source_prompt);
    assert.deepEqual(after.meta.appearanceSource,original.meta.appearanceSource);
    assert.equal(townAssetAppearanceStatus(after,capture()),'needs_update');
    assert.equal(f.generates(),2);
  });
});

test('new image-less appearance job becomes failed on staleness instead of remaining pending',async t=>{
  const f=await fixture(t),capture=appearanceFixture(f),pause=f.pauseAt('generate');
  const pending=f.createAsset(job({appearanceGuard:capture()})),rejected=assert.rejects(pending,stale);
  await pause.entered.promise;
  f.updateAssetGenerationConfig(1,{artist:'saved while pending'});
  f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,1,'2999-01-01')");
  pause.release.resolve();await rejected;
  const asset=f.getAssetById(1);assert.equal(asset.status,'failed');assert.equal(asset.image_path,'');assert.equal(asset.meta.appearanceSource,undefined);
  assert.equal(asset.meta.artist,'saved while pending');
  assert.deepEqual(fs.readdirSync(f.directory),[]);
});

test('successful pixel commits preserve concurrent config saves and their field versions', async t => {
  for (const savedConfig of [
    {artist:'saved',loras:[{name:'saved',strength:0.5}],promptPrefix:'saved'},
    {artist:'request',loras:[],promptPrefix:'request'},
    {artist:null,loras:null,promptPrefix:null},
    {artist:'partial'},
  ]) await t.test(JSON.stringify(savedConfig), async t => {
    const f=await fixture(t),capture=appearanceFixture(f);f.insert();
    const original=await f.regenerateAsset(1,{prompt:'original',appearanceGuard:capture()});
    const pause=f.pauseAt('generate'), source=capture();
    const pending=f.regenerateAsset(1,{prompt:'new pixels',artist:'request',loras:[],promptPrefix:'request',appearanceGuard:source});
    await pause.entered.promise;
    const saved=f.updateAssetGenerationConfig(1,savedConfig);
    pause.release.resolve();const after=await pending;
    for(const field of ['artist','loras','promptPrefix','_generationConfigEdits']) {
      assert.deepEqual(after.meta[field],saved.meta[field],field);
      assert.equal(Object.hasOwn(after.meta,field),Object.hasOwn(saved.meta,field));
    }
    assert.equal(after.status,'ready');assert.notEqual(after.image_path,original.image_path);
    assert.match(after.source_prompt,/new pixels/);assert.deepEqual(after.meta.appearanceSource,source.source);
    assert.equal(townAssetAppearanceStatus(after,capture()),'current');assert.equal(f.generates(),2);
  });
});

test('crop and hires commits preserve config saved during their awaits', async t => {
  for(const operation of ['crop','hires']) await t.test(operation,async t=>{
    const f=await fixture(t),capture=appearanceFixture(f);f.insert();
    const original=await f.regenerateAsset(1,{prompt:'original',appearanceGuard:capture()});
    const pause=f.pauseAt(operation);
    const pending=operation==='crop'?f.cropAssetImage(1,{x:0,y:0,w:8,h:8}):f.refineAssetWithHires(1);
    await pause.entered.promise;
    const saved=f.updateAssetGenerationConfig(1,{artist:'saved',loras:null,promptPrefix:''});
    pause.release.resolve();const after=await pending;
    for(const field of ['artist','loras','promptPrefix','_generationConfigEdits']) assert.deepEqual(after.meta[field],saved.meta[field]);
    assert.notEqual(after.image_path,original.image_path);
    assert.deepEqual(after.meta.appearanceSource,original.meta.appearanceSource);
  });
});

test('appearance stale cleanup never restores over a newer token or epoch', async t => {
  for (const change of ['token', 'epoch']) await t.test(change, async t => {
    const f=await fixture(t),capture=appearanceFixture(f);f.insert();
    await f.regenerateAsset(1,{prompt:'trusted original',appearanceGuard:capture()});
    const pause=f.pauseAt('generate');
    const pending=f.regenerateAsset(1,{prompt:'late trusted',appearanceGuard:capture()});
    const rejected=assert.rejects(pending,stale);await pause.entered.promise;
    if (change==='epoch') f.reset();
    else await f.saveEditedAssetImage(1,`data:image/png;base64,${f.replacement.toString('base64')}`);
    f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,1,'2999-01-01')");
    const before=f.getAssetById(1);f.events.length=0;
    pause.release.resolve();await rejected;
    assert.deepEqual(f.getAssetById(1),before);assert.deepEqual(f.events,[]);
  });
});

test('crop and hires inherit provenance, arbitrary prompt redraw/upload clears it, client meta cannot forge it',async t=>{
  const f=await fixture(t),capture=appearanceFixture(f);f.insert();
  const original=await f.regenerateAsset(1,{prompt:'trusted',appearanceGuard:capture()});
  f.db.exec("INSERT INTO global_outfits VALUES(1,'发型','蓝发',1,1,'2999-01-01')");
  const cropped=await f.cropAssetImage(1,{x:0,y:0,w:8,h:8});assert.deepEqual(cropped.meta.appearanceSource,original.meta.appearanceSource);
  const hires=await f.refineAssetWithHires(1);assert.deepEqual(hires.meta.appearanceSource,original.meta.appearanceSource);
  assert.equal(townAssetAppearanceStatus(hires,capture()),'needs_update');
  const arbitrary=await f.regenerateAsset(1,{prompt:'user free text'});assert.equal(arbitrary.meta.appearanceSource,undefined);
  await f.regenerateAsset(1,{prompt:'trusted again',appearanceGuard:capture()});
  const edited=await f.saveEditedAssetImage(1,`data:image/png;base64,${f.png.toString('base64')}`);assert.equal(edited.meta.appearanceSource,undefined);
  const forged=await f.createAsset(job({key:'forged',meta:{appearanceSource:capture().source}}));assert.equal(forged.meta.appearanceSource,undefined);
});

test('generation fences every async stage before file/DB/broadcast publication', { timeout: 10000 }, async t => {
  for (const stage of ['prompt', 'generate', 'flatten', 'post', 'metadata', 'anchor']) {
    await t.test(stage, async t => {
      const f = await fixture(t);
      const pause = f.pauseAt(stage);
      const pending = f.createAsset(job({ kind: stage === 'prompt' ? 'building' : 'ground' }));
      const rejected = assert.rejects(pending, stale);
      await pause.entered.promise;
      f.reset();
      const before = f.getAssetById(1);
      pause.release.resolve();
      await rejected;
      assert.deepEqual(f.getAssetById(1), before);
      assert.deepEqual(fs.readdirSync(f.directory), ['new-world.png']);
      assert.deepEqual(fs.readFileSync(path.join(f.directory, 'new-world.png')), f.replacement);
      assert.equal(f.events.length, 0);
    });
  }
});

test('new epoch queue runs without waiting for old in-flight job; old queued id cannot target replacement', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const pause = f.pauseAt('generate');
  const first = assert.rejects(f.createAsset(job()), stale);
  await pause.entered.promise;
  const queued = assert.rejects(f.createAsset(job({ key: 'queued' })), stale);
  f.db.exec('UPDATE town_world_state SET epoch = 2; DELETE FROM town_assets; DELETE FROM sqlite_sequence WHERE name = \'town_assets\'');
  const fresh = await f.createAsset(job({ key: 'new-world' }));
  assert.equal(fresh.id, 1);
  assert.equal(fresh.status, 'ready');
  const before = f.getAssetById(1);
  const files = fs.readdirSync(f.directory);
  f.events.length = 0;
  pause.release.resolve();
  await Promise.all([first, queued]);
  assert.deepEqual(f.getAssetById(1), before);
  assert.deepEqual(fs.readdirSync(f.directory), files);
  assert.equal(f.generates(), 2);
  assert.equal(f.events.length, 0);
});

test('delete/recreate same id in same epoch and stale generation failures never mutate replacement', async t => {
  const f = await fixture(t);
  const pause = f.pauseAt('generate', new Error('late backend failure'));
  const rejected = assert.rejects(f.createAsset(job()), stale);
  await pause.entered.promise;
  f.deleteAsset(1);
  f.reset({ bumpEpoch: false });
  const before = f.getAssetById(1);
  pause.release.resolve();
  await rejected;
  assert.deepEqual(f.getAssetById(1), before);
  assert.equal(f.events.length, 0);
});

test('regeneration invalidates earlier queued/in-flight operation and preserves latest overrides', async t => {
  const f = await fixture(t);
  f.insert();
  const pause = f.pauseAt('generate');
  const rejected = assert.rejects(f.regenerateAsset(1, { prompt: 'old prompt' }), stale);
  await pause.entered.promise;
  const newest = f.regenerateAsset(1, { prompt: 'new prompt' });
  pause.release.resolve();
  await rejected;
  const ready = await newest;
  assert.equal(ready.status, 'ready');
  assert.ok(ready.source_prompt.includes('new prompt'));
  assert.equal(ready.meta.promptOverride, 'new prompt');
  assert.equal(fs.existsSync(path.join(f.directory, 'original.png')), false);
});

test('old batch stops after epoch change without progress callback or inserting remaining jobs', async t => {
  const f = await fixture(t);
  const pause = f.pauseAt('generate');
  const progress = [];
  const rejected = assert.rejects(f.generateAssetsBatch([job(), job({ key: 'must-not-run' })], p => progress.push(p)), stale);
  await pause.entered.promise;
  f.reset();
  pause.release.resolve();
  await rejected;
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_assets').get().n, 1);
  assert.equal(f.generates(), 1);
  assert.deepEqual(progress, []);
});

test('normal edit/crop/hires retain metadata and publish usable PNGs, invalid crop preserves original', async t => {
  const f = await fixture(t);
  f.insert();
  const edited = await f.saveEditedAssetImage(1, `data:image/png;base64,${f.png.toString('base64')}`);
  assert.equal(edited.status, 'ready');
  assert.ok(edited.meta.editedAt);
  const editedPath = path.join(f.directory, path.basename(edited.image_path));
  await assert.rejects(f.cropAssetImage(1, { x: 30, y: 30, w: 8, h: 8 }), /超出/);
  assert.deepEqual(fs.readFileSync(editedPath), f.png);
  const cropped = await f.cropAssetImage(1, { x: 0, y: 0, w: 16, h: 16 });
  assert.deepEqual(cropped.meta.pixelSize, { w: 16, h: 16 });
  const cropMeta = await sharp(path.join(f.directory, path.basename(cropped.image_path))).metadata();
  assert.equal(cropMeta.width, 16);
  assert.equal(cropMeta.height, 16);
  const refined = await f.refineAssetWithHires(1);
  assert.ok(refined.meta.editedAt && refined.meta.croppedAt && refined.meta.hiresAt);
  assert.equal(refined.source_prompt, 'original prompt');
  assert.deepEqual(fs.readFileSync(path.join(f.directory, path.basename(refined.image_path))), f.replacement);
  assert.equal(fs.readdirSync(f.directory).length, 1);
});

test('late edit/crop/hires cannot overwrite a new world file even when id and filename are reused', { timeout: 10000 }, async t => {
  for (const stage of ['edit-metadata', 'crop-metadata', 'crop', 'hires', 'hires-metadata']) {
    await t.test(stage, async t => {
      const f = await fixture(t);
      f.insert();
      const pause = f.pauseAt(stage.endsWith('metadata') ? 'metadata' : stage);
      const operation = stage.startsWith('edit')
        ? f.saveEditedAssetImage(1, `data:image/png;base64,${f.png.toString('base64')}`)
        : stage.startsWith('crop') ? f.cropAssetImage(1, { x: 0, y: 0, w: 16, h: 16 }) : f.refineAssetWithHires(1);
      const rejected = assert.rejects(operation, stale);
      await pause.entered.promise;
      f.reset({ imagePath: '/town-assets/original.png' });
      const before = f.getAssetById(1);
      pause.release.resolve();
      await rejected;
      assert.deepEqual(f.getAssetById(1), before);
      assert.deepEqual(fs.readFileSync(path.join(f.directory, 'original.png')), f.replacement);
      assert.deepEqual(fs.readdirSync(f.directory), ['original.png']);
      assert.equal(f.events.length, 0);
    });
  }
});

test('outer expectedWorld fence rejects late create/regenerate before any database mutation', async t => {
  const f = await fixture(t);
  f.insert();
  const expectedWorld = f.captureTownAssetWorld();
  f.db.exec('UPDATE town_world_state SET epoch = 2');
  const before = f.getAssetById(1);
  assert.throws(() => f.createAsset(job({ expectedWorld })), stale);
  assert.throws(() => f.regenerateAsset(1, { expectedWorld, prompt: 'must not save' }), stale);
  assert.deepEqual(f.getAssetById(1), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_assets').get().n, 1);
  assert.equal(f.generates(), 0);
});

test('manual edit supersedes in-flight regeneration without letting its reply replace edited file', async t => {
  const f = await fixture(t);
  f.insert();
  const pause = f.pauseAt('generate');
  const rejected = assert.rejects(f.regenerateAsset(1), stale);
  await pause.entered.promise;
  const edited = await f.saveEditedAssetImage(1, `data:image/png;base64,${f.replacement.toString('base64')}`);
  f.events.length = 0;
  pause.release.resolve();
  await rejected;
  assert.deepEqual(f.getAssetById(1), edited);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, path.basename(edited.image_path))), f.replacement);
  assert.equal(f.events.length, 0);
});

test('publication SQL failure removes only its unpublished file and retains original image', async t => {
  const f = await fixture(t);
  const original = f.insert();
  f.db.exec(`CREATE TRIGGER reject_publication BEFORE UPDATE OF image_path ON town_assets
    BEGIN SELECT RAISE(ABORT, 'fixture publication fault'); END;`);
  await assert.rejects(f.regenerateAsset(1), /fixture publication fault/);
  assert.equal(f.getAssetById(1).image_path, original.image_path);
  assert.deepEqual(fs.readdirSync(f.directory), ['original.png']);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'original.png')), f.png);
});
