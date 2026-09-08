# M6 信箱正式配送任务卡契约

前端集成补充：真实 `MailboxView` 展示独立任务摘要，点击 `/town?panel=life` 由当前快照打开生活面板。`town-mailbox-browser.mjs` 验证375/1100宽度、零写请求、空页带游标、同世界追加、跨world/epoch替换、关闭后的晚回包（即使transport忽略abort）不复活。截图与结果在 `output/hd2d-town-mailbox`；没有把卡片写入信件表或改变信件未读状态。

本切片将已存在的正式配送任务投影为信箱可读取的任务卡。读取不创建订单、不接受任务、不发信、不调用模型，也不推进维护任务。它推进计划 A 链的信箱入口，但不代表雨天天气、咖啡供需、配送、服务及社交表达的 A 链已经完整闭环。

## 服务与返回字段

实现：`agent-core/src/services/town/townMailboxTasks.js`。

```js
const tasks = createTownMailboxTasks({
  db,                       // 显式 SQLite 连接，不打开真实存档
  clock: { now },            // 同步返回 UTC 毫秒
  registry,                 // getWorldEpoch/getActor/resolveAgentKey
  enabled: true,            // 严格布尔；是否允许列出 open 任务
});

const page = tasks.list({
  worldId,
  worldEpoch,
  cursor: null,             // 或 { createdAt: number, orderId: string }
  limit: 20,                // 服务默认 20，范围 1..100
});
```

返回结构如下。这是服务 DTO 示例，不是模型输出协议。

```json
{
  "worldId": "current-world-id",
  "worldEpoch": 1,
  "items": [
    {
      "orderId": "existing-order-id",
      "version": 1,
      "status": "open",
      "expiresAt": 1788829200000,
      "reward": 30,
      "locations": {
        "board": { "key": "board", "name": "公告板" },
        "supplier": { "key": "source", "name": "原料站" },
        "workshop": { "key": "workshop", "name": "工坊" }
      }
    }
  ],
  "nextCursor": null
}
```

卡片只包含上述展示字段，不暴露事件信封、人设、完整订单 config、账户 ID、库存 ID 或预留记录。玩家身份由服务器调用 `registry.resolveAgentKey('me')` 解析；客户端传入的玩家 ID 不参与读取授权。

## 来源与有效性

只读取当前 world/epoch 中未到期的 `open`、`accepted`、`picked_up` 订单。开放订单必须未分配，已接受/领取的订单必须属于当前玩家。终态、已过期或证据不一致的记录不展示。

逐卡核验：

- 对应 `delivery:<orderId>:<version>` 的 canonical `town.delivery.changed` 事件；事件身份、scope、状态、版本、时间和参与者与订单一致，且不是 `presentationOnly`。
- 同一事件的不可变 `town_business_log`，包括阶段、玩家、发生时间及完整订单快照。当前订单配置还必须与当前业务 slice 一致。
- 三个正式角色的原始身份字段必须有效且互不重复，并与 canonical 事件参与者及日志快照一致。只有 `open` 额外要求三个 NPC 当前参与小镇、未归档或合并且实际来源仍存在；`accepted/picked_up` 不因委托人、供应方或工坊 NPC 退出而隐藏，符合现有 pickup/complete 命令不依赖这些 NPC 继续入住的条件。
- 公告板、原料站、工坊 key 存在且对应唯一地点。本次仅修复无关角色退出导致的漏卡，地点校验及 DTO 未调整。
- 报酬使用已核验的订单配置；事件里的普通描述不能改变奖励。
- 资金预留属于本订单、当前 scope 和公共基金，金额、未释放余额及账户预留有效。
- 未领取阶段核验供应方材料预留；已领取阶段核验原预留已捕获，以及玩家本订单货物的库存、资源类型和托管预留。

订单历史保存的是稳定地点 key，不包含地点实例 ID。本读取模块据现有契约核验 key 与当前地点，不声称能识别同 key 被删除后人工重建的所有情况。

## 零写入与开关

factory/list 不建表，不迁移，不 synchronize，不广播，不调用经济命令、网络、模型或信件生成器。过期只在查询中隐藏，不释放预留、不改订单状态；生命周期维护仍由原业务负责。

