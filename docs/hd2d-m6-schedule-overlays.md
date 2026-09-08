# M6 只读日程回访 overlay

`services/characterTownAppointments.js` 提供独立查询，不合并或改写基础 schedule。`schedule_templates`、`daily_schedules`、原当前活动、睡眠和回复延迟保持各自原有语义；accepted 回访是承诺记录，不是已到场或已完成见面的证明。

## Reader contract

```js
const read = createCharacterTownAppointments({ db, registry, clock, timeZone });
const result = read(characterId, { limit: 20 });
// { worldId, worldEpoch, characterId, timeZone, appointments: [
//   { appointmentId, startAt, endAt, location, status: 'accepted',
//     availability: 'currently_free' | 'needs_reconfirmation', reason }
// ] }
```

工厂显式注入依赖，不使用 getDb singleton。limit 默认为 20，仅接受整数 1–20；无有效角色或玩家时返回同形空数组。查询使用 deferred 事务保持读取快照，不同步身份、不生成日程、不执行 expire/maintain、不推进移动或调用模型。

服务端解析当前 world/epoch、canonical 玩家和角色。记录必须匹配参与中的角色身份、characterId 和玩家归属，且 `status='accepted'`、`now < endAt <= now + 7天`；按 startAt、appointmentId 排序。旧 epoch、错误归属、已取消及已结束记录不展示。

地点必须同时匹配 id 与 key；删除或同 key 重建不能视为原地点。缺失地点仍保留记录，以 locationKey 作为名称回退，并标记 `needs_reconfirmation / LOCATION_UNAVAILABLE`。共享 `createTownAppointmentAvailability` 检查原日程；工作、睡眠、镇外或未知日程冲突同样保留记录并标记需确认。已开始的预约只检查剩余时间窗。

startAt/endAt 均为 UTC 毫秒；timeZone 默认 Asia/Shanghai，HTTP 使用 config.town.timeZone。页面已通过 Intl 按返回时区展示日期和时间，并明确标注时区。不要把它直接当成基础日程的服务器本地日期；DST 和跨午夜可用性由共享 availability 处理。`currently_free` 仅表示日程可用，不表示已经到场。

## HTTP

`GET /api/schedule/:characterId/overlays?limit=20`

- characterId 为正安全整数，limit 为 1–20 的整数字符串；非法参数返回 400、`INVALID_OVERLAY_QUERY` 和通用中文提示。
- 不接受客户端 world/epoch/actor 覆盖；scope 由服务端决定。
- `config.features.town !== true` 时仅读取 world scope，返回空 appointments；不查询预约/日程或执行维护。
- 读取失败返回 500、`OVERLAY_READ_FAILED` 和通用中文提示；具体数据库错误仅写服务端日志。
- 旧 `GET /:characterId` 未改动。其既有快照生成行为不属于本 endpoint。

ScheduleView 已通过 CharacterDetailDrawer 单列展示此 DTO，标示“已接受回访”和“需重新确认”，不把回访塞进 detailActs、基础 activities 或“瞄一眼”的当前活动判定。功能关闭返回空列表时不显示额外区块；overlay 失败不阻挡基础日程。私聊的 characterTownLifeContext 已复用同一 reader（limit:3），提示词组装仍由 life context 负责。

## 验证

```sh
node --test --test-reporter=dot agent-core/test/characterTownAppointments.test.js
```

定向 **10/10 通过**：query_only、身份/归属/epoch、limit 与七天边界、未来日程、DST、缺失/替换地点、实际路由源码 fixture、feature false/undefined，以及 SQLite 故障脱敏。HTTP fixture 执行真实路由源码与 reader，替换导入边界，不启动完整应用或监听网络端口；所有数据库均为内存库，无真实数据库或模型访问。

## 服务端过期通知

`townEconomyRuntime.maintainTownAppointments` 在 expire 实际改变 candidate 或 appointment 时，广播一次带当前 worldId/worldEpoch 的 `town_state_updated`，reason 为 `appointment_expired`。legacy 模式同样生效，不依赖全局 rules tick 广播。无变化的维护与 GET 不广播，订阅者重新读取不会形成通知循环。

正式回归 `agent-core/test/townAppointmentExpiryRuntime.test.js` **3/3 通过**：legacy 预约过期通知一次、无变化维护零通知、candidate 单独过期通知一次且重复 GET/维护不自激。它替代早期 output 诊断脚本中过期不通知的缺陷复现。

```sh
node --test --test-reporter=dot agent-core/test/townAppointmentExpiryRuntime.test.js
```

## 前端恢复边界

schedule store 为回访维护独立状态和读取序号。打开抽屉、切换角色或接到 town_state_updated 时只刷新 overlay；通知不会重新请求、ensure 或生成基础日程。关闭抽屉与角色切换会使旧 overlay 请求失效。

