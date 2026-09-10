/**
 * Memory v3 阶段三：整理 daemon 调度器（记忆的"睡眠期"）
 * docs/memory-upgrade-plan.md §6.1
 *
 * 触发模型（四道闸门，逐级收紧）：
 *   1. 每 5 分钟扫描一次，但只有"空闲"才继续：无活跃前台聊天流（chatActivity）
 *      且距最后一条消息 ≥ idleDelayMinutes（默认 30 分钟）；
 *   2. 两次"真正干过活"的整理之间至少间隔 minIntervalMinutes（默认 60 分钟）——
 *      空闲判定在用户离开后会恒为真，没有这道闸门就等于"每 5 分钟一整轮"；
 *   3. 每日兜底：距上次真正干过活 > 22 小时时，即便不够空闲也执行（聊天进行中仍然让路）；
 *   4. 上一轮什么都没干成 → 退避 30 分钟，避免空转轮把候选发现查询每 5 分钟跑一遍。
 *
 * LLM 预算双层：
 *   - 单轮上限 llmCallsPerRun（默认 3）；
 *   - 每日总量 dailyLlmCalls（默认 60，跨轮累计、按上海日期归零、持久化在 state.daily）。
 *   旧配置键 dailyMaxLlmCalls 的语义本就是"每日总量"，由 memoryConfig 归位到 dailyLlmCalls。
 *
 * 任务队列：memory_consolidation_jobs（job_type/payload/status/attempts）。
 *   - 扫描时按候选发现结果入队（同类型已有 pending/processing 则不重复入队）；
 *   - SQL 任务（decay/tombstone）优先领取；同优先级内按"该类型上次完成时间"轮转，
 *     避免 T1/T2 长期吃满预算把 T4/T5 饿死；
 *   - 预算耗尽而任务未完成 → 留在 pending（或补一个后续任务），下次扫描自然续跑；
 *   - 启动时 processing → pending 恢复（kill 后续跑）；attempts ≥ 3 → failed 不再自动重试。
 *
 * 候选消费记账：见 memoryConsolidation.js 的 RECONSOLIDATE_AFTER_DAYS / markConsolidated——
 * 模型判定"无关/无需泛化/补不出字段"时同样记账，否则同一批候选会被无限重复送进 LLM。
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
const DAILY_FALLBACK_HOURS = 22;              // 每日兜底线（锚在"上次真正干过活"）
const STARTUP_DELAY_MS = 2 * 60 * 1000;       // 启动后首次扫描延迟
const MAX_ATTEMPTS = 3;                       // 任务失败重试上限
const EMPTY_SCAN_BACKOFF_MS = 30 * 60 * 1000; // 空转轮退避
const STATE_KEY = 'memory_consolidation_state';

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

// 每日额度按上海日期归零（与 memoryProviders 的失败计数同口径）
export function shanghaiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function readDailyUsage(state, now = new Date()) {
  const date = shanghaiDateKey(now);
  const used = state.daily?.date === date ? Math.max(0, Number(state.daily.used) || 0) : 0;
  return { date, used };
}

/**
 * 运行闸门决策（纯函数，便于单测）。三道时间闸门都在这里：
 *   1. not-idle        —— 不空闲且距上次实干 < 22h
 *   2. min-interval    —— 距上次实干 < minIntervalMinutes（空闲判定在用户离开后恒为真，
 *                         没有这道闸门就等于每 5 分钟一满轮）
 *   3. scan-backoff    —— 上一轮空手而归且退避期未过（避免空转轮反复做候选发现全表扫描）
 * 返回 { run: true } 或 { run: false, skipped }。force 由调用方绕过本函数。
 */
