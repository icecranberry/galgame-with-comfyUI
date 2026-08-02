/**
 * 日程运行时管理器
 *
 * 提供轻量、带缓存的日程查询，用于：
 *   1. chat.js 注入当前状态到 system prompt
 *   2. chat.js 入口判断是否需要延迟回复
 *   3. momentScheduler / eventGenerator 注入日程上下文
 *   4. 调度器过滤睡眠中的角色
 *   5. 前端日程页面 API
 */

import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { snapshotTodaySchedule } from './scheduleGenerator.js';
import { broadcast } from './unifiedStreamBus.js';
import { getLocalDateKey } from '../utils/localDate.js';


// ── 缓存 ──
// key: characterId, value: { activity, expireAt }
const activityCache = new Map();
const groggyShown = new Set();  // 已展示过groggy唤醒提示的角色（key 统一为 Number，每次唤醒周期仅首条消息触发一次）
const CACHE_TTL = 60 * 1000; // 1 分钟

// ── 时间工具 ──

function timeToMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * 判断当前时间是否在给定的 [startTime, endTime) 区间内
 * 正确处理跨午夜（如 startTime="23:00", endTime="07:00"）
 */
function isInTimeSlot(startTime, endTime, now) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);

  if (endMin < startMin) {
    // 跨午夜：如 23:00 ~ 07:00
    return nowMin >= startMin || nowMin < endMin;
  }
  // 同日：如 08:00 ~ 12:00
  return nowMin >= startMin && nowMin < endMin;
}

// ── 初始化 ──

/**
 * 启动时调用：从 daily_schedules 恢复睡眠状态
 */
export function initialize() {
  const db = getDb();
  const now = new Date();
  const today = getLocalDateKey(now);

  // 全量清理超过 2 天的旧日程快照
  db.prepare(`DELETE FROM daily_schedules WHERE schedule_date < DATE('now', 'localtime', '-2 days')`).run();

  // 检查所有启用日程的角色
  const chars = db.prepare(`
    SELECT id, display_name FROM characters
    WHERE schedule_enabled = 1 OR schedule_enabled IS NULL
  `).all();

  let sleepers = 0;
  for (const char of chars) {
    const schedule = getTodayScheduleRaw(char.id);
    if (!schedule) continue;

    const sleepingBlock = schedule.find(a => a.replyDelay === -1 && isInTimeSlot(a.startTime, a.endTime, now));
    if (sleepingBlock) {
      // 计算醒来时间
      const sleepUntil = calcSleepUntil(sleepingBlock.endTime, now);
      db.prepare('UPDATE characters SET is_sleeping = 1, sleep_until = ? WHERE id = ?')
        .run(sleepUntil, char.id);
      sleepers++;
      console.log(`[scheduleMgr] ${char.display_name} is sleeping until ${sleepUntil}`);
    } else {
      // 确保非睡眠状态
      db.prepare('UPDATE characters SET is_sleeping = 0, sleep_until = NULL WHERE id = ? AND is_sleeping = 1')
        .run(char.id);
    }
  }

  if (sleepers > 0) {
    console.log(`[scheduleMgr] Initialized: ${sleepers} character(s) currently sleeping`);
  }

  // 恢复临时唤醒定时器
  restoreTempWakeTimers();

  // 启动睡眠状态定时同步（时间边界兜底）
  startSleepingStateCron();
}

/**
 * 定时同步所有角色的 is_sleeping / sleep_until。
 *
 * 在入睡/起床高峰期（21:00-02:00 / 06:00-09:00）每 15 分钟跑一次，
 * 其他时段每小时兜底一次。使用自调整 setTimeout 链，不用 setInterval。
 */
