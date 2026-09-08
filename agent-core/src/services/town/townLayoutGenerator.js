/**
 * 小镇本地布图器。
 *
 * 布局不再交给 LLM 自由摆放；这里按地皮面积、素材容量和密度设置展开实例，
 * 生成有机聚落：每个聚落一条不规则环路，聚落之间只做最短点对连接，
 * 建筑贴门放路，道具按地图分桶轮转散布。LLM 保留给蓝图、素材提示词和叙事内容。
 */

const TAU = Math.PI * 2;

function createRandom(seed) {
  let state = (Number.isFinite(seed) ? Math.floor(seed) : Date.now()) >>> 0;
  if (state === 0) state = 0x2f6e2b1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function sanitizeKey(value, fallback = 'place') {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '') || fallback;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function footprintOf(asset) {
  const fp = asset?.meta?.footprint || {};
  const w = Math.max(1, Math.min(12, parseInt(fp.w, 10) || 1));
  const h = Math.max(1, Math.min(12, parseInt(fp.h, 10) || 1));
  return { w, h };
}

function doorOf(asset) {
  const fp = footprintOf(asset);
  const door = asset?.meta?.doorOffset || {};
  return {
    dx: Math.max(0, Math.min(fp.w - 1, parseInt(door.dx, 10) || fp.w - 1)),
    dy: Math.max(0, Math.min(fp.h - 1, parseInt(door.dy, 10) || fp.h - 1)),
  };
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function paintOrganicPath(road, roadId, start, end, bounds, random) {
  let x = Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(start.x)));
  let y = Math.max(bounds.minY, Math.min(bounds.maxY, Math.round(start.y)));
  const tx = Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(end.x)));
  const ty = Math.max(bounds.minY, Math.min(bounds.maxY, Math.round(end.y)));
  road[y][x] = roadId;
  const cells = [cellKey(x, y)];
  let guard = (bounds.maxX - bounds.minX + bounds.maxY - bounds.minY + 2) * 8;
  while ((x !== tx || y !== ty) && guard-- > 0) {
    const dx = tx - x;
    const dy = ty - y;
    if (dx === 0 && dy === 0) break;
    const horizontal = Math.abs(dx) / (Math.abs(dx) + Math.abs(dy));
    if (random() < horizontal) x += Math.sign(dx);
    else y += Math.sign(dy);
    x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
    road[y][x] = roadId;
    cells.push(cellKey(x, y));
  }
  return cells;
}

function paintOrganicLoop(road, roadId, site, bounds, random) {
  const vertexCount = Math.max(8, Math.min(18, Math.round(site.radius * 2.1)));
  const vertices = [];
  const angularJitter = Math.min(0.11, TAU / vertexCount * 0.28);
  for (let i = 0; i < vertexCount; i++) {
    const angle = i / vertexCount * TAU + (random() - 0.5) * angularJitter;
    const rr = site.radius * (0.84 + random() * 0.34);
    vertices.push({
      x: Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(site.x + Math.cos(angle) * rr))),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, Math.round(site.y + Math.sin(angle) * rr))),
    });
  }
  const cells = [];
  for (let i = 0; i < vertices.length; i++) {
    const from = vertices[i];
    const to = vertices[(i + 1) % vertices.length];
    for (const key of paintOrganicPath(road, roadId, from, to, bounds, random)) {
      if (!cells.includes(key)) cells.push(key);
    }
  }
  return cells;
}

