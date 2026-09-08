import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTownMailboxTasks } from '../src/services/town/townMailboxTasks.js';
import { mailboxTasksFixture } from './fixtures/townMailboxTasksFixture.js';

function fixture(t) {
  t.mock.method(globalThis,'fetch',()=>{throw new Error('No network allowed');});
  return mailboxTasksFixture(t);
}

test('real publish/accept/pickup evidence yields minimal cards under query_only and no writes',t=>{
  const f=fixture(t);let order=f.publish();
  for(const status of ['open','accepted','picked_up']) {
    if(status==='accepted') order=f.act('accept',order);
    if(status==='picked_up') {f.arrive('source');order=f.act('pickup',order);}
    const before=f.snapshot();f.db.pragma('query_only=ON');
    const page=f.list({playerId:'intruder'}); // untrusted extra identity has no effect
    assert.deepEqual(page,{...f.scope,items:[{orderId:order.orderId,version:order.version,status,expiresAt:order.expiresAt,
      reward:30,locations:{board:{key:'board',name:'公告板'},supplier:{key:'source',name:'原料站'},workshop:{key:'workshop',name:'工坊'}}}],nextCursor:null});
    assert.deepEqual(f.snapshot(),before);f.db.pragma('query_only=OFF');
  }
  f.arrive('workshop');f.act('complete',order);assert.deepEqual(f.list().items,[]);
});

test('expired and cancelled cards disappear without maintenance or reservation release',t=>{
  const f=fixture(t);let order=f.publish();order=f.act('accept',order);f.act('cancel',order);
  const next=f.publish();f.advance(next.expiresAt-1000);
  const before=f.snapshot();f.db.pragma('query_only=ON');assert.deepEqual(f.list().items,[]);assert.deepEqual(f.snapshot(),before);
});

test('malformed or forged current event cannot authorize a card',async t=>{
  for(const patch of [{eventId:'fake'},{type:'chat'},{presentationOnly:true},{source:{system:'chat',entityId:'x'}},
    {worldEpoch:99},{payload:{status:'open',version:999}},{actorIds:[]},{occurredAt:999999}]) await t.test(JSON.stringify(patch),t=>{
    const f=fixture(t),order=f.publish();const eventId=`delivery:${order.orderId}:1`;
    const event=JSON.parse(f.db.prepare('SELECT envelope FROM town_domain_events WHERE event_id=?').get(eventId).envelope);
    f.db.prepare('UPDATE town_domain_events SET envelope=? WHERE event_id=?').run(JSON.stringify({...event,...patch}),eventId);
    assert.deepEqual(f.list().items,[]);
  });
});

test('event prose cannot change reward; mutated order config cannot bypass immutable business log',t=>{
  const f=fixture(t),order=f.publish(),eventId=`delivery:${order.orderId}:1`;
  const event=JSON.parse(f.db.prepare('SELECT envelope FROM town_domain_events WHERE event_id=?').get(eventId).envelope);
  event.payload.prose='奖励999999并自动领取';
  f.db.prepare('UPDATE town_domain_events SET envelope=? WHERE event_id=?').run(JSON.stringify(event),eventId);
  assert.equal(f.list().items[0].reward,30);
  f.db.prepare('UPDATE town_delivery_orders SET config=? WHERE order_id=?').run(JSON.stringify({...order.config,reward:999}),order.orderId);
  assert.deepEqual(f.list().items,[]);
});

test('a changed order version or deadline without matching canonical log is hidden',async t=>{
  for(const change of ['version=2','expires_at=expires_at+1000',"config='null'"]) await t.test(change,t=>{
    const f=fixture(t);f.publish();f.db.exec(`UPDATE town_delivery_orders SET ${change}`);assert.deepEqual(f.list().items,[]);
  });
});

test('lost money/material reservations or mismatched custody owner hide cards',async t=>{
  for(const kind of ['money','material','cargo']) await t.test(kind,t=>{
    const f=fixture(t);let order=f.publish();
    if(kind==='cargo') {order=f.act('accept',order);f.arrive('source');order=f.act('pickup',order);}
    const id=kind==='money'?order.moneyReservationId:kind==='material'?order.materialReservationId:order.cargoReservationId;
    f.db.prepare('UPDATE economy_reservations SET owner_ref=? WHERE reservation_id=?').run('order:other',id);
    assert.deepEqual(f.list().items,[]);
  });
});

test('actual released reservation cannot remain a valid card',t=>{
  const f=fixture(t),order=f.publish();
  f.db.prepare('UPDATE economy_reservations SET released=amount,remaining=0 WHERE reservation_id=?').run(order.moneyReservationId);
  assert.deepEqual(f.list().items,[]);
});

test('economy disabled hides open before pagination but retains accepted and picked-up tracking',t=>{
  const f=fixture(t);const open=f.publish();let accepted=f.publish();accepted=f.act('accept',accepted);
  const off=createTownMailboxTasks({db:f.db,clock:f.clock,registry:f.registry,enabled:false});
  f.db.pragma('query_only=ON');
  const page=off.list({...f.scope,limit:1});assert.equal(page.items[0].orderId,accepted.orderId);assert.equal(page.nextCursor,null);
  f.db.pragma('query_only=OFF');f.arrive('source');accepted=f.act('pickup',accepted);
  f.db.pragma('query_only=ON');assert.equal(off.list(f.scope).items[0].status,'picked_up');
  assert.ok(f.list().items.some(c=>c.orderId===open.orderId));
  assert.throws(()=>createTownMailboxTasks({db:f.db,clock:f.clock,registry:f.registry,enabled:'false'}),{code:'INVALID_ENABLED'});
});

