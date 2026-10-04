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

import { getDb, getWorldSetting, getSystemRulesWithWorld } from '../db/index.js';
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

/** 一次展开最多接受多少个场景（防模型失控吐几十个） */
const MAX_SCENES_PER_DISTRICT = 10;
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
      (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const idMap = new Map();   // 旧 id → 新 id
    for (const r of rows) {
      const newParent = r.parent_id ? (idMap.get(r.parent_id) ?? null) : null;
      const nid = Number(ins.run(mid, newParent, r.level, r.key, r.name, r.name_en, r.kind,
        r.summary, r.pois_json, r.sort_order).lastInsertRowid);
      idMap.set(r.id, nid);
    }
    return { ok: true, map: getMap(mid) };
  })();
}

/** 手动增改一个地点 */
export function upsertPlace(placeId, patch = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(placeId);
  if (!cur) return { ok: false, error: '地点不存在' };
  const pois = patch.pois !== undefined ? normalizePois(patch.pois) : safeParse(cur.pois_json, []);
  db.prepare(`UPDATE world_map_places SET name = ?, name_en = ?, kind = ?, summary = ?, pois_json = ?
    WHERE id = ?`).run(
    patch.name !== undefined ? (clampText(patch.name, 40) || cur.name) : cur.name,
    patch.name_en !== undefined ? clampText(patch.name_en, 60) : cur.name_en,
    patch.kind !== undefined ? clampText(patch.kind, 20) : cur.kind,
    patch.summary !== undefined ? clampText(patch.summary, 600) : cur.summary,
    JSON.stringify(pois), placeId);
  touchMap(cur.map_id);
  return { ok: true, place: mapPlaceRow(db.prepare('SELECT * FROM world_map_places WHERE id = ?').get(placeId)) };
}

/** 手动新增一个地点（层级由父节点推导） */
export function addPlace(mapId, { parentId = null, name, nameEn = '', kind = '', summary = '', pois = [] } = {}) {
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
  const r = db.prepare(`INSERT INTO world_map_places (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    mapId, parentId, level, key, clean, clampText(nameEn, 60), clampText(kind, 20),
    clampText(summary, 600), JSON.stringify(normalizePois(pois)), maxOrder + 1);
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

  const ins = db.prepare(`INSERT INTO world_map_places (map_id, parent_id, level, key, name, name_en, kind, summary, pois_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM world_map_places WHERE parent_id = ?').run(placeId);   // 幂等：换一批 = 整体替换
    scenes.forEach((s, i) => {
      ins.run(place.map_id, placeId, LEVEL.SCENE, uniqueKey(place.map_id, toKey(s.key, `scene${i + 1}`)),
        s.name, s.name_en, s.kind, s.summary, JSON.stringify(s.pois), i);
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
      "pois": [
        { "name": "店名／地点名（中文，意象＋功能热词融合，2~7字）", "type": "零售|餐饮|服务|配套", "blurb": "一句话说清它是什么、有什么生活气息（≤30字）" }
      ]
    }
  ]
}

**场景数量：4~7 个**。

每个场景的 **pois：6~9 个**，且必须**同时覆盖 零售、餐饮、服务 三大类各至少 1 个**（配套类可选）。

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
