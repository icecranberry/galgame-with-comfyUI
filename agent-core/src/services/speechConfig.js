import { getDb } from '../db/index.js';
import { getSetting, setSetting } from '../db/settings.js';
import { API_DEFAULTS, apiConnection, apiVoiceParams } from './speechApiClient.js';
import { resolveApiReferences } from './speechApiAssets.js';
import { localTtsModel, selectedLocalTtsModel } from './localTtsModels.js';
import { broadcast } from './unifiedStreamBus.js';

export function notifyStandingVoiceChanged(characterId) {
  const characters = characterId === undefined
    ? getDb().prepare('SELECT character_id FROM character_standing_touch_lines').all()
    : [{ character_id: Number(characterId) }];
  for (const row of characters) broadcast('expression_standings_updated', {
    characterId: row.character_id, scope: 'touch-lines-speech', voiceChanged: true,
  });
}

export function getSpeechSettings() {
  getDb();
  const api = JSON.parse(getSetting('tts_api_config') || 'null') || API_DEFAULTS;
  return { enabled: getSetting('tts_enabled') === 'true', auto_play: getSetting('tts_auto_play') === 'true', emotion_enhancement: getSetting('tts_emotion_enhancement') === 'true', mode: getSetting('tts_mode') === 'api' ? 'api' : 'local', local_model: selectedLocalTtsModel().id,
    api: { ...api, has_key: !!getSetting('tts_api_key') } };
}
export function setSpeechSettings(input) {
  const db = getDb();
  if (typeof input === 'boolean') input = { enabled: input };
  if (!input || typeof input !== 'object') throw new Error('无效的语音设置');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  if (input.auto_play !== undefined && typeof input.auto_play !== 'boolean') throw new Error('auto_play 必须是布尔值');
  if (input.emotion_enhancement !== undefined && typeof input.emotion_enhancement !== 'boolean') throw new Error('emotion_enhancement 必须是布尔值');
  if (input.mode !== undefined && !['local', 'api'].includes(input.mode)) throw new Error('无效的语音接入方式');
  if (input.local_model !== undefined) localTtsModel(input.local_model);
  const connection = input.api === undefined ? null : apiConnection({ ...getSpeechSettings().api, ...input.api });
  if (input.api?.key !== undefined && (typeof input.api.key !== 'string' || /[\r\n]/.test(input.api.key) || input.api.key.length > 4096)) throw new Error('无效的 API Key');
  db.transaction(() => {
    if (input.enabled !== undefined) setSetting('tts_enabled', input.enabled);
    if (input.auto_play !== undefined) setSetting('tts_auto_play', input.auto_play);
    if (input.emotion_enhancement !== undefined) setSetting('tts_emotion_enhancement', input.emotion_enhancement);
    if (input.mode !== undefined) setSetting('tts_mode', input.mode);
    if (input.local_model !== undefined) setSetting('tts_local_model', input.local_model);
    if (connection) setSetting('tts_api_config', JSON.stringify(connection));
    if (input.api?.clear_key === true) setSetting('tts_api_key', '');
    else if (input.api?.key?.trim()) setSetting('tts_api_key', input.api.key.trim());
  })();
  notifyStandingVoiceChanged();
  return getSpeechSettings();
}
export function getApiVoice(characterId) {
  const row = getDb().prepare('SELECT * FROM character_api_voices WHERE character_id=?').get(characterId);
  return row ? { character_id: row.character_id, name: JSON.parse(row.params).source === 'references' ? '参考音频克隆' : JSON.parse(row.params).voice, version: row.version, params: JSON.parse(row.params) } : null;
}
export function saveApiVoice(characterId, input) {
  const db = getDb(), params = apiVoiceParams(input);
  if (!db.prepare('SELECT 1 FROM characters WHERE id=?').get(characterId)) throw new Error('角色不存在');
  resolveApiReferences(characterId, params);
  db.prepare(`INSERT INTO character_api_voices(character_id,params) VALUES(?,?)
    ON CONFLICT(character_id) DO UPDATE SET params=excluded.params,version=version+1`).run(characterId, JSON.stringify(params));
  notifyStandingVoiceChanged(characterId);
  return getApiVoice(characterId);
}
