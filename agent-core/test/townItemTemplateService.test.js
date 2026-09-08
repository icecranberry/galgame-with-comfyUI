import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {Worker} from 'node:worker_threads';
import {compileFunction} from 'node:vm';
import Database from 'better-sqlite3';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {migrateTownEconomySchema} from '../src/db/townEconomySchema.js';
import {migrateTownItemTemplateSchema} from '../src/db/townItemTemplateSchema.js';
import {createEconomyService} from '../src/services/town/economyService.js';
import {createItemTemplateService} from '../src/services/town/itemTemplateService.js';
import * as lifecycle from '../src/services/itemLifecycle.js';

// Execute existing effect implementation against this db, never import its production singleton.
function isolated(db,file,exports,extra={}) {
  const names=[];
  const source=readFileSync(new URL(`../src/services/${file}.js`,import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(s=>s.trim()).filter(Boolean));return '';
    }).replace(/export (?=(?:async )?function|const)/g,'');
  const deps={...lifecycle,getDb:()=>db,...extra};
  return compileFunction(`${source}\nreturn {${exports}};`,names)(...names.map(n=>deps[n]??(()=>{throw new Error(`Unexpected dependency ${n}`);} )));
}
function fixture(t,path=':memory:') {
  const db=new Database(path);db.pragma('foreign_keys=ON');if(path!==':memory:')db.pragma('journal_mode=WAL');t.after(()=>db.close());
  db.exec(`CREATE TABLE backpack_items(id INTEGER PRIMARY KEY AUTOINCREMENT,effect_key TEXT NOT NULL,name TEXT NOT NULL,
    description TEXT NOT NULL,rarity TEXT NOT NULL DEFAULT 'common',image_url TEXT,status TEXT NOT NULL DEFAULT 'generating',
    payload_json TEXT,collected_at DATETIME,acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,used_at DATETIME);
    CREATE TABLE characters(id INTEGER PRIMARY KEY,display_name TEXT);INSERT INTO characters VALUES(1,'角色');
    CREATE TABLE messages(id INTEGER PRIMARY KEY);
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL REFERENCES backpack_items(id),
      character_id INTEGER,effect_key TEXT,payload_json TEXT,expires_at DATETIME);
    CREATE TABLE gift_history(id INTEGER PRIMARY KEY,gift_type TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE user_relationships(character_id INTEGER PRIMARY KEY,relationship_text TEXT,affinity REAL,last_interaction_at TEXT);
    CREATE TABLE emotion_snapshots(id INTEGER PRIMARY KEY,conversation_id TEXT UNIQUE,after_msg_id INTEGER REFERENCES messages(id),
      valence REAL,arousal REAL,dominance REAL,mood_valence REAL,mood_arousal REAL,mood_dominance REAL,
      dominant_emotion TEXT,affinity REAL,affinity_delta REAL,reason TEXT);`);
  migrateTownItemTemplateSchema(db);migrateTownItemTemplateSchema(db);migrateTownActionSchema(db);migrateTownEconomySchema(db);
  const emotions=isolated(db,'emotionEngine','saveEmotionSnapshot,loadAffinity,saveAffinity');
  const legacy=isolated(db,'itemService','ITEM_EFFECTS,useItem,collectItem,discardItem',emotions);
  let epoch=1,seq=0;
  const options={db,clock:{now:()=>1000000},getWorldEpoch:w=>w==='w'?epoch:null,
    getActor:id=>id==='alias'?{actorId:'npc'}:{actorId:id,playerId:id==='player'?'me':null},consumers:['ui']};
  const economy=createEconomyService(options);
  const service=createItemTemplateService({...options,effectRegistry:legacy.ITEM_EFFECTS,economy});
  const scope=()=>({worldId:'w',worldEpoch:epoch}); service.ensureDefaultTemplates(scope());
  const command=(extra={})=>({...scope(),idempotencyKey:`request:${++seq}`,sourceKey:`source:${seq}`,reasonCode:'TEST',...extra});
  const grant=(extra={})=>service.grant(command({templateId:'town.mood_patch',templateVersion:1,ownerKey:'me',quantity:1,
    sourceType:'service',sourceId:`service:${seq+1}`,...extra}));
  const row=id=>db.prepare('SELECT * FROM backpack_items WHERE id=?').get(id);
  return {db,service,economy,legacy,scope,command,grant,row,epoch:v=>{epoch=v;}};
}

