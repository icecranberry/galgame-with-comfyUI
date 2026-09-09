import { getDb } from '../../db/index.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { createEconomyService } from './economyService.js';
import { config } from '../../config.js';
import { createTownBusinessService } from './townBusinessService.js';
import { createTownOrderService } from './townOrderService.js';
import { getTownActorPosition, updateTownSettings } from './townService.js';
import { broadcastTownStateUpdated } from './townBus.js';
import { createTownServiceSessionService } from './townServiceSessionService.js';
import { createTownCafeService } from './townCafeService.js';
import { createItemTemplateService } from './itemTemplateService.js';
import { ITEM_EFFECTS } from '../itemService.js';
import { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } from './townExperienceService.js';
import { applyMemoryActions } from '../memory/memoryRepository.js';
import { getMemorySettings } from '../memory/memoryConfig.js';
import { createTownActionRunner } from './townActionRunner.js';
import { createTownBusinessWorkAdapter } from './townBusinessWorkAdapter.js';
import { chatSync } from '../../llm/llm-client.js';
import { createTownProductionService } from './townProductionService.js';
import { createTownAppointmentService } from './townAppointmentService.js';
import { createTownAppointmentAvailability } from './townAppointmentAvailability.js';
import { buildLocationMatcher } from './townLocationMatch.js';
import { createTownEventService } from './townEventService.js';
import { createTownLiquidityPolicy } from './townLiquidityPolicy.js';
import { createTownDeliveryDiagnostics } from './townDeliveryDiagnostics.js';
import { createTownMailboxTasks } from './townMailboxTasks.js';

const activeServiceGenerations = new Map();
const CAFE_SERVICE_KEYS = new Set(['town.cafe.drink_coffee', 'town.cafe.work_shift']);
export function abortTownServiceGenerations(worldId, worldEpoch) {
  for (const [controller, scope] of activeServiceGenerations) {
    if (scope.worldId === worldId && scope.worldEpoch === worldEpoch) controller.abort();
  }
}

