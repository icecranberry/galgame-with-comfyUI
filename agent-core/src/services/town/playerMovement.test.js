import test from 'node:test';
import assert from 'node:assert/strict';
import { playerRouteStart, applyPlayerRoute } from './playerMovement.js';
const position = (p, now) => {
  const distance = (now - p.moveStartedAt) / 1000 * p.speed, i = Math.floor(distance), f = distance - i;
  const from = i ? p.path[i - 1] : p.moveFrom, to = p.path[i];
  return to ? { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f } : p.path.at(-1) || p;
};
test('rapid retargeting preserves position and speed during an unfinished step', () => {
  const p = { x: 0, y: 0, speed: 1 };
  applyPlayerRoute(p, playerRouteStart(p, 1000), [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  for (let now = 1010; now < 1990; now += 10) {
    const before = position(p, now), start = playerRouteStart(p, now);
    applyPlayerRoute(p, start, [{ x: 1, y: now % 20 ? 1 : -1 }]);
    assert.deepEqual(position(p, now), before);
    assert(Math.abs(position(p, now).x - (now - 1000) / 1000) < 1e-8);
  }
});
test('turns use integer pathfinding cells, completed routes and repeated destinations remain valid', () => {
  const p = { x: 0, y: 0, speed: 2 };
  applyPlayerRoute(p, playerRouteStart(p, 1000), [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.deepEqual(playerRouteStart(p, 1750).cell, { x: 2, y: 0 });
  const start = playerRouteStart(p, 1750), before = position(p, 1750);
  applyPlayerRoute(p, start, []);
  assert.deepEqual(position(p, 1750), before);
  assert.deepEqual(playerRouteStart(p, 2200).from, { x: 2, y: 0 });
  assert.equal(p.moveRevision, 2);
});
