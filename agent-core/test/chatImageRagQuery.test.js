import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { extractImagePromptResponse, requestNonEmptyImagePrompt } from '../src/services/imagePromptResponse.js';
import { SHARED_IMAGE_PROMPT_RULE, buildSharedImageTask } from '../src/services/privateChatImagePrompt.js';

// 执行真实路由函数，隔离数据库、LLM 与 ComfyUI，避免测试发起实际生图。
const source = readFileSync(new URL('../src/routes/chat.js', import.meta.url), 'utf8');
const imageFlowSource = source.slice(
  source.indexOf('async function triggerImageGeneration('),
  source.indexOf('const dialogueGuessCache ='),
);
const stripTagsSource = source.slice(source.indexOf('function stripTags('), source.indexOf('function stripBracketActions('));
const prompt = 'A bedroom selfie shot from a phone front camera.';
const expectedQuery = '小明: 发一张卧室自拍\n小夏: 好呀，我坐在床边拍给你。';

function harness() {
  const history = [
    { role: 'user', content: '之前在咖啡厅' },
    { role: 'assistant', content: '之前穿着外套' },
    { role: 'user', content: '<dynamic_context>天气晴朗，旧日程在公园</dynamic_context>\n发一张卧室自拍' },
    { role: 'assistant', content: '好呀，我坐在床边拍给你。' },
  ];
  const calls = [];
  const events = [];
  const db = {
    prepare(sql) {
      return {
        all: () => history.map(row => ({ ...row })).reverse(),
        get: () => {
          if (sql.includes('SELECT id, prompt FROM raw_messages')) return { id: 4, prompt: null };
          if (sql.includes('SELECT id FROM messages')) return { id: 4 };
          return undefined;
        },
        run: (...args) => {
          if (sql.includes('UPDATE raw_messages SET prompt')) history.at(-1).content += args[1];
          return { changes: 1, lastInsertRowid: 5 };
        },
      };
    },
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    getDb: () => db,
    config: { user: { nickname: '小明' } },
    getSystemRules: () => '', getSystemRulesWithWorld: () => '', getWorldSetting: () => '',
    getGlobalRule: () => null,
    buildCharacterPersona: () => '测试人设',
    matchAll: () => [],
    matchUser: () => false,
    getLightNoteWithWeather: () => '',
    getCurrentActivity: () => null,
    isTempWoken: () => false,
    getCharacterEmojiMap: () => ({}),
    extractImagePromptResponse,
    requestNonEmptyImagePrompt,
    SHARED_IMAGE_PROMPT_RULE, buildSharedImageTask,
    _parseLoras: char => JSON.parse(char.loras || '[]'),
    charArtistOverride: char => char.artist_override ?? null,
    chatWithLorebook: async () => prompt,
    RAG_TIMEOUT_FAST_MS: 200,
    generateImage: async (text, options) => {
      calls.push({ text, options });
      return { success: true, images: [{ filename: 'test.png', base64: '' }] };
    },
    saveBase64Image: () => '/images/chat/test.png',
    invalidateGalleryCache() {},
    imageJudgeCounters: new Map(),
    getLastWorkflowMode: () => 'test',
    send: (event, data) => events.push({ event, data }),
    character: { id: 1, display_name: '小夏' },
  };
  runInNewContext(stripTagsSource + imageFlowSource, context);
  return { context, calls, events, history };
}

for (const kind of ['dialogue', 'tool']) {
  test(`${kind} image source freezes its own task for image RAG`, async () => {
    const { context, calls, history } = harness();
    const frozen = context.buildImagePromptMessages('char_1', context.character, { kind, scene: '我拍厨房饼干给你', image_source: 'camera', include_self: false }, history.map(row => ({ ...row })));
    history.push({ role: 'user', content: '下一轮在公园' });
    assert.equal(frozen.lastTurnDialogue, expectedQuery);
    const user = frozen.msgs.at(-1).content;
    assert.equal(user.includes('工具画面需求·本次配图的唯一任务来源'), kind === 'tool');
    await context.triggerImageGeneration('char_1', prompt, 4, 5, context.send, [], frozen.ragQuery);
    assert.equal(calls[0].options.ragQuery, kind === 'tool' ? '我拍厨房饼干给你' : expectedQuery);
  });
}