/** HTTP adapters resolve player ownership on the server, never from request JSON. */
export function getTownEconomyContext() {
  const db = getDb();
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const player = registry.resolveAgentKey('me');
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const economy = createEconomyService({ db, clock: { now: Date.now },
    getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  return { db, registry, world, player, scope, economy };
}

export function getTownWallet() {
  const { db, player, scope, economy } = getTownEconomyContext();
  const wallet = economy.ensureAccount({ ...scope, ownerKey: `actor:${player.actorId}`,
    accountType: 'actor', actorId: player.actorId });
  const receipts = db.prepare(`SELECT t.response FROM economy_transactions t JOIN economy_entries e
    ON e.transaction_id = t.transaction_id WHERE e.account_id = ? ORDER BY t.rowid DESC LIMIT 20`)
    .all(wallet.accountId).map(r => JSON.parse(r.response));
  return { ...scope, actorId: player.actorId, currency: '邻币', balance: wallet.balance,
    reserved: wallet.reserved, available: wallet.available, version: wallet.version, receipts };
}

export function getTownDeliveryDiagnostics(options = {}) {
  const { db, registry, scope } = getTownEconomyContext();
  const diagnostics = createTownDeliveryDiagnostics({ db, registry, clock: { now: Date.now } });
  return { ...scope, ...diagnostics.list({ scope, cursor: options.cursor ?? null, limit: options.limit ?? 20 }) };
}

export function getTownMailboxTaskCards(options = {}) {
  const { db, registry, scope } = getTownEconomyContext();
  if (config.features.town !== true) return { ...scope, items: [], nextCursor: null };
  const tasks = createTownMailboxTasks({ db, registry, clock: { now: Date.now }, enabled: config.town.economyEnabled === true });
  return tasks.list({ ...scope, cursor: options.cursor ?? null, limit: options.limit ?? 10 });
}

export function retryTownDelivery(input) {
  const context = getTownEconomyContext();
  const { idempotencyKey, ...scope } = commandScope(context, input);
  const diagnostics = createTownDeliveryDiagnostics({ db: context.db, registry: context.registry, clock: { now: Date.now } });
  const result = diagnostics.requeue({ scope, eventId: input.eventId, consumerKey: input.consumerKey, idempotencyKey });
  broadcastTownStateUpdated({ reason: 'delivery_requeued' });
  return { ...scope, ...result };
}

/** Independent read-only schedule adapter: never enters live movement while reading facts. */
export function getTownAppointmentRuntime() {
  const context = getTownEconomyContext();
  const { db, registry } = context;
  const locations = db.prepare('SELECT id, key, name, aliases_json FROM town_locations').all().map(row => {
    let aliases = []; try { aliases = JSON.parse(row.aliases_json || '[]'); } catch {}
    return { ...row, aliases: Array.isArray(aliases) ? aliases : [] };
  });
  const match = buildLocationMatcher(locations);
  const readAvailability = createTownAppointmentAvailability({ db, registry, clock: { now: Date.now },
    timeZone: config.town.timeZone || 'Asia/Shanghai', isTownLocation: name => !!match(name) });
  const appointments = createTownAppointmentService({ db, registry, clock: { now: Date.now },
    getLocation: ({ scope, locationKey }) => {
      if (scope.worldId !== context.scope.worldId || scope.worldEpoch !== context.scope.worldEpoch) return null;
      const row = locations.find(location => location.key === locationKey);
      return row ? { locationKey: row.key, locationId: row.id } : null;
    },
    availability: ({ scope, ...window }) => readAvailability({ ...scope, ...window }).available === true });
  return { ...context, appointments };
}

export function getTownAppointments() {
  const context = getTownAppointmentRuntime();
  maintainTownAppointments(context);
  return { ...context.scope, candidates: context.appointments.listCandidates(context.scope),
    appointments: context.appointments.listAppointments(context.scope) };
}

export function executeTownAppointment(command, id, input) {
  const context = getTownAppointmentRuntime();
  const { idempotencyKey, ...scope } = commandScope(context, input);
  let result;
  if (command === 'accept') result = context.appointments.accept({ scope, candidateId: id,
    startAt: input.startAt, expectedVersion: input.expectedVersion, idempotencyKey });
  else if (command === 'cancel') result = context.appointments.cancel({ scope, appointmentId: id,
    expectedVersion: input.expectedVersion, idempotencyKey });
  else throw Object.assign(new Error('未知预约操作'), { status: 400 });
  broadcastTownStateUpdated({ reason: 'appointment_changed' });
  return result;
}

function maintainTownAppointments(context = getTownAppointmentRuntime()) {
  const { db, scope, appointments, registry } = context;
  const consumerKey = 'town.appointment';
  const expired = appointments.expire({ scope });
  // GET also runs this maintenance: notify only a committed transition so
  // subscribers can reread without creating a notification/read feedback loop.
  if (expired.candidates > 0 || expired.appointments > 0) {
    broadcastTownStateUpdated({ ...scope, reason: 'appointment_expired' });
  }
  const events = db.prepare(`SELECT e.event_id FROM town_domain_events e
    JOIN town_service_sessions s ON e.event_id = 'service:' || s.session_id || ':settled'
    JOIN town_actors a ON a.actor_id = s.provider_actor_id
    JOIN characters c ON c.id = a.character_id
    WHERE e.world_id = ? AND e.world_epoch = ? AND e.type = 'town.service.settled'
      AND json_extract(s.config_json, '$.template.key') = 'town.workshop'
      AND a.participating = 1 AND a.archived = 0 AND a.merged_into IS NULL
      AND json_extract(e.envelope, '$.occurredAt') > ? AND NOT EXISTS (SELECT 1 FROM town_appointment_candidates candidate
        WHERE candidate.world_id = e.world_id AND candidate.source_event_id = e.event_id)
      AND NOT EXISTS (SELECT 1 FROM town_event_deliveries delivery
        WHERE delivery.event_id = e.event_id AND delivery.consumer_key = ?)
    ORDER BY e.seq LIMIT 30`).all(scope.worldId, scope.worldEpoch, Date.now() - 7 * 86400000, consumerKey);
  for (const event of events) {
    db.prepare(`INSERT OR IGNORE INTO town_event_deliveries(event_id,consumer_key,status,next_attempt_at)
      VALUES(?,?,'pending',?)`).run(event.event_id, consumerKey, Date.now());
  }
  const queue = createTownEventService({ db, clock: { now: Date.now }, getWorldEpoch: registry.getWorldEpoch });
  for (let count = 0; count < 30; count++) {
    const claim = queue.claim({ ...scope, consumerKey });
    if (!claim) break;
    try {
      queue.consume(claim, event => {
        try { appointments.offerFromSettlement({ scope, sourceEventId: event.eventId }); }
        catch (error) {
          // Immutable invalid/expired settlements are terminal skips, never a poison batch.
          if (!['APPOINTMENT_SOURCE_INVALID', 'CANDIDATE_EXPIRED'].includes(error.code)) throw error;
          db.prepare('UPDATE town_event_deliveries SET last_error = ? WHERE event_id = ? AND consumer_key = ?')
            .run(error.code, event.eventId, consumerKey);
        }
      });
    }
    catch (error) {
      queue.retry(claim, error.code || error.message);
    }
  }
}

export function getTownActorActivities(actorId, { cursor = 0, limit = 20 } = {}) {
  const { db, registry, scope } = getTownEconomyContext();
  const actor = registry.getActor(actorId, { followMerged: false });
  if (!actor || actor.mergedInto) throw Object.assign(new Error('居民不存在'), { status: 404 });
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw Object.assign(new Error('分页参数无效'), { status: 400 });
  }
  const rows = db.prepare(`SELECT * FROM town_activity_log WHERE world_id = ? AND world_epoch = ?
    AND actor_id = ? AND seq > ? ORDER BY seq LIMIT ?`).all(scope.worldId, scope.worldEpoch, actorId, cursor, limit);
  const activities = rows.map(r => ({ seq: r.seq, actorId: r.actor_id, actionId: r.action_id,
    eventId: r.event_id, phase: r.phase, reasonCode: r.reason_code, ruleKey: r.rule_key,
    ruleVersion: r.rule_version, locationKey: r.location_key, occurredAt: r.occurred_at,
    result: r.result ? JSON.parse(r.result) : null }));
  const experiences = db.prepare(`SELECT event_id AS eventId, summary, occurred_at AS occurredAt
    FROM town_experiences WHERE world_id = ? AND world_epoch = ? AND actor_id = ?
    ORDER BY occurred_at DESC, event_id DESC LIMIT 20`).all(scope.worldId, scope.worldEpoch, actorId);
  return { ...scope, actorId, activities, experiences, nextCursor: activities.at(-1)?.seq ?? cursor };
}

export function getTownBusinessRuntime() {
  const context = getTownEconomyContext();
  const { db, registry, economy, scope } = context;
  const position = {
    getLocation: ({ worldId, worldEpoch, locationKey }) => {
      if (worldId !== scope.worldId || worldEpoch !== scope.worldEpoch) return null;
      const row = db.prepare('SELECT * FROM town_locations WHERE key = ?').get(locationKey);
      return row ? { locationKey: row.key, name: row.name, x: row.grid_x, y: row.grid_y } : null;
    },
    hasArrived: ({ worldId, worldEpoch, actorId, locationKey }) => {
      const position = getTownActorPosition(actorId);
      return !!position && position.worldId === worldId && position.worldEpoch === worldEpoch
        && !position.moving && position.locationKeys.includes(locationKey);
    },
  };
  const dependencies = { db, registry, economy, position, clock: { now: Date.now }, consumers: [TOWN_EXPERIENCE_CONSUMER] };
  const business = createTownBusinessService(dependencies);
  const work = createTownBusinessWorkAdapter({ ...dependencies, getSlice: business.getSlice,
    getActorPosition: getTownActorPosition, getLocation: position.getLocation,
    readActiveService: ({ worldId, worldEpoch, actorId }) => {
      const row = db.prepare(`SELECT * FROM town_service_sessions WHERE world_id = ? AND world_epoch = ?
        AND provider_actor_id = ? AND escrow_account_id IS NOT NULL
        AND status IN ('active', 'resolving', 'settling') LIMIT 1`).get(worldId, worldEpoch, actorId);
      return row ? { worldId, worldEpoch, actorId, sessionId: row.session_id, phase: 'running',
        locationKey: JSON.parse(row.config_json).locationKey, leaseUntilUtcMs: Math.min(row.deadline_at, row.idle_at) } : null;
    } });
  const itemTemplates = createItemTemplateService({ ...dependencies,
    getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor, effectRegistry: ITEM_EFFECTS });
  position.isServiceOpen = input => !!config.town.economyEnabled && work.getWorkState(input.actorId, input)?.open === true;
  const services = createTownServiceSessionService({ ...dependencies, itemTemplates,
    generate: config.features.townLLM ? async ({ prompt, context: scene, signal }) => {
      const controller = new AbortController();
      activeServiceGenerations.set(controller, scope);
      try {
        const actor = registry.getActor(scene.speakerKey, scope.worldId);
        const character = actor?.characterExists ? db.prepare('SELECT display_name, short_prompt FROM characters WHERE id = ?').get(actor.characterId) : null;
        const npc = actor?.npcExists ? db.prepare('SELECT display_name, persona FROM town_npcs WHERE id = ?').get(actor.npcId) : null;
        const identity = `服务人员：${character?.display_name || npc?.display_name || '工坊师傅'}。\n角色背景：${String(character?.short_prompt || npc?.persona || '友善、认真地帮助玩家完成制作。').slice(0, 2000)}`;
        return await chatSync([{ role: 'system', content: `${identity}\n\n${prompt}` },
          { role: 'user', content: '请回应本轮服务操作，严格输出要求的 JSON。' }], {
          signal: AbortSignal.any([signal, controller.signal]), timeout: 10000, retries: 0, maxRetries: 0,
          freeEggFailover: false, max_tokens: 1200, temperature: 0.7, thinking: { type: 'disabled' },
          response_format: { type: 'json_object' }, label: '小镇工坊服务',
        });
      } finally { activeServiceGenerations.delete(controller); }
    } : undefined,
    interruptWork: ({ scope: serviceScope, providerActorId, sessionId }) => {
      const slice = business.getSlice(serviceScope);
      const runner = createTownActionRunner({ db, clock: { now: Date.now },
        getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor, readFacts: () => ({}) });
      const actions = db.prepare(`SELECT id, version, type, target FROM town_actions WHERE world_id = ?
        AND world_epoch = ? AND actor_id = ? AND status IN ('validated', 'reserved', 'running')`)
        .all(serviceScope.worldId, serviceScope.worldEpoch, providerActorId);
      // Service acceptance already verified both arrivals. Only ordinary on-site work can yield;
      // production, another service or unrelated commitments keep their own cancellation policy.
      for (const action of actions) {
        if (!['work_shift', 'wait'].includes(action.type) || action.target !== slice.locationKeys.workshop) continue;
        runner.cancel({ ...serviceScope, actionId: action.id, expectedVersion: action.version,
          idempotencyKey: `service:${sessionId}:interrupt:${action.id}`, reasonCode: 'SERVICE_ACCEPTED' });
      }
    },
    getWorkshop: requestedScope => {
      const slice = business.getSlice(requestedScope);
      return { accountId: slice.accounts.workshop, stockId: slice.stocks.workshop,
        actorId: slice.npcActorIds.workshop, locationKey: slice.locationKeys.workshop };
    } });
  const interruptCafeWork = ({ scope: serviceScope, providerActorId, sessionId }) => {
    const slice = business.getSlice(serviceScope);
    if (!slice.cafe) return;
    const runner = createTownActionRunner({ db, clock: { now: Date.now },
      getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor, readFacts: () => ({}) });
    const actions = db.prepare(`SELECT id, version, type, target FROM town_actions WHERE world_id = ?
      AND world_epoch = ? AND actor_id = ? AND status IN ('validated', 'reserved', 'running')`)
      .all(serviceScope.worldId, serviceScope.worldEpoch, providerActorId);
    for (const action of actions) {
      if (!['work_shift', 'wait'].includes(action.type) || action.target !== slice.cafe.locationKey) continue;
      runner.cancel({ ...serviceScope, actionId: action.id, expectedVersion: action.version,
        idempotencyKey: `cafe:${sessionId}:interrupt:${action.id}`, reasonCode: 'CAFE_SERVICE_ACCEPTED' });
    }
  };
  const getCafe = requestedScope => {
    const slice = business.getSlice(requestedScope);
    if (!slice.cafe) throw Object.assign(new Error('CAFE_NOT_CONFIGURED'), { code: 'CAFE_NOT_CONFIGURED' });
    return { accountId: slice.accounts.cafe, stockId: slice.cafe.stockId,
      actorId: slice.cafe.actorId, locationKey: slice.cafe.locationKey };
  };
  const cafe = createTownCafeService({ ...dependencies, getCafe, interruptWork: interruptCafeWork });
  return { ...context, position, business, work, itemTemplates, services, cafe,
    liquidity: createTownLiquidityPolicy({ ...dependencies, enabled: config.town.liquidityEnabled === true }),
    production: createTownProductionService(dependencies), orders: createTownOrderService(dependencies) };
}

function commandScope(context, input) {
  if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch !== context.scope.worldEpoch) {
    throw Object.assign(new Error('小镇已更新，请刷新后重试'), { status: 409, code: 'STALE_EPOCH' });
  }
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 128) {
    throw Object.assign(new Error('请求标识无效'), { status: 400 });
  }
  return { ...context.scope, idempotencyKey: input.idempotencyKey };
}

