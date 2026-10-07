/**
 * 事件线服务（T2，2026-10-07）—— 「故事」页的数据层。
 *
 * ── 来源与取舍 ─────────────────────────────────────────────
 * 移植自 `ST-SevenDaysCal`（构画）`business/lines/` 的**纯逻辑部分**：
 * 阶段机、别名归一、锁线保护、容量上限。**不移植**它的宿主适配层
 * （`setExtensionPrompt` / `chat_metadata` / 楼层锚定 —— 邻舍没有这些概念）。
 *
 * ★★ 明确**不抄**的：构画的"节点"指**聊天楼层**。它的节点图是楼层视角，
 *   对邻舍无意义（邻舍没有楼层）。本模块的"节点"概念 = **事件线本身**。
 *
 * ── 与「奇遇」的关系（用户裁定：不碰奇遇）───────────────────
 * `character_events` 是**一次性奇遇**（到期即失效）；本模块是**跨天演进**的线。
 * 两表并存，本模块**不读写** `character_events`。
 */

import { getDb } from '../../db/index.js';
import { chatSync } from '../../llm/llm-client.js';
// ⚠ 复用 `eventGenerator` 的 JSON 抽取/修复（与 `worldMapService.refinePlaceFromText`
//   同一处工具），避免各写一份"从模型输出里抠 JSON"的口径。
import { extractFirstJson, repairJson } from '../eventGenerator.js';

/**
 * 阶段机 —— 与构画 `schema.js` 的 `LINE_STAGES` 同口径。
 * ⚠ 这是**唯一真源**：前端只渲染，不自建一份（项目红线 8）。
 */
export const LINE_STAGES = ['起线', '延展', '成形', '收束', '淡出'];
/** 终态：进入后不再推进（构画的 `TERMINAL_LINE_STAGES`） */
export const TERMINAL_LINE_STAGES = ['收束', '淡出'];
/** 阶段别名归一 —— 抄构画的 `LINE_STAGE_ALIASES`（已完→收束、已失败→淡出…） */
const LINE_STAGE_ALIASES = {
  萌芽: '起线', 筹备: '起线', 萌生: '起线', 初始: '起线', 开始: '起线', 新生: '起线', 准备: '起线', 预备: '起线',
  started: '起线', starting: '起线',
  发酵: '延展', 执行: '延展', 酝酿: '延展', 发展: '延展', 升温: '延展', 进行: '延展', 推进中: '延展',
  progressing: '延展', developing: '延展', ongoing: '延展', 'in progress': '延展',
  逼近: '成形', 关键: '成形', 临近: '成形', 迫近: '成形', 高潮: '成形', 影响明确: '成形',
  approaching: '成形', forming: '成形', imminent: '成形',
  已完成: '收束', 已结束: '收束', 已解决: '收束', 已了结: '收束', 完成: '收束', 结束: '收束',
  成功: '收束', 解决: '收束', 和解: '收束', 落定: '收束', 新平衡: '收束',
  completed: '收束', finished: '收束', ended: '收束', resolved: '收束', settled: '收束', concluded: '收束',
  已消散: '淡出', 已失败: '淡出', 消散: '淡出', 消失: '淡出', 失败: '淡出', 不再追踪: '淡出',
  faded: '淡出', disappeared: '淡出', failed: '淡出',
};

/** 首次生成容量上限（构画的 `AUTO_LINE_CAPACITY=8`，同口径） */
export const AUTO_LINE_CAPACITY = 8;

/**
 * 节点图单屏节点数上限（第二期，用户设计文档 §2.2）。
 *
 * ⚠ **这不是数据上限，而是"渲染上限"** —— 与 `AUTO_LINE_CAPACITY` 是两回事：
 *   - `AUTO_LINE_CAPACITY` 管"首次自动生成最多几条线"（写入侧）
 *   - 本项管"一张图上最多画几个节点"（渲染侧），超出的由前端**分页/截断并显式告知**
 *
 * ★ 为什么要有：54 个角色 × N 条线会变成毛线球，图反而失去可读性。
 *   ⚠ 超限**绝不能静默丢弃**（红线 0）—— 必须把"还有几条没显示"回给前端。
 */
