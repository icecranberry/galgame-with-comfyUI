import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';
import { getQuestTemplate, questTemplateList } from './townQuestDefinitions.js';

const closed = new Set(['completed', 'expired', 'abandoned']);
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sync = value => { if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN'); return value; };

/**
 * 奇遇任务引擎：offered→active→(按步骤推进)→completed/expired/abandoned。
 * 金币奖励走 reserve→capture 托管（accept 时从发布方账户预留，完成付给玩家，
 * 取消/过期原路释放），物品奖励走 itemTemplates.grant(sourceType 'reward')。
 * 步骤校验只在服务端：goto 到场、service 查正式结算回执、deliver 查背包并当场收走、wait 看时间。
 */
export function createTownQuestService({ db, clock, registry, economy, itemTemplates = null, position,
  observeTriggers, resolvePayer, resolveRegularTier = null, enabled = () => true, consumers = [],
  maxActiveQuests = 1, poolLimit = 3, offerGapMs = 10 * 60000 }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor
    || !economy?.reserve || !economy?.capture || !economy?.release
    || !position?.getLocation || !position?.hasArrived
    || typeof observeTriggers !== 'function' || typeof resolvePayer !== 'function'
    || typeof enabled !== 'function') throw townError('MISSING_DEPENDENCY');
  const now = () => {
    const value = sync(clock.now());
    if (!Number.isSafeInteger(value) || value < 0) throw townError('INVALID_CLOCK');
    return value;
  };
  const events = createTownEventService({ db, clock: { now }, getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.quest.changed': payload => !!payload && typeof payload.questId === 'string'
      && ['offered', 'active', 'completed', 'expired', 'abandoned'].includes(payload.status)
      && Number.isSafeInteger(payload.currentStep) } });
  const epoch = input => {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
      || sync(registry.getWorldEpoch(input.worldId)) !== input.worldEpoch) throw townError('STALE_EPOCH');
  };
  const scopeOf = value => ({ worldId: value.world_id, worldEpoch: value.world_epoch });
  const row = input => {
    epoch(input);
    const value = db.prepare('SELECT * FROM town_quests WHERE quest_id=? AND world_id=? AND world_epoch=?')
      .get(input.questId, input.worldId, input.worldEpoch);
    if (!value) throw townError('QUEST_NOT_FOUND');
    return value;
  };
  const playerActor = input => {
    const value = sync(registry.getActor(input.actorId, input.worldId));
    if (!value || value.actorId !== input.actorId || value.playerId !== 'me'
      || value.archived || value.mergedInto || !value.participating) throw townError('ACTOR_UNAVAILABLE');
    return value;
  };
  function execute(name, input, body) {
    return db.transaction(() => {
      epoch(input); requireText(input.idempotencyKey);
      const fingerprint = hash({ name, input });
      const old = db.prepare('SELECT request_hash,response FROM town_quest_requests WHERE world_id=? AND request_key=?')
        .get(input.worldId, input.idempotencyKey);
      if (old) {
        if (old.request_hash !== fingerprint) throw townError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(old.response);
      }
      const result = body();
      epoch(input);
      db.prepare('INSERT INTO town_quest_requests VALUES(?,?,?,?)').run(input.worldId, input.idempotencyKey, fingerprint,
        canonicalJson(JSON.parse(JSON.stringify(result))));
      return result;
    }).immediate();
  }
  function update(previous, fields) {
    const columns = Object.keys(fields);
    const result = db.prepare(`UPDATE town_quests SET ${columns.map(k => `${k}=?`).join(',')},version=version+1
      WHERE quest_id=? AND version=? AND status=?`).run(...Object.values(fields), previous.quest_id, previous.version, previous.status);
    if (result.changes !== 1) throw townError('VERSION_CONFLICT');
    return db.prepare('SELECT * FROM town_quests WHERE quest_id=?').get(previous.quest_id);
  }
  /** 每次状态迁移写一条领域事件 + 不可变日志；事件 id 以版本号收口，天然幂等。 */
  function announce(value, phase, extra = {}) {
    const config = JSON.parse(value.config);
    const time = now();
    const eventId = `quest:${value.quest_id}:${value.version}`;
    const payload = { questId: value.quest_id, templateId: value.template_id,
      status: value.status, version: value.version, currentStep: value.current_step };
    events.append({ eventId, ...scopeOf(value), type: 'town.quest.changed', occurredAt: time,
      actorIds: [...new Set([value.actor_id, value.offering_actor_id].filter(Boolean))],
      locationKey: value.location_key ?? null,
      source: { system: 'town.quest', entityId: value.quest_id }, payload }, consumers);
    db.prepare(`INSERT INTO town_quest_log(world_id,world_epoch,quest_id,actor_id,event_id,phase,occurred_at,result)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(value.world_id, value.world_epoch, value.quest_id, value.actor_id, eventId, phase, time,
        canonicalJson({ ...payload, ...extra, occurredAt: time }));
    return value;
  }
  function transition(previous, fields, phase, extra = {}) {
    return announce(update(previous, { ...fields, updated_at: now() }), phase, extra);
  }
  /** 模板快照与注册表逐字节比对：任何漂移都按未知模板处理，绝不静默升级。 */
  function templateOf(value) {
    const config = JSON.parse(value.config);
    const current = getQuestTemplate(value.template_id);
    return { config, known: !!current && canonicalJson(current) === canonicalJson(config) };
  }
  function dto(value) {
    const { config, known } = templateOf(value);
    const steps = (config.steps ?? []).map((step, index) => ({ key: step.key, type: step.type,
      label: step.label, hint: step.hint ?? '', locationKey: step.locationKey ?? null,
      done: index < value.current_step, current: value.status === 'active' && index === value.current_step }));
    const items = (config.rewards?.items ?? []).map(item => ({ ...item,
      name: itemTemplates?.getTemplate?.({ ...scopeOf(value), templateId: item.templateId,
        templateVersion: item.templateVersion })?.name ?? item.templateId }));
    return { questId: value.quest_id, ...scopeOf(value), templateId: value.template_id, known,
      title: config.title, intro: config.intro, status: value.status, version: value.version,
      currentStep: value.current_step, steps, rewards: { coins: config.rewards?.coins ?? 0, items },
      trigger: config.trigger, payerType: config.payer?.type ?? null, locationKey: value.location_key ?? null,
      offeringActorId: value.offering_actor_id ?? null,
      offeredAt: value.offered_at, offerExpiresAt: value.offer_expires_at, acceptedAt: value.accepted_at,
      deadlineAt: value.deadline_at, closedAt: value.closed_at, repeatable: !!config.repeatable };
  }
  const command = (value, suffix, reasonCode) => ({ ...scopeOf(value),
    idempotencyKey: `${value.quest_id}:${suffix}`, sourceKey: `${value.quest_id}:${suffix}`,
    reasonCode: reasonCode ?? 'QUEST_OUTCOME' });
  function playerAccountId(value) {
    return sync(economy.ensureAccount({ ...scopeOf(value), ownerKey: `actor:${value.actor_id}`,
      actorId: value.actor_id, accountType: 'actor' })).accountId;
  }
  function releaseReward(value) {
    if (!value.money_reservation_id) return;
    const hold = sync(economy.getReservation({ ...scopeOf(value), reservationId: value.money_reservation_id }));
    if (hold && hold.remaining > 0) sync(economy.release({ ...command(value, `release:${hold.version}`, 'QUEST_REWARD_RELEASED'),
      reservationId: hold.reservationId, expectedVersion: hold.version }));
  }
  const deliverableRows = db.prepare(`SELECT id,version FROM backpack_items WHERE world_id=? AND owner_key='me' AND template_id=? AND template_version=?
    AND status='ready' AND retired_at IS NULL AND locked_by IS NULL AND collected_at IS NOT NULL
    AND id NOT IN (SELECT item_id FROM item_effects) ORDER BY id LIMIT ?`);
  const deliverableCount = (scope, step) => db.prepare(`SELECT count(*) n FROM backpack_items WHERE world_id=? AND owner_key='me' AND template_id=? AND template_version=?
    AND status='ready' AND retired_at IS NULL AND locked_by IS NULL AND collected_at IS NOT NULL
    AND id NOT IN (SELECT item_id FROM item_effects)`).get(scope.worldId, step.templateId, step.templateVersion ?? 1).n;
  function consumeDelivery(value, step) {
    if (!itemTemplates?.retire) throw townError('ITEM_TEMPLATES_REQUIRED');
    const scope = scopeOf(value);
    const count = step.count ?? 1;
    const items = deliverableRows.all(scope.worldId, step.templateId, step.templateVersion ?? 1, count);
    if (items.length < count) throw townError('INSUFFICIENT_STOCK');
    for (const item of items) {
      sync(itemTemplates.retire({ ...scope, ownerKey: 'me', itemId: item.id, expectedVersion: item.version,
        idempotencyKey: `quest-deliver:${value.quest_id}:${step.key}:${item.id}`,
        sourceKey: `quest-deliver:${value.quest_id}:${step.key}:${item.id}`, reasonCode: 'QUEST_DELIVERY' }));
    }
  }
  const arrivedAt = (value, locationKey) => {
    const place = sync(position.getLocation({ ...scopeOf(value), locationKey }));
    if (!place || place.locationKey !== locationKey) return false;
    return sync(position.hasArrived({ ...scopeOf(value), actorId: value.actor_id, locationKey })) === true;
  };
  function stepSatisfied(value, step) {
    if (step.type === 'goto') return arrivedAt(value, step.locationKey);
    if (step.type === 'deliver') {
      if (step.locationKey && !arrivedAt(value, step.locationKey)) return false;
      return deliverableCount(scopeOf(value), step) >= (step.count ?? 1);
    }
    if (step.type === 'wait') return now() >= (value.accepted_at ?? 0) + (step.waitMs ?? 0);
    if (step.type === 'service') {
      return !!db.prepare(`SELECT 1 FROM town_service_sessions s JOIN town_service_settlements r USING(session_id)
        WHERE s.world_id=? AND s.world_epoch=? AND s.actor_id=? AND s.status='completed'
        AND json_extract(s.config_json,'$.template.key')=?
        AND json_extract(r.receipt_json,'$.status')='completed'
        AND json_extract(r.receipt_json,'$.settledAt')>=? LIMIT 1`)
        .get(value.world_id, value.world_epoch, value.actor_id, step.serviceKey, value.accepted_at ?? 0);
    }
    return false;
  }
  function complete(value) {
    const config = JSON.parse(value.config);
    const coins = config.rewards?.coins ?? 0;
    if (coins > 0) {
      const hold = sync(economy.getReservation({ ...scopeOf(value), reservationId: value.money_reservation_id }));
      if (!hold || hold.remaining < coins) throw townError('QUEST_REWARD_UNAVAILABLE');
      sync(economy.capture({ ...command(value, `capture:${hold.version}`), reservationId: hold.reservationId,
        expectedVersion: hold.version, toAccountId: playerAccountId(value), amount: coins }));
    }
    const itemIds = [];
    for (const item of config.rewards?.items ?? []) {
      if (!itemTemplates?.grant) throw townError('ITEM_TEMPLATES_REQUIRED');
      const sourceId = `quest:${value.quest_id}:reward:${item.templateId}`;
      const grant = sync(itemTemplates.grant({ ...scopeOf(value), templateId: item.templateId,
        templateVersion: item.templateVersion, ownerKey: 'me', quantity: item.count ?? 1,
        sourceType: 'reward', sourceId, idempotencyKey: sourceId, reasonCode: 'QUEST_REWARD' }));
      itemIds.push(...(Array.isArray(grant) ? grant : grant?.itemIds ?? []));
    }
    return dto(transition(value, { status: 'completed', closed_at: now() }, 'completed', { itemIds }));
  }
  /** 步骤推进主循环：条件满足就连跳（上限防死循环），最后一步完成即结算发奖。 */
  function advanceInTx(input) {
    let value = row(input);
    if (closed.has(value.status) || value.status === 'offered') return dto(value);
    const { config, known } = templateOf(value);
    if (!known) {
      releaseReward(value);
      return dto(transition(value, { status: 'expired', closed_at: now() }, 'expired', { reason: 'TEMPLATE_RETIRED' }));
    }
    for (let guard = 0; value.current_step < config.steps.length && guard < 8; guard++) {
      const step = config.steps[value.current_step];
      if (!stepSatisfied(value, step)) break;
      if (step.type === 'deliver') consumeDelivery(value, step);
      value = transition(value, { current_step: value.current_step + 1 }, 'step', { stepKey: step.key });
    }
    if (value.current_step >= config.steps.length) return complete(value);
    return dto(value);
  }
  function canOffer(input, template, time) {
    if (db.prepare(`SELECT 1 FROM town_quests WHERE world_id=? AND world_epoch=? AND template_id=?
        AND status IN ('offered','active') LIMIT 1`).get(input.worldId, input.worldEpoch, template.id)) return false;
    const last = db.prepare(`SELECT status,closed_at FROM town_quests WHERE world_id=? AND world_epoch=? AND template_id=?
      AND status IN ('completed','expired','abandoned') ORDER BY closed_at DESC LIMIT 1`).get(input.worldId, input.worldEpoch, template.id);
    if (!template.repeatable && last?.status === 'completed') return false;
    if (last?.closed_at != null && time - last.closed_at < (template.cooldownMs ?? 0)) return false;
    return true;
  }
  function createOffer(input, template, trigger) {
    const time = now();
    const id = randomUUID();
    // 维护循环等内部路径可以不带 actorId，此时按服务端解析的玩家落账。
    const actorId = input.actorId ?? sync(registry.resolveAgentKey('me')).actorId;
    db.prepare(`INSERT INTO town_quests(quest_id,world_id,world_epoch,template_id,template_version,actor_id,status,version,
        current_step,location_key,offering_actor_id,offered_at,offer_expires_at,updated_at,config)
      VALUES(?,?,?,?,?,?,'offered',1,0,?,?,?,?,?,?)`)
      .run(id, input.worldId, input.worldEpoch, template.id, template.version, actorId,
        trigger.locationKey ?? null, trigger.actorId ?? null, time, time + template.offerMs, time, canonicalJson(template));
    return dto(announce(db.prepare('SELECT * FROM town_quests WHERE quest_id=?').get(id), 'offered'));
  }
  /** 模板候选：按天轮换起点，让同一触发点不同日子遇到不同奇遇。 */
  const rotateByDay = () => {
    const all = questTemplateList();
    const offset = Math.floor(now() / 86400000) % all.length;
    return [...all.slice(offset), ...all.slice(0, offset)];
  };
  /** 熟客档位任务只在玩家于该店达到对应档位时可见。 */
  const tierAllows = (input, trigger, template) => {
    if (template.minRegularTier == null) return true;
    if (trigger.type !== 'venue' || typeof resolveRegularTier !== 'function') return false;
    return sync(resolveRegularTier(input, trigger)) >= template.minRegularTier;
  };
  function rollOffers(input) {
    if (sync(enabled()) !== true) return [];
    epoch(input);
    const time = now();
    if (db.prepare(`SELECT count(*) n FROM town_quests WHERE world_id=? AND world_epoch=? AND status='active'`)
      .get(input.worldId, input.worldEpoch).n >= maxActiveQuests) return [];
    const pool = db.prepare(`SELECT count(*) n FROM town_quests WHERE world_id=? AND world_epoch=? AND status='offered'`)
      .get(input.worldId, input.worldEpoch).n;
    if (pool >= poolLimit) return [];
    if (db.prepare(`SELECT count(*) n FROM town_quests WHERE world_id=? AND world_epoch=?
        AND status IN ('offered','active') AND offered_at>?`).get(input.worldId, input.worldEpoch, time - offerGapMs).n > 0) return [];
    const created = [];
    for (const trigger of sync(observeTriggers(input))) {
      if (pool + created.length >= poolLimit) break;
      for (const template of rotateByDay()) {
        if (template.trigger.type !== trigger.type) continue;
        if (template.trigger.type === 'venue' && template.trigger.key !== (trigger.key ?? null)) continue;
        if (template.trigger.type === 'npc' && Array.isArray(trigger.questTemplateIds)
          && !trigger.questTemplateIds.includes(template.id)) continue;
        if (!tierAllows(input, trigger, template)) continue;
        if (!canOffer(input, template, time)) continue;
        created.push(createOffer(input, template, trigger));
        break;
      }
    }
    return created;
  }
  /** 维护：过期清理（报价过期/期限过期）→ 自动推进（到场/结算/等待到点都会自己走）→ 奇遇上架。 */
  function maintain(input) {
    epoch(input);
    const time = now();
    const changed = [];
    for (const value of db.prepare(`SELECT * FROM town_quests WHERE world_id=? AND world_epoch=?
        AND status='offered' AND offer_expires_at<=?`).all(input.worldId, input.worldEpoch, time)) {
      changed.push(dto(db.transaction(() => transition(value,
        { status: 'expired', closed_at: time }, 'expired', { reason: 'OFFER_EXPIRED' })).immediate()));
    }
    for (const value of db.prepare(`SELECT * FROM town_quests WHERE world_id=? AND world_epoch=?
        AND status='active' AND deadline_at IS NOT NULL AND deadline_at<=?`).all(input.worldId, input.worldEpoch, time)) {
      changed.push(dto(db.transaction(() => {
        releaseReward(value);
        return transition(value, { status: 'expired', closed_at: time }, 'expired', { reason: 'DEADLINE_EXPIRED' });
      }).immediate()));
    }
    for (const value of db.prepare(`SELECT * FROM town_quests WHERE world_id=? AND world_epoch=? AND status='active'`)
      .all(input.worldId, input.worldEpoch)) {
      const advanced = db.transaction(() => advanceInTx({ ...input, questId: value.quest_id })).immediate();
      if (advanced.currentStep !== value.current_step || advanced.status !== value.status) changed.push(advanced);
    }
    let offered = [];
    try { offered = db.transaction(() => rollOffers(input)).immediate(); }
    catch (error) { if (!['VENUE_NOT_CONFIGURED', 'SLICE_NOT_CONFIGURED', 'CAFE_NOT_CONFIGURED'].includes(error.code)) throw error; }
    return { changed, offered };
  }
  function offerFromTrigger(input, trigger) {
    return execute('offerFromTrigger', input, () => {
      if (sync(enabled()) !== true) throw townError('QUESTS_DISABLED');
      if (!trigger || !['board', 'venue', 'npc'].includes(trigger.type)) throw townError('INVALID_QUEST_TRIGGER');
      const time = now();
      if (db.prepare(`SELECT count(*) n FROM town_quests WHERE world_id=? AND world_epoch=? AND actor_id=? AND status='active'`)
        .get(input.worldId, input.worldEpoch, input.actorId).n >= maxActiveQuests) throw townError('QUEST_ACTIVE_LIMIT');
      if (db.prepare(`SELECT count(*) n FROM town_quests WHERE world_id=? AND world_epoch=? AND status='offered'`)
        .get(input.worldId, input.worldEpoch).n >= poolLimit) throw townError('QUEST_POOL_LIMIT');
      for (const template of rotateByDay()) {
        if (template.trigger.type !== trigger.type) continue;
        if (template.trigger.type === 'venue' && template.trigger.key !== (trigger.key ?? null)) continue;
        if (template.trigger.type === 'npc' && Array.isArray(trigger.questTemplateIds)
          && !trigger.questTemplateIds.includes(template.id)) continue;
        if (!tierAllows(input, trigger, template)) continue;
        if (!canOffer(input, template, time)) continue;
        return createOffer(input, template, trigger);
      }
      throw townError('NO_QUEST_AVAILABLE');
    });
  }
  function accept(input) {
    return execute('accept', input, () => {
      const value = row(input);
      if (value.actor_id !== input.actorId) throw townError('QUEST_NOT_OWNED');
      playerActor(input);
      if (value.status !== 'offered') throw townError('QUEST_STATE_CONFLICT');
      if (now() >= value.offer_expires_at) throw townError('OFFER_EXPIRED');
      const { config, known } = templateOf(value);
      if (!known) throw townError('INVALID_QUEST_TEMPLATE');
      if (db.prepare(`SELECT count(*) n FROM town_quests WHERE world_id=? AND world_epoch=? AND actor_id=? AND status='active'`)
        .get(value.world_id, value.world_epoch, value.actor_id).n >= maxActiveQuests) throw townError('QUEST_ACTIVE_LIMIT');
      const coins = config.rewards?.coins ?? 0;
      let reservationId = null, payerAccountId = null;
      if (coins > 0) {
        const payer = sync(resolvePayer({ ...scopeOf(value), actorId: value.actor_id }, config.payer));
        requireText(payer.accountId);
        sync(economy.getAccount({ ...scopeOf(value), accountId: payer.accountId }));
        payerAccountId = payer.accountId;
        reservationId = sync(economy.reserve({ ...scopeOf(value), accountId: payer.accountId, amount: coins,
          ownerRef: `quest:${value.quest_id}`, idempotencyKey: `quest-reserve:${value.quest_id}`,
          sourceKey: `quest-reserve:${value.quest_id}`, reasonCode: 'QUEST_REWARD_RESERVE' })).reservation.reservationId;
      } else if ((config.rewards?.items ?? []).length && !itemTemplates?.grant) throw townError('ITEM_TEMPLATES_REQUIRED');
      const time = now();
      return dto(transition(value, { status: 'active', accepted_at: time, deadline_at: time + config.deadlineMs,
        payer_account_id: payerAccountId, money_reservation_id: reservationId }, 'accepted'));
    });
  }
  function abandon(input) {
    return execute('abandon', input, () => {
      const value = row(input);
      if (value.actor_id !== input.actorId) throw townError('QUEST_NOT_OWNED');
      if (closed.has(value.status)) return dto(value);
      if (value.status !== 'active') throw townError('QUEST_STATE_CONFLICT');
      releaseReward(value);
      return dto(transition(value, { status: 'abandoned', closed_at: now() }, 'abandoned', { reason: 'USER_ABANDONED' }));
    });
  }
  const progress = input => execute('progress', input, () => advanceInTx(input));
  const get = input => { const value = row(input); if (value.actor_id !== input.actorId) throw townError('QUEST_NOT_OWNED'); return dto(value); };
  function list(input) {
    epoch(input);
    const rows = db.prepare(`SELECT * FROM town_quests WHERE world_id=? AND world_epoch=? AND actor_id=?
      ORDER BY offered_at DESC, quest_id`).all(input.worldId, input.worldEpoch, input.actorId);
    const quests = rows.filter(value => templateOf(value).known).map(dto);
    return { offered: quests.filter(q => q.status === 'offered'),
      active: quests.filter(q => q.status === 'active'),
      closed: quests.filter(q => closed.has(q.status)).slice(0, 20) };
  }
  function cancelForRebuild(input) {
    epoch(input);
    return db.transaction(() => {
      const results = [];
      for (const value of db.prepare(`SELECT * FROM town_quests WHERE world_id=? AND world_epoch=? AND status IN ('offered','active')`)
        .all(input.worldId, input.worldEpoch)) {
        try { releaseReward(value); } catch (error) { if (error.code !== 'STALE_RESERVATION') throw error; }
        results.push(dto(transition(value, { status: 'abandoned', closed_at: now() }, 'abandoned', { reason: 'WORLD_REBUILD' })));
      }
      return results;
    }).immediate();
  }
  return { offer: offerFromTrigger, accept, abandon, progress, maintain, list, get, cancelForRebuild };
}
