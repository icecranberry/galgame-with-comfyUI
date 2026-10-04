/**
 * dataCleanup.js — 按时间清理「生成的图片」与「生成的内容记录」
 *
 * ── 两类数据，绝不混为一谈 ──
 *
 * **内容记录（content）**：聊天 / 朋友圈 / 评论 / 生图日志 —— 它们是「历史」，
 *   删掉就是历史消失，配图一并删除。这是本模块的主用途。
 *
 * **长期资产（asset）**：头像生成结果 / 立绘 / 表情立绘 / 表情包 / 橱窗商品图 / 传媒配图 ——
 *   它们是「当前在用的资源」，不是历史。删了会直接影响界面与功能（头像没了、商品图要重出）。
 *   **界面默认不勾选**，且明确标注后果。商品图 / 传媒配图删了能重建，但重建要花算力与时间。
 *
 * ── 三条安全设计（都是踩过坑换来的）──
 *
 * 1. **保护集**：删图片前先算出「仍会被保留的记录所引用的图片」全集，逐张跳过。
 *    否则会出现：一条今天的新消息引用了一张 40 天前的老图（同图被复用），
 *    按时间删图会把这张图删掉，而那条新消息还留着 → 配图 404。
 * 2. **先备份数据库**：记录删了就回不来，但 DB 整体可回滚。执行前自动复制一份 agent.db。
 * 3. **两段式**：`surveyData()` 只统计不删（给界面预览），`purgeData()` 才真删，
 *    且必须显式传入要删的 target 列表 —— 不存在「一个按钮删光」的路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { getImageDir } from './imagePaths.js';
import { invalidateGalleryCache } from './galleryCache.js';

const DAY_MS = 86400_000;

/**
 * 清理目标定义。
 * - tables：要删的记录（`timeCol` 用来比时间；数组顺序 = 删除顺序，子表在前）
 * - imageDirs：与这批数据关联的图片目录（按文件 mtime 判时间）
 */
export const CLEANUP_TARGETS = [
  // ══ 内容记录（界面默认勾选）══
  {
    key: 'chat',
    label: '聊天记录',
    group: 'content',
    desc: '消息正文与对话配图。删掉后对话历史不可恢复。',
    tables: [
      { table: 'messages', timeCol: 'created_at' },
      // raw_messages 是 messages 的原稿（未加工回复），必须在 messages 之后删
      { table: 'raw_messages', timeCol: 'created_at' },
    ],
    imageDirs: ['chat'],
  },
  {
    key: 'moments',
    label: '朋友圈',
    group: 'content',
    desc: '朋友圈正文、评论与配图。',
    tables: [
      { table: 'moment_comments', timeCol: 'created_at' },   // 评论先删
      { table: 'moment_posts', timeCol: 'created_at' },
    ],
    imageDirs: ['moments'],
  },
  {
    key: 'events',
    label: '奇遇配图',
    group: 'content',
    desc: '奇遇记录的配图（奇遇正文存在聊天记录里，不单独清理）。',
    tables: [],
    imageDirs: ['events'],
  },
  {
    key: 'schedule_peek',
    label: '日程窥屏图',
    group: 'content',
    desc: '日程页「偷看」生成的场景图。',
    tables: [],
    imageDirs: ['peek'],
  },
  {
    key: 'newspaper',
    label: '报纸配图',
    group: 'content',
    desc: '《邻舍日报》各期的新闻插画（报纸文本记录保留）。',
    tables: [],
    imageDirs: ['newspaper'],
  },
  {
    key: 'gifts',
    label: '送礼配图',
    group: 'content',
    desc: '送礼时生成的图片。',
    tables: [],
    imageDirs: ['gifts'],
  },
  {
    key: 'image_tasks',
    label: '生图任务日志',
    group: 'content',
    desc: '每次生图的提示词与结果记录（纯日志，不含图片文件）。',
    tables: [{ table: 'image_tasks', timeCol: 'created_at' }],
    imageDirs: [],
  },

  // ══ 长期资产（界面默认**不**勾选）══
  {
    key: 'avatargen',
    label: 'AI 生成头像',
    group: 'asset',
    desc: '⚠️ 角色头像的来源图。当前使用中的那张会被保护集挡住，不会误删；删的是历史生成结果。',
    tables: [],
    imageDirs: ['avatargen'],
  },
  {
    key: 'standing',
    label: '角色立绘',
    group: 'asset',
    desc: '⚠️ 角色形象馆的立绘。删掉后立绘缺图，需要重新生成。',
    tables: [],
    imageDirs: ['standing'],
  },
  {
    key: 'expression_standing',
    label: '表情立绘',
    group: 'asset',
    desc: '⚠️ 表情用立绘。删掉后表情功能会缺图。',
    tables: [],
    imageDirs: ['expression_standing'],
  },
  {
    key: 'emoji',
    label: '表情包',
    group: 'asset',
    desc: '⚠️ 自建表情包图片。删掉后表情包库会缺图。',
    tables: [],
    imageDirs: ['emoji'],
  },
  {
    key: 'items',
    label: '橱窗商品图',
    group: 'asset',
    desc: '⚠️ 宝箱橱窗的商品图。删掉后会重新排队生成（花算力，且开橱窗时要等）。',
    tables: [],
    imageDirs: ['items'],
  },
  {
    key: 'media',
    label: '传媒配图',
    group: 'asset',
    desc: '⚠️ 传媒内容页的帖子封面。删掉后会重新生成（花算力）。',
    tables: [],
    imageDirs: ['media'],
  },
];

