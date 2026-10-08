/**
 * 场景服装脚部口径 —— 回归测试
 *
 * 用户反馈（2026-10-06）：居家服被生成成"没有鞋子"，但现实中居家是穿拖鞋的。
 *
 * 这是**两条相反**的脚部规则，极易被写反或被后续改动抹掉：
 *   · 居家(home) = 必须室内拖鞋（indoor slippers）；
 *   · 睡衣(sleep) = 必须赤脚（barefoot），且**画面里不能出现任何鞋袜**。
 *
 * 存量实测：15 套居家里有 2 套写成赤脚、3 套自相矛盾（"barefoot + 拖鞋"、"袜子 + barefoot"）。
 * 根因是提示词此前只约束睡衣、对居家完全没规定。提示词已补，但按项目红线
 * 「改提示词不够，模型有惯性，必须在出口层兜底」——所以 `enforceSceneFootwear`
 * 是最后一道防线，本测试钉死它的行为。
 *
 * 纯函数测试：不碰库、不调 LLM。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// outfitScene.js 顶层会 import db，但 enforceSceneFootwear 是纯函数且不触发库访问；
// 这里用内存路径兜底，避免意外写库。
process.env.DB_PATH = process.env.DB_PATH || ':memory:';

const { enforceSceneFootwear, OUTFIT_SCENES } = await import('../src/services/outfitScene.js');

const HOME = d => enforceSceneFootwear('home', d);
const SLEEP = d => enforceSceneFootwear('sleep', d);

test('★ 居家必须出现室内拖鞋（原本无鞋的描述要补上）', () => {
  const out = HOME('oversized hoodie, loose light grey lounge shorts');
  assert.match(out, /indoor slippers/i, '没有任何鞋时应补 indoor slippers');
});

test('★ 居家写成赤脚 → 必须改成拖鞋（用户报的就是这个）', () => {
  for (const raw of [
    'loose knit sweater, black lounge shorts, bare feet',
    'oversized hoodie, loose shorts, and bare feet',
    'loose robe, barefoot',
    'a simple top with matching bottoms, barefoot, white slippers with gold trim',
  ]) {
    const out = HOME(raw);
    assert.match(out, /slippers?|拖鞋/i, `应含拖鞋：${raw} → ${out}`);
    assert.doesNotMatch(out, /barefoot|bare\s+feet|bare\s+foot/i, `不应留赤脚：${raw} → ${out}`);
  }
});

test('★ 居家写成袜子 → 也换成拖鞋（袜子不是室内鞋）', () => {
  const out = HOME('loose cardigan, striped ankle socks');
  assert.match(out, /slippers?/i);
  assert.doesNotMatch(out, /socks?/i, `袜子应被替换：${out}`);
});

test('居家已有拖鞋时应沿用原文措辞，不粗暴模板化', () => {
  const out = HOME('loose lavender knit long cardigan, fuzzy purple slippers');
  assert.match(out, /fuzzy purple slippers/i, '原文的拖鞋描述应保留');
});

test('居家清理后不得出现悬空片段（裸逗号/孤立介词）', () => {
  const out = HOME('silk robe, covered in fuzzy slippers and ankle socks, warm');
  assert.doesNotMatch(out, /,\s*,/, '不能有连续逗号');
  assert.doesNotMatch(out, /^\s*,|,\s*$/, '不能以逗号开头或结尾');
  assert.doesNotMatch(out, /\bcovered in\b\s*(,|$)/i, '不能留悬空的 "covered in"');
});

test('★ 睡衣必须赤脚，且画面里不出现任何鞋袜', () => {
  const out = SLEEP('a simple sleepwear set, camisole and shorts');
  assert.match(out, /barefoot/i, '睡衣应声明赤脚');

  const noShoe = SLEEP('silk pajama top and shorts, covered in fuzzy slippers and ankle socks');
  assert.doesNotMatch(noShoe, /slipper|sock|shoe|boot/i, `睡衣不应有任何鞋袜：${noShoe}`);
  assert.match(noShoe, /barefoot/i);
});

test('睡衣不得写成拖鞋（与居家正好相反）', () => {
  const out = SLEEP('loose tee, shorts, indoor slippers');
  assert.doesNotMatch(out, /slippers?/i, '睡衣里不能留拖鞋');
  assert.match(out, /barefoot/i);
});

test('两条规则必须方向相反 —— 这条是防"改着改着写反了"', () => {
  const homeRaw = 'loose loungewear, barefoot';
  const sleepRaw = 'loose sleepwear, indoor slippers';
  assert.match(HOME(homeRaw), /slippers?/i, '居家 → 加拖鞋');
  assert.match(SLEEP(sleepRaw), /barefoot/i, '睡衣 → 加赤脚');
  assert.doesNotMatch(HOME(homeRaw), /barefoot/i);
  assert.doesNotMatch(SLEEP(sleepRaw), /slippers?/i);
});

test('其他场景（工装/私服/全身）不被脚部规则改动', () => {
  const work = 'neat button shirt, slacks, black leather shoes';
  assert.equal(enforceSceneFootwear('work', work), work, '工装原样返回');
  assert.equal(enforceSceneFootwear('casual', 'denim jacket, jeans, sneakers'),
    'denim jacket, jeans, sneakers', '私服原样返回');
  const nude = 'completely nude, wearing no clothing at all, bare skin visible';
  assert.equal(enforceSceneFootwear('nude', nude), nude, '全身原样返回');
});

test('空描述安全返回（不得抛错、不得凭空造出拖鞋）', () => {
  assert.equal(enforceSceneFootwear('home', ''), '');
  assert.equal(enforceSceneFootwear('sleep', null), null);
});

test('场景枚举里 home/sleep 的 desc 必须写明相反的脚部口径', () => {
  const home = OUTFIT_SCENES.find(s => s.key === 'home');
  const sleep = OUTFIT_SCENES.find(s => s.key === 'sleep');
  assert.ok(home && sleep, 'home/sleep 场景必须存在');
  assert.match(home.desc, /拖鞋|slippers/i, 'home.desc 必须写明穿拖鞋');
  assert.match(sleep.desc, /赤脚|barefoot/i, 'sleep.desc 必须写明赤脚');
  // sleep 明确排斥鞋类（含"床边摆着的拖鞋"这种陷阱）
  assert.match(sleep.desc, /不穿鞋袜|不要出现任何鞋类|slippers/i, 'sleep.desc 必须写明不出现鞋');
});