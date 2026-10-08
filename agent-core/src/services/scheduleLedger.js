/**
 * 角色日程台账 —— 长期观测工具。
 *
 * ── 这个模块解决什么（2026-10-06 用户提出）────────────────
 * 「方便持续观察 LLM 生成的日程在**长期表现**上的合理性、稳定性以及需要调优的点」。
 *
 * 要观测的是三类问题，对应三组指标：
 *
 *  ① **稳定性** —— 同一角色反复生成，结果是否收敛成同一套模板？
 *     指标：跨次相似度（地点集合重合率、时段结构重合率）。太高＝没变化，太低＝不可控。
 *  ② **八股度** —— 是否反复复读同样的画面/句式/道具？
 *     指标：地点集中度（Top-N 地点占比）、n-gram 复读率、道具词（如「愿宝」这类世界专名）每篇出现次数。 // @world-agnostic-ok: 注释举例
 *  ③ **合理性** —— 生成的日程是否违反了已建立的约束？
 *     指标：受限地点闯入次数、跨区瞬移（换场时间 < 通勤基线）、服装与 zone 矛盾、
 *          睡眠时长越界、时段空档/重叠。
 *
 * ⚠ 本模块**只读**：不改日程、不写自己的表，全部从 daily_schedules / schedule_templates
 *   与地图数据现算。这样它永远不会成为新的"必须同步维护的真源"。
 */

import { getDb } from '../db/index.js';
import { isTransitExempt } from './characterTransitMode.js';

// ══════════════════════════════════════════════════════════
// 基础工具
// ══════════════════════════════════════════════════════════

/** 安全解析日程 JSON（坏数据不能让整个台账崩） */
function parseSchedule(json) {
  try {
    const p = JSON.parse(json || '[]');
    // ★ 兼容三种真实落库形态：数组 / {activities:[...]} / **数字键对象**（真库里就是这种，
    //   见 daily_schedules.schedule_json；早期只认前两种 → 台账对全部存量数据返回空）
    let acts = null;
    if (Array.isArray(p)) acts = p;
    else if (Array.isArray(p?.activities)) acts = p.activities;
    else if (p && typeof p === 'object') {
      const keys = Object.keys(p).filter(k => /^\d+$/.test(k));
      if (keys.length) acts = keys.sort((a, b) => Number(a) - Number(b)).map(k => p[k]);
    }
    if (!acts) return [];
    return acts.filter(a => a && typeof a === 'object');
  } catch { return []; }
}

/** 'HH:MM' → 分钟数；解析不了返回 null */
function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (mi > 59) return null;
  // ★ `24:00` 是**合法写法**（LLM 常用来表示"到当天午夜"），必须接受。
  //   实测「22:00-24:00 夜间安睡」这类条目被旧规则判成 `bad-time`（error 级），
  //   而它其实完全正常 —— 那是两个角色的真实日程被误报警。
  //   归一到 1439（当天最后一分钟），与 `minToTime` 的封顶口径一致。
  if (h === 24 && mi === 0) return 1439;
  if (h > 23) return null;
  return h * 60 + mi;
}

/** 时段长度（跨零点按 +24h 算） */
function spanMinutes(a) {
  const s = toMin(a?.startTime), e = toMin(a?.endTime);
  if (s == null || e == null) return null;
  return e > s ? e - s : (e + 1440 - s);
}

/** 从 location 里拆出「区域 · 地点」两级（数据里常见「二维市·旧川里」这种写法） */
function splitLocation(loc) {
  const s = String(loc || '').trim();
  if (!s) return { area: '', place: '' };
  const parts = s.split(/[·•・\/|｜,，]/).map(x => x.trim()).filter(Boolean);
  return { area: parts[0] || '', place: parts[parts.length - 1] || '' };
}

/**
 * 中日文 n-gram（字符级）。用于量化"复读"。
 * ⚠ 用**字符**而非词：中文没有空格，且项目里 LLM 输出的描述是连续中文，
 *   分词器会引入额外依赖与不确定性；字符 4-gram 对"八股"已经足够敏感。
 */
function ngrams(text, n = 4) {
  const s = String(text || '').replace(/[\s，。、；：！？「」『』（）()【】…—\-]/g, '');
  const out = new Set();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}

