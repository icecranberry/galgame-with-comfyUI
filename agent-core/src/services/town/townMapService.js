/**
 * 瓦片地图服务（v2 图层数据模型）
 *
 * layers_json = {
 *   ground: [[assetId|null]], road: [[assetId|null]],      // cols×rows 索引矩阵
 *   objects: [{ id, assetId, x, y, flip }],                // 建筑/树/长椅，y 为底部锚点行
 *   blockOverride: [[0|1|-1]]                              // 可走性手动覆盖，-1 = 默认
 * }
 *
 * 可走性 = 非 blockOverride=1 且未被对象 blocking 格占用（建筑主体阻挡、门前留空，
 * 建筑另外扩一圈缓冲带，道路格除外），运行时计算；v1 的 walk_grid 列废弃不再读写。
 */
import { getDb } from '../../db/index.js';
import { broadcastTownMapUpdated } from './townBus.js';
import { reconcileTownResponsibilities } from './townResponsibilityRuntime.js';
import { townBuildingKind } from './townResponsibilityDefinitions.js';
import { townCapabilities, defaultTownCapabilities } from './townCapabilities.js';

/** 对象占用的阻挡格：建筑 = footprint 全格 - 门前格；道具 = blocking 锚点，或有 footprintKind 时按全 footprint */
export function getObjectBlockingCells(obj, assetMeta, assetKind = assetMeta?.kind) {
  const cells = [];
  const fp = assetMeta?.footprint;
  if (fp && fp.w > 0 && fp.h > 0) {
    if (assetMeta.footprintKind === 'prop') {
      if (assetMeta.blocking) {
        for (let dy = 0; dy < fp.h; dy++) {
          for (let dx = 0; dx < fp.w; dx++) {
            cells.push({ x: obj.x + dx, y: obj.y - fp.h + 1 + dy });
          }
        }
      }
      return cells;
    }
    const door = assetMeta?.doorOffset || { dx: fp.w - 1, dy: fp.h - 1 };
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        if (dx === door.dx && dy === door.dy) continue; // 门前留空
        cells.push({ x: obj.x + dx, y: obj.y - fp.h + 1 + dy });
      }
    }
  } else if (assetMeta?.blocking) {
    cells.push({ x: obj.x, y: obj.y });
  }
  return cells;
}

/** 由图层计算可走网格（rows[y][x]，1=可走 0=障碍）
 *  blockOverride 语义（plan 3.1）：1 = 手动阻挡，0 = 手动清障（强制可走），-1/缺省 = 默认（按对象阻挡计算） */
export function buildWalkGridFromLayers(cols, rows, layers, assetsById) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  const override = Array.isArray(layers?.blockOverride) ? layers.blockOverride : [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (override[y]?.[x] === 1) grid[y][x] = 0;
    }
  }
  for (const obj of layers?.objects || []) {
    const asset = assetsById.get(obj.assetId);
    for (const c of getObjectBlockingCells(obj, asset?.meta, asset?.kind)) {
      if (c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows) grid[c.y][c.x] = 0;
    }
    // 建筑外扩一圈缓冲带（n×n 占格实际阻挡 (n+2)×(n+2)），NPC 不贴墙走；
    // 道路格除外，否则贴墙马路被挡死会切断路网连通性
    const fp = asset?.kind === 'building' ? asset?.meta?.footprint : null;
    if (fp && fp.w > 0 && fp.h > 0) {
      for (let y = obj.y - fp.h; y <= obj.y + 1; y++) {
        for (let x = obj.x - 1; x <= obj.x + fp.w; x++) {
          const inside = x >= obj.x && x < obj.x + fp.w && y >= obj.y - fp.h + 1 && y <= obj.y;
          if (inside || x < 0 || y < 0 || x >= cols || y >= rows) continue;
          if (layers?.road?.[y]?.[x] != null) continue;
          grid[y][x] = 0;
        }
      }
    }
  }
  // 手动清障在对象阻挡之后应用
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (override[y]?.[x] === 0) grid[y][x] = 1;
    }
  }
  return grid;
}

/**
 * 指定地图行（含解析后的 layers）；无 v2 地图返回 null（走向导）。
 * 不传 mapId 时取默认图（ORDER BY id 的第一张），供尚未分图的历史调用点兼容。
 */
