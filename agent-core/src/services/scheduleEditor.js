/**
 * 单条日程编辑器
 *
 * 日程模板/快照都是整包 JSON，本模块提供「按条」修改能力：
 *   1. updateScheduleActivity  — 手动编辑单条（前端日程抽屉点击条目）
 *   2. applyScheduleChange     — 聊天约定检测命中后，把 LLM 返回的单条日程合并进当日日程
 *
 * 被编辑过的条目打上 edited 标记（specialMomentStatus: pending），进入当天特殊朋友圈队列
 * （pending → generating → sent / expired，扫描逻辑见 scheduleSpecialMoment.js）。
 * 标记只写 daily_schedules 当日快照，次日从模板重新派生时自然消失，不污染模板。
 */

import { getDb } from '../db/index.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { ensureTodaySchedule, invalidateCache, syncSleepingState } from './scheduleManager.js';
import { broadcast } from './unifiedStreamBus.js';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 聊天约定的最长时长（分钟）：LLM 偶尔输出「00:57~23:59」这类霸占全天的时段，必须封顶 */
const MAX_APPOINTMENT_MINUTES = 360;

function toMin(hhmm) {
  if (!TIME_RE.test(String(hhmm || ''))) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function minToTime(min) {
  // 1440（当天最后一分钟）落到 23:59，保证 HH:MM 24 小时制合法
  const clamped = Math.max(0, Math.min(1439, min));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 把 LLM/前端传入的单条日程补丁清洗成合法的活动对象，失败返回 null
 * @param {object} patch
 * @param {object} opts
 * @param {boolean} opts.clampCrossMidnight - 聊天约定路径：结束时间落在凌晨（如 23:47~00:40）
 *   视为跨天，截至当天 23:59；关闭时保留原样（手动编辑沿用原条目的跨天时段，如睡眠 22:00~07:00）
 */
export function sanitizeActivityInput(patch = {}, { clampCrossMidnight = false } = {}) {
  const startMin = toMin(patch.startTime);
  let endMin = toMin(patch.endTime);
  if (startMin === null || endMin === null) return null;
  if (endMin <= startMin) {
    if (!clampCrossMidnight) {
      // 保留跨天时段原样（睡眠等条目合法地跨午夜）
    } else if (endMin <= 240) {
      endMin = 1439; // 跨零点的约定截至当天 23:59
    } else {
      return null; // 结束不在凌晨（如 19:00~18:00）属于 LLM 输出错乱，拒绝
    }
  }

  const startTime = minToTime(startMin);
  const endTime = minToTime(endMin);
  if (startTime === null || endTime === null) return null;

  const activity = String(patch.activity || '').trim();
  if (!activity) return null;

  const replyDelayRaw = Number(patch.replyDelay);
  const replyDelay = patch.replyDelay === undefined || Number.isNaN(replyDelayRaw)
    ? 0
    : (replyDelayRaw === -1 ? -1 : Math.max(0, Math.round(replyDelayRaw)));

  const tags = Array.isArray(patch.tags)
    ? patch.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6)
    : [];

  return {
    startTime,
    endTime,
    activity: activity.slice(0, 60),
    location: String(patch.location || '').trim().slice(0, 60) || '未知',
    replyDelay,
    tags,
    description: String(patch.description || '').trim().slice(0, 200),
  };
}

function saveTodaySchedule(characterId, schedule) {
  const db = getDb();
  db.prepare(`
    UPDATE daily_schedules
    SET schedule_json = ?, generated_at = CURRENT_TIMESTAMP
    WHERE character_id = ? AND schedule_date = ?
  `).run(JSON.stringify(schedule), characterId, getLocalDateKey());
}

/** 载入今日日程（ensureTodaySchedule 首次派生快照时返回的是 JSON 字符串，统一成数组） */
function loadTodaySchedule(characterId) {
  const raw = ensureTodaySchedule(characterId);
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function finishEdit(characterId) {
  invalidateCache(characterId);
  syncSleepingState(characterId);
}

/** 日程更改成功 → 广播给前端（右上角 toast） */
function broadcastScheduleChanged(characterId, activity, targetDate = null) {
  try {
    const row = getDb().prepare('SELECT display_name FROM characters WHERE id = ?').get(characterId);
    broadcast('schedule_changed', {
      character_id: characterId,
      display_name: row?.display_name || '',
      activity: activity.activity,
      start_time: activity.startTime,
      end_time: activity.endTime,
      target_date: targetDate,
    });
  } catch (err) {
    console.warn('[scheduleEditor] schedule_changed broadcast failed:', err.message);
  }
}

/** 给条目打上「已编辑」标记并排入当天特殊朋友圈队列 */
function markEdited(activity, source) {
  activity.edited = 1;
  activity.editedSource = source === 'chat' ? 'chat' : 'manual';
  activity.specialMomentStatus = 'pending';
}

/**
 * 手动编辑单条日程
 * @param {number} characterId
 * @param {number} index - 今日日程数组下标
 * @param {object} patch - { startTime, endTime, activity, location, description }
 * @returns {{ ok: boolean, error?: string, activities?: array }}
 */
export function updateScheduleActivity(characterId, index, patch = {}) {
  const schedule = loadTodaySchedule(characterId);
  if (!schedule || !Array.isArray(schedule) || !schedule[index]) {
    return { ok: false, error: '日程条目不存在' };
  }

  // 手动编辑只改内容，不改时间：未传或传空时沿用原条目的时间段
  const base = schedule[index];
  const clean = sanitizeActivityInput({
    ...patch,
    startTime: patch.startTime || base.startTime,
    endTime: patch.endTime || base.endTime,
  });
  if (!clean) {
    return { ok: false, error: '字段不合法：活动名不能为空' };
  }

  const updated = [...schedule];
  updated[index] = { ...updated[index], ...clean };
  markEdited(updated[index], 'manual');

  saveTodaySchedule(characterId, updated);
  finishEdit(characterId);
  console.log(`[scheduleEditor] Manual edit char ${characterId} #${index}: ${clean.startTime}-${clean.endTime} ${clean.activity}`);
  broadcastScheduleChanged(characterId, clean);
  return { ok: true, activities: updated };
}

/**
 * 把聊天约定检测产出的单条日程合并进当日日程：
 * 覆盖与新时间段重叠的条目（跨午夜条目按需拆分），修剪相邻条目保持 24 小时无空档。
 * @returns {{ ok: boolean, reason?: string, activity?: object }}
 */
export function applyScheduleChange(characterId, newActivity, now = new Date()) {
  const schedule = loadTodaySchedule(characterId);
  if (!schedule || !Array.isArray(schedule)) {
    return { ok: false, reason: 'no_schedule' };
  }

  const clean = sanitizeActivityInput(newActivity, { clampCrossMidnight: true });
  if (!clean) return { ok: false, reason: 'invalid_activity' };

  // 约定时长封顶：LLM 偶尔把 endTime 写成 23:59 表达「到天亮/一整天」，
  // 不封顶会把当天日程几乎整包替换掉
  let newS = toMin(clean.startTime);
  let newE = toMin(clean.endTime);
  if (newE - newS > MAX_APPOINTMENT_MINUTES) {
    newE = newS + MAX_APPOINTMENT_MINUTES;
    clean.endTime = minToTime(newE);
    console.log(`[scheduleEditor] Appointment duration capped to ${MAX_APPOINTMENT_MINUTES} min: ${clean.startTime}-${clean.endTime}`);
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (newE <= nowMin) {
    return { ok: false, reason: 'expired' }; // 约定时段已经过去了，插入没有意义
  }

  // 保留未被覆盖的条目；与 [newS, newE) 重叠的条目裁掉重叠段（跨午夜条目拆成两段处理）
  const kept = [];
  for (const act of schedule) {
    const s = toMin(act.startTime);
    let e = toMin(act.endTime);
    if (s === null || e === null) continue; // 脏数据丢弃
    if (e === s) continue; // 零长度脏条目丢弃
    if (e === 0 && s > 0) e = 1440; // endTime 00:00 是 LLM 的「当天午夜收尾」写法，不是跨天

    if (e > s) {
      if (s < newE && newS < e) {
        if (s < newS) kept.push({ ...act, startTime: minToTime(s), endTime: minToTime(newS) });
        if (newE < e) kept.push({ ...act, startTime: minToTime(newE), endTime: minToTime(e) });
      } else {
        kept.push(act);
      }
    } else {
      // 跨午夜条目（如睡眠 22:00~07:00）：上半段 [s,1440)、下半段 [0,e)
      if (s < newE) {
        if (s < newS) kept.push({ ...act, startTime: minToTime(s), endTime: minToTime(newS) });
        // else 上半段完全被覆盖
      } else {
        kept.push({ ...act, startTime: minToTime(s), endTime: '23:59' });
      }
      if (newS < e) {
        if (newE < e) kept.push({ ...act, startTime: minToTime(newE), endTime: minToTime(e) });
        // else 下半段完全被覆盖
      } else {
        kept.push({ ...act, startTime: '00:00', endTime: minToTime(e) });
      }
    }
  }

  const marked = { ...clean };
  markEdited(marked, 'chat');
  kept.push(marked);

  // 过滤裁剪产生的零长度残块（如 [23:59,23:59]），再排序并补空档（优先拉伸原有条目，不改约定时长）
  const merged = kept.filter(a => toMin(a.startTime) !== toMin(a.endTime));
  merged.sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  if (toMin(merged[0].startTime) > 0) merged[0].startTime = '00:00';
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const cur = merged[i];
    if (toMin(prev.endTime) < toMin(cur.startTime)) {
      if (prev.edited) cur.startTime = prev.endTime;
      else prev.endTime = cur.startTime;
    }
  }
  const last = merged[merged.length - 1];
  // endTime 00:00 是「当天午夜收尾」写法，等同于 23:59，不需要也不应该改写
  if (toMin(last.endTime) < 1439 && last.endTime !== '00:00') last.endTime = '23:59';

  saveTodaySchedule(characterId, merged);
  finishEdit(characterId);
  console.log(`[scheduleEditor] Applied schedule change char ${characterId}: ${marked.startTime}-${marked.endTime} ${marked.activity} (${merged.length} activities now)`);
  broadcastScheduleChanged(characterId, marked);
  return { ok: true, activity: marked };
}

/** 更新某条已编辑日程的特殊朋友圈状态（sent / expired / pending …） */
export function updateSpecialMomentStatus(characterId, startTime, status) {
  const db = getDb();
  const row = db.prepare(
    'SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = ?'
  ).get(characterId, getLocalDateKey());
  if (!row) return false;

  let schedule;
  try { schedule = JSON.parse(row.schedule_json); } catch { return false; }
  if (!Array.isArray(schedule)) return false;

  // edited 条目在同一角色同一天内以 startTime 唯一（日程本身不允许时间重叠）
  const act = schedule.find(a => a && a.edited && a.startTime === startTime);
  if (!act) return false;

  act.specialMomentStatus = status;
  saveTodaySchedule(characterId, schedule);
  return true;
}

// ── 待应用日程变更队列（约定的是未来某天）──

/**
 * 未来某天的约定先入队，到 target_date 当天由 ensurePendingScheduleChanges
 * 合并进当日日程（合并后照常进入当天的特殊朋友圈队列）
 */
export function queueScheduleChange(characterId, targetDate, activity, source = 'chat') {
  const db = getDb();
  db.prepare(`
    INSERT INTO pending_schedule_changes (character_id, target_date, activity_json, status, source)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(characterId, targetDate, JSON.stringify(activity), source);
  console.log(`[scheduleEditor] Queued schedule change char ${characterId} for ${targetDate}: ${activity.startTime}-${activity.endTime} ${activity.activity}`);
  broadcastScheduleChanged(characterId, activity, targetDate);
}

/**
 * 应用到期的待应用队列（特殊朋友圈扫描前调用）：
 * - target_date < 今天 → 标记 expired（过时不候）
 * - target_date == 今天 → 合并进当日日程并打 edited 标记
 * - 已 applied 但当日快照被夜间日程刷新整包覆盖 → 重新合并回去（幂等）
 */
export function ensurePendingScheduleChanges(now = new Date()) {
  const db = getDb();
  const today = getLocalDateKey(now);

  const due = db.prepare(
    `SELECT id, character_id, activity_json, target_date FROM pending_schedule_changes
     WHERE status = 'pending' AND target_date <= ?`
  ).all(today);
  for (const row of due) {
    let activity = null;
    try { activity = JSON.parse(row.activity_json); } catch { /* 脏数据按过期处理 */ }

    let status = 'expired';
    if (activity && row.target_date === today) {
      const result = applyScheduleChange(row.character_id, activity, now);
      status = result.ok ? 'applied' : 'expired'; // expired / no_schedule / invalid 均不再重试
      console.log(`[scheduleEditor] Pending change ${result.ok ? 'applied' : `dropped (${result.reason})`} char ${row.character_id}: ${activity.startTime}-${activity.endTime} ${activity.activity}`);
    } else if (row.target_date < today) {
      console.log(`[scheduleEditor] Pending change expired (过时不候) char ${row.character_id} for ${row.target_date}`);
    }
    db.prepare('UPDATE pending_schedule_changes SET status = ? WHERE id = ?').run(status, row.id);
  }

  // 当日已应用的约定被夜间日程刷新（00:00~04:00 整包重写快照）覆盖时，重新合并回去
  const appliedToday = db.prepare(
    `SELECT id, character_id, activity_json FROM pending_schedule_changes
     WHERE status = 'applied' AND target_date = ?`
  ).all(today);
  for (const row of appliedToday) {
    let activity;
    try { activity = JSON.parse(row.activity_json); } catch { continue; }
    const schedule = loadTodaySchedule(row.character_id);
    const stillThere = Array.isArray(schedule) && schedule.some(a =>
      a && a.edited && a.startTime === activity.startTime && a.activity === activity.activity);
    if (!stillThere) {
      const result = applyScheduleChange(row.character_id, activity, now);
      if (result.ok) {
        console.log(`[scheduleEditor] Re-applied wiped appointment char ${row.character_id}: ${activity.startTime} ${activity.activity}`);
      }
    }
  }
}
