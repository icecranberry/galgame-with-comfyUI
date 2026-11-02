import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 让本测试进程内的模块级全局单例保持纯内存，避免落盘写入真实 agent-core/data/。
// （createLogBuffer 工厂默认 persist=false，只有显式 persist:true 的用例才碰磁盘。）
process.env.AGENT_CORE_LOG_PERSIST = '0';

const {
  createLogBuffer,
  installConsoleCapture,
  CAP_BYTES,
} = await import('../src/services/logBuffer.js');

/** 建一个随机临时目录用于持久化用例。 */
function makeTmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'logbuffer-'));
}

const START = (provider, label) => `══════════ [${provider} → ${label}] ══════════`;
const END = '═'.repeat(40);

/** 把一个完整的 LLM 块按行 push 进 buffer（起始→messages→收尾）。 */
function pushLlmBlock(b, provider, label, body = '{"messages":[]}') {
  b.push(START(provider, label), 'log');
  b.push(body, 'log');
  b.push('────────────────────────────────────────────────', 'log');
  b.push(`[${provider} ← ${label} start]`, 'log');
  b.push(`[${provider} ← ${label} 正文]`, 'log');
  b.push('hi', 'log');
  b.push(END, 'log');
}

test('CAP_BYTES 为 5MB', () => {
  assert.equal(CAP_BYTES, 5 * 1024 * 1024);
});

test('普通日志行不记录（只保留 LLM 块）', () => {
  const b = createLogBuffer();
  b.push('line1\nline2\nline3', 'info');
  assert.equal(b.getLogs().entries.length, 0, '普通日志不应产生 entry');
});

test('起始/收尾跨多次输入聚合为一个 kind:llm 块', () => {
  const b = createLogBuffer();
  b.push(START('deepseek.com', '写手 [req-7]'), 'log');
  b.push('{"messages":[{"role":"user","content":"hi"}]}', 'log');
  b.push('[写手 [req-7]] model=deepseek-chat, tools=0, max_tokens=1000', 'log');
  b.push('────────────────────────────────────────────────', 'log');
  b.push('[deepseek.com ← 写手 [req-7] start]', 'log');
  b.push('[deepseek.com ← 写手 [req-7] 思考链]', 'log');
  b.push('thinking...', 'log');
  b.push('[deepseek.com ← 写手 [req-7] 正文]', 'log');
  b.push('hello', 'log');
  b.push('[cache] 写手 [req-7]: 命中 10/20 prompt tokens (50%) | 输出 5', 'log');
  b.push(END, 'log');

  const { entries } = b.getLogs();
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.kind, 'llm');
  assert.equal(e.provider, 'deepseek.com');
  assert.equal(e.label, '写手 [req-7]'); // reqId 后缀原样保留
  assert.equal(e.level, null);
  assert.ok(e.text.includes('{"messages"'));
  assert.ok(e.text.includes('[deepseek.com ← 写手 [req-7] 正文]'));
  assert.ok(e.text.endsWith(END));
});

test('同步路径：单次输入内同时含起始行与收尾行', () => {
  const b = createLogBuffer();
  const oneShot = `${START('p', 'L')}\n{"messages":[]}\n────────────────────\nbody text\n${END}`;
  b.push(oneShot, 'log');
  const { entries } = b.getLogs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'llm');
  assert.equal(entries[0].provider, 'p');
  assert.equal(entries[0].label, 'L');
  assert.ok(entries[0].text.includes('{"messages":[]}'));
  assert.ok(entries[0].text.startsWith(START('p', 'L')));
});

test('块外普通日志不产生 entry，仅保留中间的 LLM 块', () => {
  const b = createLogBuffer();
  // 模拟流式路径起始行带前导换行
  b.push(`\n${START('p', 'L')}`, 'log');
  b.push(END, 'log');
  b.push('after block log', 'error'); // 普通日志应被忽略
  const { entries } = b.getLogs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'llm');
});

test('块内空闲超时（3 秒无增长）即使无收尾行也会 flush', () => {
  let fire = null;
  const b = createLogBuffer({
    blockIdleMs: 100,
    setTimeoutImpl: (fn) => { fire = fn; return { unref() {} }; },
    clearTimeoutImpl: () => {},
  });
  b.push(START('p', 'L'), 'log');
  b.push('partial body', 'log');
  assert.equal(b.getLogs().entries.length, 0); // 仍在 pending
  assert.equal(typeof fire, 'function');
  fire(); // 触发空闲 flush
  const { entries } = b.getLogs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'llm');
  assert.ok(entries[0].text.includes('partial body'));
});

test('块文本超过 2MB（默认 8MB）强制 flush 兜底', () => {
  const b = createLogBuffer({ maxBlockBytes: 100 });
  b.push(START('p', 'L'), 'log');
  b.push('x'.repeat(200), 'log'); // 超过阈值 → 强制 flush
  const { entries } = b.getLogs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'llm');
});

