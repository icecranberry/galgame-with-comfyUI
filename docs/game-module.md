# 游戏模块接入

从主导航「游戏」或手机侧栏「更多 → 游戏中心」进入。官方跑团模拟器支持玩家 KP 与角色 KP 两种模式，内置《雨夜的第十三声钟》《没有终点的末班车》。开局选择 1–6 位邻舍角色，一次生成全员调查员卡。模型需支持原生工具调用才能使用角色 KP 模式。图片生成默认关闭，开团时可启用。

## 包与运行时

- 官方包：`games/official/<id>/`，随仓库发布；无需额外安装依赖或构建游戏前端。
- 社区包：`agent-core/data/games_community/<id>/`。支持 GitHub Topic `linshe-game`、指定仓库和 ZIP；工坊结果缓存 20 分钟，失败可回用旧缓存。
- 存档：`installed_games`、`game_sessions`，与游戏包分离。更新保留存档；卸载可保留数据，再装同一 ID 时恢复。
- 图片：`agent-core/data/game/<id>/<sessionId>/`。只在游戏中展示，手动收藏后复制到主相册。删档与选择清数据的卸载会清理对应目录。
- GitHub Token 和 HTTPS 镜像前缀可在游戏中心「连接设置」保存；前端只读取 Token 是否存在，Token 只发送到 GitHub API。

清单与示例见 [开发规格](linshe_game_module_dev_spec.md) 和 [社区开发指南](linshe_community_game_guide.md)。`serverEntry` 为单文件 ESM，可以引用 Node 内置模块，第三方依赖须提前打包；安装时不执行 npm。后端插件是用户信任的本机代码，异步错误兜底和受控 `ctx` 不构成 Node 安全沙箱。

## 前端 SDK

游戏中心与宿主的 UI 独立于主站 Linshe 组件，沿用本地 `game-test`（`92af58cf`）的游戏馆风格。共用控件与弹窗位于 `web-ui/src/games/components/`，主题位于 `web-ui/src/games/styles/game-ui.css`；游戏包内部继续自行维护 UI。

宿主在 HTML 的游戏脚本之前自动注入 `/game-sdk.js`。使用 `await window.LinSheGameSDK.ready` 等待握手。前端资源使用相对路径，保留包内 `web/` 目录。iframe 不授予同源能力，禁止直接联网；通过 SDK 请求宿主，主站样式和浏览器存储不进入游戏。

```js
const sdk = window.LinSheGameSDK;
await sdk.ready;
const people = await sdk.bridge.call('get_characters');
await sdk.save.write('my-save', '第一幕', { chapter: 1 });
const save = await sdk.save.load('my-save');
await sdk.save.write('my-save', '第二幕', { chapter: 2 }, save.revision);
const stop = sdk.on('media', event => console.log(event.sessionId, event.url));
stop();
```

支持 `bridge.call`、`llm.chat`、`image.generate`、`image.promote`、`save.list/load/write/delete`、`ext.request`、`ui.exit`。桥接工具接受固定白名单：角色列表、完整资料、关系、立绘、记忆目录/搜索、相册、情绪和小镇状态，不提供设置、密钥、向量库管理或任意 HTTP 请求。

扩展路由注册在 `ctx.router` 下，由 SDK `ext.request('/path', { method, body })` 调用。`ctx.db` 是当前游戏的存档仓库，提供 `list/load/write`，没有全库 SQL 接口；权限仍由清单控制。`ctx.events.emit(type, data)` 通过 SSE 和 SDK 推送给当前游戏。插件默认导出注册函数，可返回 `onUnload()`，或导出同名清理钩子。停用、更新和卸载会清理插件，并取消其未完成的 LLM 请求。

## 跑团状态边界

规则引擎保存在官方包 `server/index.mjs`。前端通过扩展接口推进和读取卷宗，通用存档接口只提供跑团目录和删除。每个存档同时只接受一个状态修改请求。

`POST /turn` 接受客户端生成的 `turnId`。启动回合时，玩家发言和回合编号一起入档。角色 KP 的完整工具请求先入档，每个工具结果与对应状态变更在同一次 SQLite 写入中提交。HTTP 断开会取消当前模型请求。重新载入后用 `GET /state` 返回的 `pendingTurn.id` 作为 `turnId` 重发，可附带 `resume: true`，已记录的工具结果继续用于原模型会话。回合已完成时，同一编号返回当前状态。每轮模型最多为玩家掷一次骰，每名调查员的普通 HP/SAN 调整合并为一次。手动 `/roll` 和 `/control` 使用各自的 `operationId` 去重，重发返回原操作结果；`checkId` 可绑定具体的待掷骰检定。

前端实际显示一条发言后确认累计条数。后端只接受递增确认；到首个检定立即截断，未播放部分丢弃。输入、暂停和插话会取消剩余队列。角色 KP 模式下，玩家检定由 `request_check` 说明原因、技能、难度及骰型，并自动掷骰入档。前端播放动画后续跑同一回合，工具收到原骰值，交给 KP 裁定。AI 队友的检定在发言确认后自动掷骰，前端在动画后自动交回 KP 裁定。手动掷骰只用于玩家 KP 模式。普通调查员批次仅收到公开记录；持有密信者单独请求，仅收到自己的密信。切幕时直接摘录本幕的公开日志，后续上下文保留全部已公开证物、最近十段幕间摘录及当前场景最近 15 轮。

有风险且结果不确定时才检定。默认 D20，技能修正为 `floor((技能值 - 50) / 10)`，普通、困难、极难的目标值分别是 10、14、18。自然 20 大成功，自然 1 大失败。优势或劣势各掷两颗 D20，分别取高值或低值。D100 在需要百分骰时使用，1 大成功，96–100 大失败，普通、困难、极难按技能全值、二分之一、五分之一确定阈值。随机表和伤害等可调用 `roll_dice`，支持 1–6 颗 D4、D6、D8、D10、D12、D20 或 D100，返回每颗骰值和合计。

HP 或 SAN 为零自动退场，允许引入新角色替补或结团。结团记忆默认不写入；用户勾选后以明确的“虚构桌游／剧本杀经历”保存，并按存档去重。

官方模组用可选的 `scenario.rules` 声明队伍道具、关键动作及结局。公开发放关联线索会登记道具，关键动作可要求场景、已得线索、持有道具、前置动作或场内成功检定。引擎负责消耗道具、发放新道具、扣减状态和锁定达成结局。古宅地下室在进入后的三个已完成回合计满后触发第十三响。有结构化规则时，`/finish` 需要已达成结局，或显式传 `abandon: true` 提前收团。旧官方存档从已获线索恢复道具。导入外部剧本时可以附带同样的结构化规则，未提供规则的剧本沿用自由裁决。

场景切换、极端骰值和遭遇触发生图异步任务。结果合并到最新存档，不覆盖同时推进的剧情；失效存档拒绝图片落盘。服务重启后未完成的生图显示为中断，可从印相入口重试。

## 验证范围

开发验证使用隔离 SQLite、临时安装目录和确定性 LLM/生图桩，覆盖导入回滚、权限、存档、插件异常、两种模式、发言断点、私密上下文、退场、幕间摘要及浏览器 SDK 流程。真实接口实测走完玩家 KP 主持的《雨夜的第十三声钟》和角色 KP 主持的《没有终点的末班车》。列车复测在应急闸的骰值与 HP/SAN 变化落盘后切断 HTTP 连接，重新加载游戏后续跑，核对骰值及扣减只结算一次，再以旧票达成返程。ComfyUI/NovelAI 连通和写入长期记忆仍待专门联调。
