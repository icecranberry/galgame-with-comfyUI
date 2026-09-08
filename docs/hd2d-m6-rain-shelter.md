# M6 雨天纯空闲居民回家避雨

本切片仅在全局 `simulation='rules'` 下，把可信雨天作为纯空闲居民回自己明确住所的本地条件。复用原 move_to/wait runner，不建立咖啡馆、不新增交易、道具、LLM 或消息触发；沿用 runner 原有动作事件和日志。legacy（包括经济居民混合 rules）不新增此行为。

## 资格与优先级

TownService 先处理原作息/日程、服务、预约和经济岗位，再考虑避雨。明确记录当前是否有原任务，不把有地点的休闲日程或任意 wait 当纯空闲。原任务、work/rest/off_town、服务、预约、相遇及其他 runner owner 均优先。

非 nightOwl 的无slot NPC 在 town 本地23:00–06:00不参与新避雨，仅保守排除资格，不重写 rules 默认睡眠。角色 activity 只有 null 或 scheduleManager 完整的自由时间 sentinel 才算无任务；缺 startTime 的任意其他对象仍视为有任务，不能仅以 scheduled=false 接管。

NPC 读取自己的 town_npcs.home_location_id；关联角色读取自己的 town_characters.home_location_id，不能退回关联 NPC 的家。持久化地点必须属于当前地图且 kind 精确为 home，并与装载地点 id/key 对应。无绑定、错地图、删除、改类型均不生效或取消当前避雨，不使用首地点/户外兜底，不根据 cafe/place 名称猜室内。

天气来自只读 reader，必须 known/rain。unknown、关闭天气、非雨或预报小时失效恢复原 facts。时间源与预报缓存策略详见 hd2d-m6-weather-facts-plan.md。

## 持久预算与 runner 合同

新增只读 `createTownWeatherShelter({db})`，返回 `remaining(input)` 和 `enrich(input)`；不迁移、不写事实或内存额度。固定 `shelterRuleKey(forecastAt)` 为 `town.weather.shelter:<UTC毫秒>`。预算依据 town_actions 的 world_id/world_epoch/actor_id/type=wait/rule_key：

- 每 actor/worldEpoch/forecastAt 最多900000毫秒。home 不进入预算 key，换家不续额度；预报小时变更可有新额度。
- 只统计已开始的 wait，移动、未开始或不可达不扣等待额度。终态按 max(0,min(updated_at,due_at)-started_at) 扣除；其他未解决 owner 保守预留全部时长。
- 当前运行 wait 不在 facts 中重复预扣，仍受原 due_at 上限约束。取消后终态时间重新计入，新 wait 只能获得剩余额度。移动到达时重新采用当拍剩余额度。
- 崩溃间隔没有逐拍出勤证据，保守占用额度，不声称为实际出勤，不补发等待完成或奖励；过期租约仍由 runner recover 标 failed。此预算保证不能通过中断刷出超过15分钟的避雨等待，可能少给无法证明的离线间隔。
- 离线或未知 terminal gap 按保守时间扣预算，不称观测工时或奖励；历史时间畸形（包括 updated_at 早于 started_at）直接耗尽本预算，不按零用量退款。
- 普通 wait 完成后的下一拍发现额度耗尽，恢复 idle facts，不再次创建本小时避雨 wait。居民可以仍站在家中；有限的是避雨动作，不是强迫15分钟后离家。

`migrateTownActionSchema` 仅增加 IF NOT EXISTS 索引 town_actions_actor_rule_type(world_id,world_epoch,actor_id,rule_key,type)。实际 EXPLAIN QUERY PLAN 确认该预算查询使用 SEARCH 索引，query_only 读取无写。

