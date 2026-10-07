/**
 * 建筑功能统一来源解析器（计划 §3）。
 *
 * 职责：把「当前地点 → 当前地图对象 → 对应素材」的关联解析成生成与执行共用的
 * 权威来源快照，并计算 sourceHash。关联路径永远走对象 ID，不按名字全库搜索。
 *
 * 输入优先级（计划 §3.1）：
 *   标题  location.name（实例上可改）→ 素材 name
 *   用途  location.feature_desc（用户手填，迁移补列）→ 素材 meta.desc → 空值（提示补充）
 * businessKind/ambient 只作弱提示，不进 sourceHash 的用途字段。
 * 建筑稳定实例 ID = location.key（重排时按 key 原地更新保留，计划 §7.1）。
 */
import { createHash } from 'node:crypto';
import { townError } from './townEventService.js';
import { registryVersion, SCHEMA_VERSION } from './townBuildingFeatureRegistry.js';
import { stateProfileCatalog } from './buildingFeatures/state.js';

/** 生成契约版本：提示词骨架/顶层格式变化时递增 */
export const GENERATION_CONTRACT_VERSION = 1;

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/** 绘图提示词启发式：实库的素材 desc 常是外观/构图 prompt，不是玩法用途描述
 *（计划 §3.1「不把建筑绘图用的 prompt 当作玩法用途」）。命中即不进用途字段。 */
const DRAWING_PROMPT_RE = /game sprite|isometric|white background|45 degree view|pixel art|tile ?set|orthographic|concept art|transparent background|no ground|character sheet/i;
export function isDrawingPrompt(desc) {
  return !!desc && DRAWING_PROMPT_RE.test(desc) && desc.length > 80;
}

/** location.object_id → 图层对象 → 素材行。地图对象 id 在重排时会变，location.key 才是稳定身份。 */
export function resolveBuildingAsset(db, location) {
  if (location.object_id == null) return null;
  const object = findMapObject(db, location.map_id, location.object_id);
  const assetId = Number(object?.assetId ?? NaN);
  if (!Number.isSafeInteger(assetId)) return null;
  return db.prepare('SELECT * FROM town_assets WHERE id = ?').get(assetId) || null;
}

function findMapObject(db, mapId, objectId) {
  const row = db.prepare('SELECT layers_json FROM town_maps WHERE id = ?').get(mapId);
  const layers = row ? parseJson(row.layers_json, null) : null;
  const objects = Array.isArray(layers?.objects) ? layers.objects : [];
  return objects.find(o => Number(o?.id) === Number(objectId)) || null;
}

/**
 * 解析建筑功能来源。缺少地点时抛 LOCATION_NOT_FOUND。
 * @returns {object} source 快照（含 hash 输入字段与目录）
 */