export const GRAPH_NODE_LIMIT = 40;

/** 阶段归一：合法值原样；别名映射；其余落「起线」（不猜） */
export function normalizeLineStage(v) {
  const s = String(v ?? '').trim();
  if (!s) return '起线';
  if (LINE_STAGES.includes(s)) return s;
  return LINE_STAGE_ALIASES[s] || '起线';
}

export function isTerminalStage(stage) {
  return TERMINAL_LINE_STAGES.includes(normalizeLineStage(stage));
}

export function normalizeAgency(v) {
  return String(v ?? '').trim().toLowerCase() === 'player' ? 'player' : 'world';
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || /^(true|yes|是|对)$/i.test(String(v ?? '').trim());
}

/** JSON 数组字段的安全解析（损坏时落空数组，不抛 —— 单条坏数据不该毁掉整个列表） */
function parseArr(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** 规范化一条线的输入（写入前统一） */
export function normalizeLine(input = {}) {
  return {
    name: String(input.name ?? '').trim().slice(0, 80),
    stage: normalizeLineStage(input.stage),
    whenText: String(input.whenText ?? input.when ?? '').trim().slice(0, 120),
    agency: normalizeAgency(input.agency),
    stall: toBool(input.stall),
    pin: toBool(input.pin),
    adult: toBool(input.adult),
    desc: String(input.desc ?? '').trim().slice(0, 1200),
    nextText: String(input.nextText ?? input.next ?? '').trim().slice(0, 600),
    ticket: String(input.ticket ?? '').trim().slice(0, 40),
    participantIds: [...new Set((Array.isArray(input.participantIds) ? input.participantIds : [])
      .map(Number).filter(Number.isFinite))].slice(0, 30),
    places: [...new Set((Array.isArray(input.places) ? input.places : [])
      .map(p => String(p ?? '').trim()).filter(Boolean))].slice(0, 20),
    derivedFrom: Number.isFinite(Number(input.derivedFrom)) && Number(input.derivedFrom) > 0
      ? Number(input.derivedFrom) : null,
  };
}

/** 行 → 对外对象 */
function rowToLine(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    stage: r.stage,
    terminal: isTerminalStage(r.stage),
    when: r.when_text,
    agency: r.agency,
    stall: !!r.stall,
    pin: !!r.pin,
    adult: !!r.adult,
    desc: r.desc,
    next: r.next_text,
    ticket: r.ticket,
    participantIds: parseArr(r.participant_ids),
    places: parseArr(r.places),
    derivedFrom: r.derived_from ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 列出全部事件线（按阶段排序：活跃的在前，终态的在后） */
export function listEventLines() {
  const rows = getDb().prepare('SELECT * FROM event_lines').all();
  const order = { 成形: 0, 延展: 1, 起线: 2, 收束: 3, 淡出: 4 };
  return rows.map(rowToLine)
    .sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9) || (b.id - a.id));
}

export function getEventLine(id) {
  return rowToLine(getDb().prepare('SELECT * FROM event_lines WHERE id = ?').get(Number(id) || 0));
}

/**
 * 新建事件线。
 *
 * ⚠ **不带 `pin` 的新建**（人工锁线是后续动作）—— 避免"自动生成时顺手把线锁死"。
 */
export function createEventLine(input = {}) {
  const v = normalizeLine(input);
  if (!v.name) throw new Error('事件线必须有名字');
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO event_lines (name, stage, when_text, agency, stall, pin, adult, desc, next_text, ticket,
                             participant_ids, places, derived_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    v.name, v.stage, v.whenText, v.agency, v.stall ? 1 : 0, v.pin ? 1 : 0, v.adult ? 1 : 0,
    v.desc, v.nextText, v.ticket,
    JSON.stringify(v.participantIds), JSON.stringify(v.places), v.derivedFrom,
  );
  return getEventLine(r.lastInsertRowid);
}

/**
 * 更新事件线（人工编辑通道）。
 *
 * ★★ 人工编辑**不受任何自动护栏约束**（服装那次事故的教训 L10）：
 *   用户改什么就是什么，包括把阶段从「收束」改回「延展」。
 *   ⚠ 唯独 `pin` 例外 —— 它本身就是"锁定"，由用户显式切换。
 */
