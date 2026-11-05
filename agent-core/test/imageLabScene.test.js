import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('image lab test forbids network'); };
const { filterGlobalLoras } = await import('../src/services/imageSkill.js');
const { studioDimensions } = await import('../src/services/studioChatImages.js');
const { buildImageCrossRefInfo } = await import('../src/services/characterPersona.js');
const { resolveAngelImageReference } = await import('../src/services/godSays/angelImageReference.js');

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
    studioDimensions,
    resolveAngelImageReference: (desc, refs) => resolveAngelImageReference(desc, refs, {
      prepare: () => ({ get: () => ({ display_name: '小羽', persona: '私人往事不能给生图\n## 你的外观\n你有白金短发、金眼、白羽和白袍。' }) }),
    }),
    RAG_TIMEOUT_FAST_MS: 100,
    ...dependencies,
    config: { comfyui: {
      width: 1024, height: 1024,
      momentsWidth: 1024, momentsHeight: 1024,
      eventWidth: 1024, eventHeight: 1024,
      ...dependencies.config?.comfyui,
    } },
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

const sceneCharacters = [
  { id: 1076, display_name: '流萤', base_prompt: '你是流萤，来自崩坏：星穹铁道。\n## 你的外观\n你有银白色长发。', loras: [{ path: 'firefly.safetensors', weight: 0.8 }] },
  { id: 1077, display_name: '三月七', base_prompt: '你是三月七，来自崩坏：星穹铁道。\n## 你的外观\n你有粉色短发。', loras: [] },
];

function identityDependencies(overrides = {}) {
  return {
    getDb: () => ({ prepare: () => ({ get: id => sceneCharacters.find(char => char.id === id) }) }),
    getSystemRulesWithWorld: () => 'static rules', getWorldSetting: () => null,
    IMAGE_PROMPT_RULE: { rule_content: 'image rules' },
    matchAll: desc => sceneCharacters.filter(char => desc.includes(char.display_name)), matchUser: () => false,
    buildImageCrossRefInfo: char => buildImageCrossRefInfo(char, { outfits: null }),
    parseLoras: char => char.loras,
    extractImagePromptResponse: text => text,
    ...overrides,
  };
}

for (const scenario of [
  { name: '匿名描述仍按已查询编号注入资料', sceneDesc: '一位少女坐在窗边看书', character_ids: [1076], expected: [1076] },
  { name: '旧调用继续按姓名匹配', sceneDesc: '流萤坐在窗边看书', expected: [1076] },
  { name: '显式名单不加入仅在描述中提及的其他角色', sceneDesc: '流萤读三月七写的信，只有流萤入镜', character_ids: [1076], expected: [1076] },
  { name: '多角色分别保留身份且不重复注入', sceneDesc: '流萤与三月七在窗边看书', character_ids: [1077, 1076], expected: [1077, 1076] },
]) {
  test(`图片实验室角色身份：${scenario.name}`, async () => {
    let generated = false;
    const handler = loadHandler('/test-style', identityDependencies({
      chatSync: async messages => {
        const refs = messages.filter(message => message.content.startsWith('【画面交叉参考】'));
        assert.equal(refs.length, 1);
        const expectedChars = scenario.expected.map(id => sceneCharacters.find(char => char.id === id));
        for (const char of sceneCharacters) {
          assert.equal(refs[0].content.includes(`[${char.display_name}]`), scenario.expected.includes(char.id));
        }
        for (const char of expectedChars) {
          assert.equal(refs[0].content.split(`[${char.display_name}]`).length - 1, 1);
          assert.ok(refs[0].content.includes(buildImageCrossRefInfo(char, { outfits: null })));
        }
        assert.equal(messages.filter(message => message.role === 'user').length, 1);
        assert.equal(messages.at(-1).role, 'user');
        assert.ok(messages.at(-1).content.includes(scenario.sceneDesc));
        return 'Firefly reads by the window.';
      },
      generateImageRaw: async (_, options) => {
        generated = true;
        assert.deepEqual(Array.from(options.loras || [], lora => lora.path), ['firefly.safetensors']);
        return { success: true, images: [image] };
      },
    }));
    await handler({ body: { sceneDesc: scenario.sceneDesc,
      ...(scenario.character_ids ? { character_ids: scenario.character_ids } : {}),
    } }, {
      json(value) { assert.equal(value.success, true); },
      status(code) { assert.fail(`Unexpected HTTP ${code}`); },
    });
    assert.equal(generated, true);
  });
}

for (const scenario of [
  { sceneDesc: '天使和流萤在窗边合照', character_ids: [1076] },
  { sceneDesc: '小羽和流萤在窗边合照' },
  { sceneDesc: '我和流萤在窗边合照', character_ids: [1076], special_characters: ['angel'] },
  { sceneDesc: '天使小羽和流萤在窗边合照', character_ids: [1076], special_characters: ['angel'] },
  { sceneDesc: '流萤读天使的来信，天使不入镜', special_characters: [] },
]) {
  test(`图片实验室天使同框：${scenario.sceneDesc}`, async () => {
    let calls = 0;
    const includeAngel = scenario.special_characters?.length !== 0;
    const handler = loadHandler('/test-style', identityDependencies({
      chatSync: async (messages, { lorebook }) => {
        calls++;
        const ref = messages.find(message => message.content.startsWith('【画面交叉参考】')).content;
        assert.match(ref, /\[流萤\][\s\S]*银白色长发/);
        assert.equal(ref.includes('白金短发、金眼、白羽和白袍'), includeAngel);
        assert.equal(ref.split('[天使（小羽）]').length - 1, includeAngel ? 1 : 0);
        assert.doesNotMatch(ref, /私人往事/);
        if (includeAngel) assert.match(ref, /小羽有白金短发/);
        for (const persona of lorebook.personaTexts) assert.ok(ref.includes(persona));
        assert.equal(lorebook.staticTexts.length, 2);
        assert.equal(lorebook.cacheBoundary.index, 1);
        assert.equal(lorebook.cacheBoundary.offset, messages[1].content.length);
        assert.deepEqual(Array.from(lorebook.history), [messages.at(-1)]);
        assert.equal(messages.filter(m => m.role === 'user').length, 1);
        return 'two distinct characters by the window';
      },
      generateImageRaw: async (_, options) => {
        assert.deepEqual(Array.from(options.loras, lora => lora.path), ['firefly.safetensors']);
        return { success: true, images: [image] };
      },
    }));
    await handler({ body: scenario }, {
      json(value) { assert.equal(value.success, true); },
      status(code) { assert.fail(`Unexpected HTTP ${code}`); },
    });
    assert.equal(calls, 1);
  });
}

