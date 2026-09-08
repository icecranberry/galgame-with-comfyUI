import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownActionSchema } from '../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../src/db/townEconomySchema.js';
import { migrateTownItemTemplateSchema } from '../src/db/townItemTemplateSchema.js';
import { migrateTownServiceSessionSchema } from '../src/db/townServiceSessionSchema.js';
import { createEconomyService } from '../src/services/town/economyService.js';
import { createTownActionRunner } from '../src/services/town/townActionRunner.js';
import { createItemTemplateService } from '../src/services/town/itemTemplateService.js';
import { createTownServiceSessionService, WORKSHOP_SERVICE } from '../src/services/town/townServiceSessionService.js';
import { buildTownServicePrompt, parseTownServiceResponse } from '../src/services/town/townServicePrompt.js';

function fixture(t, options = {}) {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); t.after(() => { try { reconcile(); } finally { db.close(); } });
  let time = 1000, epoch = 1, sequence = 0;
  const flags = { provider: true, arrived: true, playerArrived: true, providerArrived: true, open: true, grantFails: false, settlementFails: false };
  const registry = { getWorldEpoch: w => w === 'w' ? epoch : null,
    getActor: id => id === 'player' ? { actorId:id,playerId:'me',participating:true,archived:false }
      : id === 'provider' && flags.provider ? { actorId:id,npcExists:true,participating:true,archived:false } : null };
  const clock = { now: () => time };
  migrateTownActionSchema(db); migrateTownEconomySchema(db);
  db.exec(`CREATE TABLE backpack_items (id INTEGER PRIMARY KEY AUTOINCREMENT, effect_key TEXT, name TEXT, description TEXT,
    rarity TEXT, image_url TEXT, status TEXT, payload_json TEXT, collected_at TEXT, acquired_at TEXT, used_at TEXT);
    CREATE TABLE item_effects (id INTEGER PRIMARY KEY,item_id INTEGER);`);
  migrateTownItemTemplateSchema(db); migrateTownServiceSessionSchema(db); migrateTownServiceSessionSchema(db);
  const economy = createEconomyService({ db,clock,getWorldEpoch: registry.getWorldEpoch,getActor: registry.getActor });
  const scope = { worldId:'w',worldEpoch:1 };
  const cmd = () => ({ ...scope,idempotencyKey:`seed:${++sequence}`,sourceKey:`seed:${sequence}`,reasonCode:'FIXTURE' });
  const player = economy.ensureAccount({ ...scope,ownerKey:'actor:player',actorId:'player',accountType:'actor' });
  const workshop = economy.ensureAccount({ ...scope,ownerKey:'workshop',accountType:'business' });
  economy.seed({ ...cmd(),accountId:player.accountId,amount:options.money ?? 100 });
  const stock = economy.ensureStock({ ...scope,ownerKey:'workshop',resourceKey:'delivery:raw_material' });
  economy.seedStock({ ...cmd(),stockId:stock.stockId,amount:options.materials ?? 10 });
  const templates = createItemTemplateService({ db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor,
    effectRegistry:{mood_fix:{kind:'mood'},energy:{kind:'buff'}} });
  const create = (extra = {}) => createTownServiceSessionService({ db,clock,registry,
    economy:{ ...economy,transfer: input => {
      if (flags.settlementFails && /:(payout|refund)$/.test(input.sourceKey)) throw new Error('fixture settlement failure');
      return economy.transfer(input);
    } },
    position:{ getLocation: input => ({locationKey:input.locationKey}),
      hasArrived: input => flags.arrived && (input.actorId==='provider'?flags.providerArrived:flags.playerArrived),isServiceOpen: () => flags.open },
    itemTemplates:{ ...templates,grant: input => { const result = templates.grant(input); if (flags.grantFails) throw new Error('fixture grant failure'); return result; } },
    getWorkshop: () => ({ accountId:workshop.accountId,stockId:stock.stockId,actorId:'provider',locationKey:'workshop' }), ...extra });
  const service = create();
  const input = (extra = {}) => ({ ...scope,actorId:'player',idempotencyKey:`request:${++sequence}`,...extra });
  const open = () => { const quote=service.offer(input()); return service.accept(input({sessionId:quote.sessionId,expectedVersion:quote.version})); };
  const turnInput = (value,intentKey) => ({ ...scope,actorId:'player',sessionId:value.sessionId,expectedVersion:value.version,clientTurnId:`turn:${++sequence}`,intentKey });
  const turn = (value,intentKey) => service.turn(turnInput(value,intentKey));
  const balance = accountId => economy.getAccount({...scope,accountId}).balance;
  const material = () => economy.getStock({...scope,stockId:stock.stockId});
  const reconcile = () => {
    for (const tx of db.prepare('SELECT transaction_id FROM economy_transactions').all()) {
      assert.equal(db.prepare('SELECT amount FROM economy_entries WHERE transaction_id=?').all(tx.transaction_id).reduce((sum,e)=>sum+e.amount,0),0);
    }
    for (const a of db.prepare('SELECT * FROM economy_accounts').all()) {
      assert.equal(db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM economy_entries WHERE account_id=?').get(a.account_id).n,a.balance);
      if (a.account_type !== 'issuance') assert.ok(a.balance >= a.reserved && a.reserved >= 0);
    }
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  };
  return { db,service,create,input,open,turn,turnInput,flags,scope,registry,clock,balance,material,player,workshop,
    advance: ms => { time+=ms; }, setEpoch: n => {epoch=n;} };
}