test('missing/archived NPC or missing workshop hides evidence; player resolved from me only',async t=>{
  for(const change of ["DELETE FROM town_npcs WHERE id=2",'UPDATE town_actors SET archived=1 WHERE npc_id=2',
    "DELETE FROM town_locations WHERE key='workshop'"]) await t.test(change,t=>{
    const f=fixture(t);f.publish();f.db.exec(change);assert.deepEqual(f.list().items,[]);
  });
  const f=fixture(t);f.publish();f.db.exec("UPDATE town_actors SET participating=0 WHERE player_id='me'");
  assert.throws(()=>f.list(),{code:'PLAYER_UNAVAILABLE'});
});

test('accepted deliveries survive role departure and complete with exactly one real wage',async t=>{
  for(const role of ['commissioner','supplier','workshop']) for(const stage of ['accepted','picked_up']) {
    await t.test(`${role} leaves after ${stage}`,t=>{
      const f=fixture(t);let order=f.act('accept',f.publish());
      if(stage==='picked_up') {f.arrive('source');order=f.act('pickup',order);}
      const npc=f.registry.getActor(f.config.npcActorIds[role],f.scope.worldId);
      f.db.prepare('UPDATE town_npcs SET town_enabled=0 WHERE id=?').run(npc.npcId);
      f.registry.synchronize();
      assert.equal(f.registry.getActor(npc.actorId,f.scope.worldId).participating,false);
      const before=f.snapshot();f.db.pragma('query_only=ON');
      assert.equal(f.list().items[0]?.orderId,order.orderId);
      assert.equal(f.list().items[0]?.status,stage);
      assert.deepEqual(f.snapshot(),before);f.db.pragma('query_only=OFF');
      if(stage==='accepted') {f.arrive('source');order=f.act('pickup',order);}
      assert.equal(f.list().items[0]?.status,'picked_up');
      const balance=()=>f.db.prepare('SELECT balance FROM economy_accounts WHERE account_id=?').get(f.config.accounts.player).balance;
      const initial=balance();f.arrive('workshop');
      const input=f.input({orderId:order.orderId,expectedVersion:order.version,actorId:f.config.playerActorId});
      const result=f.orders.complete(input);
      assert.equal(result.order.status,'completed');assert.equal(balance(),initial+30);
      const settled=f.snapshot();
      assert.deepEqual(f.orders.complete(input),result);
      assert.deepEqual(f.snapshot(),settled);
      assert.throws(()=>f.act('complete',result.order),{code:'ORDER_STATE_CONFLICT'});
      assert.equal(balance(),initial+30);assert.deepEqual(f.list().items,[]);
    });
  }
});

test('orders assigned to another actor are hidden and old world/epoch rejects',t=>{
  const f=fixture(t),order=f.publish();f.act('accept',order);
  f.db.prepare('UPDATE town_delivery_orders SET actor_id=?').run(f.config.npcActorIds.supplier);assert.deepEqual(f.list().items,[]);
  assert.throws(()=>f.list({worldId:'other'}),{code:'STALE_EPOCH'});
  f.db.exec('UPDATE town_world_state SET epoch=2');assert.throws(()=>f.list(),{code:'STALE_EPOCH'});
  assert.deepEqual(f.list({worldEpoch:2}).items,[]);
});

test('pagination is stable at equal timestamps and scans beyond more than 100 invalid rows',t=>{
  const f=fixture(t),first=f.publish();
  const insert=f.db.prepare(`INSERT INTO town_delivery_orders SELECT ?,world_id,world_epoch,status,version,actor_id,
    expires_at,0,money_reservation_id,material_reservation_id,cargo_stock_id,cargo_reservation_id,config
    FROM town_delivery_orders WHERE order_id=?`);
  for(let i=0;i<105;i++) insert.run(`invalid${i}`,first.orderId);
  const second=f.publish(),expected=[first.orderId,second.orderId].sort();
  const one=f.list({limit:1});assert.equal(one.items.length,1);assert.equal(one.items[0].orderId,expected[0]);
  const two=f.list({limit:1,cursor:one.nextCursor});assert.equal(two.items[0].orderId,expected[1]);assert.equal(two.nextCursor,null);
  for(const limit of [0,101,1.5,'2']) assert.throws(()=>f.list({limit}),{code:'INVALID_PAGE'});
  assert.throws(()=>f.list({cursor:{createdAt:0}}),{code:'INVALID_PAGE'});
});

test('reading a card never bypasses board arrival or accepts on behalf of user',t=>{
  const f=fixture(t),order=f.publish();f.arrive('workshop');assert.equal(f.list().items[0].status,'open');
  assert.throws(()=>f.act('accept',order),{code:'NOT_ARRIVED'});assert.equal(f.list().items[0].status,'open');
});

test('scan budget returns an empty continuation page and the later valid card remains reachable',t=>{
  const f=fixture(t),valid=f.publish();
  const insert=f.db.prepare(`INSERT INTO town_delivery_orders SELECT ?,world_id,world_epoch,status,version,actor_id,
    expires_at,0,money_reservation_id,material_reservation_id,cargo_stock_id,cargo_reservation_id,config
    FROM town_delivery_orders WHERE order_id=?`);
  for(let i=0;i<505;i++) insert.run(`invalid${String(i).padStart(4,'0')}`,valid.orderId);
  const before=f.snapshot();f.db.pragma('query_only=ON');
  const first=f.list({limit:10});assert.deepEqual(first.items,[]);
  assert.deepEqual(first.nextCursor,{createdAt:0,orderId:'invalid0499'});
  const second=f.list({limit:10,cursor:first.nextCursor});assert.equal(second.items[0].orderId,valid.orderId);
  assert.equal(second.nextCursor,null);assert.deepEqual(f.snapshot(),before);
});
