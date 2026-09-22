import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb } = await import('../src/db/index.js');
const offers = await import('../src/services/town/townNpcOfferService.js');
config.dbPath = ':memory:';
const sharedDb = getDb();

function setup() {
  const db = sharedDb;
  const insert = (name, job, capabilities, persona = '') => Number(db.prepare(`INSERT INTO town_npcs
    (map_id, display_name, job, brief, persona, capabilities_json, town_enabled) VALUES(1,?,?,?,?,?,1)`)
    .run(name, job, `${name}的一句话`, persona, JSON.stringify(capabilities)).lastInsertRowid);
  return {
    db,
    serviceNpc: insert('花店姑娘', '花艺师', ['service'], '温柔，喜欢把当天没卖完的花送人。'),
    workNpc: insert('矿工', '矿工', ['service', 'work']),
    traderNpc: insert('杂货掌柜', '杂货摊主', ['trade']),
  };
}

test('offer messages use the requested system1/system2/system3/user layout', () => {
  const npc = { display_name: '花店姑娘', job: '花艺师', brief: '一句话', persona: '温柔，喜欢把当天没卖完的花送人。' };
  const messages = offers.buildNpcOfferMessages('service', npc);
  assert.deepEqual(messages.map(m => m.role), ['system', 'system', 'system', 'user']);
  assert.match(messages[2].content, /花店姑娘/);
  assert.match(messages[2].content, /花艺师/);
  assert.match(messages[2].content, /温柔/);
  assert.match(messages[3].content, /服务项目/);
  const workMessages = offers.buildNpcOfferMessages('work', npc);
  assert.match(workMessages[3].content, /打工项目/);
  assert.match(workMessages[3].content, /工资/);
});

test('service and work prompts spell out opposite actor directions', () => {
  const npc = { display_name: '花店姑娘', job: '花艺师', brief: '一句话', persona: '温柔。' };
  const service = offers.buildNpcOfferTaskPrompt('service', npc);
  const work = offers.buildNpcOfferTaskPrompt('work', npc);
  // 服务：居民动手，玩家付钱；示例里居民是主语。
  assert.match(service, /方向铁律/);
  assert.match(service, /动手的人必须是「花店姑娘」/);
  assert.match(service, /扛着镰刀来你家后院/);
  assert.doesNotMatch(service, /把铁叉塞给你/);
  // 打工：玩家动手，居民付钱；示例里玩家是主语。
  assert.match(work, /动手的人必须是玩家/);
  assert.match(work, /把铁叉塞给你/);
  assert.doesNotMatch(work, /扛着镰刀来你家后院/);
});

test('offer payload parsing trims titles and clamps to three items', () => {
  const parsed = offers.parseNpcOfferPayload(JSON.stringify({ offers: [
    { title: ' 庭院除草 ', description: 'desc', price: 60 },
    { title: '', description: 'x', price: 1 },
    { title: 'A', description: 'a', price: 1 },
    { title: 'B', description: 'b', price: 1 },
    { title: 'C', description: 'c', price: 1 },
  ] }));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].title, '庭院除草');
  assert.throws(() => offers.parseNpcOfferPayload('{"offers":[]}'), err => err.code === 'OFFER_EMPTY');
});

test('offer price clamping respects the per-kind range', () => {
  assert.equal(offers.clampOfferPrice('service', 9999), 200);
  assert.equal(offers.clampOfferPrice('service', -5), 20);
  assert.equal(offers.clampOfferPrice('work', 9999), 150);
  assert.equal(offers.clampOfferPrice('work', 0), 15);
  assert.equal(offers.normalizeOfferKind('WORK'), 'work');
  assert.throws(() => offers.normalizeOfferKind('quest'), err => err.code === 'INVALID_OFFER_KIND');
});

test('overview lists only residents with service/work permissions and counts offers', async () => {
  const f = setup();
  const world = f.db.prepare('SELECT world_id FROM town_world_state WHERE singleton=1').get().world_id;
  const llm = { chatSync: async () => JSON.stringify({ offers: [
    { title: '庭院除草', description: '把后院的杂草清干净', price: 60 },
    { title: '修剪花枝', description: '把开败的花枝剪掉', price: 30 },
  ] }) };
  await offers.generateNpcOffers({ worldId: world, npcId: f.workNpc, kind: 'work', llm });
  await offers.generateNpcOffers({ worldId: world, npcId: f.workNpc, kind: 'service', llm });

  const overview = offers.listOfferOverview({ worldId: world });
  assert.deepEqual(overview.map(item => item.npcId).sort(), [f.serviceNpc, f.workNpc].sort());
  const work = overview.find(item => item.npcId === f.workNpc);
  assert.equal(work.mapId, 1);
  assert.equal(work.workCount, 2);
  assert.equal(work.serviceCount, 2);
  assert.deepEqual(work.capabilities, ['service', 'work']);

  const stored = offers.listNpcOffers({ worldId: world, npcId: f.workNpc, kind: 'work' });
  assert.equal(stored.length, 2);
  assert.equal(stored[0].price, 60);
  assert.equal(stored[0].kind, 'work');

  const rerolled = await offers.rerollNpcOffer({ worldId: world, npcId: f.workNpc, offerId: stored[0].id, llm });
  assert.equal(rerolled.id, stored[0].id);
  assert.equal(rerolled.title, '庭院除草');
});
