# M7 全镇压力、回退与局部性能诊断（2026-09-08）

本文按执行阶段追加记录。开头“唯一生产代码调整”“未改旧卡片材质”等描述仅属于首轮体积压力切片；最终已完成后文平面单遍交付及同进程ABBA验证。最终完整raw24组严格一致，PNG自身差异仍保留，CPU组内收益不代表GPU或帧率提升；统一最终单测/构建见[本轮进度](hd2d-progress-20260908.md)。

本轮按 plan 3.6 / 14.2 建立 **50×50、80 对象、20/50 居民**的独立前端 fixture，另测 60 居民桌面对照。对象包含三栋显式 opt-in 体积和 77 个旧 card，素材复用已有合成 SVG。未修改 TownView、后端、真实资产、默认启用状态或画质选项，没有真实生成/数据库调用。

## 本轮改动

- `web-ui/test/fixtures/townStressScene.js`：纯合成地图、旧贴片与居民 fixture，含普通角色、linked NPC、未关联 NPC、缺图居民。
- `web-ui/test/hd2d-stress-fixture.html`：直接调用现有 HD/Canvas renderer，一个 RAF/input/visibility owner；没有加载 Vue 业务页、聊天 store、SSE 或生产 Vite 配置。
- `web-ui/test/hd2d-stress-browser.mjs`：帧样本、CPU 分段/CDP profile、鼠标事件、回退重建、资源与 A/B 像素回归。
- 唯一生产代码调整位于 `buildingVolumeGeometry.js`：屋顶/山墙三角形改为朝外绕序；体积显示面设置 `forceSinglePass:true`。通过 alphaTest 后是实色表面，不需要半透明背面再绘一遍，仍保留透明列表顺序以正确深度遮挡旧卡片。新增屋顶法线单测。

**默认行为报告：**没有改 Canvas、low/balanced 参数、移轴默认值、旧卡片材质或淡化规则。局部优化仅作用于显式 opt-in 的三种体积原型。正常材质不新增混合透明度语义；未来若添加半透明玻璃，应重新决定它是否需要双遍。

## 性能样本

环境为 Windows、headless Edge、ANGLE / NVIDIA GeForce RTX 5070 Ti / D3D11；CSS 1100×720。加载完成后预热 30 帧，每档记录 180 个 rAF 间隔，移动居民并轻微平移镜头；测量期间未并行运行本任务的构建/其他浏览器测试。帧提交 CPU 计时包括 renderer、Canvas 标签与合成调用，不是 GPU 完成时间。

fixture 的档位复用现有配置：

| 模式 | 实际配置 |
| --- | --- |
| canvas（2D 兼容） | 原 Canvas，无移轴；volume 使用既有 imagePath 卡片回退 |
| low（低配 HD） | DPR 1、1024 shadow、关闭移轴 |
| standard（标准 HD） | balanced、DPR 1.5、2048 shadow、关闭移轴 |
| tilt（移轴对照） | 同 balanced，开启现有移轴 |

这不是新增“高档”产品开关；plan 建议的标准 1024、高档 DPR 2 与当前实现并不相同，本轮没有擅自调整默认值。

优化后本机样本（ms；draw calls 为整帧含阴影/后处理的中位数）：

| 居民 | 模式 | 帧间隔 p95 | CPU p50 / p95 | draw calls |
| --- | --- | --- | --- | --- |
| 20 | canvas | 16.8 | 1.4 / 1.9 | 0 |
| 20 | low | 16.8 | 5.4 / 7.3 | 612 |
| 20 | standard | 16.8 | 5.4 / 6.6 | 612 |
| 20 | tilt | 16.8 | 5.5 / 6.8 | 614 |
| 50 | canvas | 16.8 | 2.4 / 3.9 | 0 |
| 50 | low | 16.8 | 6.9 / 8.6 | 732 |
| 50 | standard | 16.8 | 6.8 / 8.7 | 732 |
| 50 | tilt | 16.8 | 6.6 / 7.4 | 734 |
| 60 | standard | 16.8 | 7.1 / 8.2 | 772 |

本次 60 居民 / 80 对象样本达到 plan 桌面 p95≤20ms 门槛；这只是该机器、短稳态窗口、合成内容的证据。所有测量窗口的 longtask（>50ms）记录为 0，GL error=0。没有把加载/恢复瞬间算入稳态，也不据此宣称 Android、长跑或完整 M7 达标。

