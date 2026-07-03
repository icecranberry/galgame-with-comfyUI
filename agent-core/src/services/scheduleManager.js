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
import { snapshotTodaySchedule } from './scheduleGenerator.js';

// ── 缓存 ──
// key: characterId, value: { activity, expireAt }
const activityCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 分钟

// 星期映射
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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
  const today = now.toISOString().slice(0, 10);

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
  const today = new Date().toISOString().slice(0, 10);

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
export function formatScheduleContext(characterId, now = new Date()) {
  const activity = getCurrentActivity(characterId, now);
  if (!activity) return null;

  const timeStr = `${WEEKDAYS[now.getDay()]} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const lines = [`【当前状态】${timeStr}，你正在【${activity.location}】${activity.activity}。`];

  if (activity.replyDelay === -1) {
    lines.push('你正在睡觉。不要回复任何消息，直到自然醒来。');
  } else if (activity.replyDelay > 0) {
    lines.push(`当前活动需要一定专注度，约 ${activity.replyDelay} 分钟后才能腾出手来回复消息。在回复 user 之前，应该自然地提一下刚才在做什么——例如"刚从${activity.location}出来就看到你的消息"。`);
  } else {
    lines.push('你现在可以随时回复消息。');
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
  const activity = getCurrentActivity(characterId, now);
  if (!activity) return { delay: 0, activity: '未知', location: '' };

  return {
    delay: activity.replyDelay,
    activity: activity.activity,
    location: activity.location,
  };
}

// ── 睡眠状态 ──

/**
 * 检查角色是否正在睡觉
 */
export function isSleeping(characterId, now = new Date()) {
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

// ── 全局概览 ──

/**
 * 获取所有启用日程的角色的当前活动概览（供前端 ScheduleView 使用）
 */
export function getAllOverview() {
  const db = getDb();
  const now = new Date();

  const chars = db.prepare(`
    SELECT id, display_name, avatar_path, is_sleeping, sleep_until
    FROM characters
    WHERE schedule_enabled = 1 OR schedule_enabled IS NULL
    ORDER BY display_name ASC
  `).all();

  return chars.map(char => {
    const activity = getCurrentActivity(char.id, now);
    return {
      id: char.id,
      display_name: char.display_name,
      avatar_path: char.avatar_path,
      current_activity: activity ? `${activity.activity} · ${activity.location}` : '未设置日程',
      reply_delay: activity ? activity.replyDelay : 0,
      is_sleeping: char.is_sleeping === 1,
      sleep_until: char.sleep_until,
      _desc: activity?.description || '',
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
