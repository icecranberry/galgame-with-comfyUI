// 可插拔迁移注册表（架构加固 P1）—— 让"新功能"不再往 db/index.js 里塞代码。
//
// 背景：db/index.js 已 4300+ 行、66 个迁移函数全挤在 initSchema() 里手动按序调用。
// 每加一个功能就要动这个文件 → 冲突面大、review 难、越改越不敢碰。
// 本模块提供第二条路：迁移独立成文件放 src/db/migrations/，登记进清单后由本模块调度。
//
// ── 四条硬约束（改本文件前必读）───────────────────────────
// 1. **失败隔离**：任一迁移抛错不得阻断启动、不得影响后续迁移。
//    启动阶段崩掉 = 整个应用起不来，代价远大于一个迁移没跑成。
//    失败落 schema_migrations_failed 表（含错误原文 + 尝试次数），下次启动自动重试。
// 2. **注册表只负责调度，不代替幂等**：迁移自身必须自己保证可重复执行
//    （加列前 PRAGMA 查列、清理前查一次性标记，见红线 5）。
//    已应用记录是"二次保护"，不是幂等的替代品 —— 旧库升级到本机制时
//    schema_migrations 是空的，所有已登记迁移都会被执行一次，
//    所以**搬进来的老迁移必须原本就是幂等的**。
// 3. **绝不静默跳过**：清单为空、id 重复、id 非法 → 抛错，不吞。
//    （与红线 0 同源：静默 return 会让人只看到"点了没反应"。）
// 4. **新功能一律不改本文件**：本文件是机制，不是清单。清单在 migrations/index.js。

import { createHash } from 'crypto';

/** 迁移 id 命名约束：小写字母/数字/下划线，3 位序号开头，便于人工排序与排查 */
const ID_PATTERN = /^\d{3,}_[a-z0-9_]+$/;

/** @type {Map<string, {id:string, description:string, run:Function}>} */
const registry = new Map();

/** 记录机制自身的加载标记，便于诊断接口区分"没迁移"与"没加载" */
export const REGISTRY_VERSION = 1;

// 清单是否被加载过。**这不是内部细节，是防静默的关键**：
// 若某条启动路径跳过了 loadMigrations()，注册表就是空的 —— 空表会让
// "本轮没有迁移要跑" 和 "迁移根本没被加载" 长得一模一样（红线 0 的同源陷阱）。
let loaded = false;

/** 标记清单已加载（由 migrations/index.js 在扫描完成后调用） */
export function markRegistryLoaded() {
  loaded = true;
}

/** 清单是否已加载 —— getDb() 在空注册表时用它决定要不要喊出来 */
export function isRegistryLoaded() {
  return loaded;
}

/**
 * 登记一个迁移。**只登记，不执行**。
 * @param {{id:string, description:string, run:(db:import('better-sqlite3').Database)=>void}} def
 */
export function registerMigration(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('[migration] 迁移定义必须是对象');
  }
  const { id, description, run } = def;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`[migration] 非法迁移 id: ${JSON.stringify(id)}（应形如 001_xxx_yyy）`);
  }
  if (typeof run !== 'function') {
    throw new Error(`[migration] ${id} 缺少 run(db) 实现`);
  }
  if (registry.has(id)) {
    // 重复 id 极可能是复制粘贴改漏 —— 后一个会静默覆盖前一个，必须报出来
    throw new Error(`[migration] 迁移 id 重复: ${id}`);
  }
  registry.set(id, {
    id,
    description: String(description || ''),
    run,
    // 函数体指纹：用于发现"迁移已应用之后又被改动"（只告警，不阻断）
    checksum: createHash('sha256').update(String(run)).digest('hex').slice(0, 16),
  });
}