### 为什么只做这一处优化

基线 50 居民标准档约 855 calls、CPU p50/p95 为 9.7/11.9ms；CDP 采样热点主要是 Three 的 `getParameters` / `getProgram` / 材质提交，居民 updateAgents p95 约 0.3ms。因此未重构移动/适配器或更改全局光影。

单遍 A/B 暴露了屋顶内向法线导致的 normalBias 差异。修正朝外绕序后，在同一固定时间/镜头的混合场景，单双遍截图 **逐字节一致**。固定场景 draw calls **855→733（少 122 次，约 14.3%）**；第一次 A/B CPU 中位数 9.5→6.8ms，最终复测 10.6→7.2ms。CPU 受宿主负载影响，收益以提交量和像素证据为主，不宣称帧率提高同样比例（rAF 仍约 60Hz）。

原体积 fixture、透明纹理拾取、单 shadow caster、前后遮挡及原 legacy screenshot 回归再次通过。

## 回退、输入与资源结果

- 实际鼠标点击验证 Canvas / standard / tilt 的地面编辑映射：door cell 与墙格的 blockOverride 清除/阻挡均落到正确 x/y。修改只在 fixture map 内，不发送保存请求。
- 三模式分别点击普通角色、linked NPC、未关联 NPC 和缺图居民，沿用 agentsOnly 语义，均返回对应 agentKey。它证明 renderer 拾取，不代表重新验收聊天身份管线。
- `WEBGL_lose_context` 实际触发 renderer onFailure，切为 Canvas 并 dispose 原 HD；重新选择 standard 后创建新 renderer、恢复 80 对象和一个 RAF，GL error=0。恢复语义与现有宿主相同，**不是复用丢失的旧 context 自动重连**。
- 注入构造失败验证 WebGL 不可用时仍停留 Canvas；缺图片实际 404 时保留占位，GL error=0；纹理连续换版 2/3/4 后 cache 回到 4 项，没有留下旧版缓存增长。
- 同一 fixture owner 完整 HD→Canvas→新 HD 20 轮：每轮加载后稳定为 479 geometries / 60 textures；dispose 后 geometries/textures/objects/cache 均为 0，双画布回到单画布。最终 owner dispose 后画布为 0、RAF 为 0，帧计数停止；重复 resume 不创建第二个循环。
- 使用新标签页尝试真实隐藏，但此 headless 环境仍报告 visible，真实后台切换标为**未验证**。额外注入 visibilitychange/hidden 的独立 fixture 验证 handler 暂停/恢复；不把该注入结果当作真实浏览器后台行为。
- 这些是直接 renderer 与 fixture owner 的回退/生命周期测试，不等同于真实 TownView 页面切换 20 次，也没有创建 SSE 来验证订阅回收。

GPU 统计是 Three 对象数量，不是实测显存。额外记录几何 buffer、图像尺寸和 render-target attachment 的估算：standard target 上界约 239MiB、low 约 100MiB（含保守的 MSAA/深度计数，忽略驱动压缩/复用，不同于实际分配）。原始统计保留于 results.json，不外推手机预算。

