# 严格有界流动性策略（backend独立、默认关闭）

文件：`src/services/town/townLiquidityPolicy.js`、`src/db/townLiquidityPolicySchema.js`、`test/townLiquidityPolicy.test.js`，路径相对agent-core。经济内核新增受信 `issueLiquidity`，未修改runtime、routes、config、UI或db/index，未自动启用、未实现回收。

## 固定规则与边界

准备金60、目标90、单次最多30；滚动24小时30、滚动7天210、world累计毛发行600、流通货币4000，发行间隔至少24小时。流通量包含玩家、商家、基金及托管余额，排除issuance对手账户。所有政策历史按world保留，换epoch、重新迁移、关闭再开启均不恢复额度。seed不是补贴接口，没有改seedVersion或既有配方。

启用时可用基金>=90，正常发布并预留30；60..89先在同外层事务真实发布、预留钱30/货1，再发行差额补到“发布前90”，最终可用额60。顺序这样安排是为了让发行内核验证真实open订单、持久发布日志、完整两项预留，而不是信任“稍后会发布”的回调。缺货、位置失效、旧scope、CAS冲突、额度不足、发布/收据任一步失败，都回滚订单、发行、proof、事件和状态。

基金可用额低于60不能启用：返回 `LIQUIDITY_ACTIVATION_RESERVE_REQUIRED`，带 `available`、`minimumAvailable:60`。已处于启用记录但被其他支出降到60以下则为 `LIQUIDITY_RESERVE_REQUIRED`。默认关闭仍沿原订单发布逻辑，例如基金30可发布且不发行。成功启用且所有新配送都走本桥接时，新承诺不会把可用准备金降到60以下；原有在途工资/其他基金支出仍可能突破这一前提，不能忽略。

## Main桥接API

```js
const policy = createTownLiquidityPolicy({
  db, clock, registry, economy, position,
  enabled: false, // 可信服务端配置；绝不直接读取HTTP请求的enabled
  consumers: ['town.experience'],
});

// 启用设置前只读预检；检查通过后才保存配置/展示成功。
const activation = policy.checkActivation({worldId, worldEpoch});
// {allowed, reason, available, minimumAvailable:60, fundVersion, policyVersion}

const status = policy.getStatus({worldId, worldEpoch});
// {enabled,limits,grossIssued,remainingWorldBudget,issued24h,issued7d,
//  availableFund,activationAllowed,lastObservedAt}

const result = policy.publish({
  worldId, worldEpoch, actorId: authenticatedPlayerActorId,
  idempotencyKey,
  expectedFundVersion: activation.fundVersion, // 可选乐观锁
  expectedPolicyVersion: activation.policyVersion, // 可选；尚无记录为0
});
// {order, eventId, liquidity:{enabled,issued,receipt,policyVersion}}
```

只在真正玩家发布请求处调用，不能在tick、浏览页面或LLM/event文本中调用。`checkActivation`只证明最低准备金，不是预留或对下一笔发行成功的承诺；冷却、限额、时钟与资金仍在publish事务中重新检查。配置保存由main负责，并应在同DB锁内重检避免预检后竞态；策略模块本身不保存外部配置。`getState(scope)`返回政策观察状态或null，表中enabled是最近成功发布使用的策略开关记录，不替代配置来源。

`getStatus`纯只读、不创建state。enabled来自当前实例的可信开关；未配置当前epoch业务时availableFund为null、activationAllowed为false，但保留world累计额度。activationAllowed仅表示基金最低准备金达标，不保证下一次申请通过冷却/总cap。用量SQL与限额常量直接由受信发行校验复用，回拨时未来记录仍计入窗口以免释放额度。24h/7d边界采用 `(now-window, now]`，回拨产生的未来已记录发行亦保守计入。

默认closed路径不检查政策回拨暂停、不增发；仍有本桥接请求去重。相同请求返回原收据；更改payload同key冲突。需让所有启用后的新配送发布走同一桥接，不能保留另一个绕过准备金的入口。迁移应在订单/economy schema之后执行，仅main接db/index。API层将late activation错误翻译为“公共基金可用余额至少需要60，当前为X”，不可静默显示开启成功。

