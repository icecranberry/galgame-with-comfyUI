import { canonicalJson, townError } from './townEventService.js';
import { PRODUCTION_RECIPE } from './townProductionService.js';
import { resolveTownServiceDefinition } from './townServiceDefinitions.js';

const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const same = (a, b) => { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.trim().length > 0;
const identifiers = (value, keys) => record(value) && keys.every(key => identifier(value[key]));
function validSlice(value) {
  const roles = ['commissioner', 'supplier', 'workshop'];
  return record(value) && identifier(value.playerActorId)
    && identifiers(value.locationKeys, ['board', 'supplier', 'workshop'])
    && identifiers(value.npcActorIds, roles)
    && new Set(roles.map(role => value.npcActorIds[role])).size === 3
    && identifiers(value.accounts, ['player', 'fund', ...roles])
    && identifiers(value.stocks, ['supplier', 'workshop']);
}

/** Read-only historical unlock. A status flag alone is insufficient. Do not
 * synchronize actors or manufacture production/proofs/stock during discovery.
 */
export function createTownServiceUnlock({ db, registry, clock }) {
  function event(id, scope, type) {
    const row = db.prepare('SELECT * FROM town_domain_events WHERE event_id=? AND world_id=? AND world_epoch=? AND type=?')
      .get(id, scope.worldId, scope.worldEpoch, type);
    const value = parse(row?.envelope);
    return value?.eventId === id && value.worldId === scope.worldId && value.worldEpoch === scope.worldEpoch
      && value.type === type && value.schemaVersion === 1 && value.presentationOnly === false ? value : null;
  }
  function valid(scope, row, time, slice) {
    const config = parse(row.config);
    if (!validSlice(config) || !identifiers(config.workers, ['supplier', 'workshop'])
        || !same(config.recipe, PRODUCTION_RECIPE)) return false;
    const { workers, recipe, ...base } = config;
    if (!same(base, slice) || !workers?.supplier || !workers.workshop) return false;
    const log = db.prepare("SELECT * FROM town_production_log WHERE production_id=? AND phase='completed' AND event_id=?")
      .get(row.production_id, `production:${row.production_id}:${row.version}`);
    const expected = { productionId: row.production_id, worldId: row.world_id, worldEpoch: row.world_epoch,
      sessionId: row.session_id, status: row.status, version: row.version, createdAt: row.created_at,
      expiresAt: row.expires_at, moneyReservationId: row.money_reservation_id, config };
    if (!log || !same(parse(log.result), expected) || !Number.isSafeInteger(log.occurred_at)
        || log.occurred_at < row.created_at || log.occurred_at > time) return false;
    const produced = event(log.event_id, scope, 'town.production.changed');
    if (!produced || produced.occurredAt !== log.occurred_at || produced.source?.system !== 'town.production'
        || produced.source.entityId !== row.production_id || produced.locationKey !== config.locationKeys.supplier
        || !Array.isArray(produced.actorIds) || !same(produced.actorIds.slice().sort(), [config.npcActorIds.supplier, config.npcActorIds.workshop].sort())
        || !same(produced.payload, { productionId: row.production_id, status: 'completed', quantity: 1 })) return false;
    const proofs = db.prepare(`SELECT p.role,a.* FROM town_production_proofs p JOIN town_actions a ON a.id=p.action_id
      WHERE p.production_id=?`).all(row.production_id);
    if (proofs.length !== 2 || new Set(proofs.map(p => p.actor_id)).size !== 2
        || !same(proofs.map(p => p.role).sort(), ['supplier','workshop'])) return false;
    for (const proof of proofs) {
      const result = parse(proof.result), target = config.locationKeys[proof.role];
      if (proof.world_id !== scope.worldId || proof.world_epoch !== scope.worldEpoch
          || proof.actor_id !== config.npcActorIds[proof.role] || proof.type !== 'work_shift'
          || proof.status !== 'completed' || proof.target !== target
          || ![proof.started_at, proof.due_at, proof.updated_at].every(Number.isSafeInteger)
          || proof.started_at < row.created_at || proof.due_at - proof.started_at < recipe.workMs
          || proof.updated_at > log.occurred_at || result?.completedAt !== proof.updated_at
          || result.completedAt < proof.due_at || !Number.isSafeInteger(result.attendanceMs)
          || result.attendanceMs < recipe.workMs || result.economicEffects !== 'none') return false;
      if (!db.prepare(`SELECT 1 FROM town_activity_log WHERE action_id=? AND actor_id=? AND world_id=? AND world_epoch=?
        AND phase='completed' AND reason_code='DURATION_ELAPSED' AND location_key=? AND occurred_at=?`)
        .get(proof.id, proof.actor_id, scope.worldId, scope.worldEpoch, target, proof.updated_at)) return false;
    }
    // Completed stock issuance and captured finite budget must accompany proofs.
    const output = db.prepare(`SELECT t.*,e.quantity_delta,e.reserved_delta FROM economy_transactions t
      JOIN town_resource_entries e USING(transaction_id) WHERE t.world_id=? AND t.world_epoch=?
      AND t.source_key=? AND t.command='produceStock' AND e.stock_id=?`)
      .get(scope.worldId, scope.worldEpoch, `production:stock:${row.production_id}`, config.stocks.supplier);
    if (!output || output.quantity_delta !== 1 || output.reserved_delta !== 0
        || parse(output.response)?.productionId !== row.production_id || !Number.isSafeInteger(output.occurred_at)
        || output.occurred_at < row.created_at || output.occurred_at >= row.expires_at || output.occurred_at > log.occurred_at) return false;
    const budget = db.prepare('SELECT * FROM economy_reservations WHERE reservation_id=?').get(row.money_reservation_id);
    if (!budget || budget.world_id !== scope.worldId || budget.world_epoch !== scope.worldEpoch || budget.asset_type !== 'money'
        || budget.asset_id !== config.accounts.workshop || budget.owner_ref !== `production:${row.production_id}`
        || budget.amount !== 30 || budget.captured !== 30 || budget.remaining !== 0 || budget.released !== 0) return false;
    const service = db.prepare(`SELECT s.*,r.receipt_json FROM town_service_sessions s JOIN town_service_settlements r USING(session_id)
      WHERE s.session_id=? AND s.world_id=? AND s.world_epoch=?`).get(row.session_id, scope.worldId, scope.worldEpoch);
    const receipt = parse(service?.receipt_json), serviceConfig = parse(service?.config_json);
    if (!service || service.status !== 'completed' || service.consumed !== 1 || service.crafted !== 1
        || service.provider_actor_id !== config.npcActorIds.workshop || serviceConfig?.stockId !== config.stocks.workshop
        || serviceConfig.accountId !== config.accounts.workshop || serviceConfig.locationKey !== config.locationKeys.workshop) return false;
    let definition; try { definition = resolveTownServiceDefinition(serviceConfig); } catch { return false; }
    const settledId = `service:${row.session_id}:settled`, settled = event(settledId, scope, 'town.service.settled');
    if (!receipt || receipt.sessionId !== row.session_id || receipt.settlementId !== row.session_id || receipt.eventId !== settledId
        || receipt.status !== 'completed' || receipt.paid !== 30 || receipt.payout !== 30 || receipt.refund !== 0
        || receipt.outcomeKey !== definition.outcomeKey || !Number.isSafeInteger(receipt.settledAt)
        || receipt.settledAt > row.created_at || !settled || settled.occurredAt !== receipt.settledAt
        || settled.source?.system !== 'town.service' || settled.source.entityId !== row.session_id
        || settled.locationKey !== serviceConfig.locationKey || !Array.isArray(settled.actorIds)
        || !same(settled.actorIds.slice().sort(), [...new Set([service.actor_id, service.provider_actor_id])].sort())
        || !same(settled.payload, { sessionId: row.session_id, settlementId: row.session_id, status: 'completed', outcomeKey: definition.outcomeKey })
        || receipt.itemIds?.length !== 1) return false;
    return !!db.prepare(`SELECT 1 FROM backpack_items WHERE id=? AND world_id=? AND source_type='service' AND source_id=?
      AND template_id=? AND template_version=?`).get(receipt.itemIds[0], scope.worldId,
      `service:${row.session_id}:outcome:${definition.outcomeKey}`, definition.template.templateId, definition.template.templateVersion);
  }
  return function hasCompletedProduction(scope) {
    return db.transaction(() => {
      if (!Number.isSafeInteger(scope.worldEpoch) || registry.getWorldEpoch(scope.worldId) !== scope.worldEpoch) throw townError('STALE_EPOCH');
      const tables = ['town_productions','town_production_log','town_production_proofs','town_business_slices'];
      if (tables.some(name => !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))) return false;
      const slice = parse(db.prepare('SELECT config FROM town_business_slices WHERE world_id=? AND world_epoch=?')
        .get(scope.worldId, scope.worldEpoch)?.config);
      if (!validSlice(slice)) return false;
      const time = clock.now();
      if (!Number.isSafeInteger(time) || time < 0) throw townError('INVALID_CLOCK');
      const rows = db.prepare("SELECT * FROM town_productions WHERE world_id=? AND world_epoch=? AND status='completed' ORDER BY created_at,production_id")
        .all(scope.worldId, scope.worldEpoch);
      return rows.some(row => valid(scope, row, time, slice));
    }).deferred();
  };
}