## 复现与产物

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
node web-ui/test/hd2d-stress-browser.mjs
node --test web-ui/src/town/renderers/renderers.test.js web-ui/src/town/renderers/buildingVolume.test.js
node web-ui/test/hd2d-volume-browser.mjs
```

`STRESS_AB_ONLY=1` 只跑 A/B；`STRESS_VERIFY_ONLY=1` 只跑交互/回退/资源；`STRESS_LABEL` 为输出目录加后缀。默认完整输出在 `output/hd2d-m7-stress`；初始基线在 `output/hd2d-m7-stress-baseline`，独立 A/B 在 `output/hd2d-m7-stress-ab`，新增鼠标/visibility handler 补充验收在 `output/hd2d-m7-stress-verify`。每套保留 JSON，完整性能套保留 `.cpuprofile` 与原始帧样本。

本次单测 14/14、stress 完整与 verify、volume 浏览器均 PASS。在 web-ui 运行 `npm.cmd run build -- --outDir ../output/hd2d-m7-stress/ui-build`：共享工作区 232 modules PASS，只有既有 mixed-import / chunk-size 提示。构建没有覆盖后端 public。

审阅入口：

- [50 居民标准 HD](../output/hd2d-m7-stress/50-standard.png)、[移轴](../output/hd2d-m7-stress/50-tilt.png)、[2D](../output/hd2d-m7-stress/50-canvas.png)。
- [context lost 回退](../output/hd2d-m7-stress/contextlost-canvas.png)、[恢复 HD](../output/hd2d-m7-stress/recovered-hd.png)、[缺纹理](../output/hd2d-m7-stress/missing-texture.png)。
- [A/B 双遍](../output/hd2d-m7-stress/single-pass-false.png)、[A/B 单遍](../output/hd2d-m7-stress/single-pass-true.png)、[完整结果](../output/hd2d-m7-stress/results.json)、[补充交互结果](../output/hd2d-m7-stress-verify/results.json)。

待续的视觉门槛仍包括真实素材白边/像素闪烁、真正手机与 Android 及服务 UI 集成。真实页面20轮和加载中卸载另见[真实 TownView 生命周期验收](hd2d-m7-town-view-lifecycle.md)。此压力轮发现的 legacy “任意居民遮挡即可淡化”已由后续[交互对象遮挡补丁](hd2d-m7-interaction-occlusion.md)修正；上文性能表保留为该 shader 修正前的历史证据。

## 最新 focus 覆盖 shader：一次短稳态对照（2026-09-08 07:12 左右）

主代理暂停 CPU/browser 测试后运行**一轮**，结束即归还窗口；没有重跑筛选成绩、做优化、改生产代码或重新生成素材。现有 browser runner 新增 `STRESS_STEADY_ONLY=1`，复用原 measure：每组预热30帧，记录180个 rAF 间隔，仅跑20/50/60居民的 low/standard 六组；跳过历史单双遍 A/B、CDP profile 和整套正确性循环。60 low 是新增的同口径样本，旧报告没有对应数据。

仍为50×50、80对象（三 volume + 77 card）、移动居民和轻微平移镜头；Windows headless Edge / RTX 5070 Ti / ANGLE D3D11，1100×720。配置仍为 low DPR1/1024 shadow、standard DPR1.5/2048 shadow，两档关闭移轴。所有采样 `document.hidden=false`。

| 居民 | 模式 | 当前帧间隔 p95 | 旧 CPU p50 / p95 | 当前 CPU p50 / p95 | 当前 calls |
| --- | --- | --- | --- | --- | --- |
| 20 | low | 16.8 | 5.4 / 7.3 | 5.2 / 7.5 | 612 |
| 20 | standard | 16.7 | 5.4 / 6.6 | 5.1 / 6.9 | 612 |
| 50 | low | 16.8 | 6.9 / 8.6 | 6.0 / 7.9 | 732 |
| 50 | standard | 16.8 | 6.8 / 8.7 | 6.1 / 7.7 | 732 |
| 60 | low | 16.8 | — | 6.6 / 8.3 | 772 |
| 60 | standard | 16.8 | 7.1 / 8.2 | 10.6 / 14.1 | 772 |

单位ms，calls为中位数。六组 longtask 数量均0，GL error均0，calls与旧可比组一致。60 standard 本机帧间隔 p95 16.8ms 仍低于 plan 3.6 的桌面20ms门槛，**但 CPU p95 8.2→14.1ms 的升高必须保留**。该组当前 update p95 0.4ms，render p95 13.7ms，其中 composer p95 13.5ms；composer 是 render 的子区间，不能相加。它说明本窗口的时间主要在提交/合成路径，不足以定位 shader 或 GPU 原因。没有同时段旧 shader A/B，也未采新 profile；跨时段样本和宿主状态不足以建立因果，本轮不追分。

现有 stress fixture 的演员键均为 `resident:*`，没有 `me`，也不传显式 interactionActorKeys。因此最新默认仅 me 的逻辑下，本组没有焦点触发整栋淡化；测到的是新覆盖 shader 已安装、正常不淡化的密集场景，**不是大量焦点覆盖生效的最坏性能**。旧 shader 会被普通居民触发，前后可见像素工作量本就不同，不能把CPU差异当成只改一段shader的控制实验。焦点后方、切换恢复与深度/颜色一致性仍由前述定向正确性证据覆盖。

当前 Three.js geometries 为419/479/499（20/50/60居民）；同一 HD 实例按顺序切换后 textures 为30/31/32，programs为27。这里仅记录单轮不同配置状态，不据此推断泄漏；资源回收看原独立循环及真实 TownView 文档。render target attachment估算仍约 low100MiB / standard239MiB，不是驱动实测显存。

复现这一次样本的命令：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
$env:STRESS_STEADY_ONLY='1'
$env:STRESS_LABEL='focus-steady'
node web-ui/test/hd2d-stress-browser.mjs
```

