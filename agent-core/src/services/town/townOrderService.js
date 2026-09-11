import { randomUUID } from 'node:crypto';
import { canonicalJson, townError } from './townEventService.js';
import { createTownBusinessContext, BUSINESS_KEYS, DELIVERY_SLICE } from './townBusinessService.js';

const terminal = new Set(['completed', 'cancelled', 'expired']);
const dto = row => {
  if (!row) return null;
  const config = JSON.parse(row.config);
  return { orderId: row.order_id, worldId: row.world_id, worldEpoch: row.world_epoch,
    status: row.status, version: row.version, actorId: row.actor_id, expiresAt: row.expires_at,
    createdAt: row.created_at, moneyReservationId: row.money_reservation_id,
    materialReservationId: row.material_reservation_id, cargoStockId: row.cargo_stock_id,
    cargoReservationId: row.cargo_reservation_id, config,
    businessKey: config.orderKind ?? 'workshop' };
};

/** Trusted server-side business profile. Every amount/stock/account comes from
 * the frozen slice, never from HTTP. Legacy orders default to the workshop line.
 */
export function selectTownBusiness(config, businessKey = 'workshop') {
  const functional = (config.functionalBuildings || []).find(building => building.businessKey === businessKey);
  if (!BUSINESS_KEYS.includes(businessKey) && !functional) throw townError('INVALID_BUSINESS_KEY');
  if (functional) {
    return {
      businessKey,
      actorIds: { ...config.npcActorIds, [businessKey]: functional.actorId },
      locationKeys: { ...config.locationKeys, [businessKey]: functional.locationKey },
      accountId: functional.accountId,
      sourceStockId: functional.supplierStockId,
      destinationStockId: functional.stockId,
      sourceLocationKey: config.locationKeys.supplier,
      destinationLocationKey: functional.locationKey,
      reward: functional.reward,
      materialQuantity: functional.materialQuantity,
      resourceKey: functional.resourceKey,
    };
  }
  if (businessKey === 'cafe') {
    if (!config.cafe || !config.accounts?.cafe) throw townError('CAFE_NOT_CONFIGURED');
    const cafe = config.cafe;
    return {
      businessKey,
      actorIds: { ...config.npcActorIds, cafe: cafe.actorId },
      locationKeys: { ...config.locationKeys, cafe: cafe.locationKey },
      accountId: config.accounts.cafe,
      sourceStockId: cafe.supplierStockId,
      destinationStockId: cafe.stockId,
      sourceLocationKey: config.locationKeys.supplier,
      destinationLocationKey: cafe.locationKey,
      reward: cafe.reward,
      materialQuantity: cafe.materialQuantity,
      resourceKey: cafe.resourceKey,
    };
  }
  return {
    businessKey,
    actorIds: config.npcActorIds,
    locationKeys: config.locationKeys,
    accountId: config.accounts.fund,
    sourceStockId: config.stocks.supplier,
    destinationStockId: config.stocks.workshop,
    sourceLocationKey: config.locationKeys.supplier,
    destinationLocationKey: config.locationKeys.workshop,
    reward: config.reward,
    materialQuantity: config.materialQuantity,
    resourceKey: config.resourceKey,
  };
}

/** Server commands. HTTP authenticates actorId; price, material and expiry are
 * fixed here. position adapters must use server movement state, not request XY.
 * All money/material/event/log effects use the same DB connection/transaction.
 */
