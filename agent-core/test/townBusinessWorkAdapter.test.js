import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTownBusinessWorkAdapter } from '../src/services/town/townBusinessWorkAdapter.js';

function fixture() {
  let time = Date.parse('2026-09-08T09:00:00+08:00');
  const scope = { worldId: 'world',worldEpoch: 1 };
  const actors = new Map(['a','b','c','other'].map(actorId => [actorId,{ actorId,participating: true,archived: false,
    mergedInto: null,npcExists: true,characterExists: false }]));
  const locations = new Set(['board','raw','shop']), positions = new Map(), sessions = new Map();
  const config = { npcActorIds: { commissioner: 'a',supplier: 'b',workshop: 'c' },locationKeys: { board: 'board',supplier: 'raw',workshop: 'shop' } };
  const dependencies = {
    clock: { now: () => time }, registry: { getWorldEpoch: id => id === 'world' ? 1 : null,getActor: id => actors.get(id) },
    getSlice: () => config,
    getActorPosition: id => positions.get(id) ?? null,
    getLocation: ({ locationKey }) => locations.has(locationKey) ? { locationKey } : null,
    readActiveService: ({ actorId }) => sessions.get(actorId) ?? null,
  };
  const adapter = createTownBusinessWorkAdapter(dependencies);
  const base = actorId => ({ actorId,worldEpoch: 1,intent: 'wait',scheduleKey: 'original',target: 'home',
    targetExists: true,arrived: true,locationKey: 'home',allowsAction: true,durationMs: 1000,minDurationMs: 0 });
  const enrich = (id,extra = {}) => adapter.enrichFacts(actors.get(id),scope,{ ...base(id),...extra });
  const arrive = (id,key) => positions.set(id,{ ...scope,actorId: id,x: 5,y: 5,moving: false,locationKeys: [key] });
  return { adapter,dependencies,actors,locations,positions,sessions,scope,base,enrich,arrive,
    setTime: iso => { time = Date.parse(iso); }, get time() { return time; } };
}

test('all three assigned roles localize M3 targets without mutating base facts', () => {
  const f = fixture();
  for (const [actorId,target] of [['a','board'],['b','raw'],['c','shop']]) {
    const input = f.base(actorId), copy = { ...input };
    const facts = f.adapter.enrichFacts(f.actors.get(actorId),f.scope,input);
    assert.equal(facts.target,target);
    assert.equal(facts.intent,'work');
    assert.equal(facts.arrived,false);
    assert.equal(facts.locationKey,null);
    assert.equal(facts.allowsAction,true);
    assert.ok(Object.isFrozen(facts));
    assert.deepEqual(input,copy);
  }
  assert.deepEqual(f.enrich('other'),f.base('other'));
});

test('Shanghai 09 inclusive to 18 exclusive; same work period keeps a stable schedule key', () => {
  const f = fixture(); f.arrive('b','raw');
  f.setTime('2026-09-08T00:59:59Z');
  assert.equal(f.enrich('b').intent,'wait');
  f.setTime('2026-09-08T01:00:00Z');
  const start = f.enrich('b');
  assert.equal(start.intent,'work');
  assert.equal(f.adapter.getBusinessStatus({ ...f.scope,role: 'supplier' }).open,true);
  f.setTime('2026-09-08T09:59:59Z');
  assert.equal(f.enrich('b').scheduleKey,start.scheduleKey);
  f.setTime('2026-09-08T10:00:00Z');
  assert.equal(f.enrich('b').intent,'wait');
  assert.equal(f.adapter.getBusinessStatus({ ...f.scope,role: 'supplier' }).open,false);
});

test('business opens only after complete authoritative arrival at its own location', () => {
  const f = fixture();
  const status = () => f.adapter.getBusinessStatus({ ...f.scope,role: 'workshop' });
  assert.equal(status().open,false);
  f.arrive('c','raw'); assert.equal(status().open,false);
  f.arrive('c','shop'); assert.equal(status().open,true);
  f.positions.get('c').moving = true; assert.equal(status().open,false);
  f.positions.get('c').moving = false;
  f.positions.get('c').worldEpoch = 2; assert.equal(status().open,false);
  f.arrive('c','shop'); f.positions.get('c').actorId = 'b'; assert.equal(status().open,false);
  f.arrive('c','shop'); f.positions.get('c').worldId = 'other'; assert.equal(status().open,false);
  f.arrive('c','shop'); f.locations.delete('shop'); assert.equal(status().open,false);
});

test('running service prevents movement and new business across closing time until its lease ends', () => {
  const f = fixture(); f.arrive('c','shop');
  f.sessions.set('c',{ ...f.scope,actorId: 'c',sessionId: 'service-1',locationKey: 'shop',phase: 'running',
    leaseUntilUtcMs: Date.parse('2026-09-08T19:00:00+08:00') });
  const before = f.enrich('c');
  assert.equal(before.allowsAction,false);
  assert.equal(before.target,'shop');
  assert.equal(f.adapter.getBusinessStatus({ ...f.scope,role: 'workshop' }).open,false);
  f.setTime('2026-09-08T18:30:00+08:00');
  const during = f.enrich('c',{ intent: 'off_town',target: 'other' });
  assert.equal(during.scheduleKey,before.scheduleKey);
  assert.equal(during.target,'shop');
  assert.equal(during.allowsAction,false);
  assert.equal(f.adapter.getWorkState('c',f.scope).shouldHold,true);
  f.setTime('2026-09-08T19:00:00+08:00');
  assert.equal(f.adapter.getWorkState('c',f.scope).shouldHold,false);
  assert.equal(f.enrich('c').scheduleKey,'original');
});