原始180帧数组和CPU分段：[当前 results](../output/hd2d-m7-stress-focus-steady/results.json)；截图：[20 low](../output/hd2d-m7-stress-focus-steady/20-low.png)、[20 standard](../output/hd2d-m7-stress-focus-steady/20-standard.png)、[50 low](../output/hd2d-m7-stress-focus-steady/50-low.png)、[50 standard](../output/hd2d-m7-stress-focus-steady/50-standard.png)、[60 low](../output/hd2d-m7-stress-focus-steady/60-low.png)、[60 standard](../output/hd2d-m7-stress-focus-steady/60-standard.png)。旧目录和上文历史数据均未覆盖。

本轮只补这一桌面短稳态基线，没有重验14.2全部视觉项，不宣称Android 30居民/33ms、长时稳定、真实资产或最终M7完成。

## 当前60/80独立 profiler-only（2026-09-08 07:50）

新增独立脚本 [hd2d-profiler-only-browser.mjs](../web-ui/test/hd2d-profiler-only-browser.mjs)，复用原合成fixture，只跑一次当前60居民/80对象standard。主线授予独占窗口；脚本约10秒结束后关闭浏览器和Vite并立即通知归还。之后分析与本节写入都是离线工作。没有运行旧correctness suite、六组steady、A/B、构建或第二轮采样，也没有改生产。

环境仍为Windows headless Edge / RTX5070Ti / ANGLE D3D11、1100×720、DPR1.5、2048shadow、关闭移轴。当前源码包括body alpha/clip边界修复；`results.json`记录renderer/helper/fixture SHA256。三volume、77旧card、60居民，旧fixture无me/显式focus主体，因此不执行volume遮挡射线，不代表覆盖生效的最坏场景。

### 两个窗口分别记账

30帧预热后，先记180个rAF间隔及逐帧CPU分段；**随后**启用CDP Profiler，记录120帧和独立分段后停止。profile不是前180帧的调用栈。

| 指标（ms） | 前180，未开Profiler p50 / p95 | 后120，开启Profiler p50 / p95 |
| --- | --- | --- |
| rAF间隔 | 16.7 / 16.8 | 16.7 / 16.8 |
| draw总计 | 10.0 / 12.8 | 6.8 / 12.5 |
| update | 0.2 / 0.4 | 0.2 / 0.3 |
| HD render（包含composer） | 9.6 / 12.4 | 6.5 / 12.1 |
| composer | 9.5 / 12.2 | 6.4 / 11.9 |
| 同帧render−composer | 0.2 / 0.3 | 0.2 / 0.3 |
| 同帧total−update−render | 0.1 / 0.3 | 0.1 / 0.2 |

末两行由**逐帧相减后再求分位数**，不再相减两个独立p95。最后一行包含adapt/Canvas等未单列draw工作，不等同纯Canvas标签。fixture状态文字更新在原total计时结束之后，仍可能进入profile。两窗口中位数本身不同，不能将profile比例套回前180帧的12.8ms，更不能替代先前14.1ms那次的缺失profile。

前180采集时间约1868.2–4872.6ms（页面performance时钟）；后120约5041.6–7017.6ms，两段之间约169ms控制间隙。CDP profile总跨度2109.224ms，包括其启动/停止与collector边界开销，长于120帧collector自身1976ms。所有原始样本保留`rafAt/draw/cpu/calls`，不将两个时间域拼成单一窗口。两段longtask均0，visible，GL error=0；calls中位数分别771/772。

### 只解释后续profile实际热点

按CDP `samples/timeDeltas`加权，以下是后续profile的采样时间，不是精确函数CPU/GPU耗时。inclusive含子调用，不能纵向相加。

