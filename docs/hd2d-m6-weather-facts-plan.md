# M6 A 链天气事实：时间来源与只读适配计划

最终状态：本专题后续来源绑定、异步保护和运行层补充已纳入09:30:30启动的完整后端检查点，663/663通过，见[统一验证记录](hd2d-progress-20260908.md)。下方23项“四文件”结果是来源绑定之前的历史检查点，后文15个不同测试也不是当前完整数量；这些阶段计数不相加。

来源绑定之前的专题合跑（历史实际 spec 输出）：**23 tests、23 pass、0 fail，1080.3004ms**。四文件为 `townTimezoneRuntime.test.js`（8）、`townWeatherRuntime.test.js`（4）、`townWeatherFacts.test.js`（10）、`weatherHourlyStartup.test.js`（1）。日志：`output/hd2d-weather-final-spec.log`。本次未运行全 backend，TownService 生产文件已交还。

```sh
node --test --test-reporter=spec agent-core/test/townTimezoneRuntime.test.js agent-core/test/townWeatherRuntime.test.js agent-core/test/townWeatherFacts.test.js agent-core/test/weatherHourlyStartup.test.js
```

下文 8/8 reader、11/11 首次接入、12/12 failover 及20/20三文件结果均保留为历史证据：这些组合运行时 reader 为8项，尚未加入 Curie 后续两项边界。该阶段四文件结果为23/23，最终整体结果以顶部统一验证记录为准。

状态：最小时间保留、只读 reader、主线启动迁移接入及 TownService 三处同步读取均已实现，并完成下述定向验证。未调用天气网络或模型，不修改凭证/解码实现，不把本切片表述为 A 链完成。

## 已实施合同（取代后文初稿中的候选接口与 24h 建议）

