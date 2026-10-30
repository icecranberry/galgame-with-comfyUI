import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { getSetting } from '../db/settings.js';
import { broadcast } from './unifiedStreamBus.js';
import { speechText, speechParams, speechCacheKey } from './speechText.js';
import { AUDIO_ROOT, audioPath, audioUrl } from './voiceAssets.js';
import { ttsRequest, ttsHealth } from './indexTtsClient.js';
import { withSpeechGpu } from './speechGpu.js';
import { getSpeechSettings, setSpeechSettings as configureSpeechSettings, getApiVoice } from './speechConfig.js';
import { apiConnection, apiVoiceParams, apiSpeechCacheKey, fetchApiSpeech } from './speechApiClient.js';
import { resolveApiReferences, encodeApiReferences } from './speechApiAssets.js';
import { selectedLocalTtsModel } from './localTtsModels.js';
import { localVoiceSource } from './builtinVoices.js';
import { baseVoiceSample, prepareVoiceReference, referenceDesign } from './voiceReferences.js';

import { clearGeneratedSpeech } from './speechCache.js';
import { SPEECH_EMOTION_VERSION, speechEmotionContext, inferSpeechEmotion } from './speechEmotion.js';

export { getSpeechSettings };
export function setSpeechSettings(input) {
  const previous = getSpeechSettings();
  const settings = configureSpeechSettings(input);
  if (settings.mode !== previous.mode || settings.local_model !== previous.local_model || settings.emotion_enhancement !== previous.emotion_enhancement || !settings.enabled) {
    for (const { id } of getDb().prepare("SELECT id FROM speech_jobs WHERE status IN ('queued','generating')").all()) cancelSpeech(id);
  }
  return settings;
}
const apiControllers = new Map(), localJobs = new Set(), emotionControllers = new Map();
export function clearSpeechCache() {
  const result = clearGeneratedSpeech(getDb(), AUDIO_ROOT, new Set([...localJobs, ...apiControllers.keys()]));
  broadcast('speech_cache_cleared', result);
  const removed = new Set(result.ids);
  const affected = new Set(getDb().prepare('SELECT character_id,job_id,previous_job_id FROM standing_touch_speech').all()
    .filter(row => removed.has(row.job_id) || removed.has(row.previous_job_id)).map(row => row.character_id));
  for (const characterId of affected) broadcast('expression_standings_updated', {
    characterId, scope: 'touch-lines-speech', voiceChanged: true,
  });
  return result;
}
// Bulk portrait lines must not open hundreds of upstream requests at once.
// Also bound LLM emotion analysis before jobs reach the local GPU queue.
const remoteSpeechQueue = [];
let remoteSpeechActive = 0;
function scheduleRemoteSpeech(work) {
  return new Promise((resolve, reject) => {
    remoteSpeechQueue.push({ work, resolve, reject });
    drainRemoteSpeech();
  });
}
function drainRemoteSpeech() {
  while (remoteSpeechActive < 2 && remoteSpeechQueue.length) {
    const next = remoteSpeechQueue.shift();
    remoteSpeechActive++;
    Promise.resolve().then(next.work).then(next.resolve, next.reject).finally(() => {
      remoteSpeechActive--; drainRemoteSpeech();
    });
  }
}
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
  notifyStandingSpeech(id);
}
function notifyStandingSpeech(id) {
  for (const row of getDb().prepare('SELECT DISTINCT character_id FROM standing_touch_speech WHERE job_id=?').all(id)) {
    broadcast('expression_standings_updated', { characterId: row.character_id, scope: 'touch-lines-speech' });
  }
}
function enqueue(job) {
  localJobs.add(job.id);
  const controller = new AbortController();
  emotionControllers.set(job.id, controller);
  const cancelled = () => getSpeechJob(job.id)?.status === 'cancelled' || !getSpeechSettings().enabled || getSpeechSettings().mode !== 'local';
  const jobParams = JSON.parse(job.params);
  const prepareEmotion = async () => {
    if (cancelled()) throw new Error('语音已关闭或任务已取消');
    if (!jobParams.emotion_analysis) return;
    updateJob(job.id, 'generating');
    try {
      jobParams.emo_vector = await inferSpeechEmotion(job.text, jobParams.emotion_analysis, { signal: controller.signal });
      if (cancelled()) throw new Error('任务已取消');
      getDb().prepare('UPDATE speech_jobs SET params=? WHERE id=?').run(JSON.stringify(jobParams), job.id);
    } catch (error) {
      if (cancelled() || controller.signal.aborted) throw error;
      console.warn('[语音情感增强] 推断失败，使用自然朗读：', error.message);
    }
  };
  // Run remote analysis before acquiring the shared image/TTS GPU lease.
  const prepared = jobParams.emotion_analysis ? scheduleRemoteSpeech(prepareEmotion) : prepareEmotion();
  prepared.then(() => withSpeechGpu(async () => {
    if (cancelled()) throw new Error('语音已关闭或任务已取消');
    updateJob(job.id, 'generating');
    let sample = getDb().prepare('SELECT * FROM voice_samples WHERE id=?').get(job.sample_id);
    const { reference_design: design, emotion_analysis: analysis, ...params } = jobParams;
    if (design) {
      sample = await prepareVoiceReference(sample, design);
      getDb().prepare('UPDATE speech_jobs SET sample_id=? WHERE id=?').run(sample.id, job.id);
    }
    if (cancelled()) throw new Error('语音已关闭或任务已取消');
    const status = await ttsHealth();
    if (!status.online || !status.compatible || !status.ready) throw new Error(status.error || 'TTS 模型尚未安装或固定版本不匹配');
    if (params.emo_vector && status.emotion_vector_version !== 1) throw new Error('声音服务尚未更新，请在音色管理中重启声音服务后重试情感增强');
    const effects = params.voice_effects || {};
    const requiredEffectsVersion = ['thickness', 'clarity', 'air'].some(key => effects[key]) ? 2 : 1;
    if (Object.values(effects).some(value => value !== 0) && !(status.voice_effects_version >= requiredEffectsVersion)) {
      throw new Error('声音服务尚未更新，请在音色管理的服务维护中重启声音服务后重试');
    }
    const output = `generated/${job.id}.wav`;
    // The FIFO owns the adapter here; only a cold worker needs a load notice.
    // Warm synthesis and cached audio stay silent, including on completion.
    if (!status.loaded) broadcast('speech_preparing', { phase: 'model_load' });
    const serviceEffects = Object.fromEntries(Object.entries(effects).filter(([key, value]) => ['pitch', 'resonance', 'brightness'].includes(key) || value !== 0));
    // Built-in controls have already been baked into the reference. They are
    // never forwarded to the adapter or applied to generated speech again.
    const { voice_effects: ignoredEffects, ...synthesisParams } = params;
    await ttsRequest('/synthesize', { reference: sample.reference_path, output, text: job.text,
      ...synthesisParams, ...(!design ? { voice_effects: serviceEffects } : {}), model_version: job.model_version }, 600000);
    if (!fs.existsSync(audioPath(output))) throw new Error('TTS 没有生成音频，请检查两端音频目录配置');
    return output;
  }, cancelled)).then(output => updateJob(job.id, 'completed', null, output))
    .catch(error => updateJob(job.id, 'failed', error.message))
    .finally(() => { localJobs.delete(job.id); emotionControllers.delete(job.id); });
}
export function requestSpeech({ characterId, voiceId, sampleId, text, params, messageId, force = false, background = false }) {
  const db = getDb();
  if (!getSpeechSettings().enabled) throw new Error('请先在声音设置或酒馆的音色管理中启用语音朗读');
  if (getSpeechSettings().mode === 'api') return requestApiSpeech({ characterId, text, params, messageId, force, background });
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
  const draft = !messageId ? Object.fromEntries(['generation_params', 'voice_effects', 'speed'].filter(key => params?.[key] !== undefined).map(key => [key, params[key]])) : {};
  let actualParams = speechParams(voice ? { ...voice, ...draft } : params);
  const builtin = localVoiceSource(sample.id) === 'builtin';
  if (builtin) actualParams = { ...speechParams({ language: actualParams.language, generation_params: actualParams.generation_params }), reference_design: referenceDesign(actualParams) };
  const modelVersion = selectedLocalTtsModel().version;
  if (actualParams.language === 'ja') throw new Error('IndexTTS 2.0 支持中英文，请将语音语言调整为中文或英文');
  if (getSpeechSettings().emotion_enhancement) {
    const context = messageId ? speechEmotionContext(db, messageId, db.prepare('SELECT emoji_key FROM emoji_categories').all().map(row => row.emoji_key)) : { previous: null, next: null };
    const character = db.prepare('SELECT display_name,name FROM characters WHERE id=?').get(characterId);
    actualParams.emotion_analysis = { version: SPEECH_EMOTION_VERSION, speaker: character?.display_name || character?.name || 'assistant', ...context };
  }
  // A regeneration has its own cache namespace. Existing chat associations and
  // their completed files remain playable even when this new attempt fails.
  const key = speechCacheKey(cleaned, builtin ? baseVoiceSample(sample).content_hash : sample.content_hash, actualParams, modelVersion) + (force ? `:fresh:${randomUUID()}` : '');
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
export function speakMessage(characterId, messageId, { groupId } = {}) {
  const db = getDb();
  const message = db.prepare("SELECT * FROM messages WHERE id=? AND conversation_id=? AND role='assistant'").get(messageId, groupId ? `group_${groupId}` : `char_${characterId}`);
  // 奇遇附带的文字对白也有 event_id；只有没有 raw_id 的消息才是分享卡片。
  const isEventCard = message?.raw_id == null && message?.event_id != null;
  if (!message || isEventCard || ((groupId || message.speaker_character_id) && message.speaker_character_id !== characterId)) throw new Error('消息不存在、不是对白或不属于这个角色');
  const missingVoice = () => Object.assign(new Error('角色尚未配置声音，请前往角色详情的「声音设置」配置'), { code: 'VOICE_NOT_CONFIGURED' });
  if (getSpeechSettings().mode === 'api') {
    if (!getApiVoice(characterId)) throw missingVoice();
    return requestSpeech({ characterId, text: message.content, messageId: message.id });
  }
  const binding = db.prepare(`SELECT c.voice_id FROM character_voices c
    JOIN voices v ON v.id=c.voice_id AND v.character_id=c.character_id
    JOIN voice_samples s ON s.id=v.sample_id
    WHERE c.character_id=? AND c.enabled=1 AND s.reference_path IS NOT NULL`).get(characterId);
  if (!binding) throw missingVoice();
  return requestSpeech({ characterId, voiceId: binding.voice_id, text: message.content, messageId: message.id });
}
export function cancelSpeech(id) {
  const db = getDb();
  db.prepare("UPDATE speech_jobs SET status='cancelled', error='用户取消', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','generating')").run(id);
  apiControllers.get(id)?.abort();
  emotionControllers.get(id)?.abort();
  const result = publicJob(getSpeechJob(id));
  // Running work keeps the GPU lease until inference exits, even after cancellation.
  broadcast('speech_update', result);
  notifyStandingSpeech(id);
  return result;
}

function requestApiSpeech({ characterId, text, params, messageId, force = false, background = false }) {
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
  const key = apiSpeechCacheKey(characterId, cleaned, connection, profile, references.map(ref => ({ audio: `sha256:${ref.content_hash}`, text: ref.text }))) + (force ? `:fresh:${randomUUID()}` : '');
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
    const apiKey = getSetting('tts_api_key');
    const work = async () => {
      if (controller.signal.aborted || !getSpeechSettings().enabled || getSpeechSettings().mode !== 'api') throw new Error('语音已关闭或任务已取消');
      if (background && !db.prepare('SELECT id FROM characters WHERE id=?').get(characterId)) throw new Error('角色已删除');
      updateJob(job.id, 'generating');
      const encoded = await encodeApiReferences(references);
      return fetchApiSpeech(cleaned, connection, profile, apiKey, controller.signal, encoded);
    };
    (background ? scheduleRemoteSpeech(work) : work()).then(async ({ buffer, extension }) => {
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
