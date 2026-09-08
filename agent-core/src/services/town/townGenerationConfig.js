import { config } from '../../config.js';
import { getDb } from '../../db/index.js';

export const TOWN_GENERATION_STEPS = ['tiles', 'buildings', 'npcs', 'player'];

export const DEFAULT_TOWN_GENERATION_SETTINGS = {
  styleTags: '',
  steps: {
    tiles: { prefix: 'pixel art, game sprite', artist: '@ebora', loras: [], portraitLoras: false },
    buildings: { prefix: 'pixel art, game sprite', artist: '@ebora', loras: [], portraitLoras: false },
    npcs: { prefix: 'pixel art, game sprite, mini human sized, full body', artist: '@ebora', loras: [], portraitLoras: false },
    player: { prefix: 'pixel art, game sprite, mini human sized, full body', artist: '@ebora', loras: [], portraitLoras: false },
  },
};

export function normalizeTownGenerationLoras(value) {
  return normalizeLoras(value);
}

function normalizeLoras(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item.path === 'string' && item.path.trim())
    .map(item => ({
      path: item.path.trim(),
      weight: Number.isFinite(Number(item.weight)) ? Math.max(0, Math.min(2, Number(item.weight))) : 1,
      triggerWord: typeof item.triggerWord === 'string' ? item.triggerWord : '',
    }));
}

export function normalizeTownGenerationSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const rawSteps = raw.steps && typeof raw.steps === 'object' ? raw.steps : {};
  const steps = {};
  for (const step of TOWN_GENERATION_STEPS) {
    const item = rawSteps[step] && typeof rawSteps[step] === 'object' ? rawSteps[step] : {};
    const fallback = DEFAULT_TOWN_GENERATION_SETTINGS.steps[step];
    steps[step] = {
      prefix: typeof item.prefix === 'string' || typeof item.promptPrefix === 'string'
        ? String(item.prefix ?? item.promptPrefix)
        : fallback.prefix,
      artist: typeof item.artist === 'string' ? item.artist : fallback.artist,
      loras: normalizeLoras(item.loras),
      portraitLoras: item.portraitLoras === true,
    };
  }
  return { styleTags: typeof raw.styleTags === 'string' ? raw.styleTags : '', steps };
}

export function getTownGenerationSettings() {
  return normalizeTownGenerationSettings(config.town.generation);
}

export function mergeTownGenerationSettings(currentValue, patch = {}) {
  const current = normalizeTownGenerationSettings(currentValue);
  const raw = patch && typeof patch === 'object' ? patch : {};
  const rawSteps = raw.steps && typeof raw.steps === 'object' ? raw.steps : {};
  const mergedSteps = {};
  for (const step of TOWN_GENERATION_STEPS) {
    mergedSteps[step] = {
      ...current.steps[step],
      ...(rawSteps[step] && typeof rawSteps[step] === 'object' ? rawSteps[step] : {}),
    };
  }
  return normalizeTownGenerationSettings({
    ...current,
    ...raw,
    steps: mergedSteps,
  });

}

export function updateTownGenerationSettings(patch = {}) {
  const next = mergeTownGenerationSettings(config.town.generation, patch);
  getDb().prepare(`
      INSERT INTO system_settings (setting_key, setting_value) VALUES ('town_generation_settings', ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(next));
  config.town.generation = next;
  return getTownGenerationSettings();
}

/** 资源 kind 到系统配置步骤。portrait 的画师/LoRA 归属角色类型，但前缀保持为空。 */
export function generationStepForAsset(asset = {}) {
  const kind = String(asset.kind || '');
  const key = String(asset.key || '');
  if (kind === 'ground' || kind === 'road') return 'tiles';
  if (kind === 'building' || kind === 'prop') return 'buildings';
  if (kind === 'portrait') return key.startsWith('player') ? 'player' : 'npcs';
  if (kind === 'player') return 'player';
  if (kind === 'npc') return key.startsWith('char_') ? 'npcs' : 'npcs';
  return 'npcs';
}

export function isPortraitAsset(asset = {}) {
  return String(asset.kind || '') === 'portrait';
}
