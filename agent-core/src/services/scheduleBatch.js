import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { listResidences, readCohabitationPlan, saveCohabitationPlan, readTemplate, saveAppliedResidences } from '../db/cohabitationRepository.js';
import { enterScheduleBatch, isScheduleBatchRunning } from './scheduleGenerationLock.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from './scheduleGenerator.js';
import { writeScheduleTemplate } from './cohabitationPersistence.js';
import { planResidence } from './cohabitationPlanner.js';
import { splitResidenceSleep, assertCompleteDay, overlaps, reconcileSharedActivities } from './cohabitationSchedule.js';
import { reapplyActiveEventSchedule, reserveEventTime } from './eventSchedule.js';
import { intervals } from './cohabitationSchedule.js';
import { broadcast } from './unifiedStreamBus.js';

let active = null;
let initialization = null;
const sqlTime = date => date.toISOString().slice(0, 19).replace('T', ' ');
const readArray = raw => { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };

/** 明确约定和奇遇占用属于当天硬约束；普通全天模板不是“全天没空”。 */
export function protectedScheduleActivities(db, ids, date = getLocalDateKey()) {
  const result = {};
  for (const id of ids) {
    const row = db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id=? AND schedule_date=?').get(id, date);
    const all = readArray(row?.schedule_json);
    const eventBindings = db.prepare("SELECT choice_history FROM character_events WHERE character_id=? AND status IN ('pending','open','engaged')").all(id)
      .flatMap(e => readArray(e.choice_history).slice(0, 1).map(h => h.scheduleBinding?.activity).filter(Boolean));
    const fixed = all.filter(a => a.edited || eventBindings.some(e => e.activity === a.activity && e.location === a.location));
    for (const pending of db.prepare("SELECT activity_json FROM pending_schedule_changes WHERE character_id=? AND target_date=? AND status='pending'").all(id, date)) {
      try { fixed.push(JSON.parse(pending.activity_json)); } catch { /* invalid old queued change */ }
    }
    result[id] = fixed;
  }
  return result;
}

function fixedFingerprint(fixed) {
  return JSON.stringify(Object.entries(fixed).map(([id, acts]) => [id, acts.map(a => ({ startTime: a.startTime, endTime: a.endTime, activity: a.activity, location: a.location, description: a.description }))]));
}

function assertSharedActivities(schedules, events) {
  for (const event of events) for (const id of event.participantIds) {
    const actual = schedules[id]?.filter(a => a.sharedEventId === event.sharedEventId) || [];
    if (!actual.length || actual.some(a => a.location !== event.location || JSON.stringify(a.participantIds) !== JSON.stringify(event.participantIds))
      || intervals(event).some(([s, e]) => !actual.some(a => intervals(a).some(([x, y]) => x === s && y === e)))) throw new Error('共同活动未在所有参与者日程中完整落实');
  }
}

export function getScheduleBatchStatus(db = getDb()) {
  const plan = active?.plan || readCohabitationPlan(db);
  if (!plan) return { processing: false };
  const planningRooms = plan.rooms.filter(r => r.memberIds.length >= 2 && r.memberIds.some(id => plan.characterIds.includes(id)));
  return { processing: Boolean(active), cancelled: plan.status === 'cancelled', phase: plan.phase,
    current: Object.keys(plan.drafts || {}).length, lastCompleted: Object.keys(plan.drafts || {}).length,
    total: plan.characters.length, currentName: active?.currentName || '', status: plan.status, error: plan.error || '',
    roomCurrent: planningRooms.filter(r => (plan.completedRoomIds || []).includes(r.id)).length, roomTotal: planningRooms.length };
}

export function cancelScheduleBatch() { if (active) active.cancelled = true; }

function nextRefresh(now, random) {
  const next = new Date(now);
  next.setDate(next.getDate() + Math.max(1, Math.min(3, config.features.scheduleRefreshDays || 1)));
  next.setHours(0, 0, 0, 0);
  return sqlTime(new Date(next.getTime() + Math.floor(random() * 4 * 3600_000)));
}

