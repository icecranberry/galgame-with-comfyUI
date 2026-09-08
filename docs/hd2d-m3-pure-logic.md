# M3 独立纯逻辑接口

本模块实现计划第 8 章的时钟、类型化事实、规则计算与候选选择基础。没有接入数据库、路由、townService、动作执行器或经济结算，不代表 M3 全阶段完成。

## 文件与公开 API

- `agent-core/src/services/town/townClock.js`
  - `createTownClock({now, timeZone='UTC', lastNow=null})`：`now()` 返回防回拨 UTC 毫秒；`snapshot()` 返回 `{utcMs,timeZone,date,minuteOfDay}`；`at(utcMs)` 转换任意明确时刻，不改变时钟游标。`now` 是注入函数，默认 `Date.now`。重启时传入持久化的 `lastNow`。
  - `isInTimeWindow(minuteOfDay,startMinute,endMinute)`：分钟范围 0–1439，左闭右开，支持跨午夜；起止相同表示空窗口。
  - `planCatchUp({cursorUtcMs,nowUtcMs,maxCatchUpMs,stepMs,maxSteps})`：默认最多追溯最近 6 小时、60 秒一步、最多 360 步。返回连续 `{fromUtcMs,toUtcMs}` 步骤、`skippedMs` 和建议 `cursorUtcMs`。超过步数上限时聚合步长，保留末尾不足一步的时间；回拨返回空步骤并保留原游标。
- `agent-core/src/services/town/townFacts.js`
  - `createFactRegistry(definitions)`：注册 `{type,min?,max?,values?,unit?}`；支持 `number/string/boolean` 及各自数组。数值有限、范围与枚举严格检查，`unit` 记录单位，调用方统一换算。
  - `createFactSnapshot(registry,values)`：输入是扁平键值对象，例如 `{'actor.busy':false}`。拷贝并冻结数组及快照，拒绝未注册字段和 getter；`null/undefined` 视为缺失。调用方一次批量采集权威事实，整次决策使用同一快照。
- `agent-core/src/services/town/townRuleEngine.js`
  - `createTownRuleEngine({refs,actions,maxDepth=12,maxNodes=128})`：返回 `registry`、`compileExpression(ast)`、`compileRule(rule)`。配置硬上限分别为 64/4096；默认规则的 when 与 score 共享 128 节点预算，字面量、数组元素均计数，根深度为 1。
  - 编译表达式返回 `{type,evaluate(facts)}`，计算返回 `{missing:false,value}` 或 `{missing:true}`。编译规则返回不可变规则，`evaluate(facts)` 返回 `{eligible,score?,action?,reason?}`。
  - `selectTownCandidate(options)`：返回 `{selected,seed,reason,rejected,cooldownUpdate?}`；不修改输入，不执行动作、不写冷却。错误候选被拒绝并记录 `evaluation_error` 与详情，其他有效候选仍可选择。
  - `cooldownKey({worldId,actorId,ruleKey,targetKey=''})`：稳定 JSON 元组键，用于持久化 `Map<key,lastStartedUtcMs>`。不包含日期或版本，跨日和升级不重置冷却。字符串 ID 由调用方从领域 ID 显式转换。

## 注册与调用示例

```js
const engine = createTownRuleEngine({
  refs: {
    'actor.busy': { type: 'boolean' },
    'shop.workstation': { type: 'string' },
  },
  actions: {
    produce: {
      recipeKey: { type: 'string', values: ['workshop.basic_accessory'] },
      stationRef: { type: 'string', ref: true },
    },
  },
});
const rule = engine.compileRule({
  key: 'workshop.restock', version: 1, trigger: ['stock.changed'], priority: 50,
  when: { op: 'not', args: [{ ref: 'actor.busy' }] },
  score: 80, cooldownSeconds: 1800,
  action: {
    type: 'produce', recipeKey: 'workshop.basic_accessory',
    stationRef: 'shop.workstation',
  },
});
const facts = createFactSnapshot(engine.registry, {
  'actor.busy': false, 'shop.workstation': 'station-1',
});
const result = selectTownCandidate({
  rules: [rule], facts, worldId: 'world-1', actorId: 'actor-1',
  decisionSequence: 42, nowUtcMs: clock.now(), cooldowns: new Map(),
  trigger: 'stock.changed',
});
// result.selected.action.stationRef === 'station-1'
// 仅在动作执行器成功开始后，事务提交 result.cooldownUpdate 和决策序号。
```

动作注册表是必需的能力白名单，默认不允许任何动作；所有声明参数必填，不允许额外字段。`ref:true` 参数的字符串必须是注册的同类型事实名，求值时再校验解析值的范围/枚举。该参数保留原字段名，执行器接收已经解析的值，不再次按路径读取。执行器仍须验证地点、配方、资源权限与当前版本。

## AST 与选择语义

AST 使用基本字面量、非空同类型字面量数组、`{ref:'注册名'}` 或 `{op,args}`。支持 `all/any/not/eq/ne/gt/gte/lt/lte/in/add/sub/mul/div/min/max/clamp/exists/default`。`exists` 只接受一个 ref；`default` 接受两个同类型表达式。未知字段/操作符、混合类型、无穷值、除零、反向 clamp 均拒绝。

缺失值向上传播，尤其 `not(缺失)` 仍然缺失；规则条件缺失时不成立。`all/any` 三值短路，例如 `all(false,缺失)` 为 false、`any(true,缺失)` 为 true。`default` 仅在首项缺失时计算备用值；不会吞掉除零或非法事实类型。

选择先应用 `blockedReason` 硬约束，再检查 `current:{ruleKey,startedAtUtcMs,minDurationMs}` 最短持续时间，然后按触发器、冷却、条件过滤。`switchPenalty`（默认 0）扣减其他规则的得分。先取最高 priority，再在距最高分 `nearScore`（默认 0，范围 0–100）的候选内稳定排序和 seeded 抽选，低优先级永远不会因高分入选。冷却及持续时间的 elapsed 最小为 0。

种子记录 worldId、actorId、decisionSequence、按 key 排序的所有规则版本；SHA-256 派生 Mulberry32 初始值，与候选输入顺序及全局随机数无关。调用方必须持久化决策序号、事实来源版本和返回 seed 才能跨重启完整回放。规则版本应不可变；本模块不提供规则版本存储。

`targetKey` 是本次决策共同的目标冷却范围；针对不同对象分别决策。选择不表示执行成功，失败时不要提交建议冷却。最短持续时间返回 `retainCurrent:true`，由执行器继续现有动作；取消/紧急恢复优先通过外层硬约束处理。

有限补算仅规划普通生产/需求区间，不发工资、不补发物品。动作/订单/托管恢复必须独立完成，不能随 `skippedMs` 丢弃。每步仍由业务层校验预算、物料和配额，游标应与业务结果提交后才推进。

## 验证

工作目录 `agent-core`：

```powershell
node --test test/townClock.test.js test/townFacts.test.js test/townRuleEngine.test.js
```

覆盖计划补货规则、全部 AST 运算、缺失值/类型/权限拒绝、深度节点界限、冻结快照、1,000 次乱序回放、跨日冷却与时钟回拨、最短持续时间、切换惩罚、UTC/上海与 DST、跨午夜窗口、离线多日的 6 小时裁剪与步数聚合。
