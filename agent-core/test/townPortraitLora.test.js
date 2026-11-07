import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('town portrait LoRA test forbids network'); };
const { config, updateGlobalLora } = await import('../src/config.js');
const { loadSystemSettings, initSettingsHandle } = await import('../src/db/settings.js');
const { filterGlobalLoras } = await import('../src/services/imageSkill.js');
const { isPortraitAsset } = await import('../src/services/town/townGenerationConfig.js');

function settingsDb(t, loras) {
  const saved = config.comfyui.globalLora;
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE system_settings (
    setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  if (loras !== undefined) {
    db.prepare('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)')
      .run('comfy_global_lora', JSON.stringify(loras));
  }
  initSettingsHandle(db);
  t.after(() => {
    config.comfyui.globalLora = saved;
    initSettingsHandle(null);
    db.close();
  });
  return db;
}

test('existing LoRAs enable town portraits without changing other settings or all-scenes semantics', t => {
  const legacy = ['chat', 'moments', 'events', 'mailbox', 'schedule'];
  const loras = [
    { path: 'custom.safetensors', scenes: ['chat'], weight: 0.7, triggerWord: 'ink', enabled: false },
    { path: 'legacy.safetensors', scenes: legacy },
    { path: 'all.safetensors', scenes: [] },
    { path: 'missing.safetensors' },
    { path: 'already.safetensors', scenes: ['town_portrait'] },
  ];
  const db = settingsDb(t, loras);
  loadSystemSettings(db);
  const result = config.comfyui.globalLora;
  assert.deepEqual(result[0], { ...loras[0], scenes: ['chat', 'town_portrait'] });
  assert.deepEqual(result[1].scenes, [...legacy, 'group', 'portrait', 'town_portrait']);
  assert.deepEqual(result.slice(2), loras.slice(2));
  assert.deepEqual(JSON.parse(db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'comfy_global_lora'").pluck().get()), result);
});

test('saving a disabled town portrait scope survives repeated settings reloads', t => {
  const db = settingsDb(t, [{ path: 'style.safetensors', scenes: ['portrait'] }]);
  loadSystemSettings(db);
  assert.ok(config.comfyui.globalLora[0].scenes.includes('town_portrait'));
  updateGlobalLora([{ path: 'style.safetensors', scenes: ['portrait'] }]);
  loadSystemSettings(db);
  loadSystemSettings(db);
  assert.deepEqual(config.comfyui.globalLora[0].scenes, ['portrait']);
});

test('fresh installations do not later migrate away an explicitly disabled scope', t => {
  const db = settingsDb(t);
  loadSystemSettings(db);
  updateGlobalLora([{ path: 'new.safetensors', scenes: ['chat'] }]);
  loadSystemSettings(db);
  assert.deepEqual(config.comfyui.globalLora[0].scenes, ['chat']);
});

test('town portrait scope filters independently from normal portraits and other generation scenes', () => {
  const loras = [
    { path: 'town.safetensors', scenes: ['town_portrait'] },
    { path: 'normal.safetensors', scenes: ['portrait'] },
    { path: 'all.safetensors', scenes: [] },
    { path: 'disabled.safetensors', scenes: ['town_portrait'], enabled: false },
  ];
  assert.deepEqual(filterGlobalLoras(loras, 'town_portrait').map(l => l.path), ['town.safetensors', 'all.safetensors']);
  assert.deepEqual(filterGlobalLoras(loras, 'portrait').map(l => l.path), ['normal.safetensors', 'all.safetensors']);
  for (const scene of ['town', 'chat', 'group', 'moments', 'events', 'schedule', 'mailbox', 'sticker']) {
    assert.deepEqual(filterGlobalLoras(loras, scene).map(l => l.path), ['all.safetensors']);
  }
});

test('asset generation and refinement route only the three large portrait types to town_portrait', () => {
  const source = readFileSync(new URL('../src/services/town/townAssetService.js', import.meta.url), 'utf8');
  // Evaluate both actual call-site scene expressions, including the independent workflow routing.
  const routes = [...source.matchAll(/scene: (isPortraitAsset\(row\) \? [^\n]+),\s*workflowScene: ('town')/g)];
  assert.equal(routes.length, 2);
  for (const [, scene, workflowScene] of routes) {
    for (const key of ['npc_1_portrait', 'player_portrait', 'char_1_portrait']) {
      const context = { row: { kind: 'portrait', key }, isPortraitAsset };
      assert.equal(runInNewContext(scene, context), 'town_portrait');
      assert.equal(runInNewContext(workflowScene, context), 'town');
    }
    for (const kind of ['npc', 'player', 'building', 'ground', 'road', 'prop']) {
      assert.equal(runInNewContext(scene, { row: { kind }, isPortraitAsset }), 'town');
    }
  }
});
