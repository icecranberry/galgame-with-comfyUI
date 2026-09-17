import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webUiDir = join(here, '..');
const assetsDir = join(webUiDir, '..', 'agent-core', 'public', 'assets');

const config = (await import('../vite.config.js')).default;
const manualChunks = config.build.rollupOptions.output.manualChunks;

// 回归背景：小镇渲染包 Hd2dTownRenderer 是 TownView 动态 import 出来的 chunk。
// 它依赖的一批纯计算模块原本留在入口包里，rollup 便把这个依赖的「文件名」硬编码
// 进了渲染包内容（import{...}from"./index-xxx.js"）。入口包只要有任何无关改动就会改名，
// 渲染包内容跟着变、文件名也跟着变 —— 明明没动小镇代码，渲染包也要整体重建一遍
// （历史上已经攒出 21 个不同文件名）。修法：把这些共享模块固定成自足分包 town-shared，
// 让渲染包只引用这个稳定文件名。以下断言守住这个口径。
const sharedModules = [
  'projection.js',
  'groundTexture.js',
  'imageAlpha.js',
  'TownSceneAdapter.js',
  'buildingVolumeProfile.js',
  'agentMotion.js',
];

// 产物是压缩后的 ESM：静态导入写作 from"./x.js"，动态导入写作 import("./x.js")，两种都要抓
const RELATIVE_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*"\.\/([^"]+)"/g;
const importTargets = source => [...new Set([...source.matchAll(RELATIVE_IMPORT)].map(m => m[1]))];

test('渲染包依赖的共享模块被固定分包到 town-shared（POSIX 与 Windows 路径都命中）', () => {
  for (const name of sharedModules) {
    assert.equal(
      manualChunks(`/repo/web-ui/src/town/renderers/${name}`),
      'town-shared',
      `${name} 应命中 town-shared（POSIX 路径）`,
    );
    assert.equal(
      manualChunks(`C:\\repo\\web-ui\\src\\town\\renderers\\${name}`),
      'town-shared',
      `${name} 应命中 town-shared（Windows 路径）`,
    );
  }
});

test('渲染包入口与其它 renderer 模块留在动态 chunk 内，不并入 town-shared', () => {
  assert.equal(manualChunks('/repo/web-ui/src/town/renderers/Hd2dTownRenderer.js'), undefined);
  assert.equal(manualChunks('/repo/web-ui/src/town/renderers/sceneLook.js'), undefined);
});

test('依赖不被误并入 town-shared（three 等 node_modules 必须留在自己的 chunk）', () => {
  assert.equal(manualChunks('/repo/web-ui/node_modules/three/build/three.module.js'), undefined);
  assert.equal(manualChunks('/repo/web-ui/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'), undefined);
});

test('构建产物：渲染包的依赖闭包不包含入口包', t => {
  if (!existsSync(assetsDir)) return t.skip('尚未构建 agent-core/public/assets，跳过产物检查');
  const files = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  const renderer = files.find(f => /^Hd2dTownRenderer-.*\.js$/.test(f));
  if (!renderer) return t.skip('产物中没有 Hd2dTownRenderer-*.js，跳过');

  const seen = new Set();
  const queue = [renderer];
  while (queue.length) {
    const current = queue.pop();
    if (seen.has(current) || !files.includes(current)) continue;
    seen.add(current);
    for (const target of importTargets(readFileSync(join(assetsDir, current), 'utf8'))) queue.push(target);
  }

  // 闭包里一旦出现入口包，入口任何改动都会把渲染包连带改名重建
  const entryRefs = [...seen].filter(name => /^index-.*\.js$/.test(name));
  assert.deepEqual(entryRefs, [], `渲染包依赖闭包不应包含入口包，实际：${entryRefs.join(', ')}`);

  // 闭包里的每个 chunk 都必须真实存在，避免产物缺失被静默放过
  for (const name of seen) {
    assert.ok(files.includes(name), `渲染包引用的 ${name} 不存在于产物中`);
  }
});

test('构建产物：渲染包与其共享分包引用稳定，不随入口包改名', t => {
  if (!existsSync(assetsDir)) return t.skip('尚未构建 agent-core/public/assets，跳过产物检查');
  const files = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  const renderer = files.find(f => /^Hd2dTownRenderer-.*\.js$/.test(f));
  if (!renderer) return t.skip('产物中没有 Hd2dTownRenderer-*.js，跳过');

  const targets = importTargets(readFileSync(join(assetsDir, renderer), 'utf8'));
  assert.ok(targets.length > 0, '渲染包应引用固定分包，而不是把共享模块内联进自身');
  for (const name of targets) {
    assert.ok(!/^index-.*\.js$/.test(name), `渲染包直接引用了入口包：${name}`);
  }

  // 共享分包自身不得再引用入口包，否则入口改名仍会顺链传染
  for (const name of targets) {
    if (!files.includes(name)) continue;
    const nested = importTargets(readFileSync(join(assetsDir, name), 'utf8'));
    assert.deepEqual(
      nested.filter(n => /^index-.*\.js$/.test(n)),
      [],
      `分包 ${name} 引用了入口包`,
    );
  }
});