test('流式：收尾行到达前不产出 entry（输入不会提前落盘）', () => {
  const b = createLogBuffer({
    blockIdleMs: 600000,
    setTimeoutImpl: () => ({ unref() {} }),
    clearTimeoutImpl: () => {},
  });
  b.push(START('p', 'L'), 'log');
  b.push('{"messages":[{"role":"user","content":"hi"}]}', 'log');
  b.push('────────────────────────────────────────────────', 'log');
  b.push('[p ← L start]', 'log');
  assert.equal(b.getLogs().entries.length, 0, '收尾前不应产生 entry');
  // 模拟流式结束后的输出段
  b.push('[p ← L 思考链]', 'log');
  b.push('thinking...', 'log');
  b.push('[p ← L 正文]', 'log');
  b.push('answer text', 'log');
  b.push('[cache] p: 命中 1/2 prompt tokens (50%) | 输出 5', 'log');
  assert.equal(b.getLogs().entries.length, 0, '输出阶段仍未收尾，不应落盘');
  b.push(END, 'log');
  const { entries } = b.getLogs();
  assert.equal(entries.length, 1);
  assert.ok(entries[0].text.includes('thinking...'));
  assert.ok(entries[0].text.includes('answer text'));
  assert.ok(entries[0].text.endsWith(END));
});

test('无收尾行的旧块遇到新起始行时先保存旧块再开新块', () => {
  const b = createLogBuffer({
    blockIdleMs: 600000,
    setTimeoutImpl: () => ({ unref() {} }),
    clearTimeoutImpl: () => {},
  });
  b.push(START('p', 'A'), 'log');
  b.push('body-A', 'log'); // A 没有收尾行
  b.push(START('p', 'B'), 'log');
  b.push('body-B', 'log');
  b.push(END, 'log');
  const { entries } = b.getLogs();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].label, 'A');
  assert.ok(entries[0].text.includes('body-A'));
  assert.equal(entries[1].label, 'B');
  assert.ok(entries[1].text.includes('body-B'));
});

test('超上限丢弃最旧并累计 dropped，totalBytes 不超上限', () => {
  const cap = 1000;
  const b = createLogBuffer({ capBytes: cap });
  for (let i = 0; i < 6; i++) {
    pushLlmBlock(b, 'p', `L${i}`, 'a'.repeat(300));
  }
  const { entries, totalBytes, dropped, capBytes } = b.getLogs();
  assert.equal(capBytes, cap);
  assert.ok(dropped > 0, '应有丢弃');
  assert.ok(totalBytes <= cap, `totalBytes=${totalBytes} 应 <= ${cap}`);
  assert.ok(entries.length < 6);
  // 最新一块一定还在
  assert.equal(entries[entries.length - 1].label, 'L5');
  // 最旧那块已被丢
  assert.notEqual(entries[0].label, 'L0');
});

test('afterSeq 增量过滤只返回更新的条目', () => {
  const b = createLogBuffer();
  for (const l of ['one', 'two', 'three']) pushLlmBlock(b, 'p', l);
  const all = b.getLogs();
  assert.equal(all.entries.length, 3);
  assert.equal(all.maxSeq, 3);
  const inc = b.getLogs(all.entries[0].seq);
  assert.equal(inc.entries.length, 2);
  assert.deepEqual(inc.entries.map((e) => e.label), ['two', 'three']);
  // 用 maxSeq 再拉应无新增
  assert.equal(b.getLogs(inc.maxSeq).entries.length, 0);
});

test('clearLogs 清空 entries/pending', () => {
  const b = createLogBuffer();
  b.push(START('p', 'L'), 'log'); // 留一个 pending
  b.push('partial', 'log');
  const r = b.clearLogs();
  assert.deepEqual(r, { ok: true });
  assert.equal(b.getLogs().entries.length, 0);
  assert.equal(b.getStats().hasPending, false);
});

test('installConsoleCapture 幂等，且捕获后仍执行原 console', () => {
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  try {
    const first = installConsoleCapture();
    const second = installConsoleCapture();
    assert.equal(first, true);
    assert.equal(second, false);
    // 不抛错即证明原函数仍被调用（输出到真实 stdout/stderr）
    assert.doesNotThrow(() => console.log('capture-smoke-test'));
  } finally {
    console.log = saved.log;
    console.warn = saved.warn;
    console.error = saved.error;
    console.info = saved.info;
  }
});

// ─────────────────────────────────────────────────────────────
// 持久化（落盘）用例
// 全部使用 os.tmpdir 随机临时目录，测后清理，不污染真实 agent-core/data/。
// ─────────────────────────────────────────────────────────────