export function resolveBuildingFeatureSource(context, { mapId, locationKey }) {
  const { db, registry, scope } = context;
  const world = registry.getWorldState();
  const location = db.prepare('SELECT * FROM town_locations WHERE map_id = ? AND key = ?').get(mapId, locationKey);
  if (!location) throw townError('LOCATION_NOT_FOUND');
  const mapRow = db.prepare('SELECT id, name, world_setting_id, version FROM town_maps WHERE id = ?').get(mapId);
  if (!mapRow) throw townError('LOCATION_NOT_FOUND');
  const asset = resolveBuildingAsset(db, location);

  // 建筑一律为无主的功能性建筑（用户口径 2026-10-04）：不解析经营者，
  // 收支统一走建筑自己的 business 账户，与任何居民无关。

  const meta = parseJson(asset?.meta_json || '{}', {});
  const title = location.name || asset?.name || '';
  // 用户手填优先；素材 desc 是绘图提示词时不能冒充用途（置空并提示补充）
  const assetDescUsable = meta.desc && !isDrawingPrompt(meta.desc);
  const descriptionSource = location.feature_desc ? 'location.feature_desc'
    : meta.featureDescription ? 'asset.meta.featureDescription'
    : assetDescUsable ? 'asset.meta.desc'
    : meta.desc ? 'asset.meta.drawing_prompt' : null;
  const description = location.feature_desc || meta.featureDescription || (assetDescUsable ? meta.desc : '');


  const source = {
    schemaVersion: SCHEMA_VERSION,
    contractVersion: GENERATION_CONTRACT_VERSION,
    registryVersion: registryVersion(),
    worldId: world.worldId,
    worldEpoch: world.epoch,
    mapId,
    mapName: mapRow.name,
    locationId: location.id,
    // 稳定实例 ID：地图内唯一的 location key 加上 mapId 限定，跨地图副本互不共享
    buildingInstanceId: `${mapId}:${location.key}`,
    locationKey: location.key,
    title,
    description,
    descriptionSource,
    businessKind: location.business_kind || 'none',
    ambient: location.ambient || '',
    assetId: asset?.id ?? null,
    assetName: asset?.name ?? null,
    worldSettingId: mapRow.world_setting_id ?? null,
    // 世界观语义版本：只跟世界观绑定走，重排/改图不参与（计划 §3.3 重排不漂移）
    worldVersion: mapRow.world_setting_id ? `setting:${mapRow.world_setting_id}` : 'default',
    special: !!meta.special,
    catalogs: {
      stateProfiles: stateProfileCatalog(),
    },
  };
  source.sourceHash = computeSourceHash(source);
  return source;
}

/** sourceHash：玩法相关的标题/描述、世界观语义版本、契约版本（计划 §3.3）。
 * 建筑无主：不含任何经营者维度，居民变动不影响配置有效性。 */
export function computeSourceHash(source, legacyCapabilities) {
  return createHash('sha256').update(JSON.stringify({
    contractVersion: GENERATION_CONTRACT_VERSION,
    title: source.title,
    description: source.description,
    worldVersion: source.worldVersion,
    ...(legacyCapabilities === undefined ? {} : { capabilities: legacyCapabilities }),
  })).digest('hex');
}

/**
 * 判断既有配置相对当前来源是否 stale（计划 §3.3：标记 stale 但保留旧配置供查看）。
 */
export function sourceDrifted(source, profile) {
  if (!profile?.source_hash) return false;
  if (profile.source_hash === source.sourceHash) return false;
  // 兼容旧配置摘要：废弃权限字段本身不应使已经生成的功能失效。
  // 仅当其余用途/标题/世界观字段仍逐字节相同时接受旧摘要。
  const legacy = ['service', 'trade', 'work'];
  for (let mask = 0; mask < 8; mask++) {
    if (profile.source_hash === computeSourceHash(source, legacy.filter((_, i) => mask & (1 << i)))) return false;
  }
  return true;
}

/** 当前地图上的候选建筑清单（special 优先；供后台建档与管理页展示，不触发任何 LLM） */
export function listBuildingFeatureSources(context, { mapId } = {}) {
  const db = context.db;
  const currentMapId = mapId ?? db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM town_maps').get().id;
  const locations = db.prepare('SELECT * FROM town_locations WHERE map_id = ? ORDER BY id').all(currentMapId);
  const layers = db.prepare('SELECT layers_json FROM town_maps WHERE id = ?').get(currentMapId);
  const objects = Array.isArray(parseJson(layers?.layers_json, null)?.objects)
    ? parseJson(layers.layers_json, null).objects : [];
  const results = [];
  for (const location of locations) {
    try {
      const object = objects.find(o => Number(o?.id) === Number(location.object_id));
      const asset = object ? db.prepare('SELECT * FROM town_assets WHERE id = ?').get(Number(object.assetId)) : null;
      const meta = parseJson(asset?.meta_json || '{}', {});
      const source = resolveBuildingFeatureSource(context, { mapId: currentMapId, locationKey: location.key });
      results.push({ ...source, special: !!meta.special });
    } catch (err) {
      if (err?.code === 'LOCATION_NOT_FOUND') continue;
      throw err;
    }
  }
  return results.sort((a, b) => Number(b.special) - Number(a.special) || a.title.localeCompare(b.title, 'zh'));
}
