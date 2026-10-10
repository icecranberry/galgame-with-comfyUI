/**
 * mediaService.js — 媒体内容页（传媒 / 数字媒体）的生成引擎
 *
 * ── 这是什么 ──
 *
 * 一个「媒体」是一个内容源（报纸 / 论坛 / 匿名职场社区 / 暗网 …），自带一份生成提示词；
 * 每个媒体下有若干**板块**。用户点「刷新」就抽取一批新帖子铺到瀑布流上。
 *
 * ── 与《邻舍日报》(newspaperService) 的关系 ──
 *
 * 报纸是**单一固定媒体 + 每天一期 + 有注入链路**（世界状态影响全镇、特稿主角当天会被提起）。
 * 本模块是**多媒体 + 按需刷新 + 纯展示**：不注入任何提示词、不影响角色行为，只做内容展示。
 * 配图沿用报纸那套「文字先落库、后台逐张补」的做法（fillPaperImages）。
 *
 * ── 角色怎么参与（用户要求「活跃角色随机在帖子里」）──
 *
 * 两个方向都用：
 *   ① 作为**发帖人**：随机抽 1~2 个活跃角色（排除归档），由 LLM 用其人格与口吻写一条帖，
 *      落库时带 character_id 与头像 —— 且**流量更高**（浏览/点赞按角色影响力放大）。
 *   ② 作为**被讨论对象**：其余帖子由匿名 NPC 发，内容里会提到这些角色（八卦/见闻）。
 * 为避免靠名字匹配出错，发帖人**按下标指派**：提示词里明确「第 N 条由『某某』本人发布」。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb, getSystemRules, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { saveBase64Image, deleteImageFileByUrl, getImageDir } from './imagePaths.js';
import { invalidateGalleryCache } from './galleryCache.js';
import { recordCompletedImageTask } from './imageTaskRecorder.js';
import { broadcast } from './unifiedStreamBus.js';
import { config } from '../config.js';
import { extractFirstJson, repairJson } from './eventGenerator.js';
import { buildCharacterPersona } from './characterPersona.js';
import { charArtistOverrideWithFallback } from './characterImageOpts.js';

/** 一次刷新默认抽多少条 */
export const DEFAULT_BATCH_SIZE = 6;
export const MAX_BATCH_SIZE = 12;

/**
 * 自动抓帖频率档位（分钟）。前端滑块直接用这份表，后端据此校验。
 *
 * 为什么档位化而不是连续滑块：间隔跨度从「关闭」到 12 小时，
 * 连续拖动既拖不准也说不清（要拖到 37 分钟还是 40 分钟？）；
 * 档位还能顺手把生成成本写在标签上，用户一眼知道自己在选什么。
 */
export const MEDIA_AUTO_STEPS = [
  { minutes: 0,   label: '关闭',    hint: '不自动抓帖，只有你点「刷新」时才生成。' },
  { minutes: 720, label: '12 小时', hint: '一天两批，几乎不占算力。' },
  { minutes: 240, label: '4 小时',  hint: '一天六批，内容慢慢积累。' },
  { minutes: 120, label: '2 小时',  hint: '一天十几批。' },
  { minutes: 60,  label: '1 小时',  hint: '每小时一批（每批 3 条）。' },
  { minutes: 20,  label: '20 分钟', hint: '默认节奏，社区一直有新鲜感。' },
  { minutes: 10,  label: '10 分钟', hint: '比较频繁，LLM 消耗明显上升。' },
  { minutes: 5,   label: '5 分钟',  hint: '最频繁档；每批 3 条要调一次 LLM，烧 token 很快。' },
];
/** 校验用：允许的分钟值集合 */
export const ALLOWED_MEDIA_AUTO_MINUTES = MEDIA_AUTO_STEPS.map(s => s.minutes);
/**
 * 自动补充：到点后给随机一个媒体补一小批。
 * **间隔不再写死** —— 由 `config.features.mediaAutoMinutes` 决定（0 = 关闭）。
 * 调度器 1 分钟 tick 一次，这里做「到点才动手」的节流。
 */
export const AUTO_BATCH_SIZE = 3;

/** 当前生效的自动间隔（毫秒）；0 表示关闭自动 */
function autoIntervalMs() {
  const minutes = Number(config.features.mediaAutoMinutes ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.max(5, minutes) * 60 * 1000;
}

// ── 并发守卫 ──
let generating = null;          // 当前批次生成任务
let fillingImages = false;      // 配图补印进行中
let lastAutoAt = 0;             // 上次自动补充时间

function safeParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function clampText(v, max) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : '';
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// ══════════════════════════════════════════
// 媒体 / 板块 CRUD
// ══════════════════════════════════════════

/** 全部媒体（含板块数量与帖子数），供设置页与标签页用 */
export function listOutlets({ onlyEnabled = false } = {}) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT o.*,
      (SELECT COUNT(*) FROM media_boards b WHERE b.outlet_id = o.id) AS board_count,
      (SELECT COUNT(*) FROM media_posts p WHERE p.outlet_id = o.id) AS post_count
    FROM media_outlets o
    ${onlyEnabled ? 'WHERE o.enabled = 1' : ''}
    ORDER BY o.sort_order, o.id
  `).all();
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    prompt: r.prompt,
    icon: r.icon,
    // 形态：feed=帖子流 / weekly=周刊 / poster=海报（前端据此选渲染组件）
    layout: r.layout || 'feed',
    sort_order: r.sort_order,
    enabled: !!r.enabled,
    board_count: r.board_count,
    post_count: r.post_count,
  }));
}

export function getOutlet(id) {
  const r = getDb().prepare('SELECT * FROM media_outlets WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, enabled: !!r.enabled, layout: r.layout || 'feed' };
}

export function createOutlet({ name, tagline = '', prompt = '', icon = '' }) {
  const nm = clampText(name, 24);
  if (!nm) throw Object.assign(new Error('媒体名称不能为空'), { statusCode: 400 });
  if (!clampText(prompt, 8000)) throw Object.assign(new Error('媒体提示词不能为空'), { statusCode: 400 });
  const db = getDb();
  const dup = db.prepare('SELECT id FROM media_outlets WHERE name = ?').get(nm);
  if (dup) throw Object.assign(new Error('同名媒体已存在'), { statusCode: 400 });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM media_outlets').get().m;
  const r = db.prepare(`
    INSERT INTO media_outlets (name, tagline, prompt, icon, sort_order, enabled)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(nm, clampText(tagline, 60), clampText(prompt, 8000), clampText(icon, 8), maxOrder + 1);
  return getOutlet(Number(r.lastInsertRowid));
}

export function updateOutlet(id, patch = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM media_outlets WHERE id = ?').get(id);
  if (!cur) return null;
  const name = patch.name !== undefined ? clampText(patch.name, 24) : cur.name;
  if (!name) throw Object.assign(new Error('媒体名称不能为空'), { statusCode: 400 });
  if (patch.name !== undefined) {
    const dup = db.prepare('SELECT id FROM media_outlets WHERE name = ? AND id != ?').get(name, id);
    if (dup) throw Object.assign(new Error('同名媒体已存在'), { statusCode: 400 });
  }
  db.prepare(`
    UPDATE media_outlets SET name = ?, tagline = ?, prompt = ?, icon = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    patch.tagline !== undefined ? clampText(patch.tagline, 60) : cur.tagline,
    patch.prompt !== undefined ? clampText(patch.prompt, 8000) : cur.prompt,
    patch.icon !== undefined ? clampText(patch.icon, 8) : cur.icon,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : cur.enabled,
    id,
  );
  return getOutlet(id);
}

export function deleteOutlet(id) {
  // 帖子与板块靠 ON DELETE CASCADE 一并清掉；图片文件留着不删（可能被别处引用，且删文件不可逆）
  return getDb().prepare('DELETE FROM media_outlets WHERE id = ?').run(id).changes > 0;
}

export function listBoards(outletId) {
  const rows = getDb().prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM media_posts p WHERE p.board_id = b.id) AS post_count
    FROM media_boards b WHERE b.outlet_id = ? ORDER BY b.sort_order, b.id
  `).all(outletId);
  return rows.map(r => ({ id: r.id, outlet_id: r.outlet_id, name: r.name, desc: r.desc, sort_order: r.sort_order, post_count: r.post_count }));
}

export function createBoard(outletId, { name, desc = '' }) {
  const nm = clampText(name, 16);
  if (!nm) throw Object.assign(new Error('板块名称不能为空'), { statusCode: 400 });
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM media_outlets WHERE id = ?').get(outletId)) {
    throw Object.assign(new Error('媒体不存在'), { statusCode: 404 });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM media_boards WHERE outlet_id = ?').get(outletId).m;
  const r = db.prepare('INSERT INTO media_boards (outlet_id, name, desc, sort_order) VALUES (?, ?, ?, ?)')
    .run(outletId, nm, clampText(desc, 60), maxOrder + 1);
  return listBoards(outletId).find(b => b.id === Number(r.lastInsertRowid)) || null;
}

export function updateBoard(boardId, { name, desc }) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM media_boards WHERE id = ?').get(boardId);
  if (!cur) return null;
  db.prepare('UPDATE media_boards SET name = ?, desc = ? WHERE id = ?')
    .run(name !== undefined ? (clampText(name, 16) || cur.name) : cur.name,
         desc !== undefined ? clampText(desc, 60) : cur.desc, boardId);
  return listBoards(cur.outlet_id).find(b => b.id === Number(boardId)) || null;
}

export function deleteBoard(boardId) {
  // 该板块下的帖子不删，只把 board_id 置空（避免用户删个板块连带丢内容）
  const db = getDb();
  const cur = db.prepare('SELECT id FROM media_boards WHERE id = ?').get(boardId);
  if (!cur) return false;
  db.prepare('UPDATE media_posts SET board_id = NULL WHERE board_id = ?').run(boardId);
  return db.prepare('DELETE FROM media_boards WHERE id = ?').run(boardId).changes > 0;
}

