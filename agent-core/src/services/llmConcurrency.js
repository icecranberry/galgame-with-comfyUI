/**
 * 后台 LLM 任务并发限制器 (Semaphore)
 *
 * - 仅当 config.features.serializeBackgroundLLM 为 true 时生效
 * - 限制后台任务（朋友圈/奇遇/主动聊天配图）的 LLM+ComfyUI 全流程并发数
 * - 云端 API 用户（maxConcurrency = null）零开销
 */

let maxConcurrency = null;
let activeCount = 0;
let waitQueue = [];

export function setMaxConcurrency(n) {
  maxConcurrency = n ?? null;
  if (maxConcurrency !== null) {
    console.log(`[llmConcurrency] Max background concurrency set to ${maxConcurrency}`);
  } else {
    console.log('[llmConcurrency] Disabled (unlimited)');
  }
  processQueue();
}

function processQueue() {
  while (maxConcurrency !== null && activeCount < maxConcurrency && waitQueue.length > 0) {
    const next = waitQueue.shift();
    activeCount++;
    next();
  }
}

export async function acquireSlot() {
  if (maxConcurrency === null) return;
  if (activeCount < maxConcurrency) {
    activeCount++;
    return;
  }
  return new Promise(resolve => {
    waitQueue.push(() => {
      resolve();
    });
    processQueue();
  });
}

export function releaseSlot() {
  if (maxConcurrency === null) return;
  activeCount--;
  processQueue();
}

/**
 * 包裹后台 LLM 全流程函数，限制并发
 * @param {() => Promise<T>} fn 后台任务全流程（LLM → ComfyUI）
 * @returns {Promise<T>}
 */
export async function runWithLimit(fn) {
  if (maxConcurrency === null) return fn();
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

/**
 * 从 config 对象读取并应用并发限制
 * @param {object} cfg - config 对象
 */
export function applyFromConfig(cfg) {
  const enabled = cfg.features?.serializeBackgroundLLM;
  if (enabled) {
    setMaxConcurrency(cfg.features.backgroundLLMMaxConcurrency ?? 3);
  } else {
    setMaxConcurrency(null);
  }
}