function startSleepingStateCron() {
  let running = false;

  async function tick() {
    const db = getDb();
    const chars = db.prepare(
      'SELECT id FROM characters WHERE schedule_enabled = 1 OR schedule_enabled IS NULL'
    ).all();

    for (const char of chars) {
      syncSleepingState(char.id);
    }
  }

  function scheduleNext() {
    const now = new Date();
    const hour = now.getHours();
    const sleepPeak = hour >= 21 || hour < 2;
    const wakePeak = hour >= 6 && hour < 9;
    const intervalMs = (sleepPeak || wakePeak) ? 15 * 60 * 1000 : 60 * 60 * 1000;

    const tag = (sleepPeak || wakePeak)
      ? `peak(${intervalMs / 60000}min)`
      : `off(${intervalMs / 3600000}h)`;
    console.log(`[scheduleMgr] Next sleeping-state sync in ${tag}`);

    setTimeout(async () => {
      if (running) return; // 上一轮还没跑完，跳过
      running = true;
      try {
        await tick();
      } catch (err) {
        console.error('[scheduleMgr] Sleeping-state sync error:', err.message);
      } finally {
        running = false;
        scheduleNext();
      }
    }, intervalMs).unref();
  }

  // 启动时不立即跑（initialize 里已经跑过了），直接排下一轮
  scheduleNext();
}

/**
 * 计算睡眠结束的具体 datetime
 */
