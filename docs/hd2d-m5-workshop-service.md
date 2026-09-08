# M5 有限工坊服务引擎接入

本模块独立交付，不包含路由、UI、运行时调度或主 db 迁移接入。默认不配置模型即可完成全流程。

## 构造与依赖

```js
migrateTownServiceSessionSchema(db);
const service = createTownServiceSessionService({
  db, clock, registry, economy, itemTemplates,
  consumers: ['town.experience'], // 正式runtime必须配置，默认为[]仅供独立使用
  position: {
    getLocation,     // ({worldId,worldEpoch,locationKey}) -> {locationKey,...} 或 null
    hasArrived,      // ({worldId,worldEpoch,actorId,locationKey}) -> 严格布尔值
    isServiceOpen,   // ({worldId,worldEpoch,actorId,locationKey,serviceKey}) -> 严格布尔值
  },
  getWorkshop: scope => {
    const slice = business.getSlice(scope);
    return { accountId: slice.accounts.workshop, stockId: slice.stocks.workshop,
      actorId: slice.npcActorIds.workshop, locationKey: slice.locationKeys.workshop };
  },
  // 可选同步适配：同一db上用runner.cancel中断旧动作，见下文
  interruptWork: ({scope,providerActorId,playerActorId,sessionId}) => { /* ... */ },
  // generate: async ({prompt,context,signal}) => strictJsonString, // 可省略
});
```

除 generate 外，依赖全部同步且共享同一个显式 db。economy/itemTemplates 的写入必须参加外层事务，不得使用另一连接、发网络请求或在事务中广播。clock 使用单调不回拨的 UTC 毫秒 clock；position 从服务端推进后的移动事实判定玩家与服务者均到达工坊，不可读取客户端坐标或仅验证目标地点。

schema 应在 economy/itemTemplate 依赖迁移完成后接入。服务表保留历史，不按角色/地图级联删除。账号和库存从受信任 getWorkshop 固定取值；HTTP 不得将客户端账户、价格、结果、数量或材料覆盖进去。

## 命令

所有玩家命令由 HTTP 验证并注入真实玩家 actorId，不能信任请求体身份。scope 是 `{worldId,worldEpoch}`，以下都需要 scope：

| 方法 | 额外参数 | 返回 |
| --- | --- | --- |
| `offer` | `actorId,idempotencyKey` | offered 会话 DTO，不扣钱 |
| `accept` | `actorId,sessionId,expectedVersion,idempotencyKey` | active DTO；原子扣30至会话托管并预留1份工坊原料 |
| `get` | `actorId,sessionId` | DTO，含历史 turns 与 settlement |
| `list` | `actorId` | 当前 epoch 的玩家会话，最近100条 |
| `turn`（async） | `actorId,sessionId,expectedVersion,clientTurnId,intentKey,text?` | 最新 DTO；text 最多500字符，不授权任何效果 |
| `cancel` | `actorId,sessionId,expectedVersion,idempotencyKey` | 结算后的 DTO；失败则保留 settling 可恢复 |
| `recover`（仅服务端） | 无 | 本轮处理的会话数组；未到期 resolving 原样等待 |
| `failForRebuild`（仅服务端） | 无 | 所有未终结会话按系统失败全退后的 DTO 数组 |
| `getBusyActorIds`（仅服务端） | 无 | 已付费 active/resolving/settling 占用的玩家与服务者 actorId 去重数组 |
| `isActorBusy`（仅服务端） | `actorId` | 该 actor 是否被已付费服务占用 |

推进路径为 `choose_theme → confirm_materials → craft → deliver`，phase 为 `theme → materials → crafting → delivery`。每阶段还可 `clarify/cancel`；连续两次没有推进则按取消政策结束。`turn` 的 `cancel` 意图会调用相同取消逻辑。自由输入必须配 `clarify` 或本地合法意图，模型不替用户批准材料消费。

每次使用返回的 version，不假设每回合只加1。相同幂等键/turnId与相同请求可重放；不同内容报 `IDEMPOTENCY_CONFLICT`。并发回合报 `SESSION_BUSY` 或 `VERSION_CONFLICT`。终态新回合报 `SESSION_CLOSED`；已接受 turnId 重试返回当前会话。关闭面板只停止展示，不调用 cancel。

## 固定条款

- 本地模板 `town.workshop@1`：收费30，原料1，交付 `town.mood_patch@1` 一件。接受后同时占用玩家和服务者，其他报价不占用席位。
- 原料在 confirm_materials 时实际消耗；此前取消退30，此后取消/闲置/时限到期收10退20。制作完成并交付时商家收30。
- 系统失败退30，释放未消耗预留；已消耗材料不会凭空恢复，损耗由工坊承担。
- 报价5分钟失效；接受后闲置5分钟、最长20分钟、最多8回合。第8回合不调用模型；已有制作事实则可本地交付，未完成则结束退款。
- 生成租约15秒。生成在事务外，有超时与 AbortSignal；错误/无效 JSON 直接本地兜底，采用零次修正（满足最多一次）。合法提前 finish 仅在本地 crafted 事实已满足时接受。
- 服务只调用 grant：`sourceType:'service'`，`sourceId/idempotencyKey:'service:<sessionId>:outcome:mood_patch'`，`reasonCode:'SERVICE_OUTCOME'`，quantity=1、ownerKey=me。产物 ready 且已收下；不执行 mood_fix，不生图。

