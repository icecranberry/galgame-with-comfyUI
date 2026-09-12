import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownNpcFunctionsSchema } from '../src/db/townNpcFunctionsSchema.js';
import { createTownInteractionService } from '../src/services/town/townInteractionService.js';

function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE town_npcs(id INTEGER PRIMARY KEY); CREATE TABLE paid(value INTEGER)');
  migrateTownNpcFunctionsSchema(db);
  let now = 1_000_000, epoch = 1, fail = false;
  const input = { worldId: 'town', worldEpoch: 1, actorId: 'npc', playerActorId: 'me' };
  const service = createTownInteractionService({ db, clock: { now: () => now }, registry: { getWorldEpoch: () => epoch },
    catalog: () => [{ key: 'trade:meal', kind: 'trade', price: 8 }], assertPresent: () => {},
    execute: () => { db.prepare('INSERT INTO paid VALUES(8)').run(); if (fail) throw new Error('settlement failed'); return { kind: 'trade', paid: 8 }; } });
  return { db, input, service, advance: time => { now += time }, rebuild: () => { epoch++ }, fail: () => { fail = true } };
}
test('decline, expiry, owner and world fences cannot perform a transaction', t => {
  const f = fixture(t), offer = f.service.offer(f.input, 'trade:meal');
  assert.throws(() => f.service.respond({ ...f.input, actorId: 'other' }, offer.requestId, 'accept'), { code: 'REQUEST_NOT_FOUND' });
  const declined = f.service.respond(f.input, offer.requestId, 'decline');
  assert.equal(f.service.respond(f.input, offer.requestId, 'accept').status, declined.status);
  f.advance(86400000);
  const next = f.service.offer(f.input, 'trade:meal'); f.advance(31 * 60000);
  assert.throws(() => f.service.respond(f.input, next.requestId, 'accept'), { code: 'REQUEST_EXPIRED' });
  f.rebuild();
  assert.throws(() => f.service.respond(f.input, offer.requestId, 'accept'), { code: 'STALE_EPOCH' });
  assert.equal(f.db.prepare('SELECT count(*) n FROM paid').get().n, 0);
});
test('settlement and the accepted invitation commit together or both roll back', t => {
  const f = fixture(t), offer = f.service.offer(f.input, 'trade:meal'); f.fail();
  assert.throws(() => f.service.respond(f.input, offer.requestId, 'accept'), /settlement failed/);
  assert.equal(f.service.get(offer.requestId).status, 'offered');
  assert.equal(f.db.prepare('SELECT count(*) n FROM paid').get().n, 0);
});