// ══════════════════════════════════════════
// 帖子查询
// ══════════════════════════════════════════

function mapPostRow(r) {
  return {
    id: r.id,
    outlet_id: r.outlet_id,
    outlet_name: r.outlet_name || null,
    board_id: r.board_id,
    board_name: r.board_name || null,
    title: r.title,
    content: r.content,
    tags: safeParse(r.tags_json, []) || [],
    author_type: r.author_type,
    character_id: r.character_id,
    author_name: r.author_name,
    author_avatar: r.author_avatar,
    likes: r.likes,
    views: r.views,
    comments: safeParse(r.comments_json, []) || [],
    image: r.image,
    // 周刊/海报的结构化正文（feed 形态为 null）
    payload: safeParse(r.payload_json, null),
    layout: r.layout || 'feed',
    created_at: r.created_at,
  };
}

/** 分页取帖子（跨媒体，或指定媒体/板块） */
/**
 * 分页取帖子。
 * @param {object} opts
 * @param {'digital'|'social'|null} [opts.category] - 分类过滤：
 *   `digital` = 数字报刊（layout 为 weekly/poster）；`social` = 社交平台（layout 为 feed）。
 *   分类由 layout 推导，不额外存字段 —— 加新媒体时按形态自动归类，不用手动维护。
 *   注意「传统报纸」不走这里（《邻舍日报》是独立的整版报纸，不存 media_posts）。
 */
