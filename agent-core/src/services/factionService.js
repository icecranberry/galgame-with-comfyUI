/**
 * factionService —— 「派系与组织」模块的业务层（酒馆页第三块，2026-10-07）。
 *
 * ── 它解决什么问题 ────────────────────────────────────────────
 * 酒馆页原本只有两块：「我的关系图」（人↔人、人↔我）与「世界观设置」（世界背景）。
 * 本模块补第三块：**势力格局**（派系↔派系、角色↔派系）。三者是**正交互补**的维度，不合并：
 *   · 关系图 = 人与人；
 *   · 世界观 = 背景；
 *   · 派系与组织 = 势力与势力 / 人与势力。
 *
 * ⚠ **与「角色文件夹」的区别（绝不要合并）**：
 *   文件夹 = 用户侧分类（单层、一对一、纯手动、"我怎么找角色"）；
 *   派系 = 世界观侧归属（可层级、**多对多**、带职务与关系、"这个世界怎么运转"）。
 *
 * ── 红线对照 ──────────────────────────────────────────────────
 * · 红线 12：派系是**世界观实例专属** → 只认当前激活世界观；结构化定义镜像回
 *   `world-projects/<slug>/project.json` 的 `factions` 槽位（引擎只读，不内置任何世界观的派系名）。
 * · 红线 8：类型/关系的词表只在本文件定义一份（`FACTION_TYPES` / `FACTION_RELATIONS`），
 *   前端经 `GET /api/factions/types` 渲染。
 * · 归档角色：**不计入**成员数（`archived=0` 才算），但详情里仍可看到（另标注）。
 */

import { getDb, getActiveWorldSetting } from '../db/index.js';
import { slugForWorld, writeProject, readProject } from './worldProjectLibrary.js';

/** 派系类型 —— 唯一真源（对齐 vault「四层架构」的 政权/军事/秘密结社） */
export const FACTION_TYPES = ['政权', '军事', '秘密结社', '宗教', '商业', '其他'];
/** 势力关系 —— 唯一真源 */
export const FACTION_RELATIONS = ['同盟', '敌对', '中立', '从属', '竞争'];
/** 图上"默认画哪些边"（D4）：中立太密，默认不画 */
export const DEFAULT_VISIBLE_RELATIONS = ['同盟', '敌对', '从属'];
/** 职务的常用建议值（自由文本，仅作前端联想，不做校验） */
export const ROLE_SUGGESTIONS = ['首领', '干部', '成员', '线人', '顾问', '挂名'];
/**
 * 势力状态 —— 唯一真源（参考用户既有《开局态势》的用词：鼎盛 / 稳固 / 困顿）。
 * ⚠ 全是**通用**词：引擎不得内置任何世界观专名（红线 12）。
 */
export const FACTION_STATUSES = ['鼎盛', '稳固', '困顿', '衰落', '新兴'];
/** 该势力**对玩家**的态度（区别于 `faction_relations` 的派系↔派系） */
export const FACTION_STANCES = ['友好', '中立', '冷淡', '敌对'];
/**
 * 「权力支柱」小标签的**通用**建议值 —— 一句话说清这个势力**凭什么立足**。
 *
 * ⚠ ⚠ 这里**只放通用词**：像「欢愉愿力」「欢愉假面」「寰宇巨企」那种是**某个世界观的专名**，
 *   写进引擎后换世界观就是错的（红线 12）。世界专属的支柱由用户自己填，
 *   随 `world-projects/<slug>/project.json` 的镜像走。
 */
export const POWER_PILLAR_SUGGESTIONS = [
  '武力威慑', '财力雄厚', '人脉广泛', '情报网络', '法理正当',
  '舆论声量', '技术垄断', '信仰凝聚', '地盘控制', '声望威望',
];
/** 标签上限（防 UI 与提示词被刷爆） */
const MAX_TAGS = 8;
const MAX_TAG_LEN = 12;

const MAX_NAME = 40;
const MAX_TEXT = 2000;

function clampText(v, max = MAX_TEXT) {
  return String(v ?? '').trim().slice(0, max);
}

function fail(msg, code = 400) {
  const e = new Error(msg);
  e.status = code;
  return e;
}

/** 当前激活世界观的 slug（无激活世界观 → 空串，此时派系不可用） */
export function activeWorldSlug() {
  const active = getActiveWorldSetting();
  if (!active) return '';
  return slugForWorld(active.name, active.id);
}

function db() {
  return getDb();
}