test('四种分享来源共用稳定前缀，旧照与收藏不混入当前环境或上一幅插画', () => {
  const { context, history } = harness();
  const personaOptions = [];
  const scans = [];
  Object.assign(context, {
    getGlobalRule: () => ({ rule_content: '旧版对话插画格式' }),
    getLightNoteWithWeather: () => '当前暴雨',
    getCurrentActivity: () => ({ location: '当前咖啡厅', activity: '喝咖啡' }),
    buildCharacterPersona: (_character, opts) => { personaOptions.push(opts); return '真实角色人格正文'; },
    matchAll: text => { scans.push(text); return []; },
  });
  history[1].prompt = '上一幅插画：第三人称全景';
  let prefix;
  for (const image_source of ['selfie', 'camera', 'album', 'saved']) {
    const source = { kind: 'tool', image_source, include_self: image_source === 'selfie', scene: `我想分享${image_source}的图片` };
    const result = context.buildImagePromptMessages('char_1', context.character, source, history);
    const text = result.msgs.map(m => m.content).join('\n');
    const live = ['selfie', 'camera'].includes(image_source);
    assert.equal(text.includes('当前暴雨'), live);
    assert.equal(text.includes('当前咖啡厅'), live);
    assert.equal(personaOptions.at(-1).outfits === null, !live);
    assert.ok(!text.includes('上一幅插画：第三人称全景'));
    assert.ok(!text.includes('旧版对话插画格式'));
    assert.ok(!text.includes('需求以第三人称描述'));
    assert.ok(result.msgs.at(-1).content.includes(`image_source=${image_source}`));
    assert.equal(result.includeCharacter, source.include_self);
    assert.equal(result.ragQuery, source.scene);
    assert.equal(scans.at(-1), source.scene, '历史提及的人物不应被自动带进分享图片');
    assert.equal(result.msgs.filter(m => m.role === 'user').length, 1);
    assert.equal(result.msgs.at(-1).role, 'user');
    assert.equal(result.lorebook.personaTexts[0], '真实角色人格正文');
    assert.equal(result.lorebook.history, history);
    const boundary = result.lorebook.cacheBoundary;
    assert.equal(result.msgs[boundary.index].content.length, boundary.offset);
    const currentPrefix = JSON.stringify(result.msgs.slice(0, boundary.index + 1));
    if (prefix) assert.equal(currentPrefix, prefix);
    prefix = currentPrefix;
    history.push({ role: 'user', content: `后续聊天-${image_source}` });
  }
  const dialogue = context.buildImagePromptMessages('char_1', context.character, { kind: 'dialogue' }, history);
  const text = dialogue.msgs.map(m => m.content).join('\n');
  assert.ok(text.includes('旧版对话插画格式'));
  assert.ok(text.includes('当前暴雨'));
  assert.ok(text.includes('上一幅插画：第三人称全景'));
  assert.equal(dialogue.includeCharacter, true);
  assert.equal(dialogue.ragQuery, dialogue.lastTurnDialogue);
});

test('分享稳定边界适配有无世界观和空历史，不把当次需求认证为静态', () => {
  for (const world of ['', '测试世界观']) {
    const { context } = harness();
    Object.assign(context, {
      getWorldSetting: () => world,
      getSystemRulesWithWorld: () => `共用规则${world}`,
      getWorldIntegrationRule: () => '固定世界观强化',
    });
    const result = context.buildImagePromptMessages('char_1', context.character, {
      kind: 'tool', image_source: 'saved', include_self: false, scene: '我想分享猫咪收藏图',
    }, []);
    const { cacheBoundary, staticTexts } = result.lorebook;
    assert.equal(cacheBoundary.index, world ? 2 : 1);
    assert.equal(result.msgs[cacheBoundary.index].content, SHARED_IMAGE_PROMPT_RULE);
    assert.ok(staticTexts.every(text => !text.includes('我想分享猫咪收藏图')));
    assert.equal(result.msgs.at(-1).role, 'user');
  }
});

