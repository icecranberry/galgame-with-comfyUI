# 测试维护说明

## 运行入口

- 后端：`npm --prefix agent-core test`，收集 `agent-core/test/*.test.js` 和 `agent-core/src/services/*.test.js`。
- 前端：`npm --prefix web-ui test`，收集 `web-ui/test/*.test.js`。
- 单文件：在对应子项目目录执行 `node --test test/文件名.test.js`。
- 两个包的 `npm test` 都会先跑 `pretest`（`scripts/test-hygiene.mjs --quiet`），检查测试文件是否已入库，详见下方「绿基线与日常纪律」。

后端检查应使用内存数据库。PowerShell 中可先执行 `$env:DB_PATH = ':memory:'` 再运行后端测试；测试中的外部服务优先使用本地模拟。

## 保留范围

| 范围 | 代表性入口 | 保留原因 |
| --- | --- | --- |
| 角色人格、外观与反应 | `agent-core/test/characterPersona.test.js`、`characterReactionPackService.test.js`、`emojiOutfits.test.js`、`hiresTransparentBackground.test.js`、`web-ui/test/appearanceRefine.test.js` | 人格组装兼容性、反应台词包严格解析、外观互斥与外观段边界回归 |
| 聊天与记忆 | `agent-core/test/consolidation.test.js`、`src/services/memoryV3.test.js`、`contextBudget.test.js`、`sseDisconnectAbort.test.js` | 记忆归并与检索、上下文预算、流式请求断开 |
| 朋友圈与日程 | `agent-core/test/momentUserPostFlow.test.js`、`momentScheduler.test.js`、`scheduleEditor.test.js` | 发帖、配图、调度和日程编辑的真实执行路径 |
| 小镇核心流程 | `agent-core/test/townTravel.test.js`、`townMapReset.test.js`、`townInteractionRuntime.test.js`、`townNpcServiceRuntime.test.js`、`townNpcStock.test.js` | 地图隔离、重置范围、邀请与奇遇、交易及状态恢复 |
| 前端状态与交互 | `web-ui/test/godSays.test.js`、`angelSharedDetail.test.js`、`speechQueue.test.js`、`githubUpdate.test.js` | 会话流状态机、保存契约、播放队列与升级状态 |
| 图像处理 | `agent-core/test/imageTranscode.test.js`、`imageCacheRevalidation.test.js`、`hiresWorkflow.test.js`、`web-ui/test/whiteGapDetection.test.js` | 转码、缓存再验证、放大工作流与留白检测 |

表中是代表性入口，其余保留的正式测试覆盖提示词分层、世界书注入、LLM 输出解析等静默失败风险高的复杂逻辑（见下方 2026-11-06 精简记录）。前后端同名测试可能验证不同实现，不能仅凭文件名去重。

## 浏览器回归样例

以下是持续维护的浏览器样例，依赖 Canvas / WebGL 或真实 Vue 组件，不由 `node --test` 收集。启动 `npm --prefix web-ui run dev` 后，在其开发服务器地址打开：

- `/test/fixtures/townSpriteColor.html`：角色肤色、昼夜、画质档位与色彩输出，页面显示 PASS / FAIL。
- `/test/fixtures/townObjectColor.html`：建筑、道具、灯具的材质与色彩输出，页面显示 PASS / FAIL。
- `/test/fixtures/whiteGaps.html`：图像编辑器的留白预览、恢复与保存失败交互，使用合成图片和模拟保存接口。
- `/test/fixtures/standingInteraction.html`：真实立绘展示组件、合成 SVG 和内存接口。可检查默认全身 11 类空手触摸、缓存台词、主题、睡眠、聊天抢占、延迟配置、换角色与图片更新；顶部计数可核查手势不产生请求和写入，未列入的 API 一律拦截。样例不读写真实角色数据。

立绘样例的「运行手势回归」通过合成 PointerEvent 验证生产组件的 11 类部位命中、对应缓存台词、取消/第二触点/失焦/resize。仅在测试 SVG 上模拟浏览器不允许合成指针申请的 Pointer Capture 三个方法，不替换生产命中、规则或状态代码。真实鼠标点击须另行实测；合成输入的通过不能声称已完成真实手机多点触摸验收。