export function getTownEconomyState() {
  const context = getTownBusinessRuntime();
  const { db, scope, registry, business, orders, economy } = context;
  let slice = null;
  try { slice = business.getSlice(scope); } catch (err) { if (err.code !== 'SLICE_NOT_CONFIGURED') throw err; }
  const participants = registry.synchronize().filter(a => a.npcExists && a.participating && !a.archived)
    .map(a => ({ actorId: a.actorId, displayName: db.prepare('SELECT display_name FROM town_npcs WHERE id = ?').get(a.npcId)?.display_name || '居民' }));
  const locations = db.prepare('SELECT key, name, grid_x AS x, grid_y AS y FROM town_locations ORDER BY id').all();
  return { ...scope, enabled: !!config.town.economyEnabled, configured: !!slice,
    slice, wallet: getTownWallet(), orders: orders.list(scope), participants, locations,
    production: slice ? { batches: context.production.list(scope), resource: context.production.getResourceNode(scope) } : null,
    liquidity: slice ? context.liquidity.getStatus(scope) : null,
    service: slice ? { locationKey: slice.locationKeys.workshop, providerActorId: slice.npcActorIds.workshop,
      open: !!config.town.economyEnabled && context.work.getBusinessStatus({ ...scope, role: 'workshop' })?.open === true,
      hours: '09:00–18:00（北京时间）',
      catalog: context.services.listCatalog(scope),
      sessions: context.services.list({ ...scope, actorId: context.player.actorId }) } : null,
    cafe: slice?.cafe ? { locationKey: slice.cafe.locationKey, providerActorId: slice.cafe.actorId,
      open: !!config.town.economyEnabled && context.work.getBusinessStatus({ ...scope, role: 'cafe' })?.open === true,
      hours: '09:00–18:00（北京时间）',
      stock: economy.getStock({ ...scope, stockId: slice.cafe.stockId }),
      supplierStock: economy.getStock({ ...scope, stockId: slice.cafe.supplierStockId }),
      catalog: context.cafe.listCatalog(scope),
      sessions: context.cafe.list({ ...scope, actorId: context.player.actorId }) } : null };
}

