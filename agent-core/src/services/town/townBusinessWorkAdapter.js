import { assertUtcMs, createTownClock, isInTimeWindow } from './townClock.js';
import { requireText, townError } from './townEventService.js';

export const BUSINESS_WORK_HOURS = Object.freeze({ timeZone: 'Asia/Shanghai', startMinute: 540, endMinute: 1080 });
const places = Object.freeze({ commissioner: 'board', supplier: 'supplier', workshop: 'workshop' });
const sync = value => {
  if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN');
  return value;
};

/** Read-only M3 bridge, no DB singleton, timers, money or movement side effects.
 * getSlice({worldId,worldEpoch}) is business.getSlice; absent setup is a no-op.
 * getActorPosition(actorId) returns the authoritative townService position DTO.
 * getLocation({worldId,worldEpoch,locationKey}) returns {locationKey} or null.
 * readActiveService(context) returns null, or the durable exclusive service:
 * {sessionId,worldId,worldEpoch,actorId,locationKey,phase:'running',leaseUntilUtcMs}.
 * Expired leases and stale-world sessions cannot pin a resident indefinitely.
 * All dependencies are synchronous. Pass context.nowUtcMs to reuse M3's batch
 * instant; otherwise clock.now() is sampled once. Service ownership is supplied
 * by its own lifecycle, never guessed from dialogue or an untrusted client flag.
 */
export function createTownBusinessWorkAdapter({ clock, registry, getSlice, getActorPosition, getLocation,
  readActiveService = () => null } = {}) {
  if (!clock?.now || !registry?.getWorldEpoch || !registry?.getActor || typeof getSlice !== 'function'
      || typeof getActorPosition !== 'function' || typeof getLocation !== 'function' || typeof readActiveService !== 'function') {
    throw townError('MISSING_DEPENDENCY');
  }
  const calendar = createTownClock({ timeZone: BUSINESS_WORK_HOURS.timeZone });
  function context(input) {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
        || registry.getWorldEpoch(input.worldId) !== input.worldEpoch) throw townError('STALE_EPOCH');
    return { worldId: input.worldId, worldEpoch: input.worldEpoch, nowUtcMs: assertUtcMs(input.nowUtcMs ?? clock.now()) };
  }
  function slice(ctx) {
    try { return sync(getSlice({ worldId: ctx.worldId, worldEpoch: ctx.worldEpoch })); }
    catch (error) { if (error.code === 'SLICE_NOT_CONFIGURED') return null; throw error; }
  }
  function inspect(actorId, ctx, config) {
    const role = Object.keys(places).find(key => config?.npcActorIds?.[key] === actorId);
    if (!role) return null;
    const locationKey = config.locationKeys?.[places[role]];
    requireText(locationKey);
    const actor = sync(registry.getActor(actorId, ctx.worldId));
    const available = !!actor && actor.actorId === actorId && actor.participating === true
      && actor.archived === false && !actor.mergedInto;
    const location = sync(getLocation({ worldId: ctx.worldId, worldEpoch: ctx.worldEpoch, locationKey }));
    const targetExists = location?.locationKey === locationKey;
    const position = sync(getActorPosition(actorId));
    const arrived = available && targetExists && position?.actorId === actorId && position.worldId === ctx.worldId
      && position.worldEpoch === ctx.worldEpoch && position.moving === false
      && Number.isFinite(position.x) && Number.isFinite(position.y)
      && Array.isArray(position.locationKeys) && position.locationKeys.includes(locationKey);
    const time = calendar.at(ctx.nowUtcMs);
    const inHours = isInTimeWindow(time.minuteOfDay, BUSINESS_WORK_HOURS.startMinute, BUSINESS_WORK_HOURS.endMinute);
    const service = sync(readActiveService({ ...ctx, actorId }));
    const busy = !!service && service.worldId === ctx.worldId && service.worldEpoch === ctx.worldEpoch
      && service.actorId === actorId && service.locationKey === locationKey && service.phase === 'running'
      && Number.isSafeInteger(service.leaseUntilUtcMs) && service.leaseUntilUtcMs > ctx.nowUtcMs;
    if (busy) requireText(service.sessionId);
    const localNpcSchedule = actor?.npcExists === true && actor.characterExists === false;
    return Object.freeze({ actorId, role, locationKey, targetExists, available, arrived, inHours, localNpcSchedule,
      busy, shouldHold: available && targetExists && busy,
      open: role !== 'commissioner' && available && inHours && arrived && position.sleeping !== true
        && position.encounterId == null && !busy,
      sessionId: busy ? service.sessionId : null,
      scheduleKey: busy ? `business:service:${service.sessionId}` : `business:${ctx.worldEpoch}:${time.date}:${role}:09-18` });
  }
  function getWorkState(actorId, input) {
    requireText(actorId);
    const ctx = context(input);
    return inspect(actorId,ctx,slice(ctx));
  }
  function getBusinessStatus(input) {
    if (!Object.hasOwn(places,input.role)) throw townError('INVALID_BUSINESS_ROLE');
    const ctx = context(input), config = slice(ctx);
    const actorId = config?.npcActorIds?.[input.role];
    return actorId ? inspect(actorId,ctx,config) : null;
  }
  /** Spread into readActorFacts AFTER base schedule and movement have been read.
   * Linked characters ALWAYS keep their original intent/target/scheduleKey;
   * their full character schedule owns movement. Only unlinked, existing NPCs
   * receive local work targets. Existing rest/off-town NPC commitments remain
   * authoritative except when a live service already owns this resident.
   * Unassigned residents are unchanged.
   * allowsAction=false during service prevents M3 from scheduling movement or
   * claiming its station. The service runner retains ownership until release.
   * The host must apply this helper to its movement facts; this helper alone
   * cannot stop movement and deliberately never invokes townService.
   */
  function enrichFacts(actor, input, baseFacts) {
    const ctx = context(input);
    if (baseFacts?.actorId !== actor?.actorId || baseFacts?.worldEpoch !== ctx.worldEpoch) throw townError('STALE_SIMULATION_FACTS');
    const work = inspect(actor.actorId,ctx,slice(ctx));
    const result = { ...baseFacts };
    if (!work) return Object.freeze(result);
    if (!work.available) return Object.freeze({ ...result, allowsAction: false });
    if (!work.localNpcSchedule) {
      return Object.freeze(work.busy ? { ...result, allowsAction: false } : result);
    }
    if (!work.busy && (!work.inHours || ['rest','off_town'].includes(baseFacts.intent))) return Object.freeze(result);
    return Object.freeze({ ...result, intent: 'work', target: work.locationKey,
      scheduleKey: work.scheduleKey, targetExists: work.targetExists, arrived: work.arrived,
      locationKey: work.arrived ? work.locationKey : null,
      allowsAction: baseFacts.allowsAction === true && work.targetExists && !work.busy,
      durationMs: 15 * 60000, minDurationMs: 60000 });
  }
  return { enrichFacts, getWorkState, getBusinessStatus };
}
