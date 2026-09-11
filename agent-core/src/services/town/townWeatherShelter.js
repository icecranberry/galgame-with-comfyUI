export const SHELTER_WAIT_MS = 15 * 60000;
export const shelterRuleKey = forecastAt => `town.weather.shelter:${forecastAt}`;

/** Only scheduleManager's explicit unscheduled sentinel is task-free. */
export function isIdleScheduleActivity(activity) {
  return activity === null || (activity !== undefined && activity?.activity === '自由时间'
    && activity.location === '未知' && activity.startTime === '' && activity.endTime === ''
    && activity.replyDelay === 0 && activity.snapshotPrompt === ''
    && activity.description === '没有特定安排，自由支配时间'
    && Array.isArray(activity.tags) && activity.tags.length === 1 && activity.tags[0] === 'idle');
}

/** Read-only budget from runner history. Home changes never create a new budget. */
export function createTownWeatherShelter({ db }) {
  function remaining({ worldId, worldEpoch, actorId, forecastAt, actionId = null }) {
    const rows = db.prepare(`SELECT * FROM town_actions WHERE world_id=? AND world_epoch=?
      AND actor_id=? AND type='wait' AND rule_key=?`).all(worldId, worldEpoch, actorId, shelterRuleKey(forecastAt));
    let used = 0;
    for (const row of rows) {
      if (row.id === actionId && ['validated','reserved','running'].includes(row.status)) continue;
      if (row.started_at === null) continue;
      if (![row.started_at, row.due_at, row.updated_at].every(Number.isSafeInteger)
          || row.due_at < row.started_at || row.updated_at < row.started_at) return 0;
      // An unresolved other owner reserves its whole allowance. Terminal gaps are
      // conservatively charged, never credited as observed attendance or rewards.
      const end = ['completed','cancelled','failed'].includes(row.status)
        ? Math.min(row.updated_at, row.due_at) : row.due_at;
      used += Math.max(0, end - row.started_at);
    }
    return Math.max(0, SHELTER_WAIT_MS - used);
  }
  function enrich({ actor, scope, facts, weather, sourceKey, home, hasOriginalTask, actionId }) {
    if (hasOriginalTask || !facts.allowsAction || facts.intent !== 'wait' || facts.target !== null
        || weather.status !== 'known' || weather.precipitation !== 'rain'
        || !Number.isSafeInteger(weather.forecastAt) || weather.forecastAt < 0
        || typeof sourceKey !== 'string' || !/^weather:v1:[a-f0-9]{64}$/.test(sourceKey)
        || !home || home.kind !== 'home' || typeof home.key !== 'string' || !home.key
        || home.key.length > 256) return facts;
    const durationMs = remaining({ ...scope, actorId: actor.actorId, forecastAt: weather.forecastAt, actionId });
    if (!durationMs) return facts;
    const scheduleKey = `weather:shelter:${sourceKey}:${weather.forecastAt}:${home.id}`;
    if (scheduleKey.length > 256) return facts;
    return { ...facts, target: home.key, targetExists: true, scheduleKey,
      shelterForecastAt: weather.forecastAt, durationMs, minDurationMs: 0 };
  }
  return { remaining, enrich };
}
