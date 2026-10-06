import test from 'node:test';
import assert from 'node:assert/strict';
import { composeImagePrompt, resolveImageRagQuery } from '../src/services/imagePromptPreparer.js';

// LIB_TAG_MIN_SCORE = 14 的门槛：ipk.lib.*（YAML 词库菜单）只注入 14+ 分命中，
// 框架条目（非 ipk.lib.* id）保持非零即入选。分数档见 scoreExecutableTag：
// 20 短语 / 16 别名或 bigram 全重叠 / 14 bigram 过半 / 12 英文跨词 / 10 少数 bigram 重叠。

function makeItem(id, tag, label, category = 'clothing_vocabulary') {
  return {
    id,
    category,
    priority: 55,
    executableTags: [{ tag, label, group: '测试' }],
  };
}

test('lib tag with weak bigram overlap (score 10) is not injected', () => {
  const item = makeItem('ipk.lib.clothing.test.001', 'white_kneehighs', '白色及膝袜');
  const result = composeImagePrompt('白色的裙子', [item], { ragQuery: '白色的裙子' });
  assert.deepEqual(result.selectedTags, []);
});

test('lib tag at the 14-point boundary (bigram majority overlap) is injected', () => {
  const item = makeItem('ipk.lib.clothing.test.002', 'thighhighs', '过膝袜');
  const result = composeImagePrompt('过膝的长袜', [item], { ragQuery: '过膝的长袜' });
  assert.equal(result.selectedTags.length, 1);
  assert.equal(result.selectedTags[0].tag, 'thighhighs');
  assert.equal(result.selectedTags[0].score, 14);
  assert.ok(result.promptRefined.includes('thighhighs'));
});

test('lib tag with exact label match (score 20) is injected', () => {
  const item = makeItem('ipk.lib.clothing.test.003', 'white_kneehighs', '白色及膝袜');
  const result = composeImagePrompt('穿白色及膝袜的女生', [item], { ragQuery: '穿白色及膝袜的女生' });
  assert.equal(result.selectedTags.length, 1);
  assert.equal(result.selectedTags[0].score, 20);
});

test('lib tag matched via english word soup (score 12) is not injected', () => {
  const item = makeItem('ipk.lib.clothing.test.004', 'long dress', '长连衣裙');
  const result = composeImagePrompt('1girl, white dress, long hair', [item], { ragQuery: '' });
  assert.deepEqual(result.selectedTags, []);
});

test('framework entry keeps the nonzero threshold (weak match still injected)', () => {
  const item = makeItem('ipk.test.framework', 'white_kneehighs', '白色及膝袜');
  const result = composeImagePrompt('白色的裙子', [item], { ragQuery: '白色的裙子' });
  assert.equal(result.selectedTags.length, 1);
  assert.equal(result.selectedTags[0].score, 10);
});

test('resolveImageRagQuery prefers chinese ragQuery over english prompt', () => {
  assert.equal(resolveImageRagQuery('1girl, cafe', '在咖啡厅的女生'), '在咖啡厅的女生');
  assert.equal(resolveImageRagQuery('1girl, cafe', '  '), '1girl, cafe');
});
