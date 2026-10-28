import { readTouchLines } from './standingTouchLines.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const active = status => status === 'queued' || status === 'generating';

// Persist only associations. The speech service owns jobs and audio files, which
// can also belong to chat messages and must never be deleted by dialogue edits.
export function createStandingTouchSpeechService({ db, profile, requestSpeech, fileExists, audioUrl, emit = () => {} }) {
  const job = id => id ? db.prepare('SELECT * FROM speech_jobs WHERE id=?').get(id) : null;
  const playable = value => value?.status === 'completed' && value.output_path && fileExists(value.output_path);
  function read(id) {
    const state = readTouchLines(db, id);
    const voice = profile(Number(id));
    const rows = db.prepare('SELECT * FROM standing_touch_speech WHERE character_id=?').all(id);
    const lines = Object.fromEntries(Object.entries(state.lines || {}).map(([part, texts]) => [part, texts.map((text, index) => {
      const row = rows.find(r => r.part === part && r.line_index === index && r.text === text && r.voice_key === voice.key);
      const current = job(row?.job_id), previous = job(row?.previous_job_id);
      const sound = playable(current) ? current : playable(previous) ? previous : null;
      const missing = current?.status === 'completed' && !playable(current);
      return { text, status: row?.error || missing ? 'failed' : current?.status || 'empty',
        audio_url: sound ? audioUrl(sound.output_path) : null,
        error: row?.error || (missing ? '音频文件已丢失，请重新生成' : current?.error) || null, job_id: current?.id || null };
    })]));
    return { ...state, speech: { enabled: voice.enabled, configured: voice.configured, reason: voice.reason || null, lines } };
  }
  function generate(id, { expectedVersion, part, index, force = false } = {}) {
    id = Number(id);
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT id FROM characters WHERE id=?').get(id)) fail('角色不存在', 404);
    const state = read(id), voice = profile(id);
    if (expectedVersion !== state.version) fail('台词已更新，请重新读取后再生成语音', 409);
    if (state.status === 'generating') fail('台词正在生成，请完成后再生成语音', 409);
    if (typeof force !== 'boolean') fail('重新生成参数无效');
    if ((part !== undefined || index !== undefined) && (!Object.hasOwn(state.lines || {}, part) || !Number.isSafeInteger(index) || !state.lines[part]?.[index])) fail('台词位置无效');
    const targets = Object.entries(state.speech.lines).flatMap(([key, lines]) => lines.map((line, i) => ({ part: key, index: i, ...line })))
      .filter(line => part === undefined || line.part === part && line.index === index);
    const summary = { started: 0, skipped: 0, failed: 0 };
    if (!voice.enabled || !voice.configured) return { ...state, summary: { ...summary, skipped: targets.length } };
    for (const line of targets) {
      if (active(line.status) || !force && line.audio_url) { summary.skipped++; continue; }
      const old = db.prepare('SELECT * FROM standing_touch_speech WHERE character_id=? AND part=? AND line_index=?').get(id, line.part, line.index);
      const matches = old?.text === line.text && old?.voice_key === voice.key;
      const previous = matches ? (playable(job(old.job_id)) ? old.job_id : playable(job(old.previous_job_id)) ? old.previous_job_id : null) : null;
      let next = null, error = null;
      try { next = requestSpeech({ characterId: id, voiceId: voice.voiceId, text: line.text, force, background: true }); summary.started++; }
      catch (e) { error = String(e.message || '语音生成失败').slice(0, 300); summary.failed++; }
      db.prepare(`INSERT INTO standing_touch_speech(character_id,part,line_index,text,voice_key,job_id,previous_job_id,error) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(character_id,part,line_index) DO UPDATE SET text=excluded.text,voice_key=excluded.voice_key,
          job_id=excluded.job_id,previous_job_id=excluded.previous_job_id,error=excluded.error`)
        .run(id, line.part, line.index, line.text, voice.key, next?.id || null, previous, error);
    }
    emit('expression_standings_updated', { characterId: id, scope: 'touch-lines-speech' });
    return { ...read(id), summary };
  }
  function fill() {
    const result = { started: 0, skipped: 0, failed: 0 };
    for (const { id } of db.prepare('SELECT id FROM characters ORDER BY id').all()) {
      const state = read(id);
      if (!state.speech.enabled || !state.speech.configured || state.status === 'generating' || !Object.values(state.lines || {}).some(lines => lines.length)) { result.skipped++; continue; }
      const { summary } = generate(id, { expectedVersion: state.version });
      result.started += summary.started;
      result.failed += summary.failed;
      if (!summary.started && !summary.failed) result.skipped++;
    }
    return result;
  }
  return { read, generate, fill };
}
