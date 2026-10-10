import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('image lab test forbids network'); };
const { filterGlobalLoras } = await import('../src/services/imageSkill.js');

const source = readFileSync(new URL('../src/routes/images.js', import.meta.url), 'utf8');
const image = { base64: 'data:image/png;base64,dGVzdA==', filename: 'test.png' };

// 执行实际路由处理器，隔离数据库、LLM 和 ComfyUI，检查交给生图服务的场景。
function loadHandler(route, dependencies) {
  const start = source.indexOf(`router.post('${route}',`);
  assert.ok(start >= 0);
  const end = source.indexOf('\n});', start);
  assert.ok(end > start);
  let handler;
  runInNewContext(source.slice(start, end + 4), {
    router: { post: (_, fn) => { handler = fn; } },
    console: { log() {}, error() {} },
    performance,
    Buffer,
    path,
    lastStyleTest: null,
    config: { comfyui: {} },
    RAG_TIMEOUT_FAST_MS: 100,
    ...dependencies,
  });
  return handler;
}

const loras = [
  { path: 'event.safetensors', scenes: ['events'], weight: 0.8 },
  { path: 'chat.safetensors', scenes: ['chat'] },
  { path: 'moments.safetensors', scenes: ['moments'] },
  { path: 'all.safetensors', scenes: [] },
  { path: 'disabled.safetensors', scenes: ['events'], enabled: false },
];

for (const [mode, scene] of [['event', 'events'], ['chat', 'chat'], ['moments', 'moments']]) {
  for (const route of ['/test-style', '/test-hires']) {
    test(`图片实验室 ${route}: ${mode} 使用 ${scene} 范围的全局 LoRA`, async () => {
      let options;
      let response;
      const handler = loadHandler(route, {
        generateImageRaw: async (_, opts) => {
          options = opts;
          return { success: true, images: [image] };
        },
        pickLatestTestImage: async () => ({
          type: 'test', mode, images: [image], prompt: 'test scene',
        }),
        refineImage: async opts => {
          options = opts;
          return { success: true, base64: image.base64 };
        },
      });
      await handler({ body: { mode, prompt: 'test scene', alreadyPrepared: true } }, {
        json(value) { response = value; },
        status(code) { assert.fail(`Unexpected HTTP ${code}`); },
      });
      assert.equal(response.success, true);
      assert.equal(options.scene, scene);
      assert.deepEqual(filterGlobalLoras(loras, options.scene).map(l => l.path), [
        `${mode}.safetensors`, 'all.safetensors',
      ]);
    });
  }
}
