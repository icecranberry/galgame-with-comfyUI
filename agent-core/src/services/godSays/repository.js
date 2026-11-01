import { randomUUID, createHash } from 'node:crypto';
import { getLocalDateKey } from '../../utils/localDate.js';
import { angelOutfits, angelStandings, cleanAngelOutfits } from './angelWardrobe.js';

export const GOD_TIME_ZONE = 'Asia/Shanghai';
export const ANGEL_PERSONA = `你是常驻云庭的天使，是神与邻舍世界之间的信使。用户就是与你交谈的神，你自然地称呼用户为“吾神”。你温柔、认真、有自己的好奇心和小情绪，偶尔有些笨拙；不要每句话都使用庄严的仪式措辞。你有自己的日程，会整理星图、巡视云庭、读信和休息；神呼唤时总能回应。日程只是安排，不把尚未发生的活动当成已经完成。聊天时像一个具体的人，执行神谕时诚实而可靠。能力不足时用自己的口吻说清做到了什么、还做不到什么，不假装成功。你的私人记忆只属于你与神，不主动泄露给普通居民。`;

export const parseJson = (text, fallback = null) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };
export const effectKey = (runId, name, args) => `${runId}:${createHash('sha256').update(name + ':' + stableJson(args)).digest('hex')}`;
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const publicMessage = row => row && ({ ...row, tool_calls: parseJson(row.tool_calls, []), provider_json: undefined });

