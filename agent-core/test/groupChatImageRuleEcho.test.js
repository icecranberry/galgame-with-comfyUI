import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProtocolBlock, parseScriptLine } from '../src/services/groupChatEngine.js';
import {
  isImageRuleEcho,
  isImageRuleEchoStart,
  isPlaceholderImagePrompt,
  stripBracePromptBlocks,
  stripImagePromptLines,
} from '../src/utils/groupImagePrompt.js';
import { IMAGE_PROMPT_RULE } from '../src/builtinRules.js';

const members = new Map([['宵宫', { id: 1, display_name: '宵宫' }]]);

// 生图规范（image_prompt 全局规则）的开头句：模型偶尔把它当成 {} 里要填的内容照抄
const RULE_HEAD = 'Describe the image as a flowing, detailed scene in natural English — one continuous paragraph.';

test('照抄生图规范原文（花括号成对）既不进气泡也不建生图任务', () => {
  assert.equal(parseScriptLine(`宵宫: {${RULE_HEAD}}`, members), null);
});

test('照抄生图规范原文（半截、花括号未闭合）整行丢弃', () => {
  assert.equal(parseScriptLine(`宵宫: {${RULE_HEAD}\n\nFollow this progression:`, members), null);
});

test('台词后面粘了规范原文：保留台词，不建生图任务', () => {
  const parsed = parseScriptLine(`宵宫: 给你们看 {${RULE_HEAD}}`, members);
  assert.equal(parsed.speaker.display_name, '宵宫');
  assert.equal(parsed.text, '给你们看');
  assert.equal(parsed.imagePrompt, undefined);
});

test('正常发图行不受影响', () => {
  const parsed = parseScriptLine('宵宫: {a girl soaking in a pink bath, steam rising, warm lamp light}', members);
  assert.equal(parsed.speaker.display_name, '宵宫');
  assert.equal(parsed.text, null);
  assert.equal(parsed.imagePrompt, 'a girl soaking in a pink bath, steam rising, warm lamp light');
});

test('规范原文行不进 transcript，旧图片行仍照常剔除', () => {
  const raw = [
    '[宵宫]: 给你们看',
    '[宵宫]: {a girl soaking in a pink bath}',
    '[宵宫]: 好看吗',
  ].join('\n');
  assert.equal(stripImagePromptLines(raw), '[宵宫]: 给你们看\n[宵宫]: 好看吗');
});

test('单行贴规范原文（花括号未闭合）不进 transcript', () => {
  const raw = `[宵宫]: 给你们看\n[宵宫]: {${RULE_HEAD}`;
  assert.equal(stripImagePromptLines(raw), '[宵宫]: 给你们看');
});

test('多行画面描述整块剔除，不与上下文粘成脏行', () => {
  const raw = [
    '[宵宫]: 看这个',
    '[宵宫]: {',
    'a girl soaking in a pink bath, steam rising,',
    'warm lamp light}',
    '[爱莉希雅]: 好漂亮♪',
  ].join('\n');
  assert.equal(stripImagePromptLines(raw), '[宵宫]: 看这个\n[爱莉希雅]: 好漂亮♪');
});

// 线上真实形态：模型把整篇规范从一个「{」开始逐行复读，末尾才补上「}」，
// 流式解析会把整块拼成一条 candidate 交给 parseScriptLine。
const MULTILINE_ECHO = [
  '[宵宫]: 给你们看',
  `[宵宫]: {${RULE_HEAD}`,
  '',
  'Follow this progression:',
  '',
  '1. Scene Setting — Open with the overall environment, framing, and mood.',
  "   e.g. 'a chaotic yet cozy indoor living room scene'.",
  '',
  'Hard Rules:',
  '- ALL text in English. No Chinese characters anywhere.',
  '- MAX 800 characters total.}',
  '[爱莉希雅]: 粉粉的欸，你这是要开水上烟花铺吗♪',
].join('\n');

test('多行规范原文块整体丢弃，同一块里的正常消息保留', () => {
  assert.equal(
    stripImagePromptLines(MULTILINE_ECHO),
    '[宵宫]: 给你们看\n[爱莉希雅]: 粉粉的欸，你这是要开水上烟花铺吗♪',
  );
});

test('流式拼接出的多行规范块不会变成气泡', () => {
  const candidate = MULTILINE_ECHO.split('\n').slice(1, -1).join('\n');
  assert.equal(parseScriptLine(candidate, members), null);
});

test('摘要/记忆链路同样不吃规范原文块', () => {
  const out = stripBracePromptBlocks(MULTILINE_ECHO);
  assert.equal(out, '[宵宫]: 给你们看\n[爱莉希雅]: 粉粉的欸，你这是要开水上烟花铺吗♪');
});

test('规范特征只在行首/块内命中，普通英文画面描述不误判', () => {
  assert.equal(isImageRuleEcho(RULE_HEAD), true);
  assert.equal(isImageRuleEchoStart(`{${RULE_HEAD}`), true);
  assert.equal(isImageRuleEchoStart('a girl soaking in a pink bath'), false);
  assert.equal(isImageRuleEcho('a girl soaking in a pink bath'), false);
  assert.equal(isImageRuleEcho(''), false);
  assert.equal(isImageRuleEcho(undefined), false);
});

test('发图格式行里的花括号放的是可直接用的英文示例，不是占位词', () => {
  const block = buildProtocolBlock();
  const demo = block.match(/^\s*角色名: \{([^{}]*)\}$/m);
  assert.ok(demo, '格式示范里应有一对花括号');
  assert.equal(isPlaceholderImagePrompt(demo[1]), false);
  assert.ok(demo[1].split(' ').length >= 6, '示例应是完整的英文画面描述');
  assert.equal(block.split(IMAGE_PROMPT_RULE.rule_content).length, 2);
  const lines = block.split('\n');
  const rulesBlockLine = lines.findIndex(line => line.trim() === '<image_prompt_rules>');
  const demoLine = lines.findIndex(line => /^\s*角色名: \{/.test(line));
  assert.ok(rulesBlockLine > demoLine, '规范原文块应排在格式示范之后');
});

test('模型把格式模板当答案输出的 {PROMPT} 不会建成生图任务', () => {
  assert.equal(parseScriptLine('宵宫: {PROMPT}', members), null);
  assert.equal(parseScriptLine('宵宫: {prompt}', members), null);
  assert.equal(parseScriptLine('宵宫: {画面描述}', members), null);
  assert.equal(parseScriptLine('宵宫: {待填写}', members), null);
});

test('占位词判定只吃占位与纯非英文写法', () => {
  assert.equal(isPlaceholderImagePrompt('PROMPT'), true);
  assert.equal(isPlaceholderImagePrompt('...'), true);
  assert.equal(isPlaceholderImagePrompt('画面描述'), true);
  assert.equal(isPlaceholderImagePrompt(''), true);
  assert.equal(isPlaceholderImagePrompt('a girl soaking in a pink bath'), false);
});

test('超长（复读整段文本）的画面描述不会建成生图任务', () => {
  const tooLong = 'a girl soaking in a pink bath, '.repeat(80);
  assert.equal(parseScriptLine(`宵宫: {${tooLong}}`, members), null);
});
