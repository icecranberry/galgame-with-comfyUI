import { canonicalJson, townError } from './townEventService.js';

const roles = ['commissioner','supplier','workshop'];
const places = ['board','supplier','workshop'];
export const TOWN_MAILBOX_SCAN_LIMIT = 500;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const positive = value => Number.isSafeInteger(value) && value > 0;
const parse = value => { try { const result=JSON.parse(value); return result && typeof result==='object' && !Array.isArray(result) ? result : null; } catch { return null; } };
const equal = (a,b) => { try { return canonicalJson(a)===canonicalJson(b); } catch { return false; } };

/** Read-only task cards. No maintenance, synchronization, economic commands or model calls.
 * list({worldId,worldEpoch,cursor:null|{createdAt,orderId},limit:20})
 * => {worldId,worldEpoch,items,nextCursor}. Constructor enabled=false hides open cards in SQL;
 * accepted/picked_up cards remain trackable. No caller-supplied player identity is read.
 * At most 500 candidate rows are inspected per call. A short/empty page can have nextCursor;
 * clients must use nextCursor, not items.length, to determine whether traversal is complete.
 */
export function createTownMailboxTasks({db,clock,registry,enabled=true}) {
  if (!db?.prepare || typeof clock?.now!=='function' || typeof registry?.getWorldEpoch!=='function'
    || typeof registry?.getActor!=='function' || typeof registry?.resolveAgentKey!=='function') throw townError('MISSING_DEPENDENCY');
  if (typeof enabled!=='boolean') throw townError('INVALID_ENABLED');
  function actor(scope,id,npc=false) {
    const value=registry.getActor(id,scope.worldId,{followMerged:false});
    return value?.actorId===id && value.participating && !value.archived && !value.mergedInto
      && (!npc || value.npcExists) ? value : null;
  }
  function card(scope,row,player,time) {
    const config=parse(row.config);
    if (!config || !positive(config.reward) || !positive(config.materialQuantity) || !text(config.resourceKey)
      || config.playerActorId!==player.actorId || !config.accounts || !config.stocks || !config.npcActorIds || !config.locationKeys
      || !positive(row.version) || !Number.isSafeInteger(row.created_at) || row.created_at>time
      || !Number.isSafeInteger(row.expires_at) || row.expires_at<=time) return null;
    if (row.status==='open' ? row.actor_id!==null : row.actor_id!==player.actorId) return null;
    // Current NPC availability gates discovery, not an already accepted delivery.
    // Pickup/complete use the player's arrival and custody; historical identities
    // remain checked against the canonical event and business log below.
    if (roles.some(role=>!text(config.npcActorIds[role])
      || (row.status==='open' && !actor(scope,config.npcActorIds[role],true)))
      || new Set(roles.map(role=>config.npcActorIds[role])).size!==3
      || places.some(place=>!text(config.locationKeys[place])) || new Set(places.map(place=>config.locationKeys[place])).size!==3) return null;
    const locations={};
    for (const place of places) {
      const rows=db.prepare('SELECT key,name FROM town_locations WHERE key=?').all(config.locationKeys[place]);
      if (rows.length!==1 || !text(rows[0].name)) return null;
      locations[place]={key:rows[0].key,name:rows[0].name.slice(0,80)};
    }
    const slice=db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(scope.worldId,scope.worldEpoch);
    if (!slice || !equal(parse(slice.config),config)) return null;
    const eventId=`delivery:${row.order_id}:${row.version}`;
    const evidence=db.prepare(`SELECT e.type,e.envelope,l.actor_id,l.phase,l.occurred_at,l.result
      FROM town_domain_events e JOIN town_business_log l ON l.event_id=e.event_id
      WHERE e.event_id=? AND e.world_id=? AND e.world_epoch=? AND l.world_id=e.world_id AND l.world_epoch=e.world_epoch
      AND l.order_id=?`).get(eventId,scope.worldId,scope.worldEpoch,row.order_id);
    if (!evidence || evidence.type!=='town.delivery.changed' || evidence.phase!==row.status || evidence.actor_id!==row.actor_id) return null;
    const event=parse(evidence.envelope),logged=parse(evidence.result);
    if (!event || !logged || event.eventId!==eventId || event.type!==evidence.type || event.schemaVersion!==1
      || event.worldId!==scope.worldId || event.worldEpoch!==scope.worldEpoch || event.presentationOnly!==false
      || event.source?.system!=='town.delivery' || event.source.entityId!==row.order_id || event.locationKey!==null
      || event.payload?.orderId!==row.order_id || event.payload?.version!==row.version || event.payload?.status!==row.status
      || event.payload?.reward!==config.reward || !Number.isSafeInteger(event.occurredAt)
      || event.occurredAt<row.created_at || event.occurredAt>time || evidence.occurred_at!==event.occurredAt
      || !Array.isArray(event.actorIds) || !equal([...new Set(event.actorIds)].sort(),
        [row.actor_id,...roles.map(role=>config.npcActorIds[role])].filter(Boolean).sort())) return null;
    const expected={orderId:row.order_id,worldId:row.world_id,worldEpoch:row.world_epoch,status:row.status,version:row.version,
      actorId:row.actor_id,expiresAt:row.expires_at,createdAt:row.created_at,moneyReservationId:row.money_reservation_id,
      materialReservationId:row.material_reservation_id,cargoStockId:row.cargo_stock_id,cargoReservationId:row.cargo_reservation_id,config};
    if (!equal(logged,expected)) return null;
    const account=id=>db.prepare('SELECT * FROM economy_accounts WHERE account_id=? AND world_id=?').get(id,scope.worldId);
    const fund=account(config.accounts.fund),payee=account(config.accounts.player);
    if (!fund || fund.owner_key!=='delivery:public-fund' || fund.account_type!=='fund' || !payee
      || payee.actor_id!==player.actorId || payee.owner_key!==`actor:${player.actorId}` || payee.account_type!=='actor') return null;
    const stock=id=>db.prepare('SELECT * FROM town_resource_stocks WHERE stock_id=? AND world_id=?').get(id,scope.worldId);
    const supplier=stock(config.stocks.supplier),workshop=stock(config.stocks.workshop);
    if (!supplier || !workshop || supplier.owner_key!=='delivery:business:supplier' || workshop.owner_key!=='delivery:business:workshop'
      || supplier.resource_key!==config.resourceKey || workshop.resource_key!==config.resourceKey) return null;
    function reservation(id,type,asset,amount,remaining,captured) {
      const value=db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=? AND world_id=? AND world_epoch=?')
        .get(id,scope.worldId,scope.worldEpoch);
      return value && value.asset_type===type && value.asset_id===asset && value.owner_ref===`order:${row.order_id}`
        && value.amount===amount && value.remaining===remaining && value.captured===captured && value.released===0;
    }
    if (!reservation(row.money_reservation_id,'money',fund.account_id,config.reward,config.reward,0)
      || fund.reserved<config.reward || fund.balance<fund.reserved) return null;
    const picked=row.status==='picked_up';
    if (!reservation(row.material_reservation_id,'stock',supplier.stock_id,config.materialQuantity,
      picked?0:config.materialQuantity,picked?config.materialQuantity:0)) return null;
    if (picked) {
      const cargo=stock(row.cargo_stock_id);
      if (!cargo || cargo.owner_key!==`delivery:cargo:${row.order_id}:${player.actorId}` || cargo.resource_key!==config.resourceKey
        || cargo.quantity<config.materialQuantity || cargo.reserved<config.materialQuantity
        || !reservation(row.cargo_reservation_id,'stock',cargo.stock_id,config.materialQuantity,config.materialQuantity,0)) return null;
    } else if (row.cargo_stock_id!==null || row.cargo_reservation_id!==null
      || supplier.quantity<config.materialQuantity || supplier.reserved<config.materialQuantity) return null;
    return {orderId:row.order_id,version:row.version,status:row.status,expiresAt:row.expires_at,reward:config.reward,locations};
  }
  function list({worldId,worldEpoch,cursor=null,limit=20}) {
    const scope={worldId,worldEpoch};
    if (!text(worldId) || !positive(worldEpoch) || registry.getWorldEpoch(worldId)!==worldEpoch) throw townError('STALE_EPOCH');
    if (!Number.isInteger(limit) || limit<1 || limit>100 || (cursor!==null && (!Number.isSafeInteger(cursor?.createdAt)
      || cursor.createdAt<0 || !text(cursor.orderId)))) throw townError('INVALID_PAGE');
    const resolved=registry.resolveAgentKey('me'),player=resolved && actor(scope,resolved.actorId);
    if (!player || player.playerId!=='me') throw townError('PLAYER_UNAVAILABLE');
    const time=clock.now();if (!Number.isSafeInteger(time) || time<0) throw townError('INVALID_CLOCK');
    const items=[];
    let scanned=0,hasMore=false;
    let after=cursor ?? {createdAt:-1,orderId:''};
    // Scan past invalid evidence instead of letting a poison first page hide later valid cards.
    while (items.length<limit && scanned<TOWN_MAILBOX_SCAN_LIMIT) {
      const batchSize=Math.min(100,TOWN_MAILBOX_SCAN_LIMIT-scanned);
      const rows=db.prepare(`SELECT * FROM town_delivery_orders WHERE world_id=? AND world_epoch=?
        AND status IN ('open','accepted','picked_up') AND expires_at>?
        AND (?=1 OR status<>'open')
        AND (actor_id IS NULL OR actor_id=?) AND (created_at>? OR (created_at=? AND order_id>?))
        ORDER BY created_at,order_id LIMIT ?`).all(worldId,worldEpoch,time,enabled?1:0,player.actorId,after.createdAt,after.createdAt,after.orderId,batchSize);
      if (!rows.length) {hasMore=false;break;}
      for (let index=0;index<rows.length;index++) {
        const row=rows[index];scanned++;
        after={createdAt:row.created_at,orderId:row.order_id};
        const value=card(scope,row,player,time);
        if (value) items.push(value);
        hasMore=index<rows.length-1 || rows.length===batchSize;
        if (items.length===limit) break;
      }
      if (!hasMore || items.length===limit) break;
    }
    return {...scope,items,nextCursor:hasMore?after:null};
  }
  return {list};
}