/** 不提供对外子集重置接口；小范围实测由独立数据库控制角色范围。 */
export function startScheduleBatch({ kind = 'manual', direction = '', resume = false, db = getDb(),
  planner = planResidence, generator = generateSchedule, random = Math.random, now = new Date(), onProgress } = {}) {
  const release = enterScheduleBatch();
  let plan;
  try {
    const previous = readCohabitationPlan(db);
    if (resume && previous && !previous.invalidated && ['running', 'failed'].includes(previous.status) && previous.date === getLocalDateKey(now)) plan = previous;
    else {
      if (resume && previous) direction = previous.direction;
      const characters = db.prepare(`SELECT * FROM characters WHERE name!='default' ${kind === 'automatic' ? 'AND schedule_enabled=1' : ''} ORDER BY id`).all();
      if (!characters.length) throw Object.assign(new Error('没有需要生成日程的角色'), { status: 404 });
      const rooms = listResidences(db);
      for (let i = rooms.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
      }
      const characterIds = characters.map(c => c.id);
      // 关闭自动重排的角色沿用旧模板；已经与这些角色确认的共同活动也继续履行。
      const frozenSchedules = kind === 'automatic' ? Object.fromEntries(db.prepare("SELECT id FROM characters WHERE name!='default' AND schedule_enabled=0").all()
        .map(c => [c.id, readTemplate(db, c.id)]).filter(([, schedule]) => schedule.length)) : {};
      const carried = new Map();
      for (const schedule of Object.values(frozenSchedules)) for (const event of schedule) {
        if (event.sharedEventId && event.participantIds?.some(id => characterIds.includes(id))) {
          carried.set(event.sharedEventId, { ...event, startTime: event.sharedStartTime || event.startTime, endTime: event.sharedEndTime || event.endTime });
        }
      }
      plan = { id: randomUUID(), kind, date: getLocalDateKey(now), direction, status: 'running', phase: 'cohabitation',
        characters, characterIds, rooms,
        frozenSchedules,
        planningCharacters: db.prepare("SELECT id,display_name,short_prompt FROM characters WHERE name!='default' ORDER BY id").all(),
        relationships: db.prepare("SELECT from_character_id,to_character_id,relationship_text FROM character_relationships WHERE relationship_text!=''").all(),
        fixed: protectedScheduleActivities(db, characterIds, getLocalDateKey(now)), events: [...carried.values()], lockedSharedEventIds: [...carried.keys()], completedRoomIds: [], drafts: {} };
      db.transaction(() => {
        // 旧版本的成功快照先保留，避免新草稿覆盖后丢失已生效的比较基准。
        if (previous?.status === 'done') saveAppliedResidences(db, previous.rooms);
        db.prepare('DELETE FROM cohabitation_plan').run(); saveCohabitationPlan(db, plan);
      })();
    }
    plan.status = 'running'; plan.error = ''; saveCohabitationPlan(db, plan);
  } catch (error) { release(); throw error; }
  const control = { plan, cancelled: false, currentName: '', promise: null };
  active = control;
  const report = (data = {}) => {
    const status = { ...getScheduleBatchStatus(db), ...data };
    broadcast('schedule_reset_progress', status); onProgress?.(status);
  };
  const check = () => { if (control.cancelled) throw Object.assign(new Error('已取消，原日程保持不变'), { cancelled: true }); };
  report({ status: 'generating' });
  control.promise = Promise.resolve().then(async () => {
    const fixedEvents = Object.entries(plan.fixed).flatMap(([id, acts]) => acts.map(a => ({ ...a, participantIds: [Number(id)] })));
    for (const originalRoom of plan.rooms) {
      check();
      if (plan.completedRoomIds.includes(originalRoom.id)) continue;
      const room = originalRoom;
      if (room.memberIds.length >= 2 && room.memberIds.some(id => plan.characterIds.includes(id))) {
        control.currentName = room.name;
        report({ phase: 'cohabitation', character_name: room.name, status: 'generating' });
        const events = await planner({ room, characters: plan.planningCharacters || plan.characters, eligibleCharacterIds: plan.characterIds, relationships: plan.relationships,
          events: plan.events, fixed: fixedEvents, direction: plan.direction, batchId: plan.id });
        check(); plan.events.push(...events);
      }
      plan.completedRoomIds.push(originalRoom.id); saveCohabitationPlan(db, plan);
    }
    plan.phase = 'schedules'; saveCohabitationPlan(db, plan);
    for (const character of plan.characters) {
      check();
      if (plan.drafts[character.id]) continue;
      control.currentName = character.display_name;
      report({ phase: 'running', character_name: character.display_name, current: Object.keys(plan.drafts).length + 1, status: 'generating' });
      const room = plan.rooms.find(r => r.memberIds.includes(character.id)) || null;
      const events = plan.events.filter(e => e.participantIds.includes(character.id));
      const lockedSharedEventIds = plan.lockedSharedEventIds || plan.events.filter(e => !e.sharedEventId?.startsWith(`${plan.id}:`)).map(e => e.sharedEventId);
      const result = await generator(character, plan.direction, { persist: false, resident: true, deferSharedActivities: true, lockedSharedEventIds, cohabitation: { room, events } });
      check();
      const schedule = JSON.parse(result.schedule_json);
      assertCompleteDay(schedule);
      plan.drafts[character.id] = schedule;
      saveCohabitationPlan(db, plan);
      report({ phase: 'running', character_name: character.display_name, status: 'prepared' });
    }
    check();
    if (getLocalDateKey() !== plan.date) throw new Error('生成期间已跨日，本轮草稿保留；请启动新一轮日程');
    plan.phase = 'sleep'; report({ status: 'generating' });
    const names = Object.fromEntries((plan.planningCharacters || plan.characters).map(c => [c.id, c.display_name]));
    const lockedIds = plan.lockedSharedEventIds || plan.events.filter(e => !e.sharedEventId?.startsWith(`${plan.id}:`)).map(e => e.sharedEventId);
    const reconciled = reconcileSharedActivities({ ...plan.frozenSchedules, ...plan.drafts }, plan.events, plan.fixed, lockedIds, Object.keys(plan.frozenSchedules || {}).map(Number));
    const schedules = splitResidenceSleep(reconciled.schedules, plan.rooms, names);
    // 失败重试仍从原提案和原草稿协调，不累计移动距离。
    const proposedEvents = plan.events;
    for (const id of plan.characterIds) assertCompleteDay(schedules[id]);
    assertSharedActivities(schedules, reconciled.events);
    plan.events = reconciled.events;
    plan.adjustments = reconciled.adjustments;
    for (const adjustment of plan.adjustments) console.info(`[scheduleBatch] 共同活动协调 ${adjustment.sharedEventId} ${adjustment.from.join('-')} -> ${adjustment.to?.join('-') || '无共同空档，省略本轮提案'}`);
    const next = nextRefresh(new Date(), random);
    try { db.transaction(() => {
      check();
      const freshFixed = protectedScheduleActivities(db, plan.characterIds, plan.date);
      if (fixedFingerprint(freshFixed) !== fixedFingerprint(plan.fixed)) { plan.invalidated = true; throw new Error('生成期间已有约定发生变化，原日程保留，请重新规划'); }
      for (const [id, frozen] of Object.entries(plan.frozenSchedules || {})) {
        if (JSON.stringify(readTemplate(db, id)) !== JSON.stringify(frozen)) { plan.invalidated = true; throw new Error('生成期间室友的旧日程发生变化，请重新规划'); }
        if (JSON.stringify(schedules[id]) !== JSON.stringify(frozen)) writeScheduleTemplate(db, id, schedules[id]);
      }
      for (const character of plan.characters) {
        if (!db.prepare('SELECT id FROM characters WHERE id=?').get(character.id)) { plan.invalidated = true; throw new Error('生成期间角色已删除，请重新规划'); }
        let daily = schedules[character.id];
        for (const fixed of freshFixed[character.id] || []) {
          if (plan.events.some(e => e.participantIds.includes(character.id) && overlaps(e, fixed))) throw new Error('共同活动与现有约定冲突');
          for (const [s, e] of intervals(fixed)) daily = reserveEventTime(daily, fixed, s, e);
        }
        writeScheduleTemplate(db, character.id, schedules[character.id]);
        db.prepare(`INSERT INTO daily_schedules(character_id,schedule_date,schedule_json) VALUES(?,?,?)
          ON CONFLICT(character_id,schedule_date) DO UPDATE SET schedule_json=excluded.schedule_json,generated_at=CURRENT_TIMESTAMP`).run(character.id, plan.date, JSON.stringify(daily));
        reapplyActiveEventSchedule(character.id, db);
        db.prepare('UPDATE characters SET next_schedule_refresh_at=? WHERE id=?').run(next, character.id);
      }
      // 当天的手动约定可能影响同睡人员，以实际发布的每日快照再计算一次。
      const affectedIds = Object.keys(schedules).map(Number);
      const actual = Object.fromEntries(affectedIds.map(id => [id, readArray(db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id=? AND schedule_date=?').get(id, plan.date)?.schedule_json || JSON.stringify(schedules[id]))]));
      const splitActual = splitResidenceSleep(actual, plan.rooms, names);
      for (const id of plan.characterIds) assertCompleteDay(splitActual[id]);
      assertSharedActivities(splitActual, plan.events);
      for (const id of affectedIds) db.prepare('UPDATE daily_schedules SET schedule_json=? WHERE character_id=? AND schedule_date=?').run(JSON.stringify(splitActual[id]), id, plan.date);
      plan.status = 'done'; plan.phase = 'done'; plan.drafts = {};
      saveCohabitationPlan(db, plan);
      saveAppliedResidences(db, plan.rooms);
      db.prepare(`INSERT INTO schedule_refresh_cycle(id,next_refresh_at,last_batch_id) VALUES(1,?,?)
        ON CONFLICT(id) DO UPDATE SET next_refresh_at=excluded.next_refresh_at,last_batch_id=excluded.last_batch_id,retry_at=NULL`).run(next, plan.id);
    })(); } catch (error) { plan.events = proposedEvents; throw error; }
    const manager = await import('./scheduleManager.js');
    for (const id of Object.keys(schedules).map(Number)) {
      manager.invalidateCache(id);
      try { manager.syncSleepingState(id); } catch (error) { console.warn('[scheduleBatch] 日程已发布，睡眠状态留待下次同步：', error.message); }
    }
    report({ phase: 'complete', processing: false, current: plan.characters.length, lastCompleted: plan.characters.length, status: 'done' });
    return { batchId: plan.id, events: plan.events, characterIds: plan.characterIds };
  }).catch(error => {
    plan.status = error.cancelled ? 'cancelled' : 'failed'; plan.error = error.message;
    saveCohabitationPlan(db, plan);
    // 失败不会让每分钟调度反复消耗token；重启仍遵守退避。
    db.prepare(`INSERT INTO schedule_refresh_cycle(id,retry_at) VALUES(1,?)
      ON CONFLICT(id) DO UPDATE SET retry_at=excluded.retry_at`).run(sqlTime(new Date(Date.now() + 3600_000)));
    report({ phase: error.cancelled ? 'cancelled' : 'error', processing: false, cancelled: Boolean(error.cancelled), error: error.message, status: plan.status });
    if (!error.cancelled) throw error;
    return { cancelled: true };
  }).finally(() => { active = null; release(); });
  return control;
}

/** 仅由到期调度调用；不阻塞回复队列。新角色缺失模板仍由原创建流程补齐。 */
export function maybeStartScheduledBatch({ db = getDb(), now = new Date(), start = startScheduleBatch } = {}) {
  if (config.features.schedule === false || isScheduleBatchRunning()) return null;
  if (!db.prepare("SELECT id FROM characters WHERE name!='default' AND schedule_enabled=1 LIMIT 1").get()) return null;
  const nowSql = sqlTime(now);
  let state = db.prepare('SELECT * FROM schedule_refresh_cycle WHERE id=1').get();
  if (state?.retry_at && state.retry_at > nowSql) return null;
  if (!state) {
    const earliest = db.prepare("SELECT MIN(next_schedule_refresh_at) AS at FROM characters WHERE name!='default' AND schedule_enabled=1").get()?.at || nowSql;
    db.prepare('INSERT INTO schedule_refresh_cycle(id,next_refresh_at) VALUES(1,?)').run(earliest);
    state = { next_refresh_at: earliest };
  }
  const saved = readCohabitationPlan(db);
  const resume = saved?.kind === 'automatic' && ['failed', 'running'].includes(saved.status);
  if (!resume && state.next_refresh_at && state.next_refresh_at > nowSql) return null;
  try {
    const task = start({ kind: 'automatic', resume, db, now });
    task.promise.catch(error => console.error('[scheduleBatch]', error.message));
    return task;
  } catch (error) { if (error.status !== 409) throw error; return null; }
}

/** 新建失败后的补齐 / 显式重新启用：沿用已发布共同约定，仅生成一个人的日程。 */
export function maybeInitializeSchedule({ db = getDb(), now = new Date(), generator = generateSchedule } = {}) {
  if (initialization || isScheduleBatchRunning() || config.features.schedule === false) return null;
  const character = db.prepare(`SELECT c.* FROM characters c WHERE name!='default' AND schedule_enabled=1
    AND (next_schedule_refresh_at IS NULL OR (next_schedule_refresh_at<=? AND
      NOT EXISTS(SELECT 1 FROM schedule_templates s WHERE s.character_id=c.id))) ORDER BY id LIMIT 1`).get(sqlTime(now));
  if (!character) return null;
  initialization = Promise.resolve().then(async () => {
    await generator(character);
    assignNextRefreshTime(character.id);
    snapshotTodaySchedule(character.id);
    return { characterId: character.id };
  }).catch(error => {
    db.prepare('UPDATE characters SET next_schedule_refresh_at=? WHERE id=?').run(sqlTime(new Date(now.getTime() + 3600_000)), character.id);
    console.warn('[scheduleBatch] 单人日程初始化失败：', error.message);
    return { characterId: character.id, error: error.message };
  }).finally(() => { initialization = null; });
  return initialization;
}
