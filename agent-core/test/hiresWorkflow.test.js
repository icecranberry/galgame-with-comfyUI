import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHiresWorkflow } from '../src/services/imageRefine.js';
import { guiToApi } from '../src/services/comfyClient.js';
import { config } from '../src/config.js';
import { HIRES_WORKFLOW, checkWorkflowHealth } from '../src/services/workflowTemplates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');

/** 隔离 LoRA 配置：测试内使用固定值，结束后恢复用户真实配置（node --test 串行执行，安全） */
function isolateLoraConfig(t, globalLoras = [], hiresLoras = []) {
  const savedGlobal = config.comfyui.globalLora;
  const savedHires = config.comfyui.hiresLora;
  const savedSteps = config.comfyui.hiresSteps;
  const savedCfg = config.comfyui.hiresCfg;
  const savedDenoise = config.comfyui.hiresDenoise;
  const savedMaxSize = config.comfyui.hiresMaxSize;
  const savedArtistMode = config.comfyui.hiresArtistMode;
  const savedArtist = config.comfyui.hiresArtist;
  config.comfyui.globalLora = globalLoras;
  config.comfyui.hiresLora = hiresLoras;
  config.comfyui.hiresSteps = 35;
  config.comfyui.hiresCfg = 5.0;
  config.comfyui.hiresDenoise = 0.35;
  config.comfyui.hiresMaxSize = 2000;
  config.comfyui.hiresArtistMode = 'empty';
  config.comfyui.hiresArtist = '';
  t.after(() => {
    config.comfyui.globalLora = savedGlobal;
    config.comfyui.hiresLora = savedHires;
    config.comfyui.hiresSteps = savedSteps;
    config.comfyui.hiresCfg = savedCfg;
    config.comfyui.hiresDenoise = savedDenoise;
    config.comfyui.hiresMaxSize = savedMaxSize;
    config.comfyui.hiresArtistMode = savedArtistMode;
    config.comfyui.hiresArtist = savedArtist;
  });
}

test('放大细化工作流文件存在且可被自动恢复', () => {
  const health = checkWorkflowHealth();
  assert.ok(health.hiresExists, 'workflow/放大细化工作流.json 应存在');
  const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, HIRES_WORKFLOW), 'utf8'));
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
  const types = wf.nodes.map(n => n.type);
  // 仅允许官方节点
  for (const t of types) {
    assert.ok(!t.includes('LatentUpscale') && !/upscale.*latent/i.test(t), `不应包含 latent 放大节点: ${t}`);
  }
});

test('构建细化工作流（turbo 源）→ API 结构完整且参数继承正确', (t) => {
  isolateLoraConfig(t);
  config.comfyui.hiresArtistMode = 'inherit';
  const { wf } = buildHiresWorkflow('1girl, solo, test scene, classroom', {
    uploadFilename: 'linshe-hires-test.png',
    artist: '@testArtist',
    sourceMode: 'turbo',
    loras: [],
  });

  const api = guiToApi(wf);
  const byType = {};
  for (const [id, node] of Object.entries(api)) {
    byType[node.class_type] = byType[node.class_type] || [];
    byType[node.class_type].push({ id, node });
  }

  // LoadImage 注入上传文件名
  const load = byType.LoadImage?.[0];
  assert.ok(load, '应有 LoadImage 节点');
  assert.equal(load.node.inputs.image, 'linshe-hires-test.png');

  // ImageScaleToMaxDimension 按长边像素放大（非固定倍数、非 latent）
  const scale = byType.ImageScaleToMaxDimension?.[0];
  assert.ok(scale, '应有 ImageScaleToMaxDimension 节点');
  assert.equal(scale.node.inputs.upscale_method, 'lanczos');
  assert.equal(scale.node.inputs.largest_size, 2000);

  // VAEEncode ← ImageScaleToMaxDimension（像素域放大后再编码，不经 LatentUpscale）
  const encode = byType.VAEEncode?.[0];
  assert.ok(encode, '应有 VAEEncode 节点');
  assert.deepEqual(encode.node.inputs.pixels, [String(scale.id), 0]);

  // KSampler ← VAEEncode（图生图）
  const sampler = byType.KSampler?.[0];
  assert.ok(sampler, '应有 KSampler 节点');
  assert.deepEqual(sampler.node.inputs.latent_image, [String(encode.id), 0]);

  // KSampler 采样参数以 HiresFix 设置为准（35步/cfg5.0/denoise0.35），不继承原图 turbo 的 12步/cfg1
  assert.equal(sampler.node.inputs.steps, 35);
  assert.equal(sampler.node.inputs.cfg, 5);
  assert.equal(sampler.node.inputs.sampler_name, 'er_sde');
  assert.equal(sampler.node.inputs.scheduler, 'beta');
  assert.equal(sampler.node.inputs.denoise, 0.35);

  // 模型加载器继承自 turbo 模板
  const unet = byType.UNETLoader?.[0];
  assert.ok(unet, '应有 UNETLoader');
  const turboWf = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, '制图工作流.json'), 'utf8'));
  const turboUnet = turboWf.nodes.find(n => n.type === 'UNETLoader');
  assert.equal(unet.node.inputs.unet_name, turboUnet.widgets_values[0]);
  const vae = byType.VAELoader?.[0];
  assert.ok(vae && vae.node.inputs.vae_name, 'VAELoader 应有模型名');

  // 负面提示词继承自 turbo 模板（text 为内联字符串的那个 CLIPTextEncode）
  const turboNeg = turboWf.nodes.find(n => n.id === 12);
  const clips = byType.CLIPTextEncode;
  assert.equal(clips.length, 2);
  const inlineTexts = clips.filter(c => typeof c.node.inputs.text === 'string').map(c => c.node.inputs.text);
  assert.ok(inlineTexts.includes(turboNeg.widgets_values[0]), '负面提示词应继承原图工作流');

  // 正面提示词: text 来自字符串拼接链（链接引用），注入值在各 PrimitiveString 节点上
  const linkedClips = clips.filter(c => Array.isArray(c.node.inputs.text));
  assert.equal(linkedClips.length, 1, '正面 CLIPTextEncode 的 text 应来自拼接链');
  const byTitle = {};
  for (const n of Object.values(api)) {
    if (n._meta?.title) byTitle[n._meta.title] = n;
  }
  assert.ok(byTitle['画面描述'].inputs.value.includes('1girl, solo, test scene, classroom'), '画面描述应注入');
  assert.equal(byTitle['画师串'].inputs.value, '@testArtist', '画师串应注入');
  assert.ok(byTitle['质量提示词'].inputs.value.includes('masterpiece'), '质量提示词节点应存在');

  // 输出端点存在
  assert.ok(byType.PreviewImage?.length > 0 || byType.SaveImage?.length > 0, '应有输出节点');
});

