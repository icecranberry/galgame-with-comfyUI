import {randomUUID,createHash} from 'node:crypto';
import {canonicalJson,requireText,townError} from './townEventService.js';
import {createTownOrderService} from './townOrderService.js';

export const TOWN_LIQUIDITY_LIMITS=Object.freeze({reserve:60,target:90,maxIssue:30,
  rolling24h:30,rolling7d:210,grossWorld:600,circulation:4000,cooldownMs:86400000});

/** Same conservative window query for enforcement and read-only status. Future
 * records remain counted on clock rollback; they must not free grant capacity. */
export function readTownLiquidityUsage(db,worldId,time) {
  return db.prepare(`SELECT COALESCE(SUM(amount),0) grossIssued,MAX(occurred_at) lastIssuedAt,
    COALESCE(SUM(CASE WHEN occurred_at>? THEN amount ELSE 0 END),0) issued24h,
    COALESCE(SUM(CASE WHEN occurred_at>? THEN amount ELSE 0 END),0) issued7d
    FROM town_liquidity_issues WHERE world_id=?`).get(time-86400000,time-7*86400000,worldId);
}

/** Trusted opt-in bridge. No timers, config changes, seed calls or broadcasts.
 * `enabled` is server configuration, never a request field. Instantiate on the
 * same DB/clock as economy. Position/actor validation is done by actual orders.
 * Forward time grants no catch-up allowance; a rollback pauses new policy work.
 */
