/**
 * T3 写入门闸 —— 回归测试。
 *
 * 来源：ST 插件「千千结」逆向移植调研（`0-投递箱/2026-10-07_ST插件逆向移植评估/`）
 * 的 T3（与 T1 同层）：**禁止"AI 覆盖写入"用空/畸形结果清空既有数据**。
 *
 * ⚠ 全部用内联数据 + 临时库，不碰真库、不调 LLM。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(os.tmpdir(), `linshe-write-guard-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`write guard test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

const guard = await import('../src/services/writeGuard.js');
const repo = await import('../src/services/memory/memoryRepository.js');

// ⚠ 迁移在 app.js 里加载执行，测试不跑 app.js → 必须显式跑一遍，
//   否则 memory_fragments 缺 evidence_* 列（写入报 SQLITE_ERROR）。
//   ⚠ 只调 loadFeatureMigrations 只是**登记**、不执行（实测踩过）。
const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
const { runRegisteredMigrations } = await import('../src/db/migrationRegistry.js');
const { getDb } = await import('../src/db/index.js');
await loadFeatureMigrations();
runRegisteredMigrations(getDb());

function withEnv(value, fn) {
  const save = process.env.FEATURE_WRITE_GUARD;
  if (value === undefined) delete process.env.FEATURE_WRITE_GUARD;
  else process.env.FEATURE_WRITE_GUARD = value;
  try { return fn(); } finally {
    if (save === undefined) delete process.env.FEATURE_WRITE_GUARD;
    else process.env.FEATURE_WRITE_GUARD = save;
  }
}

// ─────────────────────────────────────────────────────────
// ① 纯函数判据
// ─────────────────────────────────────────────────────────

test('★★★ 空结果覆盖：既有非空 + AI 结果为空 → 拒绝', () => {
  const r = guard.checkEmptyOverwrite({ label: 'X', existingCount: 3, incomingCount: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-overwrite');
});

test('★ 没有既有数据时不拦（空覆盖空无害）', () => {
  assert.equal(guard.checkEmptyOverwrite({ existingCount: 0, incomingCount: 0 }).ok, true);
});

test('★ 结果非空时不属"空覆盖"判据', () => {
  assert.equal(guard.checkEmptyOverwrite({ existingCount: 10, incomingCount: 1 }).ok, true);
});

test('★★★ 整体覆盖：既有够大且单批覆盖比例过高 → 拒绝', () => {
  const r = guard.checkMassOverwrite({ label: 'X', existingCount: 10, incomingCount: 9 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mass-overwrite');
});

test('★ 小集合不判整体覆盖（避免误杀）', () => {
  // 既有 3 条、覆盖 3 条 = 100%，但低于阈值 5 → 放行
  assert.equal(guard.checkMassOverwrite({ existingCount: 3, incomingCount: 3 }).ok, true);
});

test('★ 覆盖率在允许范围内 → 放行', () => {
  assert.equal(guard.checkMassOverwrite({ existingCount: 10, incomingCount: 5 }).ok, true); // 50%
});

test('★ 组合判据：任一条命中即拒绝', () => {
  assert.equal(guard.checkAiOverwrite({ existingCount: 10, incomingCount: 0 }).reason, 'empty-overwrite');
  assert.equal(guard.checkAiOverwrite({ existingCount: 10, incomingCount: 10 }).reason, 'mass-overwrite');
  assert.equal(guard.checkAiOverwrite({ existingCount: 10, incomingCount: 2 }).ok, true);
});

// ─────────────────────────────────────────────────────────
// ② 默认关闭（红线 4）
// ─────────────────────────────────────────────────────────

test('★★★ 门闸必须默认关闭', () => {
  withEnv(undefined, () => assert.equal(guard.isWriteGuardEnabled(), false));
  withEnv('', () => assert.equal(guard.isWriteGuardEnabled(), false));
  withEnv('0', () => assert.equal(guard.isWriteGuardEnabled(), false));
  withEnv('1', () => assert.equal(guard.isWriteGuardEnabled(), true));
  withEnv('true', () => assert.equal(guard.isWriteGuardEnabled(), true));
  withEnv('on', () => assert.equal(guard.isWriteGuardEnabled(), true));
});

test('★★★ 关闭时 assert 一律放行（哪怕结果畸形）', () => {
  withEnv(undefined, () => {
    assert.doesNotThrow(() => guard.assertAiOverwrite({ existingCount: 999, incomingCount: 0 }));
  });
});

test('★★★ 开启时 assert 抛错，且带可识别的 code/reason', () => {
  withEnv('1', () => {
    try {
      guard.assertAiOverwrite({ label: 'X', existingCount: 999, incomingCount: 0 });
      assert.fail('应当抛错');
    } catch (err) {
      assert.equal(err.reason, 'empty-overwrite');
      assert.match(err.code, /^WRITE_GUARD_/);
    }
  });
});

// ─────────────────────────────────────────────────────────
// ③ 接入点：记忆写入
// ─────────────────────────────────────────────────────────

test('★★★ 接在事务内、写第一行之前（静态钉住）', () => {
  const src = fs.readFileSync(path.join(SRC, 'services/memory/memoryRepository.js'), 'utf8');
  assert.match(src, /import \{ assertAiOverwrite \} from '\.\.\/writeGuard\.js'/, '应 import 门闸');
  assert.match(src, /assertAiOverwrite\(\{[\s\S]{0,200}guardEmpty: false/, '只启用整体覆盖判据（空批次本是无操作，误拦会误伤）');
  // 调用点在 applyMemoryActions 内、db.transaction 之前
  const fnStart = src.indexOf('export function applyMemoryActions');
  const idxGuard = src.indexOf('assertAiOverwrite({', fnStart);
  const idxTx = src.indexOf('db.transaction(() =>', fnStart);
  assert.ok(fnStart > 0 && idxGuard > fnStart && idxTx > 0, '应能在 applyMemoryActions 内定位门闸与事务');
  assert.ok(idxGuard < idxTx, '门闸必须在事务之前');
});

test('★★★ 开启门闸时：一批想覆盖全部既有记忆的畸形结果被拒（且不写入）', async () => {
  const { getDb } = await import('../src/db/index.js');
  const db = getDb();
  const convA = `c-guard-${Date.now()}`;

  // 先造 6 条既有记忆（create，无引用）
  const createdA = repo.applyMemoryActions({
    conversationId: convA,
    sourceRawStartId: 1,
    sourceRawEndId: 6,
    actions: Array.from({ length: 6 }, (_, i) => ({
      action: 'create',
      memory: { memoryType: 'knowledge', subject: 'user', judgment: `既有记忆 ${i}`, reasoning: 'r', tags: ['t'] },
    })),
  });
  assert.equal(createdA.length, 6);
  const idsA = createdA.map(r => r.memory_id);

  // 畸形批次：一次 merge 引用全部 6 条 → 覆盖率 100% > 80%
  const badActions = [{
    action: 'merge',
    sourceMemoryIds: idsA,
    memory: { memoryType: 'knowledge', subject: 'user', judgment: '把全部旧记忆合并成一条', reasoning: 'r', tags: ['t'] },
  }];

  // 开启时：被拒（且事务回滚，既有记忆不受影响）
  withEnv('1', () => {
    assert.throws(() => repo.applyMemoryActions({
      conversationId: convA, sourceRawStartId: 1, sourceRawEndId: 6, actions: badActions,
    }), /疑似畸形结果|拒绝/);
  });
  const activeA = db.prepare(`SELECT COUNT(*) AS c FROM memory_fragments WHERE conversation_id = ? AND status = 'active'`).get(convA)?.c || 0;
  assert.equal(activeA, 6, `畸形批次不应清空既有记忆（实际 active=${activeA}）`);
});

test('★★★ 关闭门闸时（默认）：同样的畸形批次照常执行 —— 证明默认不改行为', async () => {
  const convB = `c-noguard-${Date.now()}`;
  const createdB = repo.applyMemoryActions({
    conversationId: convB, sourceRawStartId: 1, sourceRawEndId: 6,
    actions: Array.from({ length: 6 }, (_, i) => ({
      action: 'create',
      memory: { memoryType: 'knowledge', subject: 'user', judgment: `旧 ${i}`, reasoning: 'r', tags: ['t'] },
    })),
  });
  assert.equal(createdB.length, 6);
  const idsB = createdB.map(r => r.memory_id);
  withEnv(undefined, () => {
    assert.doesNotThrow(() => repo.applyMemoryActions({
      conversationId: convB, sourceRawStartId: 1, sourceRawEndId: 6,
      actions: [{ action: 'merge', sourceMemoryIds: idsB, memory: { memoryType: 'knowledge', subject: 'user', judgment: '合并', reasoning: 'r', tags: ['t'] } }],
    }));
  });
});

test('★ 关闭门闸时：正常的 create 批次不受影响', async () => {
  const conv = `c-ok-${Date.now()}`;
  const saved = repo.applyMemoryActions({
    conversationId: conv, sourceRawStartId: 1, sourceRawEndId: 1,
    actions: [{ action: 'create', memory: { memoryType: 'knowledge', subject: 'user', judgment: '一条正常记忆', reasoning: 'r', tags: ['t'] } }],
  });
  assert.equal(saved.length, 1);
});
