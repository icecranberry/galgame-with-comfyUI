# M7 移动请求的世界范围

## 问题与边界

原链路是 `stores/town.movePlayer(x,y)` → `api.moveTownPlayer(x,y)` → `POST /api/town/player/move` → `movePlayerTo`；方向移动对应 `movePlayerDir` → `moveTownPlayerDir` → `POST /api/town/player/dir`。原请求只有坐标，没有世界范围。隔离 HTTP fixture 将 epoch 从 2 改为 3 后送入 epoch 2 请求，两个入口都曾返回 200 并调用移动函数。

本切片只对这两条 HTTP 移动链路添加可选范围检查，不增加命令队列或自动重试，不改 TownView、身份解析或寻路逻辑。

## 契约

```js
moveTownPlayer(x, y, { worldId, worldEpoch } = {})
moveTownPlayerDir(dx, dy, { worldId, worldEpoch } = {})
// POST /api/town/player/move
{ x: 3, y: 4, worldId: 'world', worldEpoch: 3 }
// POST /api/town/player/dir
{ dx: 1, dy: 0, worldId: 'world', worldEpoch: 3 }
```

- 新 store 两个方法在调用时从 snapshot 拷贝 worldId/worldEpoch；之后快照改变不影响已发起请求。没有有效快照时以 `INVALID_WORLD_SCOPE` 拒绝，不发送无范围请求。
- API 保持原两参数调用兼容，仅透传可选 worldId/worldEpoch，不接受客户端 playerId。提供的非法值不被转换或静默删去，交由服务器拒绝。
- 两个字段都未提供时保持旧调用行为。只要提供任一字段，必须同时提供非空字符串 worldId 与正安全整数 worldEpoch；非法或不完整参数返回 HTTP 400 / `INVALID_WORLD_SCOPE`。
- 路由在实际移动前只读 `town_world_state` 的 world_id/epoch。不同世界、不同 epoch 或无当前世界返回 HTTP 409 / `STALE_WORLD`，不调用移动函数。不调用带维护副作用的 getTownState，不依赖客户端 me/playerId。
- 校验和现有同步移动调用之间没有 await。若未来移动改为异步提交，应在实际状态提交处重新验证；当前不扩展服务层。旧客户端无 scope 的兼容请求仍不具备该隔离保证。

## 验证

后端：`node --test test/townMovementScopeHttp.test.js`，2/2 通过。使用实际 router、内存 SQLite 与 query_only、localhost 随机端口，移动函数是记录调用的 fake。每个入口覆盖旧 epoch 迟到拒绝、旧 world 拒绝、当前范围成功、旧无范围兼容、缺字段/类型错误/非法 epoch，不访问真实数据库或执行真实移动。

前端：`node --test test/town-movement-scope.test.mjs src/stores/town.test.js`，12/12 通过，其中新增 API/store 测试 3 项、原 store 回归 9 项。执行实际 API 函数源码与 store，验证旧参数形状、范围白名单、无快照拒绝及 deferred 等待期间 scope 不变。无真实网络移动或自动额外请求。

主线提供的 TownView 浏览器验收证据：world/epoch 变化关闭 life 并递增 lifeMoveRequest，释放旧输入锁；晚失败不写新世界 notice，旧 finally 不释放新请求锁。`town-view-browser.mjs` 新增 life epoch 关闭及 held 前往 POST 晚到 409 场景，重开新世界 life 不受污染，已通过。仅 1 次显式前往 mock POST，其余入口零新增命令。本切片未修改 TownView，也未重复运行主线浏览器验收。

## 文件范围

生产仅修改 `agent-core/src/routes/town.js` 两个移动 handler 及其共用只读检查、`web-ui/src/api/index.js` 两个移动函数、`web-ui/src/stores/town.js` 两个移动方法。新增独立测试 `agent-core/test/townMovementScopeHttp.test.js`、`web-ui/test/town-movement-scope.test.mjs` 与本文档。