- `migrateWeatherHourlySchema(db)`：主线已在 db/index.js 原 weather_hourly 建表后接入，新增可空 INTEGER forecast_at/fetched_at（UTC 毫秒）及可空 TEXT source_key；历史保持 null，不回填、不抓取。重复迁移安全。本切片未修改 db/index.js。
- writer 把响应交给独立 `replaceWeatherHourlyCache`。完整批次先严格验证带 offset 的 ISO fxTime（允许 Z，拒绝无 offset/非法日期）；forecast_at 保留完整有效瞬间，fetched_at 记录本次写入前 Date.now()。DELETE 与 INSERT 在同一事务内，验证/插入失败保留旧缓存。
- 来源合同：`getWeatherSourceKey(city)` 使用 trim 后城市或 auto 模式构造版本化 SHA-256 key。`captureWeatherSource()` 返回 `{sourceKey,revision}`；`updateWeatherConfig` 在实际规范化来源变化时通知 revision，防止 A→B→A 旧 await 回填。稳定 key 不暴露城市文本。
- `beginWeatherForecastRequest()` 返回 `{sourceKey,revision,generation}`，`assertWeatherForecastCurrent(request)` 同时检查来源与最新请求。tick/手动更新在 resolve 前获取请求；resolve 自身另有 generation，返回/定位写入前检查。geo 回填、forecast 返回、缓存提交前均 fence。同城市后发请求也会取消旧请求提交资格；后发失败保留原缓存，不恢复更早请求资格。仅此 source 切片未修改全局定时器生命周期；同期已由独立 scheduler 切片修复，见 [天气调度器生命周期](hd2d-weather-scheduler-lifecycle.md)。
- `replaceWeatherHourlyCache` 必传 sourceKey/assertCurrent，事务删除前再次 assert，写入请求开始时捕获的 source_key。`needsUpdate` 遇旧来源即需更新；不在改设置时新增网络请求。定位缓存/getResolvedCity 只返回当前来源 revision 的缓存。
- 来源同步验证先运行 `node --test test/townWeatherFacts.test.js test/weatherHourlyStartup.test.js`，14/14 通过（当时 reader/writer 13、实际 startup 1），含来源 mismatch/legacy、事务内 guard、revision ABA、同城市 generation、真实初始化新列。随后新增实际 needsUpdate 的同 UTC 日来源刷新检查，独立运行 `node --test --test-name-pattern="actual needsUpdate" test/townWeatherFacts.test.js`，1/1 通过，覆盖匹配、不匹配、NULL 与空缓存，query_only 零写。两次共覆盖15个不同测试，不表示最终15项已重新合跑。后续完整 checkpoint 已由主线统一记录在本轮进度，见顶部链接。异步完整 weatherService deferred 测试由 Volta 独立负责，runtime fixture 由 Arch 负责；本数字不替代他们的合跑记录。
- writer 接受范围进一步限定为来源本地 HH:00:00（省略秒等价于 00）；这是本系统的一小时区间契约，不宣称 provider 永远返回整点。UTC 不要求整点，支持例如 +05:30 偏移。同 forecastAt 只有天气原文、转换后的温度标签和风速标签三项完全相同才去重；冲突则拒绝整批。按完整 forecastAt 排序后，任何不同起点的一小时区间重叠均在 INSERT 前拒绝，避免旧 HH:mm UNIQUE/IGNORE 隐藏歧义。验证排序不改变实际插入的原响应顺序。
- weather_time/展示文本与 UNIQUE/INSERT OR IGNORE 首次出现保留规则沿用原契约。超过一日出现重复 HH:mm 时不额外存储被舍弃行；新 reader 因而可能 unknown，但不会伪造日期或把另一日当今天。没有假设 provider 一定给足 24 条。
- 上述歧义加固定向验证：原 8 项 reader/writer 加 2 项新边界及实际 startup，`node --test test/townWeatherFacts.test.js test/weatherHourlyStartup.test.js` 共 11/11 通过。覆盖非零分钟/秒、半小时 offset、相同瞬间冲突、同 HH:mm 不同 offset 隐藏重叠、乱序重叠、相邻区间、非重叠跨日期 first-wins；失败均保留旧缓存。无真实网络。
- `createTownWeatherFacts({db,clock,enabled=true,expectedSourceKey}).readCurrent()` 同步只读，返回 `{source:'forecast',status:'known'|'unknown',precipitation:'rain'|'none'|null,text,temperature,forecastAt,fetchedAt,validUntil,reason}`。expectedSourceKey 必须由服务端当前配置产生；缺失、legacy source_key null/缺列、不同或混合来源均 unknown / SOURCE_MISMATCH。known 的 text 仅为认可词表原文，temperature 仅允许非空、最多32字符的单行标签，否则 null；不将其解析为数值天气事实。unknown 固定 text:''、temperature:null，三个时间字段均 null；known 的 reason 为 null。时间展示由 town clock 负责。source 明确为预报，绝不称 observedAt 或实测降雨。
- known 必须在 `[forecast_at,forecast_at+1h)`，抓取年龄在 `[0,26h)`，时间值有效且 fetched_at 不在未来，并精确命中批准词表。validUntil 是小时有效期与 fetched_at+26h 的较早值。26h 是主线允许的最大缓存年龄策略，避免擅用短 TTL 与现有按 UTC 日期刷新冲突；不是声称 provider 的覆盖期。
- rain 精确词表：小雨、中雨、大雨、暴雨、大暴雨、特大暴雨、阵雨、雷阵雨。none：晴、少云、晴间多云、多云、阴。混合降水或任意台词 unknown，不进行 includes 或 LLM 解析。
- reason：SOURCE_MISMATCH、DISABLED、MISSING_CACHE、MISSING_VALID_TIME、NO_CURRENT_FORECAST、AMBIGUOUS_FORECAST、INVALID_TIME、STALE_CACHE、UNRECOGNIZED_WEATHER。缺表明确 unknown；PRAGMA 检查发现 legacy 表缺 forecast_at/fetched_at 则返回 MISSING_VALID_TIME，不自行迁移。其他真实 schema 错误仍可见。
- 完整 offset 时间直接换算 UTC，reader 不接收/猜测宿主或镇内时区，不再需要从城市设置猜预报时区。新增 source_key 仅绑定配置城市/auto 模式；auto 不随实际物理位置变化自动换 key。不宣称它验证了镇内地理坐标、IP 定位精度或用户实时所在位置。

