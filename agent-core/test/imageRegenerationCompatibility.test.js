import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runInNewContext } from 'node:vm';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { markLoraWorkflow, recomposeLoraWorkflow } from '../src/services/imageLoraProvenance.js';
import { attachPngWorkflow, readImageWorkflow, readPngWorkflow, preserveImageWorkflow, randomizeWorkflowSeeds, isApiWorkflow } from '../src/services/imageWorkflowMetadata.js';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('test forbids network'); };
const { guiToApi, apiToGui } = await import('../src/services/comfyClient.js');
const imageSkill = await import('../src/services/imageSkill.js');
const { config } = await import('../src/config.js');

const globals = [{ path: 'style.safetensors', weight: 0.4, triggerWord: 'style_tag' }];
const characters = [{ path: 'a.safetensors', weight: 0.8, triggerWord: 'char_a' }, { path: 'b.safetensors', weight: 0.9, triggerWord: 'char_b' }];
const templatePath = path.resolve('..', 'workflow', '制图工作流.json');
const source = fs.readFileSync(new URL('../src/services/imageSkill.js', import.meta.url), 'utf8');
function build(globalsOverride = globals, chars = characters) {
  const start = source.indexOf('function buildWorkflow(');
  const end = source.indexOf('\n/**', start);
  const buildWorkflow = runInNewContext(source.slice(start, end) + '\nbuildWorkflow', {
    fs, path, console, Math, Set, structuredClone, WORKFLOW_DIR: path.dirname(templatePath),
    resolveWorkflowPath: () => templatePath, normalizeLoraValue: v => v,
    config, apiToGui, pathToMode: () => 'turbo', lastUsedWorkflowMode: 'turbo',
    PROMPT_PLACEHOLDER: '请输入画面描述', NODE_TITLES: imageSkill.NODE_TITLES,
    filterGlobalLoras: imageSkill.filterGlobalLoras, findNegativeEncodeNode: imageSkill.findNegativeEncodeNode,
    injectLoraNodes: imageSkill.injectLoraNodes, markLoraWorkflow,
  });
  return buildWorkflow('two characters in a cafe', { globalLoraSnapshot: globalsOverride, loras: chars, scene: 'chat' }).wf;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('旧模板动态添加两组触发词，GUI/API 链完整并保存去重前来源', () => {
  const wf = build();
  const record = wf.extra.linsheGeneration;
  assert.deepEqual(plain(record.characters), characters);
  const api = guiToApi(wf);
  assert.equal(api[record.globalTriggerId].inputs.value, 'style_tag');
  assert.equal(api[record.characterTriggerId].inputs.value, 'char_a, char_b');
  const titles = wf.nodes.filter(n => record.loraIds.includes(String(n.id))).map(n => n.title);
  assert.equal(titles.filter(t => t.startsWith('角色 LoRA')).length, 2);
  for (const node of Object.values(api)) for (const value of Object.values(node.inputs)) {
    if (Array.isArray(value)) assert.ok(api[value[0]], `missing ${value[0]}`);
  }
  const trigger = wf.nodes.find(n => n.title === 'LoRA 触发词合并');
  assert.equal(api[trigger.id].class_type, 'StringConcatenate');
  assert.equal(api[trigger.id].inputs.string_a[0], record.globalTriggerId);
  assert.equal(api[trigger.id].inputs.string_b[0], record.characterTriggerId);
});

test('新图重生更换全局 LoRA/触发词，保留全部角色与其他参数，连续重生不累加', () => {
  const wf = build();
  const api = plain(guiToApi(wf));
  const nextGlobals = [{ path: 'new.safetensors', weight: 0.2, triggerWord: 'new_style' }];
  const next = recomposeLoraWorkflow(api, wf.extra.linsheGeneration, nextGlobals);
  const again = recomposeLoraWorkflow(next.prompt, next.generation, []);
  for (const state of [next, again]) {
    const loras = Object.values(state.prompt).filter(n => n.class_type === 'LoraLoaderModelOnly');
    assert.ok(!loras.some(n => n.inputs.lora_name === 'style.safetensors'));
    for (const char of characters) assert.ok(loras.some(n => n.inputs.lora_name === char.path && n.inputs.strength_model === char.weight));
    assert.equal(state.prompt[state.generation.characterTriggerId].inputs.value, 'char_a, char_b');
    assert.equal(loras.length, state === next ? 3 : 2);
    for (const [id, node] of Object.entries(api)) {
      if (wf.extra.linsheGeneration.loraIds.includes(id)) continue;
      if ([wf.extra.linsheGeneration.globalTriggerId, wf.extra.linsheGeneration.characterTriggerId].includes(id)) continue;
      const before = structuredClone(node), after = structuredClone(state.prompt[id]);
      // 只允许模型链入口随重新挂载发生变化。
      if (Array.isArray(before.inputs.model)) { delete before.inputs.model; delete after.inputs.model; }
      assert.deepEqual(after, before);
    }
  }
  assert.equal(next.prompt[next.generation.globalTriggerId].inputs.value, 'new_style');
  assert.equal(again.prompt[again.generation.globalTriggerId].inputs.value, '');
});

test('全局与角色同路径沿用全局优先，删除全局后恢复原角色权重和触发词', () => {
  const wf = build([{ ...globals[0], path: characters[0].path }]);
  const next = recomposeLoraWorkflow(guiToApi(wf), wf.extra.linsheGeneration, []);
  assert.deepEqual(plain(next.generation.characters), characters);
  assert.equal(next.prompt[next.generation.characterTriggerId].inputs.value, 'char_a, char_b');
  assert.ok(Object.values(next.prompt).some(n => n.inputs.lora_name === characters[0].path && n.inputs.strength_model === 0.8));
});

test('老图只更新种子，不新增来源标记，不改变原图 LoRA 和触发词', () => {
  const api = { '1': { class_type: 'KSampler', inputs: { seed: 42, steps: 20 } },
    '2': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'old.safetensors', strength_model: 0.7 } } };
  const old = recomposeLoraWorkflow(api, undefined, globals);
  assert.equal(old.generation, undefined);
  const result = randomizeWorkflowSeeds(old.prompt, () => 0.5);
  assert.notEqual(result['1'].inputs.seed, 42);
  result['1'].inputs.seed = 42;
  assert.deepEqual(result, api);
});

