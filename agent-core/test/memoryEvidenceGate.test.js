/**
 * T1 记忆证据闸门 —— 回归测试。
 *
 * 来源：ST 插件「千千结」逆向移植调研（`0-投递箱/2026-10-07_ST插件逆向移植评估/`）的
 * **第一优先项**。核心价值是**唯一能根治"AI 编造记忆"的机制**：
 * 不是"AI 说记住了什么"，而是"这句话在正文里第几次出现"。
 *
 * 邻舍原有链路（`memoryExtractor` → `applyMemoryActions`）只要求模型写
 * `reasoning:"只写支撑判断的对话依据"` —— **自由文本、写入前不复算**，
 * 于是"用户喜欢咖啡"这种对话里从没提过的判断也会被存下来。
 *
 * ⚠ 本测试全部用**内联数据**，不碰真库、不调 LLM。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(os.tmpdir(), `linshe-evidence-gate-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`evidence gate test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const gateSrc = fs.readFileSync(path.join(SRC, 'services/memory/memoryEvidenceGate.js'), 'utf8');
const extractorSrc = fs.readFileSync(path.join(SRC, 'services/memoryExtractor.js'), 'utf8');
const repo = await import('../src/services/memory/memoryRepository.js');
const gate = await import('../src/services/memory/memoryEvidenceGate.js');
const { buildMemoryCurationPrompt } = await import('../src/services/memoryExtractor.js');

// ⚠ 迁移在 `app.js:156` 里加载，**测试不跑 app.js** → 测试库默认没有 evidence_* 列。
//   这里按 app.js 的**同一序列**跑一遍（load → run），既补上列，也顺带验证
//   "迁移本身能执行"（比只测 schema 更有价值）。
//   ⚠ 别只调 loadFeatureMigrations —— 那只是**登记**，不执行（实测踩过：列仍不存在）。
const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
const { runRegisteredMigrations } = await import('../src/db/migrationRegistry.js');
const { getDb } = await import('../src/db/index.js');
await loadFeatureMigrations();
runRegisteredMigrations(getDb());
{
  const cols = new Set(getDb().prepare('PRAGMA table_info(memory_fragments)').all().map(c => c.name));
  for (const c of ['evidence_text', 'evidence_count', 'evidence_msg_id', 'evidence_verified']) {
    if (!cols.has(c)) throw new Error(`迁移未生效：memory_fragments 缺列 ${c}`);
  }
}

// ─────────────────────────────────────────────────────────
// ① 逐字复算：这是整套机制的心脏
// ─────────────────────────────────────────────────────────

test('★★★ 逐字引文能在原文里定位到 → 通过', () => {
  const raw = '我今天去了一家新开的咖啡店，点了一杯拿铁。';
  const r = gate.countQuoteOccurrence(raw, '点了一杯拿铁', 1);
  assert.equal(r.ok, true, '原文里存在的引文必须通过');
  assert.equal(r.total, 1, '应数出 1 次出现');
});

test('★★★ 引文在原文里不存在 → 必须拒收（这就是根治幻觉的判据）', () => {
  const raw = '我今天去了一家新开的咖啡店，点了一杯拿铁。';
  // 模型编造的"证据"：这句话原文里根本没有
  const r = gate.countQuoteOccurrence(raw, '她说她最喜欢咖啡', 1);
  assert.equal(r.ok, false, '原文里没有的引文必须失败');
  assert.equal(r.total, 0);
});

test('★★ 同一句出现多次时，occurrence 用来定位第几次', () => {
  const raw = '好。那就这样吧。好。';
  const r1 = gate.countQuoteOccurrence(raw, '好。', 1);
  const r2 = gate.countQuoteOccurrence(raw, '好。', 2);
  const r3 = gate.countQuoteOccurrence(raw, '好。', 3);
  assert.equal(r1.ok, true, '第 1 次存在');
  assert.equal(r2.ok, true, '第 2 次存在');
  assert.equal(r3.ok, false, '只有 2 次，第 3 次不应存在');
  assert.equal(r1.total, 2, '总出现次数应为 2');
});

test('★ 重叠匹配不能被漏掉（"aaa" 里 "aa" 应算 2 次）', () => {
  const r = gate.countQuoteOccurrence('aaa', 'aa', 2);
  assert.equal(r.ok, true, '重叠出现也要能数到第 2 次');
  assert.equal(r.total, 2);
});

test('★★ 归一化只做"无害对齐"：全角/半角标点与空白差异不应误判', () => {
  // 模型抄写时常把「，」写成 ","，这不该导致拒收（否则闸门误杀率过高）
  const raw = '她说，明天见。';
  assert.equal(gate.countQuoteOccurrence(raw, '她说,明天见。', 1).ok, true, '标点全半角差异应通过');
  const raw2 = '她说   明天见';
  assert.equal(gate.countQuoteOccurrence(raw2, '她说 明天见', 1).ok, true, '空白差异应通过');
});

test('★★★ 但**不得**做模糊匹配 —— 删词/取子串都算不成立', () => {
  // 逐字就是逐字：引文必须原样出现在原文里。
  const raw = '她喜欢喝茶，不喜欢咖啡。';
  assert.equal(gate.countQuoteOccurrence(raw, '她喜欢咖啡', 1).ok, false,
    '「她喜欢咖啡」不是原文的连续子串（原文是"不喜欢咖啡"）→ 必须失败');
  assert.equal(gate.countQuoteOccurrence(raw, '她喜欢喝', 1).ok, true, '真实连续子串应通过');
});

test('★ 空引文 / 超长引文必须被拒（后者多半是把整段对话抄进来了）', () => {
  assert.equal(gate.countQuoteOccurrence('abc', '', 1).ok, false, '空引文不成立');
  assert.equal(gate.verifyEvidence({ evidenceMsgId: 1, evidenceText: 'x'.repeat(2001) }).reason, 'evidence-too-long');
});

// ─────────────────────────────────────────────────────────
// ② 窗口内的自动定位（不依赖模型给 id）
// ─────────────────────────────────────────────────────────

test('★★★ 引文应在**本批次消息窗口**内被定位（模型只需抄准，不需指对）', () => {
  // ★ 设计决定：chat_log 是共享缓存前缀块，不能为塞 id 去改它的格式（会让缓存全失效）。
  //   所以让模型只给引文，由代码在窗口内搜索 —— 这是确定性问题，代码比模型可靠。
  const window = [
    { id: 11, content: '今天工作好累。' },
    { id: 12, content: '我想去海边走走，好久没看海了。' },
  ];
  const r = gate.verifyQuoteInWindow('想去海边走走', 1, window);
  assert.equal(r.ok, true, '应能在窗口内定位');
  assert.equal(r.msgId, 12, '应定位到正确的那条消息');
});

test('★★★ 引文不在窗口内（但在库更早的消息里）→ 仍须拒收', () => {
  // 反例：模型引用了"很久以前"的话来支撑当下判断 —— 那不是本次窗口的证据。
  const window = [{ id: 30, content: '今天天气不错。' }];
  const r = gate.verifyQuoteInWindow('你上次说要戒烟', 1, window);
  assert.equal(r.ok, false, '窗口内没有的话不能算证据');
  assert.equal(r.reason, 'quote-not-found');
});

test('★★ occurrence 跨消息累计，超出总数要拒', () => {
  const window = [
    { id: 1, content: '好。' },
    { id: 2, content: '那就这样。好。' },
  ];
  // 总共出现 2 次
  assert.equal(gate.verifyQuoteInWindow('好。', 2, window).ok, true, '第 2 次应存在');
  const r3 = gate.verifyQuoteInWindow('好。', 3, window);
  assert.equal(r3.ok, false, '第 3 次不存在');
  assert.equal(r3.reason, 'occurrence-out-of-range');
});

// ─────────────────────────────────────────────────────────
// ③ 逐条隔离（不连坐）
// ─────────────────────────────────────────────────────────

test('★★★ 坏条目被隔离，好条目照常通过（不连坐 —— 一条幻觉不该毁掉整批）', () => {
  const window = [{ id: 5, content: '她说她明天要去图书馆还书。' }];
  const actions = [
    { action: 'create', memory: { judgment: '她明天要去图书馆', evidenceText: '明天要去图书馆还书' } },
    { action: 'create', memory: { judgment: '她讨厌甜食', evidenceText: '我最讨厌吃蛋糕了' } },   // ← 编造
    { action: 'create', memory: { judgment: '她要还书', evidenceText: '要去图书馆还书' } },
  ];
  const { accepted, isolated } = gate.isolateUnverifiedActions(actions, window);
  assert.equal(accepted.length, 2, '两条有证据的应通过');
  assert.equal(isolated.length, 1, '编造的那条应被隔离');
  assert.equal(isolated[0].judgment, '她讨厌甜食');
  assert.equal(isolated[0].reason, 'quote-not-found');
  // 通过的两条应带上复算结果（而非模型自述）
  for (const a of accepted) {
    assert.equal(a._evidence.verified, 1, '应标记为已校验');
    assert.ok(a._evidence.msgId === 5, '应记录来源消息 id');
  }
});

test('★ 缺引文的条目一律隔离（"没证据"不因模型漏写而放行）', () => {
  const window = [{ id: 1, content: '随便什么内容' }];
  const r = gate.isolateUnverifiedActions([
    { action: 'create', memory: { judgment: 'A' } },                          // 无 evidenceText
    { action: 'create', memory: { judgment: 'B', evidenceText: '' } },        // 空串
    { action: 'create', memory: { judgment: 'C', evidenceText: '随便什么内容' } },
  ], window);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.isolated.length, 2);
});

// ─────────────────────────────────────────────────────────
// ④ 默认关闭（不改行为）
// ─────────────────────────────────────────────────────────

test('★★★ 闸门必须**默认关闭**（项目红线 4：默认不改行为）', () => {
  const save = process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  delete process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  assert.equal(gate.isMemoryEvidenceGateEnabled(), false, '未设置环境变量时必须关闭');
  process.env.FEATURE_MEMORY_EVIDENCE_GATE = '';
  assert.equal(gate.isMemoryEvidenceGateEnabled(), false, '空串必须关闭');
  process.env.FEATURE_MEMORY_EVIDENCE_GATE = '0';
  assert.equal(gate.isMemoryEvidenceGateEnabled(), false, '"0" 必须关闭');
  process.env.FEATURE_MEMORY_EVIDENCE_GATE = '1';
  assert.equal(gate.isMemoryEvidenceGateEnabled(), true, '"1" 开启');
  process.env.FEATURE_MEMORY_EVIDENCE_GATE = 'true';
  assert.equal(gate.isMemoryEvidenceGateEnabled(), true, '"true" 开启');
  if (save === undefined) delete process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  else process.env.FEATURE_MEMORY_EVIDENCE_GATE = save;
});

test('★★★ 提示词只在闸门开启时才追加证据要求（否则会破坏既有缓存前缀）', () => {
  const save = process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  const prompt = { transcript: '[user] 你好\n[assistant] 你好呀', related: [], timeRange: '' };

  delete process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  const off = extractorSrc.includes('isMemoryEvidenceGateEnabled()') ? 'has-guard' : 'no-guard';
  assert.equal(off, 'has-guard', '提示词构造必须读取闸门开关');

  // 直接验证：开关关闭时 prompt 不含证据要求
  const noEv = buildMemoryCurationPrompt(prompt);
  assert.ok(!/必须附证据/.test(noEv), '关闭时不得出现证据要求（保住缓存前缀逐字节一致）');

  process.env.FEATURE_MEMORY_EVIDENCE_GATE = '1';
  const withEv = buildMemoryCurationPrompt(prompt);
  assert.match(withEv, /必须附证据/, '开启时必须要求引文');
  assert.match(withEv, /逐字照抄/, '措辞必须强调逐字 —— 否则模型会改写导致复算必失败');
  assert.match(withEv, /宁可少写一条/, '必须给出"找不到原句就别写"的前置防线');

  if (save === undefined) delete process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  else process.env.FEATURE_MEMORY_EVIDENCE_GATE = save;
});

// ─────────────────────────────────────────────────────────
// ⑤ 落库：证据随记忆写入（关闭时落 NULL）
// ─────────────────────────────────────────────────────────

test('★★★ 开启闸门时证据随记忆落库（含来源消息与校验结果）', async () => {
  const db = (await import('../src/db/index.js')).getDb();
  const conv = `c-${Date.now()}`;
  const raw = db.prepare(`INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'user', ?)`).run(conv, '我养了一只叫豆豆的猫。');
  const saved = repo.applyMemoryActions({
    conversationId: conv,
    sourceRawStartId: raw.lastInsertRowid,
    sourceRawEndId: raw.lastInsertRowid,
    actions: [{
      action: 'create',
      _evidence: { verified: 1, text: '一只叫豆豆的猫', count: 1, msgId: Number(raw.lastInsertRowid) },
      memory: { memoryType: 'knowledge', subject: 'user', judgment: '用户养了一只叫豆豆的猫', reasoning: '用户自述', tags: ['宠物'] },
    }],
  });
  assert.equal(saved.length, 1, '应写入 1 条');
  // ⚠ `applyMemoryActions` 返回的是**行对象数组**（含 memory_id 等字段），不是 id 字符串数组。
  //   直接拿 saved[0] 当参数传给 SQL 会报 "Too few parameter values were provided"（实测踩过）。
  const memId = saved[0]?.memory_id || saved[0];
  const row = db.prepare('SELECT evidence_text, evidence_count, evidence_msg_id, evidence_verified FROM memory_fragments WHERE memory_id = ?').get(memId);
  assert.equal(row.evidence_text, '一只叫豆豆的猫', '引文应落库');
  assert.equal(row.evidence_count, 1);
  assert.equal(row.evidence_verified, 1, '应记录为已校验');
  assert.ok(row.evidence_msg_id > 0, '应记录来源消息 id');
});

test('★★★ 不带证据时（闸门关闭的常态）证据列必须为 NULL，不得写成 0 或空串', () => {
  // ⚠ 写成 0/'' 会让"未校验"与"校验失败"混为一谈，事后无法区分。
  const src = fs.readFileSync(path.join(SRC, 'services/memory/memoryRepository.js'), 'utf8');
  assert.match(src, /item\.memory\.evidence\?\.text \?\? null/, '引文应落 null');
  assert.match(src, /item\.memory\.evidence\?\.verified \?\? null/, '校验结果应落 null（而非 0）');
});

test('★★ 证据字段长度受限（引文 ≤2000，与千千结一致）', () => {
  const long = 'x'.repeat(2100);
  const m = repo.normalizeMemory({ judgment: 'j', reasoning: 'r', tags: ['t'], evidence: { text: long, count: 1, msgId: 1, verified: 1 } });
  assert.ok(m.evidence.text.length <= 2000, `引文应被截到 2000 以内（实际 ${m.evidence.text.length}）`);
});

// ─────────────────────────────────────────────────────────
// ⑥ 防回退：迁移与接入点
// ─────────────────────────────────────────────────────────

test('★★ 迁移文件必须存在且幂等（加列前查 PRAGMA）', () => {
  const mig = fs.readFileSync(path.join(SRC, 'db/migrations/002_memory_evidence_gate.migration.js'), 'utf8');
  assert.match(mig, /export const id = '002_memory_evidence_gate'/, '应导出 id');
  assert.match(mig, /export function run\(db\)/, '应导出 run');
  assert.match(mig, /PRAGMA table_info\(memory_fragments\)/, '必须查列后再加（幂等）');
  for (const col of ['evidence_text', 'evidence_count', 'evidence_msg_id', 'evidence_verified']) {
    assert.ok(mig.includes(col), `迁移应包含 ${col}`);
  }
});

test('★★★ 闸门必须接在**写入前**且限定在窗口内（接错位置等于没接）', () => {
  // 关键：必须用本批次 messages 作为窗口，而不是全库搜索
  assert.match(extractorSrc, /isolateUnverifiedActions\(actions, window\)/,
    '应以本批次消息窗口调用隔离');
  assert.match(extractorSrc, /messages\.map\(m => \(\{ id: m\.id, content: m\.content \}\)\)/,
    '窗口应来自本批次 messages');
  assert.match(extractorSrc, /isMemoryEvidenceGateEnabled\(\)/, '必须先判开关');
});

test('★★★ 拒收必须留痕（不得静默 —— 与红线 0/11 同源）', () => {
  assert.match(extractorSrc, /memoryEvidenceGate\] 拒收/, '应在日志里明确写出拒收条数');
  assert.match(extractorSrc, /byReason/, '应按原因分类，便于判断是模型问题还是闸门误杀');
});

test('★★ 引用层级必须正确（写错会 ERR_MODULE_NOT_FOUND）', () => {
  // 实测踩过：把 '../../db/index.js' 写成 '../../../db/index.js'
  assert.match(gateSrc, /from '\.\.\/\.\.\/db\/index\.js'/, 'memory/ 下到 src/db 是两层回溯');
  assert.ok(!/from '\.\.\/\.\.\/\.\.\/db\/index\.js'/.test(gateSrc), '不应是三层');
});