export function getMapRow(mapId = null) {
  const db = getDb();
  const row = mapId == null
    ? db.prepare('SELECT * FROM town_maps ORDER BY id LIMIT 1').get()
    : db.prepare('SELECT * FROM town_maps WHERE id = ?').get(mapId);
  if (!row || !row.layers_json) return null;
  let layers = null;
  try { layers = JSON.parse(row.layers_json); } catch { return null; }
  if (!layers || !Array.isArray(layers.ground)) return null;
  return { ...row, layers };
}

/** 小镇素材库成员独立于地图摆放；移除摆放不会移除素材库成员。 */
export function addMapAssets(mapId, assetIds) {
  const db = getDb();
  const insert = db.prepare(`INSERT OR IGNORE INTO town_map_assets (map_id, asset_id)
    SELECT ?, id FROM town_assets WHERE id = ? AND EXISTS (SELECT 1 FROM town_maps WHERE id = ?)`);
  db.transaction(() => {
    for (const id of new Set(assetIds || [])) insert.run(mapId, id, mapId);
  })();
}

export function getMapLibraryAssets(mapId) {
  const map = getMapRow(mapId);
  if (!map) return [];
  // 兼容旧地图；成员只增不减，未摆放的素材仍保留。
  addMapAssets(map.id, getLayersAssets(map.layers).map(a => a.id));
  const ids = getDb().prepare('SELECT asset_id FROM town_map_assets WHERE map_id = ?').all(map.id);
  return getLayersAssets({ objects: ids.map(row => ({ assetId: row.asset_id })) });
}

