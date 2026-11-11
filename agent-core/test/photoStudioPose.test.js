import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { describeStudioPose, resolveCustomStudioPose, STUDIO_POSE_RULES } from '../src/services/photoStudioPose.js';

const posePrompt = 'character 1 sits on a bench, left hand on the knee, right hand holding a cup, smiling toward the viewer.';
const image = async () => `data:image/png;base64,${(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64')}`;

test('pose recognition sends only base rules, fixed task rules and one final user with the image', async () => {
  const data = await image();
  let saved;
  const result = await describeStudioPose({ image: data }, {
    systemRules: () => 'base rules only',
    chat: async (messages, options) => {
      assert.deepEqual(messages.slice(0, 2), [{ role: 'system', content: 'base rules only' }, { role: 'system', content: STUDIO_POSE_RULES }]);
      assert.equal(messages.length, 3);
      assert.equal(messages[2].role, 'user');
      assert.equal(messages[2].content[1].image_url.url, data);
      assert.equal(options.lorebook, false);
      assert.deepEqual(options.thinking, { type: 'disabled' });
      assert.equal(options.forceDisableThinking, true);
      assert.deepEqual(options.response_format, { type: 'json_object' });
      return JSON.stringify({ personCount: 1, posePrompt });
    },
    save: (...args) => { saved = args; return '/images/photo_studio/pose-ref-test.png'; },
  });
  assert.deepEqual(result, { personCount: 1, posePrompt, imageUrl: '/images/photo_studio/pose-ref-test.png' });
  assert.equal(saved[0], 'photo_studio');
  assert.match(saved[1], /^pose-ref-[a-f0-9]{64}\.png$/);
  assert.equal(saved[2], data);
});

test('invalid uploads never call the model and invalid model output never saves a reference', async () => {
  const deps = { chat: () => assert.fail('must not call model'), systemRules: () => '', save: () => assert.fail('must not save') };
  for (const value of [null, 'https://example.com/image.png', 'data:image/png;base64,YWJj']) {
    await assert.rejects(describeStudioPose({ image: value }, deps), { status: 400 });
  }
  const data = await image();
  for (const raw of ['', 'not json', JSON.stringify({ personCount: 3, posePrompt }), JSON.stringify({ personCount: 1, posePrompt: '中文' })]) {
    await assert.rejects(describeStudioPose({ image: data }, { ...deps, chat: async () => raw }), /未识别到有效/);
  }
});

test('supplementary requirements only enter the final user and keep the reference image and fixed prefix', async () => {
  const data = await image();
  const direction = '右手抬高，左手保持原位。';
  await describeStudioPose({ image: data, direction: ` ${direction} ` }, {
    systemRules: () => 'base rules only',
    chat: async (messages, options) => {
      assert.deepEqual(messages.slice(0, 2), [{ role: 'system', content: 'base rules only' }, { role: 'system', content: STUDIO_POSE_RULES }]);
      assert.equal(messages.length, 3);
      assert.equal(messages[2].content[0].text, `描述这张参考图的姿势，严格按约定的 JSON 格式输出。\n补充描述：${direction}\n请按照补充描述的需求调整最终输出。`);
      assert.equal(messages[2].content[1].image_url.url, data);
      assert.equal(options.forceDisableThinking, true);
      assert.equal(options.lorebook, false);
      return JSON.stringify({ personCount: 1, posePrompt });
    },
    save: () => '/images/photo_studio/pose-ref-test.png',
  });
  for (const invalid of [null, {}, 'x'.repeat(2001)]) {
    await assert.rejects(describeStudioPose({ image: data, direction: invalid }, { chat: () => assert.fail('invalid directions must not call the model') }), { status: 400 });
  }
});

test('AVIF references are converted for vision while the original reference is saved', async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).avif().toBuffer();
  const data = `data:image/avif;base64,${bytes.toString('base64')}`;
  await describeStudioPose({ image: data }, {
    systemRules: () => 'rules',
    chat: async messages => {
      const url = messages[2].content[1].image_url.url;
      assert.match(url, /^data:image\/png;base64,/);
      assert.equal((await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()).width, 8);
      return JSON.stringify({ personCount: 1, posePrompt });
    },
    save: (_category, filename, source) => {
      assert.match(filename, /\.avif$/);
      assert.equal(source, data);
      return `/images/photo_studio/${filename}`;
    },
  });
});

test('custom poses validate edited prompts and preserve numbered actor placeholders', () => {
  assert.equal(resolveCustomStudioPose({ personCount: 2, posePrompt: ' character 1 reaches toward character 2. ' }).system, '双人');
  assert.equal(resolveCustomStudioPose({ personCount: 1, posePrompt }).posePrompt, posePrompt);
  for (const value of [null, {}, { personCount: 1, posePrompt: '' }, { personCount: 1, posePrompt: 'x'.repeat(6001) }, { personCount: '2', posePrompt }]) {
    assert.throws(() => resolveCustomStudioPose(value), { status: 400 });
  }
});
