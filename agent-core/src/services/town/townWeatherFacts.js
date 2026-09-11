const HOUR = 3600000, MAX_AGE = 26 * HOUR;
const rain = new Set(['小雨','中雨','大雨','暴雨','大暴雨','特大暴雨','阵雨','雷阵雨']);
const none = new Set(['晴','少云','晴间多云','多云','阴']);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 - HOUR;

/** Local cache only. Forecast means a provider forecast, never observed weather or LLM prose. */
export function createTownWeatherFacts({ db, clock, enabled = true, expectedSourceKey }) {
  if (!db?.prepare || typeof clock?.now !== 'function' || typeof enabled !== 'boolean') throw new TypeError('Invalid weather dependencies');
  const unknown = reason => ({source:'forecast',status:'unknown',precipitation:null,text:'',temperature:null,forecastAt:null,fetchedAt:null,validUntil:null,reason});
  function readCurrent() {
    if (!enabled) return unknown('DISABLED');
    if (typeof expectedSourceKey !== 'string' || !/^weather:v1:[a-f0-9]{64}$/.test(expectedSourceKey)) return unknown('SOURCE_MISMATCH');
    const now = clock.now();
    if (!validTime(now)) return unknown('INVALID_TIME');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='weather_hourly'").get()) return unknown('MISSING_CACHE');
    const columns = new Set(db.prepare('PRAGMA table_info(weather_hourly)').all().map(row => row.name));
    if (!columns.has('forecast_at') || !columns.has('fetched_at')) return unknown('MISSING_VALID_TIME');
    if (!columns.has('source_key')) return unknown('SOURCE_MISMATCH');
    const rows = db.prepare('SELECT weather_text,temperature,forecast_at,fetched_at,source_key FROM weather_hourly').all();
    if (!rows.length) return unknown('MISSING_CACHE');
    if (rows.some(row => row.source_key !== expectedSourceKey)) return unknown('SOURCE_MISMATCH');
    const current = rows.filter(row => validTime(row.forecast_at) && row.forecast_at <= now && now < row.forecast_at + HOUR);
    if (!current.length) return unknown(rows.some(row => !validTime(row.forecast_at)) ? 'MISSING_VALID_TIME' : 'NO_CURRENT_FORECAST');
    if (current.length !== 1) return unknown('AMBIGUOUS_FORECAST');
    const row = current[0];
    if (!validTime(row.fetched_at) || row.fetched_at > now) return unknown('INVALID_TIME');
    if (now - row.fetched_at >= MAX_AGE) return unknown('STALE_CACHE');
    const precipitation = rain.has(row.weather_text) ? 'rain' : none.has(row.weather_text) ? 'none' : null;
    if (!precipitation) return unknown('UNRECOGNIZED_WEATHER');
    const temperature = typeof row.temperature === 'string' && row.temperature.trim().length > 0
      && row.temperature.length <= 32 && !/[\r\n\x00-\x1f]/.test(row.temperature) ? row.temperature : null;
    return {source:'forecast',status:'known',precipitation,text:row.weather_text,temperature,forecastAt:row.forecast_at,fetchedAt:row.fetched_at,
      validUntil:Math.min(row.forecast_at + HOUR, row.fetched_at + MAX_AGE),reason:null};
  }
  return {readCurrent};
}
