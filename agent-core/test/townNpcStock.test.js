import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import { migrateTownServiceOfferSchema } from '../src/db/townServiceOfferSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import {
  createTownNpcStockService, parseStockPayload, splitStockPlan, pickStockCount,
  clampStockPrice, clampFavorDelta, buildStockTaskPrompt, buildStockPersonaBlock, STOCK_ROLL_MS,
  CHEST_GOODS, getNpcFavor, stockNeedsRoll,
} from '../src/services/town/townNpcStockService.js';

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY, town_enabled INTEGER);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER DEFAULT 1,
      display_name TEXT DEFAULT '', job TEXT DEFAULT '', brief TEXT DEFAULT '', persona TEXT DEFAULT '',
      appearance_desc TEXT DEFAULT '', town_enabled INTEGER DEFAULT 1);
    INSERT INTO town_npcs(id, display_name, job, brief) VALUES
      (1, '奶牛娘', '牧场帮工', '每天挤奶的兽人姑娘'),
      (2, '铁匠', '铁匠', '沉默寡言的打铁匠');
    CREATE TABLE IF NOT EXISTS backpack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effect_key TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common', image_url TEXT, status TEXT NOT NULL DEFAULT 'generating',
      payload_json TEXT, collected_at DATETIME, acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS item_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES backpack_items(id) ON DELETE CASCADE,
      character_id INTEGER, effect_key TEXT NOT NULL, payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME
    );`);
  migrateTownSchema(db);
  migrateTownActionSchema(db);
  migrateTownEconomySchema(db);
  migrateTownItemTemplateSchema(db);
  migrateTownServiceOfferSchema(db);
  const registry = createTownActorRegistry(db);
  registry.synchronize();
  let time = 1_000_000;
  const clock = { now: () => time };
  const world = registry.getWorldState();
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const economy = createEconomyService({ db, clock, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  const service = createTownNpcStockService({ db, clock, registry, economy });
  let counter = 0;
  const cmd = fields => ({ ...scope, idempotencyKey: `buy-${++counter}`, ...fields });
  const playerAccountId = economy.ensureAccount({ ...scope, ownerKey: `actor:${registry.resolveAgentKey('me').actorId}`,
    actorId: registry.resolveAgentKey('me').actorId, accountType: 'actor' }).accountId;
  const seedPlayer = amount => economy.seed({ ...scope, accountId: playerAccountId, amount,
    idempotencyKey: `seed-${++counter}`, sourceKey: `seed-${counter}`, reasonCode: 'TEST' });
  const playerBalance = () => economy.getAccount({ ...scope, accountId: playerAccountId }).balance;
  return { db, registry, clock, economy, service, cmd, scope, seedPlayer, playerBalance,
    setTime: value => { time = value; }, get time() { return time; } };
}

function insertStock(f, { npcId = 1, title = '当天没卖完的牛奶', price = 30, favor = 3, effectKey = 'favor_candy' } = {}) {
  const now = f.time;
  const info = f.db.prepare(`INSERT INTO town_npc_stock
    (world_id, npc_id, effect_key, price, custom_name, custom_desc, image_prompt, image_status, favor_delta, source, rolled_at, next_roll_at)
    VALUES (?, ?, ?, ?, ?, '温热的、还挂着奶沫', 'milk icon', 'pending', ?, 'llm', ?, ?)`)
    .run(f.scope.worldId, npcId, effectKey, price, title, favor, now, now + STOCK_ROLL_MS);
  return Number(info.lastInsertRowid);
}

test('stock count stays within 1~5 and keeps the shelf mostly resident-made', () => {
  for (let i = 0; i < 60; i++) {
    const count = pickStockCount(`seed-${i}`);
    assert.ok(count >= 1 && count <= 5, `count ${count} out of range`);
    const plan = splitStockPlan(count, `seed-${i}`);
    assert.equal(plan.chest + plan.free, count);
    // 宝箱取材最多 1 件（满 4 件才放 1 件），其余全部按人格卡自由创作。
    assert.equal(plan.chest, count >= 4 ? 1 : 0);
    assert.ok(plan.free >= plan.chest, `free ${plan.free} should dominate chest ${plan.chest}`);
  }
});

test('stock payload parsing clamps price/favor and falls back on unknown effect keys', () => {
  const plan = { count: 3, chest: 2, free: 1 };
  const parsed = parseStockPayload(JSON.stringify({ goods: [
    { title: '自产牛奶', description: '温热的牛奶', effectKey: 'favor_candy', price: 9999, favor: 99, imagePrompt: 'milk icon' },
    { title: '奇怪的护符', description: '铁匠打铁剩下的边角料', effectKey: 'not_a_real_key', price: -5, favor: -3, imagePrompt: 'charm icon' },
    { title: '野花束', description: '当天没卖完的花', effectKey: 'mood_fix', price: 30, favor: 4, imagePrompt: 'flowers icon' },
  ] }), plan);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].price, 120);
  assert.equal(parsed[0].favor, 6);
  assert.equal(parsed[1].effectKey, 'favor_candy');
  assert.equal(parsed[1].price, 10);
  assert.equal(parsed[1].favor, 1);
  assert.equal(clampStockPrice('abc'), 65);
  assert.equal(clampFavorDelta('abc'), 4);
});

test('stock task prompt carries the persona card, chest pool and target count', () => {
  const npc = { display_name: '奶牛娘', job: '牧场帮工', brief: '每天挤奶的兽人姑娘', persona: '说话软软的，一提到奶牛就停不下来。' };
  const personaBlock = buildStockPersonaBlock(npc);
  const task = buildStockTaskPrompt(npc, { count: 4, chest: 2, free: 2 });
  assert.match(personaBlock, /奶牛娘/);
  assert.match(personaBlock, /牧场帮工/);
  assert.match(personaBlock, /每天挤奶的兽人姑娘/);
  assert.match(personaBlock, /说话软软的/);
  assert.match(task, /恰好 4 项/);
  assert.match(task, /其中 2 件/);
  for (const good of CHEST_GOODS) assert.match(task, new RegExp(good.effectKey));
  // 宝箱配额为 0 时不出现「其中 0 件」，而是明确要求整架都长在居民身上。
  const noChest = buildStockTaskPrompt(npc, { count: 3, chest: 0, free: 3 });
  assert.match(noChest, /全部从这位居民身上长出来/);
  assert.doesNotMatch(noChest, /其中 0 件/);
});

test('buying a good deducts coins and drops it in the backpack as a gift', t => {
  const f = fixture(t);
  f.seedPlayer(100);
  const stockId = insertStock(f, { price: 30, favor: 3 });
  const result = f.service.buyStock(1, stockId, f.cmd({}));
  assert.equal(result.money.delta, -30);
  assert.equal(f.playerBalance(), 70);
  // 货品是送给角色的礼物：不再写 NPC 好感（town_npc_favor 表与 favor_delta 列保留，以后另有用途）。
  assert.equal(result.favor, null);
  assert.equal(getNpcFavor(f.db, f.scope.worldId, 1), 0);
  assert.ok(result.item?.id);
  const row = f.db.prepare(`SELECT * FROM backpack_items WHERE id=?`).get(result.item.id);
  assert.equal(row.owner_key, 'me');
  assert.equal(row.source_type, 'trade');
  assert.equal(row.status, 'ready');
  assert.equal(row.name, '当天没卖完的牛奶');
  const stock = f.db.prepare('SELECT sold_at FROM town_npc_stock WHERE id=?').get(stockId);
  assert.ok(stock.sold_at != null);
});

test('buying the same stock twice is idempotent and never double-charges', t => {
  const f = fixture(t);
  f.seedPlayer(100);
  const stockId = insertStock(f, { price: 30, favor: 3 });
  f.service.buyStock(1, stockId, f.cmd({}));
  const replay = f.service.buyStock(1, stockId, f.cmd({}));
  assert.equal(f.playerBalance(), 70);
  assert.equal(getNpcFavor(f.db, f.scope.worldId, 1), 0);
  assert.equal(replay.favor, null);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM backpack_items WHERE owner_key=\'me\'').get().n, 1);
});

test('buying without enough coins rolls back stock, favor and backpack', t => {
  const f = fixture(t);
  f.seedPlayer(10);
  const stockId = insertStock(f, { price: 30, favor: 3 });
  assert.throws(() => f.service.buyStock(1, stockId, f.cmd({})), err => err.code === 'INSUFFICIENT_FUNDS');
  assert.equal(f.playerBalance(), 10);
  assert.equal(getNpcFavor(f.db, f.scope.worldId, 1), 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM backpack_items').get().n, 0);
  assert.equal(f.db.prepare('SELECT sold_at FROM town_npc_stock WHERE id=?').get(stockId).sold_at, null);
});

test('stock shelf is considered stale after seven days or when sold out', t => {
  const f = fixture(t);
  const stockId = insertStock(f, {});
  assert.equal(stockNeedsRoll(f.db, f.scope.worldId, 1, f.time), false);
  f.db.prepare('UPDATE town_npc_stock SET sold_at=? WHERE id=?').run(f.time, stockId);
  assert.equal(stockNeedsRoll(f.db, f.scope.worldId, 1, f.time), true, 'sold out should trigger a reroll');
  f.db.prepare('UPDATE town_npc_stock SET sold_at=NULL, next_roll_at=? WHERE id=?').run(f.time + STOCK_ROLL_MS + 1, stockId);
  assert.equal(stockNeedsRoll(f.db, f.scope.worldId, 1, f.time), false);
  assert.equal(stockNeedsRoll(f.db, f.scope.worldId, 1, f.time + STOCK_ROLL_MS + 2), true);
});
