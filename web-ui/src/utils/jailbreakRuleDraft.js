/**
 * jailbreakRuleDraft.js —— 破限规则集编辑器的**纯逻辑**（与 Vue 组件解耦）
 *
 * 为什么单独拆一个文件：这些函数（选中/新建/复制/取消/范围勾选）是整套 UI 里
 * 唯一容易出隐错的部分 —— 尤其是「范围勾选必须是集合运算，取消一个不能把其余八个弄丢」，
 * 以及「草稿的 targets 必须是副本，改它不能污染 rules 里那条预置」。
 * 拆出来后单测能直接跑（本仓没有组件挂载能力：无 @vue/test-utils / jsdom），
 * 组件只负责把它们接到响应式 state 上。
 *
 * 口径与后端 `services/jailbreakRules.js` 一一对应：
 *   · `targets` 空数组 = 合法表达（哪都不投递），**不许**被回填成全集
 *   · 内置项（`builtin: true`）不可改内容，只能改名称与 targets
 */

/** 选中某套：编辑器切到它（targets 取副本，避免污染 rules 里那条） */
export function pickRule(rules, id) {
  const rule = (Array.isArray(rules) ? rules : []).find(r => r && r.id === id) || null
  return {
    id,
    draft: rule
      ? { id: rule.id, name: rule.name, content: rule.content || '', targets: [...(rule.targets || [])] }
      : null,
  }
}

/** 新建空白草稿：默认带上全部可选范围（用户不用手动勾九个） */
export function newDraft(availableTargets) {
  return {
    id: '',
    draft: { id: '', name: '', content: '', targets: [...(availableTargets || [])] },
  }
}

/** 从某套复制一份再改：正文带着走，名字加「副本」，id 清空（保存走 POST） */
export function copyToNewDraft(draft, fallbackName = '未命名规则集') {
  return {
    id: '',
    draft: {
      id: '',
      name: `${draft?.name || fallbackName}（副本）`,
      content: draft?.content || '',
      targets: [...(draft?.targets || [])],
    },
  }
}

/**
 * 勾选/取消一个投递目标。**集合运算**：
 *   · 勾上 → 加入（去重）
 *   · 取消 → 只移除那一个，其余原样留着
 *   · 全取消 → 空数组（合法表达，不回填）
 * @returns {string[]} 新数组（不改入参）
 */
export function toggleTargetIn(targets, key, on) {
  const current = Array.isArray(targets) ? targets : []
  const set = new Set(current);
  if (on) set.add(key);
  else set.delete(key);
  return [...set];
}

/** 全选 / 全不选 */
export function setAllTargets(availableTargets, on) {
  return on ? [...(availableTargets || [])] : [];
}

/** 取消编辑：新建态回到列表第一套，编辑态回到原选中套 */
export function cancelPick(rules, isNewDraft, selectedId) {
  if (isNewDraft) {
    const first = (Array.isArray(rules) ? rules : [])[0];
    return { id: first?.id || '', draft: first ? draftOf(first) : null };
  }
  return pickRule(rules, selectedId);
}

function draftOf(rule) {
  return { id: rule.id, name: rule.name, content: rule.content || '', targets: [...(rule.targets || [])] };
}

/** 内置项只能改名称与 targets（正文框要 disabled） */
export function isBuiltinRule(rules, id) {
  const rule = (Array.isArray(rules) ? rules : []).find(r => r && r.id === id);
  return !!(rule && rule.builtin);
}

/** 正文字节数（与后端 Buffer.byteLength(..., 'utf8') 同口径：中文按 3 字节算） */
export function draftByteLength(content) {
  const text = String(content ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return text.length;
}
