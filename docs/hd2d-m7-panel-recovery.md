# M7 面板恢复与晚响应边界

本轮针对 Life、Workshop、Appointment、Delivery Diagnostics 的晚响应、关闭重开、世界变化和幂等请求保存进行了隔离复现与修复。Activity 同步经过只读审查，未发现新的可复现问题。

所有网络验证使用真实 Vue 组件、真实 `api/index.js` 聚合导出和 Edge 浏览器，但 HTTP 全部由 fixture 拦截。不调用真实业务、模型或配置写入接口。本轮没有修改 TownView、api/index.js 或 unifiedStream。

## 1. Life：重开读取失败后仍可重试旧世界请求

**复现：**在 epoch 1 发起操作并丢失响应，关闭面板；服务端变为 epoch 2，重开时 GET 失败。旧实现保留了缓存 economy，重试按钮仍可点击，发送 epoch 1 的原请求。服务端会拒绝旧 epoch；此复现不表示交易被重复执行。

**修复：**重试按钮和 `run()` 都要求状态已成功重新读取。执行守卫同时检查面板打开状态、幂等键、worldId 和 worldEpoch。独立生命周期令牌隔离关闭重开前的读写回调，读取序号只负责读取请求间的先后顺序。

**长期回归：**`web-ui/test/town-life-browser.mjs` 调用 `town-request-boundaries.mjs` 的 `checkLifeBoundary`。断言失败重开后按钮禁用，程序化触发禁用按钮也不新增 POST；恢复 GET 后清除旧世界请求，不自动提交。

## 2. Appointment / Diagnostics：存储写入失败覆盖内存幂等请求

**复现：**模拟 sessionStorage 配额不足：setItem 抛错，但 getItem 仍正常返回 null 或旧记录。原保存函数保留了内存副本，随后加载函数却用存储值覆盖它，导致当前请求的幂等键丢失。此问题发生于同一页面生命周期内的恢复，不承诺存储完全不可写时跨页面刷新仍能持久保存。

**修复：**两个 API 模块分别记录 `storageWriteFailed`。写入或删除失败时，以内存中的最新值为准；其中 null 也是有效的清除结果，不能从旧存储复活请求。下一次成功保存或删除后解除回退，恢复读取存储的实际值，包括 null。

**长期回归：**

- `web-ui/test/town-appointments-api.test.mjs`
- `web-ui/test/town-deliveries-api.test.mjs`
- 两者复用 `town-pending-storage-check.mjs`，验证首次写失败、旧存储覆盖风险、删除失败不复活、成功清除和恢复正常 null 读取。

现有浏览器测试继续覆盖响应丢失后的页面刷新与原请求重试，验证存储正常时请求体和幂等键保持一致。

## 3. Workshop：A 的晚响应覆盖新选中的 B 会话

**复现范围：组件接口场景。**保持同一 TownWorkshopService 实例，在 A 的 POST 尚未返回时将 `sessionId` prop 改为 B。B 收据读取完成后，A 的响应仍可能替换当前会话，并让后续 GET 重新读取 A。

**主入口通常卸载并重建工坊组件，不应将该接口复现描述为已确认的日常用户点击路径。**修复保障的是组件允许的 props 切换及未来复用边界。

**修复：**worldId、worldEpoch、sessionId 变化会更新独立生命周期令牌。旧 POST 不再修改新生命周期的会话、错误、发送状态或触发补读。读取优先采用显式 sessionId；返回 DTO 还须匹配显式选中的会话。已确认请求仅按原幂等键清理持久状态，后续有效读取同步待确认请求。

**长期回归：**`web-ui/test/town-workshop-browser.mjs` 调用 `checkWorkshopBoundary`。延迟 A 的 POST，切换至 B 并读取收据，再释放 A 响应；断言所选会话仍为 B，最后一次会话 GET 仍为 B，B 收据保留且没有出现 A 的继续操作。

## 4. Appointment / Diagnostics：旧补读结束后恢复旧错误

**复现：**POST 被拒绝后自动补读，延迟该 GET；用户关闭重开，新的 GET 成功且错误已清空。释放旧 GET 后，原 `finally` 在 await 后没有再次校验，重新写入了旧错误。

**修复：**生命周期令牌与读取序号分离。读取校验两者，POST 校验生命周期；补读 await 返回后再次核验生命周期，才能恢复错误。不能使用被读取函数自增的同一个序号作为 POST 生命周期，否则正常 finally 也可能失配。

**长期回归：**`town-appointments-browser.mjs` 和 `town-deliveries-browser.mjs` 分别调用 `checkLateErrorBoundary`。断言新面板读取成功后，旧 GET 返回不会重新显示 alert，并且当前原请求重试按钮仍可正常使用。

## 验证结果与运行方式

修复后定向、串行执行结果：

| 测试 | 结果 |
| --- | --- |
| appointments + deliveries API | 8 项通过 |
| town-life-browser | 通过，包含新增恢复边界 |
| town-workshop-browser | 通过，包含 A→B 接口场景 |
| town-appointments-browser | 通过，包含旧错误隔离 |
| town-deliveries-browser | 通过，包含旧错误隔离 |

在 `web-ui` 下运行；`PLAYWRIGHT_MODULE` 指向本机可用的 Playwright / playwright-core 模块，浏览器默认使用 msedge：

```powershell
node --test test/town-appointments-api.test.mjs test/town-deliveries-api.test.mjs
node test/town-life-browser.mjs
node test/town-workshop-browser.mjs
node test/town-appointments-browser.mjs
node test/town-deliveries-browser.mjs
```

修复前的隔离审查记录位于 `output/town-boundary-audit/`。该目录是历史复现证据，其脚本断言的是旧缺陷，不能作为修复后的验收命令；修复验收以以上长期回归为准。

## 后续键盘与截止时区回归

ScheduleView 的本页监听卸载边界也已完成最小修复与真实组件回归：两项 peek 订阅卸载归零，慢 resetStatus 成功/失败晚回不再注册监听，成功晚回不写共享任务，重进后只有一对订阅。修复前真实 browser 已复现监听残留，修复后同一现有测试通过；详细范围与计数见 `hd2d-m6-schedule-overlays.md`。此项没有更改 peek 业务管线。

Life、Appointment、Workshop 的异步阶段切换会移除原聚焦控件，曾使焦点落回 body。三个组件已在相关状态更新后检查这一情况，将焦点恢复到当前仍打开的面板/对话舞台；关闭或卸载后不抢焦点。对应现有 browser 回归已验证操作切换后的焦点仍位于面板内，没有修改共享 TownDialogueStage。

TownLife 的订单截止时间已固定使用 `Asia/Shanghai`，保留短月日、时分布局并明确标注“北京时间”。`town-life-browser.mjs` 使用 America/Los_Angeles 浏览器时区断言显示结果，且确认原截止时间戳未改变。显式 setup 可启用经济的原设计保持不变。

这次定向运行 Life、Workshop、Appointment 均通过；各自主要 fixture 报告的 POST 数分别为 **11、20、5**，Life 钱包结果为 **30**。这些是主场景计数，不包含独立恢复边界 helper 的请求，不能当作整份测试全部 HTTP 次数。Diagnostics 既有恢复回归与两个 API 模块的 **8/8** 证据沿用上表，本次未因上述键盘/时区修改重复执行。日程 API/回调、Drawer/store 与真实 ScheduleView 的独立证据见 `hd2d-m6-schedule-overlays.md`。