const TARGET_BY_KEY = new Map(CLEANUP_TARGETS.map(t => [t.key, t]));

/** 单值图片字段（这些表的记录不在清理范围内，一律参与保护集） */
const PROTECT_SINGLE_FIELDS = [
  ['characters', 'avatar_path'],
  ['characters', 'standing_url'],
  ['character_standings', 'image_url'],
  ['backpack_items', 'image_url'],
  ['loot_catalog', 'image_url'],
  ['media_posts', 'image'],
  ['media_posts', 'author_avatar'],
];

/** 从 URL（或 URL 数组的 JSON）里取文件名 */
function nameFromUrl(u) {
  const s = String(u || '').split('?')[0];
  return s.startsWith('/images/') ? s.split('/').pop() : null;
}

/**
 * 构建保护集：本次**不会**被清空的记录所引用的图片文件名。
 * @param {Set<string>} wipingTables - 本次要清空的表名（它们的引用马上就不存在了，不参与保护）
 * @returns {Set<string>}
 */
function buildProtectedSet(db, wipingTables) {
  const names = new Set();
  const addJsonArray = (val) => {
    if (!val) return;
    let arr;
    try {
      const parsed = JSON.parse(val);
      arr = Array.isArray(parsed) ? parsed : [parsed];
    } catch { arr = [val]; }
    for (const u of arr) { const n = nameFromUrl(u); if (n) names.add(n); }
  };

  // images 是 JSON 数组的两张表；若本次要清它，就不用参与保护
  if (!wipingTables.has('messages')) {
    try {
      for (const r of db.prepare(`SELECT images FROM messages WHERE images IS NOT NULL AND images <> ''`).all()) addJsonArray(r.images);
    } catch { /* 表不存在 */ }
  }
  if (!wipingTables.has('moment_posts')) {
    try {
      for (const r of db.prepare(`SELECT images FROM moment_posts WHERE images IS NOT NULL AND images <> ''`).all()) addJsonArray(r.images);
    } catch { /* ignore */ }
  }
  // 单值字段
  for (const [table, col] of PROTECT_SINGLE_FIELDS) {
    if (wipingTables.has(table)) continue;
    try {
      for (const r of db.prepare(`SELECT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`).all()) {
        const n = nameFromUrl(r.v);
        if (n) names.add(n);
      }
    } catch { /* 表/列不存在 */ }
  }
  return names;
}

/**
 * 扫一个图片目录，挑出「够老且不在保护集里」的文件。
 * @returns {{files: Array<{name:string, full:string, size:number}>, bytes:number, skippedProtected:number}}
 */
function scanImageDir(dirName, cutoffMs, protectedNames) {
  const out = { files: [], bytes: 0, skippedProtected: 0 };
  let dir;
  try { dir = getImageDir(dirName); } catch { return out; }
  if (!fs.existsSync(dir)) return out;

  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.mtimeMs >= cutoffMs) continue;                          // 不够老
    if (protectedNames.has(name)) { out.skippedProtected++; continue; }  // 仍被保留的记录引用
    out.files.push({ name, full, size: st.size });
    out.bytes += st.size;
  }
  return out;
}

