import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import { migrateTownItemSchema } from '../src/db/townItemSchema.js';
import { migrateTownExperienceSchema } from '../src/db/townExperienceSchema.js';
import { migrateTownNpcFunctionsSchema } from '../src/db/townNpcFunctionsSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createItemTemplateService } from '../src/services/town/itemTemplateService.js';
import { createTownNpcFunctionService } from '../src/services/town/townNpcFunctionService.js';
import { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } from '../src/services/town/townExperienceService.js';

const EFFECT_REGISTRY = Object.freeze({ mood_fix: { kind: 'mood' }, energy: { kind: 'buff' },
  bob_cut: { kind: 'hairstyle' }, tipsy: { kind: 'buff' }, yukata: { kind: 'outfit' } });

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER,
      display_name TEXT DEFAULT '', job TEXT DEFAULT '', town_enabled INTEGER DEFAULT 1);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY, town_enabled INTEGER);
    INSERT INTO town_npcs(id, display_name, job) VALUES
      (1, '杂货掌柜', '杂货摊主'), (2, '茶馆姑娘', '茶艺师'), (3, '游荡的书生', '');
    CREATE TABLE IF NOT EXISTS backpack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effect_key TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common', image_url TEXT, status TEXT NOT NULL DEFAULT 'generating',
      payload_json TEXT, collected_at DATETIME, acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS item_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES backpack_items(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE, effect_key TEXT NOT NULL, payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME
    );`);
  migrateTownSchema(db); migrateTownActionSchema(db); migrateTownEconomySchema(db);
  migrateTownItemTemplateSchema(db); migrateTownItemSchema(db); migrateTownExperienceSchema(db);
  migrateTownNpcFunctionsSchema(db);
  const registry = createTownActorRegistry(db);
  registry.synchronize();
  let time = 1_000_000;
  const clock = { now: () => time };
  const world = registry.getWorldState();
  let scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const economy = createEconomyService({ db, clock, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  const itemTemplates = createItemTemplateService({ db, clock, getWorldEpoch: registry.getWorldEpoch,
    getActor: registry.getActor, effectRegistry: EFFECT_REGISTRY, economy });
  itemTemplates.ensureDefaultTemplates({ ...scope });
  const service = createTownNpcFunctionService({ db, clock, registry, economy, itemTemplates,
    consumers: [TOWN_EXPERIENCE_CONSUMER] });
  let counter = 0;
  const cmd = fields => ({ ...scope, idempotencyKey: `request-${++counter}`, ...fields });
  const playerAccountId = economy.ensureAccount({ ...scope, ownerKey: `actor:${registry.resolveAgentKey('me').actorId}`,
    actorId: registry.resolveAgentKey('me').actorId, accountType: 'actor' }).accountId;
  const seedPlayer = amount => economy.seed({ ...scope, accountId: playerAccountId, amount,
    idempotencyKey: `seed-${++counter}`, sourceKey: `seed-${counter}`, reasonCode: 'TEST' });
  const playerBalance = () => economy.getAccount({ ...scope, accountId: playerAccountId }).balance;
  return { db, registry, clock, economy, itemTemplates, service, cmd, seedPlayer, playerBalance,
    get scope() { return scope; }, setTime: value => { time = value; }, get time() { return time; } };
}

test('NPCs persist two nonexclusive permissions; functions follow capabilities', t => {
  const f = fixture(t);
  const trader = f.service.functionsOf(1, f.cmd({}));
  assert.ok(trader.functions.trader, '杂货摊主应是 trader');
  assert.deepEqual(trader.capabilities, ['trade']);
  assert.equal(trader.functions.gift_giver, undefined);
  const gift = f.service.functionsOf(2, f.cmd({}));
  assert.ok(gift.functions.gift_giver, '茶艺师应是 gift_giver');
  assert.ok(!gift.functions.trader);
  // 分配结果落库，第二次读取走同一份声明
  const stored = JSON.parse(f.db.prepare('SELECT functions_json FROM town_npcs WHERE id=1').get().functions_json);
  assert.deepEqual(stored.trader, trader.functions.trader);
  assert.deepEqual(f.service.functionsOf(1, f.cmd({})), trader);
});

test('gift_giver grants a reward item once per cooldown and writes an experience event', t => {
  const f = fixture(t);
  const first = f.service.receiveGift(2, f.cmd({}));
  assert.equal(first.templateId, 'town.mood_patch');
  const row = f.db.prepare(`SELECT id FROM backpack_items WHERE id=? AND owner_key='me' AND source_type='reward'`).get(first.itemId);
  assert.ok(row);
  assert.throws(() => f.service.receiveGift(2, f.cmd({})), err => err.code === 'GIFT_COOLDOWN');
  f.setTime(f.time + 24 * 3600000 + 1);
  const second = f.service.receiveGift(2, f.cmd({}));
  assert.ok(Number.isSafeInteger(second.itemId) && second.itemId !== first.itemId);
  // 事件进入经历管道
  const drained = createTownExperienceService({ db: f.db, clock: f.clock, registry: f.registry,
    writeMemory: null, memoryEnabled: () => false }).drain(f.scope);
  assert.ok(drained >= 1);
  const rows = f.db.prepare(`SELECT summary FROM town_experiences WHERE summary LIKE '%小心意%'`).all();
  assert.ok(rows.length >= 1);
});

test('non gift_giver refuses gifts', t => {
  const f = fixture(t);
  assert.throws(() => f.service.receiveGift(1, f.cmd({})), err => err.code === 'NOT_A_GIFT_GIVER');
});

test('trader buy mints the item to the npc then trades it to the player for the listed price', t => {
  const f = fixture(t);
  f.seedPlayer(100);
  const before = f.playerBalance();
  const result = f.service.executeTrade(1, f.cmd({ templateId: 'town.mood_patch' }));
  assert.equal(result.price, 15);
  assert.equal(f.playerBalance(), before - 15);
  const item = f.db.prepare(`SELECT owner_key, source_type, collected_at FROM backpack_items WHERE id=?`).get(result.itemId);
  assert.equal(item.owner_key, 'me');
  assert.equal(item.source_type, 'trade');
  assert.ok(item.collected_at);
  // 再买一件是全新的一笔交易：新幂等键、新物品、再扣一次钱
  const second = f.service.executeTrade(1, f.cmd({ templateId: 'town.mood_patch' }));
  assert.notEqual(second.itemId, result.itemId);
  assert.equal(f.playerBalance(), before - 30);
  const minted = f.db.prepare(`SELECT count(*) n FROM backpack_items WHERE source_type='trade' AND owner_key='me'`).get().n;
  assert.equal(minted, 2);
  // 不在 sells 里的商品直接拒绝
  assert.throws(() => f.service.executeTrade(1, f.cmd({ templateId: 'town.inn_tea' })),
    err => err.code === 'INVALID_TRADE_ITEM');
});

test('trader buy fails cleanly without funds and rolls back the mint', t => {
  const f = fixture(t);
  assert.throws(() => f.service.executeTrade(1, f.cmd({ templateId: 'town.mood_patch' })),
    err => err.code === 'INSUFFICIENT_FUNDS');
  const npcStock = f.db.prepare(`SELECT count(*) n FROM backpack_items WHERE owner_key LIKE 'actor:%'`).get().n;
  assert.equal(npcStock, 0);
});

test('non trader refuses trades', t => {
  const f = fixture(t);
  assert.throws(() => f.service.tradeCatalog(2, f.cmd({})), err => err.code === 'NOT_A_TRADER');
});

test('explicit two-function permissions gate direct trade', t => {
  const f = fixture(t);
  f.seedPlayer(100);
  f.db.prepare('UPDATE town_npcs SET capabilities_json=? WHERE id=2').run('["service","trade"]');
  assert.ok(f.service.functionsOf(2, f.cmd({})).functions.trader);
  const first = f.service.executeTrade(2, f.cmd({ templateId: 'town.energy_charm' }));
  assert.equal(first.price, 15);
  f.db.prepare('UPDATE town_npcs SET capabilities_json=? WHERE id=2').run('["service"]');
  assert.throws(() => f.service.tradeCatalog(2, f.cmd({})), { code: 'NOT_A_TRADER' });
  assert.throws(() => f.service.executeTrade(2, f.cmd({ templateId: 'town.energy_charm' })), { code: 'NOT_A_TRADER' });
  assert.equal(f.playerBalance(), 85);
});