function calcSleepUntil(endTime, now) {
  const endMin = timeToMinutes(endTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const result = new Date(now);
  result.setHours(0, 0, 0, 0);
  result.setMinutes(result.getMinutes() + endMin);

  // 如果结束时间在今天之前（即在明天），加一天
  if (endMin <= nowMin) {
    result.setDate(result.getDate() + 1);
  }

  return result.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// ── 日程获取 ──

/**
 * 获取角色今日日程的原始 JSON（优先 daily_schedules，fallback template）
 */
function getTodayScheduleRaw(characterId) {
  const db = getDb();
  const today = getLocalDateKey();

  // 优先查 daily_schedules
  let row = db.prepare(
    'SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = ?'
  ).get(characterId, today);

  if (!row) {
    // fallback: 从 template 快照一条
    const template = db.prepare(
      'SELECT schedule_json FROM schedule_templates WHERE character_id = ?'
    ).get(characterId);

    if (template) {
      db.prepare(`
        INSERT OR REPLACE INTO daily_schedules (character_id, schedule_date, schedule_json)
        VALUES (?, ?, ?)
      `).run(characterId, today, template.schedule_json);
      // 清理超过 2 天的旧快照
      db.prepare(
        `DELETE FROM daily_schedules WHERE character_id = ? AND schedule_date < DATE('now', 'localtime', '-2 days')`
      ).run(characterId);
      row = { schedule_json: template.schedule_json };
    }
  }

  if (!row) return null;

  try {
    return JSON.parse(row.schedule_json);
  } catch {
    return null;
  }
}

/**
 * 获取角色今日完整日程（公开 API）
 */
export function getTodaySchedule(characterId) {
  const schedule = getTodayScheduleRaw(characterId);
  if (!schedule) return null;

  const now = new Date();
  const enriched = schedule.map(act => ({
    ...act,
    isCurrent: isInTimeSlot(act.startTime, act.endTime, now),
  }));

  return enriched;
}

// ── 当前活动查询 ──

/**
 * 获取角色当前活动（带缓存）
 * @returns {object|null} { activity, location, replyDelay, snapshotPrompt, description, startTime, endTime }
 */
export function getCurrentActivity(characterId, now = new Date()) {
  // 检查缓存
  const cached = activityCache.get(characterId);
  if (cached && cached.expireAt > Date.now()) {
    return cached.activity;
  }

  const schedule = getTodayScheduleRaw(characterId);
  if (!schedule) {
    // 无日程模板 → 缓存 null（短 TTL，因为可能正在生成中）
    activityCache.set(characterId, { activity: null, expireAt: Date.now() + 10000 });
    return null;
  }

  for (const act of schedule) {
    if (isInTimeSlot(act.startTime, act.endTime, now)) {
      const result = {
        activity: act.activity,
        location: act.location,
        replyDelay: act.replyDelay,
        snapshotPrompt: act.snapshotPrompt || '',
        description: act.description || '',
        startTime: act.startTime,
        endTime: act.endTime,
        tags: act.tags || [],
      };
      activityCache.set(characterId, { activity: result, expireAt: Date.now() + CACHE_TTL });
      return result;
    }
  }

  // 当前时间不在任何活动中 → 空闲状态
  const idleResult = {
    activity: '自由时间',
    location: '未知',
    replyDelay: 0,
    snapshotPrompt: '',
    description: '没有特定安排，自由支配时间',
    startTime: '',
    endTime: '',
    tags: ['idle'],
  };
  activityCache.set(characterId, { activity: idleResult, expireAt: Date.now() + CACHE_TTL });
  return idleResult;
}

// ── Prompt 注入 ──

/**
 * 为 chat.js / momentScheduler / eventGenerator 生成日程上下文
 * @returns {string|null} 适合拼入 system prompt 的文字
 */
export function formatScheduleContext(characterId, now = new Date(), { consumeGroggy = true } = {}) {
  characterId = Number(characterId);
  // 临时唤醒期间 → 覆盖睡眠提示
  if (isTempWoken(characterId, now)) {
    // 非聊天调用方（如 mailboxScheduler）不消费一次性标记，避免偷走聊天首条的 groggy 提示
    if (!consumeGroggy) return null;
    if (groggyShown.has(characterId)) return null;
    groggyShown.add(characterId);
    const db = getDb();
    const char = db.prepare('SELECT wake_mode, wake_attempts FROM characters WHERE id = ?').get(characterId);
    const mode = char?.wake_mode || 'unknown';
    const attempts = char?.wake_attempts || 1;
    const wakeMsgs = {
      phone:   `被${config.user.nickname || '用户'}打来的${attempts}个电话吵醒`,
      door:    `被${config.user.nickname || '用户'}上门从床上摇醒`,
      shake:   `被${config.user.nickname || '用户'}又跑到床边晃醒`,
    };
    const wakeDesc = wakeMsgs[mode] || `被${config.user.nickname || '用户'}叫醒`;
    return `【当前状态】${wakeDesc}，脑袋还迷迷糊糊的。`;
  }

  const activity = getCurrentActivity(characterId, now);
  if (!activity) return null;

  const lines = [`【当前状态】你正在【${activity.location}】${activity.activity}。`];

  if (activity.description && activity.description.trim()) {
    lines.push(activity.description.trim());
  }

  if (activity.replyDelay === -1) {
    lines.push('你正在睡觉。不要回复任何消息，直到自然醒来。');
  } else if (activity.replyDelay > 0) {
    lines.push(`当前活动需要一定专注度，约 ${activity.replyDelay} 分钟后才能腾出手来回复消息。回复时自然提及刚才在${activity.location}的处境。`);
  } else {
    lines.push('你现在可以随时回复消息，言行举止应与当前场景自然衔接。');
  }

  return lines.join(' ');
}

// ── 回复延迟 ──

/**
 * 获取角色当前的回复延迟信息
 * @returns {{ delay: number, activity: string, location: string }}
 *   delay: 0=秒回, >0=延迟分钟, -1=暂停(睡觉)
 */
export function getReplyDelay(characterId, now = new Date()) {
  // 临时唤醒期间：秒回（覆盖日程中的睡眠状态）
  const tempWoken = isTempWoken(characterId, now);
  if (tempWoken) {
    return { delay: 0, activity: '被叫醒了', location: '' };
  }

  const activity = getCurrentActivity(characterId, now);
  if (!activity) return { delay: 0, activity: '未知', location: '' };

  // 日程显示睡眠 but DB 中 is_sleeping=0 → 区分两种情况：
  //   a. 曾被叫醒（temporary_wake_until 有值，可能是过期残留）→ 视为清醒，秒回
  //   b. 睡眠时段刚开始、cron 尚未同步 → 立即同步并按睡眠拦截
  if (activity.replyDelay === -1) {
    const db = getDb();
    const char = db.prepare('SELECT is_sleeping, temporary_wake_until FROM characters WHERE id = ?').get(characterId);
    if (char && char.is_sleeping === 0) {
      if (char.temporary_wake_until) {
        return { delay: 0, activity: '被叫醒了', location: '' };
      }
      syncSleepingState(characterId, now);
      return { delay: -1, activity: activity.activity, location: activity.location };
    }
  }

  return {
    delay: activity.replyDelay,
    activity: activity.activity,
    location: activity.location,
  };
}

// ── 临时唤醒状态管理 ──

const tempWakeTimers = new Map(); // characterId → setTimeout

/**
 * 检查角色是否处于临时唤醒期
 */
export function isTempWoken(characterId, now = new Date()) {
  const db = getDb();
  const char = db.prepare('SELECT temporary_wake_until, is_sleeping FROM characters WHERE id = ?').get(characterId);
  if (!char || !char.temporary_wake_until) return false;
  const until = new Date(char.temporary_wake_until.replace(' ', 'T') + 'Z');
  return until > now;
}

/**
 * 获取临时唤醒到期时间，未唤醒返回 null
 */
export function getTempWakeUntil(characterId) {
  const db = getDb();
  const char = db.prepare('SELECT temporary_wake_until FROM characters WHERE id = ?').get(characterId);
  if (!char || !char.temporary_wake_until) return null;
  return char.temporary_wake_until;
}

/**
 * 设置临时唤醒定时器
 */
export function scheduleTempWakeExpiry(characterId, tempWakeUntil) {
  characterId = Number(characterId);
  clearTempWakeTimer(characterId);

  const until = new Date(tempWakeUntil.replace(' ', 'T') + 'Z');
  const delayMs = until.getTime() - Date.now();
  if (delayMs <= 0) {
    revertTempWake(characterId);
    return;
  }

  const timer = setTimeout(() => {
    revertTempWake(characterId);
    tempWakeTimers.delete(characterId);
  }, delayMs);
  timer.unref?.();
  tempWakeTimers.set(characterId, timer);
  console.log(`[scheduleMgr] Temp wake expiry scheduled in ${Math.round(delayMs / 60000)}min for ${characterId}`);
}

/**
 * 延长临时唤醒计时器 — 每次用户互动时重置倒计时为 5~15 分钟
 * 角色在聊天中保持活跃时不会被强制入睡，仅在无互动到期后才回退睡眠
 */
export function extendTempWake(characterId) {
  characterId = Number(characterId);
  if (!isTempWoken(characterId)) return false;

  const db = getDb();
  const minutes = 5 + Math.floor(Math.random() * 11);
  const newUntil = new Date(Date.now() + minutes * 60000)
    .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

  db.prepare('UPDATE characters SET temporary_wake_until = ? WHERE id = ?')
    .run(newUntil, characterId);

  console.log(`[scheduleMgr] Temp wake extended for ${characterId}, new expiry in ${minutes}min`);
  scheduleTempWakeExpiry(characterId, newUntil);

  // 通知前端临时唤醒时间已续期，避免过期显示
  const char = db.prepare('SELECT sleep_until, wake_mode FROM characters WHERE id = ?').get(characterId);
  broadcast('schedule_state_change', {
    character_id: characterId,
    is_sleeping: false,
    sleep_until: char?.sleep_until || null,
    temporary_wake_until: newUntil,
    wake_mode: char?.wake_mode || null,
  });
  return true;
}

/**
 * 重置 groggy 一次性提示标记
 * 每次叫醒成功时由 wake 端点调用，保证"每次被唤醒都注入一次"的语义，
 * 不依赖上一轮 revertTempWake 是否正常执行
 */
export function resetGroggyShown(characterId) {
  groggyShown.delete(Number(characterId));
}

function clearTempWakeTimer(characterId) {
  characterId = Number(characterId);
  const existing = tempWakeTimers.get(characterId);
  if (existing) { clearTimeout(existing); tempWakeTimers.delete(characterId); }
}

/**
 * 临时唤醒到期 → 回退到睡眠或正常清醒
 */
function revertTempWake(characterId) {
  groggyShown.delete(Number(characterId));
  const db = getDb();
  const char = db.prepare('SELECT id, sleep_until FROM characters WHERE id = ?').get(characterId);
  if (!char) return;

  const now = new Date();
  const activity = getCurrentActivity(characterId, now);

  // 仍在睡眠时间块内 → 回退到睡眠
  if (activity && activity.replyDelay === -1) {
    const sleepUntil = calcSleepUntil(activity.endTime, now);
    db.prepare(`UPDATE characters SET is_sleeping = 1, sleep_until = ?, temporary_wake_until = NULL, wake_mode = NULL, wake_attempts = 0 WHERE id = ?`)
      .run(sleepUntil, characterId);
    console.log(`[scheduleMgr] Temp wake expired for ${characterId}, back to sleep until ${sleepUntil}`);

    broadcast('schedule_state_change', {
      character_id: characterId,
      is_sleeping: true,
      sleep_until: sleepUntil,
      temporary_wake_until: null,
      wake_mode: null,
    });
    return;
  }

  // 睡眠时间块已结束 → 直接转入正常清醒
  db.prepare(`UPDATE characters SET is_sleeping = 0, sleep_until = NULL, temporary_wake_until = NULL, wake_mode = NULL, wake_attempts = 0, was_door_woken = 0 WHERE id = ?`)
    .run(characterId);
  console.log(`[scheduleMgr] Temp wake expired for ${characterId}, sleep block ended → staying awake`);

  broadcast('schedule_state_change', {
    character_id: characterId,
    is_sleeping: false,
    sleep_until: null,
    temporary_wake_until: null,
    wake_mode: null,
  });
}

/**
 * 服务重启时恢复临时唤醒定时器
 */
function restoreTempWakeTimers() {
  const db = getDb();
  const now = new Date();
  const chars = db.prepare(`SELECT id, temporary_wake_until FROM characters WHERE temporary_wake_until IS NOT NULL`).all();
  for (const char of chars) {
    const until = new Date(char.temporary_wake_until.replace(' ', 'T') + 'Z');
    if (until <= now) {
      revertTempWake(char.id);
    } else {
      scheduleTempWakeExpiry(char.id, char.temporary_wake_until);
    }
  }
  if (chars.length > 0) {
    console.log(`[scheduleMgr] Restored ${chars.length} temp wake timer(s)`);
  }
}

// ── 睡眠状态 ──

/**
 * 检查角色是否正在睡觉
 */
export function isSleeping(characterId, now = new Date()) {
  // 临时唤醒期间 → 不视为睡眠
  if (isTempWoken(characterId, now)) {
    return { sleeping: false, sleepUntil: null };
  }

  const db = getDb();
  // 优先读 DB 中的缓存状态
  const char = db.prepare('SELECT is_sleeping, sleep_until FROM characters WHERE id = ?').get(characterId);
  if (char && char.is_sleeping === 1) {
    return { sleeping: true, sleepUntil: char.sleep_until };
  }

  // fallback: 直接查日程
  const activity = getCurrentActivity(characterId, now);
  if (activity && activity.replyDelay === -1) {
    const sleepUntil = calcSleepUntil(activity.endTime, now);
    return { sleeping: true, sleepUntil };
  }

  return { sleeping: false, sleepUntil: null };
}

// ── 睡眠状态同步 ──

/**
 * 根据当前日程同步角色的 is_sleeping / sleep_until 到 characters 表
 * 应在日程生成/刷新后调用，确保其他 SQL 直读 is_sleeping 的模块拿到正确状态
 */
export function syncSleepingState(characterId, now = new Date()) {
  const db = getDb();

  // 临时唤醒期间 → 跳过同步，保持 is_sleeping = 0，不覆盖 sleep_until
  if (isTempWoken(characterId, now)) return;

  const activity = getCurrentActivity(characterId, now);
  const sleeping = !!(activity && activity.replyDelay === -1);
  const prev = db.prepare('SELECT is_sleeping, sleep_until FROM characters WHERE id = ?').get(characterId);

  if (sleeping) {
    const sleepUntil = calcSleepUntil(activity.endTime, now);
    const wasAlreadySleeping = prev && prev.is_sleeping === 1;
    db.prepare('UPDATE characters SET is_sleeping = 1, sleep_until = ? WHERE id = ?')
      .run(sleepUntil, characterId);

    // 新睡眠周期 → 重置所有叫醒相关列
    if (!wasAlreadySleeping) {
      db.prepare(`UPDATE characters SET wake_attempts = 0, was_door_woken = 0, temporary_wake_until = NULL, wake_mode = NULL WHERE id = ?`)
        .run(characterId);

      broadcast('schedule_state_change', {
        character_id: characterId,
        is_sleeping: true,
        sleep_until: sleepUntil,
        temporary_wake_until: null,
        wake_mode: null,
      });
    }
  } else {
    // 从睡眠转为清醒 → 清除 sleep 状态，不清除叫醒列（让自然醒后重置）
    db.prepare('UPDATE characters SET is_sleeping = 0, sleep_until = NULL WHERE id = ? AND is_sleeping = 1')
      .run(characterId);
    // 自然醒来 → 重置所有叫醒列
    if (prev && prev.is_sleeping === 1) {
      db.prepare(`UPDATE characters SET wake_attempts = 0, was_door_woken = 0, temporary_wake_until = NULL, wake_mode = NULL WHERE id = ?`)
        .run(characterId);

      broadcast('schedule_state_change', {
        character_id: characterId,
        is_sleeping: false,
        sleep_until: null,
        temporary_wake_until: null,
        wake_mode: null,
      });
    }
  }
}

// ── 全局概览 ──

/**
 * 获取所有启用日程的角色的当前活动概览（供前端 ScheduleView 使用）
 */
export function getAllOverview() {
  const db = getDb();
  const now = new Date();

  const chars = db.prepare(`
    SELECT id, display_name, avatar_path, is_sleeping, sleep_until, wake_attempts, was_door_woken, temporary_wake_until, wake_mode
    FROM characters
    ORDER BY display_name ASC
  `).all();

  return chars.map(char => {
    const activity = getCurrentActivity(char.id, now);
    // 动态计算睡眠状态（不依赖 characters 表中的缓存值，日程更新后该缓存可能过期）
    const sleeping = !!(activity && activity.replyDelay === -1);
    const sleepUntil = sleeping ? calcSleepUntil(activity.endTime, now) : null;
    const tempWoken = isTempWoken(char.id, now);
    return {
      id: char.id,
      display_name: char.display_name,
      avatar_path: char.avatar_path,
      current_activity: activity ? `${activity.activity} · ${activity.location}` : '未设置日程',
      reply_delay: activity ? activity.replyDelay : 0,
      is_sleeping: sleeping,
      sleep_until: sleepUntil,
      _desc: activity?.description || '',
      tags: activity?.tags || [],
      wake_attempts: char.wake_attempts,
      was_door_woken: char.was_door_woken,
      temporary_wake_until: char.temporary_wake_until,
      wake_mode: char.wake_mode,
      is_temp_woken: tempWoken,
    };
  });
}

/**
 * 确保某个角色今日有日程快照
 */
export function ensureTodaySchedule(characterId) {
  const existing = getTodayScheduleRaw(characterId);
  if (!existing) {
    return snapshotTodaySchedule(characterId);
  }
  return existing;
}

/**
 * 清除指定角色的活动缓存（日程更新后调用）
 */
export function invalidateCache(characterId) {
  activityCache.delete(characterId);
}

/**
 * 清除所有缓存
 */
export function invalidateAllCache() {
  activityCache.clear();
}
