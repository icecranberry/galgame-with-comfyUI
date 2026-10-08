/**
 * 世界地图骨架（叙事地理）——「地图」页的服务层。
 *
 * ── 这个模块解决什么 ─────────────────────────────────
 * 用户有世界观，但「世界长什么样」散在脑子里/知识库里，落不成结构。
 * 这里用 **两段式、强引导** 的 AI 流程把它逼出来：
 *
 *   ① `generateSkeleton`  1 次**短** LLM → L1 大地区 + L2 子地区（大纲）
 *      产出小、几秒回、用户马上能看见全貌并调整 —— 这一步不涉及任何场景细节。
 *   ② `expandPlace`       点某个子地区才展开 → 它的 L3 场景 + 每场景的 POI 清单
 *      按需触发、逐个细化，想停就停；避免一次性吐出一座城市（那既不"简洁"也容易失控）。
 *
 * ── 提示词里的方法论来自用户知识库的范式（已内化，不依赖外部文件）────
 *   · 三层舞台范式：宏观概念虚化 / 中观大地图虚化 / 微观聚焦舞台详档
 *   · 平凡场所做舞台（便利店/站台/澡堂…），不选空泛奇观
 *   · 一区 6~9 个生活地点（POI），覆盖 零售 / 餐饮 / 服务 各 ≥1
 *   · 命名两档：地点级「中文意象名 + 官方英文合成意译名」成对；
 *              店名级「中文意象名 + 贴合功能的热词」融合
 *   · 类型化表达（"巷口面包铺 · 烘焙/早餐"），**不写人物剧情/前史**
 */

import { getDb, getWorldSetting, getSystemRulesWithWorld, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
// ⚠ 项目里有**两个同名导出**、语义不同，别拿错：
//   · eventGenerator.extractFirstJson → 返回 **JSON 字符串**（调用方自己 JSON.parse(repairJson(s))）—— 本文件用这个
//   · itemService.extractFirstJson    → 返回**已解析的对象**（内部已 repair）
// 本文件与 mediaService.js 保持同一口径（都用 eventGenerator 版），方便互相参照。
import { extractFirstJson, repairJson } from './eventGenerator.js';

// ── 层级 ──
/**
 * 层级**不设上限**（数据是自引用的 `parent_id`）。
 *
 * 前三层有惯用叫法，第四层起统称「子地点」——
 * 因为真实项目里会有「二维市 → 珠星集团总部大楼 → 1F 展示大厅 → IP 产品展示厅」这种嵌套，
 * 硬卡三层会把它们压平成一片（用户报过这个问题）。
 */
export const LEVEL = { REGION: 1, DISTRICT: 2, SCENE: 3 };
const LEVEL_NAMES = { 1: '大地区', 2: '子地区', 3: '场景' };
export function levelLabel(level) {
  return LEVEL_NAMES[level] || `子地点（${level} 级）`;
}
/** 前三层的固定叫法（给前端做静态映射用；四层以上前端调 levelLabel 的等价逻辑） */
export const LEVEL_LABEL = { ...LEVEL_NAMES };
export const POI_TYPES = ['零售', '餐饮', '服务', '配套'];

// ═══════════════════════════════════════════════════════════
// 地点的结构化属性（2026-10-05 加）
//
// ── 为什么要有这几个字段 ─────────────────────────────────
// 日程生成过去靠提示词里一段**散文**告诉模型「哪些地方不能去」「在家该穿什么」，
// 但散文不可查询、且在地图数据之外 → 改地图不会改它，「ROLL 到不合适场景」
// 和「穿错衣服」都由此而来。改成结构化字段后，注入侧可以**过滤 + 标注**，
// 把「模型猜」变成「后端算」。
// ═══════════════════════════════════════════════════════════

/**
 * 准入等级。**未标注（空串）按 public 处理** —— 迁移不可能给存量打标，
 * 若把空串当 restricted，一次升级会把所有地点关掉。
 *
 * - public        随时可去
 * - restricted    谢绝外人 / 需身份（如「珠星总部」「非仪式期的幻月秘庭」）
 * - private       角色私人空间（自己的房间等），只在归属该角色时进池
 * - time_window   有时段（配 open_at/close_at）
 */
export const ACCESS_LEVELS = ['public', 'restricted', 'private', 'time_window'];
export const ACCESS_LABEL = {
  public: '公开', restricted: '谢绝外人', private: '私人空间', time_window: '限时段',
};

/**
 * 区域性质 —— 与服装联动（`outfitScene`）。
 *
 * - residence        居住区域（自己住处）→ 居家 / 睡衣
 * - activity         主要活动区域        → 常服 / 私服
 * - private_transit  私密转运（浴室等）  → 全身（原「裸体」，仅私密场景）
 */
export const ZONE_LEVELS = ['residence', 'activity', 'private_transit'];
export const ZONE_LABEL = {
  residence: '居住区域', activity: '主要活动区域', private_transit: '私密空间（洗浴等）',
};
/** zone → 该场景下应当优先穿的服装 key（供注入与校验；'' = 不限定） */
export const ZONE_OUTFIT_HINT = {
  residence: 'home', activity: 'work', private_transit: 'nude',
};

/** 归一化准入：非法值 → ''（=未标注），不做猜测性兜底 */
export function normalizeAccess(v) {
  const s = String(v ?? '').trim();
  return ACCESS_LEVELS.includes(s) ? s : '';
}
/** 归一化分区：非法值 → ''（=未标注） */
export function normalizeZone(v) {
  const s = String(v ?? '').trim();
  return ZONE_LEVELS.includes(s) ? s : '';
}
/** 时间点校验：接受 'HH:MM'，其余 → '' */
function normalizeClock(v) {
  const s = String(v ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}

/** 是否「默认可进候选池」——public 与未标注都算（见 normalizeAccess 的说明） */
export function isAccessibleByDefault(access) {
  const a = normalizeAccess(access);
  return a === '' || a === 'public';
}

/** 拒绝原因文案（注入时标注给模型看，比只写 access 值更有用） */
export function accessReason(place) {
  const a = normalizeAccess(place?.access);
  if (a === 'restricted') return '谢绝外人／需身份';
  if (a === 'private') return '某角色的私人空间';
  if (a === 'time_window') {
    const o = normalizeClock(place?.open_at), c = normalizeClock(place?.close_at);
    return (o && c) ? `仅 ${o}–${c} 时段开放` : '仅特定时段开放';
  }
  return '';
}

/** 一次展开最多接受多少个场景（防模型失控吐几十个） */
const MAX_SCENES_PER_DISTRICT = 10;
/**
 * 遍历地点树的深度上限 —— **防环护栏，不是层级上限**。
 * `parent_id` 是结构真源、`level` 只是冗余列；历史数据一旦成环（A→B→A），
 * 无上限递归会直接把进程栈打爆。真实世界的地图不会超过这个深度。
 */
const MAX_PLACE_DEPTH = 12;
/** 每场景 POI 数量区间（范式要求一区 6~9 个） */
const POI_MIN = 4;
const POI_MAX = 9;

function clampText(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/** key 只留字母数字下划线（前端 v-for 的稳定 key，也给模型一个可引用的锚） */
function toKey(raw, fallback) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return k || fallback;
}

// ═══════════════════════════════════════════════════════════
// 读
// ═══════════════════════════════════════════════════════════

export function listMaps() {
  const rows = getDb().prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM world_map_places p WHERE p.map_id = m.id) AS place_count,
           (SELECT COUNT(*) FROM world_map_places p WHERE p.map_id = m.id AND p.level = 3) AS scene_count
    FROM world_maps m ORDER BY m.id DESC
  `).all();
  return rows.map(r => ({
    id: r.id, name: r.name, world_setting_id: r.world_setting_id, note: r.note,
    place_count: r.place_count, scene_count: r.scene_count,
    created_at: r.created_at, updated_at: r.updated_at,
  }));
}

/** 整张地图（树 + 扁平列表两种形态都给，前端按需取） */
export function getMap(mapId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM world_maps WHERE id = ?').get(mapId);
  if (!row) return null;
  const places = db.prepare(
    'SELECT * FROM world_map_places WHERE map_id = ? ORDER BY level, sort_order, id'
  ).all(mapId).map(mapPlaceRow);

  return {
    id: row.id, name: row.name, world_setting_id: row.world_setting_id, note: row.note,
    created_at: row.created_at, updated_at: row.updated_at,
    tree: buildTree(places),
    places,
    stats: {
      region: places.filter(p => p.level === 1).length,
      district: places.filter(p => p.level === 2).length,
      scene: places.filter(p => p.level === 3).length,
      poi: places.reduce((n, p) => n + p.pois.length, 0),
    },
  };
}

function mapPlaceRow(r) {
  return {
    id: r.id, map_id: r.map_id, parent_id: r.parent_id, level: r.level,
    key: r.key, name: r.name, name_en: r.name_en || '', kind: r.kind || '',
    summary: r.summary || '', pois: safeParse(r.pois_json, []), sort_order: r.sort_order,
    // 结构化属性（见文件中部 ACCESS_LEVELS / ZONE_LEVELS 的说明）
    access: r.access || '', zone: r.zone || '', category: r.category || '',
    scene_prompt: r.scene_prompt || '', open_at: r.open_at || '', close_at: r.close_at || '',
    // ★ 手动摆放的归一化坐标（-1 = 用户没摆过，走自动排布）
    pos_x: typeof r.pos_x === 'number' ? r.pos_x : -1,
    pos_y: typeof r.pos_y === 'number' ? r.pos_y : -1,
    // 是否已细化（L2 有子场景就算已展开）——前端据此显示「展开 / 已展开」
    expanded: false,
  };
}

/** 扁平列表 → 嵌套树（自引用一次装好，前端不用递归请求） */
function buildTree(places) {
  const byId = new Map(places.map(p => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
    else roots.push(node);
  }
  // 标记已展开：有子节点即可
  for (const node of byId.values()) node.expanded = node.children.length > 0;
  return roots;
}

// ═══════════════════════════════════════════════════════════
// 写
// ═══════════════════════════════════════════════════════════

export function createMap({ name, worldSettingId = null, note = '' } = {}) {
  const db = getDb();
  const clean = clampText(name, 40) || '未命名地图';
  const r = db.prepare('INSERT INTO world_maps (name, world_setting_id, note) VALUES (?, ?, ?)')
    .run(clean, worldSettingId, clampText(note, 500));
  return getMap(Number(r.lastInsertRowid));
}

export function updateMap(mapId, { name, note } = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM world_maps WHERE id = ?').get(mapId);
  if (!cur) return { ok: false, error: '地图不存在' };
  db.prepare('UPDATE world_maps SET name = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name !== undefined ? (clampText(name, 40) || cur.name) : cur.name,
      note !== undefined ? clampText(note, 500) : cur.note, mapId);
  return { ok: true };
}

export function deleteMap(mapId) {
  const r = getDb().prepare('DELETE FROM world_maps WHERE id = ?').run(mapId);
  return { ok: r.changes > 0 };
}

/**
 * 复制一张地图（整棵子树）为新的独立地图。
 *
 * 用途：**把「二相乐园」这类建好的地图当模板**新建 —— 比在代码里再维护一份模板数据可靠得多
 * （模板就是真实数据，改一次即可）。
 * 复制后两张图完全独立，改一张不影响另一张。
 */
export function duplicateMap(sourceId, newName = '') {
  const db = getDb();
  const src = db.prepare('SELECT * FROM world_maps WHERE id = ?').get(sourceId);
  if (!src) return { ok: false, error: '源地图不存在' };

  const name = clampText(newName, 40) || `${src.name} 副本`;
  return db.transaction(() => {
    const mid = Number(db.prepare(
      'INSERT INTO world_maps (name, world_setting_id, note) VALUES (?, ?, ?)'
    ).run(name, src.world_setting_id, src.note).lastInsertRowid);

    // 按 level 升序插入，保证父节点先于子节点存在（parent_id 需要重映射）
    const rows = db.prepare(
      'SELECT * FROM world_map_places WHERE map_id = ? ORDER BY level, sort_order, id'
    ).all(sourceId);
    const ins = db.prepare(`INSERT INTO world_map_places
      (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order,
       access, zone, category, scene_prompt, open_at, close_at, pos_x, pos_y)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const idMap = new Map();   // 旧 id → 新 id
    for (const r of rows) {
      const newParent = r.parent_id ? (idMap.get(r.parent_id) ?? null) : null;
      const nid = Number(ins.run(mid, newParent, r.level, r.key, r.name, r.name_en, r.kind,
        r.summary, r.pois_json, r.sort_order,
        r.access || '', r.zone || '', r.category || '', r.scene_prompt || '',
        r.open_at || '', r.close_at || '',
        // 复制地图时**保留用户手动摆过的点位**（-1 则照旧表示未摆）
        typeof r.pos_x === 'number' ? r.pos_x : -1,
        typeof r.pos_y === 'number' ? r.pos_y : -1).lastInsertRowid);
      idMap.set(r.id, nid);
    }
    return { ok: true, map: getMap(mid) };
  })();
}

