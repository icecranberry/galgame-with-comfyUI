# M6 B 链：固定波波头发型卡

本切片复用原工坊、30 邻币、1 份材料和四阶段服务，交付原背包道具。效果固定为已有 `bob_cut`；使用后24小时的限时外观由原 `useItem` 执行，不在付费时直接改变角色外观，不自动生图，也不授予免费回访。没有新增经济数值、职业框架或初始化库存。

## 冻结合同

| 字段 | 旧 mood 服务 | bob 服务 |
| --- | --- | --- |
| serviceKey / template.key | `town.workshop` | `town.workshop.bob_cut` |
| template.version | 1 | 1 |
| templateId | `town.mood_patch` | `town.bob_cut` |
| templateVersion | 1 | 1 |
| outcomeKey | `mood_patch` | `bob_cut` |
| effectKey | `mood_fix` | `bob_cut` |

key 字符串不含 `@1`。bob 模板 payload 固定：

```json
{
  "outfit_name": "波波头发型",
  "outfit_description": "利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海"
}
```

`townServiceDefinitions.js` 导出 `WORKSHOP_SERVICE`、`TOWN_SERVICE_DEFINITIONS`、`getTownServiceDefinition(serviceKey)`、`resolveTownServiceDefinition(config)`。展示文字和模板注册方法放在定义外层，不加入旧 template。恢复解析严格校验批准模板字段/版本，旧无 outcomeKey 的配置映射 mood_patch。

offer 唯一新增可选 `serviceKey`；缺省沿用旧服务，不补字段进入旧请求 fingerprint。后续操作由保存的 session 决定服务，不能在 accept/turn 时换款。session DTO 增量返回 `serviceKey/serviceName/serviceDescription`，原字段保留。旧在途记录、pending 请求、事件和收据不迁改。

同步只读 `services.listCatalog({worldId,worldEpoch})` 返回：

```js
[{ serviceKey, name, description, price: 30, available, reason }]
```

未配置工坊返回空数组；reason 为 null 或 SERVICE_LOCKED。available 仅表示生产解锁资格，不表示营业、到场或余额足够。runtime 将该列表附加到 `getTownEconomyState().service.catalog`，保持旧字段。

## 真实生产解锁与结算

`townServiceUnlock.js` 只读核验当前 world/epoch 的 completed production，不能只用 status 字段。核验包括固定 recipe、当前业务 slice、最终 production log 和领域事件、两名不同岗位居民的工时 proof 与 completed activity log、真实 produceStock 入账、30 邻币预算已捕获，以及来源付费服务的 receipt、领域事件和实际发放实例。事件参与者及地点也必须匹配；不要求完成生产的历史参与者现在仍在镇内。坏证据返回锁定，不广泛吞数据库错误。

生产入账和最终日志在同一事务内可能相差毫秒，校验其合法先后顺序，不要求时间戳相等。跨 epoch 后旧批次不能解锁新世界代次。查询不会发钱、补货、写解锁状态或制造 proof。

engine 在 offer 与 accept 均核验解锁。接受后依据已冻结会话恢复，不反复依赖历史解锁状态。到场、营业与 busy 校验仍沿用原服务规则。

阶段保持 `choose_theme → confirm_materials → craft → deliver`；bob 的主题阶段仅确认固定款式。accept 托管30、预留1材料；确认材料后消耗。消耗前取消退30，消耗后收10退20，系统失败/重建全退30；原超时、回合限制、CAS 和结算恢复机制保留。

选择 bob 时显式调用 Curie 的 `ensureBobCutTemplate(scope)`，不能假设 `ensureDefaultTemplates` 已注册它；后者仍仅返回原 mood/energy 两项。

完成事件仍使用原四字段 payload；bob 的 sourceId 是 `service:<sessionId>:outcome:bob_cut`。grant、收据、事件和 outcome 必须一致，重试不重复发卡。经验只能描述获得发型卡，不能说已使用/已换发型；新 bob 不满足现有免费回访来源。Desc 负责经验来源与生产兼容的跨模块验证。

## 验收证据与范围

本模块定向命令：

```sh
node --test --test-reporter=dot agent-core/test/townBobCutService.test.js
node --test --test-reporter=dot agent-core/test/townServiceSession.test.js agent-core/test/townServiceCatalogHttp.test.js
```

- `townBobCutService.test.js`：**6/6 通过**。真实完整迁移、配送、旧服务结算及 scheduler 双岗位工作完成生产后解锁；bob 四阶段付费发卡一次、固定模板/no freevisit、旧 offer 原 fingerprint、query_only catalog、损坏 proof/log/receipt/事件/入账拒绝、accept 二次核验、30/20退款、跨 epoch 锁定、冻结会话重建 engine 后系统失败全退。
- 旧 `townServiceSession.test.js`：**32/32 通过**。原服务语义回归。
- main 的 `townServiceCatalogHttp.test.js`：**3/3 通过**。接口参数/返回兼容证据，单独不作为真实支付或解锁证据。
- main 转交 Curie：模板及原背包相关新旧测试 **12/12 通过**。bob 独立批准入口，默认模板列表不变。
- main 转交 Desc：experience 与 B 链生产兼容 **17/17 通过**（旧11＋新6，含父项；837ms）。实际配送/旧 mood 服务 → 双岗位5分钟 proof → 生产完成解锁 → bob 服务 → 第二次生产，node 剩余198；重复 start 不重复生产，新的重复请求 key 被拒。经历仅向两位参与者记录获得发型卡，错误 grant source 被拒；definition/receipt 篡改由数据库 trigger 拒绝。该证据覆盖实际生产与经历链路，不等同于发型卡使用后的完整外观更新验收。
- main 转交 Socrates：UI API **5/5** 及新 bob、原 Workshop、Life 浏览器 fixture 通过。此处记录协作方证据，不称为本模块独立浏览器验收。
- main 转交 Volta：真实 B 链 **1/1 通过，1256ms**，输出 `hd2d-bob-chain-runtime.log`。grant 不改变外观；原背包 use 生效24小时；真实 persona 与 builder 得到 `needs_update`；没有 freevisit。此项补齐发卡后的使用与外观待更新证据，不代表自动生图完成。

所有本模块运行测试仅使用内存库、受控时钟和本地网络 stub；没有真实数据库、真实模型或自动生图。工坊服务前半链与原背包使用后外观 signature 待更新的后半链，应由跨模块实际 B 链测试另行记录，不以目录可见代替整链验收。

Curie 发现历史 config/slice 的 locationKeys 或 npcActorIds 为 null 时会抛 TypeError。解锁 reader 现先验证地点、角色、账户、库存及工人标识结构，再读取生产证据；畸形记录返回锁定，真实 SQL schema 错误仍抛出。正式回归为 `townServiceUnlockMalformedAudit.test.js`，包含 query_only 与 schema 错误不吞断言。

CPU 窗口结束后定向运行 `node --test --test-reporter=dot agent-core/test/townServiceUnlockMalformedAudit.test.js agent-core/test/townBobCutService.test.js`：**8/8 通过**（历史结构回归2＋真实 B 链6）。未运行全套测试、真实数据库或模型。
