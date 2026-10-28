import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { getSetting } from '../db/settings.js';
import { broadcast } from './unifiedStreamBus.js';
import { speechText, speechParams, speechCacheKey } from './speechText.js';
import { audioPath, audioUrl } from './voiceAssets.js';
import { ttsRequest, ttsHealth } from './indexTtsClient.js';
import { withSpeechGpu } from './speechGpu.js';
import { getSpeechSettings, setSpeechSettings as configureSpeechSettings, getApiVoice } from './speechConfig.js';
import { apiConnection, apiVoiceParams, apiSpeechCacheKey, fetchApiSpeech } from './speechApiClient.js';
import { resolveApiReferences, encodeApiReferences } from './speechApiAssets.js';
import { selectedLocalTtsModel } from './localTtsModels.js';

export { getSpeechSettings };
export function setSpeechSettings(input) {
  const previous = getSpeechSettings();
  const settings = configureSpeechSettings(input);
  if (settings.mode !== previous.mode || settings.local_model !== previous.local_model || !settings.enabled) {
    for (const { id } of getDb().prepare("SELECT id FROM speech_jobs WHERE status IN ('queued','generating')").all()) cancelSpeech(id);
  }
  return settings;
}
const apiControllers = new Map();
export function publicJob(job) {
  if (!job) return null;
  return { id: job.id, status: job.status, error: job.error, voice_id: job.voice_id,
    voice_version: job.voice_version, audio_url: job.status === 'completed' && job.output_path ? audioUrl(job.output_path) : null };
}
export function getSpeechJob(id) { return getDb().prepare('SELECT * FROM speech_jobs WHERE id=?').get(id); }
function updateJob(id, status, error = null, output = null) {
  const db = getDb();
  // Cancellation always wins over a late inference response.
  db.prepare("UPDATE speech_jobs SET status=?, error=?, output_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status != 'cancelled'").run(status, error, output, id);
  broadcast('speech_update', publicJob(getSpeechJob(id)));
}
function enqueue(job) {
  const cancelled = () => getSpeechJob(job.id)?.status === 'cancelled' || !getSpeechSettings().enabled || getSpeechSettings().mode !== 'local';
  withSpeechGpu(async () => {
    if (cancelled()) throw new Error('语音已关闭或任务已取消');
    updateJob(job.id, 'generating');
    const sample = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(job.sample_id);
    const status = await ttsHealth();
    if (!status.online || !status.compatible || !status.ready) throw new Error(status.error || 'TTS 模型尚未安装或固定版本不匹配');
    const output = `generated/${job.id}.wav`;
    await ttsRequest('/synthesize', { reference: sample.reference_path, output, text: job.text,
      ...JSON.parse(job.params), model_version: job.model_version }, 600000);
    if (!fs.existsSync(audioPath(output))) throw new Error('TTS 没有生成音频，请检查两端音频目录配置');
    return output;
  }, cancelled).then(output => updateJob(job.id, 'completed', null, output))
    .catch(error => updateJob(job.id, 'failed', error.message));
}
export function requestSpeech({ characterId, voiceId, sampleId, text, params, messageId }) {
  const db = getDb();
  if (!getSpeechSettings().enabled) throw new Error('请先在声音设置或酒馆的音色管理中启用语音朗读');
  if (getSpeechSettings().mode === 'api') return requestApiSpeech({ characterId, text, params, messageId });
  const voice = voiceId ? db.prepare('SELECT * FROM voices WHERE id=?').get(voiceId) : null;
  if (voiceId && !voice) throw new Error('音色不存在');
  if (voice && (!characterId || voice.character_id !== characterId)) throw new Error('音色不属于当前角色，请为该角色创建声音');
  const sample = db.prepare('SELECT * FROM voice_samples WHERE id=?').get(voice?.sample_id || sampleId || '');
  if (!sample?.reference_path) throw new Error('请先选择并处理参考片段');
  const cleaned = speechText(text, db.prepare('SELECT emoji_key FROM emoji_categories').all().map(row => row.emoji_key));
  if (!/[\p{L}\p{N}]/u.test(cleaned)) throw new Error('这条消息没有可朗读的对白');
  if (cleaned.length > 1000) throw new Error('单次朗读最多 1000 字，请选择较短的气泡');
  // Preview drafts can override sampling without mutating the saved voice.
  // Message playback always uses the saved profile.
  const actualParams = speechParams(voice ? { ...voice, ...(!messageId && params?.generation_params !== undefined ? { generation_params: params.generation_params } : {}) } : params);
  const modelVersion = selectedLocalTtsModel().version;
  if (actualParams.language === 'ja') throw new Error('IndexTTS 2.0 支持中英文，请将语音语言调整为中文或英文');
  const key = speechCacheKey(cleaned, sample.content_hash, actualParams, modelVersion);
  let job = db.prepare("SELECT * FROM speech_jobs WHERE cache_key=? AND status IN ('queued','generating','completed')").get(key);
  if (job?.status === 'completed' && !fs.existsSync(audioPath(job.output_path))) { updateJob(job.id, 'failed', '缓存文件已丢失'); job = null; }
  let created = false;
  if (!job) {
    const id = randomUUID();
    db.prepare(`INSERT INTO speech_jobs(id, cache_key, text, voice_id, voice_version, sample_id, model_version, params, status)
      VALUES(?,?,?,?,?,?,?,?, 'queued')`).run(id, key, cleaned, voice?.id || 'preview', voice?.version || 1, sample.id, modelVersion, JSON.stringify(actualParams));
    job = getSpeechJob(id); created = true;
  }
  if (messageId) db.prepare('INSERT OR REPLACE INTO message_speech(message_id,job_id) VALUES(?,?)').run(messageId, job.id);
  if (created) { broadcast('speech_update', publicJob(job)); enqueue(job); }
  return publicJob(job);
}
export function speakMessage(characterId, messageId) {
  const db = getDb();
  const message = db.prepare("SELECT * FROM messages WHERE id=? AND conversation_id=? AND role='assistant'").get(messageId, `char_${characterId}`);
  if (!message || message.event_id || (message.speaker_character_id && message.speaker_character_id !== characterId)) throw new Error('消息不存在、不是对白或不属于这个角色');
  if (getSpeechSettings().mode === 'api') return requestSpeech({ characterId, text: message.content, messageId: message.id });
  const binding = db.prepare('SELECT * FROM character_voices WHERE character_id=? AND enabled=1').get(characterId);
  if (!binding) throw new Error('角色尚未设置声音，请在角色详情中添加');
  return requestSpeech({ characterId, voiceId: binding.voice_id, text: message.content, messageId: message.id });
}
export function cancelSpeech(id) {
  const db = getDb();
  db.prepare("UPDATE speech_jobs SET status='cancelled', error='用户取消', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','generating')").run(id);
  apiControllers.get(id)?.abort();
  const result = publicJob(getSpeechJob(id));
  // Running work keeps the GPU lease until inference exits, even after cancellation.
  broadcast('speech_update', result);
  return result;
}