test('本人不入镜时跳过角色 LoRA 与人物工作流，保留画风；入镜时照常使用', async () => {
  for (const includeCharacter of [false, true]) {
    const { context, calls } = harness();
    const char = { loras: JSON.stringify([{ path: 'character.safetensors', weight: 1 }]), custom_workflow: 'portrait.json', artist_override: '既有画风' };
    await context.triggerImageGeneration('char_1', prompt, 4, 5, context.send, [], '我拍食物', char, [], { customWorkflow: 'chat-default.json' }, { includeCharacter });
    assert.equal(calls[0].options.customWorkflow, includeCharacter ? 'portrait.json' : 'chat-default.json');
    assert.equal(calls[0].options.loras?.[0]?.path, includeCharacter ? 'character.safetensors' : undefined);
    assert.equal(calls[0].options.artist, '既有画风');
  }
});

test('工具参数经过受理和冻结快照传至描述器与实际生成，强制配图仍走 dialogue', async () => {
  const accepted = [];
  const rendered = [];
  const { context } = harness();
  Object.assign(context, {
    db: { prepare: () => ({ all: () => [], get: () => undefined, run() {} }) },
    structuredClone,
    conversationId: 'char_1', userRawMsgId: 10,
    streamState: { fullContent: '给你看我收藏的猫咪' },
    config: { comfyui: { imageProvider: 'test' } },
    captureImageGenerationConfig: () => ({}), notifyImage() {},
    buildImagePromptMessages: (_conversation, _char, source) => ({
      msgs: [{ role: 'user', content: source.scene || '对话插画' }],
      imageSource: source, crossRefCharIdsForImage: [],
      includeCharacter: source.kind === 'tool' ? source.include_self : true,
      ragQuery: source.scene || '最后一轮对话',
    }),
    queuePrivateImage: (_db, options) => { accepted.push(options); return { ok: true }; },
    triggerImageGeneration: (...args) => { rendered.push(args); },
  });
  runInNewContext(source.slice(source.indexOf('    function acceptImage('), source.indexOf('    // 流式消费 + flush')), context);
  const request = { image_source: 'saved', include_self: false, scene: '我想分享收藏的猫咪插画' };
  assert.equal(context.acceptImage(request, { content: '猫咪像你' }).ok, true);
  assert.equal(accepted[0].snapshot.imageSource.kind, 'tool');
  assert.equal(accepted[0].snapshot.imageSource.image_source, 'saved');
  await accepted[0].execute({ taskId: 1, rawId: 2, messageId: 3 }, accepted[0].snapshot);
  assert.equal(rendered[0][6], request.scene);
  assert.equal(rendered[0][10].includeCharacter, false);
  context.acceptImage('', null, { rawId: 8, messageId: 9 });
  assert.equal(accepted[1].snapshot.imageSource.kind, 'dialogue');
  assert.equal(accepted[1].rawId, 8);
  assert.equal(accepted[1].messageId, 9);
});

test('梦话配图使用本轮用户消息和梦话正文作为 RAG query', async () => {
  const { context, calls } = harness();
  const output = [];
  Object.assign(context, {
    broadcast() {},
    ensureDreamOnDemand: async () => ({ id: 1, content: '较早的梦境正文' }),
    generateLiveDreamMurmur: async () => ({ talk: '唔，云朵变成棉花糖了……', imagePrompt: prompt }),
    decorateDreamImagePrompt: text => text,
    _parseLoras: () => [],
    charArtistOverride: () => null,
  });
  runInNewContext(source.slice(source.indexOf('async function handleDreamTalkReply('), source.indexOf('function _parseLoras(')), context);
  const res = { writeHead() {}, setTimeout() {}, write: text => output.push(text), end() {} };
  await context.handleDreamTalkReply(res, 1, 'char_1', 2, context.character, '你梦到什么啦？');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, prompt);
  assert.equal(calls[0].options.ragQuery, '小明: 你梦到什么啦？\n小夏: 唔，云朵变成棉花糖了……');
  assert.ok(output.some(text => text.startsWith('event: generate_done')));
  assert.ok(!output.some(text => text.startsWith('event: generate_error')));
});
