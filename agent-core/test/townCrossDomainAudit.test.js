/** Cross-domain audit regressions, promoted after owners fixed the reproduced issues.
 * All DBs are in memory;
 * no production module/database, model, HTTP or generation adapter is imported.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {migrateTownSchema} from '../src/db/townSchema.js';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {migrateTownEconomySchema} from '../src/db/townEconomySchema.js';
import {migrateTownBusinessSchema} from '../src/db/townBusinessSchema.js';
import {migrateTownItemTemplateSchema} from '../src/db/townItemTemplateSchema.js';
import {migrateTownServiceSessionSchema} from '../src/db/townServiceSessionSchema.js';
import {createTownActorRegistry} from '../src/services/town/townActorRegistry.js';
import {createTownActionRunner} from '../src/services/town/townActionRunner.js';
import {createEconomyService} from '../src/services/town/economyService.js';
import {createTownBusinessService} from '../src/services/town/townBusinessService.js';
import {createItemTemplateService} from '../src/services/town/itemTemplateService.js';
import {createTownServiceSessionService,WORKSHOP_SERVICE} from '../src/services/town/townServiceSessionService.js';

function fixture(t) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');t.after(()=>db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    INSERT INTO town_npcs VALUES(1,NULL,1),(2,NULL,1),(3,NULL,1);
    CREATE TABLE backpack_items(id INTEGER PRIMARY KEY AUTOINCREMENT,effect_key TEXT,name TEXT,description TEXT,
      rarity TEXT,image_url TEXT,status TEXT,payload_json TEXT,collected_at TEXT,acquired_at TEXT,used_at TEXT);
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,item_id INTEGER);`);
  migrateTownSchema(db);migrateTownActionSchema(db);migrateTownEconomySchema(db);migrateTownBusinessSchema(db);
  migrateTownItemTemplateSchema(db);migrateTownServiceSessionSchema(db);
  const registry=createTownActorRegistry(db),world=registry.getWorldState(),scope={worldId:world.worldId,worldEpoch:world.epoch};
  const player=registry.resolveAgentKey('me'),provider=registry.resolveAgentKey('npc:3');
  let now=1000,sequence=0;const clock={now:()=>now};
  const locations=new Set(['board','supplier','workshop']),positions=new Map([[player.actorId,'workshop'],[provider.actorId,'workshop']]);
  const position={getLocation:({locationKey})=>locations.has(locationKey)?{locationKey}:null,
    hasArrived:({actorId,locationKey})=>positions.get(actorId)===locationKey,isServiceOpen:()=>true};
  const command=extra=>({...scope,idempotencyKey:`audit:${++sequence}`,sourceKey:`audit-source:${sequence}`,reasonCode:'AUDIT',...extra});
  const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
  const business=createTownBusinessService({db,clock,registry,economy,position});
  const config=business.setup(command({npcActorIds:{commissioner:registry.resolveAgentKey('npc:1').actorId,
    supplier:registry.resolveAgentKey('npc:2').actorId,workshop:provider.actorId},locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}}));
  economy.transfer(command({fromAccountId:config.accounts.fund,toAccountId:config.accounts.player,amount:100}));
  // The template service requires an effect registry; no effect is executed in this audit.
  const itemTemplates=createItemTemplateService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,economy,
    effectRegistry:{mood_fix:{kind:'mood'},energy:{kind:'buff'}}});itemTemplates.ensureDefaultTemplates(scope);
  const service=createTownServiceSessionService({db,clock,registry,economy,position,itemTemplates,
    getWorkshop:()=>({accountId:config.accounts.workshop,stockId:config.stocks.workshop,actorId:provider.actorId,locationKey:'workshop'})});
  economy.transferStock(command({fromStockId:config.stocks.supplier,toStockId:config.stocks.workshop,amount:2}));
  const offer=()=>service.offer(command({actorId:player.actorId}));
  const accept=value=>service.accept(command({actorId:player.actorId,sessionId:value.sessionId,expectedVersion:value.version}));
  const turn=(value,intentKey)=>service.turn({...scope,actorId:player.actorId,sessionId:value.sessionId,
    expectedVersion:value.version,clientTurnId:`turn:${++sequence}`,intentKey});
  return {db,registry,scope,clock,position,positions,player,provider,config,economy,business,itemTemplates,service,command,offer,accept,turn,
    advance:ms=>{now+=ms;}};
}

test('[audit verified] service acceptance does not double-book an actor already owned by a persistent action',t=>{
    const f=fixture(t);
    const runner=createTownActionRunner({db:f.db,clock:f.clock,getWorldEpoch:f.registry.getWorldEpoch,getActor:f.registry.getActor,
      readFacts:a=>({worldEpoch:f.scope.worldEpoch,actorId:a.actorId,allowsAction:true,targetExists:true,arrived:true,locationKey:'workshop'})});
    let action=runner.create(f.command({actorId:f.provider.actorId,type:'work_shift',target:'workshop',payload:{durationMs:10000}}));
    action=runner.reserve(f.command({actionId:action.id,expectedVersion:action.version}));
    action=runner.start(f.command({actionId:action.id,expectedVersion:action.version}));
    const quote=f.offer();let accepted=null;
    try {accepted=f.accept(quote);}catch(error){assert.match(error.code??error.message,/BUSY|RESOURCE|OCCUPIED/);}
    const concurrent=f.db.prepare("SELECT count(*) n FROM town_actions WHERE actor_id=? AND status='running'").get(f.provider.actorId).n+
      f.db.prepare("SELECT count(*) n FROM town_service_sessions WHERE provider_actor_id=? AND status='active'").get(f.provider.actorId).n;
    assert.equal(concurrent,1,`actor has ${concurrent} simultaneous activities; paid session=${accepted?.sessionId}`);
  });

test('[audit verified] business slice workshop account is compatible with the item trade owner contract',t=>{
    const f=fixture(t),account=f.economy.getAccount({...f.scope,accountId:f.config.accounts.workshop});
    const item=f.itemTemplates.grant(f.command({templateId:'town.mood_patch',templateVersion:1,ownerKey:account.ownerKey,quantity:1,
      sourceType:'production',sourceId:'audit:workshop:batch1'})).items[0];
    assert.doesNotThrow(()=>f.itemTemplates.trade(f.command({itemId:item.id,ownerKey:item.ownerKey,toOwnerKey:'me',expectedVersion:item.version,
      fromAccountId:f.config.accounts.player,toAccountId:account.accountId,amount:30})),
    `actual business account owner=${account.ownerKey}, valid item owner=${item.ownerKey}`);
  });

test('[audit verified] background recovery fully refunds provider departure before evaluating idle expiry',async t=>{
    const f=fixture(t);let value=f.accept(f.offer());
    value=await f.turn(value,'choose_theme');value=await f.turn(value,'confirm_materials');
    assert.equal(value.materialsConsumed,true);
    f.positions.set(f.provider.actorId,'elsewhere'); // Player remains at the workshop.
    f.advance(WORKSHOP_SERVICE.idleMs+1);f.service.recover(f.scope);
    value=f.service.get({...f.scope,actorId:f.player.actorId,sessionId:value.sessionId});
    assert.equal(value.settlement.refund,30,`provider gone: status=${value.status}, reason=${value.settlement.reason}, payout=${value.settlement.payout}`);
    assert.equal(value.status,'failed');
  });

test('[audit verified] multi-domain rebuild rollback restores escrow/holds/items/actions/epoch together',t=>{
  const f=fixture(t);const accepted=f.accept(f.offer());
  const item=f.itemTemplates.grant(f.command({templateId:'town.mood_patch',templateVersion:1,ownerKey:'me',quantity:1,
    sourceType:'reward',sourceId:'audit:reset:retained-item'})).items[0];
  f.itemTemplates.lock(f.command({itemId:item.id,ownerKey:'me',expectedVersion:item.version,lockKey:'audit:reset:lock'}));
  f.economy.reserve(f.command({accountId:f.config.accounts.fund,amount:10,ownerRef:'audit:reset:reserve'}));
  const runner=createTownActionRunner({db:f.db,clock:f.clock,getWorldEpoch:f.registry.getWorldEpoch,getActor:f.registry.getActor,readFacts:()=>({})});
  let action=runner.create(f.command({actorId:f.registry.resolveAgentKey('npc:1').actorId,type:'wait',payload:{durationMs:1000}}));
  action=runner.reserve(f.command({actionId:action.id,expectedVersion:action.version}));
  const tables=['town_world_state','economy_accounts','economy_entries','economy_reservations','economy_transactions','economy_requests',
    'town_service_sessions','town_service_settlements','backpack_items','town_item_transactions','town_item_requests',
    'town_actions','town_resource_claims','town_action_requests','town_domain_events','town_event_deliveries'];
  const snapshot=()=>tables.map(table=>f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before=snapshot();
  const clean=()=>{
    runner.cancelActive(f.command({reasonCode:'WORLD_RESET'}));
    f.service.failForRebuild(f.scope);
    f.itemTemplates.releaseLocks(f.command({reasonCode:'WORLD_RESET'}));
    f.economy.releaseActive(f.command({reasonCode:'WORLD_RESET'}));
    f.registry.advanceEpoch({expectedEpoch:f.scope.worldEpoch});
  };
  assert.throws(()=>f.db.transaction(()=>{clean();throw new Error('last reset write failed');})(),/last reset write failed/);
  assert.deepEqual(snapshot(),before);
  f.db.transaction(clean)();
  const current={worldId:f.scope.worldId,worldEpoch:f.scope.worldEpoch+1};
  assert.equal(f.registry.getWorldEpoch(f.scope.worldId),current.worldEpoch);
  assert.equal(f.economy.getAccount({...current,accountId:f.config.accounts.player}).balance,100);
  assert.equal(f.economy.getAccount({...current,accountId:f.config.accounts.player}).reserved,0);
  assert.equal(f.itemTemplates.getItem({...current,itemId:item.id}).lockedBy,null);
  assert.equal(f.db.prepare('SELECT status FROM town_service_sessions WHERE session_id=?').get(accepted.sessionId).status,'failed');
  assert.throws(()=>f.service.cancel(f.command({actorId:f.player.actorId,sessionId:accepted.sessionId,expectedVersion:accepted.version})),{code:'STALE_EPOCH'});
  assert.throws(()=>f.itemTemplates.grant(f.command({templateId:'town.mood_patch',templateVersion:1,ownerKey:'me',quantity:1,
    sourceType:'reward',sourceId:'audit:late-callback'})),{code:'STALE_EPOCH'});
  assert.throws(()=>f.economy.transfer(f.command({fromAccountId:f.config.accounts.fund,toAccountId:f.config.accounts.player,amount:30})),{code:'STALE_EPOCH'});
});