/** 图层引用的全部素材（去重，含 meta） */
export function getLayersAssets(layers) {
  const db = getDb();
  const ids = new Set();
  for (const row of layers?.ground || []) for (const id of row || []) if (id) ids.add(id);
  for (const row of layers?.road || []) for (const id of row || []) if (id) ids.add(id);
  for (const obj of layers?.objects || []) if (obj.assetId) ids.add(obj.assetId);
  if (ids.size === 0) return [];
  const placeholders = [...ids].map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM town_assets WHERE id IN (${placeholders})`).all(...ids);
  return rows.map(r => {
    let meta = {};
    try { meta = JSON.parse(r.meta_json || '{}'); } catch { /* 忽略坏 meta */ }
    return { id: r.id, kind: r.kind, key: r.key, name: r.name, imagePath: r.image_path, meta, status: r.status };
  });
}

/**
 * 清掉图层里指向已不存在素材的引用（原地修改 layers）：地面/路面格置空、移除悬空的建筑/道具对象。
 * 被清空的地面格回填全图最常见的剩余地砖（与渲染器周边外扩取砖同一口径），避免地图留下黑洞。
 * 返回统计 { groundCells, backfilled, roadCells, removedObjects, removedObjectIds }。
 */
function scrubMissingAssetReferences(layers, knownIds) {
  const known = value => { const n = Number(value); return Number.isFinite(n) && knownIds.has(n); };
  const clearedGround = [];
  const scrubGrid = (name, collect) => {
    const grid = layers?.[name];
    if (!Array.isArray(grid)) return 0;
    let cleared = 0;
    for (let y = 0; y < grid.length; y++) {
      const cells = grid[y];
      if (!Array.isArray(cells)) continue;
      for (let x = 0; x < cells.length; x++) {
        if (cells[x] != null && !known(cells[x])) {
          cells[x] = null;
          cleared++;
          if (collect) clearedGround.push([x, y]);
        }
      }
    }
    return cleared;
  };
  const groundCells = scrubGrid('ground', true);
  const roadCells = scrubGrid('road', false);
  let backfilled = 0;
  if (groundCells > 0) {
    const counts = new Map();
    for (const cells of layers.ground) for (const id of cells || []) if (id != null) counts.set(id, (counts.get(id) || 0) + 1);
    const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominant != null) {
      for (const [x, y] of clearedGround) { layers.ground[y][x] = dominant; backfilled++; }
    }
  }
  const objects = Array.isArray(layers?.objects) ? layers.objects : [];
  const kept = objects.filter(o => o?.assetId != null && known(o.assetId));
  const removedObjectIds = objects
    .filter(o => !o || o.assetId == null || !known(o.assetId))
    .map(o => o?.id)
    .filter(id => Number.isInteger(id));
  if (kept.length !== objects.length) layers.objects = kept;
  return { groundCells, backfilled, roadCells, removedObjects: objects.length - kept.length, removedObjectIds };
}

/** 供前端渲染的完整地图载荷 */
export function getMapPayload(mapId = null) {
  const row = getMapRow(mapId);
  if (!row) return null;
  const locations = getDb().prepare('SELECT * FROM town_locations WHERE map_id = ? ORDER BY id').all(row.id)
    .map(l => ({
      id: l.id, key: l.key, name: l.name,
      aliases: (() => { try { return JSON.parse(l.aliases_json || '[]'); } catch { return []; } })(),
      kind: l.kind, x: l.grid_x, y: l.grid_y, radius: l.radius, ambient: l.ambient || '',
      businessKind: l.business_kind || 'none',
      capabilities: townCapabilities(l, defaultTownCapabilities(l.business_kind)),
      objectId: l.object_id ?? null,
    }));
  const assets = getLayersAssets(row.layers);
  // 渲染兜底：悬空引用会在地图上渲染成白块/黑洞，读载荷时就地清掉；持久化清理由 removeDeletedAssetReferences 在删素材时负责
  scrubMissingAssetReferences(row.layers, new Set(assets.map(a => Number(a.id))));
  return {
    id: row.id,
    name: row.name,
    cols: row.grid_cols,
    rows: row.grid_rows,
    tileSize: row.tile_size || 32,
    version: row.version || 1,
    worldSettingId: row.world_setting_id || null,
    layers: row.layers,
    assets,
    locations,
  };
}

/**
 * 出行目录：所有地图的轻量描述（不含图层），供顶栏「出行」面板与切换前校验。
 * 只列 status = 'ready' 的图可前往；archived 仅保留在列表里做历史说明。
 */
export function listMaps() {
  const db = getDb();
  const rows = db.prepare(`SELECT id, name, status, version, grid_cols, grid_rows, tile_size,
    world_setting_id, created_at FROM town_maps ORDER BY id`).all();
  // 角色的托管档案不算居民
  const residentCount = db.prepare(`SELECT map_id, COUNT(*) AS n FROM town_npcs
    WHERE town_enabled = 1 AND COALESCE(character_managed, 0) = 0 GROUP BY map_id`).all();
  const residents = new Map(residentCount.map(r => [r.map_id, r.n]));
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    status: row.status || 'ready',
    version: row.version || 1,
    cols: row.grid_cols,
    rows: row.grid_rows,
    tileSize: row.tile_size || 32,
    worldSettingId: row.world_setting_id || null,
    residentCount: residents.get(row.id) || 0,
    createdAt: row.created_at || null,
  }));
}

/**
 * 保存地图（编辑器确认 / 向导开镇共用）：单地图 upsert，version+1 并广播
 * layers 内未带 id 的对象自动补 id。
 * locations 缺省/null 保留 POI；数组为当前地图完整集合，[] 清空。
 * key 是不可变身份：同 key 原位更新并保留 id；传入 id 时必须与该 key 匹配。
 * 地图、POI 与删除地点的住宅引用在同一事务提交，成功后才广播。
 */
export function saveMap({ name, cols, rows, tileSize = 32, layers, worldSettingId = null, locations = null,
  assignResponsibilities = true, mapId: targetMapId = null, create = false }) {
  const db = getDb();
  if (locations !== null && !Array.isArray(locations)) throw new Error('locations 必须为数组或 null');
  const keys = new Set();
  for (const loc of locations || []) {
    if (!loc || typeof loc.key !== 'string' || !loc.key.trim()
      || typeof loc.name !== 'string' || !loc.name.trim()) {
      throw new Error('地点 key/name 必填');
    }
    if (keys.has(loc.key)) throw new Error(`地点 key 重复: ${loc.key}`);
    keys.add(loc.key);
  }
  if (!layers || !Array.isArray(layers.ground)) throw new Error('layers.ground 矩阵缺失');
  if (!Array.isArray(layers.road)) layers.road = Array.from({ length: rows }, () => Array(cols).fill(null));
  if (!Array.isArray(layers.objects)) layers.objects = [];
  if (!Array.isArray(layers.blockOverride)) {
    layers.blockOverride = Array.from({ length: rows }, () => Array(cols).fill(-1));
  }

  let nextId = 1;
  for (const o of layers.objects) if (Number.isInteger(o.id)) nextId = Math.max(nextId, o.id + 1);
  for (const o of layers.objects) if (!Number.isInteger(o.id)) o.id = nextId++;

  const result = db.transaction(() => {
    // 目标地图解析：create 永远新建；显式 mapId 只更新那一张；两者都没有才退回「默认图」旧口径
    const requestedId = targetMapId == null ? null : Number(targetMapId);
    if (requestedId != null && !Number.isInteger(requestedId)) throw new Error(`地图 id 无效: ${targetMapId}`);
    const existing = create ? null : (requestedId != null
      ? db.prepare('SELECT id, version FROM town_maps WHERE id = ?').get(requestedId) || null
      : db.prepare('SELECT id, version FROM town_maps ORDER BY id LIMIT 1').get());
    if (requestedId != null && !existing && !create) throw new Error(`地图不存在: ${requestedId}`);
    const layersJson = JSON.stringify(layers);
    if (existing) addMapAssets(existing.id, getLayersAssets(getMapRow(existing.id)?.layers).map(a => a.id));
    let mapId;
    let version;
    if (existing) {
      // v1 地图升级：保留行 id；无 layers 的旧行 version 视为 0
      version = (existing.version || 0) + 1;
      db.prepare(`
        UPDATE town_maps SET name = ?, grid_cols = ?, grid_rows = ?, layers_json = ?, tile_size = ?,
          world_setting_id = COALESCE(?, world_setting_id), version = ?
        WHERE id = ?
      `).run(name, cols, rows, layersJson, tileSize, worldSettingId, version, existing.id);
      mapId = existing.id;
    } else {
      version = 1;
      // 在创建事务内分配名字；带编号的重名继续递增，避免出现「小镇-1-1」。
      const names = new Set(db.prepare('SELECT name FROM town_maps').all().map(row => row.name));
      let uniqueName = String(name || '').trim() || '新小镇';
      if (names.has(uniqueName)) {
        const suffix = uniqueName.match(/^(.*)-(\d+)$/);
        const base = suffix ? suffix[1] : uniqueName;
        let index = suffix ? BigInt(suffix[2]) + 1n : 1n;
        while (names.has(`${base}-${index}`)) index++;
        uniqueName = `${base}-${index}`;
      }
      const r = db.prepare(`
        INSERT INTO town_maps (name, grid_cols, grid_rows, layers_json, tile_size, world_setting_id, version)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(uniqueName, cols, rows, layersJson, tileSize, worldSettingId);
      mapId = Number(r.lastInsertRowid);
    }

    addMapAssets(mapId, getLayersAssets(layers).map(a => a.id));
    if (Array.isArray(locations)) {
      const oldLocations = db.prepare('SELECT id, key, business_kind, capabilities_json FROM town_locations WHERE map_id = ?').all(mapId);
      const oldByKey = new Map(oldLocations.map(loc => [loc.key, loc]));
      const insLoc = db.prepare(`
        INSERT INTO town_locations (map_id, key, name, aliases_json, kind, grid_x, grid_y, radius, ambient, object_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updLoc = db.prepare(`
        UPDATE town_locations SET name = ?, aliases_json = ?, kind = ?, grid_x = ?, grid_y = ?,
          radius = ?, ambient = ?, object_id = ? WHERE id = ? AND map_id = ?
      `);
      for (const loc of locations) {
        const old = oldByKey.get(loc.key);
        if (loc.id != null && (!Number.isInteger(loc.id) || loc.id !== old?.id)) {
          throw new Error(`地点 id/key 不匹配: ${loc.key}`);
        }
        const values = [loc.name, JSON.stringify(loc.aliases || []), loc.kind || 'place',
          loc.x ?? 0, loc.y ?? 0, loc.radius ?? 2, loc.ambient || '', loc.objectId ?? null];
        if (old) updLoc.run(...values, old.id, mapId);
        else insLoc.run(mapId, loc.key, ...values);
        const businessKind = loc.businessKind ?? old?.business_kind;
        if (businessKind != null) db.prepare('UPDATE town_locations SET business_kind=? WHERE map_id=? AND key=?')
          .run(townBuildingKind({ businessKind }), mapId, loc.key);
        const capabilities = townCapabilities({ ...old, ...loc }, defaultTownCapabilities(townBuildingKind(loc)));
        db.prepare('UPDATE town_locations SET capabilities_json=? WHERE map_id=? AND key=?').run(JSON.stringify(capabilities), mapId, loc.key);
      }
      for (const old of oldLocations) {
        if (keys.has(old.key)) continue;
        db.prepare('UPDATE town_characters SET home_location_id = NULL WHERE home_location_id = ?').run(old.id);
        db.prepare('UPDATE town_npcs SET home_location_id = NULL WHERE home_location_id = ?').run(old.id);
        db.prepare('UPDATE town_agent_state SET current_location_id = NULL WHERE current_location_id = ?').run(old.id);
        // 其他业务 FK 若仍引用该地点，删除失败并整体回滚，不能静默破坏引用。
        db.prepare('DELETE FROM town_locations WHERE id = ? AND map_id = ?').run(old.id, mapId);
      }
    }
    if (assignResponsibilities) reconcileTownResponsibilities({ db, mapId });
    return { ok: true, mapId, version: db.prepare('SELECT version FROM town_maps WHERE id=?').get(mapId).version, layers };
  })();
  broadcastTownMapUpdated({ mapId: result.mapId, version: result.version });
  return result;
}

/**
 * 只改名字：图层、POI、居民、素材一概不动（编辑器那条 saveMap 要整图回写，改名不能走它）。
 * version+1 并广播 town_map_updated，各端据此刷新目录与顶栏镇名。
 */
export function renameMap({ mapId, name }) {
  const db = getDb();
  const id = Number(mapId);
  if (!Number.isInteger(id)) throw new Error('地图 id 无效');
  const clean = String(name ?? '').trim().slice(0, 24);
  if (!clean) throw new Error('小镇名字不能为空');
  const row = db.prepare('SELECT id, version FROM town_maps WHERE id = ?').get(id);
  if (!row) throw new Error('地图不存在');
  const version = (row.version || 0) + 1;
  db.prepare('UPDATE town_maps SET name = ?, version = ? WHERE id = ?').run(clean, version, id);
  broadcastTownMapUpdated({ mapId: id, version });
  return { ok: true, mapId: id, name: clean, version };
}

/**
 * 删除素材后调用（deleteAsset 专用）：把图层里指向已不存在素材的引用真正清出数据库——
 * 悬空对象移除、绑定了悬空对象的 POI 解绑（object_id 置空，地点本身保留）、地面/路面引用格清空回填；
 * 有改动才 version+1 并广播，让各端立即重取地图。顺带修复历史版本遗留的悬空引用
 * （旧版本删素材不清图层，会在地图上留下白块/黑洞）。地图不存在或无悬空引用时返回 null。
 */
export function removeDeletedAssetReferences() {
  const row = getMapRow();
  if (!row) return null;
  const db = getDb();
  const knownIds = new Set(db.prepare('SELECT id FROM town_assets').all().map(r => r.id));
  const stats = scrubMissingAssetReferences(row.layers, knownIds);
  if (!stats.groundCells && !stats.roadCells && !stats.removedObjects) return null;
  const result = db.transaction(() => {
    const version = (row.version || 0) + 1;
    db.prepare('UPDATE town_maps SET layers_json = ?, version = ? WHERE id = ?')
      .run(JSON.stringify(row.layers), version, row.id);
    for (const objectId of stats.removedObjectIds) {
      db.prepare('UPDATE town_locations SET object_id = NULL WHERE map_id = ? AND object_id = ?').run(row.id, objectId);
    }
    return { mapId: row.id, version };
  })();
  broadcastTownMapUpdated({ mapId: result.mapId, version: result.version });
  return { ...stats, version: result.version };
}
