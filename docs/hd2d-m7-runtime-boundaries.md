# M7 runtime 边界回归

正式测试：`agent-core/test/townBoundaryRuntime.test.js`，定向运行结果 **5/5 通过**。

```sh
node --test --test-reporter=dot agent-core/test/townBoundaryRuntime.test.js
```

沿用 `townAppointmentRuntimeMovement.test.js` / `townRecoveryMatrix.test.js` 的实际 runtime fixture 配置：完整 getDb 迁移、地图与居民、角色原日程、真实配送与服务结算产生预约来源。现有 fixture 未导出，新文件保留本地初始化，避免导入旧测试注册额外用例。

| 切点 | 验证结果 |
| --- | --- |
| 已接受服务后从 rules 切 legacy、关闭 economy，LLM 保持关闭 | 新 offer 被拒绝；已有服务完成四阶段并解除 busy |
| 已付费服务期间删除工坊 POI并 reload/tick | 服务失败全退 30，材料预留归零，busy 解除；再次 GET 不重复结算 |
| 已付费服务期间角色退住 | 服务 GET 恢复并全退 30；重复 GET 不重复结算，再入住不残留 busy |
| 预约移动期间删除工坊 POI | 旧动作取消、其资源 lease 清空，预约不再提供有效覆盖事实 |
| 预约 GET 首次维护后重复读取 | 表快照不变，SQLite total_changes 不增加；取消后下一 tick 清理动作与 lease |

数据库在动态导入前设为 `:memory:`；受控 Date.now，无真实数据库、模型或网络请求。仅允许模块启动所需 `/object_info` 的本地 fetch stub；其余 fetch 请求拒绝。scheduler 在每例清理时停止。

本文件补充集成边界，不重复 RecoveryMatrix 的 SQLite 重开、离线恢复和 reset 九阶段回滚。LLM 覆盖限于关闭状态下的本地服务流程，不包含在途模型调用中断；不涉及 HTTP/SSE 前端响应排序。本轮未修改生产代码。
