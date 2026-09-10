# 功能建筑泛化：注册表与两种新玩法

2026-09-10。把咖啡馆 A 链抽成「玩法原型（playbook）+ 建筑注册表（venue kind）」两层声明，并落地酒馆、裁缝铺、客栈、书斋四种可换名复用的功能建筑。硬约束：咖啡馆的冻结模板、已存档会话与回执字节不变。

## 为什么这样泛化

咖啡馆此前把 businessKey、材料、阶段名、目录文案、托管语义都写在 `townCafeService.js` 里；每加一座建筑就要复制一份服务引擎。现在：

- 一座建筑 = `townVenuePlaybooks.js` 里一条 `VENUE_KINDS` 声明（名字、材料、预算、服务列表、产出）。
- 一种玩法 = 一条 `VENUE_PLAYBOOKS` 声明（谁付费、有没有产出、阶段与动作、时长上限）。
- 引擎、账本、库存、订单、补货、经历回执与前端面板都按这两份声明工作，不新增第二套经济或服务实现。

换名字只改声明：把 `tavern` 的 `displayName` 改成「面包房」、`resourceLabel` 改成「面粉」、把产出换成面包，玩法（当班 / 帮工换物）原样复用；把 `custom_order` 挂到木工房就是定做家具；把 `lodging` 挂到温泉、澡堂、静室就是换汤不换药的「泡/住一阵再走」；把 `lesson` 挂到武馆、琴房、花艺班就是「先生教一手、你亲手做一件」。

生活侧入口同样泛化：任务与玩法不再挂在顶栏「生活」按钮里，而是回到地图上的建筑与经营者，见 [生活入口回到世界里](hd2d-life-entry-in-world.md)。

## 三层结构

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 声明 | `agent-core/src/services/town/townVenuePlaybooks.js` | `VENUE_PLAYBOOKS` 玩法原型、`VENUE_KINDS` 建筑声明、`venueServiceTemplate` 冻结模板、`venueServiceCatalog` 目录、`venueProductTemplates` 产出清单 |
| 引擎 | `agent-core/src/services/town/townVenueService.js` | offer/accept/turn/cancel/get/list/listCatalog/recover/failForRebuild；按 playbook 驱动阶段、托管、退款、材料占用、道具发放与回执 |
| 冻结实例 | `agent-core/src/services/town/townCafeService.js` | 只剩 facade：注入咖啡馆专用解析器，`CAFE_SERVICE` / `CAFE_WORK_SERVICE` 导出与持久化字节保持原样 |

`venueServiceTemplate` 只冻结 key/version/price/wage/materialQuantity/outcomeKey 与时长五件套，不写 playbook；老咖啡馆模板因此逐字节不变，`assertFrozenTemplate` 仍是严格全字段比对。

## 玩法原型

| playbook | 语义 | 付款方 | 产出 | 阶段（接受后进入） | 可套用的建筑举例 |
| --- | --- | --- | --- | --- | --- |
| `shift` | 当班打工 | 店方托管工资 | 无 | prep → finish（先 `work` 再 `serve`） | 酒馆、裁缝铺、便利店、书店 |
| `help_swap` | 帮工换物 | 店方托管 0 | 1 件道具 | prep → finish | 面包房、花店、药铺 |
| `custom_order` | 定做 | 玩家付费 | 1 件道具 | brief → make | 裁缝铺、木工房、陶艺店 |
| `purchase` | 现成商品点单 | 玩家付费 | 1 件道具 | order → pickup | 酒馆、面包房、花店 |
| `lodging` | 投宿歇脚 | 玩家付费 | 1 件道具 | checkin → resting | 客栈、茶馆、温泉、澡堂、静室 |
| `lesson` | 跟着学一手 | 玩家付费 | 1 件道具 | ask → practice | 书斋、武馆、琴房、花艺班 |
| `cafe_drink` / `cafe_shift` | 冻结的旧咖啡馆玩法 | 玩家 / 店方 | 无 | menu → serving | 仅咖啡馆，用于字节兼容 |

零金额玩法（`help_swap`）不建托管账户、不写 0 元分录；取消只释放材料占用。

## 本轮落地的四座建筑

| 建筑 | businessKey | 材料 | 服务 | 价格/工资 | 产出 |
| --- | --- | --- | --- | --- | --- |
| 镇口酒馆 | `tavern` | 食材 | `town.tavern.shift` | 26 邻币/班（店方托管） | — |
| 镇口酒馆 | `tavern` | 食材 | `town.tavern.help_swap` | 0（以工换物） | 酒馆热食（`tipsy`，沿用微醺糖果效果） |
| 镇口酒馆 | `tavern` | 食材 | `town.tavern.buy_meal` | 12 邻币 + 1 份食材 | 酒馆热食（`tipsy`） |
| 临街裁缝铺 | `clothing_shop` | 布料 | `town.clothing.custom_order` | 22 邻币 + 1 份布料 | 定做的浴衣（`yukata`，24 小时外观） |
| 临街裁缝铺 | `clothing_shop` | 布料 | `town.clothing.shift` | 22 邻币/班（店方托管） | — |
| 镇东客栈 | `inn` | 铺盖 | `town.inn.stay` | 16 邻币 + 1 份铺盖 | 客栈醒神茶（`energy`，沿用元气符咒效果） |
| 镇东客栈 | `inn` | 铺盖 | `town.inn.shift` | 24 邻币/班（店方托管） | — |
| 街尾书斋 | `study` | 纸墨 | `town.study.lesson` | 14 邻币 + 1 份纸墨 | 手抄的静心小笺（`mood_fix`） |
| 街尾书斋 | `study` | 纸墨 | `town.study.shift` | 20 邻币/班（店方托管） | — |