/**
 * 手动增改一个地点。
 *
 * ★ 支持**移动**（`patch.parentId`）—— 这是「动不了位置」的根治。
 *
 * 早先这里只白名单了 `name/name_en/kind/summary/pois`，**改不了 `parent_id`**，
 * 于是「把某个地点挪到另一个父级下」在界面上完全做不到，只能删掉重建
 * （重建会换 id，任何引用它的状态都会失效）。实测踩过这个坑。
 *
 * 移动不是单纯改一列：`level` 是**冗余存储**的（列表按 `level, sort_order` 排序，
 * 层级还要参与「大区/子区/场景」计数），所以整棵子树都要按位移量重算；
 * 另外必须防**成环**（把父节点挪进自己的子孙里 → 那棵子树会从树上消失，
 * 用户看到的是"地点凭空不见了"，而且再也点不回来）。
 */
export function upsertPlace(placeId, patch = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(placeId);
  if (!cur) return { ok: false, error: '地点不存在' };

  return db.transaction(() => {
    // ── ① 移动（可选）──
    if (patch.parentId !== undefined) {
      const moved = movePlace(placeId, patch.parentId, cur);
      if (!moved.ok) return moved;
    }

    // ── ② 字段更新 ──
    const pois = patch.pois !== undefined ? normalizePois(patch.pois) : safeParse(cur.pois_json, []);
    db.prepare(`UPDATE world_map_places SET name = ?, name_en = ?, kind = ?, summary = ?, pois_json = ?,
        access = ?, zone = ?, category = ?, scene_prompt = ?, open_at = ?, close_at = ?,
        pos_x = ?, pos_y = ?
      WHERE id = ?`).run(
      patch.name !== undefined ? (clampText(patch.name, 40) || cur.name) : cur.name,
      patch.name_en !== undefined ? clampText(patch.name_en, 60) : cur.name_en,
      patch.kind !== undefined ? clampText(patch.kind, 20) : cur.kind,
      patch.summary !== undefined ? clampText(patch.summary, 600) : cur.summary,
      JSON.stringify(pois),
      // ⚠ access/zone 用 normalize*（非法值落空串=未标注），**不做猜测性兜底**
      patch.access !== undefined ? normalizeAccess(patch.access) : (cur.access || ''),
      patch.zone !== undefined ? normalizeZone(patch.zone) : (cur.zone || ''),
      patch.category !== undefined ? clampText(patch.category, 20) : (cur.category || ''),
      patch.scene_prompt !== undefined ? clampText(patch.scene_prompt, 400) : (cur.scene_prompt || ''),
      patch.open_at !== undefined ? normalizeClock(patch.open_at) : (cur.open_at || ''),
      patch.close_at !== undefined ? normalizeClock(patch.close_at) : (cur.close_at || ''),
      // ★ 手动摆放的坐标（归一化 0~1；非法/缺省保持原值）。前端拖完写回这里 → 落库、
      //   后端与 LLM 都能读到（原先只存 localStorage，后端根本看不见）。
      patch.pos_x !== undefined ? normalizeUnit(patch.pos_x, cur.pos_x) : (cur.pos_x ?? -1),
      patch.pos_y !== undefined ? normalizeUnit(patch.pos_y, cur.pos_y) : (cur.pos_y ?? -1),
      placeId);

    touchMap(cur.map_id);
    return { ok: true, place: mapPlaceRow(db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(placeId)) };
  })();
}

/**
 * 让 AI 依据「名称 / 类型 / 一句话简介」生成一条**英文画面描述**（scene_prompt）。
 *
 * ── 为什么单独做这个（2026-10-06 用户要求）──────────────
 * 地图地点的 `scene_prompt` 有两个消费方（日程注入的反八股素材、哈托比亚「城市风光」的生图取景），
 * 但它**必须用英文**写画面（生图规则要求 ALL text in English），手写很别扭。
 * 用户口径：在人写好了"名称+类型+简介"后，给一个按钮**自动生成**这条英文画面描述。
 *
 * ── 与 `expandPlace` 的关系 ──
 * 那是"展开下一级"（产出结构），本节是"补一条字段"（产出文本）。**不落库** ——
 * 只返回给前端预览，用户可改可重掷，确认后随 `PUT /places/:id` 保存（与论坛马甲同一取向：
 * 生成物先给人看，不直接覆盖已有内容）。
 *
 * ⚠ 只依据用户已填的**中文**信息做翻译+扩写；无世界观的纯地名也能生成（不强制依赖世界观）。
 *
 * @param {{name?:string, kind?:string, summary?:string, nameEn?:string, context?:string}} input
 * @returns {Promise<{ok:true, scenePrompt:string}>}
 */