export function getTownLiquidityStatus() {
  const context = getTownBusinessRuntime();
  return { ...context.scope, liquidity: context.liquidity.getStatus(context.scope) };
}

export async function executeTownService(command, sessionId, input) {
  const context = getTownBusinessRuntime();
  const scope = commandScope(context, input);
  if (!config.town.economyEnabled && ['offer', 'accept'].includes(command)) {
    throw Object.assign(new Error('工坊暂未营业'), { code: 'ECONOMY_DISABLED' });
  }
  if (!['offer', 'accept', 'turn', 'cancel'].includes(command)) throw new Error('未知服务操作');
  const args = { ...scope, actorId: context.player.actorId,
    ...(sessionId ? { sessionId, expectedVersion: input.expectedVersion } : {}) };
  // Only a new offer selects a definition. Existing sessions and legacy retries
  // retain their frozen configuration and original request fingerprint.
  if (command === 'offer' && Object.hasOwn(input, 'serviceKey')) args.serviceKey = input.serviceKey;
  if (command === 'turn') Object.assign(args, { clientTurnId: scope.idempotencyKey, intentKey: input.intentKey, text: input.text ?? '' });
  const cafeSession = sessionId ? (() => {
    try {
      const row = context.db.prepare('SELECT config_json FROM town_service_sessions WHERE session_id=? AND world_id=? AND world_epoch=?')
        .get(sessionId, scope.worldId, scope.worldEpoch);
      return !!row && CAFE_SERVICE_KEYS.has(JSON.parse(row.config_json).template?.key);
    } catch { return false; }
  })() : CAFE_SERVICE_KEYS.has(input.serviceKey);
  const service = cafeSession ? context.cafe : context.services;
  const result = await service[command](args);
  broadcastTownStateUpdated({ reason: 'service_changed' });
  return result;
}