产出模板由 `venueProductTemplates()` 在 `setupTownEconomy` 时一次性发布（`itemTemplateService.ensureVenueTemplates`），效果白名单在 `EFFECT_KINDS` 显式登记，模型不参与。

四座建筑还各自声明了 `regular` 熟客档案：玩家在同一家店正常消费达到阈值，店主会把他记成熟客并解锁一段独特对话主题，只加内容不加钱物。口径与实现见 [功能建筑熟客系统](hd2d-venue-regulars.md)。

## 接入点

- 世界配置：`townBusinessService.setup` 按 `VENUE_KINDS` 为每座被请求的建筑建账户、供货库存、店内存货与档案；重复 setup 不重复发行，改经营者/地点抛 `SLICE_CONFLICT`。
- 订单：`townOrderService` 的 `orderKind` 直接取 `businessKey`（工坊仍写旧 config）；`maintainTownVenueRestock` 按建筑独立判断缺货与预算。
- 服务路由：`townEconomyRuntime.executeTownService` / `getTownService` 按 `serviceKey` 分派到 `context.cafe`（咖啡馆键）、`context.venues`（注册表键）或 `context.services`（工坊键）。
- 经历：`townExperienceService` 新增通用回执校验分支，核对 `outcomeKey`、付款方金额口径、产出 `itemIds` 与背包溯源。
- 前端：`web-ui/src/components/town/TownVenueServicePanel.vue` 以 `businessKey` 为参数复用同一套游戏化暖纸舞台与 `LinsheButton`；世界里点建筑或掌柜即进店（面板从 `economy.venues[]` 里读自己的服务清单、库存、营业状态与熟客进度）。

## 本轮修掉的串扰

1. **咖啡馆不能出现在通用 venue 视图。** 咖啡馆档案同时写在 `slice.cafe` 与 `functionalBuildings`；通用视图若不排除它，会对未注册的 `town.cafe.*` 键解析目录并抛 `INVALID_SERVICE_KEY`，让 `/api/town/economy` 直接 500。现在 `getTownEconomyState().venues` 显式排除 `cafe`。
2. **工坊只列自己的会话。** `townServiceSessionService.list` 原来会把所有会话都按工坊定义解析；玩家有咖啡馆或功能建筑会话时会 500。现在只返回工坊模板的会话，咖啡馆与功能建筑各自过滤。
3. **生产队列只认工坊付费服务。** `maintainTownProductions` 原来扫描所有已完成会话并调用 `production.start`，遇到咖啡馆/功能建筑会话会抛 `PAID_SERVICE_REQUIRED`。现在按工坊账户过滤，非工坊会话不进入队列。

## 验证

```powershell
# 工作目录：agent-core
node --test --test-reporter=spec test/townVenueChain.test.js
node --test --test-reporter=spec test/townVenueRuntime.test.js
node --test --test-reporter=dot --test-concurrency=4 test/*.test.js

# 工作目录：web-ui
node --test test/town-life-api.test.mjs
npm.cmd run build -- --outDir ../output/hd2d-venue/ui-build
```

- `townVenueChain`（服务层 15 项）：注册表建档（含客栈/书斋的账户、库存与产出）、字节兼容、当班/换物/定做/点单/投宿/学艺六条阶段机、幂等重放、经营者离店退款、按 businessKey 补货、熟客计数。
- 新增覆盖：`town.inn.stay` 从 checkin 走到 resting 再退房发茶、`town.study.lesson` 从 ask 走到 practice 再发小笺，以及投宿前的整额退款与铺盖释放。
- `townVenueRuntime`（真实运行层）：真实 runtime + 真实模拟走通酒馆当班、帮工换物、裁缝铺定做；同时锁住上面三个串扰。
- 全量后端 673 项（TAP 顶层计数，含本轮新增的 4 项客栈/书斋用例）、前端 API/单元测试 34 项与生产构建在本轮通过；世界里点建筑进店由 `town-view-browser.mjs` 覆盖。

## 边界与未做

- 世界生成尚未自动把 `tavern` / `clothing_shop` / `inn` / `study` 写进蓝图；setup 里的功能建筑是可选行，玩家自己指定经营者与地点，留空即不开启。
- 产出全部沿用现有道具效果（`tipsy` / `yukata` / `energy` / `mood_fix`），没有新增装备或住宿系统；投宿只是“付费 → 歇一阶段 → 退房拿茶”的服务会话，不写日程、不改作息。
- 熟客系统（D 链「独特对话主题」分支）与酒馆点单已在同日补上，见 [功能建筑熟客系统](hd2d-venue-regulars.md)；「一次预约」分支仍未实现。
- 长期经济平衡、正式生活帖、Android 真机与真实存档人工验收仍未进行。