/** 返回按 id 升序排列的迁移清单（副本，外部改不动内部） */
export function listRegisteredMigrations() {
  return [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 登记数量 —— 供自检用（清单与磁盘文件必须一致） */
export function registeredCount() {
  return registry.size;
}

function ensureLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT,
      checksum TEXT,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schema_migrations_failed (
      id TEXT PRIMARY KEY,
      description TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** 已成功应用的迁移记录（供诊断接口展示） */
export function listAppliedMigrations(db) {
  try {
    ensureLedger(db);
    return db.prepare(`SELECT id, description, applied_at FROM schema_migrations ORDER BY id`).all();
  } catch {
    return [];
  }
}

/** 失败过的迁移记录（供诊断接口展示；成功后会被清掉） */
export function listFailedMigrations(db) {
  try {
    ensureLedger(db);
    return db.prepare(`SELECT id, description, error, attempts, failed_at FROM schema_migrations_failed ORDER BY id`).all();
  } catch {
    return [];
  }
}

/**
 * 按序执行所有已登记迁移。
 *
 * ⚠ 失败隔离的边界：**单条迁移**失败不影响其它迁移、不抛给调用方。
 *   但如果**建台账表本身**就失败（磁盘损坏级），那就直接返回，让上层看到空结果。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{logger?: Pick<Console,'log'|'warn'|'error'>}} [opts]
 * @returns {{applied:string[], skipped:string[], failed:{id:string,error:string}[], warnings:string[]}}
 */
export function runRegisteredMigrations(db, opts = {}) {
  const log = opts.logger || console;
  const report = { applied: [], skipped: [], failed: [], warnings: [] };

  try {
    ensureLedger(db);
  } catch (err) {
    log.error('[migration] 台账表创建失败，本轮注册表迁移全部跳过:', err.message);
    return report;
  }

  const all = listRegisteredMigrations();
  if (all.length === 0) return report;

  const done = new Set(
    db.prepare(`SELECT id FROM schema_migrations`).all().map(r => r.id)
  );
  const appliedRows = db.prepare(`SELECT id, checksum FROM schema_migrations`).all();

  // 发现"已应用但函数体被改过"：只告警。开发期反复调提示词/改逻辑是常态，
  // 硬报错会逼人去手工删记录；但完全不提示又会让人以为改动生效了。
  const changed = [];
  for (const row of appliedRows) {
    const cur = all.find(m => m.id === row.id);
    if (cur && row.checksum && cur.checksum !== row.checksum) changed.push(row.id);
  }
  if (changed.length) {
    report.warnings.push(...changed.map(id => `迁移 ${id} 已应用但其实现代码已被修改，改动不会自动重放`));
    log.warn(`[migration] ${changed.length} 个已应用迁移的代码有改动（不会自动重放）: ${changed.join(', ')}`);
  }

  const markApplied = db.prepare(
    `INSERT OR REPLACE INTO schema_migrations (id, description, checksum, applied_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
  );
  const clearFailed = db.prepare(`DELETE FROM schema_migrations_failed WHERE id = ?`);
  const markFailed = db.prepare(`
    INSERT INTO schema_migrations_failed (id, description, error, attempts, failed_at)
    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET error = excluded.error,
                                  attempts = schema_migrations_failed.attempts + 1,
                                  failed_at = CURRENT_TIMESTAMP
  `);

  for (const m of all) {
    if (done.has(m.id)) {
      report.skipped.push(m.id);
      continue;
    }
    try {
      m.run(db);
      markApplied.run(m.id, m.description, m.checksum);
      clearFailed.run(m.id);
      report.applied.push(m.id);
      log.log(`[migration] 已应用 ${m.id}${m.description ? ' — ' + m.description : ''}`);
    } catch (err) {
      // 关键：吞错但必须留痕。下一次启动会重试（因为没写成功记录）。
      const msg = err?.message || String(err);
      report.failed.push({ id: m.id, error: msg });
      try { markFailed.run(m.id, m.description, msg); } catch { /* 连记账都失败就算了 */ }
      log.error(`[migration] ${m.id} 执行失败（不影响启动，下次重试）: ${msg}`);
    }
  }

  return report;
}

/** 仅供测试：清空登记表与加载标记（生产路径永远不清） */
export function __resetRegistryForTest() {
  registry.clear();
  loaded = false;
}