test('工作流元数据经过 PNG/AVIF 转码后仍可读取，旧图保持旧版身份', async () => {
  const png = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const wf = build();
  for (const generation of [wf.extra.linsheGeneration, undefined]) {
    const snapshot = { prompt: plain(guiToApi(wf)), ...(generation ? { generation: plain(generation) } : {}) };
    const input = attachPngWorkflow(png, snapshot);
    assert.deepEqual(await readImageWorkflow(input), snapshot);
    assert.equal((await sharp(input).metadata()).format, 'png');
    for (const format of ['png', 'avif']) {
      const pipeline = await preserveImageWorkflow(sharp(input), input);
      const converted = await pipeline.toFormat(format).toBuffer();
      assert.deepEqual(await readImageWorkflow(converted), snapshot);
    }
  }
  assert.equal(await readImageWorkflow(Buffer.from('broken')), null);
});

test('兼容压缩 PNG 文本块与缺少 API prompt 的 GUI 工作流', () => {
  const wf = build();
  const data = Buffer.concat([Buffer.from('workflow\0\0'), deflateSync(Buffer.from(JSON.stringify(wf)))]);
  const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write('zTXt', 4);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), header, data, Buffer.alloc(4)]);
  const snapshot = readPngWorkflow(png);
  assert.equal(snapshot.generation.version, 1);
  assert.deepEqual(plain(snapshot.workflow), plain(wf));
});

