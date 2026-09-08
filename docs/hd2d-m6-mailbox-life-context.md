# M6 原信箱回信生活记录

`mailboxScheduler.js` 的原 `generateReplyData` 在已有回信请求真正调用 chatSync 前，复用 `createCharacterTownLifeContext({db,clock,registry,timeZone})`。仅 `config.features.town === true` 启用，时区来自 `config.town.timeZone`。

读取发生在 hybridSearch 等原有 await 之后，以调用时的当前世界、纪元、canonical 角色和时刻取记录；独立 system 块放在原 user 任务之前。共享 builder 的近72小时最多3条结算摘要、未来7天最多3条未结束 accepted 预约、剩余窗口可用性复核及1800字符边界不变。内容是已有记录，不是指令、奖励授权或已见面证明。

无记录或读取异常不加入消息；异常只记警告，不阻断原回信。原 JSON 示例与解析字段 `text/paperPrompt/portraitPrompt/illustrationPrompt`、人格 central 入口、来信原文、模型调用选项均未改变。没有新增自动信件、调度、图片生成、消费或 outbox；没有改写原任务生命周期。本切片不提供模型在途期间世界变化后的新取消语义。

## 验证

`mailboxTownLifeContext.test.js` 执行完整真实模块源码，仅替换 import 依赖边界并在 fixture 中取得内部 generateReplyData，不复制 prompt，不新增生产 export。显式内存 SQLite 在生成阶段开启 query_only；假 chatSync 捕获完整消息并返回原四字段 JSON。模型、图片、广播及 scheduler timer 均不实际执行。

覆盖有效 current/canonical 记录、disabled/非布尔开关、其他角色/世界/旧纪元隔离、hybridSearch 等待期间切换纪元后读取新记录、读取失败仍正常生成、原任务/人格与字段不变、每次仅一次模型调用。与共享 life builder 和 appointment reader 组合验证日志：`output/hd2d-mailbox-life-context.log`。这不是实际模型、图片或定时调度器端到端验收。