export function listPosts({ outletId = null, boardId = null, category = null, limit = 40, offset = 0 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (outletId) { where.push('p.outlet_id = ?'); params.push(outletId); }
  if (boardId) { where.push('p.board_id = ?'); params.push(boardId); }
  if (category === 'digital') {
    // 门户是周刊/海报的升级形态（两层生成），同样属于「数字报刊」
    where.push(`o.layout IN ('weekly','poster','portal')`);
  } else if (category === 'social') {
    // 注意：layout 有 DEFAULT 'feed'，但老库可能为 NULL，一并当 feed 处理
    where.push(`(o.layout IS NULL OR o.layout = 'feed')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // ★ 分类过滤引用 o.layout，所以**计数查询也必须带上同一套 JOIN**。
  //   踩过的坑：计数只写 `FROM media_posts p` → SQLite 报 `no such column: o.layout`
  //   → 整个 listPosts() 抛错 → 前端 catch 后把列表置空 → 分类标签有数字但正文区
  //   显示「还没有任何帖子」。两个查询共用 fromSql，从结构上杜绝再次跑偏。
  //   LEFT JOIN 对 outlet/board 都是 1:1（外键指向唯一主键），COUNT 不会重复计数。
  const fromSql = `
    FROM media_posts p
    LEFT JOIN media_outlets o ON o.id = p.outlet_id
    LEFT JOIN media_boards  b ON b.id = p.board_id
  `;

  const total = db.prepare(`SELECT COUNT(*) AS n ${fromSql} ${whereSql}`).get(...params).n;
  const rows = db.prepare(`
    SELECT p.*, o.name AS outlet_name, o.layout AS layout, b.name AS board_name
    ${fromSql}
    ${whereSql}
    ORDER BY p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Math.max(1, limit), 100), Math.max(0, offset));

  return { posts: rows.map(mapPostRow), total };
}

/** 待补配图的帖子（供后台补印） */
export function listPostsNeedingImage(limit = 8) {
  // ⚠ 必须排除门户：门户由 fillPortalImages 负责逐块补图，而门户帖的 image_prompt 存的是
  //   「第一块的头图提示词」，被这里捞到会**额外多生一张重复的主图**（正是两层设计要避免的浪费）。
  return getDb().prepare(`
    SELECT p.id, p.image_prompt, p.character_id FROM media_posts p
    LEFT JOIN media_outlets o ON o.id = p.outlet_id
    WHERE p.image_status = 'pending' AND p.image_prompt IS NOT NULL AND p.image_prompt != ''
      AND COALESCE(o.layout, 'feed') != 'portal'
    ORDER BY p.id DESC LIMIT ?
  `).all(limit);
}

/**
 * 写帖子配图状态。
 *
 * **未传 url 时不动 image 字段** —— 原实现用 `url = null` 当默认值，
 * 「置为 generating」这种不带 url 的调用会把已有图片清空，是个隐患。
 * @param {number} postId
 * @param {{url?: string|null, status?: string, error?: string|null}} patch
 */
export function updatePostImage(postId, { url, status, error = null } = {}) {
  const db = getDb();
  if (url === undefined) {
    // 只改状态，保留已有图片
    db.prepare('UPDATE media_posts SET image_status = ?, image_error = ? WHERE id = ?')
      .run(status, error, postId);
    return;
  }
  db.prepare('UPDATE media_posts SET image = ?, image_status = ?, image_error = ? WHERE id = ?')
    .run(url, status, error, postId);
}

/**
 * 原子抢占一条待配图的帖子（CAS）。
 * 只有当前仍是 `pending` 的才抢得到 —— 防止同一帖子被两条补图路径同时捞走、各生成一张，
 * 后者覆盖前者、前者的文件变成永远没人引用的孤儿。
 * @returns {boolean} 是否抢到（false = 别人已在处理或已完成，应跳过）
 */
function claimPostForImage(postId) {
  const r = getDb().prepare(`
    UPDATE media_posts SET image_status = 'generating', image_error = NULL
    WHERE id = ? AND image_status = 'pending' AND (image IS NULL OR image = '')
  `).run(postId);
  return r.changes === 1;
}

// ══════════════════════════════════════════
// 生成
// ══════════════════════════════════════════

/**
 * 抽参与本次生成的活跃角色（排除归档：归档 = 不参与任何主动行为）。
 * 返回带人格与头像的行，供提示词与落库使用。
 */
export function pickActiveCharacters(count = 2) {
  const n = Math.max(0, Math.min(3, count));
  if (!n) return [];
  return getDb().prepare(`
    SELECT id, display_name, avatar_path, short_prompt, base_prompt, loras, custom_workflow, artist_override
    FROM characters
    WHERE COALESCE(archived, 0) = 0
    ORDER BY RANDOM() LIMIT ?
  `).all(n);
}

/** 提示词：让 LLM 产出 { posts: [...] } */
function buildFormatPrompt(outlet, boards, authors) {
  const boardNames = boards.map(b => b.name);
  const boardRule = boardNames.length
    ? `"board" 必须从这个媒体的板块里选：${boardNames.map(x => `「${x}」`).join('、')}`
    : `"board" 填 ""（本媒体还没有板块）`;

  const authorRule = authors.length
    ? authors.map((a, i) => `第 ${i + 1} 条帖子的作者必须是「${a.display_name}」本人`).join('；')
      + `。这几条要用 Ta 自己的口吻与身份写，author 字段填其名字「对应角色名」，不要加任何后缀；`
      + `其余帖子的 author 填一个符合该媒体气质的匿名用户名（每个都不同）。`
    : `author 填一个符合该媒体气质的匿名用户名（每个都不同）。`;

  const imageRules = String(getGlobalRule('image_prompt')?.rule_content || '').trim();

  return `请严格按照以下 JSON 格式输出，不要输出任何解释或 JSON 以外的文字：

{
  "posts": [
    {
      "board": "板块名（${boardRule}）",
      "title": "帖子标题（≤30字，符合该媒体的标题风格）",
      "content": "帖子正文（60~300字，有具体细节，符合该媒体的文体）",
      "tags": ["标签1", "标签2"],
      "author": "发布者名（见下方作者要求）",
      "likes": 数字（点赞数，见下方热度要求）,
      "views": 数字（浏览数，通常为点赞数的 8~25 倍）,
      "comments": [
        { "author": "评论者名", "content": "评论内容（20~80字）" }
      ],
      "image_prompt": "英文插画描述（一段完整英文：写清画面主体、动作、地点、光线；不出现任何文字、边框或水印）"
    }
  ]
}

字段要求：
- ${boardRule}。
- 作者要求：${authorRule}
- 同一批次内每条帖子的**板块、主题、作者都必须明显不同**，禁止同质化与模板化。
- "likes"/"views"：普通帖子点赞 20~3000；由上面点名的那几位角色本人发的帖子，因为有关注度，点赞要给到 800~12000。views 相应放大。
- "comments"：每条帖子 1~4 条评论，观点要有支持、反对、质疑、调侃、歪楼等不同声音，禁止清一色附和、禁止"同上/+1"这类无信息量回复。
- 所有 title/content/comments 用中文；所有 image_prompt 用英文。
- 内容必须符合 <world_setting> 的时代感与生活细节，不出现世界观之外的事物。${imageRules ? `\n\n生图规则（所有 image_prompt 必须遵守）：\n${imageRules}` : ''}`;
}

/** 提示词：本次素材（世界观由 stage 层注入，这里给板块与角色资料） */
function buildMaterialsPrompt(outlet, boards, authors, count) {
  const boardList = boards.length
    ? boards.map(b => `- ${b.name}${b.desc ? `：${b.desc}` : ''}`).join('\n')
    : '（本媒体暂无板块，全部帖子 board 填空字符串）';

  const authorBlock = authors.length
    ? `\n【本次由以下角色本人发帖（按顺序对应第 1~${authors.length} 条）】\n`
      + authors.map((a, i) => `${i + 1}. ${a.display_name}\n${buildCharacterPersona(a, { variant: 'short', person: a.display_name }) || '（无补充资料）'}`).join('\n\n')
    : '';

  return `本次要为「${outlet.name}」生成 ${count} 条新帖子。
${outlet.tagline ? `媒体定位：${outlet.tagline}\n` : ''}
【本媒体的板块】
${boardList}
${authorBlock}

请开始生成。`;
}

/**
 * 规整 LLM 输出 → 可落库的帖子数组。不合法的条目丢弃；一条都没有则抛错。
 * @param {object} raw - LLM 返回的对象
 * @param {Array} boards - 该媒体的板块（用于把 board 名映射成 id）
 * @param {Array} authors - 本次指派的角色（按下标对应）
 */
export function normalizeMediaDraft(raw, boards, authors = []) {
  const list = Array.isArray(raw?.posts) ? raw.posts : null;
  if (!list) throw new Error('LLM 输出缺少 posts 数组');

  const boardByName = new Map(boards.map(b => [b.name, b]));
  const out = [];

  list.forEach((item, i) => {
    const title = clampText(item?.title, 60);
    const content = clampText(item?.content, 1200);
    if (!title || !content) return;   // 标题/正文缺一不可

    const boardName = clampText(item?.board, 16);
    const board = boardByName.get(boardName) || null;

    // 按下标指派角色作者：绝不靠名字匹配（LLM 会给名字加后缀、改大小写）
    const author = authors[i] || null;

    const likesRaw = Number(item?.likes);
    const viewsRaw = Number(item?.views);
    const likes = Number.isFinite(likesRaw) && likesRaw >= 0 ? Math.floor(likesRaw) : randInt(20, 3000);

    const comments = (Array.isArray(item?.comments) ? item.comments : [])
      .map(c => ({ author: clampText(c?.author, 24) || '匿名', content: clampText(c?.content, 200) }))
      .filter(c => c.content)
      .slice(0, 6);

    out.push({
      board_id: board?.id ?? null,
      title,
      content,
      tags: (Array.isArray(item?.tags) ? item.tags : []).map(t => clampText(t, 12)).filter(Boolean).slice(0, 5),
      author_type: author ? 'character' : 'anonymous',
      character_id: author ? author.id : null,
      author_name: author ? author.display_name : (clampText(item?.author, 24) || '匿名用户'),
      author_avatar: author ? (author.avatar_path || null) : null,
      likes,
      views: Number.isFinite(viewsRaw) && viewsRaw > 0 ? Math.floor(viewsRaw) : likes * randInt(8, 25),
      comments,
      image_prompt: clampText(item?.image_prompt ?? item?.imagePrompt, 1200),
    });
  });

  if (!out.length) throw new Error('没有可用的帖子');
  return out;
}

/**
 * 生成一批帖子并落库（文字先上线，配图随后由 fillPendingImages 补）。
 * @param {object} opts
 * @param {number} [opts.outletId] - 不传则随机挑一个启用的媒体
 * @param {number} [opts.count] - 条数
 * @param {boolean} [opts.withCharacters] - 是否让活跃角色参与发帖（默认 true）
 * @returns {Promise<{outletId:number, batchId:string, inserted:number}>}
 */
// ══════════════════════════════════════════
// 周刊形态（狸狸通讯社）
// ══════════════════════════════════════════

/** 周刊的输出格式约束（结构对齐游戏内《狸狸周刊》的实际版式） */
function buildWeeklyFormatPrompt() {
  const imageRules = String(getGlobalRule('image_prompt')?.rule_content || '').trim();
  return `请严格按照以下 JSON 格式输出这一期周刊，不要输出任何解释或 JSON 以外的文字：

{
  "volume": 数字（本期卷号，比上一期大 1；我会告诉你上一期是几卷）,
  "kind": "刊别（特急刊 / 增刊 / 号外 / 常规刊 三选一）",
  "headline": "大标题（震撼体，把最劲爆的事写进去，≤40字）",
  "intro": "引言（一句话勾人，以《狸狸周刊》扒一扒……开头）",
  "preface": ["开场白第1段", "开场白第2段", "开场白第3段（可选）"],
  "columns": [
    {
      "name": "栏目名（如「震撼首发：一手信息直播间」）",
      "items": [
        {
          "asker": "提问人的网名（不带@）",
          "q": "提问内容（口语、带情绪、接地气）",
          "answers": [
            { "speaker": "说话的角色名", "text": "这一句的内容（可以互相吐槽、接梗、歪楼）" }
          ]
        }
      ]
    }
  ],
  "tail": [
    {
      "kind": "rank",
      "title": "榜单标题（如「幻月游戏谒者愿力排名」）",
      "notice": "榜单前的声明（可空字符串）",
      "rows": [
        { "rank": "第一名", "mask": "面具名", "change": "▲0 / NEW / ▼1 / ▼2", "bearer": "持有者" }
      ]
    },
    {
      "kind": "threads",
      "title": "跟帖区标题",
      "stat": "🤍 数字 💬 数字",
      "replies": [ { "author": "网名", "text": "跟帖内容" } ]
    }
  ],
  "credits": { "interview": "采访者名", "editor": "编辑名" },
  "image_prompt": "英文插画描述（本期头版大图）"
}

字段要求：
- "preface"：2~3 段，先安抚读者情绪（排比句），再交代本期背景，最后用「那么，一如既往，《狸狸周刊》快问快答Time，冲冲冲！」收尾。
- "columns"：**2~4 个栏目**，每个栏目 **3~5 组问答**，栏目主题彼此必须明显不同。
  每个 Q 的 "answers" 要有 **2~5 个嘉宾分段作答**，这是本刊的笑点所在（互相吐槽、接梗、歪楼、突然@别人）。
- "tail"：从 rank / threads 里挑 **1~2 个**输出（可以都出）。
  rank 要 5~8 行，change 用 ▲▼NEW 表示名次变化，可以出现「？？」表示未公开。
  threads 的 "replies" 要 5~10 条，有队形刷屏、有人破坏队形、有官方号插入温馨提示、有歪楼。
- "credits"：记者名/编辑名都要带「狸」字的刊物风格。
- 所有文字字段用中文；image_prompt 用英文。
- 内容必须符合 <world_setting>。${imageRules ? `\n\n生图规则（image_prompt 必须遵守）：\n${imageRules}` : ''}`;
}

/**
 * 生成一期周刊（落库为 1 条 media_post，结构化数据存 payload_json）。
 * @param {object} outlet
 */
async function generateWeeklyIssue(outlet) {
  const db = getDb();
  const worldSetting = getWorldSetting();

  // 上一期的卷号（本期 = 上期 + 1；首次出刊从 Vol.1 起）
  const prev = db.prepare(`
    SELECT payload_json FROM media_posts
    WHERE outlet_id = ? AND payload_json IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(outlet.id);
  const prevVolume = Number(safeParse(prev?.payload_json, null)?.volume) || 0;

  const msgs = [
    { role: 'system', content: [getSystemRules({ roleplay: false }), worldSetting].filter(Boolean).join('\n\n') },
    { role: 'system', content: outlet.prompt },
    { role: 'system', content: buildWeeklyFormatPrompt() },
    { role: 'user', content: `请出《狸狸周刊》新的一期。上一期是 Vol.${prevVolume || '（尚无，本期为 Vol.1）'}，本期卷号用 ${prevVolume + 1}。\n\n必须是全新一期，不得重复往期的头条与栏目内容。` },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0.9, max_tokens: 8000,
    response_format: { type: 'json_object' }, label: `media:${outlet.name}`,
  });
  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('LLM 未返回 JSON');
  const draft = JSON.parse(repairJson(jsonStr));
  const p = normalizeWeeklyDraft(draft, prevVolume);

  // content 存一份纯文本（便于搜索与列表摘要），结构存 payload
  const plain = [
    `Vol.${p.volume}【${p.kind}】${p.headline}`,
    p.intro,
    ...p.preface,
    ...p.columns.flatMap(c => [c.name, ...c.items.flatMap(it => [`Q：${it.q}`, ...it.answers.map(a => `${a.speaker}：${a.text}`)])]),
  ].filter(Boolean).join('\n').slice(0, 4000);

  const batchId = `mw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const r = db.prepare(`
    INSERT INTO media_posts (outlet_id, board_id, batch_id, title, content, tags_json,
      author_type, author_name, likes, views, comments_json, image_prompt, payload_json, image_status)
    VALUES (?, NULL, ?, ?, ?, ?, 'anonymous', ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    outlet.id, batchId,
    `Vol.${p.volume}【${p.kind}】${p.headline}`,
    plain,
    JSON.stringify([p.kind, '狸狸周刊']),
    `狸狸周刊编辑部`,
    p.views, p.views * randInt(8, 20), JSON.stringify([]),
    p.image_prompt, JSON.stringify(p),
  );
  console.log(`[media] 《狸狸周刊》Vol.${p.volume}【${p.kind}】出版（${p.columns.length} 栏目）`);
  broadcast('media_new_posts', { outletId: outlet.id, count: 1 });
  fillPendingImages(1).catch(err => console.error('[media] 本期刊头补图失败:', err.message));
  return { outletId: outlet.id, outletName: outlet.name, batchId, inserted: 1, postId: Number(r.lastInsertRowid) };
}

/**
 * 规整周刊草稿（纯函数，便于测试）。
 * @param {object} raw - LLM 输出
 * @param {number} prevVolume - 上一期卷号（用于兜底）
 */
export function normalizeWeeklyDraft(raw, prevVolume = 0) {
  if (!raw || typeof raw !== 'object') throw new Error('周刊草稿不是对象');

  const preface = (Array.isArray(raw.preface) ? raw.preface : [])
    .map(x => clampText(x, 800)).filter(Boolean).slice(0, 4);

  const columns = (Array.isArray(raw.columns) ? raw.columns : [])
    .map(c => ({
      name: clampText(c?.name, 60),
      items: (Array.isArray(c?.items) ? c.items : []).map(it => ({
        asker: clampText(it?.asker, 24),
        q: clampText(it?.q, 400),
        answers: (Array.isArray(it?.answers) ? it.answers : [])
          .map(a => ({ speaker: clampText(a?.speaker, 24) || '记者', text: clampText(a?.text, 500) }))
          .filter(a => a.text).slice(0, 8),
      })).filter(it => it.q && it.answers.length).slice(0, 6),
    }))
    .filter(c => c.name && c.items.length).slice(0, 5);
  if (!columns.length) throw new Error('周刊没有有效栏目');

  const tail = (Array.isArray(raw.tail) ? raw.tail : []).map(t => {
    const kind = t?.kind === 'rank' ? 'rank' : (t?.kind === 'threads' ? 'threads' : null);
    if (!kind) return null;
    if (kind === 'rank') {
      const rows = (Array.isArray(t.rows) ? t.rows : []).map(x => ({
        rank: clampText(x?.rank, 12), mask: clampText(x?.mask, 24),
        change: clampText(x?.change, 8), bearer: clampText(x?.bearer, 24),
      })).filter(x => x.rank || x.mask).slice(0, 10);
      if (!rows.length) return null;
      return { kind, title: clampText(t.title, 40) || '榜单', notice: clampText(t.notice, 200), rows };
    }
    const replies = (Array.isArray(t.replies) ? t.replies : []).map(x => ({
      author: clampText(x?.author, 30) || '网友', text: clampText(x?.text, 300),
    })).filter(x => x.text).slice(0, 14);
    if (!replies.length) return null;
    return { kind, title: clampText(t.title, 40) || '跟帖', stat: clampText(t.stat, 30), replies };
  }).filter(Boolean).slice(0, 3);

  const headline = clampText(raw.headline, 120);
  if (!headline) throw new Error('周刊缺少大标题');

  const volumeRaw = Number(raw.volume);
  const volume = Number.isFinite(volumeRaw) && volumeRaw > 0 ? Math.floor(volumeRaw) : (prevVolume + 1);

  return {
    volume,
    kind: clampText(raw.kind, 10) || '常规刊',
    headline,
    intro: clampText(raw.intro, 300),
    preface,
    columns,
    tail,
    credits: {
      interview: clampText(raw.credits?.interview, 24),
      editor: clampText(raw.credits?.editor, 24),
    },
    image_prompt: clampText(raw.image_prompt, 1200),
    views: randInt(8000, 60000),
  };
}

// ══════════════════════════════════════════
// 海报形态（狸狸八卦）
// ══════════════════════════════════════════

/** 海报的输出格式约束（结构对齐游戏内《狸狸八卦》的海报版式） */
function buildPosterFormatPrompt() {
  const imageRules = String(getGlobalRule('image_prompt')?.rule_content || '').trim();
  return `请严格按照以下 JSON 格式输出这一张海报，不要输出任何解释或 JSON 以外的文字：

{
  "issueNo": 数字（本期编号，接上一期 +1）,
  "hotline": "热点速报条（一行，把本期最大爆点喊出来）",
  "bigTitle": "大标题（4~6字，押韵或玩梗，是刊物的固定栏名风格）",
  "bubbles": ["爆点气泡1（4~8字，如「小鸟胃？大胃袋！」）", "爆点气泡2", "爆点气泡3（可选）"],
  "caption": ["旁白第1行", "旁白第2行", "旁白第3行"],
  "panels": [
    { "label": "小图标签（如「开拓者砂金抢拍杀红眼」）", "image_prompt": "英文：这张小图的画面描述" }
  ],
  "credits": { "reporter": "记者名", "editor": "编辑名" },
  "image_prompt": "英文：主图（本期主角被拍到的那个瞬间）"
}

字段要求：
- "hotline"：一行，感叹号拉满，把最大的瓜喊出来。
- "bigTitle"：4~6 字，要够夸张够梗（这是刊物固定栏名，每期风格一致）。
- "bubbles"：**2~3 个**，每个 4~8 字，是整张海报最抢眼的部分（会做成爆炸贴纸效果）。
- "caption"：**3~5 行**，每行一句、短促有力，交代事件来龙去脉（谁被拍到、在哪、发生了什么、什么反应）。
- "panels"：**2~3 个**小图，每个配一行图注式标签。
- "credits"：记者名要带「狸」字。
- 所有文字字段用中文；image_prompt 用英文。
- 内容必须符合 <world_setting>，但要用**化名或外号**称呼当事人（保持小报那种「不点名但大家都知道是谁」的调调）。
- 严禁重复往期的瓜；每期必须是新瓜。${imageRules ? `\n\n生图规则（image_prompt 必须遵守）：\n${imageRules}` : ''}`;
}

/** 生成一张海报（落库为 1 条 media_post；主图走 image，小图存在 payload 里） */
async function generatePosterIssue(outlet) {
  const db = getDb();
  const worldSetting = getWorldSetting();

  // 上一期的编号
  const prev = db.prepare(`
    SELECT payload_json FROM media_posts
    WHERE outlet_id = ? AND payload_json IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(outlet.id);
  const prevNo = Number(safeParse(prev?.payload_json, null)?.issueNo) || 0;

  const msgs = [
    { role: 'system', content: [getSystemRules({ roleplay: false }), worldSetting].filter(Boolean).join('\n\n') },
    { role: 'system', content: outlet.prompt },
    { role: 'system', content: buildPosterFormatPrompt() },
    { role: 'user', content: `请出《狸狸八卦》新的一期海报。上一期编号是 ${prevNo || '（尚无，本期为 01）'}，本期编号用 ${prevNo + 1}。\n\n必须是全新的瓜，不得重复往期。` },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0.95, max_tokens: 3000,
    response_format: { type: 'json_object' }, label: `media:${outlet.name}`,
  });
  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('LLM 未返回 JSON');
  const p = normalizePosterDraft(JSON.parse(repairJson(jsonStr)), prevNo);

  const batchId = `mp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const r = db.prepare(`
    INSERT INTO media_posts (outlet_id, board_id, batch_id, title, content, tags_json,
      author_type, author_name, likes, views, comments_json, image_prompt, payload_json, image_status)
    VALUES (?, NULL, ?, ?, ?, ?, 'anonymous', ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    outlet.id, batchId,
    `【${String(p.issueNo).padStart(2, '0')}】${p.bubbles[0] || p.bigTitle}`,
    [p.hotline, ...p.caption].filter(Boolean).join('\n').slice(0, 2000),
    JSON.stringify(['狸狸八卦', '海报']),
    `狸狸八卦编辑部`,
    p.views, p.views * randInt(8, 20), JSON.stringify([]),
    p.image_prompt, JSON.stringify(p),
  );
  console.log(`[media] 《狸狸八卦》第 ${p.issueNo} 期海报发布（${p.bubbles.length} 气泡 / ${p.panels.length} 小图）`);
  broadcast('media_new_posts', { outletId: outlet.id, count: 1 });
  // 先补主图；小图由 fillPendingImages 的 poster 分支继续补
  fillPendingImages(1).catch(err => console.error('[media] 本期海报补图失败:', err.message));
  return { outletId: outlet.id, outletName: outlet.name, batchId, inserted: 1, postId: Number(r.lastInsertRowid) };
}

/** 规整海报草稿（纯函数） */
export function normalizePosterDraft(raw, prevNo = 0) {
  if (!raw || typeof raw !== 'object') throw new Error('海报草稿不是对象');

  const bubbles = (Array.isArray(raw.bubbles) ? raw.bubbles : [])
    .map(x => clampText(x, 24)).filter(Boolean).slice(0, 4);
  const caption = (Array.isArray(raw.caption) ? raw.caption : [])
    .map(x => clampText(x, 300)).filter(Boolean).slice(0, 6);
  const panels = (Array.isArray(raw.panels) ? raw.panels : [])
    .map(x => ({ label: clampText(x?.label, 40), image_prompt: clampText(x?.image_prompt, 1200), image: null }))
    .filter(x => x.label && x.image_prompt).slice(0, 3);

  const bigTitle = clampText(raw.bigTitle, 12);
  if (!bigTitle) throw new Error('海报缺少大标题');

  const noRaw = Number(raw.issueNo);
  const issueNo = Number.isFinite(noRaw) && noRaw > 0 ? Math.floor(noRaw) : (prevNo + 1);

  return {
    issueNo,
    hotline: clampText(raw.hotline, 200),
    bigTitle,
    bubbles: bubbles.length ? bubbles : [bigTitle],
    caption,
    panels,
    credits: {
      reporter: clampText(raw.credits?.reporter, 24),
      editor: clampText(raw.credits?.editor, 24),
    },
    image_prompt: clampText(raw.image_prompt, 1200),
    views: randInt(5000, 40000),
  };
}

// ═══════════════════════════════════════════════════════════
// 门户（portal）——数字报刊的「两层生成」
// ═══════════════════════════════════════════════════════════
/**
 * 为什么要分两层（设计动机，改之前先读）：
 *
 * 周刊/海报是「一次长 LLM + N 张图」全量产出 —— 周刊的 JSON 有 5600 字符，
 * 出刊要等十几秒到几十秒，配图还要再等；而且横版铺在 1920 屏上两侧各空 520px
 * （`.special-list` 是 max-width:880px 居中单列）。
 *
 * 门户把这个峰拆开：
 *   第 1 层  出刊：1 次**短** LLM，只产骨架（板块名 + 一句导语 + 每板块的生图提示词），
 *           **文字先落库 → 刷新立刻有东西可看**，不必干等配图。
 *   第 1.5 层 图：后台**串行**逐张补，补一张卡片亮一张；负载曲线是平的。
 *           ★ 这批图同时就是板块详情的配图 —— 一图两用，不重复生成。
 *   第 2 层  阅读：点某个板块才开始生成它的正文，落库缓存，二次点开秒开。
 *
 * 「外壳统一、里子各自保持个性」：门户只是个壳，各刊的人设/语气仍由 outlet.prompt 决定；
 * 板块正文用**通用块数组**承载，周刊的 outlet.prompt 会自然产出 qa/rank/replies 块，
 * 狸狸八卦会产出 caption 块 —— 不用为每个刊物各写一套版式。
 */

/** 门户的门户层格式（骨架，故意写得短，产出控制在一千多字符） */
function buildPortalFormatPrompt() {
  const imageRules = String(getGlobalRule('image_prompt')?.rule_content || '').trim();
  return `本期请**只输出门户骨架**（不要写正文内容），严格按以下 JSON 格式，不要输出任何解释或 JSON 以外的文字：

{
  "issue": 数字（本期编号，比上一期大 1；我会告诉你上一期是几号）,
  "title": "本期总标题（震撼体，把本期最劲爆的那件事写进去，≤40字）",
  "lead": "一句话导语（勾人，≤60字）",
  "sections": [
    {
      "key": "板块的英文短标识（如 headline / gossip / column1 / ranking，全小写无空格）",
      "name": "板块名（4~12字，是这一块的小标题）",
      "lead": "这一块的导语（一句话剧透这块讲什么，≤45字）",
      "image_prompt": "英文：这一块的头图画什么（用于配图，也用作点开后的详情配图）"
    }
  ],
  "credits": { "reporter": "记者/撰稿名", "editor": "编辑名" }
}

字段要求：
- "sections"：**4~6 个**，彼此主题明显不同，合起来覆盖本期所有看点。
- 每块的 "lead" 要具体、有信息量，让人想点开看 —— 不要写「详见内文」这类空话。
- 每块的 "image_prompt" 必须独立可画：写清主体、动作、环境、光线；各块画面不要重复。
- 所有中文文字字段用中文；image_prompt 用英文。
- 内容必须符合 <world_setting>。
- **本期必须是全新的**，不得重复往期的标题与看点。${imageRules ? `\n\n生图规则（image_prompt 必须遵守）：\n${imageRules}` : ''}`;
}

/** 板块正文的块格式（第 2 层，点开某块时才生成） */
function buildSectionBodyPrompt(sectionName, sectionLead) {
  return `现在只写「${sectionName}」这**一个**板块的正文（前面已经给读者看过它的导语：${sectionLead || '（无）'}）。

请严格按以下 JSON 格式输出，不要输出任何解释或 JSON 以外的文字：

{
  "blocks": [
    { "type": "p", "text": "一个自然段" },
    { "type": "qa", "asker": "提问人的网名", "q": "问题", "answers": [ { "speaker": "说话人", "text": "这一句" } ] },
    { "type": "rank", "title": "榜单标题", "notice": "可空字符串", "rows": [ { "rank": "第一名", "mask": "面具名", "change": "▲0", "bearer": "持有者" } ] },
    { "type": "replies", "title": "跟帖区标题", "stat": "🤍 数字 💬 数字", "replies": [ { "author": "网名", "text": "跟帖内容" } ] },
    { "type": "caption", "lines": ["短促的一句", "短促的一句"] }
  ]
}

字段要求：
- 按这个板块的**性质**挑块类型用，不要五种全上：
  · 访谈/问答性质 → 多用 "qa"（asker/q/answers 必填，answers 2~5 个嘉宾分段作答，要互相吐槽、接梗、歪楼）
  · 榜单性质 → 用 "rank"（rows 5~8 行）
  · 需要网友反应 → 用 "replies"（replies 5~10 条，有队形刷屏、有人破坏队形、有官方号插话）
  · 八卦/事件叙述 → 用 "caption"（lines 3~5 行，每行短促有力）
  · 交代背景 / 承上启下 → 用 "p"
- **块数 3~8 个**，内容要扎实、具体、有梗，是「值得点开看」的量。
- 沿用你本刊一贯的人称、语气、口癖与署名风格。
- 所有文字用中文。至少含一个 "qa" 或 "caption" 块（保证有可读的对话感）。
- 内容必须符合 <world_setting>，且不得与本期其它板块重复。`;
}

/**
 * 规范化门户骨架（纯函数，便于单测）。
 * 与 normalizeWeeklyDraft / normalizePosterDraft 同口径：容错 + 截断 + 兜底。
 */
export function normalizePortalDraft(raw, prevIssue = 0) {
  if (!raw || typeof raw !== 'object') throw new Error('门户草稿不是对象');

  const title = clampText(raw.title, 80);
  if (!title) throw new Error('门户缺少总标题');

  const seen = new Set();
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((s, i) => {
      const name = clampText(s?.name, 24);
      // key 只留字母数字下划线；缺失/重复就按序号兜底，保证前端 v-for 有稳定 key
      let key = String(s?.key || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
      if (!key || seen.has(key)) key = `s${i + 1}`;
      seen.add(key);
      return {
        key,
        name,
        lead: clampText(s?.lead, 120),
        image_prompt: clampText(s?.image_prompt, 1200),
        image: null,
        body: null,       // 第 2 层：点开时才填
        body_at: null,
      };
    })
    .filter(s => s.name)
    .slice(0, 8);

  if (!sections.length) throw new Error('门户一个板块都没有，模型返回异常');

  const noRaw = Number(raw.issue);
  const issue = Number.isFinite(noRaw) && noRaw > 0 ? Math.floor(noRaw) : (prevIssue + 1);

  return {
    portal: true,       // 前端据此认出这是门户（比按 layout 判断更可靠：老帖的 layout 取自 outlet）
    issue,
    title,
    lead: clampText(raw.lead, 160),
    sections,
    credits: {
      reporter: clampText(raw.credits?.reporter, 24),
      editor: clampText(raw.credits?.editor, 24),
    },
    views: randInt(5000, 40000),
  };
}

/** 该 post 的 payload 是否门户结构 */
function isPortalPayload(payload) {
  return Boolean(payload?.portal) && Array.isArray(payload.sections);
}

/**
 * 生成一期门户（第 1 层）。落库后**立即返回**，配图由 fillPortalImages 在后台串行补。
 * 返回落库的行；正文/配图状态通过 SSE 与轮询带回前端。
 */
async function generatePortalIssue(outlet) {
  const db = getDb();
  const worldSetting = getWorldSetting();

  const prev = db.prepare(`
    SELECT payload_json FROM media_posts
    WHERE outlet_id = ? AND payload_json IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(outlet.id);
  const prevIssue = Number(safeParse(prev?.payload_json, null)?.issue) || 0;

  const msgs = [
    { role: 'system', content: [getSystemRules({ roleplay: false }), worldSetting].filter(Boolean).join('\n\n') },
    { role: 'system', content: outlet.prompt },
    { role: 'system', content: buildPortalFormatPrompt() },
    { role: 'user', content: `请出《${outlet.name}》新的一期。上一期是第 ${prevIssue || '（尚无，本期为第 1 期）'} 期，本期编号用 ${prevIssue + 1}。\n\n只出骨架，不要写正文。必须是全新一期。` },
  ];

  const raw = await chatSync(msgs, {
    // 只产骨架 → max_tokens 压到海报同档，出刊速度是本设计的核心收益，别给大预算
    temperature: 0.9, max_tokens: 2500,
    response_format: { type: 'json_object' }, label: `media:${outlet.name}`,
  });
  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('LLM 未返回 JSON');
  const p = normalizePortalDraft(JSON.parse(repairJson(jsonStr)), prevIssue);

  // content 存一份纯文本（列表摘要 / 搜索用），结构存 payload
  const plain = [
    `第${p.issue}期 ${p.title}`,
    p.lead,
    ...p.sections.map(s => `${s.name}｜${s.lead}`),
  ].filter(Boolean).join('\n').slice(0, 4000);

  const batchId = `mp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const r = db.prepare(`
    INSERT INTO media_posts (outlet_id, board_id, batch_id, title, content, tags_json,
      author_type, author_name, likes, views, comments_json, image_prompt, payload_json, image_status)
    VALUES (?, NULL, ?, ?, ?, ?, 'anonymous', ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    outlet.id, batchId, p.title, plain, JSON.stringify(p.sections.map(s => s.name)),
    outlet.name, randInt(20, 600), p.views, '[]',
    p.sections[0]?.image_prompt || '',
    JSON.stringify(p),
  );
  const postId = Number(r.lastInsertRowid);
  console.log(`[media] ${outlet.name} 第${p.issue}期门户已出刊（post #${postId}，${p.sections.length} 个板块），配图后台补印`);

  // ★ 出刊即开始补图（用户口径）。**不 await** —— 出刊要立刻返回，这正是两层设计的意义。
  setTimeout(() => {
    fillPortalImages(p.sections.length + 1)
      .catch(err => console.error('[media] 门户补图失败:', err.message));
  }, 0);

  return db.prepare('SELECT * FROM media_posts WHERE id = ?').get(postId);
}

/**
 * 给门户逐张补图（第 1.5 层）。
 *
 * 与 fillPosterPanelImages 的差别：**每补一张就写回一次库**，而不是攒到整期补完再写。
 * 这是刻意的 —— 前端卡片要「补一张亮一张」，攒着写就看不到渐进效果，
 * 而且中途失败会丢掉已经生成好的那几张（那些图的文件已经在磁盘上了，成为孤儿）。
 */
export async function fillPortalImages(limit = 6) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.id, p.payload_json FROM media_posts p
    JOIN media_outlets o ON o.id = p.outlet_id
    WHERE o.layout = 'portal' AND p.payload_json IS NOT NULL
    ORDER BY p.id DESC LIMIT 12
  `).all();

  let filled = 0;
  for (const row of rows) {
    if (filled >= limit) break;
    const payload = safeParse(row.payload_json, null);
    if (!isPortalPayload(payload)) continue;

    for (const section of payload.sections) {
      if (filled >= limit) break;
      if (section.image || !section.image_prompt) continue;
      try {
        const result = await generateMediaImage(section.image_prompt, null);
        if (!result) continue;
        // 重新读一次 payload：生成期间可能有别的写入（如用户点了某块生成正文）
        const fresh = safeParse(db.prepare('SELECT payload_json FROM media_posts WHERE id = ?').get(row.id)?.payload_json, null);
        const target = isPortalPayload(fresh) ? fresh.sections.find(s => s.key === section.key) : null;
        if (!target || target.image) continue;   // 已被填过就跳过，避免覆盖
        target.image = result.url;
        db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(fresh), row.id);
        filled++;
        recordCompletedImageTask({
          conversationId: 'media_portal_section',
          promptOriginal: section.image_prompt,
          promptRefined: result.refinedPrompt,
          outputPaths: [result.url],
          style: result.artist,
          resolution: `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
          workflowTemplate: result.wfMode,
          db,
        });
        broadcast('media_image_ready', { postId: row.id, image: result.url, sectionKey: section.key });
        console.log(`[media] 门户配图 #${row.id}/${section.key} 已补（${filled}/${limit}）`);
      } catch (err) {
        console.error(`[media] 门户配图失败 #${row.id}/${section.key}:`, err.message);
      }
    }

    // 全部板块都有图 → 整期标记 done，前端停止轮询
    const now = safeParse(db.prepare('SELECT payload_json FROM media_posts WHERE id = ?').get(row.id)?.payload_json, null);
    if (isPortalPayload(now) && now.sections.every(s => s.image || !s.image_prompt)) {
      db.prepare(`UPDATE media_posts SET image_status = 'done', image_error = NULL WHERE id = ? AND image_status != 'done'`).run(row.id);
      // 门户的「封面」取第一块的头图，便于瀑布流/列表复用同一套渲染
      const cover = now.sections.find(s => s.image)?.image;
      if (cover) db.prepare('UPDATE media_posts SET image = ? WHERE id = ? AND (image IS NULL OR image = \'\')').run(cover, row.id);
      broadcast('media_portal_ready', { postId: row.id });
    }
  }
  return filled;
}

