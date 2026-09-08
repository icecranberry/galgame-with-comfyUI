import { randomUUID } from 'node:crypto';
import { createTownBusinessContext } from './townBusinessService.js';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';

export const PRODUCTION_RECIPE = Object.freeze({ key: 'town.raw_material.harvest.v1',capacity: 200,quantity: 1,
  budget: 30,publicFee: 20,procurement: 6,wagePerWorker: 2,workMs: 5 * 60000,lifetimeMs: 2 * 3600000 });
const dto = r => r && ({ productionId: r.production_id,worldId: r.world_id,worldEpoch: r.world_epoch,sessionId: r.session_id,
  status: r.status,version: r.version,createdAt: r.created_at,expiresAt: r.expires_at,
  moneyReservationId: r.money_reservation_id,config: JSON.parse(r.config) });

/** Server-only finite harvest + revenue distribution. No seed/seedStock calls.
 * economy.produceStock must be a synchronous same-db trusted stock issuance
 * command; proof/capacity consumption and its ledger commit in one transaction.
 * Existing work_shift runner owns timing, attendance and station leases.
 * Call cancelForRebuild BEFORE releaseActive/advanceEpoch in the same outer tx.
 */
export function createTownProductionService(dependencies) {
  const c = createTownBusinessContext(dependencies), { db,economy } = c;
  const readSlice = input => {
    const value = dependencies.getSlice ? dependencies.getSlice(input) : c.slice(input);
    if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
    if (!value) throw townError('SLICE_NOT_CONFIGURED');
    return value;
  };
  const events = createTownEventService({ db,clock: { now: c.now },getWorldEpoch: c.registry.getWorldEpoch,
    validators: { 'town.production.changed': p => typeof p?.productionId === 'string' && typeof p.status === 'string' } });
  function get(input) {
    c.epoch(input);
    return dto(db.prepare('SELECT * FROM town_productions WHERE production_id=? AND world_id=? AND world_epoch=?')
      .get(input.productionId,input.worldId,input.worldEpoch));
  }
  function getResourceNode(input) {
    c.epoch(input);
    const node = db.prepare('SELECT * FROM town_production_nodes WHERE world_id=?').get(input.worldId);
    return node ? { worldId: node.world_id,capacity: node.capacity,remaining: node.remaining,reserved: node.reserved,
      available: node.remaining-node.reserved } : null;
  }
  function initializeResourceNode(input) {
    return c.execute('production.initialize',input,() => {
      readSlice(input);
      db.prepare('INSERT OR IGNORE INTO town_production_nodes(world_id,capacity,remaining) VALUES(?,?,?)')
        .run(input.worldId,PRODUCTION_RECIPE.capacity,PRODUCTION_RECIPE.capacity);
      return getResourceNode(input);
    });
  }
  function log(input, production) {
    const eventId = `production:${production.productionId}:${production.version}`, occurredAt = c.now();
    events.append({ eventId,worldId: input.worldId,worldEpoch: input.worldEpoch,type: 'town.production.changed',occurredAt,
      actorIds: [production.config.npcActorIds.supplier,production.config.npcActorIds.workshop],
      locationKey: production.config.locationKeys.supplier,source: { system: 'town.production',entityId: production.productionId },
      payload: { productionId: production.productionId,status: production.status,quantity: PRODUCTION_RECIPE.quantity } },dependencies.consumers ?? []);
    db.prepare('INSERT INTO town_production_log(production_id,event_id,phase,occurred_at,result) VALUES(?,?,?,?,?)')
      .run(production.productionId,eventId,production.status,occurredAt,canonicalJson(production));
    return { production,eventId };
  }
  function verifyService(input, config) {
    requireText(input.sessionId);
    const row = db.prepare(`SELECT s.*,r.receipt_json FROM town_service_sessions s
      JOIN town_service_settlements r USING(session_id) WHERE s.session_id=? AND s.world_id=? AND s.world_epoch=?`)
      .get(input.sessionId,input.worldId,input.worldEpoch);
    if (!row || row.status !== 'completed' || row.consumed !== 1 || row.crafted !== 1) throw townError('PAID_SERVICE_REQUIRED');
    const receipt = JSON.parse(row.receipt_json), serviceConfig = JSON.parse(row.config_json);
    if (receipt.status !== 'completed' || receipt.paid !== 30 || receipt.payout !== 30 || receipt.refund !== 0
        || serviceConfig.accountId !== config.accounts.workshop || row.provider_actor_id !== config.npcActorIds.workshop
        || serviceConfig.stockId !== config.stocks.workshop || serviceConfig.locationKey !== config.locationKeys.workshop
        || !Number.isSafeInteger(receipt.settledAt) || receipt.settledAt > c.now()) throw townError('PAID_SERVICE_REQUIRED');
  }
  function start(input) {
    return c.execute('production.start',input,() => {
      const config = readSlice(input); verifyService(input,config);
      if (db.prepare("SELECT 1 FROM town_productions WHERE world_id=? AND session_id=? AND status IN ('reserved','completed')")
        .get(input.worldId,input.sessionId)) throw townError('SERVICE_PRODUCTION_ALREADY_USED');
      const node = getResourceNode(input);
      if (!node || node.available < 1) throw townError('RESOURCE_CAPACITY_EXHAUSTED');
      const workers = {};
      for (const role of ['supplier','workshop']) {
        const actorId = config.npcActorIds[role];
        c.actor(input,actorId,{ npc: true }); c.location(input,config.locationKeys[role]);
        workers[role] = economy.ensureAccount({ worldId: input.worldId,worldEpoch: input.worldEpoch,
          accountType: 'actor',ownerKey: `actor:${actorId}`,actorId }).accountId;
      }
      const productionId = randomUUID(), createdAt = c.now(), expiresAt = createdAt + PRODUCTION_RECIPE.lifetimeMs;
      if (!Number.isSafeInteger(expiresAt)) throw townError('INVALID_CLOCK');
      const money = economy.reserve({ ...c.command(input,'production.budget'),accountId: config.accounts.workshop,
        amount: PRODUCTION_RECIPE.budget,ownerRef: `production:${productionId}` }).reservation;
      db.prepare('UPDATE town_production_nodes SET reserved=reserved+1 WHERE world_id=?').run(input.worldId);
      db.prepare(`INSERT INTO town_productions(production_id,world_id,world_epoch,session_id,status,created_at,expires_at,money_reservation_id,config)
        VALUES(?,?,?,?,'reserved',?,?,?,?)`).run(productionId,input.worldId,input.worldEpoch,input.sessionId,createdAt,expiresAt,money.reservationId,
        canonicalJson({ ...config,workers,recipe: PRODUCTION_RECIPE }));
      return log(input,get({ ...input,productionId }));
    });
  }
  function current(input) {
    const value = get(input);
    if (!value) throw townError('PRODUCTION_NOT_FOUND');
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== value.version) throw townError('VERSION_CONFLICT');
    if (value.status !== 'reserved') throw townError('PRODUCTION_CLOSED');
    return value;
  }
  function validateWorkProof(input, value, role, actionId) {
    requireText(actionId);
    const action = db.prepare('SELECT * FROM town_actions WHERE id=?').get(actionId);
    const actorId = value.config.npcActorIds[role], target = value.config.locationKeys[role];
    if (!action || action.world_id !== input.worldId || action.world_epoch !== input.worldEpoch || action.actor_id !== actorId
        || action.type !== 'work_shift' || action.status !== 'completed' || action.target !== target
        || ![action.started_at,action.due_at,action.updated_at].every(Number.isSafeInteger) || action.started_at < value.createdAt
        || action.due_at-action.started_at < PRODUCTION_RECIPE.workMs || action.updated_at > c.now()) throw townError('INVALID_WORK_PROOF');
    let result;
    try { result = JSON.parse(action.result || 'null'); } catch { throw townError('INVALID_WORK_PROOF'); }
    if (!result || !Number.isSafeInteger(result.attendanceMs) || !Number.isSafeInteger(result.completedAt)
        || result.attendanceMs < PRODUCTION_RECIPE.workMs || result.completedAt < action.due_at
        || result.completedAt !== action.updated_at || result.economicEffects !== 'none') throw townError('INVALID_WORK_PROOF');
    if (!db.prepare(`SELECT 1 FROM town_activity_log WHERE action_id=? AND actor_id=? AND world_id=? AND world_epoch=?
      AND phase='completed' AND reason_code='DURATION_ELAPSED' AND location_key=? AND occurred_at=?`)
      .get(actionId,actorId,input.worldId,input.worldEpoch,target,action.updated_at)) throw townError('INVALID_WORK_PROOF');
    if (db.prepare('SELECT 1 FROM town_production_proofs WHERE action_id=?').get(actionId)) throw townError('WORK_PROOF_ALREADY_USED');
    c.actor(input,actorId,{ npc: true }); c.arrived({ ...input,actorId },target);
    return action;
  }
  function prove(input, value, role, actionId) {
    validateWorkProof(input,value,role,actionId);
    db.prepare('INSERT INTO town_production_proofs VALUES(?,?,?)').run(actionId,value.productionId,role);
  }
  /** Read-only discovery, accepting {scope,productionId} or {...scope,productionId}.
   * Returns both presently usable proofs or null; stale epochs still throw.
   * Never claims an action. complete() revalidates and claims atomically because
   * another batch may consume a discovered proof before this caller completes.
   */
  function findAvailableProofs(input) {
    const query = { ...(input.scope ?? input),productionId: input.productionId };
    return db.transaction(() => {
      const value = get(query);
      if (!value || value.status !== 'reserved' || c.now() >= value.expiresAt) return null;
      const result = {};
      for (const role of ['supplier','workshop']) {
        const candidates = db.prepare(`SELECT id FROM town_actions WHERE world_id=? AND world_epoch=?
          AND actor_id=? AND type='work_shift' AND status='completed' AND target=? AND started_at>=?
          ORDER BY updated_at,id`).all(query.worldId,query.worldEpoch,value.config.npcActorIds[role],value.config.locationKeys[role],value.createdAt);
        for (const candidate of candidates) {
          try {
            validateWorkProof(query,value,role,candidate.id);
            result[`${role}ActionId`] = candidate.id;
            break;
          } catch (error) {
            if (['INVALID_WORK_PROOF','WORK_PROOF_ALREADY_USED'].includes(error.code)) continue;
            if (['ACTOR_UNAVAILABLE','LOCATION_UNAVAILABLE','NOT_ARRIVED'].includes(error.code)) return null;
            throw error;
          }
        }
        if (!result[`${role}ActionId`]) return null;
      }
      return result;
    }).deferred();
  }
  function finish(input, value, status) {
    const updated = db.prepare('UPDATE town_productions SET status=?,version=version+1 WHERE production_id=? AND version=?')
      .run(status,value.productionId,value.version);
    if (updated.changes !== 1) throw townError('VERSION_CONFLICT');
    return log(input,get(input));
  }
  function complete(input) {
    return c.execute('production.complete',input,() => {
      const value = current(input);
      if (c.now() >= value.expiresAt) throw townError('PRODUCTION_EXPIRED');
      prove(input,value,'supplier',input.supplierActionId); prove(input,value,'workshop',input.workshopActionId);
      if (typeof economy.produceStock !== 'function') throw townError('PRODUCTION_STOCK_ADAPTER_REQUIRED');
      const node = getResourceNode(input);
      if (!node || node.reserved < 1 || node.remaining < 1) throw townError('RESOURCE_RESERVATION_LOST');
      db.prepare('UPDATE town_production_nodes SET remaining=remaining-1,reserved=reserved-1 WHERE world_id=?').run(input.worldId);
      const beforeStock = economy.getStock({ worldId: input.worldId,worldEpoch: input.worldEpoch,stockId: value.config.stocks.supplier });
      const output = economy.produceStock({ ...c.command(input,'production.output'),stockId: value.config.stocks.supplier,
        amount: 1,productionId: value.productionId });
      if (output?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
      const afterStock = economy.getStock({ worldId: input.worldId,worldEpoch: input.worldEpoch,stockId: value.config.stocks.supplier });
      if (afterStock.quantity !== beforeStock.quantity+1 || afterStock.reserved !== beforeStock.reserved) throw townError('INVALID_PRODUCTION_OUTPUT');
      const payments = [['fund',20],['supplier',6],['supplierWorker',2],['workshopWorker',2]];
      for (const [recipient,amount] of payments) {
        const money = economy.getReservation({ worldId: input.worldId,worldEpoch: input.worldEpoch,reservationId: value.moneyReservationId });
        if (!money || money.worldEpoch !== input.worldEpoch) throw townError('PRODUCTION_RESERVATION_LOST');
        const toAccountId = recipient.endsWith('Worker') ? value.config.workers[recipient.replace('Worker','')] : value.config.accounts[recipient];
        economy.capture({ ...c.command(input,`production.pay.${recipient}`),reservationId: money.reservationId,
          expectedVersion: money.version,amount,toAccountId });
      }
      return finish(input,value,'completed');
    });
  }
  function release(input, value, status) {
    const money = economy.getReservation({ worldId: input.worldId,worldEpoch: input.worldEpoch,reservationId: value.moneyReservationId });
    if (!money || money.remaining !== 30) throw townError('PRODUCTION_RESERVATION_LOST');
    economy.release({ ...c.command(input,'production.cancel'),reservationId: money.reservationId,expectedVersion: money.version });
    const change = db.prepare('UPDATE town_production_nodes SET reserved=reserved-1 WHERE world_id=? AND reserved>0').run(input.worldId);
    if (change.changes !== 1) throw townError('RESOURCE_RESERVATION_LOST');
    return finish(input,value,status);
  }
  const cancel = input => c.execute('production.cancel',input,() => release(input,current(input),'cancelled'));
  const expire = input => c.execute('production.expire',input,() => {
    const value = current(input);
    if (c.now() < value.expiresAt) throw townError('PRODUCTION_NOT_DUE');
    return release(input,value,'expired');
  });
  const cancelForRebuild = input => c.execute('production.rebuild',input,() => ({ productions:
    db.prepare("SELECT * FROM town_productions WHERE world_id=? AND world_epoch=? AND status='reserved'").all(input.worldId,input.worldEpoch)
      .map(row => release({ ...input,productionId: row.production_id,sourceKey: `production-rebuild:${row.production_id}` },dto(row),'cancelled')) }));
  const list = input => { c.epoch(input); return db.prepare('SELECT * FROM town_productions WHERE world_id=? AND world_epoch=? ORDER BY created_at,production_id')
    .all(input.worldId,input.worldEpoch).map(dto); };
  return { initializeResourceNode,start,complete,cancel,expire,cancelForRebuild,get,list,getResourceNode,findAvailableProofs };
}
