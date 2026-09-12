import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownBusinessSchema } from '../src/db/townBusinessSchema.js';
import { migrateTownServiceSessionSchema } from '../src/db/townServiceSessionSchema.js';
import { migrateTownQuestSchema } from '../src/db/townQuestSchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import { migrateTownItemSchema } from '../src/db/townItemSchema.js';
import { migrateTownExperienceSchema } from '../src/db/townExperienceSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownBusinessService } from '../src/services/town/townBusinessService.js';
import { createItemTemplateService } from '../src/services/town/itemTemplateService.js';
import { createTownQuestService } from '../src/services/town/townQuestService.js';
import { QUEST_TEMPLATES, questTemplateList } from '../src/services/town/townQuestDefinitions.js';
import { venueProductTemplates } from '../src/services/town/townVenuePlaybooks.js';
import { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } from '../src/services/town/townExperienceService.js';
import { canonicalJson } from '../src/services/town/townEventService.js';

const EFFECT_REGISTRY = Object.freeze({ mood_fix: { kind: 'mood' }, energy: { kind: 'buff' },
  bob_cut: { kind: 'hairstyle' }, tipsy: { kind: 'buff' }, yukata: { kind: 'outfit' } });

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY AUTOINCREMENT,character_id INTEGER,town_enabled INTEGER DEFAULT 1);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs(id) VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9);
    CREATE TABLE IF NOT EXISTS backpack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effect_key TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common', image_url TEXT, status TEXT NOT NULL DEFAULT 'generating',
      payload_json TEXT, collected_at DATETIME, acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS item_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES backpack_items(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
      effect_key TEXT NOT NULL, payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME
    );`);
  migrateTownSchema(db); migrateTownActionSchema(db); migrateTownEconomySchema(db);
  migrateTownBusinessSchema(db); migrateTownServiceSessionSchema(db); migrateTownQuestSchema(db);
  migrateTownItemTemplateSchema(db); migrateTownItemSchema(db); migrateTownExperienceSchema(db);
  const registry = createTownActorRegistry(db);
  let time = 1_000_000;
  const clock = { now: () => time };
  const world = registry.getWorldState();
  let scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const playerId = registry.resolveAgentKey('me').actorId;
  const arrivals = new Map();
  const locations = new Set(['board', 'source', 'workshop', 'cafe', 'tavern', 'clothing_shop', 'inn', 'study']);
  const position = {
    getLocation: ({ locationKey }) => locations.has(locationKey) ? { locationKey } : null,
    hasArrived: ({ actorId, locationKey }) => {
      const point = arrivals.get(actorId);
      return !!point && !point.moving && point.locationKey === locationKey;
    },
    isServiceOpen: () => true,
  };
  const economy = createEconomyService({ db, clock, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  const itemTemplates = createItemTemplateService({ db, clock, getWorldEpoch: registry.getWorldEpoch,
    getActor: registry.getActor, effectRegistry: EFFECT_REGISTRY, economy });
  const dependencies = { db, clock, registry, economy, position, itemTemplates };
  const business = createTownBusinessService(dependencies);
  let counter = 0;
  const cmd = (fields = {}) => ({ ...scope, idempotencyKey: `request-${++counter}`, sourceKey: `source-${counter}`, ...fields });
  const slice = business.setup(cmd({ npcActorIds: { commissioner: registry.resolveAgentKey(-1).actorId,
    supplier: registry.resolveAgentKey(-2).actorId, workshop: registry.resolveAgentKey(-3).actorId,
    cafe: registry.resolveAgentKey(-4).actorId, tavern: registry.resolveAgentKey(-5).actorId,
    clothing_shop: registry.resolveAgentKey(-6).actorId },
  locationKeys: { board: 'board', supplier: 'source', workshop: 'workshop', cafe: 'cafe',
    tavern: 'tavern', clothing_shop: 'clothing_shop' } }));
  itemTemplates.ensureVenueTemplates({ ...scope, idempotencyKey: 'venue-templates', sourceKey: 'venue-templates',
    reasonCode: 'VENUE_PRODUCT_TEMPLATE' }, venueProductTemplates());
  itemTemplates.ensureDefaultTemplates({ ...scope, idempotencyKey: 'default-templates', sourceKey: 'default-templates' });
  const venueProfile = businessKey => [slice.cafe, ...(slice.functionalBuildings || [])]
    .find(profile => profile && profile.businessKey === businessKey);
  const questPayer = (input, payer) => {
    if (payer.type === 'fund') return { accountId: slice.accounts.fund };
    const profile = venueProfile(payer.businessKey);
    if (!profile) throw Object.assign(new Error('VENUE_NOT_CONFIGURED'), { code: 'VENUE_NOT_CONFIGURED' });
    return { accountId: profile.accountId };
  };
  let observed = [];
  const quests = createTownQuestService({ ...dependencies, observeTriggers: () => observed, resolvePayer: questPayer,
    enabled: () => true, consumers: [TOWN_EXPERIENCE_CONSUMER], offerGapMs: 1000 });
  const arrive = (actorId, locationKey, moving = false) => arrivals.set(actorId, { ...scope, locationKey, moving });
  const account = id => economy.getAccount({ ...scope, accountId: id });
  const playerAccount = () => economy.ensureAccount({ ...scope, ownerKey: `actor:${playerId}`,
    actorId: playerId, accountType: 'actor' });
  const fund = () => account(slice.accounts.fund);
  const offer = (trigger) => { observed = [trigger]; return quests.maintain({ ...scope, actorId: playerId }).offered; };
  /** 合成一单已完成的服务结算：任务引擎只认正式回执，不关心会话是怎么来的。 */
  const settleService = (serviceKey, providerActorId, settledAt) => {
    const sessionId = `session-${++counter}`;
    db.prepare(`INSERT INTO town_service_sessions(session_id,world_id,world_epoch,actor_id,provider_actor_id,status,phase,
      created_at,updated_at,offer_expires_at,config_json) VALUES(?,?,?,?,?,'completed','done',?,?,?,?)`)
      .run(sessionId, scope.worldId, scope.worldEpoch, playerId, providerActorId, settledAt, settledAt, settledAt + 60000,
        JSON.stringify({ template: { key: serviceKey } }));
    db.prepare('INSERT INTO town_service_settlements(session_id,receipt_json) VALUES(?,?)')
      .run(sessionId, JSON.stringify({ status: 'completed', settledAt, sessionId }));
    return sessionId;
  };
  return { db, registry, clock, economy, itemTemplates, business, quests, cmd, arrive, account, fund,
    playerAccount, venueProfile, settleService, offer, playerId,
    get scope() { return scope; }, setEpoch: value => { scope = { ...scope, worldEpoch: value }; },
    setTime: value => { time = value; }, get time() { return time; },
    setObserved: list => { observed = list; } };
}

const boardQuestOf = offered => offered.find(q => q.templateId === 'quest.board.hot_meal_run');
const venueQuestOf = offered => offered.find(q => q.templateId === 'quest.tavern.busy_night');
const npcQuestOf = offered => offered.find(q => q.templateId === 'quest.npc.first_favor');

test('quest templates registry is internally consistent', () => {
  const ids = questTemplateList().map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const template of questTemplateList()) {
    assert.ok(template.steps.length >= 1);
    assert.ok(Number.isSafeInteger(template.rewards.coins) && template.rewards.coins >= 0);
    assert.equal(QUEST_TEMPLATES[template.id], template);
  }
});

test('board trigger offers a quest; accept reserves reward coins from the fund', t => {
  const f = fixture(t);
  const [quest] = f.offer({ type: 'board', locationKey: 'board' });
  assert.equal(quest.templateId, 'quest.board.hot_meal_run');
  assert.equal(quest.status, 'offered');
  const fundBefore = f.fund().available;
  const accepted = f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  assert.equal(accepted.status, 'active');
  assert.equal(accepted.currentStep, 0);
  assert.equal(f.fund().available, fundBefore - 20);
  assert.equal(f.fund().reserved, 20);
  // 同一幂等键重放返回同一结果，不重复预留
  const replay = f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  assert.equal(replay.version, accepted.version);
  assert.equal(f.fund().reserved, 20);
  // 另一个并发接受 → 状态已变化
  assert.throws(() => f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-2' }),
    err => err.code === 'QUEST_STATE_CONFLICT');
});

test('accept requires the offering to belong to the player and an active-quest limit of one', t => {
  const f = fixture(t);
  const [first] = f.offer({ type: 'board', locationKey: 'board' });
  f.setTime(f.time + 2000);
  f.setObserved([{ type: 'venue', key: 'tavern' }]);
  const newlyOffered = f.quests.maintain({ ...f.scope, actorId: f.playerId }).offered;
  assert.equal(newlyOffered.length, 1);
  const second = newlyOffered[0];
  assert.equal(second.templateId, 'quest.tavern.busy_night');
  f.quests.accept({ ...f.scope, actorId: f.playerId, questId: first.questId, idempotencyKey: 'accept-1' });
  assert.throws(() => f.quests.accept({ ...f.scope, actorId: f.playerId, questId: second.questId, idempotencyKey: 'accept-2' }),
    err => err.code === 'QUEST_ACTIVE_LIMIT');
});

test('quest advances through goto/service/deliver and settles coins to the player', t => {
  const f = fixture(t);
  const [quest] = f.offer({ type: 'board', locationKey: 'board' });
  const accepted = f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  const tavernActor = f.venueProfile('tavern').actorId;
  const meal = f.itemTemplates.grant({ ...f.scope, templateId: 'town.tavern_meal', templateVersion: 1,
    ownerKey: 'me', quantity: 1, sourceType: 'seed', sourceId: 'test-meal',
    idempotencyKey: 'grant-meal', reasonCode: 'TEST' });
  assert.equal(meal.itemIds.length, 1);
  // 到酒馆 + 买热食结算 → 前两步推进
  f.arrive(f.playerId, 'tavern');
  f.settleService('town.tavern.buy_meal', tavernActor, f.time);
  f.setTime(f.time + 1000);
  const progressed = f.quests.progress({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'progress-1' });
  assert.equal(progressed.currentStep, 2);
  // 没回公告站 → 交付步不推进，物品也不收走
  const stuck = f.quests.progress({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'progress-2' });
  assert.equal(stuck.currentStep, 2);
  const itemRow = f.db.prepare('SELECT retired_at,locked_by FROM backpack_items WHERE id=?').get(meal.itemIds[0]);
  assert.equal(itemRow.retired_at, null);
  // 回到公告站 → 交付收走热食、任务完成、赏钱到账
  f.arrive(f.playerId, 'board');
  f.setTime(f.time + 1000);
  const playerBefore = f.account(f.playerAccount().accountId).balance;
  const done = f.quests.progress({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'progress-3' });
  assert.equal(done.status, 'completed');
  assert.equal(f.account(f.playerAccount().accountId).balance, playerBefore + 20);
  assert.equal(f.db.prepare('SELECT retired_at FROM backpack_items WHERE id=?').get(meal.itemIds[0]).retired_at != null, true);
  assert.equal(f.fund().reserved, 0);
  const event = f.db.prepare(`SELECT envelope FROM town_domain_events WHERE event_id=?`)
    .get(`quest:${quest.questId}:${done.version}`);
  assert.ok(event && JSON.parse(event.envelope).payload.status === 'completed');
  assert.ok(f.db.prepare('SELECT 1 FROM town_quest_log WHERE event_id=?').get(`quest:${quest.questId}:${done.version}`));
});

test('completed quest writes an experience for the player', t => {
  const f = fixture(t);
  const [quest] = f.offer({ type: 'board', locationKey: 'board' });
  f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  const tavernActor = f.venueProfile('tavern').actorId;
  f.itemTemplates.grant({ ...f.scope, templateId: 'town.tavern_meal', templateVersion: 1, ownerKey: 'me', quantity: 1,
    sourceType: 'seed', sourceId: 'test-meal', idempotencyKey: 'grant-meal', reasonCode: 'TEST' });
  f.arrive(f.playerId, 'tavern');
  f.settleService('town.tavern.buy_meal', tavernActor, f.time);
  f.setTime(f.time + 1000);
  f.quests.progress({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'progress-1' });
  f.arrive(f.playerId, 'board');
  f.setTime(f.time + 1000);
  f.quests.progress({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'progress-2' });
  const drained = createTownExperienceService({ db: f.db, clock: f.clock, registry: f.registry,
    writeMemory: null, memoryEnabled: () => false }).drain(f.scope);
  assert.ok(drained >= 1);
  const rows = f.db.prepare(`SELECT summary FROM town_experiences WHERE summary LIKE '%一份热食的跑腿%'`).all();
  assert.equal(rows.length, 1);
});

test('npc trigger records the offering neighbour and grants item rewards on completion', t => {
  const f = fixture(t);
  const cafeActor = f.venueProfile('cafe').actorId;
  const [quest] = f.offer({ type: 'npc', key: null, locationKey: 'cafe', actorId: cafeActor });
  assert.equal(quest.templateId, 'quest.npc.first_favor');
  assert.equal(quest.offeringActorId, cafeActor);
  f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  f.arrive(f.playerId, 'cafe');
  f.settleService('town.cafe.drink_coffee', cafeActor, f.time);
  f.setTime(f.time + 1000);
  const playerBefore = f.account(f.playerAccount().accountId).balance;
  const done = f.quests.progress({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'progress-1' });
  assert.equal(done.status, 'completed');
  assert.equal(f.account(f.playerAccount().accountId).balance, playerBefore + 20);
  const reward = f.db.prepare(`SELECT id FROM backpack_items WHERE owner_key='me' AND template_id='town.mood_patch'
    AND source_type='reward' AND source_id=?`).get(`quest:${quest.questId}:reward:town.mood_patch`);
  assert.ok(reward);
});

test('abandon and deadline expiry release the reserved reward back to the payer', t => {
  const f = fixture(t);
  const [quest] = f.offer({ type: 'board', locationKey: 'board' });
  f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  assert.equal(f.fund().reserved, 20);
  const abandoned = f.quests.abandon({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'abandon-1' });
  assert.equal(abandoned.status, 'abandoned');
  assert.equal(f.fund().reserved, 0);
  assert.equal(f.fund().available, 2000);

  // 冷却期过后再上架一次；期限过期同样释放托管
  f.setTime(f.time + 2 * 3600000 + 2000);
  const [next] = f.offer({ type: 'board', locationKey: 'board' });
  f.quests.accept({ ...f.scope, actorId: f.playerId, questId: next.questId, idempotencyKey: 'accept-2' });
  assert.equal(f.fund().reserved, 20);
  f.setTime(f.time + 4 * 3600000 + 1);
  const maintained = f.quests.maintain(f.scope);
  const expired = maintained.changed.find(q => q.questId === next.questId);
  assert.equal(expired.status, 'expired');
  assert.equal(f.fund().reserved, 0);
});

test('offered quests expire and pool limits plus cooldowns gate the offer roll', t => {
  const f = fixture(t);
  f.offer({ type: 'board', locationKey: 'board' });
  // 上架间隔（offerGapMs=1000）内不再开新奇遇
  f.setTime(f.time + 500);
  f.setObserved([{ type: 'venue', key: 'tavern' }]);
  assert.equal(f.quests.maintain(f.scope).offered.length, 0);
  // 过了间隔，board 模板仍在架上（不重复上架），venue 模板与公告站的第二条模板各补一员
  f.setTime(f.time + 2000);
  f.setObserved([{ type: 'board', locationKey: 'board' }, { type: 'venue', key: 'tavern' }]);
  const offered = f.quests.maintain(f.scope).offered;
  assert.equal(offered.length, 2);
  assert.ok(offered.some(q => q.templateId === 'quest.tavern.busy_night'));
  assert.ok(offered.some(q => q.templateId === 'quest.board.cafe_hand'));
  // 报价过期
  f.setTime(f.time + 31 * 60000);
  const changed = f.quests.maintain(f.scope).changed;
  assert.ok(changed.filter(q => q.status === 'expired').length >= 2);
  // 冷却期内不重新上架
  f.setObserved([{ type: 'board', locationKey: 'board' }]);
  assert.equal(f.quests.maintain(f.scope).offered.length, 0);
});

test('explicit trigger offers come from the server registry only', t => {
  const f = fixture(t);
  const offered = f.quests.offer({ ...f.scope, actorId: f.playerId, idempotencyKey: 'trigger-1' }, { type: 'venue', key: 'tavern' });
  assert.equal(offered.templateId, 'quest.tavern.busy_night');
  // 没有声明模板的场地不给奇遇；熟客档位不够时 tier-1 任务也不出现
  assert.throws(() => f.quests.offer({ ...f.scope, actorId: f.playerId, idempotencyKey: 'trigger-2' }, { type: 'venue', key: 'workshop' }),
    err => err.code === 'NO_QUEST_AVAILABLE');
  assert.throws(() => f.quests.offer({ ...f.scope, actorId: f.playerId, idempotencyKey: 'trigger-3' }, { type: 'venue', key: 'town-hall' }),
    err => err.code === 'NO_QUEST_AVAILABLE');
});

test('tampered template snapshots are retired instead of silently upgraded', t => {
  const f = fixture(t);
  const [quest] = f.offer({ type: 'board', locationKey: 'board' });
  f.quests.accept({ ...f.scope, actorId: f.playerId, questId: quest.questId, idempotencyKey: 'accept-1' });
  f.db.prepare('UPDATE town_quests SET config=? WHERE quest_id=?').run('{"title":"伪造"}', quest.questId);
  const changed = f.quests.maintain(f.scope).changed;
  const retired = changed.find(q => q.questId === quest.questId);
  assert.equal(retired.status, 'expired');
  assert.equal(f.fund().reserved, 0);
});
