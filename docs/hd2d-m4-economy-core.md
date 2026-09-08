# M4 钱包账本与物料内核

本次只新增 schema、服务与测试，不修改生产 `db/index.js`、`townService.js` 或 routes。没有新增商品模板、物品实例、工资判定、价格、任务或生产配方。所有 API 是**可信服务端命令**，调用者必须验证身份、真实交付/工时、金额与奖励权限，不能直接透传客户端数据。

## 初始化

```js
migrateTownActionSchema(db); // 事务事件/outbox 表
migrateTownEconomySchema(db);
const registry = createTownActorRegistry(db);
const economy = createEconomyService({
  db, clock,
  getWorldEpoch: registry.getWorldEpoch,
  getActor: registry.getActor,
  consumers: [],
});
```

显式 better-sqlite3 连接，应开启 `foreign_keys`；多连接使用 WAL 与合理 busy_timeout。模块不打开文件，不创建定时器。所有写事务使用 `BEGIN IMMEDIATE`，嵌套时使用 savepoint。schema 有版本记录，发现已有草稿缺少必要列时抛错，不能静默跳过。

## API

所有命令携带 `worldId, worldEpoch`；先检查当前 epoch，旧请求不能写入。钱包与物料归属按稳定 world/owner 存储，地图重建不清余额、不重发初始资金。

```js
const wallet = economy.ensureAccount({
  worldId, worldEpoch, ownerKey: `actor:${actorId}`, actorId, accountType: 'actor',
});
// 其他 accountType: business / fund / escrow；业务账户 ownerKey 由服务端稳定生成。
const receipt = economy.transfer({
  worldId, worldEpoch,
  fromAccountId, toAccountId, amount: 30,
  expectedVersion: payer.version, // 可选的显式 CAS；不传仍有数据库锁和条件版本更新
  idempotencyKey: 'request:delivery-1',
  sourceKey: 'delivery:order-1:payment',
  reasonCode: 'DELIVERY_PAYMENT',
  sourceEventId: 'source-event-id', // 可选审计引用；不是凭该字符串自动发奖
});
```

公共经济命令字段：`worldId,worldEpoch,idempotencyKey,sourceKey,reasonCode,sourceEventId?`。seed 的 sourceKey 由内核生成，不接受调用者覆盖。返回 receipt：`{transactionId,eventId,accounts:[],stocks:[],reservation?}`。账户快照含 `balance,reserved,available,version`；物料快照含 `quantity,reserved,available,version`。

| 方法 | 额外参数 / 返回 |
| --- | --- |
| `ensureAccount` | `{ownerKey,accountType,actorId?}` → 零余额账户或原账户；owner/type/actor 冲突拒绝；actor 钱包 ownerKey 必须是 `actor:canonicalActorId` |
| `getAccount` | `{accountId}` → 账户快照 |
| `seed` | `{accountId,amount,seedVersion=1}` → 初始资金收据；amount 可为0，系统对手分录同步记录 |
| `transfer` | `{fromAccountId,toAccountId,amount,expectedVersion?,expectedToVersion?}` → 收据 |
| `reserve` | `{accountId,amount,ownerRef,expectedVersion?}` → 含 reservation 的收据 |
| `capture` | `{reservationId,toAccountId,amount?,expectedVersion}` → 部分/全部预留转账；不传 amount 扣完剩余 |
| `release` | `{reservationId,amount?,expectedVersion}` → 部分/全部预留释放 |
| `ensureStock` | `{ownerKey,resourceKey}` → 零数量物料或原物料 |
| `getStock` | `{stockId}` → 物料快照 |
| `seedStock` | `{stockId,amount,seedVersion=1}` → 有来源的初始数量收据 |
| `transferStock` | `{fromStockId,toStockId,amount,expectedVersion?,expectedToVersion?}` → 相同 resourceKey 的数量转移 |
| `reserveStock` | `{stockId,amount,ownerRef,expectedVersion?}` → 物料预留 |
| `captureStock` | `{reservationId,toStockId,amount?,expectedVersion}` → 预留物料交付；或用 `consume:true` 替换 toStockId 显式消耗 |
| `releaseStock` | `{reservationId,amount?,expectedVersion}` → 释放物料预留 |
| `getReservation` | `{reservationId}` → reservation 或 null |
| `getReceipt` | `{transactionId}` → 当前 world 的历史收据或 null |
| `releaseActive` | 公共命令字段 → `{transactionId,eventId,count,releases,accounts:[],stocks:[]}`，释放当前 epoch 全部未结束的钱/物料预留 |

reservation 含 `reservationId,assetType,assetId,ownerRef,worldEpoch,amount,captured,released,remaining,version`。`ownerRef` 必须是稳定 order/action/session/batch 引用；同 asset/ownerRef 不可二次预留，即使原预留已全部释放。重新接受需使用新的正式版本/批次引用。capture/release 必须传当前 reservation version；remaining 为0时不可再扣取。