export function getTownService(sessionId) {
  const context = getTownBusinessRuntime();
  context.cafe.recover(context.scope); context.services.recover(context.scope);
  const row = context.db.prepare('SELECT config_json FROM town_service_sessions WHERE session_id=? AND world_id=? AND world_epoch=?')
    .get(sessionId, context.scope.worldId, context.scope.worldEpoch);
  if (!row) throw new Error('服务不存在');
  const service = CAFE_SERVICE_KEYS.has(JSON.parse(row.config_json).template?.key) ? context.cafe : context.services;
  return service.get({ ...context.scope, actorId: context.player.actorId, sessionId });
}

export function isTownActorServing(actorId) {
  if (!actorId) return false;
  return !!getDb().prepare(`SELECT 1 FROM town_service_sessions
    WHERE (provider_actor_id = ? OR actor_id = ?) AND escrow_account_id IS NOT NULL
      AND status IN ('active', 'resolving', 'settling') LIMIT 1`).get(actorId, actorId);
}

export function setupTownEconomy(input) {
  const context = getTownBusinessRuntime();
  const command = commandScope(context, input);
  const slice = context.db.transaction(() => {
    const value = context.business.setup({ ...command, sourceKey: `setup:${context.scope.worldEpoch}`,
      npcActorIds: input.npcActorIds, locationKeys: input.locationKeys });
    const resourceKey = `resource:${context.scope.worldId}:${context.scope.worldEpoch}`;
    context.production.initializeResourceNode({ ...context.scope, idempotencyKey: resourceKey, sourceKey: resourceKey });
    return value;
  }).immediate();
  updateTownSettings({ economyEnabled: true });
  broadcastTownStateUpdated({ reason: 'economy_setup' });
  return { ...command, slice };
}