/** Jaccard 相似度 */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * 道具/货币等"容易变成口头禅"的词。出现频次过高＝八股信号。
 *
 * ★★ 2026-10-07 架构修正：拆成**引擎通用词**与**世界观专有词**两部分。
 *   原先是一张混合表，里面既有「心愿/餐盘/酒杯」（任何世界观都适用的通用词），
 *   也有「愿宝/黄金马桶」（**某一个世界观的专名**）—— 后者属"数据跑进引擎"。
 *   现在：通用词留在这里；专有词由该世界观的**项目库**（`clicheProps` 槽位）提供。
 *   这样换世界观时，检测表会自动跟着换，不会再把别的世界的词当成"口头禅"。
 */
import { getActiveWorldSlots } from '../db/index.js';

/** 本次检测用的道具词表 = 引擎通用词 + **当前世界观**项目库声明的专有词。
 *  ★ 专有词归项目库（换世界观自动跟着换），不写死在引擎里。 */
function clichePropsNow() {
  let extra = [];
  try {
    extra = getActiveWorldSlots()?.clicheProps || [];
  } catch { /* 项目库读不到就只用通用词 */ }
  return [...CLICHE_PROPS_GENERIC, ...extra];
}

const CLICHE_PROPS_GENERIC = [
  '心愿', '餐盘', '石桌', '内袋', '尾款', '结算表', '酒杯', '账单', '围裙', '账本', '小费',
];

/** 取某角色的全部日程记录（模板 + 每日快照），按时间排序 */
function loadSchedules(characterId) {
  const db = getDb();
  const out = [];
  try {
    const t = db.prepare('SELECT schedule_json, generated_at, version FROM schedule_templates WHERE character_id = ?').get(characterId);
    if (t) out.push({ kind: 'template', date: '', json: t.schedule_json, generated_at: t.generated_at, version: t.version });
  } catch { /* ignore */ }
  try {
    const rows = db.prepare(
      'SELECT schedule_date, schedule_json, generated_at FROM daily_schedules WHERE character_id = ? ORDER BY schedule_date'
    ).all(characterId);
    for (const r of rows) out.push({ kind: 'daily', date: r.schedule_date, json: r.schedule_json, generated_at: r.generated_at, version: null });
  } catch { /* ignore */ }
  return out;
}

// ══════════════════════════════════════════════════════════
// 单份日程的体检
// ══════════════════════════════════════════════════════════

/**
 * 体检一份日程，产出**结构化问题清单**（每条都可指向一个具体调优点）。
 *
 * ★ 关于「自己的住处」的豁免（2026-10-06 用户口径）：
 *   角色的**专属住处**在地图上常被标成 `restricted`/`private`（"谢绝外人"说的是别人进不去，
 *   住户自己当然能回），也常不在公共交通网上（私宅没站）。若一律按"闯入受限地点/不可直达"报错，
 *   就会把**回家/睡觉**误报成风险 —— 用户实报：这类告警其实是"角色进入限定的个人空间"导致的假阳性。
 *   故 ctx 支持传 `ownPlaces`（该角色自己的居家/睡眠地点与所属区），命中即豁免这两项检查。
 *
 * ★ 关于「超能力移动」的豁免（2026-10-06 用户口径，二档"按能力分级"）：
 *   设定上会瞬移/飞行的角色，换场本来就不受通勤表限制。若照旧报 `teleport`，
 *   台账会持续输出"假阳性"—— 用户裁定：**有能力即不报该项**，其余审计项照常。
 *   判据统一取自 `characterTransitMode.isTransitExempt`（唯一真源）。
 *
 * @param {Array} acts 活动数组
 * @param {object} ctx { forbiddenPlaces:Set, noTransferPlaces:Set, areaOf:Map, ownPlaces:Set, transitMode:string }
 */
