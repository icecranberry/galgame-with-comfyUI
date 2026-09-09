import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';

export const CAFE_SERVICE = Object.freeze({ key: 'town.cafe.drink_coffee', version: 1, price: 18,
  materialQuantity: 1, outcomeKey: 'coffee_served', maxTurns: 4,
  idleMs: 5 * 60000, maxDurationMs: 20 * 60000, offerMs: 5 * 60000, leaseMs: 15000 });
export const CAFE_WORK_SERVICE = Object.freeze({ key: 'town.cafe.work_shift', version: 1, wage: 24,
  materialQuantity: 1, outcomeKey: 'cafe_shift_done', maxTurns: 4,
  idleMs: 5 * 60000, maxDurationMs: 20 * 60000, offerMs: 5 * 60000, leaseMs: 15000 });
const definitionOf = template => template?.key === CAFE_WORK_SERVICE.key ? CAFE_WORK_SERVICE : CAFE_SERVICE;
const closed = new Set(['completed', 'cancelled', 'failed', 'expired']);
const actions = Object.freeze({ menu: ['choose_drink', 'cancel'], serving: ['serve', 'clarify', 'cancel'] });
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sync = value => { if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN'); return value; };

/** Fixed cafe A-chain service. Kept separate from the workshop engine so its
 * price, no-item receipt and menu phases cannot alter frozen B-chain requests.
 * Local flow is complete without LLM; model failure is therefore not a risk.
 */
export function createTownCafeService({ db, clock, registry, economy, position, getCafe, interruptWork, consumers = [] }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor
      || !economy?.transfer || !economy?.reserveStock || !economy?.captureStock
      || !position?.getLocation || !position?.hasArrived || !position?.isServiceOpen
      || typeof getCafe !== 'function') throw townError('MISSING_DEPENDENCY');
  if (interruptWork !== undefined && typeof interruptWork !== 'function') throw townError('INVALID_INTERRUPT_ADAPTER');
  const nowMs = () => {
    const value = sync(clock.now());
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - CAFE_SERVICE.maxDurationMs) throw townError('INVALID_CLOCK');
    return value;
  };
  const events = createTownEventService({ db, clock: { now: nowMs }, getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.service.settled': payload => {
      if (!payload || payload.sessionId !== payload.settlementId
          || typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) return false;
      if (!closed.has(payload.status)) return false;
      return payload.status === 'completed' ? [CAFE_SERVICE.outcomeKey, CAFE_WORK_SERVICE.outcomeKey].includes(payload.outcomeKey)
        : payload.outcomeKey === payload.status;
    } } });
  const epoch = input => {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
        || sync(registry.getWorldEpoch(input.worldId)) !== input.worldEpoch) throw townError('STALE_EPOCH');
  };
  const scopeInput = input => ({ worldId: input.world_id ?? input.worldId, worldEpoch: input.world_epoch ?? input.worldEpoch });
  const row = input => {
    epoch(input);
    const value = db.prepare('SELECT * FROM town_service_sessions WHERE session_id=? AND world_id=? AND world_epoch=?')
      .get(input.sessionId, input.worldId, input.worldEpoch);
    if (!value) throw townError('SESSION_NOT_FOUND');
    return value;
  };
  const actor = (input, actorId, player = false) => {
    const value = sync(registry.getActor(actorId, input.worldId));
    if (!value || value.actorId !== actorId || value.archived || value.mergedInto || !value.participating
        || (player ? value.playerId !== 'me' : !(value.npcExists || value.characterExists))) throw townError('ACTOR_UNAVAILABLE');
    return value;
  };
  const owner = (input, value) => { if (input.actorId !== value.actor_id) throw townError('SESSION_NOT_OWNED'); };
  const version = (input, value) => {
    if (closed.has(value.status)) throw townError('SESSION_CLOSED');
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== value.version) throw townError('VERSION_CONFLICT');
  };
  const location = (input, key) => {
    const place = sync(position.getLocation({ ...input, locationKey: key }));
    if (!place || place.locationKey !== key) throw townError('LOCATION_UNAVAILABLE');
  };
  const arrived = (input, actorId, locationKey) => {
    location(scopeInput(input), locationKey);
    if (sync(position.hasArrived({ ...scopeInput(input), actorId, locationKey })) !== true) throw townError('NOT_ARRIVED');
  };
  const qualified = (input, config, opening = false) => {
    actor(input, input.actorId, true); actor(input, config.actorId);
    arrived(input, input.actorId, config.locationKey); arrived(input, config.actorId, config.locationKey);
    if (opening && sync(position.isServiceOpen({ ...scopeInput(input), actorId: config.actorId,
      locationKey: config.locationKey, serviceKey: definitionOf(config.template).key })) !== true) throw townError('SERVICE_NOT_OPEN');
  };
  function dto(value) {
    const config = JSON.parse(value.config_json), work = config.template?.key === CAFE_WORK_SERVICE.key, def = definitionOf(config.template);
    return { serviceKey: config.template.key,
      serviceName: work ? '咖啡馆打工 · 临时代班' : '镇咖啡馆手冲咖啡',
      serviceDescription: work ? '到店完成点单、备料、冲煮等固定小任务，按班次领取工资。' : '用 1 份咖啡豆做一杯手冲咖啡，服务完成后正式结算。',
      sessionId: value.session_id, ...scopeInput(value), actorId: value.actor_id, providerActorId: value.provider_actor_id,
      status: value.status, phaseKey: value.phase, version: value.version, turnCount: value.turn_count,
      materialsConsumed: !!value.consumed, crafted: !!value.crafted, offerExpiresAt: value.offer_expires_at,
      idleAt: value.idle_at, deadlineAt: value.deadline_at, leaseUntil: value.lease_until,
      template: config.template, locationKey: config.locationKey,
      choices: value.status === 'active' ? actions[value.phase] : [],
      dialogue: value.status === 'offered' ? (work ? `临时代班工资 ${def.wage} 邻币；确认后咖啡馆会把工资托管，完成后付给你，取消全退。`
        : `手冲咖啡收费${def.price}邻币；确认前取消全退，服务完成后退还托管中的全额费用。`)
        : value.status === 'active' ? (work ? '开工了：先备料，再冲煮一杯练习咖啡，完成后领工资。' : value.phase === 'menu' ? '先选一杯今天的咖啡吧。' : '材料已经备好，确认后开始冲煮。') : '',
      settlement: JSON.parse(db.prepare('SELECT receipt_json FROM town_service_settlements WHERE session_id=?').get(value.session_id)?.receipt_json || 'null'),
      turns: db.prepare('SELECT client_turn_id,input_json,response_json FROM town_service_turns WHERE session_id=? ORDER BY rowid').all(value.session_id)
        .map(t => ({ clientTurnId: t.client_turn_id, input: JSON.parse(t.input_json), response: JSON.parse(t.response_json || 'null') })) };
  }
  const get = input => { const value = row(input); owner(input, value); return dto(value); };
  const list = input => {
    epoch(input); actor(input, input.actorId, true);
    return db.prepare('SELECT * FROM town_service_sessions WHERE world_id=? AND world_epoch=? AND actor_id=? ORDER BY created_at DESC LIMIT 100')
      .all(input.worldId, input.worldEpoch, input.actorId).map(dto)
      .filter(value => [CAFE_SERVICE.key, CAFE_WORK_SERVICE.key].includes(value.serviceKey));
  };
  function command(value, suffix) {
    const key = `cafe:${value.session_id}:${suffix}`;
    return { ...scopeInput(value), idempotencyKey: key, sourceKey: key, reasonCode: 'CAFE_SERVICE_OUTCOME' };
  }
  function execute(name, input, body) {
    return db.transaction(() => {
      epoch(input); requireText(input.idempotencyKey);
      const fingerprint = hash({ name, input });
      const old = db.prepare('SELECT * FROM town_service_requests WHERE world_id=? AND request_key=?').get(input.worldId, input.idempotencyKey);
      if (old) {
        if (old.request_hash !== fingerprint) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(old.response_json);
      }
      const result = body();
      epoch(input);
      db.prepare('INSERT INTO town_service_requests VALUES(?,?,?,?)').run(input.worldId, input.idempotencyKey, fingerprint,
        canonicalJson(JSON.parse(JSON.stringify(result))));
      return result;
    }).immediate();
  }
  function update(value, fields) {
    const columns = Object.keys(fields);
    const result = db.prepare(`UPDATE town_service_sessions SET ${columns.map(k => `${k}=?`).join(',')},version=version+1
      WHERE session_id=? AND version=? AND status=?`).run(...Object.values(fields), value.session_id, value.version, value.status);
    if (result.changes !== 1) throw townError('VERSION_CONFLICT');
    return row({ ...scopeInput(value), sessionId: value.session_id });
  }
  function assertActionFree(value) {
    const tableExists = name => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (tableExists('town_actions') && db.prepare(`SELECT 1 FROM town_actions WHERE world_id=? AND world_epoch=?
      AND actor_id IN (?,?) AND status IN ('validated','reserved','running') LIMIT 1`)
      .get(value.world_id, value.world_epoch, value.provider_actor_id, value.actor_id)) throw townError('SERVICE_ACTOR_BUSY');
  }
  function freeze(value, status, reason) {
    const config = JSON.parse(value.config_json);
    const def = definitionOf(config.template), paid = value.escrow_account_id !== null;
    const payout = status === 'completed' ? (def.key === CAFE_WORK_SERVICE.key ? def.wage : def.price) : 0;
    if (value.pending_turn_id) {
      db.prepare('UPDATE town_service_turns SET response_json=COALESCE(response_json,?) WHERE session_id=? AND client_turn_id=?')
        .run(canonicalJson({ fallback: true, dialogue: '本次咖啡服务已进入结算。', reason }), value.session_id, value.pending_turn_id);
    }
    return update(value, { status: 'settling', lease_token: null, lease_until: null,
      plan_json: canonicalJson({ status, reason, payout, refund: paid ? (def.key === CAFE_WORK_SERVICE.key ? def.wage : def.price) - payout : 0, outcomeKey: status === 'completed' ? def.outcomeKey : status }) });
  }
  function settle(value) {
    const perform = () => db.transaction(() => {
      value = row({ ...scopeInput(value), sessionId: value.session_id });
      if (closed.has(value.status)) return dto(value);
      if (value.status !== 'settling') throw townError('SESSION_STATE_CONFLICT');
      const plan = JSON.parse(value.plan_json), config = JSON.parse(value.config_json);
      const def = definitionOf(config.template), work = def.key === CAFE_WORK_SERVICE.key;
      if (plan.status === 'completed' && (!value.consumed || !value.crafted || plan.outcomeKey !== def.outcomeKey)) throw townError('SERVICE_FACTS_INCOMPLETE');
      if (value.material_reservation_id) {
        const hold = sync(economy.getReservation({ ...scopeInput(value), reservationId: value.material_reservation_id }));
        if (hold && hold.remaining) sync(economy.releaseStock({ ...command(value, 'release'), reservationId: hold.reservationId, expectedVersion: hold.version }));
      }
      const payoutTo = work ? config.playerAccountId : config.accountId, refundTo = work ? config.accountId : config.playerAccountId;
      if (plan.payout) sync(economy.transfer({ ...command(value, 'payout'), fromAccountId: value.escrow_account_id, toAccountId: payoutTo, amount: plan.payout }));
      if (plan.refund) sync(economy.transfer({ ...command(value, 'refund'), fromAccountId: value.escrow_account_id, toAccountId: refundTo, amount: plan.refund }));
      if (value.escrow_account_id && sync(economy.getAccount({ ...scopeInput(value), accountId: value.escrow_account_id })).balance !== 0) throw townError('SERVICE_ESCROW_NOT_EMPTY');
      const eventId = `service:${value.session_id}:settled`;
      const receipt = { sessionId: value.session_id, settlementId: value.session_id, eventId, status: plan.status, outcomeKey: plan.outcomeKey,
        reason: plan.reason, paid: !work && value.escrow_account_id ? def.price : 0, payout: plan.payout, refund: plan.refund, itemIds: [], settledAt: nowMs() };
      db.prepare('INSERT INTO town_service_settlements VALUES(?,?)').run(value.session_id, canonicalJson(receipt));
      value = update(value, { status: plan.status, updated_at: nowMs(), pending_turn_id: null });
      events.append({ eventId, ...scopeInput(value), type: 'town.service.settled', occurredAt: receipt.settledAt,
        actorIds: [...new Set([value.actor_id, value.provider_actor_id])], locationKey: config.locationKey,
        source: { system: 'town.service', entityId: value.session_id },
        payload: { sessionId: value.session_id, status: plan.status, outcomeKey: plan.outcomeKey, settlementId: value.session_id } }, consumers);
      return dto(value);
    }).immediate();
    try { return perform(); }
    catch (error) {
      const current = row({ ...scopeInput(value), sessionId: value.session_id });
      if (current.status !== 'settling' || JSON.parse(current.plan_json).status !== 'completed') throw error;
      value = db.transaction(() => freeze(row({ ...scopeInput(value), sessionId: value.session_id }), 'failed', 'SYSTEM_DELIVERY_FAILURE')).immediate();
      return perform();
    }
  }
  function offer(input) {
    return execute('offer', input, () => {
      const supplied = sync(getCafe(scopeInput(input)));
      const definition = input.serviceKey === CAFE_WORK_SERVICE.key ? CAFE_WORK_SERVICE : CAFE_SERVICE;
      const config = { accountId: supplied?.accountId, stockId: supplied?.stockId, actorId: supplied?.actorId,
        locationKey: supplied?.locationKey, template: { ...definition } };
      Object.values(config).filter(v => typeof v !== 'object').forEach(requireText);
      qualified(input, config, true);
      sync(economy.getAccount({ ...scopeInput(input), accountId: config.accountId }));
      sync(economy.getStock({ ...scopeInput(input), stockId: config.stockId }));
      const id = randomUUID(), time = nowMs();
      db.prepare(`INSERT INTO town_service_sessions(session_id,world_id,world_epoch,actor_id,provider_actor_id,status,phase,
        created_at,updated_at,offer_expires_at,config_json) VALUES(?,?,?,?,?,'offered','menu',?,?,?,?)`)
        .run(id, input.worldId, input.worldEpoch, input.actorId, config.actorId, time, time, time + definition.offerMs, canonicalJson(config));
      return get({ ...input, sessionId: id });
    });
  }
  function accept(input) {
    return execute('accept', input, () => {
      let value = row(input); owner(input, value); version(input, value);
      if (value.status !== 'offered') throw townError('SESSION_STATE_CONFLICT');
      if (nowMs() >= value.offer_expires_at) throw townError('OFFER_EXPIRED');
      const config = JSON.parse(value.config_json);
      qualified(input, config, true);
      if (interruptWork) sync(interruptWork({ scope: scopeInput(value), providerActorId: value.provider_actor_id,
        playerActorId: value.actor_id, sessionId: value.session_id }));
      assertActionFree(value);
      const playerAccount = sync(economy.ensureAccount({ ...scopeInput(value), ownerKey: `actor:${value.actor_id}`,
        actorId: value.actor_id, accountType: 'actor' }));
      const escrow = sync(economy.ensureAccount({ ...scopeInput(value), ownerKey: `service:${value.session_id}`, accountType: 'escrow' }));
      const work = config.template?.key === CAFE_WORK_SERVICE.key;
      const escrowSource = work ? config.accountId : playerAccount.accountId;
      const escrowAmount = work ? config.template.wage : config.template.price;
      sync(economy.transfer({ ...command(value, 'escrow'), fromAccountId: escrowSource, toAccountId: escrow.accountId, amount: escrowAmount }));
      const material = sync(economy.reserveStock({ ...command(value, 'reserve'), stockId: config.stockId,
        amount: config.template.materialQuantity, ownerRef: `service:${value.session_id}` })).reservation;
      config.playerAccountId = playerAccount.accountId;
      const time = nowMs();
      value = update(value, { status: 'active', escrow_account_id: escrow.accountId, material_reservation_id: material.reservationId,
        updated_at: time, idle_at: time + config.template.idleMs, deadline_at: time + config.template.maxDurationMs,
        phase: 'serving', config_json: canonicalJson(config) });
      return dto(value);
    });
  }
  function commitTurn(input, intentKey = 'serve') {
    let value = row(input);
    if (value.status !== 'active') throw townError('SESSION_BUSY');
    const config = JSON.parse(value.config_json), def = definitionOf(config.template);
    if (nowMs() >= value.idle_at || nowMs() >= value.deadline_at || value.turn_count >= def.maxTurns) {
      return settle(freeze(value, 'expired', 'TIME_LIMIT'));
    }
    let progressed = false, completed = false;
    if (intentKey === 'choose_drink' && value.phase === 'menu') { value = update(value, { phase: 'serving', updated_at: nowMs() }); progressed = true; }
    else if (intentKey === 'serve' && value.phase === 'serving') {
      const hold = sync(economy.getReservation({ ...scopeInput(value), reservationId: value.material_reservation_id }));
      if (!hold || hold.remaining !== config.template.materialQuantity) return settle(freeze(value, 'failed', 'MATERIAL_UNAVAILABLE'));
      sync(economy.captureStock({ ...command(value, 'consume'), reservationId: hold.reservationId, expectedVersion: hold.version, consume: true }));
      value = update(value, { consumed: 1, crafted: 1, updated_at: nowMs() }); progressed = true; completed = true;
    }
    if (intentKey === 'clarify') {
      const noProgress = value.no_progress + 1;
      value = update(value, { no_progress: noProgress, updated_at: nowMs() });
      if (noProgress >= 2) return settle(freeze(value, 'cancelled', 'NO_PROGRESS'));
      return dto(value);
    }
    if (completed) return settle(freeze(value, 'completed', 'SERVED'));
    if (!progressed) throw townError('INVALID_SERVICE_INTENT');
    return dto(value);
  }
  function turn(input) {
    requireText(input.clientTurnId);
    if (!['choose_drink', 'serve', 'clarify', 'cancel'].includes(input.intentKey)) throw townError('INVALID_SERVICE_INTENT');
    if (input.intentKey === 'cancel') return cancel({ ...input, idempotencyKey: `cafe-turn-cancel:${input.sessionId}:${input.clientTurnId}` });
    const fingerprint = hash(input);
    const claim = db.transaction(() => {
      const previous = db.prepare('SELECT * FROM town_service_turns WHERE session_id=? AND client_turn_id=?').get(input.sessionId, input.clientTurnId);
      let value = row(input); owner(input, value);
      if (previous) {
        if (previous.request_hash !== fingerprint) throw townError('IDEMPOTENCY_CONFLICT');
        return { existing: dto(value) };
      }
      version(input, value);
      if (value.status !== 'active') throw townError('SESSION_BUSY');
      if (!actions[value.phase].includes(input.intentKey)) throw townError('INVALID_SERVICE_INTENT');
      qualified(input, JSON.parse(value.config_json));
      db.prepare('INSERT INTO town_service_turns VALUES(?,?,?,?,NULL)').run(input.sessionId, input.clientTurnId, fingerprint, canonicalJson(input));
      value = update(value, { turn_count: value.turn_count + 1 });
      return { value };
    }).immediate();
    if (claim.existing) return claim.existing;
    return commitTurn(input, input.intentKey);
  }
  function cancel(input) {
    const result = execute('cancel', input, () => {
      const value = row(input); owner(input, value);
      if (closed.has(value.status) || value.status === 'settling') return dto(value);
      version(input, value);
      return dto(freeze(value, 'cancelled', 'USER_CANCELLED'));
    });
    const current = row({ ...input, sessionId: result.sessionId });
    return current.status === 'settling' ? settle(current) : dto(current);
  }
  function recover(input) {
    epoch(input);
    const results = [];
    for (const entry of db.prepare(`SELECT session_id FROM town_service_sessions WHERE world_id=? AND world_epoch=?
      AND status NOT IN ('completed','cancelled','failed','expired')`).all(input.worldId, input.worldEpoch)) {
      let value = row({ ...input, sessionId: entry.session_id });
      if (![CAFE_SERVICE.key, CAFE_WORK_SERVICE.key].includes(JSON.parse(value.config_json).template?.key)) continue;
      if (value.status === 'settling') { results.push(settle(value)); continue; }
      const config = JSON.parse(value.config_json);
      let reason = null, status = 'expired';
      try { actor(input, value.provider_actor_id); location(input, config.locationKey); arrived(input, value.provider_actor_id, config.locationKey); }
      catch { reason = 'PROVIDER_UNAVAILABLE'; status = 'failed'; }
      if (!reason && value.escrow_account_id) {
        try { actor(input, value.actor_id, true); arrived(input, value.actor_id, config.locationKey); }
        catch { reason = 'PLAYER_LEFT'; status = 'cancelled'; }
      }
      if (!reason && ((value.status === 'offered' && nowMs() >= value.offer_expires_at)
          || (value.deadline_at !== null && (nowMs() >= value.deadline_at || nowMs() >= value.idle_at)))) reason = 'TIME_LIMIT';
      if (reason) { results.push(settle(freeze(value, status, reason))); continue; }
    }
    return results;
  }
  function failForRebuild(input) {
    epoch(input);
    const values = db.transaction(() => db.prepare(`SELECT * FROM town_service_sessions WHERE world_id=? AND world_epoch=?
      AND status NOT IN ('completed','cancelled','failed','expired')`).all(input.worldId, input.worldEpoch)
      .filter(value => [CAFE_SERVICE.key, CAFE_WORK_SERVICE.key].includes(JSON.parse(value.config_json).template?.key))
      .map(value => freeze(value, 'failed', 'WORLD_REBUILD'))).immediate();
    return values.map(settle);
  }
  function listCatalog(input) {
    epoch(input);
    try {
      const profile = sync(getCafe(scopeInput(input)));
      if (!profile) return [];
      return [{ serviceKey: CAFE_WORK_SERVICE.key, name: '打工 · 临时代班', description: '到店完成一班固定小任务，工资由咖啡馆托管。', price: 0, wage: CAFE_WORK_SERVICE.wage, available: true, reason: null },
        { serviceKey: CAFE_SERVICE.key, name: '手冲咖啡', description: '用 1 份咖啡豆做一杯手冲咖啡。', price: CAFE_SERVICE.price, available: true, reason: null }];
    } catch (error) { if (error.code === 'CAFE_NOT_CONFIGURED') return []; throw error; }
  }
  return { offer, accept, turn, cancel, get, list, listCatalog, recover, failForRebuild };
}
