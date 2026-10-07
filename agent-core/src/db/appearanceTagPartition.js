/**
 * appearanceTagPartition.js —— 「角色外观标签」与「绘图标签」的**唯一真源**。
 *
 * ── 为什么需要它（2026-10-06 用户口径）──
 *
 * 标签库原本整体被塞进角色编辑弹窗，于是**大量 NSFW 动作/状态词**（流口水、乳晕微露、
 * 胸部晃动、透视乳沟、晒痕…）出现在"角色身体设定"的位置上。用户裁定：
 *   · 角色页**只保留「身体设计」类标签** —— 描述"这个角色身体长什么样"的**常态属性**；
 *   · 动作、表情、瞬时状态一律**移入「绘图」页** —— 那是"此刻这张图长什么样"。
 *
 * ── 判定标准（唯一一条，逐组逐 TAG 执行）──
 *
 *   **「这句话描述的是一个常态属性，还是那一瞬间的表现？」**
 *     · 能填进「身体」字段、明天后天都一样 → 角色页（身体设计）
 *       （体型、种族、机械义体、阴毛、生理性别特征、胸部尺寸与形态…）
 *     · 只在某张图里成立、下张图可能不同 → 绘图页（动作与状态）
 *       （流口水、乳晕微露、乳头勃起、胸部晃动、晒痕、透视、镜头特写…）
 *
 * ★ 本文件是**唯一真源**：后端目录接口、前端角色页与绘图页一律读这里，
 *   禁止各自维护一份名单（改一处漏一处 —— 项目红线 8）。
 *
 * ── 判定结果小结 ──
 *   保留（身体设计）：阴毛 11 · 机械义体 20 · 体型身高 15 · 种族特征 20 · 对象 7
 *                    + 胸部组内的尺寸/形态/乳头乳晕生理属性 42 个
 *   移出（动作状态）：嘴巴 27 · 舌头 9 · 腹部 1 · 眼睛 1 · 胸部组内的状态词 30 个
 *
 * ⚠ 注意几个**刻意保留**的反直觉项：`对象` 组（penis / pussy / futanari）看着 NSFW，
 *   但它回答的是"这个角色有没有阴茎"—— 属**生理特征**，与"胸部尺寸"同理，故保留。
 */

/**
 * 整段保留（该段下所有分组都属身体设计）。
 * key = YAML 里的段名。
 */
export const FULLY_KEPT_SECTIONS = new Set(['身体特征']);

/**
 * 整段移出（动作 / 表情 / 瞬时状态）。
 * 这些段名在角色页**不出现**，仅在绘图页提供。
 */
export const MOVED_OUT_GROUPS = new Set([
  '嘴巴（纯嘴巴补充）', '嘴巴', '舌头', '腹部', '眼睛',
]);// ★ 2026-10-07：`胸部`/`对象` 已拆分重命名 —— 见下方 PARTIAL_GROUPS 与 SPLIT_GROUPS。

/**
 * 需要**逐 TAG 拆分**的分组：只保留"身体设计"那一部分。
 *
 * 结构：{ [组名]: { keep: Set<tag> } }
 * 未列在 `keep` 里的 tag 一律视为"状态"→ 移出。
 *
 * ── 胸部组（72 个）的判定明细 ──
 * 保留 42：尺寸（贫/小/中/大/巨/超巨）、形态（下垂/挺翘/尖/钟形/圆/水滴/饱满/紧实/柔软/
 *          不对称/鱼雷）、乳头乳晕的**生理属性**（颜色/大小/内陷/穿孔/长）、痣与雀斑、体质（胸肌/肋骨/锁骨）
 * 移出 30：乳房晃动 / 乳晕微露 / 乳头滑出 / 乳头勃起 / 侧乳·后乳·下乳 / 乳沟 / 衣服造成
 *          （紧绷·镂空·框住·无乳头设计）/ 汗·精液·晒痕 / 透视 / 镜头特写 / 单胸外露 / 裸肩
 */
