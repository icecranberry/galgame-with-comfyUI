# M7 三栋模块化体积原型（2026-09-08）

本次完成 plan-HD2D 3.4 的显式 opt-in 前端原型：咖啡馆、工坊、公告站。没有修改 TownView、后端、地图阻挡数据或现存资产，没有调用生图。旧资产默认继续使用 legacy card；这里只验收几何、渲染与资源契约，不标记最终素材、Android、全镇压力/长跑或完整 M7 已完成。

## 资产契约

只有 `asset.kind === 'building'` 且 **asset.meta** 同时满足下例三个 opt-in 字段才启用；资产名称、key、NPC 身份、instance.render 均不能自动触发替换。版本或 profile 不支持、footprint/door 不合法时保留旧贴片。

```json
{
  "id": 1,
  "kind": "building",
  "imagePath": "/existing-legacy-building.png",
  "meta": {
    "projection": "modular_volume",
    "modularVolumeVersion": 1,
    "buildingProfile": "cafe",
    "footprint": { "w": 3, "h": 3 },
    "doorOffset": { "dx": 1, "dy": 2 },
    "textureFilter": "nearest",
    "alphaCutoff": 0.3
  }
}
```

白名单为 `cafe` / `workshop` / `notice_station`。v1 footprint 宽深均支持 2–12 的整数，实例 x/y 为整数；doorOffset 必须在 footprint 周边，缺省沿用 `{dx:w-1,dy:h-1}`。内部入口和任意旋转暂不支持。保留 imagePath 可直接回退旧画面。`worldHeight`、图像 anchor、flip 不改变体积几何与逻辑入口。

可选 `meta.buildingTextures` 支持 `wall`、`roof`、`sign`、`door` URL；缺省或载入失败使用暖墙、陶瓦/灰绿屋顶与木色饰条。不会将整张旧建筑图片当墙面纹理。`meta.updatedAt` 会附加分面 URL 版本参数（data URL 除外），也可直接提供带版本的 URL。当前使用重复单元 UV，不是最终展开图集；门牌几何符号用于区分无纹理原型。

## 几何与渲染边界

- `buildingVolumeProfile.js` 是无副作用的白名单/尺寸/入口适配；`TownSceneAdapter.js` 只在通过验证后添加 volume DTO。未启用的 DTO 结构及既有渲染默认值保持不变。
- `buildingVolumeGeometry.js` 创建墙体、屋顶棱柱、墙脚、窗框、门牌和浅门槛。原点为 `(obj.x, obj.y-h+1)`；实墙占据 footprint 内除 door cell 外的格子，与 `buildBlockedCells` 的基础规则一致。门口退进该格，浅门槛位于格内；屋檐仅向外悬挑 0.12 格。不会新增或修改导航阻挡；地图显式 blockOverride 仍由原导航逻辑处理，不用于重塑本原型。
- 墙、屋顶使用真实 Lambert 法线，复用 `sceneLook` 的天气/日夜与现有后处理。窗灯在相同 night 判定下切换 emissive，无新增点光源；不更改全局色盘或 legacy 卡片的绘制光影。
- 每栋仅一个合并几何 shadow caster，显示分面不再投影，也不叠加 legacy card/proxy/contact shadow。caster 取实墙、墙脚与屋顶几何；可选表面纹理的透明孔不改变建筑实体阴影。
- 拾取递归访问分面并沿用 alphaCutoff 采样，跳过不可见 caster。旧卡片之间仍按 painter 顺序，体积与可见卡片按实际深度比较；`groundOnly` 原地面平面和 `agentsOnly` 原过滤语义不变。
- 混合场景下，卡片用 ALWAYS 深度测试保留原覆盖顺序并写入深度，再供体积面正确遮挡。修复并测试了“门前人物可点击但被墙错误盖住”的混合绘制问题。后续[交互对象遮挡补丁](hd2d-m7-interaction-occlusion.md)进一步让纯 card 也写入相机深度，并同步淡化的可见/深度覆盖。
- group 自有 geometry/material 递归 dispose；纹理由 renderer cache 拥有，遍历子面防止误回收，移除后按原缓存周期释放。切版本/模式和重复 dispose 均有回归。

## 离线验收与审阅

`web-ui/test/hd2d-volume-browser.mjs` 独立启动无生产配置、无代理的 Vite fixture，仅加载本地模块与合成 SVG；拒绝外网请求，不启动 Vue 业务页、API、DB 或模型进程。Windows 桌面 headless Edge，1000×720，DPR 1。

- `node --test web-ui/src/town/renderers/renderers.test.js web-ui/src/town/renderers/buildingVolume.test.js`：14/14 通过，含三 profile × 四向入口、opt-in/fallback、位置/阴影/灯光和原投影回归。
- `node web-ui/test/hd2d-volume-browser.mjs`：三 profile 各自日/夜截图、GL error=0、单 caster、门口 ground pick、透明分面 alpha、前后人物遮挡/像素验证、12 轮重建、纹理保留/过期、版本回退/恢复均通过。
- 每轮移除体积后 GPU 统计稳定回到 4 geometries / 6 textures（地面与后处理基线）；单栋完整场景为 45–46 geometries。咖啡馆切出时 42 份 geometry 和 material 均收到 dispose，未增长。
- 旧贴片截图与 HEAD `8ce1e66` 渲染器源在同一 fixture 下逐字节一致；不代表所有真实资产均做过像素验收。
- 独立构建命令：在 web-ui 执行 `npm.cmd run build -- --outDir ../output/hd2d-m7-volume/ui-build`。共享工作区最新 229 modules 通过；保留既有混合 import 与大 chunk 提示。

浏览器命令可用环境变量 `PLAYWRIGHT_MODULE=C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs`；默认 Edge，可用 `BROWSER_CHANNEL` 覆盖。结果写入 `output/hd2d-m7-volume/results.json`。

截图索引：

| 原型 | 日间 | 夜间 |
| --- | --- | --- |
| 咖啡馆 | [日间](../output/hd2d-m7-volume/cafe-day.png) | [窗灯](../output/hd2d-m7-volume/cafe-night.png) |
| 工坊 | [日间](../output/hd2d-m7-volume/workshop-day.png) | [窗灯](../output/hd2d-m7-volume/workshop-night.png) |
| 公告站 | [日间](../output/hd2d-m7-volume/notice_station-day.png) | [窗灯](../output/hd2d-m7-volume/notice_station-night.png) |

[可选分面纹理](../output/hd2d-m7-volume/cafe-textured.png)、[门前/建筑后人物遮挡](../output/hd2d-m7-volume/cafe-occlusion.png)、[旧贴片基线](../output/hd2d-m7-volume/legacy-baseline.png)、[旧贴片当前](../output/hd2d-m7-volume/legacy-current.png)。

main 可审阅后另行选择资产 opt-in；本补丁没有替换任何真实资产。仍待美术校准的范围包括像素风细节、纹理展开、三栋更鲜明的外形组合、真实街景与手机性能。当前逐格盒体是可测原型，未做合批优化或 Android 完成声明。