`/test/fixtures/standingInteractionFrame.html` 将同一回归舞台放进带位移、缩放和旋转的 iframe，用于复核小窗嵌入坐标。它并不模拟 Document PiP 的系统置顶能力。

浏览器样例及其 HTML / SVG 配套资源共同保留；算法单测不能替代 GPU 和画布交互检查。修改相关渲染或编辑功能后应额外运行这些样例。

## 清理记录与后续准则

2026-09-22 清理了 9 个没有调用方的后端 fixture / worker / 旧验收脚本，以及引用已删除组件的旧挣钱玩法预览页。交易命令用例并入 `townInteractions.test.js`；原先分散在两处的人格测试统一放入 `agent-core/test/characterPersona.test.js`，保留原有行为覆盖。

同时移除仅逐句检查静态提示词常量的断言，保留动态提示词组装、解析及发帖流程测试；补齐服务管理筛选测试所需的地图状态，并验证同镇排序不会改写原名单。

- 保留真实行为、失败路径、数据安全和曾发生过的 bug 回归；不按文件长短或测试数量决定去留。
- 同一功能的小用例优先合并到已有测试中；不要复制生产逻辑再验证复制品。
- 删除功能或测试时同步检查其 fixture、worker、预览资源和文档入口是否仍有调用方。
- 临时验证脚本和日志用完即删；需反复使用的回归逻辑按 `AGENTS.md` 约定纳入正式测试。

## 2026-11-06 测试精简

按「只留极度核心」原则对全量测试做了一轮大幅精简：362 个测试文件删至 165 个，用例数 1437 → 1299（agent-core 1140、web-ui 159），测试代码 4.56 万行 → 2.87 万行。精简后两包 `npm test` 均为绿：agent-core 1139 通过 + 1 个自跳过，web-ui 159 全通过。

- **保留判据**（满足其一）：复杂且会静默出错的逻辑（提示词分层与组装、LLM/JSON 输出解析、状态机、调度器、资金与幂等结算）；AGENTS.md 明确要求维护的 `characterPersona.test.js`；当前活跃开发（神说/godSays）的核心引擎；历史真实 bug 的回归（小镇多图 scope、action-runner 写入管线、发送锁并发）；近期返工（TTS GPU 调度、反应通知、日记、宿舍、日程约定）的非平凡逻辑。
- **删除判据**（满足其一）：微小工具/纯函数单测；UI 呈现细节（几何、滚动、CSS、动画、徽标）；与更强兄弟测试 ≥70% 重叠的包装测试；早已落地冻结的一次性迁移/回填；依赖真实 GPU/API/浏览器但自跳过、默认永不执行的 integration/browser 文件；稳定功能的微小边界。
- 同族重复测试的幸存者：godSays 18→15（HTTP 会话/替换提示词/天使引用微测移除）、speech 31→8（GPU 策略与队列、API 模式、进程生命周期保留）、lorebook 9→6、standing 30→6、chat/group 29→12、town 家族 97→53（全部 D2 呈现类与流程 smoke 移除）。
- 已删测试都可从 git 历史恢复；`*.live` / `*.integration` / `*.browser` 的自跳过文件随本轮一并移除，需要真实环境验收时从历史取回。`test/fixtures/` 手动浏览器样例不受影响。

## 绿基线与日常纪律

两包 `npm test` 必须保持全绿。长期红着的套件等于没有套件——它会训练所有人无视红色，真正的回归就藏不住了。宁可删掉一个测试，也不要把红的留在仓库里。

`npm test` 前会自动执行 `scripts/test-hygiene.mjs --quiet`（两个包都配了 `pretest`）：

1. **测试文件必须被 git 跟踪**。历史上 `.gitignore` 用 `agent-core/test/*` 整目录忽略 + 长白名单，导致 6 个新测试从未入库、删除后无法从 git 恢复。现已改为只忽略 `agent-core/test/.tmp-*` 与 `*.log`；新建测试忘记 `git add` 会直接让 `npm test` 失败并提示命令。
2. **微测试告警**：单文件 ≤1 个用例且 <45 行时提示并入同族测试文件（只是告警，`--strict` 才当失败）。新测试默认写进该功能既有的测试文件，只有「独立复杂契约」才单开文件。
3. 临时跳过：`TEST_HYGIENE=off npm test`（不推荐，仅应急）。

