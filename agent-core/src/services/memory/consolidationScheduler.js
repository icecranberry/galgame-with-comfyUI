/**
 * Memory v3 阶段三：整理 daemon 调度器（记忆的"睡眠期"）
 * docs/memory-upgrade-plan.md §6.1
 *
 * 触发模型：
 *   - 每 5 分钟扫描一次；
 *   - 空闲判定通过才执行：无活跃聊天流（chatActivity）且距最后一条消息 ≥ idleDelayMinutes（默认 30 分钟）；
 *   - 每日兜底：距上次成功运行 > 22 小时时，即便不够空闲也执行（但聊天进行中仍然让路）；
 *   - daemon 永不在聊天进行中触发 LLM 调用。
 *
 * 任务队列：memory_consolidation_jobs（job_type/payload/status/attempts）。
 *   - 扫描时按候选发现结果入队（同类型已有 pending/processing 则不重复入队）；
 *   - SQL 任务（decay/tombstone）优先领取，LLM 任务受单轮预算 dailyMaxLlmCalls 约束；
 *   - 预算耗尽而任务未完成 → 留在 pending（或补一个后续任务），下次扫描自然续跑；
 *   - 启动时 processing → pending 恢复（kill 后续跑）；attempts ≥ 3 → failed 不再自动重试。
 *
 * 运行状态写入 system_settings('memory_consolidation_state')，管理接口可查。
 */

import { getDb } from '../../db/index.js';
import { chatSync } from '../../llm/llm-client.js';
import { config } from '../../config.js';
import { getConsolidationConfig } from './memoryConfig.js';
import { hasActiveChatStream } from '../chatActivity.js';
import {
  LLM_JOB_TYPES,
  findConflictClusters,
  findGeneralizationGroups,
  findPortraitSuggestionConversations,
  findBackfillCandidates,
  hasBackfillCandidates,
  runConflictResolutionTask,
  runGeneralizationTask,
  runPortraitSuggestionTask,
  runBackfillTask,
  runDecayTask,
  runTombstoneTask,
  taskEnabledByV3,
} from './memoryConsolidation.js';
import {
  enqueueMemoryDeleteJob,
  enqueueTripleDeleteJob,
  notifyMemoryIndexWorker,
} from './memoryRepository.js';

const SCAN_INTERVAL_MS = 5 * 60 * 1000;       // 扫描周期
const DAILY_FALLBACK_HOURS = 22;              // 每日兜底线
const STARTUP_DELAY_MS = 2 * 60 * 1000;       // 启动后首次扫描延迟
const MAX_ATTEMPTS = 3;                       // 任务失败重试上限
const STATE_KEY = 'memory_consolidation_state';

// SQL 任务（零 LLM）永远先于 LLM 任务执行，保证预算紧张时免费任务不被饿死
const FREE_JOB_TYPES = new Set(['decay', 'tombstone']);

let timer = null;
let executing = false;

// ── 状态存取 ──

function readState() {
  try {
    const row = getDb().prepare(`SELECT setting_value FROM system_settings WHERE setting_key = ?`).get(STATE_KEY);
    return row ? JSON.parse(row.setting_value) : {};
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  getDb().prepare(`
    INSERT INTO system_settings(setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `).run(STATE_KEY, JSON.stringify(next));
  return next;
}

// ── 空闲判定 ──

function lastMessageAgeMs() {
  const row = getDb().prepare(`SELECT MAX(created_at) AS latest FROM raw_messages`).get();
  if (!row?.latest) return Infinity;
  const parsed = new Date(String(row.latest).replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '') + 'Z');
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return Date.now() - parsed.getTime();
}

export function isIdleForConsolidation(idleDelayMinutes) {
  if (hasActiveChatStream()) return false;
  return lastMessageAgeMs() >= idleDelayMinutes * 60 * 1000;
}

// ── 任务队列 ──

function hasOpenJob(db, jobType) {
  return db.prepare(`SELECT 1 FROM memory_consolidation_jobs WHERE job_type = ? AND status IN ('pending', 'processing') LIMIT 1`).get(jobType);
}

