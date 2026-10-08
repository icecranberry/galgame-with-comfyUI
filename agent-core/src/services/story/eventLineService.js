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
 * @returns {{nodes:Array, edges:Array<{from:number,to:number,kind:string,label:string}>}}
 */
export function buildLineGraph() {
  const lines = listEventLines();
  const edges = [];
  // 派生边（显式字段）
  for (const l of lines) {
    if (l.derivedFrom && lines.some(x => x.id === l.derivedFrom)) {
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
  return { nodes: lines, edges };
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