/**
 * 记忆系统体检：把"哪些环节没配好"聚合成一份可执行的结论，供设置页直接展示。
 *
 * 为什么需要它：记忆出问题时症状都在别处——角色记不住事、语义搜不到、整理迟迟没动静——
 * 而原因分散在四个阶段开关、两套 provider（嵌入/重排）和一个独立的 Python 向量服务上。
 * 出问题的人第一反应往往是"这功能是不是没做"，而不是"我没配"。这里一次性给出
 * 「当前生效的是什么、缺什么、缺了会怎样、去哪里配」，避免在设置页里逐个猜。
 *
 * 只读聚合，不做任何写入；向量服务探测失败不抛错（降级为 reachable=false）。
 */
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';
import { getMemorySettings, getActiveSearchConfig, getConsolidationConfig } from './memoryConfig.js';
import { getPreferredMemoryEmbeddingProfile } from './memoryProviders.js';
import { healthCheck } from '../vectorClient.js';

const SOURCE_LABEL = Object.freeze({
  user: '自定义模型',
  builtin: '内置默认服务',
  local: '本地模型',
});

function readConsolidationState(db) {
  const row = db.prepare(`SELECT setting_value, updated_at FROM system_settings WHERE setting_key = 'memory_consolidation_state'`).get();
  let state = null;
  if (row?.setting_value) { try { state = JSON.parse(row.setting_value); } catch { state = null; } }
  return { hasState: Boolean(row), updatedAt: row?.updated_at || null, state };
}

export async function memoryHealth() {
  const db = getDb();
  const settings = getMemorySettings({ includeSecrets: true });
  const embedding = getPreferredMemoryEmbeddingProfile(settings, 'embedding');
  const enabled = config.features.memory !== false;
  const llmReady = config.llm.freeEgg === true || Boolean(config.llm.apiKey);
  const vectorServiceReachable = await healthCheck();

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
      SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) AS superseded,
      SUM(CASE WHEN embedding_state = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN embedding_state IN ('stale', 'pending') THEN 1 ELSE 0 END) AS reindexPending
    FROM memory_fragments
  `).get() || {};
  const indexJobs = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM memory_index_jobs
  `).get() || {};
  const lastRetrievalAt = db.prepare(`SELECT MAX(created_at) AS at FROM memory_retrieval_audits`).get()?.at || null;
  const consolidation = readConsolidationState(db);
  const consolidationConfig = getConsolidationConfig();
  const activeSearch = getActiveSearchConfig();

  // ── 结论：按"会不会真的坏事"排序，每条都给出去哪里配 ──
  const issues = [];
  if (!enabled) {
    issues.push({
      level: 'off',
      code: 'memory-off',
      title: '记忆系统已关闭',
      detail: '角色不会记住任何新内容。需要时打开上方「启用聊天记忆」开关即可。',
      where: '本页上方开关',
    });
  } else {
    if (!llmReady) {
      issues.push({
        level: 'error',
        code: 'llm-missing',
        title: '对话大模型没有配置 Key',
        detail: '记忆的「写入」靠模型整理对话、整理 daemon 也靠模型，所以这两条链路都不会执行——只有「召回已有记忆」还能用。这就是"角色什么都记不住"最常见的原因。',
        where: '模型设置里填 API Key，或在会话里临时开启「免费鸡蛋」',
      });
    }
    if (!vectorServiceReachable) {
      issues.push({
        level: 'warn',
        code: 'vector-down',
        title: '向量服务不可达（:8765）',
        detail: '语义检索、三元组联想与 @memory 主动回想会降级；关键字检索仍然可用。注意：无论嵌入用云端还是本地，向量库都在这个服务里。',
        where: '确认随主服务一起启动了 vector-service',
      });
    }
    if (Number(counts.failed) > 0) {
      issues.push({
        level: 'warn',
        code: 'embed-failed',
        title: `${counts.failed} 条记忆的向量索引失败`,
        detail: '通常是索引当时向量服务或嵌入服务不可用。现在会自动重试 3 次，仍失败的可手动重试。',
        where: '本页「重建索引」/「重试失败任务」',
      });
    }
    if (!consolidation.hasState) {
      issues.push({
        level: 'info',
        code: 'consolidation-pending',
        title: '记忆整理还没有跑过一轮',
        detail: '整理 daemon 每 5 分钟扫描一次，需要「无人聊天 + 距上次消息满 30 分钟」才会动手；启动后首次扫描在 2 分钟。还没跑过通常只是条件没满足。',
        where: '本页「记忆整理」卡片可手动触发一次',
      });
    }
    if (consolidation.state?.lastFailedJob) {
      issues.push({
        level: 'info',
        code: 'consolidation-last-failed',
        title: `上次整理任务失败：${consolidation.state.lastFailedJob.jobType}`,
        detail: consolidation.state.lastFailedJob.error || '见整理任务队列。',
        where: '本页「记忆整理」卡片',
      });
    }
  }

  const level = issues.some(item => item.level === 'error') ? 'error'
    : issues.some(item => item.level === 'warn') ? 'warn'
      : enabled ? 'ok' : 'off';

  return {
    level,
    enabled,
    llm: { ready: llmReady, freeEgg: config.llm.freeEgg === true, hasApiKey: Boolean(config.llm.apiKey) },
    embedding: {
      source: embedding.source,
      label: SOURCE_LABEL[embedding.source] || embedding.source,
      fingerprint: embedding.fingerprint,
      customConfigured: settings.embedding.enabled === true,
      useBuiltin: settings.embedding.useBuiltin !== false,
    },
    reranker: {
      customConfigured: settings.reranker.enabled === true,
      useBuiltin: settings.reranker.useBuiltin !== false,
    },
    vectorService: { reachable: vectorServiceReachable },
    switches: {
      v3: settings.v3?.enabled !== false,
      activeSearch: activeSearch.enabled,
      consolidation: consolidationConfig.enabled,
      contextBudget: settings.contextBudget?.enabled === true,
    },
    counts: {
      active: Number(counts.active) || 0,
      archived: Number(counts.archived) || 0,
      superseded: Number(counts.superseded) || 0,
      embeddingFailed: Number(counts.failed) || 0,
      reindexPending: Number(counts.reindexPending) || 0,
      indexJobsPending: Number(indexJobs.pending) || 0,
      indexJobsFailed: Number(indexJobs.failed) || 0,
    },
    lastRetrievalAt,
    consolidation: {
      hasState: consolidation.hasState,
      updatedAt: consolidation.updatedAt,
      lastWorkedAt: consolidation.state?.lastWorkedAt || null,
      lastEmptyScanAt: consolidation.state?.lastEmptyScanAt || null,
      dailyUsed: consolidation.state?.daily?.used ?? 0,
      dailyLimit: consolidationConfig.dailyLlmCalls,
    },
    issues,
  };
}