export async function generateScenePrompt({ name = '', kind = '', summary = '', nameEn = '', context = '' } = {}) {
  const nm = String(name || '').trim();
  if (!nm) throw Object.assign(new Error('请先填写名称'), { statusCode: 400 });

  const world = (() => { try { return getWorldSetting(); } catch { return ''; } })();
  const msgs = [
    { role: 'system', content: getSystemRulesWithWorld() || '你是一个场景美术描述师。' },
    {
      role: 'system',
      content: `你要为一个虚构地点写一条**英文画面描述**，供 AI 生图模型取景使用。

硬性要求：
- **全英文输出**（生图模型不吃中文）。**不得出现任何中文字符** —— 专有名词/设定词
  （如"愿力""星穹"）也要**意译或音译**成英文（如 willpower / astral），宁可用近义词也不要留中文。
- 只写**画面本身**：环境、光线、材质、天气、氛围、色调、建筑/陈设细节。
- **绝对不要写人**（不要出现 person/girl/man，除非环境必然包含人流，用 crowd 也要克制）。
- 40 个英文词以内，用逗号分隔的短语堆叠风格（Danbooru/插画站常用写法），不要完整句子。
- 与地点名、类型、简介**保持一致**：它是"什么性质的地方"要能从画面看出来。

只输出 JSON：{"scene_prompt": "..."}，不要任何解释。`,
    },
    {
      role: 'user',
      content: `地点名称：${nm}${nameEn ? `（${nameEn}）` : ''}
类型：${kind || '（未填）'}
一句话简介：${summary || '（未填）'}
${context ? `所属：${context}\n` : ''}${world ? `\n参考世界观（摘录）：\n${String(world).slice(0, 1200)}` : ''}`,
    },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0.8, max_tokens: 300,
    response_format: { type: 'json_object' }, label: `worldmap:scene:${nm}`,
  });
  const jsonStr = extractFirstJson(raw);
  const obj = jsonStr ? safeParse(repairJson(jsonStr), null) : null;
  let out = clampText(obj?.scene_prompt || '', 400);
  // ★ 出口兜底：即便提示词已写明"全英文"，模型偶尔仍会漏一个中文词进来
  //   （实测吐过 "dazzling愿力 glow"）。scene_prompt 是**喂英文生图模型**的，
  //   混中文会污染提示词 —— 这里把残留的 CJK 字符直接剔除，并压掉多余空格/逗号。
  out = out.replace(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/g, ' ')
    .replace(/\s*,\s*/g, ', ').replace(/(?:,\s*){2,}/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!out) throw new Error('模型没产出画面描述，请重试');
  return { ok: true, scenePrompt: out };
}

/**
 * 让 AI **追加**生活地点（POI）到某个已有地点下 —— 用户 2026-10-07 要求。
 *
 * ── 为什么必须有这个（而不是复用手动「+ 添加一条」）─────────
 * 用户实况：很多时候只想给这个地点补几个**店/设施**，**不需要**再建一层下级地点。
 * 既有的「✨ 让 AI 展开下一级」会 DELETE 掉该地点下的**全部**子节点再整体替换（幂等换一批），
 * 手写的子地点会被一起清掉；「+ 添加一条」又得一条条敲名字。
 * 本函数补的就是中间那条路：**只往 pois_json 里追加**，不碰任何子节点。
 *
 * ── 与 `expandPlace` 的关键区别（改代码前务必看清）──────────
 *   · `expandPlace`      → 产出**结构**（L3 场景），会 `DELETE ... WHERE parent_id = ?`；
 *   · `expandPois`（本函数）→ 只在**当前节点**上追加 POI 行，**不落库**（前端预览确认后才随
 *     `PUT /places/:id` 保存），也不做任何删除。
 *
 * ★★ 出口两道闸门（缺一不可，都是踩过的坑）：
 *   ① **与已有 POI 去重**（按名字，忽略大小写与空白）—— 否则「再点一次」就堆出一串同名店；
 *   ② **全是重复时不能静默返回空数组**（红线 0）：前端拿到 `[]` 只会看到"点了没反应"。
 *      此时抛 400 带明确原因，用户知道该做什么（先改现有条目名，或换个方向重掷）。
 *
 * @param {number} placeId
 * @param {{count?:number, hint?:string, excludeNames?:string[]}} opts
 *   `excludeNames` 由前端传**当前表单里已有**的 POI 名（含未保存的手改条目），
 *   比只查库更准 —— 用户刚手打完名字还没点保存，库里的 `pois_json` 并不包含它。
 * @returns {Promise<{ok:true, pois:Array<{name:string,type:string,blurb:string}>}>}
 *   返回的是**要追加的那几条**（不是全量），由前端决定怎么并进表单。
 */
export async function expandPois(placeId, { count = 4, hint = '', excludeNames = [] } = {}) {
  const db = getDb();
  const place = db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(placeId);
  if (!place) throw Object.assign(new Error('地点不存在'), { statusCode: 404 });

  const world = (() => { try { return getWorldSetting(); } catch { return ''; } })();
  const parent = place.parent_id
    ? db.prepare('SELECT name FROM world_map_places WHERE id = ?').get(place.parent_id)
    : null;

  // 已有 POI：库里存的 + 前端传来的（未保存的手改条目）合并去重。
  // ⚠ 前端那份可能含空名（用户点了「+ 添加一条」还没填），要过滤掉再参与比对。
  const existingNames = [
    ...(safeParse(place.pois_json, []) || []).map(p => String(p?.name || '')),
    ...(Array.isArray(excludeNames) ? excludeNames : []),
  ].map(s => s.trim()).filter(Boolean);

  // 上层地点的同级 POI 也读几个当"别重复"的参考（跨兄弟节点重名很出戏，但不硬性禁止）
  const siblingNames = parent
    ? db.prepare('SELECT pois_json FROM world_map_places WHERE parent_id = ? AND id != ? LIMIT 8')
      .all(place.parent_id, placeId)
      .flatMap(r => (safeParse(r.pois_json, []) || []).map(p => String(p?.name || '')))
      .filter(Boolean)
    : [];

  const n = Math.max(1, Math.min(8, Number(count) || 4));
  const msgs = [
    { role: 'system', content: getSystemRulesWithWorld() || '你是一个世界观设定师。' },
    { role: 'system', content: POI_APPEND_FORMAT(existingNames, siblingNames) },
    {
      role: 'user',
      content: `地点：**${place.name}**${place.name_en ? `（${place.name_en}）` : ''}
${place.kind ? `类型：${place.kind}\n` : ''}${place.summary ? `它是什么地方：${place.summary}\n` : ''}${parent ? `它属于「${parent.name}」。\n` : ''}${hint.trim() ? `\n【本次特别要求】${hint.trim()}\n` : ''}
请给这个地点补 **${n} 个**生活地点（店 / 设施）。${existingNames.length ? '已列出的这些**不要再出**。' : ''}`,
    },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0.9, max_tokens: 900,
    response_format: { type: 'json_object' }, label: `worldmap:poi:${place.name}`,
  });
  const jsonStr = extractFirstJson(raw);
  const obj = jsonStr ? safeParse(repairJson(jsonStr), null) : null;

  // 兼容模型偶尔改用 "places"/"items" 作键（不按格式走时也要能捞回来）
  const list = Array.isArray(obj?.pois) ? obj.pois
    : Array.isArray(obj?.places) ? obj.places
      : Array.isArray(obj?.items) ? obj.items : [];

  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  const blocked = new Set(existingNames.map(norm));
  const seen = new Set();
  const out = [];
  for (const p of normalizePois(list)) {
    const k = norm(p.name);
    if (!k || blocked.has(k) || seen.has(k)) continue;   // 闸门① 与已有/本轮重复的都丢掉
    seen.add(k);
    out.push(p);
  }

  // 闸门② 一条都不剩 → 抛错说清原因，绝不 `return []`
  if (!out.length) {
    throw Object.assign(
      new Error(existingNames.length
        ? `AI 给出的都是已有地点（${existingNames.slice(0, 4).join('、')}${existingNames.length > 4 ? ' 等' : ''}），没有新内容。可再点一次换一批，或先改掉现有条目名。`
        : 'AI 没产出可用的生活地点，请重试'),
      { statusCode: 502 },
    );
  }
  return { ok: true, pois: out };
}

/**
 * 追加 POI 时的输出格式约束。
 *
 * ⚠ `existing` / `siblings` 只把**名字**列给模型当"别再出"的负样本 ——
 * 刻意**不列**已存在的店名以外的任何内容（blurb/类型），否则模型会把整行照抄回来。
 * 名字为空数组时整段不出现（不给模型看空列表）。
 */
