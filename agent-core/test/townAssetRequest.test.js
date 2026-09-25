import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`asset request fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { buildAssetRequestSnapshot, buildCharacterRequestDesc } = await import('../src/services/town/townAssetRequest.js');

config.dbPath = ':memory:';

const BASE_PROMPT = [
  '琪亚娜是来自《崩坏3》的天命卡斯兰娜家族名义上的大小姐，实际上是被制造的克隆体。',
  '她是个不折不扣的笨蛋，喜欢用「本小姐」自称。',
  '',
  '## 你的外观',
  '- 银白色长发扎成双麻花辫，头顶有标志性的侧呆毛',
  '- 蓝色眼睛，日常穿着便服',
].join('\n');
const SHORT_PROMPT = '琪亚娜(kiana)，天命卡斯兰娜家族的大小姐，性格直率、自称本小姐。';
const BAKER_PERSONA = '说话温吞的面包师。\n\n## 你的外观\n- 亚麻色短发，围裙上总有面粉';

function seed (t) {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('m', 10, 10)`).run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt, short_prompt) VALUES ('kiana', '琪亚娜', ?, ?)`)
    .run(BASE_PROMPT, SHORT_PROMPT);
  const characterId = db.prepare('SELECT max(id) id FROM characters').get().id;
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, persona, character_id) VALUES (1, '琪亚娜', '学生', ?, ?)`)
    .run(BASE_PROMPT, characterId);
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, persona) VALUES (1, '面包师', '面包师', ?)`)
    .run(BAKER_PERSONA);
  const plainNpcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  return { db, characterId, npcId, plainNpcId };
}

const characterSource = (characterId, mode = 'portrait') => ({
  version: 1, sourceKind: 'character', sourceId: characterId, characterId, mode, signature: 'a'.repeat(64),
});
const npcSource = (npcId, characterId, mode = 'portrait') => ({
  version: 1, sourceKind: 'npc', sourceId: npcId, characterId, mode, signature: 'b'.repeat(64),
});

test('character 来源：重取 short_prompt + 外观段，而不是素材里的整卡', async t => {
  const { characterId } = seed(t);
  const desc = (await buildAssetRequestSnapshot({
    meta: { desc: BASE_PROMPT, appearanceSource: characterSource(characterId) },
  })).desc;
  assert.match(desc, /琪亚娜\(kiana\)，天命卡斯兰娜家族的大小姐/);
  assert.match(desc, /银白色长发扎成双麻花辫/);
  assert.ok(!desc.includes('不折不扣的笨蛋'), '整卡里的非外观段落不该进入需求');
  assert.ok(!desc.includes('##'), '外观段标题行应被清掉');
  assert.ok(desc.length < BASE_PROMPT.length);
});

test('npc 来源且关联酒馆角色：优先角色卡的 short_prompt + 外观段', async t => {
  const { npcId, characterId } = seed(t);
  const desc = (await buildAssetRequestSnapshot({
    meta: { desc: '过期的整卡快照', appearanceSource: npcSource(npcId, characterId) },
  })).desc;
  assert.match(desc, /天命卡斯兰娜家族的大小姐/);
  assert.match(desc, /银白色长发/);
  assert.ok(!desc.includes('过期的整卡快照'));
});

test('npc 来源未关联角色卡：退回居民人格卡的外观段', async t => {
  const { plainNpcId } = seed(t);
  const desc = (await buildAssetRequestSnapshot({
    meta: { desc: '过期的整卡快照', appearanceSource: npcSource(plainNpcId, null) },
  })).desc;
  assert.match(desc, /亚麻色短发/);
  assert.ok(!desc.includes('说话温吞的面包师'), '人格卡正文不该混进外观需求');
  assert.ok(!desc.includes('##'), '外观段标题行应被清掉');
});

test('非角色素材：沿用 meta.desc，并透传视角 / 占格 / 风格', async t => {
  seed(t);
  const snapshot = await buildAssetRequestSnapshot({
    meta: { desc: '一间靠河的面包房', styleTags: 'cozy pixel', direction: 'up', footprint: { w: 2, h: 1 }, special: true },
  });
  assert.deepEqual(snapshot, {
    desc: '一间靠河的面包房', styleTags: 'cozy pixel', direction: 'up', footprint: { w: 2, h: 1 }, special: true,
  });
});

test('外观来源缺失 / 失效时回落 meta.desc', async t => {
  const { characterId } = seed(t);
  assert.equal(await buildCharacterRequestDesc({ meta: {} }), '');
  assert.equal(await buildCharacterRequestDesc({ meta: { appearanceSource: { version: 2, sourceKind: 'character', sourceId: characterId } } }), '');
  assert.equal(await buildCharacterRequestDesc({ meta: { appearanceSource: { version: 1, sourceKind: 'character', sourceId: 999999 } } }), '');
  assert.equal(await buildCharacterRequestDesc({ meta: { appearanceSource: { version: 1, sourceKind: 'npc', sourceId: 999999 } } }), '');
  assert.equal((await buildAssetRequestSnapshot({
    meta: { desc: '兜底描述', appearanceSource: { version: 1, sourceKind: 'character', sourceId: 999999 } },
  })).desc, '兜底描述');
});

test('老素材没落 appearanceSource：按 meta.characterId / key 前缀推断来源', async t => {
  const { characterId, npcId } = seed(t);
  // 复用关联居民立绘登记进来的角色立绘：meta 里只有 characterId
  const byMeta = (await buildAssetRequestSnapshot({
    kind: 'portrait', key: 'char_5_portrait', meta: { desc: '过期的短人格', characterId },
  })).desc;
  assert.match(byMeta, /银白色长发/);
  assert.ok(!byMeta.includes('过期的短人格'));

  // 只有 key 前缀可推断
  const byKey = (await buildAssetRequestSnapshot({
    kind: 'portrait', key: 'char_' + characterId + '_portrait', meta: { desc: '过期的短人格' },
  })).desc;
  assert.match(byKey, /银白色长发/);

  // 小人素材：key 前缀 npc_<id>_down，经 npc 关联到角色卡
  const byNpcKey = (await buildAssetRequestSnapshot({
    kind: 'npc', key: 'npc_' + npcId + '_down', meta: { desc: '过期的短人格' },
  })).desc;
  assert.match(byNpcKey, /银白色长发/);
});



test('玩家素材：实时重取用户配置里的「我」的外观，而不是生成时的占位 desc', async t => {
  seed(t);
  const saved = { ...config.user };
  Object.assign(config.user, { nickname: '小北', gender: '女', appearance: '银色短发，红色连帽衫，黑色短裤', persona: '爱冒险的旅行者' });
  t.after(() => Object.assign(config.user, saved));

  // 立绘：key player_portrait，生成时 meta.desc 只是占位
  const snapshot = await buildAssetRequestSnapshot({
    kind: 'portrait', key: 'player_portrait', name: '玩家 立绘',
    meta: { desc: 'the player character', styleTags: 'cozy pixel town' },
  });
  assert.match(snapshot.desc, /银色短发/);
  assert.match(snapshot.desc, /红色连帽衫/);
  assert.match(snapshot.desc, /爱冒险的旅行者/);
  assert.ok(!snapshot.desc.includes('the player character'), '占位 desc 不该留在需求里');
  assert.equal(snapshot.styleTags, 'cozy pixel town', '风格仍走 meta 透传');

  // 正/背小人（kind player，key player_down）同样口径
  const sprite = (await buildAssetRequestSnapshot({
    kind: 'player', key: 'player_down', meta: { desc: 'the player character', direction: 'down' },
  })).desc;
  assert.match(sprite, /银色短发/);
  assert.ok(!sprite.includes('the player character'));
});
test('用户配置里没有形象信息时，玩家素材回落 meta.desc', async t => {
  seed(t);
  const saved = { ...config.user };
  Object.assign(config.user, { nickname: '用户', gender: '', appearance: '', persona: '' });
  t.after(() => Object.assign(config.user, saved));
  const desc = (await buildAssetRequestSnapshot({
    kind: 'portrait', key: 'player_portrait', meta: { desc: 'the player character' },
  })).desc;
  assert.equal(desc, 'the player character');
});
