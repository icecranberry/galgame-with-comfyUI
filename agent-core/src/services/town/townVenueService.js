import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';
import { getVenueServiceSpec, isVenueServiceKey, venueServiceCatalog, venueServiceTemplate } from './townVenuePlaybooks.js';

const closed = new Set(['completed', 'cancelled', 'failed', 'expired']);
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sync = value => { if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN'); return value; };
const frozenFields = template => Object.keys(template).sort();

/** Strictly compare a stored template with its registered frozen definition.
 * Any drift is a tampered or unknown service version, never a silent upgrade.
 */
export function assertFrozenTemplate(template, expected) {
  if (!template || typeof template !== 'object' || template.key !== expected.key) throw townError('INVALID_SERVICE_DEFINITION');
  const keys = frozenFields(expected);
  if (canonicalJson(keys) !== canonicalJson(Object.keys(template).sort())) throw townError('INVALID_SERVICE_DEFINITION');
  for (const key of keys) if (template[key] !== expected[key]) throw townError('INVALID_SERVICE_DEFINITION');
  return true;
}

/** 默认解析器：注册表里的新功能建筑。返回引擎需要的全部玩法信息。 */
export function resolveVenueDefinition(template) {
  const spec = getVenueServiceSpec(template?.key);
  if (!spec) throw townError('INVALID_SERVICE_DEFINITION');
  const frozen = venueServiceTemplate(spec.service);
  assertFrozenTemplate(template, frozen);
  return { template: frozen, playbook: spec.playbook, payer: spec.playbook.payer,
    product: spec.service.product || null, businessKey: spec.kind.businessKey,
    commandPrefix: spec.kind.businessKey, reasonCode: 'VENUE_SERVICE_OUTCOME',
    completeReason: 'SERVED', freezeText: `${spec.service.name}已进入结算。`,
    lines: { name: spec.service.name, description: spec.service.description,
      offered: () => spec.service.offered(frozen), active: phase => spec.service.active(frozen, phase) },
    catalog: venueServiceCatalog(spec) };
}

/**
 * 通用功能建筑服务引擎：阶段机、托管、退款、材料占用、产出道具与回执全部由
 * playbook 驱动。咖啡馆是它的一个冻结实例（townCafeService 只做声明转发）。
 */
export function createTownVenueService({ db, clock, registry, economy, position, itemTemplates = null,
  getVenue, resolveDefinition = resolveVenueDefinition, resolveServiceKey = null, interruptWork,
  consumers = [], onConsumed = null, defaultServiceKey = null, defaultBusinessKey = null }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor
      || !economy?.transfer || !economy?.reserveStock || !economy?.captureStock
      || !position?.getLocation || !position?.hasArrived || !position?.isServiceOpen
      || typeof getVenue !== 'function' || typeof resolveDefinition !== 'function') throw townError('MISSING_DEPENDENCY');
  if (interruptWork !== undefined && typeof interruptWork !== 'function') throw townError('INVALID_INTERRUPT_ADAPTER');
  if (onConsumed !== null && typeof onConsumed !== 'function') throw townError('INVALID_CONSUME_ADAPTER');
  const nowMs = () => {
    const value = sync(clock.now());
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 20 * 60000) throw townError('INVALID_CLOCK');
    return value;
  };
  const isKnownTemplate = template => { try { resolveDefinition(template); return true; } catch { return false; } };
  /** 按 serviceKey 取冻结定义；新建筑走注册表，咖啡馆由 facade 注入。 */
  const byServiceKey = serviceKey => {
    if (typeof resolveServiceKey === 'function') return resolveServiceKey(serviceKey);
    const spec = getVenueServiceSpec(serviceKey);
    if (!spec) throw townError('INVALID_SERVICE_KEY');
    return resolveDefinition(venueServiceTemplate(spec.service));
  };
  const actionsOf = (definition, phase) => definition.playbook.phases.find(item => item.key === phase)?.actions || [];
  const allActionsOf = definition => [...new Set(definition.playbook.phases.flatMap(item => item.actions))];
  const events = createTownEventService({ db, clock: { now: nowMs }, getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.service.settled': payload => {
      if (!payload || payload.sessionId !== payload.settlementId
          || typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) return false;
      if (!closed.has(payload.status)) return false;
      if (payload.status !== 'completed') return payload.outcomeKey === payload.status;
      return typeof payload.outcomeKey === 'string' && payload.outcomeKey.length > 0;
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
  const qualified = (input, config, definition, opening = false) => {
    actor(input, input.actorId, true); actor(input, config.actorId);
    arrived(input, input.actorId, config.locationKey); arrived(input, config.actorId, config.locationKey);
    if (opening && sync(position.isServiceOpen({ ...scopeInput(input), actorId: config.actorId,
      locationKey: config.locationKey, serviceKey: definition.template.key })) !== true) throw townError('SERVICE_NOT_OPEN');
  };
  function dto(value) {
    const config = JSON.parse(value.config_json), definition = resolveDefinition(config.template);
    const playbook = definition.playbook;
    const dialogue = value.status === 'offered' ? definition.lines.offered()
      : value.status === 'active' ? definition.lines.active(value.phase) : '';
    return { serviceKey: definition.template.key,
      serviceName: definition.lines.name, serviceDescription: definition.lines.description,
      sessionId: value.session_id, ...scopeInput(value), actorId: value.actor_id, providerActorId: value.provider_actor_id,
      status: value.status, phaseKey: value.phase, version: value.version, turnCount: value.turn_count,
      materialsConsumed: !!value.consumed, crafted: !!value.crafted, offerExpiresAt: value.offer_expires_at,
      idleAt: value.idle_at, deadlineAt: value.deadline_at, leaseUntil: value.lease_until,
      template: config.template, locationKey: config.locationKey,
      choices: value.status === 'active' ? actionsOf(definition, value.phase) : [],
      dialogue, playbookKey: playbook.key, payer: definition.payer, businessKey: definition.businessKey,
      settlement: JSON.parse(db.prepare('SELECT receipt_json FROM town_service_settlements WHERE session_id=?').get(value.session_id)?.receipt_json || 'null'),
      turns: db.prepare('SELECT client_turn_id,input_json,response_json FROM town_service_turns WHERE session_id=? ORDER BY rowid').all(value.session_id)
        .map(t => ({ clientTurnId: t.client_turn_id, input: JSON.parse(t.input_json), response: JSON.parse(t.response_json || 'null') })) };
  }
  const get = input => { const value = row(input); owner(input, value); return dto(value); };
  const list = input => {
    epoch(input); actor(input, input.actorId, true);
    return db.prepare('SELECT * FROM town_service_sessions WHERE world_id=? AND world_epoch=? AND actor_id=? ORDER BY created_at DESC LIMIT 100')
      .all(input.worldId, input.worldEpoch, input.actorId).filter(value => isKnownTemplate(JSON.parse(value.config_json).template)).map(dto);
  };
  function command(value, suffix, definition) {
    const key = `${definition.commandPrefix}:${value.session_id}:${suffix}`;
    return { ...scopeInput(value), idempotencyKey: key, sourceKey: key, reasonCode: definition.reasonCode };
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
    const config = JSON.parse(value.config_json), definition = resolveDefinition(config.template);
    const amount = definition.payer === 'venue' ? definition.template.wage : definition.template.price;
    const paid = value.escrow_account_id !== null;
    const payout = status === 'completed' ? amount : 0;
    if (value.pending_turn_id) {
      db.prepare('UPDATE town_service_turns SET response_json=COALESCE(response_json,?) WHERE session_id=? AND client_turn_id=?')
        .run(canonicalJson({ fallback: true, dialogue: definition.freezeText, reason }), value.session_id, value.pending_turn_id);
    }
    return update(value, { status: 'settling', lease_token: null, lease_until: null,
      plan_json: canonicalJson({ status, reason, payout, refund: paid ? amount - payout : 0,
        outcomeKey: status === 'completed' ? definition.template.outcomeKey : status }) });
  }
  function settle(value) {
    const perform = () => db.transaction(() => {
      value = row({ ...scopeInput(value), sessionId: value.session_id });
      if (closed.has(value.status)) return dto(value);
      if (value.status !== 'settling') throw townError('SESSION_STATE_CONFLICT');
      const plan = JSON.parse(value.plan_json), config = JSON.parse(value.config_json);
      const definition = resolveDefinition(config.template);
      if (plan.status === 'completed' && (!value.consumed || !value.crafted
          || plan.outcomeKey !== definition.template.outcomeKey)) throw townError('SERVICE_FACTS_INCOMPLETE');
      if (value.material_reservation_id) {
        const hold = sync(economy.getReservation({ ...scopeInput(value), reservationId: value.material_reservation_id }));
        if (hold && hold.remaining) sync(economy.releaseStock({ ...command(value, 'release', definition),
          reservationId: hold.reservationId, expectedVersion: hold.version }));
      }
      const venuePays = definition.payer === 'venue';
      const payoutTo = venuePays ? config.playerAccountId : config.accountId;
      const refundTo = venuePays ? config.accountId : config.playerAccountId;
      if (plan.payout) sync(economy.transfer({ ...command(value, 'payout', definition),
        fromAccountId: value.escrow_account_id, toAccountId: payoutTo, amount: plan.payout }));
      if (plan.refund) sync(economy.transfer({ ...command(value, 'refund', definition),
        fromAccountId: value.escrow_account_id, toAccountId: refundTo, amount: plan.refund }));
      if (value.escrow_account_id && sync(economy.getAccount({ ...scopeInput(value), accountId: value.escrow_account_id })).balance !== 0) {
        throw townError('SERVICE_ESCROW_NOT_EMPTY');
      }
      let itemIds = [];
      if (plan.status === 'completed' && definition.product) {
        if (!itemTemplates?.grant) throw townError('ITEM_TEMPLATES_REQUIRED');
        const sourceId = `service:${value.session_id}:outcome:${plan.outcomeKey}`;
        const grant = sync(itemTemplates.grant({ ...scopeInput(value), templateId: definition.product.templateId,
          templateVersion: definition.product.templateVersion, ownerKey: 'me', quantity: 1, sourceType: 'service',
          sourceId, idempotencyKey: sourceId, reasonCode: 'SERVICE_OUTCOME' }));
        itemIds = Array.isArray(grant) ? grant : grant?.itemIds;
        if (!Array.isArray(itemIds) || itemIds.length !== 1 || !Number.isSafeInteger(itemIds[0])) throw townError('SERVICE_GRANT_INVALID');
      }
      const eventId = `service:${value.session_id}:settled`;
      const receipt = { sessionId: value.session_id, settlementId: value.session_id, eventId, status: plan.status,
        outcomeKey: plan.outcomeKey, reason: plan.reason,
        paid: !venuePays && value.escrow_account_id ? definition.template.price : 0,
        payout: plan.payout, refund: plan.refund, itemIds, settledAt: nowMs() };
      db.prepare('INSERT INTO town_service_settlements VALUES(?,?)').run(value.session_id, canonicalJson(receipt));
      // 熟客累计只是结算的派生权益：记录失败不能把一笔已完成结算改判失败。
      if (onConsumed && plan.status === 'completed' && definition.payer === 'player') {
        try {
          sync(onConsumed({ ...scopeInput(value), businessKey: definition.businessKey,
            serviceKey: definition.template.key, sessionId: value.session_id, playerActorId: value.actor_id,
            providerActorId: value.provider_actor_id, locationKey: config.locationKey, occurredAt: receipt.settledAt }));
        } catch (error) {
          console.error('[town.venue] regular record failed:', error?.message);
        }
      }
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
      const serviceKey = input.serviceKey ?? defaultServiceKey;
      if (typeof serviceKey !== 'string') throw townError('INVALID_SERVICE_KEY');
      const definition = byServiceKey(serviceKey);
      const supplied = sync(getVenue({ ...scopeInput(input), businessKey: definition.businessKey }));
      const config = { accountId: supplied?.accountId, stockId: supplied?.stockId, actorId: supplied?.actorId,
        locationKey: supplied?.locationKey, template: { ...definition.template } };
      Object.values(config).filter(v => typeof v !== 'object').forEach(requireText);
      qualified(input, config, definition, true);
      sync(economy.getAccount({ ...scopeInput(input), accountId: config.accountId }));
      sync(economy.getStock({ ...scopeInput(input), stockId: config.stockId }));
      const id = randomUUID(), time = nowMs();
      db.prepare(`INSERT INTO town_service_sessions(session_id,world_id,world_epoch,actor_id,provider_actor_id,status,phase,
        created_at,updated_at,offer_expires_at,config_json) VALUES(?,?,?,?,?,'offered',?,?,?,?,?)`)
        .run(id, input.worldId, input.worldEpoch, input.actorId, config.actorId, definition.playbook.phases[0].key,
          time, time, time + definition.template.offerMs, canonicalJson(config));
      return get({ ...input, sessionId: id });
    });
  }
  function accept(input) {
    return execute('accept', input, () => {
      let value = row(input); owner(input, value); version(input, value);
      if (value.status !== 'offered') throw townError('SESSION_STATE_CONFLICT');
      if (nowMs() >= value.offer_expires_at) throw townError('OFFER_EXPIRED');
      const config = JSON.parse(value.config_json), definition = resolveDefinition(config.template);
      qualified(input, config, definition, true);
      if (interruptWork) sync(interruptWork({ scope: scopeInput(value), providerActorId: value.provider_actor_id,
        playerActorId: value.actor_id, sessionId: value.session_id, locationKey: config.locationKey }));
      assertActionFree(value);
      const playerAccount = sync(economy.ensureAccount({ ...scopeInput(value), ownerKey: `actor:${value.actor_id}`,
        actorId: value.actor_id, accountType: 'actor' }));
      const venuePays = definition.payer === 'venue';
      const escrowSource = venuePays ? config.accountId : playerAccount.accountId;
      const escrowAmount = venuePays ? definition.template.wage : definition.template.price;
      // 零金额玩法（以工换物）不建托管账户，也不写一笔 0 元分录。
      const escrow = escrowAmount > 0
        ? sync(economy.ensureAccount({ ...scopeInput(value), ownerKey: `service:${value.session_id}`, accountType: 'escrow' }))
        : null;
      if (escrow) sync(economy.transfer({ ...command(value, 'escrow', definition), fromAccountId: escrowSource,
        toAccountId: escrow.accountId, amount: escrowAmount }));
      const material = sync(economy.reserveStock({ ...command(value, 'reserve', definition), stockId: config.stockId,
        amount: definition.template.materialQuantity, ownerRef: `service:${value.session_id}` })).reservation;
      config.playerAccountId = playerAccount.accountId;
      const time = nowMs();
      value = update(value, { status: 'active', escrow_account_id: escrow ? escrow.accountId : null, material_reservation_id: material.reservationId,
        updated_at: time, idle_at: time + definition.template.idleMs, deadline_at: time + definition.template.maxDurationMs,
        phase: definition.playbook.acceptPhase, config_json: canonicalJson(config) });
      return dto(value);
    });
  }
  function commitTurn(input, intentKey) {
    let value = row(input);
    if (value.status !== 'active') throw townError('SESSION_BUSY');
    const config = JSON.parse(value.config_json), definition = resolveDefinition(config.template);
    const playbook = definition.playbook;
    if (nowMs() >= value.idle_at || nowMs() >= value.deadline_at || value.turn_count >= definition.template.maxTurns) {
      return settle(freeze(value, 'expired', 'TIME_LIMIT'));
    }
    const firstPhase = playbook.phases[0].key, secondPhase = playbook.phases[1].key;
    let progressed = false, completed = false;
    if (intentKey === playbook.progressAction && value.phase === firstPhase) {
      value = update(value, { phase: secondPhase, updated_at: nowMs() }); progressed = true;
    }
    else if (intentKey === playbook.completeAction && value.phase === secondPhase) {
      const hold = sync(economy.getReservation({ ...scopeInput(value), reservationId: value.material_reservation_id }));
      if (!hold || hold.remaining !== definition.template.materialQuantity) return settle(freeze(value, 'failed', 'MATERIAL_UNAVAILABLE'));
      sync(economy.captureStock({ ...command(value, 'consume', definition), reservationId: hold.reservationId,
        expectedVersion: hold.version, consume: true }));
      value = update(value, { consumed: 1, crafted: 1, updated_at: nowMs() }); progressed = true; completed = true;
    }
    if (intentKey === playbook.noProgressAction) {
      const noProgress = value.no_progress + 1;
      value = update(value, { no_progress: noProgress, updated_at: nowMs() });
      if (noProgress >= 2) return settle(freeze(value, 'cancelled', 'NO_PROGRESS'));
      return dto(value);
    }
    if (completed) return settle(freeze(value, 'completed', definition.completeReason));
    if (!progressed) throw townError('INVALID_SERVICE_INTENT');
    return dto(value);
  }
  function turn(input) {
    requireText(input.clientTurnId);
    const probe = row(input);
    const definition = resolveDefinition(JSON.parse(probe.config_json).template);
    if (![...allActionsOf(definition), 'cancel'].includes(input.intentKey)) throw townError('INVALID_SERVICE_INTENT');
    if (input.intentKey === 'cancel') return cancel({ ...input, idempotencyKey: `${definition.commandPrefix}-turn-cancel:${input.sessionId}:${input.clientTurnId}` });
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
      const current = resolveDefinition(JSON.parse(value.config_json).template);
      if (!actionsOf(current, value.phase).includes(input.intentKey)) throw townError('INVALID_SERVICE_INTENT');
      qualified(input, JSON.parse(value.config_json), current);
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
      if (!isKnownTemplate(JSON.parse(value.config_json).template)) continue;
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
      .filter(value => isKnownTemplate(JSON.parse(value.config_json).template))
      .map(value => freeze(value, 'failed', 'WORLD_REBUILD'))).immediate();
    return values.map(settle);
  }
  function listCatalog(input) {
    epoch(input);
    try {
      const supplied = sync(getVenue({ ...scopeInput(input), businessKey: input.businessKey ?? defaultBusinessKey }));
      if (!supplied) return [];
      const serviceKeys = Array.isArray(supplied.services) ? supplied.services : [];
      return serviceKeys.map(key => byServiceKey(key).catalog);
    } catch (error) { if (['CAFE_NOT_CONFIGURED', 'VENUE_NOT_CONFIGURED'].includes(error.code)) return []; throw error; }
  }
  return { offer, accept, turn, cancel, get, list, listCatalog, recover, failForRebuild };
}