## 恢复与事务

短事务认领回合并记录 lease token/version，事务外模型，提交时重新检查状态/token/租约、世界 epoch、actor、权威到达与事实。晚回包不能复活或覆盖已恢复/终结的会话。重启后调用 recover，过期 resolving 从已存 input 通过本地模板完成，旧 token 作废，不重复调用模型或增加回合。

settling 中持久冻结结果与退款清单；授予、材料释放、转账、唯一结算收据和永久终态在同事务提交。授予失败会回滚实际物品写入，再改系统失败全退；退款自身失败则保留 settling，供 recover 重试，不声称完成。每次 terminal 只有一个 settlement，数据库触发器拒绝重开终态和修改/删除收据。

同一结算事务也通过 createTownEventService 写入唯一 `town.service.settled` 事实事件，并为 consumers 建持久投递。`eventId = service:<sessionId>:settled`，payload 严格为 `{sessionId,status,outcomeKey,settlementId}`，settlementId=sessionId；actorIds 包含玩家与provider，locationKey 为工坊地点。完成/取消/失败/过期都发同一typed事件；settlement DTO 同步返回 eventId/settlementId。事件插入失败回滚道具、钱、收据及终态，不留下虚假完成。

main 正式构造必须传 `consumers:['town.experience']`。消费方按 settlementId 查真实收据及会话终态，摘要只能描述已发生事实；事件 payload 不是金额/物品授权，不应再次授予。默认空 consumers 不补投历史事件，必须在开始正式服务前完成配置。本引擎不在事务内发送广播或调用记忆模型。

运行时须定时调用 recover，并在启动时调用；已接受服务允许临时闭店后继续短窗口，永久服务者/地点丢失则全退。运行时也应尊重活跃服务的工位占用，不把提供者挪走。

provider 与玩家各有独立的 SQLite 唯一索引，active/resolving/settling 期间最多各占一个已付费会话，第二次 accept 的扣款与预留一起回滚。未接受报价不占位。main 在 sim 移动、M3动作启动与 encounter 配对前，使用 getBusyActorIds/isActorBusy 屏蔽这些演员（本引擎未修改或另建 M3 actor lease）。终态释放占位；退款写入失败时仍为 settling，继续占位直到真实结算成功。

accept 现在在同一事务内调用可选 `interruptWork({scope,providerActorId,playerActorId,sessionId})`。main 应查询这两个 actor 的 validated/reserved/running 动作，以同一 db 的 `runner.cancel({ ...scope,actionId,expectedVersion,idempotencyKey:'service:<sessionId>:interrupt:<actionId>',reasonCode:'SERVICE_ACCEPTED' })` 取消；runner 会同时释放该动作的 actor/station/resource claims。不得调用取消整个世界的 cancelActive，也不得在回调中改内存状态、开异步任务或广播。接受事务失败会连同旧动作、claims、事件及取消记录整体回滚；成功重试不会再次调用中断适配。

中断回调后，引擎同步检查已有 M3 表中的双方非终态动作及未过期 actor claims；未清空则抛 `SERVICE_ACTOR_BUSY`。未提供适配也执行这一检查，有旧动作时拒绝接受，不静默双占用。回调必须同步返回（Promise 被拒绝）。这一入口处理已有动作；main 的 busy 屏蔽仍负责禁止在服务期间新建/启动动作。

recover 对 active/resolving 立即重查权威到达，不等闲置超时：provider 走开按系统失败全退；玩家走开按取消政策（制作前退30，后退20）结算，并使仍未到期的模型 lease 作废。settling 已冻结的清单仍走幂等结算恢复。

世界重置顺序：停止新服务 → `failForRebuild(scope)` → 其他经济预留释放 → epoch递增。只有退款成功才可继续；可由主调用方把同步步骤包在同一个 db 事务中。若先递增 epoch，本引擎及 economy 会拒绝旧 epoch 写入，不能靠 recover 穿透 fence 擅自结算。

## 验证边界

`node --test test/townServiceSession.test.js`：32项通过。全部显式内存 SQLite，使用真实 economyService/itemTemplateService/ActionRunner/EventService 与 fixture registry/position/clock，验证款项账本对账、实际ready物品、退款、失败回滚、并发认领、租约晚回包、重启服务实例恢复、终态永久性、双重占位约束、离场恢复、旧工作原子中断/回滚，以及结算事实事件/投递同事务与失败回滚。

没有调用真实 LLM/图像接口或真实库。没有跑跨进程崩溃注入、实际HTTP/UI端到端或调度器长跑；runtime 接入与重置顺序由主代理负责。

补充注入回归覆盖 runtime 白名单契约：仅 provider 同工坊 work_shift/wait 可被取消；资金/材料不足时旧动作、actor/station claims、审计事件与经济写入整体回滚。其他类型/地点/玩家动作保持不变并拒绝接受；未到达时不调用 interruptWork。实际 runtime 适配端到端由主代理验证。