/** 名称 → 稳定 slug（中文走 `f_<sha1 前 8 位>`，ASCII 走 kebab） */
function slugify(name) {
  const base = String(name || '').trim();
  const ascii = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii.slice(0, 40);
  // 中文等非 ASCII：用内容哈希，稳定且与名字绑定
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return `f-${h.toString(16).padStart(8, '0')}`;
}

/** 生成不与既有冲突的 slug */
function uniqueSlug(name, excludeId = null) {
  const rows = db().prepare('SELECT id, slug FROM factions').all();
  const taken = new Set(rows.filter(r => r.id !== excludeId).map(r => r.slug));
  const stem = slugify(name);
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 1000; i++) {
    const s = `${stem}-${i}`;
    if (!taken.has(s)) return s;
  }
  throw fail('派系同名过多，换一个名字');
}

function assertType(type) {
  const t = clampText(type, 20) || '其他';
  if (!FACTION_TYPES.includes(t)) throw fail(`未知的派系类型：${t}（可选：${FACTION_TYPES.join(' / ')}）`);
  return t;
}

function assertRelation(relation) {
  const r = clampText(relation, 20);
  if (!FACTION_RELATIONS.includes(r)) throw fail(`未知的势力关系：${r}（可选：${FACTION_RELATIONS.join(' / ')}）`);
  return r;
}

function assertStatus(status) {
  const s = clampText(status, 12) || '稳固';
  if (!FACTION_STATUSES.includes(s)) throw fail(`未知的势力状态：${s}（可选：${FACTION_STATUSES.join(' / ')}）`);
  return s;
}

function assertStance(stance) {
  const s = clampText(stance, 12) || '中立';
  if (!FACTION_STANCES.includes(s)) throw fail(`未知的立场：${s}（可选：${FACTION_STANCES.join(' / ')}）`);
  return s;
}

/**
 * 归一「权力支柱」标签：接受数组或「a、b,c」字符串。
 * ⚠ 去重 + 去空 + 截断（各有上限），并**去重时不区分全半角顿号**。
 * ⚠ 自由文本 —— **不做词表校验**（世界观专属的支柱本就该自由填）。
 */
function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '').split(/[、,，;；|]/);
  const out = [];
  for (const t of raw) {
    const s = clampText(t, MAX_TAG_LEN);
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** 从库里读出的 tags（TEXT，JSON 数组）→ 数组；坏数据回落空数组并留痕 */
function parseTags(text) {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    console.warn('[factionService] factions.tags 不是合法 JSON，按空处理');
    return [];
  }
}

function assertInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * 防环：把 parentId 挂到 id 下之后是否会成环（沿 parent 链上溯，遇到 id 即成环）。
 * ⚠ 层级是"结构性"判据的来源，环会让树渲染与递归双双爆栈 —— 必须在写入前拦住。
 */
function assertNoCycle(id, parentId) {
  if (parentId == null) return;
  if (Number(parentId) === Number(id)) throw fail('不能把派系挂到自己下面');
  let cur = Number(parentId);
  const seen = new Set();
  const stmt = db().prepare('SELECT parent_id FROM factions WHERE id = ?');
  while (cur != null && !seen.has(cur)) {
    if (cur === Number(id)) throw fail('不能把派系挂到自己的后代下面（会成环）');
    seen.add(cur);
    const row = stmt.get(cur);
    cur = row?.parent_id ?? null;
  }
}

// ── 读 ────────────────────────────────────────────────────────

/** 组织架构：members + 角色名（含归档标记；计数另行排除归档） */
function membersOf(factionId) {
  return db().prepare(`
    SELECT m.id, m.character_id, m.role, m.rank, m.note,
           c.display_name, c.name AS char_name, COALESCE(c.archived, 0) AS archived
    FROM faction_members m
    JOIN characters c ON c.id = m.character_id
    WHERE m.faction_id = ?
    ORDER BY m.rank DESC, c.display_name COLLATE NOCASE
  `).all(factionId);
}

/** 势力关系（出边） */
function relationsOf(factionId) {
  return db().prepare(`
    SELECT r.id, r.to_faction_id AS toId, r.relation, r.strength, r.note,
           f.name AS toName, f.type AS toType
    FROM faction_relations r
    JOIN factions f ON f.id = r.to_faction_id
    WHERE r.from_faction_id = ?
    ORDER BY r.strength DESC
  `).all(factionId);
}