export function executeTownOrder(command, orderId, input) {
  const context = getTownBusinessRuntime();
  const scope = commandScope(context, input);
  if (!config.town.economyEnabled && ['publish', 'accept'].includes(command)) {
    throw Object.assign(new Error('小镇委托暂未开启'), { status: 409, code: 'ECONOMY_DISABLED' });
  }
  if (!['publish', 'accept', 'pickup', 'complete', 'cancel'].includes(command)) throw new Error('未知委托操作');
  const result = context.db.transaction(() => {
  if (command === 'publish') {
    const businessKey = input.businessKey ?? 'workshop';
    const functionalOrder = businessKey !== 'workshop';
    const requestKey = functionalOrder ? `${businessKey}:${scope.idempotencyKey}` : scope.idempotencyKey;
    // One available/unsettled commission per business line; clients cannot drain all budget by publishing many cards.
    const active = context.orders.list(scope).find(o => ['open', 'accepted', 'picked_up'].includes(o.status)
      && (!functionalOrder || o.businessKey === businessKey));
    const legacyRequest = context.db.prepare('SELECT 1 FROM town_business_requests WHERE world_id = ? AND request_key = ?')
      .get(scope.worldId, requestKey);
    const policyRequest = !functionalOrder ? context.db.prepare('SELECT 1 FROM town_liquidity_requests WHERE world_id = ? AND request_key = ?')
      .get(scope.worldId, scope.idempotencyKey) : null;
    if (active && !legacyRequest && !policyRequest) {
      throw Object.assign(new Error('已有一份委托，请先完成或取消'), { status: 409, code: 'ACTIVE_ORDER_EXISTS' });
    }
    if (functionalOrder) return context.orders.publish({ ...scope, actorId: context.player.actorId,
      businessKey, idempotencyKey: requestKey,
      sourceKey: `${businessKey}-publish:${scope.worldEpoch}:${scope.idempotencyKey}` });
    if (!legacyRequest) return context.liquidity.publish({ ...scope, actorId: context.player.actorId });
  }
  return context.orders[command]({ ...scope, actorId: context.player.actorId,
    ...(orderId ? { orderId, expectedVersion: input.expectedVersion } : {}),
    sourceKey: command === 'publish' ? `publish:${scope.worldEpoch}:${scope.idempotencyKey}` : `order:${orderId}:${command}` });
  }).immediate();
  broadcastTownStateUpdated({ reason: 'order_changed' });
  return result;
}