export function auditSchedule(acts, ctx = {}) {
  const issues = [];
  const durations = [];
  let sleepMin = 0, sexCount = 0, explicitCount = 0, musicDelay = 0;

  const FORBIDDEN = ctx.forbiddenPlaces instanceof Set ? ctx.forbiddenPlaces : new Set();
  const NO_TRANSFER = ctx.noTransferPlaces instanceof Set ? ctx.noTransferPlaces : new Set();
  // ★ 该角色自己的住处（含所属区名）：回家/睡觉不算"闯入受限地点"，也不受"不可直达"约束
  const OWN = ctx.ownPlaces instanceof Set ? ctx.ownPlaces : new Set();
  // ★ 超能力移动：豁免「跨区瞬移」这一项（有能力就不报，避免假阳性）
  const TRANSIT_EXEMPT = isTransitExempt(ctx.transitMode);

  for (const a of acts) {
    const span = spanMinutes(a);
    if (span == null) {
      issues.push({ code: 'bad-time', level: 'error', detail: `时间格式不可解析：${a?.startTime}~${a?.endTime}`, activity: a?.activity || '' });
      continue;
    }
    durations.push(span);
    if (a.replyDelay === -1) sleepMin += span;

    const txt = `${a.activity || ''} ${a.location || ''} ${a.description || ''}`;
    const { area, place } = splitLocation(a.location);
    // 这条活动是否落在该角色自己的住处（命中即豁免下面两项，避免"回家=闯禁区"的假阳性）
    const isOwn = (place && OWN.has(place)) || (area && OWN.has(area));

    // ① 受限地点闯入（自己的住处不算闯入）
    if (!isOwn) {
      for (const f of FORBIDDEN) {
        if (f && (place === f || area === f)) {
          issues.push({ code: 'forbidden-place', level: 'warn', detail: `去了受限地点「${f}」`, activity: a.activity, startTime: a.startTime });
          break;
        }
      }
    }
    // ② 不可直接抵达（自己的住处不受此限 —— 私宅本就不在交通网）
    if (!isOwn) {
      for (const f of NO_TRANSFER) {
        if (f && (place === f || area === f)) {
          issues.push({ code: 'unreachable-place', level: 'warn', detail: `去了不可直接抵达的「${f}」`, activity: a.activity, startTime: a.startTime });
          break;
        }
      }
    }
    // ③ 内容空泛
    const desc = String(a.description || '').trim();
    if (desc.length < 8) issues.push({ code: 'thin-desc', level: 'info', detail: '描述过短（<8 字）', activity: a.activity, startTime: a.startTime });
    if (!a.location) issues.push({ code: 'no-location', level: 'warn', detail: '缺少 location', activity: a.activity, startTime: a.startTime });

    // ④ 计数性活动
    if (/性|口交|做爱|自慰|群交|插入|阴茎|高潮/.test(txt)) sexCount++;
    if (/性交|口交|自慰到出|多人|插入|阴茎/.test(txt)) explicitCount++;
    if (a.replyDelay === -1) musicDelay++;
  }

  // ⑤ 时间轴完整性：必须覆盖 24h 且不重叠、不空档
  const sorted = acts
    .map(a => ({ s: toMin(a.startTime), e: toMin(a.endTime), a }))
    .filter(x => x.s != null && x.e != null)
    .sort((x, y) => x.s - y.s);
  if (sorted.length) {
    if (sorted[0].s !== 0) issues.push({ code: 'gap-start', level: 'warn', detail: `00:00 无人接续（首段从 ${sorted[0].a.startTime} 开始）` });
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].s !== sorted[i - 1].e) {
        const d = sorted[i].s - sorted[i - 1].e;
        issues.push({
          code: d > 0 ? 'gap' : 'overlap', level: 'warn',
          detail: d > 0 ? `${sorted[i - 1].a.endTime}~${sorted[i].a.startTime} 空档 ${d} 分` : `时段重叠 ${-d} 分`,
          startTime: sorted[i].a.startTime,
        });
      }
    }
  }

  // ⑥ 睡眠时长
  if (sleepMin < 300) issues.push({ code: 'sleep-short', level: 'warn', detail: `睡眠仅 ${Math.round(sleepMin / 60 * 10) / 10} 小时（<5h）` });
  if (sleepMin > 660) issues.push({ code: 'sleep-long', level: 'info', detail: `睡眠 ${Math.round(sleepMin / 60 * 10) / 10} 小时（>11h）` });

  // ⑦ 跨区瞬移（相邻两段换区，但中间没有留出通勤时间）
  //   ★ 超能力角色豁免：设定上会瞬移/飞行，换场本来就不受通勤表限制 ——
  //     照旧报就是假阳性（用户裁定：按能力分级、不报该项）。其余审计项不受影响。
  const TRANSFER = ctx.transferMinutes instanceof Map ? ctx.transferMinutes : new Map();
  if (!TRANSIT_EXEMPT) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].a, cur = sorted[i].a;
      const pa = splitLocation(prev.location).area, ca = splitLocation(cur.location).area;
      if (!pa || !ca || pa === ca) continue;
      const need = TRANSFER.get(`${pa}→${ca}`) ?? TRANSFER.get(`${ca}→${pa}`);
      if (need == null) continue;
      const gap = Math.max(0, (toMin(cur.startTime) ?? 0) - (toMin(prev.endTime) ?? 0));
      // 换场时间通常并入其中一段，所以用「上一段尾 + 本段头」的可疑度判断：
      // 若两段都写得"满"（本一开始就在新地点做事），视为瞬移。
      if (gap === 0 && need > 20) {
        issues.push({ code: 'teleport', level: 'warn', detail: `${pa} → ${ca} 无换场时间（该区通勤约 ${need} 分）`, startTime: cur.startTime });
      }
    }
  }

  return {
    issues,
    stats: {
      segments: acts.length,
      sleepHours: Math.round(sleepMin / 60 * 10) / 10,
      sexCount, explicitCount,
      avgDescLen: acts.length ? Math.round(acts.reduce((s, a) => s + String(a.description || '').length, 0) / acts.length) : 0,
      uniquePlaces: new Set(acts.map(a => splitLocation(a.location).place).filter(Boolean)).size,
      uniqueAreas: new Set(acts.map(a => splitLocation(a.location).area).filter(Boolean)).size,
    },
  };
}