function toDTO(row) {
  const members = membersOf(row.id);
  // ⚠ D7：归档角色不计入成员数（与归档体系一致），但仍在 members 里可见
  const activeMembers = members.filter(m => !m.archived);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    parentId: row.parent_id,
    summary: row.summary || '',
    description: row.description || '',
    // ── 态势与小标签（2026-10-07，迁移 004）──
    scope: row.scope || '',
    status: row.status || '稳固',
    stance: row.stance || '中立',
    goal: row.goal || '',
    tags: parseTags(row.tags),
    color: row.color || '',
    icon: row.icon || '',
    worldSlug: row.world_slug || '',
    sortOrder: row.sort_order,
    origin: row.origin,
    memberCount: activeMembers.length,
    archivedMemberCount: members.length - activeMembers.length,
    members,
    relations: relationsOf(row.id),
  };
}

/** 列出当前世界的全部派系（含成员与关系；SQL 条数有限，一次取全） */
export function listFactions() {
  const slug = activeWorldSlug();
  const rows = slug
    ? db().prepare('SELECT * FROM factions WHERE world_slug = ? ORDER BY sort_order, name COLLATE NOCASE').all(slug)
    : [];
  return rows.map(toDTO);
}

export function getFaction(id) {
  const row = db().prepare('SELECT * FROM factions WHERE id = ?').get(Number(id));
  if (!row) throw fail('派系不存在', 404);
  return toDTO(row);
}

// ── 写 ────────────────────────────────────────────────────────

export function createFaction(input = {}) {
  const slug = activeWorldSlug();
  if (!slug) throw fail('没有激活的世界观，无法创建派系（先在「世界观设置」里激活一套）');
  const name = clampText(input.name, MAX_NAME);
  if (!name) throw fail('派系名不能为空');
  const type = assertType(input.type);
  const parentId = input.parentId == null || input.parentId === '' ? null : Number(input.parentId);

  const row = db().prepare(`
    INSERT INTO factions (slug, name, type, parent_id, summary, description, color, icon, world_slug, sort_order, origin,
                          scope, status, stance, goal, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
  `).run(
    uniqueSlug(name),
    name,
    type,
    parentId,
    clampText(input.summary, 200),
    clampText(input.description),
    clampText(input.color, 20) || null,
    clampText(input.icon, 40) || null,
    slug,
    assertInt(input.sortOrder, 0, -9999, 9999),
    clampText(input.scope, 120),
    assertStatus(input.status),
    assertStance(input.stance),
    clampText(input.goal, 300),
    JSON.stringify(normalizeTags(input.tags)),
  );
  const created = getFaction(row.lastInsertRowid);
  mirrorToProject(slug);
  return created;
}

export function updateFaction(id, patch = {}) {
  const numId = Number(id);
  const cur = db().prepare('SELECT * FROM factions WHERE id = ?').get(numId);
  if (!cur) throw fail('派系不存在', 404);

  const next = {
    name: patch.name === undefined ? cur.name : clampText(patch.name, MAX_NAME),
    type: patch.type === undefined ? cur.type : assertType(patch.type),
    parentId: patch.parentId === undefined
      ? cur.parent_id
      : (patch.parentId == null || patch.parentId === '' ? null : Number(patch.parentId)),
    summary: patch.summary === undefined ? cur.summary : clampText(patch.summary, 200),
    description: patch.description === undefined ? cur.description : clampText(patch.description),
    color: patch.color === undefined ? cur.color : (clampText(patch.color, 20) || null),
    icon: patch.icon === undefined ? cur.icon : (clampText(patch.icon, 40) || null),
    sortOrder: patch.sortOrder === undefined ? cur.sort_order : assertInt(patch.sortOrder, 0, -9999, 9999),
    scope: patch.scope === undefined ? cur.scope : clampText(patch.scope, 120),
    status: patch.status === undefined ? cur.status : assertStatus(patch.status),
    stance: patch.stance === undefined ? cur.stance : assertStance(patch.stance),
    goal: patch.goal === undefined ? cur.goal : clampText(patch.goal, 300),
    tags: patch.tags === undefined ? parseTags(cur.tags) : normalizeTags(patch.tags),
  };
  if (!next.name) throw fail('派系名不能为空');
  if (next.parentId != null) assertNoCycle(numId, next.parentId);

  db().prepare(`
    UPDATE factions
    SET name = ?, type = ?, parent_id = ?, summary = ?, description = ?, color = ?, icon = ?,
        sort_order = ?, scope = ?, status = ?, stance = ?, goal = ?, tags = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next.name, next.type, next.parentId, next.summary, next.description, next.color, next.icon,
    next.sortOrder, next.scope, next.status, next.stance, next.goal, JSON.stringify(next.tags), numId);
  const out = getFaction(numId);
  mirrorToProject(cur.world_slug);
  return out;
}

export function deleteFaction(id) {
  const numId = Number(id);
  const cur = db().prepare('SELECT id, world_slug FROM factions WHERE id = ?').get(numId);
  if (!cur) throw fail('派系不存在', 404);
  // 成员与关系由外键 ON DELETE CASCADE 清掉；子派系的 parent_id 由 ON DELETE SET NULL 置空
  db().prepare('DELETE FROM factions WHERE id = ?').run(numId);
  mirrorToProject(cur.world_slug);
  return { deleted: numId };
}

// ── 成员 ──────────────────────────────────────────────────────

export function addMember(factionId, input = {}) {
  const fid = Number(factionId);
  const parent = db().prepare('SELECT id, world_slug FROM factions WHERE id = ?').get(fid);
  if (!parent) throw fail('派系不存在', 404);
  const characterId = Number(input.characterId);
  if (!Number.isFinite(characterId)) throw fail('缺少 characterId');
  const ch = db().prepare('SELECT id FROM characters WHERE id = ?').get(characterId);
  if (!ch) throw fail('角色不存在', 404);

  const role = clampText(input.role, 20) || '成员';
  const rank = assertInt(input.rank, 5, 0, 9);
  try {
    db().prepare(`
      INSERT INTO faction_members (faction_id, character_id, role, rank, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(fid, characterId, role, rank, clampText(input.note, 200));
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) throw fail('该角色已在此派系里担任同一职务（换个职务或改那条）', 409);
    throw err;
  }
  mirrorToProject(parent.world_slug);
  return getFaction(fid);
}

