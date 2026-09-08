import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {migrateTownSchema} from '../src/db/townSchema.js';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {migrateTownEconomySchema} from '../src/db/townEconomySchema.js';
import {migrateTownBusinessSchema} from '../src/db/townBusinessSchema.js';
import {migrateTownItemTemplateSchema} from '../src/db/townItemTemplateSchema.js';
import {migrateTownServiceSessionSchema} from '../src/db/townServiceSessionSchema.js';
import {migrateTownExperienceSchema} from '../src/db/townExperienceSchema.js';
import {createTownActorRegistry} from '../src/services/town/townActorRegistry.js';
import {createEconomyService} from '../src/services/town/economyService.js';
import {createTownBusinessService} from '../src/services/town/townBusinessService.js';
import {createTownOrderService} from '../src/services/town/townOrderService.js';
import {createItemTemplateService} from '../src/services/town/itemTemplateService.js';
import {createTownServiceSessionService} from '../src/services/town/townServiceSessionService.js';
import {createTownEventService} from '../src/services/town/townEventService.js';
import {createTownExperienceService,TOWN_EXPERIENCE_CONSUMER} from '../src/services/town/townExperienceService.js';

function fixture(t,{linked=true,writeMemory,memoryEnabled}={}) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');t.after(()=>db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    CREATE TABLE messages(id INTEGER PRIMARY KEY);CREATE TABLE raw_messages(id INTEGER PRIMARY KEY);
    CREATE TABLE audit_memories(id INTEGER PRIMARY KEY,conversation_id TEXT,dedupe_key TEXT NOT NULL,judgment TEXT,request_json TEXT,
      source_msg_id INTEGER REFERENCES messages(id),source_raw_start_id INTEGER REFERENCES raw_messages(id),
      source_raw_end_id INTEGER REFERENCES raw_messages(id),UNIQUE(conversation_id,dedupe_key));
    CREATE TABLE backpack_items(id INTEGER PRIMARY KEY AUTOINCREMENT,effect_key TEXT,name TEXT,description TEXT,
      rarity TEXT,image_url TEXT,status TEXT,payload_json TEXT,collected_at TEXT,acquired_at TEXT,used_at TEXT);
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,item_id INTEGER);`);
  if(linked)db.exec('INSERT INTO characters VALUES(11);INSERT INTO town_characters VALUES(11,1)');
  db.prepare('INSERT INTO town_npcs VALUES(1,NULL,1),(2,NULL,1),(3,?,1)').run(linked?11:null);
  migrateTownSchema(db);migrateTownActionSchema(db);migrateTownEconomySchema(db);migrateTownBusinessSchema(db);
  migrateTownItemTemplateSchema(db);migrateTownServiceSessionSchema(db);migrateTownExperienceSchema(db);migrateTownExperienceSchema(db);
  const registry=createTownActorRegistry(db),world=registry.getWorldState(),scope={worldId:world.worldId,worldEpoch:world.epoch};
  const player=registry.resolveAgentKey('me'),provider=registry.resolveAgentKey('npc:3');
  let time=Date.UTC(2026,8,8,12),sequence=0;const clock={now:()=>time};const flags={enabled:true,failWrite:false};
  const locations=new Set(['board','supplier','workshop']),positions=new Map([[player.actorId,'board'],[provider.actorId,'workshop']]);
  const position={getLocation:({locationKey})=>locations.has(locationKey)?{locationKey}:null,
    hasArrived:({actorId,locationKey})=>positions.get(actorId)===locationKey,isServiceOpen:()=>true};
  const command=extra=>({...scope,idempotencyKey:`exp:${++sequence}`,sourceKey:`exp-source:${sequence}`,reasonCode:'FIXTURE',...extra});
  const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
  const dependencies={db,clock,registry,economy,position};
  const business=createTownBusinessService(dependencies),orders=createTownOrderService(dependencies);
  const config=business.setup(command({npcActorIds:{commissioner:registry.resolveAgentKey('npc:1').actorId,
    supplier:registry.resolveAgentKey('npc:2').actorId,workshop:provider.actorId},locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}}));
  economy.transfer(command({fromAccountId:config.accounts.fund,toAccountId:config.accounts.player,amount:100}));
  const templates=createItemTemplateService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,
    effectRegistry:{mood_fix:{kind:'mood'},energy:{kind:'buff'}}});
  const services=createTownServiceSessionService({...dependencies,itemTemplates:templates,
    getWorkshop:()=>({accountId:config.accounts.workshop,stockId:config.stocks.workshop,actorId:provider.actorId,locationKey:'workshop'})});
  const eventStore=createTownEventService({db,clock,getWorldEpoch:registry.getWorldEpoch,
    validators:{'town.delivery.changed':()=>true,'town.service.settled':()=>true}});
  const queue=event=>{eventStore.append(event,[TOWN_EXPERIENCE_CONSUMER]);return event;};
  const writer=input=>{
    assert.equal(db.inTransaction,true,'memory writer must share event-consumer transaction');
    assert.equal(input.sourceMessageId,null);assert.equal(input.sourceRawStartId,null);assert.equal(input.sourceRawEndId,null);
    assert.equal(typeof input.dedupeKey,'string');assert.ok(input.dedupeKey.length>0);
    const ids=[];
    for(const action of input.actions) {
      assert.equal(action.action,'create');
      assert.ok(!action.memory.judgment.includes(input.dedupeKey),'visible judgment must not expose technical source ID');
      const result=db.prepare(`INSERT OR IGNORE INTO audit_memories(conversation_id,dedupe_key,judgment,request_json,source_msg_id,source_raw_start_id,source_raw_end_id)
        VALUES(?,?,?,?,?,?,?)`).run(input.conversationId,input.dedupeKey,action.memory.judgment,JSON.stringify(input),input.sourceMessageId,input.sourceRawStartId,input.sourceRawEndId);
      if(result.changes)ids.push({memory_id:`memory:${result.lastInsertRowid}`});
    }
    if(flags.failWrite)throw new Error('writer failed after insert');
    return ids;
  };
  const create=()=>createTownExperienceService({db,clock,registry,writeMemory:writeMemory??writer,memoryEnabled:memoryEnabled??(()=>flags.enabled)});
  const experience=create();
  function delivery() {
    let order=orders.publish(command()).order;
    for(const [method,location] of [['accept','board'],['pickup','supplier'],['complete','workshop']]) {
      positions.set(player.actorId,location);
      order=orders[method](command({actorId:player.actorId,orderId:order.orderId,expectedVersion:order.version})).order;
    }
    return queue(eventStore.get(`delivery:${order.orderId}:${order.version}`));
  }
  async function service() {
    economy.transferStock(command({fromStockId:config.stocks.supplier,toStockId:config.stocks.workshop,amount:1}));
    positions.set(player.actorId,'workshop');const quote=services.offer(command({actorId:player.actorId}));
    let value=services.accept(command({actorId:player.actorId,sessionId:quote.sessionId,expectedVersion:quote.version}));
    for(const intentKey of ['choose_theme','confirm_materials','craft','deliver']) value=await services.turn({...scope,actorId:player.actorId,
      sessionId:value.sessionId,expectedVersion:value.version,clientTurnId:`turn:${++sequence}`,intentKey});
    return queue(eventStore.get(`service:${value.sessionId}:settled`));
  }
  const memoryRows=()=>db.prepare('SELECT * FROM audit_memories ORDER BY id').all();
  const rows=()=>db.prepare('SELECT * FROM town_experiences ORDER BY rowid').all();
  const balances=()=>db.prepare('SELECT * FROM economy_accounts ORDER BY account_id').all();
  return {db,scope,registry,clock,player,provider,flags,eventStore,queue,experience,create,delivery,service,memoryRows,rows,balances,
    advance:ms=>{time+=ms;},setTime:ms=>{time=ms;}};
}

test('real delivery/service source rows produce private participant memories with null original-history references',async t=>{
  const f=fixture(t);f.delivery();await f.service();
  const balances=f.balances();f.experience.drain(f.scope,100);
  assert.equal(f.rows().length,4);assert.equal(f.memoryRows().length,2);
  assert.ok(f.rows().every(r=>[f.player.actorId,f.provider.actorId].includes(r.actor_id)));
  for(const memory of f.memoryRows()) {
    assert.equal(memory.conversation_id,'char_11');assert.equal(memory.source_msg_id,null);
    assert.equal(memory.source_raw_start_id,null);assert.equal(memory.source_raw_end_id,null);
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM messages').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,0);
  assert.deepEqual(f.balances(),balances);assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

test('repeat append, repeat delivery and recreated consumer never duplicate a memory or experience',t=>{
  const f=fixture(t),event=f.delivery();f.experience.drain(f.scope,100);const before=f.memoryRows();
  f.queue(event);assert.equal(f.experience.drain(f.scope,100),0);
  // Simulate a transport replay after committed effects but a lost acknowledgement.
  f.db.prepare("UPDATE town_event_deliveries SET status='pending',attempts=0 WHERE event_id=? AND consumer_key=?").run(event.eventId,TOWN_EXPERIENCE_CONSUMER);
  f.create().drain(f.scope,100);assert.deepEqual(f.memoryRows(),before);assert.equal(f.rows().length,2);
});

test('writer failure rolls back every participant and memory insert; outbox retry succeeds once',t=>{
  const f=fixture(t),event=f.delivery();f.flags.failWrite=true;
  f.experience.drain(f.scope,100);assert.equal(f.rows().length,0);assert.equal(f.memoryRows().length,0);
  assert.equal(f.db.prepare('SELECT status FROM town_event_deliveries WHERE event_id=?').get(event.eventId).status,'pending');
  f.flags.failWrite=false;f.advance(1001);f.experience.drain(f.scope,100);
  assert.equal(f.rows().length,2);assert.equal(f.memoryRows().length,1);
});

test('old epoch cannot drain and current epoch never claims prior pending events',t=>{
  const f=fixture(t);f.delivery();f.registry.advanceEpoch({expectedEpoch:f.scope.worldEpoch});
  assert.throws(()=>f.experience.drain(f.scope),{code:'STALE_EPOCH'});
  assert.equal(f.experience.drain({...f.scope,worldEpoch:f.scope.worldEpoch+1}),0);
  assert.equal(f.rows().length,0);assert.equal(f.memoryRows().length,0);
});

test('forged amounts never pay money; a different event ID cannot reuse a valid settled source',t=>{
  const f=fixture(t),event=f.delivery();const balances=f.balances();
  const forged={...event,eventId:'forged-delivery',rootEventId:'forged-delivery',payload:{...event.payload,reward:999999999}};
  f.queue(forged);f.experience.drain(f.scope,100);
  assert.deepEqual(f.balances(),balances);assert.equal(f.rows().length,2);assert.equal(f.memoryRows().length,1);
  const delivery=f.db.prepare('SELECT last_error FROM town_event_deliveries WHERE event_id=?').get(forged.eventId);
  assert.equal(delivery.last_error,'EXPERIENCE_SOURCE_INVALID');
  assert.ok(!f.memoryRows()[0].judgment.includes('999999999'));
});

test('service event alias and altered source entity fail stable settlement identity checks',async t=>{
  const f=fixture(t),event=await f.service();
  f.queue({...event,eventId:'forged-service',rootEventId:'forged-service',source:{system:'town.service',entityId:'another-session'}});
  f.experience.drain(f.scope,100);assert.equal(f.rows().length,2);assert.equal(f.memoryRows().length,1);
  assert.equal(f.db.prepare("SELECT last_error FROM town_event_deliveries WHERE event_id='forged-service'").get().last_error,'EXPERIENCE_SOURCE_INVALID');
});

test('lightweight NPC records its experience without creating a character or invoking memory writer',t=>{
  let calls=0;const f=fixture(t,{linked:false,writeMemory:()=>{calls++;throw new Error('must not run');}});
  f.delivery();f.experience.drain(f.scope,100);
  assert.equal(calls,0);assert.equal(f.rows().length,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM characters').get().n,0);
  assert.ok(f.rows().every(row=>row.character_id===null));
});

test('12 source-UTC-day cap per actor survives replay; next UTC day admits a new experience',t=>{
  const f=fixture(t);f.setTime(Date.UTC(2026,8,8,23,59));
  for(let i=0;i<13;i++)f.delivery();f.experience.drain(f.scope,100);
  assert.equal(f.rows().length,24);assert.equal(f.memoryRows().length,12,'distinct real source keys must preserve otherwise identical judgments');
  assert.equal(new Set(f.memoryRows().map(row=>row.judgment)).size,1);
  assert.equal(new Set(f.memoryRows().map(row=>row.dedupe_key)).size,12);
  f.setTime(Date.UTC(2026,8,9,0,0));f.delivery();f.experience.drain(f.scope,100);
  assert.equal(f.rows().length,26);assert.equal(f.memoryRows().length,13);
});

test('public/presentation-only input never creates private memories; disabled memory preserves local experience only',t=>{
  const f=fixture(t),event=f.delivery();
  // Only enqueue non-business presentation copies; leave the real event for the disabled-policy check.
  f.db.prepare("UPDATE town_event_deliveries SET status='done' WHERE event_id=?").run(event.eventId);
  f.queue({...event,eventId:'public-copy',rootEventId:'public-copy',visibility:'public'});
  f.queue({...event,eventId:'presentation-copy',rootEventId:'presentation-copy',presentationOnly:true});
  f.experience.drain(f.scope,100);assert.equal(f.rows().length,0);assert.equal(f.memoryRows().length,0);
  f.db.prepare("UPDATE town_event_deliveries SET status='pending' WHERE event_id=?").run(event.eventId);f.flags.enabled=false;
  f.experience.drain(f.scope,100);assert.equal(f.rows().length,2);assert.equal(f.memoryRows().length,0);
});

test('missing participants roll back the earlier player entry; async writer is rejected before invocation',t=>{
  const f=fixture(t),event=f.delivery();
  f.db.prepare('UPDATE town_domain_events SET envelope=? WHERE event_id=?')
    .run(JSON.stringify({...event,actorIds:[f.player.actorId]}),event.eventId);
  f.experience.drain(f.scope,100);assert.equal(f.rows().length,0);assert.equal(f.memoryRows().length,0);
  assert.equal(f.db.prepare('SELECT last_error FROM town_event_deliveries WHERE event_id=?').get(event.eventId).last_error,'EXPERIENCE_PARTICIPANT_INVALID');
  let called=false;const g=fixture(t,{writeMemory:async()=>{called=true;return [];}});g.delivery();g.experience.drain(g.scope,100);
  assert.equal(called,false);assert.equal(g.rows().length,0);
});

test('invalid drain size rejects and unknown/non-completed events do not authorize experiences',t=>{
  const f=fixture(t);assert.throws(()=>f.experience.drain(f.scope,0),{code:'INVALID_PAGE'});
  f.queue({eventId:'unsettled-service',worldId:f.scope.worldId,worldEpoch:f.scope.worldEpoch,type:'town.service.settled',payload:{sessionId:'missing',status:'cancelled'}});
  f.experience.drain(f.scope,100);assert.equal(f.rows().length,0);assert.equal(f.memoryRows().length,0);
});
