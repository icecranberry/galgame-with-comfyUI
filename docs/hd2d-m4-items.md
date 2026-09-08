# M4 本地模板、实例授予与交易

新增 `townItemTemplateSchema.js`、`services/town/itemTemplateService.js`；原 `itemService.js` 与 `itemLifecycle.js` 只调整所有权/锁/CAS/退役和图片回写条件，保留已有效果实现与宝箱生成逻辑。没有商城 UI。

## 迁移与初始化

`migrateTownItemTemplateSchema(db)` 在 backpack_items 创建后、启动清理前调用；它内部调用旧 `migrateTownItemSchema`。原道具字段、ID、payload、used/collected 状态与效果引用不改，新增：

- `template_id, template_version`：引用不可变模板版本；旧道具保持 null。
- `world_id, source_id, source_index`：授予来源，批量授予各实例有独立序号；唯一 world/source_type/source_id/source_index。交易保持最初来源，不重新授予。
- `version`：默认1，收下/使用/交易/锁定/解锁/退役/宝箱图片完成时增加。
- `locked_by`：明确 order/session/trade 的占用 key。
- `retired_at`：软退役时间。退役不删除实例或图标。

`item_templates` 按 world/template/version 唯一且发布后不可 UPDATE/DELETE；`town_item_transactions` 与 `town_item_requests` 记录来源/请求哈希与固定回执。需要事务事件时先初始化 `migrateTownActionSchema(db)`。

```js
const items = createItemTemplateService({
  db, clock,
  getWorldEpoch: registry.getWorldEpoch,
  getActor: registry.getActor,
  effectRegistry: ITEM_EFFECTS, // 从现有运行时注入；新模块不导入 itemService/生产DB
  economy, // 仅 trade 必需；单独 grant 可省略
  consumers: [],
});
items.ensureDefaultTemplates({ worldId, worldEpoch });
```

首版本地默认模板：`town.mood_patch@1` → 原 `mood_fix`；`town.energy_charm@1` → 原 `energy`。名称、描述固定且 payload 为 `{}`；无图片也直接 ready，UI 使用原兜底图标，不调用 LLM 或生图。仅这两种本地模板效果已开放校验，不能因为另一个 key 出现在 ITEM_EFFECTS 就接受任意 payload。

## M5 固定 grant 接口

```js
const receipt = items.grant({
  worldId, worldEpoch,
  templateId: 'town.mood_patch', templateVersion: 1,
  ownerKey: 'me', quantity: 1,
  sourceType: 'service', sourceId: `service:${sessionId}:outcome:${outcomeKey}`,
  idempotencyKey: `service:${sessionId}:grant:${outcomeKey}`,
  reasonCode: 'SERVICE_OUTCOME',
  // sourceEventId: 'optional-audit-reference',
});
// { transactionId, eventId, itemIds: [真实 backpack_items ID], items: [快照] }
```

授予**不执行效果**；玩家以后使用此实例，仍由原 `itemService.useItem` 调用原情绪效果实现。quantity 范围1–20；sourceType 只支持 `service/production/reward/seed`，宝箱不走此入口。玩家授予即收下，NPC/商家库存不设 collected_at。

grant 以 sourceType/sourceId 唯一来源去重，同来源相同内容返回原实例 ID，改变数量/模板/owner 等内容拒绝。换 request key、重新建图、实例已用或退役都不能重新领取。请求哈希校验与 epoch 拒绝在每次调用先执行；同 key 不同内容为 `IDEMPOTENCY_CONFLICT`，同来源不同内容为 `SOURCE_CONFLICT`。

服务结算在同一外层 `db.transaction` 中组合 `economy.capture` 与 `items.grant`；任一步失败，钱、预留、物品、事件与回执整体回滚。事务提交后调用 `items.flushNotifications(receipt,broadcast)`；未提交时拒绝通知。可靠业务联动仍由 outbox 消费。

## 所有权与交易命令

道具玩家 owner 固定 `me`；NPC/角色为 `actor:canonicalUuid`；商家为 `business:stableId`。现有配送链的 `delivery:business:<role>` 也可使用，但必须已存在于同 world 的 economy_accounts 且 account_type 为 business；不重建或重新 seed 账户。拒绝把玩家再映射成 `actor:玩家UUID` 道具 owner，拒绝旧合并 actor ID。人物钱包仍是 `actor:uuid`，trade 会通过 registry 的 playerId 映射到道具 owner `me`。

