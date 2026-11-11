import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`characterPersona test forbids network: ${url}`); };

const { config } = await import('../src/config.js');
const { getUserName, matchUser } = await import('../src/services/userSearch.js');
const {
  buildCharacterPersona,
  buildCharacterAppearanceSection,
  buildCharacterImageAppearance,
  extractCharacterEnglishName,
  buildOutfitInjectionBlocks,
  buildImageCrossRefInfo,
  buildUserImageCrossRefInfo,
  extractAppearanceIdentityCorpus,
  replaceAppearanceSection,
  splitAppearanceSection,
  extractEditableAppearanceBody,
  isAppearanceOnlyPromptChange,
  extractCharacterIdentityTag,
  ensureImagePromptIdentity,
} = await import('../src/services/characterPersona.js');

// 覆盖范围：
// 1) userSearch：用户名提及匹配（占位名 / 单字名 / 非字符串输入都不得误判）
// 2) buildUserImageCrossRefInfo：用户自述资料块（图片实验室、私聊提到用户名时注入）
// 3) AGENTS.md 强制的回归：无生效外观时 characterPersona 与收口前的旧口径逐字节一致
//
// 无外观回归用例显式传 outfits: null —— 既绕开 DB，也保证断言只反映「没有外观可注入」这条路径。

/** 临时改写 config.user，返回还原函数（用例之间不串味） */
function patchUser(patch) {
  const saved = { ...config.user };
  Object.assign(config.user, patch);
  return () => Object.assign(config.user, saved);
}

// 标准测试角色：身份行 + 外观段俱全，用来对齐旧口径
const CHAR = {
  id: 1,
  display_name: '小满',
  short_prompt: '小满是面包店店员。',
  base_prompt: '你是小满，来自邻舍镇的面包店店员，性格温柔。\n\n## 你的外观\n小满有着栗色长发与琥珀色眼睛。\n',
};

test('文本里出现用户名时 matchUser 命中', () => {
  const restore = patchUser({ nickname: '阿离' });
  try {
    assert.equal(matchUser('阿离站在面包店门口，回头看向镜头'), true);
    assert.equal(matchUser('阿离'), true);
  } finally {
    restore();
  }
});

test('文本里没出现用户名时 matchUser 不命中', () => {
  const restore = patchUser({ nickname: '阿离' });
  try {
    assert.equal(matchUser('小满站在面包店门口'), false);
    assert.equal(matchUser(''), false);
  } finally {
    restore();
  }
});

test('占位昵称「用户」/「user」不算提到用户本人', () => {
  // 没设置昵称时 config.user.nickname 就是 '用户'；若把它当名字，
  // 正文里任何一句「用户」都会误触发注入
  for (const nickname of ['用户', 'user', 'User']) {
    const restore = patchUser({ nickname });
    try {
      assert.equal(getUserName(), nickname);
      assert.equal(matchUser('用户把面包放回了货架'), false);
    } finally {
      restore();
    }
  }
});

test('单字昵称不算提到用户本人', () => {
  const restore = patchUser({ nickname: '离' });
  try {
    assert.equal(matchUser('离站在面包店门口'), false);
  } finally {
    restore();
  }
});

test('matchUser 对空值与非字符串输入返回 false 且不抛', () => {
  const restore = patchUser({ nickname: '阿离' });
  try {
    for (const input of [null, undefined, '', 0, 123, {}, []]) {
      assert.equal(matchUser(input), false);
    }
  } finally {
    restore();
  }
});

test('getUserName 缺省回退占位名，并去掉首尾空白', () => {
  const restore = patchUser({ nickname: '' });
  try {
    assert.equal(getUserName(), '用户');
  } finally {
    restore();
  }

  const restoreTrimmed = patchUser({ nickname: '  阿离  ' });
  try {
    assert.equal(getUserName(), '阿离');
  } finally {
    restoreTrimmed();
  }
});

test('用户资料三项全空时给出占位说明（不返回空串）', () => {
  const restore = patchUser({ gender: '', appearance: '', persona: '' });
  try {
    assert.equal(buildUserImageCrossRefInfo(), '（用户未填写个人资料，按普通人处理）');
  } finally {
    restore();
  }
});

test('用户资料按性别 / 外观 / 其他说明顺序拼接', () => {
  const restore = patchUser({ gender: '女', appearance: '黑色长发，常穿米色外套', persona: '说话慢，喜欢甜食' });
  try {
    assert.equal(
      buildUserImageCrossRefInfo(),
      '性别：女；外观：黑色长发，常穿米色外套；其他说明：说话慢，喜欢甜食',
    );
  } finally {
    restore();
  }

  // 只填一项时不留多余分隔符
  const restorePartial = patchUser({ gender: '', appearance: '黑色长发', persona: '' });
  try {
    assert.equal(buildUserImageCrossRefInfo(), '外观：黑色长发');
  } finally {
    restorePartial();
  }
});