function enqueueJob(db, jobType, payload = {}) {
  db.prepare(`INSERT INTO memory_consolidation_jobs(job_type, payload, status) VALUES (?, ?, 'pending')`)
    .run(jobType, JSON.stringify(payload));
}

function recoverInterruptedJobs(db) {
  const recovered = db.prepare(`
    UPDATE memory_consolidation_jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE status = 'processing'
  `).run().changes;
  if (recovered > 0) console.log(`[consolidation] recovered ${recovered} interrupted job(s)`);
  return recovered;
}

// 最近一次同类型任务完成时间（节流入队用）
function lastCompletedAt(db, jobType) {
  return db.prepare(`
    SELECT MAX(updated_at) AS at FROM memory_consolidation_jobs
    WHERE job_type = ? AND status = 'completed'
  `).get(jobType)?.at || null;
}

function completedBefore(db, jobType, withinMs) {
  const at = lastCompletedAt(db, jobType);
  if (!at) return true;
  const parsed = new Date(String(at).replace('T', ' ') + 'Z');
  if (Number.isNaN(parsed.getTime())) return true;
  return Date.now() - parsed.getTime() >= withinMs;
}

/**
 * 候选发现 + 入队。SQL 任务按时间节流（decay 6h / tombstone 24h），
 * LLM 任务只在"确实有活干"时入队，避免空转。
 */
function discoverAndEnqueueJobs(db, llmBudget) {
  if (!hasOpenJob(db, 'decay') && completedBefore(db, 'decay', 6 * 3600 * 1000)) {
    enqueueJob(db, 'decay');
  }
  if (!hasOpenJob(db, 'tombstone') && completedBefore(db, 'tombstone', 24 * 3600 * 1000)) {
    enqueueJob(db, 'tombstone');
  }
  if (llmBudget <= 0) return;
  const candidates = {
    conflict: () => findConflictClusters(db).length > 0,
    generalize: () => findGeneralizationGroups(db).length > 0,
    portrait_suggest: () => findPortraitSuggestionConversations(db).length > 0,
    backfill: () => hasBackfillCandidates(db),
  };
  for (const [jobType, hasWork] of Object.entries(candidates)) {
    if (!taskEnabledByV3(jobType)) continue;
    if (hasOpenJob(db, jobType)) continue;
    if (hasWork()) enqueueJob(db, jobType);
  }
}

function claimNextJob(db) {
  return db.transaction(() => {
    const job = db.prepare(`
      SELECT * FROM memory_consolidation_jobs WHERE status = 'pending'
      ORDER BY CASE WHEN job_type IN ('decay', 'tombstone') THEN 0 ELSE 1 END, id ASC LIMIT 1
    `).get();
    if (!job) return null;
    const claimed = db.prepare(`
      UPDATE memory_consolidation_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'
    `).run(job.id);
    return claimed.changes === 1 ? { ...job, payload: JSON.parse(job.payload || '{}') } : null;
  })();
}

