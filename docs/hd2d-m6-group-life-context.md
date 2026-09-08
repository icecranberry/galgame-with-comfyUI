# M6 群聊只读生活记录

原 `groupChatEngine.runGroupRound` 在已有整轮 `chatStream` 调用前、RAG await 之后读取共享 `createCharacterTownLifeContext`。只在 `features.town === true` 时启用，整轮使用一次 `Date.now()`、一个 registry 和配置的 `town.timeZone`。成员 ID 使用原 JOIN 查询的 `characters.id`，由共享 reader 校验当前 world/epoch 与 canonical character actor。

新增独立动态 system 块，JSON 编码 `characterId`、`displayName` 和完整记录内容，转义 `<>&`。说明各成员只能认领自己的记录，不代表全群知情、共同到场或奖励授权，不要求新增发言。每角色沿用共享 reader 的 1800 字符上限，整轮包含归属、转义及外层说明不超过 6000 字符；超预算舍弃整块并继续遍历原成员列表。没有有效记录时不插入任何消息；单成员失败不抹去其他成员记录，整体读取失败也不阻断原回复。

不改稳定人格、成员选择、历史和行输出协议，不新增调度、发送触发、模型调用或图片调用。事实块不作为原始聊天记录持久化。本接入用于原有 user/opening/idle/lull 轮共同生成入口，不额外启动任何轮次。

## 隔离验证

`agent-core/test/groupTownLifeContext.test.js` 编译完整生产 module，在 import 边界注入依赖，调用真实 `runGroupRound`；fake `chatStream` 捕获实际 msgs 并返回原行协议文本，原解析与消息写入只在显式内存库执行。真实共享 reader 在 `query_only` 下运行，图片/调度调用禁止，后台后处理回调仅捕获不执行，无真实模型、网络或消息发送。

5/5 通过：真实角色 ID 与记录归属；非群成员/旧 epoch/其他 world 排除；disabled、非布尔 gate 和无记录时完整 msgs/options 逐字节一致；RAG 等待期间切换 world epoch 后读取新记录；单成员与全部读取失败降级；6000 字符总预算、超长归属跳过后继续读取、保留的每块与真实 builder 输出完全一致。每轮仍仅一次 fake 模型调用，输出角色 ID 和原回复文本保持，事实不写入 raw 历史。

与 `characterTownLifeContext.test.js`、`characterTownAppointments.test.js` 联跑共 **23/23 通过，0 失败**；日志见 `output/hd2d-group-life-context.log`。

## 未覆盖边界

读取时点是调用 `chatStream` 之前。`chatStream` 内部并发 slot 等待期间及流生成中发生 reset 的取消、重读或晚响应隔离没有实现，也不在上述通过结果的保证范围。没有验证真实模型表达质量或既有后台调度的整体并发行为。
