import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`prompt rewrite fixture forbids network: ${url}`); };

const { renderAssetRequestSnapshot, buildAssetRewriteMessages } = await import('../src/services/town/townPromptBuilder.js');

const MUL = '\u00d7';

test('原始需求快照渲染成结构化要点块', () => {
  assert.equal(renderAssetRequestSnapshot(null), '');
  assert.equal(renderAssetRequestSnapshot({}), '');
  assert.equal(renderAssetRequestSnapshot({ footprint: { w: 0, h: 2 } }), '', '非法占格不算需求');
  const text = renderAssetRequestSnapshot({
    desc: '  一间靠河的面包房，青瓦屋顶  ',
    styleTags: 'cozy pixel town',
    direction: 'up',
    footprint: { w: 2, h: 1 },
    special: true,
  }, { kind: 'building' });
  assert.match(text, /- 内容描述（这张图要画的主体，夹带的英文 tag 必须原样保留）：/);
  assert.match(text, /\n  一间靠河的面包房，青瓦屋顶/);
  assert.doesNotMatch(text, /描述：\s/, '描述要 trim');
  assert.match(text, /- 风格基调：cozy pixel town/);
  assert.match(text, /- 视角：背面（角色背对观众，back view）/);
  assert.ok(text.includes('- 占地：2' + MUL + '1 格'), text);
  assert.match(text, /- 地标：是（需要更精细、更有辨识度）/);
});

test('快照渲染：角色类素材用「外观描述」口径，多行原文各自缩进', () => {
  const text = renderAssetRequestSnapshot({
    desc: '标志性的侧呆毛，白发\n日常穿着便服，或者女生日常穿束',
    direction: 'down',
  }, { kind: 'npc' });
  assert.match(text, /- 角色形象描述（角色锚点特征，夹带的英文 tag 必须原样保留）：/);
  assert.match(text, /\n  标志性的侧呆毛，白发\n  日常穿着便服，或者女生日常穿束/);
  assert.match(text, /- 视角：正面（角色面朝观众，front view）/);
});

test('有需求快照时：快照进入上下文，并被声明为最高优先级', () => {
  const msgs = buildAssetRewriteMessages({
    currentPrompt: 'a bakery, isometric',
    kind: 'building',
    name: '面包房',
    requestSnapshot: { desc: '靠河的面包房', styleTags: 'cozy pixel' },
  });
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /【输出结构】/);
  assert.match(msgs[0].content, /The original requirement snapshot is the authority/);
  assert.match(msgs[0].content, /Merge duplicate features/);
  assert.match(msgs[1].content, /【原始需求快照（这张图最初要画的东西，最高优先级）】/);
  assert.match(msgs[1].content, /- 内容描述（这张图要画的主体，夹带的英文 tag 必须原样保留）：\n  靠河的面包房/);
  assert.match(msgs[1].content, /当前提示词：a bakery, isometric/);
  assert.equal(msgs[2].role, 'user');
  assert.match(msgs[2].content, /对照原始需求快照重写提示词/);
});

test('类型行带上素材形态说明，不只给 kind 缩写', () => {
  const msgs = buildAssetRewriteMessages({ currentPrompt: 'x', kind: 'npc', name: '琪亚娜' });
  assert.match(msgs[1].content, /类型：npc \/ 像素小人（chibi pixel sprite，纯白底全身图）/);
  const unknown = buildAssetRewriteMessages({ currentPrompt: 'x', kind: 'unknown-kind' });
  assert.match(unknown[1].content, /类型：unknown-kind \/ 游戏素材（game asset）/);
});

test('带用户要求时：要求与原始需求一起进入 user 指令', () => {
  const msgs = buildAssetRewriteMessages({
    currentPrompt: 'old prompt',
    requirement: '把屋檐改成青色',
    requestSnapshot: { desc: '面包房' },
  });
  assert.match(msgs[2].content, /【用户修改要求】/);
  assert.match(msgs[2].content, /把屋檐改成青色/);
  assert.match(msgs[2].content, /以原始需求为准/);
});

test('没有需求快照时保持旧口径：只改写当前提示词', () => {
  const msgs = buildAssetRewriteMessages({ currentPrompt: 'old prompt', kind: 'ground', name: '草地' });
  assert.match(msgs[0].content, /【输出结构】/);
  assert.doesNotMatch(msgs[0].content, /requirement snapshot is the authority/);
  assert.doesNotMatch(msgs[1].content, /原始需求快照/);
  assert.equal(msgs[2].content, '请执行：在保持素材主体与技术要求的前提下优化当前提示词，并以英文 prompt 输出。');
});

test('只有需求快照（还没落过提示词）时按需求出提示词，不报缺少提示词', () => {
  const msgs = buildAssetRewriteMessages({ requestSnapshot: { desc: '草地' }, kind: 'ground' });
  assert.match(msgs[1].content, /当前提示词：（这张素材还没有落过提示词）/);
  assert.equal(msgs[2].content, '请执行：按原始需求快照设计这张素材的提示词，并以英文 prompt 输出。');
});

test('既没有当前提示词也没有需求快照时报错', () => {
  assert.throws(
    () => buildAssetRewriteMessages({ currentPrompt: '   ', requestSnapshot: { desc: '' } }),
    /当前素材缺少提示词/,
  );
});

test('纯按原始需求重写（fromRequestOnly）：不提供既有提示词', () => {
  const msgs = buildAssetRewriteMessages({
    currentPrompt: 'a drifted old prompt',
    kind: 'building',
    name: '面包房',
    requestSnapshot: { desc: '靠河的面包房', styleTags: 'cozy pixel' },
    fromRequestOnly: true,
  });
  assert.match(msgs[0].content, /Rely ONLY on the original requirement snapshot/);
  assert.doesNotMatch(msgs[0].content, /drifted away/);
  assert.match(msgs[1].content, /既有提示词：忽略（本次完全按原始需求重写）/);
  assert.doesNotMatch(msgs[1].content, /drifted old prompt/);
  assert.match(msgs[1].content, /靠河的面包房/);
  assert.equal(msgs[2].content, '请执行：忽略既有提示词，完全按原始需求快照重写这张素材的提示词，并以英文 prompt 输出。');
});

test('纯按原始需求重写：不看当前提示词，没有需求快照才报错', () => {
  const msgs = buildAssetRewriteMessages({ requestSnapshot: { desc: '草地' }, fromRequestOnly: true });
  assert.equal(msgs[1].content.includes('当前提示词：'), false);
  assert.throws(
    () => buildAssetRewriteMessages({ currentPrompt: 'old prompt', fromRequestOnly: true }),
    /原始需求/,
  );
});

test('有用户要求时：用户要求决定改什么，原始需求只作事实基线', () => {
  const msgs = buildAssetRewriteMessages({
    currentPrompt: 'old prompt',
    requirement: '把屋檐改成青色',
    requestSnapshot: { desc: '面包房' },
  });
  assert.match(msgs[0].content, /the user request decides what to change/);
  assert.doesNotMatch(msgs[0].content, /drifted away/);
});