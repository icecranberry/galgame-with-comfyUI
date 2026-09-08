import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { createTownActionRunner } from '../src/services/town/townActionRunner.js';
import { migrateTownSchema } from '../src/db/townSchema.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';

function fixture(t) {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); t.after(() => db.close());
  migrateTownActionSchema(db); migrateTownActionSchema(db);
  let time = 1000, epoch = 1, sequence = 0;
  const fact = { allowsAction: true, targetExists: true, arrived: false, locationKey: null };
  const options = { db, clock: { now: () => time }, getWorldEpoch: () => epoch,
    getActor: id => id === 'missing' ? null : { actorId: id, participating: true, archived: false },
    readFacts: a => ({ worldEpoch: epoch, actorId: a.actorId, ...fact }), leaseMs: 1000, consumers: ['test'] };
  let runner = createTownActionRunner(options);
  const scope = { worldId: 'world', worldEpoch: 1 };
  const create = (patch = {}) => runner.create({ ...scope, actorId: 'a', type: 'wait', payload: { durationMs: 100 },
    idempotencyKey: `create-${++sequence}`, ...patch });
  const command = (method, a, patch = {}) => runner[method]({ ...scope, actionId: a.id, expectedVersion: a.version,
    idempotencyKey: `${method}-${++sequence}`, ...patch });
  return { db, fact, create, command, scope, get runner() { return runner; },
    time: value => { time = value; }, epoch: value => { epoch = value; },
    restart: () => { runner = createTownActionRunner(options); } };
}

test('explicit repeatable schema, timed lifecycle and one event/log per phase', t => {
  const f = fixture(t); let a = f.create();
  a = f.command('reserve',a); a = f.command('start',a);
  assert.equal(a.dueAt,1100); const v = a.version;
  f.time(1050); a = f.command('advance',a); assert.equal(a.version,v);
  f.time(1100); a = f.command('advance',a); assert.equal(a.phase,'completed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_activity_log').get().n,4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_domain_events').get().n,4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims').get().n,0);
  assert.throws(() => f.command('start',a), { code: 'TERMINAL_ACTION' });
});

test('move_to cannot complete from elapsed time, only authoritative arrival at matching target', t => {
  const f = fixture(t); let a = f.create({type:'move_to',target:'workshop',payload:{}});
  a=f.command('reserve',a); a=f.command('start',a); assert.equal(a.dueAt,null);
  f.time(1500); a=f.command('advance',a); assert.equal(a.phase,'running');
  f.fact.arrived=true; f.fact.locationKey='wrong'; a=f.command('advance',a); assert.equal(a.phase,'running');
  f.fact.locationKey='workshop'; a=f.command('advance',a); assert.equal(a.phase,'completed');
});

