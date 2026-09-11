/**
 * 小镇网格寻路（A*，4 方向）
 *
 * 纯函数、无 IO：walk_grid 是 town_maps.walk_grid 反序列化后的二维数组
 * （rows[y][x]，1 = 可走，0 = 障碍）。townService 的 tick 推进与
 * REST 的玩家移动共用同一实现，保证两端路径一致。
 */

/**
 * 在可行走网格上寻找从 from 到 to 的最短路径（A*，曼哈顿启发）
 * @param {number[][]} grid - rows[y][x]，1=可走 0=障碍
 * @param {{x:number, y:number}} from - 起点（须在网格内；允许落在障碍上，走出的第一步仍按邻格判定）
 * @param {{x:number, y:number}} to - 终点（须可走）
 * @returns {Array<{x:number, y:number}>|null} 不含起点的逐格路径；起终点相同返回 []；不可达返回 null
 */
export function findPath(grid, from, to) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const rows = grid.length;
  const cols = grid[0].length;
  const inBounds = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;
  if (!inBounds(from) || !inBounds(to)) return null;
  if (!isWalkable(grid, to.x, to.y)) return null;

  const startKey = from.y * cols + from.x;
  const goalKey = to.y * cols + to.x;
  if (startKey === goalKey) return [];

  const open = [{ x: from.x, y: from.y, g: 0, f: heuristic(from.x, from.y, to.x, to.y) }];
  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();

  while (open.length > 0) {
    // 网格很小（千级格子），线性取最小 f 即可，不值得引入二叉堆
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0];
    const curKey = cur.y * cols + cur.x;
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (curKey === goalKey) {
      return reconstructPath(cameFrom, curKey, cols);
    }

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isWalkable(grid, nx, ny)) continue;
      const nKey = ny * cols + nx;
      if (closed.has(nKey)) continue;
      const ng = cur.g + 1;
      if (ng < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, ng);
        cameFrom.set(nKey, curKey);
        open.push({ x: nx, y: ny, g: ng, f: ng + heuristic(nx, ny, to.x, to.y) });
      }
    }
  }
  return null;
}

function heuristic(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

export function isWalkable(grid, x, y) {
  if (!Array.isArray(grid) || y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (!Array.isArray(row) || x < 0 || x >= row.length) return false;
  return row[x] === 1;
}

function reconstructPath(cameFrom, goalKey, cols) {
  const path = [];
  let key = goalKey;
  while (cameFrom.has(key)) {
    path.push({ x: key % cols, y: Math.floor(key / cols) });
    key = cameFrom.get(key);
  }
  path.reverse();
  return path;
}

/**
 * 在锚点周围 radius 内（切比雪夫距离）找一个可走且未被占用的站立格。
 * 从锚点向外螺旋扩展；radius 内找满则继续向外放宽几圈（人群拥挤时不至于
 * 全部叠回锚点一个点），最多放宽 +4 圈。
 * @param {number[][]} grid
 * @param {Set<string>} occupied - 已被占用的 "x,y" 集合
 * @param {{x:number, y:number}} anchor
 * @param {number} radius
 * @returns {{x:number, y:number}|null}
 */
export function pickStandingCell(grid, occupied, anchor, radius) {
  for (let r = 0; r <= radius + 4; r++) {
    if (r === 0) {
      if (isWalkable(grid, anchor.x, anchor.y) && !occupied.has(`${anchor.x},${anchor.y}`)) {
        return { x: anchor.x, y: anchor.y };
      }
      continue;
    }
    const candidates = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // 只看外圈
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (isWalkable(grid, x, y) && !occupied.has(`${x},${y}`)) {
          candidates.push({ x, y });
        }
      }
    }
    if (candidates.length > 0) {
      // 候选随机取一个，避免所有人排成一条整齐的线
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  return null;
}
