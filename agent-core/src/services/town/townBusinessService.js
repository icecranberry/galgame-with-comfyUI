import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';

export const DELIVERY_SLICE = Object.freeze({ reward: 30, materialQuantity: 1, resourceKey: 'delivery:raw_material',
  publicBudget: 2000, initialMaterials: 20, lifetimeMs: 30 * 60 * 1000 });
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
  function setup(input) {
    return context.execute('setup', input, () => {
      const roles = ['commissioner', 'supplier', 'workshop'];
      const places = ['board', 'supplier', 'workshop'];
      if (!input.npcActorIds || !input.locationKeys) throw townError('INVALID_SLICE');
      roles.forEach(role => context.actor(input,input.npcActorIds[role],{ npc: true }));
      places.forEach(place => context.location(input,input.locationKeys[place]));
      if (new Set(roles.map(role => input.npcActorIds[role])).size !== 3
          || new Set(places.map(place => input.locationKeys[place])).size !== 3) throw townError('INVALID_SLICE');
      const selected = { npcActorIds: Object.fromEntries(roles.map(role => [role,input.npcActorIds[role]])),
        locationKeys: Object.fromEntries(places.map(place => [place,input.locationKeys[place]])) };
      const previous = db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?').get(input.worldId,input.worldEpoch);
      if (previous) {
        const value = JSON.parse(previous.config);
        if (canonicalJson(selected) !== canonicalJson({ npcActorIds: value.npcActorIds, locationKeys: value.locationKeys })) throw townError('SLICE_CONFLICT');
        return value;
      }
      const world = { worldId: input.worldId, worldEpoch: input.worldEpoch };
      const player = registry.resolveAgentKey('me');
      context.actor(input,player?.actorId,{ player: true });
      const accounts = {};
      accounts.player = economy.ensureAccount({ ...world, ownerKey: `actor:${player.actorId}`, actorId: player.actorId, accountType: 'actor' }).accountId;
      accounts.fund = economy.ensureAccount({ ...world, ownerKey: 'delivery:public-fund', accountType: 'fund' }).accountId;
      for (const role of roles) accounts[role] = economy.ensureAccount({ ...world, ownerKey: `delivery:business:${role}`, accountType: 'business' }).accountId;
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
      const result = { ...selected, accounts, stocks, playerActorId: player.actorId, ...DELIVERY_SLICE };
      db.prepare('INSERT INTO town_business_slices VALUES(?,?,?)').run(input.worldId,input.worldEpoch,canonicalJson(result));
      return result;
    });
  }
  return { setup, getSlice: context.slice };
}
