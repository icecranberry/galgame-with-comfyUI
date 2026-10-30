import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { getDb } from '../db/index.js';
import { getSpeechSettings, requestSpeech } from './speechService.js';
import { apiConnection, apiVoiceParams } from './speechApiClient.js';
import { audioPath, audioUrl } from './voiceAssets.js';
import { broadcast } from './unifiedStreamBus.js';
import { createStandingTouchSpeechService } from './standingTouchSpeech.js';

const fileExists = relative => { try { return !!relative && existsSync(audioPath(relative)); } catch { return false; } };
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function standingSpeechProfile(db, id, settings = getSpeechSettings()) {
  const disabled = settings.enabled ? null : '请先启用语音朗读';
  const missing = reason => ({ enabled: settings.enabled, configured: false, reason: disabled || reason, key: null });
  try {
    if (settings.mode === 'api') {
      const row = db.prepare('SELECT * FROM character_api_voices WHERE character_id=?').get(id);
      if (!row) return missing('角色尚未配置 API 声音，已跳过');
      const params = apiVoiceParams(JSON.parse(row.params));
      const references = (params.references || []).map(ref => {
        const sample = db.prepare('SELECT * FROM api_voice_samples WHERE id=? AND character_id=?').get(ref.sample_id, id);
        if (!sample || !fileExists(sample.preview_path)) throw new Error('角色的 API 参考音频已丢失');
        return { hash: sample.content_hash, text: ref.text };
      });
      return { enabled: settings.enabled, configured: true, reason: disabled,
        key: fingerprint({ mode: 'api', id, version: row.version, params, references, connection: apiConnection(settings.api) }) };
    }
    const voice = db.prepare(`SELECT v.*,s.content_hash,s.reference_path FROM character_voices b
      JOIN voices v ON b.voice_id=v.id AND v.character_id=b.character_id JOIN voice_samples s ON s.id=v.sample_id
      WHERE b.character_id=? AND b.enabled=1`).get(id);
    if (!voice) return missing('角色尚未配置本地声音，已跳过');
    if (!fileExists(voice.reference_path)) return missing('角色的声音参考片段已丢失');
    return { enabled: settings.enabled, configured: true, reason: disabled, voiceId: voice.id,
      key: fingerprint({ mode: 'local', model: settings.local_model, voice,
        ...(settings.emotion_enhancement ? { emotion_enhancement: true } : {}) }) };
  } catch (error) { return missing(error.message || '角色声音配置无效'); }
}

export function standingTouchSpeech(db = getDb()) {
  return createStandingTouchSpeechService({ db, profile: id => standingSpeechProfile(db, id), requestSpeech, fileExists, audioUrl, emit: broadcast });
}
export const readStandingTouchLines = (db, id) => standingTouchSpeech(db).read(id);