function POI_APPEND_FORMAT(existing = [], siblings = []) {
  return `请严格按以下 JSON 格式输出，不要任何解释或 JSON 以外的文字：

{
  "pois": [
    { "name": "店名／地点名（中文，意象＋功能热词融合，2~7字）", "type": "零售|餐饮|服务|配套", "blurb": "一句话说清它是什么、有什么生活气息（≤30字）" }
  ]
}

硬性纪律（务必遵守）：
1. **优先平凡日常场所**——便利店、面包坊、澡堂、洗衣店、站台、小饭馆、文具店、报刊亭……
   不要空泛奇观（"宏伟的中央广场""神秘的古代遗迹"这类勿用）。
2. **店名要「意象 + 功能热词」融合**：名字里同时装着画面和梗，且梗必须**从这家店的功能里自然长出来**。
   好例：澡堂=「班味清零汤」、汽水铺=「童年一响」、洗衣店=「出厂设置」、咖啡=「续命一刻」。
   坏例（禁用）：白月光、emo、精神SPA 这类与功能脱节的硬贴；也不要「XXの店」这种空名。
3. **只写地点本身**：类型 + 一句生活气息即可。**绝对不要写人物、老板、店员、顾客的剧情或前史**。
4. **不出现日文假名**，也不要用中式刻板语汇（面馆、大排档、里弄、茶摊、赊账本、老字号）。
5. 这几个生活地点之间**不要同质堆叠**（别开三家便利店）；类型要分散，
   **零售 / 餐饮 / 服务**至少各覆盖到（配套类可选）。
6. 贴合 <world_setting> 的底色（若世界观有独特的货币/生物/职业/现象，可自然地体现在店名或 blurb 里）。
7. **它们要能合理存在于这个地点里**：这个地点是商场就别全是街边摊，是车站就别全是住宅配套。
${existing.length ? `\n【已经有的（**严禁重复**，名字不要撞）】${existing.join('、')}` : ''}${siblings.length ? `\n【同层的其它地点已用过这些名字（尽量避开）】${siblings.slice(0, 20).join('、')}` : ''}`;
}

/** 把 `null` / `''` / `0` / `'0'` 统一成"无父级"，其余转成数字 */
function normalizeParentId(v) {
  if (v === null || v === undefined || v === '' || v === 0 || v === '0') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ═══════════════════════════════════════════════════════════
// AI：修正地点（参考图 / 文字要点 → 重写 类型+简介+英文画面描述）
//
// 用户 2026-10-07 口径：**明确要求照「角色 → 修正外观」那一套做**，并给出了样式参考。
// 所以这里刻意与 `routes/characters.js` 的 `refine-appearance-draft` /
// `expand-appearance-draft` 保持**同构**（同样两条入口、同样"只出草稿不落库"、
// 同样把可编辑结果回传由前端回填），便于两边一起维护。
//
// 与「✨ AI 生成画面描述」的区别：
//   · `generateScenePrompt` → 只补 `scene_prompt` **一个字段**，输入是用户已写好的中文。
//   · `refinePlaceDraft`（本函数）→ 依据参考图或要点，**重写整条地点的可描述字段**
//     （类型 / 一句话简介 / 英文画面描述），输入是"图"或"零散要点"。
// ═══════════════════════════════════════════════════════════

/**
 * 修正地点的公共语料：把这个地点在树里的位置、以及**兄弟地点**的名字给它，
 * 让它写出来的东西"落在这张图的语境里"，而不是凭空一座城。
 *
 * ⚠ 兄弟地点只给**名字**（不给简介）—— 给多了模型会去复读别人的描述。
 */
function buildPlaceCorpus(place, db) {
  const parent = place.parent_id
    ? db.prepare('SELECT name, kind, summary FROM world_map_places WHERE id = ?').get(place.parent_id)
    : null;
  const siblings = place.parent_id
    ? db.prepare('SELECT name, kind FROM world_map_places WHERE parent_id = ? AND id != ? ORDER BY sort_order LIMIT 10')
      .all(place.parent_id, place.id)
    : db.prepare('SELECT name, kind FROM world_map_places WHERE map_id = ? AND parent_id IS NULL AND id != ? ORDER BY sort_order LIMIT 10')
      .all(place.map_id, place.id);
  const map = db.prepare('SELECT name FROM world_maps WHERE id = ?').get(place.map_id);
  const lines = [];
  if (map?.name) lines.push(`所属地图：${map.name}`);
  if (parent) lines.push(`上级地点：「${parent.name}」${parent.kind ? `（${parent.kind}）` : ''}${parent.summary ? ` —— ${parent.summary}` : ''}`);
  if (siblings.length) {
    lines.push(`同层的其它地点：${siblings.map(s => `${s.name}${s.kind ? `（${s.kind}）` : ''}`).join('、')}`);
  }
  return lines.join('\n');
}

/** 修正地点的 system 提示词（图片模式与文字模式共用的部分） */
const REFINE_PLACE_SYSTEM_PROMPT = `你是虚构世界的地理设定助手。用户会给你一个**已有地点**的当前信息（可能还有一张参考图），请重写它的可描述字段。

【输出三个字段，只输出 JSON】
{
  "kind": "类型（≤8字，如 商店街 / 站台 / 公园 / 河岸 / 居民街 / 地标 / 中庭）",
  "summary": "一句话交代这块地方长什么样、什么人来、什么时候最热闹（中文，≤60字）",
  "scene_prompt": "英文画面描述（见下方硬性要求）"
}

【铁律】
1. **忠实于用户给的信息**：用户给了参考图就以图为准，用户给了文字要点就只按要点改。
   用户**没有要求改**的部分保持原样，不要借机重写一遍。
2. 地点名（name）**不归你管**，不要动它、也不要在输出里重复它。
3. 不要编造人物。这里只描述"地方"，老板/店员/顾客的剧情或前史一律不写。
4. 贴合已有的语境：写出来的东西要能落在它上级地点与同层地点的语境里，不要凭空造一座城。

【scene_prompt 的硬性要求（它要被喂给英文生图模型，写错会直接污染画面）】
- **全英文输出**，不得出现任何中文字符。专有名词/设定词（如"愿力""星穹"）也要意译或音译
  （如 willpower / astral），宁可用近义词也不要留中文。
- 只写**画面本身**：环境、光线、材质、天气、氛围、色调、建筑/陈设细节。
- **绝对不要写人**（不要出现 person/girl/man；环境必然有人流时用 crowd 也要克制）。
- 40 个英文词以内，用逗号分隔的短语堆叠风格（插画站常用写法），不要完整句子。

只输出 JSON，不要任何解释。`;

/**
 * 修正地点 · 图片模式：观察参考图重写该地点的字段。
 *
 * @param {{placeId:number, image:string, hints?:string}} input  `image` 是 dataURL
 * @returns {Promise<{ok:true, kind:string, summary:string, scenePrompt:string}>}
 */
export async function refinePlaceFromImage({ placeId, image = '', hints = '' } = {}) {
  const db = getDb();
  const place = db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(Number(placeId));
  if (!place) throw Object.assign(new Error('地点不存在'), { statusCode: 404 });

  const m = String(image).match(/^data:image\/(png|jpeg|webp);base64,/i);
  if (!m) throw Object.assign(new Error('请上传 PNG / JPG / WEBP 图片'), { statusCode: 400 });
  if (String(image).length > 8 * 1024 * 1024) {
    throw Object.assign(new Error('图片过大，请压缩后再上传（不超过 6MB）'), { statusCode: 400 });
  }

  const corpus = buildPlaceCorpus(place, db);
  const world = (() => { try { return getWorldSetting(); } catch { return ''; } })();

  const textPart = [
    `当前地点「${place.name}」的已有信息（供参考，以图为准）：`,
    `类型：${place.kind || '（未填）'}`,
    `一句话简介：${place.summary || '（未填）'}`,
    corpus,
    hints.trim() ? `\n【用户特别要求】${hints.trim()}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await chatSync([
      { role: 'system', content: getSystemRules({ roleplay: false }) },
      { role: 'system', content: REFINE_PLACE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${textPart}\n\n参考图如下，请据此重写这个地点。` },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ], { temperature: 0.3, max_tokens: 700, response_format: { type: 'json_object' }, label: `worldmap:refine-img:${place.name}` });
    return { ok: true, ...absorbPlaceRefine(res) };
  } catch (err) {
    throw translateVisionError(err);
  }
}

/**
 * 修正地点 · 文字模式：按用户给的零散要点扩写。
 * 与图片模式同一套输出契约（三个字段），只是输入换成文字。
 */
