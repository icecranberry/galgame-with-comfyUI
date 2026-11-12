import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { collectCharacterLoras } from '../src/services/groupImageLoraMatcher.js';
import { preserveImageWorkflow } from '../src/services/imageWorkflowMetadata.js';
import { ACTIVE_WORKFLOW, PRO_WORKFLOW } from '../src/services/workflowTemplates.js';

const source = fs.readFileSync(new URL('../src/routes/images.js', import.meta.url), 'utf8');
const paramsCode = source.slice(source.indexOf('function lookupImageGenerationParams('), source.indexOf('// ── 图片编辑任务'));
const taskCode = source.slice(source.indexOf('async function startImageEditTask('), source.indexOf('\nfunction sendTaskError'));
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE image_tasks (prompt_original TEXT, prompt_refined TEXT, conversation_id TEXT, style TEXT, resolution TEXT, workflow_template TEXT, output_paths TEXT, created_at TEXT);
    CREATE TABLE photo_studio_jobs (output_url TEXT, prompt TEXT, width INTEGER, height INTEGER, character_id INTEGER, character2_id INTEGER);
    CREATE TABLE characters (id INTEGER, loras TEXT);
    INSERT INTO image_tasks VALUES ('original', 'finished studio prompt', NULL, NULL, NULL, 'photo-studio-anima-base', '["/images/photo_studio/source.png"]', 'now');
    INSERT INTO photo_studio_jobs VALUES ('/images/photo_studio/source.png', 'studio prompt', 912, 1624, 1, 2);`);
  const loras = [{ path: 'first.safetensors', weight: 0.7, triggerWord: 'actor_one' }, { path: 'second.safetensors', weight: 0.9, triggerWord: 'actor_two' }];
  loras.forEach((lora, i) => db.prepare('INSERT INTO characters VALUES (?, ?)').run(i + 1, JSON.stringify([lora])));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-studio-edit-'));
  t.after(() => {
    db.close();
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('linshe-studio-edit-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'source.png'), png);
  let generated, refined, snapshot = null;
  const context = {
    fs, path, Buffer, sharp, preserveImageWorkflow, collectCharacterLoras, ACTIVE_WORKFLOW, PRO_WORKFLOW,
    getDb: () => db, config: { comfyui: { momentsArtist: 'studio artist' } },
    readImageWorkflow: async () => snapshot,
    parseImageTarget: () => ({ category: 'photo_studio', filename: 'source.png' }), getImageDir: () => dir,
    taskHttpError: (message, status) => Object.assign(new Error(message), { status }),
    startEditTask: spec => spec, dataUriExt: () => '.png',
    generateImageRaw: async (prompt, options) => { generated = { prompt, options }; return { success: true, images: [{ base64: `data:image/png;base64,${png.toString('base64')}` }] }; },
    refineImage: async options => { refined = options; fs.writeFileSync(options.outPath, png); },
  };
  const { startImageEditTask, lookupImageGenerationParams } = runInNewContext(`${paramsCode}\n${taskCode}\n({ startImageEditTask, lookupImageGenerationParams })`, context);
  return { db, dir, loras, startImageEditTask, lookupImageGenerationParams, setSnapshot: value => { snapshot = value }, generated: () => generated, refined: () => refined };
}

test('studio regeneration without metadata restores both actors, dimensions, artist and the recorded workflow', async t => {
  const f = await fixture(t);
  const task = await f.startImageEditTask('regenerate', '/images/photo_studio/source.png?_t=42');
  await task.run({ stageBase: path.join(f.dir, 'stage') });
  const { prompt, options } = f.generated();
  assert.equal(task.url, '/images/photo_studio/source.png');
  assert.equal(prompt, 'finished studio prompt');
  assert.equal(options.width, 912);
  assert.equal(options.height, 1624);
  assert.equal(options.artist, 'studio artist');
  assert.equal(options.scene, undefined);
  assert.equal(options.promptScene, 'standalone');
  assert.equal(options.customWorkflow, PRO_WORKFLOW);
  assert.deepEqual(plain(options.loras), f.loras);
  f.db.prepare("UPDATE image_tasks SET workflow_template = 'photo-studio-anima-custom.json'").run();
  assert.equal(f.lookupImageGenerationParams('source.png', 'photo_studio').taskWorkflowTemplate, 'custom.json');
});

test('studio regeneration with embedded metadata uses the original workflow instead of rebuilding it', async t => {
  const f = await fixture(t);
  const snapshot = { prompt: { '1': { class_type: 'KSampler', inputs: { seed: 42 } } } };
  f.setSnapshot(snapshot);
  const task = await f.startImageEditTask('regenerate', '/images/photo_studio/source.png');
  await task.run({ stageBase: path.join(f.dir, 'stage') });
  assert.deepEqual(plain(f.generated().options.sourceWorkflow), snapshot);
  assert.equal(f.generated().options.customWorkflow, undefined);
});

test('studio HiresFix restores pair LoRAs and base mode, and accepts a PNG URL compressed to AVIF', async t => {
  const f = await fixture(t);
  fs.renameSync(path.join(f.dir, 'source.png'), path.join(f.dir, 'source.avif'));
  const task = await f.startImageEditTask('upscale', '/images/photo_studio/source.png');
  const result = await task.run({ stageBase: path.join(f.dir, 'stage') });
  const options = f.refined();
  assert.equal(options.filePath, path.join(f.dir, 'source.avif'));
  assert.equal(options.promptText, 'finished studio prompt');
  assert.equal(options.sourceMode, 'base');
  assert.equal(options.artist, 'studio artist');
  assert.equal(options.scene, undefined);
  assert.equal(options.workflowScene, 'standalone');
  assert.deepEqual(plain(options.loras), f.loras);
  assert.equal(result.filename, 'stage.avif');
  assert.equal((await sharp(path.join(f.dir, result.filename)).metadata()).format, 'heif');
});
