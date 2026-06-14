/**
 * 朋友圈定时发帖调度器
 *
 * - 每 10 分钟扫描一次
 * - 找出 next_moment_at <= now 或 NULL 的角色
 * - 每次只处理一个（排队），避免并发生图撑爆 ComfyUI
 * - 发帖后随机设定下次发帖时间（2~8 小时）
 */

import { getDb } from '../db/index.js';
import { generateMomentPost } from '../routes/moments.js';

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
    const candidate = db.prepare(`
      SELECT * FROM characters
      WHERE is_active = 1
        AND (next_moment_at IS NULL OR next_moment_at <= datetime('now'))
      ORDER BY next_moment_at ASC NULLS FIRST
      LIMIT 1
    `).get();

    if (!candidate) {
      // 没有需要发帖的角色——给下一个最早发帖的角色估算时间
      const nextUp = db.prepare(`
        SELECT display_name, next_moment_at FROM characters
        WHERE is_active = 1 AND next_moment_at IS NOT NULL
        ORDER BY next_moment_at ASC LIMIT 1
      `).get();
      if (nextUp) {
        console.log(`[momentScheduler] No pending posts. Next: ${nextUp.display_name} at ${nextUp.next_moment_at}`);
      } else {
        console.log('[momentScheduler] No active characters or all have NULL next_moment_at — initializing...');
        // 首次启动：给所有角色设定首次发帖时间（1~4 小时内）
        const chars = db.prepare('SELECT id FROM characters WHERE is_active = 1 AND next_moment_at IS NULL').all();
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
    console.log(`[momentScheduler] Generating moment for ${candidate.display_name}...`);

    try {
      await generateMomentPost(candidate);
      console.log(`[momentScheduler] Done: ${candidate.display_name}`);
    } catch (err) {
      console.error(`[momentScheduler] Failed for ${candidate.display_name}:`, err.message);
      // 失败也设置下次时间，避免反复重试（30 分钟后重试）
      const nextAt = new Date(Date.now() + 30 * 60_000).toISOString();
      db.prepare('UPDATE characters SET next_moment_at = ? WHERE id = ?')
        .run(toSQLiteDate(nextAt), candidate.id);
    }
  } catch (err) {
    console.error('[momentScheduler] tick error:', err.message);
  } finally {
    processing = false;
  }
}

export function startMomentScheduler() {
  console.log('[momentScheduler] Starting (interval:', CHECK_INTERVAL / 60000, 'min)');

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