// ══════════════════════════════════════════════════════════
// 跨次观测（长期视角）
// ══════════════════════════════════════════════════════════

/**
 * 某角色的**长期体检**：跨多次生成的稳定性、八股度与风险累积。
 */
export function auditCharacter(characterId, ctx = {}) {
  const db = getDb();
  const char = db.prepare('SELECT id, display_name, COALESCE(archived,0) AS archived, home_place, sleep_place, home_area, work_place, transit_mode FROM characters WHERE id = ?').get(characterId);
  if (!char) return null;

  // ★ 该角色的**自有场所**（居家/睡眠/**工作地** + 所属区）：从角色资料读，并入本次体检的豁免集
  //   —— 避免"回家/睡觉/在自家办公室办公"被误报成"闯入受限地点/不可直达"。
  //   ⚠ 工作地必须一并纳入：地图常把办公处标成 private（"谢绝外人"说的是别人进不去），
  //     实测「真珠办公室」被连报 8 次受限闯入 —— 那是她在**自己办公室上班**。
  //   ⚠ 这三者语义相同（"这是我自己的地方"），故合并进**同一个**豁免集，
  //     不做来源区分 —— 审计只需要知道"该不该放行"，不需要知道是家还是办公室。
  const ownPlaces = new Set();
  for (const v of [char.home_place, char.sleep_place, char.home_area, char.work_place]) {
    const s = String(v || '').trim();
    if (s) ownPlaces.add(s);
    // 地点名常以「区 · 地点」或带书名号记录，做一次宽松归一，保证能命中 splitLocation 的结果
    if (s) ownPlaces.add(s.replace(/[「」《》\s]/g, ''));
  }
  // ★ 超能力移动：从角色资料读移动方式并入 ctx（豁免「跨区瞬移」审计项）。
  //   即便 ownPlaces 为空也要带上 —— 两个豁免条件彼此独立。
  const charCtx = {
    ...ctx,
    transitMode: char.transit_mode,
    ...(ownPlaces.size ? { ownPlaces: new Set([...(ctx.ownPlaces || []), ...ownPlaces]) } : {}),
  };

  const records = loadSchedules(characterId);
  const perRecord = [];
  const clicheProps = clichePropsNow();   // 通用词 + 当前世界观专有词（每次审计算一次）
  for (const r of records) {
    const acts = parseSchedule(r.json);
    if (!acts.length) continue;
    const audit = auditSchedule(acts, charCtx);
    const places = new Set(), locSet = new Set();
    let propHits = 0;
    const allText = [];
    for (const a of acts) {
      const loc = String(a.location || '').trim();
      if (loc) { places.add(loc); locSet.add(splitLocation(loc).place); }
      const t = `${a.activity || ''} ${a.description || ''}`;
      allText.push(t);
      for (const p of clicheProps) if (t.includes(p)) propHits++;
    }
    perRecord.push({
      kind: r.kind, date: r.date, generated_at: r.generated_at,
      places: locSet, allText: allText.join('\n'),
      propHits, issues: audit.issues, stats: audit.stats,
    });
  }

  // ── 八股度：同一批记录里地点与句式的重复程度 ──
  // ★★ 复读率**只能在"不同日期的 daily 快照之间"比较**：
  //    ① template 是"典型一天"，daily 由它实例化 → 把 daily-vs-同源-template 计入配对，
  //       会把"只有 1 份"的角色算成 100% 复读（假阳性，实测「长夜月」命中，会严重误导观察）；
  //    ② 只有 1 份 daily 时 pairN=0，本就没有可比对象 → 标记 measurable=false，不报数。
  let cliche = { topPlaceShare: 0, propPerRecord: 0, repeat4gram: 0, sampleTop: [], measurable: false, pairs: 0 };
  if (perRecord.length) {
    const placeCount = new Map();
    for (const r of perRecord) for (const p of r.places) placeCount.set(p, (placeCount.get(p) || 0) + 1);
    const sortedPlaces = [...placeCount.entries()].sort((a, b) => b[1] - a[1]);
    const totalPlaceMentions = sortedPlaces.reduce((s, [, n]) => s + n, 0);
    const topN = sortedPlaces.slice(0, 5).reduce((s, [, n]) => s + n, 0);
    // 复读：**只在不同日期的 daily 之间**做两两 4-gram 重合（排除 template 与其副本）
    const dailies = perRecord.filter(r => r.kind === 'daily');
    const grams = dailies.map(r => ngrams(r.allText, 4));
    let pairSum = 0, pairN = 0;
    for (let i = 0; i < grams.length; i++) for (let j = i + 1; j < grams.length; j++) { pairSum += jaccard(grams[i], grams[j]); pairN++; }
    cliche = {
      topPlaceShare: totalPlaceMentions ? Math.round(topN / totalPlaceMentions * 100) : 0,
      propPerRecord: Math.round(perRecord.reduce((s, r) => s + r.propHits, 0) / perRecord.length * 10) / 10,
      repeat4gram: pairN ? Math.round(pairSum / pairN * 100) : 0,
      measurable: pairN > 0,
      pairs: pairN,
      sampleTop: sortedPlaces.slice(0, 8).map(([p, n]) => ({ place: p, count: n })),
    };
  }

  // ── 稳定性：与模板（"典型一天"）的偏离度 ──
  const tmpl = perRecord.find(r => r.kind === 'template');
  let stability = null;
  if (tmpl && perRecord.length > 1) {
    const others = perRecord.filter(r => r.kind !== 'template');
    const sims = others.map(r => jaccard(tmpl.places, r.places));
    stability = {
      refKind: 'template',
      avgPlaceSimilarity: Math.round(sims.reduce((s, x) => s + x, 0) / Math.max(1, sims.length) * 100),
      samples: sims.length,
    };
  }

  // ── 风险累积 ──
  // ⚠ 按 **(code, 对象)** 去重后再计数 —— 用户实报「点开全是重复」的直接原因就是不去重：
  //   实测「真珠办公室」被连报 8 次受限闯入，那是**同一个问题在同一份日程里重复出现**
  //   （她的一天里有 8 个时段都在自己办公室），展开后 8 条一模一样，完全淹没真信号。
  //   现在同 code + 同对象只计 1 次，并记下 `occurrences` 供参考（不参与排序）。
  const agg = new Map();   // key = code|对象  → { code, detail, occurrences }
  for (const r of perRecord) {
    for (const i of r.issues) {
      // 对象 = 受限地点名 / 涉及活动名；取不到则退化为 code 本身（同 code 全部合并）
      const obj = pickIssueObject(i);
      const key = `${i.code}|${obj}`;
      const hit = agg.get(key);
      if (hit) hit.occurrences++;
      else agg.set(key, { code: i.code, detail: i.detail, occurrences: 1 });
    }
  }
  const byCode = new Map();
  for (const v of agg.values()) byCode.set(v.code, (byCode.get(v.code) || 0) + 1);

  return {
    character: { id: char.id, name: char.display_name, archived: !!char.archived },
    records: perRecord.length,
    dailyCount: perRecord.filter(r => r.kind === 'daily').length,
    hasTemplate: !!tmpl,
    cliche,
    stability,
    // 去重后的**问题种类数**（不再是重复条数）——这才是"该有信号"的口径
    riskByCode: [...byCode.entries()].map(([code, n]) => ({ code, count: n })).sort((a, b) => b.count - a.count),
    // 去重后的问题明细（供前端展开），最多 40 条
    risks: [...agg.values()]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 40)
      .map(v => ({ code: v.code, detail: v.detail, occurrences: v.occurrences })),
    latest: perRecord.length ? {
      // ⚠ 最新一期的明细也去重（同 code + 同对象只留一条），否则展开后又是 8 条一样的话
      date: perRecord[perRecord.length - 1].date || '(模板)',
      issues: dedupeIssues(perRecord[perRecord.length - 1].issues).slice(0, 12),
      stats: perRecord[perRecord.length - 1].stats,
    } : null,
  };
}