test('complete local flow escrows 30, reserves/consumes one material, grants one ready mood item without executing it', async t => {
  const f=fixture(t); let value=f.open();
  assert.equal(f.balance(f.player.accountId),70); assert.equal(f.balance(f.workshop.accountId),0);
  assert.equal(f.material().reserved,1); assert.equal(f.material().quantity,10);
  for (const intent of ['choose_theme','confirm_materials','craft','deliver']) value=await f.turn(value,intent);
  assert.equal(value.status,'completed'); assert.deepEqual(value.choices,[]);
  assert.equal(value.settlement.payout,30); assert.equal(value.settlement.refund,0);
  assert.equal(f.material().quantity,9); assert.equal(f.material().reserved,0);
  assert.equal(f.balance(f.workshop.accountId),30);
  assert.equal(f.db.prepare("SELECT SUM(balance) AS n FROM economy_accounts WHERE account_type='escrow'").get().n,0);
  const item=f.db.prepare('SELECT * FROM backpack_items').get();
  assert.equal(item.effect_key,'mood_fix'); assert.equal(item.status,'ready'); assert.equal(item.owner_key,'me');
  assert.equal(item.source_type,'service'); assert.equal(item.source_id,`service:${value.sessionId}:outcome:mood_patch`);
  assert.ok(item.collected_at); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM item_effects').get().n,0);
  assert.throws(()=>f.db.prepare("UPDATE town_service_sessions SET status='active' WHERE session_id=?").run(value.sessionId),/SESSION_CLOSED/);
  await assert.rejects(f.turn(value,'clarify'),e=>e.code==='SESSION_CLOSED');
});

test('before material consumption cancellation refunds all; after consumption charges 10 and refunds 20', async t => {
  for (const consumed of [false,true]) {
    const f=fixture(t); let value=f.open();
    if (consumed) { value=await f.turn(value,'choose_theme'); value=await f.turn(value,'confirm_materials'); }
    const request=f.input({sessionId:value.sessionId,expectedVersion:value.version});
    value=f.service.cancel(request);
    assert.equal(value.status,'cancelled'); assert.equal(value.settlement.refund,consumed?20:30);
    assert.equal(f.balance(f.player.accountId),consumed?90:100); assert.equal(f.balance(f.workshop.accountId),consumed?10:0);
    assert.equal(f.material().reserved,0); assert.equal(f.material().quantity,consumed?9:10);
    assert.deepEqual(f.service.cancel(request),value);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_service_settlements').get().n,1);
  }
});

test('accept is idempotent, conflicts reject, business-supplied terms override untrusted extra fields', t => {
  const f=fixture(t);
  const offered=f.service.offer(f.input({price:1,materialQuantity:0,templateId:'invented'}));
  assert.equal(offered.template.price,30); assert.equal(offered.template.templateId,'town.mood_patch');
  const input=f.input({sessionId:offered.sessionId,expectedVersion:offered.version});
  const accepted=f.service.accept(input);
  assert.deepEqual(f.service.accept(input),accepted);
  assert.equal(f.balance(f.player.accountId),70); assert.equal(f.material().reserved,1);
  assert.throws(()=>f.service.accept({...input,expectedVersion:999}),e=>e.code==='IDEMPOTENCY_CONFLICT');
});

