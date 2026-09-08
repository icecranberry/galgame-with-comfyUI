# M1 画面渲染实施记录

> 当前视觉版本为用户提供《八方旅人》参考图后的第二轮重做，详见 [视觉返工记录](hd2d-look-v2.md)。下方首轮截图和计数保留为基线，不再作为视觉达到目标的证明。

2026-09-07：M1 渲染代码已接入小镇，桌面隔离场景和页面交互验收通过。未启动业务后端、写入存档或调用 LLM/生图。Android 真机及真实存档手动验收待进行；不将此记录等同于 M0 或后续经济、对话、美术里程碑完成。

## 使用

世界渲染固定为 **HD2D**，不再提供画质下拉、低配档或 Canvas 兼容画面，也不再自动降级。标准 HD2D 默认弱移轴，可通过统一开关关闭；移轴偏好仅存在本机 localStorage。WebGL2 创建失败、运行异常或 context lost 会停止 HD2D 并显示「重试 HD2D」，不会切到 Canvas。

HD2D 固定使用标准档：DPR 上限 1.5、单盏方向投影灯、2048² 阴影。低配档与 Canvas 兼容档已移除，不再提供切换入口。地砖按 16×16 块、素材和图层使用 InstancedMesh，编辑只重建改变的块。Three.js 锁定 **0.185.1**，按需加载独立 chunk。

## 实现边界

- `web-ui/src/town/renderers/CanvasTownRenderer.js`：迁出原地面烘焙、建筑、小人、名字和气泡绘制；天气粒子、编辑标记及页面输入仍由 TownView 管理。
- `projection.js`、`TownSceneAdapter.js`：共享格心、建筑底边、门前格、显式清障优先级及素材 URL/版本。兼容地图的 `imagePath` 与素材库的 `image_path`。去掉原角色脚底额外 `+16px`，使两种渲染器都落在同一格心。
- `Hd2dTownRenderer.js`：固定 45° 朝向、俯角 30° 正交相机；水平地面、建筑与人物直立网格。可见材质和阴影深度材质共用 alpha 贴图、cutoff 与 UV。射线拾取先检查透明轮廓，再求地面交点；移动还检查地图边界与阻挡，实际寻路仍由服务端决定。
- `TiltShiftPass.js`：两遍半分辨率模糊，叠回完整分辨率场景；清晰区域覆盖玩家和当前交互居民。第二轮使用世界渲染的原始深度贴图决定前后景失焦，最终统一 HDR 色彩转换；名字/气泡/菜单不进入模糊通道。仍是深度辅助的景深近似，不是物理镜头模拟。
- `groundTexture.js`：旧菱形贴图映射到水平正方形，保留裁剪高度和 `groundAnchorY`。运行时派生版本 1 对边缘透明像素扩色，对旧草地白色轮廓取内侧颜色；不改原 PNG。支持 `contentDiamondUv` 校准和 `topdown_square`（Canvas 也转换为菱形）。
- 页面保留原编辑、聊天和 WASD 路径；修复拖拽松手后的误走路、建筑放置预览横向偏移，以及画质选择器键盘事件穿透。切页释放 RAF、监听器、贴图、几何体、深度材质、阴影图与后处理缓冲。

元数据可选项由 adapter 兜底/约束：`projection`、`anchor`、`worldHeight`、`alphaCutoff`、`shadowMode`（当前 `volume` / `alpha_card` / `none`，有 footprint 的建筑默认 volume）、`textureFilter`。对象实例可在 `render` 下覆盖显示参数。草地有意保留白色边饰时用 `removeWhiteEdge: false`；完全禁用运行时地砖派生用 `groundDerivative: 'none'`。这些是可选读取约定，本轮不迁移旧素材数据，也不新增素材生成协议。

## 验证结果

| 验证 | 实际结果 |
| --- | --- |
| 渲染单测 | 5/5：50×50 格心在 0.5/1/2.5 缩放下经过真实 Three 相机往返；底边/门口/清障；UV 与白边派生；地图外射线；透明像素命中 |
| 原有小镇测试 | 素材后处理、A*、地点匹配 20/20 |
| 前端隔离构建 | 成功，205 modules；HD2D chunk 约 539 kB（gzip 137 kB），仍有 bundle 大小和原有混合导入警告 |
| 真实素材 WebGL 场景 | 4 张本机素材加载成功；人物轮廓拾取正确；GL error=0；白天、夜晚、雨天黄昏截图已检查 |
| 50×50 低配基线 | 40 栋建筑、26 个居民、16 个地面批次；1100×650、DPR=1，60 帧 p50≈16.7ms / p95≈16.8ms |
| 释放 | standalone dispose 后 Three 统计几何体=0、纹理=0 |
| 页面操作 | 20 次 HD2D↔Canvas 切换无额外订阅；点击空地提交正确格坐标；素材库选建筑、放置、保存载荷含新增对象 |
| 页面生命周期 | 20 次卸载/重挂，start=21、stop=20，最后卸载 stop=21；挂载时只保留世界/文字两张画布 |
| 兼容回退 | 真实 WEBGL_lose_context 事件、模拟无 WebGL2 均回退到单张 Canvas；页面无未处理错误 |
| 窄屏 | 390×844 浏览器视口通过布局与回退检查；不代表 Android 真机性能 |

帧间隔是本机 headless Chrome 的观察值，不是纯 GPU 耗时，也不是安卓性能承诺。页面测试使用真实 TownView 及渲染模块，但业务请求/订阅由 fixture 隔离；编辑“保存”验证请求载荷，没有写真实数据库或验证服务端 POI 持久化。

截图和机器报告：[`output/hd2d-m1/`](../output/hd2d-m1/) 中的 `town-page.png`、`canvas-page.png`、`editor.png`、`mobile.png`、`day.png`、`night.png`、`rain-dusk.png`、`large-map-low.png`、`verification.json`。

## 复现

```powershell
# web-ui 工作目录
node --test src/town/renderers/renderers.test.js
npm.cmd run build -- --outDir ../output/hd2d-m1/ui-build

# 使用已安装的 Playwright；若不在项目依赖中，给出其 index.mjs 绝对路径
$env:PLAYWRIGHT_MODULE = '你的已安装路径/playwright/index.mjs'
$env:BROWSER_CHANNEL = 'chrome'
node test/hd2d-browser.mjs

# 可选：使用本机现有镇素材；本轮截图使用此模式
$env:TOWN_REAL_ASSETS = '1'
node test/hd2d-browser.mjs

# agent-core 工作目录
node --test test/townAssetPostProcess.test.js src/services/town/townPathfinding.test.js src/services/town/townLocationMatch.test.js
```

浏览器脚本默认使用确定性 SVG fixture，不依赖未入库的素材或数据库；`TOWN_REAL_ASSETS=1` 模式读取 fixture 列出的本机 PNG。测试自启/关闭 127.0.0.1:5189 的 Vite 服务，不启动后端。不要从仓库根目录调用 build 做此验证：根 build 是整包构建，只有 web-ui 的上述命令会把输出隔离到指定目录。

## 后续验收

1. Android 真机：方向阴影、DPR、发热、触控和软键盘；根据测量决定是否默认低配。
2. 在实际小镇手工检查真实地块、复杂遮挡、特殊门口、向导草稿与素材重生成。本轮没有执行真实库的地图保存/POI 生命周期测试。
3. 旧草地仍有重复图案及少量画入纹理的边缘；白边派生不是无缝美术重制。建筑仍是兼容立片，屋顶和墙面是旧图自带透视；三个体积建筑、独立窗灯与进一步光影校准属于 M7。