失败时按下面的顺序判定，不要一上来就改断言：

1. **单跑该文件**：`node --test test/xxx.test.js`。单独通过、全量才挂 → 并发/环境/资源问题，不是产品回归。
2. **看错误类型**：`Unable to deserialize cloned data due to invalid or unsupported version` 是 test runner 子进程 IPC 被超大输出撑爆，不是断言失败。定位方式：该测试是否把整段提示词 / 大对象打到 stdout；修法是在文件顶部静音 `console.log/info/debug`（见 `mediaImagePriority.test.js`、`mediaAutoStartup.test.js`）。
3. **断言漂移**：先分清「产品行为改了」还是「夹具契约过期」。判据是实现真正对外承诺的契约，例如 `streamPrivateChatImages` 在续写轮刻意保留 `tools` 只为 provider 签名稳定、仅把 `toolChoice` 置为 `none`，所以夹具不能再用 `options.tools?.length` 判断续写轮，而应看消息尾部是否追加了 `tool` 结果。照着现状改断言前，先确认这是有意的设计而不是 bug。
4. **修不动的**：若测试守护的是已废弃契约，删掉它并在本文档记录原因；不要用 `skip` 掩盖——自跳过的测试和删掉的测试等价，但前者会伪装成覆盖。

## 小镇特殊建筑功能（2026-10-03 新增）

「描述驱动的可执行玩法」（见 `town-special-buildings-plan.md` §14）按职责维护三组测试，全部走真实生产入口、隔离内存库、注入式 LLM/生图：

- `agent-core/test/townBuildingFeature{Contract,Source,Runtime,Effects,Trade,Media,Draw}.test.js`：14 模板 schema 与排除能力门控、来源优先级与绘图提示词检测、操作幂等/报价收据/配额/资金预留、外观与状态真实注入及到期恢复、交易真实钱物与回收估值封顶、生成模板一次调用与重试复用、固定种子抽取与跨日签运。共享夹具在 `test/helpers/townBuildingFeatureFixture.js`（`saveMap` 必须 `create: true`，否则按名 upsert 会覆盖第一张图）。
- `web-ui/test/townBuildingFeatureOperations.test.js`：以 SFC 脚本提取 handler 的方式验证报价→执行顺序、失败文案映射与模板事件邀请流（原 `townBuildingFeatures.test.js` 面板切片用例已随 2026-11-06 精简移除）。夹具 state 必须提供 handler 引用的全部模块级名字，否则 `with(state)` 抛 ReferenceError 被组件 catch 吞掉，表现为「夹具没生效」而不是报错。
- 功能有独立总开关 `config.features.townBuildingFeatures`（`FEATURE_TOWN_BUILDING_FEATURES`，默认开）；关闭后隐藏入口并拒绝新生成与新操作，已有预留仍按既有状态机结算或释放。旧镇建筑不自动建档，由管理面板「特殊建筑功能」逐栋启用。

触摸样例还验证按下形变、松手回弹、最终恢复原形，以及图片节点不被重建。「完整触摸动效预览」只在测试页覆盖媒体偏好输入，以检查完整动画分支，不修改用户系统设置。

## 聊天与日记中断恢复

`sentenceSplitter.test.js` 覆盖英文流式分句及中文 golden 回归。日记重启恢复与失败历史在 `diaryGenerator.test.js` 中验证；纯文字回复幂等与回放在 `privateChatImageTools.test.js` 中验证。

前端恢复编排测试（原 `chatTimeoutRecovery`、`diaryRecovery`、`proactiveChatSwitch`）已随 2026-11-06 精简移除；超时重试的幂等契约仍由服务端 `privateChatImageTools.test.js` 覆盖。`/test/fixtures/chatDiaryRecovery.html` 保留为手动检查页。
