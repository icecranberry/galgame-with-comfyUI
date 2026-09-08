# M2 镇内对话前端交接（2026-09-08）

当前状态：NPC 与普通角色均已接入镇内舞台，不再跳聊天页面；前端原 API / store / SSE / 历史复用、角色 context 拒绝处理与 NPC 稳定请求 ID 已实现并通过离线 fixture。真实模型、真实存档和 Android 真机验收未运行。此文替代本文件早先的“仅 NPC 切片”交接，不宣称全部 M2 产品验收完成。

本轮没有修改后端、数据库或 prompt；共享区后端以及 `stores/town.js` 的其他代理改动保持原样。没有启动生产后端、连接真实库、调用模型或加载真实角色素材。

## 前端交付文件

- `components/town/TownDialogueStage.vue`：纯展示、统一 LinsheButton/LinsheInput，宽底对白框、双方立绘、缺图占位/放大、最近一轮完整回复与历史切换、长内容滚动、可扩展消息 slot。直接全文呈现；无新增逐字动画或聊天记录。
- `components/town/TownCharacterChat.vue` + `town/dialogue/useTownCharacterChat.js`：普通 chat store 的视图适配，展示原文字/表情/配图/思考/奇遇摘要与延迟消息；复用普通聊天的 imageGenMode/deepThinkMode 设置。历史展开调用原 expandWindow，不再获取一套历史。
- `components/town/TownNpcChat.vue` + `town/dialogue/npcPendingTurns.js`：NPC 原 API 适配，内存只保存未确认请求 ID/文本和 in-flight Promise，跨关闭重开复用；没有第二份对话持久层。
- `views/TownView.vue`：角色资料卡“就地交谈”、linked NPC characterId 优先、舞台接入与停止移动、输入隔离、世界/角色身份失效关闭。
- `stores/chat.js`：原 sendMessage 增加可选 `{ townContext }` 第四参数；history/selection 代次保护并返回读取成功状态；新增展示用 queuedReplies 状态；镇内前置拒绝向 adapter 抛出（移除本轮未入库的乐观气泡）。不另实现 SSE parser、人格或记忆。
- `api/index.js`：原 chatStream 可选第六参数 townContext；镇内 400/409 直接停止重试并保留 code/status。jsonRequest 的错误增加 status/code/requestId/characterId 属性。NPC 请求第三参数扩展见下。

## 角色契约

完整后端说明见 `docs/hd2d-m2-character-chat.md`（Volta）。路径 ID 始终是 characterId，`kind=npc` 有 characterId 也走角色管线；`kind=char` 携带 npcId 不改变选择。详情才发现关联时先刷新 snapshot，再按最新 actor 映射开角色舞台。

```js
chat.sendMessage(text, settings.imageGenMode, settings.deepThinkMode, {
  townContext: { worldId, worldEpoch, actorId },
})
```

- 三字段取小镇 snapshot 和点击的 actor；不传坐标、地点名、prompt。普通 ChatView 原三参数调用保持省略 townContext。
- 400/409 两层（API/store）均不自动重试，更不会丢弃 context 降级。前置拒绝原文恢复到输入框供查看，提示关闭后走近/重新选择；非 TOO_FAR 拒绝触发 snapshot 刷新。
- 角色回复由同一个 chat.messages/visibleMessages 呈现；App 已有 delayed_reply/proactive_message 分发原 store，舞台不新订阅或新开统一 SSE。
- 关闭舞台不取消正在接受的回复。再次打开同一角色时复用正在流式生成的数据；打开另一角色时等待原回复结束，不中止旧请求。主动/延迟消息沿用原 App 分发，不追加第二次。
- 世界 worldId/worldEpoch 或 active actor/character 绑定变化时关闭旧舞台，已接受的角色回复仍完成到原历史。
- 后端 guard 将校验后的发送时现场存入 `req.townAdmission`，原聊天 route 在 `dynamicBlocks` 追加面对面现场说明。地点由角色实际已完成整步的 cell 匹配 POI，不使用 `agent.targetloc`；原稳定人格、统一历史与非镇内请求保持不变。`queued` 早返回仍沿用原语义，不将镇内上下文另行持久化到延迟队列，也不建立额外人格。

## NPC 契约与重试

```js
api.chatWithTownNpc(npcId, text, { clientMessageId, worldId, worldEpoch })
// { reply, source, requestId }
```

- 新用户发言创建 crypto.randomUUID；按 worldId/worldEpoch/npcId 保留未确认请求。网络结果不明、DIALOGUE_PROCESSING 时锁定新发言，手动“重试同一条消息”复用同 ID；不自动重试。
- 接受完成响应后统一重新读取原 NPC 历史，避免服务器重放 completed reply 或之前手动读过历史导致前端重复追加。
- DIALOGUE_FAILED 不继续自动请求；恢复原文，先手动读取历史后，用户下一次发送创建新 ID。
- 待确认请求仅保存在当前 JS 会话内，关闭舞台/重新打开保持，整页刷新不保留。服务器幂等保证依赖后端实现；fixture 只验证前端同 ID 行为。
- STALE_WORLD 提示重新选择并刷新世界；发现 characterId 则停止 NPC 管线、进入普通角色管线。

## 地图与移动端

