import { createTownEventService, townError } from './townEventService.js';
import { createTownClock } from './townClock.js';
import { resolveTownServiceDefinition } from './townServiceDefinitions.js';
import { getVenueServiceSpec, venueRegularProfile, venueServiceTemplate } from './townVenuePlaybooks.js';

export const TOWN_EXPERIENCE_CONSUMER = 'town.experience';

/** Only settled, durable source rows authorize an experience. Event prose/amounts never do. */
export function createTownExperienceService({ db, clock, registry, writeMemory, memoryEnabled = () => false, timeZone = 'Asia/Shanghai' }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor ||
      typeof memoryEnabled !== 'function' || (writeMemory != null && typeof writeMemory !== 'function')) throw townError('MISSING_DEPENDENCY');
  const sync = value => { if (value?.then) throw townError('ASYNC_EFFECT_FORBIDDEN'); return value; };
  const events = createTownEventService({ db, clock, getWorldEpoch: registry.getWorldEpoch });
  const calendar = createTownClock({ timeZone });
  function facts(event) {
    if (event.presentationOnly || event.visibility === 'public') return null;
    if (event.type === 'town.delivery.changed' && event.payload?.status === 'completed') {
      const row = db.prepare(`SELECT * FROM town_delivery_orders WHERE order_id = ? AND world_id = ?
        AND world_epoch = ? AND status = 'completed'`).get(event.payload.orderId, event.worldId, event.worldEpoch);
      if (!row || row.version !== event.payload.version || event.eventId !== `delivery:${row.order_id}:${row.version}` ||
          event.source?.system !== 'town.delivery' || event.source.entityId !== row.order_id) throw townError('EXPERIENCE_SOURCE_INVALID');
      const log = db.prepare(`SELECT occurred_at FROM town_business_log WHERE event_id=? AND order_id=?
        AND world_id=? AND world_epoch=? AND phase='completed'`).get(event.eventId,row.order_id,event.worldId,event.worldEpoch);
      if (!log || log.occurred_at !== event.occurredAt) throw townError('EXPERIENCE_SOURCE_INVALID');
      const config = JSON.parse(row.config);
      return { actorIds: [row.actor_id, config.npcActorIds.workshop],
        summary: '玩家将领取的原料送到了工坊，配送已经交付并完成结算。', locationKey: config.locationKeys.workshop };
    }
    if (event.type === 'town.venue.regular') {
      const payload = event.payload || {};
      const profile = venueRegularProfile(payload.businessKey);
      const tier = profile?.tiers[payload.tier - 1];
      if (!profile || !tier || payload.topic !== tier.topic) throw townError('EXPERIENCE_SOURCE_INVALID');
      const visit = db.prepare(`SELECT * FROM town_venue_regular_visits WHERE world_id=? AND world_epoch=? AND session_id=?`)
        .get(event.worldId, event.worldEpoch, payload.sessionId);
      const session = db.prepare(`SELECT * FROM town_service_sessions WHERE session_id=? AND world_id=?
        AND world_epoch=? AND status='completed'`).get(payload.sessionId, event.worldId, event.worldEpoch);
      if (!visit || !session || visit.business_key !== payload.businessKey
          || event.source?.system !== 'town.venue' || event.source.entityId !== payload.sessionId
          || event.locationKey !== JSON.parse(session.config_json).locationKey) throw townError('EXPERIENCE_SOURCE_INVALID');
      const regular = db.prepare(`SELECT * FROM town_venue_regulars WHERE world_id=? AND world_epoch=?
        AND business_key=? AND player_actor_id=?`)
        .get(event.worldId, event.worldEpoch, payload.businessKey, session.actor_id);
      if (!regular || regular.tier < payload.tier || regular.visits < payload.visits) throw townError('EXPERIENCE_SOURCE_INVALID');
      return { actorIds: [session.actor_id, session.provider_actor_id],
        summary: `玩家常来${profile.displayName}，已经成了这里的熟客。${tier.topic}`,
        locationKey: event.locationKey };
    }
    if (['town.service.completed', 'town.service.settled'].includes(event.type)) {
      if (event.payload?.status !== 'completed') return null;
      const row = db.prepare(`SELECT s.*, r.receipt_json FROM town_service_sessions s
        JOIN town_service_settlements r USING(session_id) WHERE s.session_id = ?
        AND s.world_id = ? AND s.world_epoch = ? AND s.status = 'completed'`)
        .get(event.payload?.sessionId, event.worldId, event.worldEpoch);
      if (!row) return null;
      const receipt = JSON.parse(row.receipt_json);
      const config = JSON.parse(row.config_json);
      if (config.template?.key === 'town.cafe.work_shift') {
        if (receipt.status !== 'completed' || !Array.isArray(receipt.itemIds) || receipt.itemIds.length !== 0
          || receipt.eventId !== event.eventId || event.eventId !== `service:${row.session_id}:settled`
          || receipt.sessionId !== row.session_id || receipt.settlementId !== event.payload.settlementId
          || receipt.settlementId !== row.session_id || receipt.outcomeKey !== 'cafe_shift_done'
          || receipt.outcomeKey !== event.payload.outcomeKey || receipt.paid !== 0 || receipt.payout !== 24 || receipt.refund !== 0
          || receipt.settledAt !== event.occurredAt || event.source?.system !== 'town.service' || event.source.entityId !== row.session_id
          || config.template.version !== 1 || !row.consumed || !row.crafted) throw townError('EXPERIENCE_SOURCE_INVALID');
        return { actorIds: [row.actor_id, row.provider_actor_id],
          summary: '玩家在镇咖啡馆完成了一班临时代班，工资已经结算。', locationKey: config.locationKey };
      }
      if (config.template?.key === 'town.cafe.drink_coffee') {
        if (receipt.status !== 'completed' || !Array.isArray(receipt.itemIds) || receipt.itemIds.length !== 0
          || receipt.eventId !== event.eventId || event.eventId !== `service:${row.session_id}:settled`
          || receipt.sessionId !== row.session_id || receipt.settlementId !== event.payload.settlementId
          || receipt.settlementId !== row.session_id || receipt.outcomeKey !== 'coffee_served'
          || receipt.outcomeKey !== event.payload.outcomeKey || receipt.paid !== 18 || receipt.payout !== 18 || receipt.refund !== 0
          || receipt.settledAt !== event.occurredAt || event.source?.system !== 'town.service' || event.source.entityId !== row.session_id
          || config.template.version !== 1 || !row.consumed || !row.crafted) throw townError('EXPERIENCE_SOURCE_INVALID');
        return { actorIds: [row.actor_id, row.provider_actor_id],
          summary: '玩家在镇咖啡馆喝到了一杯手冲咖啡，服务已经正式结算。', locationKey: config.locationKey };
      }
      // 通用功能建筑：咖啡馆之外的所有店铺共用同一份回执校验口径。
      const venueSpec = getVenueServiceSpec(config.template?.key);
      if (venueSpec) {
        const template = venueServiceTemplate(venueSpec.service);
        if (receipt.status !== 'completed' || receipt.eventId !== event.eventId
            || event.eventId !== `service:${row.session_id}:settled` || receipt.sessionId !== row.session_id
            || receipt.settlementId !== event.payload.settlementId || receipt.settlementId !== row.session_id
            || receipt.outcomeKey !== event.payload.outcomeKey || receipt.outcomeKey !== template.outcomeKey
            || receipt.settledAt !== event.occurredAt || event.source?.system !== 'town.service'
            || event.source.entityId !== row.session_id || config.template.version !== 1
            || !row.consumed || !row.crafted) throw townError('EXPERIENCE_SOURCE_INVALID');
        const venuePays = venueSpec.playbook.payer === 'venue';
        if (venuePays ? (receipt.paid !== 0 || receipt.payout !== template.wage || receipt.refund !== 0)
          : (receipt.paid !== template.price || receipt.payout !== template.price || receipt.refund !== 0)) {
          throw townError('EXPERIENCE_SOURCE_INVALID');
        }
        if (venueSpec.service.product) {
          if (!Array.isArray(receipt.itemIds) || receipt.itemIds.length !== 1
              || !Number.isSafeInteger(receipt.itemIds[0])) throw townError('EXPERIENCE_SOURCE_INVALID');
          const granted = db.prepare(`SELECT id FROM backpack_items WHERE id=? AND world_id=? AND source_type='service'
            AND source_id=? AND template_id=? AND template_version=? AND effect_key=?`)
            .get(receipt.itemIds[0], event.worldId, `service:${row.session_id}:outcome:${receipt.outcomeKey}`,
              venueSpec.service.product.templateId, venueSpec.service.product.templateVersion,
              venueSpec.service.product.effectKey);
          if (!granted) throw townError('EXPERIENCE_SOURCE_INVALID');
        } else if (!Array.isArray(receipt.itemIds) || receipt.itemIds.length !== 0) {
          throw townError('EXPERIENCE_SOURCE_INVALID');
        }
        return { actorIds: [row.actor_id, row.provider_actor_id],
          summary: `玩家在${venueSpec.kind.displayName}完成了「${venueSpec.service.name}」，服务已经正式结算。`,
          locationKey: config.locationKey };
      }
      let definition;
      try { definition = resolveTownServiceDefinition(config); }
      catch { throw townError('EXPERIENCE_SOURCE_INVALID'); }
      if (receipt.status !== 'completed' || receipt.itemIds?.length !== 1 || !Number.isSafeInteger(receipt.itemIds[0]) ||
          receipt.eventId !== event.eventId || event.eventId !== `service:${row.session_id}:settled` ||
          receipt.sessionId !== row.session_id || receipt.settlementId !== event.payload.settlementId ||
          receipt.settlementId !== row.session_id || receipt.outcomeKey !== event.payload.outcomeKey ||
          receipt.outcomeKey !== definition.outcomeKey || receipt.paid !== 30 || receipt.payout !== 30 || receipt.refund !== 0 ||
          receipt.settledAt !== event.occurredAt || event.source?.system !== 'town.service' || event.source.entityId !== row.session_id ||
          !row.consumed || !row.crafted) throw townError('EXPERIENCE_SOURCE_INVALID');
      const granted = db.prepare(`SELECT id FROM backpack_items WHERE id=? AND world_id=? AND source_type='service'
        AND source_id=? AND template_id=? AND template_version=? AND effect_key=?`)
        .get(receipt.itemIds[0],event.worldId,`service:${row.session_id}:outcome:${receipt.outcomeKey}`,
          definition.template.templateId,definition.template.templateVersion,
          definition.outcomeKey === 'bob_cut' ? 'bob_cut' : 'mood_fix');
      if (!granted) throw townError('EXPERIENCE_SOURCE_INVALID');
      return { actorIds: [row.actor_id, row.provider_actor_id],
        summary: definition.outcomeKey === 'bob_cut' ? '玩家在工坊获得了一张发型卡，服务已经结算。'
          : '玩家在工坊完成了制作体验，收下了一枚心情修复贴，服务已经结算。',
        locationKey: config.locationKey };
    }
    return null;
  }
  function consume(event) {
    const source = facts(event);
    if (!source) return;
    const date = new Date(event.occurredAt).toISOString().slice(0, 10);
    const localDate = calendar.at(event.occurredAt).date;
    for (const actorId of [...new Set(source.actorIds)].slice(0, 3)) {
      if (!event.actorIds.includes(actorId)) throw townError('EXPERIENCE_PARTICIPANT_INVALID');
      if (db.prepare('SELECT 1 FROM town_experiences WHERE event_id = ? AND actor_id = ?').get(event.eventId, actorId)) continue;
      const actor = sync(registry.getActor(actorId, event.worldId, { followMerged: false }));
      if (!actor || actor.actorId !== actorId || actor.archived || actor.mergedInto) continue;
      const dayStart = Date.parse(`${date}T00:00:00Z`);
      const count = db.prepare(`SELECT count(*) n FROM town_experiences WHERE world_id = ? AND actor_id = ?
        AND occurred_at >= ? AND occurred_at < ?`).get(event.worldId, actorId, dayStart, dayStart + 86400000).n;
      if (count >= 12) continue;
      let memoryIds = [];
      if (actor.characterExists && sync(memoryEnabled()) === true && writeMemory) {
        if (writeMemory.constructor.name === 'AsyncFunction') throw townError('ASYNC_EFFECT_FORBIDDEN');
        const result = writeMemory({ conversationId: `char_${actor.characterId}`, dedupeKey: event.eventId,
          sourceRawStartId: null, sourceRawEndId: null, sourceMessageId: null,
          actions: [{ action: 'create', memory: { memoryType: 'event', subject: 'relationship',
            judgment: `${localDate}，${source.summary}`, reasoning: `已结算的小镇经历；来源 ${event.eventId}`,
            tags: ['小镇', '共同经历', source.locationKey || '工坊'] } }] });
        if (result?.then) throw townError('ASYNC_EFFECT_FORBIDDEN');
        memoryIds = (result || []).map(item => item.memoryId ?? item.memory_id).filter(Boolean);
      }
      db.prepare(`INSERT INTO town_experiences(event_id, actor_id, world_id, world_epoch,
        occurred_at, summary, character_id, memory_ids) VALUES(?,?,?,?,?,?,?,?)`)
        .run(event.eventId, actorId, event.worldId, event.worldEpoch, event.occurredAt,
          source.summary, actor.characterExists ? actor.characterId : null, JSON.stringify(memoryIds));
    }
  }
  function drain(scope, limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw townError('INVALID_PAGE');
    let processed = 0;
    for (; processed < limit; processed++) {
      const claim = events.claim({ ...scope, consumerKey: TOWN_EXPERIENCE_CONSUMER });
      if (!claim) break;
      try { events.consume(claim, consume); }
      catch (error) { events.retry(claim, error.code || error.message); }
    }
    return processed;
  }
  return { drain };
}
