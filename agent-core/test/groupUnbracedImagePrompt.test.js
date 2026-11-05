import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGroupImagePrompt,
  extractUnbracedGroupImagePrompt,
  stripBracePromptBlocks,
  stripImagePromptLines,
} from '../src/utils/groupImagePrompt.js';

// 引擎依赖的初始化只能使用内存数据库，测试不连接图片服务。
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network disabled in parser regression tests'); };
const { parseScriptLine, formatGroupImageLine } = await import('../src/services/groupChatEngine.js');

const member = { id: 1, display_name: '宵宫' };
const members = new Map([['宵宫', member]]);
const scene = 'A young woman sits beside an open window in a quiet wooden room. '
  + 'Warm afternoon light falls across her face and softly illuminates her flowing hair. '
  + 'She holds a small ceramic cup with both hands, smiling gently toward the camera. '
  + 'Behind her, pale curtains drift in the breeze above a table covered with fresh flowers. '
  + 'The composition is a relaxed medium shot with natural perspective, soft shadows, '
  + 'delicate fabric textures, and a peaceful atmosphere throughout the scene.';

test('漏括号的长英文直接发图，无需前一句发图意图', () => {
  assert.ok(scene.length >= 150);
  for (const prefix of ['宵宫: ', '[宵宫]: ']) {
    assert.deepEqual(parseScriptLine(prefix + scene, members), {
      speaker: member, text: null, imagePrompt: scene,
    });
  }
  assert.deepEqual(parseScriptLine(scene, members), { continuation: null, imagePrompt: scene });
  assert.equal(extractGroupImagePrompt(scene), scene);
});

test('阈值按去掉首尾空白后的正文计算，149 保留、150 转图', () => {
  const below = 'a'.repeat(149);
  const at = 'a'.repeat(150);
  assert.equal(extractUnbracedGroupImagePrompt(` ${below} `), null);
  assert.deepEqual(parseScriptLine(`[宵宫]: ${below}`, members), { speaker: member, text: below });
  assert.equal(extractUnbracedGroupImagePrompt(` ${at} `), at);
  assert.equal(parseScriptLine(`[宵宫]: ${at}`, members).imagePrompt, at);
  assert.equal(stripImagePromptLines(`[宵宫]: ${below}`), `[宵宫]: ${below}`);
  assert.equal(stripImagePromptLines(`[宵宫]: ${at}`), '');
});

test('短英文、中文及混合正文仍然作为台词，数字和符号不触发生图', () => {
  for (const body of ['Hello, everyone!', '这是普通台词。'.repeat(80), `给你看看 ${scene}`, '1'.repeat(500)]) {
    assert.equal(extractUnbracedGroupImagePrompt(body), null);
    assert.deepEqual(parseScriptLine(`宵宫: ${body}`, members), { speaker: member, text: body });
  }
});

test('英文描述的引号、破折号和数字不影响兜底', () => {
  const body = `${scene} A sign reads “Welcome” — shot on a 50mm lens.`;
  assert.equal(extractUnbracedGroupImagePrompt(body), body);
});

test('上下文清理复用兜底，纠错写回的标准图片行同样可剔除', () => {
  const raw = `[宵宫]: 给你们看\n[宵宫]: ${scene}\n[宵宫]: 好看吗`;
  assert.equal(stripImagePromptLines(raw), '[宵宫]: 给你们看\n[宵宫]: 好看吗');
  assert.equal(stripImagePromptLines(scene), '');
  assert.equal(stripImagePromptLines(formatGroupImageLine('宵宫', scene)), '');
  assert.equal(stripImagePromptLines('[宵宫]: Hello!'), '[宵宫]: Hello!');
});

test('用户群聊上下文与通用私聊清理不套长英文规则', () => {
  assert.equal(stripImagePromptLines(scene, { allowUnbraced: false }), scene);
  assert.equal(stripBracePromptBlocks(scene), scene);
  assert.equal(stripImagePromptLines(`{${scene}}`, { allowUnbraced: false }), '');
});

test('已有花括号协议、规则复读拦截及非成员限制保持有效', () => {
  assert.deepEqual(parseScriptLine('宵宫: 看这个 {a girl by a window}', members), {
    speaker: member, text: '看这个', imagePrompt: 'a girl by a window',
  });
  const echo = `Describe the image as a flowing, detailed scene. ${scene}`;
  assert.equal(extractUnbracedGroupImagePrompt(echo), null);
  assert.equal(parseScriptLine(`宵宫: ${echo}`, members), null);
  assert.equal(parseScriptLine(`[用户]: ${scene}`, members), null);
});

test('第 6 项协议标签不做清洗，也不作为长英文描述强制转图', () => {
  const body = `<Elicitation>${scene}</Elicitation>`;
  assert.equal(extractUnbracedGroupImagePrompt(body), null);
  assert.deepEqual(parseScriptLine(`宵宫: ${body}`, members), { speaker: member, text: body });
});