test('提到用户时的注入块与角色块同形：`[名字]` + 换行 + 资料', () => {
  const restore = patchUser({ nickname: '阿离', gender: '女', appearance: '黑色长发', persona: '' });
  try {
    assert.equal(
      `[${getUserName()}]\n${buildUserImageCrossRefInfo()}`,
      '[阿离]\n性别：女；外观：黑色长发',
    );
  } finally {
    restore();
  }
});

test('无生效外观时 short variant 与旧口径逐字节一致（short_prompt + 外观段）', () => {
  assert.equal(
    buildCharacterPersona(CHAR, { outfits: null }),
    '小满是面包店店员。\n## 你的外观\n小满有着栗色长发与琥珀色眼睛。',
  );
});

test('无生效外观时 full variant 与旧口径逐字节一致（整卡原样）', () => {
  assert.equal(buildCharacterPersona(CHAR, { variant: 'full', outfits: null }), CHAR.base_prompt);
});

test('外观段默认保留标题，直接生图可仅移除标题而保留正文', () => {
  assert.equal(
    buildCharacterAppearanceSection(CHAR, { outfits: null }),
    '## 你的外观\n小满有着栗色长发与琥珀色眼睛。\n',
  );
  for (const heading of ['## 你的外观\n', '##你的外观\r\n', '## 你的外观 ']) {
    assert.equal(
      buildCharacterAppearanceSection({ base_prompt: `人格正文\n${heading}Mobius has green hair, bright eyes.\n` }, { outfits: null, includeHeading: false }),
      'Mobius has green hair, bright eyes.',
    );
  }
  assert.equal(buildCharacterAppearanceSection({ base_prompt: '无外观段' }, { outfits: null, includeHeading: false }), '');
  assert.equal(buildCharacterAppearanceSection({ base_prompt: '## 你的外观\n' }, { outfits: null, includeHeading: false }), '');
});

