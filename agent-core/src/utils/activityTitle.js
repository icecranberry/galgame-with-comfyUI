/**
 * 日程活动名（activity）归一化 —— 去 AI 八股。
 *
 * 背景：LLM 习惯把 `activity` 写成「活动名——补充说明」这种解说式标题
 * （实测 582 条存量日程里 542 条带 `——`，占 93.1%）。这些补充说明与
 * `description` 高度重复，列表里看着就是一片八股，也冲淡了标题的可扫读性。
 *
 * 处理：**只取破折号之前的主干**。LLM 的用法极其稳定（主干 ≥4 字、说明在后、
 * 正文里从不出现破折号），因此截断安全。
 *
 * ⚠ 边界：只作用于 **LLM 生成路径**与**存量数据一次性清理**。
 *   用户在日程抽屉里手改的名字由 `scheduleEditor.sanitizeActivityInput` 负责，
 *   且已打 `edited` 标记的条目在迁移里会被跳过 —— 不会覆盖用户的手笔。
 */

/** 破折号族：双破折号（LLM 的实际用法）、单破折号、连字符 */
const DASH_RE = /——|—|–|--/;

/**
 * 把 LLM 给出的活动名收敛成纯标题。
 * @param {string} raw 原始活动名
 * @returns {string} 归一化后的活动名；输入非字符串或为空时返回 ''
 */
export function normalizeActivityTitle(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';

  // ① 去掉「——补充说明」这类尾巴（取第一个分隔符之前的主干）
  const dashIdx = s.search(DASH_RE);
  if (dashIdx > 0) {
    const head = s.slice(0, dashIdx).trim();
    // 主干太短（如「补——睡」）说明分隔符不是标题分界，只把破折号抹掉
    s = head.length >= 2 ? head : s.replace(/——|—|–|--/g, '').trim();
  } else if (dashIdx === 0) {
    // 以破折号开头（如「—— 午睡」）：去掉前导符号
    s = s.replace(/^(——|—|–|--)\s*/, '').trim();
  }

  // ② 仍挂着解释的（冒号/逗号等）取第一段 —— 仅在已经过长时才动手
  if (s.length > 14) {
    const cut = s.search(/[：:，,、；;（(]/);
    if (cut >= 2) s = s.slice(0, cut).trim();
  }

  // ③ 保守兜底：超过 16 字才硬截
  if (s.length > 16) s = s.slice(0, 14).trim();

  return s.replace(/[，,、：:；;—–\-]+$/, '').trim();
}