/**
 * 生成某个板块的正文（第 2 层）。按需触发、落库缓存 —— 生成过就直接返回缓存。
 * @returns {{ ok: boolean, cached?: boolean, section?: object, error?: string }}
 */
export async function generatePortalSection(postId, sectionKey) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM media_posts WHERE id = ?').get(postId);
  if (!row) return { ok: false, error: '内容不存在' };
  const payload = safeParse(row.payload_json, null);
  if (!isPortalPayload(payload)) return { ok: false, error: '这条内容不是门户结构' };

  const section = payload.sections.find(s => s.key === sectionKey);
  if (!section) return { ok: false, error: '找不到这个板块' };
  // 已生成过 → 直接给缓存（这就是「二次点开秒开」）
  if (section.body) return { ok: true, cached: true, section };

  const outlet = db.prepare('SELECT * FROM media_outlets WHERE id = ?').get(row.outlet_id);
  const worldSetting = getWorldSetting();

  const raw = await chatSync([
    { role: 'system', content: [getSystemRules({ roleplay: false }), worldSetting].filter(Boolean).join('\n\n') },
    { role: 'system', content: outlet?.prompt || '' },
    { role: 'system', content: buildSectionBodyPrompt(section.name, section.lead) },
    { role: 'user', content: `本期的总标题是「${payload.title}」。现在请写「${section.name}」这一块的正文。` },
  ], {
    temperature: 0.9, max_tokens: 4000,
    response_format: { type: 'json_object' }, label: `media:${outlet?.name || '门户'}·板块`,
  });

  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('LLM 未返回 JSON');
  const body = normalizeSectionBlocks(JSON.parse(repairJson(jsonStr)));

  // 重新读 payload 再写：生成期间可能刚补进了图，直接写旧对象会把图弄丢
  const fresh = safeParse(db.prepare('SELECT payload_json FROM media_posts WHERE id = ?').get(postId)?.payload_json, null);
  const target = isPortalPayload(fresh) ? fresh.sections.find(s => s.key === sectionKey) : null;
  if (!target) return { ok: false, error: '板块在生成期间被移除了，请刷新' };
  target.body = body;
  target.body_at = new Date().toISOString();
  db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(fresh), postId);

  console.log(`[media] 门户板块正文 #${postId}/${sectionKey} 已生成（${body.length} 块）`);
  return { ok: true, cached: false, section: target };
}