验证：`node --test test/townWeatherFacts.test.js`，8/8 通过。全部使用内存 DB、query_only、fake 响应与独立 writer 函数；不启动 scheduler，不运行真实网络/API。覆盖时间解析、legacy/migration、跨日同小时、有效区间/26h 边界、精确词表、事务失败保留旧缓存、重复 HH:mm 兼容、畸形缓存、缺时间列与展示字段边界。以下章节保留最初设计推导，候选接口、24h 策略及“未实现”陈述均以本节为准。

- TownService 的 `isRaining()`、`getWeatherNote()`、`getTownState().weather` 已统一同步调用局部 `readTownWeather()`，替换原来对 async `getWeatherContext()` 的同步误读。降雨只认 known/rain；快照保留 timeDesc/hour/season/text/temperature 字段并附加 reader 事实字段。温度是原标签，不另加 °C。不重复迁移，不修改既有移动概率、拜访策略、经济或全局天气/光线消费者。
- townClock 使用 config.town.timeZone（缺省 Asia/Shanghai）及同一快照 now 派生本地小时、分钟和月份，局部复用纯 getTimeLight 的时段文案。season 现为 timeLight.getSeason 的「春天/夏天/秋天/冬天」，原 weatherService.getSeason 为「春/夏/秋/冬」：这是明确的字面变化。旧 async 调用没有正常取得字段，不据此声称季节值逐字节兼容。
- 主线完成 606/606 checkpoint 后，已授权并实施 TownService 高层可选天气降级：只捕获 reader 创建/读取异常，返回 unknown/READ_FAILED，清空天气及时间证据字段，保留 town 时钟展示。服务端保留原始异常诊断，每分钟至多一次（时钟回拨重新开始限频窗口），响应不泄漏 SQL；修复缓存后下一次读取自动恢复。getDb 初始化、town 时钟及其他业务错误不纳入此回退。低层 reader 仍抛真实 SQL/schema 错误；原概率未改。

TownService 实际 runtime 证据：首次快照接入 **3/3、与 reader 合计11/11**；高层降级新增正式用例后，`agent-core/test/townWeatherRuntime.test.js` **4/4 通过**，与 reader 合跑命令 `node --test --test-reporter=dot agent-core/test/townWeatherRuntime.test.js agent-core/test/townWeatherFacts.test.js` **12/12 通过**。runtime 测试动态导入完整 getDb 迁移及实际 getTownState，使用内存库、受控时钟、UTC 宿主和 query_only；覆盖 town 跨午夜、旧日同小时/legacy/26h 过期拒绝、小时有效期终点、精确词表、实时天气开关、DST 与季节跨午夜、重复读取无写。新用例通过重命名 weather_text 列先复现修复前 SQLITE_ERROR 导致快照失败，再验证高层降级保留时间、不泄漏 SQL、连续11次读取仅一次诊断、满一分钟再次记录、列恢复后自动 known，且低层仍抛错。未启动 scheduler/向导，没有真实网络或模型；这是快照接入证据，不作为移动概率或雨天拜访策略验收。

## 现有写入与读取证据

TownService 时区补漏已完成：`refreshNpcAgent(now)` 无 routine slot 时的睡眠判断改用与天气展示共享的纯 `townLocalTime(now)`（townClock 本地分钟），不读取天气 DB 来决定睡眠。23:00 至次日06:00 的既有窗口、routine 优先级和 nightOwl 豁免均不变。`townTimezoneRuntime.test.js` **8/8**：修复前实际复现 host UTC/town Shanghai 下当地00:00不睡、08:00误睡及夜间边界错误；修复后覆盖00/08、22:59/23:00、05:59/06:00、已有slot及nightOwl，并断言夜间真实回家路径、初始位置未瞬移、推进后到家及 sleeping 状态。完整内存 runtime、受控时钟、本地网络 stub，无模型。历史合跑（当时 reader 8项＋runtime 4项＋timezone 8项）**20/20 通过**：`node --test --test-reporter=dot agent-core/test/townTimezoneRuntime.test.js agent-core/test/townWeatherRuntime.test.js agent-core/test/townWeatherFacts.test.js`。