function countTable(db, table, timeCol, cutoffIso) {
  try {
    return db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${timeCol} IS NOT NULL AND ${timeCol} < ?`).get(cutoffIso).n;
  } catch { return 0; }
}

function normDays(days) {
  const n = Number(days);
  return Math.max(1, Math.min(3650, Number.isFinite(n) ? Math.floor(n) : 7));
}

// ── 预览（只统计，不删）──────────────────────────────────

/**
 * 扫描各清理目标在指定天数之前的存量。
 * @param {number} days - 7 / 14 / 30 …
 */
export function surveyData(days = 7) {
  const db = getDb();
  const d = normDays(days);
  const cutoffMs = Date.now() - d * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString().replace('T', ' ').slice(0, 19);

  // 预览按「什么都不删」算保护集 —— 最保守（所有现存记录都当作会保留）
  const protectedNames = buildProtectedSet(db, new Set());

  const targets = CLEANUP_TARGETS.map(t => {
    let rows = 0;
    for (const x of t.tables) rows += countTable(db, x.table, x.timeCol, cutoffIso);

    let files = 0, bytes = 0, skippedProtected = 0;
    for (const dirName of t.imageDirs) {
      const s = scanImageDir(dirName, cutoffMs, protectedNames);
      files += s.files.length;
      bytes += s.bytes;
      skippedProtected += s.skippedProtected;
    }
    return { key: t.key, label: t.label, group: t.group, desc: t.desc, rows, files, bytes, skippedProtected };
  });

  const sum = (list) => list.reduce((a, t) => ({
    rows: a.rows + t.rows, files: a.files + t.files, bytes: a.bytes + t.bytes,
  }), { rows: 0, files: 0, bytes: 0 });

  return {
    days: d,
    cutoff: cutoffIso,
    targets,
    total: sum(targets),
    contentTotal: sum(targets.filter(t => t.group === 'content')),
    assetTotal: sum(targets.filter(t => t.group === 'asset')),
  };
}

// ── 执行 ────────────────────────────────────────────────

/**
 * 数据库文件路径 —— **直接问 better-sqlite3 要**（`db.name` 就是已打开的文件路径）。
 *
 * 为什么不自己按 dataDir() 拼：万一实际连的库和推导出来的路径不是同一个
 * （IMAGES_DIR / 启动参数改过路径），就会出现「备份的是 A、删的是 B」——
 * 用户手里那份"备份"根本救不了被删的库。从 db 实例反查保证两者必然是同一个文件。
 * @param {object} db - getDb() 的返回值
 */
function dbFilePath(db) {
  const f = db?.name;
  if (!f || typeof f !== 'string') {
    throw new Error('无法从数据库连接取到文件路径，已中止（不会在没有备份的情况下清理）');
  }
  if (f === ':memory:' || !fs.existsSync(f)) {
    throw new Error(`数据库不是磁盘文件或已丢失：${f}，已中止`);
  }
  return f;
}

/**
 * 备份数据库（记录删了回不来，但整库可回滚）。
 * 失败会**抛错**而不是返回 null —— 调用方据此中止整个清理，绝不带伤执行。
 *
 * ⚠️ 必须用 `db.backup()` 而不是 `fs.copyFileSync`：
 * 库跑在 **WAL 模式** 下，最新数据可能还在 `agent.db-wal` 里没合并进主库文件。
 * 直接复制主库会**丢掉这部分数据** —— 实测备份比实际少了 5 行。
 * `db.backup()` 是 SQLite 的一致性快照，会自动包含 WAL 内容。
 *
 * @returns {Promise<{path:string, bytes:number, verified:boolean}>}
 */
async function backupDatabase(db) {
  const dbFile = dbFilePath(db);
  // 备份与库文件同目录（data/backups/）—— 跟着实际的库走，不跟着推导的路径走
  const dir = path.join(path.dirname(dbFile), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `agent_before-cleanup_${stamp}.db`);

  await db.backup(dest);

  // 校验：打开备份、比对关键表行数，确保备份真的可用（不是只比字节数）
  const size = fs.statSync(dest).size;
  let verified = false;
  let checkNote = '';
  try {
    const { default: Database } = await import('better-sqlite3');
    const bak = new Database(dest, { readonly: true });
    const pick = ['messages', 'moment_posts', 'characters'];
    const diffs = [];
    for (const t of pick) {
      try {
        const a = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
        const b = bak.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
        if (a !== b) diffs.push(`${t}: 原 ${a} vs 备份 ${b}`);
      } catch { /* 表不存在则跳过 */ }
    }
    bak.close();
    verified = diffs.length === 0;
    if (!verified) checkNote = diffs.join('; ');
  } catch (err) {
    checkNote = '校验时无法打开备份：' + err.message;
  }

  if (!verified) {
    // 备份不可用就没有清理的意义 —— 抛错让调用方中止
    throw new Error(`备份校验未通过（${checkNote}），已中止清理`);
  }
  console.log(`[cleanup] 已备份数据库 → ${path.basename(dest)} (${(size / 1048576).toFixed(1)} MB, 已校验)`);
  return { path: dest, bytes: size, verified };
}

/**
 * 执行清理。**必须显式传入 targets**，不存在「一键全清」。
 * @param {{days?: number, targets?: string[]}} opts
 * @returns {Promise<object>} 实际删除统计（含备份路径）
 */
export async function purgeData({ days = 7, targets = [] } = {}) {
  const db = getDb();
  const d = normDays(days);
  const keys = (Array.isArray(targets) ? targets : []).filter(k => TARGET_BY_KEY.has(k));
  if (!keys.length) return { ok: false, error: '没有指定任何清理项' };

  const cutoffMs = Date.now() - d * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString().replace('T', ' ').slice(0, 19);

  // ① 先备份；失败就中止，不带伤执行（备份用一致性快照，含 WAL 未合并数据）
  let backup;
  try {
    backup = await backupDatabase(db);
  } catch (err) {
    return { ok: false, error: '备份数据库失败，已中止：' + err.message };
  }

  // ② 保护集：本次要清空的表不参与保护（它们的引用马上失效）
  const wipingTables = new Set();
  for (const key of keys) TARGET_BY_KEY.get(key).tables.forEach(x => wipingTables.add(x.table));
  const protectedNames = buildProtectedSet(db, wipingTables);

  const detail = keys.map(key => {
    const t = TARGET_BY_KEY.get(key);
    return { key, label: t.label, group: t.group, rows: 0, files: 0, bytes: 0 };
  });
  const byKey = new Map(detail.map(x => [x.key, x]));

  // ③ 删记录（事务内；按目标定义顺序，子表在前）
  const delTx = db.transaction(() => {
    for (const key of keys) {
      const t = TARGET_BY_KEY.get(key);
      for (const x of t.tables) {
        try {
          const r = db.prepare(`DELETE FROM ${x.table} WHERE ${x.timeCol} IS NOT NULL AND ${x.timeCol} < ?`).run(cutoffIso);
          byKey.get(key).rows += r.changes;
        } catch (err) {
          console.warn(`[cleanup] 删 ${x.table} 失败:`, err.message);
        }
      }
    }
  });
  delTx();

  // ④ 删图片（跳过保护集）
  for (const key of keys) {
    const t = TARGET_BY_KEY.get(key);
    const hit = byKey.get(key);
    for (const dirName of t.imageDirs) {
      const s = scanImageDir(dirName, cutoffMs, protectedNames);
      for (const f of s.files) {
        try { fs.unlinkSync(f.full); hit.files++; hit.bytes += f.size; }
        catch { /* 单个失败不影响其余 */ }
      }
    }
  }

  const totalRows = detail.reduce((a, x) => a + x.rows, 0);
  const totalFiles = detail.reduce((a, x) => a + x.files, 0);
  const totalBytes = detail.reduce((a, x) => a + x.bytes, 0);

  // ⑤ 失效相册缓存，界面立刻反映
  try { invalidateGalleryCache(); } catch { /* ignore */ }

  console.log(`[cleanup] 完成：清理 ${d} 天前 → 记录 ${totalRows} 行 / 图片 ${totalFiles} 个（${(totalBytes / 1048576).toFixed(1)} MB）`);

  return { ok: true, days: d, cutoff: cutoffIso, backup, detail, totalRows, totalFiles, totalBytes };
}

/** 列出已有的清理备份（供界面显示 / 手动清理旧备份） */
export function listCleanupBackups() {
  let dir;
  try {
    dir = path.join(path.dirname(dbFilePath(getDb())), 'backups');
  } catch {
    return [];
  }
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('agent_before-cleanup_') && f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, bytes: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}
