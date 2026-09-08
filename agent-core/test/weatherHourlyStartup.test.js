import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// Follow townDatabaseMigration's real startup isolation; no app/scheduler import.
test('actual getDb/initSchema startup creates nullable forecast columns in memory without network', async t => {
  const original = process.env.DB_PATH;
  process.env.DB_PATH = ':memory:';
  let attempts = 0;
  const forbidden = () => { attempts++; throw new Error('Network forbidden in weather schema startup test'); };
  t.mock.method(globalThis, 'fetch', forbidden);
  t.mock.method(net.Socket.prototype, 'connect', forbidden);
  for (const module of [http, https]) {
    t.mock.method(module, 'request', forbidden); t.mock.method(module, 'get', forbidden);
  }
  t.mock.method(tls, 'connect', forbidden);
  const { config } = await import('../src/config.js');
  assert.equal(config.dbPath, ':memory:');
  const { getDb, closeDb } = await import('../src/db/index.js');
  t.after(() => {
    closeDb();
    if (original === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = original;
    assert.equal(attempts, 0);
  });
  const db = getDb();
  const columns = db.pragma('table_info(weather_hourly)');
  for (const name of ['forecast_at', 'fetched_at']) {
    const column = columns.find(value => value.name === name);
    assert.ok(column); assert.equal(column.type, 'INTEGER'); assert.equal(column.notnull, 0);
  }
  assert.equal(columns.find(value => value.name === 'source_key')?.type,'TEXT');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM weather_hourly').get().n, 0);
  db.prepare('INSERT INTO weather_hourly(weather_time,weather_text,temperature) VALUES(?,?,?)').run('09:00','小雨','温暖');
  const legacy = db.prepare('SELECT forecast_at,fetched_at,source_key FROM weather_hourly').get();
  assert.deepEqual(legacy, { forecast_at: null, fetched_at: null,source_key:null });
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});
