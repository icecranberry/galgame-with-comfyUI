/** Offset is mandatory; reject normalized invalid dates rather than guessing host TZ. */
export function parseWeatherForecastAt(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid forecast timestamp');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) throw new TypeError('Invalid forecast timestamp');
  const [, year, month, day, hour, minute, second = '00', zone] = m;
  // Our accepted hourly contract is source-local HH:00:00, not UTC alignment.
  if (minute !== '00' || second !== '00') throw new TypeError('Forecast must start at a local hour');
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const date = new Date(utc);
  if (+year < 1970 || date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1
    || date.getUTCDate() !== +day || date.getUTCHours() !== +hour || date.getUTCMinutes() !== +minute
    || date.getUTCSeconds() !== +second) throw new TypeError('Invalid forecast timestamp');
  let offset = 0;
  if (zone !== 'Z') {
    const hours = +zone.slice(1, 3), minutes = +zone.slice(4, 6);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw new TypeError('Invalid forecast offset');
    offset = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
  }
  const result = utc - offset * 60000;
  if (result < 0) throw new TypeError('Invalid forecast timestamp');
  return result;
}

/** Keep legacy display columns; prepare the whole batch before atomic replacement. */
export function replaceWeatherHourlyCache({ db, hourly, fetchedAt, tempLabel, beaufortLabel, sourceKey, assertCurrent }) {
  if (typeof sourceKey !== 'string' || !/^weather:v1:[a-f0-9]{64}$/.test(sourceKey)
    || typeof assertCurrent !== 'function') throw new TypeError('Weather source guard required');
  assertCurrent();
  if (!Array.isArray(hourly) || !hourly.length || !Number.isSafeInteger(fetchedAt) || fetchedAt < 0
    || fetchedAt > 8640000000000000) throw new TypeError('Invalid weather batch');
  const rows = hourly.map(h => {
    const forecastAt = parseWeatherForecastAt(h?.fxTime);
    if (typeof h.text !== 'string' || !h.text.length) throw new TypeError('Invalid weather text');
    return [h.fxTime.substring(11, 16), h.text, tempLabel(parseInt(h.temp, 10) || 0),
      beaufortLabel(parseFloat(h.windSpeed)), forecastAt, fetchedAt];
  });
  const byTime = new Map();
  for (const row of rows) {
    const prior = byTime.get(row[4]);
    if (prior) {
      if (![1, 2, 3].every(index => prior[index] === row[index])) throw new TypeError('Conflicting forecast payload');
    } else byTime.set(row[4], row);
  }
  const sorted = [...byTime.keys()].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index] < sorted[index - 1] + 3600000) throw new TypeError('Overlapping forecast intervals');
  }
  return db.transaction(() => {
    assertCurrent();
    db.prepare('DELETE FROM weather_hourly').run();
    const insert = db.prepare(`INSERT OR IGNORE INTO weather_hourly
      (weather_time,weather_text,temperature,wind_speed,forecast_at,fetched_at,source_key) VALUES(?,?,?,?,?,?,?)`);
    // Keep original response order for non-overlapping legacy HH:mm collisions.
    for (const row of byTime.values()) insert.run(...row, sourceKey);
  }).immediate();
}
