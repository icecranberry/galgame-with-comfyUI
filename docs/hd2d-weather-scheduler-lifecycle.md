# Weather scheduler 生命周期修复

2026-09-08：实际源码隔离复现后，仅修改 `weatherService.js` 的 scheduler 字段与 start/stop 调度逻辑。restart 仍保持 stop → start → 立即 tick 的原顺序；tick、source/cache、定位、HTTP 与凭证逻辑不属于本次修改。

## 问题及修复

原启动使用未保存的10秒 timeout，stop 仅清理 interval。启动1秒后停止，旧 timeout 仍创建1个 interval 并触发1次假请求；启动1秒后 restart，会形成2个 interval，最终 stop 后还残留1个，虚拟推进一小时继续请求。

现在保存 `startupTimer`，由 `schedulerRunning` 保证重复 start 幂等，`schedulerGeneration` 隔离旧代次。stop 同时清理启动 timeout 和 interval，并使旧代次失效。延迟回调与 interval 回调执行前检查运行状态及代次，旧回调不能清掉当前启动句柄、重新建立 interval 或发起后续 tick。正常启动仍延迟10秒，轮询间隔仍一小时；restart 保留立即 tick，同时重新等待10秒建立唯一轮询。

**只保证后续调度停止，不代表取消了已在途的 HTTP、定位 Promise 或正在执行的 tick。** 本次没有新增 AbortController、请求重试或修改 processing/source 的异步语义；source/cache fence 的覆盖由其独立验收负责。

## 隔离验证

[weatherSchedulerLifecycle.test.js](../agent-core/test/weatherSchedulerLifecycle.test.js) 读取并编译实际服务源码，保留 scheduler/tick 函数体；导入边界替换为假的配置/DB/稳定source，私有请求函数替换为返回空结果的计数 stub。私有常量在执行前移除，不执行 JWT 或真实网络，也不导入真实数据库。意外进入外部边界或服务错误会导致测试失败，不输出凭证或请求参数。

假时钟推进，无真实10秒等待；6项全部通过：

1. 启动延迟中 stop，之后零 interval、零请求增量。
2. 延迟中 restart，仅一个 interval；最终 stop 后虚拟一小时无请求增量。
3. 正常启动完成后 stop 清除 interval。
4. 延迟中及启动完成后重复 start 幂等，重复 stop 安全。
5. 连续三次 restart，每次保留立即 tick，最后一次后9999ms不提前触发，10000ms建立唯一 interval。
6. 显式执行已捕获的旧代次 delay/interval 回调，验证运行状态与代次检查，不能影响当前句柄或新增请求。该项是对已分派旧回调的直接单测，不冒称真实事件循环必然发生该交错。

修复前实际源码 hash：`fcc5bd4b416ad9b3f4fd816f732f0daa007829a775af8e0a95fde2f97d563993`，原3项2红1绿；修复后 hash：`a8e114560b4a0f75d599be14a15f8835f3a34c930c9db6355bdb89c6b466db41`，6/6 PASS。测试长期保留正确行为断言，没有“证明bug存在即通过”的断言。

```powershell
node --test agent-core/test/weatherSchedulerLifecycle.test.js
```

未执行全套、build、浏览器或CPU基准。