基础日程冲突刷新已接入 `schedule_state_change`、重置完成/取消通知，以及本页 `regenerateSchedule` 成功后的当前角色刷新。通知保留原概览读取，但不新增基础详情 GET 或自动重规划。ScheduleView 同时复用已有的可见页面 60 秒概览刷新、focus 和 visibilitychange：仅抽屉打开且 overlay 未在读取时刷新当前角色，不新增 timer，不向全部角色发请求。自然时间变化后，过期卡片可由此只读刷新移除。

**HTTP 权威刷新恢复漏通知：**之前 SSE 记录的 world/epoch 不再永久锁定后续 HTTP 结果。若断线漏掉重建通知，当前有效 HTTP 读取可接受新 epoch 或新 world，并更新已知世界；同 world 明确更低的 epoch 仍拒绝。如果请求期间收到新 SSE，读取序号已使旧请求失效。此逻辑同时支持手动重新读取恢复。

**基础 GET 竞态：**真实 onSelectChar 原先可能让 A 的晚成功覆盖后选 B 的活动，或让 A 的失败/finally 清空 B 内容、提前结束 B 的加载状态。视图回调已增加请求序号及当前角色/打开状态守卫；store 的 currentSchedule 赋值也只接受最新一次基础请求。基础 GET 的调用、返回值与抛错语义保持不变，没有用 overlay 代替基础日程。

**本页监听生命周期：**ScheduleView 已保存 `schedule_peek_ready/progress` 的 unsubscribe 并在卸载时释放；`getResetStatus` 的成功晚回在写共享 resetTask 前检查 disposed，失败晚回也在注册监听前检查。真实 ScheduleView browser 先复现正常卸载后两项监听仍各为1，再验证修复后均为0、卸载后的成功/503晚回不会补注册或恢复旧任务、重进页面仅有一对监听。仅收口本页 owned callbacks，没有改 unifiedStream 或重构 peek 管线。此次新增生命周期场景后，完整定向 browser 仍通过，基础GET为5、显式fixture重规划POST为1、自动重生成为0。

## 前端定向证据

以下三类证据分别记录，不将手写 host 的 Drawer/store 测试称为真实 ScheduleView 整页验收。

| 范围 | 测试文件 | 结果与覆盖 |
| --- | --- | --- |
| API 与选择回调 | `web-ui/test/town-schedule-api.test.mjs`、`web-ui/test/town-schedule-selection.test.mjs` | 共 **4/4 通过**。独立 GET、limit/取消信号、角色和失败响应校验、响应时区格式化；提取真实 onSelectChar 回调源码，验证旧成功/错误/finally 不覆盖新选择。回调测试先在修复前复现失败，再通过修复后的断言。 |
| 独立 Drawer/store | `web-ui/test/town-schedule-browser.mjs`、`town-schedule-fixture.html` | **通过**。真实 Drawer、Pinia store、API 聚合入口，手写 host。浏览器时区为 America/Los_Angeles，按响应 Asia/Shanghai 将01:30 UTC显示为09:30；覆盖基础活动和瞄一眼来源、overlay失败独立性、切角色、关闭重开、epoch晚包、漏通知HTTP恢复、新world与旧epoch拒绝、空列表无噪音。最后一次运行6次基础GET、16次overlay GET。 |
| 真实 ScheduleView 集成 | `web-ui/test/town-schedule-view-browser.mjs`、`town-schedule-view-fixture.html` | **通过**。实际挂载生产 ScheduleView，通过真实角色卡点击进入 onSelectChar；不替换选择回调。延迟A基础GET，点击遮罩关闭并选择B，再释放A成功/失败响应，验证B活动、标题、store当前日程与加载骨架。town_state_updated只增加overlay读取；schedule_state_change后冲突变为需确认，显式重新规划成功后恢复可安排。推进已有60秒时钟移除过期卡，focus刷新当前卡，关闭后不再读overlay；覆盖抽屉焦点、Tab/ShiftTab与Escape。最后一次运行 **5次基础GET、1次fixture显式重规划POST、0次自动重生成**。 |

两类浏览器 fixture 均拦截全部 HTTP，不调用真实业务或模型。SSE 使用 unifiedStream 实际 dispatcher 的仅 fixture 导出，没有修改生产 unifiedStream。Drawer/store 的375×667和740×360截图已人工检查，位于 `output/hd2d-schedule-overlays/`；真实 ScheduleView 集成的证据范围是上述角色选择与通知链路，不代表所有页面功能均已遍历。

在 `web-ui` 目录串行运行，PLAYWRIGHT_MODULE 指向本机 Playwright/playwright-core 模块，浏览器默认 msedge：

```powershell
node --test test/town-schedule-api.test.mjs test/town-schedule-selection.test.mjs
node test/town-schedule-browser.mjs
node test/town-schedule-view-browser.mjs
```
