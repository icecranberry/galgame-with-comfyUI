import { createHash } from 'node:crypto';
import { canonicalJson, townError } from './townEventService.js';

/** 持久化对话邀请。模型只选择目录 key；钱、物、地点、对象都来自服务端目录。 */
export function createTownInteractionService({ db, clock, registry, catalog, assertPresent, execute }) {
  const row = id => db.prepare('SELECT * FROM town_interaction_offers WHERE request_id=?').get(id);
  function check(input, value = null) {
    if (registry.getWorldEpoch(input.worldId) !== input.worldEpoch) throw townError('STALE_EPOCH');
    if (value && (value.world_id !== input.worldId || value.world_epoch !== input.worldEpoch
      || value.player_actor_id !== input.playerActorId || value.actor_id !== input.actorId
      || value.source_key !== (input.sourceKey || ''))) throw townError('REQUEST_NOT_FOUND');
  }
  const dto = value => value && ({ requestId: value.request_id, status: value.status === 'offered' && value.expires_at <= clock.now()
    ? 'expired' : value.status, ...JSON.parse(value.spec_json), expiresAt: value.expires_at,
    eventId: value.event_id, updatedAt: value.updated_at, result: value.result_json ? JSON.parse(value.result_json) : null });
  function list(input) {
    check(input);
    return db.prepare(`SELECT * FROM town_interaction_offers WHERE world_id=? AND world_epoch=? AND actor_id=?
      AND player_actor_id=? AND source_key=? ORDER BY created_at DESC LIMIT 12`)
      .all(input.worldId, input.worldEpoch, input.actorId, input.playerActorId, input.sourceKey || '').map(dto);
  }
  function offer(input, key) {
    return db.transaction(() => {
      check(input); assertPresent(input);
      const spec = catalog(input).find(item => item.key === key);
      if (!spec) throw townError('REQUEST_UNAVAILABLE');
      // 同一个人、同一项请求每天最多一份；重复问话不会刷出无限收购、剧情或礼物。
      const day = Math.floor((clock.now() + 8 * 3600000) / 86400000);
      const requestId = createHash('sha256').update(canonicalJson({ ...input, key, day })).digest('hex');
      const existing = row(requestId);
      if (existing) {
        // An unaccepted invitation may be quoted again after its catalogue changes.
        // Never overwrite a generating request or a settled receipt.
        if (existing.status === 'offered' && canonicalJson(spec) !== canonicalJson(JSON.parse(existing.spec_json))) {
          db.prepare('UPDATE town_interaction_offers SET spec_json=?,expires_at=?,updated_at=? WHERE request_id=?')
            .run(canonicalJson(spec), clock.now() + 30 * 60000, clock.now(), requestId);
          return dto(row(requestId));
        }
        return dto(existing);
      }
      db.prepare(`INSERT INTO town_interaction_offers(request_id,world_id,world_epoch,actor_id,player_actor_id,
        kind,character_id,status,spec_json,created_at,expires_at,updated_at,source_key) VALUES(?,?,?,?,?,?,?,'offered',?,?,?,?,?)`)
        .run(requestId, input.worldId, input.worldEpoch, input.actorId, input.playerActorId, spec.kind,
          spec.characterId ?? null, canonicalJson(spec), clock.now(), clock.now() + 30 * 60000, clock.now(), input.sourceKey || '');
      return dto(row(requestId));
    }).immediate();
  }
  function finish(input, requestId, result, eventId = null) {
    check(input, row(requestId));
    db.prepare("UPDATE town_interaction_offers SET status='accepted',result_json=?,event_id=?,updated_at=? WHERE request_id=?")
      .run(canonicalJson(result), eventId, clock.now(), requestId);
    return dto(row(requestId));
  }
  function respond(input, requestId, decision) {
    return db.transaction(() => {
      const value = row(requestId);
      if (!value) throw townError('REQUEST_NOT_FOUND');
      check(input, value);
      if (!['accept', 'decline'].includes(decision)) throw townError('INVALID_REQUEST_DECISION');
      if (['accepted', 'declined', 'generating'].includes(value.status)) return dto(value);
      if (value.expires_at <= clock.now()) throw townError('REQUEST_EXPIRED');
      if (decision === 'decline') {
        db.prepare("UPDATE town_interaction_offers SET status='declined',updated_at=? WHERE request_id=?").run(clock.now(), requestId);
        return dto(row(requestId));
      }
      assertPresent(input);
      const spec = JSON.parse(value.spec_json);
      const current = catalog(input).find(item => item.key === spec.key);
      if (!current || canonicalJson(current) !== canonicalJson(spec)) throw townError('REQUEST_UNAVAILABLE');
      if (spec.kind === 'service' && !spec.npcId && !spec.characterId) throw townError('REQUEST_UNAVAILABLE');
      if (spec.kind === 'story' || spec.kind === 'service') {
        // 镇民奇遇（特殊奇遇与店里能办什么）：同一镇民同时只允许一条生成中/活跃奇遇（actor_id 即该镇民）。
        // 角色奇遇（characterId）：沿用 character_id 维度的占用检查。
        const busy = spec.npcId
          ? db.prepare(`SELECT 1 FROM town_interaction_offers WHERE kind IN ('story','service') AND status='generating'
              AND actor_id=? AND world_id=? AND world_epoch=? AND request_id<>?`)
              .get(value.actor_id, value.world_id, value.world_epoch, value.request_id)
            || db.prepare('SELECT 1 FROM town_npc_events WHERE npc_id=? AND status IN (\'open\',\'engaged\')').get(spec.npcId)
          : db.prepare("SELECT 1 FROM town_interaction_offers WHERE character_id=? AND status='generating'").get(spec.characterId);
        if (busy) throw townError('STORY_BUSY');
        db.prepare("UPDATE town_interaction_offers SET status='generating',updated_at=? WHERE request_id=?").run(clock.now(), requestId);
        return { ...dto(row(requestId)), startGeneration: true };
      }
      // 交易、发放和邀请确认同一事务，掉线重试直接返回收据。
      return finish(input, requestId, execute(input, spec, requestId));
    }).immediate();
  }
  return { list, offer, respond, finish, check, get: requestId => dto(row(requestId)) };
}