除 grant 外，写命令公共字段为 `worldId,worldEpoch,idempotencyKey,sourceKey,reasonCode,sourceEventId?`。操作单件实例要求 `itemId,ownerKey,expectedVersion`，旧版本、非 ready、已退役、带生效引用、玩家未收下均不能操作。

| API | 额外参数与行为 |
| --- | --- |
| `publishTemplate` | `{templateId,version,effectKey,name,description,tradable,payload?,rarity?,imageUrl?}`；同版本同内容幂等，不同内容拒绝 |
| `getTemplate` | `{worldId,worldEpoch,templateId,templateVersion}` |
| `getItem` | `{worldId,worldEpoch,itemId}`；内部世界级查询，外部 API 须再检查所有权权限 |
| `lock` | `{itemId,ownerKey,expectedVersion,lockKey}`；只允许无锁实例，新版本快照返回 |
| `unlock` | 同上，必须持有匹配 lockKey |
| `transfer` | 上述单件参数加 `{toOwnerKey,lockKey?}`；用于真实交货/赠与/由上层已结算的归属转移 |
| `trade` | transfer 参数加 `{fromAccountId,toAccountId,amount,expectedAccountVersion?}`；付款账户必须属于买方 toOwnerKey，收款账户必须属于卖方 ownerKey；与 economy.transfer 同事务 |
| `retire` | 单件参数加 `{lockKey?}`；软退役，不删除图标 |
| `releaseLocks` | 公共字段；事务内释放当前 world 所有非退役实例锁，用于重置前清理 |

转移后保持 ID/template/source，清除旧锁并增加 version；进入玩家背包时设置 collected_at，离开玩家时清空。trade 返回普通实例回执和 `payment` 钱包回执。交易 price/报价时限/营业/距离/限额由可信上层验证，本内核不接受“模型说完成了”的事实，不单独生成购买品。legacy_chest/chest 来源默认不可交易；非 tradable 模板不可转移。

## 原玩家入口兼容

- `collectItem(id, {expectedVersion}?)`、`useItem(id, characterId, {expectedVersion}?)`、`discardItem(id, {expectedVersion}?)` 保持原调用可用，新增可选版本参数；即使旧调用不传，仍在 IMMEDIATE 事务中按读取到的 version 条件更新。
- 三者读取 `owner_key='me' AND retired_at IS NULL`，拒绝任何 locked_by。NPC/商家实例不能被这些玩家 API 消耗。
- collect 已收下的同版本调用仍成功且不额外增加版本；use 的效果写入与最终版本化消费同事务，CAS 失败回滚原效果。
- 首次无聊天记录的 mood_fix 使用 `after_msg_id = null`，保持消息外键合法，不伪造消息。
- discard 保持 `{ok:true}` 返回语义，实例改 retired_at 而非 DELETE；列表隐藏退役行，图标保留供回执与共享引用。
- 宝箱异步图片任务捕获起始 version，回包只更新同版本、未锁、未退役、仍 generating 的玩家宝箱；过期结果不广播。丢弃孤立生成图前检查是否已有实例引用。

重置顺序应在同一外层事务中取消动作、释放经济预留、`items.releaseLocks`，然后递增 epoch。外部旧回包仍必须通过当前 epoch；旧玩家背包的有效道具不会因为重建场景被删除。

## 验证边界

```powershell
cd agent-core
node --test test/townItemTemplateService.test.js test/townItemCompatibility.test.js test/townEconomyService.test.js test/townDatabaseMigration.test.js
```

覆盖本地无模型授予、实际原 mood 使用、来源去重、canonical owner、锁/CAS、买卖保留同一实例、付款后转移失败回滚、M5扣款+授予整体回滚、旧宝箱与真实效果写入兼容、软退役、图片晚回包、真实启动迁移。隔离 WAL 文件中两个 worker 同时出售/使用同一实例，只有一个结果成功。

没有实现商城 UI、报价服务、自动购买、任意新效果、成品生产规则或完整 M5 会话；测试通过不代表完整商业链和经济平衡已经验收。
