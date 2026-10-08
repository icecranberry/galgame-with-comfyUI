/**
 * 生图「人数判定」回归测试。
 *
 * ── 为什么单独钉这一条（2026-10-05，用户实报）──────────────
 * 用户反馈：**日程 / 朋友圈 / 对话**的提示词会「把单一角色画成同一个人两个人」。
 * 查出根因在 `imagePromptPreparer.js` 的人数判定上 —— 原判据把 `two`/`three`
 * 当**裸词**匹配，于是：
 *
 *     "holding a cup in her **two** hands"      → 判成多人 → 不加 solo
 *     "both **two** legs raised onto his shoulders" → 同上
 *
 * `solo` 一旦不加，模型就可能把同一角色渲染成两份（尤其在有画师串/LoRA 强化角色特征时）。
 * 84 条体位的 prompt 里大量出现 "two hands / two legs"，所以这不是个例。
 *
 * 本测试钉住**双向**语义：
 *   · 身体部位词（two hands/two legs/both arms…）**绝不能被当成多人**
 *   · 真正的多人表达（2girls / 1girl 1boy / two people / threesome / crowd…）**必须仍被判为多人**
 *   少任一条都会回退：前者导致画两个人，后者导致双人图丢了第二个人。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`countRule test forbids network: ${url}`); };

const { composeImagePrompt } = await import('../src/services/imagePromptPreparer.js');

/** 只喂 count.solo 这一条知识，隔离出人数判定的行为 */
const SOLO_ONLY = [{
  id: 'ipk.count.solo', category: 'count_identity', title: '单人数量锚点', priority: 90,
  content: '单人画面明确写出性别计数与 solo。',
  tags: ['solo'],
}];

const withSolo = (prompt) => /\bsolo\b/i.test(composeImagePrompt(prompt, SOLO_ONLY).promptRefined);

// ══════════════════════════════════════════════════════════
// ① 身体部位词不得触发"多人"（这就是用户报的 bug）
// ══════════════════════════════════════════════════════════
test('★ 单人：two hands / two legs 等身体部位词不得被当成多人', () => {
  const cases = [
    '1girl sitting on the bed holding a cup in her two hands, night, bedroom',
    '1girl lying on her back with both legs raised onto his shoulders, bedroom',
    '1girl with two pigtails and two blue eyes, standing, street',
    '1girl, both hands on the desk, classroom, afternoon light',
    '1girl covering her two ears, surprised, festival',
    '1girl, two breasts visible, lying on bed',
    '1girl tying her two shoes, doorway',
  ];
  for (const p of cases) {
    assert.equal(withSolo(p), true, `应判为单人却被当成多人：${p}`);
  }
});

test('★ 单人：明确写 alone / by herself 时按单人处理', () => {
  assert.equal(withSolo('1girl, sitting alone by the window, reading a book'), true);
  assert.equal(withSolo('1girl sitting by herself in an empty classroom'), true);
});

test('★ 单人：solo 一旦被判定，必须清掉残留的多人计数标签', () => {
  const r = composeImagePrompt(
    '1girl with two hands raised, 2girls, 2boys, classroom',
    [{ ...SOLO_ONLY[0] }],
  );
  // 这条含 2girls，所以是多人 → 不该加 solo；换一条纯单人的验证清理逻辑
  const r2 = composeImagePrompt('1girl, alone, two hands on hips, 2girls, street', SOLO_ONLY);
  assert.match(r2.promptRefined, /solo/i, '说了 alone 就该按单人');
  assert.doesNotMatch(r2.promptRefined, /\b2girls\b/, '判成单人后必须移除 2girls，否则模型会画两个');
});

// ══════════════════════════════════════════════════════════
// ② 真正的多人表达必须仍被判为多人（不能矫枉过正）
// ══════════════════════════════════════════════════════════
test('★★ 多人：明确的人数与互动词必须仍判为多人（否则双人图会丢人）', () => {
  const cases = [
    ['1girl 1boy, having sex on the bed, missionary', '1girl 1boy'],
    ['2girls kissing each other, bedroom', '2girls'],
    ['two people share the frame: a girl and a man', 'two people'],
    ['the scene has two girls sitting together', 'two girls'],
    ['a couple walks down the street at night', 'couple'],
    ['a threesome on the bed', 'threesome'],
    ['a crowd gathers in the plaza', 'crowd'],
    ['multiple characters in the frame', 'multiple characters'],
    ['three men surround her, group scene', 'three men'],
    ['two women and one man, on the sofa', 'two women'],
  ];
  for (const [p, why] of cases) {
    assert.equal(withSolo(p), false, `应判为多人却被当成单人（${why}）：${p}`);
  }
});

test('★ 多人：both 后接人算多人，both 后接身体部位不算', () => {
  assert.equal(withSolo('both girls are laughing'), false, 'both girls = 多人');
  assert.equal(withSolo('both hands are tied behind her back'), true, 'both hands = 单人');
});

// ══════════════════════════════════════════════════════════
// ③ 回归：这批体位的真实 prompt 片段
// ══════════════════════════════════════════════════════════
test('★ 实测回归：84 条体位中带 two hands / her ass 的 prompt 仍应判为单人', () => {
  const real = [
    // 068 扛腿位（用户报的那张就是它）
    "the girl is lying on her back with both legs raised high onto the boy's shoulders and her ass lifted off the bed; the boy is kneeling in front of her with her calves or knees resting on his shoulders and his hands around her waist or ass",
    // 042 常见：手被按住
    'the girl is bent over the desk with both hands pinned behind her back',
    // 站立位常见
    'the girl is standing with her two legs slightly apart, one hand on the wall',
  ];
  for (const p of real) {
    assert.equal(withSolo(p), true, `体位 prompt 被误判为多人：${p.slice(0, 60)}…`);
  }
});