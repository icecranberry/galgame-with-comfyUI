import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { getDb, closeDb } = await import('../src/db/index.js');
const { touchTownViewer, hasTownViewers } = await import('../src/services/town/townService.js');

test('town viewer gate is closed by default and opens on heartbeat touch', async t => {
  const db = getDb();
  t.after(() => closeDb());

  // 服务重启 / 从未有人打开世界页：默认无人观看，相遇与状态气泡被跳过
  assert.equal(hasTownViewers(), false);

  // 前端心跳打点后视为在线（45s TTL 内）
  touchTownViewer();
  assert.equal(hasTownViewers(), true);
});
