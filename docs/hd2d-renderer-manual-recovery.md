# TownView 手动恢复 HD2D

世界渲染固定为 HD2D，不再保留 Canvas 兼容回退，也不再显示画质/渲染切换下拉。contextlost 或初始化失败时 HD2D 停止并显示 ghost/sm「重试 HD2D」，点击后直接重新创建 HD2D renderer。

rendererPending 在加载期间禁用并阻止连续点击。独立请求序号负责 finally 状态清理，避免 fallback 自增 rendererEpoch 后 pending 永远不清；原 rendererEpoch/disposed 防护仍保留，异步 import 晚回不挂载已卸载实例。notice 仅增加 flex/wrap/gap 局部布局。

## 定向证据

在 web-ui 执行 `node test/town-renderer-recovery-browser.mjs`（PLAYWRIGHT_MODULE 指向本地 playwright-core）：真实 TownView、Pinia、Canvas/HD2D renderer，全部业务HTTP由独立fixture拦截。

balanced、low **两种模式通过**：

- 使用真实 WebGL 的 WEBGL_lose_context 扩展触发兼容回退，保留原偏好。
- 点击原模式重试（连续双击），只创建1个新renderer，恢复HD；直接断言renderer.quality与原模式一致。
- 恢复期间HTTP请求数不增加：0业务POST、0新SSE。
- 再次丢context，点击后立即卸载，异步续执行不挂载新renderer，DOM无残留canvas。

截图位于 `output/hd2d-renderer-recovery/`，含 balanced/low 的 fallback/restored。已实际view_image检查balanced fallback与low restored，notice按钮无重叠，恢复后提示消失。此证据为headless Edge空地图隔离fixture，不代表真实设备GPU稳定性或整页性能验收。没有运行构建；温度格式修复与本项由主线合并构建。