test('arrival, opening, actor eligibility, funds and stock are required before atomic acceptance', t => {
  const f=fixture(t);
  f.flags.arrived=false; assert.throws(()=>f.service.offer(f.input()),e=>e.code==='NOT_ARRIVED');
  f.flags.arrived=true; f.flags.open=false; assert.throws(()=>f.service.offer(f.input()),e=>e.code==='SERVICE_NOT_OPEN');
  f.flags.open=true; f.flags.provider=false; assert.throws(()=>f.service.offer(f.input()),e=>e.code==='ACTOR_UNAVAILABLE');
  for (const limits of [{money:20},{materials:0}]) {
    const g=fixture(t,limits); const quote=g.service.offer(g.input());
    assert.throws(()=>g.service.accept(g.input({sessionId:quote.sessionId,expectedVersion:quote.version})),e=>['INSUFFICIENT_FUNDS','INSUFFICIENT_STOCK'].includes(e.code));
    assert.equal(g.balance(g.player.accountId),limits.money??100); assert.equal(g.material().reserved,0);
    assert.equal(g.service.get({...g.scope,actorId:'player',sessionId:quote.sessionId}).status,'offered');
  }
});

test('provider/player exclusivity prevents concurrent paid sessions and rolls back second escrow', t => {
  const f=fixture(t); const q1=f.service.offer(f.input()),q2=f.service.offer(f.input());
  f.service.accept(f.input({sessionId:q1.sessionId,expectedVersion:q1.version}));
  assert.throws(()=>f.service.accept(f.input({sessionId:q2.sessionId,expectedVersion:q2.version})),/UNIQUE/);
  assert.equal(f.balance(f.player.accountId),70); assert.equal(f.material().reserved,1);
});

test('8-turn bound and two consecutive clarifications always terminate locally', async t => {
  const f=fixture(t); let value=f.open();
  for (const intent of ['clarify','choose_theme','clarify','confirm_materials','clarify','craft','clarify','deliver']) value=await f.turn(value,intent);
  assert.equal(value.turnCount,8); assert.equal(value.status,'completed');
  const g=fixture(t); let other=g.open(); other=await g.turn(other,'clarify'); other=await g.turn(other,'clarify');
  assert.equal(other.status,'cancelled'); assert.equal(other.settlement.reason,'NO_PROGRESS'); assert.equal(other.settlement.refund,30);
});

test('offer, idle and absolute duration expire via recovery with the displayed policy', async t => {
  const f=fixture(t); const quote=f.service.offer(f.input()); f.advance(WORKSHOP_SERVICE.offerMs);
  assert.equal(f.create().recover(f.scope)[0].status,'expired'); assert.equal(f.balance(f.player.accountId),100);
  assert.throws(()=>f.service.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),e=>e.code==='SESSION_CLOSED');
  const g=fixture(t); let value=g.open(); value=await g.turn(value,'choose_theme'); value=await g.turn(value,'confirm_materials');
  g.advance(WORKSHOP_SERVICE.idleMs); const result=g.create().recover(g.scope)[0];
  assert.equal(result.status,'expired'); assert.equal(result.settlement.refund,20);
  const h=fixture(t); h.open(); h.advance(WORKSHOP_SERVICE.maxDurationMs);
  assert.equal(h.create().recover(h.scope)[0].status,'expired');
});

test('provider loss and pre-epoch rebuild refund 30 even after consuming materials', async t => {
  for (const rebuild of [false,true]) {
    const f=fixture(t); let value=f.open(); value=await f.turn(value,'choose_theme'); value=await f.turn(value,'confirm_materials');
    let results;
    if (rebuild) results=f.service.failForRebuild(f.scope);
    else { f.flags.provider=false; results=f.create().recover(f.scope); }
    assert.equal(results[0].status,'failed'); assert.equal(results[0].settlement.refund,30);
    assert.equal(f.balance(f.player.accountId),100); assert.equal(f.balance(f.workshop.accountId),0);
    assert.equal(f.material().reserved,0);
    if (rebuild) { f.setEpoch(2); assert.throws(()=>f.service.recover(f.scope),e=>e.code==='STALE_EPOCH'); }
  }
});

test('grant failure rolls back actual item grant and completion, then refunds all', async t => {
  const f=fixture(t); let value=f.open();
  for (const intent of ['choose_theme','confirm_materials','craft']) value=await f.turn(value,intent);
  f.flags.grantFails=true; value=await f.turn(value,'deliver');
  assert.equal(value.status,'failed'); assert.equal(value.settlement.refund,30);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM backpack_items').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_item_transactions').get().n,0);
  assert.equal(f.balance(f.player.accountId),100);
});

test('settling failure remains recoverable; restart applies frozen refund once', t => {
  const f=fixture(t); const value=f.open(); f.flags.settlementFails=true;
  assert.throws(()=>f.service.cancel(f.input({sessionId:value.sessionId,expectedVersion:value.version})),/fixture settlement/);
  assert.equal(f.service.get({...f.scope,actorId:'player',sessionId:value.sessionId}).status,'settling');
  assert.equal(f.material().reserved,1); assert.equal(f.balance(f.player.accountId),70);
  f.flags.settlementFails=false;
  assert.equal(f.create().recover(f.scope)[0].status,'cancelled');
  assert.deepEqual(f.create().recover(f.scope),[]); assert.equal(f.balance(f.player.accountId),100);
});