test('构建细化工作流（base 源 + lora）→ 采样参数切换且 lora 链正确链入', (t) => {
  isolateLoraConfig(t);
  const { wf } = buildHiresWorkflow('test prompt', {
    uploadFilename: 'x.png',
    sourceMode: 'base',
    loras: [{ path: 'test_lora.safetensors', weight: 0.7, triggerWord: 'triggerA' }],
  });

  const api = guiToApi(wf);
  const byType = {};
  for (const [id, node] of Object.entries(api)) {
    byType[node.class_type] = byType[node.class_type] || [];
    byType[node.class_type].push({ id, node });
  }

  // KSampler 采样参数不继承 base 源(31步/cfg5)，保持细化设置 35步/cfg5.0
  const sampler = byType.KSampler?.[0];
  assert.equal(sampler.node.inputs.steps, 35);
  assert.equal(sampler.node.inputs.cfg, 5);

  // base 模型继承
  const baseWf = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, '制图工作流-pro.json'), 'utf8'));
  const baseUnet = baseWf.nodes.find(n => n.type === 'UNETLoader');
  assert.equal(byType.UNETLoader[0].node.inputs.unet_name, baseUnet.widgets_values[0]);

  // lora 链: UNETLoader → LoraLoaderModelOnly → KSampler
  const lora = byType.LoraLoaderModelOnly?.[0];
  assert.ok(lora, '应注入 LoraLoaderModelOnly');
  assert.equal(lora.node.inputs.lora_name, 'test_lora.safetensors');
  assert.equal(lora.node.inputs.strength_model, 0.7);
  assert.deepEqual(lora.node.inputs.model, [String(byType.UNETLoader[0].id), 0], 'lora 上游应为 UNETLoader');
  assert.deepEqual(sampler.node.inputs.model, [String(lora.id), 0], 'KSampler model 应来自 lora');

  // lora 触发词注入
  const trigger = Object.values(api).find(n => n._meta?.title === 'lora触发词');
  assert.ok(trigger, 'lora触发词节点应存在');
  assert.equal(trigger.inputs.value, 'triggerA');
});

