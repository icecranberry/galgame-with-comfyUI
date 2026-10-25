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
    setInterval,
    clearInterval,
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

for (const [mode, configuredArtist] of [['chat', '@chat'], ['moments', '@moments'], ['event', '@event']]) {
  for (const artist of ['', '@ebora', undefined]) {
    test(`图片实验室 ${mode}: 画师串 ${JSON.stringify(artist)} 区分留空与未传`, async () => {
      let options;
      const handler = loadHandler('/test-style', {
        config: { comfyui: { artist: '@chat', momentsArtist: '@moments', eventArtist: '@event' } },
        generateImageRaw: async (_, opts) => {
          options = opts;
          return { success: true, images: [image] };
        },
      });
      await handler({ body: { mode, artist, prompt: 'test scene', alreadyPrepared: true } }, {
        json(value) { assert.equal(value.success, true); },
        status(code) { assert.fail(`Unexpected HTTP ${code}`); },
      });
      assert.equal(options.artist, artist === undefined ? configuredArtist : artist);
    });
  }
}

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

for (const success of [true, false]) {
  test(`流式实验室先发送初始和最终提示词，再返回图片${success ? '成功' : '失败'}`, async () => {
    const frames = [];
    let complete, close;
    const res = {
      writeHead(status, headers) { assert.equal(headers['Content-Type'], 'text/event-stream'); },
      flushHeaders() {},
      on(event, fn) { if (event === 'close') close = fn; },
      write(frame) { frames.push(frame); },
      end() { this.writableEnded = true; close(); },
    };
    const handler = loadHandler('/test-style', {
      generateScenePrompt: async () => ({ prompt: 'initial prompt', loras: [] }),
      generateImageRaw: async (prompt, opts) => {
        assert.equal(prompt, 'initial prompt');
        assert.match(frames[0], /initial prompt/);
        opts.onPromptPrepared('final prompt');
        return new Promise(resolve => { complete = resolve; });
      },
    });
    try {
      const pending = handler({ body: { sceneDesc: 'cafe', stream: true } }, res);
      // LLM promise 与生成函数之间的微任务均执行完，图片仍待返回。
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(frames.length, 2);
      assert.match(frames[1], /final prompt/);
      assert.match(frames[1], /generating/);
      assert.equal(res.writableEnded, undefined);
      complete({ success, images: success ? [image] : [], error: 'image failed' });
      await pending;
      assert.equal(frames.length, 3);
      assert.match(frames[2], /event: result/);
      assert.match(frames[2], /final prompt/);
      assert.equal(res.writableEnded, true);
    } finally { close?.(); }
  });
}
