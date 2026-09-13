import { createTownEventService, townError } from './townEventService.js';
import { createTownClock } from './townClock.js';

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
    if (event.type === 'town.gift.given') return giftFacts(event);
    if (event.type === 'town.encounter.happened') return encounterFacts(event);
    return null;
  }

  function giftFacts(event) {
    const payload = event.payload || {};
    const item = db.prepare(`SELECT id, template_id, name, source_id, owner_key FROM backpack_items
      WHERE id = ? AND world_id = ? AND source_type = 'reward'`).get(payload.itemId, event.worldId);
    if (!item || item.source_id !== payload.sourceId || item.owner_key !== 'me'
      || item.template_id !== payload.templateId
      || event.source?.system !== 'town.npc.functions' || event.source.entityId !== payload.sourceId) throw townError('EXPERIENCE_SOURCE_INVALID');
    const npcActor = sync(registry.getActor(payload.npcActorId, event.worldId, { followMerged: false }));
    if (!npcActor || npcActor.actorId !== payload.npcActorId) throw townError('EXPERIENCE_SOURCE_INVALID');
    const npcName = npcActor.npcExists
      ? db.prepare('SELECT display_name FROM town_npcs WHERE id = ?').get(npcActor.npcId)?.display_name || '邻居' : '邻居';
    return { actorIds: [...new Set([payload.npcActorId])],
      summary: `${npcName}送了玩家一份「${item.name}」的小心意。`, locationKey: event.locationKey ?? null };
  }

  /** 相遇经历：只有已收尾且摘要落库的 town_encounters 行授权一条经历；参与人就是事件的 actorIds。 */
  function encounterFacts(event) {
    const payload = event.payload || {};
    if (!Number.isSafeInteger(payload.encounterId) || typeof payload.summary !== 'string'
      || !payload.summary.trim() || payload.summary.length > 200
      || !Array.isArray(event.actorIds) || event.actorIds.length !== 2
      || new Set(event.actorIds).size !== 2) throw townError('EXPERIENCE_SOURCE_INVALID');
    const row = db.prepare('SELECT id, summary, status FROM town_encounters WHERE id = ?').get(payload.encounterId);
    if (!row || row.status !== 'done' || row.summary !== payload.summary) throw townError('EXPERIENCE_SOURCE_INVALID');
    const names = event.actorIds.map(actorId => {
      const actor = sync(registry.getActor(actorId, event.worldId, { followMerged: false }));
      if (!actor || actor.actorId !== actorId || actor.archived || actor.mergedInto) throw townError('EXPERIENCE_SOURCE_INVALID');
      if (actor.npcExists) {
        return db.prepare('SELECT display_name FROM town_npcs WHERE id = ?').get(actor.npcId)?.display_name || '邻居';
      }
      if (actor.characterExists) {
        return db.prepare('SELECT display_name FROM characters WHERE id = ?').get(actor.characterId)?.display_name || '邻居';
      }
      throw townError('EXPERIENCE_SOURCE_INVALID');
    });
    const location = event.locationKey
      ? db.prepare('SELECT name FROM town_locations WHERE key = ?').get(event.locationKey)?.name || '小镇' : '小镇';
    return { actorIds: event.actorIds,
      summary: `${names[0]}和${names[1]}在${location}聊了会儿：${payload.summary.slice(0, 80)}`,
      locationKey: event.locationKey ?? null };
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
            judgment: `${localDate}，${source.summary}`, reasoning: `已入账的小镇经历；来源 ${event.eventId}`,
            tags: ['小镇', '共同经历', source.locationKey || '小镇'] } }] });
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