test('idempotency stable JSON and payload conflict including command/version', t => {
  const f=fixture(t); const input={...f.scope,actorId:'a',type:'rest',payload:{durationMs:10,resources:[]},idempotencyKey:'once'};
  const a=f.runner.create(input);
  assert.deepEqual(f.runner.create({...input,payload:{resources:[],durationMs:10}}),a);
  assert.throws(() => f.runner.create({...input,payload:{durationMs:20}}),{code:'IDEMPOTENCY_CONFLICT'});
  const c={...f.scope,actionId:a.id,expectedVersion:a.version,idempotencyKey:'reserve-once'};
  const reserved=f.runner.reserve(c); assert.deepEqual(f.runner.reserve(c),reserved);
  assert.throws(() => f.runner.start(c),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(() => f.command('start',a),{code:'VERSION_CONFLICT'});
});

test('exclusive station and actor claims, partial resource acquisition rolls back, cancel releases', t => {
  const f=fixture(t); let a=f.create({payload:{durationMs:10,resources:['z']}}); a=f.command('reserve',a);
  const b=f.create({actorId:'b',payload:{durationMs:10,resources:['a','z']}});
  assert.throws(() => f.command('reserve',b),{code:'RESOURCE_BUSY'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims WHERE action_id=?').get(b.id).n,0);
  const same=f.create(); assert.throws(() => f.command('reserve',same),{code:'RESOURCE_BUSY'});
  a=f.command('cancel',a,{reasonCode:'USER_CANCELLED'});
  assert.equal(f.command('reserve',b).phase,'reserved'); assert.equal(a.phase,'cancelled');
});

test('work requires arrival and attendance; explicitly no economic settlement', t => {
  const f=fixture(t); let a=f.create({type:'work_shift',target:'shop',payload:{durationMs:100}});
  a=f.command('reserve',a); assert.throws(() => f.command('start',a),{code:'NOT_ARRIVED'});
  f.fact.arrived=true; f.fact.locationKey='shop'; a=f.command('start',a);
  f.time(1100); a=f.command('advance',a);
  assert.deepEqual(a.result,{attendanceMs:100,completedAt:1100,economicEffects:'none',settlement:'not_implemented'});
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'economy_%'").get().n,0);
});

test('target removal, schedule interruption and leaving work fail with resource release', t => {
  for (const change of [{targetExists:false},{allowsAction:false},{arrived:false},{failureReason:'PATH_UNREACHABLE'}]) {
    const f=fixture(t); f.fact.arrived=true; f.fact.locationKey='shop';
    let a=f.create({type:'work_shift',target:'shop',payload:{durationMs:100}});
    a=f.command('reserve',a); a=f.command('start',a); Object.assign(f.fact,change);
    a=f.command('advance',a); assert.equal(a.phase,'failed'); assert.ok(a.failureReason);
    assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims').get().n,0);
  }
});

test('restart preserves action, recovery fences expired/stolen claims, epoch rejects old requests', t => {
  const f=fixture(t); let a=f.create(); a=f.command('reserve',a); a=f.command('start',a);
  f.restart(); a=f.command('recover',a); assert.equal(a.phase,'running');
  f.time(2001); assert.throws(() => f.command('advance',a),{code:'LEASE_LOST'});
  a=f.command('recover',a); assert.equal(a.failureReason,'LEASE_EXPIRED');
  f.epoch(2); assert.throws(() => f.command('cancel',a,{reasonCode:'cancel'}),{code:'STALE_EPOCH'});
});

test('event failure rolls back state, lease, log and request receipt atomically', t => {
  const f=fixture(t); const a=f.create();
  f.db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON town_domain_events BEGIN SELECT RAISE(ABORT,'injected event failure'); END");
  assert.throws(() => f.command('reserve',a),/injected event failure/);
  assert.deepEqual(f.runner.get(a.id),a);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_resource_claims').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_activity_log').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_action_requests').get().n,1);
});

test('stale facts cannot start, unsupported production and money payloads rejected', t => {
  const f=fixture(t); let a=f.create(); a=f.command('reserve',a);
  f.fact.worldEpoch=0; assert.throws(() => f.command('start',a),{code:'STALE_FACTS'});
  assert.throws(() => f.create({type:'produce'}),{code:'UNSUPPORTED_ACTION'});
  assert.throws(() => f.create({payload:{durationMs:10,wages:100}}),{code:'UNKNOWN_PAYLOAD_FIELD'});
});

test('registry integration rejects retired aliases and inactive actors; reset cancels before epoch atomically',t=>{
  const db=new Database(':memory:'); t.after(()=>db.close()); db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO characters VALUES(1); INSERT INTO town_npcs VALUES(1,NULL,1);
    INSERT INTO town_characters VALUES(1,1);`);
  migrateTownSchema(db); migrateTownActionSchema(db);
  const registry=createTownActorRegistry(db); const {worldId,epoch:worldEpoch}=registry.getWorldState();
  const old=registry.resolveAgentKey('char:1').actorId;
  registry.linkNpcCharacter(1,1);
  const actorId=registry.resolveAgentKey('npc:1').actorId;
  const runner=createTownActionRunner({db,clock:{now:()=>100},getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,
    readFacts:a=>({worldEpoch,actorId:a.actorId,allowsAction:true})});
  const input={worldId,worldEpoch,actorId,type:'wait',payload:{durationMs:10},idempotencyKey:'create'};
  assert.throws(()=>runner.create({...input,actorId:old}),{code:'ACTOR_UNAVAILABLE'});
  db.prepare('UPDATE town_actors SET participating=0 WHERE actor_id=?').run(actorId);
  assert.throws(()=>runner.create(input),{code:'ACTOR_UNAVAILABLE'});
  db.prepare('UPDATE town_actors SET participating=1 WHERE actor_id=?').run(actorId);
  const action=runner.create(input);
  const reserved=runner.reserve({worldId,worldEpoch,actionId:action.id,expectedVersion:1,idempotencyKey:'reserve'});
  const cancel={worldId,worldEpoch,reasonCode:'WORLD_RESET',idempotencyKey:'reset'};
  assert.throws(()=>db.transaction(()=>{
    runner.cancelActive(cancel); registry.advanceEpoch({expectedEpoch:worldEpoch}); throw new Error('reset failed');
  })(),/reset failed/);
  assert.deepEqual(runner.get(action.id),reserved); assert.equal(registry.getWorldEpoch(worldId),worldEpoch);
  db.transaction(()=>{
    assert.equal(runner.cancelActive(cancel).count,1); registry.advanceEpoch({expectedEpoch:worldEpoch});
  })();
  assert.equal(runner.get(action.id).phase,'cancelled');
  assert.equal(db.prepare('SELECT count(*) n FROM town_resource_claims').get().n,0);
  assert.throws(()=>runner.create(input),{code:'STALE_EPOCH'});
});