test('resolving lease blocks parallel turns; cancellation fences late model result', async t => {
  const f=fixture(t); const value=f.open(); let resolve;
  const engine=f.create({generate: () => { assert.equal(f.db.inTransaction,false); return new Promise(r=>{resolve=r;}); }});
  const request=f.turnInput(value,'choose_theme'); const pending=engine.turn(request);
  await new Promise(r=>setImmediate(r));
  const resolving=engine.get({...f.scope,actorId:'player',sessionId:value.sessionId});
  await assert.rejects(engine.turn({...f.turnInput(resolving,'choose_theme')}),e=>e.code==='SESSION_BUSY');
  assert.equal((await engine.turn(request)).status,'resolving');
  const cancelled=engine.cancel(f.input({sessionId:value.sessionId,expectedVersion:resolving.version}));
  resolve('invalid model output');
  assert.equal((await pending).status,'cancelled'); assert.equal(cancelled.settlement.refund,30);
  assert.equal(f.material().reserved,0);
});

test('expired resolving lease recovers saved intent without a second model; old reply cannot overwrite', async t => {
  const f=fixture(t); const value=f.open(); let resolve;
  const engine=f.create({generate: () => new Promise(r=>{resolve=r;})});
  const request=f.turnInput(value,'choose_theme'); const pending=engine.turn(request);
  await new Promise(r=>setImmediate(r)); f.advance(WORKSHOP_SERVICE.leaseMs);
  const recovered=f.create().recover(f.scope)[0];
  assert.equal(recovered.status,'active'); assert.equal(recovered.phaseKey,'materials'); assert.equal(recovered.turnCount,1);
  resolve('invalid'); const late=await pending;
  assert.equal(late.version,recovered.version); assert.equal(late.phaseKey,'materials');
  assert.equal(late.turns.length,1); assert.equal(late.turns[0].response.fallback,true);
});

test('invalid or unavailable model falls back; model cannot invent outcomes or skip local material facts', async t => {
  const f=fixture(t); let value=f.open();
  const engine=f.create({generate: () => '{"ending":{"decision":"finish","outcomeKey":"free_gold"}}'});
  value=await engine.turn(f.turnInput(value,'choose_theme'));
  assert.equal(value.phaseKey,'materials'); assert.equal(value.status,'active'); assert.equal(f.material().quantity,10);
  assert.equal(value.turns[0].response.fallback,true);
});

test('prompt and strict parser share complete shape, enforce enums and evidence, reject extra fields/fences', () => {
  const context={speakerKey:'provider',allowedIntents:['clarify'],allowedNextPhases:['theme'],allowedOutcomes:[],evidenceTurnIds:['t1']};
  const output={schemaVersion:1,narration:'',speakerKey:'provider',dialogue:'请说说你的想法。',intentKey:'clarify',suggestedPhaseKey:'theme',
    choices:[{intentKey:'clarify',label:'再说说想法'}],ending:{decision:'continue',outcomeKey:null,reason:'',evidenceTurnIds:['t1']},memorySummary:''};
  assert.deepEqual(parseTownServiceResponse(JSON.stringify(output),context),output);
  const prompt=buildTownServicePrompt(context);
  for (const key of Object.keys(output)) assert.ok(prompt.includes(`"${key}"`));
  for (const bad of [{...output,schemaVersion:'1'},{...output,extra:true},{...output,speakerKey:'other'},
    {...output,ending:{...output.ending,evidenceTurnIds:['fake']}},
    {...output,ending:{...output.ending,decision:'finish',outcomeKey:'mood_patch'},choices:[]}]) {
    assert.throws(()=>parseTownServiceResponse(JSON.stringify(bad),context),e=>e.code==='SERVICE_MODEL_INVALID');
  }
  assert.throws(()=>parseTownServiceResponse('```json\n'+JSON.stringify(output)+'\n```',context));
});

test('unaccepted offers can expire or rebuild alongside an active paid session without claiming its seat', t => {
  const f=fixture(t); const paid=f.open(); f.service.offer(f.input()); f.service.offer(f.input());
  const results=f.service.failForRebuild(f.scope);
  assert.equal(results.length,3); assert.ok(results.every(value=>value.status==='failed'));
  assert.equal(results.find(value=>value.sessionId===paid.sessionId).settlement.refund,30);
  assert.equal(f.balance(f.player.accountId),100); assert.equal(f.material().reserved,0);
});

