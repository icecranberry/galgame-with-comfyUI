import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceAgentPosition } from '../src/services/town/agentMovement.js';

test('NPC 权威到达不会因请求频率提前，最后一格必须完成最后一条边', () => {
  const agent = { x: 0, y: 0, moveFrom: { x: 0, y: 0 }, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }], speed: 1, moveStartedAt: 1000 };
  for (const now of [500, 1000, 1001, 1500, 1999]) {
    assert.equal(advanceAgentPosition(agent, now), false);
    assert.equal(agent.x, 0);
  }
  advanceAgentPosition(agent, 2000);
  assert.equal(agent.x, 1);
  advanceAgentPosition(agent, 2999);
  assert.equal(agent.x, 1);
  assert.equal(advanceAgentPosition(agent, 3000), true);
  assert.equal(agent.x, 2);
  assert.equal(agent.path, null);
  assert.equal(agent.dirty, true);
  assert.equal(advanceAgentPosition(agent, 9000), false);
});

test('同一路径密集请求与一次推进得到相同权威位置', () => {
  const original = { x: 4, y: 8, moveFrom: { x: 4, y: 8 }, path: [{ x: 4, y: 9 }, { x: 5, y: 9 }, { x: 6, y: 9 }], speed: 0.7, moveStartedAt: 0 };
  const dense = structuredClone(original), single = structuredClone(original);
  for (let now = 0; now <= 2500; now += 5) advanceAgentPosition(dense, now);
  advanceAgentPosition(single, 2500);
  assert.deepEqual(dense, single);
  assert.deepEqual({ x: single.x, y: single.y }, { x: 4, y: 9 });
});
