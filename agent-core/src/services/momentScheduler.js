import { isMomentBackfillRunning } from './momentBackfill.js';
/**
 * 朋友圈定时发帖调度器
 *
 * - 角色默认每 5 分钟扫描；自定义档每 30 秒检查角色全局计时，每个间隔只发一条
 * - 镇民使用自己的默认排期与 5 分钟检查；关闭档同时停止角色和镇民
 * - 找出 next_moment_at <= now 或 NULL 的角色 / 镇民（双来源，谁先到期谁先发）
 * - 镇民每个自然滚动 24 小时最多发一条（调度查询里硬过滤，生成器排期兜底）
 * - 每次只处理一个（排队），避免并发生图撑爆 ComfyUI
 * - 发帖后随机设定下次发帖时间
 */

import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { getMomentDelay, getMomentIntervalMs } from './momentTiming.js';
import { getMomentIntervalSchedule, resetMomentIntervalSchedule, runIntervalMomentTick } from './momentIntervalScheduler.js';
import { getTownMaps } from './town/townService.js';
import { getPendingComplaint, markComplaintDone, postponeComplaint, buildComplaintTopic } from './newspaperService.js';

// 生成函数由路由层装配时注入（setMomentPostGenerator / setTownNpcPostGenerator），
// 避免服务层静态反向依赖路由模块（service → route）。
let momentPostGenerator = null;
export function setMomentPostGenerator(fn) {
  momentPostGenerator = fn;
}
let townNpcPostGenerator = null;
export function setTownNpcPostGenerator(fn) {
  townNpcPostGenerator = fn;
}

// 调度扫描可能带来最多一个扫描周期的额外等待，生图排队也会延后实际发帖。
const CHECK_INTERVAL = 5 * 60 * 1000;

let timer = null;
let startupTimer = null;
let processing = false;
let nextNpcCheckAt = 0;

const checkInterval = () => getMomentIntervalMs(config.features) ? 30_000 : CHECK_INTERVAL;

/** 切换模式仅重置一个全局计时；默认档的逐角色排期保留。 */
export function refreshMomentFrequency(previousFeatures) {
  if (getMomentIntervalMs(previousFeatures) === getMomentIntervalMs(config.features)
    && (previousFeatures.momentFreq ?? 1) === (config.features.momentFreq ?? 1)) {
    getMomentIntervalSchedule();
    return;
  }
  resetMomentIntervalSchedule();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, checkInterval());
  }
}