export async function refinePlaceFromText({ placeId, brief = '', hints = '' } = {}) {
  const db = getDb();
  const place = db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(Number(placeId));
  if (!place) throw Object.assign(new Error('地点不存在'), { statusCode: 404 });

  const b = String(brief || '').trim();
  if (!b) throw Object.assign(new Error('请先写下你想要的要点'), { statusCode: 400 });

  const corpus = buildPlaceCorpus(place, db);
  const res = await chatSync([
    { role: 'system', content: getSystemRules({ roleplay: false }) },
    { role: 'system', content: REFINE_PLACE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `当前地点「${place.name}」的已有信息：
类型：${place.kind || '（未填）'}
一句话简介：${place.summary || '（未填）'}
${corpus}

【用户给出的要点（必须全部体现在结果里，没说到的部分由你补全成完整描述）】
${b}
${hints.trim() ? `\n【用户特别要求】${hints.trim()}` : ''}`,
    },
  ], { temperature: 0.7, max_tokens: 700, response_format: { type: 'json_object' }, label: `worldmap:refine-txt:${place.name}` });
  return { ok: true, ...absorbPlaceRefine(res) };
}

/**
 * 收口模型返回：解析 JSON 并归一化三个字段。
 *
 * ⚠ `scene_prompt` 的 CJK 清洗不可省 —— 实测模型即便被明确要求"全英文"，
 * 仍会漏一两个中文词（吐过 "dazzling愿力 glow"），而这段文字是**直接喂生图模型**的。
 * 与 `generateScenePrompt` 用同一套清洗，避免两条链路口径不一致。
 */
function absorbPlaceRefine(raw) {
  const jsonStr = extractFirstJson(String(raw || ''));
  const obj = jsonStr ? safeParse(repairJson(jsonStr), null) : null;
  const kind = clampText(obj?.kind || '', 20);
  const summary = clampText(obj?.summary || '', 600);
  let scenePrompt = clampText(obj?.scene_prompt || '', 400);
  scenePrompt = scenePrompt.replace(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/g, ' ')
    .replace(/\s*,\s*/g, ', ').replace(/(?:,\s*){2,}/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  // 三个字段全空 = 模型没产出可用内容（不是"用户想要清空"）→ 抛错，别静默把表单清空
  if (!kind && !summary && !scenePrompt) {
    throw Object.assign(new Error('模型没能读出可用的地点信息，请重试或换一张更清晰的图片'), { statusCode: 502 });
  }
  return { kind, summary, scenePrompt };
}

/**
 * 中转站对「模型不支持图片输入」的报错措辞五花八门，常见是 400/404 且 body 为空。
 * 关键词匹配不到就按状态码兜底识别 —— 与 `routes/characters.js` 的修正外观同一策略，
 * 命中即给出"去设置里换视觉模型"的可执行提示（原始报错留在括号里便于排查）。
 */
function translateVisionError(err) {
  const status = err?.status || err?.response?.status || err?.statusCode;
  const rawMsg = String(err?.message || '');
  if (status === 400 || status === 404 || /image|vision|multimodal|visual|image_url|content part/i.test(rawMsg)) {
    return Object.assign(new Error(
      `当前配置的 LLM API 不支持图片输入，请在设置中更换支持视觉（图片输入）的模型后重试（上游返回：${rawMsg || status}）`,
    ), { statusCode: 500 });
  }
  return err;
}

/**
 * 归一化坐标（0~1）。非法输入返回 `fallback`（保持原值，不做猜测）。
 * `-1` 是"未摆放"哨兵值，原样放行。
 */
function normalizeUnit(v, fallback = -1) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return -1;                       // 负值一律视为"未摆放"
  return Math.min(1, Math.max(0, n));
}

/**
 * 移动一个地点到新父级下（含整棵子树的 `level` 重算）。
 * 校验三件事，任一不过就整笔回滚（在 `upsertPlace` 的事务里）：
 *   ① 目标父级必须存在、且在**同一张图**内
 *   ② 不能移到自己或自己的**子孙**下（成环 → 子树脱离树，等于数据丢失）
 *   ③ 目标父级 == 当前父级 → 视为无变化
 */
function movePlace(placeId, rawParentId, cur) {
  const db = getDb();
  const parentId = normalizeParentId(rawParentId);

  if (parentId === cur.parent_id) return { ok: true, moved: false };
  if (parentId === placeId) return { ok: false, error: '不能把地点移动到它自己下面' };

  let parent = null;
  if (parentId !== null) {
    parent = db.prepare('SELECT * FROM world_map_places WHERE id = ? AND map_id = ?').get(parentId, cur.map_id);
    if (!parent) return { ok: false, error: '目标上级地点不存在' };

    // ★ 成环检测：沿 parent 往上走，撞到自己就拒绝
    //   （用带步数上限的循环而不是递归 —— 数据一旦已成环，递归会无限转）
    let walker = parent;
    for (let i = 0; i < 200 && walker; i++) {
      if (walker.id === placeId) return { ok: false, error: '不能把地点移动到它自己的下级里' };
      walker = walker.parent_id
        ? db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(walker.parent_id)
        : null;
    }
  }

  const newLevel = parent ? parent.level + 1 : LEVEL.REGION;
  const delta = newLevel - cur.level;

  // 新父级下排到最后（保持用户原有序：搬家 = 追加，不插队）
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM world_map_places WHERE map_id = ? AND COALESCE(parent_id, 0) = COALESCE(?, 0)'
  ).get(cur.map_id, parentId).m;

  db.prepare('UPDATE world_map_places SET parent_id = ?, level = ?, sort_order = ? WHERE id = ?')
    .run(parentId, newLevel, maxOrder + 1, placeId);

  // 整棵子树跟着位移（level 是冗余列，不重算的话"大区/子区/场景"计数与排序全错）
  if (delta !== 0) {
    const descendants = db.prepare(`
      WITH RECURSIVE sub(id) AS (
        SELECT id FROM world_map_places WHERE parent_id = ?
        UNION ALL
        SELECT p.id FROM world_map_places p JOIN sub s ON p.parent_id = s.id
      )
      SELECT id FROM sub
    `).all(placeId).map(r => r.id);
    if (descendants.length) {
      const upd = db.prepare('UPDATE world_map_places SET level = level + ? WHERE id = ?');
      for (const id of descendants) upd.run(delta, id);
    }
  }
  return { ok: true, moved: true };
}

/** 手动新增一个地点（层级由父节点推导） */
export function addPlace(mapId, {
  parentId = null, name, nameEn = '', kind = '', summary = '', pois = [],
  access = '', zone = '', category = '', scenePrompt = '', openAt = '', closeAt = '',
} = {}) {
  const db = getDb();
  const map = db.prepare('SELECT * FROM world_maps WHERE id = ?').get(mapId);
  if (!map) return { ok: false, error: '地图不存在' };
  let level = LEVEL.REGION;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM world_map_places WHERE id = ? AND map_id = ?').get(parentId, mapId);
    if (!parent) return { ok: false, error: '父地点不存在' };
    // 层级不限深 —— 真实项目有「二维市 → 珠星集团总部大楼 → 1F 展示大厅 → IP 产品展示厅」这种嵌套
    level = parent.level + 1;
  }
  const clean = clampText(name, 40);
  if (!clean) return { ok: false, error: '名称必填' };
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM world_map_places WHERE map_id = ? AND level = ? AND COALESCE(parent_id, 0) = COALESCE(?, 0)'
  ).get(mapId, level, parentId).m;
  const key = uniqueKey(mapId, toKey(nameEn || name, `p${Date.now()}`));
  const r = db.prepare(`INSERT INTO world_map_places
      (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order,
       access, zone, category, scene_prompt, open_at, close_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    mapId, parentId, level, key, clean, clampText(nameEn, 60), clampText(kind, 20),
    clampText(summary, 600), JSON.stringify(normalizePois(pois)), maxOrder + 1,
    normalizeAccess(access), normalizeZone(zone), clampText(category, 20),
    clampText(scenePrompt, 400), normalizeClock(openAt), normalizeClock(closeAt));
  touchMap(mapId);
  return { ok: true, place: mapPlaceRow(db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(Number(r.lastInsertRowid))) };
}

/** 删除一个地点（有子级时一并删，靠外键 CASCADE） */
export function deletePlace(placeId) {
  const db = getDb();
  const cur = db.prepare('SELECT map_id FROM world_map_places WHERE id = ?').get(placeId);
  if (!cur) return { ok: false, error: '地点不存在' };
  db.prepare('DELETE FROM world_map_places WHERE id = ?').run(placeId);
  touchMap(cur.map_id);
  return { ok: true };
}

function touchMap(mapId) {
  try { getDb().prepare('UPDATE world_maps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(mapId); } catch { /* ignore */ }
}

/** 同一张图内 key 唯一（DB 没做唯一约束，这里在写入前保证） */
function uniqueKey(mapId, base) {
  const db = getDb();
  const taken = new Set(db.prepare('SELECT key FROM world_map_places WHERE map_id = ?').all(mapId).map(r => r.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now()}`;
}