export function createTownLiquidityPolicy({db,clock,registry,economy,position,enabled=false,consumers=[]}) {
  if(typeof enabled!=='boolean' || !economy?.issueLiquidity)throw townError('MISSING_DEPENDENCY');
  const orders=createTownOrderService({db,clock,registry,economy,position,consumers});
  function epoch(input) {
    requireText(input.worldId);
    if(!Number.isSafeInteger(input.worldEpoch)||registry.getWorldEpoch(input.worldId)!==input.worldEpoch)throw townError('STALE_EPOCH');
  }
  function getState(input) {
    epoch(input);
    return db.prepare('SELECT * FROM town_liquidity_state WHERE world_id=?').get(input.worldId)??null;
  }
  function checkActivation(input) {
    epoch(input);
    const row=db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(input.worldId,input.worldEpoch);
    if(!row)throw townError('SLICE_NOT_CONFIGURED');
    const fund=economy.getAccount({...input,accountId:JSON.parse(row.config).accounts.fund});
    return {allowed:fund.available>=TOWN_LIQUIDITY_LIMITS.reserve,reason:fund.available>=TOWN_LIQUIDITY_LIMITS.reserve?'READY':'LIQUIDITY_ACTIVATION_RESERVE_REQUIRED',
      available:fund.available,minimumAvailable:TOWN_LIQUIDITY_LIMITS.reserve,fundVersion:fund.version,policyVersion:getState(input)?.version??0};
  }
  function getStatus(input) {
    epoch(input);
    const time=clock.now();
    if(!Number.isSafeInteger(time)||time<0)throw townError('INVALID_CLOCK');
    const state=getState(input),usage=readTownLiquidityUsage(db,input.worldId,time);
    const row=db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(input.worldId,input.worldEpoch);
    const fund=row?economy.getAccount({...input,accountId:JSON.parse(row.config).accounts.fund}):null;
    return {enabled,limits:TOWN_LIQUIDITY_LIMITS,grossIssued:usage.grossIssued,
      remainingWorldBudget:Math.max(0,TOWN_LIQUIDITY_LIMITS.grossWorld-usage.grossIssued),
      issued24h:usage.issued24h,issued7d:usage.issued7d,availableFund:fund?.available??null,
      activationAllowed:!!fund&&fund.available>=TOWN_LIQUIDITY_LIMITS.reserve,lastObservedAt:state?.last_observed_at??null};
  }
  function publish(input) {
    return db.transaction(()=>{
      epoch(input);requireText(input.idempotencyKey);requireText(input.actorId);
      const player=registry.getActor(input.actorId,input.worldId,{followMerged:false});
      if(!player||player.actorId!==input.actorId||player.playerId!=='me'||!player.participating||player.archived||player.mergedInto)throw townError('ACTOR_UNAVAILABLE');
      const requestHash=createHash('sha256').update(canonicalJson(input)).digest('hex');
      const old=db.prepare('SELECT * FROM town_liquidity_requests WHERE world_id=? AND request_key=?').get(input.worldId,input.idempotencyKey);
      if(old) {
        if(old.request_hash!==requestHash)throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(old.response);
      }
      const time=clock.now();
      if(!Number.isSafeInteger(time)||time<0||time>8640000000000000-86400000)throw townError('INVALID_CLOCK');
      let state=getState(input);
      if(enabled && state && time<state.last_observed_at)throw townError('LIQUIDITY_CLOCK_ROLLBACK');
      if(input.expectedPolicyVersion!==undefined && input.expectedPolicyVersion!==(state?.version??0))throw townError('VERSION_CONFLICT');
      const slice=db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(input.worldId,input.worldEpoch);
      if(!slice)throw townError('SLICE_NOT_CONFIGURED');
      const config=JSON.parse(slice.config);
      const fund=economy.getAccount({...input,accountId:config.accounts.fund});
      if(input.expectedFundVersion!==undefined && input.expectedFundVersion!==fund.version)throw townError('VERSION_CONFLICT');
      let amount=0;
      if(enabled && fund.available<TOWN_LIQUIDITY_LIMITS.target) {
        if(fund.available<TOWN_LIQUIDITY_LIMITS.reserve) {
          const error=townError(state?.enabled===1?'LIQUIDITY_RESERVE_REQUIRED':'LIQUIDITY_ACTIVATION_RESERVE_REQUIRED');
          error.available=fund.available;error.minimumAvailable=TOWN_LIQUIDITY_LIMITS.reserve;throw error;
        }
        amount=TOWN_LIQUIDITY_LIMITS.target-fund.available;
      }
      if(state)db.prepare('UPDATE town_liquidity_state SET version=version+1,enabled=?,last_observed_at=? WHERE world_id=? AND version=?')
        .run(Number(enabled),Math.max(time,state.last_observed_at),input.worldId,state.version);
      else db.prepare('INSERT INTO town_liquidity_state(world_id,enabled,last_observed_at) VALUES(?,?,?)').run(input.worldId,Number(enabled),time);
      state=getState(input);
      const key=`liquidity-order:${createHash('sha256').update(canonicalJson({worldId:input.worldId,key:input.idempotencyKey})).digest('hex')}`;
      // Publish first while funds>=60, so issuance verifies an actual fully held
      // order, rather than trusting a promise/callback to publish later.
      const result=orders.publish({worldId:input.worldId,worldEpoch:input.worldEpoch,idempotencyKey:key,sourceKey:key});
      let receipt=null;
      if(amount) {
        const authorizationId=randomUUID();
        const held=economy.getAccount({...input,accountId:fund.accountId});
        db.prepare(`INSERT INTO town_liquidity_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(authorizationId,input.worldId,input.worldEpoch,result.order.orderId,input.actorId,fund.accountId,
            amount,fund.available,held.version,state.version,time);
        receipt=economy.issueLiquidity({worldId:input.worldId,worldEpoch:input.worldEpoch,authorizationId,
          idempotencyKey:`liquidity:${authorizationId}`,sourceKey:`liquidity:${authorizationId}`,reasonCode:'PUBLIC_DELIVERY_LIQUIDITY'});
      }
      epoch(input);
      const response={...result,liquidity:{enabled,issued:amount,receipt,policyVersion:state.version}};
      db.prepare('INSERT INTO town_liquidity_requests VALUES(?,?,?,?)').run(input.worldId,input.idempotencyKey,requestHash,canonicalJson(response));
      return response;
    }).immediate();
  }
  return {publish,getState,getStatus,checkActivation};
}
