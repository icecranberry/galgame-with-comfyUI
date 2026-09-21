import { getDb } from '../../db/index.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { createEconomyService } from './economyService.js';
import { createItemTemplateService } from './itemTemplateService.js';
import { ITEM_EFFECTS } from '../itemService.js';
import { ensureNpcFunctions } from './townNpcFunctions.js';
import { TOWN_BUSINESS_ROLES, inferTownBusinessKind, townBuildingKind } from './townResponsibilityDefinitions.js';
import { buildWalkGridFromLayers } from './townMapService.js';
import { findPath } from './townPathfinding.js';
import { broadcastTownMapUpdated } from './townBus.js';
import { ensureTownCapabilities, defaultTownCapabilities, townCapabilities, upgradeTownNpcCapabilities, shouldHaveWorkPermission } from './townCapabilities.js';

const parse = (value, fallback = {}) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
export function initializeTownNpcFunctions(db, npc) {
  const workplace = npc.workplace_key && db.prepare('SELECT * FROM town_locations WHERE key=? AND map_id=?').get(npc.workplace_key, npc.map_id);
  ensureTownCapabilities(db, 'town_npcs', npc, workplace
    ? townCapabilities(workplace, defaultTownCapabilities(workplace.business_kind))
    : defaultTownCapabilities(inferTownBusinessKind(npc.job), npc.job));
  // 老档案只有 service/trade，工作岗位要单独补上 work 权限。
  if (shouldHaveWorkPermission(npc.job)) upgradeTownNpcCapabilities(db, npc, ['work']);
  return ensureNpcFunctions(db, npc);
}

/** No LLM, timers or movement. Both generation orders (buildings first / residents first)
 * converge on the same stored bindings. Buildings get addresses, residents get workplaces;
 * the binding lives in town_npcs.workplace_key, so repeated runs are stable. */