// ═══════════════════════════════════════════════════════════
// AI：① 骨架（L1 + L2）
// ═══════════════════════════════════════════════════════════

/**
 * 生成地图骨架：L1 大地区 + L2 子地区。
 *
 * **刻意只出这两层** —— 用户先看到「这个世界由哪几块组成」，
 * 确认方向对了再去展开细节。一次吐完整座城市既慢又难改。
 *
 * @param {number} mapId
 * @param {{ brief?: string, regionCount?: number, districtPerRegion?: number }} opts
 *   brief：用户的一句话补充（如"我想做一个港口城市，重工业和渔业"），可空
 */
export async function generateSkeleton(mapId, { brief = '', regionCount = 2, districtPerRegion = 3 } = {}) {
  const db = getDb();
  const map = db.prepare('SELECT * FROM world_maps WHERE id = ?').get(mapId);
  if (!map) throw new Error('地图不存在');

  const world = getWorldSetting();
  if (!world) throw new Error('没有激活的世界观，请先在「世界观设置」里启用一个');

  const msgs = [
    { role: 'system', content: getSystemRulesWithWorld() || '你是一个世界观设定师。' },
    { role: 'system', content: SKELETON_FORMAT(regionCount, districtPerRegion) },
    { role: 'user', content: buildSkeletonUserMsg(map, brief) },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0.9, max_tokens: 1600,
    response_format: { type: 'json_object' }, label: 'worldmap:骨架',
  });
  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('模型未返回 JSON');
  const draft = normalizeSkeleton(safeParse(repairJson(jsonStr), null));

  // 写库：整体替换该图的 L1/L2（保留 L3 由调用方决定 —— 骨架重生成等于重开，先清干净）
  db.prepare('DELETE FROM world_map_places WHERE map_id = ?').run(mapId);
  const ins = db.prepare(`INSERT INTO world_map_places (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`);
  const tx = db.transaction(() => {
    draft.regions.forEach((rg, ri) => {
      const key = uniqueKey(mapId, toKey(rg.key, `region${ri + 1}`));
      const rid = Number(ins.run(mapId, null, LEVEL.REGION, key, rg.name, rg.name_en, rg.kind, rg.summary, ri).lastInsertRowid);
      rg.districts.forEach((d, di) => {
        ins.run(mapId, rid, LEVEL.DISTRICT, uniqueKey(mapId, toKey(d.key, `${key}_d${di + 1}`)),
          d.name, d.name_en, d.kind, d.summary, di);
      });
    });
  });
  tx();
  touchMap(mapId);
  console.log(`[worldmap] 骨架已生成 #${mapId}：${draft.regions.length} 大地区 / ${draft.regions.reduce((n, r) => n + r.districts.length, 0)} 子地区`);
  return { ok: true, map: getMap(mapId) };
}

function buildSkeletonUserMsg(map, brief) {
  const note = map.note ? `\n这张地图的总体定位：${map.note}` : '';
  const extra = brief ? `\n用户的补充要求（优先满足）：${brief}` : '';
  return `请为这个世界设计**地理骨架**（只要大地区和子地区两级，先不要场景细节）。
地图名：${map.name}${note}${extra}

要求：
- 只要"这个世界由哪几块组成"这一层；每块的 summary 一句话说清它是个什么样的地方。
- 各块之间要有**明显差异**（地理/产业/氛围），不要同质化。
- 贴合 <world_setting>，不要写成现实世界或通用奇幻。`;
}

function normalizeSkeleton(raw) {
  const regions = (Array.isArray(raw?.regions) ? raw.regions : [])
    .map((r, i) => ({
      key: String(r?.key || ''), name: clampText(r?.name, 24), name_en: clampText(r?.name_en, 48),
      kind: clampText(r?.kind, 16), summary: clampText(r?.summary, 200),
      districts: (Array.isArray(r?.districts) ? r.districts : [])
        .map(d => ({
          key: String(d?.key || ''), name: clampText(d?.name, 24), name_en: clampText(d?.name_en, 48),
          kind: clampText(d?.kind, 16), summary: clampText(d?.summary, 200),
        }))
        .filter(d => d.name).slice(0, 6),
    }))
    .filter(r => r.name).slice(0, 4);
  if (!regions.length) throw new Error('模型没产出可用的大地区，请重试');
  // 至少要有子地区，否则骨架没意义
  if (!regions.some(r => r.districts.length)) throw new Error('模型没产出子地区，请重试');
  return { regions };
}

function SKELETON_FORMAT(regionCount, districtPerRegion) {
  return `请严格按以下 JSON 格式输出，不要任何解释或 JSON 以外的文字：

{
  "regions": [
    {
      "key": "英文短标识（小写无空格，如 civic / harbor）",
      "name": "大地区名（中文意象名，4~8字）",
      "name_en": "官方风格的英文合成意译名（词缀构词，如 Duomension City）",
      "kind": "类型标签（如 核心区 / 港区 / 工业带 / 学院区 / 娱乐区）",
      "summary": "一句话说清这是个什么样的地方（≤50字，写地理与产业特征，不写剧情）",
      "districts": [
        {
          "key": "英文短标识",
          "name": "子地区名（中文意象名，3~6字）",
          "name_en": "对应的英文合成意译名",
          "kind": "类型标签（如 居住区 / 商业街 / 车站 / 河岸）",
          "summary": "一句话说明（≤50字）"
        }
      ]
    }
  ]
}

数量：大地区 **${regionCount} 个**左右，每个大地区下 **${districtPerRegion} 个子地区**左右（可±1，但别差太多）。
命名纪律：
- 地点级名字一律「**中文意象名 + 英文合成意译名**」成对出现 —— 英文名用词缀构词承载意象，不要拼音、不要直译、不要中文互联网腔。
- **不出现日文假名**，也不必用日式词汇硬凑。
- 不要写人物、剧情、店铺 —— 这一层只定地理。`;
}

// ═══════════════════════════════════════════════════════════
// AI：② 逐区细化（L3 场景 + POI）
// ═══════════════════════════════════════════════════════════

/**
 * 展开一个子地区：产出它的 L3 场景，每个场景带 POI 清单。
 * 幂等：重复调用会**整体替换**该子地区下的场景（用户点"换一批"就是这行为）。
 */