| 热点 | self ms | inclusive ms |
| --- | --- | --- |
| Three getParameters | 271.212 | 274.738 |
| Three getProgram | 101.812 | 392.831 |
| Three setProgram | 42.087 | 648.954 |
| WebGLRenderer.renderBufferDirect | 37.563 | 747.352 |
| RenderPass.render | — | 874.696 |
| EffectComposer.render | — | 881.249 |

主调用链为 `Hd2dTownRenderer.render → composer → RenderPass → WebGLRenderer.render → renderScene/renderObjects/renderObject → renderBufferDirect → setProgram → getProgram → getParameters`。因此**本次后续窗口可确认的热点是材质/program选择、参数计算及提交链**，不是体积raycast或Canvas标签。

对每个样本按祖先集合去重后的独立分类：program选择链661.646ms，CanvasTownRenderer 10.087ms，volume/raycast 0，GC5.624ms；另有idle1029.756ms。未采到compileShader/linkProgram/WebGLProgram构造栈，不能将getProgram命中说成“shader在反复编译”，也不能以未采到证明绝对没有短编译或驱动工作。

可定位代码入口：

- `Hd2dTownRenderer.js` 的 `this.composer.render()`，以及 `updateCard` 创建 `transparent:true/DoubleSide` 材质的位置。
- Three `WebGLRenderer.js` 的 `renderObject`：当transparent、DoubleSide且forceSinglePass=false时，分别切BackSide/FrontSide，设置material.needsUpdate并各提交一遍；`setProgram`看到material.version变化后进入`getProgram`；后者调用`WebGLPrograms.getParameters`并查cache key。
- 当前card/人物和部分投影影子保留该双遍配置，volume已显式forceSinglePass=true。**这提供了当前反复program选择的一条具体代码机制，但profile不记录材质实例参数，不能量化每类mesh的贡献，也不构成修改单遍的像素安全证据。**本轮没有据此修改材质。

该结论只解释本次profile内的热点分布。没有同窗口旧shader对照，不能证明历史8.2→14.1ms增长来自此链、coverage shader或clip修复；历史回归根因仍未定。profile不含GPU timer查询，无法从这些JS栈量化驱动等待和GPU片元成本，也不外推Android。