test('省略外观标题不丢失生效服饰、基础外观或着装优先级', () => {
  const outfits = { limited: [{ name: '测试服饰', description: 'silver coat' }], exclusive: null };
  for (const character of [CHAR, { base_prompt: '' }]) {
    const section = buildCharacterAppearanceSection(character, { outfits });
    const body = buildCharacterAppearanceSection(character, { outfits, includeHeading: false });
    assert.equal(body, section.replace('## 你的外观', '').trim());
    assert.doesNotMatch(body, /##\s*你的外观/);
    assert.match(body, /silver coat/);
    assert.match(body, /【着装裁定/);
  }
});

test('无生效外观时 buildImageCrossRefInfo 与旧口径逐字节一致（身份行 + 外观段）', () => {
  // 身份行切到含「来自」那一段的末标点；外观段「你」→ 角色名，并保留原有结尾换行
  assert.equal(
    buildImageCrossRefInfo(CHAR, { outfits: null }),
    '小满，来自邻舍镇的面包店店员\n## 小满的外观\n小满有着栗色长发与琥珀色眼睛。\n',
  );
});

test('无外观段的角色：short 兜底整卡、full 原样返回', () => {
  const plain = { id: 2, display_name: '阿岚', short_prompt: '', base_prompt: '你是阿岚，来自邻舍镇的邮差。' };
  assert.equal(buildCharacterPersona(plain, { outfits: null }), '你是阿岚，来自邻舍镇的邮差。');
  assert.equal(buildCharacterPersona(plain, { variant: 'full', outfits: null }), '你是阿岚，来自邻舍镇的邮差。');
});

// 外观段编辑与身份提取：与人格组装共同维护，避免同名测试分散。
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


test('editable appearance extraction excludes following chapters and replacement preserves surrounding prose', () => {
  const source='身份原文\n\n## 你的外观\n黑发、蓝眼。\n## 你的约定\n尾部原文';
  assert.equal(extractEditableAppearanceBody(source),'黑发、蓝眼。');
  assert.equal(replaceAppearanceSection(source,'红发、蓝眼。'),'身份原文\n\n## 你的外观\n红发、蓝眼。\n## 你的约定\n尾部原文');
  assert.equal(extractEditableAppearanceBody('没有外观标题'), '');
  assert.equal(extractEditableAppearanceBody('## 你的外观\n## 你的约定\n不能吞掉'), '');
  assert.equal(replaceAppearanceSection('## 你的外观\n## 你的约定\n不能吞掉', '红发'), '## 你的外观\n红发\n## 你的约定\n不能吞掉');
});


test('三种生效外观组合均遵循世界观着装规定，同时保留外观来源优先级与整体替换', () => {
  const limited = [{ name: '限时服饰', description: '银色短发，蓝色礼服' }];
  const exclusive = { name: '专属形态', description: '黑色长发，白色制服' };
  for (const [outfits, order] of [
    [{ limited }, '限时服饰 > 基础外观'],
    [{ exclusive }, '角色专属形态 > 基础外观'],
    [{ limited, exclusive }, '限时服饰 > 角色专属形态 > 基础外观'],
  ]) {
    const blocks = buildOutfitInjectionBlocks(outfits);
    assert.ok(blocks.tail.includes(`优先级：${order}`));
    assert.match(blocks.tail, /若已提供<world_setting>，最终服装、饰品与鞋袜必须符合其中明确的着装规定/);
    assert.match(blocks.tail, /仅调整与世界观冲突的服饰细节，保留其余设计/);
    assert.match(blocks.tail, /不得借适配世界观恢复已被替换的基础服装、发型或发色/);
    assert.match(blocks.tail, /世界观未规定的部分按上述外观优先级执行，不自行添加限制/);
    assert.match(blocks.tail, /整体替换，不是叠加/);
    assert.match(blocks.lead, /在符合世界观规定的前提下完整呈现/);
    for (const variant of ['short', 'full']) {
      assert.ok(buildCharacterPersona(CHAR, { variant, outfits }).endsWith(blocks.tail));
    }
  }
  assert.equal(buildOutfitInjectionBlocks({ limited: [], exclusive: null }), null);
});

test('extractCharacterIdentityTag 从外观段提取 Name (Series)，限时服饰包裹也能提取', () => {
  const char = {
    base_prompt: '你是瑟莉姆（thelema nutriscu）。\n\n## 你的外观\n【限时服饰（当前生效）】\n1. 日常装：thelema nutriscu (Honkai Impact 3rd) has long silvery hair and striking purple eyes.\n\n【基础外观】silvery hair.',
  };
  assert.equal(extractCharacterIdentityTag(char), 'thelema nutriscu (Honkai Impact 3rd)');
});

test('extractCharacterIdentityTag 对原创角色返回空串', () => {
  assert.equal(extractCharacterIdentityTag({
    base_prompt: '你是星见雅。\n\n## 你的外观\n黑色长发，蓝色眼睛。',
  }), '');
});

test('ensureImagePromptIdentity 缺失时补在开头，已有名字不重复补', () => {
  const char = {
    base_prompt: '你是三月七。\n\n## 你的外观\nMarch 7th (Honkai: Star Rail) has short fluffy pink hair and bright pink eyes.',
  };
  assert.equal(
    ensureImagePromptIdentity('A dimly lit training hall with a young woman.', char),
    'March 7th (Honkai: Star Rail). A dimly lit training hall with a young woman.',
  );
  assert.equal(
    ensureImagePromptIdentity('March 7th (Honkai: Star Rail) stands in a training hall.', char),
    'March 7th (Honkai: Star Rail) stands in a training hall.',
  );
  assert.equal(
    ensureImagePromptIdentity('March 7th stands in a training hall.', char),
    'March 7th stands in a training hall.',
  );
});

test('ensureImagePromptIdentity 保留梦境前缀，不破坏 A surreal dreamscape scene:', () => {
  const char = {
    base_prompt: '你是三月七。\n\n## 你的外观\nMarch 7th (Honkai: Star Rail) has short fluffy pink hair.',
  };
  assert.equal(
    ensureImagePromptIdentity('A surreal dreamscape scene: floating islands and a girl.', char),
    'A surreal dreamscape scene: March 7th (Honkai: Star Rail). floating islands and a girl.',
  );
});

test('direct image appearance keeps only default prose and strips legacy arbitration and duplicate tags', () => {
  const base = 'Elysia (Honkai Impact 3rd) has pink hair, blue eyes, wearing a white shirt.';
  const character = { name: 'elysia', base_prompt: 'Personality\n## 你的外观\n【限时服饰（当前生效）】\n1. 睡衣：pink pajamas\n【基础外观（仅用于填补）】elysia \\(coco\\) \\(honkai impact\\), ' + base + '\n【着装裁定（优先级）】\n忽略原衣服\n## 其他\nDo not send this.' };
  assert.equal(buildCharacterImageAppearance(character), base);
  assert.equal(extractCharacterEnglishName(character), 'Elysia');
  assert.equal(buildCharacterImageAppearance({ base_prompt: '## 你的外观\n【限时服饰】a dress\n【着装裁定】rules' }), '');
});

test('direct image identity understands an original Chinese character with an English name in parentheses', () => {
  const character = { name: '白芷清', base_prompt: '## 你的外观\n白芷清 (Bai Zhiqing) has grey hair, amber eyes, wearing a blue skirt.\n## 其他\nHidden persona.' };
  assert.equal(buildCharacterImageAppearance(character), 'Bai Zhiqing has grey hair, amber eyes, wearing a blue skirt.');
  assert.equal(extractCharacterEnglishName(character), 'Bai Zhiqing');
  assert.equal(extractCharacterEnglishName({ name: 'original_character', base_prompt: '## 你的外观\nshort hair, blue eyes' }), 'original character');
});

test('escaped IP identities retain their English name and do not leak the closing escape into the series', () => {
  const character = { name: '中文名字', base_prompt: '## 你的外观\nFurina \\(Genshin Impact\\) has blue hair and blue eyes.' };
  assert.equal(extractCharacterIdentityTag(character), 'Furina (Genshin Impact)');
  assert.equal(extractCharacterEnglishName(character), 'Furina');
  assert.equal(buildCharacterImageAppearance(character), 'Furina \\(Genshin Impact\\) has blue hair and blue eyes.');
});
