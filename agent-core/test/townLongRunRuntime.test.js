import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReplay,START,DAY} from './fixtures/townLongRunRuntime.js';
import {summarizeReplay} from './fixtures/townLongRunMetrics.js';

const output = new URL('../../output/hd2d-m7-long-run/',import.meta.url);
const results = {};
async function replay(t,mode) {
  const f = createReplay(t), daily=[], failures={}, trips=[];
  try {
    for(let day=1;day<=90;day++) {
      f.setNow(START+(day-1)*DAY);f.tick(0);
      for(let attempt=0;attempt<(mode==='normal'?3:1);attempt++) {
        try {trips.push(await f.delivery());}
        catch(error) {
          if(!['INSUFFICIENT_STOCK','INSUFFICIENT_FUNDS','LIQUIDITY_COOLDOWN','LIQUIDITY_CAP','LIQUIDITY_RESERVE_REQUIRED'].includes(error.code))throw error;
          failures[error.code]=(failures[error.code]||0)+1;break;
        }
        if(mode==='normal') {
          await f.consume();
          const before = f.scalar("SELECT count(*) n FROM town_productions WHERE status='completed'");
          for(let minute=0;minute<20;minute++) {
            f.tick();
            if(f.scalar("SELECT count(*) n FROM town_productions WHERE status='completed'")>before)break;
          }
        }
      }
      f.setNow(START+(day-1)*DAY+9*3600000);f.tick(0);
      const row=f.inspect(day);assert.equal(row.moneyReserved,0);daily.push(row);
      if(day%30===0)console.log(JSON.stringify({mode,day,...row,failures}));
    }
    assert.deepEqual(f.networkAttempts,[]);
    const income=trips.reduce((n,t)=>n+t.income,0),travelMs=trips.reduce((n,t)=>n+t.travelMs,0);
    const poor=trips.filter(t=>t.poor).map(t=>t.entryMs);
    return {mode,daily,failures,income,travelMs,incomePerMovementMinute:income/(travelMs/60000),
      poorEntryMs:{count:poor.length,min:Math.min(...poor),max:Math.max(...poor)},at30:daily[29],at90:daily[89]};
  } finally {f.close();}
}

test('30/90 days through actual movement, service, work proofs and bounded liquidity; deterministic replay',async t=>{
  await fs.mkdir(output,{recursive:true});
  for(const mode of ['normal','hoard']) {
    const first=await replay(t,mode);
    results[mode]=first;await fs.writeFile(new URL('results.json',output),JSON.stringify(results,null,2));
    const repeated=await replay(t,mode);
    assert.deepEqual(repeated,first,'fresh in-memory replay must reproduce all daily aggregates');
    results[mode].deterministic=true;results[mode].metrics=summarizeReplay(first);
    await fs.writeFile(new URL('results.json',output),JSON.stringify(results,null,2));
  }
});

test('30/90-day offline recovery settles real paid service and production holds once, without catch-up issuance or proofs',async t=>{
  const recovery=[];
  for(const days of [30,90]) {
    const f=createReplay(t);
    try {
      await f.delivery();await f.consume();f.runtime.maintainTownOrders();
      assert.equal(f.scalar("SELECT count(*) n FROM town_productions WHERE status='reserved'"),1);
      await f.delivery();
      let service=await f.runtime.executeTownService('offer',null,f.cmd());
      service=await f.runtime.executeTownService('accept',service.sessionId,{...f.cmd(),expectedVersion:service.version});
      for(const intentKey of ['choose_theme','confirm_materials'])service=await f.runtime.executeTownService('turn',service.sessionId,{...f.cmd(),expectedVersion:service.version,intentKey});
      const before=f.inspect(0);
      const transactions=f.scalar('SELECT count(*) n FROM economy_transactions');
      f.town.stopTownScheduler();f.setNow(START+days*DAY+9*3600000);
      assert.equal(f.scalar('SELECT count(*) n FROM economy_transactions'),transactions,'clock advance alone does no work');
      f.town.startTownScheduler();f.runtime.maintainTownOrders();
      const after=f.inspect(days);
      assert.equal(after.moneyReserved,0);assert.equal(after.proofs,0);assert.equal(after.resource,200);
      assert.equal(after.issued,0);assert.equal(after.production.expired,1);
      service=f.context.services.get({...f.scope,actorId:f.context.player.actorId,sessionId:service.sessionId});
      assert.equal(service.status,'expired');assert.equal(service.settlement.refund,20);assert.equal(service.settlement.payout,10);
      const settledTransactions=f.scalar('SELECT count(*) n FROM economy_transactions');
      f.runtime.maintainTownOrders();
      assert.equal(f.scalar('SELECT count(*) n FROM economy_transactions'),settledTransactions);
      assert.deepEqual(f.inspect(days),after);
      // Policy observes server clock rollback on a new request; old receipts stay idempotent.
      const current=f.now;f.setNow(START-1);
      assert.throws(()=>f.runtime.executeTownOrder('publish',null,f.cmd()),{code:'LIQUIDITY_CLOCK_ROLLBACK'});
      f.setNow(current);assert.deepEqual(f.inspect(days),after);
      recovery.push({days,before,after,settlement:{status:service.status,refund:service.settlement.refund,payout:service.settlement.payout},rollbackRejected:true});
    } finally {f.close();}
  }
  await fs.mkdir(output,{recursive:true});await fs.writeFile(new URL('recovery.json',output),JSON.stringify(recovery,null,2));
});
