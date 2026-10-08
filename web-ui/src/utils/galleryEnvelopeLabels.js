/**
 * 规则34「环境层」的**维度显示名**——前端唯一真源。
 *
 * 后端 `galleryEnvironment.js` 的 `ENV_DIMENSIONS` 是标签池的真源，
 * 维度 key（scene/lighting/…）随 `payload.gallery.env[].dim` 下发。
 * 这里的 key 必须与它**逐字一致**；新增维度时两处一起改。
 *
 * 为什么要有这个文件而不是在组件里写死：
 *   左栏标签云分组、详情页参数行都要用这套名字 —— 两处各写一份必然改一处漏一处。
 *
 * ⚠ 标签本身**是英文**（用户口径），这里的中文只是**分组标题**（UI 文案，不是标签）。
 */
export const ENV_DIM_LABELS = {
  scene: '场景 / 环境',
  lighting: '光影 / 氛围',
  view: '视角 / 构图',
  focus: '焦点',
  optics: '摄影效果',
  emotion: '表情 / 视线',
  state: '身体 / 衣物状态',
  prop: '道具 / 玩法',
};

/** 左栏标签云里的展示顺序（与后端抽取顺序一致：场景 → 光影 → 视角 → …） */
export const ENV_DIM_ORDER = ['scene', 'lighting', 'view', 'focus', 'optics', 'emotion', 'state', 'prop'];

/** 非环境层的标签（体位名 / 人数 / 体位 core 词）统一归到这一组 */
export const POSE_GROUP_KEY = '__pose__';
export const POSE_GROUP_LABEL = '体位 / 主题';

export function envDimLabel(key) {
  return ENV_DIM_LABELS[key] || key;
}

/**
 * 把一批帖子拆成「按维度分组」的标签云。
 *
 * 为什么必须分组（而不是按出现次数取前 N）：
 *   体位名（中文）天然高频，取前 26 会被它整体占满 —— 新加的场景/光影/视角等维度
 *   **一个都露不出来**，用户看上去还是"标签很少"。分组后每组独立排序与截断。
 *
 * @param {Array} posts 帖子列表（读 `tags` 与 `payload.gallery.env`）
 * @param {number} [perGroup] 每组最多显示几个（默认 12）
 * @returns {Array<{key:string,label:string,items:Array<{name:string,count:number}>,total:number}>}
 */
export function buildTagGroups(posts, perGroup = 12) {
  const list = Array.isArray(posts) ? posts : [];

  // 先收集：tag → { 次数, 属于哪个维度 }
  const dimOfTag = new Map();     // tag → dim key
  for (const p of list) {
    for (const e of (p?.payload?.gallery?.env || [])) {
      if (e?.en && e?.dim && !dimOfTag.has(e.en)) dimOfTag.set(e.en, e.dim);
    }
  }

  const tally = new Map();        // groupKey → Map(tag → count)
  const bump = (key, tag) => {
    if (!tally.has(key)) tally.set(key, new Map());
    const m = tally.get(key);
    m.set(tag, (m.get(tag) || 0) + 1);
  };

  for (const p of list) {
    /*
     * ⚠ 必须显式判数组：`for...of` 一个字符串会**逐字符**迭代 ——
     * `tags: 'abc'` 会产出 a / b / c 三个"标签"（测试里踩过）。
     */
    if (!Array.isArray(p?.tags)) continue;
    for (const t of p.tags) {
      if (!t) continue;
      // 环境标签按它自己的维度归组；其它（体位名/人数/core 词）归「体位 / 主题」
      bump(dimOfTag.get(t) || POSE_GROUP_KEY, t);
    }
  }

  const groups = [];
  // 体位组排最前（它是检索主键），其余按 ENV_DIM_ORDER
  const order = [POSE_GROUP_KEY, ...ENV_DIM_ORDER];
  for (const key of order) {
    const m = tally.get(key);
    if (!m?.size) continue;
    const all = [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    groups.push({
      key,
      label: key === POSE_GROUP_KEY ? POSE_GROUP_LABEL : envDimLabel(key),
      items: all.slice(0, perGroup),
      total: all.length,
    });
  }
  // 兜底：万一后端下发的 dim 不在已知清单里，也别把标签丢掉
  for (const [key, m] of tally) {
    if (groups.some(g => g.key === key)) continue;
    const all = [...m.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    groups.push({ key, label: envDimLabel(key), items: all.slice(0, perGroup), total: all.length });
  }
  return groups;
}