test('immutable local templates use injected real ITEM_EFFECTS; grant creates original ready instances without applying effects',t=>{
  const f=fixture(t); const templates=f.service.ensureDefaultTemplates(f.scope());assert.equal(templates[0].effectKey,'mood_fix');
  assert.throws(()=>f.service.publishTemplate({...f.scope(),...templates[0],name:'changed'}),{code:'TEMPLATE_VERSION_CONFLICT'});
  assert.throws(()=>f.service.publishTemplate({...f.scope(),...templates[0],templateId:'bad',effectKey:'unknown'}),{code:'UNSUPPORTED_TEMPLATE_EFFECT'});
  assert.throws(()=>f.service.publishTemplate({...f.scope(),...templates[0],templateId:'bad',payload:{affinity:999}}),{code:'INVALID_TEMPLATE_PAYLOAD'});
  const result=f.grant({quantity:3});assert.equal(new Set(result.itemIds).size,3);
  for(const id of result.itemIds){assert.equal(f.row(id).status,'ready');assert.ok(f.row(id).collected_at);assert.equal(f.row(id).owner_key,'me');}
  assert.equal(f.db.prepare('SELECT count(*) n FROM emotion_snapshots').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM gift_history').get().n,0);
  assert.equal(f.legacy.useItem(result.itemIds[0],1).ok,true);
  assert.equal(f.row(result.itemIds[0]).status,'used');assert.equal(f.row(result.itemIds[0]).version,2);
  assert.equal(f.db.prepare('SELECT dominant_emotion FROM emotion_snapshots').get().dominant_emotion,'joy');
  assert.equal(f.db.prepare('SELECT after_msg_id FROM emotion_snapshots').get().after_msg_id,null);
});

test('grant request/source dedupe survives epoch rebuild and a used/retired output cannot be regranted',t=>{
  const f=fixture(t);const input=f.command({templateId:'town.mood_patch',templateVersion:1,ownerKey:'me',quantity:1,sourceType:'service',sourceId:'session:1'});
  const result=f.service.grant(input);f.legacy.discardItem(result.itemIds[0]);
  assert.deepEqual(f.service.grant(input),result);
  f.epoch(2);assert.deepEqual(f.service.grant({...input,worldEpoch:2,idempotencyKey:'new-request'}),result);
  assert.ok(f.row(result.itemIds[0]).retired_at);
  assert.throws(()=>f.service.grant({...input,worldEpoch:2,idempotencyKey:'different',quantity:2}),{code:'SOURCE_CONFLICT'});
  assert.throws(()=>f.service.grant({...input,worldEpoch:2,quantity:2}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items').get().n,1);
});

test('canonical ownership, lock fences, delivery transfer preserve instance ID and prevent old player APIs',t=>{
  const f=fixture(t);assert.throws(()=>f.grant({ownerKey:'actor:player'}),{code:'INVALID_ITEM_OWNER'});
  assert.throws(()=>f.grant({ownerKey:'actor:alias'}),{code:'INVALID_ITEM_OWNER'});
  let item=f.grant({ownerKey:'actor:npc'}).items[0];const originalId=item.id;
  assert.equal(f.legacy.useItem(item.id,1).ok,false);assert.equal(f.legacy.collectItem(item.id).ok,false);assert.equal(f.legacy.discardItem(item.id).ok,false);
  item=f.service.lock(f.command({ownerKey:item.ownerKey,itemId:item.id,expectedVersion:item.version,lockKey:'order:1'})).items[0];
  assert.throws(()=>f.service.transfer(f.command({ownerKey:item.ownerKey,toOwnerKey:'me',itemId:item.id,expectedVersion:item.version})),{code:'ITEM_LOCKED'});
  item=f.service.transfer(f.command({ownerKey:item.ownerKey,toOwnerKey:'me',itemId:item.id,expectedVersion:item.version,lockKey:'order:1'})).items[0];
  assert.equal(item.id,originalId);assert.equal(item.ownerKey,'me');assert.equal(item.lockedBy,null);assert.ok(item.collectedAt);
  item=f.service.lock(f.command({ownerKey:'me',itemId:item.id,expectedVersion:item.version,lockKey:'sale:1'})).items[0];
  for(const result of [f.legacy.useItem(item.id,1),f.legacy.collectItem(item.id),f.legacy.discardItem(item.id)])assert.equal(result.code,'ITEM_LOCKED');
  item=f.service.unlock(f.command({ownerKey:'me',itemId:item.id,expectedVersion:item.version,lockKey:'sale:1'})).items[0];
  assert.equal(f.legacy.useItem(item.id,1,{expectedVersion:item.version}).ok,true);
  assert.throws(()=>f.service.transfer(f.command({ownerKey:'me',toOwnerKey:'business:shop',itemId:item.id,expectedVersion:item.version})),{code:'VERSION_CONFLICT'});
});

test('buy then sell transfers same item and money atomically with owner checks and response replay',t=>{
  const f=fixture(t),player=f.economy.ensureAccount({...f.scope(),ownerKey:'actor:player',actorId:'player',accountType:'actor'}),
    shop=f.economy.ensureAccount({...f.scope(),ownerKey:'business:shop',accountType:'business'});
  f.economy.seed(f.command({accountId:player.accountId,amount:100}));
  let item=f.grant({ownerKey:'business:shop',sourceType:'production'}).items[0];
  const buy=f.command({ownerKey:item.ownerKey,toOwnerKey:'me',itemId:item.id,expectedVersion:item.version,
    fromAccountId:player.accountId,toAccountId:shop.accountId,amount:30});
  const purchased=f.service.trade(buy);item=purchased.items[0];assert.equal(item.ownerKey,'me');
  assert.deepEqual(f.service.trade({...buy,idempotencyKey:'retry'}),purchased);
  assert.equal(f.economy.getAccount({...f.scope(),accountId:player.accountId}).balance,70);
  assert.equal(f.economy.getAccount({...f.scope(),accountId:shop.accountId}).balance,30);
  const sell=f.command({ownerKey:'me',toOwnerKey:'business:shop',itemId:item.id,expectedVersion:item.version,
    fromAccountId:shop.accountId,toAccountId:player.accountId,amount:10});
  item=f.service.trade(sell).items[0];assert.equal(item.id,purchased.itemIds[0]);assert.equal(item.ownerKey,'business:shop');
  assert.equal(f.economy.getAccount({...f.scope(),accountId:player.accountId}).balance,80);
  assert.throws(()=>f.service.trade(f.command({...buy,itemId:item.id,expectedVersion:item.version,sourceKey:'wrong-payer',idempotencyKey:'wrong-payer',
    fromAccountId:shop.accountId,toAccountId:player.accountId})),{code:'ACCOUNT_OWNER_MISMATCH'});
});

test('delivery business keys require existing same-world business accounts, and trade preserves their IDs and seeds',t=>{
  const f=fixture(t);
  assert.throws(()=>f.grant({ownerKey:'delivery:business:missing'}),{code:'INVALID_ITEM_OWNER'});
  f.economy.ensureAccount({...f.scope(),ownerKey:'delivery:business:fund',accountType:'fund'});
  assert.throws(()=>f.grant({ownerKey:'delivery:business:fund'}),{code:'INVALID_ITEM_OWNER'});
  const workshop=f.economy.ensureAccount({...f.scope(),ownerKey:'delivery:business:workshop',accountType:'business'});
  const player=f.economy.ensureAccount({...f.scope(),ownerKey:'actor:player',actorId:'player',accountType:'actor'});
  f.economy.seed(f.command({accountId:player.accountId,amount:30}));
  const before=f.db.prepare('SELECT count(*) n FROM economy_accounts').get().n;
  const item=f.grant({ownerKey:workshop.ownerKey,sourceType:'production'}).items[0];
  const receipt=f.service.trade(f.command({itemId:item.id,ownerKey:workshop.ownerKey,toOwnerKey:'me',expectedVersion:item.version,
    fromAccountId:player.accountId,toAccountId:workshop.accountId,amount:30}));
  assert.equal(receipt.items[0].ownerKey,'me');assert.equal(receipt.items[0].id,item.id);
  assert.equal(f.economy.getAccount({...f.scope(),accountId:workshop.accountId}).balance,30);
  assert.equal(f.db.prepare('SELECT count(*) n FROM economy_accounts').get().n,before);
  // A business from another world never authorizes the same owner string here.
  f.db.prepare("INSERT INTO economy_accounts(account_id,world_id,owner_key,account_type) VALUES('foreign','other','delivery:business:foreign','business')").run();
  assert.throws(()=>f.grant({ownerKey:'delivery:business:foreign'}),{code:'INVALID_ITEM_OWNER'});
});

test('failure after payment or item insertion rolls back inventory, ledger, grant source and events',t=>{
  const f=fixture(t),player=f.economy.ensureAccount({...f.scope(),ownerKey:'actor:player',actorId:'player',accountType:'actor'}),
    shop=f.economy.ensureAccount({...f.scope(),ownerKey:'business:shop',accountType:'business'});
  f.economy.seed(f.command({accountId:player.accountId,amount:100}));
  const item=f.grant({ownerKey:'business:shop',sourceType:'production'}).items[0];
  f.db.exec("CREATE TRIGGER reject_transfer BEFORE UPDATE OF owner_key ON backpack_items BEGIN SELECT RAISE(ABORT,'transfer fault'); END");
  assert.throws(()=>f.service.trade(f.command({ownerKey:item.ownerKey,toOwnerKey:'me',itemId:item.id,expectedVersion:item.version,
    fromAccountId:player.accountId,toAccountId:shop.accountId,amount:30})),/transfer fault/);
  assert.equal(f.economy.getAccount({...f.scope(),accountId:player.accountId}).balance,100);assert.equal(f.row(item.id).owner_key,'business:shop');
  f.db.exec('DROP TRIGGER reject_transfer');
  f.db.exec("CREATE TRIGGER reject_item_event BEFORE INSERT ON town_domain_events WHEN NEW.type='town.item.changed' BEGIN SELECT RAISE(ABORT,'event fault'); END");
  assert.throws(()=>f.grant({quantity:2}),/event fault/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM town_item_transactions').get().n,1);
});

test('M5 escrow capture and safe grant share outer transaction; no notification before commit',t=>{
  const f=fixture(t),payer=f.economy.ensureAccount({...f.scope(),ownerKey:'actor:player',actorId:'player',accountType:'actor'}),
    payee=f.economy.ensureAccount({...f.scope(),ownerKey:'business:workshop',accountType:'business'});
  f.economy.seed(f.command({accountId:payer.accountId,amount:30}));
  const reservation=f.economy.reserve(f.command({accountId:payer.accountId,amount:30,ownerRef:'service:1'})).reservation;
  const capture=f.command({reservationId:reservation.reservationId,toAccountId:payee.accountId,expectedVersion:reservation.version});
  let receipt,notifications=0;
  assert.throws(()=>f.db.transaction(()=>{
    f.economy.capture(capture);receipt=f.grant();
    assert.throws(()=>f.service.flushNotifications(receipt,()=>notifications++),{code:'COMMIT_REQUIRED'});throw new Error('settlement fault');
  })(),/settlement fault/);
  assert.equal(f.economy.getAccount({...f.scope(),accountId:payer.accountId}).reserved,30);
  assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items').get().n,0);
  f.db.transaction(()=>{f.economy.capture(capture);receipt=f.grant();})();
  f.service.flushNotifications(receipt,()=>notifications++);assert.equal(notifications,1);
  assert.equal(f.economy.getAccount({...f.scope(),accountId:payer.accountId}).reserved,0);
  assert.equal(f.row(receipt.itemIds[0]).effect_key,'mood_fix');
});

test('reset releases inventory locks transactionally and a retired template image remains referenced',t=>{
  const f=fixture(t);let item=f.grant().items[0];
  item=f.service.lock(f.command({ownerKey:'me',itemId:item.id,expectedVersion:item.version,lockKey:'service:1'})).items[0];
  const command=f.command({reasonCode:'WORLD_RESET'});
  assert.throws(()=>f.db.transaction(()=>{f.service.releaseLocks(command);throw new Error('reset fault');})(),/reset fault/);
  assert.equal(f.row(item.id).locked_by,'service:1');
  const result=f.service.releaseLocks(command);assert.equal(result.items[0].lockedBy,null);
  f.epoch(2);assert.throws(()=>f.service.unlock({...command,worldEpoch:1,ownerKey:'me',itemId:item.id,expectedVersion:item.version,lockKey:'service:1'}),{code:'STALE_EPOCH'});
});

test('real WAL workers race selling versus legacy use: exactly one owns the outcome',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'town-item-test-')),path=join(directory,'race.db');
  const f=fixture(t,path),player=f.economy.ensureAccount({...f.scope(),ownerKey:'actor:player',actorId:'player',accountType:'actor'}),
    shop=f.economy.ensureAccount({...f.scope(),ownerKey:'business:shop',accountType:'business'});
  f.economy.seed(f.command({accountId:shop.accountId,amount:10}));
  const item=f.grant({templateId:'town.energy_charm'}).items[0],gate=new SharedArrayBuffer(4),workers=[];
  try {
    const jobs=[{method:'use',itemId:item.id,version:item.version},{method:'trade',command:f.command({ownerKey:'me',toOwnerKey:'business:shop',
      itemId:item.id,expectedVersion:item.version,fromAccountId:shop.accountId,toAccountId:player.accountId,amount:10})}];
    const readies=[],results=[];
    for(const job of jobs) {
      const worker=new Worker(new URL('./fixtures/townItemWorker.js',import.meta.url),{workerData:{path,gate,...job}});workers.push(worker);
      readies.push(new Promise((resolve,reject)=>{worker.on('message',m=>{if(m.ready)resolve();});worker.once('error',reject);}));
      results.push(new Promise((resolve,reject)=>{worker.on('message',m=>{if('ok' in m)resolve(m);});worker.once('error',reject);}));
    }
    await Promise.all(readies);Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
    const outcomes=await Promise.all(results);assert.equal(outcomes.filter(r=>r.ok).length,1);
    const final=f.row(item.id),paid=f.economy.getAccount({...f.scope(),accountId:player.accountId}).balance;
    if(final.status==='used') {assert.equal(final.owner_key,'me');assert.equal(paid,0);}
    else {assert.equal(final.owner_key,'business:shop');assert.equal(paid,10);}
    assert.equal(f.db.prepare('SELECT count(*) n FROM backpack_items').get().n,1);
  }finally{
    await Promise.all(workers.map(w=>w.terminate()));f.db.close();
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('town-item-test-'));
    rmSync(directory,{recursive:true,force:true});
  }
});
