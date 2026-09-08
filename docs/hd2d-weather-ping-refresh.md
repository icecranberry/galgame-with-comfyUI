# Legacy ping 天气快照刷新

真实 town store 原先收到 town_ping 只设置 connected，页面跨小时后 weather.hour/validUntil 可能保留旧快照。隔离浏览器先复现：服务端fixture改为9点后发ping，store仍为8点。

修复仅在 `web-ui/src/stores/town.js`：有效数值serverTime的ping只取一次本地now并更新serverOffset；本地时钟回拨（elapsed<0）同样允许刷新，由fetchState重设限流基准；仅活跃引用期间复用原120ms `_scheduleAgentSpriteRefresh` 请求快照。不新增interval。以最近一次fetchState请求开始时间限制ping触发GET最多每60秒一次，首次mount的既有fetch也计入，避免紧邻ping重复读取。town_state_updated不受该限流影响，同拍共享原debounce。最终stop仍清timer、取消订阅并使旧请求序号失效；timer执行前再确认引用仍活跃。

定向 `node test/town-weather-ping-browser.mjs` 在web-ui下通过（本地playwright-core/headless Edge）。fixture实例化真实Pinia town store与API聚合入口，使用真实unifiedStream dispatcher的fixture-only导出；没有修改生产stream或模拟替换store函数。

覆盖：legacy跨hour和validUntil刷新、有效ping对时、首次fetch后不重复读、短间隔ping限流、本地时钟回拨仍读取新hour/validUntil且随后恢复限流、ping+state_updated合并、state_updated绕过ping限流、无效ping忽略、stop清pending、停止后ping零GET、请求已发出后stop忽略晚回包。最终 **6次GET、0次POST**（第6次是重进后的持有请求，用于晚回包测试）。全部HTTP隔离，无真实业务/模型调用。没有运行后端checkpoint或全套构建。
