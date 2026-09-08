import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

test('actual updateWeatherConfig fences ABA but preserves normalized source and persists only in memory', async t => {
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = ':memory:';
  let attempts = 0, closeDb;
  t.after(() => {
    closeDb?.();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    assert.equal(attempts, 0);
  });
  const forbidden = () => { attempts++; throw new Error('Network forbidden in weather config fixture'); };
  t.mock.method(globalThis, 'fetch', forbidden);
  t.mock.method(net.Socket.prototype, 'connect', forbidden);
  t.mock.method(tls, 'connect', forbidden);
  for (const module of [http, https]) {
    t.mock.method(module, 'request', forbidden);
    t.mock.method(module, 'get', forbidden);
  }
  // Do not expose configuration values from actual startup logging.
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const { config, updateWeatherConfig } = await import('../src/config.js');
  assert.equal(config.dbPath, ':memory:');
  const database = await import('../src/db/index.js');
  closeDb = database.closeDb;
  const db = database.getDb();
  assert.equal(db.pragma('database_list').find(row => row.name === 'main').file, '');
  const { beginWeatherForecastRequest, assertWeatherForecastCurrent } = await import('../src/services/weatherSource.js');
  updateWeatherConfig('fixture-A');
  const request = beginWeatherForecastRequest();
  assert.doesNotThrow(() => assertWeatherForecastCurrent(request));
  updateWeatherConfig('fixture-B');
  updateWeatherConfig('fixture-A');
  assert.throws(() => assertWeatherForecastCurrent(request), { code: 'WEATHER_SOURCE_STALE' });
  assert.equal(database.getSetting('weather_city'), 'fixture-A');
  const current = beginWeatherForecastRequest();
  updateWeatherConfig('  fixture-A  ');
  assert.doesNotThrow(() => assertWeatherForecastCurrent(current));
  assert.equal(database.getSetting('weather_city'), '  fixture-A  ');
  assert.equal(db.pragma('database_list').find(row => row.name === 'main').file, '');
});