/** 板块正文的块数组规范化：只认已知块类型，其余丢弃（不做兜底猜测，避免前端拿到怪结构） */
export function normalizeSectionBlocks(raw) {
  const list = Array.isArray(raw?.blocks) ? raw.blocks : [];
  const out = [];
  for (const b of list) {
    const type = String(b?.type || '').toLowerCase();
    if (type === 'p') {
      const text = clampText(b.text, 2000);
      if (text) out.push({ type: 'p', text });
    } else if (type === 'qa') {
      const q = clampText(b.q, 300);
      const answers = (Array.isArray(b.answers) ? b.answers : [])
        .map(a => ({ speaker: clampText(a?.speaker, 30), text: clampText(a?.text, 600) }))
        .filter(a => a.text).slice(0, 6);
      if (q) out.push({ type: 'qa', asker: clampText(b.asker, 30), q, answers });
    } else if (type === 'rank') {
      const rows = (Array.isArray(b.rows) ? b.rows : [])
        .map(r => ({
          rank: clampText(r?.rank, 16), mask: clampText(r?.mask, 30),
          change: clampText(r?.change, 10), bearer: clampText(r?.bearer, 30),
        }))
        .filter(r => r.rank || r.bearer).slice(0, 12);
      if (rows.length) out.push({ type: 'rank', title: clampText(b.title, 40), notice: clampText(b.notice, 200), rows });
    } else if (type === 'replies') {
      const replies = (Array.isArray(b.replies) ? b.replies : [])
        .map(r => ({ author: clampText(r?.author, 30), text: clampText(r?.text, 600) }))
        .filter(r => r.text).slice(0, 14);
      if (replies.length) out.push({ type: 'replies', title: clampText(b.title, 40), stat: clampText(b.stat, 40), replies });
    } else if (type === 'caption') {
      const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => clampText(l, 300)).filter(Boolean).slice(0, 8);
      if (lines.length) out.push({ type: 'caption', lines });
    }
  }
  if (!out.length) throw new Error('模型没产出可用的正文块，请重试');
  return out;
}

