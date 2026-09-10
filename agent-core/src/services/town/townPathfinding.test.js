import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, isWalkable, pickStandingCell } from './townPathfinding.js';

// 6x4 测试网格：1=可走 0=障碍
// 1 1 1 1 1 1
// 1 0 0 0 0 1
// 1 1 1 1 1 1
// 1 1 1 1 1 1
const GRID = [
  [1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
];

test('findPath returns empty array when start equals goal', () => {
  assert.deepEqual(findPath(GRID, { x: 0, y: 0 }, { x: 0, y: 0 }), []);
});

test('findPath returns shortest path excluding the start cell', () => {
  const path = findPath(GRID, { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.ok(Array.isArray(path));
  // 曼哈顿最短路长度 = 2 步
  assert.equal(path.length, 2);
  assert.deepEqual(path[0], { x: 1, y: 0 });
  assert.deepEqual(path[path.length - 1], { x: 2, y: 0 });
});

test('findPath detours around obstacles and every step is walkable', () => {
  const path = findPath(GRID, { x: 0, y: 0 }, { x: 5, y: 2 });
  assert.ok(Array.isArray(path));
  // 沿顶边走到 x=5 再下绕：5 步横 + 2 步竖 = 7
  assert.equal(path.length, 7);
  for (const { x, y } of path) {
    assert.ok(isWalkable(GRID, x, y), `step (${x},${y}) should be walkable`);
  }
  // 相邻步必须四连通
  let prev = { x: 0, y: 0 };
  for (const step of path) {
    const dist = Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y);
    assert.equal(dist, 1);
    prev = step;
  }
});

test('findPath returns null when target is unreachable or blocked', () => {
  assert.equal(findPath(GRID, { x: 0, y: 0 }, { x: 2, y: 1 }), null); // 终点是障碍
  const sealed = [
    [1, 0, 1],
    [0, 0, 1],
    [1, 1, 1],
  ];
  assert.equal(findPath(sealed, { x: 0, y: 0 }, { x: 2, y: 2 }), null); // 起点被围死
  assert.equal(findPath(GRID, { x: -1, y: 0 }, { x: 2, y: 2 }), null); // 越界
  assert.equal(findPath(GRID, { x: 0, y: 0 }, { x: 99, y: 99 }), null);
});

test('pickStandingCell prefers the anchor then spirals outward avoiding occupied cells', () => {
  const empty = new Set();
  // 锚点可走 → 直接返回锚点
  assert.deepEqual(pickStandingCell(GRID, empty, { x: 2, y: 2 }, 2), { x: 2, y: 2 });
  // 锚点被占 → radius=1 内必有候选
  const occupied = new Set(['2,2']);
  const cell = pickStandingCell(GRID, occupied, { x: 2, y: 2 }, 1);
  assert.ok(cell);
  assert.notDeepEqual(cell, { x: 2, y: 2 });
  assert.ok(isWalkable(GRID, cell.x, cell.y));
  assert.ok(Math.max(Math.abs(cell.x - 2), Math.abs(cell.y - 2)) <= 1);
});

test('pickStandingCell widens the search when the requested radius is exhausted', () => {
  // 把 radius=1 的 9 格全部占住：放宽搜索应在 +4 圈内找到更远的可走格
  const all = new Set(['2,2', '1,2', '3,2', '2,1', '2,3', '1,1', '3,1', '1,3', '3,3']);
  const cell = pickStandingCell(GRID, all, { x: 2, y: 2 }, 1);
  assert.ok(cell, 'should widen beyond the requested radius');
  assert.ok(isWalkable(GRID, cell.x, cell.y));
  const ring = Math.max(Math.abs(cell.x - 2), Math.abs(cell.y - 2));
  assert.ok(ring > 1 && ring <= 5, `expected a widened ring, got ${ring}`);
});

test('pickStandingCell returns null only when everything within radius+4 is blocked', () => {
  // 三面墙围死 + 剩余通路全占到 +4 圈：起点在封闭区
  const sealed = [
    [1, 0, 1],
    [0, 0, 1],
    [1, 1, 1],
  ];
  const occupyAll = (grid, cx, cy, maxR) => {
    const s = new Set();
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[0].length; x++) {
        if (grid[y][x] === 1 && Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= maxR) s.add(`${x},${y}`);
      }
    }
    return s;
  };
  assert.equal(pickStandingCell(sealed, occupyAll(sealed, 1, 1, 5), { x: 1, y: 1 }, 1), null);
});
