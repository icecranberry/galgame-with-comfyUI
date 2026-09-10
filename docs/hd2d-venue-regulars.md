# 功能建筑熟客系统（生态链 D 确定性内核）

2026-09-10。把计划 10.3 节 D 链「经常光顾的朋友」落到功能建筑注册表上：玩家在同一家店正常消费达到阈值，店主把他记成熟客，解锁一段独特对话主题并写入一条共同经历。硬约束与咖啡馆一致——熟客只加内容，不发钱、不发道具，不能把持续花钱变成无限亲密度或铸币漏洞。

## 为什么这样泛化

熟客不该是咖啡馆专属：酒馆、裁缝铺、面包房、花店只要挂上注册表，就自动获得同一套熟客口径。因此：

- 建筑只声明 `regular` 档案（阈值与主题文案），不写计数逻辑。
- 引擎只认「已正式结算、且付款方是玩家」的服务，付款方是店方的当班/帮工不计入。
- 咖啡馆作为冻结实例单独声明 `CAFE_REGULAR_PROFILE`，口径与注册表建筑一致。

## 口径

| 环节 | 规则 |
| --- | --- |
| 计数 | 一笔 `completed` 且 `payer === 'player'` 的功能建筑服务 = 一次到访；按 `sessionId` 去重，重复结算/重放不重复计 |
| 阈值 | 注册表 `regular.tiers` 声明，当前两档：3 次、6 次 |
| 奖励 | 解锁该档 `topic`（独特对话主题，内容而非钱物）；跨过阈值时追加 `town.venue.regular` 事件 |
| 记忆 | 既有经历消费者校验来源后，为玩家与店主各写一条 `town_experiences`，摘要含店名与主题 |
| 展示 | `/api/town/economy` 的 `cafe.regular` 与 `venues[].regular` 返回 `{visits, tier, nextTierAt, topic, unlockedAt, lastVisitAt}` |

零金额换物（`help_swap`）与当班（`shift`/`cafe_shift`）是店方付款，不进入熟客计数；这是有意为之：熟客对应真实消费，不对应劳动。

## 酒馆点单（新增消费玩法）

熟客要成立，酒馆必须有玩家付费的服务。新增 playbook `purchase`（玩家付费 → 两阶段 `order` → `pickup` → 发放成品）与 `town.tavern.buy_meal`（12 邻币 + 1 份食材 → 酒馆热食）。裁缝铺的 `custom_order`、咖啡馆的 `drink_coffee` 原本就是玩家付费，自动进入熟客计数。

## 文件与接入点

- 声明：`agent-core/src/services/town/townVenuePlaybooks.js`（`purchase` playbook、`town.tavern.buy_meal`、各建筑 `regular` 档案、`CAFE_REGULAR_PROFILE`、`venueRegularProfile(s)`、`venueKindDescriptors`）
- 引擎：`agent-core/src/services/town/townVenueRegularService.js`（`record` / `get` / `list`）
- 表：`agent-core/src/db/townVenueRegularSchema.js`（`town_venue_regulars`、`town_venue_regular_visits`）
- 结算钩子：`townVenueService.settle` 在写入收据后调用 `onConsumed`；记录失败只打日志，不会把已完成结算改判失败
- 运行层：`townEconomyRuntime.js` 构造 `regulars`，咖啡馆与注册表建筑共用同一实例，并在 `/economy` 投影 `regular` 与 `venueKinds`
- 记忆：`townExperienceService.facts` 新增 `town.venue.regular` 来源校验分支
- 前端：熟客进度与已解锁主题随进店面板在 `TownVenueServicePanel.vue` 显示（并支持 `purchase` 的确认/取走动作）；可开张建筑清单由 `economy.venueKinds` 下发，落在 `TownWalletPanel.vue` 的开张向导里（`TownLifePanel.vue` 已拆成 `TownPaperPanel.vue` + 钱袋 / 公告站两个面板）；`townLife.js` 登记 `town.tavern.buy_meal` 与 `confirm_order`/`take`

## 验证

```powershell
# 工作目录：agent-core
node --test --test-reporter=spec test/townVenueChain.test.js
node --test --test-reporter=spec test/townVenueRuntime.test.js
node --test --test-reporter=dot --test-concurrency=4 test/*.test.js

# 工作目录：web-ui
node --test test/town-life-api.test.mjs
npm.cmd run build -- --outDir ../output/hd2d-venue/ui-build
```

- `townVenueChain`（服务层 11 项）：新增酒馆点单与熟客计数用例，覆盖「只计玩家付费」「同会话去重」「当班不计入」「跨阈值只解锁一次」「未知建筑返回 null」。
- `townVenueRuntime`（真实运行层）：真实 runtime + 真实模拟走通三次定做达到熟客阈值，`/economy` 暴露 `venueKinds` 与 `regular`，并经既有经历消费者写出两条记忆。

## 边界与未做

- 只实现 D 链的「独特对话主题」分支。计划里的「一次预约」分支——店主在私聊里发正式邀请、玩家接受生成日程 overlay、镇上相见——尚未实现；现有 `townAppointmentService` 仍只认工坊 `mood_patch` 结算来源。
- 熟客主题随经历摘要进入既有 `characterTownLifeContext` 读取（私聊/回信/朋友圈/群聊等入口共用），没有另建一份熟客上下文；生活面板只是把同一条进度与主题显示给玩家。
- 6 次档主题已声明，但没有额外权益；这是有意的内容分层，不是漏做。