/**
 * ★★ 2026-10-07 标签库重构（用户裁定）—— **组名与归属已变**：
 *   · 原「胸部」(72) 拆成 **「乳房形状」(32)** 与 **「乳头 / 乳晕」(16)**；
 *     **状态词 24 个已从 YAML 删除**（晃动/乳晕微露/乳头滑出/乳沟/侧乳/后乳/透视/特写/
 *     汗·精液·晒痕/衣物造成的一律不属"身体设计"）—— 它们改由**绘图页**提供。
 *   · 原「对象」(7) 改名 **「阴部」(6)**，并移除 `onee-shota`(小孩开大车)——
 *     它是**体位**（谁在上谁在下），不是身体特征。
 *   · 「人物」段只留动作/表情组；身体设计组全部并入单一「身体特征」段。
 *
 *   因此下面这几个组现在**整组保留**（无需再逐 TAG 拆）——列在 KEPT_GROUPS 里。
 */
export const KEPT_GROUPS = new Set([
  '乳房形状', '乳头 / 乳晕', '阴部',
]);

export const PARTIAL_GROUPS = {
  '胸部': {
    keep: new Set([
      // ── 尺寸（身体设定，必留）──
      'chest', 'flat chest', 'small breasts', 'medium breasts', 'big breasts',
      'large breasts', 'huge breasts', 'gigantic breasts', 'large saggy breasts',
      // ── 形态（身体设定）──
      'hanging breasts', 'perky breasts', 'pointy breasts', 'sagging breasts',
      'asymmetrical breasts', 'torpedo breasts', 'bell shaped breasts', 'round breasts',
      'teardrop breasts', 'full breasts', 'firm breasts', 'soft breasts', 'veiny breasts',
      // ── 乳头 / 乳晕的生理属性（会一直这样，不是"此刻状态"）──
      'nipples', 'areola', 'inverted nipples', 'huge nipples', 'long nipples',
      'gaping nipples', 'huge nipples,thick nipples', 'dark nipples', 'pink nipples',
      'puffy areola', 'large areola', 'small areola', 'nipple piercing',
      // ── 痣 / 雀斑（身体标记）──
      'mole on breast', 'mole under breast', 'freckles on breasts',
      // ── 体质（体型的一部分）──
      'pectorals', 'large pectorals', 'visible ribs', 'collarbone visible',
      // ── 其他占位（中性词，作"有胸"的基准）──
      // （`between breasts` / `breasts apart` 属视角与姿态，已移出）
    ]),
  },
};

/**
 * 判断某个 tag 是否属于「身体设计」（= 应出现在角色页）。
 *
 * @param {string} section 段名（如「身体特征」「人物」）
 * @param {string} group 组名（如「种族特征」「胸部」）
 * @param {string} tag 标签原文（英文 tag）
 * @returns {boolean} true = 身体设计（角色页保留）；false = 动作/状态（绘图页）
 */
export function isBodyDesignTag(section, group, tag) {
  const sec = String(section || '').trim();
  const g = String(group || '').trim();
  const t = String(tag || '').trim();

  // 整段保留的段（身体特征）
  if (FULLY_KEPT_SECTIONS.has(sec)) return true;
  // 整组移出
  if (MOVED_OUT_GROUPS.has(g)) return false;
  // 拆分组的白名单
  if (KEPT_GROUPS.has(g)) return true;      // ★ 2026-10-07 新组：整组即身体设计
  const partial = PARTIAL_GROUPS[g];
  if (partial) return partial.keep.has(t);
  // 未在任一名单里的「人物」子组：默认**保留**（保守 —— 宁可多留一个也不要误删设定）
  return true;
}

/** 该分组是否**完全**属于身体设计（前端可据此整组展示/隐藏） */
export function isFullyKeptGroup(section, group) {
  const sec = String(section || '').trim();
  const g = String(group || '').trim();
  if (FULLY_KEPT_SECTIONS.has(sec)) return true;
  if (MOVED_OUT_GROUPS.has(g)) return false;
  const partial = PARTIAL_GROUPS[g];
  if (partial) return false;                 // 拆分组的保留项以逐 TAG 判定为准
  return true;
}