test('持久化：写入后新 buffer 指向同文件可恢复 entries / seq / totalBytes', async () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, 'runtime-log.jsonl');
    const b1 = createLogBuffer({ persist: true, filePath: file });
    pushLlmBlock(b1, 'p', 'hello');
    pushLlmBlock(b1, 'p', 'world');
    await b1.flushPersistence();
    assert.equal(existsSync(file), true, '日志文件应已创建');

    const b2 = createLogBuffer({ persist: true, filePath: file });
    const g = b2.getLogs();
    assert.equal(g.entries.length, 2);
    assert.equal(g.entries[0].kind, 'llm');
    assert.equal(g.entries[0].label, 'hello');
    assert.equal(g.entries[1].label, 'world');
    assert.equal(g.maxSeq, 2);
    assert.equal(g.dropped, 0);
    assert.ok(g.totalBytes > 0);

    // 续写：seq 应继续单调递增
    pushLlmBlock(b2, 'p', 'next');
    await b2.flushPersistence();
    const b3 = createLogBuffer({ persist: true, filePath: file });
    assert.equal(b3.getLogs().maxSeq, 3);
    assert.equal(b3.getLogs().entries[2].label, 'next');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('持久化：旧文件里的普通日志行重启时被跳过，且随后被清理', async () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, 'runtime-log.jsonl');
    // 手工造一个混有普通日志的旧文件
    writeFileSync(
      file,
      [
        JSON.stringify({ seq: 1, ts: 'x', kind: 'log', label: null, provider: null, level: 'info', text: 'startup noise' }),
        JSON.stringify({ seq: 2, ts: 'x', kind: 'llm', label: 'L', provider: 'p', level: null, text: 'block' }),
      ].join('\n') + '\n',
      'utf8',
    );
    const b = createLogBuffer({ persist: true, filePath: file });
    const g = b.getLogs();
    assert.equal(g.entries.length, 1, '只载入 LLM 块');
    assert.equal(g.entries[0].label, 'L');
    assert.equal(g.maxSeq, 2, 'seq 仍取历史最大值');
    await b.flushPersistence(); // 触发 compact 清理旧普通日志行
    const raw = readFileSync(file, 'utf8');
    assert.ok(!raw.includes('startup noise'), '旧普通日志应被清理');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('持久化：文件超限 compact 后 <= cap 且保留最新', async () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, 'runtime-log.jsonl');
    const cap = 2000;
    const b = createLogBuffer({ persist: true, filePath: file, capBytes: cap });
    for (let i = 0; i < 20; i++) pushLlmBlock(b, 'p', `msg-${i}-` + 'x'.repeat(150));
    await b.flushPersistence();
    assert.equal(existsSync(file), true);
    const size = statSync(file).size;
    assert.ok(size <= cap, `文件 size=${size} 应 <= cap=${cap}`);

    // 重新 load 应能读到，且最新一条保留
    const b2 = createLogBuffer({ persist: true, filePath: file, capBytes: cap });
    const { entries } = b2.getLogs();
    assert.ok(entries.length >= 1);
    assert.equal(entries[entries.length - 1].label.startsWith('msg-19-'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('持久化：persist=false 完全不碰磁盘（不建文件）', async () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, 'runtime-log.jsonl');
    const meta = path.join(dir, 'runtime-log.meta.json');
    const b = createLogBuffer({ persist: false, filePath: file });
    pushLlmBlock(b, 'p', 'L');
    await b.flushPersistence();
    assert.equal(existsSync(file), false, '不应创建日志文件');
    assert.equal(existsSync(meta), false, '不应创建 meta 文件');
    assert.equal(b.getLogs().entries.length, 1); // 内存仍工作
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('持久化：clearLogs 后重启 seq 不回退（meta.seqMax 保留）', async () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, 'runtime-log.jsonl');
    const b1 = createLogBuffer({ persist: true, filePath: file });
    pushLlmBlock(b1, 'p', 'a');
    pushLlmBlock(b1, 'p', 'b');
    await b1.flushPersistence();
    const maxBefore = b1.getLogs().maxSeq; // 2
    assert.equal(maxBefore, 2);

    b1.clearLogs();
    await b1.flushPersistence();

    const b2 = createLogBuffer({ persist: true, filePath: file });
    assert.equal(b2.getLogs().entries.length, 0, 'clearLogs 后文件应为空');
    assert.ok(b2.getLogs().maxSeq >= maxBefore, '重启后 maxSeq 不应回退');

    pushLlmBlock(b2, 'p', 'c');
    await b2.flushPersistence();
    assert.ok(b2.getLogs().maxSeq > maxBefore);

    // 再次重启仍不回退
    const b3 = createLogBuffer({ persist: true, filePath: file });
    assert.ok(b3.getLogs().maxSeq > maxBefore);
    assert.equal(b3.getLogs().entries[0].label, 'c');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