export function updateEventLine(id, patch = {}) {
  const cur = getEventLine(id);
  if (!cur) throw new Error('事件线不存在');
  const v = normalizeLine({ ...cur, ...patch });
  if (!v.name) throw new Error('事件线必须有名字');
  getDb().prepare(`
    UPDATE event_lines
    SET name = ?, stage = ?, when_text = ?, agency = ?, stall = ?, pin = ?, adult = ?,
        desc = ?, next_text = ?, ticket = ?, participant_ids = ?, places = ?, derived_from = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    v.name, v.stage, v.whenText, v.agency, v.stall ? 1 : 0, v.pin ? 1 : 0, v.adult ? 1 : 0,
    v.desc, v.nextText, v.ticket,
    JSON.stringify(v.participantIds), JSON.stringify(v.places), v.derivedFrom,
    Number(id),
  );
  return getEventLine(id);
}

export function deleteEventLine(id) {
  return getDb().prepare('DELETE FROM event_lines WHERE id = ?').run(Number(id) || 0).changes > 0;
}

/**
 * 切换人工锁线。
 *
 * ★ 锁线的语义（抄构画 `mergePinned` 的意图）：**置 pin 后 AI 不得改动本线**。
 *   这是"防止自动生成覆盖人工成果"的保护 —— 与 T1/T3 同一取向。
 */
export function setEventLinePin(id, pin) {
  const r = getDb().prepare('UPDATE event_lines SET pin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(pin ? 1 : 0, Number(id) || 0);
  return r.changes > 0;
}

/**
 * 计算事件线之间的**关联边**（供节点图）。
 *
 * ★★ 由代码**自动算**，不让 AI 生成（用户裁定 S3：AI 会造假关系）。
 *   判据是**结构性事实**：共享参与角色 / 共享地点 / 显式派生。
 *   不做任何"语义相似"推断 —— 那才会造假关系。
 *
 * ── 筛选（第二期，用户设计文档 §2.2）────────────────────────
 * ⚠ 设计文档明确：「不要一开始就画"所有角色 × 所有事件"的大图 —— 54 个角色 × N 条线
 *   会变成毛线球。**默认按角色筛选**，且限制单屏节点数。」
 *   故这里支持按参与角色 / 是否含终态线收窄。**筛选必须在算边之前**：
 *   模型是"先选出可见节点集，再只在可见集内算边"——否则会出现指向被隐藏节点的悬空边。
 *
 * ★ 兼容（红线 4「默认不改行为」）：**不传任何选项时，返回结果与加筛选前逐字节一致**
 *   （`filterLinesForGraph(lines, {})` 原样返回全部）。
 *
 * @param {{participantId?:number|null, includeTerminal?:boolean, limit?:number}} [opts]
 * @returns {{nodes:Array, edges:Array<{from:number,to:number,kind:string,label:string}>, total:number, truncated:number}}
 */
export function buildLineGraph(opts = {}) {
  const all = filterLinesForGraph(listEventLines(), opts);
  // ★ 渲染上限：超出部分**必须显式回报**（红线 0：绝不静默丢弃）。
  //   不传 limit 时用 GRAPH_NODE_LIMIT；传 0 / 负数表示不限。
  const rawLimit = opts.limit === undefined ? GRAPH_NODE_LIMIT : Number(opts.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : Infinity;
  const lines = all.slice(0, limit);
  const truncated = all.length - lines.length;
  const ids = new Set(lines.map(l => l.id));
  const edges = [];
  // 派生边（显式字段）—— 两端都必须在可见集内，避免悬空边
  for (const l of lines) {
    if (l.derivedFrom && ids.has(l.derivedFrom)) {
      edges.push({ from: l.derivedFrom, to: l.id, kind: 'derive', label: '派生' });
    }
  }
  // 关联边（结构性共享，自动算）
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const sharedChars = a.participantIds.filter(x => b.participantIds.includes(x));
      const sharedPlaces = a.places.filter(x => b.places.includes(x));
      if (!sharedChars.length && !sharedPlaces.length) continue;
      const key = `${a.id}-${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = [];
      if (sharedChars.length) parts.push(`同角色×${sharedChars.length}`);
      if (sharedPlaces.length) parts.push(`同地点×${sharedPlaces.length}`);
      edges.push({ from: a.id, to: b.id, kind: 'related', label: parts.join('、') });
    }
  }
  return { nodes: lines, edges, total: all.length, truncated };
}

