# M7 小镇store一致性边界

实现：`web-ui/src/stores/town.js`。本轮只修改store和`town.test.js`，没有新增后端revision、修改业务或执行backend全量测试。

## NPC移动与晚HTTP快照

复现顺序：发起fetchState→同epoch收到NPC town_move（新位置/路径）→先前抓取的HTTP快照返回旧位置和空路径。原store只有玩家moveRevision保护，NPC会回跳并停止。

修复使用store内本地递增的移动观察代次。每次HTTP发起时记录边界；NPC移动事件为该agentKey登记新代次。快照返回时，若同world/epoch且该NPC在请求期间收到移动，仅保留当前x、y、path、speed、moveStartedAt、sleeping，新快照其他元数据仍生效。空路径停止事件同样保留；代次递增不依赖毫秒时间戳，因此同毫秒事件也能区分。明确actorId不同的替换对象不继承旧移动，世界变更清除观察记录。

后续没有介入移动事件的HTTP请求仍接受服务端权威位置，不永久锁住本地路径。已有HTTP请求序号继续保证旧请求晚于新请求返回时不能覆盖新快照；玩家继续使用原moveRevision。

### 限制

本地代次只表示浏览器观察顺序，不是服务器序号。它保护“HTTP请求期间收到SSE”这一竞争窗口，不能校验独立SSE乱序/重复，也不能证明请求发起前收到的事件与服务端快照的先后。若要进一步保证，需要后端为NPC移动/停止及快照提供统一revision，并规定重载/epoch生命周期；本轮未实现。后端现有stateVersion为场景generation，也不能当成每次移动的序号。

## 向导预览与初始化状态晚响应

复现顺序：refreshDraftPreview挂起→卸载或clearDraftPreview→重挂载/进入正式地图→旧请求完成。原draftPreview被重新写入，renderMap优先选择它，使旧预览覆盖正式地图。

preview与init各有独立请求序号，并在发起时记录worldId/epoch。只有请求仍为最新且世界未变才可赋值。stopTownStream、clearDraftPreview、世界变化会失效两类挂起请求；世界变化同时清除initState与draftPreview。清预览只使未完成init请求失效，不随意清除同世界已有初始化信息。请求不需要取消网络也能防止晚赋值。

这不是完整的服务端向导任务版本协议；同世界中新任务若既未发新请求、也未调用clear/stop，不会仅凭HTTP内容识别任务替换。调用方仍需在对应生命周期触发刷新或清理。

## 真实unified SSE接线（main负责）

此前store订阅town_state_updated，但unifiedStream._connect未注册对应callback，真实广播不能到达store。main已补注册与派发。api/index.js的connectUnifiedStream解析事件名后动态查handlers，没有另一份固定事件白名单。

main新增`web-ui/src/stores/townStream.test.js`中的1项实际连接/解析契约测试，覆盖真实SSE parser→unifiedStream→已挂载town store的状态失效刷新，以及退出后的退订。此项与store自身用Map模拟事件派发的测试不同，不能用后者替代接线验证。本轮未修改或重复执行main的测试。

## 已验证

定向命令：`cd web-ui && node --test src/stores/town.test.js`，9/9通过。原4项保留；新增5项覆盖NPC晚快照/同毫秒移动与停止/后续权威刷新、actor替换与跨epoch、preview/init卸载重挂、clear与世界变更、同世界请求乱序。另有main的townStream实际解析测试1项。

临时复现脚本位于output，仅用于记录审计，不作为现有修复后应通过的回归测试。未重跑backend全量。
