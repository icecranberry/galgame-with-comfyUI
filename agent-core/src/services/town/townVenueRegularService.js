import { createTownEventService, requireText, townError } from './townEventService.js';
import { venueRegularProfile, venueRegularProfiles } from './townVenuePlaybooks.js';

/** 熟客（常客）系统：只做「正常消费累计 → 解锁主题内容」，不发钱、不发道具，
 * 避免把持续花钱变成无限亲密度或铸币漏洞。所有功能建筑（含冻结的咖啡馆）
 * 共用同一口径：一笔已正式结算的玩家付费服务算一次到访。
 *
 * record 由功能建筑引擎在结算事务内调用；同一 session 重复结算只计一次。
 * 跨过阈值时追加 town.venue.regular 事件，由既有经历消费者写成角色记忆。
 */
export function createTownVenueRegularService({ db, clock, registry, consumers = [] }) {
  if (!db?.transaction || typeof clock?.now !== 'function' || typeof registry?.getWorldEpoch !== 'function') {
    throw townError('MISSING_DEPENDENCY');
  }
  const events = createTownEventService({ db, clock, getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.venue.regular': payload => {
      if (!payload || typeof payload.businessKey !== 'string' || payload.businessKey.length === 0) return false;
      if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) return false;
      if (!Number.isSafeInteger(payload.tier) || payload.tier < 1) return false;
      if (!Number.isSafeInteger(payload.visits) || payload.visits < 1) return false;
      return typeof payload.topic === 'string' && payload.topic.length > 0 && payload.topic.length <= 256;
    } } });
  function nowMs() {
    const value = clock.now();
    if (!Number.isSafeInteger(value) || value < 0) throw townError('INVALID_CLOCK');
    return value;
  }
  function epoch(input) {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
        || registry.getWorldEpoch(input.worldId) !== input.worldEpoch) throw townError('STALE_EPOCH');
  }
  const rowOf = input => db.prepare(`SELECT * FROM town_venue_regulars WHERE world_id=? AND world_epoch=?
    AND business_key=? AND player_actor_id=?`).get(input.worldId, input.worldEpoch, input.businessKey, input.playerActorId);
  function tierAt(profile, visits) { return profile.tiers.reduce((n, tier) => visits >= tier.visits ? n + 1 : n, 0); }
  function dto(profile, value) {
    const visits = value?.visits ?? 0, tier = value?.tier ?? 0;
    const next = profile.tiers.find(item => item.visits > visits) || null;
    return { businessKey: profile.businessKey, displayName: profile.displayName, label: profile.label,
      visits, tier, nextTierAt: next?.visits ?? null,
      topic: tier > 0 ? profile.tiers[tier - 1].topic : null,
      unlockedAt: value?.unlocked_at ?? null, lastVisitAt: value?.last_visit_at ?? null };
  }
  /** 记一次消费到访。未知建筑或非消费结算由调用方过滤；这里再兜底返回 null。 */
  function record(input) {
    const profile = venueRegularProfile(input.businessKey);
    if (!profile) return null;
    requireText(input.playerActorId);
    requireText(input.sessionId);
    return db.transaction(() => {
      epoch(input);
      const time = Number.isSafeInteger(input.occurredAt) && input.occurredAt >= 0 ? input.occurredAt : nowMs();
      const seen = db.prepare(`SELECT 1 FROM town_venue_regular_visits WHERE world_id=? AND world_epoch=? AND session_id=?`)
        .get(input.worldId, input.worldEpoch, input.sessionId);
      if (seen) return dto(profile, rowOf(input));
      db.prepare('INSERT INTO town_venue_regular_visits VALUES(?,?,?,?,?,?)')
        .run(input.worldId, input.worldEpoch, input.sessionId, input.businessKey, input.playerActorId, time);
      const current = rowOf(input), visits = (current?.visits ?? 0) + 1;
      const tier = tierAt(profile, visits);
      const unlocked = tier > (current?.tier ?? 0);
      const unlockedAt = unlocked ? time : (current?.unlocked_at ?? null);
      if (current) {
        db.prepare(`UPDATE town_venue_regulars SET visits=?, tier=?, last_visit_at=?, unlocked_at=?, updated_at=?
          WHERE world_id=? AND world_epoch=? AND business_key=? AND player_actor_id=?`)
          .run(visits, tier, time, unlockedAt, time, input.worldId, input.worldEpoch, input.businessKey, input.playerActorId);
      } else {
        db.prepare(`INSERT INTO town_venue_regulars
          (world_id,world_epoch,business_key,player_actor_id,visits,tier,first_visit_at,last_visit_at,unlocked_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(input.worldId, input.worldEpoch, input.businessKey, input.playerActorId,
            visits, tier, time, time, unlockedAt, time);
      }
      const result = dto(profile, rowOf(input));
      if (unlocked) {
        const eventId = `venue-regular:${input.worldId}:${input.worldEpoch}:${input.businessKey}:${input.playerActorId}:${tier}`;
        events.append({ eventId, worldId: input.worldId, worldEpoch: input.worldEpoch, type: 'town.venue.regular',
          occurredAt: time, actorIds: [...new Set([input.playerActorId, input.providerActorId].filter(Boolean))],
          locationKey: input.locationKey ?? null, source: { system: 'town.venue', entityId: input.sessionId },
          payload: { businessKey: input.businessKey, sessionId: input.sessionId, tier, visits, topic: result.topic } }, consumers);
      }
      return result;
    }).immediate();
  }
  function get(input) {
    epoch(input);
    const profile = venueRegularProfile(input.businessKey);
    if (!profile) throw townError('INVALID_BUSINESS_KEY');
    return dto(profile, rowOf(input));
  }
  function list(input) {
    epoch(input);
    requireText(input.playerActorId);
    return venueRegularProfiles().map(profile => dto(profile, rowOf({ ...input, businessKey: profile.businessKey })));
  }
  return { record, get, list };
}