test('semantic finish is accepted only with crafted local facts; no extra turn is required', async t => {
  const f=fixture(t); let value=f.open();
  for (const intent of ['choose_theme','confirm_materials','craft']) value=await f.turn(value,intent);
  const engine=f.create({generate: ({context})=>JSON.stringify({schemaVersion:1,narration:'',speakerKey:context.speakerKey,
    dialogue:'制作已完成，我们可以收尾了。',intentKey:'clarify',suggestedPhaseKey:'delivery',choices:[],
    ending:{decision:'finish',outcomeKey:'mood_patch',reason:'制作事实已经齐备',evidenceTurnIds:context.evidenceTurnIds},memorySummary:'双方完成了工坊制作。'})});
  const done=await engine.turn({...f.turnInput(value,'clarify'),text:'就这样吧，谢谢。'});
  assert.equal(done.status,'completed'); assert.equal(done.turnCount,4); assert.equal(done.settlement.itemIds.length,1);
});

test('eighth turn does not call the optional model and respects the independent duration deadline', async t => {
  const f=fixture(t); let value=f.open();
  for (const intent of ['clarify','choose_theme','clarify','confirm_materials','clarify','craft','clarify']) value=await f.turn(value,intent);
  let calls=0;
  const engine=f.create({generate:()=>{calls++;throw new Error('must not call at hard limit');}});
  assert.equal((await engine.turn(f.turnInput(value,'deliver'))).status,'completed'); assert.equal(calls,0);
  const g=fixture(t); let other=g.open();
  for (const intent of ['clarify','choose_theme','clarify','confirm_materials','clarify']) {
    g.advance(4*60000-1); other=await g.turn(other,intent);
  }
  g.advance(60000); // idle is still fresh, absolute 20-minute bound has elapsed
  const expired=g.service.recover(g.scope)[0];
  assert.equal(expired.status,'expired'); assert.equal(expired.settlement.refund,20);
});

test('facts are rechecked after optional generation; leaving cannot consume materials from afar', async t => {
  const f=fixture(t); let value=f.open(); value=await f.turn(value,'choose_theme');
  const engine=f.create({generate:()=>{f.flags.arrived=false;return 'invalid';}});
  const finished=await engine.turn(f.turnInput(value,'confirm_materials'));
  assert.equal(finished.status,'failed'); assert.equal(finished.settlement.refund,30); assert.equal(f.material().quantity,10);
});

test('material capture exception rolls back its ledger and fails/refunds the service rather than looping forever', async t => {
  const f=fixture(t); let value=f.open(); value=await f.turn(value,'choose_theme');
  f.db.exec("CREATE TRIGGER fixture_consume_fail BEFORE UPDATE OF quantity ON town_resource_stocks WHEN NEW.quantity < OLD.quantity BEGIN SELECT RAISE(ABORT,'fixture consume failure'); END");
  const result=await f.turn(value,'confirm_materials');
  assert.equal(result.status,'failed'); assert.equal(result.settlement.refund,30);
  assert.equal(f.material().quantity,10); assert.equal(f.material().reserved,0); assert.equal(f.balance(f.player.accountId),100);
});

test('busy queries cover both actors only while paid active/resolving/settling and release on terminal', async t => {
  const f=fixture(t); const quote=f.service.offer(f.input());
  assert.deepEqual(f.service.getBusyActorIds(f.scope),[]);
  const value=f.service.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version}));
  assert.deepEqual(f.service.getBusyActorIds(f.scope),['player','provider']);
  assert.equal(f.service.isActorBusy({...f.scope,actorId:'provider'}),true);
  assert.equal(f.service.isActorBusy({...f.scope,actorId:'unrelated'}),false);
  let release;
  const engine=f.create({generate:()=>new Promise(resolve=>{release=resolve;})});
  const pending=engine.turn(f.turnInput(value,'choose_theme'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(engine.getBusyActorIds(f.scope),['player','provider']);
  const current=engine.get({...f.scope,actorId:'player',sessionId:value.sessionId});
  f.flags.settlementFails=true;
  assert.throws(()=>engine.cancel(f.input({sessionId:value.sessionId,expectedVersion:current.version})),/fixture settlement/);
  assert.deepEqual(engine.getBusyActorIds(f.scope),['player','provider']);
  f.flags.settlementFails=false; engine.recover(f.scope);
  assert.deepEqual(engine.getBusyActorIds(f.scope),[]);
  release('invalid'); assert.equal((await pending).status,'cancelled');
  assert.deepEqual(engine.getBusyActorIds(f.scope),[]);
});

