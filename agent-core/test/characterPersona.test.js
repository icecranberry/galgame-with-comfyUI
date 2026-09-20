import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`characterPersona test forbids network: ${url}`); };

const { config } = await import('../src/config.js');
const { getUserName, matchUser } = await import('../src/services/userSearch.js');
const {
  buildCharacterPersona,
  buildImageCrossRefInfo,
  buildUserImageCrossRefInfo,
} = await import('../src/services/characterPersona.js');

// 覆盖范围：
// 1) userSearch：用户名提及匹配（占位名 / 单字名 / 非字符串输入都不得误判）
// 2) buildUserImageCrossRefInfo：用户自述资料块（图片实验室、私聊提到用户名时注入）
// 3) AGENTS.md 强制的回归：无生效外观时 characterPersona 与收口前的旧口径逐字节一致
//
// 外观注入一律显式传 outfits: null —— 既绕开 DB，也保证断言只反映「没有外观可注入」这条路径。

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
