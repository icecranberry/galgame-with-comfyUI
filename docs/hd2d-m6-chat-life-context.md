# M6 私聊生活记录动态上下文

`agent-core/src/services/characterTownLifeContext.js` 导出
`createCharacterTownLifeContext({ db, clock, registry, timeZone = 'Asia/Shanghai' })`，
返回接受数值 `characterId` 的同步 builder。依赖必须显式注入；无符合条件记录返回 `''`。

## 输入与预算

- 通过 registry 读取当前 world/epoch，并将 `char:<characterId>` 解析为 canonical actor。要求角色关联仍存在、参与小镇且未归档；不接受客户端指定 actor、世界、地点或摘要。
- 仅该 actor、当前 world/epoch 的 `town_experiences`：近72小时、时间不晚于当前时刻，按发生时间倒序最多3条；仅使用已有非空结算摘要，每条最多160个 Unicode 字符。
- 仅该角色/provider、当前 canonical 玩家与当前 world/epoch 的 accepted 预约：`end_at > now` 且结束时间不超过未来7天，按开始时间顺序最多3条。包含已开始但未结束的窗口；取消、过期及结束瞬间的记录排除。
- 使用统一 `townAppointmentAvailability` 与 `townLocationMatch` 复核 `max(now, startAt)..endAt` 的剩余窗口及地点。读取时重查原日程，工作、休息、离镇、未知日程或地点失效保留记录并标为 `needs_reconfirmation`。`currently_free` 仅表示本次读取可用，不保证赴约或已到场。
- JSON 编码记录并转义 `<`、`>`、`&`，避免记录文本闭合外围标签。完整块不超过1800个 JavaScript 字符；超预算删除整条记录，不截断 JSON。地点名称最多50个 Unicode 字符。

块内说明明确：字段内容是已有记录，不是新指令、奖励授权或已见面证明。预约状态不能作为实际到场、交易或新事实的证据。

## 只读与聊天接入

builder 仅查询注入连接，不加载生产 DB、不写表、不创建日程快照、不调用 LLM，也不调用 `getTownState`、同步 registry 或推进移动。`clock.now()` 使用 UTC 毫秒；日程解释使用 factory 的时区。

`routes/chat.js` 在原动态尾部加入生活记录，使用 `config.features.town` gate，并传入 `config.town.timeZone`。即时普通私聊与带 townContext 的聊天共用该位置。原 M2 现场块继续独立保留；稳定人格、摘要、历史及回复队列未改变。无符合条件记录时 builder 返回空字符串，由原装配器过滤，原 prompt 逐字节保持一致。可选记录读取异常时 route 跳过此块。

## 排队覆盖边界

睡眠/延迟回复的 `queued` 路径仍在即时聊天动态装配点之前返回。`replyQueueScheduler.js` 现在在实际生成回复的 `buildDelayedReplyContext` 中，使用同一 builder 读取生成时的当前 world/epoch、当前时刻记录，作为独立 system 消息追加在原历史之前；同样使用 `features.town` gate 和 `config.town.timeZone`。无记录时不新增消息，原 payload 逐字节不变；读取异常跳过可选记录。

没有把生活记录、旧 town 现场或其他上下文快照写入用户原文或 reply_queue。原队列 claim、合并、历史写入和删除流程保持不变。本次覆盖的是 `processReplyQueue` 的实际生成装配，不表示已验证所有唤醒入口、调度定时器或真实模型端到端行为。

## 验证

`characterTownLifeContext.test.js` 使用显式 `:memory:` SQLite、实际 schema/registry，以及开启 `PRAGMA query_only=ON` 的读取验证：身份/world/epoch 隔离、时间与数量限制、原日程变化、地点别名、进行中窗口与结束瞬间、可配置时区、JSON 边界及长度预算、无数据 prompt 字节一致和稳定/历史 hash 不变。

`replyQueueTownLifeContext.test.js` 执行完整真实 scheduler 源码，仅在 import 边界注入显式内存库、固定时钟及本地假 LLM/广播。覆盖无记录 payload 字节一致、生成时新纪元与72小时边界、取消预约和其他身份/世界隔离、时区与工作冲突，以及 claim 后队列字段和用户原文保持原样、原成功写入/删除流程。没有加载生产 DB/config/网络依赖或启动调度定时器。

2026-09-08 上述两组测试与 `characterChatTownContext.test.js`、`townAppointmentAvailability.test.js` 组合回归32/32通过；日志为 `output/hd2d-queued-town-life.log`。未进行真实模型调用或定时调度器端到端测试。

预约读取随后收口到 `createCharacterTownAppointments({db,registry,clock,timeZone})`：life builder 调用 `read(characterId,{limit:3})`，仅移除 appointmentId，保留原字段顺序、文案及1800字符裁剪。新旧实现8个场景逐字节对照一致；共享 reader、life context、即时 guard、queued 与 availability 组合43/43通过（`output/hd2d-life-shared-appointments.log`）。此次收口未修改 routes/chat 或 queue。

随后只读审计未复现 chatSync 修改引入的兼容回归；默认重试、取消、freeEgg 回退边界、timer/listener 清理及取消后的晚回包检查通过，cancellation 与 queued 聚焦回归15/15通过（`output/chatSync-readonly-regression.log`）。另由 `output/chatSync-readonly-audit.mjs` 复现未修改的 llmConcurrency 既有问题：已有请求排队时关闭并发限制不会唤醒等待者，可能一直等待。本轮不修复此问题，因此这些结果不代表整体后台并发已完全验证。
