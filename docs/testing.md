# 测试维护说明

## 运行入口

- 后端：`npm --prefix agent-core test`，收集 `agent-core/test/*.test.js` 和 `agent-core/src/services/*.test.js`。
- 前端：`npm --prefix web-ui test`，收集 `web-ui/test/*.test.js`。
- 单文件：在对应子项目目录执行 `node --test test/文件名.test.js`。

后端检查应使用内存数据库。PowerShell 中可先执行 `$env:DB_PATH = ':memory:'` 再运行后端测试；测试中的外部服务优先使用本地模拟。

## 保留范围

| 范围 | 代表性入口 | 保留原因 |
| --- | --- | --- |
| 角色人格、外观与生图 | `agent-core/test/characterPersona.test.js`、`globalLoraScene.test.js`、`llmImageInput.test.js`、`hiresTransparentBackground.test.js` | 人格组装兼容性、身份和外观段编辑、图像输入及透明背景回归 |
| 聊天、记忆与数据迁移 | `agent-core/test/consolidation.test.js`、`memoryV3Migration.test.js`、`contextBudget.test.js`、`sseDisconnectAbort.test.js` | 记忆检索与归并、存量数据升级、上下文预算、流式请求断开 |
| 朋友圈与日程 | `agent-core/test/momentUserPostFlow.test.js`、`momentScheduler.test.js`、`scheduleEditor.test.js` | 发帖、配图、调度和日程编辑的真实执行路径 |
| 小镇核心流程 | `agent-core/test/townTravel.test.js`、`townMapReset.test.js`、`townInteractionRuntime.test.js`、`townNpcServiceRuntime.test.js`、`townNpcStock.test.js` | 地图隔离、重置范围、邀请与奇遇、交易及状态恢复 |
| 前端状态与交互 | `web-ui/test/townInteractions.test.js`、`townTravel.test.js`、`townServiceManagerScope.test.js`、`groupLastSeen.test.js`、`githubUpdate.test.js` | 重复提交、迟到响应、地图切换、筛选排序、未读和升级状态 |
| 图像处理与渲染 | `web-ui/test/whiteGapDetection.test.js`、`townImageEditor.test.js`、`townTileUv.test.js`、`townRendererChunkStability.test.js` | 留白误删、编辑回退、UV 稳定性和构建分包依赖 |

表中是代表性入口，其余覆盖不同边界条件的正式测试继续保留。前后端同名测试可能验证不同实现，不能仅凭文件名去重。

## 浏览器回归样例

以下是持续维护的浏览器样例，依赖 Canvas / WebGL 或真实 Vue 组件，不由 `node --test` 收集。启动 `npm --prefix web-ui run dev` 后，在其开发服务器地址打开：

- `/test/fixtures/townSpriteColor.html`：角色肤色、昼夜、画质档位与色彩输出，页面显示 PASS / FAIL。
- `/test/fixtures/townObjectColor.html`：建筑、道具、灯具的材质与色彩输出，页面显示 PASS / FAIL。
- `/test/fixtures/whiteGaps.html`：图像编辑器的留白预览、恢复与保存失败交互，使用合成图片和模拟保存接口。

浏览器样例及其 HTML / SVG 配套资源共同保留；算法单测不能替代 GPU 和画布交互检查。修改相关渲染或编辑功能后应额外运行这些样例。

## 清理记录与后续准则

2026-09-22 清理了 9 个没有调用方的后端 fixture / worker / 旧验收脚本，以及引用已删除组件的旧挣钱玩法预览页。交易命令用例并入 `townInteractions.test.js`；原先分散在两处的人格测试统一放入 `agent-core/test/characterPersona.test.js`，保留原有行为覆盖。

同时移除仅逐句检查静态提示词常量的断言，保留动态提示词组装、解析及发帖流程测试；补齐服务管理筛选测试所需的地图状态，并验证同镇排序不会改写原名单。

- 保留真实行为、失败路径、数据安全和曾发生过的 bug 回归；不按文件长短或测试数量决定去留。
- 同一功能的小用例优先合并到已有测试中；不要复制生产逻辑再验证复制品。
- 删除功能或测试时同步检查其 fixture、worker、预览资源和文档入口是否仍有调用方。
- 临时验证脚本和日志用完即删；需反复使用的回归逻辑按 `AGENTS.md` 约定纳入正式测试。