test('SQLite independently enforces provider and player occupancy for active, resolving and settling', t => {
  const f=fixture(t); const active=f.open();
  const quote=f.service.offer(f.input());
  // Deliberately different opposite actor IDs isolate each unique constraint.
  for (const status of ['active','resolving','settling']) {
    assert.throws(()=>f.db.prepare(`UPDATE town_service_sessions SET actor_id='other-player',status=?,escrow_account_id='fixture'
      WHERE session_id=?`).run(status,quote.sessionId),/provider_actor_id/);
    assert.throws(()=>f.db.prepare(`UPDATE town_service_sessions SET provider_actor_id='other-provider',status=?,escrow_account_id='fixture'
      WHERE session_id=?`).run(status,quote.sessionId),/actor_id/);
  }
  assert.equal(f.service.get({...f.scope,actorId:'player',sessionId:quote.sessionId}).status,'offered');
  assert.equal(f.service.get({...f.scope,actorId:'player',sessionId:active.sessionId}).status,'active');
  assert.equal(f.balance(f.player.accountId),70);
});

test('recover immediately fails a departed provider and refunds all, including after material consumption', async t => {
  const f=fixture(t); let value=f.open();
  value=await f.turn(value,'choose_theme'); value=await f.turn(value,'confirm_materials');
  f.flags.providerArrived=false;
  const result=f.create().recover(f.scope)[0];
  assert.equal(result.status,'failed'); assert.equal(result.settlement.reason,'PROVIDER_UNAVAILABLE');
  assert.equal(result.settlement.refund,30); assert.equal(f.balance(f.workshop.accountId),0);
  assert.deepEqual(f.service.getBusyActorIds(f.scope),[]);
});

test('recover cancels a departed player with the displayed policy and fences a still-live LLM lease', async t => {
  const f=fixture(t); let value=f.open();
  value=await f.turn(value,'choose_theme'); value=await f.turn(value,'confirm_materials');
  let release;
  const engine=f.create({generate:()=>new Promise(resolve=>{release=resolve;})});
  const pending=engine.turn(f.turnInput(value,'craft'));
  await new Promise(resolve=>setImmediate(resolve));
  f.flags.playerArrived=false;
  const cancelled=f.create().recover(f.scope)[0];
  assert.equal(cancelled.status,'cancelled'); assert.equal(cancelled.settlement.reason,'PLAYER_LEFT');
  assert.equal(cancelled.settlement.refund,20); assert.equal(f.balance(f.workshop.accountId),10);
  assert.deepEqual(engine.getBusyActorIds(f.scope),[]);
  release('invalid'); assert.equal((await pending).status,'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM backpack_items').get().n,0);
});

function runningWork(f, actorId='provider', {type='work_shift',target='workshop'}={}) {
  const runner=createTownActionRunner({db:f.db,clock:f.clock,getWorldEpoch:f.registry.getWorldEpoch,getActor:f.registry.getActor,
    readFacts: action=>({worldEpoch:1,actorId:action.actorId,allowsAction:true,targetExists:true,arrived:true,locationKey:action.target})});
  let action=runner.create(f.input({actorId,type,target,payload:{durationMs:10000}}));
  action=runner.reserve(f.input({actionId:action.id,expectedVersion:action.version}));
  action=runner.start(f.input({actionId:action.id,expectedVersion:action.version}));
  return {runner,action};
}
function actionInterrupt(f,runner,onCall=()=>{}) {
  return ({scope,providerActorId,playerActorId,sessionId})=>{
    assert.equal(f.db.inTransaction,true); onCall();
    const rows=f.db.prepare(`SELECT id,version FROM town_actions WHERE world_id=? AND world_epoch=?
      AND actor_id IN (?,?) AND status IN ('validated','reserved','running')`)
      .all(scope.worldId,scope.worldEpoch,providerActorId,playerActorId);
    for (const action of rows) runner.cancel({...scope,actionId:action.id,expectedVersion:action.version,
      idempotencyKey:`service:${sessionId}:interrupt:${action.id}`,reasonCode:'SERVICE_ACCEPTED'});
  };
}

test('accept fails closed against existing M3 work without an interrupt adapter or with a no-op adapter', t => {
  for (const noOp of [false,true]) {
    const f=fixture(t); const {runner,action}=runningWork(f);
    const engine=f.create(noOp?{interruptWork:()=>{}}:{});
    const quote=engine.offer(f.input());
    assert.throws(()=>engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),e=>e.code==='SERVICE_ACTOR_BUSY');
    assert.equal(runner.get(action.id).phase,'running'); assert.equal(f.balance(f.player.accountId),100);
    assert.equal(f.material().reserved,0); assert.deepEqual(engine.getBusyActorIds(f.scope),[]);
  }
});