export async function generateMediaBatch({ outletId = null, count = DEFAULT_BATCH_SIZE, withCharacters = true } = {}) {  if (generating) return generating;   // 同一时间只跑一批，避免并发刷爆 LLM
  generating = (async () => {
    const db = getDb();
    const n = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(count) || DEFAULT_BATCH_SIZE));

    // 选媒体
    let outlet = outletId ? getOutlet(outletId) : null;
    if (!outlet) {
      outlet = db.prepare('SELECT * FROM media_outlets WHERE enabled = 1 ORDER BY RANDOM() LIMIT 1').get() || null;
    }
    if (!outlet) throw new Error('没有可用的媒体（请先在媒体设置里添加）');

    // 按形态分派：周刊/海报/门户一次出一期（刊），都不是「一批帖子」
    if (outlet.layout === 'portal') return await generatePortalIssue(outlet);
    if (outlet.layout === 'weekly') return await generateWeeklyIssue(outlet);
    if (outlet.layout === 'poster') return await generatePosterIssue(outlet);

    const boards = listBoards(outlet.id);
    // 角色数量受帖数限制：最多 3 个、且不超过总帖数的一半（否则整版都是角色帖，不像真实社区）
    const authorCount = !withCharacters ? 0 : Math.min(3, Math.max(1, Math.floor(n / 2)));
    const authors = pickActiveCharacters(authorCount);

    const worldSetting = getWorldSetting();
    const msgs = [
      { role: 'system', content: [getSystemRules({ roleplay: false }), worldSetting].filter(Boolean).join('\n\n') },
      { role: 'system', content: outlet.prompt },
      { role: 'system', content: buildFormatPrompt(outlet, boards, authors) },
      { role: 'user', content: buildMaterialsPrompt(outlet, boards, authors, n) },
    ];

    const raw = await chatSync(msgs, {
      temperature: 0.9,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      label: `media:${outlet.name}`,
    });
    const jsonStr = extractFirstJson(raw);
    if (!jsonStr) throw new Error('LLM 未返回 JSON');
    const drafts = normalizeMediaDraft(JSON.parse(repairJson(jsonStr)), boards, authors);

    const batchId = `mb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ins = db.prepare(`
      INSERT INTO media_posts (outlet_id, board_id, batch_id, title, content, tags_json,
        author_type, character_id, author_name, author_avatar, likes, views, comments_json,
        image_prompt, image_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    let inserted = 0;
    const tx = db.transaction(() => {
      for (const d of drafts) {
        ins.run(
          outlet.id, d.board_id, batchId, d.title, d.content, JSON.stringify(d.tags),
          d.author_type, d.character_id, d.author_name, d.author_avatar, d.likes, d.views,
          JSON.stringify(d.comments), d.image_prompt || null,
        );
        inserted++;
      }
    });
    tx();
    console.log(`[media] 「${outlet.name}」新增 ${inserted} 条（角色参与 ${authors.map(a => a.display_name).join('、') || '无'}）`);

    // 通知前端有新内容；配图后台补（不阻塞返回）
    broadcast('media_new_posts', { outletId: outlet.id, count: inserted });

    // 只为**刚生成的这一批**补图（按需，不做全库扫描）。
    // 不 await：refresh 接口本来就是异步的，让文字先上屏、图随后到。
    fillPendingImages(inserted).catch(err => console.error('[media] 本批补图失败:', err.message));

    return { outletId: outlet.id, outletName: outlet.name, batchId, inserted };
  })().finally(() => { generating = null; });
  return generating;
}

