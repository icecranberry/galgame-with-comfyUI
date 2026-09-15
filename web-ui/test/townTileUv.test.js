import { test } from 'node:test';
import assert from 'node:assert/strict';

const { groundUvs } = await import('../src/town/renderers/TownSceneAdapter.js');

// 回归背景：groundUvs 的内缩原本写死 4 texel。地砖成品从 64×32 提到 128×64 后，
// 同样 4 texel 在 UV 里只剩一半，会把本该裁在画幅外的菱形蒙版边 / 派生扩色带重新采样进来，
// 接缝会露白边。内缩必须按贴图宽度等比，两种分辨率采到的必须是同一块画面。
test('地砖 UV 不随成品分辨率变化（64×32 与 128×64 逐值一致）', () => {
  const ground = { kind: 'ground', meta: {} };
  assert.deepEqual(groundUvs(ground, 128, 64), groundUvs(ground, 64, 32));
});

test('道路 UV 不随成品分辨率变化', () => {
  const road = { kind: 'road', meta: {} };
  assert.deepEqual(groundUvs(road, 128, 64), groundUvs(road, 64, 32));
});

test('顶面朝向投影不参与内缩换算', () => {
  const asset = { kind: 'ground', meta: { projection: 'topdown_square' } };
  assert.deepEqual(groundUvs(asset, 128, 64), [[0, 1], [1, 1], [1, 0], [0, 0]]);
});
