# M7 交互对象遮挡淡化修正（2026-09-08）

按 plan 3.5 修正密集居民让多栋建筑长期淡化的问题。HD card、modular volume 与 Canvas 只考虑玩家和明确的 hover / selected / dialogue / activity 对象；其他居民路过不触发淡化。本次没有编辑 TownView，main 已接入下述参数。

## 接口与身份

```js
const interactionActorKeys = [
  'me', hoverAgentKey, selectedAgentKey,
  chatResident?.actorId, activityActorId,
].filter(Boolean)

hdRenderer.render(weather, matchingFocusGrounds, { interactionActorKeys })
canvasRenderer.draw(ctx, frames, nowMs, {
  // 保留原 labelsOnly / hover / selected 等选项
  interactionActorKeys,
})
```

`interactionActorKeys` 支持 `agentKey` 或稳定 `actorId`，匹配当前 renderer 中的居民 DTO。默认始终包含 `me`；省略、空数组或失效 key 不会选中其他居民。Canvas 原有显式 hover/selected 选项也加入集合。`focusPoints` / `matchingFocusGrounds` 仍只用于景深，不根据坐标推断身份，不会把同格居民全部当成交互对象。

纯身份 helper 位于 `interactionSubjects.js`，Canvas 不因此提前加载 Three/WebGL。`interactionOcclusion.js` 负责 HD 分面遮挡探测、淡化覆盖 shader 与状态恢复。

## 行为变化与深度

- 旧 HD card 的“遍历任意居民”改为交互集合；card 仍使用原贴图 alpha 轮廓探测。volume 根据交互人物身体采样点到相机的射线，检查前方实际表面和原 alphaCutoff，排除不可见 shadow caster。
- 每帧重新计算：对象退出遮挡、切换焦点、key 失效或角色离开时恢复覆盖率 1，不依赖退出事件，不保留前一个对象的透明状态。
- HD 原先 `.32` 的混合透明保留了整栋深度。现在采用固定 4×4 screen-door 覆盖（约 5/16），在原 alphaTest 后于同一可见片元中 discard，因此颜色与相机深度裁切同步；近看能看到规则覆盖颗粒。没有引入独立深度 override pass，也不新增 render target。
- **纯 card 的相机深度也修正：**`depthTest=false` 时即便 `depthWrite=true`，WebGL 也不写深度。现在 card 统一用 ALWAYS 深度测试，保持原 painter 覆盖顺序，同时写入真实 alpha/覆盖轮廓。这会修正纯卡片景深表现；不是无行为变化的重构。无淡化、关闭移轴的旧贴片像素回归仍一致。
- 实体阴影不使用交互淡化：card 的原 alpha 深度材质、footprint proxy、volume 单 caster 均保留。相机深度裁切与物理阴影是不同用途，角色获得可见性不会改变建筑的地面投影。
- card / volume / Canvas 拾取继续使用原轮廓和排序，不按覆盖颗粒点击穿透；agentsOnly / groundOnly 原语义不变。Canvas 无深度缓冲，沿用原 0.62 画面 alpha，仅收窄触发对象。

## 定向验收

使用 `hd2d-focus-fixture.html` / `hd2d-focus-browser.mjs`，复用 50×50、50 居民、80 对象的合成素材，不加载业务页/数据库/模型。before 使用本次修改前保存的 renderer/sceneLook；干净检出缺少该快照时，脚本只重建旧 all-resident + soft-alpha 策略作为对照。

结果：

- 密集场景 before 31 栋因非交互居民淡化；after 为 **0 栋**。即便把全部居民 ground 传入 focusPoints，也不会推断交互身份。
- card 和 volume 分别验证：无焦点 0 栋 → `npc:a` 只淡化 A → `actor:b` 恢复 A/淡化 B → 失效 key 全恢复；默认 me 淡化 A，me+dialogue 同时淡化 A/B；玩家走远恢复。
- Canvas 同样验证无焦点、A/B 切换、清空、hover 与默认 me：`[1,1] → [.62,1] → [1,.62] → [1,1]`。
- 淡化前后矩阵采样拾取结果完全一致。card 相机深度变化 29,958 像素、volume 37,723 像素，**每个变化像素均对应可见颜色变化**。聚焦建筑投影范围外的颜色变化为 0（包括地面阴影），caster 数量不变，GL error=0。
- 原 volume 浏览器回归通过：单投影、夜灯、分面 alpha、前后人物、资源回收、旧贴片截图一致。单测 16/16 通过。
- 隔离构建 `npm.cmd run build -- --outDir ../output/hd2d-m7-focus/ui-build`：共享工作区 237 modules PASS，保留既有 mixed-import/chunk 提示，没有覆盖后端 public。

本轮配合 main 的并发 checkpoint，仅做定向正确性/截图，没有采集严格 CPU 样本或重跑 180 帧 benchmark。上一份压力结果不应当作此 shader 的新增性能验收；Android、真实素材美术和完整 M7 仍未声明完成。

