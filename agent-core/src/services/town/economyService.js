import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';
import { TOWN_LIQUIDITY_LIMITS, readTownLiquidityUsage } from './townLiquidityPolicy.js';

const MAX = Number.MAX_SAFE_INTEGER;
const accountDto = r => r && ({ accountId:r.account_id,worldId:r.world_id,ownerKey:r.owner_key,actorId:r.actor_id,
  accountType:r.account_type,currency:r.currency,balance:r.balance,reserved:r.reserved,available:r.balance-r.reserved,version:r.version });
const stockDto = r => r && ({ stockId:r.stock_id,worldId:r.world_id,ownerKey:r.owner_key,resourceKey:r.resource_key,
  quantity:r.quantity,reserved:r.reserved,available:r.quantity-r.reserved,version:r.version });
const reservationDto = r => r && ({ reservationId:r.reservation_id,worldId:r.world_id,worldEpoch:r.world_epoch,
  assetType:r.asset_type,assetId:r.asset_id,ownerRef:r.owner_ref,amount:r.amount,captured:r.captured,released:r.released,
  remaining:r.remaining,version:r.version });
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
function integer(value, min=1) {
  if (!Number.isSafeInteger(value) || value < min) throw townError('INVALID_AMOUNT');
  return value;
}
function sum(a,b) {
  const value=BigInt(a)+BigInt(b);
  if (value>BigInt(MAX) || value < -BigInt(MAX)) throw townError('INTEGER_OVERFLOW');
  return Number(value);
}

