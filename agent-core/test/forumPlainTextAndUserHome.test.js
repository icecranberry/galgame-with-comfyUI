/**
 * 论坛纯文字 + 人类居住地注入 —— 回归测试。
 *
 * 覆盖 2026-10-05 用户实报的两条：
 *  A. **论坛是纯文字版面**：此前提示词允许"约四分之一配图"，实测 12 条里 5 条配了图，
 *     版面变成图文混排。现改为一律不配图，且**出口层强制清空**（只改提示词不够，模型有惯性）。
 *  B. **人类（用户）居住地**：此前完全没有这个入口，角色日程里"回家"只能含糊写"公寓"。
 *     现可从地图选，并注入日程；**未指定时整段不出现**（不猜、不编）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`test forbids network: ${url}`); };

const { normalizeForumDraft } = await import('../src/services/mediaService.js');
const { buildScheduleConstraintBlock } = await import('../src/services/scheduleGenerator.js');

// ══════════════════════════════════════════════════════════
// A. 论坛必须是纯文字
// ══════════════════════════════════════════════════════════

const BOARDS = [{ id: 1, name: '闲聊' }];
const AUTHORS = [];

/** 造一条论坛帖原始草稿（可选带 image_prompt，模拟模型不听话） */
const post = (extra = {}) => ({
  board: '闲聊', title: '标题', content: '正文内容', tags: ['标签'],
  author: '某个网友', likes: 10, views: 100,
  replies: [{ floor: 1, author: '二楼', content: '回复', quote: null }],
  ...extra,
});

test('★★ 论坛帖即使模型给了 image_prompt，出口层也必须清空（纯文字版面）', () => {
  const out = normalizeForumDraft(
    { posts: [post({ image_prompt: 'a girl standing in the rain, neon lights' })] },
    BOARDS, AUTHORS,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].image_prompt, null,
    '论坛是文字版；模型有惯性仍会产出 image_prompt，必须在出口层兜底清空');
});

test('★ 论坛帖没给 image_prompt 时同样是 null（不是 undefined）', () => {
  const out = normalizeForumDraft({ posts: [post()] }, BOARDS, AUTHORS);
  assert.equal(out[0].image_prompt, null);
});

test('★ 清空配图不得影响论坛的其它字段（标题/正文/回复都要在）', () => {
  const out = normalizeForumDraft(
    { posts: [post({ image_prompt: 'x' })] },
    BOARDS, AUTHORS,
  );
  const p = out[0];
  assert.equal(p.title, '标题');
  assert.equal(p.content, '正文内容');
  assert.ok(Array.isArray(p.payload?.forum?.replies), '回复结构要保留');
  assert.equal(p.payload.forum.replies.length, 1);
});

// ══════════════════════════════════════════════════════════
// B. 人类居住地注入
// ══════════════════════════════════════════════════════════

test('★ 人类居住地：设了就注入，且说明「这是用户的住处、不是角色的家」', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] },
    userHome: '旧川里公寓', userName: 'moka',
  });
  assert.ok(s);
  assert.match(s, /moka 的住处/);
  assert.match(s, /旧川里公寓/);
  assert.match(s, /不是角色自己的家/, '必须点明归属，否则模型会把自己的家和用户的混为一谈');
});

test('★ 人类居住地：没设时整段不出现（不猜、不编）', () => {
  const s = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] } });
  assert.doesNotMatch(s, /的住处/);
  // 空串同样不出现
  const s2 = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] }, userHome: '' });
  assert.doesNotMatch(s2, /的住处/);
  // 只有空白字符也不算
  const s3 = buildScheduleConstraintBlock({ areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] }, userHome: '   ' });
  assert.doesNotMatch(s3, /的住处/);
});

test('★ 人类居住地：没给昵称时用「用户」兜底，不产生「 的住处」这种空主语', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] }, userHome: '旧川里',
  });
  assert.match(s, /用户 的住处/);
});

test('★ 人类居住地必须写明"不要含糊写成公寓"（这正是用户报的问题）', () => {
  const s = buildScheduleConstraintBlock({
    areas: ['二维市'], scenesByArea: { 二维市: ['泊地站'] }, userHome: '旧川里',
  });
  assert.match(s, /不要含糊写成/);
});