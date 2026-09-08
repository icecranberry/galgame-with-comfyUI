# M6 记录投递维护

管理面板的设置页可打开“记录投递状态”。仅展示当前 world/epoch 的经历记录和回访预约投递；交易账本不通过此入口重放。

`GET /api/town/deliveries` 返回 `items` 与复合 `nextCursor`，可传 `cursorSeq`、`cursorConsumer`、`limit`（1–100）。仅列 pending、processing、dead，摘要包括消费者中文名、来源类型、尝试次数、时间及白名单错误码，不返回事件全文、人格或原始 SQL 错误。

`POST /api/town/deliveries/retry` 需要当前 `worldEpoch`、`eventId`、白名单 `consumerKey` 与稳定 `idempotencyKey`。仅 dead 可重新入队，保持原 eventId；不立即消费，不重新交易或发放奖励。原 key 在投递随后进入 processing/done 后仍返回原确认；新 key 对这些状态拒绝。请求记录与重新入队同事务，重建后旧 epoch 请求拒绝。

页面读取不自动提交重试；网络结果未确认时保留原请求，可关闭重开后手动重试。重新投递成功只表示已入队，不表示记忆或预约候选已经写入。永久无效/过期预约来源在自动消费时终止跳过，不在此列表反复触发。

`townDeliveryDiagnostics.test.js` 和 `townDeliveryDiagnosticsHttp.test.js` 合计13项通过，使用内存 SQLite、注入时钟、实际服务/路由源码与 localhost HTTP，覆盖复合分页、epoch/消费者校验、幂等、脱敏和回滚。前端 API 与浏览器 fixture 覆盖断网原请求重试、分页、世界变化、375竖屏/短屏/横屏、管理页嵌套面板焦点恢复。真实 TownView 触控 fixture 也验证了该入口及地图移动锁。

当前白名单仅 `town.experience`、`town.appointment`；不向任意 outbox 消费者开放运维重试权限。
