import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { closeDb } = await import('../src/db/index.js');
const { getTownState } = await import('../src/services/town/townService.js');

test('town weather supplies a precise zoned clock even when weather is disabled', t => {
  config.dbPath = ':memory:';
  config.features.weather = false;
  config.town.timeZone = 'Asia/Shanghai';
  let now = Date.parse('2026-09-22T15:59:30.500Z');
  t.mock.method(Date, 'now', () => now);
  t.after(closeDb);
  const first = getTownState();
  assert.equal(first.weather.hour, 23);
  assert.equal(first.weather.minuteOfDay, 1439);
  assert.equal(first.weather.sampledAt, first.serverTime);
  assert.equal(first.weather.sampledAt, now);
  now += 60000;
  const midnight = getTownState();
  assert.equal(midnight.weather.hour, 0);
  assert.equal(midnight.weather.minuteOfDay, 0);
  assert.equal(midnight.weather.sampledAt, now);
  config.town.timeZone = 'Asia/Kathmandu';
  now = Date.parse('2026-09-22T00:00:15.250Z');
  const quarterHourZone = getTownState();
  assert.equal(quarterHourZone.weather.hour, 5);
  assert.equal(quarterHourZone.weather.minuteOfDay, 345);
  assert.equal(quarterHourZone.weather.sampledAt, now);
});