启动接入另已验证：`node --test test/weatherHourlyStartup.test.js test/townWeatherFacts.test.js` 共 9/9 通过。新增测试采用既有 migration fixture 的隔离方式，设置 DB_PATH=:memory: 后实际调用 db/index.js 的 getDb/initSchema，并检查新列类型、可空性、legacy 插入为 null 与完整性；不是静态源码断言。启动包含原有本地 seed，网络入口全部禁止且尝试次数为 0，没有启动业务 scheduler 或真实数据库。

| 文件/函数 | 当前行为 | 事实约束 |
| --- | --- | --- |
| `agent-core/src/db/index.js` weather_hourly 建表 | weather_time 为唯一 TEXT，注释称 HH:00；另有 weather_text、temperature、wind_speed；created_at 默认 CURRENT_TIMESTAMP | created_at 是 SQLite 入库 UTC 时间，格式没有显式偏移；不是预报有效时间 |
| `weatherService.js` / fetchWeatherData | 逐行取 `h.fxTime.substring(11,16)`；写入 h.text，温度/风速转换为展示文本 | 实际持久化 HH:mm；没有验证分钟为 00，没有保存 fxTime 的日期、偏移、预报地点或批次 |
| 同一 writer | 先 DELETE 整表，再在另一个事务内 INSERT OR IGNORE | 删除不在插入事务内；失败可能留下空表。重复小时只留首次插入值，不能假定一定为完整 24 小时 |
| `weatherService.js` / needsUpdate | 比较 MAX(created_at) 的日期与 `new Date().toISOString()` 日期 | 以 UTC 日界判断是否需要更新；不是按预报有效期/实际小时覆盖判断。调用失败前未写入时可保留旧缓存 |
| `weatherService.js` / getCurrentWeather | 按 datetime.getHours() 拼 HH:00 查询，不查 created_at；夜间把晴改写为月朗星稀 | 使用宿主时区，且返回含展示变换，不能直接作结构化事实来源 |
| `timeLight.js` / getCurrentWeather | 按传入 hour 拼 HH:00，只看功能开关，不查日期/created_at | 可重复使用过期天相同小时；相关调用通常用宿主 getHours() |
| `timeLight.js` / _normalizeWeather | 用 includes 等文本规则归类 | 适合既有画面提示，不作为镇内可信降雨事实解析器 |
| `townService.js` 时钟初始化 | 配置 timeZone，默认 Asia/Shanghai | 与宿主时区、天气来源地点时区不保证一致 |

当前 writer 的 weather_text 来自天气响应 h.text，这条路径没有经过 LLM。但仅凭数据库字段名不能证明任意历史文本都是合法天气类别；不接收聊天、人格、生成台词或 weather context 描述作为天气证据。

## 不能靠 TTL 解决的歧义

`created_at` 只能说明缓存写入时间。假设 09:30 写入的一批预报从当天 10:00 延续到次日 09:00，那么表中 09:00 对应次日，当前 09:00 查询却会命中它。即使 TTL 只有一分钟、created_at 与现在同日，也不能证明该条预报适用于当前小时。这是现有格式允许的情况；本调查未访问外部接口确认其具体返回窗口。

同样，手动更新地点之后，表中没有保存每条记录的地点/时区绑定；读取当前城市设置不能追溯证明旧缓存属于当前地点。HH:mm 也无法表达 DST 重复小时的两个不同瞬间。

**结论：仅用现有三类字段不能建立可信当前天气。** 不从入库日期拼出有效日期，不用“最近过去/最近未来同小时”猜测，不凭宿主时区或小镇默认时区解释来源小时。独立 reader 的现阶段安全结果是 unknown；可以诊断缓存是否陈旧，但不能据此升级为 rain/clear。

## 建议最小 reader 契约（待批准实现）

`createTownWeatherFacts({db,clock,timeZone,enabled})` 返回同步 `readCurrent()`；clock.now() 为 UTC 毫秒，timeZone 为服务端明确配置的 IANA 时区，仅用于镇内展示。接口不调用现有 weatherService、resolveCity、triggerUpdate、getWeatherContext，不维护缓存，不自动补数据，不追加事件。

最小结果：

