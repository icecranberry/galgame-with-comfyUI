import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';
import { VENUE_KINDS } from './townVenuePlaybooks.js';


export const DELIVERY_SLICE = Object.freeze({ reward: 30, materialQuantity: 1, resourceKey: 'delivery:raw_material',
  publicBudget: 2000, initialMaterials: 20, lifetimeMs: 30 * 60 * 1000 });
export const CAFE_SLICE = Object.freeze({ businessKey: 'cafe', reward: 30, materialQuantity: 1,
  resourceKey: 'cafe:coffee_bean', budget: 600, initialSupplierMaterials: 20, initialMaterials: 8 });
export const BUSINESS_KEYS = Object.freeze(['workshop', 'cafe']);
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Shared synchronous command boundary; exported for the order service only.
 * No broadcast/network callbacks execute inside DB transactions.
 */
export function createTownBusinessContext({ db, clock, registry, economy, position }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor || !economy?.reserve
      || !position?.getLocation || !position?.hasArrived) throw townError('MISSING_DEPENDENCY');
  function now() {
    const time = clock.now();
    if (!Number.isSafeInteger(time) || time < 0) throw townError('INVALID_CLOCK');
    return time;
  }
  function epoch(input) {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
        || registry.getWorldEpoch(input.worldId) !== input.worldEpoch) throw townError('STALE_EPOCH');
  }
  function actor(input, actorId, { player = false, npc = false } = {}) {
    requireText(actorId);
    const result = registry.getActor(actorId, input.worldId);
    if (!result || result.actorId !== actorId || result.mergedInto || result.archived || !result.participating
        || (player && result.playerId !== 'me') || (npc && !result.npcExists)) throw townError('ACTOR_UNAVAILABLE');
    return result;
  }
  function location(input, locationKey) {
    requireText(locationKey);
    const value = position.getLocation({ worldId: input.worldId, worldEpoch: input.worldEpoch, locationKey });
    if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
    if (!value || value.locationKey !== locationKey) throw townError('LOCATION_UNAVAILABLE');
    return value;
  }
  function arrived(input, locationKey) {
    location(input, locationKey);
    const result = position.hasArrived({ worldId: input.worldId, worldEpoch: input.worldEpoch, actorId: input.actorId, locationKey });
    if (result?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
    if (result !== true) throw townError('NOT_ARRIVED');
  }
  function slice(input) {
    epoch(input);
    const row = db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(input.worldId,input.worldEpoch);
    if (!row) throw townError('SLICE_NOT_CONFIGURED');
    return JSON.parse(row.config);
  }
  function execute(command, input, body) {
    return db.transaction(() => {
      epoch(input); requireText(input.idempotencyKey); requireText(input.sourceKey);
      const requestHash = hash({ command, input });
      const { idempotencyKey, expectedVersion, ...semantic } = input;
      const sourceHash = hash({ command, input: semantic });
      const previous = db.prepare(`SELECT q.request_hash,r.response FROM town_business_requests q
        JOIN town_business_receipts r USING(receipt_id) WHERE q.world_id=? AND q.request_key=?`).get(input.worldId,idempotencyKey);
      if (previous) {
        if (previous.request_hash !== requestHash) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(previous.response);
      }
      let receipt = db.prepare('SELECT * FROM town_business_receipts WHERE world_id=? AND source_key=?').get(input.worldId,input.sourceKey);
      if (receipt && receipt.source_hash !== sourceHash) throw townError('SOURCE_CONFLICT');
      if (!receipt) {
        const response = body();
        if (response?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
        epoch(input);
        receipt = { receipt_id: randomUUID(), response: canonicalJson(response) };
        db.prepare('INSERT INTO town_business_receipts VALUES(?,?,?,?,?)').run(receipt.receipt_id,input.worldId,input.sourceKey,sourceHash,receipt.response);
      }
      db.prepare('INSERT INTO town_business_requests VALUES(?,?,?,?)').run(input.worldId,idempotencyKey,requestHash,receipt.receipt_id);
      return JSON.parse(receipt.response);
    }).immediate();
  }
  // Derived economy keys are short, stable and scoped to the business operation.
  function command(input, suffix) {
    const key = `delivery:${hash({ worldId: input.worldId, sourceKey: input.sourceKey, suffix })}`;
    return { worldId: input.worldId, worldEpoch: input.worldEpoch,
      idempotencyKey: key, sourceKey: key, reasonCode: `delivery.${suffix}` };
  }
  const events = createTownEventService({ db, clock: { now }, getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.delivery.changed': payload => typeof payload?.orderId === 'string' && typeof payload.status === 'string' } });
  return { db, now, registry, economy, epoch, actor, location, arrived, slice, execute, command, events };
}

/** Trusted server setup, never accept seed amounts or prices from HTTP clients.
 * Each world has stable business accounts independent of current proprietor.
 * Rebuilding changes selected NPCs/locations, never repeats initial issuance.
 */

export function createTownBusinessService(dependencies) {
  const context = createTownBusinessContext(dependencies);
  const { db, economy, registry } = context;
  const venueKinds = Object.values(VENUE_KINDS);
  function addCafe(input, previous) {
    const world = { worldId: input.worldId, worldEpoch: input.worldEpoch };
    const cafeActorId = input.npcActorIds.cafe, cafeLocationKey = input.locationKeys.cafe;
    context.actor(input,cafeActorId,{ npc: true }); context.location(input,cafeLocationKey);
    const accountId = economy.ensureAccount({ ...world, ownerKey: 'delivery:business:cafe', accountType: 'business' }).accountId;
    const key = `seed:${input.worldId}:delivery:cafe:1`;
    economy.seed({ ...world, accountId, amount: CAFE_SLICE.budget, seedVersion: 1,
      idempotencyKey: key, sourceKey: key, reasonCode: 'cafe.initial_budget' });
    const supplierStockId = economy.ensureStock({ ...world, ownerKey: 'delivery:business:supplier',
      resourceKey: CAFE_SLICE.resourceKey }).stockId;
    const stockId = economy.ensureStock({ ...world, ownerKey: 'delivery:business:cafe',
      resourceKey: CAFE_SLICE.resourceKey }).stockId;
    economy.seedStock({ ...world, stockId: supplierStockId, amount: CAFE_SLICE.initialSupplierMaterials, seedVersion: 1,
      idempotencyKey: `seed:${input.worldId}:delivery:cafe:supplier-materials:1`,
      sourceKey: `seed:${input.worldId}:delivery:cafe:supplier-materials:1`, reasonCode: 'cafe.initial_supplier_materials' });
    economy.seedStock({ ...world, stockId, amount: CAFE_SLICE.initialMaterials, seedVersion: 1,
      idempotencyKey: `seed:${input.worldId}:delivery:cafe:materials:1`,
      sourceKey: `seed:${input.worldId}:delivery:cafe:materials:1`, reasonCode: 'cafe.initial_materials' });
    const profile = { businessKey: 'cafe', kind: 'cafe', actorId: cafeActorId, locationKey: cafeLocationKey,
      accountId, supplierStockId, stockId, serviceKeys: ['town.cafe.work_shift', 'town.cafe.drink_coffee'], ...CAFE_SLICE };
    return { ...previous, accounts: { ...previous.accounts, cafe: accountId },
      stocks: { ...previous.stocks, cafeSupplier: supplierStockId, cafe: stockId },
      cafe: profile, functionalBuildings: [...(previous.functionalBuildings || [])
        .filter(building => building.businessKey !== 'cafe'), profile] };
  }
  /** 通用功能建筑：账户、供货库存、店内存货与档案全部按 kind 声明生成。
   * 与咖啡馆共用同一账本/库存/订单引擎，只是 businessKey、材料与服务不同。
   */
  function addVenue(input, previous, kind) {
    const world = { worldId: input.worldId, worldEpoch: input.worldEpoch };
    const businessKey = kind.businessKey;
    const actorId = input.npcActorIds[businessKey], locationKey = input.locationKeys[businessKey];
    context.actor(input, actorId, { npc: true }); context.location(input, locationKey);
    const accountId = economy.ensureAccount({ ...world, ownerKey: `delivery:business:${businessKey}`,
      accountType: 'business' }).accountId;
    const seedKey = `seed:${input.worldId}:delivery:${businessKey}:1`;
    economy.seed({ ...world, accountId, amount: kind.budget, seedVersion: 1,
      idempotencyKey: seedKey, sourceKey: seedKey, reasonCode: `${businessKey}.initial_budget` });
    const supplierStockId = economy.ensureStock({ ...world, ownerKey: 'delivery:business:supplier',
      resourceKey: kind.resourceKey }).stockId;
    const stockId = economy.ensureStock({ ...world, ownerKey: `delivery:business:${businessKey}`,
      resourceKey: kind.resourceKey }).stockId;
    const supplierSeed = `seed:${input.worldId}:delivery:${businessKey}:supplier-materials:1`;
    economy.seedStock({ ...world, stockId: supplierStockId, amount: kind.initialSupplierMaterials, seedVersion: 1,
      idempotencyKey: supplierSeed, sourceKey: supplierSeed, reasonCode: `${businessKey}.initial_supplier_materials` });
    const stockSeed = `seed:${input.worldId}:delivery:${businessKey}:materials:1`;
    economy.seedStock({ ...world, stockId, amount: kind.initialMaterials, seedVersion: 1,
      idempotencyKey: stockSeed, sourceKey: stockSeed, reasonCode: `${businessKey}.initial_materials` });
    const profile = { businessKey, kind: kind.kind, actorId, locationKey, accountId, supplierStockId, stockId,
      serviceKeys: kind.services.map(service => service.serviceKey), reward: kind.reward,
      materialQuantity: kind.materialQuantity, resourceKey: kind.resourceKey,
      displayName: kind.displayName, resourceLabel: kind.resourceLabel };
    return { ...previous, accounts: { ...previous.accounts, [businessKey]: accountId },
      stocks: { ...previous.stocks, [`${businessKey}Supplier`]: supplierStockId, [businessKey]: stockId },
      functionalBuildings: [...(previous.functionalBuildings || []).filter(building => building.businessKey !== businessKey), profile] };
  }
  const requestedVenues = input => venueKinds.filter(kind =>
    Object.hasOwn(input.npcActorIds, kind.businessKey) || Object.hasOwn(input.locationKeys, kind.businessKey));
  function setup(input) {
    return context.execute('setup', input, () => {
      if (!input.npcActorIds || !input.locationKeys) throw townError('INVALID_SLICE');
      const hasCafe = Object.hasOwn(input.npcActorIds, 'cafe') || Object.hasOwn(input.locationKeys, 'cafe');
      if (hasCafe && (!input.npcActorIds.cafe || !input.locationKeys.cafe)) throw townError('INVALID_SLICE');
      const venues = requestedVenues(input);
      for (const kind of venues) {
        if (!input.npcActorIds[kind.businessKey] || !input.locationKeys[kind.businessKey]) throw townError('INVALID_SLICE');
      }
      const venueRoles = venues.map(kind => kind.businessKey);
      const baseRoles = ['commissioner','supplier','workshop'];
      const basePlaces = ['board','supplier','workshop'];
      const roles = [...baseRoles, ...(hasCafe ? ['cafe'] : []), ...venueRoles];
      const places = [...basePlaces, ...(hasCafe ? ['cafe'] : []), ...venueRoles];
      roles.forEach(role => context.actor(input,input.npcActorIds[role],{ npc: true }));
      places.forEach(place => context.location(input,input.locationKeys[place]));
      if (new Set(roles.map(role => input.npcActorIds[role])).size !== roles.length
          || new Set(places.map(place => input.locationKeys[place])).size !== places.length) throw townError('INVALID_SLICE');
      const baseSelected = { npcActorIds: Object.fromEntries(baseRoles.map(role => [role,input.npcActorIds[role]])),
        locationKeys: Object.fromEntries(basePlaces.map(place => [place,input.locationKeys[place]])) };
      const previous = db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(input.worldId,input.worldEpoch);
      if (previous) {
        const value = JSON.parse(previous.config);
        const requestedBase = { npcActorIds: Object.fromEntries(baseRoles.map(role => [role,input.npcActorIds[role]])),
          locationKeys: Object.fromEntries(basePlaces.map(place => [place,input.locationKeys[place]])) };
        if (canonicalJson(requestedBase) !== canonicalJson({ npcActorIds: value.npcActorIds, locationKeys: value.locationKeys })) {
          throw townError('SLICE_CONFLICT');
        }
        let next = value;
        if (value.cafe) {
          const currentCafe = { cafeActorId: value.cafe.actorId, cafeLocationKey: value.cafe.locationKey };
          const requestedCafe = hasCafe
            ? { cafeActorId: input.npcActorIds.cafe, cafeLocationKey: input.locationKeys.cafe }
            : null;
          if (requestedCafe && canonicalJson(currentCafe) !== canonicalJson(requestedCafe)) throw townError('SLICE_CONFLICT');
        } else if (hasCafe) next = addCafe(input, next);
        for (const kind of venues) {
          const businessKey = kind.businessKey;
          const current = (next.functionalBuildings || []).find(building => building.businessKey === businessKey);
          if (!current) { next = addVenue(input, next, kind); continue; }
          if (current.actorId !== input.npcActorIds[businessKey] || current.locationKey !== input.locationKeys[businessKey]) {
            throw townError('SLICE_CONFLICT');
          }
        }
        return next;
      }
      const world = { worldId: input.worldId, worldEpoch: input.worldEpoch };
      const player = registry.resolveAgentKey('me');
      context.actor(input,player?.actorId,{ player: true });
      const accounts = {};
      accounts.player = economy.ensureAccount({ ...world, ownerKey: `actor:${player.actorId}`, actorId: player.actorId, accountType: 'actor' }).accountId;
      accounts.fund = economy.ensureAccount({ ...world, ownerKey: 'delivery:public-fund', accountType: 'fund' }).accountId;
      for (const role of baseRoles) accounts[role] = economy.ensureAccount({ ...world, ownerKey: `delivery:business:${role}`, accountType: 'business' }).accountId;
      const grants = { player: 0, fund: DELIVERY_SLICE.publicBudget, commissioner: 400, supplier: 600, workshop: 400 };
      for (const [role, amount] of Object.entries(grants)) {
        // Source and request key deliberately exclude epoch and setup sourceKey.
        const key = `seed:${input.worldId}:delivery:${role}:1`;
        economy.seed({ ...world, accountId: accounts[role], amount, seedVersion: 1,
          idempotencyKey: key, sourceKey: key, reasonCode: 'delivery.initial_budget' });
      }
      const stocks = {};
      for (const role of ['supplier', 'workshop']) stocks[role] = economy.ensureStock({ ...world,
        ownerKey: `delivery:business:${role}`, resourceKey: DELIVERY_SLICE.resourceKey }).stockId;
      const key = `seed:${input.worldId}:delivery:materials:1`;
      economy.seedStock({ ...world, stockId: stocks.supplier, amount: DELIVERY_SLICE.initialMaterials, seedVersion: 1,
        idempotencyKey: key, sourceKey: key, reasonCode: 'delivery.initial_materials' });
      let result = { ...baseSelected, accounts, stocks, playerActorId: player.actorId, ...DELIVERY_SLICE };
      if (hasCafe) result = addCafe(input,result);
      for (const kind of venues) result = addVenue(input, result, kind);
      db.prepare('INSERT INTO town_business_slices VALUES(?,?,?)').run(input.worldId,input.worldEpoch,canonicalJson(result));
      return result;
    });
  }
  return { setup, getSlice: context.slice,
    getFunctionalBuildings: input => { const slice = context.slice(input);
      return slice.functionalBuildings || (slice.cafe ? [slice.cafe] : []); } };
}
