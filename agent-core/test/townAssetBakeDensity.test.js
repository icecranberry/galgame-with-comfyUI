import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`town asset bake fixture forbids network: ${url}`); };

const { ASSET_SPECS, TILE_PIXEL } = await import('../src/services/town/townAssetService.js');

/** 蓝图约束（townInitService）：建筑 footprint 2~3、道具 1~3，等距占格宽最大 (3+3) */
const MAX_FOOTPRINT = { w: 3, h: 3 };
/** 等距投影下屏幕占格宽：一格宽 64px，占格 (w+h) 格 → (w+h)*32px */
const screenWidth = fp => (fp.w + fp.h) * 32;

test('建筑/道具按屏幕占格宽的 4 倍边长烘焙', () => {
  for (const kind of ['building', 'prop']) {
    const { pixelWidth } = ASSET_SPECS[kind];
    for (const fp of [{ w: 1, h: 1 }, { w: 2, h: 2 }, { w: 2, h: 3 }, MAX_FOOTPRINT]) {
      assert.equal(pixelWidth(fp), screenWidth(fp) * 4, `${kind} ${fp.w}x${fp.h}`);
    }
  }
});

// 回归背景：烘焙边长一旦超过生成端最短边，pixelate 的 fit:'fill' 就是在把糊图放大——
// 白涨显存且比不提密度还差，所以生成尺寸必须跟着烘焙口径一起调。
test('生成端最短边压得住最大占格的成品边长', () => {
  for (const kind of ['building', 'prop']) {
    const spec = ASSET_SPECS[kind];
    const baked = spec.pixelWidth(MAX_FOOTPRINT);
    const gen = Math.min(spec.size.width, spec.size.height);
    assert.ok(gen > baked, `${kind}: 生成端 ${gen} 未超过成品边长 ${baked}`);
  }
});

// 地砖/道路的成品是 TILE_PIXEL（128×64 = 屏幕占格宽的 2 倍边长），与建筑/道具的插画烘焙口径不同。
// 回归背景：1:1 的 64×32 会把源图里 4px 的砖缝（≈0.35 texel）平均成中间色，看起来就是「糊」。
test('地砖/道路成品是 128×64，且与 TILE_PIXEL 单一来源一致', () => {
  assert.deepEqual(TILE_PIXEL, { w: 128, h: 64 });
  for (const kind of ['ground', 'road']) assert.deepEqual(ASSET_SPECS[kind].pixel, TILE_PIXEL);
});