```js
{ status: 'unknown', precipitation: null, source: 'weather_hourly',
  reason: 'MISSING_VALID_TIME', checkedAt: 1788831000000, cacheWrittenAt: null }
```

内部 reason 可限定为 DISABLED、MISSING_CACHE、INVALID_CACHE、STALE_CACHE、MISSING_VALID_TIME、MISSING_SOURCE_ZONE、UNRECOGNIZED_WEATHER。仅供诊断，不能触发模型或写入。业务只依赖 status/precipitation，unknown 不等同无雨，也不触发雨天业务。不返回城市、原始 weather_text、提示词或 SQL 错误。

读取规则：

1. disabled 直接 unknown。缺表可经 sqlite_master 明确识别为 MISSING_CACHE；真实 SQL/schema 错误不全量 catch 吞成天气未知。
2. clock 必须为有效 UTC 毫秒。created_at 严格按 SQLite UTC 格式解析并校验日期往返，不调用宿主相关的 `Date.parse('YYYY-MM-DD HH:mm:ss')`；畸形/未来入库时间返回 INVALID_CACHE。
3. 拟定缓存新鲜度上限 24 小时（与现有按日更新频率匹配），年龄范围 `[0,24h)`；恰好 24 小时即 STALE_CACHE。这是候选策略，不是现有源的有效期保证。不得用全表 MAX(created_at) 替代选中记录时间。混合批次/缺小时不填补、不沿用其他小时。
4. 即使通过新鲜度检查，只要缺少完整预报有效时间和来源时区/地点绑定，仍返回 MISSING_VALID_TIME / MISSING_SOURCE_ZONE。不能把“新缓存”标为“当前天气已知”。
5. 将来有可信完整有效时间时，以 UTC 瞬间做区间匹配，例如 `[validFrom,validTo)`；检查有效区间与缓存年龄两层约束。完整含 offset 时间可直接转换 UTC，镇内 timeZone 不重解释来源时间。只有本地时间且遇 DST 歧义则 unknown。
6. 条件具备后仅用固定精确词表映射可信源类别，例如小雨/中雨/大雨/阵雨/雷阵雨→rain，晴/少云/晴间多云/多云/阴→none；其他如混合降水先 unknown，单独批准后再扩。禁止 includes('雨')，禁止把“没有下雨”“雨天建议”“模型说会下雨”判为 rain。none 只代表已识别的当前源类别，不承诺未来天气。

无需 world/epoch 参数来解释公共天气缓存；若将来异步注入小镇快照或上下文，调用方仍须按小镇既有 scope 规则隔离旧回包，不能把天气缓存年龄当 world epoch。

## 达到已知事实所需的最小后续前置条件

若主线希望 A 链真的获得 rain，而不是长期 unknown，需要另行批准 writer 保留原始完整 fxTime 或等价的 UTC 有效区间，以及与该批预报绑定的来源地点/时区证据。先冻结存储格式再实现只读 reader；不必扩成通用天气框架。本轮没有新增表、字段或修改 writer。

现有 temperature/wind_speed 已是展示标签，也不用于数值阈值业务。reader 不发送信件、不调用 LLM、不改变日程/预约/经济；下游未知时维持原业务，不制造“下雨导致”的原因。

## 必要独立 fixture 测试（本轮未运行）

- query_only 下所有分支零写；禁止网络/调度器/LLM 依赖，disabled 不查表。
- 昨日同小时、恰好 24h、未来 created_at、非法日期、缺表/缺行、空表/混合批次；真实 schema 错误可见。
- 新鲜 09:00 行也可能是次日预报：没有有效日期时保持 unknown，不能因 TTL 通过而变 rain。
- 宿主 TZ 为 UTC/其他时区、小镇 Asia/Shanghai 时结果一致；UTC 日界与北京时间日界分离。
- 缺来源时区/地点、设置地点已改变而行未绑定、DST 重复/跳过小时都不猜测。
- 如果未来补完整有效区间：恰好起点命中、终点失效，offset 正确换算，不接受其他日期同小时。
- 精确词表与任意台词/含雨字句子区分；unknown 不触发副作用。

本文结论来自代码只读审计；未查询真实 weather_hourly 内容，未运行测试或天气请求。