物料只是数量账，不是背包 ITEM_EFFECTS 道具。`consume:true` 只允许受验证的生产服务调用；内核记录消耗，不自动创建成品。未来生产/订单可在同一外层事务中组合钱与材料操作，任一步失败均回滚。

## 不变量与幂等

- 所有钱/数量为 JS 安全整数；用 BigInt 中间计算防止加法溢出。每笔同币种货币分录合计为0，数据库也检查平衡。唯一货币 LIN。
- 普通账户 `0 ≤ reserved ≤ balance`；物料 `0 ≤ reserved ≤ quantity`。系统发行对手只可承担非正余额，普通 transfer 不得使用它。
- reserve 只增加 reserved；capture 同时减少 balance 与对应 reserved，再贷记对手。可用余额不会重复扣除。
- 请求哈希用规范 JSON + SHA-256。相同 key 不同内容为 `IDEMPOTENCY_CONFLICT`；不同 key 相同 sourceKey 相同经济内容返回旧收据，不同内容为 `SOURCE_CONFLICT`。每个别名请求也记入唯一请求表。
- request 哈希排除 worldEpoch（但每次先校验 epoch）；source 哈希额外排除请求 key 与期望版本，使合法重试不重复经济效果。
- seed source 为固定账户/物料 ID + seedVersion，跨 epoch 去重。**seedVersion 必须是代码中批准的迁移版本，不能让客户端递增它领取新资金。** 普通公共补助额度政策尚未实现，不可拿 seed 当无限补助接口。
- 交易、钱分录、物料分录提交后禁止 UPDATE/DELETE；交易封存后不能追加分录。事务、分录、预留、回执和 domain event/outbox 一起提交。

## 提交后通知与重置

```js
const receipt = db.transaction(() => {
  const payment = economy.capture(paymentCommand);
  economy.captureStock(materialCommand);
  return payment;
})();
economy.flushNotifications(receipt, event => broadcast(event));
```

`flushNotifications` 在 `db.inTransaction` 时抛 `COMMIT_REQUIRED`，不存在已提交交易时抛 `TRANSACTION_NOT_COMMITTED`；不自动调用。它可重复调用，UI 应按 eventId 去重。广播失败不会回滚已完成的钱物，可靠业务消费使用持久 outbox；不宣称外部网络 exactly-once。

重置应在**同一外层事务**中先 `runner.cancelActive`、`economy.releaseActive`，再 `registry.advanceEpoch`。失败时所有预留释放与事件一起回滚。旧 epoch 尚有预留时直接 advanceEpoch 会被后续捕获/释放拒绝，因此不能跳过清理；独立 escrow 已转入的余额仍需服务会话自身退款规则，本内核不会自动把 escrow 余额退回未知来源。

## 已验证范围

### 受信生产入库

`produceStock({worldId,worldEpoch,stockId,amount:1,productionId,idempotencyKey,sourceKey,reasonCode})`
返回标准 `{transactionId,eventId,stocks,productionId,...}` 收据。仅允许 `townProductionService.complete` 的外层同DB同步事务调用，不是通用库存增发或客户端接口，不复用初始seed。

校验当前epoch reserved批次、批准原料配方与供应商库存、完整30预算预留、供应商/工坊两份已完成5分钟动作及权威日志。调用顺序必须是插入两份proof→节点remaining/reserved各减1→produceStock→付款→标记completed；节点容量减余量必须等于已入库生产笔数+1，reserved必须等于保留批次数-1，因此不可先批量扣多个节点再逐笔入库。任一步失败由外层事务恢复全部状态。

来源固定为 `production:stock:<productionId>`，调用方换request/source不新建输出，payload冲突拒绝；新epoch不能重新使用旧批次。物料分录与事件写在同事务内，广播继续使用提交后的显式机制。真实90天业务结果见 `hd2d-m4-business-consumption-audit.md`，不能与下方旧数学转账测试混为经济平衡验收。

```powershell
cd agent-core
node --test test/townEconomyService.test.js
```

内存 SQLite 测试覆盖重复 migration、seed/请求/source 冲突、整数溢出、CAS、预留部分扣取释放、物料交付/消耗、故障回滚、外层钱物事务、提交后广播、重置清理与账本不可变。

并发测试使用隔离临时 SQLite **同一 WAL 文件**及独立 worker 连接，以共享原子门同时放行：争最后余额恰有一个成功；相同请求只产生同一笔交易；争最后物料只有一个成功。测试结束关闭连接并删除自己的临时目录，不操作真实存档。

90天固定9笔/日，共810笔普通转账，每笔再重放一次；初始流通3400每天守恒，最终回到初值，并逐账户/物料对账分录。这只验证预设封闭路径与账本，不是完整经济平衡验收：囤币、断货、离线、需求、贫困任务可达性、NPC生产/工资尚未建模，也未验证真实玩家交付链。