export function evaluateRunGates({ state = {}, cfg = {}, idle = false, now = Date.now() } = {}) {
  const withinMs = (iso, windowMs) => {
    if (!iso) return false;
    const parsed = new Date(iso).getTime();
    if (Number.isNaN(parsed)) return false;
    return now - parsed < windowMs;
  };
  // 不空闲时：距上次实干 < 22h 就让路；≥ 22h 走每日兜底（state 里没有实干记录则视为需要兜底）
  if (!idle && withinMs(state.lastWorkedAt, DAILY_FALLBACK_HOURS * 3600000)) {
    return { run: false, skipped: 'not-idle' };
  }
  if (withinMs(state.lastWorkedAt, Math.max(0, Number(cfg.minIntervalMinutes) || 0) * 60000)) {
    return { run: false, skipped: 'min-interval' };
  }
  if (withinMs(state.lastEmptyScanAt, EMPTY_SCAN_BACKOFF_MS)) {
    return { run: false, skipped: 'scan-backoff' };
  }
  return { run: true };
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
 * LLM 任务只在"确实有活干"时入队；候选是否重复由 memoryConsolidation 的记账表负责。
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

/**
 * 领取下一个 pending 任务。
 * 排序：SQL 任务永远优先；同为 LLM 任务时按"该类型上次完成时间"升序轮转——
 * 原先只按 id 升序会让 conflict/generalize 稳定吃满预算，portrait_suggest/backfill 永远排不上。
 */
function claimNextJob(db) {
  return db.transaction(() => {
    const job = db.prepare(`
      SELECT pj.* FROM memory_consolidation_jobs pj
      WHERE pj.status = 'pending'
      ORDER BY
        CASE WHEN pj.job_type IN ('decay', 'tombstone') THEN 0 ELSE 1 END,
        (SELECT COALESCE(MAX(hist.updated_at), '') FROM memory_consolidation_jobs hist
          WHERE hist.job_type = pj.job_type AND hist.status = 'completed') ASC,
        pj.id ASC
      LIMIT 1
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
  if (!force) {
    const gate = evaluateRunGates({ state, cfg, idle });
    if (!gate.run) return { skipped: gate.skipped };
  }

  if (executing) return { skipped: 'already-running' };
  executing = true;
  const summary = {};
  let jobsExecuted = 0;
  let llmCallsUsed = 0;
  try {
    const daily = readDailyUsage(state);
    const dailyRemaining = Math.max(0, cfg.dailyLlmCalls - daily.used);
    const llmBudgetForRun = Math.min(cfg.llmCallsPerRun, dailyRemaining);
    recoverInterruptedJobs(db);
    discoverAndEnqueueJobs(db, llmBudgetForRun);
    while (true) {
      const job = claimNextJob(db);
      if (!job) break;
      const isLlmJob = LLM_JOB_TYPES.has(job.job_type);
      const budgetRemaining = Math.max(0, llmBudgetForRun - llmCallsUsed);
      if (isLlmJob && budgetRemaining === 0) {
        // 预算耗尽：任务退回 pending，下轮扫描续跑（SQL 任务排序在前，不会被这里挡住）
        db.prepare(`UPDATE memory_consolidation_jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(job.id);
        break;
      }
      try {
        const result = await executeJob(job, { llmBudgetRemaining: budgetRemaining, db });
        llmCallsUsed += result.llmCalls || 0;
        // LLM 任务因预算中途让位 → 补一个后续任务（下轮接着跑剩余候选）
        if (isLlmJob && result.done === false && llmBudgetForRun - llmCallsUsed <= 0) {
          enqueueJob(db, job.job_type, { continuation: true });
        }
        finishJob(db, job.id, 'completed');
        jobsExecuted++;
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
    const nowIso = new Date().toISOString();
    const worked = jobsExecuted > 0;
    writeState({
      lastFinishedAt: nowIso,
      ...(worked ? { lastWorkedAt: nowIso, lastEmptyScanAt: null } : { lastEmptyScanAt: nowIso }),
      lastRunIdle: idle,
      llmCallsUsed,
      llmCallsPerRun: llmBudgetForRun,
      dailyLlmCalls: cfg.dailyLlmCalls,
      dailyMaxLlmCalls: undefined,
      daily: { date: daily.date, used: daily.used + llmCallsUsed },
      summary,
    });
    return {
      ok: true,
      idle,
      jobsExecuted,
      llmCallsUsed,
      dailyLlmCallsUsed: daily.used + llmCallsUsed,
      dailyLlmCalls: cfg.dailyLlmCalls,
      summary,
    };
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
  console.log('[consolidation] scheduler started (scan every 5min, idle+min-interval gated, daily LLM budget)');
}

export function stopConsolidationScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