export async function expandPlace(placeId) {
  const db = getDb();
  const place = db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(placeId);
  if (!place) throw new Error('地点不存在');
  // 任何层级都能展开（AI 给它补下一级）—— 不再限定"只有子地区"

  const map = db.prepare('SELECT * FROM world_maps WHERE id = ?').get(place.map_id);
  const parent = place.parent_id ? db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(place.parent_id) : null;
  const world = getWorldSetting();
  if (!world) throw new Error('没有激活的世界观');

  const msgs = [
    { role: 'system', content: getSystemRulesWithWorld() || '你是一个世界观设定师。' },
    { role: 'system', content: SCENE_FORMAT() },
    { role: 'user', content: `请展开这个${levelLabel(place.level)}：**${place.name}**${place.name_en ? `（${place.name_en}）` : ''}
${parent ? `它属于「${parent.name}」。` : ''}${place.summary ? `它的定位：${place.summary}` : ''}

请给出它下面的**子地点**（可理解为街区 / 地标 / 建筑 / 一片区域），以及每个子地点里的**生活地点（POI）**。` },
  ];

  const raw = await chatSync(msgs, {
    temperature: 0.9, max_tokens: 2600,
    response_format: { type: 'json_object' }, label: `worldmap:${place.name}`,
  });
  const jsonStr = extractFirstJson(raw);
  if (!jsonStr) throw new Error('模型未返回 JSON');
  const scenes = normalizeScenes(safeParse(repairJson(jsonStr), null));
  if (!scenes.length) throw new Error('模型没产出可用场景，请重试');

  const ins = db.prepare(`INSERT INTO world_map_places
      (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order, access, zone, category, scene_prompt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM world_map_places WHERE parent_id = ?').run(placeId);   // 幂等：换一批 = 整体替换
    scenes.forEach((s, i) => {
      ins.run(place.map_id, placeId, LEVEL.SCENE, uniqueKey(place.map_id, toKey(s.key, `scene${i + 1}`)),
        s.name, s.name_en, s.kind, s.summary, JSON.stringify(s.pois), i,
        // ★ 这几个字段由 AI 一并产出（问题 3 的「AI 自动匹配」）：
        //   access/zone 是枚举、非法值落空串；scene_prompt 是生图用的英文场景描述。
        normalizeAccess(s.access), normalizeZone(s.zone),
        clampText(s.category, 20), clampText(s.scene_prompt, 400));
    });
  });
  tx();
  touchMap(place.map_id);
  const poiTotal = scenes.reduce((n, s) => n + s.pois.length, 0);
  console.log(`[worldmap] 展开「${place.name}」：${scenes.length} 场景 / ${poiTotal} POI`);
  return { ok: true, map: getMap(place.map_id), placeId };
}

function SCENE_FORMAT() {
  return `请严格按以下 JSON 格式输出，不要任何解释或 JSON 以外的文字：

{
  "scenes": [
    {
      "key": "英文短标识（小写无空格）",
      "name": "场景名（中文意象名，4~10字）",
      "name_en": "英文合成意译名（词缀构词）",
      "kind": "类型（如 商店街 / 站台 / 公园 / 河岸 / 居民街 / 学校）",
      "summary": "一句话交代这块地方长什么样、什么人来、什么时候最热闹（≤60字）",
      "category": "功能分类（商店街 / 商业设施 / 公园 / 文化 / 餐饮 / 居住 / 地标 / 交通）",
      "access": "public | restricted | private | time_window",
      "zone": "residence | activity | private_transit",
      "scene_prompt": "英文场景描述（供生图用，只写画面：环境、光线、材质、氛围，≤40词，不要写人）",
      "pois": [
        { "name": "店名／地点名（中文，意象＋功能热词融合，2~7字）", "type": "零售|餐饮|服务|配套", "blurb": "一句话说清它是什么、有什么生活气息（≤30字）" }
      ]
    }
  ]
}

**场景数量：4~7 个**。

每个场景的 **pois：6~9 个**，且必须**同时覆盖 零售、餐饮、服务 三大类各至少 1 个**（配套类可选）。

**结构化字段的判定标准（重要，日程生成会按这些字段过滤与联动服装）**：
- access：绝大多数是 public。写 restricted **仅限**「谢绝外人 / 需要身份才能进」的地方
  （例：私人公司总部、需要许可的机构、非开放期不对外的地方）；写 private 仅限
  「属于某个具体角色的私人空间」（例：某人的单身公寓、私人卧室）；写 time_window
  **仅限**「开放有明显时段性且白天基本关着」的地方（夜市、深夜档、只在特定时段开的店）。
  **不确定就写 public** —— 宁可放宽，不要把话说死。
- zone：residence 只给「有人真的住在这儿」的地方（住宅楼、宿舍、公寓）；
  **主要活动地（商店街、车站、公园、学校）一律 activity**；private_transit 只给
  「洗浴 / 更衣」这类必然不穿衣服的场所，很少用。
- scene_prompt：**只描述画面本身**，供生图模型用。写环境、光线、材质、季节、氛围、
  建筑风格与店招细节；**不要出现人物**（人物由角色外观另供）。全英文。

硬性纪律（务必遵守）：
1. **优先平凡日常场所**——便利店、面包坊、澡堂、洗衣店、站台、小饭馆、文具店、报刊亭……
   不要空泛奇观（"宏伟的中央广场""神秘的古代遗迹"这类勿用）。
2. **店名要「意象 + 功能热词」融合**：名字里同时装着画面和梗，且梗必须**从这家店的功能里自然长出来**。
   好例：澡堂=「班味清零汤」、汽水铺=「童年一响」、洗衣店=「出厂设置」、咖啡=「续命一刻」。
   坏例（禁用）：白月光、emo、精神SPA 这类与功能脱节的硬贴；也不要「XXの店」这种空名。
3. **只写地点本身**：类型 + 一句生活气息即可。**绝对不要写人物、老板、店员、顾客的剧情或前史**。
4. **不出现日文假名**，也不要用中式刻板语汇（面馆、大排档、里弄、茶摊、赊账本、老字号）。
5. 地点名与场景名不要重复；同一个子地区内的 POI 不要同质堆叠（别开三家便利店）。
6. 贴合 <world_setting> 的底色（若世界观有独特的货币/生物/职业/现象，可自然地体现在店名或 blurb 里）。`;
}

function normalizeScenes(raw) {
  return (Array.isArray(raw?.scenes) ? raw.scenes : [])
    .map(s => ({
      key: String(s?.key || ''),
      name: clampText(s?.name, 30),
      name_en: clampText(s?.name_en, 60),
      kind: clampText(s?.kind, 16),
      summary: clampText(s?.summary, 240),
      pois: normalizePois(s?.pois),
      // 结构化属性（AI 一并产出；非法值在写入侧落空串）
      access: s?.access,
      zone: s?.zone,
      category: clampText(s?.category, 20),
      scene_prompt: clampText(s?.scene_prompt, 400),
    }))
    .filter(s => s.name)
    .slice(0, MAX_SCENES_PER_DISTRICT);
}

function normalizePois(list) {
  return (Array.isArray(list) ? list : [])
    .map(p => ({
      name: clampText(p?.name, 24),
      type: POI_TYPES.includes(String(p?.type || '').trim()) ? String(p.type).trim() : '配套',
      blurb: clampText(p?.blurb, 80),
    }))
    .filter(p => p.name)
    .slice(0, POI_MAX);
}

/**
 * 导出为 Markdown（给用户贴回知识库用）。
 * 纯格式化，不调 LLM。
 */
/**
 * 导出整张地图为 Markdown。
 *
 * ⚠ 必须**递归**：层级不限深，早先这里是硬编码三层循环（`rg → d → s`），
 * 结果 ① 子地区自己带的 POI 不导出（如「喜悲街」这种本身就是一条街的节点）、
 * ② 第 4 层及以后整个丢失。树的渲染、展开都已支持任意深度，导出不能落后。
 */
export function exportMarkdown(mapId) {
  const map = getMap(mapId);
  if (!map) return null;
  const L = [];
  L.push(`# ${map.name}`);
  if (map.note) L.push('', `> ${map.note}`);
  L.push('', `共 ${map.stats.region} 大地区 / ${map.stats.district} 子地区 / ${map.stats.scene} 场景 / ${map.stats.poi} 生活地点`, '');

  // Markdown 只到 ######（6 级）；再深就用加粗 + 缩进，避免溢出成纯文本
  const heading = (depth, text) => depth <= 5 ? `${'#'.repeat(depth + 1)} ${text}` : `${'  '.repeat(depth - 5)}- **${text}**`;

  const walk = (node, depth) => {
    const en = node.name_en ? ` · ${node.name_en}` : '';
    const kind = node.kind ? `　*${node.kind}*` : '';
    L.push('', heading(depth, `${node.name}${en}${kind}`));
    if (node.summary) L.push('', node.summary);
    // 生活地点挂在**任意层级**上（该节点本身是条街/市集时就没有下级）
    if (node.pois?.length) {
      L.push('', '| 生活地点 | 类型 | 气息 |', '|:--|:--|:--|');
      for (const p of node.pois) L.push(`| ${p.name} | ${p.type} | ${p.blurb || ''} |`);
    }
    for (const c of node.children || []) walk(c, depth + 1);
  };
  for (const rg of map.tree) walk(rg, 1);
  return L.join('\n');
}

// ═══════════════════════════════════════════════════════════
// 日程侧的地点属性查询（准入 / 分区 / 场景提示词）
//
// ⚠ 这是**唯一真源**：日程注入与前端弹窗都走这里，不要在 routes/schedule.js
//   里另写一份过滤逻辑 —— 否则两处口径迟早漂移（项目红线 8）。
// ═══════════════════════════════════════════════════════════

/**
 * 取「某区域下可用于日程的地点」及其属性。
 *
 * ⚠ 这是**唯一真源**：日程注入与前端弹窗都走这里，不要在 routes/schedule.js
 *   里另写一份过滤逻辑 —— 否则两处口径迟早漂移（项目红线 8）。
 *
 * @param {string} areaName 子区名（level 2）
 * @param {number|null} mapId
 * @returns {Array<{id,name,kind,category,access,zone,scene_prompt,summary,reason}>}
 */
export function listAreaPlaceAttrs(areaName, mapId = null) {
  const { areas } = listAreasForSchedule(mapId);
  const area = areas.find(a => a.name === areaName);
  return area?.places ?? [];
}

/**
 * ★★ 判断一个节点是否可以直接作为「日程地点」使用 —— **不看它的 level 数值**。
 *
 * ── 为什么不能写 `level === 3`（2026-10-07 用户实报的 bug 根因）────────
 * 用户新建「二相乐园之外 → 托帕的私人生态舰」后，**该区在编排日程里一个地点都不出现**。
 * 实测 DB：它的子节点里两个是 `level=3`、**三个是 `level=4`**（用户曾在更深处建过东西，
 * 或节点被迁移过；`level` 是冗余列，历史数据可能不准）。
 * 而 `listAreasForSchedule` 原来硬过滤 `s.level === LEVEL.SCENE`：
 *   · 三个 lv4 地点被**静默丢弃**（用户只会看到"这个区点不开/没内容"）；
 *   · 更糟的是 lv3 的节点若自己还有孩子（实测「鸽川区」下 `鸽川河与滨河道`、
 *     `狸狸周刊报社` 都有子节点），会被当成"地点"塞进去，但它其实是个**容器**。
 *
 * 正确判据是**结构性的、与具体世界观和层级深度都无关**：
 *   · 有子节点 → 它是**中间层**，继续往下走（下钻），不作为候选集本身；
 *   · 无子节点 → 它是**叶子**，可以作为日程地点。
 * 这样「二维市→鸽川区→场景」和「生态舰→甲板→货运巷」两种深度都能正确工作，
 * 也让新加的世界观无需迁就引擎假设的层数。
 *
 * @param {{children?:Array}} node 树节点（必须带 children；扁平行请先用 buildTree）
 * @returns {boolean}
 */
function isSchedulePlaceNode(node) {
  return !(node?.children?.length > 0);
}

/**
 * 递归收集一个子树里**所有叶子节点**（可作日程地点的那些）。
 *
 * ⚠ 深度上限 `MAX_PLACE_DEPTH` 是防环护栏而非层级限制：`level` 是冗余列、
 *    `parent_id` 才是结构真源，历史数据一旦成环，无上限递归会栈溢出。
 *
 * @param {Array} nodes 待遍历的节点
 * @param {number} depth 当前深度（仅用于护栏与可读性）
 * @returns {Array} 叶子节点（含其原始字段）
 */
function collectLeafPlaceNodes(nodes, depth = 0) {
  const out = [];
  if (depth > MAX_PLACE_DEPTH) return out;
  for (const n of (nodes || [])) {
    if (isSchedulePlaceNode(n)) out.push(n);
    else out.push(...collectLeafPlaceNodes(n.children, depth + 1));
  }
  return out;
}

/** 列出可作为日常活动区域的子区（含其下地点属性）——日程弹窗与注入共用 */
export function listAreasForSchedule(mapId = null) {
  let id = Number(mapId) || null;
  if (!id) id = listMaps()[0]?.id ?? null;
  if (!id) return { mapId: null, mapName: '', areas: [] };
  const map = getMap(id);
  if (!map || !Array.isArray(map.tree)) return { mapId: null, mapName: '', areas: [] };
  const areas = [];
  for (const region of map.tree) {
    for (const district of region.children ?? []) {
      // ★ 见 isSchedulePlaceNode 的说明：判据是"有没有子节点"，不是 level 数值。
      //   过度深度的容器会被自动下钻，lv3/lv4 的叶子一视同仁地收进来。
      const places = collectLeafPlaceNodes(district.children ?? [])
        .map(s => ({
          id: s.id, name: s.name, kind: s.kind || '', category: s.category || '',
          access: normalizeAccess(s.access), zone: normalizeZone(s.zone),
          scene_prompt: s.scene_prompt || '', summary: s.summary || '',
          open_at: s.open_at || '', close_at: s.close_at || '',
          reason: accessReason(s),
        }));
      areas.push({
        id: district.id, name: district.name, region: region.name,
        kind: district.kind || '',
        access: normalizeAccess(district.access), zone: normalizeZone(district.zone),
        places,
      });
    }
  }
  return { mapId: map.id, mapName: map.name, areas };
}

/**
 * ★★ 唯一真源：判定一个地点的**实际准入**（含父区继承）。
 *
 * ── 为什么必须抽成函数（2026-10-07）────────────────────────
 * 这条口径原本有**两份实现**：`pickSchedulePlaces`（决定"生成时能不能去"）
 * 和 `routes/schedule.js` 的 `decorated`（决定"前端界面显示能不能去"）。
 * 两份一旦漂移，用户看到的就是"界面说能去、生成时去不了"——最难查的一类 bug。
 *
 * ── 继承规则（只继承 restricted）──────────────────────────
 * · `restricted`（谢绝外人／需身份）**继承**：整区谢绝外人时其下地点一并受限
 *   （`幻月秘庭` 是这种，必须继承）。
 * · `private`（某角色的私人空间）**不继承**：它是**归属**属性、是单点属性。
 *   一个区域标 private 只说明"这整块地方是某人的"，不代表它里面每个房间都是私人空间。
 * · 子项显式写 `public` 可解锁父级的受限（否则「车站谢绝外人」这种错会静默发生）。
 *
 * @param {string} ownAccess 该地点自己的 access
 * @param {string} parentAccess 所属子区的 access
 * @returns {{access:string, inherited:boolean}} 实际准入与"是否来自继承"
 */
export function resolveEffectiveAccess(ownAccess, parentAccess) {
  const own = normalizeAccess(ownAccess);
  if (own === 'public') return { access: own, inherited: false };   // 显式 public 解锁
  if (own !== '') return { access: own, inherited: false };         // 自己标了什么就是什么
  // 自己没标注 → 只有父级 restricted 才继承
  const pa = normalizeAccess(parentAccess);
  if (pa === 'restricted') return { access: pa, inherited: true };
  return { access: '', inherited: false };
}

/**
 * 从候选里挑出「本次可进提示词」的地点，并给出需要标注的例外。
 *
 * 规则（用户口径：「别去不合适的地方」）：
 *  - public / 未标注 → 进候选池
 *  - restricted / private → **默认不进**；但若用户**显式勾选**了它（`picked`），
 *    则**进池并带 `仅限…` 标注**（用户显式指令优先于自动过滤，与本项目其它「显式优先」口径一致）
 *  - time_window → 进池，但附开放时段，由模型自己核验
 *  - 用户**取消勾选**的地点一律排除（排除优先于一切）
 *
 * ⚠ 继承规则见 `resolveEffectiveAccess`（**只继承 restricted**）。
 *   ★★ 2026-10-07 用户实报的 bug 正是踩了这条：
 *   「翡翠的私人生态舰」在**区域级**标了 `private`，其下 7 个舱室自己都没标注，
 *   旧代码把 private 一路继承下去 → 7 个舱室全被标成「某角色的私人空间」不可去。
 *   语义上「典当品陈列长廊」是营业场所、「异星生态庭院」是景观舱，显然不该因为是
 *   "翡翠的船"就都进不去。
 *
 * @param {Array} places  来自 listAreaPlaceAttrs
 * @param {Set<string>} excluded 用户取消勾选的地点名
 * @param {string} [parentAccess] 所属子区的 access（**仅 restricted 参与继承**）
 * @param {Set<string>} [picked] 用户**显式勾选**（放行）的地点名 —— 受限点由此进池
 * @returns {{included:Array,excluded:Array,annotated:Array}} annotated = 被显式放行但需标注的
 */
export function pickSchedulePlaces(places = [], excluded = new Set(), parentAccess = '', picked = new Set()) {
  const included = [], excludedOut = [], annotated = [];
  for (const p of places) {
    const name = p?.name;
    if (!name) continue;
    if (excluded.has(name)) { excludedOut.push({ name, why: 'user-excluded' }); continue; }
    const { access } = resolveEffectiveAccess(p.access, parentAccess);
    // ★★ 用户**显式勾选**的受限地点：强制进池并标注。
    //   这一条曾经缺失 —— 勾选只生成了给模型看的"注释行"，地点名**没有进清单**，
    //   而清单渲染遇到"本区无可用地点"会整区跳过 → 用户看到的是"勾了完全没用"。
    //   显式指令必须真正落到候选集里，而不是只写一句说明（见 routes/schedule.js 的 forcedPlaces）。
    if (picked.has(name) && !isAccessibleByDefault(access) && access !== 'time_window') {
      // ⚠ 标注里必须写明"**本次用户已显式指定，可用**"：
      //   只说「某角色的私人空间」的话，模型看到"私人"就会自己把它排除掉，
      //   用户勾选的意思恰恰相反（"我就要它来这儿"）。显式指令要显式表达。
      const why = accessReason({ ...p, access }) || '仅限特定对象';
      const note = `${why}（**本次用户已显式指定，可用**）`;
      const item = { ...p, access, note };
      included.push(item); annotated.push(item);
      continue;
    }
    if (isAccessibleByDefault(access)) { included.push({ ...p, access, note: '' }); continue; }
    if (access === 'time_window') {
      const t = accessReason(p);
      const item = { ...p, access, note: t };
      included.push(item); annotated.push(item);
      continue;
    }
    // restricted / private：默认不进池，由调用方按「是否被显式勾选」决定是否放行
    excludedOut.push({ name, why: access, reason: accessReason({ ...p, access }) });
  }
  return { included, excluded: excludedOut, annotated };
}