原始证据：[两个窗口逐帧数据与环境/hash](../output/hd2d-m7-profiler-only/results.json)、[完整CPU profile](../output/hd2d-m7-profiler-only/cpu-profile.cpuprofile)、[self/inclusive和去重分类](../output/hd2d-m7-profiler-only/analysis.json)。旧目录和历史报告未覆盖。

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
node web-ui/test/hd2d-profiler-only-browser.mjs
```

该命令应仅在再次明确授予独占窗口时执行；本轮已完成一次，不自动追跑。

## 平面 forceSinglePass 早期正确性评估（历史阶段，后续已有交付）

本节保留修改生产默认之前的诊断过程。“未改生产”“ABBA尚未执行”只描述当时状态，最终交付及性能证据见后两节。此阶段文字所称“整帧原始颜色”和相机深度实际曾误用CSS尺寸，属于framebuffer局部读取，不能作为完整画面的验证证据；完整尺寸修复后另跑的24组才用于生产判据。shadow-map读取尺寸不受该问题影响。

新增独立 [plane-pass fixture](../web-ui/test/hd2d-plane-pass-fixture.html) 和 [browser脚本](../web-ui/test/hd2d-plane-pass-browser.mjs)，只在运行时切换三类明确的平面材料：旧card、人物、`userData.projectedShadow`。没有遍历并修改所有Mesh；volume已有单遍保持，contact shadow、footprint proxy及customDepthMaterial不改。

固定时间1000ms、静止相机/人物，分别比较双遍A与单遍B的整帧RGBA、打包相机深度、完整shadow-map字节、矩阵拾取结果和caster数量，并保存整帧PNG。场景含密集白天/夜间、card白天焦点、volume夜间焦点、翻转贴片和部分透明纹理的白天/夜间。此阶段不读取或解释CPU timing。

第一轮密集白天/夜间、两类焦点及翻转白天均严格0差异；密集场景calls为772→607（card减少73、人物60、投影影子32），**这只是调用数，不是实测性能收益**。

翻转+部分透明纹理夜间出现1个颜色字节差异，立即停止默认值修改。后续定向诊断增加不切开关的A/A与B/B对照，并分开切每个card。完整历史顺序下复现：屏幕 `(690,165)` 蓝通道48↔49；A/A本身也差1字节，B/B为0；深度、shadow-map及拾取始终相同。单独新页只跑该夜间场景没有差异，说明有场景/渲染历史依赖；**不能将它归因于forceSinglePass，也不能未经定位就称作已证实的驱动噪声**。

后续原始RGBA诊断在增加固定绘制后出现30项全零，但呈现截图仍不能通过严格门槛，因此不以选取该次结果判定安全。早期诊断JSON被后续诊断覆盖，不再作为早期失败的原始证据；上述1字节观察是当时执行日志记录。

最新固定准备采用每种模式30个requestAnimationFrame呈现帧，随后整帧原始颜色/相机深度/shadow-map A/B及颜色A/A、B/B对比。密集白天、夜间8项均为0；夜间PNG的A/A和B/B仍各有3个颜色通道差1，A的第二张与B第一张完全一致。位置为 (91,31) G 51↔52、(842,146) R 108↔109、(801,183) G 61↔62。这是解码PNG像素差异，并非仅PNG元数据不同。见[当前运行原始结果（失败）](../output/hd2d-m7-plane-pass/results.json)、[截图逐通道比较](../output/hd2d-m7-plane-pass/screenshot-comparison.json)、[A第一帧](../output/hd2d-m7-plane-pass/dense-22-double-0.png)、[A第二帧](../output/hd2d-m7-plane-pass/dense-22-double-1.png)、[B第一帧](../output/hd2d-m7-plane-pass/dense-22-single-2.png)、[B第二帧](../output/hd2d-m7-plane-pass/dense-22-single-3.png)。当前执行停在夜间截图断言，未将未执行场景记为通过。

因此当前结论是**整帧逐字节门槛尚未全部满足，Hd2dTownRenderer生产材料定义未改，文件可交还主线build**。同模式呈现也存在差异，不能归因于单遍，也未定位到驱动、量化或浏览器合成环节；不增加容差、不改金标、不宣称优化成立。此次只运行正确性，无CPU性能采样。

脚本已预备独立`PLANE_PASS_ABBA=1`分支：同一进程当前60/80移动场景，A双遍→B单遍→B单遍→A双遍，每段30帧预热+180帧原始CPU/rAF/calls。它不运行正确性readback，使用独立fixture的计时边界（没有原stress的Canvas标签层），只能做本轮组内对照，不能与历史总CPU直接拼接。**该分支尚未执行，必须等主线独占窗口；当前也未宣称优化成立。**

## 平面单遍：主线调整 raw 判据后的完整验收（2026-09-08）

主线依据不切模式的PNG A/A、B/B本身变化，将生产判据明确调整为renderer完整framebuffer颜色、相机depth、shadow-map和拾取严格一致；PNG仍原样记录，不阻断后续场景。这是验证口径调整，**不是原PNG门槛通过，也未改金标或增加容差**。现存失败/诊断文件及当时脚本已封存于 [失败档案](../output/hd2d-m7-plane-pass-failures-20260908/)，早期已被覆盖的诊断仍仅有前文日志观察，不声称恢复了不存在的原始文件。

检查中另发现旧fixture按CSS 1100×720读取，实际DPR 1.5 framebuffer为1650×1080，旧结果不足以证明完整画面。本轮修正为drawingBuffer实际尺寸，depth按源depthTexture尺寸打包读取；修正前过渡运行也归档为`partial-dimension-run`，不计入生产判据。修正后完整六scene只执行一轮，每scene两种模式各固定30个呈现帧准备，再逐类切card、人物、投影影子和全部三类，共24组：

- 每组颜色7,128,000字节、打包相机depth 7,128,000字节、完整2048×2048 shadow-map 16,777,216字节，A/B全部0差异；颜色A/A、B/B亦全部0。
- 拾取网格及caster数量全部一致，GL error全部0，页面错误为空。包含密集昼夜、card焦点、volume夜间焦点、翻转及分数alpha纹理昼夜。
- PNG AA/AB/BB变化通道数仍原值保留，依场景顺序分别为：密集白天0/0/8、密集夜间3/3/3、card白天3/3/3、volume夜间0/0/0、翻转白天3/3/3、翻转夜间1/1/1。未将截图差异归因于材质或特定浏览器环节。

[完整raw与PNG结果](../output/hd2d-m7-plane-pass-raw-gate/results.json)；示例截图：[密集白天A](../output/hd2d-m7-plane-pass-raw-gate/dense-12-double-0.png)、[B](../output/hd2d-m7-plane-pass-raw-gate/dense-12-single-2.png)、[夜间翻转A](../output/hd2d-m7-plane-pass-raw-gate/flipped-22-double-0.png)、[B](../output/hd2d-m7-plane-pass-raw-gate/flipped-22-single-2.png)。所有六scene的AA/BB图均在同目录。

通过后只在Hd2dTownRenderer两个材料定义增加`forceSinglePass: true`：updateCard共用的旧card/人物PlaneGeometry材料，以及projectedShadow平面材料。DoubleSide、alpha/depth设置不变；volume原有配置、customDepthMaterial、contact shadow、shadowProxy和fallback路径均保持。没有修改TownView或其他生产文件。

应用后的单次 [focus-browser结果](../output/hd2d-m7-focus/results.json) PASS：非焦点居民不fade；切换焦点及离开恢复；card/volume部分可见→完全出屏→返回均为采样2→0→3；拾取一致，颜色/深度coverage配对29958/37723，配对外变化0，GL error0；Canvas隔离回归通过。此前focus结果也保存在失败档案的`focus-before-single-pass`目录。构建留主线统一运行。

**本轮没有CPU timing采样或性能结论**。runtime ABBA分支保留，待主线给予窗口才执行；不能用调用数减少或本次正确性结果证明帧时间改善，也不外推Android。

## 同进程单轮 ABBA CPU 窗口（2026-09-08，主线明确独占）

主线确认其他agent/browser/test已暂停后，仅执行一次`PLANE_PASS_ABBA=1`。同一浏览器、同一renderer、当前60居民/80对象，A1双遍→B1单遍→B2单遍→A2双遍；每组30帧预热、180帧样本，共720个原始样本。该分支没有profile、截图、颜色/depth/shadow readback；浏览器及Vite退出后立即归还窗口，随后只离线汇总。未追跑、未挑选组。

| 组 | CPU total p50/p95 ms | render p50/p95 ms | composer p50/p95 ms | CPU mean ms | rAF interval p95 ms | calls min–max |
| --- | --- | --- | --- | --- | --- | --- |
| A1 双遍 | 6.7 / 7.8 | 6.5 / 7.6 | 6.4 / 7.4 | 6.766 | 16.8 | 771–772 |
| B1 单遍 | 2.4 / 3.9 | 2.3 / 3.6 | 2.2 / 3.4 | 2.671 | 16.8 | 606–607 |
| B2 单遍 | 2.4 / 3.4 | 2.3 / 3.2 | 2.1 / 3.1 | 2.538 | 16.8 | 606–607 |
| A2 双遍 | 6.8 / 8.4 | 6.6 / 8.2 | 6.4 / 8.1 | 6.984 | 16.7 | 771 |

组间漂移保留：A2−A1的total p50 +0.1ms、p95 +0.6ms、mean +0.218ms；B2−B1的p50 0、p95 −0.5ms、mean −0.132ms。两个B组的CPU均明显低于两个A组，切回A2后开销回升，因此本轮样本支持当前平面单遍减少CPU开销；主要差异落在composer范围，update各组p50均0.1ms。收益方向在本轮四组中稳定，但尾部存在上述漂移，不能把某个最佳组当作固定收益。rAF仍约60Hz，不能声称可见帧率提升。

限制：这是移动人物/轻微相机运动的连续时间场景，四组不是逐帧同相位重放，calls存在约1次变化；CPU total含fixture更新/运行时开关和测量开销，没有原stress的Canvas标签层。未计GPU timer，未采本轮profile，不能据此量化getProgram具体占比，也不能解释历史8.2→14.1ms回归或归因新shader；仅是本次同进程单轮局部优化证据，不外推Android。

[全部A1/B1/B2/A2逐帧原始数据](../output/hd2d-m7-plane-pass-abba/results.json)、[各阶段分位数、均值、极值与组间漂移](../output/hd2d-m7-plane-pass-abba/analysis.json)。分位数使用nearest-rank，文中四舍五入，原始浮点数保留。此处`passed`仅表示计时脚本完成且无页面错误，不是新的像素验收；像素判据证据见上一节。