/** Trusted server command API, not an authorization layer. No singleton DB or external side effects. */
export function createEconomyService({db,clock,getWorldEpoch,getActor,consumers=[]}) {
  if (!db?.transaction || !clock?.now || typeof getWorldEpoch!=='function' || typeof getActor!=='function') throw townError('MISSING_DEPENDENCY');
  const events=createTownEventService({db,clock,getWorldEpoch,
    validators:{'town.economy.changed':p=>typeof p?.transactionId==='string' && typeof p.command==='string'}});
  function epoch(input) {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch<1 || getWorldEpoch(input.worldId)!==input.worldEpoch) throw townError('STALE_EPOCH');
  }
  function account(id,worldId) {
    requireText(id);
    const row=db.prepare('SELECT * FROM economy_accounts WHERE account_id=? AND world_id=?').get(id,worldId);
    if (!row) throw townError('ACCOUNT_NOT_FOUND');
    return accountDto(row);
  }
  function stock(id,worldId) {
    requireText(id);
    const row=db.prepare('SELECT * FROM town_resource_stocks WHERE stock_id=? AND world_id=?').get(id,worldId);
    if (!row) throw townError('STOCK_NOT_FOUND');
    return stockDto(row);
  }
  function ensureAccount(input) {
    return db.transaction(()=>{
      epoch(input); requireText(input.ownerKey);
      if (!['actor','business','fund','escrow'].includes(input.accountType)) throw townError('INVALID_ACCOUNT_TYPE');
      if (input.ownerKey.startsWith('system:')) throw townError('RESERVED_OWNER');
      const actorId=input.actorId ?? null;
      if (input.accountType==='actor' && actorId===null) throw townError('ACTOR_REQUIRED');
      if (actorId!==null) {
        const actor=getActor(actorId,input.worldId);
        if (!actor || actor.actorId!==actorId || actor.mergedInto) throw townError('ACTOR_UNAVAILABLE');
      }
      if (input.accountType==='actor' && input.ownerKey!==`actor:${actorId}`) throw townError('INVALID_ACTOR_OWNER');
      db.prepare(`INSERT OR IGNORE INTO economy_accounts(account_id,world_id,owner_key,actor_id,account_type)
        VALUES(?,?,?,?,?)`).run(randomUUID(),input.worldId,input.ownerKey,actorId,input.accountType);
      const result=accountDto(db.prepare('SELECT * FROM economy_accounts WHERE world_id=? AND owner_key=?').get(input.worldId,input.ownerKey));
      if (result.actorId!==actorId || result.accountType!==input.accountType) throw townError('ACCOUNT_CONFLICT');
      return result;
    }).immediate();
  }
  function ensureStock(input) {
    return db.transaction(()=>{
      epoch(input); requireText(input.ownerKey); requireText(input.resourceKey);
      db.prepare(`INSERT OR IGNORE INTO town_resource_stocks(stock_id,world_id,owner_key,resource_key) VALUES(?,?,?,?)`)
        .run(randomUUID(),input.worldId,input.ownerKey,input.resourceKey);
      return stockDto(db.prepare('SELECT * FROM town_resource_stocks WHERE world_id=? AND owner_key=? AND resource_key=?')
        .get(input.worldId,input.ownerKey,input.resourceKey));
    }).immediate();
  }
  function issuance(worldId) {
    db.prepare(`INSERT OR IGNORE INTO economy_accounts(account_id,world_id,owner_key,account_type)
      VALUES(?,?,'system:issuance','issuance')`).run(randomUUID(),worldId);
    return accountDto(db.prepare("SELECT * FROM economy_accounts WHERE world_id=? AND owner_key='system:issuance'").get(worldId));
  }
  function version(asset,expected,required=false) {
    if ((required || expected!==undefined) && (!Number.isSafeInteger(expected) || expected!==asset.version)) throw townError('VERSION_CONFLICT');
  }
  function ordinary(a) { if (a.accountType==='issuance') throw townError('SYSTEM_ACCOUNT_NOT_SPENDABLE'); }

  // The write lock is acquired before reading balances, including across Node workers/processes.
  // Nested calls use savepoints; notifications stay explicitly outside the outer transaction.
  function execute(command,input,body) {
    return db.transaction(()=>{
      epoch(input); requireText(input.idempotencyKey); requireText(input.sourceKey); requireText(input.reasonCode);
      if (input.sourceEventId!=null) requireText(input.sourceEventId);
      // Epoch is a write fence, not business identity. A map rebuild must not
      // turn the same accepted request/seed into a fresh grant.
      const {worldEpoch:requestEpoch,...requestInput}=input;
      const requestHash=hash({command,input:requestInput});
      const {idempotencyKey,worldEpoch,expectedVersion,expectedToVersion,...semantic}=input;
      const sourceHash=hash({command,input:semantic});
      const previous=db.prepare(`SELECT r.request_hash,t.response FROM economy_requests r
        JOIN economy_transactions t USING(transaction_id) WHERE r.world_id=? AND r.request_key=?`)
        .get(input.worldId,idempotencyKey);
      if (previous) {
        if (previous.request_hash!==requestHash) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(previous.response);
      }
      const sourced=db.prepare('SELECT * FROM economy_transactions WHERE world_id=? AND source_key=?').get(input.worldId,input.sourceKey);
      if (sourced) {
        if (sourced.request_hash!==sourceHash) throw townError('SOURCE_CONFLICT');
        db.prepare('INSERT INTO economy_requests VALUES(?,?,?,?)').run(input.worldId,idempotencyKey,requestHash,sourced.transaction_id);
        return JSON.parse(sourced.response);
      }
      const transactionId=randomUUID();
      const context={transactionId,money:[],materials:[],accounts:[],stocks:[]};
      const extra=body(context) ?? {};
      if (context.money.reduce((total,e)=>total+BigInt(e.amount),0n)!==0n) throw townError('UNBALANCED_TRANSACTION');
      for (const entry of context.money) db.prepare('INSERT INTO economy_entries VALUES(?,?,?,?)')
        .run(transactionId,entry.id,entry.amount,entry.reservedDelta);
      for (const entry of context.materials) db.prepare('INSERT INTO town_resource_entries VALUES(?,?,?,?)')
        .run(transactionId,entry.id,entry.amount,entry.reservedDelta);
      const eventId=`economy:${transactionId}`;
      const result={transactionId,eventId,accounts:context.accounts,stocks:context.stocks,...extra};
      const now=clock.now(); integer(now,0);
      // Receipt is final on insertion; ledger tables reject subsequent UPDATE/DELETE.
      db.prepare('INSERT INTO economy_transactions VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(transactionId,input.worldId,input.worldEpoch,input.sourceKey,sourceHash,command,input.reasonCode,input.sourceEventId??null,now,canonicalJson(result));
      events.append({eventId,worldId:input.worldId,worldEpoch:input.worldEpoch,type:'town.economy.changed',occurredAt:now,
        actorIds:[...new Set(context.accounts.map(a=>a.actorId).filter(Boolean))],
        source:{system:'town.economy',entityId:transactionId},
        payload:{transactionId,command,reasonCode:input.reasonCode,sourceEventId:input.sourceEventId??null,
          accountIds:context.accounts.map(a=>a.accountId),stockIds:context.stocks.map(s=>s.stockId)}},consumers);
      db.prepare('INSERT INTO economy_requests VALUES(?,?,?,?)').run(input.worldId,idempotencyKey,requestHash,transactionId);
      return result;
    }).immediate();
  }
  function moneyChange(ctx,a,amount,reservedDelta=0) {
    const balance=sum(a.balance,amount),reserved=sum(a.reserved,reservedDelta);
    if (reserved<0 || (a.accountType!=='issuance' && balance<reserved)) throw townError('INSUFFICIENT_FUNDS');
    const change=db.prepare('UPDATE economy_accounts SET balance=?,reserved=?,version=version+1 WHERE account_id=? AND version=?')
      .run(balance,reserved,a.accountId,a.version);
    if (change.changes!==1) throw townError('VERSION_CONFLICT');
    ctx.money.push({id:a.accountId,amount,reservedDelta});
    ctx.accounts.push(account(a.accountId,a.worldId));
  }
  function stockChange(ctx,s,amount,reservedDelta=0) {
    const quantity=sum(s.quantity,amount),reserved=sum(s.reserved,reservedDelta);
    if (reserved<0 || quantity<reserved) throw townError('INSUFFICIENT_STOCK');
    const change=db.prepare('UPDATE town_resource_stocks SET quantity=?,reserved=?,version=version+1 WHERE stock_id=? AND version=?')
      .run(quantity,reserved,s.stockId,s.version);
    if (change.changes!==1) throw townError('VERSION_CONFLICT');
    ctx.materials.push({id:s.stockId,amount,reservedDelta});
    ctx.stocks.push(stock(s.stockId,s.worldId));
  }
  function seed(input) {
    const seedVersion=input.seedVersion??1; integer(seedVersion);
    return execute('seed',{...input,seedVersion,sourceKey:`seed:money:${input.accountId}:${seedVersion}`},ctx=>{
      integer(input.amount,0); const to=account(input.accountId,input.worldId); ordinary(to);
      const from=issuance(input.worldId);
      moneyChange(ctx,from,-input.amount); moneyChange(ctx,to,input.amount);
    });
  }
  function seedStock(input) {
    const seedVersion=input.seedVersion??1; integer(seedVersion);
    return execute('seedStock',{...input,seedVersion,sourceKey:`seed:stock:${input.stockId}:${seedVersion}`},ctx=>{
      integer(input.amount,0); stockChange(ctx,stock(input.stockId,input.worldId),input.amount);
    });
  }
  function transfer(input) {
    return execute('transfer',input,ctx=>{
      integer(input.amount); const from=account(input.fromAccountId,input.worldId),to=account(input.toAccountId,input.worldId);
      ordinary(from); ordinary(to); version(from,input.expectedVersion); version(to,input.expectedToVersion);
      if (from.accountId===to.accountId) throw townError('SAME_ASSET');
      moneyChange(ctx,from,-input.amount); moneyChange(ctx,to,input.amount);
    });
  }
  // Only the synchronous production completion transaction may issue output.
  // Stable production identity is independent of caller request/source keys.
  function produceStock(input) {
    if (!db.inTransaction) throw townError('PRODUCTION_TRANSACTION_REQUIRED');
    requireText(input.productionId);
    epoch(input);
    const identity=db.prepare('SELECT world_id,world_epoch FROM town_productions WHERE production_id=?').get(input.productionId);
    if (!identity || identity.world_id!==input.worldId || identity.world_epoch!==input.worldEpoch) throw townError('INVALID_PRODUCTION_OUTPUT');
    return execute('produceStock',{...input,sourceKey:`production:stock:${input.productionId}`},ctx=>{
      const invalid=()=>{throw townError('INVALID_PRODUCTION_OUTPUT');};
      const row=db.prepare('SELECT * FROM town_productions WHERE production_id=? AND world_id=? AND world_epoch=?')
        .get(input.productionId,input.worldId,input.worldEpoch);
      if (!row || row.status!=='reserved' || input.amount!==1) invalid();
      const config=JSON.parse(row.config),to=stock(input.stockId,input.worldId),now=clock.now();integer(now,0);
      if (config.recipe?.key!=='town.raw_material.harvest.v1' || config.recipe.quantity!==1 ||
          input.stockId!==config.stocks?.supplier || to.resourceKey!=='delivery:raw_material' ||
          to.ownerKey!=='delivery:business:supplier' || now>=row.expires_at) invalid();
      const money=db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=?').get(row.money_reservation_id);
      if (!money || money.world_id!==input.worldId || money.world_epoch!==input.worldEpoch || money.asset_type!=='money' ||
          money.asset_id!==config.accounts.workshop || money.owner_ref!==`production:${row.production_id}` ||
          money.amount!==30 || money.remaining!==30) invalid();
      const proofs=db.prepare(`SELECT p.role,a.* FROM town_production_proofs p JOIN town_actions a ON a.id=p.action_id
        WHERE p.production_id=?`).all(row.production_id);
      if (proofs.length!==2 || new Set(proofs.map(p=>p.role)).size!==2 || new Set(proofs.map(p=>p.actor_id)).size!==2) invalid();
      for (const proof of proofs) {
        const actorId=config.npcActorIds?.[proof.role],target=config.locationKeys?.[proof.role];
        const result=JSON.parse(proof.result||'null');
        if (proof.actor_id!==actorId || proof.world_id!==input.worldId || proof.world_epoch!==input.worldEpoch ||
            proof.type!=='work_shift' || proof.status!=='completed' || proof.target!==target ||
            !Number.isSafeInteger(proof.started_at) || proof.started_at<row.created_at ||
            !Number.isSafeInteger(proof.due_at) || proof.due_at-proof.started_at<300000 || proof.updated_at>now ||
            !Number.isSafeInteger(result?.attendanceMs) || result.attendanceMs<300000 ||
            !Number.isSafeInteger(result?.completedAt) || result.completedAt<proof.due_at ||
            result.completedAt!==proof.updated_at || result.economicEffects!=='none') invalid();
        if (!db.prepare(`SELECT 1 FROM town_activity_log WHERE action_id=? AND actor_id=? AND world_id=? AND world_epoch=?
          AND phase='completed' AND reason_code='DURATION_ELAPSED' AND location_key=? AND occurred_at=?`)
          .get(proof.id,actorId,input.worldId,input.worldEpoch,target,proof.updated_at)) invalid();
      }
      // With the write lock held, exactly this batch must have consumed capacity
      // after reservation and before its immutable output ledger is inserted.
      const node=db.prepare('SELECT * FROM town_production_nodes WHERE world_id=?').get(input.worldId);
      const issued=db.prepare("SELECT count(*) n FROM economy_transactions WHERE world_id=? AND command='produceStock'").get(input.worldId).n;
      const reserved=db.prepare("SELECT count(*) n FROM town_productions WHERE world_id=? AND status='reserved'").get(input.worldId).n;
      if (!node || node.capacity!==200 || node.capacity-node.remaining!==issued+1 || node.reserved!==reserved-1) invalid();
      stockChange(ctx,to,1);
      return {productionId:row.production_id};
    });
  }
  /** Policy-only issuance backed by a real unpublished-to-clients order and its
   * two reservations. A naked request/amount or seed version cannot authorize it. */
  function issueLiquidity(input) {
    if(!db.inTransaction)throw townError('LIQUIDITY_TRANSACTION_REQUIRED');
    epoch(input);requireText(input.authorizationId);
    const proof=db.prepare('SELECT * FROM town_liquidity_authorizations WHERE authorization_id=?').get(input.authorizationId);
    if(!proof||proof.world_id!==input.worldId||proof.world_epoch!==input.worldEpoch)throw townError('LIQUIDITY_PROOF_INVALID');
    return execute('issueLiquidity',{...input,sourceKey:`liquidity:issue:${input.authorizationId}`,reasonCode:'PUBLIC_DELIVERY_LIQUIDITY'},ctx=>{
      const invalid=()=>{throw townError('LIQUIDITY_PROOF_INVALID');};
      const state=db.prepare('SELECT * FROM town_liquidity_state WHERE world_id=?').get(input.worldId);
      const now=clock.now();integer(now,0);
      if(!state||state.enabled!==1||state.version!==proof.state_version||state.last_observed_at!==proof.occurred_at||now<proof.occurred_at)invalid();
      const actor=getActor(proof.actor_id,input.worldId);
      if(!actor||actor.actorId!==proof.actor_id||actor.playerId!=='me'||!actor.participating||actor.archived||actor.mergedInto)invalid();
      const order=db.prepare('SELECT * FROM town_delivery_orders WHERE order_id=?').get(proof.order_id);
      if(!order||order.world_id!==input.worldId||order.world_epoch!==input.worldEpoch||order.status!=='open'||order.version!==1||
          order.created_at<proof.occurred_at||order.created_at>now||order.expires_at<=now)invalid();
      const config=JSON.parse(order.config),fund=account(proof.fund_id,input.worldId);
      if(config.reward!==30||config.materialQuantity!==1||config.accounts.fund!==fund.accountId||fund.accountType!=='fund'||
          fund.ownerKey!=='delivery:public-fund'||fund.version!==proof.fund_version||fund.available!==proof.before_available-30||
          proof.amount!==TOWN_LIQUIDITY_LIMITS.target-proof.before_available||proof.amount<1||proof.amount>TOWN_LIQUIDITY_LIMITS.maxIssue||
          proof.before_available<TOWN_LIQUIDITY_LIMITS.reserve||proof.before_available>=TOWN_LIQUIDITY_LIMITS.target)invalid();
      for(const [id,type,assetId,amount] of [[order.money_reservation_id,'money',fund.accountId,30],
        [order.material_reservation_id,'stock',config.stocks.supplier,1]]) {
        const hold=db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=?').get(id);
        if(!hold||hold.world_id!==input.worldId||hold.world_epoch!==input.worldEpoch||hold.asset_type!==type||
            hold.asset_id!==assetId||hold.owner_ref!==`order:${order.order_id}`||hold.amount!==amount||hold.remaining!==amount)invalid();
      }
      if(!db.prepare(`SELECT 1 FROM town_business_log l JOIN town_domain_events e ON e.event_id=l.event_id
        WHERE l.order_id=? AND l.world_id=? AND l.world_epoch=? AND l.phase='open' AND l.event_id=?
        AND l.occurred_at=? AND e.type='town.delivery.changed'`).get(order.order_id,input.worldId,input.worldEpoch,
          `delivery:${order.order_id}:1`,order.created_at))invalid();
      const usage=readTownLiquidityUsage(db,input.worldId,proof.occurred_at);
      if(usage.lastIssuedAt!==null&&proof.occurred_at-usage.lastIssuedAt<TOWN_LIQUIDITY_LIMITS.cooldownMs)throw townError('LIQUIDITY_COOLDOWN');
      if(usage.grossIssued+proof.amount>TOWN_LIQUIDITY_LIMITS.grossWorld||usage.issued24h+proof.amount>TOWN_LIQUIDITY_LIMITS.rolling24h||
          usage.issued7d+proof.amount>TOWN_LIQUIDITY_LIMITS.rolling7d)throw townError('LIQUIDITY_CAP');
      const circulation=db.prepare("SELECT COALESCE(SUM(balance),0) total FROM economy_accounts WHERE world_id=? AND account_type<>'issuance'").get(input.worldId).total;
      if(BigInt(circulation)+BigInt(proof.amount)>BigInt(TOWN_LIQUIDITY_LIMITS.circulation))throw townError('LIQUIDITY_CIRCULATION_CAP');
      moneyChange(ctx,issuance(input.worldId),-proof.amount);moneyChange(ctx,fund,proof.amount);
      db.prepare('INSERT INTO town_liquidity_issues VALUES(?,?,?,?,?)').run(proof.authorization_id,ctx.transactionId,input.worldId,proof.amount,proof.occurred_at);
      return {authorizationId:proof.authorization_id,orderId:order.order_id,issued:proof.amount};
    });
  }
  function transferStock(input) {
    return execute('transferStock',input,ctx=>{
      integer(input.amount); const from=stock(input.fromStockId,input.worldId),to=stock(input.toStockId,input.worldId);
      version(from,input.expectedVersion); version(to,input.expectedToVersion);
      if (from.stockId===to.stockId) throw townError('SAME_ASSET');
      if (from.resourceKey!==to.resourceKey) throw townError('RESOURCE_MISMATCH');
      stockChange(ctx,from,-input.amount); stockChange(ctx,to,input.amount);
    });
  }
  function reserveAsset(type,input) {
    return execute(type==='money'?'reserve':'reserveStock',input,ctx=>{
      integer(input.amount); requireText(input.ownerRef);
      const a=type==='money'?account(input.accountId,input.worldId):stock(input.stockId,input.worldId);
      version(a,input.expectedVersion);
      if (type==='money') ordinary(a);
      const assetId=type==='money'?a.accountId:a.stockId;
      if (db.prepare('SELECT 1 FROM economy_reservations WHERE world_id=? AND asset_type=? AND asset_id=? AND owner_ref=?')
        .get(input.worldId,type,assetId,input.ownerRef)) throw townError('RESERVATION_OWNER_CONFLICT');
      const id=randomUUID();
      db.prepare(`INSERT INTO economy_reservations(reservation_id,world_id,world_epoch,asset_type,asset_id,owner_ref,amount,remaining)
        VALUES(?,?,?,?,?,?,?,?)`).run(id,input.worldId,input.worldEpoch,type,assetId,input.ownerRef,input.amount,input.amount);
      (type==='money'?moneyChange:stockChange)(ctx,a,0,input.amount);
      return {reservation:reservationDto(db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=?').get(id))};
    });
  }
  function finishReservation(type,operation,input) {
    return execute(operation+(type==='stock'?'Stock':''),input,ctx=>{
      const r=reservationDto(db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=? AND world_id=?')
        .get(input.reservationId,input.worldId));
      if (!r || r.assetType!==type) throw townError('RESERVATION_NOT_FOUND');
      if (r.worldEpoch!==input.worldEpoch) throw townError('STALE_RESERVATION');
      version(r,input.expectedVersion,true);
      if (r.remaining===0) throw townError('RESERVATION_CLOSED');
      const amount=input.amount??r.remaining; integer(amount);
      if (amount>r.remaining) throw townError('RESERVATION_EXCEEDED');
      const a=type==='money'?account(r.assetId,input.worldId):stock(r.assetId,input.worldId);
      if (operation==='release') (type==='money'?moneyChange:stockChange)(ctx,a,0,-amount);
      else if (type==='money') {
        const to=account(input.toAccountId,input.worldId); ordinary(to);
        if (to.accountId===a.accountId) throw townError('SAME_ASSET');
        moneyChange(ctx,a,-amount,-amount); moneyChange(ctx,to,amount);
      } else {
        // Material consumption must be an explicit trusted production command.
        if (input.consume===true) {
          if (input.toStockId!=null) throw townError('AMBIGUOUS_STOCK_CAPTURE');
          stockChange(ctx,a,-amount,-amount);
        } else {
          const to=stock(input.toStockId,input.worldId);
          if (to.stockId===a.stockId) throw townError('SAME_ASSET');
          if (to.resourceKey!==a.resourceKey) throw townError('RESOURCE_MISMATCH');
          stockChange(ctx,a,-amount,-amount); stockChange(ctx,to,amount);
        }
      }
      const field=operation==='release'?'released':'captured';
      const changed=db.prepare(`UPDATE economy_reservations SET remaining=remaining-?,${field}=${field}+?,version=version+1
        WHERE reservation_id=? AND version=?`).run(amount,amount,r.reservationId,r.version);
      if (changed.changes!==1) throw townError('VERSION_CONFLICT');
      return {reservation:reservationDto(db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=?').get(r.reservationId))};
    });
  }
  function flushNotifications(receipt,broadcast) {
    if (db.inTransaction) throw townError('COMMIT_REQUIRED');
    const row=db.prepare('SELECT * FROM economy_transactions WHERE transaction_id=?').get(receipt.transactionId);
    if (!row) throw townError('TRANSACTION_NOT_COMMITTED');
    epoch({worldId:row.world_id,worldEpoch:row.world_epoch});
    const actual=JSON.parse(row.response);
    if (actual.eventId!==receipt.eventId) throw townError('INVALID_RECEIPT');
    return broadcast(events.get(actual.eventId));
  }
  function releaseActive(input) {
    return execute('releaseActive',input,()=>{
      const rows=db.prepare(`SELECT * FROM economy_reservations WHERE world_id=? AND world_epoch=? AND remaining>0
        ORDER BY reservation_id`).all(input.worldId,input.worldEpoch);
      const releases=rows.map(row=>finishReservation(row.asset_type,'release',{
        worldId:input.worldId,worldEpoch:input.worldEpoch,reservationId:row.reservation_id,expectedVersion:row.version,
        idempotencyKey:`release:${hash({key:input.idempotencyKey,id:row.reservation_id})}`,
        sourceKey:`release:${hash({key:input.sourceKey,id:row.reservation_id})}`,reasonCode:input.reasonCode,
      }));
      return {count:releases.length,releases};
    });
  }
  return {ensureAccount,ensureStock,seed,seedStock,produceStock,issueLiquidity,transfer,transferStock,flushNotifications,releaseActive,events,
    reserve:input=>reserveAsset('money',input),reserveStock:input=>reserveAsset('stock',input),
    capture:input=>finishReservation('money','capture',input),release:input=>finishReservation('money','release',input),
    captureStock:input=>finishReservation('stock','capture',input),releaseStock:input=>finishReservation('stock','release',input),
    getAccount:input=>{epoch(input);return account(input.accountId,input.worldId);},
    getStock:input=>{epoch(input);return stock(input.stockId,input.worldId);},
    getReservation:input=>{
      epoch(input);
      return reservationDto(db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=? AND world_id=?')
        .get(input.reservationId,input.worldId))??null;
    },
    getReceipt:input=>{
      epoch(input);
      const row=db.prepare('SELECT response FROM economy_transactions WHERE transaction_id=? AND world_id=?')
        .get(input.transactionId,input.worldId);
      return row?JSON.parse(row.response):null;
    },
  };
}
