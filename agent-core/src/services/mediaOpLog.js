/**
 * mediaOpLog.js — 媒体操作日志（审计痕迹）
 *
 * ── 一句话 ──
 * 把**删除类 / 破坏性**媒体操作落一条结构化流水，供事后追溯「什么时候、谁、删了什么、删时多大」。
 *
 * ── 为什么要做（T5，2026-10-06）──
 * 曾发生「一条真实产物在界面里无故消失、无法追溯」：删掉的媒体/板块/帖子行连同 CASCADE
 * 子行一起没了，事后只能靠回忆猜。本模块把被删对象的**关键字段快照**留下来 ——
 * "它曾经是什么"可查，不必依赖外部备份。
 *
 * ── 设计硬约束 ──
 * ① **只记元信息，不搬全量正文**：正文(prompt/content)可能很长，全存会让日志表膨胀；
 *    只留名字/标题/形态/计数等"够人辨认"的字段。
 * ② **fail-soft**：写日志失败**绝不能**影响主操作（删除本身必须成功）。全部包 try/catch。
 * ③ **不做只读探测**（红线 3）：本模块**只 INSERT / SELECT**，从不 DELETE，可安全地
 *    在任何地方调用。
 * ④ 表由 `db/index.js` 的 `migrateMediaOpLog` 建；本模块只在表存在时工作，表缺失时静默跳过。
 */

import { getDb } from '../db/index.js';

/** 允许的操作类型（防止拼写漂移；批次日志按这张表校验，越界落 'unknown'） */
export const MEDIA_OP_TYPES = ['create', 'delete', 'batch_delete', 'batch_regenerate', 'cleanup'];
/** 允许的目标类型 */
export const MEDIA_TARGET_TYPES = ['outlet', 'board', 'post'];

function safeJson(v) {
  try { return JSON.stringify(v ?? {}); } catch { return '{}'; }
}

/**
 * 记一条媒体操作日志。
 *
 * @param {object} op
 * @param {string} op.opType      见 MEDIA_OP_TYPES
 * @param {string} op.targetType  见 MEDIA_TARGET_TYPES
 * @param {number} [op.targetId]  被操作对象 id（可能已被删，仅存档）
 * @param {string} [op.targetName] 名称/标题（人眼扫读用）
 * @param {string} [op.outletName] 所属媒体名
 * @param {number} [op.count]     影响条数（批量操作），默认 1
 * @param {string} [op.detail]    一句话说明
 * @param {object} [op.snapshot]  被删行关键字段快照
 * @returns {number|null} 新行 id；失败返回 null（**不抛错**）
 */
export function recordMediaOp({
  opType,
  targetType,
  targetId = null,
  targetName = '',
  outletName = '',
  count = 1,
  detail = '',
  snapshot = {},
} = {}) {
  try {
    const db = getDb();
    const ot = MEDIA_OP_TYPES.includes(opType) ? opType : 'unknown';
    const tt = MEDIA_TARGET_TYPES.includes(targetType) ? targetType : 'unknown';
    const info = db.prepare(`
      INSERT INTO media_op_log (op_type, target_type, target_id, target_name, outlet_name, count, detail, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ot,
      tt,
      Number.isFinite(Number(targetId)) ? Number(targetId) : null,
      String(targetName || '').slice(0, 200),
      String(outletName || '').slice(0, 120),
      Number.isFinite(Number(count)) ? Number(count) : 1,
      String(detail || '').slice(0, 500),
      safeJson(snapshot),
    );
    return Number(info.lastInsertRowid) || null;
  } catch (err) {
    // 日志写不进去（表缺失/磁盘满）不该阻断删除本身 —— 只 warn
    try { console.warn('[mediaOpLog] 写入失败:', err.message); } catch { /* ignore */ }
    return null;
  }
}

/**
 * 读取最近的媒体操作日志（倒序）。供排查 / 未来 UI 用。
 * @param {{ limit?: number, targetType?: string, opType?: string }} [opts]
 */
export function listMediaOps({ limit = 100, targetType = '', opType = '' } = {}) {
  try {
    const db = getDb();
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const where = [];
    const params = [];
    if (targetType) { where.push('target_type = ?'); params.push(targetType); }
    if (opType) { where.push('op_type = ?'); params.push(opType); }
    const sql = `SELECT * FROM media_op_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY id DESC LIMIT ?`;
    return db.prepare(sql).all(...params, n);
  } catch {
    return [];
  }
}

/** 日志总条数（UI 显示 / 排查用） */
export function countMediaOps() {
  try {
    return getDb().prepare('SELECT COUNT(*) AS c FROM media_op_log').get().c;
  } catch { return 0; }
}