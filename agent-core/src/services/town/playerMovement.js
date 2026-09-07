// Preserve the partially travelled edge when clicks replace a route.
// Pathfinding still receives integer cells, and repeated commands cannot advance time.
export function playerRouteStart(player, now) {
  const path = player.path || [];
  const progress = Math.max(0, (now - player.moveStartedAt) / 1000 * player.speed);
  const index = Math.floor(progress);
  if (!path.length || index >= path.length) {
    const from = path.at(-1) || { x: player.x, y: player.y };
    return { from, cell: from, prefix: [], startedAt: now };
  }
  const from = index ? path[index - 1] : (player.moveFrom || { x: player.x, y: player.y });
  const fraction = progress - index;
  if (fraction < 1e-9) return { from, cell: from, prefix: [], startedAt: now };
  return { from, cell: path[index], prefix: [path[index]], startedAt: now - fraction / player.speed * 1000 };
}
export function applyPlayerRoute(player, start, tail) {
  player.moveRevision = (player.moveRevision || 0) + 1;
  player.x = start.from.x; player.y = start.from.y;
  player.moveFrom = { ...start.from };
  player.path = [...start.prefix, ...tail];
  player.moveStartedAt = start.startedAt;
}
