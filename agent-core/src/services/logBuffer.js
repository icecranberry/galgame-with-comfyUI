import { format } from 'node:util';
import { readFileSync, mkdirSync, statSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────
// 运行日志内存环形缓冲（可选落盘持久化）
//
// 目标：把 agent-core 运行时的 console 输出在内存里留一份，供前端「运行日志」页
// 通过 GET /api/logs 增量拉取。核心难点是 llm-client.js 的一次 LLM 调用会打印
// 成十几行 console.log，需要按「文本流」把它们聚合成一个 kind:'llm' 块。
// 只记录 LLM 输入输出块；启动/调度/连接等普通单行日志一律不入缓冲、不落盘。
//
// 持久化（默认开启，可通过环境变量关闭）：
//  - 每条 entry 异步 append 一行 JSON 到文件（串行写队列，不 await 阻塞主流程）；
//  - 启动时同步读回文件，恢复 entries / totalBytes / seq（dropped 归零）；
//  - 另用 meta 文件记录 seqMax，保证 clearLogs 后重启 seq 仍单调；
//  - 文件超过 CAP_BYTES 时异步 compact（tmp + rename 原子替换）。
//
// 约束（切勿违反）：
//  1) 本模块内部**绝不调用 console**，否则 installConsoleCapture 之后会递归死循环。
//  2) installConsoleCapture 必须幂等。
//  3) 环形上限按 UTF-8 字节（Buffer.byteLength），超限从最旧（数组头）丢弃。
// ─────────────────────────────────────────────────────────────

/** 环形缓冲上限：5MB（UTF-8 字节）。 */
export const CAP_BYTES = 5 * 1024 * 1024;

// pending 块超过 8MB 才强制 flush（LLM 的 messages + 思考链 + 正文可能较大，
// 阈值太小会把一次流式调用从中间截断；8MB 仅作内存保护的极端兜底）。
const DEFAULT_MAX_BLOCK_BYTES = 8 * 1024 * 1024;
// 空闲 flush 兜底时长：流式 LLM 生成期间 llm-client 不打印中间 token，
// 若沿用短超时（如 3s）会把「输入」与「输出」拆成两条，导致日志断开。
// 这里放宽到 10 分钟，正常调用一律以收尾行 `═══...` 结束并落盘。
const DEFAULT_BLOCK_IDLE_MS = 10 * 60 * 1000;

// 起始行：`══════════ [provider → label] ══════════`
// group1 = provider, group2 = label（label 可能含 `[reqId]` 后缀，原样保留）
const START_RE = /^\s*═{5,}\s*\[\s*(.+?)\s*→\s*(.+?)\s*\]\s*═{5,}\s*$/;
// 收尾行：只由 ≥30 个 ═ 组成
const END_RE = /^\s*═{30,}\s*$/;

/** 神说聊天流仅在日志缓冲/落盘时精简输入；console 原始参数不改写。 */
function storedBlockText({ label, provider, lines }) {
  if (!/^神说(?: \[[^\n]*\])?$/.test(label)) return lines.join('\n');
  const boundary = lines.findIndex((line, i) => i > 0 && (
    line.startsWith(`[${label}] model=`)
    || /^\s*─{5,}\s*$/.test(line)
    || line.startsWith(`[${provider} ←`)
    || END_RE.test(line)
  ));
  const inputEnd = boundary < 0 ? lines.length : boundary;
  let lastUser;
  try {
    const messages = JSON.parse(lines.slice(1, inputEnd).join('\n'));
    if (Array.isArray(messages)) lastUser = messages.findLast(message => message?.role === 'user');
  } catch {
    // 强制 flush 时输入可能尚未完整；不把截断的历史内容写入持久化日志。
  }
  return [lines[0], JSON.stringify(lastUser ? [lastUser] : [], null, 2), ...lines.slice(inputEnd)].join('\n');
}

/** 默认日志文件：基于本文件位置解析到 agent-core/data/runtime-log.jsonl，不依赖 cwd。 */
function resolveDefaultLogFile() {
  const here = path.dirname(fileURLToPath(import.meta.url)); // agent-core/src/services
  return path.join(here, '..', '..', 'data', 'runtime-log.jsonl');
}

/** meta 文件：与日志文件同目录。 */
function resolveDefaultMetaPath(filePath) {
  return path.join(path.dirname(filePath), 'runtime-log.meta.json');
}

/** 环境变量开关：默认开启；'0' / 'false' 关闭（=纯内存，完全不碰磁盘）。 */
function envPersistEnabled() {
  const raw = process.env.AGENT_CORE_LOG_PERSIST;
  if (raw == null || raw === '') return true;
  const s = String(raw).trim().toLowerCase();
  return !(s === '0' || s === 'false');
}

/**
 * 创建一个独立的日志缓冲实例（纯内存，不碰全局 console）。
 * 单测用它可以完全隔离，不会污染其它测试；生产用模块底部的全局单例。
 *
 * @param {object} [options]
 * @param {number} [options.capBytes]          环形上限字节
 * @param {number} [options.maxBlockBytes]     pending 块强制 flush 阈值
 * @param {number} [options.blockIdleMs]       pending 块空闲 flush 毫秒
 * @param {Function} [options.setTimeoutImpl]  便于单测注入假定时器
 * @param {Function} [options.clearTimeoutImpl]
 * @param {boolean} [options.persist]          是否落盘（工厂默认 false，只有显式 true 才写盘）
 * @param {string}  [options.filePath]         日志文件路径（persist 时使用）
 * @param {string}  [options.metaPath]         seq meta 文件路径（默认与 filePath 同目录）
 */
export function createLogBuffer(options = {}) {
  const capBytes = Number.isFinite(options.capBytes) ? options.capBytes : CAP_BYTES;
  const maxBlockBytes = Number.isFinite(options.maxBlockBytes) ? options.maxBlockBytes : DEFAULT_MAX_BLOCK_BYTES;
  const blockIdleMs = Number.isFinite(options.blockIdleMs) ? options.blockIdleMs : DEFAULT_BLOCK_IDLE_MS;
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;

  // 工厂默认不落盘，避免单测被动写真实 data/；只有显式 persist:true 才启用。
  const persistEnabled = options.persist === true;
  const filePath = options.filePath || (persistEnabled ? resolveDefaultLogFile() : null);
  const metaPath = persistEnabled
    ? (options.metaPath || resolveDefaultMetaPath(filePath))
    : null;

  /** @type {Array<{seq:number, ts:string, kind:'llm'|'log', label:string|null, provider:string|null, level:string|null, text:string}>} */
  const entries = [];
  let totalBytes = 0;
  let dropped = 0;
  let seqCounter = 0;

  /** 当前正在聚合的 LLM 块；null 表示不在块内 */
  let pending = null; // { provider, label, lines: string[], bytes: number }
  let timerHandle = null;

  // ── 持久化状态 ──
  let writeChain = Promise.resolve(); // 串行写队列
  let approxFileBytes = 0;            // 近似文件字节（用于触发 compact）
  let writeFailed = false;           // 写失败仅内部标记，绝不打印
  let loadedSkipped = 0;             // 启动回填时跳过的旧普通日志条数（用于清理旧文件）

  function clearTimer() {
    if (timerHandle) {
      try { clearTimeoutImpl(timerHandle); } catch { /* 忽略 */ }
      timerHandle = null;
    }
  }

  function armTimer() {
    clearTimer();
    const handle = setTimeoutImpl(() => {
      timerHandle = null;
      flushPending();
    }, blockIdleMs);
    // 定时器不应阻止进程退出
    if (handle && typeof handle.unref === 'function') handle.unref();
    timerHandle = handle;
  }

  // ── 持久化实现 ──

  function enqueueWrite(task) {
    if (!persistEnabled) return;
    writeChain = writeChain.then(task).catch(() => { writeFailed = true; });
  }

  async function writeMeta() {
    try {
      await fsp.writeFile(metaPath, JSON.stringify({ seqMax: seqCounter }), 'utf8');
    } catch {
      writeFailed = true;
    }
  }

  /** 用内存 entries 去掉最旧使「序列化估算字节」<= cap，然后 tmp+rename 原子替换。 */
  async function compactFile() {
    if (!persistEnabled) return;
    const serialized = entries.map((e) => JSON.stringify(e) + '\n');
    let bytes = 0;
    for (const s of serialized) bytes += Buffer.byteLength(s, 'utf8');
    let start = 0;
    while (bytes > capBytes && entries.length - start > 1) {
      bytes -= Buffer.byteLength(serialized[start], 'utf8');
      start += 1;
    }
    if (start > 0) {
      // 同步裁剪内存，保持内存与文件一致
      entries.splice(0, start);
      totalBytes = 0;
      for (const e of entries) totalBytes += Buffer.byteLength(e.text, 'utf8');
      dropped += start;
    }
    const data = entries.map((e) => JSON.stringify(e) + '\n').join('');
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsp.writeFile(tmp, data, 'utf8');
      await fsp.rename(tmp, filePath);
      approxFileBytes = Buffer.byteLength(data, 'utf8');
    } catch {
      writeFailed = true;
      // 清理残留 tmp，忽略失败
      try { await fsp.unlink(tmp); } catch { /* 忽略 */ }
    }
  }

  /** 异步 append 一条 entry，并在必要时触发 meta 更新与 compact。 */
  function persistEntry(entry) {
    if (!persistEnabled) return;
    const line = JSON.stringify(entry) + '\n';
    enqueueWrite(async () => {
      await fsp.appendFile(filePath, line, 'utf8');
      approxFileBytes += Buffer.byteLength(line, 'utf8');
      // meta 只在 clearLogs 时更新：正常重启靠文件最后一条 entry 的 seq 恢复即可，
      // 每条 entry 都写 meta 会让磁盘 IO 翻倍且无必要。
      if (approxFileBytes > capBytes) await compactFile();
    });
  }

  /** 同步读回文件 + meta，恢复 entries / totalBytes / seq。 */
  function loadFromDisk() {
    let raw = '';
    try { raw = readFileSync(filePath, 'utf8'); } catch { raw = ''; }
    let lastSeq = 0;
    loadedSkipped = 0;
    if (raw) {
      for (const line of raw.split('\n')) {
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; } // 跳过坏行
        if (!obj || typeof obj.seq !== 'number' || !Number.isFinite(obj.seq)) continue;
        // seq 单调要覆盖所有历史行（含将被跳过的旧普通日志）
        if (obj.seq > lastSeq) lastSeq = obj.seq;
        // 兼容旧版本文件：只保留 LLM 块，跳过普通日志行
        if (obj.kind !== 'llm') { loadedSkipped += 1; continue; }
        const text = typeof obj.text === 'string' ? obj.text : String(obj.text ?? '');
        entries.push({
          seq: obj.seq,
          ts: typeof obj.ts === 'string' ? obj.ts : new Date().toISOString(),
          kind: 'llm',
          label: obj.label ?? null,
          provider: obj.provider ?? null,
          level: obj.level ?? null,
          text,
        });
        totalBytes += Buffer.byteLength(text, 'utf8');
      }
    }
    let metaSeq = 0;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta && typeof meta.seqMax === 'number' && Number.isFinite(meta.seqMax)) metaSeq = meta.seqMax;
    } catch { /* meta 不存在或损坏 -> 0 */ }
    seqCounter = Math.max(lastSeq, metaSeq);
    try { approxFileBytes = statSync(filePath).size; } catch { approxFileBytes = totalBytes; }
    dropped = 0;
  }

  // 初始化持久化（目录 + 回填）
  if (persistEnabled) {
    try { mkdirSync(path.dirname(filePath), { recursive: true }); } catch { writeFailed = true; }
    loadFromDisk();
    // 旧文件里若混有普通日志行，重写一次把它清掉（只留 LLM 块）
    if (loadedSkipped > 0) enqueueWrite(compactFile);
  }

  function pushEntry({ kind, label, provider, level, text }) {
    seqCounter += 1;
    const entry = {
      seq: seqCounter,
      ts: new Date().toISOString(),
      kind,
      label: label ?? null,
      provider: provider ?? null,
      level: level ?? null,
      text: typeof text === 'string' ? text : String(text ?? ''),
    };
    entries.push(entry);
    totalBytes += Buffer.byteLength(entry.text, 'utf8');
    // 环形丢弃：超限从最旧（数组头）丢，累计 dropped；至少保留最新 1 条
    while (totalBytes > capBytes && entries.length > 1) {
      const removed = entries.shift();
      totalBytes -= Buffer.byteLength(removed.text, 'utf8');
      dropped += 1;
    }
    persistEntry(entry);
    return entry;
  }

  function flushPending() {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimer();
    // 即使没有收尾行也保存
    pushEntry({ kind: 'llm', label: p.label, provider: p.provider, level: null, text: storedBlockText(p) });
  }

  function beginPending(provider, label, firstLine) {
    pending = {
      provider,
      label,
      lines: [firstLine],
      bytes: Buffer.byteLength(firstLine, 'utf8') + 1,
    };
    armTimer();
  }

  /**
   * 送入一段 console 文本（可能多行）。逐行扫描：
   *  - 遇起始行开始一个 llm 块；块内所有行（含起止行）合并；
   *  - 遇收尾行结束块；块可跨多次输入；
   *  - 块外的普通日志行**直接忽略**：本缓冲只保留 LLM 输入输出块
   *    （kind:'llm'），不记录启动/调度/连接等普通单行日志；
   *  - 一个块必须等到收尾行 `═══...` 才生成 entry 并落盘，因此落盘的
   *    永远是「完整的输入+输出」，流式生成期间不会把输入提前写出去。
   * @param {string} text
   * @param {string} [_level] 保留形参以兼容 installConsoleCapture，当前不使用
   */
  function push(text, _level = 'log') {
    const input = typeof text === 'string' ? text : String(text ?? '');
    const lines = input.split('\n');

    for (const line of lines) {
      if (pending) {
        // 上一块没等到收尾行就来了新块：先把旧块完整保存，再开新块，
        // 避免新块被吞进旧块、也避免旧块丢失。
        const next = START_RE.exec(line);
        if (next) {
          flushPending();
          beginPending(next[1], next[2], line);
          continue;
        }
        pending.lines.push(line);
        pending.bytes += Buffer.byteLength(line, 'utf8') + 1;
        armTimer(); // 有新增即重置空闲计时
        if (END_RE.test(line)) {
          flushPending();
        } else if (pending.bytes > maxBlockBytes) {
          // 块过大强制 flush（无收尾行也保存）
          flushPending();
        }
      } else {
        const m = START_RE.exec(line);
        if (m) beginPending(m[1], m[2], line);
        // 非起始行的块外普通日志一律忽略，不入缓冲
      }
    }
  }

  function getLogs(afterSeq = 0) {
    const after = Number(afterSeq);
    const from = Number.isFinite(after) ? after : 0;
    const list = entries
      .filter((e) => e.seq > from)
      .map((e) => ({ ...e }));
    return {
      entries: list,
      maxSeq: seqCounter,
      totalBytes,
      capBytes,
      dropped,
    };
  }

  function clearLogs() {
    entries.length = 0;
    totalBytes = 0;
    dropped = 0;
    pending = null;
    clearTimer();
    if (persistEnabled) {
      enqueueWrite(async () => {
        try { await fsp.writeFile(filePath, '', 'utf8'); } catch { writeFailed = true; return; }
        approxFileBytes = 0;
        await writeMeta(); // seqMax 保持（不清零）
      });
    }
    return { ok: true };
  }

  function getStats() {
    return {
      count: entries.length,
      totalBytes,
      capBytes,
      dropped,
      maxSeq: seqCounter,
      hasPending: !!pending,
    };
  }

  /** 单测用：清空并重置 seq（持久化时同样清空文件） */
  function reset() {
    clearLogs();
    seqCounter = 0;
    return { ok: true };
  }

  /** 等待所有异步写入/compact 完成（单测与优雅退出用）。 */
  function flushPersistence() {
    return writeChain;
  }

  return { push, getLogs, clearLogs, getStats, reset, flushPending, flushPersistence };
}

