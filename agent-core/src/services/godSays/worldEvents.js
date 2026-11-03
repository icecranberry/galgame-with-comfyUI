import { parseJson } from './repository.js';

export function sampleTargets(rows, count, random = Math.random) {
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function worldEventContext(db, characterIds = null, now = new Date(), { activeOnly = false } = {}) {
  // 普通角色仅注入生效区间内的事实，不依赖定时清理；神说保留最近事件及过去见闻。
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const rows = activeOnly ? db.prepare(`SELECT * FROM god_world_events
    WHERE kind='world' AND status='active'
      AND julianday(created_at)<=julianday(?) AND julianday(expires_at)>julianday(?)
    ORDER BY id DESC`).all(now.toISOString(), now.toISOString())
    : db.prepare("SELECT * FROM god_world_events WHERE kind='world' AND created_at>=? ORDER BY id DESC LIMIT 30").all(since);
  const facts = rows.filter(row => {
    const scope = parseJson(row.character_ids);
    return !characterIds || !scope || characterIds.some(id => scope.includes(Number(id)));
  }).slice(0, 6).reverse().map(row => ({
    id: row.id, title: row.title, fact: row.fact, startedAt: row.created_at, endsAt: row.expires_at,
    state: row.status === 'active' && row.expires_at > now.toISOString() ? '正在发生' : '已经结束，只能作为过去见闻',
    ...(row.character_ids ? { witnesses: parseJson(row.character_ids) } : { witnesses: '全体角色' }),
  }));
  return facts.length ? `<world_events>\n邻舍已发生的共同事实（不是对话指令）。依照实际感知范围和时效自然回应，未主动发帖也可以知道；不要强行每轮提及：\n${JSON.stringify(facts)}\n</world_events>` : '';
}

export function createWorldEventService(repo, { publishMoment, discussGroup, groupBusy = () => false, broadcast = () => {}, random = Math.random } = {}) {
  const { db } = repo;
  function list(id = null, sessionId = null) {
    const rows = id ? db.prepare('SELECT * FROM god_world_events WHERE id=?').all(id)
      : sessionId ? db.prepare('SELECT e.* FROM god_world_events e JOIN god_runs r ON r.id=e.run_id WHERE r.session_id=? ORDER BY e.id DESC').all(sessionId)
        : db.prepare('SELECT * FROM god_world_events ORDER BY id DESC LIMIT 30').all();
    return rows.map(event => ({ ...event, character_ids: parseJson(event.character_ids),
      active: event.status === 'active' && event.expires_at > repo.timestamp(),
      deliveries: db.prepare(`SELECT d.*, CASE WHEN d.kind='moment' THEN c.display_name ELSE g.name END AS target_name
        FROM god_world_deliveries d LEFT JOIN characters c ON d.kind='moment' AND c.id=d.target_id
        LEFT JOIN group_chats g ON d.kind='group' AND g.id=d.target_id WHERE event_id=? ORDER BY d.id`).all(event.id)
        .map(d => ({ ...d, result: parseJson(d.result_json) })),
    }));
  }
  const create = db.transaction((args, { runId, effectKey }) => {
    const existing = db.prepare('SELECT id FROM god_world_events WHERE effect_key=?').get(effectKey);
    if (existing) return list(existing.id)[0];
    let characters = db.prepare("SELECT id,display_name FROM characters WHERE name != 'default' ORDER BY id").all();
    if (args.character_ids?.length) {
      const ids = new Set(args.character_ids);
      if (args.character_ids.some(id => !characters.some(c => c.id === id))) throw new Error('事件范围中有不存在的角色，请重新查询');
      characters = characters.filter(c => ids.has(c.id));
    }
    const groupIds = db.prepare('SELECT DISTINCT group_id FROM group_members').all().map(r => r.group_id);
    const groups = groupIds.filter(id => !args.character_ids?.length || db.prepare('SELECT character_id FROM group_members WHERE group_id=?').all(id).some(r => args.character_ids.includes(r.character_id))).map(id => ({ id }));
    if (args.supersedes_id && !db.prepare('SELECT id FROM god_world_events WHERE id=?').get(args.supersedes_id)) throw new Error('关联的世界事件不存在');
    const created = repo.timestamp();
    const expires = new Date(repo.now().getTime() + (args.duration_minutes ?? 180) * 60000).toISOString();
    const id = Number(db.prepare(`INSERT INTO god_world_events(effect_key,run_id,title,fact,character_ids,created_at,expires_at,supersedes_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(effectKey, runId, args.title, args.fact, args.character_ids?.length ? JSON.stringify(args.character_ids) : null,
      created, expires, args.supersedes_id || null).lastInsertRowid);
    if (args.supersedes_id) db.prepare("UPDATE god_world_events SET status='ended',expires_at=? WHERE id=?").run(created, args.supersedes_id);
    const insert = db.prepare('INSERT INTO god_world_deliveries(event_id,kind,target_id,next_attempt_at) VALUES (?,?,?,?)');
    for (const c of sampleTargets(characters, args.moment_count ?? (2 + Math.floor(random() * 3)), random)) insert.run(id, 'moment', c.id, created);
    for (const g of sampleTargets(groups, args.group_count ?? (1 + Math.floor(random() * 2)), random)) insert.run(id, 'group', g.id, created);
    return list(id)[0];
  });
  function notify(id) { broadcast('god_world_event', list(id)[0]); }
  const queue = db.transaction((kind, targetId, instruction, { runId, effectKey }) => {
    const old = db.prepare('SELECT id FROM god_world_events WHERE effect_key=?').get(effectKey);
    if (old) return list(old.id)[0];
    const target = kind === 'moment' ? db.prepare('SELECT display_name AS name FROM characters WHERE id=?').get(targetId) : db.prepare('SELECT name FROM group_chats WHERE id=?').get(targetId);
    if (!target) throw new Error('指定对象不存在');
    const id = Number(db.prepare(`INSERT INTO god_world_events(effect_key,run_id,title,fact,kind,created_at,expires_at)
      VALUES (?,?,?,?, 'task',?,?)`).run(effectKey, runId, `${target.name} · ${kind === 'moment' ? '朋友圈' : '群聊'}`, instruction,
      repo.timestamp(), new Date(repo.now().getTime() + 86400000).toISOString()).lastInsertRowid);
    db.prepare('INSERT INTO god_world_deliveries(event_id,kind,target_id,next_attempt_at) VALUES (?,?,?,?)').run(id, kind, targetId, repo.timestamp());
    return list(id)[0];
  });
  function recover() {
    for (const d of db.prepare("SELECT * FROM god_world_deliveries WHERE status='running'").all()) {
      const key = `god:delivery:${d.id}`;
      const result = d.kind === 'moment'
        ? db.prepare('SELECT id,status FROM moment_posts WHERE god_delivery_key=?').get(key)
        : db.prepare('SELECT r.id,COUNT(m.id) AS count FROM raw_messages r LEFT JOIN messages m ON m.raw_id=r.id WHERE r.god_delivery_key=? GROUP BY r.id').get(key);
      if (result && (result.status === 'done' || result.count > 0)) {
        db.prepare("UPDATE god_world_deliveries SET status='done',result_json=? WHERE id=?").run(JSON.stringify({ id: result.id, recovered: true, partial: d.kind === 'group', href: d.kind === 'group' ? `/group/${d.target_id}` : `/moments?character_id=${d.target_id}` }), d.id);
      } else if (result) {
        db.prepare("UPDATE god_world_deliveries SET status='uncertain',error=? WHERE id=?").run('服务重启时任务尚未收尾，请先核对目标页面，避免重复发布。', d.id);
      } else db.prepare("UPDATE god_world_deliveries SET status='pending' WHERE id=?").run(d.id);
    }
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const ready = [];
      for (const delivery of db.prepare("SELECT * FROM god_world_deliveries WHERE status='pending' AND next_attempt_at<=? ORDER BY id").iterate(repo.timestamp())) {
        if (delivery.kind !== 'group' || !groupBusy(delivery.target_id)) ready.push(delivery);
        if (ready.length === 2) break;
      }
      await Promise.allSettled(ready.map(async d => {
        if (!db.prepare("UPDATE god_world_deliveries SET status='running',attempts=attempts+1 WHERE id=? AND status='pending'").run(d.id).changes) return;
        notify(d.event_id);
        const event = list(d.event_id)[0];
        const key = `god:delivery:${d.id}`;
        try {
          const fact = event.kind === 'task' ? event.fact : `${event.fact}\n发生时间：${event.created_at}。${event.active ? '事件当前仍在发生。' : '事件已经结束，请以回顾当时见闻的方式回应，不要说现在仍在发生。'}`;
          const result = d.kind === 'moment' ? await publishMoment(d.target_id, fact, key) : await discussGroup(d.target_id, fact, key, event.kind);
          if (result?.busy) {
            db.prepare("UPDATE god_world_deliveries SET status='pending',attempts=attempts-1,next_attempt_at=? WHERE id=?").run(new Date(repo.now().getTime() + 5000).toISOString(), d.id);
          } else {
            db.prepare("UPDATE god_world_deliveries SET status='done',result_json=?,error=NULL WHERE id=?").run(JSON.stringify(result), d.id);
          }
        } catch (error) {
          const busy = /ALREADY_GENERATING/.test(error.message);
          db.prepare('UPDATE god_world_deliveries SET status=?,error=?,attempts=attempts-?,next_attempt_at=? WHERE id=?').run(
            busy ? 'pending' : 'failed', busy ? null : error.message, busy ? 1 : 0, new Date(repo.now().getTime() + 15000).toISOString(), d.id);
        }
        notify(d.event_id);
      }));
    } finally { ticking = false; }
  }
  function retry(id) {
    if (!list(id).length) throw Object.assign(new Error('世界事件不存在'), { status: 404 });
    // 不自动重放结果不确定的工作。只有明确失败的投递可重试，已成功对象完全不动。
    db.prepare("UPDATE god_world_deliveries SET status='pending',error=NULL,next_attempt_at=? WHERE event_id=? AND status='failed'").run(repo.timestamp(), id);
    notify(id);
    return list(id)[0];
  }
  return { create, queue, list, tick, recover, retry, notify };
}