/** Always run even while economy is disabled; turning off new trades cannot strand reservations. */
export function maintainTownOrders() {
  const context = getTownBusinessRuntime();
  const now = Date.now();
  const recovered = [...context.services.recover(context.scope), ...context.cafe.recover(context.scope)];
  if (recovered.length) broadcastTownStateUpdated({ reason: 'service_recovered' });
  for (const order of context.orders.list(context.scope)) {
    if (['open', 'accepted', 'picked_up'].includes(order.status) && order.expiresAt <= now) {
      context.orders.expire({ ...context.scope, orderId: order.orderId, expectedVersion: order.version,
        idempotencyKey: `expire:${order.orderId}`, sourceKey: `expire:${order.orderId}` });
      broadcastTownStateUpdated({ reason: 'order_expired' });
    }
  }
  maintainTownProductions(context);
  maintainTownCafeRestock(context);
  maintainTownAppointments();
  createTownExperienceService({ db: context.db, clock: { now: Date.now }, registry: context.registry,
    writeMemory: applyMemoryActions, memoryEnabled: () => getMemorySettings().enabled,
    timeZone: config.town.timeZone || 'Asia/Shanghai' }).drain(context.scope);
}

function maintainTownCafeRestock(context) {
  if (!config.town.economyEnabled) return;
  let slice;
  try { slice = context.business.getSlice(context.scope); }
  catch (error) { if (error.code === 'SLICE_NOT_CONFIGURED') return; throw error; }
  if (!slice.cafe) return;
  const orders = context.orders.list(context.scope);
  const active = orders.some(order => order.businessKey === 'cafe' && ['open', 'accepted', 'picked_up'].includes(order.status));
  const stock = context.economy.getStock({ ...context.scope, stockId: slice.cafe.stockId });
  const supplier = context.economy.getStock({ ...context.scope, stockId: slice.cafe.supplierStockId });
  const cafeAccount = context.economy.getAccount({ ...context.scope, accountId: slice.accounts.cafe });
  if (active || stock.available > 2 || supplier.available < 1 || cafeAccount.available < slice.cafe.reward) return;
  const count = orders.filter(order => order.businessKey === 'cafe').length + 1;
  const key = `cafe-restock:${context.scope.worldId}:${context.scope.worldEpoch}:${count}`;
  context.db.transaction(() => context.orders.publish({ ...context.scope, actorId: context.player.actorId,
    businessKey: 'cafe', idempotencyKey: key, sourceKey: key }))();
  broadcastTownStateUpdated({ reason: 'cafe_restock' });
}