function planSites(width, height, buildingTarget, random) {
  const shortSide = Math.min(width, height);
  const siteCount = Math.min(8, Math.max(buildingTarget >= 6 ? 3 : 1, Math.round(buildingTarget / 6)));
  const radius = Math.max(4, Math.min(Math.round(shortSide / 8 + 0.5), Math.max(4, Math.floor(shortSide / 7))));
  const cols = Math.max(1, Math.ceil(Math.sqrt(siteCount)));
  const rows = Math.max(1, Math.ceil(siteCount / cols));
  const marginX = radius + 2;
  const marginY = radius + 2;
  const spanX = Math.max(1, width - marginX * 2);
  const spanY = Math.max(1, height - marginY * 2);
  const sites = [];
  let gridPositions = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) gridPositions.push([gx, gy]);
  }
  // 8 个聚落对应 3×3 网格时只跳过中心，四角四边都必须有聚落。
  if (cols === 3 && rows === 3 && siteCount >= 7) {
    gridPositions = gridPositions.filter(([gx, gy]) => !(gx === 1 && gy === 1));
  }
  for (let i = 0; i < siteCount; i++) {
    const [gxIndex, gyIndex] = gridPositions[i];
    const gx = cols === 1 ? 0.5 : gxIndex / (cols - 1);
    const gy = rows === 1 ? 0.5 : gyIndex / (rows - 1);
    const jitterX = (random() - 0.5) * spanX * 0.1;
    const jitterY = (random() - 0.5) * spanY * 0.1;
    sites.push({
      x: Math.max(marginX, Math.min(width - marginX - 1, Math.round(marginX + spanX * gx + jitterX))),
      y: Math.max(marginY, Math.min(height - marginY - 1, Math.round(marginY + spanY * gy + jitterY))),
      radius,
    });
  }
  return sites;
}

function nearestCellsBetween(aCells, bCells) {
  let best = null;
  for (const ax of aCells) {
    for (const by of bCells) {
      const [axx, ayy] = ax.split(',').map(Number);
      const [bxx, byy] = by.split(',').map(Number);
      const d = (axx - bxx) ** 2 + (ayy - byy) ** 2;
      if (!best || d < best.d) best = { d, from: { x: axx, y: ayy }, to: { x: bxx, y: byy } };
    }
  }
  return best;
}

function buildBuildingInstances(buildingAssets, requestedBuildings, random) {
  // 只有普通可复用建筑参与超密度循环复用，特殊建筑始终只放一座。
  const reusable = buildingAssets.filter(a => a.meta?.reusable && !a.meta?.special);
  const firstLimit = (asset) => Math.max(1, Math.min(24, parseInt(asset.meta?.maxInstances, 10) || 1)) - 1;
  const declaredCapacity = buildingAssets.length
    + reusable.reduce((sum, asset) => sum + firstLimit(asset), 0);
  const ordered = [...buildingAssets];
  for (const asset of reusable) {
    for (let i = 0; i < firstLimit(asset); i++) ordered.push(asset);
  }
  if (requestedBuildings > declaredCapacity && reusable.length) {
    const extraCount = requestedBuildings - declaredCapacity;
    for (let i = 0; i < extraCount; i++) ordered.push(reusable[i % reusable.length]);
  }
  return ordered.slice(0, requestedBuildings);
}