test('old-world or completed sessions cannot pin residents; sleeping and off-town schedules survive', () => {
  const f = fixture();
  for (const intent of ['rest','off_town']) assert.equal(f.enrich('b',{ intent }).intent,intent);
  f.sessions.set('b',{ ...f.scope,worldEpoch: 99,actorId: 'b',sessionId: 'old',locationKey: 'raw',phase: 'running',leaseUntilUtcMs: f.time + 10000 });
  assert.equal(f.enrich('b').allowsAction,true);
  f.sessions.get('b').worldEpoch = 1; f.sessions.get('b').phase = 'completed';
  assert.equal(f.adapter.getWorkState('b',f.scope).busy,false);
  f.actors.get('b').participating = false;
  f.arrive('b','raw');
  assert.equal(f.enrich('b').allowsAction,false);
  assert.equal(f.adapter.getBusinessStatus({ ...f.scope,role: 'supplier' }).open,false);
});

test('missing setup is a no-op and failed/async dependencies or stale batches fail closed', () => {
  const f = fixture();
  const absent = createTownBusinessWorkAdapter({ ...f.dependencies,getSlice: () => { throw Object.assign(new Error(),{ code: 'SLICE_NOT_CONFIGURED' }); } });
  assert.deepEqual(absent.enrichFacts(f.actors.get('b'),f.scope,f.base('b')),f.base('b'));
  assert.equal(absent.getBusinessStatus({ ...f.scope,role: 'supplier' }),null);
  assert.throws(() => f.adapter.getWorkState('b',{ ...f.scope,worldEpoch: 2 }),{ code: 'STALE_EPOCH' });
  assert.throws(() => f.adapter.enrichFacts(f.actors.get('b'),f.scope,{ ...f.base('b'),worldEpoch: 2 }),{ code: 'STALE_SIMULATION_FACTS' });
  const asyncAdapter = createTownBusinessWorkAdapter({ ...f.dependencies,getActorPosition: () => Promise.resolve(null) });
  assert.throws(() => asyncAdapter.getWorkState('b',f.scope),{ code: 'ASYNC_ADAPTER_FORBIDDEN' });
});

test('M3 batch now overrides clock and independent restrictions are not relaxed', () => {
  const f = fixture();
  const outside = f.adapter.enrichFacts(f.actors.get('b'),{ ...f.scope,nowUtcMs: Date.parse('2026-09-08T20:00:00+08:00') },f.base('b'));
  assert.equal(outside.intent,'wait');
  assert.equal(f.enrich('b',{ allowsAction: false }).allowsAction,false);
});

test('linked characters preserve every schedule intent and target even during business hours', () => {
  const f = fixture();
  f.actors.get('b').characterExists = true;
  for (const intent of ['wait','work','rest','off_town']) {
    const base = { ...f.base('b'),intent,target: 'character-schedule-target',scheduleKey: 'character-original' };
    assert.deepEqual(f.adapter.enrichFacts(f.actors.get('b'),f.scope,base),base);
  }
  f.arrive('b','raw');
  assert.equal(f.adapter.getBusinessStatus({ ...f.scope,role: 'supplier' }).open,true);
  f.sessions.set('b',{ ...f.scope,actorId: 'b',sessionId: 'busy-character',locationKey: 'raw',phase: 'running',leaseUntilUtcMs: f.time + 10000 });
  assert.deepEqual(f.enrich('b'),{ ...f.base('b'),allowsAction: false });
  f.sessions.clear();
  f.actors.get('b').characterExists = false;
  assert.equal(f.enrich('b').target,'raw','deleted character association resumes NPC local schedule');
});

test('sleeping residents cannot open a business even when stationary at the workplace', () => {
  const f = fixture();
  for (const [actorId,role,key] of [['b','supplier','raw'],['c','workshop','shop']]) {
    f.arrive(actorId,key);
    const status = () => f.adapter.getBusinessStatus({ ...f.scope,role });
    assert.equal(status().open,true);
    f.positions.get(actorId).sleeping = true;
    assert.equal(status().arrived,true);
    assert.equal(status().open,false);
    f.actors.get(actorId).characterExists = true;
    assert.equal(status().open,false);
    assert.deepEqual(f.enrich(actorId),f.base(actorId));
    f.positions.get(actorId).sleeping = false;
    assert.equal(status().open,true);
  }
});

test('encounter occupancy closes business while absent optional position fields remain compatible', () => {
  const f = fixture(); f.arrive('c','shop');
  const open = () => f.adapter.getBusinessStatus({ ...f.scope,role: 'workshop' }).open;
  assert.equal(open(),true);
  for (const encounterId of [1,0,'encounter']) {
    f.positions.get('c').encounterId = encounterId;
    assert.equal(open(),false);
  }
  f.positions.get('c').encounterId = null;
  assert.equal(open(),true);
  delete f.positions.get('c').encounterId;
  assert.equal(open(),true);
});
