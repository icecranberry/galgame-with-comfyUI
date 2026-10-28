import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/index.js';
import { getSetting } from '../db/settings.js';

export const DEFAULT_LOCAL_TTS_MODEL = '2.0';
const catalog = JSON.parse(readFileSync(new URL('../../../tts-service/local-models.json', import.meta.url), 'utf8'));
export const LOCAL_TTS_MODELS = Object.freeze(Object.fromEntries(catalog.map(entry => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../tts-service/${entry.manifest}`, import.meta.url)), 'utf8'));
  return [entry.id, { ...entry, ...manifest, version: `${entry.label.replaceAll(' ', '-')}:${manifest.model_revision}:${manifest.code_revision}` }];
})));
export function localTtsModel(id) {
  if (!Object.hasOwn(LOCAL_TTS_MODELS, id)) throw new Error('不支持的本地语音模型版本');
  return LOCAL_TTS_MODELS[id];
}
export function selectedLocalTtsModel() {
  getDb();
  const selected = getSetting('tts_local_model');
  return localTtsModel(!selected || ['2.5', 'voxcpm-2.0'].includes(selected) ? DEFAULT_LOCAL_TTS_MODEL : selected);
}
