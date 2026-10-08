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
 *     指标：地点集中度（Top-N 地点占比）、n-gram 复读率、道具词（愿宝等）每篇出现次数。
 *  ③ **合理性** —— 生成的日程是否违反了已建立的约束？
 *     指标：受限地点闯入次数、跨区瞬移（换场时间 < 通勤基线）、服装与 zone 矛盾、
 *          睡眠时长越界、时段空档/重叠。
 *
 * ⚠ 本模块**只读**：不改日程、不写自己的表，全部从 daily_schedules / schedule_templates
 *   与地图数据现算。这样它永远不会成为新的"必须同步维护的真源"。
 */

import { getDb } from '../db/index.js';

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
  if (h > 23 || mi > 59) return null;
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

/** 道具/货币等"容易变成口头禅"的词。出现频次过高＝八股信号 */
const CLICHE_PROPS = ['愿宝', '心愿', '黄金马桶', '餐盘', '石桌', '内袋', '尾款', '结算表', '酒杯', '账单'];

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
 * @param {Array} acts 活动数组
 * @param {object} ctx { forbiddenPlaces:Set, transferForbidden:Set, areaOf:Map }
 */
export function auditSchedule(acts, ctx = {}) {
  const issues = [];
  const durations = [];
  let sleepMin = 0, sexCount = 0, explicitCount = 0, musicDelay = 0;

  const FORBIDDEN = ctx.forbiddenPlaces instanceof Set ? ctx.forbiddenPlaces : new Set();
  const NO_TRANSFER = ctx.noTransferPlaces instanceof Set ? ctx.noTransferPlaces : new Set();

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

    // ① 受限地点闯入
    for (const f of FORBIDDEN) {
      if (f && (place === f || area === f)) {
        issues.push({ code: 'forbidden-place', level: 'warn', detail: `去了受限地点「${f}」`, activity: a.activity, startTime: a.startTime });
        break;
      }
    }
    // ② 不可直接抵达
    for (const f of NO_TRANSFER) {
      if (f && (place === f || area === f)) {
        issues.push({ code: 'unreachable-place', level: 'warn', detail: `去了不可直接抵达的「${f}」`, activity: a.activity, startTime: a.startTime });
        break;
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
  const TRANSFER = ctx.transferMinutes instanceof Map ? ctx.transferMinutes : new Map();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].a, cur = sorted[i].a;
    const pa = splitLocation(prev.location).area, ca = splitLocation(cur.location).area;
    if (!pa || !ca || pa === ca) continue;
    const need = TRANSFER.get(`${pa}→${ca}`) ?? TRANSFER.get(`${ca}→${pa}`);
    if (need == null) continue;
    const gap = Math.max(0, (toMin(cur.startTime) ?? 0) - (toMin(prev.endTime) ?? 0));
    // 换场时间通常并入其中一段，所以用「上一段尾 + 本段头」的可疑度判断：
    // 若两段都写得"满"（本段一开始就在新地点做事），视为瞬移。
    if (gap === 0 && need > 20) {
      issues.push({ code: 'teleport', level: 'warn', detail: `${pa} → ${ca} 无换场时间（该区通勤约 ${need} 分）`, startTime: cur.startTime });
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
  const char = db.prepare('SELECT id, display_name, COALESCE(archived,0) AS archived FROM characters WHERE id = ?').get(characterId);
  if (!char) return null;

  const records = loadSchedules(characterId);
  const perRecord = [];
  for (const r of records) {
    const acts = parseSchedule(r.json);
    if (!acts.length) continue;
    const audit = auditSchedule(acts, ctx);
    const places = new Set(), locSet = new Set();
    let propHits = 0;
    const allText = [];
    for (const a of acts) {
      const loc = String(a.location || '').trim();
      if (loc) { places.add(loc); locSet.add(splitLocation(loc).place); }
      const t = `${a.activity || ''} ${a.description || ''}`;
      allText.push(t);
      for (const p of CLICHE_PROPS) if (t.includes(p)) propHits++;
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
  const byCode = new Map();
  for (const r of perRecord) for (const i of r.issues) byCode.set(i.code, (byCode.get(i.code) || 0) + 1);

  return {
    character: { id: char.id, name: char.display_name, archived: !!char.archived },
    records: perRecord.length,
    dailyCount: perRecord.filter(r => r.kind === 'daily').length,
    hasTemplate: !!tmpl,
    cliche,
    stability,
    riskByCode: [...byCode.entries()].map(([code, n]) => ({ code, count: n })).sort((a, b) => b.count - a.count),
    latest: perRecord.length ? {
      date: perRecord[perRecord.length - 1].date || '(模板)',
      issues: perRecord[perRecord.length - 1].issues.slice(0, 12),
      stats: perRecord[perRecord.length - 1].stats,
    } : null,
  };
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