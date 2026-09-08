import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import Database from 'better-sqlite3';
import { migrateTownItemSchema } from '../src/db/townItemSchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import * as lifecycle from '../src/services/itemLifecycle.js';

// Execute real service source with explicit dependencies; never import production DB/config.
function isolatedModule(db, overrides, file, exports) {
  const names = [];
  const source = readFileSync(new URL(`../src/services/${file}.js`, import.meta.url), 'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g, (_, imports) => {
      names.push(...imports.split(',').map(n => n.trim()).filter(Boolean));
      return '';
    }).replace(/export (?=(?:async )?function|const)/g, '');
  assert.doesNotMatch(source, /\bimport\s/);
  const deps = { ...lifecycle, getDb: () => db, ...overrides };
  return compileFunction(`${source}\nreturn { ${exports} };`, names)(
    ...names.map(name => deps[name] ?? (() => { throw new Error(`Unexpected dependency: ${name}`); })),
  );
}

function isolatedService(db, overrides = {}) {
  return isolatedModule(db, overrides, 'itemService', 'getChestState, listBackpack, collectItem, useItem, discardItem, listActiveEffects, removeActiveEffect, tickCleanup, generateItemImageAsync, openChest');
}

function fixture(t, migrate = true) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE backpack_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, effect_key TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, rarity TEXT NOT NULL DEFAULT 'common', image_url TEXT,
      status TEXT NOT NULL DEFAULT 'generating', payload_json TEXT, collected_at DATETIME,
      acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP, used_at DATETIME
    );
    CREATE TABLE characters (id INTEGER PRIMARY KEY, display_name TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY);
    INSERT INTO characters VALUES (1, 'fixture');
    CREATE TABLE item_effects (
      id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES backpack_items(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES characters(id), effect_key TEXT, payload_json TEXT,
      expires_at DATETIME
    );
    CREATE TABLE gift_history (id INTEGER PRIMARY KEY, gift_type TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE global_outfits (id INTEGER PRIMARY KEY, name TEXT, description TEXT, enabled INTEGER, character_id INTEGER, expires_at DATETIME);
  `);
  if (migrate) migrateTownItemTemplateSchema(db);
  const add = (owner = 'me', source = 'chest', status = 'ready', collected = '2020-01-01 00:00:00', effect = 'energy') => Number(db.prepare(`
    INSERT INTO backpack_items (effect_key, name, description, owner_key, source_type, status, collected_at, acquired_at)
    VALUES (?, 'fixture', 'fixture', ?, ?, ?, ?, '2020-01-01 00:00:00')
  `).run(effect, owner, source, status, collected).lastInsertRowid);
  const row = id => db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(id);
  return { db, add, row, service: isolatedService(db) };
}

test('legacy migration preserves every existing field, effect reference and cooldown; reruns preserve new ownership', t => {
  const { db } = fixture(t, false);
  for (const [index, status] of ['generating', 'ready', 'used'].entries()) {
    db.prepare(`INSERT INTO backpack_items (id, effect_key, name, description, image_url, status, payload_json, collected_at, used_at)
      VALUES (?, 'energy', '旧道具', '描述', '/images/old.png', ?, '{"x":1}', ?, ?)`)
      .run(index + 1, status, index ? '2020-01-01' : null, index === 2 ? '2020-01-02' : null);
  }
  db.exec("INSERT INTO item_effects VALUES (9, 3, 1, 'energy', '{}', '2099-01-01'); INSERT INTO gift_history VALUES (7, 'chest', '2020-01-03')");
  const old = db.prepare('SELECT * FROM backpack_items ORDER BY id').all();
  const effects = db.prepare('SELECT * FROM item_effects').all();
  const history = db.prepare('SELECT * FROM gift_history').all();
  migrateTownItemSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM backpack_items ORDER BY id').all(), old.map(row => ({ ...row, owner_key: 'me', source_type: 'legacy_chest' })));
  db.exec("UPDATE backpack_items SET owner_key = 'business:1', source_type = 'shop' WHERE id = 2");
  const migrated = db.prepare('SELECT * FROM backpack_items').all();
  migrateTownItemSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM backpack_items').all(), migrated);
  assert.deepEqual(db.prepare('SELECT * FROM item_effects').all(), effects);
  assert.deepEqual(db.prepare('SELECT * FROM gift_history').all(), history);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  migrateTownItemTemplateSchema(db);
  const expanded = db.prepare('SELECT * FROM backpack_items').all();
  assert.deepEqual(expanded.map(row => Object.fromEntries(Object.keys(migrated[0]).map(key => [key, row[key]]))), migrated);
  for (const row of expanded) {
    assert.equal(row.version, 1); assert.equal(row.template_id, null); assert.equal(row.locked_by, null); assert.equal(row.retired_at, null);
  }
  migrateTownItemTemplateSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM backpack_items').all(), expanded);
  assert.deepEqual(db.prepare('SELECT * FROM item_effects').all(), effects);
});

test('shop/service/foreign chest generation neither blocks chest nor changes during stale/startup cleanup', t => {
  const { db, add, row, service } = fixture(t);
  const ids = [add('me', 'shop', 'generating'), add('me', 'service', 'generating'), add('business:1', 'chest', 'generating')];
  const before = ids.map(row);
  assert.equal(service.getChestState().canOpen, true);
  assert.equal(lifecycle.completeStaleChestItems(db, 30), 0);
  assert.equal(lifecycle.cleanupInterruptedChestItems(db), 0);
  for (const id of ids) assert.equal(lifecycle.completeChestItem(db, id, '/new.png'), false);
  assert.deepEqual(ids.map(row), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_history').get().n, 0);
  const chest = add('me', 'legacy_chest', 'generating');
  assert.equal(service.getChestState().generating, true);
  assert.equal(lifecycle.completeStaleChestItems(db, 30), 1);
  assert.equal(row(chest).status, 'ready');
  assert.equal(service.getChestState().canOpen, false);
  assert.equal(lifecycle.completeChestItem(db, chest), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_history').get().n, 1);
  const interrupted = add('me', 'chest', 'generating');
  assert.equal(lifecycle.cleanupInterruptedChestItems(db), 1);
  assert.equal(row(interrupted), undefined);
  assert.deepEqual(ids.map(row), before);
});

test('cooldown write failure rolls back image completion', t => {
  const { db, add, row } = fixture(t);
  const id = add('me', 'chest', 'generating');
  db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON gift_history BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.throws(() => lifecycle.completeChestItem(db, id, '/new.png'), /fixture failure/);
  assert.equal(row(id).status, 'generating');
  assert.equal(row(id).image_url, null);
});

test('all player inventory operations reject foreign ownership; owned shop/service items remain usable', t => {
  const { db, add, row, service } = fixture(t);
  const foreign = add('business:1', 'shop');
  for (const call of [() => service.collectItem(foreign), () => service.useItem(foreign, 1), () => service.discardItem(foreign)]) assert.equal(call().ok, false);
  const pending = add('me', 'service', 'ready', null);
  assert.equal(service.useItem(pending, 1).ok, false);
  assert.equal(service.collectItem(pending).ok, true);
  const collected = row(pending).collected_at;
  assert.equal(service.collectItem(pending).ok, true);
  assert.equal(row(pending).collected_at, collected);
  assert.equal(service.useItem(pending, 1).ok, true);
  assert.equal(service.useItem(pending, 1).ok, false);
  assert.equal(service.discardItem(pending).ok, false);
  assert.equal(service.listActiveEffects().length, 1);
  const shop = add('me', 'shop');
  assert.deepEqual(service.listBackpack().items.map(i => i.id), [shop]);
  assert.equal(service.listBackpack().items[0].source_type, 'shop');
  db.prepare("INSERT INTO item_effects VALUES (99, ?, 1, 'energy', NULL, '2099-01-01')").run(foreign);
  assert.equal(service.removeActiveEffect(99).ok, false);
});

test('generation is not consumable or discardable; discard retires without deleting shared image/history', t => {
  const { db, add, row } = fixture(t);
  const deleted = [];
  const service = isolatedService(db, { deleteImageFileByUrl: url => { assert.equal(db.inTransaction, false); deleted.push(url); } });
  const generating = add('me', 'chest', 'generating');
  assert.equal(service.useItem(generating, 1).ok, false);
  assert.equal(service.collectItem(generating).ok, false);
  assert.equal(service.discardItem(generating).ok, false);
  const id = add('me', 'shop');
  db.prepare("UPDATE backpack_items SET image_url = '/fixture.png' WHERE id = ?").run(id);
  assert.equal(service.discardItem(id).ok, true);
  assert.ok(row(id).retired_at);
  assert.equal(row(id).image_url, '/fixture.png');
  assert.equal(row(id).version, 2);
  assert.deepEqual(deleted, []);
  assert.equal(service.listBackpack().items.some(item => item.id === id), false);
  assert.equal(service.discardItem(id).ok, false);
});

test('effect failure and failed conditional consumption roll back all effects and inventory', t => {
  const { db, add, row, service } = fixture(t);
  const original = add();
  assert.equal(service.useItem(original, 1).ok, true);
  const effects = db.prepare('SELECT * FROM item_effects').all();
  const id = add();
  db.exec("CREATE TRIGGER fail_effect BEFORE INSERT ON item_effects BEGIN SELECT RAISE(ABORT, 'fixture effect failure'); END");
  assert.throws(() => service.useItem(id, 1), /fixture effect failure/);
  assert.equal(row(id).status, 'ready');
  assert.deepEqual(db.prepare('SELECT * FROM item_effects').all(), effects);
  db.exec(`DROP TRIGGER fail_effect;
    CREATE TRIGGER lose_item AFTER INSERT ON item_effects BEGIN
      UPDATE backpack_items SET owner_key = 'business:1' WHERE id = NEW.item_id;
    END`);
  assert.throws(() => service.useItem(id, 1), /使用已回滚/);
  assert.equal(row(id).owner_key, 'me');
  assert.equal(row(id).status, 'ready');
  assert.deepEqual(db.prepare('SELECT * FROM item_effects').all(), effects);
});

test('async image callback commits before broadcasting and ignores a late completion', async t => {
  const { db, add, row } = fixture(t);
  const events = [], deleted = [];
  const service = isolatedService(db, {
    generateImageRaw: async () => { assert.equal(db.inTransaction, false); return { success: true, images: [{ base64: 'fixture' }] }; },
    saveBase64Image: () => '/fixture.png',
    deleteImageFileByUrl: url => deleted.push(url),
    broadcast: (event, payload) => { assert.equal(db.inTransaction, false); assert.equal(row(payload.itemId).status, 'ready'); events.push(event); },
  });
  const id = add('me', 'chest', 'generating');
  await service.generateItemImageAsync(id, 'fixture');
  assert.deepEqual(events, ['item_ready']);
  await service.generateItemImageAsync(id, 'fixture');
  assert.deepEqual(events, ['item_ready']);
  assert.deepEqual(deleted, []);
});

test('real outfit, transform, mood and affinity writers share the consumption transaction', t => {
  const { db, add, row } = fixture(t);
  db.exec(`
    CREATE TABLE character_outfits (id INTEGER PRIMARY KEY, character_id INTEGER, name TEXT, description TEXT, enabled INTEGER, expires_at DATETIME);
    INSERT INTO character_outfits VALUES (10, 1, '原形', '', 1, NULL);
    CREATE TABLE user_relationships (character_id INTEGER PRIMARY KEY, relationship_text TEXT, affinity REAL, last_interaction_at TEXT);
    CREATE TABLE emotion_snapshots (id INTEGER PRIMARY KEY, conversation_id TEXT UNIQUE, after_msg_id INTEGER REFERENCES messages(id),
      valence REAL, arousal REAL, dominance REAL, mood_valence REAL, mood_arousal REAL, mood_dominance REAL,
      dominant_emotion TEXT, affinity REAL, affinity_delta REAL, reason TEXT);
  `);
  const outfits = isolatedModule(db, {}, 'outfitService', 'createTemporaryLimitedOutfit, createTemporaryExclusiveOutfit, setCharacterOutfitEnabled, deleteExpiredItemLimitedOutfits');
  const emotions = isolatedModule(db, {}, 'emotionEngine', 'saveEmotionSnapshot, loadAffinity, saveAffinity');
  const service = isolatedService(db, { ...outfits, ...emotions });
  const tables = ['backpack_items', 'item_effects', 'global_outfits', 'character_outfits', 'emotion_snapshots', 'user_relationships'];
  const snapshot = () => tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
  for (const effect of ['maid_outfit', 'transform', 'mood_fix', 'favor_candy']) {
    const id = add('me', 'shop', 'ready', '2020-01-01', effect);
    const before = snapshot();
    db.exec("CREATE TRIGGER reject_consume BEFORE UPDATE OF status ON backpack_items WHEN NEW.status = 'used' BEGIN SELECT RAISE(ABORT, 'fixture consume failure'); END");
    assert.throws(() => service.useItem(id, 1), /fixture consume failure/);
    assert.deepEqual(snapshot(), before, `${effect} must roll back its actual writer`);
    db.exec('DROP TRIGGER reject_consume');
    assert.equal(service.useItem(id, 1).ok, true);
    assert.equal(row(id).status, 'used');
    const after = snapshot();
    assert.equal(service.useItem(id, 1).ok, false);
    assert.deepEqual(snapshot(), after);
  }
  assert.equal(db.prepare('SELECT affinity FROM user_relationships').get().affinity, 58);
  assert.equal(db.prepare('SELECT dominant_emotion FROM emotion_snapshots').get().dominant_emotion, 'joy');
  assert.equal(db.prepare('SELECT after_msg_id FROM emotion_snapshots').get().after_msg_id, null);
  assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n, 0, 'no fabricated chat message for first-use mood effect');
  assert.equal(db.prepare('SELECT enabled FROM character_outfits WHERE id = 10').get().enabled, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM global_outfits').get().n, 1);
});

test('scheduler keeps foreign effects and foreign/service generating instances intact', t => {
  const { db, add, row } = fixture(t);
  const service = isolatedService(db, { deleteExpiredItemLimitedOutfits: () => 0 });
  const foreign = add('business:1', 'shop', 'used');
  const owned = add('me', 'service', 'used');
  const pending = add('me', 'service', 'generating');
  db.prepare("INSERT INTO item_effects VALUES (1, ?, 1, 'energy', NULL, '2020-01-01')").run(foreign);
  db.prepare("INSERT INTO item_effects VALUES (2, ?, 1, 'energy', NULL, '2020-01-01')").run(owned);
  assert.equal(service.tickCleanup().removedEffects, 1);
  assert.deepEqual(db.prepare('SELECT id FROM item_effects').all(), [{ id: 1 }]);
  assert.equal(row(pending).status, 'generating');
});

test('opening a chest stamps its source explicitly and runs model/image generation outside transactions', async t => {
  const { db, add, row } = fixture(t);
  add('me', 'shop', 'generating');
  let finishImage;
  const image = new Promise(resolve => { finishImage = resolve; });
  const events = [];
  const service = isolatedService(db, {
    getWorldSetting: () => null,
    getSystemRules: () => 'fixture',
    chatSync: async () => { assert.equal(db.inTransaction, false); return '{"name":"测试","description":"测试","image_prompt":"fixture"}'; },
    generateImageRaw: () => { assert.equal(db.inTransaction, false); return image; },
    saveBase64Image: () => '/new-fixture.png',
    broadcast: event => { assert.equal(db.inTransaction, false); events.push(event); },
  });
  const result = await service.openChest();
  assert.equal(result.ok, true);
  assert.equal(row(result.item.id).owner_key, 'me');
  assert.equal(row(result.item.id).source_type, 'chest');
  assert.equal((await service.openChest()).ok, false);
  finishImage({ success: true, images: [{ base64: 'fixture' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['item_ready']);
  assert.equal(row(result.item.id).status, 'ready');
});

test('legacy collect/use/discard reject locks/stale versions and advance version only on actual transition',t=>{
  const {db,add,row,service}=fixture(t);
  const pending=add('me','service','ready',null);
  db.prepare('UPDATE backpack_items SET locked_by=? WHERE id=?').run('order:1',pending);
  assert.equal(service.collectItem(pending).code,'ITEM_LOCKED');
  assert.equal(service.useItem(pending,1).code,'ITEM_LOCKED');
  assert.equal(service.discardItem(pending).code,'ITEM_LOCKED');
  db.prepare('UPDATE backpack_items SET locked_by=NULL WHERE id=?').run(pending);
  assert.equal(service.collectItem(pending,{expectedVersion:0}).code,'VERSION_CONFLICT');
  assert.equal(service.collectItem(pending,{expectedVersion:1}).ok,true);assert.equal(row(pending).version,2);
  assert.equal(service.collectItem(pending).ok,true);assert.equal(row(pending).version,2);
  assert.equal(service.useItem(pending,1,{expectedVersion:1}).code,'VERSION_CONFLICT');
  assert.equal(service.discardItem(pending,{expectedVersion:1}).code,'VERSION_CONFLICT');
  assert.equal(service.useItem(pending,1,{expectedVersion:2}).ok,true);assert.equal(row(pending).version,3);
  const npc=add('actor:npc','service');
  for(const result of [service.useItem(npc,1),service.collectItem(npc),service.discardItem(npc)])assert.equal(result.ok,false);
});

test('async chest callback cannot overwrite a newer version or delete an already referenced image',async t=>{
  const {db,add,row}=fixture(t);const id=add('me','chest','generating');let resolveImage;
  const deleted=[];
  const service=isolatedService(db,{
    generateImageRaw:()=>new Promise(resolve=>{resolveImage=resolve;}),saveBase64Image:()=>'/shared.png',
    deleteImageFileByUrl:url=>deleted.push(url),broadcast:()=>{throw new Error('late callback must not broadcast');},
  });
  const pending=service.generateItemImageAsync(id,'test');
  const referenced=add('me','service');db.prepare("UPDATE backpack_items SET image_url='/shared.png' WHERE id=?").run(referenced);
  db.prepare('UPDATE backpack_items SET version=version+1 WHERE id=?').run(id);
  resolveImage({success:true,images:[{base64:'fixture'}]});await pending;
  assert.equal(row(id).status,'generating');assert.deepEqual(deleted,[]);
  assert.equal(db.prepare('SELECT count(*) n FROM gift_history').get().n,0);
});
