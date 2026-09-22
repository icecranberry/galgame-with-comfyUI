import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
// 商品图标是异步补画的：端点指到打不通的本地端口，失败即降级，不阻塞断言
config.comfyui = { ...config.comfyui, url: 'http://127.0.0.1:9' };
const { getDb } = await import('../src/db/index.js');
const { seedTownNpcOfferings } = await import('../src/services/town/townNpcOfferingSeed.js');
config.dbPath = ':memory:';
const db = getDb();

// 按 label 区分三种 LLM 产物：服务项目 / 打工项目 / 货架
function mockLlm() {
  return { chatSync: async (messages, options = {}) => {
    const label = String(options.label || '');
    if (label.includes('服务')) return JSON.stringify({ offers: [{ title: '庭院除草', description: '把后院的杂草清干净', price: 60 }] });
    if (label.includes('打工')) return JSON.stringify({ offers: [{ title: '帮搬木材', description: '把木料搬到后院码好', price: 40 }] });
    if (label.includes('货架')) return JSON.stringify({ goods: [{ title: '当天鲜花', description: '当天没卖完的花束，还挂着水珠', effectKey: 'mood_fix', price: 30, favor: 3, imagePrompt: 'game item icon, flowers' }] });
    throw new Error('unexpected label: ' + label);
  } };
}

function insertNpc(id, name, job, capabilities) {
  db.prepare('INSERT INTO town_npcs (id, map_id, display_name, job, brief, persona, capabilities_json, town_enabled) VALUES(?, 1, ?, ?, ?, ?, ?, 1)')
    .run(id, name, job, name + '的一句话', name + '的人格卡', capabilities == null ? null : JSON.stringify(capabilities));
}

function setup() {
  db.prepare('DELETE FROM town_npcs').run();
  db.prepare('DELETE FROM town_npc_offers').run();
  db.prepare('DELETE FROM town_npc_stock').run();
  insertNpc(1, '花店姑娘', '花艺师', ['service']);
  insertNpc(2, '矿工', '矿工', ['service', 'work']);
  insertNpc(3, '杂货掌柜', '杂货摊主', ['trade']);
  insertNpc(4, '无关居民', '闲人', []);
  insertNpc(5, '老档案居民', '居民', null);
}

function offersOf(npcId, kind) {
  return db.prepare('SELECT * FROM town_npc_offers WHERE npc_id = ? AND kind = ?').all(npcId, kind).length;
}
function stockOf(npcId) {
  return db.prepare('SELECT COUNT(*) AS n FROM town_npc_stock WHERE npc_id = ?').get(npcId).n;
}test('开镇后台上料：有权限的居民才生成对应内容', async () => {
  setup();
  const summary = await seedTownNpcOfferings({ mapId: 1, llm: mockLlm() });
  assert.equal(summary.offers, 4, '共生成 4 组 offer');
  assert.equal(summary.stock, 1, '只有交易权限的居民上货');
  assert.equal(summary.failed, 0);
  assert.equal(offersOf(1, 'service'), 1);
  assert.equal(offersOf(1, 'work'), 0, '普通服务居民没有打工入口');
  assert.equal(offersOf(2, 'service'), 1);
  assert.equal(offersOf(2, 'work'), 1, '有打工权限的居民两项都生成');
  assert.equal(offersOf(3, 'service'), 0, '纯交易居民没有服务项目');
  assert.equal(offersOf(3, 'work'), 0);
  assert.equal(offersOf(4, 'service'), 0, '无权限居民什么都不生成');
  assert.equal(offersOf(5, 'service'), 1, '老档案没有权限时按默认 service 生成');
  assert.equal(stockOf(3), 1, '交易居民上架商品');
  assert.equal(stockOf(1), 0);
  assert.equal(stockOf(2), 0);
  assert.equal(stockOf(4), 0);
});

test('重复确认开镇：已有内容不重复生成', async () => {
  setup();
  await seedTownNpcOfferings({ mapId: 1, llm: mockLlm() });
  const before = db.prepare('SELECT COUNT(*) AS n FROM town_npc_offers').get().n;
  const second = await seedTownNpcOfferings({ mapId: 1, llm: mockLlm() });
  assert.equal(second.offers, 0, '不会再生成新项目');
  assert.equal(second.skipped, 4, '已有的四组项目被跳过');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_npc_offers').get().n, before, '项目数量不变');
});

test('只处理指定地图的居民', async () => {
  setup();
  insertNpc(6, '别镇居民', '铁匠', ['service']);
  db.prepare('UPDATE town_npcs SET map_id = 2 WHERE id = 6').run();
  await seedTownNpcOfferings({ mapId: 1, llm: mockLlm() });
  assert.equal(offersOf(6, 'service'), 0, '别的镇居民不被这次开镇上料');
});