import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// Deliberately no static application imports: config captures DB_PATH at import.
// This file runs in node:test's isolated process, and never imports app.js,
// schedulers, model services, or the town initialization wizard.
const originalDbPath = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

test('full getDb startup migration (offline, isolated databases)', async t => {
  const attemptedNetwork = [];
  const blockNetwork = () => {
    attemptedNetwork.push('blocked');
    throw new Error('Network/model access is forbidden in database migration tests');
  };
  t.mock.method(globalThis, 'fetch', blockNetwork);
  t.mock.method(net.Socket.prototype, 'connect', blockNetwork);
  t.mock.method(http, 'request', blockNetwork);
  t.mock.method(http, 'get', blockNetwork);
  t.mock.method(https, 'request', blockNetwork);
  t.mock.method(https, 'get', blockNetwork);
  t.mock.method(tls, 'connect', blockNetwork);

  const { getDb, closeDb } = await import('../src/db/index.js');
  const { config } = await import('../src/config.js');
  const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');
  assert.equal(config.dbPath, ':memory:');
  const scratch = mkdtempSync(path.join(tmpdir(), 'town-migration-test-'));
  t.after(() => {
    closeDb();
    config.dbPath = ':memory:';
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
    // Only remove the exact fresh directory created by this test.
    assert.equal(path.dirname(scratch), path.resolve(tmpdir()));
    assert.ok(path.basename(scratch).startsWith('town-migration-test-'));
    rmSync(scratch, { recursive: true, force: true });
    assert.equal(attemptedNetwork.length, 0, 'startup must not attempt network/model access');
  });
  const useDatabase = name => {
    closeDb();
    config.dbPath = name === ':memory:' ? name : path.join(scratch, name);
    return getDb();
  };
  const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
  const checkIntegrity = db => {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  };

  await t.test('fresh full schema starts without a map and includes world, actor and item migrations', () => {
    const db = useDatabase(':memory:');
    assert.equal(getDb(), db, 'getDb returns the same live connection');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    for (const name of ['characters', 'messages', 'backpack_items', 'item_effects', 'town_maps', 'town_npcs', 'town_characters', 'town_world_state', 'town_actors']) {
      assert.ok(tables.has(name), `${name} exists after real startup`);
    }
    const columns = new Set(db.pragma('table_info(backpack_items)').map(c => c.name));
    assert.ok(columns.has('owner_key'));
    assert.ok(columns.has('source_type'));
    assert.ok(db.pragma('index_list(backpack_items)').some(i => i.name === 'idx_backpack_items_owner_source_status'));
    const npcColumns = db.pragma('table_info(town_npcs)');
    assert.equal(npcColumns.find(c => c.name === 'map_id').notnull, 0);
    assert.ok(npcColumns.some(c => c.name === 'character_id'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM town_maps').get().n, 0);
    const registry = createTownActorRegistry(db);
    assert.equal(registry.getWorldState().schemaVersion, 1);
    assert.match(registry.resolveAgentKey('me').actorId, /^[0-9a-f-]{36}$/);
    checkIntegrity(db);
  });

  await t.test('repeated file close/reopen preserves player UUID, world/seed and epoch', () => {
    let db = useDatabase('reopen.sqlite');
    let registry = createTownActorRegistry(db);
    const original = registry.getWorldState();
    const world = registry.advanceEpoch({ expectedEpoch: original.epoch });
    const player = registry.resolveAgentKey('me').actorId;
    const identities = dump(db, 'town_actors');
    for (let i = 0; i < 3; i++) {
      closeDb();
      db = getDb();
      registry = createTownActorRegistry(db);
      assert.deepEqual(registry.getWorldState(), world);
      assert.equal(registry.resolveAgentKey('me').actorId, player);
      assert.deepEqual(dump(db, 'town_actors'), identities);
      assert.throws(() => registry.assertEpoch(original.epoch), { code: 'TOWN_STALE_EPOCH' });
      checkIntegrity(db);
    }
  });

  await t.test('pre-M0 NPC/character save backfills on open and preserves source records', () => {
    let db = useDatabase('legacy.sqlite');
    // Build a full legacy fixture from real schema, then remove only the M0
    // additions in this disposable file. All legacy migrations/markers remain.
    db.exec(`DROP TABLE town_actors; DROP TABLE town_world_state;
      INSERT INTO characters (id, name, display_name, base_prompt)
        VALUES (901, 'migration_fixture', '迁移角色', 'fixture persona');
      INSERT INTO town_npcs (id, display_name, character_id, town_enabled)
        VALUES (801, '迁移居民', 901, 1), (802, '未邀请居民', NULL, 1);
      INSERT INTO town_characters (character_id, town_enabled) VALUES (901, 1);`);
    const before = ['characters', 'town_npcs', 'town_characters'].map(table => dump(db, table));
    closeDb();
    db = getDb();
    const registry = createTownActorRegistry(db);
    const npc = registry.resolveAgentKey('npc:801');
    assert.equal(registry.resolveAgentKey('char:901').actorId, npc.actorId);
    assert.equal(npc.agentKey, 'char:901');
    assert.equal(npc.participating, true);
    assert.ok(registry.resolveAgentKey(-802));
    assert.deepEqual(['characters', 'town_npcs', 'town_characters'].map(table => dump(db, table)), before);
    const world = registry.getWorldState();
    const actors = dump(db, 'town_actors');
    closeDb();
    db = getDb();
    assert.deepEqual(createTownActorRegistry(db).getWorldState(), world);
    assert.deepEqual(dump(db, 'town_actors'), actors);
    checkIntegrity(db);
  });

  await t.test('real startup cleanup only discards interrupted player chest items', () => {
    let db = useDatabase('cleanup.sqlite');
    const insert = db.prepare(`INSERT INTO backpack_items
      (effect_key, name, description, owner_key, source_type, status)
      VALUES ('fixture', ?, 'fixture', ?, ?, ?)`);
    for (const values of [
      ['legacy interrupted', 'me', 'legacy_chest', 'generating'],
      ['chest interrupted', 'me', 'chest', 'generating'],
      ['service interrupted', 'me', 'service', 'generating'],
      ['purchase interrupted', 'me', 'purchase', 'generating'],
      ['npc chest', 'actor:fixture', 'chest', 'generating'],
      ['ready chest', 'me', 'chest', 'ready'],
    ]) insert.run(...values);
    const retained = db.prepare("SELECT * FROM backpack_items WHERE name NOT IN ('legacy interrupted', 'chest interrupted') ORDER BY id").all();
    const gifts = dump(db, 'gift_history');
    for (let i = 0; i < 2; i++) {
      closeDb();
      db = getDb();
      assert.deepEqual(dump(db, 'backpack_items'), retained);
      assert.deepEqual(dump(db, 'gift_history'), gifts, 'reopening must not grant or consume chest cooldown');
      checkIntegrity(db);
    }
  });

  await t.test('delivery survives real DB reopen and two connections cannot pay twice', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { migrateTownBusinessSchema } = await import('../src/db/townBusinessSchema.js');
    const { createEconomyService } = await import('../src/services/town/economyService.js');
    const { createTownBusinessService } = await import('../src/services/town/townBusinessService.js');
    const { createTownOrderService } = await import('../src/services/town/townOrderService.js');
    let db = useDatabase('delivery.sqlite');
    migrateTownBusinessSchema(db);
    db.exec(`INSERT INTO town_maps(name,grid_cols,grid_rows) VALUES('delivery fixture',20,20);
      INSERT INTO town_npcs(id,display_name) VALUES(801,'公告员'),(802,'原料商'),(803,'工坊主');
      INSERT INTO town_locations(map_id,key,name,grid_x,grid_y) VALUES
        ((SELECT MAX(id) FROM town_maps),'board','公告',1,1),
        ((SELECT MAX(id) FROM town_maps),'source','原料',5,5),
        ((SELECT MAX(id) FROM town_maps),'workshop','工坊',10,10);`);
    createTownActorRegistry(db).synchronize();
    let authoritativePosition = null;
    const runtime = connection => {
      const registry = createTownActorRegistry(connection), clock = { now: () => 1000 };
      const economy = createEconomyService({ db: connection,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor });
      const position = {
        getLocation: ({ worldId,worldEpoch,locationKey }) => {
          if (registry.getWorldEpoch(worldId) !== worldEpoch) return null;
          return connection.prepare('SELECT key AS locationKey FROM town_locations WHERE key=?').get(locationKey) ?? null;
        },
        hasArrived: ({ worldId,worldEpoch,actorId,locationKey }) => {
          const p = authoritativePosition;
          return !!p && p.worldId === worldId && p.worldEpoch === worldEpoch && p.actorId === actorId
            && p.moving === false && p.locationKeys.includes(locationKey);
        },
      };
      const deps = { db: connection,clock,registry,economy,position };
      return { registry,economy,business: createTownBusinessService(deps),orders: createTownOrderService(deps) };
    };
    let service = runtime(db);
    const world = service.registry.getWorldState(), scope = { worldId: world.worldId,worldEpoch: world.epoch };
    const player = service.registry.resolveAgentKey('me').actorId;
    const command = (key,extra = {}) => ({ ...scope,idempotencyKey: key,sourceKey: key,...extra });
    const slice = service.business.setup(command('setup',{
      npcActorIds: { commissioner: service.registry.resolveAgentKey(-801).actorId,
        supplier: service.registry.resolveAgentKey(-802).actorId,workshop: service.registry.resolveAgentKey(-803).actorId },
      locationKeys: { board: 'board',supplier: 'source',workshop: 'workshop' },
    }));
    let order = service.orders.publish(command('publish')).order;
    const action = key => command(key,{ orderId: order.orderId,actorId: player,expectedVersion: order.version });
    const arrive = key => { authoritativePosition = { ...scope,actorId: player,moving: false,locationKeys: [key] }; };
    arrive('board');
    authoritativePosition.worldEpoch += 1;
    assert.throws(() => service.orders.accept(action('accept')),{ code: 'NOT_ARRIVED' });
    arrive('board'); order = service.orders.accept(action('accept')).order;
    arrive('source'); order = service.orders.pickup(action('pickup')).order;
    closeDb();
    db = getDb();
    service = runtime(db);
    assert.deepEqual(service.orders.getOrder({ ...scope,orderId: order.orderId }),order);
    const cargo = service.economy.getStock({ ...scope,stockId: order.cargoStockId });
    assert.equal(cargo.quantity,1);
    assert.equal(cargo.available,0);
    const second = new Database(config.dbPath);
    try {
      second.pragma('foreign_keys=ON');
      const competing = runtime(second);
      const oldVersion = competing.orders.getOrder({ ...scope,orderId: order.orderId }).version;
      arrive('workshop');
      const complete = action('complete');
      const result = service.orders.complete(complete);
      assert.deepEqual(competing.orders.complete(complete),result);
      assert.throws(() => competing.orders.complete(command('competing-complete',{
        orderId: order.orderId,actorId: player,expectedVersion: oldVersion,
      })),{ code: 'VERSION_CONFLICT' });
      assert.equal(competing.economy.getAccount({ ...scope,accountId: slice.accounts.player }).balance,30);
      assert.equal(competing.economy.getStock({ ...scope,stockId: slice.stocks.workshop }).quantity,1);
      assert.equal(second.prepare("SELECT COUNT(*) n FROM town_business_log WHERE phase='completed'").get().n,1);
      checkIntegrity(second);
    } finally { second.close(); }
    closeDb();
    db = getDb();
    service = runtime(db);
    assert.equal(service.orders.getOrder({ ...scope,orderId: order.orderId }).status,'completed');
    assert.equal(service.economy.getAccount({ ...scope,accountId: slice.accounts.player }).balance,30);
    checkIntegrity(db);
  });
});