function maintainTownProductions(context) {
  const { db, scope, production, work } = context;
  let changed = false;
  for (const batch of production.list(scope)) {
    if (batch.status !== 'reserved') continue;
    const base = { ...scope, productionId: batch.productionId, expectedVersion: batch.version };
    if (!config.town.economyEnabled || batch.expiresAt <= Date.now()) {
      const command = config.town.economyEnabled ? 'expire' : 'cancel';
      production[command]({ ...base, idempotencyKey: `${command}:${batch.productionId}`, sourceKey: `${command}:${batch.productionId}` });
      changed = true;
      continue;
    }
    const proofs = production.findAvailableProofs({ ...scope, productionId: batch.productionId });
    if (!proofs) continue;
    production.complete({ ...base, ...proofs,
      idempotencyKey: `complete:${batch.productionId}`, sourceKey: `complete:${batch.productionId}` });
    changed = true;
  }
  if (config.town.economyEnabled && work.getBusinessStatus({ ...scope, role: 'supplier' })?.open
      && work.getBusinessStatus({ ...scope, role: 'workshop' })?.open) {
    const sessions = db.prepare(`SELECT s.session_id FROM town_service_sessions s WHERE s.world_id = ?
      AND s.world_epoch = ? AND s.status = 'completed' AND NOT EXISTS (SELECT 1 FROM town_productions p
        WHERE p.world_id = s.world_id AND p.session_id = s.session_id AND p.status IN ('reserved', 'completed'))
      ORDER BY s.created_at LIMIT 10`).all(scope.worldId, scope.worldEpoch);
    for (const session of sessions) {
      const attempt = db.prepare('SELECT count(*) n FROM town_productions WHERE session_id = ?').get(session.session_id).n;
      const key = `start:${session.session_id}:${attempt}`;
      try {
        production.start({ ...scope, sessionId: session.session_id, idempotencyKey: key, sourceKey: key });
        changed = true;
      } catch (error) {
        if (!['INSUFFICIENT_FUNDS', 'RESOURCE_CAPACITY_EXHAUSTED', 'ACTOR_UNAVAILABLE', 'LOCATION_UNAVAILABLE'].includes(error.code)) throw error;
        break;
      }
    }
  }
  if (changed) broadcastTownStateUpdated({ reason: 'production_changed' });
}
