import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAppearanceIdentityCorpus,
  replaceAppearanceSection,
  splitAppearanceSection,
  isAppearanceOnlyPromptChange,
} from './characterPersona.js';

test('extractAppearanceIdentityCorpus 截取开头段到「来自」后的第一个句号并去掉「你是」', () => {
  const card = '你是星见雅(Hoshimi Miyabi)，来自《绝区零》。\n\n## 你的身份\n你是新艾利都对空洞特别行动科第六课的课长。';
  assert.equal(
    extractAppearanceIdentityCorpus(card, '星见雅'),
    '星见雅(Hoshimi Miyabi)，来自《绝区零》。',
  );
});

test('extractAppearanceIdentityCorpus 兼容「来自」单独成行的卡片', () => {
  const card = '你是芙宁娜(Furina)。\n来自《原神》。\n\n## 你的身份\n你是枫丹的前任水神。';
  assert.equal(
    extractAppearanceIdentityCorpus(card, '芙宁娜'),
    '芙宁娜(Furina)。\n来自《原神》。',
  );
});

test('extractAppearanceIdentityCorpus 只在首个空行前的段落里找「来自」，不受正文影响', () => {
  const card = '你是流萤(Firefly)，来自《崩坏：星穹铁道》。\n\n## 你的身份\n你来自天外的一艘星舰，常年沉睡。';
  assert.equal(
    extractAppearanceIdentityCorpus(card, '流萤'),
    '流萤(Firefly)，来自《崩坏：星穹铁道》。',
  );
});

test('extractAppearanceIdentityCorpus 无「来自」或句号时回退为显示名', () => {
  assert.equal(extractAppearanceIdentityCorpus('你是萨沙(Sasha)。你是一名高中生。', '萨沙'), '萨沙');
  assert.equal(extractAppearanceIdentityCorpus('你是无名，来自只有传说的地方', '无名'), '无名');
  assert.equal(extractAppearanceIdentityCorpus('', '默认助手'), '默认助手');
  assert.equal(extractAppearanceIdentityCorpus('', ''), '');
});

test('replaceAppearanceSection 原位替换已有外观段（默认是最后一段）', () => {
  const card = '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\n- 旧外观一行\n- 旧外观两行';
  assert.equal(
    replaceAppearanceSection(card, 'Sasha has long golden hair, wearing a white JK uniform.'),
    '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\nSasha has long golden hair, wearing a white JK uniform.',
  );
});

test('replaceAppearanceSection 外观段之后还有别的段落时只替换到下一个标题', () => {
  const card = '## 你的外观\n- 旧外观\n\n## 你的口癖\n- 呐呐';
  const result = replaceAppearanceSection(card, 'new look');
  assert.ok(result.includes('## 你的外观\nnew look'));
  assert.ok(result.includes('## 你的口癖\n- 呐呐'));
  assert.ok(result.indexOf('new look') < result.indexOf('## 你的口癖'));
});

test('replaceAppearanceSection 无外观段时在卡末补一段', () => {
  const card = '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气';
  assert.equal(
    replaceAppearanceSection(card, 'Sasha has blue eyes.'),
    '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\nSasha has blue eyes.',
  );
  assert.equal(replaceAppearanceSection('', 'only look'), '\n\n## 你的外观\nonly look');
});

test('splitAppearanceSection 切出的前后文按公式重组后与 replaceAppearanceSection 完全一致', () => {
  const assemble = (base, body) => {
    const { before, after } = splitAppearanceSection(base);
    return `${before}## 你的外观\n${body}${after}`;
  };
  const cases = [
    '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\n- 旧外观',
    '你是萨沙(Sasha)。\n\n## 你的外观\n- 旧外观\n\n## 你的口癖\n- 呐呐',
    '## 你的外观\n- 旧外观',
    '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气',
    '',
  ];
  for (const base of cases) {
    assert.equal(assemble(base, 'new look'), replaceAppearanceSection(base, 'new look'));
  }
});

test('isAppearanceOnlyPromptChange 仅外观段正文变化（含外观段增删）时返回 true', () => {
  const card = '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\n- 金发\n- 白色JK';
  assert.equal(isAppearanceOnlyPromptChange(card, card.replace('- 金发', '- 银发')), true);
  assert.equal(isAppearanceOnlyPromptChange(card, card.replace('- 白色JK', '- 白色JK，黑丝')), true);
  // 原卡无外观段 → 卡末新增外观段
  const noAppearance = '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气';
  assert.equal(isAppearanceOnlyPromptChange(noAppearance, replaceAppearanceSection(noAppearance, '- 金发')), true);
  // 删除整段外观
  assert.equal(isAppearanceOnlyPromptChange(card, noAppearance), true);
});

test('isAppearanceOnlyPromptChange 外观段之前的正文变化时返回 false', () => {
  const card = '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\n- 金发';
  assert.equal(isAppearanceOnlyPromptChange(card, card.replace('- 元气', '- 高冷')), false);
  assert.equal(isAppearanceOnlyPromptChange(card, card.replace('萨沙', '星野')), false);
});

test('isAppearanceOnlyPromptChange 容忍标题前收尾空白差异与完全一致的两次保存', () => {
  const card = '你是萨沙(Sasha)。\n\n## 你的性格\n- 元气\n\n## 你的外观\n- 金发';
  assert.equal(isAppearanceOnlyPromptChange(card, card.replace('\n\n## 你的外观', '\n## 你的外观')), true);
  assert.equal(isAppearanceOnlyPromptChange(card, card), true);
  assert.equal(isAppearanceOnlyPromptChange(card.replace('\n\n## 你的外观', '\n## 你的外观'), card), true);
});
