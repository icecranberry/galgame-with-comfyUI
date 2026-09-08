import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.TZ = 'UTC';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in weather runtime fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { getTownState } = await import('../src/services/town/townService.js');
const { createTownWeatherFacts } = await import('../src/services/town/townWeatherFacts.js');
const { getWeatherSourceKey } = await import('../src/services/weatherSource.js');

function fixture(t) {
  let now = Date.parse('2026-09-08T00:30:00+08:00');
  t.mock.method(Date, 'now', () => now);
  config.features.town = true;
  config.features.townLLM = false;
  config.features.weather = true;
  config.town.timeZone = 'Asia/Shanghai';
  config.town.economyEnabled = false;
  const db = getDb(); // Actual full migration; no scheduler or initialization wizard.
  t.after(() => closeDb());
  function cache({ forecastAt = now - 1800000, fetchedAt = now, text = '小雨', temperature = '温暖' } = {}) {
    db.pragma('query_only=OFF');
    db.prepare('DELETE FROM weather_hourly').run();
    db.prepare(`INSERT INTO weather_hourly(weather_time,weather_text,temperature,forecast_at,fetched_at,source_key)
      VALUES('00:00',?,?,?,?,?)`).run(text, temperature, forecastAt, fetchedAt, getWeatherSourceKey(config.weather.city));
    db.pragma('query_only=ON');
  }
  return { db, cache, setNow: value => { now = value; }, get now() { return now; },
    read: () => getTownState().weather };
}

test('city change invalidates current forecast until matching cache, preserving town night display', t => {
  const f = fixture(t);
  const previous = config.weather.city;
  t.after(() => { config.weather.city = previous; });
  config.weather.city = '上海';
  f.cache();
  assert.equal(f.read().status, 'known');
  config.weather.city = '北京';
  const weather = f.read();
  assert.equal(weather.status, 'unknown');
  assert.equal(weather.reason, 'SOURCE_MISMATCH');
  assert.equal(weather.text, '');
  assert.equal(weather.temperature, null);
  assert.equal(weather.hour, 0);
  assert.equal(weather.timeDesc, '凌晨');
  assert.equal(weather.season, '秋天');
  f.cache();
  assert.equal(f.read().status, 'known');
  assert.equal(f.read().hour, 0);
});

test('actual town snapshot uses UTC forecast validity and town wall clock without writes', t => {
  const f = fixture(t);
  f.cache();
  const changes = f.db.prepare('SELECT total_changes() AS n').get().n;
  const weather = f.read();
  assert.equal(new Date(f.now).getHours(), 16);
  assert.equal(weather.hour, 0);
  assert.equal(weather.timeDesc, '凌晨');
  assert.equal(weather.season, '秋天');
  assert.equal(weather.status, 'known');
  assert.equal(weather.source, 'forecast');
  assert.equal(weather.precipitation, 'rain');
  assert.equal(weather.text, '小雨');
  assert.equal(weather.temperature, '温暖');
  assert.equal(weather.validUntil, f.now + 1800000);
  assert.deepEqual(f.read(), weather);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n, changes);
  f.setNow(weather.validUntil);
  assert.equal(f.read().status, 'unknown');
});

test('actual snapshot never reuses yesterday, legacy or stale weather and honors live feature gate', t => {
  const f = fixture(t);
  for (const [input, reason] of [
    [{ forecastAt: f.now - 86400000 }, 'NO_CURRENT_FORECAST'],
    [{ forecastAt: null, fetchedAt: null }, 'MISSING_VALID_TIME'],
    [{ fetchedAt: f.now - 26 * 3600000 }, 'STALE_CACHE'],
    [{ text: '没有下雨' }, 'UNRECOGNIZED_WEATHER'],
  ]) {
    f.cache(input);
    const weather = f.read();
    assert.equal(weather.status, 'unknown');
    assert.equal(weather.reason, reason);
    assert.equal(weather.text, '');
    assert.equal(weather.temperature, null);
    assert.equal(weather.precipitation, null);
    assert.equal(weather.hour, 0);
  }
  f.cache();
  config.features.weather = false;
  assert.equal(f.read().reason, 'DISABLED');
  config.features.weather = true;
  assert.equal(f.read().status, 'known');
});

test('town time follows configured zone across DST and seasonal midnight independently of host', t => {
  const f = fixture(t);
  config.town.timeZone = 'America/New_York';
  for (const [instant, hour] of [['2026-03-08T06:30:00Z', 1], ['2026-03-08T07:30:00Z', 3]]) {
    f.setNow(Date.parse(instant));
    f.cache();
    assert.equal(f.read().hour, hour);
    assert.equal(f.read().timeDesc, '凌晨');
  }
  config.town.timeZone = 'Asia/Shanghai';
  f.setNow(Date.parse('2026-08-31T16:00:00Z'));
  f.cache({ text: '晴' });
  assert.equal(f.read().season, '秋天');
  assert.equal(f.read().precipitation, 'none');
});

test('optional weather SQL failure degrades snapshot with bounded diagnostics and recovers', t => {
  const f = fixture(t);
  f.cache();
  f.db.pragma('query_only=OFF');
  f.db.exec('ALTER TABLE weather_hourly RENAME COLUMN weather_text TO broken_text');
  f.db.pragma('query_only=ON');
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  const reader = createTownWeatherFacts({ db: f.db, clock: { now: () => f.now }, enabled: true,
    expectedSourceKey: getWeatherSourceKey(config.weather.city) });
  assert.throws(() => reader.readCurrent(), error => error.code === 'SQLITE_ERROR');
  const weather = f.read();
  assert.equal(weather.status, 'unknown');
  assert.equal(weather.reason, 'READ_FAILED');
  assert.equal(weather.hour, 0);
  assert.equal(weather.timeDesc, '凌晨');
  assert.equal(weather.season, '秋天');
  assert.equal(weather.text, '');
  assert.equal(weather.temperature, null);
  assert.equal(weather.precipitation, null);
  assert.equal(weather.forecastAt, null);
  assert.equal(weather.fetchedAt, null);
  assert.equal(weather.validUntil, null);
  assert.equal(JSON.stringify(weather).includes('weather_text'), false);
  for (let i = 0; i < 10; i++) assert.deepEqual(f.read(), weather);
  assert.equal(logs.length, 1);
  assert.match(String(logs[0][1]), /weather_text/);
  f.setNow(f.now + 60000);
  assert.equal(f.read().reason, 'READ_FAILED');
  assert.equal(logs.length, 2);
  f.db.pragma('query_only=OFF');
  f.db.exec('ALTER TABLE weather_hourly RENAME COLUMN broken_text TO weather_text');
  f.db.pragma('query_only=ON');
  assert.equal(f.read().status, 'known');
  assert.equal(logs.length, 2);
});