test('accept synchronously cancels M3 work/claims before acquiring the service; replay does not interrupt twice', t => {
  const f=fixture(t); const {runner,action}=runningWork(f); let calls=0;
  const engine=f.create({interruptWork:actionInterrupt(f,runner,()=>{calls++;})});
  const quote=engine.offer(f.input()); const request=f.input({sessionId:quote.sessionId,expectedVersion:quote.version});
  const accepted=engine.accept(request);
  assert.equal(accepted.status,'active'); assert.equal(runner.get(action.id).phase,'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_resource_claims WHERE action_id=?').get(action.id).n,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM town_activity_log WHERE action_id=? AND phase='cancelled'").get(action.id).n,1);
  assert.equal(f.balance(f.player.accountId),70); assert.deepEqual(engine.accept(request),accepted); assert.equal(calls,1);
});

test('later acceptance failure rolls back actual runner cancellation, claims, audit events and money', t => {
  const f=fixture(t,{materials:0}); const {runner,action}=runningWork(f);
  const engine=f.create({interruptWork:actionInterrupt(f,runner)});
  const quote=engine.offer(f.input());
  const tables=['town_actions','town_resource_claims','town_action_requests','town_activity_log','town_domain_events',
    'economy_accounts','economy_transactions','economy_reservations','town_service_sessions'];
  const snapshot=()=>tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
  const before=snapshot();
  assert.throws(()=>engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),e=>e.code==='INSUFFICIENT_STOCK');
  assert.deepEqual(snapshot(),before); assert.equal(runner.get(action.id).phase,'running');
});

test('player M3 work is also protected, and an interrupt callback exception restores old work', t => {
  const f=fixture(t); const {runner,action}=runningWork(f,'player');
  const quote=f.service.offer(f.input());
  assert.throws(()=>f.service.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),e=>e.code==='SERVICE_ACTOR_BUSY');
  const interrupt=actionInterrupt(f,runner);
  const engine=f.create({interruptWork:args=>{interrupt(args);throw new Error('fixture interrupt failure');}});
  assert.throws(()=>engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),/fixture interrupt failure/);
  assert.equal(runner.get(action.id).phase,'running');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_resource_claims WHERE action_id=?').get(action.id).n,2);
  assert.equal(f.balance(f.player.accountId),100);
});

test('settlement appends one typed fact event and experience delivery in the money/item/terminal transaction', async t => {
  const f=fixture(t); let value=f.open();
  const engine=f.create({consumers:['town.experience']});
  for (const intent of ['choose_theme','confirm_materials','craft']) value=await engine.turn(f.turnInput(value,intent));
  const request=f.turnInput(value,'deliver'); value=await engine.turn(request);
  const eventId=`service:${value.sessionId}:settled`;
  assert.equal(value.settlement.eventId,eventId);
  assert.equal(value.settlement.settlementId,value.sessionId);
  const events=f.db.prepare("SELECT envelope FROM town_domain_events WHERE type='town.service.settled'").all().map(row=>JSON.parse(row.envelope));
  assert.equal(events.length,1);
  assert.deepEqual(events[0].payload,{sessionId:value.sessionId,status:'completed',outcomeKey:'mood_patch',settlementId:value.sessionId});
  assert.deepEqual(events[0].actorIds,['player','provider']); assert.equal(events[0].locationKey,'workshop');
  assert.deepEqual(f.db.prepare('SELECT consumer_key,status FROM town_event_deliveries WHERE event_id=?').all(eventId),
    [{consumer_key:'town.experience',status:'pending'}]);
  assert.equal((await engine.turn(request)).status,'completed'); engine.recover(f.scope);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM town_domain_events WHERE type='town.service.settled'").get().n,1);
});

test('fact-event insertion failure rolls back payout, item, receipt and terminal; recovery emits only final refunded fact', async t => {
  const f=fixture(t); let value=f.open();
  const engine=f.create({consumers:['town.experience']});
  for (const intent of ['choose_theme','confirm_materials','craft']) value=await engine.turn(f.turnInput(value,intent));
  f.db.exec("CREATE TRIGGER fixture_service_event_fail BEFORE INSERT ON town_domain_events WHEN NEW.type='town.service.settled' BEGIN SELECT RAISE(ABORT,'fixture event failure'); END");
  await assert.rejects(engine.turn(f.turnInput(value,'deliver')),/fixture event failure/);
  assert.equal(engine.get({...f.scope,actorId:'player',sessionId:value.sessionId}).status,'settling');
  assert.equal(f.balance(f.player.accountId),70); assert.equal(f.balance(f.workshop.accountId),0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM backpack_items').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_service_settlements').get().n,0);
  f.db.exec('DROP TRIGGER fixture_service_event_fail');
  const recovered=engine.recover(f.scope)[0];
  assert.equal(recovered.status,'failed'); assert.equal(recovered.settlement.refund,30);
  assert.equal(f.balance(f.player.accountId),100);
  const event=JSON.parse(f.db.prepare("SELECT envelope FROM town_domain_events WHERE type='town.service.settled'").get().envelope);
  assert.equal(event.payload.status,'failed'); assert.equal(event.payload.settlementId,value.sessionId);
});