export function updateMember(factionId, memberId, patch = {}) {
  const fid = Number(factionId);
  const mid = Number(memberId);
  const cur = db().prepare('SELECT * FROM faction_members WHERE id = ? AND faction_id = ?').get(mid, fid);
  if (!cur) throw fail('成员记录不存在', 404);
  db().prepare(`
    UPDATE faction_members SET role = ?, rank = ?, note = ? WHERE id = ?
  `).run(
    patch.role === undefined ? cur.role : (clampText(patch.role, 20) || '成员'),
    patch.rank === undefined ? cur.rank : assertInt(patch.rank, cur.rank, 0, 9),
    patch.note === undefined ? cur.note : clampText(patch.note, 200),
    mid,
  );
  const parent = db().prepare('SELECT world_slug FROM factions WHERE id = ?').get(fid);
  mirrorToProject(parent?.world_slug);
  return getFaction(fid);
}

export function removeMember(factionId, memberId) {
  const fid = Number(factionId);
  const r = db().prepare('DELETE FROM faction_members WHERE id = ? AND faction_id = ?').run(Number(memberId), fid);
  if (!r.changes) throw fail('成员记录不存在', 404);
  const parent = db().prepare('SELECT world_slug FROM factions WHERE id = ?').get(fid);
  mirrorToProject(parent?.world_slug);
  return getFaction(fid);
}

// ── 势力关系 ──────────────────────────────────────────────────

/** 建/改一条势力关系（from→to 唯一，重复则更新） */
export function upsertRelation(input = {}) {
  const fromId = Number(input.fromId ?? input.from_faction_id);
  const toId = Number(input.toId ?? input.to_faction_id);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId)) throw fail('缺少 fromId / toId');
  if (fromId === toId) throw fail('派系不能和自己建立关系');
  const relation = assertRelation(input.relation);
  const strength = assertInt(input.strength, 50, 0, 100);
  const note = clampText(input.note, 200);

  const from = db().prepare('SELECT id, world_slug FROM factions WHERE id = ?').get(fromId);
  const to = db().prepare('SELECT id, world_slug FROM factions WHERE id = ?').get(toId);
  if (!from || !to) throw fail('派系不存在', 404);
  if (from.world_slug !== to.world_slug) throw fail('不能跨世界观建立势力关系');

  db().prepare(`
    INSERT INTO faction_relations (from_faction_id, to_faction_id, relation, strength, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(from_faction_id, to_faction_id)
    DO UPDATE SET relation = excluded.relation, strength = excluded.strength,
                  note = excluded.note, updated_at = CURRENT_TIMESTAMP
  `).run(fromId, toId, relation, strength, note);
  mirrorToProject(from.world_slug);
  return getFaction(fromId);
}

export function removeRelation(relationId) {
  const row = db().prepare(`
    SELECT r.id, f.world_slug FROM faction_relations r
    JOIN factions f ON f.id = r.from_faction_id WHERE r.id = ?
  `).get(Number(relationId));
  if (!row) throw fail('关系不存在', 404);
  db().prepare('DELETE FROM faction_relations WHERE id = ?').run(Number(relationId));
  mirrorToProject(row.world_slug);
  return { deleted: Number(relationId) };
}