// ══════════════════════════════════════════
// 配图（文字先上线，后台逐张补）
// ══════════════════════════════════════════

async function generateMediaImage(prompt, character = null) {
  const charArtist = charArtistOverrideWithFallback(character);
  const loras = parseCharacterLoras(character?.loras);
  const result = await generateImageRaw(prompt, {
    ragQuery: prompt,
    artist: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
    width: config.comfyui.momentsWidth,
    height: config.comfyui.momentsHeight,
    scene: 'moments',
    priority: 'low',
    ...(loras.length ? { customWorkflow: character?.custom_workflow || null, loras } : {}),
  });
  if (!result?.success || !result.images?.length) return null;
  const img = result.images[0];
  return {
    url: saveBase64Image('media', `media_${Date.now()}_${img.filename || 'comfy.png'}`, img.base64),
    refinedPrompt: result.promptRefined || prompt,
    wfMode: result.wfMode,
    artist: charArtist !== null ? charArtist : config.comfyui.momentsArtist,
  };
}

function parseCharacterLoras(loras) {
  if (!loras) return [];
  try {
    const parsed = typeof loras === 'string' ? JSON.parse(loras) : loras;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * 给缺图的帖子补封面（一次最多 limit 张，串行）。返回补上的张数。
 * 由定时器周期调用，也可在生成批次后立刻调一次。
 */
export async function fillPendingImages(limit = 6) {
  if (fillingImages) return 0;
  fillingImages = true;
  const db = getDb();
  let filled = 0;
  try {
    // ⚠️ 这里**不要**调 resetStaleMediaGenerating —— 它每分钟跑一次会把
    // 「正在生成中」的帖子反复重置为 pending，形成无限重生循环（详见该函数注释）。
    // 自愈只在服务启动时做一次（见 startReplyQueueScheduler）。
    const pending = listPostsNeedingImage(limit);
    for (const p of pending) {
      // ★ 原子抢占（CAS）：只有仍是 pending 的才抢得到。
      //   这一句是防重复生图的关键 —— 原实现先无条件置 generating，
      //   若同一帖子被两条补图路径同时捞走，两边都会生成、后写的覆盖前写的，
      //   前一张文件就变成没人引用的孤儿（实测目录里 81 个文件只有 37 个被引用）。
      if (!claimPostForImage(p.id)) continue;
      try {
        const character = p.character_id
          ? db.prepare('SELECT loras, artist_override, custom_workflow FROM characters WHERE id = ?').get(p.character_id)
          : null;
        const result = await generateMediaImage(p.image_prompt, character);
        if (!result) {
          updatePostImage(p.id, { status: 'failed', error: 'ComfyUI 未返回图片' });
          continue;
        }
        // ★ 条件写回：生成期间若有别的路径已经写入了图，就不覆盖它，
        //   并把自己刚存的这张删掉（否则又留一个孤儿）。
        const wrote = db.prepare(`
          UPDATE media_posts SET image = ?, image_status = 'done', image_error = NULL
          WHERE id = ? AND (image IS NULL OR image = '')
        `).run(result.url, p.id).changes;
        if (wrote !== 1) {
          console.warn(`[media] 帖子 #${p.id} 在生成期间已被填图，丢弃本次结果`);
          try { deleteImageFileByUrl(result.url); } catch { /* 文件可能已被清 */ }
          continue;
        }
        recordCompletedImageTask({
          conversationId: 'media_post',
          promptOriginal: p.image_prompt,
          promptRefined: result.refinedPrompt,
          outputPaths: [result.url],
          style: result.artist,
          resolution: `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
          workflowTemplate: result.wfMode,
          db,
        });
        broadcast('media_image_ready', { postId: p.id, image: result.url });
        filled++;
      } catch (err) {
        console.error(`[media] 配图失败 #${p.id}:`, err.message);
        updatePostImage(p.id, { status: 'failed', error: String(err.message).slice(0, 200) });
      }
    }

    // ── 海报的小图（存在 payload.panels 里，一张海报最多 3 张）──
    // 单独一轮、放在主图之后：主图是海报的门面，优先保证。
    filled += await fillPosterPanelImages(Math.max(0, limit));
  } finally {
    fillingImages = false;
  }
  return filled;
}

/**
 * 补海报小图（payload.panels[].image 为空且已有 image_prompt 的）。
 * 用「先写回 payload 再生成」的顺序无法 CAS（payload 是一整块 JSON），
 * 所以这里改为**串行 + 单飞**：fillPendingImages 本身有 fillingImages 守卫，
 * 且本函数只在同一次调用里跑一遍，不会与自身并发。
 */
async function fillPosterPanelImages(limit = 3) {
  const db = getDb();
  const posts = db.prepare(`
    SELECT p.id, p.payload_json FROM media_posts p
    JOIN media_outlets o ON o.id = p.outlet_id
    WHERE o.layout = 'poster' AND p.payload_json IS NOT NULL
    ORDER BY p.id DESC LIMIT 12
  `).all();

  let filled = 0;
  for (const row of posts) {
    if (filled >= limit) break;
    const payload = safeParse(row.payload_json, null);
    const panels = Array.isArray(payload?.panels) ? payload.panels : [];
    let touched = false;

    for (const panel of panels) {
      if (filled >= limit) break;
      if (panel.image || !panel.image_prompt) continue;
      try {
        const result = await generateMediaImage(panel.image_prompt, null);
        if (!result) continue;
        panel.image = result.url;
        touched = true;
        filled++;
        recordCompletedImageTask({
          conversationId: 'media_poster_panel',
          promptOriginal: panel.image_prompt,
          promptRefined: result.refinedPrompt,
          outputPaths: [result.url],
          style: result.artist,
          resolution: `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
          workflowTemplate: result.wfMode,
          db,
        });
        broadcast('media_image_ready', { postId: row.id, image: result.url, panel: true });
      } catch (err) {
        console.error(`[media] 海报小图失败 #${row.id}:`, err.message);
      }
    }
    if (touched) {
      db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), row.id);
    }
  }
  return filled;
}

// ══════════════════════════════════════════
// 自动补充（replyQueueScheduler tick 调用）
// ══════════════════════════════════════════

/**
 * 定时补内容：到点后随机挑一个启用的媒体补一小批，并顺带补几张缺图。
 * 不阻塞 tick（内部 fire-and-forget）。
 */
/** 这条内容是否有生图提示词（可重新生图） */
export function canRegenerateImage(post) {
  if (!post) return false;
  const payload = safeParse(post.payload_json, null);
  if (isPortalPayload(payload)) return payload.sections.some(s => String(s?.image_prompt || '').trim());
  if (String(post.image_prompt || '').trim()) return true;
  const panels = Array.isArray(payload?.panels) ? payload.panels : [];
  return panels.some(p => String(p?.image_prompt || '').trim());
}

/**
 * 为某条内容重新生成配图。
 *
 * 三种形态一视同仁：
 *   feed   → 清空主图，重新排队
 *   poster → 清空主图 **+ payload.panels[].image**（小图一并重出）
 *   weekly → 清空头图
 *
 * 旧图文件**不在这里删** —— 等新图写入成功后再处理，避免「图清了、新图又失败」
 * 导致这条内容永久没图。孤儿文件由 cleanupOrphanMediaImages 兜底清理。
 * @returns {{ok:boolean, error?:string, cleared?:number, post?:object}}
 */
export function regeneratePostImage(postId) {
  const db = getDb();
  const post = db.prepare('SELECT * FROM media_posts WHERE id = ?').get(postId);
  if (!post) return { ok: false, error: '内容不存在' };
  if (!canRegenerateImage(post)) return { ok: false, error: '这条内容没有生图提示词，无法重新生图' };

  let cleared = 0;
  const payload = safeParse(post.payload_json, null);
  const isPortal = isPortalPayload(payload);

  const tx = db.transaction(() => {
    // 主图清空并置回 pending —— CAS 抢占（claimPostForImage）只认 pending
    db.prepare(`UPDATE media_posts SET image = NULL, image_status = 'pending', image_error = NULL WHERE id = ?`).run(postId);
    cleared++;

    if (isPortal) {
      // 门户：清空**每个板块**的头图（正文 body 是文字、不动，重生成图片不该把已生成的正文丢掉）
      let touched = false;
      for (const s of payload.sections) {
        if (s?.image) { s.image = null; cleared++; touched = true; }
      }
      if (touched) {
        db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), postId);
      }
    } else if (payload && Array.isArray(payload.panels)) {
      let touched = false;
      for (const panel of payload.panels) {
        if (panel?.image) { panel.image = null; cleared++; touched = true; }
      }
      if (touched) {
        db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), postId);
      }
    }
  });
  tx();

  // 立刻排队（不 await：接口要快速返回；图会通过 SSE 到位）
  if (isPortal) {
    // 门户走自己的补图通道（主图通道已被 listPostsNeedingImage 排除）
    fillPortalImages(1 + payload.sections.length)
      .catch(err => console.error('[media] 门户重新生图失败:', err.message));
  } else {
    fillPendingImages(1 + (payload?.panels?.length || 0))
      .catch(err => console.error('[media] 重新生图失败:', err.message));
  }

  console.log(`[media] 帖子 #${postId} 重新生图：清空 ${cleared} 张`);
  const fresh = db.prepare('SELECT * FROM media_posts WHERE id = ?').get(postId);
  return { ok: true, cleared, post: mapPostRow(fresh) };
}