`enabled=false` 在查询阶段过滤 `open`，所以隐藏项不会占用输出页；`accepted/picked_up` 仍可追踪。runtime 以 `economyEnabled === true` 传入此参数。小镇功能关闭时，runtime 返回空列表，不调用维护逻辑。

## 分页与读取预算

按 `(created_at, order_id)` 升序读取。游标是 `{createdAt, orderId}` 对象。

- `limit` 限制返回卡片数，最大 100。
- `TOWN_MAILBOX_SCAN_LIMIT = 500` 限制每次检查的候选订单行数；它不是所有 SQL 查询数量的上限。
- 无效证据会被跳过；达到扫描预算时，返回最后已扫描位置作为 `nextCursor`。
- 即使 `items` 为空或少于 `limit`，也可能仍有下一页。客户端只能用 `nextCursor === null` 判断结束。
- 满批边界可能需要额外读取一个空页才能确认结束；不会丢失未返回的合法卡片。

HTTP 入口为 `GET /api/town/mailbox-tasks?cursor&limit`。`cursor` 使用 URL 编码的 JSON 字符串，route 解析为对象后传入服务；响应保持对象形式。当前 runtime/route 默认 limit 为 10。

## 显式导航边界

主线 UI 的约定是点击卡片仅导航到 `/town?panel=life`，打开重新读取状态的生活面板；分页由 `nextCursor` 按钮继续读取。导航不发送接受、领取或交付命令。

后续接受仍走既有正式命令及服务器到达验证。`townOrderService.accept` 当前要求玩家到达公告板；本切片不提供信箱远程接单，不改变 CAS、幂等或领取/交付条件，也不通过伪造 `user_to_char` 信件触发自动回信。

上述为接入约定及主线提供的 UI 状态说明，不属于本文已完成的浏览器验收证据。

## 已验证证据

定向命令（工作目录 `agent-core`）：

```text
node --test test/townMailboxTasks.test.js test/townMailboxTasksHttp.test.js
```

历史 checkpoint 结果：**33 tests / 33 pass / 0 fail**，含子测试，由当时 core 30 项与 HTTP 3 项组成。

角色退出漏卡修复后的定向回归仅运行 core：

```text
node --test --test-reporter=spec test/townMailboxTasks.test.js
```

结果：**37 tests / 37 pass / 0 fail**，含子测试。原 core 30 项加一个测试父项及六个子场景：委托人、供应方、工坊分别在真实 accept 或 pickup 后停用，调用 registry.synchronize 后，`query_only` 读取仍返回任务卡且全表快照不变；继续真实 pickup/complete 获得 30，同 key 重放不产生任何数据库变化，新 key 再次交付被拒绝，余额只增加一次。原 open 缺失/归档 NPC 过滤回归仍通过。原始身份、事件、日志、资金与物料预留核验均保留。

本次没有重跑 HTTP 3 项、浏览器或 backend 全量；历史 HTTP 结果不计入本次 37 项。

相关文件：

- `agent-core/test/townMailboxTasks.test.js`
- `agent-core/test/townMailboxTasksHttp.test.js`
- `agent-core/test/fixtures/townMailboxTasksFixture.js`
- HTTP 监听复用 `agent-core/test/fixtures/localHttpServer.js`，随机选择 fetch 允许的 localhost 端口。

证据覆盖真实内存 SQLite 的 setup/publish/accept/pickup 数据、canonical 来源与日志核验、预留失效、角色/地点丢失、旧 scope、奖励不采信事件描述、到达条件不绕过、功能开关、HTTP cursor JSON 往返和无效参数。服务及真实 runtime/route fixture 在 `PRAGMA query_only=ON` 下成功读取，并比较全表快照确认零变化。

预算回归前置 505 条无效记录：第一页为空且返回第 500 条已扫描位置，第二页仍可取得后方合法任务。未使用真实存档、真实模型或外部网络；HTTP 仅 localhost，生产模块通过 import 边界隔离加载。

真实 Mailbox + TownView 浏览器验收已完成，结果见本文开头与 `output/hd2d-town-mailbox/result.json`。本切片不声称完成 A 链或整个 M6。
