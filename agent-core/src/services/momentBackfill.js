import { getDb } from '../db/index.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from './scheduleGenerator.js';
import { getTodaySchedule, invalidateCache, syncSleepingState } from './scheduleManager.js';
import { startBackgroundTask } from './imageEditTasks.js';
import { backfillDay, planBackfillTimes, activityAt } from './momentBackfillPlan.js';
import { broadcast } from './unifiedStreamBus.js';

let activeTaskId = null;
let activeControl = null;

export function stopMomentBackfill(taskId) {
  if (!activeControl || taskId !== activeTaskId) {
    throw Object.assign(new Error('该补发任务已结束或不存在'), { status: 409 });
  }
  activeControl.stopped = true;
  activeControl.task.onProgress({ stage: '正在停止，等待当前生成完成后结束', phase: 'stopping' });
}

export const isMomentBackfillRunning = () => activeTaskId !== null;
const sqlTime = date => date.toISOString().slice(0, 19).replace('T', ' ');

export function startMomentBackfill(generatePost, { waitForIdle = async () => {} } = {}) {
  if (activeTaskId) throw Object.assign(new Error('补发动态正在进行中'), { status: 409 });
  const now = new Date();
  const task = startBackgroundTask({ action: 'moment_backfill', meta: {} });
  activeTaskId = task.id;
  const control = { stopped: false, task };
  activeControl = control;
  // 任务独立于 HTTP 请求运行；所有终态都释放互斥标志。
  task.onProgress({ stage: '准备补发，等待正在生成的动态完成', progress: 0 });
  Promise.resolve().then(waitForIdle).then(() => runBackfill(task, generatePost, now, control))
    .catch(err => task.fail(err)).finally(() => { activeTaskId = null; activeControl = null; });
  return task.id;
}

async function runBackfill(task, generatePost, now, control) {
  const db = getDb();
  const characters = db.prepare("SELECT * FROM characters WHERE name != 'default' AND moments_disabled = 0 ORDER BY id").all();
  const { start, end } = backfillDay(now);
  const countPosts = db.prepare("SELECT COUNT(*) AS count FROM moment_posts WHERE character_id = ? AND status = 'done' AND created_at >= ? AND created_at < ?");
  const failed = new Set();
  const schedules = new Map();
  let generated = 0, skipped = 0;
  const errors = [];
  const progress = (stage, value) => { if (!control.stopped) task.onProgress({ stage, progress: value }); };
  // 先完成所有角色的到期日程，再进入发帖阶段。
  for (const [index, character] of characters.entries()) {
    if (control.stopped) break;
    progress(`检查日程 ${index + 1}/${characters.length} · ${character.display_name}`, index / Math.max(1, characters.length) * 0.3);
    try {
      if (new Date() >= end) throw new Error('已跨日，请重新启动今日补发');
      const needsRefresh = db.prepare(`SELECT 1 FROM characters c WHERE id = ? AND (
        next_schedule_refresh_at IS NULL OR next_schedule_refresh_at <= ? OR
        NOT EXISTS (SELECT 1 FROM schedule_templates st WHERE st.character_id = c.id))`).get(character.id, sqlTime(now));
      if (needsRefresh) {
        progress(`刷新日程 ${index + 1}/${characters.length} · ${character.display_name}`, index / characters.length * 0.3);
        await generateSchedule(character);
        if (new Date() >= end) throw new Error('日程刷新期间已跨日，请重新启动今日补发');
        snapshotTodaySchedule(character.id);
        assignNextRefreshTime(character.id);
        invalidateCache(character.id);
        syncSleepingState(character.id);
        broadcast('schedule_state_change', { character_id: character.id, reason: 'schedule_refreshed' });
      }
      schedules.set(character.id, getTodaySchedule(character.id));
    } catch (err) {
      failed.add(character.id);
      errors.push(`${character.display_name}日程刷新失败：${err.message}`);
    }
  }
  for (const [index, character] of characters.entries()) {
    if (control.stopped) break;
    if (failed.has(character.id)) continue;
    if (countPosts.get(character.id, sqlTime(start), sqlTime(end)).count >= 2) { skipped++; continue; }
    // 日程快照固定下来，跨午夜继续执行也不会读到次日日程。
    const schedule = schedules.get(character.id);
    const times = planBackfillTimes(now);
    for (const [postIndex, postedAt] of times.entries()) {
      if (control.stopped) break;
      progress(`补发 ${index + 1}/${characters.length} · ${character.display_name} · ${postIndex + 1}/${times.length}`, 0.3 + 0.7 * (index + postIndex / times.length) / characters.length);
      try {
        await generatePost(character, { backfill: true, postedAt, activity: activityAt(schedule, postedAt) });
        generated++;
      } catch (err) {
        errors.push(`${character.display_name}发帖失败：${err.message}`);
        break;
      }
    }
  }
  const summary = `已补发 ${generated} 条，跳过 ${skipped} 位角色${errors.length ? `，${errors.length} 项失败` : ''}`;
  if (control.stopped) task.succeed({ cancelled: true, summary: `已停止；${summary}` });
  else if (errors.length) task.fail(new Error(`${summary}；${errors.join('；')}`));
  else task.succeed({ summary });
}
