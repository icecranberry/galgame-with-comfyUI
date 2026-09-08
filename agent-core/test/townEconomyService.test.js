import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {Worker} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {migrateTownEconomySchema} from '../src/db/townEconomySchema.js';
import {createEconomyService} from '../src/services/town/economyService.js';

function fixture(t,path=':memory:') {
  const db=new Database(path); db.pragma('foreign_keys=ON');
  if(path!==':memory:') db.pragma('journal_mode=WAL');
  t.after(()=>db.close()); migrateTownActionSchema(db); migrateTownEconomySchema(db); migrateTownEconomySchema(db);
  let epoch=1,seq=0;
  const service=createEconomyService({db,clock:{now:()=>1000},getWorldEpoch:w=>w==='w'?epoch:null,
    getActor:id=>id==='alias'?{actorId:'canonical'}:{actorId:id},consumers:['ui']});
  const scope=()=>({worldId:'w',worldEpoch:epoch});
  const command=(patch={})=>({...scope(),idempotencyKey:`request:${++seq}`,sourceKey:`source:${seq}`,reasonCode:'TEST',...patch});
  const account=(owner,amount=0)=>{
    const a=service.ensureAccount({...scope(),ownerKey:owner,accountType:'fund'});
    if(amount>0) service.seed(command({accountId:a.accountId,amount}));
    return service.getAccount({...scope(),accountId:a.accountId});
  };
  const stock=(owner,amount=0,resourceKey='wood')=>{
    const s=service.ensureStock({...scope(),ownerKey:owner,resourceKey});
    if(amount>0) service.seedStock(command({stockId:s.stockId,amount}));
    return service.getStock({...scope(),stockId:s.stockId});
  };
  return {db,service,scope,command,account,stock,epoch:n=>{epoch=n;}};
}
function reconcile(db) {
  for(const a of db.prepare('SELECT * FROM economy_accounts').all()) {
    const entries=db.prepare('SELECT * FROM economy_entries WHERE account_id=?').all(a.account_id);
    assert.equal(entries.reduce((n,e)=>n+BigInt(e.amount),0n),BigInt(a.balance));
    assert.equal(entries.reduce((n,e)=>n+BigInt(e.reserved_delta),0n),BigInt(a.reserved));
    if(a.account_type!=='issuance') assert.ok(a.balance>=a.reserved && a.reserved>=0);
  }
  for(const s of db.prepare('SELECT * FROM town_resource_stocks').all()) {
    const entries=db.prepare('SELECT * FROM town_resource_entries WHERE stock_id=?').all(s.stock_id);
    assert.equal(entries.reduce((n,e)=>n+BigInt(e.quantity_delta),0n),BigInt(s.quantity));
    assert.equal(entries.reduce((n,e)=>n+BigInt(e.reserved_delta),0n),BigInt(s.reserved));
  }
  for(const tx of db.prepare('SELECT transaction_id FROM economy_transactions').all()) {
    const entries=db.prepare('SELECT amount FROM economy_entries WHERE transaction_id=?').all(tx.transaction_id);
    assert.equal(entries.reduce((n,e)=>n+BigInt(e.amount),0n),0n);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}

async function race(path,commands,method='transfer') {
  const gate=new SharedArrayBuffer(4),workers=[];
  try {
    const completions=[],readies=[];
    for(const command of commands) {
      const worker=new Worker(new URL('./fixtures/townEconomyWorker.js',import.meta.url),{workerData:{path,gate,method,command}});
      workers.push(worker);
      readies.push(new Promise((resolve,reject)=>{worker.on('message',m=>{if(m.ready)resolve();});worker.once('error',reject);}));
      completions.push(new Promise((resolve,reject)=>{worker.on('message',m=>{if('ok' in m)resolve(m);});worker.once('error',reject);}));
    }
    await Promise.all(readies); Atomics.store(new Int32Array(gate),0,1); Atomics.notify(new Int32Array(gate),0);
    return await Promise.all(completions);
  } finally { await Promise.all(workers.map(w=>w.terminate())); }
}

function removeFixtureDirectory(directory) {
  assert.equal(dirname(resolve(directory)),resolve(tmpdir())); assert.ok(basename(directory).startsWith('town-economy-test-'));
  rmSync(directory,{recursive:true,force:true});
}

test('seed balances issuance, remains unique across epochs/restarts and rejects payload conflicts',t=>{
  const f=fixture(t); const a=f.account('player');
  const seed=f.command({accountId:a.accountId,amount:100}); const receipt=f.service.seed(seed);
  assert.deepEqual(f.service.seed(seed),receipt);
  assert.deepEqual(f.service.seed({...seed,idempotencyKey:'new-request'}),receipt);
  f.epoch(2); assert.deepEqual(f.service.seed({...seed,worldEpoch:2}),receipt);
  assert.throws(()=>f.service.seed({...seed,worldEpoch:2,idempotencyKey:'different',amount:101}),{code:'SOURCE_CONFLICT'});
  assert.throws(()=>f.service.seed(seed),{code:'STALE_EPOCH'});
  assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).balance,100);
  assert.equal(f.db.prepare('SELECT SUM(balance) n FROM economy_accounts').get().n,0); reconcile(f.db);
});

