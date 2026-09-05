/**
 * 瓦片地图服务（v2 图层数据模型）
 *
 * layers_json = {
 *   ground: [[assetId|null]], road: [[assetId|null]],      // cols×rows 索引矩阵
 *   objects: [{ id, assetId, x, y, flip }],                // 建筑/树/长椅，y 为底部锚点行
 *   blockOverride: [[0|1|-1]]                              // 可走性手动覆盖，-1 = 默认
 * }
 *
 * 可走性 = 非 blockOverride=1 且未被对象 blocking 格占用（建筑主体阻挡、门前留空），
 * 运行时计算；v1 的 walk_grid 列废弃不再读写。
 */
import { getDb } from '../../db/index.js';
import { broadcastTownMapUpdated } from './townBus.js';

/** 对象占用的阻挡格：建筑 = footprint 全格 - 门前格（朝向镜头的底角格）；blocking 道具 = 锚点 1 格 */
export function getObjectBlockingCells(obj, assetMeta) {
  const cells = [];
  const fp = assetMeta?.footprint;
  if (fp && fp.w > 0 && fp.h > 0) {
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
    const meta = assetsById.get(obj.assetId)?.meta;
    for (const c of getObjectBlockingCells(obj, meta)) {
      if (c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows) grid[c.y][c.x] = 0;
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

/** 当前地图行（含解析后的 layers）；无 v2 地图返回 null（走向导） */
export function getMapRow() {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_maps ORDER BY id LIMIT 1').get();
  if (!row || !row.layers_json) return null;
  let layers = null;
  try { layers = JSON.parse(row.layers_json); } catch { return null; }
  if (!layers || !Array.isArray(layers.ground)) return null;
  return { ...row, layers };
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

/** 供前端渲染的完整地图载荷 */
export function getMapPayload() {
  const row = getMapRow();
  if (!row) return null;
  const locations = getDb().prepare('SELECT * FROM town_locations WHERE map_id = ? ORDER BY id').all(row.id)
    .map(l => ({
      id: l.id, key: l.key, name: l.name,
      aliases: (() => { try { return JSON.parse(l.aliases_json || '[]'); } catch { return []; } })(),
      kind: l.kind, x: l.grid_x, y: l.grid_y, radius: l.radius, ambient: l.ambient || '',
      objectId: l.object_id ?? null,
    }));
  return {
    id: row.id,
    name: row.name,
    cols: row.grid_cols,
    rows: row.grid_rows,
    tileSize: row.tile_size || 32,
    version: row.version || 1,
    worldSettingId: row.world_setting_id || null,
    layers: row.layers,
    assets: getLayersAssets(row.layers),
    locations,
  };
}

/**
 * 保存地图（编辑器确认 / 向导开镇共用）：单地图 upsert，version+1 并广播
 * layers 内未带 id 的对象自动补 id；带 locations 时全量重建 POI。
 */
export function saveMap({ name, cols, rows, tileSize = 32, layers, worldSettingId = null, locations = null }) {
  const db = getDb();
  if (!layers || !Array.isArray(layers.ground)) throw new Error('layers.ground 矩阵缺失');
  if (!Array.isArray(layers.road)) layers.road = Array.from({ length: rows }, () => Array(cols).fill(null));
  if (!Array.isArray(layers.objects)) layers.objects = [];
  if (!Array.isArray(layers.blockOverride)) {
    layers.blockOverride = Array.from({ length: rows }, () => Array(cols).fill(-1));
  }

  let nextId = 1;
  for (const o of layers.objects) if (Number.isInteger(o.id)) nextId = Math.max(nextId, o.id + 1);
  for (const o of layers.objects) if (!Number.isInteger(o.id)) o.id = nextId++;

  const existing = db.prepare('SELECT id, version FROM town_maps ORDER BY id LIMIT 1').get();
  const layersJson = JSON.stringify(layers);
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
    const r = db.prepare(`
      INSERT INTO town_maps (name, grid_cols, grid_rows, layers_json, tile_size, world_setting_id, version)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(name, cols, rows, layersJson, tileSize, worldSettingId);
    mapId = Number(r.lastInsertRowid);
  }

  if (Array.isArray(locations)) {
    // POI 全量重建会让 home_location_id 失效 → 先记旧 id→key 映射，重建后按 key 回填
    const oldKeyById = new Map(
      db.prepare('SELECT id, key FROM town_locations').all().map(r => [r.id, r.key])
    );
    const oldNpcHomes = db.prepare('SELECT id, home_location_id AS h FROM town_npcs WHERE home_location_id IS NOT NULL').all()
      .map(r => [r.id, r.h]);
    const oldCharHomes = db.prepare('SELECT character_id AS id, home_location_id AS h FROM town_characters WHERE home_location_id IS NOT NULL').all()
      .map(r => [r.id, r.h]);
    // town_characters.home_location_id 带 FK（无级联），先断开引用再删
    db.exec('UPDATE town_characters SET home_location_id = NULL');
    db.exec('UPDATE town_npcs SET home_location_id = NULL');
    const insLoc = db.prepare(`
      INSERT INTO town_locations (map_id, key, name, aliases_json, kind, grid_x, grid_y, radius, ambient, object_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('DELETE FROM town_locations');
    const idByKey = new Map();
    for (const loc of locations) {
      if (!loc?.key || !loc?.name) continue;
      const r = insLoc.run(
        mapId, loc.key, loc.name, JSON.stringify(loc.aliases || []), loc.kind || 'place',
        loc.x || 0, loc.y || 0, loc.radius || 2, loc.ambient || '', loc.objectId ?? null,
      );
      idByKey.set(loc.key, Number(r.lastInsertRowid));
    }
    const remapHomes = (oldHomes, table, idCol) => {
      const upd = db.prepare(`UPDATE ${table} SET home_location_id = ? WHERE ${idCol} = ?`);
      for (const [id, oldHome] of oldHomes) {
        const key = oldKeyById.get(oldHome);
        upd.run(key ? (idByKey.get(key) ?? null) : null, id);
      }
    };
    try { remapHomes(oldNpcHomes, 'town_npcs', 'id'); } catch { /* 可容忍 */ }
    try { remapHomes(oldCharHomes, 'town_characters', 'character_id'); } catch { /* 可容忍 */ }
  }

  broadcastTownMapUpdated({ mapId, version });
  return { ok: true, mapId, version, layers };
}
