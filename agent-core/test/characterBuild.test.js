import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`characterBuild test forbids network: ${url}`); };

const {
  bucketOfHeight,
  extractHeightCm,
  extractBuildTag,
  deriveBuild,
  buildBodySizeLine,
  buildCastBodySummary,
} = await import('../src/services/characterBuild.js');
const { IMAGE_PROMPT_RULE } = await import('../src/builtinRules.js');

// 覆盖范围：
// 1) 身高/体型解析：只读出现有文本，读不出就返回 null（绝不发明数值）
// 2) 档位边界
// 3) 多人对照块：单人 / 无身高时不输出（避免噪声与凭空排序）
// 4) 静态钉子：IMAGE_PROMPT_RULE 里必须保留「多人相对体型」条款（漏删＝回归）

const c = (name, base) => ({ id: 9001, display_name: name, base_prompt: base });

test('extractHeightCm：认「身高157cm」与宽松「157cm」，过滤离谱数值', () => {
  assert.equal(extractHeightCm('你身高157cm，体型偏瘦'), 157);
  assert.equal(extractHeightCm('身高约 152 厘米'), 152);
  assert.equal(extractHeightCm('body height 168cm'), 168);
  // 非法/离谱
  assert.equal(extractHeightCm('身高999cm'), null);
  assert.equal(extractHeightCm('身高 90cm'), null);
  assert.equal(extractHeightCm('她穿着 80 厘米的裙子'), null);
  assert.equal(extractHeightCm(''), null);
  assert.equal(extractHeightCm(null), null);
});

test('bucketOfHeight：档位边界', () => {
  assert.equal(bucketOfHeight(151), 'petite');
  assert.equal(bucketOfHeight(152), 'short');
  assert.equal(bucketOfHeight(159), 'short');
  assert.equal(bucketOfHeight(160), 'average');
  assert.equal(bucketOfHeight(168), 'average');
  assert.equal(bucketOfHeight(169), 'tall');
  assert.equal(bucketOfHeight(175), 'tall');
  assert.equal(bucketOfHeight(176), 'verytall');
  assert.equal(bucketOfHeight(null), null);
});

test('extractBuildTag：中文体型词映射（高挑优先于纤细等描述顺序）', () => {
  assert.equal(extractBuildTag('身材娇小'), 'petite');
  assert.equal(extractBuildTag('身姿纤细挺拔'), 'slender');
  assert.equal(extractBuildTag('体态丰满'), 'curvy');
  assert.equal(extractBuildTag('身形高挑'), 'tall');
  assert.equal(extractBuildTag('身材匀称'), 'average');
  assert.equal(extractBuildTag('slender build'), 'slender');
  assert.equal(extractBuildTag('没有体型描述'), null);
});

test('deriveBuild：有身高优先用身高；只有体型词时降级；都没有则 source=null', () => {
  const withH = deriveBuild(c('甲', '你是甲。\n\n## 你的外观\n你身高157cm，身形纤细。'));
  assert.equal(withH.source, 'height');
  assert.equal(withH.heightCm, 157);
  assert.equal(withH.bucket, 'short');
  assert.match(withH.en, /157cm/);

  const keywordOnly = deriveBuild(c('乙', '你是乙。\n\n## 你的外观\n你个子娇小，头发很长。'));
  assert.equal(keywordOnly.source, 'keyword');
  assert.equal(keywordOnly.heightCm, null);
  assert.equal(keywordOnly.bucket, 'petite');

  const none = deriveBuild(c('丙', '你是丙。\n\n## 你的外观\n黑发红瞳。'));
  assert.equal(none.source, null);
  assert.equal(none.en, null);
});

test('buildBodySizeLine：读不出体型时返回 null（不给生图加噪声）', () => {
  assert.match(buildBodySizeLine(c('甲', '你身高163cm。')), /身高约 163cm/);
  assert.equal(buildBodySizeLine(c('丙', '黑发红瞳。')), null);
});

test('buildCastBodySummary：<2 人 → null；只有 1 人有身高 → null（不凭空排序）', () => {
  const a = c('甲', '你身高150cm。');
  const b = c('乙', '你身高175cm。');
  const noH = c('丙', '黑发红瞳。');

  assert.equal(buildCastBodySummary([a]), null);
  assert.equal(buildCastBodySummary([]), null);
  assert.equal(buildCastBodySummary([a, noH]), null, '只有一人有身高时不得输出对照');

  const s = buildCastBodySummary([b, a]);
  assert.ok(s, '两人都有身高时必须输出对照');
  // 排序：矮的在前，且标出最高/最矮
  assert.ok(s.indexOf('甲') < s.indexOf('乙'), '应按身高升序排列');
  assert.match(s, /全场最矮/);
  assert.match(s, /全场最高/);
  assert.match(s, /严禁把全场角色画成同一高度/);
});

test('buildCastBodySummary：未标身高者按体型词附注，不混进排序', () => {
  const a = c('甲', '你身高150cm。');
  const b = c('乙', '你身高175cm。');
  const kw = c('丙', '你身材娇小。');
  const s = buildCastBodySummary([a, b, kw]);
  assert.ok(s);
  assert.match(s, /丙（矮小）/);
});

test('静态钉子：IMAGE_PROMPT_RULE 必须保留「多人相对体型」条款', () => {
  const rule = String(IMAGE_PROMPT_RULE.rule_content || '');
  assert.match(rule, /Relative body size/, '相对体型条款被删了 —— 这正是「萝莉与御姐一样高」的复发路径');
  assert.match(rule, /Never normalise the cast to one height/);
  assert.match(rule, /Multiple Characters/, '多人分句条款也应保留');
});