// The injection contract used by runtime: provider only, same offered workshop, work/wait only.
// This exercises the engine boundary; main owns actual runtime adapter integration tests.
function workshopInterrupt(f,runner,onCall=()=>{}) {
  return ({scope,providerActorId,sessionId})=>{
    assert.equal(f.db.inTransaction,true); onCall();
    const offer=f.db.prepare('SELECT config_json FROM town_service_sessions WHERE session_id=?').get(sessionId);
    const locationKey=JSON.parse(offer.config_json).locationKey;
    const actions=f.db.prepare(`SELECT id,version FROM town_actions WHERE world_id=? AND world_epoch=?
      AND actor_id=? AND target=? AND type IN ('work_shift','wait') AND status IN ('validated','reserved','running')`)
      .all(scope.worldId,scope.worldEpoch,providerActorId,locationKey);
    for (const action of actions) runner.cancel({...scope,actionId:action.id,expectedVersion:action.version,
      idempotencyKey:`service:${sessionId}:interrupt:${action.id}`,reasonCode:'SERVICE_ACCEPTED'});
  };
}

test('workshop-scoped interrupt rolls back old work/wait, leases and audit writes on insufficient money or material', t => {
  for (const type of ['work_shift','wait']) for (const shortage of [{money:20},{materials:0}]) {
    const f=fixture(t,shortage); const {runner,action}=runningWork(f,'provider',{type});
    let calls=0; const engine=f.create({interruptWork:workshopInterrupt(f,runner,()=>{calls++;})});
    const quote=engine.offer(f.input());
    const tables=['town_actions','town_resource_claims','town_action_requests','town_activity_log','town_domain_events','town_event_deliveries',
      'economy_accounts','economy_entries','economy_transactions','economy_requests','economy_reservations','town_resource_stocks',
      'town_resource_entries','town_service_sessions','town_service_requests','item_templates'];
    const snapshot=()=>tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
    const before=snapshot();
    assert.throws(()=>engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),
      error=>error.code===(shortage.money?'INSUFFICIENT_FUNDS':'INSUFFICIENT_STOCK'));
    assert.equal(calls,1); assert.deepEqual(snapshot(),before);
    assert.equal(runner.get(action.id).phase,'running');
    assert.deepEqual(engine.getBusyActorIds(f.scope),[]);
  }
});

test('workshop-scoped interrupt preserves other type/target/player actions and engine refuses acceptance', t => {
  for (const variant of [{actorId:'provider',type:'rest',target:'workshop'},
    {actorId:'provider',type:'work_shift',target:'another-place'},{actorId:'player',type:'wait',target:'workshop'}]) {
    const f=fixture(t); const {runner,action}=runningWork(f,variant.actorId,variant);
    const engine=f.create({interruptWork:workshopInterrupt(f,runner)}); const quote=engine.offer(f.input());
    const claims=f.db.prepare('SELECT * FROM town_resource_claims').all();
    assert.throws(()=>engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),error=>error.code==='SERVICE_ACTOR_BUSY');
    assert.deepEqual(runner.get(action.id),action); assert.deepEqual(f.db.prepare('SELECT * FROM town_resource_claims').all(),claims);
    assert.equal(f.balance(f.player.accountId),100);
  }
});

test('provider arrival is checked before interrupting work and eligible wait can accept successfully', t => {
  const f=fixture(t); const {runner,action}=runningWork(f,'provider',{type:'wait'});
  let calls=0; const engine=f.create({interruptWork:workshopInterrupt(f,runner,()=>{calls++;})});
  const quote=engine.offer(f.input()); f.flags.providerArrived=false;
  assert.throws(()=>engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version})),error=>error.code==='NOT_ARRIVED');
  assert.equal(calls,0); assert.equal(runner.get(action.id).phase,'running');
  f.flags.providerArrived=true;
  const accepted=engine.accept(f.input({sessionId:quote.sessionId,expectedVersion:quote.version}));
  assert.equal(accepted.status,'active'); assert.equal(calls,1); assert.equal(runner.get(action.id).phase,'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM town_resource_claims WHERE action_id=?').get(action.id).n,0);
});
