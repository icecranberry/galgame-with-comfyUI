import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Run the real settings functions against an isolated SQLite system_settings table.
const code = readFileSync(new URL('../src/services/speechConfig.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/\bexport /g, '') + '\nreturn { getSpeechSettings, setSpeechSettings };';
function fixture(db, events = []) {
  return new Function('getDb', 'getSetting', 'setSetting', 'API_DEFAULTS', 'selectedLocalTtsModel', 'broadcast', code)(
    () => db,
    key => db.prepare('SELECT setting_value FROM system_settings WHERE setting_key=?').pluck().get(key),
    (key, value) => db.prepare('INSERT OR REPLACE INTO system_settings VALUES(?,?)').run(key, String(value)),
    {}, () => ({ id: '2.0' }), (type, payload) => events.push({ type, payload }));
}
test('auto playback defaults off, validates booleans and persists across database reopen', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'speech-settings-'));
  let db = new Database(path.join(dir, 'test.db'));
  try {
    db.exec('CREATE TABLE system_settings(setting_key TEXT PRIMARY KEY, setting_value TEXT)');
    db.exec('CREATE TABLE character_standing_touch_lines(character_id INTEGER PRIMARY KEY); INSERT INTO character_standing_touch_lines VALUES(1)');
    const events = [], config = fixture(db, events);
    assert.equal(config.getSpeechSettings().auto_play, false);
    assert.equal(config.getSpeechSettings().emotion_enhancement, false);
    config.setSpeechSettings({ emotion_enhancement: true });
    for (const value of ['true', 1, null, {}]) assert.throws(() => config.setSpeechSettings({ emotion_enhancement: value }), /布尔值/);
    config.setSpeechSettings({ enabled: true, auto_play: true });
    assert.deepEqual(events[0], { type: 'expression_standings_updated', payload: { characterId: 1, scope: 'touch-lines-speech', voiceChanged: true } });
    assert.equal(db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='tts_auto_play'").pluck().get(), 'true');
    for (const value of ['true', 1, null, {}]) assert.throws(() => config.setSpeechSettings({ auto_play: value }), /布尔值/);
    assert.equal(config.getSpeechSettings().auto_play, true);
    config.setSpeechSettings({ enabled: false });
    assert.equal(config.getSpeechSettings().auto_play, true);
    db.close(); db = new Database(path.join(dir, 'test.db'));
    const reopened = fixture(db);
    assert.equal(reopened.getSpeechSettings().auto_play, true);
    assert.equal(reopened.getSpeechSettings().emotion_enhancement, true);
    assert.equal(reopened.setSpeechSettings({ emotion_enhancement: false }).emotion_enhancement, false);
    assert.equal(reopened.setSpeechSettings({ auto_play: false }).auto_play, false);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
