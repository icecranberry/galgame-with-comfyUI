# 配送、工坊与经历运行层

`townEconomyRuntime.js` 是 HTTP/定时器到纯服务的入口：从当前 world/epoch 与 actor registry 解析玩家，客户端不能指定钱包所有者、价格、库存、奖励或到达坐标。

## 操作契约

所有写请求必须携带当前 `worldEpoch` 与稳定 `idempotencyKey`。响应丢失时沿用原请求完整内容重试；不能用新标识自动再提交。版本操作同时携带 `expectedVersion`。

| 接口 | 行为 |
| --- | --- |
| `GET /api/town/economy` | 配置、钱包、订单、居民、地点、工坊营业与会话状态 |
| `GET /api/town/liquidity` | 只读公共基金保障状态；设置页使用，不推进订单或投递维护 |
| `GET /api/town/mailbox-tasks` | 信箱正式配送卡，只读校验来源及预留；不生成信件或接受任务 |
| `POST /api/town/economy/setup` | 明确选择三位不同 NPC、三个不同 POI；一次性初始预算，不自动发布订单 |
| `POST /api/town/orders/publish` | 预留公共预算 30 与一份原料；最多一份未结算委托 |
| `POST /api/town/orders/:id/accept` | 玩家实际到公告地点后接单 |
| `POST /api/town/orders/:id/pickup` | 玩家实际到供应地点后取得专用托管货物 |
| `POST /api/town/orders/:id/complete` | 玩家实际到工坊后原子交货、到账 30 |
| `POST /api/town/orders/:id/cancel` | 按订单状态退回预算、原料或托管货物 |
| `POST /api/town/services/offer` | 在工坊实际到达、营业且提供者就位时创建报价，不扣费 |
| `POST /api/town/services/:id/accept` | 明确接受报价；30 托管、一份工坊材料预留；岗位工作按规则让位 |
| `POST /api/town/services/:id/turn` | 附 `intentKey` 与可选 `text`；稳定标识同时作为回合 ID |
| `POST /api/town/services/:id/cancel` | 取消并按不可逆结算方案退款 |
| `GET /api/town/services/:id` | 恢复/查询当前玩家的会话与结算 |
| `GET /api/town/actors/:id/activities` | 分页行动日志和近期已结算经历，运行中工时不等于已获工资 |
| `GET /api/town/appointments` | 免费回访候选和已确认预约；候选仅来自已结算服务的入住角色 |
| `POST /api/town/appointments/candidates/:id/accept` | 显式选择 `startAt`（UTC 毫秒）并确认三十分钟回访 |
| `POST /api/town/appointments/:id/cancel` | 按版本取消预约；不修改基础日程 |
| `GET /api/town/deliveries` | 当前世界经历/预约的待处理或失败投递摘要与分页 |
| `POST /api/town/deliveries/retry` | 手动将失败记录按原 eventId 重新入队，不执行交易 |

服务的本地阶段为主题、材料确认、制作、交付，对应 `choose_theme`、`confirm_materials`、`craft`、`deliver`。最多 8 回合，5 分钟空闲超时、20 分钟总时限；报价 5 分钟有效。制作前取消全退，材料投入后取消收 10 退 20，系统失效全退。完成交付才发放一枚 `town.mood_patch@1`，实例进入原背包，使用沿用 `mood_fix`。模型表达不能修改金额、材料和可发放模板。

营业时间为北京时间 09:00–18:00。轻量 NPC 采用结构化岗位目标；已关联角色保留原日程，不从工坊名称推断角色正在工作。接受后会话在有限时限内持有居民，普通相遇/聊天和新的模拟动作不能抢占。接单开关关闭后不接新单，既有订单/会话仍可完成或取消。

## 恢复与经历

重建在同一事务内取消动作、失败结算服务、取消订单、释放物品锁与经济预留，再递增 epoch；旧待投递事件进入 `WORLD_RESET` 终止状态。失败整体回滚，不留下半次重建。角色、背包、账本与已结算履历保留。

配送/服务产生持久事实事件。`town.experience` 仅消费可核对的正式结算来源，为参与者保存摘要；已关联角色通过原 `applyMemoryActions` 写记忆，轻量 NPC 不会因此创建角色卡。每位参与者按事实发生 UTC 日最多 12 条，每轮最多处理 10 个事件。失败退避重试，旧 epoch 不作用于新世界，不自动发帖、发信或给玩家额外奖励。

## 当前验证边界

`townWorkshopRuntime.test.js` 使用完整真实模块图、内存数据库和受控时间，覆盖走路配送、收入消费、营业工作让位、重复回合、关联角色身份、原背包首次无聊天历史使用、原记忆去重与重建保留。`townDeliveryRuntime.test.js` 另覆盖关闭接单后仍能完成既有配送。测试拦截网络，没有实际模型、生图或真实存档操作。

生产补货已通过 `townProductionRuntime.test.js`：已完成服务支持一次生产批次，工坊预留 30；供应者和工坊各有至少五分钟真实工作证明且仍在岗后，有限资源节点消耗 1、供应库存增加 1，并向公共基金回流 20、供应者支付 6、两名工作者各支付 2。证明只能使用一次，预算/资源/库存/工资在同一事务结算。资源总容量 200，重建不补满；关闭经营或到期释放预留。

九十天实 API 审计完成 90 轮配送、服务与补货，库存回到 20，资源剩余 110；公共基金净减 10/天，故不能称为长期经济平衡。只存钱、不消费服务的路径仍会停滞，详见 [经营审计](hd2d-m4-business-consumption-audit.md)。

预约只读校验指定未来日期的每日日程或模板，检查完整时间窗、所有重叠段及前日跨午夜延续，不使用“今天的活动”缓存，不创建每日快照。工作、休息、离镇和其他预约均阻止接受；赴约结束不超过原服务结算后七天。实际运行层按原导航前往工坊等候，取消/过期/重载清理模拟动作与租约；等候不是工作，不支付工资。

预约候选使用 `town.appointment` outbox。无效/过期结算终止跳过并记录原因；临时失败退避重试，已处理的坏记录不会持续占满每轮候选批次。候选创建和投递完成同事务，重建隔离旧队列。HTTP 与运行层测试通过；真实 `TownView` fixture 覆盖生活→预约、资料→近况、地图输入锁、epoch 关闭和触控竖屏旋转地图。

公共基金[有限保障政策](hd2d-m4-liquidity-policy.md)已接发布入口，默认关闭。开启至少需 60 可用准备金；基金在 60–89 时，随真实有库存的委托一次补至发布前 90，发布后保留 60。单次/滚动 24 小时最多 30，滚动七天最多 210，本 world 累计最多 600，流通量上限 4000。发行、预算/原料预留、订单和收据同事务；缺货/失败不发行，重建不刷新限额。尚不支持低于最低准备金后的救助，也没有无限资源或永久经营保证。设置和生图配置同批保存先提交数据库再变更内存，保存失败不假报成功。

`townWorkshopLLMRuntime.test.js` 另以本机 OpenAI 兼容 HTTP fixture 验证真实 chatSync 表达、坏 JSON/超时本地回退及 reset 中止旧回合。移动端浏览器 fixture 不能替代 Android 真机验收。

独立自然超时验收 `node test/fixtures/runWorkshopWallclockTimeout.js`（agent-core 下）实际等待 10017.6ms，5/5 通过：只发一个本机请求，超时进入本地模板，socket 与 generation 清理，托管保留至交付且只授予一件物品。该慢验收不加入默认快速测试；没有连接真实模型。
