/**
 * 生图时段锚点 —— 回归测试
 *
 * 用户反馈（2026-10-06）：「日程写的是凌晨 2 点自慰，生图结果却是白天」。
 *
 * 根因：生图链路**完全不感知时间** —— `imagePromptPreparer` / `imageSkill` 里
 * 没有任何时段输入，而日程描述往往**不写"深夜/凌晨"字样**，
 * 于是"显式出现 night 才加 night 标签"那条 RAG 规则也匹配不到 → 模型默认画白天。
 *
 * 修法：由调用方传入**真实时刻**，推出时段并：①压制相反时段词 ②追加该时段光照锚点。
 *
 * 本测试钉住几条易写错的语义（都实测踩过）：
 *   · 白天档要压「夜里」的词、夜里档要压「白天」的词 —— **方向反了等于没压**；
 *   · 匹配必须把 `bright_sunlight` 与 `bright sunlight` 视为等价；
 *   · 转义顺序（先 escape 再插字符类），否则正则变成字面量 `\[ _\]`；
 *   · `test()` 不能用带 g 的正则（lastIndex 会推进，第二次匹配失败）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = process.env.DB_PATH || ':memory:';
globalThis.fetch = async url => { throw new Error(`timeOfDay test forbids network: ${url}`); };

const { timeOfDayAnchor, composeImagePrompt } = await import('../src/services/imagePromptPreparer.js');

test('★ 凌晨/深夜必须压制白天词，并补夜间锚点（用户主诉场景）', () => {
  const r = composeImagePrompt('1girl, lying on bed, daytime, bright_sunlight, sleeping', [], { timeOfDay: '02:30' });
  assert.doesNotMatch(r.promptRefined, /daytime/i, '凌晨不该留 daytime');
  assert.doesNotMatch(r.promptRefined, /bright[ _]sunlight/i, '凌晨不该留 bright_sunlight');
  assert.match(r.promptRefined, /late night|dark room|dim/i, '凌晨应补夜间光照锚点');
});

test('★ 白天必须压制夜晚词（方向不能反 —— 写反等于没压）', () => {
  const r = composeImagePrompt('1girl, walking, night, moonlight, street', [], { timeOfDay: '12:00' });
  assert.doesNotMatch(r.promptRefined, /\bnight\b/i, '中午不该留 night');
  assert.doesNotMatch(r.promptRefined, /moonlight/i, '中午不该留 moonlight');
  assert.match(r.promptRefined, /midday|sunlight/i, '中午应补白天光照锚点');
});

test('★ 下划线与空格等价（bright_sunlight ≡ bright sunlight）', () => {
  const a = composeImagePrompt('1girl, bright_sunlight', [], { timeOfDay: '23:00' }).promptRefined;
  const b = composeImagePrompt('1girl, bright sunlight', [], { timeOfDay: '23:00' }).promptRefined;
  assert.doesNotMatch(a, /bright/i);
  assert.doesNotMatch(b, /bright/i);
});

test('清理后不得留悬空逗号', () => {
  const r = composeImagePrompt('1girl, daytime, bright_sunlight, sleeping', [], { timeOfDay: '02:30' });
  assert.doesNotMatch(r.promptRefined, /,\s*,/, '不能有连续逗号');
  assert.doesNotMatch(r.promptRefined, /^\s*,|,\s*$/, '不能以逗号开头/结尾');
});

test('★ 不传 timeOfDay 时行为与改动前完全一致（红线：默认可不改变行为）', () => {
  const prompt = '1girl, lying on bed, daytime, sleeping';
  const r = composeImagePrompt(prompt, [], {});
  assert.equal(r.timeOfDay, null, '未传时 timeOfDay 应为 null');
  assert.match(r.promptRefined, /daytime/, '不传时不得清理任何时段词');
});

test('时段分档覆盖 24 小时且不重叠地给出锚点', () => {
  for (let h = 0; h < 24; h++) {
    const a = timeOfDayAnchor(`${String(h).padStart(2, '0')}:30`);
    assert.ok(a, `${h} 点应能判定时段`);
    assert.ok(a.key && a.en, `${h} 点应给出 key 与英文锚点`);
    // 白天档不得压白天词，夜间档不得压夜间词（防方向写反）
    const isNight = ['evening', 'night', 'late_night'].includes(a.key);
    if (isNight) assert.ok(a.suppress.includes('daytime'), `${a.label} 应压 daytime`);
    else assert.ok(a.suppress.includes('night'), `${a.label} 应压 night`);
  }
});

test('非法/缺省时刻安全返回（不抛错）', () => {
  assert.doesNotThrow(() => timeOfDayAnchor('乱写'));
  assert.equal(timeOfDayAnchor('乱写'), null, '无法解析应返回 null');
  assert.doesNotThrow(() => composeImagePrompt('1girl', [], { timeOfDay: '乱写' }));
  // 缺省 = 用当前时间，不应为 null
  assert.ok(timeOfDayAnchor());
});

test('锚点英文不含逗号（否则会被下游按逗号拆碎）', () => {
  for (let h = 0; h < 24; h++) {
    const a = timeOfDayAnchor(`${String(h).padStart(2, '0')}:00`);
    if (a) assert.doesNotMatch(a.en, /,/, `锚点含逗号会被拆碎：${a.en}`);
  }
});