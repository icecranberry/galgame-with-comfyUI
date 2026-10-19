import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getMomentDelay, getMomentIntervalMs, isDefaultMomentTiming } from '../src/services/momentTiming.js';
import { config, updateMomentFreq } from '../src/config.js';
import { initSettingsHandle, loadSystemSettings } from '../src/db/settings.js';

const HOUR = 3600_000;

test('默认档保留首次 1~4 小时、后续 2~8 小时，兼容旧设置', () => {
  for (const features of [{}, { momentFreq: 1 }, { momentFreq: 1, momentFreqMode: 'default' }]) {
    assert.equal(isDefaultMomentTiming(features), true);
    for (const [sample, first, next] of [[0, 1, 2], [0.5, 2.5, 5], [1, 4, 8]]) {
      assert.equal(getMomentDelay(features, { initial: true, random: () => sample }), first * HOUR);
      assert.equal(getMomentDelay(features, { random: () => sample }), next * HOUR);
    }
  }
});

test('所有具体时间档返回精确的全局间隔，默认与关闭不启用全局计时', () => {
  for (const minutes of [2160, 1440, 960, 720, 480, 240, 120, 60, 30, 15, 5]) {
    const features = { momentFreq: 120 / minutes, momentFreqMode: 'interval' };
    assert.equal(isDefaultMomentTiming(features), false);
    assert.ok(Math.abs(getMomentIntervalMs(features) - minutes * 60_000) < 0.001);
  }
  assert.equal(getMomentIntervalMs({ momentFreq: 1, momentFreqMode: 'default' }), null);
  assert.equal(getMomentIntervalMs({ momentFreq: 0, momentFreqMode: 'interval' }), null);
});

test('自定义与关闭时的单人排期仍用默认节奏，切回默认不会留下 5 分钟排期', () => {
  for (const momentFreq of [24, 1 / 12, 0]) {
    assert.equal(getMomentDelay({ momentFreq }, { random: () => 0.5 }), 5 * HOUR);
  }
  assert.equal(getMomentIntervalMs({ momentFreq: 1 / 12 }), 24 * HOUR);
});

test('2 小时与默认的模式随设置持久化，重载后仍可区分', () => {
  const previous = { ...config.features };
  const db = new Database(':memory:');
  db.exec('CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT)');
  initSettingsHandle(db);
  try {
    for (const [value, mode, expectedHours] of [[1, 'interval', 2], [1, 'default', null], [1 / 8, 'interval', 16], [1 / 18, 'interval', 36]]) {
      updateMomentFreq(value, mode);
      config.features.momentFreq = 0;
      config.features.momentFreqMode = '';
      loadSystemSettings(db);
      assert.equal(config.features.momentFreq, value);
      assert.equal(config.features.momentFreqMode, mode);
      assert.equal(getMomentIntervalMs(config.features), expectedHours === null ? null : expectedHours * HOUR);
    }
    updateMomentFreq(1); // 旧客户端仍选择默认
    assert.equal(isDefaultMomentTiming(config.features), true);
  } finally {
    Object.assign(config.features, previous);
    initSettingsHandle(null);
    db.close();
  }
});