// ── 给 LLM 的创意写作指导块 ────────────────────────────────────

/**
 * 生成「势力态势」提示词块（供创意写作时参考）。
 *
 * ── 为什么这样写 ──────────────────────────────────────────────
 * 参考用户既有的《剧本 开局态势》结构：光有"势力叫什么"对写作没用，
 * **"现在什么状态 + 想干什么 + 靠什么立足"** 才是抓手 —— 于是这里按
 * `状态 / 立场 / 支柱 / 当下目标` 组织，并明确要求"言行与处境一致"。
 *
 * ★ **没有派系时返回 `null`** —— 调用方据此整段不出现，保证"默认不改行为"（红线 4）。
 * ⚠ 内容**全部来自 DB/项目库**（某世界观的派系名与支柱都属该世界观），引擎不内置任何专名（红线 12）。
 * ⚠ 调用方必须把它放在**动态层**（如日程的约束层），**绝不要塞进共享常量**（会打穿 LLM 前缀缓存）。
 *
 * @param {{limit?:number, onlyWithGoal?:boolean}} [opts]
 * @returns {string|null}
 */
export function buildPromptBlock(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : 20;
  let list = listFactions();
  if (opts.onlyWithGoal) list = list.filter(f => f.goal);
  if (limit > 0) list = list.slice(0, limit);
  if (!list.length) return null;

  const lines = [];
  for (const f of list) {
    const bits = [
      `**${f.name}**`,
      f.type ? `${f.type}` : '',
      f.scope ? `范围：${f.scope}` : '',
      f.status ? `状态：${f.status}` : '',
      f.stance ? `对我：${f.stance}` : '',
    ].filter(Boolean);
    lines.push(`- ${bits.join(' ｜ ')}`);
    if (f.parentId) {
      const parent = list.find(x => x.id === f.parentId);
      if (parent) lines.push(`  （隶属：${parent.name}）`);
    }
    if (f.tags.length) lines.push(`  支柱：${f.tags.join('、')}`);
    if (f.goal) lines.push(`  当下目标：${f.goal}`);
    else if (f.summary) lines.push(`  概述：${f.summary}`);
  }

  return `<factions>
【势力态势 —— 供你理解这个世界的格局】

${lines.join('\n')}

写作要求：
· 角色的言行要与其所属派系的**处境与目标**一致（困顿的势力更收敛，鼎盛的更张扬）。
· 涉及势力之间的互动时，按上面的「支柱」与「当下目标」推演，**不要凭空发明新势力或新目标**。
· 本段只供你把握分寸：**不要照抄、不要向角色复述这些设定**。
</factions>`;
}

// ── project.json 镜像（红线 12：定义随世界观项目库走）────────────

/**
 * 把当前世界的派系**镜像**写回 `world-projects/<slug>/project.json` 的 `factions` 槽位。
 *
 * ⚠ 与 `world.md` 同口径：**运行时真源是 DB**，这里写的是**镜像/可迁移载体**
 *   （方便人工编辑、版本控制、随世界观项目库整体迁移）。
 * ⚠ 只改 `factions` 槽位，其余槽位原样保留 —— 不要覆盖用户手填的其它字段。
 * ⚠ 失败只 warn（写不进去不该阻断业务写入）。
 */
export function mirrorToProject(slug = activeWorldSlug()) {
  if (!slug) return { ok: false, reason: 'no-world' };
  try {
    const factions = listFactions().map(f => ({
      slug: f.slug,
      name: f.name,
      type: f.type,
      parent: f.parentId ? (db().prepare('SELECT slug FROM factions WHERE id = ?').get(f.parentId)?.slug || null) : null,
      summary: f.summary,
      description: f.description,
      scope: f.scope,
      status: f.status,
      stance: f.stance,
      goal: f.goal,
      tags: f.tags,
      color: f.color,
      icon: f.icon,
      sort_order: f.sortOrder,
      members: f.members.map(m => ({ character: m.char_name, role: m.role, rank: m.rank })),
      relations: f.relations.map(r => ({ to: r.toId, relation: r.relation, strength: r.strength })),
    }));
    const cur = readProject(slug);
    writeProject(slug, { ...cur, slug, exists: true, factions });
    return { ok: true, count: factions.length };
  } catch (err) {
    console.warn(`[factionService] 回写 project.json 失败（不影响 DB 写入）: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}
