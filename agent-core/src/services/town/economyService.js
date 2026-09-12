import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';

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
  return {ensureAccount,ensureStock,seed,seedStock,transfer,transferStock,flushNotifications,releaseActive,events,
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