/**
 * 节点图的可见性筛选 —— **唯一真源**（红线 8：筛选口径只此一份）。
 *
 * ⚠ 为什么筛选要下沉到服务层而不是前端过滤：前端若自己 `filter` 一遍，
 *   边是后端按**全量**算的 → 会把指针指向被隐藏的节点，vue-flow 收到悬空边会报错/漏画。
 *   所以"选节点 + 算边"必须原子完成。
 *
 * ★ 不传 opts（或 opts 全空）时**原样返回**，保证与加筛选前行为一致（红线 4）。
 */
export function filterLinesForGraph(lines = [], opts = {}) {
  // ⚠ 判据是"**有没有显式给值**"，不是"值大不大"：`participantId: 0` 也必须按 0 筛
  //   （前端下拉从真实 `participantIds` 聚合，可能含 0；若拿 `>0` 当判据，
  //    用户选了 `#0` 却得到全量，是**静默错误**——正好是红线 0 那类"点了没反应/结果不对"）。
  const rawPid = opts.participantId;
  const hasPid = rawPid != null && rawPid !== '' && Number.isFinite(Number(rawPid));
  const pid = hasPid ? Number(rawPid) : null;
  // ⚠ 默认值是 `true`（含终态）—— 保持与无筛选时一致；若要"只看在推进的线"，
  //   由调用方显式传 `includeTerminal:false`。
  const includeTerminal = opts.includeTerminal !== false;
  if (!hasPid && includeTerminal) return [...lines];
  return lines.filter(l => {
    if (hasPid && !l.participantIds.includes(pid)) return false;
    if (!includeTerminal && l.terminal) return false;
    return true;
  });
}

/**
 * 首次生成时的容量裁剪（抄构画 `schema.js:209` 的口径：
 * **超量按原始顺序只取前 N 个**，第 N+1 条起不参与业务判断）。
 *
 * ⚠ 只在"还没有任何线"时限额（`isInitial`）—— 已有线时新增不受此限，
 *   否则用户永远无法把线加到 8 条以上。
 */
export function limitInitialLines(lines = [], limit = AUTO_LINE_CAPACITY, isInitial = false) {
  if (!isInitial) return [...lines];
  return [...lines].slice(0, limit);
}

// ═══════════════════════════════════════════════════════════
// 编辑表单的候选数据（2026-10-07 用户要求）
//
// 用户口径：「涉及角色和涉及地点我建议改为可输入并自动检索的选择框」。
// → 前端用可检索多选，**候选由后端给**。为什么不放前端自造：
//   ① 角色候选必须排除归档角色（归档 = 不参与任何主动行为，见项目红线）；
//   ② 地点候选的层级（大地区/子地区）**唯一真源是地图**，前端不该另写一份遍历逻辑（红线 8）。
// ═══════════════════════════════════════════════════════════

/**
 * 「涉及角色」候选。
 *
 * ★ 排除**归档角色**（`archived=1`）—— 与 `scheduleGenerator.isScheduleForbidden` 同一取向：
 *   归档 = 不参与任何主动行为，事件线也不该再把他卷进来。
 * ⚠ 这是**主列表的过滤口径**，不是"编辑已存线时也把归档角色抹掉" ——
 *   历史线里已经写进去的归档角色 id 必须原样保留（人工编辑不受自动护栏约束），
 *   前端只需在候选中找不到时照原值显示即可。
 */
export function listParticipantOptions() {
  const rows = getDb().prepare(`
    SELECT id, display_name FROM characters
    WHERE COALESCE(archived, 0) = 0
    ORDER BY id ASC
  `).all();
  return rows.map(r => ({ id: r.id, name: r.display_name || `#${r.id}` }));
}