`economy.issueLiquidity({worldId,worldEpoch,authorizationId,idempotencyKey,sourceKey,reasonCode})`不是HTTP接口。它只读同DB不可变授权proof，核对player身份、当前epoch、状态/版本/时间、实际订单及两预留、基金账户类型与版本，并独立重查所有caps。目标账户与amount不由调用参数决定。来源固定为authorizationId；同来源重放没有新增发行，授权order唯一；分录issuance负数、fund正数，事件/outbox与订单同事务。提交后广播由main沿现有机制执行，模块内不广播。

## 时间策略

持久记录最后成功操作的观察时间。启用模式回拨到该高水位之前时暂停新publish，返回 `LIQUIDITY_CLOCK_ROLLBACK`；取消/退款仍走原业务API。交易失败时连观察状态也回滚，不额外写一次时钟状态。成功重放原请求只返回收据，不产生时间推进或额度。

正常离线造成的前跳不拒绝：本地wall clock没有可靠证据区分“离线90天”和“手动调快90天”，设置任意前跳阈值会误杀正常离线。采用经过24小时而非日历换日、无补发积累；不论跳过多少天，本次最多30，仍受毛600和流通4000硬限额。回拨到跳时之前会被高水位暂停。反复人为前跳仍可能加速耗尽有限600，这是单机wall-clock的明确限制；本轮不引入联网可信时间或扩大cap，不宣称防篡改时间。

## 低于30基金的未来恢复（未实施）

当前无法恢复低于60的基金，与计划“低于底线补助”仅部分一致，本轮实现采用严格真实订单证明。尤其<30时无法先形成资金已预留的订单，不能为迎合现有proof先伪造open订单或直接mint再期待交付。

未来可另行设计有界紧急预算协议：验证真实玩家请求、地点与实际货物库存，先创建不对玩家承诺工资的 `budget_pending` 请求并锁货；同事务获得唯一、受gross/rolling/circulation约束的紧急预算授权，限定只给基金，再完成真实订单和工资预留，最后提交。任一步失败回滚，不留下“先发行但无订单”。该授权是新证据类型，需要订单状态机/schema/内核联合设计和并发故障测试，不能复用本轮authorization或对普通mint放开amount。若仍要求准备金60，<30恢复至少需要超过本轮max30的另一个明确上限；必须先由main决定政策，而不是暗改常量。也可通过已有真实经营收入自然恢复，无自动补发。

## 验证

`node --test test/townLiquidityPolicy.test.js`：默认关闭、严格启用门槛、真实预留、请求冲突/CAS、缺货/缺位置/晚收据故障回滚、回拨暂停与24h精确边界、90天离线只一笔、累计600/跨epoch冷却、circulation4000、受信proof/篡改预留拒绝；另用隔离临时SQLite WAL文件两worker争最后日额度并重放同请求。测试初始极低基金通过真实账本转账构造边界；这不是经济消费模拟或真实存档。无模型调用。

策略只提供有界缓冲。现有真实生产路径基金仍净-10/轮、资源总200，不称经济平衡。没有回收命令，未来burn也不得返还毛发行600额度。

### 实际runtime桥接验证

`node --test test/townLiquidityRuntime.test.js`：完整内存DB迁移、实际updateTownSettings和executeTownOrder，共4子场景加父test，5/5通过。最低准备金不足时整个设置patch的内存与持久记录均不改变；开启本身0发行；active订单挡新key而不挡原key重放；冷却失败没有残留pending订单/收据/预留，24h后同key成功；disabled发布0发行；legacy原始request key在订单active和expired后均返回同一旧收据。预算边界只通过真实经济转账构造，没有插入proof。

main随后将activation校验与generation/settings写入收口到同一db.immediate，提交后才更新config。独立测试新增第二settings写失败trigger：先确认generation新值已在事务中写入，再抛错，验证generation和其他patch内存/DB全部恢复，且activation读取基金时db.inTransaction为true。另验证独立updateTownGenerationSettings持久失败不改config或DB。现为6子场景加父test，7/7通过；原设置吞错/预检事务分离风险已在该路径修复。
