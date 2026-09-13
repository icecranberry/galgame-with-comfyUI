import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildWalkGridFromLayers, getObjectBlockingCells } = await import('../src/services/town/townMapService.js');

const assetsById = new Map([
  [1, { id: 1, kind: 'building', meta: { footprint: { w: 2, h: 2 }, doorOffset: { dx: 1, dy: 1 } } }],
  [2, { id: 2, kind: 'prop', meta: { footprint: { w: 2, h: 2 }, blocking: true } }],
]);

const gridAt = (grid, x, y) => grid[y][x];

test('建筑阻挡外扩一圈：2×2 占格实际阻挡 3×3（n×n → (n+2)×(n+2)）', () => {
  // 建筑占 (2,2)-(3,3)，外扩后 (1,1)-(4,4) 全阻挡；门前格 (3,3) 按设计留空
  const grid = buildWalkGridFromLayers(8, 8, { objects: [{ assetId: 1, x: 2, y: 3 }] }, assetsById);
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 4; x++) {
      if (x === 3 && y === 3) { assert.equal(gridAt(grid, x, y), 1, '门前格应保持可走'); continue; }
      assert.equal(gridAt(grid, x, y), 0, `(${x},${y}) 应被建筑缓冲带阻挡`);
    }
  }
  // 缓冲带外一圈可走
  assert.equal(gridAt(grid, 0, 0), 1);
  assert.equal(gridAt(grid, 5, 5), 1);
  assert.equal(gridAt(grid, 1, 5), 1);
});

test('缓冲带不阻挡道路格，路网连通性不受影响', () => {
  // 建筑占 (2,2)-(3,3)，(4,3) 是贴墙道路 → 缓冲带跳过它保持可走
  const road = Array.from({ length: 8 }, () => Array(8).fill(null));
  road[3][4] = 9;
  const grid = buildWalkGridFromLayers(8, 8, { road, objects: [{ assetId: 1, x: 2, y: 3 }] }, assetsById);
  assert.equal(gridAt(grid, 4, 3), 1, '贴墙道路格应保持可走');
  assert.equal(gridAt(grid, 4, 2), 0, '非道路缓冲格仍应阻挡');
});

test('blockOverride=0 手动清障仍可强制打开缓冲带格子', () => {
  const override = Array.from({ length: 8 }, () => Array(8).fill(-1));
  override[1][1] = 0;
  const grid = buildWalkGridFromLayers(8, 8, { blockOverride: override, objects: [{ assetId: 1, x: 2, y: 3 }] }, assetsById);
  assert.equal(gridAt(grid, 1, 1), 1, '手动清障应覆盖缓冲带');
  assert.equal(gridAt(grid, 1, 2), 0);
});

test('道具（树）阻挡不外扩，维持原样', () => {
  // 真实道具 meta 只有 blocking（锚点阻挡），没有 footprintKind
  const grid = buildWalkGridFromLayers(8, 8, { objects: [{ assetId: 2, x: 4, y: 5 }] }, assetsById);
  assert.equal(gridAt(grid, 4, 5), 0, '锚点格阻挡');
  assert.equal(gridAt(grid, 5, 5), 1);
  assert.equal(gridAt(grid, 3, 4), 1, '道具周边不外扩');
  assert.equal(gridAt(grid, 6, 6), 1);
});

test('getObjectBlockingCells 仍只返回 footprint 本体（缓冲带只在 buildWalkGridFromLayers 内扩）', () => {
  const cells = getObjectBlockingCells({ x: 2, y: 3 }, assetsById.get(1).meta, 'building');
  // 2×2 = 4 格，门前格 (3,3) 留空
  assert.equal(cells.length, 3);
  assert.ok(cells.every(c => c.x >= 2 && c.x <= 3 && c.y >= 2 && c.y <= 3));
});