test('transfer CAS, safe integer checks, system cannot spend and business-source dedupe',t=>{
  const f=fixture(t),a=f.account('a',100),b=f.account('b');
  const command=f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:30,expectedVersion:a.version});
  const result=f.service.transfer(command); assert.equal(result.accounts[0].available,70);
  assert.deepEqual(f.service.transfer({...command,idempotencyKey:'lost-response-retry',expectedVersion:a.version+1}),result);
  assert.throws(()=>f.service.transfer({...command,amount:31}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>f.service.transfer({...command,idempotencyKey:'duplicate-award',amount:31}),{code:'SOURCE_CONFLICT'});
  assert.throws(()=>f.service.transfer(f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:1,expectedVersion:a.version})),{code:'VERSION_CONFLICT'});
  for(const amount of [0,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>f.service.transfer(f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount})));
  const system=f.db.prepare("SELECT account_id FROM economy_accounts WHERE account_type='issuance'").get().account_id;
  assert.throws(()=>f.service.transfer(f.command({fromAccountId:system,toAccountId:b.accountId,amount:1})),{code:'SYSTEM_ACCOUNT_NOT_SPENDABLE'});
  reconcile(f.db);
});

test('partial reserve/capture/release prevents double availability deduction and double capture',t=>{
  const f=fixture(t),a=f.account('a',100),b=f.account('escrow');
  let receipt=f.service.reserve(f.command({accountId:a.accountId,amount:80,ownerRef:'order:1'}));
  let r=receipt.reservation; assert.deepEqual([receipt.accounts[0].balance,receipt.accounts[0].reserved,receipt.accounts[0].available],[100,80,20]);
  assert.throws(()=>f.service.transfer(f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:21})),{code:'INSUFFICIENT_FUNDS'});
  receipt=f.service.capture(f.command({reservationId:r.reservationId,toAccountId:b.accountId,amount:30,expectedVersion:r.version})); r=receipt.reservation;
  assert.deepEqual([receipt.accounts[0].balance,receipt.accounts[0].reserved,receipt.accounts[0].available],[70,50,20]);
  receipt=f.service.release(f.command({reservationId:r.reservationId,amount:20,expectedVersion:r.version})); r=receipt.reservation;
  assert.equal(receipt.accounts[0].available,40);
  receipt=f.service.capture(f.command({reservationId:r.reservationId,toAccountId:b.accountId,expectedVersion:r.version})); r=receipt.reservation;
  assert.deepEqual([r.captured,r.released,r.remaining],[60,20,0]);
  assert.throws(()=>f.service.capture(f.command({reservationId:r.reservationId,toAccountId:b.accountId,expectedVersion:r.version})),{code:'RESERVATION_CLOSED'});
  assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).reserved,0); reconcile(f.db);
});

test('material reserve cannot double sell; delivery and explicit production consumption have ledgers',t=>{
  const f=fixture(t),a=f.stock('supplier',10),b=f.stock('shop');
  let result=f.service.reserveStock(f.command({stockId:a.stockId,amount:8,ownerRef:'production:1'})); let r=result.reservation;
  assert.throws(()=>f.service.transferStock(f.command({fromStockId:a.stockId,toStockId:b.stockId,amount:3})),{code:'INSUFFICIENT_STOCK'});
  result=f.service.captureStock(f.command({reservationId:r.reservationId,toStockId:b.stockId,amount:3,expectedVersion:r.version})); r=result.reservation;
  assert.equal(result.stocks[1].quantity,3);
  result=f.service.captureStock(f.command({reservationId:r.reservationId,consume:true,amount:2,expectedVersion:r.version})); r=result.reservation;
  result=f.service.releaseStock(f.command({reservationId:r.reservationId,expectedVersion:r.version}));
  assert.deepEqual([result.stocks[0].quantity,result.stocks[0].reserved],[5,0]);
  const other=f.stock('shop',0,'cloth');
  assert.throws(()=>f.service.transferStock(f.command({fromStockId:a.stockId,toStockId:other.stockId,amount:1})),{code:'RESOURCE_MISMATCH'}); reconcile(f.db);
});

