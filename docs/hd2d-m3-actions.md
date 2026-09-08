# M3 持久动作与事件基础

独立模块，不导入生产数据库、不创建定时器、不调用 LLM。初始化由集成层显式调用 `migrateTownActionSchema(db)`，world/actor 使用 `townActorRegistry`，不由动作 schema 创建。

## 接入 API

```js
const registry = createTownActorRegistry(db);
const runner = createTownActionRunner({
  db, clock,
  getWorldEpoch: registry.getWorldEpoch,
  getActor: registry.getActor,
  readFacts: action => ({
    worldEpoch: registry.getWorldEpoch(action.worldId),
    actorId: action.actorId,
    allowsAction: true, // 真实日程/维护状态检查结果
    targetExists: true, // 真实目标查询结果
    arrived: false, // 必须来自服务端已推进的位置，不能来自客户端声称或 dueAt
    locationKey: null,
    // failureReason: 'PATH_UNREACHABLE'
  }),
  leaseMs: 180000, // 默认三分钟；驱动器须在租约到期前续租
  consumers: [], // 所有 action.changed 事件投递到这些消费者
});
```

以上 `readFacts` 仅展示字段契约；生产必须接入真实查询。所有注入回调同步执行，不能访问网络或启动外部副作用。

- `validate(input)`：只读校验，返回规范化输入。要求 canonical、participating 且未 archived 的 actor；旧合并 ID 拒绝。
- `create({worldId,worldEpoch,actorId,type,target?,payload,idempotencyKey,ruleKey?,ruleVersion?})`：持久化 `validated` 动作，返回 `{id,worldId,worldEpoch,actorId,type,phase,version,target,payload,startedAt,dueAt,updatedAt,failureReason,result,...}`。
- `reserve/start/advance/cancel/fail/recover({worldId,worldEpoch,actionId,expectedVersion,idempotencyKey,reasonCode?})`：返回动作快照；cancel/fail 必填 reasonCode。
- `cancelActive({worldId,worldEpoch,idempotencyKey,reasonCode})`：取消该 epoch 的 validated/reserved/running，返回 `{count,actions}`。重置调用方在同一外层 `db.transaction` 中先取消，再 `registry.advanceEpoch`；重置失败则全部回滚。
- `get(id)`：内部读取，不做 world scope 检查；HTTP 适配层必须验证 world/epoch/访问权限。
- `activities({worldId,worldEpoch,actorId,cursor=0,limit=10})`：按 seq 升序分页，返回数据库字段命名的日志行，`result` 是 JSON 文本。游标为上批末尾 seq。

payload 只允许 `durationMs`（wait/rest/work_shift 必填，1–21600000 毫秒）、`resources`（最多32个排他资源 key）。move_to/work_shift 必填字符串 target。工位自动使用 `station:target`；共享资源使用 `resource:key`；每个动作自动独占 `actor:actorId`。按排序顺序获取，任一争抢失败整笔回滚。

状态：validated → reserved → running → completed；所有非终态允许 cancel/fail。start 会核对租约与日程，目标型定时动作须已到达。move_to 的 dueAt 为 null；bridge 启动真实寻路并推进权威位置，runner 只在 arrived 且 locationKey 匹配时完成。无法寻路通过 failureReason 或 fail 显式结束；重试与退避候选由 bridge 决策。

重复的幂等请求返回原回执，同 key 不同命令/参数/expectedVersion 返回 `IDEMPOTENCY_CONFLICT`。新 key 的旧版本返回 `VERSION_CONFLICT`。每次状态变化和恢复记录都会增长 version；纯 lease 续租不写活动日志、不增长版本。调用者每次 tick 使用新的稳定请求 key，不能复用旧 key 期待再次推进。

恢复有效租约内的动作；过期租约 recover 为 `failed/LEASE_EXPIRED` 并释放本动作资源。默认不补记无人监管的离线工时。终态不可重开。旧 epoch 的写操作一律拒绝，历史行保留审计。

`work_shift` 完成只表示在岗时间，结果含 `attendanceMs`、`economicEffects:'none'`、`settlement:'not_implemented'`。生产、工资、购买、交货仍不支持；不能据 action.completed 自动发钱发物。rest 当前只有持续时间事实，不维护另一套疲劳数值。

## 事件与 outbox

`createTownEventService({db,clock,getWorldEpoch,validators,maxAttempts=5,leaseMs=30000,retryMs=1000})`。validators 按完整事件 type 注册同步 payload 校验器，必须返回 true；未知 type 拒绝。

- `append(envelope,consumerKeys=[])`：事件信封与唯一 event/consumer 投递行原子提交；同 eventId 不同内容冲突。省略 occurredAt 时首次写入使用 clock，再次提交沿用原时刻。
- `get(eventId)`、`list({worldId,worldEpoch,cursor=0,limit=100})`：持久事实读取，list 返回含 seq 的信封。
- `claim({consumerKey,worldId,worldEpoch})`：返回 `{event,consumerKey,token,attempts,leaseUntil}` 或 null；过期处理租约可抢回，每次 claim 都消耗一次尝试。
- `consume(claim, (event, db) => synchronousEffect)`：同数据库业务效果与 done 标记同事务提交；失败回滚，调用者可 retry。`ack(claim)` 仅确认。
- `retry(claim,reason)`：指数退避，上限一小时；尝试耗尽转 dead。崩溃导致租约到期同样计入有限次数；旧 lease token 不能确认新 claim。
- `requeue({worldId,worldEpoch,eventId,consumerKey})`：显式人工重投 dead-letter，保留 eventId，将本轮尝试数归零。

因果限制：root 最多两层衍生，每层最多三条；校验父事件的世界、epoch、root 和 depth。presentationOnly 事件不能继续衍生业务事件。当前 visibility 允许 participants/private/public，载荷总量限32KiB。

外部生成/发送服务仍需 sourceEventId 持久 job 与幂等结果 adapter；consume 仅保证同一 SQLite 内的事务效果，不能保证网络 exactly-once。尚未绑定 SSE 或现有朋友圈/信件，事件写入失败会回滚动作、资源、日志和回执。

## 验证

```powershell
cd agent-core
node --test test/townActionRunner.test.js test/townEventService.test.js
```

全部使用 `:memory:` SQLite，包含实际 registry 的独立最小源表 fixture。覆盖生命周期、到达事实、工作无结算、资源争抢与部分预留回滚、CAS/幂等冲突、日志去重、重启/epoch、取消重置原子回滚、outbox租约抢回/有限重试、消费者事务回滚与传播限制。尚未声称跨进程并发或真实存档验收通过。