test('LoRA 链合并：全局(场景过滤) → 角色 → HiresFix细化 追加链尾，同 path 去重后者覆盖', (t) => {
  isolateLoraConfig(
    t,
    [
      { path: 'gA.safetensors', weight: 0.5, enabled: true, scenes: ['chat'] },
      { path: 'gB.safetensors', weight: 0.5, enabled: true, scenes: ['moments'] },  // 场景不匹配 → 排除
      { path: 'gOff.safetensors', weight: 0.5, enabled: false, scenes: [] },        // 禁用 → 排除
      { path: 'shared.safetensors', weight: 0.3, enabled: true, scenes: [] },
    ],
    [
      { path: 'hFix.safetensors', weight: 0.7, triggerWord: 'hires_detail', enabled: true },
      { path: 'shared.safetensors', weight: 0.9, enabled: true },                    // 覆盖全局权重并移到链尾
      { path: 'hOff.safetensors', weight: 1, enabled: false },                       // 禁用 → 排除
    ],
  );
  {
    const { wf } = buildHiresWorkflow('merge test', {
      uploadFilename: 'x.png',
      sourceMode: 'turbo',
      scene: 'chat',
      loras: [{ path: 'charL.safetensors', weight: 0.8 }],
    });
    const api = guiToApi(wf);
    const chain = Object.entries(api)
      .filter(([, n]) => n.class_type === 'LoraLoaderModelOnly')
      .map(([id, n]) => ({ id, name: n.inputs.lora_name, weight: n.inputs.strength_model }));

    // 顺序: gA(全局) → charL(角色) → hFix(细化) → shared(细化覆盖，移至链尾)
    assert.deepEqual(chain.map(c => c.name), ['gA.safetensors', 'charL.safetensors', 'hFix.safetensors', 'shared.safetensors']);
    assert.equal(chain.find(c => c.name === 'shared.safetensors').weight, 0.9, '同 path 应以细化配置权重覆盖');

    // 链路首尾: UNETLoader → 第一个 lora；最后一个 lora → KSampler
    const byId = Object.fromEntries(Object.entries(api).map(([id, n]) => [id, n]));
    const unetId = Object.keys(api).find(id => api[id].class_type === 'UNETLoader');
    const samplerId = Object.keys(api).find(id => api[id].class_type === 'KSampler');
    assert.deepEqual(byId[chain[0].id].inputs.model, [unetId, 0], '第一个 lora 上游应为 UNETLoader');
    assert.deepEqual(byId[samplerId].inputs.model, [chain[chain.length - 1].id, 0], 'KSampler 应接链尾 lora');

    // 细化 LoRA 触发词注入
    const trigger = Object.values(api).find(n => n._meta?.title === 'lora触发词');
    assert.ok(trigger.inputs.value.includes('hires_detail'), '细化 LoRA 触发词应注入');
  }
});

test('HiresFix 采样参数跟随系统设置（步数/CFG/重绘幅度）', (t) => {
  const saved = {
    hiresSteps: config.comfyui.hiresSteps,
    hiresCfg: config.comfyui.hiresCfg,
    hiresDenoise: config.comfyui.hiresDenoise,
  };
  config.comfyui.hiresSteps = 60;
  config.comfyui.hiresCfg = 5.5;
  config.comfyui.hiresDenoise = 0.5;
  t.after(() => {
    config.comfyui.hiresSteps = saved.hiresSteps;
    config.comfyui.hiresCfg = saved.hiresCfg;
    config.comfyui.hiresDenoise = saved.hiresDenoise;
  });

  const { wf } = buildHiresWorkflow('params test', {
    uploadFilename: 'x.png',
    sourceMode: 'turbo',
    loras: [],
  });
  const api = guiToApi(wf);
  const sampler = Object.values(api).find(n => n.class_type === 'KSampler');
  assert.equal(sampler.inputs.steps, 60);
  assert.equal(sampler.inputs.cfg, 5.5);
  assert.equal(sampler.inputs.denoise, 0.5);
});

test('HiresFix 最长边与画师串指定模式跟随系统设置', (t) => {
  const saved = {
    hiresMaxSize: config.comfyui.hiresMaxSize,
    hiresArtistMode: config.comfyui.hiresArtistMode,
    hiresArtist: config.comfyui.hiresArtist,
  };
  config.comfyui.hiresMaxSize = 2048;
  config.comfyui.hiresArtistMode = 'specified';
  config.comfyui.hiresArtist = '@customArtist';
  t.after(() => {
    config.comfyui.hiresMaxSize = saved.hiresMaxSize;
    config.comfyui.hiresArtistMode = saved.hiresArtistMode;
    config.comfyui.hiresArtist = saved.hiresArtist;
  });

  const { wf } = buildHiresWorkflow('artist test', {
    uploadFilename: 'x.png',
    sourceMode: 'turbo',
    loras: [],
    artist: '@original',
  });
  const api = guiToApi(wf);
  const scale = Object.values(api).find(n => n.class_type === 'ImageScaleToMaxDimension');
  assert.equal(scale.inputs.largest_size, 2048);
  const artistNode = Object.values(api).find(n => n._meta?.title === '画师串');
  assert.equal(artistNode.inputs.value, '@customArtist');
});

test('HiresFix 画师串留空模式清空画师串', (t) => {
  const saved = config.comfyui.hiresArtistMode;
  config.comfyui.hiresArtistMode = 'empty';
  t.after(() => { config.comfyui.hiresArtistMode = saved; });

  const { wf } = buildHiresWorkflow('empty artist', {
    uploadFilename: 'x.png',
    sourceMode: 'turbo',
    loras: [],
    artist: '@original',
  });
  const api = guiToApi(wf);
  const artistNode = Object.values(api).find(n => n._meta?.title === '画师串');
  assert.equal(artistNode.inputs.value, '');
});