test('fault after debit, ledger insertion or event insertion rolls back balances/holds/receipts',t=>{
  const f=fixture(t),a=f.account('a',100),b=f.account('b');
  for(const table of ['economy_entries','economy_transactions','town_domain_events']) {
    const before=f.db.prepare('SELECT count(*) n FROM economy_transactions').get().n;
    f.db.exec(`CREATE TRIGGER inject_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'fault'); END`);
    assert.throws(()=>f.service.transfer(f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:10})),/fault/);
    assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).balance,100);
    assert.equal(f.service.getAccount({...f.scope(),accountId:b.accountId}).balance,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM economy_transactions').get().n,before);
    f.db.exec('DROP TRIGGER inject_failure');
  }
  f.db.exec("CREATE TRIGGER inject_failure BEFORE INSERT ON town_domain_events BEGIN SELECT RAISE(ABORT,'fault'); END");
  assert.throws(()=>f.service.reserve(f.command({accountId:a.accountId,amount:50,ownerRef:'bad'})),/fault/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM economy_reservations').get().n,0); reconcile(f.db);
});

test('outer money/material transaction and notifications respect commit, rollback and lost response',t=>{
  const f=fixture(t),a=f.account('a',100),b=f.account('b'),s=f.stock('a',10),dest=f.stock('b');
  let receipt,notifications=0;
  assert.throws(()=>f.db.transaction(()=>{
    receipt=f.service.transfer(f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:20}));
    assert.throws(()=>f.service.flushNotifications(receipt,()=>notifications++),{code:'COMMIT_REQUIRED'});
    f.service.transferStock(f.command({fromStockId:s.stockId,toStockId:dest.stockId,amount:20}));
  })(),{code:'INSUFFICIENT_STOCK'});
  assert.throws(()=>f.service.flushNotifications(receipt,()=>notifications++),{code:'TRANSACTION_NOT_COMMITTED'});
  const command=f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:20});
  f.db.transaction(()=>{
    receipt=f.service.transfer(command);
    f.service.transferStock(f.command({fromStockId:s.stockId,toStockId:dest.stockId,amount:2}));
  })();
  f.service.flushNotifications(receipt,event=>{assert.equal(event.payload.transactionId,receipt.transactionId);notifications++;});
  assert.equal(notifications,1); assert.deepEqual(f.service.transfer(command),receipt); reconcile(f.db);
});

test('reset releaseActive handles money/material holds atomically before epoch and preserves wallets',t=>{
  const f=fixture(t),a=f.account('a',100),s=f.stock('a',10);
  f.service.reserve(f.command({accountId:a.accountId,amount:50,ownerRef:'order:reset'}));
  f.service.reserveStock(f.command({stockId:s.stockId,amount:5,ownerRef:'order:reset'}));
  const command=f.command({reasonCode:'WORLD_RESET'});
  assert.throws(()=>f.db.transaction(()=>{f.service.releaseActive(command);throw new Error('reset fault');})(),/reset fault/);
  assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).reserved,50);
  assert.equal(f.service.getStock({...f.scope(),stockId:s.stockId}).reserved,5);
  const released=f.db.transaction(()=>f.service.releaseActive(command))(); assert.equal(released.count,2);
  assert.deepEqual(f.service.releaseActive(command),released); f.epoch(2);
  assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).balance,100);
  assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).reserved,0);
  assert.equal(f.service.getStock({...f.scope(),stockId:s.stockId}).reserved,0); reconcile(f.db);
});

test('schema rejects incompatible drafts and journal mutation/late inserts',t=>{
  const f=fixture(t); f.account('a',1);
  for(const table of ['economy_transactions','economy_entries']) {
    assert.throws(()=>f.db.exec(`DELETE FROM ${table}`),/Immutable/);
  }
  const tx=f.db.prepare('SELECT transaction_id FROM economy_transactions LIMIT 1').get().transaction_id;
  const b=f.account('b');
  assert.throws(()=>f.db.prepare('INSERT INTO economy_entries VALUES(?,?,1,0)').run(tx,b.accountId),/Sealed/);
  const bad=new Database(':memory:'); t.after(()=>bad.close()); bad.exec('CREATE TABLE town_resource_stocks(owner_key TEXT)');
  assert.throws(()=>migrateTownEconomySchema(bad),/Incompatible|no such column/);
});