// ── 模块级全局单例（生产使用）──
// 持久化默认开启，可用 AGENT_CORE_LOG_PERSIST=0/false 关闭；
// AGENT_CORE_LOG_FILE 覆盖默认文件路径。
const _envFile = process.env.AGENT_CORE_LOG_FILE;
const _global = createLogBuffer({
  persist: envPersistEnabled(),
  ...(_envFile ? { filePath: _envFile } : {}),
});

export function getLogs(afterSeq = 0) {
  return _global.getLogs(afterSeq);
}
export function clearLogs() {
  return _global.clearLogs();
}
export function getLogStats() {
  return _global.getStats();
}

// ── console 捕获 ──
let _installed = false;

/**
 * patch console.log/warn/error/info：先记录进内存，再调用原函数（保留 stdout/stderr 行为）。
 * 幂等：多次调用只安装一次。注意本函数内部禁止调用 console。
 * @returns {boolean} 是否本次完成安装（已安装返回 false）
 */
export function installConsoleCapture() {
  if (_installed) return false;
  _installed = true;
  for (const level of ['log', 'warn', 'error', 'info']) {
    const orig = console[level];
    if (typeof orig !== 'function') continue;
    console[level] = function capturedConsole(...args) {
      try {
        _global.push(format(...args), level);
      } catch {
        // 采集失败绝不能影响正常日志输出
      }
      return orig.apply(this, args);
    };
  }
  return true;
}

// ── 单测辅助 ──
export function __pushForTest(text, level = 'log') {
  _global.push(text, level);
}
export function __resetForTest() {
  _global.reset();
}
