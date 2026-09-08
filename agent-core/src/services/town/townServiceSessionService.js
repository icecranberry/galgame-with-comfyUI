import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';
import { buildTownServicePrompt, parseTownServiceResponse } from './townServicePrompt.js';

import { WORKSHOP_SERVICE, TOWN_SERVICE_DEFINITIONS, getTownServiceDefinition, resolveTownServiceDefinition } from './townServiceDefinitions.js';
import { createTownServiceUnlock } from './townServiceUnlock.js';
export { WORKSHOP_SERVICE } from './townServiceDefinitions.js';

const closed = new Set(['completed','cancelled','failed','expired']);
const actions = { theme: ['choose_theme','clarify','cancel'], materials: ['confirm_materials','clarify','cancel'],
  crafting: ['craft','clarify','cancel'], delivery: ['deliver','clarify','cancel'] };
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sync = value => { if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN'); return value; };

/**
 * Server-only commands. All injected writers MUST share db and be synchronous/transactional.
 * position must advance authoritative movement before hasArrived; never bind it to request XY.
 * getWorkshop(scope) => {accountId,stockId,actorId,locationKey}, from trusted business.getSlice.
 * interruptWork({scope,providerActorId,playerActorId,sessionId}) optionally cancels old M3 actions
 * on this SAME db synchronously. No memory mutation/broadcast: a later acceptance failure rolls it back.
 * generate({prompt,context,signal}) is optional expression generation, called outside transactions.
 */
export function createTownServiceSessionService({ db, clock, registry, economy, position, itemTemplates, getWorkshop, generate, interruptWork, consumers = [] }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor
      || !economy?.transfer || !position?.getLocation || !position?.hasArrived || !position?.isServiceOpen
      || !itemTemplates?.grant || !itemTemplates?.ensureDefaultTemplates || typeof getWorkshop !== 'function') {
    throw townError('MISSING_DEPENDENCY');
  }
  if (interruptWork !== undefined && typeof interruptWork !== 'function') throw townError('INVALID_INTERRUPT_ADAPTER');
  const now = () => {
    const time = sync(clock.now());
    if (!Number.isSafeInteger(time) || time < 0 || time > Number.MAX_SAFE_INTEGER - WORKSHOP_SERVICE.maxDurationMs) throw townError('INVALID_CLOCK');
    return time;
  };
  const unlocked = createTownServiceUnlock({ db, registry, clock: { now } });
  function requireUnlocked(input, definition) {
    if (definition.requiresProduction && !unlocked(scopeInput(input))) throw townError('SERVICE_LOCKED');
  }
  function listCatalog(input) {
    epoch(input);
    try { if (!sync(getWorkshop(scopeInput(input)))) return []; }
    catch (error) { if (error.code === 'SLICE_NOT_CONFIGURED') return []; throw error; }
    const bobAvailable = unlocked(scopeInput(input));
    return TOWN_SERVICE_DEFINITIONS.map(definition => ({ serviceKey: definition.serviceKey, name: definition.name,
      description: definition.description, price: definition.template.price,
      available: !definition.requiresProduction || bobAvailable,
      reason: definition.requiresProduction && !bobAvailable ? 'SERVICE_LOCKED' : null }));
  }
  const events = createTownEventService({ db,clock: { now },getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.service.settled': payload => payload && Object.keys(payload).sort().join(',') === 'outcomeKey,sessionId,settlementId,status'
      && typeof payload.sessionId === 'string' && payload.sessionId.length > 0 && payload.settlementId === payload.sessionId
      && closed.has(payload.status) && (payload.status === 'completed' ? TOWN_SERVICE_DEFINITIONS.some(d => d.outcomeKey === payload.outcomeKey) : payload.outcomeKey === payload.status) } });
  const scope = row => ({ worldId: row.world_id, worldEpoch: row.world_epoch });
  function epoch(input) {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
        || sync(registry.getWorldEpoch(input.worldId)) !== input.worldEpoch) throw townError('STALE_EPOCH');
  }
  function row(input) {
    epoch(input);
    const result = db.prepare('SELECT * FROM town_service_sessions WHERE session_id=? AND world_id=? AND world_epoch=?')
      .get(input.sessionId,input.worldId,input.worldEpoch);
    if (!result) throw townError('SESSION_NOT_FOUND');
    return result;
  }
  function actor(input, id, player = false) {
    const value = sync(registry.getActor(id,input.worldId));
    if (!value || value.actorId !== id || value.archived || value.mergedInto || !value.participating
        || (player ? value.playerId !== 'me' : !(value.npcExists || value.characterExists))) throw townError('ACTOR_UNAVAILABLE');
    return value;
  }
  function owner(input, value) {
    if (input.actorId !== value.actor_id) throw townError('SESSION_NOT_OWNED');
  }
  function version(input, value) {
    if (closed.has(value.status)) throw townError('SESSION_CLOSED');
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== value.version) throw townError('VERSION_CONFLICT');
  }
  function location(input, key) {
    const place = sync(position.getLocation({ ...input, locationKey: key }));
    if (!place || place.locationKey !== key) throw townError('LOCATION_UNAVAILABLE');
  }
  function arrived(input, actorId, locationKey) {
    location(scopeInput(input),locationKey);
    if (sync(position.hasArrived({ ...scopeInput(input), actorId, locationKey })) !== true) throw townError('NOT_ARRIVED');
  }
  const scopeInput = input => ({ worldId: input.worldId, worldEpoch: input.worldEpoch });
  function qualified(input, config, opening = false) {
    actor(input,input.actorId,true); actor(input,config.actorId);
    arrived(input,input.actorId,config.locationKey); arrived(input,config.actorId,config.locationKey);
    if (opening && sync(position.isServiceOpen({ ...scopeInput(input), actorId: config.actorId,
      locationKey: config.locationKey, serviceKey: resolveTownServiceDefinition(config).serviceKey })) !== true) throw townError('SERVICE_NOT_OPEN');
  }
  function dto(value) {
    const config = JSON.parse(value.config_json);
    const definition = resolveTownServiceDefinition(config);
    return { serviceKey: definition.serviceKey, serviceName: definition.name, serviceDescription: definition.description, sessionId: value.session_id, ...scope(value), actorId: value.actor_id, providerActorId: value.provider_actor_id,
      status: value.status, phaseKey: value.phase, version: value.version, turnCount: value.turn_count,
      materialsConsumed: !!value.consumed, crafted: !!value.crafted, offerExpiresAt: value.offer_expires_at,
      idleAt: value.idle_at, deadlineAt: value.deadline_at, leaseUntil: value.lease_until,
      template: config.template, locationKey: config.locationKey,
      choices: value.status === 'active' ? actions[value.phase] : [],
      dialogue: value.status === 'offered' ? '工坊服务收费30邻币；制作前取消全退，制作后收10退20；系统失败全退。'
        : value.status === 'active' ? definition.lines[value.phase] : '',
      settlement: JSON.parse(db.prepare('SELECT receipt_json FROM town_service_settlements WHERE session_id=?').get(value.session_id)?.receipt_json || 'null'),
      turns: db.prepare('SELECT client_turn_id,input_json,response_json FROM town_service_turns WHERE session_id=? ORDER BY rowid').all(value.session_id)
        .map(t => ({ clientTurnId: t.client_turn_id, input: JSON.parse(t.input_json), response: JSON.parse(t.response_json || 'null') })),
    };
  }
  function get(input) { const value = row(input); owner(input,value); return dto(value); }
  function list(input) {
    epoch(input); actor(input,input.actorId,true);
    return db.prepare('SELECT * FROM town_service_sessions WHERE world_id=? AND world_epoch=? AND actor_id=? ORDER BY created_at DESC LIMIT 100')
      .all(input.worldId,input.worldEpoch,input.actorId).map(dto);
  }
  /** Runtime movement/encounter exclusion. Offers do not occupy either actor. */
  function getBusyActorIds(input) {
    epoch(input);
    const rows = db.prepare(`SELECT actor_id,provider_actor_id FROM town_service_sessions
      WHERE world_id=? AND world_epoch=? AND escrow_account_id IS NOT NULL
        AND status IN ('active','resolving','settling')`).all(input.worldId,input.worldEpoch);
    return [...new Set(rows.flatMap(value => [value.actor_id,value.provider_actor_id]))].sort();
  }
  function isActorBusy(input) {
    requireText(input.actorId);
    return getBusyActorIds(input).includes(input.actorId);
  }
  function assertActionFree(value) {
    // M3 is optional for the isolated engine. If present, it is authoritative even when no adapter was supplied.
    const tableExists = name => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const ids = [value.provider_actor_id,value.actor_id];
    if (tableExists('town_actions') && db.prepare(`SELECT 1 FROM town_actions WHERE world_id=? AND world_epoch=?
      AND actor_id IN (?,?) AND status IN ('validated','reserved','running') LIMIT 1`)
      .get(value.world_id,value.world_epoch,...ids)) throw townError('SERVICE_ACTOR_BUSY');
    if (tableExists('town_resource_claims') && db.prepare(`SELECT 1 FROM town_resource_claims WHERE world_id=? AND world_epoch=?
      AND resource_key IN (?,?) AND lease_until>? LIMIT 1`)
      .get(value.world_id,value.world_epoch,...ids.map(id=>`actor:${id}`),now())) throw townError('SERVICE_ACTOR_BUSY');
  }
  function command(value, suffix) {
    const key = `service:${value.session_id}:${suffix}`;
    return { ...scope(value), idempotencyKey: key, sourceKey: key, reasonCode: 'SERVICE_OUTCOME' };
  }
  function execute(name, input, body) {
    return db.transaction(() => {
      epoch(input); requireText(input.idempotencyKey);
      const fingerprint = hash({ name,input });
      const old = db.prepare('SELECT * FROM town_service_requests WHERE world_id=? AND request_key=?').get(input.worldId,input.idempotencyKey);
      if (old) {
        if (old.request_hash !== fingerprint) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(old.response_json);
      }
      const result = body();
      epoch(input);
      db.prepare('INSERT INTO town_service_requests VALUES(?,?,?,?)').run(input.worldId,input.idempotencyKey,fingerprint,canonicalJson(result));
      return result;
    }).immediate();
  }
  function update(value, fields) {
    const columns = Object.keys(fields);
    const result = db.prepare(`UPDATE town_service_sessions SET ${columns.map(k => `${k}=?`).join(',')},version=version+1
      WHERE session_id=? AND version=? AND status=?`).run(...Object.values(fields),value.session_id,value.version,value.status);
    if (result.changes !== 1) throw townError('VERSION_CONFLICT');
    return row({ ...scope(value), sessionId: value.session_id });
  }
  function offer(input) {
    return execute('offer',input,() => {
      if (Object.hasOwn(input,'serviceKey') && typeof input.serviceKey !== 'string') throw townError('INVALID_SERVICE_KEY');
      const definition = getTownServiceDefinition(input.serviceKey);
      requireUnlocked(input,definition);
      const supplied = sync(getWorkshop(scopeInput(input)));
      const config = { accountId: supplied?.accountId, stockId: supplied?.stockId, actorId: supplied?.actorId,
        locationKey: supplied?.locationKey, template: { ...definition.template } };
      Object.values(config).filter(v => typeof v !== 'object').forEach(requireText);
      qualified(input,config,true);
      sync(economy.getAccount({ ...scopeInput(input), accountId: config.accountId }));
      sync(economy.getStock({ ...scopeInput(input), stockId: config.stockId }));
      const id = randomUUID(), time = now();
      db.prepare(`INSERT INTO town_service_sessions(session_id,world_id,world_epoch,actor_id,provider_actor_id,status,phase,
        created_at,updated_at,offer_expires_at,config_json) VALUES(?,?,?,?,?,'offered','theme',?,?,?,?)`)
        .run(id,input.worldId,input.worldEpoch,input.actorId,config.actorId,time,time,time+WORKSHOP_SERVICE.offerMs,canonicalJson(config));
      return get({ ...input,sessionId: id });
    });
  }
  function accept(input) {
    return execute('accept',input,() => {
      let value = row(input); owner(input,value); version(input,value);
      if (value.status !== 'offered') throw townError('SESSION_STATE_CONFLICT');
      if (now() >= value.offer_expires_at) throw townError('OFFER_EXPIRED');
      const config = JSON.parse(value.config_json);
      requireUnlocked(input,resolveTownServiceDefinition(config)); qualified(input,config,true);
      if (interruptWork) sync(interruptWork({ scope: scope(value),providerActorId: value.provider_actor_id,
        playerActorId: value.actor_id,sessionId: value.session_id }));
      assertActionFree(value);
      const definition = resolveTownServiceDefinition(config);
      if (typeof itemTemplates[definition.ensureTemplateMethod] !== 'function') throw townError('MISSING_DEPENDENCY');
      sync(itemTemplates[definition.ensureTemplateMethod](scope(value)));
      const playerAccount = sync(economy.ensureAccount({ ...scope(value), ownerKey: `actor:${value.actor_id}`,
        actorId: value.actor_id, accountType: 'actor' }));
      const escrow = sync(economy.ensureAccount({ ...scope(value), ownerKey: `service:${value.session_id}`, accountType: 'escrow' }));
      sync(economy.transfer({ ...command(value,'escrow'), fromAccountId: playerAccount.accountId, toAccountId: escrow.accountId, amount: 30 }));
      const material = sync(economy.reserveStock({ ...command(value,'reserve'), stockId: config.stockId,
        amount: 1, ownerRef: `service:${value.session_id}` })).reservation;
      config.playerAccountId = playerAccount.accountId;
      const time = now();
      value = update(value,{ status: 'active', escrow_account_id: escrow.accountId, material_reservation_id: material.reservationId,
        updated_at: time, idle_at: time+WORKSHOP_SERVICE.idleMs, deadline_at: time+WORKSHOP_SERVICE.maxDurationMs, config_json: canonicalJson(config) });
      return dto(value);
    });
  }
  function freeze(value, status, reason) {
    const paid = value.escrow_account_id !== null;
    const payout = !paid || status === 'failed' ? 0 : status === 'completed' ? 30 : value.consumed ? 10 : 0;
    if (value.pending_turn_id) {
      db.prepare('UPDATE town_service_turns SET response_json=COALESCE(response_json,?) WHERE session_id=? AND client_turn_id=?')
        .run(canonicalJson({ fallback: true,dialogue: '本次服务已进入结算。',reason }),value.session_id,value.pending_turn_id);
    }
    return update(value,{ status: 'settling', lease_token: null, lease_until: null,
      plan_json: canonicalJson({ status,reason,payout,refund: paid ? 30-payout : 0,
        outcomeKey: status === 'completed' ? resolveTownServiceDefinition(JSON.parse(value.config_json)).outcomeKey : status }) });
  }
  function settle(value) {
    const perform = () => db.transaction(() => {
      value = row({ ...scope(value),sessionId: value.session_id });
      if (closed.has(value.status)) return dto(value);
      if (value.status !== 'settling') throw townError('SESSION_STATE_CONFLICT');
      const plan = JSON.parse(value.plan_json), config = JSON.parse(value.config_json);
      let itemIds = [];
      if (plan.status === 'completed') {
        const definition = resolveTownServiceDefinition(config);
        if (plan.outcomeKey !== definition.outcomeKey) throw townError('INVALID_SERVICE_DEFINITION');
        actor(scope(value),value.provider_actor_id); location(scope(value),config.locationKey);
        if (!value.crafted || !value.consumed) throw townError('SERVICE_FACTS_INCOMPLETE');
        const sourceId = `service:${value.session_id}:outcome:${plan.outcomeKey}`;
        const grant = sync(itemTemplates.grant({ ...scope(value), templateId: definition.template.templateId, templateVersion: definition.template.templateVersion,
          ownerKey: 'me', quantity: 1, sourceType: 'service', sourceId, idempotencyKey: sourceId, reasonCode: 'SERVICE_OUTCOME' }));
        itemIds = Array.isArray(grant) ? grant : grant?.itemIds;
        if (!Array.isArray(itemIds) || itemIds.length !== 1 || !Number.isSafeInteger(itemIds[0])) throw townError('SERVICE_GRANT_INVALID');
      }
      if (value.material_reservation_id) {
        const reservation = sync(economy.getReservation({ ...scope(value),reservationId: value.material_reservation_id }));
        if (!reservation) throw townError('SERVICE_RESERVATION_LOST');
        if (reservation.remaining) sync(economy.releaseStock({ ...command(value,'release'), reservationId: reservation.reservationId, expectedVersion: reservation.version }));
      }
      if (plan.payout) sync(economy.transfer({ ...command(value,'payout'), fromAccountId: value.escrow_account_id, toAccountId: config.accountId, amount: plan.payout }));
      if (plan.refund) sync(economy.transfer({ ...command(value,'refund'), fromAccountId: value.escrow_account_id, toAccountId: config.playerAccountId, amount: plan.refund }));
      if (value.escrow_account_id && sync(economy.getAccount({ ...scope(value),accountId: value.escrow_account_id })).balance !== 0) throw townError('SERVICE_ESCROW_NOT_EMPTY');
      const eventId = `service:${value.session_id}:settled`;
      const receipt = { sessionId: value.session_id, settlementId: value.session_id, eventId, status: plan.status, outcomeKey: plan.outcomeKey,
        reason: plan.reason, paid: value.escrow_account_id ? 30 : 0, payout: plan.payout, refund: plan.refund, itemIds, settledAt: now() };
      db.prepare('INSERT INTO town_service_settlements VALUES(?,?)').run(value.session_id,canonicalJson(receipt));
      value = update(value,{ status: plan.status,updated_at: now(),pending_turn_id: null });
      events.append({ eventId,...scope(value),type: 'town.service.settled',occurredAt: receipt.settledAt,
        actorIds: [...new Set([value.actor_id,value.provider_actor_id])],locationKey: config.locationKey,
        source: { system: 'town.service',entityId: value.session_id },
        payload: { sessionId: value.session_id,status: plan.status,outcomeKey: plan.outcomeKey,settlementId: value.session_id } },consumers);
      return dto(value);
    }).immediate();
    try { return perform(); }
    catch (error) {
      // All grant/money/material writes rolled back. Convert undeliverable completion to full refund.
      // A failing refund itself remains settling and is retried by recover; never claim completion.
      const current = row({ ...scope(value),sessionId: value.session_id });
      if (current.status !== 'settling' || JSON.parse(current.plan_json).status !== 'completed') throw error;
      value = db.transaction(() => freeze(row({ ...scope(value),sessionId: value.session_id }),'failed','SYSTEM_DELIVERY_FAILURE')).immediate();
      return perform();
    }
  }
  function contextFor(value, input) {
    const definition = resolveTownServiceDefinition(JSON.parse(value.config_json));
    return { serviceKey: definition.serviceKey, serviceName: definition.name, serviceDescription: definition.description, speakerKey: value.provider_actor_id, phaseKey: value.phase,
      allowedIntents: actions[value.phase], allowedNextPhases: [value.phase],
      allowedOutcomes: value.crafted ? [definition.outcomeKey] : [],
      evidenceTurnIds: db.prepare('SELECT client_turn_id FROM town_service_turns WHERE session_id=?').all(value.session_id).map(r => r.client_turn_id),
      facts: { materialsConsumed: !!value.consumed, crafted: !!value.crafted },
      input: { intentKey: input.intentKey,text: input.text || '' } };
  }
  function commitTurn(input, token, response = null) {
    let value;
    try { value = db.transaction(() => {
      let current = row(input);
      if (current.status !== 'resolving' || current.lease_token !== token || now() >= current.lease_until) return null;
      const config = JSON.parse(current.config_json);
      const definition = resolveTownServiceDefinition(config);
      // Permanent actor/place loss is system failure; temporary closing is permitted for accepted sessions.
      try { actor(input,current.provider_actor_id); location(input,config.locationKey); }
      catch { return freeze(current,'failed','PROVIDER_UNAVAILABLE'); }
      try { arrived(input,current.provider_actor_id,config.locationKey); }
      catch { return freeze(current,'failed','PROVIDER_UNAVAILABLE'); }
      try { actor(input,current.actor_id,true); arrived(input,current.actor_id,config.locationKey); }
      catch { return freeze(current,'cancelled','PLAYER_LEFT'); }
      if (now() >= current.deadline_at || now() >= current.idle_at) return freeze(current,'expired','TIME_LIMIT');
      let phase = current.phase, progressed = false;
      if (input.intentKey === 'choose_theme' && phase === 'theme') { phase = 'materials'; progressed = true; }
      if (input.intentKey === 'confirm_materials' && phase === 'materials') {
        const r = sync(economy.getReservation({ ...scope(current),reservationId: current.material_reservation_id }));
        if (!r || r.remaining !== 1) return freeze(current,'failed','MATERIAL_UNAVAILABLE');
        sync(economy.captureStock({ ...command(current,'consume'),reservationId: r.reservationId,expectedVersion: r.version,consume: true }));
        current = update(current,{ consumed: 1 }); phase = 'crafting'; progressed = true;
      }
      if (input.intentKey === 'craft' && phase === 'crafting') { current = update(current,{ crafted: 1 }); phase = 'delivery'; progressed = true; }
      const noProgress = progressed ? 0 : current.no_progress+1;
      current = update(current,{ phase,status: 'active',no_progress: noProgress,updated_at: now(),idle_at: now()+WORKSHOP_SERVICE.idleMs,
        lease_token: null,lease_until: null,pending_turn_id: null });
      const complete = (input.intentKey === 'deliver' && current.crafted)
        || (response?.ending.decision === 'finish' && response.ending.outcomeKey === definition.outcomeKey && current.crafted);
      const expression = response || { narration: '',dialogue: definition.lines[phase],fallback: true };
      db.prepare('UPDATE town_service_turns SET response_json=? WHERE session_id=? AND client_turn_id=?')
        .run(canonicalJson(expression),current.session_id,input.clientTurnId);
      if (complete) return freeze(current,'completed','DELIVERED');
      if (current.turn_count >= 8) return freeze(current,current.crafted ? 'completed' : 'expired','MAX_TURNS');
      if (noProgress >= 2) return freeze(current,'cancelled','NO_PROGRESS');
      return current;
    }).immediate(); }
    catch (error) {
      if (['STALE_EPOCH','VERSION_CONFLICT','SESSION_CLOSED'].includes(error.code)) throw error;
      // Failed synchronous effects rolled back with the turn. Preserve the claim fence before refunding.
      value = db.transaction(() => {
        const current = row(input);
        if (current.status !== 'resolving' || current.lease_token !== token) return null;
        return freeze(current,'failed','SYSTEM_TURN_FAILURE');
      }).immediate();
    }
    if (!value) return get(input); // late output cannot mutate or revive a session
    return value.status === 'settling' ? settle(value) : dto(value);
  }
  async function turn(input) {
    requireText(input.clientTurnId);
    if (typeof input.intentKey !== 'string' || (input.text !== undefined && (typeof input.text !== 'string' || [...input.text].length > 500))) throw townError('INVALID_SERVICE_INPUT');
    if (input.intentKey === 'cancel') return cancel({ ...input,idempotencyKey: `turn-cancel:${input.sessionId}:${input.clientTurnId}` });
    const fingerprint = hash(input);
    const claim = db.transaction(() => {
      let value = row(input); owner(input,value);
      const previous = db.prepare('SELECT * FROM town_service_turns WHERE session_id=? AND client_turn_id=?').get(input.sessionId,input.clientTurnId);
      if (previous) {
        if (previous.request_hash !== fingerprint) throw townError('IDEMPOTENCY_CONFLICT');
        return { existing: dto(value) };
      }
      version(input,value);
      if (value.status !== 'active') throw townError('SESSION_BUSY');
      if (now() >= value.idle_at || now() >= value.deadline_at || value.turn_count >= 8) return { settling: freeze(value,'expired','TIME_LIMIT') };
      if (!actions[value.phase].includes(input.intentKey)) throw townError('INVALID_SERVICE_INTENT');
      qualified(input,JSON.parse(value.config_json));
      const token = randomUUID();
      db.prepare('INSERT INTO town_service_turns VALUES(?,?,?,?,NULL)').run(input.sessionId,input.clientTurnId,fingerprint,canonicalJson(input));
      value = update(value,{ status: 'resolving',lease_token: token,lease_until: now()+WORKSHOP_SERVICE.leaseMs,
        pending_turn_id: input.clientTurnId,turn_count: value.turn_count+1 });
      return { token,value,context: contextFor(value,input) };
    }).immediate();
    if (claim.existing) return claim.existing;
    if (claim.settling) return settle(claim.settling);
    let response = null;
    if (generate && claim.value.turn_count < WORKSHOP_SERVICE.maxTurns) {
      const controller = new AbortController(); let timer;
      try {
        const output = await Promise.race([
          Promise.resolve().then(() => generate({ prompt: buildTownServicePrompt(claim.context),context: structuredClone(claim.context),signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(townError('SERVICE_MODEL_TIMEOUT')),WORKSHOP_SERVICE.leaseMs); }),
        ]);
        response = parseTownServiceResponse(output,claim.context);
      } catch { /* zero corrections: invalid/unavailable model uses the complete local flow */ }
      finally { clearTimeout(timer); controller.abort(); }
    }
    if (now() >= claim.value.lease_until) { recover({ ...scopeInput(input) }); return get(input); }
    return commitTurn(input,claim.token,response);
  }
  function cancel(input) {
    // Freeze policy in the request transaction; settlement is separately retryable.
    const result = execute('cancel',input,() => {
      const value = row(input); owner(input,value);
      if (closed.has(value.status) || value.status === 'settling') return dto(value);
      version(input,value);
      return dto(freeze(value,'cancelled','USER_CANCELLED'));
    });
    const current = row({ ...input,sessionId: result.sessionId });
    return current.status === 'settling' ? settle(current) : dto(current);
  }
  /** Call before epoch increment / releasing economy reservations. Never expose as a user command. */
  function failForRebuild(input) {
    epoch(input);
    const values = db.transaction(() => db.prepare(`SELECT * FROM town_service_sessions WHERE world_id=? AND world_epoch=?
      AND status NOT IN ('completed','cancelled','failed','expired')`).all(input.worldId,input.worldEpoch)
      .map(value => freeze(value,'failed','WORLD_REBUILD'))).immediate();
    return values.map(settle);
  }
  function recover(input) {
    epoch(input);
    const results = [];
    const values = db.prepare(`SELECT session_id FROM town_service_sessions WHERE world_id=? AND world_epoch=?
      AND status NOT IN ('completed','cancelled','failed','expired')`).all(input.worldId,input.worldEpoch);
    for (const entry of values) {
      let value = row({ ...input,sessionId: entry.session_id });
      if (value.status === 'settling') { results.push(settle(value)); continue; }
      let reason = null, status = 'expired';
      const config = JSON.parse(value.config_json);
      try {
        actor(input,value.provider_actor_id); location(input,config.locationKey);
        if (value.escrow_account_id) arrived(input,value.provider_actor_id,config.locationKey);
      }
      catch { reason = 'PROVIDER_UNAVAILABLE'; status = 'failed'; }
      if (!reason && value.escrow_account_id) {
        try { actor(input,value.actor_id,true); arrived(input,value.actor_id,config.locationKey); }
        catch { reason = 'PLAYER_LEFT'; status = 'cancelled'; }
      }
      if (!reason && ((value.status === 'offered' && now() >= value.offer_expires_at)
          || (value.deadline_at !== null && (now() >= value.deadline_at || now() >= value.idle_at)))) reason = 'TIME_LIMIT';
      if (reason) {
        value = db.transaction(() => freeze(row({ ...input,sessionId: value.session_id }),status,reason)).immediate();
        results.push(settle(value)); continue;
      }
      if (value.status === 'resolving' && now() >= value.lease_until) {
        // Retire old token, finish the already accepted intent via local template, never call the model again.
        const original = JSON.parse(db.prepare('SELECT input_json FROM town_service_turns WHERE session_id=? AND client_turn_id=?')
          .get(value.session_id,value.pending_turn_id).input_json);
        const token = randomUUID();
        value = db.transaction(() => update(row({ ...input,sessionId: value.session_id }),{ lease_token: token,lease_until: now()+WORKSHOP_SERVICE.leaseMs })).immediate();
        results.push(commitTurn(original,token));
      }
    }
    return results;
  }
  return { offer,accept,get,list,listCatalog,turn,cancel,recover,failForRebuild,getBusyActorIds,isActorBusy };
}