function requestApiSpeech({ characterId, text, params, messageId }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM characters WHERE id=?').get(characterId)) throw new Error('角色不存在');
  const saved = getApiVoice(characterId);
  const draft = !messageId && params?.api_params;
  if (!draft && !saved) throw new Error('角色尚未设置 API 音色，请先设置音色 ID 或参考音频');
  const profile = apiVoiceParams(draft || saved.params);
  const connection = apiConnection(getSpeechSettings().api);
  const cleaned = speechText(text, db.prepare('SELECT emoji_key FROM emoji_categories').all().map(row => row.emoji_key));
  if (!/[\p{L}\p{N}]/u.test(cleaned)) throw new Error('这条消息没有可朗读的对白');
  if (cleaned.length > 1000) throw new Error('单次朗读最多 1000 字，请选择较短的气泡');
  const references = profile.source === 'references' ? resolveApiReferences(characterId, profile) : [];
  const key = apiSpeechCacheKey(characterId, cleaned, connection, profile, references.map(ref => ({ audio: `sha256:${ref.content_hash}`, text: ref.text })));
  let job = db.prepare("SELECT * FROM speech_jobs WHERE cache_key=? AND status IN ('queued','generating','completed')").get(key);
  if (job?.status === 'completed' && !fs.existsSync(audioPath(job.output_path))) { updateJob(job.id, 'failed', '缓存文件已丢失'); job = null; }
  let created = false;
  if (!job) {
    const id = randomUUID();
    db.prepare(`INSERT INTO speech_jobs(id,cache_key,text,voice_id,voice_version,sample_id,model_version,params,status)
      VALUES(?,?,?,?,?,NULL,?,?,'queued')`).run(id, key, cleaned, `api:${characterId}`, saved?.version || 1,
      `openai-compatible:${connection.model}`, JSON.stringify({ connection, profile }));
    job = getSpeechJob(id); created = true;
  }
  if (messageId) db.prepare('INSERT OR REPLACE INTO message_speech(message_id,job_id) VALUES(?,?)').run(messageId, job.id);
  if (created) {
    const controller = new AbortController();
    apiControllers.set(job.id, controller);
    broadcast('speech_update', publicJob(job));
    updateJob(job.id, 'generating');
    const apiKey = getSetting('tts_api_key');
    encodeApiReferences(references).then(encoded => fetchApiSpeech(cleaned, connection, profile, apiKey, controller.signal, encoded)).then(async ({ buffer, extension }) => {
      if (controller.signal.aborted || !getSpeechSettings().enabled) throw new Error('语音已关闭或任务已取消');
      const output = `generated/${job.id}.${extension}`;
      await fs.promises.mkdir(audioPath('generated'), { recursive: true });
      await fs.promises.writeFile(audioPath(output), buffer);
      if (controller.signal.aborted || !getSpeechSettings().enabled) {
        await fs.promises.rm(audioPath(output), { force: true });
        throw new Error('语音已关闭或任务已取消');
      }
      updateJob(job.id, 'completed', null, output);
    }).catch(error => updateJob(job.id, 'failed', error.name === 'TimeoutError' ? 'TTS API 请求超时，请重试' : error.message))
      .finally(() => apiControllers.delete(job.id));
  }
  return publicJob(getSpeechJob(job.id));
}