function finishJob(db, jobId, status, error = null) {
  db.prepare(`
    UPDATE memory_consolidation_jobs SET status = ?, error = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, error ? String(error).slice(0, 500) : null, jobId);
}

// ── 任务执行分发 ──

async function executeJob(job, { llmBudgetRemaining, db }) {
  const deps = {
    db,
    chatSync,
    enqueueDelete: enqueueMemoryDeleteJob,
    enqueueTripleDelete: enqueueTripleDeleteJob,
  };
  switch (job.job_type) {
    case 'decay':
      return { ...runDecayTask({ db, enqueueDelete: deps.enqueueDelete, enqueueTripleDelete: deps.enqueueTripleDelete }), detail: undefined };
    case 'tombstone':
      return runTombstoneTask({ db, enqueueDelete: deps.enqueueDelete, enqueueTripleDelete: deps.enqueueTripleDelete });
    case 'conflict': {
      const clusters = findConflictClusters(db);
      return runConflictResolutionTask({ clusters, llmBudgetRemaining, deps });
    }
    case 'generalize': {
      const groups = findGeneralizationGroups(db);
      return runGeneralizationTask({ groups, llmBudgetRemaining, deps });
    }
    case 'portrait_suggest': {
      const conversations = findPortraitSuggestionConversations(db);
      return runPortraitSuggestionTask({ conversations, llmBudgetRemaining, deps });
    }
    case 'backfill': {
      const candidates = findBackfillCandidates(db, { limit: 10 });
      return runBackfillTask({ candidates, llmBudgetRemaining, deps });
    }
    default:
      throw new Error(`unsupported consolidation job type: ${job.job_type}`);
  }
}

// ── 单轮执行（扫描入口；手动触发也走这里）──

export async function runConsolidationOnce({ force = false } = {}) {
  const db = getDb();
  const cfg = getConsolidationConfig();
  if (!cfg.enabled || config.features.memory === false) return { skipped: 'disabled' };
  if (hasActiveChatStream()) return { skipped: 'chat-active' };

  const state = readState();
  const idle = isIdleForConsolidation(cfg.idleDelayMinutes);
  const hoursSinceRun = state.lastFinishedAt ? (Date.now() - new Date(state.lastFinishedAt).getTime()) / 3600000 : Infinity;
  if (!force && !idle && hoursSinceRun < DAILY_FALLBACK_HOURS) return { skipped: 'not-idle' };

  if (executing) return { skipped: 'already-running' };
  executing = true;
  const summary = {};
  try {
    recoverInterruptedJobs(db);
    discoverAndEnqueueJobs(db, cfg.dailyMaxLlmCalls);
    let llmCallsUsed = 0;
    while (true) {
      const job = claimNextJob(db);
      if (!job) break;
      const isLlmJob = LLM_JOB_TYPES.has(job.job_type);
      const budgetRemaining = Math.max(0, cfg.dailyMaxLlmCalls - llmCallsUsed);
      if (isLlmJob && budgetRemaining === 0) {
        // 预算耗尽：任务退回 pending，下轮扫描续跑
        db.prepare(`UPDATE memory_consolidation_jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(job.id);
        break;
      }
      try {
        const result = await executeJob(job, { llmBudgetRemaining: budgetRemaining, db });
        llmCallsUsed += result.llmCalls || 0;
        // LLM 任务因预算中途让位 → 补一个后续任务（下轮接着跑剩余候选）
        if (isLlmJob && result.done === false && cfg.dailyMaxLlmCalls - llmCallsUsed <= 0) {
          enqueueJob(db, job.job_type, { continuation: true });
        }
        finishJob(db, job.id, 'completed');
        summary[job.job_type] = result;
        console.log(`[consolidation] job ${job.job_type}#${job.id} completed:`, JSON.stringify(result).slice(0, 300));
      } catch (error) {
        const attempts = (job.attempts || 0) + 1;
        const nextStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        finishJob(db, job.id, nextStatus, error.message);
        console.warn(`[consolidation] job ${job.job_type}#${job.id} ${nextStatus} (attempt ${attempts}):`, error.message);
      }
    }
    if (llmCallsUsed > 0) notifyMemoryIndexWorker();
    writeState({ lastFinishedAt: new Date().toISOString(), lastRunIdle: idle, llmCallsUsed, summary });
    return { ok: true, idle, llmCallsUsed, summary };
  } finally {
    executing = false;
  }
}

// ── 生命周期 ──

export function startConsolidationScheduler() {
  if (timer) return;
  // 启动即恢复被 kill 打断的任务（续跑保证）
  try { recoverInterruptedJobs(getDb()); } catch (error) { console.warn('[consolidation] recover failed:', error.message); }
  timer = setInterval(() => {
    runConsolidationOnce().catch(error => console.warn('[consolidation] scan failed:', error.message));
  }, SCAN_INTERVAL_MS);
  timer.unref();
  // 启动后延迟首扫，避开启动风暴（index worker 初始化、向量服务重连等）
  setTimeout(() => {
    runConsolidationOnce().catch(error => console.warn('[consolidation] first scan failed:', error.message));
  }, STARTUP_DELAY_MS).unref();
  console.log('[consolidation] scheduler started (scan every 5min, idle-gated)');
}

export function stopConsolidationScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
