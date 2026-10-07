/**
 * 写入门闸（T3，2026-10-07）—— 禁止"AI 覆盖写入"用畸形结果清空既有数据。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * 千千结逆向移植调研（`0-投递箱/2026-10-07_ST插件逆向移植评估/`）把 T3 与 T1 并列为同一层：
 * T1 解决"AI 编造**新**记忆"，T3 解决"AI 的**畸形结果**把**既有**数据冲掉"。
 *
 * 邻舍里所有由 LLM 产出驱动的写入，都隐含一个假设：**模型返回的是一份"可信的完整结果"**。
 * 但模型可能：
 *   · 返回空数组（被截断、被拒答、格式没解析出来）—— 若调用方据此"覆盖"，既有数据全没了；
 *   · 返回一份"把全部既有条目都 update/merge 掉"的退化结果 —— 等价于整集清空。
 * 这两种都是**静默的数据损失**：界面不一定报错，用户只会发现"东西没了"。
 *
 * ── 与千千结的差异（有意为之）────────────────────────────────
 * · 千千结在 CSE 引擎里就地判；邻舍抽成**通用工具函数**，供 记忆 / 事件线（T2）/ 人物档案 复用
 *   （调研 §T3「接哪里」明写"可统一成一个共用的写入门闸工具函数"）。
 * · 判据从"是否为空"放宽为"是否退化"：既拦**空结果**，也拦**一次覆盖掉绝大多数**的畸形批次。
 *
 * ⚠ **默认关闭**（`FEATURE_WRITE_GUARD`）：关闭时所有 assert 直接放行，
 *   行为与上线前逐字节一致（项目红线 4「默认不改行为」）。
 */

/**
 * 特征开关 —— 读环境变量。
 * 与项目其它长驻功能一致：**默认关闭**。
 */
export function isWriteGuardEnabled() {
  const v = process.env.FEATURE_WRITE_GUARD;
  return v === '1' || v === 'true' || v === 'on';
}

/** 低于这个既有规模就不判"整体覆盖"（小集合本来占比就高，避免误杀） */
const MIN_EXISTING_FOR_RATIO_GUARD = 5;
/** 默认允许的最大覆盖比例 */
const DEFAULT_MAX_RATIO = 0.8;

function countOf(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** 判据 1：**空结果覆盖** —— 既有数据非空，而这次 AI 结果是空。 */
export function checkEmptyOverwrite({ label = 'AI 写入', existingCount = 0, incomingCount = 0 } = {}) {
  const existing = countOf(existingCount);
  const incoming = countOf(incomingCount);
  // 没有既有数据 → 做什么都不会"清空"，放行；有既有数据但 AI 结果非空 → 不属此判据
  if (existing === 0 || incoming > 0) return { ok: true };
  return {
    ok: false,
    reason: 'empty-overwrite',
    message: `${label}：AI 结果为空，拒绝用空结果覆盖既有 ${existing} 条数据`,
  };
}

/** 判据 2：**整体覆盖** —— 既有规模够大时，一次批次要覆盖/失效的比例过高。 */
export function checkMassOverwrite({ label = 'AI 写入', existingCount = 0, incomingCount = 0, maxRatio = DEFAULT_MAX_RATIO } = {}) {
  const existing = countOf(existingCount);
  const incoming = countOf(incomingCount);
  if (existing < MIN_EXISTING_FOR_RATIO_GUARD || incoming === 0) return { ok: true };
  const cap = Number.isFinite(maxRatio) && maxRatio > 0 && maxRatio <= 1 ? maxRatio : DEFAULT_MAX_RATIO;
  const ratio = incoming / existing;
  if (ratio > cap) {
    return {
      ok: false,
      reason: 'mass-overwrite',
      message: `${label}：单批覆盖 ${incoming}/${existing} 条（${(ratio * 100).toFixed(0)}% > ${(cap * 100).toFixed(0)}%），疑似畸形结果，拒绝`,
    };
  }
  return { ok: true };
}

/**
 * 组合判据（默认两条都查）。
 * ⚠ 纯函数：不读库、不写库、不看时间 —— 只做算术，便于单测与复用。
 *
 * @param {object} args
 * @param {string} [args.label] 人类可读的场景名（用于报错信息）
 * @param {number} [args.existingCount] 写入前既有（active）条目数
 * @param {number} [args.incomingCount] 本次 AI 结果**将覆盖/失效**的条目数
 * @param {number} [args.maxRatio=0.8] 允许的最大覆盖比例
 * @param {boolean} [args.guardEmpty=true] 是否启用"空结果覆盖"判据
 * @param {boolean} [args.guardMass=true] 是否启用"整体覆盖"判据
 * @returns {{ok:boolean, reason?:string, message?:string}}
 */
export function checkAiOverwrite({ guardEmpty = true, guardMass = true, ...args } = {}) {
  if (guardEmpty) {
    const r1 = checkEmptyOverwrite(args);
    if (!r1.ok) return r1;
  }
  if (guardMass) {
    const r2 = checkMassOverwrite(args);
    if (!r2.ok) return r2;
  }
  return { ok: true };
}

/**
 * 门闸版：不安全就抛错（调用方已有的 try/catch / 事务会兜住，实现"失败即不写"）。
 *
 * ⚠ 必须在**事务内、写第一行之前**调用 —— 否则回滚也不彻底。
 * ⚠ 关闭开关时直接返回，不抛错。
 *
 * @param {object} args 见 checkAiOverwrite
 * @returns {{ok:true}} 安全时返回
 * @throws {Error} 不安全时抛出（`err.code`/`err.reason` 便于调用方识别）
 */
export function assertAiOverwrite(args = {}) {
  if (!isWriteGuardEnabled()) return { ok: true };
  const r = checkAiOverwrite(args);
  if (!r.ok) {
    const err = new Error(r.message);
    err.code = 'WRITE_GUARD_' + String(r.reason || 'blocked').toUpperCase().replace(/-/g, '_');
    err.reason = r.reason;
    throw err;
  }
  return { ok: true };
}
