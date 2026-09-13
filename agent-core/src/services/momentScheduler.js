/**
 * 朋友圈定时发帖调度器
 *
 * - 每 10 分钟扫描一次
 * - 找出 next_moment_at <= now 或 NULL 的角色 / 镇民（双来源，谁先到期谁先发）
 * - 镇民每个自然滚动 24 小时最多发一条（调度查询里硬过滤，生成器排期兜底）
 * - 每次只处理一个（排队），避免并发生图撑爆 ComfyUI
 * - 发帖后随机设定下次发帖时间
 */

import { getDb } from '../db/index.js';
import { config } from '../config.js';

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

const CHECK_INTERVAL = 10 * 60 * 1000; // 10 分钟

let timer = null;
let processing = false;

function toSQLiteDate(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

async function tick() {
  if (processing) {
    console.log('[momentScheduler] Previous post still generating, skip this tick');
    return;
  }

  const db = getDb();
  try {
    // 找出下一个需要发帖的角色（next_moment_at <= now 或 NULL）
    // 跳过有活跃奇遇事件的角色
    const candidate = db.prepare(`
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
    `).get();

    // 镇民朋友圈总开关（管理面板）：关闭后镇民不再进入调度，角色发帖不受影响
    const townNpcMomentsOn = config.features.town === true && config.town.npcMomentsDisabled !== true;
    // 镇民首次启动初始化：从未定时的镇民设定首帖时间（1~4 小时内），须在选候选前完成
    if (townNpcMomentsOn) {
      const pendingNpcs = db.prepare(
        'SELECT id FROM town_npcs WHERE town_enabled = 1 AND moments_disabled = 0 AND next_moment_at IS NULL'
      ).all();
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
        AND (n.next_moment_at IS NULL OR n.next_moment_at <= datetime('now'))
        AND n.id NOT IN (
          SELECT npc_id FROM moment_posts
          WHERE npc_id IS NOT NULL AND status = 'done'
            AND created_at >= datetime('now', '-24 hours')
        )
      ORDER BY n.next_moment_at ASC NULLS FIRST
      LIMIT 1
    `).get() : null;

    // 两个来源都到期时，谁等得更久谁先发（NULL 视为最早）
    const dueKey = row => row?.next_moment_at || '';
    const useNpc = !!npcCandidate && (!candidate || dueKey(npcCandidate) <= dueKey(candidate));
    const pickedNpc = useNpc ? npcCandidate : null;

    if (!candidate && !pickedNpc) {
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
        // 首次启动：给所有角色设定首次发帖时间（1~4 小时内）
        const chars = db.prepare('SELECT id FROM characters WHERE moments_disabled = 0 AND next_moment_at IS NULL').all();
        for (const c of chars) {
          const delay = 1 * 3600_000 + Math.random() * 3 * 3600_000;
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
  console.log('[momentScheduler] Starting (interval:', CHECK_INTERVAL / 60000, 'min)');

  // 启动时立即清理僵尸帖，无需等 30 秒
  cleanupStuckPosts();

  // 启动后先等 30 秒再首次检查，让服务稳定下来
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL);
  }, 30_000);
}

export function stopMomentScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[momentScheduler] Stopped');
  }
}

/** 测试入口：单次执行调度扫描（与 tick 相同逻辑，不启定时器）。 */
export const runSchedulerTick = tick;