test('路由：有工作流不查数据库；缺少工作流回退数据库；均缺失才报错', async () => {
  const routeSource = fs.readFileSync(new URL('../src/routes/images.js', import.meta.url), 'utf8');
  const start = routeSource.indexOf('async function startImageEditTask(');
  const end = routeSource.indexOf('\nfunction sendTaskError', start);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-regen-'));
  const file = path.join(dir, 'source.png'); fs.writeFileSync(file, 'test');
  try {
    let snapshot = { prompt: { '1': { class_type: 'KSampler', inputs: { seed: 12 } } } };
    let dbCalls = 0, submitted;
    let dbPrompt = 'database prompt';
    const fn = runInNewContext(routeSource.slice(start, end) + '\nstartImageEditTask', {
      fs, path, Buffer, readImageWorkflow: async () => snapshot,
      parseImageTarget: () => ({ category: 'chat', filename: 'source.png' }), getImageDir: () => dir,
      lookupImageGenerationParams: () => { dbCalls++; return { promptText: dbPrompt }; },
      taskHttpError: (message, status) => Object.assign(new Error(message), { status }),
      startEditTask: spec => spec, categoryGenConfig: () => ({}), resolveArtist: () => '', CATEGORY_SCENE: { chat: 'chat' },
      dataUriExt: () => '.png',
      generateImageRaw: async (prompt, opts) => { submitted = { prompt, opts }; return { success: true, images: [{ base64: 'data:image/png;base64,dGVzdA==' }] }; },
    });
    let task = await fn('regenerate', '/images/chat/source.png');
    await task.run({ stageBase: path.join(dir, 'stage') });
    assert.equal(dbCalls, 0); assert.deepEqual(submitted.opts.sourceWorkflow, snapshot);
    snapshot = null;
    task = await fn('regenerate', '/images/chat/source.png');
    await task.run({ stageBase: path.join(dir, 'stage') });
    assert.equal(dbCalls, 1); assert.equal(submitted.prompt, dbPrompt);
    dbPrompt = null;
    await assert.rejects(fn('regenerate', '/images/chat/source.png'), e => e.status === 404);
  } finally {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('linshe-regen-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('真实提交分支按原场景过滤最新全局配置，模型执行失败不回退重建', async () => {
  const wf = build();
  const start = source.indexOf('async function submitWithRetry(');
  const end = source.indexOf('// ── 优先级队列', start);
  let submitted, generation;
  let fail = false;
  const fn = runInNewContext(source.slice(start, end) + '\nsubmitWithRetry', {
    MAX_SUBMIT_RETRIES: 0, config: { comfyui: { imageProvider: 'novelai', globalLora: [
      { path: 'new-chat.safetensors', scenes: ['chat'], triggerWord: 'new_chat' },
      { path: 'moments.safetensors', scenes: ['moments'] },
      { path: 'disabled.safetensors', enabled: false },
    ] } },
    recomposeLoraWorkflow, randomizeWorkflowSeeds, guiToApi, console,
    filterGlobalLoras: imageSkill.filterGlobalLoras,
    buildWorkflow: () => { throw new Error('must not rebuild source image'); },
    submitNovelaiImage: () => { throw new Error('must not change original provider'); },
    submitWorkflow: async (prompt, _, record) => {
      submitted = prompt; generation = record;
      if (fail) throw new Error('missing model');
      return { images: [{ base64: 'test' }], promptId: 'fixture' };
    },
  });
  const snapshot = { prompt: guiToApi(wf), generation: wf.extra.linsheGeneration };
  const result = await fn('', { sourceWorkflow: snapshot });
  assert.equal(result.success, true);
  assert.equal(generation.scene, 'chat');
  assert.deepEqual(plain(generation.globals).map(l => l.path), ['new-chat.safetensors']);
  assert.equal(submitted[generation.globalTriggerId].inputs.value, 'new_chat');
  fail = true;
  const failed = await fn('', { sourceWorkflow: snapshot });
  assert.equal(failed.success, false);
  assert.equal(failed.error, 'missing model');
});

test('ComfyUI 直接提交 API，返回图片保存同一份执行快照与新版来源', async () => {
  const client = fs.readFileSync(new URL('../src/services/comfyClient.js', import.meta.url), 'utf8');
  const start = client.indexOf('export async function submitWorkflow(');
  const end = client.indexOf('// ── WebSocket 实时进度', start);
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let body;
  const submit = runInNewContext(client.slice(start, end).replace('export async function', 'async function') + '\nsubmitWorkflow', {
    Buffer, console, isApiWorkflow, attachPngWorkflow,
    guiToApi: () => { throw new Error('API must not roundtrip through GUI'); },
    withImageGpu: fn => fn(), getBase: () => 'http://fixture',
    fetch: async (_, req) => { body = JSON.parse(req.body); return { ok: true, json: async () => ({ prompt_id: 'fixture' }) }; },
    wsProgressAndDownload: async () => ({ images: [{ base64: `data:image/png;base64,${png.toString('base64')}` }] }),
  });
  const wf = build();
  const api = plain(guiToApi(wf)), generation = plain(wf.extra.linsheGeneration);
  const result = await submit(api, undefined, generation);
  assert.deepEqual(body.prompt, api);
  assert.deepEqual(body.extra_data.extra_pnginfo.linshe_generation, generation);
  const snapshot = await readImageWorkflow(Buffer.from(result.images[0].base64.split(',')[1], 'base64'));
  assert.deepEqual(snapshot, { prompt: api, generation });
});