/** 从 issue 里取「问题对象」（受限地点 / 活动名），取不到返回空串 */
function pickIssueObject(i) {
  const d = String(i?.detail || '');
  // 受限/不可达：detail 形如「去了受限地点「真珠办公室」」
  const quoted = d.match(/「([^」]+)」/);
  if (quoted) return quoted[1];
  // 其余用活动名兜底（同一活动只算一次）
  return String(i?.activity || '');
}

/** 按 (code, 对象) 去重，保留首次出现并累计 occurrences */
function dedupeIssues(list) {
  const seen = new Map();
  for (const i of (list || [])) {
    const key = `${i.code}|${pickIssueObject(i)}`;
    const hit = seen.get(key);
    if (hit) hit.occurrences = (hit.occurrences || 1) + 1;
    else seen.set(key, { ...i, occurrences: 1 });
  }
  return [...seen.values()];
}

/** 全角色台账总览（按八股度/风险排序，便于一眼看出该先调谁） */
export function ledgerOverview(ctx = {}) {
  const db = getDb();
  let chars = [];
  try {
    chars = db.prepare('SELECT id, display_name, COALESCE(archived,0) AS archived FROM characters ORDER BY id').all();
  } catch { return { characters: [], summary: {} }; }

  const rows = [];
  for (const c of chars) {
    const a = auditCharacter(c.id, ctx);
    if (!a || !a.records) continue;          // 没生成过日程的角色不进台账（避免满屏空行）
    rows.push(a);
  }
  // ⚠ 内层累加器必须用独立变量（曾误写成外层 s → 每轮 2*s 指数放大到 2^44）
  const totalIssues = rows.reduce((sum, r) => sum + r.riskByCode.reduce((acc, y) => acc + (Number(y.count) || 0), 0), 0);
  // 平均复读只统计**可测**的角色（≥2 份不同日期 daily）；不可测的按 0 计入会压低均值、失真
  const measurableRows = rows.filter(r => r.cliche.measurable);
  return {
    characters: rows,
    summary: {
      withSchedules: rows.length,
      totalIssues,
      measurableRepeat: measurableRows.length,   // 有几位的复读率是可信的
      avgRepeat4gram: measurableRows.length
        ? Math.round(measurableRows.reduce((s, r) => s + r.cliche.repeat4gram, 0) / measurableRows.length)
        : 0,
      avgPropPerRecord: rows.length ? Math.round(rows.reduce((s, r) => s + r.cliche.propPerRecord, 0) / rows.length * 10) / 10 : 0,
    },
  };
}