simulation 只新增服务端可信事实 `shelterForecastAt`，校验为非负安全整数，且必须 wait、有 target、durationMs不超过15分钟、minDurationMs=0。固定规则族由 simulation 内部派生，不开放客户端任意 payload/ruleKey。TownService 向 enrich 独立传入 getWeatherSourceKey(config.weather.city)，不新增公开天气DTO字段。scheduleKey 为有界 weather:shelter:<完整sourceKey>:<forecastAt>:<homeId>；sourceKey 严格校验 weather:v1: 加64位小写十六进制，组合长度超过256则保守不参与。不含每帧 now 或 fetchedAt。完整 home.key 独立保存在 target，runner 单独比较 target 变化，因此改名仍取消旧计划且不丢来源；home.key 超过256字符则不参与避雨，不放宽 runner 上限。城市来源变化即使在两拍间已换成同小时同雨缓存，也会取消旧计划；预算 ruleKey 仍只有 forecastAt，不因 source 变化增加额度。

runner 先走真实路径，权威到达后才开始有限 wait。源/家/任务变化沿用计划取消和租约释放；不可达沿用失败退避，不每tick新建。reset 沿用既有取消与epoch切换，不增加 catch-up 钱物。

## 定向证据

最新 source 计划一致性修复：三个自有 runtime 文件 **36/36 通过**（shelter 23、weather 5、timezone 8），日志 output/hd2d-rain-source-plan-spec.log。新增移动/等待两场景：A→B 同 forecastAt 同雨，中间不读取 mismatch，旧动作取消且新 scheduleKey 包含 B 完整sourceKey；等待14分钟后切换城市只使用原剩余额度，两段扣量总计900000ms，移动场景也不续预算。组合 key 保持≤256，原长 target 保护继续通过。未自主跑全 backend；本修复交还后冻结 backend 新功能。

天气来源绑定接入后，TownService 在天气 try/catch 内传 `expectedSourceKey:getWeatherSourceKey(config.weather.city)`；本模块两个缓存 fixture 写入匹配 source_key。三个自有文件合跑 **34/34 通过**（weather runtime 5、shelter runtime 21、timezone runtime 8），日志 output/hd2d-weather-source-runtime-spec.log。新增城市切换 known→SOURCE_MISMATCH→匹配缓存 known，验证 town 时间显示及真实 legacy NPC 默认夜间 sleeping 始终保留。未修改 Curie/Volta 的测试或天气底层模块。

协作方独立证据（主线转交，与下述本模块20项分别记录，不相加，覆盖可能重叠）：

- Socrates：activity UI 新增原因及 scope browser 20 只读检查 **PASS**。属于 UI 展示与 scope 浏览器证据，不作为本模块独立 backend 运行结果。
- Volta：独立真实优先级审测 **1/1 通过，1351ms**。覆盖已付服务期间不移动、真实双 proof 生产、已接受预约优先，以及预约取消后恢复 shelter。该项补齐跨模块业务优先级证据，不与本模块 runtime 用例累计计数。

长 key 修复后独立避雨 runtime **20/20 通过**，日志 output/hd2d-rain-shelter-long-key-spec.log。新增实际 runtime 验证256字符 home.key 可真实到达并等待、scheduleKey 有界、同home改名仍取消旧动作并使用新target、257字符目标不参与。下方50/50为此前五文件组合历史结果，未将本次单文件结果冒称重新跑过全部五文件。

`townWeatherShelterRuntime.test.js` 使用实际完整 getDb、TownService、scheduler forceTick 和内存库；禁用 LLM，网络只允许本地 object_info 空 stub。覆盖走路→到达→等待→额度耗尽、14分钟取消/换家/重载后剩余额度、新预报小时、天气失效、原休闲任务和后续工作优先、无home/非home/错地图/类型变更、不可达退避、过期租约重启与reset、关联角色自身绑定、经济开启的无关居民、切legacy取消，以及 query_only/索引。

最新五文件合跑命令：

```sh
node --test --test-reporter=spec agent-core/test/townWeatherShelterRuntime.test.js agent-core/test/townSimulation.test.js agent-core/test/townRuntimeSimulation.test.js agent-core/test/townWeatherRuntime.test.js agent-core/test/townTimezoneRuntime.test.js
```

历史五文件结果：**50 tests、50 pass、0 fail**，日志 output/hd2d-rain-shelter-spec.log。包含当时避雨新文件19项、原 simulation/runtime 19项、天气与时区12项。独立服务/预约/经济工作优先级已由 Volta 按真实业务链补充审测，证据单列于本节开头，不把本文件的普通日程优先级用例冒充这些跨模块验收。