function toSQLiteDate(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// ── 《小镇早知道》吐槽帖 ──

/**
 * 当期报纸主角的额外吐槽帖：complaint_after 到期且角色可发时，用强制话题生成一条。
 * 成功后若角色原有的 next_moment_at 仍在未来则恢复原值——吐槽帖是"额外"的，不推迟常规发帖节奏。
 * @returns {number|false} 已处理吐槽帖的角色 id；没有发帖则返回 false。
 */
async function maybePostNewspaperComplaint() {
  const pending = getPendingComplaint();
  if (!pending) return false;
  const { newspaper, character, event } = pending;
  const db = getDb();

  if (!momentPostGenerator) {
    console.warn('[momentScheduler] newspaper complaint pending but moment post generator not wired yet');
    return false;
  }

  // 与常规候选一致的可发性校验（不满足就下个 tick 再试）
  const blocked = db.prepare(`
    SELECT 1 AS blocked FROM characters
    WHERE id = ? AND (
      moments_disabled = 1
      OR (is_sleeping IS NOT NULL AND is_sleeping = 1)
      OR (temporary_wake_until IS NOT NULL AND temporary_wake_until > datetime('now'))
      OR id IN (SELECT character_id FROM character_events WHERE status IN ('pending','open','engaged'))
    )
  `).get(character.id);
  if (blocked) return false;

  const topic = buildComplaintTopic(event, character.display_name);
  if (!topic) {
    // 特稿数据缺失（如旧数据），标记完成避免整天空转
    markComplaintDone(newspaper.id);
    return false;
  }

  try {
    const prevNextAt = character.next_moment_at;
    await momentPostGenerator(character, { forcedTopic: topic });
    markComplaintDone(newspaper.id);
    // generateMomentPost 成功后会重排 next_moment_at；原值仍在未来则恢复
    if (prevNextAt && db.prepare(`SELECT datetime(?) > datetime('now') AS is_future`).get(prevNextAt)?.is_future) {
      db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?').run(prevNextAt, character.id);
    }
    console.log(`[momentScheduler] Newspaper complaint posted for ${character.display_name}`);
    return character.id;
  } catch (err) {
    if (err.message !== 'ALREADY_GENERATING') {
      postponeComplaint(newspaper.id, 30);
      console.error(`[momentScheduler] Newspaper complaint failed for ${character.display_name}:`, err.message);
    }
    return false;
  }
}

async function tick() {
  if (processing || isMomentBackfillRunning()) {
    console.log('[momentScheduler] Previous post still generating, skip this tick');
    return;
  }

  // 关闭档是总开关；其他时间档只调整角色频率，镇民保留默认排期。
  const momentFreq = config.features.momentFreq ?? 1;
  if (momentFreq <= 0) return;
  const intervalMode = !!getMomentIntervalMs(config.features);
  const defaultCharacterMode = momentFreq > 0 && !intervalMode;

  const db = getDb();
  processing = true;
  try {
    if (intervalMode) {
      const attempted = await runIntervalMomentTick({
        generateCharacter: momentPostGenerator,
        postComplaint: maybePostNewspaperComplaint,
      });
      if (attempted) return;
    }
    // 0. 报纸吐槽帖：《小镇早知道》当期主角的额外发圈（优先于常规发帖，处理过就结束本 tick）
    if (defaultCharacterMode && await maybePostNewspaperComplaint()) return;

    // 找出下一个需要发帖的角色（next_moment_at <= now 或 NULL）
    // 跳过有活跃奇遇事件的角色
    const candidate = defaultCharacterMode ? db.prepare(`
      SELECT c.* FROM characters c
      WHERE c.moments_disabled = 0
        AND (c.is_sleeping IS NULL OR c.is_sleeping = 0)
        AND (c.temporary_wake_until IS NULL OR c.temporary_wake_until <= datetime('now'))
        AND (c.next_moment_at IS NULL OR c.next_moment_at <= datetime('now'))
        AND c.id NOT IN (
          SELECT character_id FROM character_events WHERE status IN ('pending','open','engaged')
        )
      ORDER BY c.next_moment_at ASC NULLS FIRST
      LIMIT 1
    `).get() : null;

    // 快速档只加快角色检查，不能把镇民的扫描也加快到每 30 秒。
    if (intervalMode && Date.now() < nextNpcCheckAt) return;
    nextNpcCheckAt = Date.now() + CHECK_INTERVAL;

    // 镇民朋友圈总开关（管理面板）：关闭后镇民不再进入调度，角色发帖不受影响
    // 多地图：只有玩家当前所在地图（聚焦图）的镇民能发帖，否则不消耗 LLM
    const currentMapId = getTownMaps().currentMapId;
    const townNpcMomentsOn = config.features.town === true && config.town.npcMomentsDisabled !== true;
    // 地图范围从句：拿到玩家所在地图就按图过滤镇民，世界还没建图（如旧库/测试桩）退回不分图口径
    const npcMapClause = currentMapId != null ? 'AND map_id = ?' : '';
    const npcMapClauseAliased = currentMapId != null ? 'AND n.map_id = ?' : '';
    const npcMapArgs = currentMapId != null ? [currentMapId] : [];
    // 镇民首次启动初始化：从未定时的镇民设定首帖时间（1~4 小时内），须在选候选前完成
    if (townNpcMomentsOn) {
      const pendingNpcs = db.prepare(
        `SELECT id FROM town_npcs WHERE town_enabled = 1 AND moments_disabled = 0 AND next_moment_at IS NULL ${npcMapClause}`
      ).all(...npcMapArgs);
      for (const n of pendingNpcs) {
        const delay = 3600_000 + Math.random() * 3 * 3600_000;
        db.prepare('UPDATE town_npcs SET next_moment_at = ? WHERE id = ?')
          .run(toSQLiteDate(new Date(Date.now() + delay).toISOString()), n.id);
      }
    }
    // 镇民候选：小镇开启时，镇民也能发朋友圈（同一队列排队，先到期先发）
    // 每个镇民 24 小时内最多一条（只数 done 帖，失败重试不受限）
    const npcCandidate = townNpcMomentsOn ? db.prepare(`
      SELECT n.* FROM town_npcs n
      WHERE n.town_enabled = 1 AND n.moments_disabled = 0
        ${npcMapClauseAliased}
        AND (n.next_moment_at IS NULL OR n.next_moment_at <= datetime('now'))
        AND n.id NOT IN (
          SELECT npc_id FROM moment_posts
          WHERE npc_id IS NOT NULL AND status = 'done'
            AND created_at >= datetime('now', '-24 hours')
        )
      ORDER BY n.next_moment_at ASC NULLS FIRST
      LIMIT 1
    `).get(...npcMapArgs) : null;

    // 两个来源都到期时，谁等得更久谁先发（NULL 视为最早）
    const dueKey = row => row?.next_moment_at || '';
    const useNpc = !!npcCandidate && (!candidate || dueKey(npcCandidate) <= dueKey(candidate));
    const pickedNpc = useNpc ? npcCandidate : null;

    if (!candidate && !pickedNpc) {
      if (!defaultCharacterMode) return;
      // 没有需要发帖的角色——给下一个最早发帖的角色估算时间
      const nextUp = db.prepare(`
        SELECT display_name, next_moment_at FROM characters
        WHERE moments_disabled = 0 AND next_moment_at IS NOT NULL
        ORDER BY next_moment_at ASC LIMIT 1
      `).get();
      if (nextUp) {
        console.log(`[momentScheduler] No pending posts. Next: ${nextUp.display_name} at ${nextUp.next_moment_at}`);
      } else {
        console.log('[momentScheduler] No active characters or all have NULL next_moment_at — initializing...');
        // 默认档首次启动：1~4 小时。
        const chars = db.prepare('SELECT id FROM characters WHERE moments_disabled = 0 AND next_moment_at IS NULL').all();
        for (const c of chars) {
          const delay = getMomentDelay(config.features, { initial: true });
          const nextAt = new Date(Date.now() + delay).toISOString();
          db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?')
            .run(toSQLiteDate(nextAt), c.id);
        }
        if (chars.length > 0) {
          console.log(`[momentScheduler] Initialized ${chars.length} character(s) with first post times`);
        }
      }
      return;
    }

    processing = true;
    const kindLabel = pickedNpc ? 'npc' : 'character';
    const picked = pickedNpc || candidate;
    console.log(`[momentScheduler] Generating ${kindLabel} moment for ${picked.display_name}...`);

    try {
      if (pickedNpc) {
        if (!townNpcPostGenerator) {
          console.warn('[momentScheduler] town npc post generator not wired yet, skip this tick');
          return;
        }
        await townNpcPostGenerator(pickedNpc);
      } else {
        if (!momentPostGenerator) {
          console.warn('[momentScheduler] moment post generator not wired yet, skip this tick');
          return;
        }
        await momentPostGenerator(candidate);
      }
      console.log(`[momentScheduler] Done: ${picked.display_name}`);
    } catch (err) {
      console.error(`[momentScheduler] Failed for ${picked.display_name}:`, err.message);
      // ALREADY_GENERATING 表示已有另一个生成任务在进行中（锁已设），跳过
      if (err.message !== 'ALREADY_GENERATING') {
        // 失败也设置下次时间，避免反复重试（30 分钟后重试）；镇民生成器内部已自设重试时间
        if (!pickedNpc) {
          const nextAt = new Date(Date.now() + 30 * 60_000).toISOString();
          db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?')
            .run(toSQLiteDate(nextAt), candidate.id);
        }
      }
    }
  } catch (err) {
    console.error('[momentScheduler] tick error:', err.message);
  } finally {
    processing = false;
  }
}

/**
 * 启动时清理僵尸 generating 帖子（>10 分钟未完成）
 * 确保版本升级后老用户的卡住帖子自动修复
 */
function cleanupStuckPosts() {
  const db = getDb();
  try {
    const stuck = db.prepare(`
      UPDATE moment_posts SET status = 'failed'
      WHERE status = 'generating'
        AND created_at < datetime('now', '-10 minutes')
    `).run();
    if (stuck.changes > 0) {
      console.log(`[momentScheduler] Cleaned up ${stuck.changes} stuck generating post(s)`);
      // 重置受影响角色/镇民的 next_moment_at，让它们立即重试
      db.prepare(`
        UPDATE characters
        SET next_moment_at = datetime('now', '+' || (ABS(RANDOM() % 300) + 30) || ' seconds')
        WHERE moments_disabled = 0
          AND next_moment_at <= datetime('now')
      `).run();
      if (config.features.town === true) {
        db.prepare(`
          UPDATE town_npcs
          SET next_moment_at = datetime('now', '+' || (ABS(RANDOM() % 300) + 30) || ' seconds')
          WHERE town_enabled = 1 AND moments_disabled = 0
            AND next_moment_at <= datetime('now')
        `).run();
      }
    }
  } catch (err) {
    console.error('[momentScheduler] cleanup error:', err.message);
  }
}

export function startMomentScheduler() {
  if (timer || startupTimer) return;
  console.log('[momentScheduler] Starting (interval:', checkInterval() / 60000, 'min)');

  // 启动时立即清理僵尸帖，无需等 30 秒
  cleanupStuckPosts();
  getMomentIntervalSchedule();

  // 启动后先等 30 秒再首次检查，让服务稳定下来
  startupTimer = setTimeout(() => {
    startupTimer = null;
    tick();
    timer = setInterval(tick, checkInterval());
  }, 30_000);
}

export function stopMomentScheduler() {
  nextNpcCheckAt = 0;
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[momentScheduler] Stopped');
  }
}

/** 测试入口：单次执行调度扫描（与 tick 相同逻辑，不启定时器）。 */
export const runSchedulerTick = tick;
