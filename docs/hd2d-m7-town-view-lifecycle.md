# M7 真实 TownView 生命周期验收（2026-09-08）

真实组件在同一页完成 **20 轮正常加载后 mount/unmount（Canvas / HD 各 10）**，另测慢 state、慢 map 和图片响应未返回三种加载中卸载。修复后的三种早卸载通过；此前等待继续运行的问题已先保存证据，再由 main 修改生产代码。

本轮新增文件仅为 [fixture](../web-ui/test/town-view-lifecycle-fixture.html) 和 [browser runner](../web-ui/test/town-view-lifecycle-browser.mjs)。实际使用 TownView、Pinia store、Canvas/HD renderer 和统一 SSE 管线；API/图片/SSE 都由独立 loopback fixture 提供，未连接真实后端、数据库或模型。没有修改原 TownView fixture 或代替生产函数执行 cleanup。

## 正常加载后卸载 20 轮

- 每轮真实 `createApp(TownView).mount()` / `app.unmount()`，共享一个 Pinia；没有通过导航或重开页面清空泄漏。
- 每轮 10 个 Town SSE handlers 从 10 回到 0；卸载后再发送真实 SSE ping，不再更新已停止的 Town 连接状态。
- 按住 W 建立实际移动 interval 后卸载：RAF 和移动 timer 回收，400ms 后无组件残留任务，RAF 调用数不继续增长。
- ResizeObserver 的实际 disconnect 被观察到，活跃观察目标归零；window/document 的 CDP 原生监听清单各轮一致，无累积。
- DOM canvas 归零；存活 HD renderer 已 disposed，Three.js geometry/texture 计数归零。原 dispose 调用后的 objects/agents/texture cache 清空记录保留。Canvas create/dispose、Town stream start/stop 在第20轮均为 20/20。
- 宿主拥有的统一 SSE 连接跨轮保持一条。全部23轮结束后宿主 stop 关闭它，start/stop 为23/23，没有 pageerror 或未知 API 请求。

正常运行截图：[Canvas](../output/hd2d-town-view-lifecycle/canvas-mounted.png)、[HD](../output/hd2d-town-view-lifecycle/balanced-mounted.png)。完整的 mounted / immediate / 400ms-unmounted、监听清单和原 dispose 结果见[修复后 results](../output/hd2d-town-view-lifecycle/results.json)。

## 先复现、再修复的早卸载

state/map 响应延迟900ms，确认请求已发生后卸载；分别记录立即、1.5秒与6.7秒状态。before 源码 SHA256 为 `ed3da88574d2d3b450fbdf6bc6a7cc29d8f13c748ca5c37fffada6d1c3f81df7`，本次 after 为 `7ac0f2a7e5de7780cead959ae1a00978085da357d1055c6c48065cd16cc729f3`。

| 场景 | before：卸载后新调度 | after：卸载后新调度 | after：新 Image |
| --- | --- | --- | --- |
| 慢 `/state` | 2 RAF + 1 timeout | 0 | 0 |
| 慢 `/map` | 2 RAF + 97 timeout | 0 | 0 |

before 的调用栈对应 `waitForRenderMap` 递归 timer、`nextFrames` 和 `prepareWorldResources`。这些任务最终自然耗尽，是**有界的卸载后工作**；没有把它描述成已证明的无限泄漏。两个 before 场景都没有新 Image，因此仅凭它们不能证明图片等待安全。

main 随后加入 boot 等待取消并 resolve、各 await 后 disposed guard、getImg guard，以及卸载时 `entry.cancel` 结算。after 的零调度/零图片已作为 runner 默认断言。

- [before 早卸载原始栈与快照](../output/hd2d-town-view-lifecycle/early-unmount.before.json)、[before 全部20轮](../output/hd2d-town-view-lifecycle/results.before.json)。
- [after 早卸载原始结果](../output/hd2d-town-view-lifecycle/early-unmount.json)、[after 全部结果](../output/hd2d-town-view-lifecycle/results.json)。
- 冻结副本及当时源码：[baseline 源码](../output/hd2d-town-view-lifecycle/baseline/TownView.vue.txt)、[hash](../output/hd2d-town-view-lifecycle/baseline/source-hash.json)。常规复跑不会覆盖 before 或 baseline。

第23轮额外使用 Canvas，服务器保持图片 HTTP 响应不返回，确认原 preload Promise 正在等待后卸载。**在服务器释放响应之前**，两个原 image ready Promise 均结算 false，原 preload 和 prepare Promise 已结束，Image 的 onload/onerror 清空。之后释放响应，再观察400ms，仍无新调度。fixture 只向原 Promise 添加 then 观察，没有 resolve/cancel 它们。见[未返回图片证据](../output/hd2d-town-view-lifecycle/slow-image.json)。

## 复现与边界

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
node web-ui/test/town-view-lifecycle-browser.mjs
```

`LIFECYCLE_OBSERVE_EARLY=1` 仅供旧版本诊断时跳过 state/map 零新调度断言；当前版本默认严格检查。每次输出到 `output/hd2d-town-view-lifecycle`，before 与 baseline 单独保留。

测量包装始终调用原生 API/原生产函数。Vite transform 只暴露订阅计数、观察原 Promise 和 Canvas dispose；HD 原型包装只记录实际 mount/dispose。Vue devtools 一次性初始化 timer 单独标注并自然到期；本次最后尚有一个 **epoch 0 的 Vite 宿主心跳**，它不属于组件，未由 fixture 清除。

这是桌面 headless Edge 的隔离结果，不宣称真实 hidden 切换、Android、所有路由/服务面板路径或完整 JS 堆可达性通过。CDP 监听清单覆盖 window/document，不覆盖所有脱离 DOM 节点的引用；Three.js 计数和 WeakRef 观察不等同实际驱动显存测量。本轮没有严格性能采样；短稳态帧样本见[压力文档](hd2d-m7-stress-fallback.md)。