test('integer overflow rolls back and canonical actor owner prevents alias wallets',t=>{
  const f=fixture(t); const a=f.account('a',Number.MAX_SAFE_INTEGER),b=f.account('b');
  assert.throws(()=>f.service.seed(f.command({accountId:b.accountId,amount:1})),{code:'INTEGER_OVERFLOW'});
  assert.equal(f.service.getAccount({...f.scope(),accountId:b.accountId}).balance,0);
  assert.throws(()=>f.service.ensureAccount({...f.scope(),ownerKey:'actor:alias',accountType:'actor',actorId:'alias'}),{code:'ACTOR_UNAVAILABLE'});
  assert.throws(()=>f.service.ensureAccount({...f.scope(),ownerKey:'random-wallet',accountType:'actor',actorId:'a'}),{code:'INVALID_ACTOR_OWNER'});
  assert.equal(a.balance,Number.MAX_SAFE_INTEGER); reconcile(f.db);
});

test('90-day fixed closed circulation conserves 3400; this is ledger simulation, not economic balance acceptance',t=>{
  const f=fixture(t); const accounts={fund:f.account('fund',2000),producer:f.account('producer',600),cafe:f.account('cafe',400),shop:f.account('shop',400),player:f.account('player')};
  const flows=[['fund','player',30],['producer','player',12],['player','cafe',18],['player','shop',24],['cafe','producer',10],['shop','producer',16],['producer','fund',14],['cafe','fund',8],['shop','fund',8]];
  for(let day=0;day<90;day++) {
    for(const [from,to,amount] of flows) {
      const c=f.command({fromAccountId:accounts[from].accountId,toAccountId:accounts[to].accountId,amount,sourceKey:`day:${day}:${from}:${to}`});
      const receipt=f.service.transfer(c); assert.deepEqual(f.service.transfer(c),receipt);
    }
    assert.equal(f.db.prepare("SELECT sum(balance) n FROM economy_accounts WHERE account_type<>'issuance'").get().n,3400);
  }
  for(const original of Object.values(accounts)) assert.equal(f.service.getAccount({...f.scope(),accountId:original.accountId}).balance,original.balance);
  assert.equal(f.db.prepare("SELECT count(*) n FROM economy_transactions WHERE command='transfer'").get().n,810); reconcile(f.db);
});

test('two real SQLite WAL workers race the last balance; exactly one debit commits',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'town-economy-test-')); const path=join(directory,'race.db');
  // Register cleanup after fixture closure; explicit boundary check before recursive cleanup.
  const f=fixture(t,path); const a=f.account('a',10),b=f.account('b'),c=f.account('c');
  try {
    const results=await race(path,[b,c].map(to=>f.command({fromAccountId:a.accountId,toAccountId:to.accountId,amount:7})));
    assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal(results.find(r=>!r.ok).code,'INSUFFICIENT_FUNDS');
    assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).balance,3); reconcile(f.db);
  } finally {
    // Windows needs the database handle closed before removing WAL files.
    f.db.close();
    removeFixtureDirectory(directory);
  }
});

test('real WAL workers replay one request/source exactly once and contend for last material units',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'town-economy-test-')); const path=join(directory,'race.db');
  const f=fixture(t,path); const a=f.account('a',10),b=f.account('b'),s=f.stock('a',10),dest=f.stock('b');
  try {
    const command=f.command({fromAccountId:a.accountId,toAccountId:b.accountId,amount:7});
    const results=await race(path,[command,command]);
    assert.ok(results.every(r=>r.ok)); assert.equal(results[0].transactionId,results[1].transactionId);
    assert.equal(f.service.getAccount({...f.scope(),accountId:a.accountId}).balance,3);
    const material=await race(path,[1,2].map(()=>f.command({fromStockId:s.stockId,toStockId:dest.stockId,amount:7})),'transferStock');
    assert.equal(material.filter(r=>r.ok).length,1); assert.equal(material.find(r=>!r.ok).code,'INSUFFICIENT_STOCK');
    assert.equal(f.service.getStock({...f.scope(),stockId:s.stockId}).quantity,3); reconcile(f.db);
  } finally { f.db.close(); removeFixtureDirectory(directory); }
});
