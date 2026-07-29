/**
 * Per-turn LLM 调用汇总
 *
 * 一条用户消息可触发多次 LLM 调用（主回复、生图判断、生图 prompt、情绪评估、
 * 记忆提取、画像提取、摘要、回复猜想…）。单次调用的 usage 日志散落各处，
 * 无法回答"这一轮总共花了多少 token / 哪个功能最烧钱"。
 *
 * 机制：
 *   - 路由入口调 beginTurn(label)，通过 AsyncLocalStorage 把统计对象绑定到
 *     本次请求的异步上下文——响应结束后仍在继续的后处理调用（记忆提取、
 *     摘要等 fire-and-forget promise）同样继承该上下文，无需改动任何调用方。
 *   - llm-client 每次调用结束时调 recordLlmCall(label, usage)。
 *   - 最后一次调用后静默 10s 触发汇总日志（后处理链一般在回复后数秒内完成）。
 *   - 无 turn 上下文的调用（后台调度器）不参与统计，维持原有单次日志。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

// 最后一次 LLM 调用后静默此时长即输出汇总（覆盖异步后处理的收尾时间）
const SUMMARY_DEBOUNCE_MS = 10_000;

/** 在请求处理入口调用，开启本轮统计（须在首个 await 之前调用） */
export function beginTurn(label) {
  als.enterWith({
    label,
    startedAt: Date.now(),
    calls: [],   // { label, prompt, completion, cacheHit, failed }
    timer: null,
    flushed: false,
  });
}

/**
 * 记录一次 LLM 调用（由 llm-client 在调用结束/最终失败时触发）
 * @param {string} label - 调用用途标签（chat/judge/memory_extract/...）
 * @param {object|null} usage - OpenAI 风格 usage 对象，第三方渠道可能为 null
 */
export function recordLlmCall(label, usage, { failed = false } = {}) {
  const turn = als.getStore();
  if (!turn || turn.flushed) return;

  turn.calls.push({
    label,
    prompt: usage?.prompt_tokens ?? 0,
    completion: usage?.completion_tokens ?? 0,
    cacheHit: usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0,
    failed,
  });

  if (turn.timer) clearTimeout(turn.timer);
  turn.timer = setTimeout(() => flushTurn(turn), SUMMARY_DEBOUNCE_MS);
  turn.timer.unref();
}

function fmtTokens(n) {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function flushTurn(turn) {
  if (turn.flushed || turn.calls.length === 0) return;
  turn.flushed = true;

  const totalPrompt = turn.calls.reduce((s, c) => s + c.prompt, 0);
  const totalCompletion = turn.calls.reduce((s, c) => s + c.completion, 0);
  const totalCacheHit = turn.calls.reduce((s, c) => s + c.cacheHit, 0);
  const failedCount = turn.calls.filter(c => c.failed).length;
  const elapsed = Math.round((Date.now() - turn.startedAt - SUMMARY_DEBOUNCE_MS) / 1000);

  // 按 label 聚合明细：label(次数, prompt→输出)
  const byLabel = new Map();
  for (const c of turn.calls) {
    const agg = byLabel.get(c.label) || { count: 0, prompt: 0, completion: 0 };
    agg.count += 1;
    agg.prompt += c.prompt;
    agg.completion += c.completion;
    byLabel.set(c.label, agg);
  }
  const detail = [...byLabel.entries()]
    .sort((a, b) => b[1].prompt - a[1].prompt)
    .map(([label, a]) => `${label}(${a.count}次, ${fmtTokens(a.prompt)}→${fmtTokens(a.completion)})`)
    .join(' ');

  const hitPct = totalPrompt > 0 ? ` (缓存命中 ${Math.round((totalCacheHit / totalPrompt) * 100)}%)` : '';
  const usageNote = totalPrompt === 0 ? '（渠道未返回 usage，token 数不可用）' : '';
  const failNote = failedCount > 0 ? ` | 失败 ${failedCount} 次` : '';

  console.log(
    `\n┄┄┄┄┄┄┄┄┄┄ [turn] ${turn.label} 轮次汇总 ┄┄┄┄┄┄┄┄┄┄\n` +
    `  ${turn.calls.length} 次 LLM 调用 | prompt ${fmtTokens(totalPrompt)}${hitPct} | 输出 ${fmtTokens(totalCompletion)} | 历时 ~${elapsed}s${failNote} ${usageNote}\n` +
    `  明细: ${detail}\n` +
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`
  );
}