/**
 * 「涉及地点」候选 —— 扁平化**所有**世界地图的地点，并带上归属层级。
 *
 * 返回 `{name, region, area, kind}`：
 *   - `region` = L1 大地区名，`area` = L2 子地区名，供前端分组/收敛（与
 *     `ui/PlaceCascadeSelect.vue` 需要的数据形状一致，可复用它的分组逻辑）。
 *   - ⚠ 只取 L1~L3（大地区 / 子地区 / 场景），不含 L4+ 的 POI：
 *     事件线是叙事地理层级的东西，挂到"某家店的收银台"没有意义。
 *   - ⚠ 地名**可能重名**（多个区都有「中心广场」）→ 前端展示时必须带 `region/area`，
 *     否则用户选了也不知道选的是哪个（这正是 `PlaceCascadeSelect` 当初被做出来的原因）。
 */
export function listPlaceOptions() {
  const db = getDb();
  const maps = db.prepare('SELECT id FROM world_maps').all();
  const out = [];
  for (const m of maps) {
    const rows = db.prepare(
      'SELECT id, parent_id, level, name, kind FROM world_map_places WHERE map_id = ? ORDER BY level, sort_order, id'
    ).all(m.id);
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const r of rows) {
      if (![1, 2, 3].includes(r.level)) continue;
      const parent = r.parent_id ? byId.get(r.parent_id) : null;
      // L1 是自身即大地区；L2 的 parent 是 region；L3 的 parent 是 area、祖父是 region。
      let region = '';
      let area = '';
      if (r.level === 1) region = r.name;
      else if (r.level === 2) { region = parent?.name || ''; area = r.name; }
      else {
        area = parent?.name || '';
        const grand = parent?.parent_id ? byId.get(parent.parent_id) : null;
        region = grand?.name || '';
      }
      const name = String(r.name || '').trim();
      if (!name) continue;
      out.push({ name, region, area, kind: r.kind || '' });
    }
  }
  // 去重（同名同区只留一条），并按 大地区 → 子地区 → 名字 稳定排序
  const seen = new Set();
  return out.filter(p => {
    const k = `${p.region}|${p.area}|${p.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.region.localeCompare(b.region, 'zh')
    || a.area.localeCompare(b.area, 'zh') || a.name.localeCompare(b.name, 'zh'));
}

// ═══════════════════════════════════════════════════════════
// AI 生成事件线草稿（2026-10-07 用户要求「需要一个 AI 生成按钮」）
//
// ★ 与「修正地点」「修正外观」**同一范式**：只出草稿、**不落库**，
//   结果回给前端填进编辑表单，用户可改，点「保存」才写库。
//   为什么不直接落库：AI 产出需要人工过一遍（与 T1 记忆证据闸门同一取向，
//   项目红线 L10 —— 护栏只作用于 AI，人工编辑不受约束）。
// ═══════════════════════════════════════════════════════════

const GENERATE_LINE_PROMPT = `你是一个剧情线策划助手。给定角色的身份与用户写下的要点，为「跨天演进的剧情线」补出一条**起线阶段的草稿**。

## 你要产出什么
这条线是"一件事后来怎么发展"的**起点**（不是一次性事件）。它应该：
- 有明确的**当事方**与**利益/情感冲突**（否则没有戏可演）；
- 有**可推进的方向**（下一步会自然发生什么），而不是已经完结的状态；
- 扎根在这个角色的日常与所处世界里，不是凭空冒出的宏大设定。

## 字段要求
- name：线名，**6~18 字**。像一句"这件事的标题"，不要写成句子或带破折号/冒号的解说。
  ✗「绯英的稿约——一场连环局」 ✓「绯英的连环画稿约」
- desc：**发生了什么、为什么值得跟进**，40~90 字。写具体的人与事，不写抒情。
- nextText：**下一步会自然发生什么**，20~50 字。给下一轮生成当锚点用的。
- whenText：起步时间，**自由文本**，如「第 1 天」「这两天」「最近」。
- stage：固定输出「起线」。

## 硬性要求
- **不要照抄用户原话**：用户给的是要点，你要把它展开成具体情节。
- **不要编造用户没暗示的大设定**：宁可在用户给的范围内写具体，不要自己加新组织/新地点/新世界观。
- **地点从给定候选里挑**（若给了候选）；没给候选就写用户要点里出现的地名。
- 只输出 JSON，不要解释、不要 Markdown 代码块。

## 输出格式
{"name":"...","desc":"...","nextText":"...","whenText":"...","stage":"起线"}`;

/**
 * 由要点生成一条事件线草稿。**不写库**。
 *
 * @param {{brief?:string, hints?:string, participantIds?:number[], places?:string[]}} input
 * @returns {Promise<{name:string,desc:string,nextText:string,whenText:string,stage:string}>}
 */
export async function generateEventLineDraft(input = {}) {
  const brief = String(input.brief || '').trim();
  if (!brief) throw Object.assign(new Error('请先写下这条线大概想讲什么'), { statusCode: 400 });

  const db = getDb();
  // 用户已选的参与角色 → 取名字喂给模型（比只给 id 有用得多）
  const pids = (Array.isArray(input.participantIds) ? input.participantIds : [])
    .map(Number).filter(Number.isFinite);
  let peopleBlock = '';
  if (pids.length) {
    const ph = pids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, display_name FROM characters WHERE id IN (${ph})`).all(...pids);
    if (rows.length) peopleBlock = `\n【涉及角色】${rows.map(r => `${r.display_name}（id ${r.id}）`).join('、')}`;
  }
  // 用户已选地点
  const places = (Array.isArray(input.places) ? input.places : [])
    .map(p => String(p || '').trim()).filter(Boolean);
  const placeBlock = places.length ? `\n【涉及地点】${places.join('、')}` : '';

  // 已有线名，避免生成重名/雷同的线
  const existing = listEventLines().map(l => l.name).filter(Boolean);
  const existingBlock = existing.length
    ? `\n【已有的事件线（不要重复，也尽量不要和它们撞主题）】${existing.slice(0, 20).join('、')}`
    : '';

  // 地点候选（供模型挑；只在用户没指定地点时给，避免干扰）
  let placeHint = '';
  if (!places.length) {
    const opts = listPlaceOptions().slice(0, 120).map(p => p.name);
    if (opts.length) placeHint = `\n【可用的地点名（若要点里提到地点，用这些标准名）】${[...new Set(opts)].join('、')}`;
  }

  const hints = String(input.hints || '').trim();
  const res = await chatSync([
    { role: 'system', content: GENERATE_LINE_PROMPT },
    {
      role: 'user',
      content: `【这条线想讲什么（用户要点，必须全部体现）】
${brief}${peopleBlock}${placeBlock}${existingBlock}${placeHint}${hints ? `\n\n【用户特别要求】${hints}` : ''}`,
    },
  ], { temperature: 0.8, max_tokens: 600, response_format: { type: 'json_object' }, label: 'story:gen-line' });

  return absorbLineDraft(res);
}

/**
 * 收口模型返回。
 *
 * ⚠ **必须校验出可用内容再返回**：全空时抛错，而不是回一个空草稿 ——
 *   否则前端会拿空值覆盖用户已经填好的表单（与 `absorbPlaceRefine` 同源思路）。
 */
export function absorbLineDraft(raw) {
  const jsonStr = extractFirstJson(String(raw || ''));
  const obj = jsonStr ? safeParseJson(repairJson(jsonStr)) : null;
  const name = String(obj?.name ?? '').trim().slice(0, 80);
  const desc = String(obj?.desc ?? '').trim().slice(0, 1200);
  const nextText = String(obj?.nextText ?? obj?.next ?? '').trim().slice(0, 600);
  const whenText = String(obj?.whenText ?? obj?.when ?? '').trim().slice(0, 120);
  if (!name && !desc && !nextText) {
    throw Object.assign(new Error('模型没能读出可用的剧情线，请把要点写得更具体些再试'), { statusCode: 502 });
  }
  return { name, desc, nextText, whenText, stage: normalizeLineStage(obj?.stage) };
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}