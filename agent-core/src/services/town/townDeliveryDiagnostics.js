import { createTownEventService, canonicalJson } from './townEventService.js';

const CONSUMERS = Object.freeze({ 'town.experience': '经历记录', 'town.appointment': '回访预约' });
const MESSAGES = Object.freeze({
  STALE_EPOCH: '小镇已更新，请刷新后重试', INVALID_PAGE: '分页参数无效',
  INVALID_REQUEST: '请求参数无效', CONSUMER_NOT_ALLOWED: '不支持此投递类型',
  DELIVERY_NOT_FOUND: '投递记录不存在', DELIVERY_ACTIVE: '投递正在等待或处理中',
  DELIVERY_DONE: '投递已完成，不能重放', IDEMPOTENCY_CONFLICT: '请求标识已用于其他操作',
  DELIVERY_UNAVAILABLE: '暂时无法读取或重试投递',
});
const SAFE_ERRORS = new Set(['APPOINTMENT_SOURCE_INVALID', 'CANDIDATE_EXPIRED', 'EXPERIENCE_SOURCE_INVALID',
  'PROVIDER_NOT_LINKED', 'ACTOR_UNAVAILABLE', 'LOCATION_UNAVAILABLE', 'PLAYER_UNAVAILABLE',
  'APPOINTMENT_NOT_OWNED', 'LEASE_RETRIES_EXHAUSTED', 'LEASE_LOST', 'STALE_EPOCH', 'MEMORY_DISABLED']);
const SOURCE_TYPES = new Set(['town.service.settled', 'town.service.completed', 'town.delivery.changed',
  'town.item.changed', 'town.action.completed', 'town.production.completed']);
const error = code => Object.assign(new Error(MESSAGES[code]), { code, status:
  ['INVALID_PAGE','INVALID_REQUEST','CONSUMER_NOT_ALLOWED'].includes(code) ? 400 : code === 'DELIVERY_NOT_FOUND' ? 404 : 409 });

/** Explicit startup migration; factory and list never create tables. */
export function migrateTownDeliveryDiagnosticsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_delivery_retry_requests (
    world_id TEXT NOT NULL, world_epoch INTEGER NOT NULL, request_key TEXT NOT NULL,
    payload TEXT NOT NULL, response TEXT NOT NULL,
    PRIMARY KEY(world_id,world_epoch,request_key)
  )`);
}

/** Synchronous diagnostics only. Requeue preserves event identity and never consumes it.
 * list({scope,cursor:null|{seq,consumerKey},limit:20}) => {items,nextCursor}
 * requeue({scope,eventId,consumerKey,idempotencyKey?}) => {eventId,consumerKey,status:'pending',requeued:true}
 * Optional key defaults to event+consumer; use a fresh explicit key for a later dead-letter cycle.
 * A recorded key always replays its original response, even after processing/completion;
 * this response describes the original requeue, not the current delivery status. Refresh list for that.
 */
export function createTownDeliveryDiagnostics({ db, clock, registry }) {
  if (!db?.transaction || typeof clock?.now !== 'function' || typeof registry?.getWorldEpoch !== 'function') throw error('INVALID_REQUEST');
  const queue = createTownEventService({ db, clock, getWorldEpoch: registry.getWorldEpoch });
  function guard(scope) {
    if (typeof scope?.worldId !== 'string' || !scope.worldId.length || !Number.isSafeInteger(scope.worldEpoch)
      || scope.worldEpoch < 1 || registry.getWorldEpoch(scope.worldId) !== scope.worldEpoch) throw error('STALE_EPOCH');
  }
  function safe(run) {
    try { return run(); } catch (caught) { throw error(Object.hasOwn(MESSAGES, caught.code) ? caught.code : 'DELIVERY_UNAVAILABLE'); }
  }
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  function summary(row) {
    let occurredAt = null;
    try { const value = JSON.parse(row.envelope)?.occurredAt; if (Number.isSafeInteger(value) && value >= 0) occurredAt = value; } catch {}
    return { eventId: row.event_id, consumerKey: row.consumer_key, consumerName: CONSUMERS[row.consumer_key],
      status: row.status, attempts: row.attempts, nextRetryAt: row.status === 'pending' ? row.next_attempt_at : null,
      lastErrorCode: row.last_error ? SAFE_ERRORS.has(row.last_error) ? row.last_error : 'DELIVERY_FAILED' : null,
      sourceType: SOURCE_TYPES.has(row.type) ? row.type : 'town.other', occurredAt };
  }
  function list({ scope, cursor = null, limit = 20 }) {
    return safe(() => {
      guard(scope);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== null
        && (!Number.isSafeInteger(cursor?.seq) || cursor.seq < 1 || !Object.hasOwn(CONSUMERS,cursor.consumerKey)))) throw error('INVALID_PAGE');
      const rows = db.prepare(`SELECT e.seq,e.type,e.envelope,d.* FROM town_event_deliveries d
        JOIN town_domain_events e USING(event_id) WHERE e.world_id=? AND e.world_epoch=?
        AND d.consumer_key IN ('town.experience','town.appointment') AND d.status IN ('dead','pending','processing')
        AND (e.seq>? OR (e.seq=? AND d.consumer_key>?)) ORDER BY e.seq,d.consumer_key LIMIT ?`)
        .all(scope.worldId,scope.worldEpoch,cursor?.seq ?? 0,cursor?.seq ?? 0,cursor?.consumerKey ?? '',limit+1);
      const page=rows.slice(0,limit),last=page.at(-1);
      return {items:page.map(summary),nextCursor:rows.length>limit ? {seq:last.seq,consumerKey:last.consumer_key} : null};
    });
  }
  function requeue({ scope, eventId, consumerKey, idempotencyKey }) {
    return safe(() => db.transaction(() => {
      guard(scope);
      if (!Object.hasOwn(CONSUMERS,consumerKey)) throw error('CONSUMER_NOT_ALLOWED');
      if (!text(eventId) || (idempotencyKey !== undefined && !text(idempotencyKey))) throw error('INVALID_REQUEST');
      const key=idempotencyKey === undefined ? `auto:${canonicalJson([eventId,consumerKey])}` : `key:${idempotencyKey}`;
      const payload=canonicalJson({eventId,consumerKey});
      const row=db.prepare(`SELECT d.status FROM town_event_deliveries d JOIN town_domain_events e USING(event_id)
        WHERE e.world_id=? AND e.world_epoch=? AND d.event_id=? AND d.consumer_key=?`)
        .get(scope.worldId,scope.worldEpoch,eventId,consumerKey);
      if (!row) throw error('DELIVERY_NOT_FOUND');
      const prior=db.prepare('SELECT payload,response FROM town_delivery_retry_requests WHERE world_id=? AND world_epoch=? AND request_key=?')
        .get(scope.worldId,scope.worldEpoch,key);
      if (prior) {
        if (prior.payload !== payload) throw error('IDEMPOTENCY_CONFLICT');
        return JSON.parse(prior.response);
      }
      if (row.status === 'done') throw error('DELIVERY_DONE');
      if (row.status === 'processing') throw error('DELIVERY_ACTIVE');
      if (row.status !== 'dead') throw error('DELIVERY_ACTIVE');
      queue.requeue({...scope,eventId,consumerKey});
      const result={eventId,consumerKey,status:'pending',requeued:true};
      db.prepare('INSERT INTO town_delivery_retry_requests VALUES(?,?,?,?,?)').run(scope.worldId,scope.worldEpoch,key,payload,canonicalJson(result));
      return result;
    }).immediate());
  }
  return {list,requeue};
}