export function createGodRepository(db, { now = () => new Date(), timeZone = GOD_TIME_ZONE } = {}) {
  const timestamp = () => now().toISOString();
  const day = () => getLocalDateKey(now(), timeZone);
  function emit(runId, type, data) {
    const seq = Number(db.prepare('INSERT INTO god_run_events(run_id,type,data) VALUES (?,?,?)').run(runId, type, JSON.stringify(data)).lastInsertRowid);
    return { seq, type, data };
  }
  function ensureAngel() {
    db.prepare('INSERT OR IGNORE INTO god_angel(id,display_name,persona) VALUES (1,?,?)').run('天使', ANGEL_PERSONA);
    const row = db.prepare('SELECT * FROM god_angel WHERE id=1').get();
    return { ...row, schedule: parseJson(row.schedule_json, []), outfits: angelOutfits(row), standings: angelStandings(row) };
  }
  function today() {
    const key = day();
    db.prepare("UPDATE god_sessions SET status='closing' WHERE day < ? AND status='open'").run(key);
    db.prepare('INSERT OR IGNORE INTO god_sessions(day,time_zone,created_at) VALUES (?,?,?)').run(key, timeZone, timestamp());
    return db.prepare('SELECT * FROM god_sessions WHERE day=?').get(key);
  }
  function message(run, role, content = '', extra = {}) {
    const id = Number(db.prepare(`INSERT INTO god_messages(session_id,run_id,role,content,reasoning,tool_calls,tool_call_id,provider_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(run.session_id, run.id, role, content, extra.reasoning || '',
      extra.tool_calls ? JSON.stringify(extra.tool_calls) : null, extra.tool_call_id || null,
      extra.provider ? JSON.stringify(extra.provider) : null, extra.status || 'done', timestamp()).lastInsertRowid);
    const row = db.prepare('SELECT * FROM god_messages WHERE id=?').get(id);
    emit(run.id, 'message', publicMessage(row));
    return row;
  }
  const start = db.transaction((clientId, input, images = []) => {
    const existing = db.prepare('SELECT * FROM god_runs WHERE client_id=?').get(clientId);
    if (existing) {
      if (existing.deleted_at) throw Object.assign(new Error('这轮对话已删除，请使用新的发送标识'), { status: 409 });
      if (existing.input !== input) throw Object.assign(new Error('这次发送标识已用于另一条消息'), { status: 409 });
      return { run: existing, duplicate: true };
    }
    const session = today();
    if (db.prepare("SELECT id FROM god_runs WHERE session_id=? AND status='running'").get(session.id)) {
      throw Object.assign(new Error('天使仍在回应上一句话，请稍候或先停止'), { status: 409 });
    }
    const imagesJson = JSON.stringify(Array.isArray(images) ? images : []);
    const run = { id: randomUUID(), session_id: session.id, client_id: clientId, input, images_json: imagesJson, status: 'running', created_at: timestamp() };
    db.prepare('INSERT INTO god_runs(id,session_id,client_id,input,images_json,created_at) VALUES (?,?,?,?,?,?)').run(run.id, session.id, clientId, input, imagesJson, run.created_at);
    message(run, 'user', input);
    return { run, duplicate: false };
  });
  function updateMessage(id, patch) {
    const row = db.prepare('SELECT * FROM god_messages WHERE id=?').get(id);
    const updated = { ...row, ...patch };
    db.prepare('UPDATE god_messages SET content=?,reasoning=?,tool_calls=?,provider_json=?,status=? WHERE id=?').run(
      updated.content, updated.reasoning, updated.tool_calls, updated.provider_json, updated.status, id);
    emit(row.run_id, 'message', publicMessage(updated));
    return updated;
  }
  const delta = db.transaction((id, field, text) => {
    if (!['content', 'reasoning'].includes(field)) throw new Error('Invalid message field');
    db.prepare(`UPDATE god_messages SET ${field}=${field} || ? WHERE id=?`).run(text, id);
    const row = db.prepare('SELECT run_id FROM god_messages WHERE id=?').get(id);
    emit(row.run_id, 'delta', { id, field, text });
  });
  function finish(runId, status, error = null) {
    db.prepare('UPDATE god_runs SET status=?,error=?,finished_at=? WHERE id=?').run(status, error, timestamp(), runId);
    emit(runId, 'run_end', { id: runId, status, error });
  }
  function recover() {
    for (const run of db.prepare("SELECT * FROM god_runs WHERE status='running'").all()) {
      db.prepare("UPDATE god_messages SET status='interrupted' WHERE run_id=? AND status='streaming'").run(run.id);
      finish(run.id, 'interrupted', '上次回应因服务重启中断；已经执行的工作仍然保留。');
    }
    for (const call of db.prepare("SELECT id,result_json FROM god_tool_calls WHERE status='running'").all()) {
      const saved = parseJson(call.result_json);
      if (saved) db.prepare("UPDATE god_tool_calls SET status='done',result_json=? WHERE id=?").run(JSON.stringify(saved.ok === undefined ? { ok: true, value: saved } : saved), call.id);
      else db.prepare("UPDATE god_tool_calls SET status='uncertain' WHERE id=?").run(call.id);
    }
    db.prepare("UPDATE god_sessions SET summary_status='pending' WHERE summary_status='running'").run();
  }
  const deleteTurn = db.transaction(id => {
    const run = db.prepare('SELECT * FROM god_runs WHERE id=?').get(id);
    if (!run) throw Object.assign(new Error('这轮对话不存在'), { status: 404 });
    if (run.deleted_at) return { ok: true, session_id: run.session_id };
    const session = db.prepare('SELECT * FROM god_sessions WHERE id=?').get(run.session_id);
    if (db.prepare("SELECT 1 FROM god_runs WHERE session_id=? AND status='running'").get(run.session_id)) {
      throw Object.assign(new Error('请等待本日回应结束或先停止，再删除对话'), { status: 409 });
    }
    if (session.summary_status === 'running') throw Object.assign(new Error('这一天的记忆正在整理，请稍后再删除'), { status: 409 });
    db.prepare('DELETE FROM god_messages WHERE run_id=?').run(id);
    db.prepare('DELETE FROM god_run_events WHERE run_id=?').run(id);
    db.prepare('DELETE FROM god_tool_calls WHERE run_id=?').run(id);
    // 保留幂等墓碑及世界事件关联，删除对话不撤销已受理的业务操作。
    db.prepare("UPDATE god_runs SET input='',error=NULL,deleted_at=? WHERE id=?").run(timestamp(), id);
    db.prepare(`UPDATE god_sessions SET summary='',memories_json='[]',summary_status='pending',summary_error=NULL,
      summary_attempts=0,summary_attempt_at=NULL,context_summary='',context_last_message=0 WHERE id=?`).run(run.session_id);
    return { ok: true, session_id: run.session_id };
  });
  function updateAngel(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('角色资料格式无效'), { status: 400 });
    const name = typeof input.display_name === 'string' ? input.display_name.trim() : '';
    const persona = typeof input.persona === 'string' ? input.persona.trim() : '';
    const current = ensureAngel();
    const storedVad = parseJson(current.emotion_baseline);
    const validVad = value => value && ['valence', 'arousal', 'dominance'].every(key => Number.isFinite(value[key]) && value[key] <= 1 && value[key] >= (key === 'valence' ? -1 : 0));
    const vad = input.emotion_baseline ?? (validVad(storedVad) ? storedVad : { valence: 0.5, arousal: 0.5, dominance: 0.5 });
    if (!name || name.length > 40 || !persona || persona.length > 50000 || !vad ||
      !['valence', 'arousal', 'dominance'].every(key => Number.isFinite(vad[key]) && vad[key] <= 1 && vad[key] >= (key === 'valence' ? -1 : 0))) {
      throw Object.assign(new Error('请填写角色名、完整人设及有效情绪基线'), { status: 400 });
    }
    const outfits = input.outfits === undefined ? current.scene_outfits_json : JSON.stringify(cleanAngelOutfits(input.outfits));
    db.prepare(`UPDATE god_angel SET display_name=?,persona=?,emotion_baseline=?,persona_generated_at=?,persona_error=NULL,
      schedule_generated_at=CASE WHEN persona<>? OR scene_outfits_json<>? THEN NULL ELSE schedule_generated_at END,
      scene_outfits_json=? WHERE id=1`)
      .run(name, persona, JSON.stringify({ valence: vad.valence, arousal: vad.arousal, dominance: vad.dominance }), timestamp(), persona, outfits, outfits);
    return { ...ensureAngel(), persona_changed: current.persona !== persona };
  }
  function snapshot(sessionId) {
    const session = sessionId ? db.prepare('SELECT * FROM god_sessions WHERE id=?').get(sessionId) : today();
    if (!session) throw Object.assign(new Error('这一天的对话不存在'), { status: 404 });
    return {
      session, angel: ensureAngel(),
      messages: db.prepare('SELECT * FROM god_messages WHERE session_id=? ORDER BY id').all(session.id).map(publicMessage),
      runs: db.prepare('SELECT * FROM god_runs WHERE session_id=? AND deleted_at IS NULL ORDER BY created_at,rowid').all(session.id).map(r => ({ ...r, images: parseJson(r.images_json, []) })),
      calls: db.prepare('SELECT c.* FROM god_tool_calls c JOIN god_runs r ON r.id=c.run_id WHERE r.session_id=? ORDER BY c.created_at,c.rowid').all(session.id).map(c => ({ ...c, args: parseJson(c.args_json, {}), result: parseJson(c.result_json) })),
      cursor: db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM god_run_events').get().seq,
      today: day(),
    };
  }
  return { db, now, day, timeZone, timestamp, today, ensureAngel, updateAngel, deleteTurn, emit, start, message, updateMessage, delta, finish, recover, snapshot };
}