- 任一舞台打开前 await `api.moveTownPlayerDir(0,0)`（POST `/api/town/player/dir`）。按新后端语义，保留未完成当前边，取消其后路径，不在前端改坐标、不提前宣告到达、不暂停全镇。
- 等待 stop 与舞台显示期间均清空方向键定时器/拖拽状态，并拒绝画布点击、拖动、滚轮、右键与双击输入。stop 失败不打开舞台。
- DOM 拦截键盘/触摸/指针冒泡；IME/229/长按 Enter 不重复发送。Tab 只在可见且非 inert 的控件循环；Esc 优先关闭大图/历史，再关舞台；卸载恢复之前焦点。
- visualViewport / ResizeObserver 限定面板可见高度，窄屏双立绘上置，低高度隐藏立绘，安全区保留；移动端不自动拉起键盘。
- 渲染器/投影/HD2D 业务实现未修改。

## 可重复验证

仓库根目录：

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/icecr/.codex/tmp-pw/node_modules/playwright-core/index.mjs'
node web-ui/test/town-character-browser.mjs
node web-ui/test/town-dialogue-browser.mjs
node --test web-ui/src/town/renderers/renderers.test.js
```

`PLAYWRIGHT_MODULE` 可指向其他已安装 playwright/playwright-core；默认浏览器 channel=msedge，可用 BROWSER_CHANNEL 覆盖。fixture 独立 Vite 配置无生产 proxy、关闭 HMR，未知 API 拒绝；所有历史与 SSE 来自内存 HTTP fixture，配图是合成 SVG。没有启动后端服务。

web-ui 目录：

```powershell
npm.cmd run build -- --outDir ../output/hd2d-m2-character/ui-build
```

最终结果：

- 角色浏览器 fixture PASS：真实前端 API/SSE parser + Pinia store；流式首 token、配图/好感度、同键网络重试、queued+统一流 delayed_reply 仅追加一次、原历史、关闭重开、回复中换角色、迟到历史、history 失败、context 400/409 只发一次且无降级、普通聊天省略 context。
- 同一 fixture 挂载真实 TownView：stop 应答前不开舞台、WASD/画布不穿透、URL 不跳转、kind=char/npc 的 linked 角色优先、stop 失败与 epoch 变化关闭通过。
- NPC 浏览器 fixture PASS：原 API、身份优先、IME、重复提交、失败重读后新 ID、processing 同 ID、响应丢失关闭重开同 ID 且历史不重复、晚回包隔离、立绘焦点/错误占位、桌面/竖屏/横屏/压缩高度布局。
- HD2D 原前端测试 12/12；隔离 build 成功（218 modules）。既有混合导入/大包警告保留。
- 截图已检查：`output/hd2d-m2-character/character-desktop.png`、`character-mobile.png` 与 `output/hd2d-m2-npc/*.png`。前者 synthetic 立绘/聊天配图，后者缺图/长文本；不代表真实艺术素材或 Android 真机软键盘验收。

## 保留边界

完整真实后端 + 实际存档 + 模型端到端测试未做；本轮验收采用隔离 fixture，没有进行真实生成或真实存档写入。角色奇遇仅展示已有摘要，未把完整奇遇操作移植进舞台；角色原聊天页的撤回/管理菜单不在这次镇内输入范围。NPC 历史仍受原 API 默认条数限制；玩家/角色外观实时缓存失效事件未新增。发送时现场动态块已由后端接入（main 报告 11 项 guard/context 测试通过）；这不代表真实手机或模型对现场说明的实际响应表现已完成验收。

## SERVICE_BUSY 补丁与整合 QA（2026-09-08）

- 角色资料卡优先展示“正在提供工坊服务”，禁用“就地交谈”。NPC/linked NPC 的普通聊天入口也检查最新 agent.busyReason；停止移动应答后再检查一次，避免等待期间服务状态改变。
- 已打开的普通角色/NPC 舞台响应 SERVICE_BUSY 禁止新发送；角色原 stream 不取消、不重新选角，已接受回复继续完成。NPC_BUSY 作为明确拒绝展示并禁用同条重试，保留原文；TOWN_CHAT_BUSY 沿用前置 409 不重试处理。
- Life/Workshop 不消费普通聊天的 busy 禁用条件。整页 fixture 已验证 busy provider 仍可从 Life 打开 Workshop，并可按 locationKey 调用地图移动。
- 四套离线浏览器测试 PASS：town-character-browser（含 busy 切换中原流完成、TOWN_CHAT_BUSY 单次拒绝、资料卡禁用、Life→Workshop）、town-dialogue-browser（含 NPC_BUSY）、town-life-browser（11 次合成命令、余额 30）、town-workshop-browser（20 次合成命令）。
- 当前完整隔离 build 成功：223 modules，目录 output/hd2d-m2-busy/ui-build；既有混合导入与大包警告。先前 Life API barrel 缺失问题已由共享工作区补齐，本轮重新验证已通过。
- 本轮验收使用前端真实组件/HTTP/SSE 解析和内存 fixture；没有启动真实模型或写入真实存档。这些结果不替代真实设备与真实内容的视觉验收。
- TownView 当前补丁完成并交还 main；未启动 M7 几何/素材改动或 imagegen。