test('图片实验室拒绝无效天使名单及缺失外观，在 SSE 和模型之前返回错误', async () => {
  const handler = loadHandler('/test-style', identityDependencies({
    resolveAngelImageReference: (desc, refs) => resolveAngelImageReference(desc, refs, { prepare: () => ({ get: () => undefined }) }),
    chatSync: () => assert.fail('must not call LLM'),
    generateImageRaw: () => assert.fail('must not generate'),
  }));
  for (const body of [
    ...[null, 'angel', [1], ['unknown'], ['angel', 'angel']].map(special_characters => ({ sceneDesc: '天使', special_characters })),
    { prompt: 'prepared prompt', special_characters: ['angel'] },
    { sceneDesc: '天使和流萤合照' }, { sceneDesc: '我和流萤合照', special_characters: ['angel'] },
  ]) {
    let status;
    await handler({ body: { ...body, stream: true } }, {
      status(code) { status = code; return this; },
      json(value) { assert.ok(value.error); },
      writeHead() { assert.fail('must validate before SSE'); },
    });
    assert.equal(status, 400);
  }
});

test('实验室世界书实际边界位于动态参考前，有无世界观及天使均保持稳定前缀', async () => {
  const entries = [0, 1, 2, 3, 4, 5, 6].map(position => ({ position, constant: true, content: `STABLE_${position}` }));
  entries.push({ position: 4, depth: 0, constant: false, key: ['合照'], content: 'DYNAMIC_LORE' });
  const document = normalizeBook({ entries }).document;
  for (const withWorld of [false, true]) {
    const world = withWorld ? '<world_setting>云庭世界</world_setting>' : '';
    let previousPrefix;
    const handler = loadHandler('/test-style', identityDependencies({
      getSystemRulesWithWorld: () => `static rules${world}`,
      getWorldSetting: () => withWorld ? world : null,
      getWorldIntegrationRule: () => 'world integration',
      chatSync: async (messages, { lorebook }) => {
        const options = { ...lorebook, worldText: world, cachePlacement: true };
        assert.deepEqual(applyLorebookLayout(messages, { entries: [] }, options).messages, messages);
        const activation = evaluateBook(document, {}, { history: lorebook.history });
        const applied = applyLorebookLayout(messages, activation, options);
        const boundary = lorebook.cacheBoundary.index;
        assert.equal(boundary, withWorld ? 2 : 1);
        assert.deepEqual(Array.from(applied.messages, m => m.role), Array.from(messages, m => m.role));
        for (const position of [0, 1, 4, 5, 6]) assert.ok(applied.messages[boundary].content.includes(`STABLE_${position}`));
        assert.equal(applied.messages.at(-1).content.includes('DYNAMIC_LORE'), messages.at(-1).content.includes('合照'));
        assert.ok(applied.placements.every(p => p.actualAnchor && Number.isInteger(p.index) && Number.isInteger(p.offset)));
        const prefix = applied.messages.slice(0, boundary + 1);
        if (previousPrefix) assert.deepEqual(prefix, previousPrefix);
        previousPrefix = prefix;
        return 'scene prompt';
      },
      generateImageRaw: async () => ({ success: true, images: [image] }),
    }));
    for (const sceneDesc of ['天使和流萤合照', '流萤看书', '空无一人的房间']) {
      await handler({ body: { sceneDesc } }, {
        json(value) { assert.equal(value.success, true, value.error); },
        status() { return this; },
      });
    }
  }
});

test('图片实验室拒绝无效入镜编号，不调用模型或生图', async () => {
  const handler = loadHandler('/test-style', identityDependencies({
    chatSync: () => assert.fail('must not call LLM'),
    generateImageRaw: () => assert.fail('must not generate an image'),
  }));
  for (const character_ids of [null, '1076', [], [0], ['1076'], [1.5], [1076, 1076], [9999], [1076, 9999], Array.from({ length: 31 }, (_, i) => i + 1)]) {
    let status;
    await handler({ body: { sceneDesc: '窗边看书', character_ids, stream: true } }, {
      status(code) { status = code; return this; },
      json(value) { assert.ok(value.error); },
      writeHead() { assert.fail('validation must precede streaming headers'); },
    });
    assert.equal(status, 400);
  }
  await handler({ body: { prompt: 'prepared prompt', character_ids: [1076] } }, {
    status(code) { assert.equal(code, 400); return this; },
    json(value) { assert.match(value.error, /sceneDesc/); },
  });
});

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
      getSystemRulesWithWorld: () => '', getWorldSetting: () => null,
      IMAGE_PROMPT_RULE: { rule_content: 'image rules' }, matchAll: () => [], matchUser: () => false,
      chatSync: async () => 'initial prompt', extractImagePromptResponse: text => text,
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