export function createTownOrderService(dependencies) {
  const c = createTownBusinessContext(dependencies);
  const { db, economy } = c;
  function getOrder(input) {
    c.epoch(input);
    return dto(db.prepare('SELECT * FROM town_delivery_orders WHERE order_id=? AND world_id=? AND world_epoch=?')
      .get(input.orderId,input.worldId,input.worldEpoch));
  }
  function order(input, states, { deadline = true } = {}) {
    const value = getOrder(input);
    if (!value) throw townError('ORDER_NOT_FOUND');
    if (!Number.isSafeInteger(input.expectedVersion) || value.version !== input.expectedVersion) throw townError('VERSION_CONFLICT');
    if (!states.includes(value.status)) throw townError('ORDER_STATE_CONFLICT');
    if (deadline && c.now() >= value.expiresAt) throw townError('ORDER_EXPIRED');
    return value;
  }
  function owned(input, value) {
    c.actor(input,input.actorId,{ player: true });
    if (value.actorId !== input.actorId) throw townError('ORDER_NOT_OWNED');
  }
  function record(input, value, phase) {
    const business = selectTownBusiness(value.config, value.businessKey);
    const eventId = `delivery:${value.orderId}:${value.version}`;
    const occurredAt = c.now();
    const event = c.events.append({ eventId, worldId: input.worldId, worldEpoch: input.worldEpoch,
      type: 'town.delivery.changed', occurredAt,
      actorIds: [value.actorId, ...Object.values(business.actorIds)].filter(Boolean),
      locationKey: value.status === 'completed' ? business.destinationLocationKey : null,
      source: { system: 'town.delivery', entityId: value.orderId },
      payload: { orderId: value.orderId, status: value.status, version: value.version, reward: business.reward } }, dependencies.consumers || []);
    db.prepare(`INSERT INTO town_business_log(world_id,world_epoch,order_id,actor_id,event_id,phase,occurred_at,result)
      VALUES(?,?,?,?,?,?,?,?)`).run(input.worldId,input.worldEpoch,value.orderId,value.actorId,eventId,phase,occurredAt,canonicalJson(value));
    return { order: value, eventId: event.eventId };
  }
  function transition(input, value, status, extra = {}) {
    const result = db.prepare(`UPDATE town_delivery_orders SET status=?,version=version+1,actor_id=?,cargo_stock_id=?,cargo_reservation_id=?
      WHERE order_id=? AND version=?`).run(status,extra.actorId ?? value.actorId,
      extra.cargoStockId ?? value.cargoStockId,extra.cargoReservationId ?? value.cargoReservationId,value.orderId,value.version);
    if (result.changes !== 1) throw townError('VERSION_CONFLICT');
    return record(input,getOrder(input),status);
  }
  function reservation(input, id, expectedAmount) {
    const r = economy.getReservation({ worldId: input.worldId, worldEpoch: input.worldEpoch, reservationId: id });
    if (!r || r.worldEpoch !== input.worldEpoch || r.remaining !== expectedAmount) throw townError('ORDER_RESERVATION_LOST');
    return r;
  }
  function publish(input) {
    return c.execute('publish',input,() => {
      const config = c.slice(input);
      const business = selectTownBusiness(config,input.businessKey ?? 'workshop');
      for (const actorId of Object.values(business.actorIds)) c.actor(input,actorId,{ npc: true });
      for (const key of Object.values(business.locationKeys)) c.location(input,key);
      const orderId = randomUUID();
      const createdAt = c.now(), expiresAt = createdAt + DELIVERY_SLICE.lifetimeMs;
      if (!Number.isSafeInteger(expiresAt)) throw townError('INVALID_CLOCK');
      const money = economy.reserve({ ...c.command(input,'publish.money'), accountId: business.accountId,
        amount: business.reward, ownerRef: `order:${orderId}` }).reservation;
      const material = economy.reserveStock({ ...c.command(input,'publish.material'), stockId: business.sourceStockId,
        amount: business.materialQuantity, ownerRef: `order:${orderId}` }).reservation;
      db.prepare(`INSERT INTO town_delivery_orders(order_id,world_id,world_epoch,status,expires_at,created_at,
        money_reservation_id,material_reservation_id,config) VALUES(?,?,?,'open',?,?,?,?,?)`)
        .run(orderId,input.worldId,input.worldEpoch,expiresAt,createdAt,money.reservationId,material.reservationId,
          canonicalJson(business.businessKey === 'workshop' ? config : { ...config, orderKind: business.businessKey }));
      return record(input,getOrder({ ...input,orderId }),'open');
    });
  }
  function accept(input) {
    return c.execute('accept',input,() => {
      const value = order(input,['open']);
      c.actor(input,input.actorId,{ player: true });
      c.arrived(input,value.config.locationKeys.board);
      return transition(input,value,'accepted',{ actorId: input.actorId });
    });
  }
  function pickup(input) {
    return c.execute('pickup',input,() => {
      const value = order(input,['accepted']);
      owned(input,value);
      const business = selectTownBusiness(value.config,value.businessKey);
      c.arrived(input,business.sourceLocationKey);
      const material = reservation(input,value.materialReservationId,business.materialQuantity);
      const cargo = economy.ensureStock({ worldId: input.worldId, worldEpoch: input.worldEpoch,
        ownerKey: `delivery:cargo:${value.orderId}:${value.actorId}`, resourceKey: business.resourceKey });
      economy.captureStock({ ...c.command(input,'pickup.material'), reservationId: material.reservationId,
        expectedVersion: material.version, toStockId: cargo.stockId });
      // Order-bound custody: cargo is physically held by the courier but cannot
      // be sold/transferred by ordinary available-stock operations.
      const lock = economy.reserveStock({ ...c.command(input,'pickup.custody'), stockId: cargo.stockId,
        ownerRef: `order:${value.orderId}`, amount: business.materialQuantity }).reservation;
      return transition(input,value,'picked_up',{ cargoStockId: cargo.stockId,cargoReservationId: lock.reservationId });
    });
  }
  function complete(input) {
    return c.execute('complete',input,() => {
      const value = order(input,['picked_up']);
      owned(input,value);
      const business = selectTownBusiness(value.config,value.businessKey);
      c.arrived(input,business.destinationLocationKey);
      const cargo = reservation(input,value.cargoReservationId,business.materialQuantity);
      if (cargo.assetId !== value.cargoStockId || cargo.ownerRef !== `order:${value.orderId}`) throw townError('CARGO_NOT_OWNED');
      const stock = economy.getStock({ worldId: input.worldId,worldEpoch: input.worldEpoch,stockId: value.cargoStockId });
      if (stock.ownerKey !== `delivery:cargo:${value.orderId}:${value.actorId}` || stock.quantity < business.materialQuantity) throw townError('CARGO_NOT_OWNED');
      const money = reservation(input,value.moneyReservationId,business.reward);
      economy.captureStock({ ...c.command(input,'complete.material'),reservationId: cargo.reservationId,
        expectedVersion: cargo.version,toStockId: business.destinationStockId });
      economy.capture({ ...c.command(input,'complete.wage'),reservationId: money.reservationId,
        expectedVersion: money.version,toAccountId: value.config.accounts.player });
      return transition(input,value,'completed');
    });
  }
  function releaseOrder(input, value, status) {
    const business = selectTownBusiness(value.config,value.businessKey);
    const money = reservation(input,value.moneyReservationId,business.reward);
    economy.release({ ...c.command(input,'cancel.money'),reservationId: money.reservationId,expectedVersion: money.version });
    if (value.status === 'picked_up') {
      const cargo = reservation(input,value.cargoReservationId,business.materialQuantity);
      economy.captureStock({ ...c.command(input,'cancel.return'),reservationId: cargo.reservationId,
        expectedVersion: cargo.version,toStockId: business.sourceStockId });
    } else {
      const material = reservation(input,value.materialReservationId,business.materialQuantity);
      economy.releaseStock({ ...c.command(input,'cancel.material'),reservationId: material.reservationId,expectedVersion: material.version });
    }
    return transition(input,value,status);
  }
  /** User cancellation is restricted to their own accepted/picked-up order.
   * Operator lifecycle cancellation uses cancelForRebuild, never a user flag.
   */
  function cancel(input) {
    return c.execute('cancel',input,() => {
      const value = order(input,['accepted','picked_up'],{ deadline: false });
      owned(input,value);
      return releaseOrder(input,value,'cancelled');
    });
  }
  function expire(input) {
    return c.execute('expire',input,() => {
      const value = order(input,['open','accepted','picked_up'],{ deadline: false });
      if (c.now() < value.expiresAt) throw townError('ORDER_NOT_DUE');
      return releaseOrder(input,value,'expired');
    });
  }
  /** Trusted lifecycle API: call BEFORE economy.releaseActive and epoch advance.
   * Wrap all three in the caller's same DB transaction when rebuilding.
   */
  function cancelForRebuild(input) {
    return c.execute('cancelForRebuild',input,() => {
      const rows = db.prepare(`SELECT * FROM town_delivery_orders WHERE world_id=? AND world_epoch=?
        AND status IN ('open','accepted','picked_up') ORDER BY order_id`).all(input.worldId,input.worldEpoch);
      return { orders: rows.map(row => {
        const value = dto(row);
        return releaseOrder({ ...input,orderId: value.orderId,sourceKey: `rebuild:${value.orderId}` },value,'cancelled');
      }) };
    });
  }
  function list(input) {
    c.epoch(input);
    return db.prepare('SELECT * FROM town_delivery_orders WHERE world_id=? AND world_epoch=? ORDER BY created_at,order_id')
      .all(input.worldId,input.worldEpoch).map(dto);
  }
  return { publish, accept, pickup, complete, cancel, expire, cancelForRebuild, getOrder, list,
    isTerminal: status => terminal.has(status) };
}