export function reconcileTownResponsibilities({ db = getDb(), allowFallback = false, mapId = null } = {}) {
  let mapUpdate = null;
  const result = db.transaction(() => {
    const map = mapId == null
      ? db.prepare('SELECT * FROM town_maps ORDER BY id LIMIT 1').get()
      : db.prepare('SELECT * FROM town_maps WHERE id = ?').get(mapId);
    if (!map) return { pending: [], changed: false };
    const registry = createTownActorRegistry(db);
    const actors = registry.synchronize();
    const world = registry.getWorldState(), scope = { worldId: world.worldId, worldEpoch: world.epoch };
    const locations = db.prepare('SELECT * FROM town_locations WHERE map_id=? ORDER BY id').all(map.id);
    const objects = new Map((parse(map.layers_json).objects || []).map(o => [o.id, o]));
    // Earlier maps only recorded landmarks as locations. Give every existing building
    // an address so its saved permissions can actually be reached by clicking it.
    const mapAssets = new Map(db.prepare('SELECT * FROM town_assets').all().map(a => [a.id, { ...a, meta: parse(a.meta_json) }]));
    let walkGrid;
    for (const object of objects.values()) {
      const asset = mapAssets.get(object.assetId);
      if (asset?.kind !== 'building' || locations.some(l => l.object_id === object.id)) continue;
      const matching = locations.find(l => l.object_id == null && l.key === asset.key);
      if (matching) {
        matching.object_id = object.id;
        db.prepare('UPDATE town_locations SET object_id=? WHERE id=?').run(object.id, matching.id);
      } else {
        walkGrid ||= buildWalkGridFromLayers(map.grid_cols, map.grid_rows, parse(map.layers_json), mapAssets);
        const fp = asset.meta.footprint || { w: 1, h: 1 }, door = asset.meta.doorOffset || { dx: fp.w - 1, dy: fp.h - 1 };
        const x = object.x + door.dx, y = object.y - fp.h + 1 + door.dy;
        const nearby = [];
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          if (walkGrid[y + dy]?.[x + dx]) nearby.push({ x: x + dx, y: y + dy, distance: Math.abs(dx) + Math.abs(dy) });
        }
        const entrance = nearby.sort((a, b) => a.distance - b.distance)[0];
        if (!entrance) continue; // A sealed building is unavailable until its entrance is repaired.
        let key = String(asset.key || `building_${object.id}`).replace(/[^a-zA-Z0-9_-]/g, '_'), suffix = 2;
        const base = key;
        while (locations.some(l => l.key === key)) key = `${base}_${suffix++}`;
        const id = db.prepare(`INSERT INTO town_locations(map_id,key,name,kind,grid_x,grid_y,radius,object_id,business_kind,capabilities_json)
          VALUES(?,?,?,'place',?,?,1,?,?,?)`).run(map.id, key, asset.name || key, entrance.x, entrance.y, object.id,
          townBuildingKind(asset), JSON.stringify(townCapabilities(asset, defaultTownCapabilities(townBuildingKind(asset))))).lastInsertRowid;
        locations.push(db.prepare('SELECT * FROM town_locations WHERE id=?').get(id));
      }
      if (!mapUpdate) {
        db.prepare('UPDATE town_maps SET version=COALESCE(version,0)+1 WHERE id=?').run(map.id);
        mapUpdate = { mapId: map.id, version: (map.version || 0) + 1 };
      }
    }
    for (const location of locations) {
      if (location.business_kind != null) {
        ensureTownCapabilities(db, 'town_locations', location, defaultTownCapabilities(location.business_kind));
        continue;
      }
      const object = objects.get(location.object_id);
      const asset = object && db.prepare('SELECT * FROM town_assets WHERE id=?').get(object.assetId);
      const fromAsset = asset && townBuildingKind({ ...asset, meta: parse(asset.meta_json) });
      location.business_kind = fromAsset && fromAsset !== 'none' ? fromAsset : townBuildingKind(location);
      db.prepare('UPDATE town_locations SET business_kind=? WHERE id=?').run(location.business_kind, location.id);
      ensureTownCapabilities(db, 'town_locations', location, asset
        ? townCapabilities({ meta: parse(asset.meta_json) }, defaultTownCapabilities(location.business_kind))
        : defaultTownCapabilities(location.business_kind));
    }
    // 角色的托管档案不参与岗位绑定：它们只是角色挂服务 / 打工项目的影子身份
    const npcs = db.prepare('SELECT * FROM town_npcs WHERE map_id=? AND COALESCE(character_managed, 0) = 0 ORDER BY id').all(map.id);
    for (const npc of npcs) initializeTownNpcFunctions(db, npc);
    const residents = npcs.map(npc => ({ ...npc, actor: actors.find(a => a.npcId === npc.id) }))
      .filter(npc => npc.actor?.participating && !npc.actor.archived && !npc.actor.mergedInto);
    // Old worlds may have no supply/crafting building. Community stalls belong in
    // public space; never turn an unrelated home or world landmark into a workshop.
    if (allowFallback && residents.length >= 3) {
      const plaza = locations.find(l => l.business_kind === 'board') || locations.find(l => l.kind === 'outdoor');
      if (plaza) {
        const assets = new Map(db.prepare('SELECT * FROM town_assets').all().map(a => [a.id, { ...a, meta: parse(a.meta_json) }]));
        const grid = buildWalkGridFromLayers(map.grid_cols, map.grid_rows, parse(map.layers_json), assets);
        for (const [kind, name] of [['supplier', '广场补给摊'], ['workshop', '广场手作摊']]) {
          if (locations.some(l => l.business_kind === kind)) continue;
          const cells = [];
          for (let y = 0; y < map.grid_rows; y++) for (let x = 0; x < map.grid_cols; x++) {
            if (!grid[y]?.[x] || locations.some(l => Math.max(Math.abs(l.grid_x - x), Math.abs(l.grid_y - y)) <= (l.radius || 2) + 1)) continue;
            const distance = Math.max(Math.abs(x - plaza.grid_x), Math.abs(y - plaza.grid_y));
            if (distance <= 10) cells.push({ x, y, distance });
          }
          const cell = cells.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
            .find(candidate => findPath(grid, { x: plaza.grid_x, y: plaza.grid_y }, candidate) !== null);
          if (!cell) continue;
          let key = `town_${kind}_stall`;
          while (locations.some(l => l.key === key)) key += '_new';
          const id = db.prepare(`INSERT INTO town_locations(map_id,key,name,kind,grid_x,grid_y,radius,business_kind)
            VALUES(?,?,?,'outdoor',?,?,1,?)`).run(map.id, key, name, cell.x, cell.y, kind).lastInsertRowid;
          locations.push(db.prepare('SELECT * FROM town_locations WHERE id=?').get(id));
          ensureTownCapabilities(db, 'town_locations', locations.at(-1), defaultTownCapabilities(kind));
          if (!mapUpdate) {
            db.prepare('UPDATE town_maps SET version=COALESCE(version,0)+1 WHERE id=?').run(map.id);
            mapUpdate = { mapId: map.id, version: (map.version || 0) + 1 };
          }
        }
      }
    }
    // 已声明的 workplace_key 是权威绑定：specialist 匹配按它复选，本轮 bind 只新增。
    const boundWorkplaces = new Set(), boundNpcs = new Set(), pending = [], selected = [];
    const candidates = Object.entries(TOWN_BUSINESS_ROLES).map(([kind, role]) => ({ kind, role,
      location: locations.find(l => !boundWorkplaces.has(l.key) && l.business_kind === kind) }));
    const bind = (kind, npc, location) => {
      // Re-affirming an existing workplace is not a change; only new pairings are.
      selected.push({ kind, npc, location, isNew: npc.workplace_key !== location.key });
      boundNpcs.add(npc.id); boundWorkplaces.add(location.key);
    };
    // Reserve specialist matches before assigning spare residents to community duties.
    for (const entry of candidates) {
      if (entry.kind === 'board' && !entry.location) entry.location = locations.find(l => !boundWorkplaces.has(l.key) && l.kind === 'outdoor');
      if (!entry.location) continue;
      const npc = residents.find(n => !boundNpcs.has(n.id) && n.workplace_key === entry.location.key)
        || residents.find(n => !boundNpcs.has(n.id) && !n.workplace_key && inferTownBusinessKind(n.job) === entry.kind);
      if (npc) bind(entry.kind, npc, entry.location);
    }
    for (const entry of candidates) {
      const { kind, role } = entry;
      if (['board', 'supplier', 'workshop'].includes(kind) && allowFallback && entry.location) {
        const npc = residents.find(n => !boundNpcs.has(n.id) && !n.workplace_key && inferTownBusinessKind(n.job) === 'none');
        if (npc) bind(kind, npc, entry.location);
      }
      if (!selected.some(item => item.kind === kind) && (entry.location || ['board', 'supplier', 'workshop'].includes(kind))) {
        pending.push({ kind, locationKey: entry.location?.key || null,
          message: entry.location ? `${entry.location.name}等待${role.job}到岗` : `${role.name}尚未生成` });
      }
    }
    const templates = createItemTemplateService({ db, clock: { now: Date.now }, getWorldEpoch: registry.getWorldEpoch,
      getActor: registry.getActor, effectRegistry: ITEM_EFFECTS });
    templates.ensureDefaultTemplates(scope);
    // 开局补助：每位玩家只发一次（seed v2，与旧开店时代的 v1 发放互不冲突），
    // 花光不补发；发放失败绝不阻塞小镇启动。
    const economy = createEconomyService({ db, clock: { now: Date.now }, getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
    const me = registry.resolveAgentKey('me');
    const wallet = economy.ensureAccount({ ...scope, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });
    const grantSourceKey = `seed:money:${wallet.accountId}:2`;
    const granted = db.prepare('SELECT 1 FROM economy_transactions WHERE world_id=? AND source_key=?').get(scope.worldId, grantSourceKey);
    if (!granted) {
      try {
        economy.seed({ ...scope, accountId: wallet.accountId, amount: 200, seedVersion: 2,
          idempotencyKey: `opening-grant:${scope.worldEpoch}`, reasonCode: 'TOWN_OPENING_GRANT' });
      } catch (error) {
        if (!['SOURCE_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) throw error;
      }
    }
    for (const { kind, npc, location } of selected) {
      // Persist factual workplace without rewriting an existing personality, home or routine.
      db.prepare('UPDATE town_npcs SET workplace_key=? WHERE id=?').run(location.key, npc.id);
      if (!npc.capabilities_explicit) db.prepare('UPDATE town_npcs SET capabilities_json=? WHERE id=?')
        .run(JSON.stringify(townCapabilities(location, defaultTownCapabilities(kind, npc.job))), npc.id);
      if (location.business_kind === 'none') db.prepare('UPDATE town_locations SET business_kind=? WHERE id=?').run(kind, location.id);
    }
    return { changed: selected.some(item => item.isNew), pending };
  }).immediate();
  if (mapUpdate) broadcastTownMapUpdated(mapUpdate);
  return { ...result, mapChanged: !!mapUpdate };
}