复现（仓库根目录）：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
node web-ui/test/hd2d-focus-browser.mjs
node --test web-ui/src/town/renderers/renderers.test.js web-ui/src/town/renderers/buildingVolume.test.js web-ui/src/town/renderers/interactionSubjects.test.js
node web-ui/test/hd2d-volume-browser.mjs
```

[密集场景修正前](../output/hd2d-m7-focus/dense-before.png) · [修正后](../output/hd2d-m7-focus/dense-after.png) · [card 聚焦](../output/hd2d-m7-focus/card-focus-a.png) · [volume 聚焦](../output/hd2d-m7-focus/volume-focus-a.png) · [退出恢复](../output/hd2d-m7-focus/volume-restored.png) · [结果 JSON](../output/hd2d-m7-focus/results.json)。

## 后续边界修复：身体 alpha 与相机裁剪

只读审查后，先用定向离线输入复现两处误淡化，再修改 `cardLayers.js`、`interactionOcclusion.js` 及专用测试。未修改 TownView、Canvas、shadow 或 picking 逻辑。

1. **视口外焦点仍触发 volume 淡化。** 原函数将身体点投影后直接发射射线，未检查 NDC。完全在视口外、但与部分可见建筑投影重叠的焦点，以及越过 far clip 的焦点，均能返回遮挡成立。
2. **card 将角色透明留白当作身体。** 原 card 检查建筑 alpha，却不检查角色采样点的 alpha；全透明角色的合成像素输入也返回遮挡成立。这是既有 card 探测边界，不能归因于 coverage shader。

新增共享 generator [`visibleBodySamples`](../web-ui/src/town/renderers/interactionOcclusion.js)，card 和 volume 都通过它获取身体采样点：

- 保留原3×3身体采样位置；每点先按角色贴图及 alphaTest 检查是否为有效像素。
- 将该点变换到世界坐标，再投影到 NDC；x/y/z 必须有限且位于 `[-1,1]` 内，即同时检查四侧视口与 near/far。边界包含在内，`1e-10` 容差仅处理浮点误差。
- **逐点判断而非整个人物裁掉**：部分身体点可见时仍参与遮挡，全部采样点不可见或透明时不触发。
- card 用有效点继续检查建筑贴图轮廓；volume 用同一有效点继续做表面射线与 alphaHit。没有改原建筑拾取或物理阴影语义，也没有把覆盖颗粒加入 picking。

### 本次验证与证据

定向单测 **17/17 PASS**，其中新增 [`interactionOcclusion.test.js`](../web-ui/src/town/renderers/interactionOcclusion.test.js) 覆盖：全透明、全不透明、部分透明、只有透明留白进入视口、只有不透明条带进入视口、四侧部分可见/完全出界、精确视口边界，以及 near/far 平面及其内外。使用真实 Three 相机/mesh和合成像素 readback；不把纯函数测试描述成 GPU 验收。

真实 `hd2d-focus-browser.mjs` 对 card/volume 均增加镜头边缘切换：部分可见 **2个有效点且A淡化** → 完全出界 **0点且全部恢复** → 返回 **3点且A再次淡化**。三阶段 GL error 均0。使用上下边缘是因为该合成人物横向采样仅中列有不透明像素，不能用左右裁剪的点数变化冒充有效验证。

- card：[部分可见](../output/hd2d-m7-focus/card-viewport-partial.png)、[完全出界](../output/hd2d-m7-focus/card-viewport-outside.png)、[返回](../output/hd2d-m7-focus/card-viewport-returned.png)。
- volume：[部分可见](../output/hd2d-m7-focus/volume-viewport-partial.png)、[完全出界](../output/hd2d-m7-focus/volume-viewport-outside.png)、[返回](../output/hd2d-m7-focus/volume-viewport-returned.png)。
- [最新结果 JSON](../output/hd2d-m7-focus/results.json) 的 `isolated[].viewport` 保存2→0→3采样和淡化状态；`pickAndDepth` 再次确认拾取相同、caster数量不变、建筑范围外颜色变化0，card/volume深度变化29,958/37,723像素均对应颜色变化。

上文31栋before与16项单测、237模块build属于第一轮历史验收。当前before renderer仍为历史快照，但引用了已更新的共享card探测函数，因此最新对照为28栋→0栋；它不是原31栋历史像素的冻结重播，不用于新的性能比较。

```powershell
node --test web-ui/src/town/renderers/interactionOcclusion.test.js web-ui/src/town/renderers/interactionSubjects.test.js web-ui/src/town/renderers/renderers.test.js web-ui/src/town/renderers/buildingVolume.test.js
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
node web-ui/test/hd2d-focus-browser.mjs
```

本边界补丁只运行上述定向单测和 focus 浏览器，没有重跑性能/profile、独立 volume-browser 或构建；构建由主线统一执行。此前一次当前shader短稳态结果另见[压力文档](hd2d-m7-stress-fallback.md)，其60人standard的composer耗时增长仍保持根因未定，不由本边界修复解释。
> 后续按产品要求恢复旧口径：任意 NPC 进入建筑遮挡都会触发建筑淡化，不再只限玩家/hover/selected/dialogue/activity 对象。下面的“只考虑交互对象”段落是中间版记录，当前代码以恢复后的全 NPC 行为为准。
> 同时淡化方式恢复为旧版纯 alpha（`diffuseColor.a *= townFade`），不再使用 M7 的 4×4 screen-door 覆盖。