export function generateLocalLayout({
  readyAssets,
  blueprint = { npcs: [] },
  cols,
  rows,
  buildingDensity,
  propDensity,
  seed,
}) {
  const warnings = [];
  const width = Math.max(12, parseInt(cols, 10) || 50);
  const height = Math.max(12, parseInt(rows, 10) || 50);
  const random = createRandom(seed);
  const cellCount = width * height;

  const groundAssets = readyAssets.filter(a => a.kind === 'ground');
  const roadAssets = readyAssets.filter(a => a.kind === 'road');
  const buildingAssets = readyAssets.filter(a => a.kind === 'building');
  const propAssets = readyAssets.filter(a => a.kind === 'prop');
  if (!groundAssets.length || !roadAssets.length || !buildingAssets.length) {
    throw new Error('可用素材不足：至少需要地皮、道路和建筑');
  }

  const baseGround = groundAssets[0];
  const baseRoad = roadAssets[0];
  const ground = Array.from({ length: height }, () => Array(width).fill(baseGround.id));
  const road = Array.from({ length: height }, () => Array(width).fill(null));
  const occupancy = Array.from({ length: height }, () => Array(width).fill(0));
  const blockOverride = Array.from({ length: height }, () => Array(width).fill(-1));
  const objects = [];
  const placedBuildingCentroids = [];
  const bounds = { minX: 1, minY: 1, maxX: width - 2, maxY: height - 2 };

  const normalizedBuildingDensity = Number.isFinite(Number(buildingDensity)) ? Number(buildingDensity) : 1;
  const normalizedPropDensity = Number.isFinite(Number(propDensity)) ? Number(propDensity) : 1;
  const requestedBuildings = Math.max(1, Math.round(cellCount * normalizedBuildingDensity / 1000));
  const requestedProps = Math.max(requestedBuildings + 1, Math.round(cellCount * normalizedPropDensity / 1000));

  // 每个聚落一条不规则环路；全图网格撒点，聚落之间按最短点对生成树连接。
  const sites = planSites(width, height, requestedBuildings, random);
  const siteLoopCells = sites.map(site => paintOrganicLoop(road, baseRoad.id, site, bounds, random));
  const connectedSites = [0];
  const unconnectedSites = sites.slice(1).map((_, i) => i + 1);
  while (unconnectedSites.length) {
    let best = null;
    for (const siteIndex of unconnectedSites) {
      for (const connectedIndex of connectedSites) {
        const pair = nearestCellsBetween(siteLoopCells[connectedIndex], siteLoopCells[siteIndex]);
        if (pair && (!best || pair.d < best.pair.d)) best = { siteIndex, pair };
      }
    }
    if (!best) break;
    paintOrganicPath(road, baseRoad.id, best.pair.from, best.pair.to, bounds, random);
    connectedSites.push(best.siteIndex);
    unconnectedSites.splice(unconnectedSites.indexOf(best.siteIndex), 1);
  }

  // 把路格重新归到最近的聚落，保证每个聚落都有独立候选路格。
  const roadCellsBySite = sites.map(() => []);
  for (let y = 1; y <= height - 2; y++) {
    for (let x = 1; x <= width - 2; x++) {
      if (road[y][x] == null) continue;
      occupancy[y][x] = 1;
      let nearest = 0;
      let bestD = Infinity;
      for (let i = 0; i < sites.length; i++) {
        const d = (x - sites[i].x) ** 2 + (y - sites[i].y) ** 2;
        if (d < bestD) {
          bestD = d;
          nearest = i;
        }
      }
      roadCellsBySite[nearest].push(cellKey(x, y));
    }
  }

  const fits = (x, y, w, h) => {
    if (x < 1 || y < 1 || x + w > width - 1 || y + h > height - 1) return false;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (occupancy[yy][xx] !== 0) return false;
      }
    }
    return true;
  };
  const reserve = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) occupancy[yy][xx] = 2;
    }
  };
  const centroidDistance = (x, y, w, h) => {
    const cx = x + w / 2;
    const cy = y + h / 2;
    let nearest = Infinity;
    for (const placed of placedBuildingCentroids) {
      nearest = Math.min(nearest, Math.hypot(cx - placed.x, cy - placed.y));
    }
    return nearest === Infinity ? 14 : Math.min(14, nearest);
  };

  const candidateAnchorForRoad = (asset, roadCell, roadUse) => {
    const { w, h } = footprintOf(asset);
    const door = doorOf(asset);
    const [rx, ry] = roadCell.split(',').map(Number);
    const results = [];
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const doorX = rx + dx;
      const doorY = ry + dy;
      const x = doorX - door.dx;
      const y = doorY - door.dy;
      if (!fits(x, y, w, h)) continue;
      const edgeGap = Math.min(x, y, width - 1 - (x + w), height - 1 - (y + h));
      const roadCount = roadUse.get(roadCell) || 0;
      results.push({
        x,
        y,
        w,
        h,
        roadCell,
        score: centroidDistance(x, y, w, h) + random() * 2.6 - roadCount * 3 - (edgeGap < 2 ? 3 : 0),
      });
    }
    return results;
  };

  function chooseBuildingCandidate(asset, siteIndex, roadUse) {
    let best = null;
    for (const roadCell of roadCellsBySite[siteIndex] || []) {
      for (const candidate of candidateAnchorForRoad(asset, roadCell, roadUse)) {
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
    return best;
  }

  function paintBranchRoad(siteIndex) {
    let best = null;
    for (const roadCell of roadCellsBySite[siteIndex] || []) {
      const [rx, ry] = roadCell.split(',').map(Number);
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        let clear = 0;
        for (let step = 1; step <= 4; step++) {
          const nx = rx + dx * step;
          const ny = ry + dy * step;
          if (nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY) break;
          if (occupancy[ny][nx] !== 0 || road[ny][nx] != null) break;
          clear++;
        }
        if (clear > 1 && (!best || clear > best.clear)) best = { rx, ry, dx, dy, clear };
      }
    }
    if (!best) return false;
    for (let step = 1; step <= best.clear; step++) {
      const nx = best.rx + best.dx * step;
      const ny = best.ry + best.dy * step;
      road[ny][nx] = baseRoad.id;
      occupancy[ny][nx] = 1;
      roadCellsBySite[siteIndex].push(cellKey(nx, ny));
    }
    return true;
  }

  function repairCandidate(asset, siteIndex, roadUse) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!paintBranchRoad(siteIndex)) break;
      const candidate = chooseBuildingCandidate(asset, siteIndex, roadUse);
      if (candidate) return candidate;
    }
    return null;
  }

  const buildingTarget = Math.min(requestedBuildings, Math.max(1, Math.floor(cellCount / 8)));
  const assignedBuildings = buildBuildingInstances(buildingAssets, buildingTarget, random);
  const instanceCounters = new Map();
  const roadUse = roadCellsBySite.map(() => new Map());
  const remainingQuota = Array(sites.length).fill(0);
  for (let i = 0; i < assignedBuildings.length; i++) remainingQuota[i % sites.length]++;

  let placedBuildings = 0;
  let buildingCursor = 0;
  while (buildingCursor < assignedBuildings.length) {
    const asset = assignedBuildings[buildingCursor];
    const preferredSite = buildingCursor % sites.length;
    let siteIndex = preferredSite;
    if (!chooseBuildingCandidate(asset, siteIndex, roadUse[siteIndex])) {
      siteIndex = -1;
      for (let i = 0; i < remainingQuota.length; i++) {
        if (!chooseBuildingCandidate(asset, i, roadUse[i])) continue;
        if (siteIndex < 0 || remainingQuota[i] > remainingQuota[siteIndex]) siteIndex = i;
      }
    }
    let candidate = siteIndex >= 0 ? chooseBuildingCandidate(asset, siteIndex, roadUse[siteIndex]) : null;
    if (!candidate) {
      const repairOrder = [];
      for (let i = 0; i < remainingQuota.length; i++) {
        repairOrder.push(i);
      }
      repairOrder.sort((a, b) => remainingQuota[b] - remainingQuota[a]);
      for (const attemptSite of repairOrder) {
        candidate = repairCandidate(asset, attemptSite, roadUse[attemptSite]);
        if (candidate) {
          siteIndex = attemptSite;
          break;
        }
      }
    }
    if (!candidate) {
      buildingCursor++;
      continue;
    }
    reserve(candidate.x, candidate.y, candidate.w, candidate.h);
    roadUse[siteIndex].set(candidate.roadCell, (roadUse[siteIndex].get(candidate.roadCell) || 0) + 1);
    placedBuildingCentroids.push({ x: candidate.x + candidate.w / 2, y: candidate.y + candidate.h / 2 });
    const key = String(asset.key || asset.name || asset.id).trim().toLowerCase();
    const instance = asset.meta?.reusable
      ? Math.max(1, instanceCounters.get(key) || 0) + 1
      : 1;
    if (asset.meta?.reusable) instanceCounters.set(key, instance);
    objects.push({
      assetId: asset.id,
      x: candidate.x,
      y: candidate.y + candidate.h - 1,
      flip: random() < 0.5,
      assetKey: asset.key,
      instance,
      _layoutKind: 'building',
    });
    remainingQuota[siteIndex]--;
    placedBuildings++;
    buildingCursor++;
  }
  if (placedBuildings < buildingTarget) {
    warnings.push(`建筑目标 ${buildingTarget} 个，聚落路网旁只放下了 ${placedBuildings} 个`);
  }

  // 地皮上叠小簇核心斑点 + 少量野生 patch，避免大片广场砖。
  const decorativeGround = groundAssets.slice(1);
  if (decorativeGround.length) {
    const paintBlob = (cx, cy, radius) => {
      const asset = decorativeGround[Math.floor(random() * decorativeGround.length)];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius * (0.62 + random() * 0.48)) {
            const x = cx + dx;
            const y = cy + dy;
            if (x >= 0 && x < width && y >= 0 && y < height) ground[y][x] = asset.id;
          }
        }
      }
    };
    for (const site of sites) paintBlob(site.x, site.y, Math.max(2, Math.round(site.radius * 0.5)));
    const wildPatchCount = Math.max(1, Math.min(decorativeGround.length * 3, Math.round(cellCount / 900)));
    for (let i = 0; i < wildPatchCount; i++) {
      paintBlob(
        Math.round(1 + random() * (width - 2)),
        Math.round(1 + random() * (height - 2)),
        2 + Math.floor(random() * 3),
      );
    }
  }

  const propTarget = propAssets.length
    ? Math.min(requestedProps, Math.max(0, Math.floor(cellCount / 6)))
    : 0;
  if (propTarget > 0) {
    const bucketSize = Math.max(4, Math.round(Math.sqrt(cellCount / 9)));
    const bucketCols = Math.max(1, Math.ceil(width / bucketSize));
    const buckets = [];
    for (let by = 0; by * bucketSize < height; by++) {
      for (let bx = 0; bx * bucketSize < width; bx++) {
        buckets.push(shuffle([], random));
      }
    }
    for (let y = 1; y <= height - 2; y++) {
      for (let x = 1; x <= width - 2; x++) {
        const by = Math.floor(y / bucketSize);
        const bx = Math.floor(x / bucketSize);
        const bucketIndex = Math.min(buckets.length - 1, by * bucketCols + bx);
        if (buckets[bucketIndex]) buckets[bucketIndex].push(cellKey(x, y));
      }
    }
    for (let i = 0; i < buckets.length; i++) buckets[i] = shuffle(buckets[i], random);
    const bucketOrder = shuffle(buckets.map((_, i) => i), random);
    let placedProps = 0;
    let cursor = 0;
    let progress = true;
    while (placedProps < propTarget && progress) {
      progress = false;
      for (const bucketIndex of bucketOrder) {
        if (placedProps >= propTarget) break;
        const bucket = buckets[bucketIndex];
        if (cursor >= bucket.length) continue;
        const key = bucket[cursor];
        const [x, y] = key.split(',').map(Number);
        const expected = propAssets[placedProps % propAssets.length];
        const { w, h } = footprintOf(expected);
        for (let offset = 0; offset < propAssets.length; offset++) {
          const desired = propAssets[(placedProps + offset) % propAssets.length];
          const { w, h } = footprintOf(desired);
          if (!fits(x, y, w, h)) continue;
          reserve(x, y, w, h);
          objects.push({
            assetId: desired.id,
            x,
            y: y + h - 1,
            flip: random() < 0.5,
            assetKey: desired.key,
            instance: 1,
            _layoutKind: 'prop',
          });
          placedProps++;
          progress = true;
          break;
        }
      }
      cursor++;
    }
    if (placedProps < propTarget) {
      warnings.push(`道具目标 ${propTarget} 个，剩余地皮只放下了 ${placedProps} 个`);
    }
  } else if (requestedProps > 0) {
    warnings.push('没有可用道具素材，跳过道具布局');
  }

  objects.forEach((object, index) => { object.id = index + 1; });

  // 特殊建筑全部作为 POI；没有特殊建筑时拿前几个建筑兜底，保证日程有地点。
  const buildingById = new Map(buildingAssets.map(a => [a.id, a]));
  const specialObjects = objects.filter(o => o._layoutKind === 'building'
    && !buildingById.get(o.assetId)?.meta?.reusable);
  const poiObjects = specialObjects.length
    ? specialObjects
    : objects.filter(o => o._layoutKind === 'building').slice(0, Math.min(4, objects.length));
  const usedLocationKeys = new Set();
  const locations = poiObjects.map((obj, index) => {
    const asset = buildingById.get(obj.assetId);
    const fp = footprintOf(asset);
    const door = doorOf(asset);
    let key = sanitizeKey(asset?.key || asset?.name || `place_${index + 1}`);
    let suffix = 2;
    while (usedLocationKeys.has(key)) key = `${sanitizeKey(asset?.key || asset?.name || `place_${index + 1}`)}_${suffix++}`;
    usedLocationKeys.add(key);
    return {
      key,
      name: String(asset?.name || key).slice(0, 30),
      aliases: [],
      kind: 'place',
      x: Math.max(0, Math.min(width - 1, obj.x + door.dx)),
      y: Math.max(0, Math.min(height - 1, obj.y - (fp.h - 1 - door.dy))),
      radius: 2,
      ambient: '',
      objectId: obj.id,
      objectAssetKey: obj.assetKey,
      objectInstance: obj.instance,
    };
  });

  const allRoadKeys = roadCellsBySite.flat();
  const mapCenterX = Math.round(width / 2);
  const mapCenterY = Math.round(height / 2);
  const plazaRoad = allRoadKeys.length
    ? allRoadKeys.reduce((best, key) => {
      const [x, y] = key.split(',').map(Number);
      const d = (x - mapCenterX) ** 2 + (y - mapCenterY) ** 2;
      return d < best.d ? { key, d, x, y } : best;
    }, { key: allRoadKeys[0], d: Infinity, x: mapCenterX, y: mapCenterY })
    : { key: `${mapCenterX},${mapCenterY}`, d: 0, x: mapCenterX, y: mapCenterY };
  if (!usedLocationKeys.has('central_plaza')) {
    usedLocationKeys.add('central_plaza');
    locations.push({
      key: 'central_plaza',
      name: '中央广场',
      aliases: ['广场'],
      kind: 'outdoor',
      x: Math.max(0, Math.min(width - 1, plazaRoad.x)),
      y: Math.max(0, Math.min(height - 1, plazaRoad.y)),
      radius: Math.max(2, Math.min(4, Math.round(sites[0].radius * 0.55))),
      ambient: '',
      objectId: null,
      objectAssetKey: null,
      objectInstance: null,
    });
  }

  const npcList = Array.isArray(blueprint?.npcs) ? blueprint.npcs : [];
  const npcSpawns = npcList.map((npc, index) => ({
    npcRef: String(npc?.displayName || ''),
    locationKey: locations.length ? locations[index % locations.length].key : 'central_plaza',
  })).filter(item => item.npcRef);

  const layerObjects = objects.map(({ assetKey, instance, _layoutKind, ...rest }) => rest);
  return {
    name: '新小镇',
    cols: width,
    rows: height,
    tileSize: 32,
    layers: {
      ground,
      road,
      objects: layerObjects,
      blockOverride,
    },
    locations,
    npcSpawns,
    warnings,
  };
}