/**
 * 删除一条内容（含全部配图文件）。
 * 周刊/海报的小图存在 payload.panels、门户的头图存在 payload.sections —— **都要一并清理**，
 * 否则会留下没人引用的孤儿文件。
 * @param {number} postId
 * @param {{ silent?: boolean }} [opts] silent=true 时**不**失效相册缓存、**不**广播
 *   —— 批量删除用：逐条做这两件事会重复 N 次，由批量入口统一收尾。
 */
export function deletePost(postId, { silent = false } = {}) {
  const db = getDb();
  const post = db.prepare('SELECT * FROM media_posts WHERE id = ?').get(postId);
  if (!post) return { ok: false, error: '内容不存在' };

  // 先收集所有要删的图片 URL
  const urls = [];
  if (post.image) urls.push(post.image);
  const payload = safeParse(post.payload_json, null);
  if (Array.isArray(payload?.panels)) {
    for (const p of payload.panels) if (p?.image) urls.push(p.image);
  }
  // 门户的图存在 sections[].image（不是 panels），漏了会留下孤儿文件
  if (Array.isArray(payload?.sections)) {
    for (const s of payload.sections) if (s?.image) urls.push(s.image);
  }

  db.prepare('DELETE FROM media_posts WHERE id = ?').run(postId);

  // 删文件放在事务外：文件删失败不该导致记录删不掉
  let removed = 0;
  for (const u of urls) {
    try { if (deleteImageFileByUrl(u)) removed++; } catch { /* 可能已被清 */ }
  }
  if (!silent) {
    try { invalidateGalleryCache(); } catch { /* ignore */ }
    broadcast('media_post_deleted', { postId });
  }

  console.log(`[media] 删除内容 #${postId}（清理图片 ${removed}/${urls.length}）`);
  return { ok: true, removedImages: removed };
}

// ── 批量操作（列表页「批量操作」用） ─────────────────────────

/** 一次最多处理多少条 —— 防止误点「全选」把整库送进来跑很久 */
export const MAX_BATCH_POSTS = 500;

function normalizePostIds(ids) {
  const arr = Array.isArray(ids) ? ids : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 批量删除。
 *
 * 逐条复用 `deletePost`（它已负责：收集主图 + payload.panels 小图、删记录、删文件、广播），
 * 但**撤掉它内部的缓存失效与广播**会重复 N 次 —— 这里由调用方统一收尾。
 * 返回每一张的结果，前端据此提示「成功 N 张，失败 M 张」而不是笼统报错。
 */
export function deletePosts(ids) {
  const list = normalizePostIds(ids);
  if (!list.length) return { ok: false, error: '没有选中任何内容' };
  if (list.length > MAX_BATCH_POSTS) return { ok: false, error: `一次最多处理 ${MAX_BATCH_POSTS} 条` };

  let deleted = 0;
  let removedImages = 0;
  const failedItems = [];
  for (const id of list) {
    // silent：逐条失效缓存/广播会重复 N 次，这里统一在下面收尾一次
    const r = deletePost(id, { silent: true });
    if (r.ok) { deleted++; removedImages += r.removedImages || 0; }
    else failedItems.push({ id, error: r.error });
  }
  if (deleted > 0) {
    try { invalidateGalleryCache(); } catch { /* ignore */ }
  }
  console.log(`[media] 批量删除：请求 ${list.length} 条，成功 ${deleted}，失败 ${failedItems.length}，清理图片 ${removedImages} 张`);
  return { ok: true, requested: list.length, deleted, removedImages, failed: failedItems.length, failedItems: failedItems.slice(0, 20) };
}

/**
 * 批量重新生图。
 *
 * 逐条复用 `regeneratePostImage`（清空 image + payload.panels[].image 并置回 pending）。
 * 注意它内部每条都会调一次 `fillPendingImages` —— 批量时会排队 N 次，
 * 但 `fillPendingImages` 自带单飞守卫（`fillingImages`），重复调用会直接返回 0，不会重复生图。
 * 所以这里照常逐条调用，最后不再补一次，避免与守卫打架。
 */
export function regeneratePostImages(ids) {
  const list = normalizePostIds(ids);
  if (!list.length) return { ok: false, error: '没有选中任何内容' };
  if (list.length > MAX_BATCH_POSTS) return { ok: false, error: `一次最多处理 ${MAX_BATCH_POSTS} 条` };

  let queued = 0;
  let clearedImages = 0;
  const failedItems = [];
  for (const id of list) {
    const r = regeneratePostImage(id);
    if (r.ok) { queued++; clearedImages += r.cleared || 0; }
    else failedItems.push({ id, error: r.error });
  }
  console.log(`[media] 批量重新生图：请求 ${list.length} 条，已排队 ${queued}，失败 ${failedItems.length}`);
  return { ok: true, requested: list.length, queued, clearedImages, failed: failedItems.length, failedItems: failedItems.slice(0, 20) };
}

export function maybeAutoGenerate(now = Date.now()) {  // ⚠️ 这里**不再**每轮扫描补图。
  //
  // 原来每次 tick（1 分钟）都无条件调 `fillPendingImages(8)`，配合已被移除的橱窗预生成，
  // 会让 ComfyUI 持续满负载（实测 30 分钟被派单 46 次）。
  // 现在改为**纯按需**：只在①生成新批次后立即补那一批 ②前端打开传媒页时兜底补一次。
  // 没有任何"后台定时扫描出图"的路径。

  // 自动抓帖：间隔由用户设置的档位决定；0 = 关闭（只手动刷新）
  const interval = autoIntervalMs();
  if (interval === 0) return null;
  if (generating) return null;
  if (now - lastAutoAt < interval) return null;
  const hasOutlet = getDb().prepare('SELECT 1 FROM media_outlets WHERE enabled = 1 LIMIT 1').get();
  if (!hasOutlet) return null;
  lastAutoAt = now;
  return generateMediaBatch({ count: AUTO_BATCH_SIZE })
    .then(r => console.log(`[media] 自动补充：「${r.outletName}」+${r.inserted} 条`))
    .catch(err => console.error('[media] 自动补充失败:', err.message));
}

/**
 * 启动自愈：把上次进程中断时遗留的 `generating` 放回 `pending`。
 *
 * 和橱窗图库同样的两段式问题：补图循环在内存、状态在 DB，
 * 进程一重启循环就没了、DB 却停在 `generating`，而 `listPostsNeedingImage`
 * 只查 `pending` → 这几条再也补不上图。
 *
 * ⚠️⚠️ **只能在服务启动时调用一次，绝不能放进每分钟的补图/定时循环里。**
 *
 * 曾经它被放在 `fillPendingImages()` 开头（等于每分钟跑一次），且用 `created_at`
 * 判"卡了多久" —— 但 `created_at` 是**帖子创建时间**，不是**生图开始时间**。
 * 于是一个「创建于 10 分钟前、此刻正在生成中」的帖子会被判定为卡死 → 重置为 pending
 * → 下一轮又被捞去生成 → 再被重置……**形成无限重生循环，ComfyUI 被持续打满**。
 * （2026-10-04 实测：30 分钟内被反复派单 46 次、同一 prompt 重生 4 次。）
 *
 * 进程刚启动时不存在"正在生成"的帖子，因此此时把所有 generating 视为中断遗留是安全的。
 * @returns {number} 重置了几条
 */
export function resetStaleMediaGenerating() {
  try {
    const r = getDb().prepare(`
      UPDATE media_posts SET image_status = 'pending', image_error = '上次生成被中断，已重置'
      WHERE image_status = 'generating'
    `).run();
    if (r.changes > 0) console.log(`[media] 启动自愈：重置了 ${r.changes} 条中断的配图状态`);
    return r.changes;
  } catch (err) {
    console.error('[media] resetStaleMediaGenerating 失败:', err.message);
    return 0;
  }
}

/**
 * 清理未被任何帖子引用的孤儿配图文件。
 *
 * 重复生图的历史遗留：目录里的文件数远多于 DB 引用数（实测 81 vs 37）。
 * 现在虽然加了 CAS 防护不会再产生新的，但存量孤儿会白占磁盘，需要清一次。
 * @param {number} [maxAgeMs] 只清理「这么久以前」的文件，避免误删正在写入的
 * @returns {{scanned:number, removed:number}}
 */
export function cleanupOrphanMediaImages(maxAgeMs = 60 * 60 * 1000) {
  try {
    const dir = getImageDir('media');
    if (!fs.existsSync(dir)) return { scanned: 0, removed: 0 };
    const referenced = new Set(
      getDb().prepare(`SELECT image FROM media_posts WHERE image IS NOT NULL AND image <> ''`).all()
        .map(r => String(r.image).split('/').pop())
    );
    let scanned = 0, removed = 0;
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('media_')) continue;      // 只看本模块产生的文件
      scanned++;
      if (referenced.has(f)) continue;
      const full = path.join(dir, f);
      try {
        if (now - fs.statSync(full).mtimeMs < maxAgeMs) continue;  // 太新，可能在写
        fs.unlinkSync(full);
        removed++;
      } catch { /* 单个失败不影响其余 */ }
    }
    if (removed > 0) console.log(`[media] 清理孤儿配图 ${removed} 个（扫描 ${scanned}）`);
    return { scanned, removed };
  } catch (err) {
    console.error('[media] cleanupOrphanMediaImages 失败:', err.message);
    return { scanned: 0, removed: 0 };
  }
}

/**
 * 距下次自动抓帖还有多久（前端「下次约 X 后」倒计时用）。
 * 关闭时返回 null。
 */
export function getAutoState() {
  const interval = autoIntervalMs();
  const minutes = Number(config.features.mediaAutoMinutes ?? 0);
  if (interval === 0) return { minutes: 0, nextInMs: null, generating: !!generating };
  const nextAt = lastAutoAt + interval;
  return {
    minutes,
    nextInMs: Math.max(0, nextAt - Date.now()),
    generating: !!generating,
  };
}
