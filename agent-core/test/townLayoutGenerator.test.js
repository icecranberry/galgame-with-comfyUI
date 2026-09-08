import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLocalLayout } from '../src/services/town/townLayoutGenerator.js';

const asset = (id, kind, key, name, meta = {}) => ({ id, kind, key, name, meta });

function fixture() {
  return [
    asset(1, 'ground', 'grass_01', '草地'),
    asset(2, 'ground', 'flower_01', '花田'),
    asset(3, 'road', 'road_01', '石板路'),
    asset(4, 'building', 'cafe', '咖啡厅', { reusable: false, footprint: { w: 3, h: 3 } }),
    asset(5, 'building', 'house', '居民楼', { reusable: true, maxInstances: 6, footprint: { w: 3, h: 3 } }),
    asset(6, 'prop', 'tree', '橡树', { blocking: true, footprint: { w: 2, h: 2 }, footprintKind: 'prop' }),
    asset(7, 'prop', 'bench', '长椅', { blocking: false }),
  ];
}

test('local layout reaches high-density targets with an organic connected road network', () => {
  const draft = generateLocalLayout({
    readyAssets: fixture(),
    blueprint: { npcs: Array.from({ length: 8 }, (_, i) => ({ displayName: `居民${i + 1}` })) },
    cols: 50,
    rows: 50,
    buildingDensity: 20,
    propDensity: 40,
    seed: 42,
  });

  assert.equal(draft.cols, 50);
  assert.equal(draft.rows, 50);
  assert.equal(draft.layers.objects.length, 150);

  const assetsById = new Map(fixture().map(a => [a.id, a]));
  const roadCells = new Set();
  for (let y = 0; y < draft.rows; y++) {
    for (let x = 0; x < draft.cols; x++) {
      if (draft.layers.road[y][x] != null) roadCells.add(`${x},${y}`);
    }
  }

  // 所有路格都在一个连通域里：满密度也不允许出现互不相接的孤立路条。
  const seen = new Set();
  const queue = [[...roadCells][0]];
  seen.add(queue[0]);
  while (queue.length) {
    const [x, y] = queue.pop().split(',').map(Number);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const key = `${nx},${ny}`;
      if (roadCells.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  assert.equal(seen.size, roadCells.size);

  // 聚落式路网：允许短连接，但不允许出现贯通整行/整列的网格主干。
  assert.equal(draft.layers.road.some(row => row.every(v => v != null)), false);
  for (let x = 0; x < draft.cols; x++) {
    assert.equal(draft.layers.road.every(row => row[x] != null), false);
  }

  const occupied = Array.from({ length: draft.rows }, () => Array(draft.cols).fill(false));
  for (const object of draft.layers.objects) {
    const meta = assetsById.get(object.assetId).meta || {};
    const w = meta.footprint?.w || 1;
    const h = meta.footprint?.h || 1;
    const x0 = object.x;
    const y0 = object.y - h + 1;
    assert.ok(x0 >= 1 && y0 >= 1 && x0 + w < draft.cols && y0 + h < draft.rows);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        assert.equal(draft.layers.road[y][x], null, 'object must not overlap a road');
        assert.equal(occupied[y][x], false, 'objects must not overlap each other');
        occupied[y][x] = true;
      }
    }
  }

  const buildings = draft.layers.objects.filter(o => o.assetId === 4 || o.assetId === 5);
  const props = draft.layers.objects.filter(o => o.assetId === 6 || o.assetId === 7);
  assert.equal(buildings.length, 50);
  assert.equal(props.length, 100);
  assert.equal(draft.warnings.length, 0);

  const extent = (items) => items.reduce((box, item) => {
    const fp = assetsById.get(item.assetId).meta.footprint || { w: 1, h: 1 };
    const top = item.y - fp.h + 1;
    return { minX: Math.min(box.minX, item.x), maxX: Math.max(box.maxX, item.x + fp.w), minY: Math.min(box.minY, top), maxY: Math.max(box.maxY, top + fp.h) };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  assert.ok(extent(buildings).maxX - extent(buildings).minX > 30);
  assert.ok(extent(buildings).maxY - extent(buildings).minY > 30);
  assert.ok(extent(props).maxX - extent(props).minX > 35);
  assert.ok(extent(props).maxY - extent(props).minY > 35);

  const cornerGuards = [
    b => b.x + 1.5 < 15 && b.y - 1 < 15,
    b => b.x + 1.5 >= 35 && b.y - 1 < 15,
    b => b.x + 1.5 < 15 && b.y - 1 >= 35,
    b => b.x + 1.5 >= 35 && b.y - 1 >= 35,
  ];
  assert.ok(cornerGuards.every(guard => buildings.some(guard)), 'every map corner must contain buildings');

  for (const building of buildings) {
    const footprint = assetsById.get(building.assetId).meta.footprint;
    const door = { x: building.x + footprint.w - 1, y: building.y };
    const touchesRoad = [[door.x, door.y + 1], [door.x + 1, door.y], [door.x, door.y - 1], [door.x - 1, door.y]]
      .some(([x, y]) => roadCells.has(`${x},${y}`));
    assert.equal(touchesRoad, true, 'every building door must touch the road grid');
  }
  assert.equal(draft.locations.some(loc => loc.objectAssetKey === 'cafe'), true);
  assert.equal(draft.locations.some(loc => loc.key === 'central_plaza'), true);
  assert.equal(draft.npcSpawns.length, 8);
});

test('high density overrides the declared first-use cap by cycling reusable buildings', () => {
  const draft = generateLocalLayout({
    readyAssets: fixture().map(a => a.key === 'house' ? { ...a, meta: { ...a.meta, maxInstances: 2 } } : a),
    blueprint: { npcs: [] },
    cols: 50,
    rows: 50,
    buildingDensity: 20,
    propDensity: 40,
    seed: 7,
  });
  const buildings = draft.layers.objects.filter(o => o.assetId === 4 || o.assetId === 5);
  assert.equal(buildings.length, 50);
  assert.equal(draft.warnings.length, 0);
});
