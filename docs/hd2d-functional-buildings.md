# 功能建筑（Functional Building）分类

2026-09-09 从咖啡馆打工玩法中抽出的通用分类；2026-09-10 收口成「玩法原型 + 建筑注册表」两层声明，并落地酒馆、裁缝铺。功能建筑指“世界生成时被标记为可互动经营场所”的特殊建筑，例如咖啡馆、酒馆、裁缝铺、小卖部、花店等；一个世界可以同时存在多个功能建筑，各自拥有经营者、地点、账户、库存和服务模板。实施细节见 [功能建筑泛化](hd2d-venues-generic.md)。

## 分类定义

一个建筑成为功能建筑需要满足：

1. 它是地图上的特殊建筑（`special: true`），有稳定 `locationKey`。
2. 它绑定一位 canonical actor 作为经营者（轻量 NPC 或已关联角色均可，当前实现先以 NPC 为准）。
3. 它在 `VENUE_KINDS`（`agent-core/src/services/town/townVenuePlaybooks.js`）里登记至少一个服务，玩法取自 `VENUE_PLAYBOOKS`。
4. 它的钱、物料、订单和服务结算都走统一账本/库存/服务引擎，不另建第二套经济系统。

新增一座建筑 = 在 `VENUE_KINDS` 加一条声明；新增一种玩法 = 在 `VENUE_PLAYBOOKS` 加一条阶段机。不要在调用点拼名字、价格或阶段。

## 档案结构

当前先存进 `town_business_slices.config.functionalBuildings`，保持旧世界 `cafe` 字段兼容：

```json
{
  "businessKey": "tavern",
  "kind": "tavern",
  "actorId": "tavern-actor-id",
  "locationKey": "tavern",
  "accountId": "tavern-account-id",
  "supplierStockId": "supplier-food-stock-id",
  "stockId": "tavern-food-stock-id",
  "serviceKeys": ["town.tavern.shift", "town.tavern.help_swap", "town.tavern.buy_meal"],
  "reward": 30,
  "materialQuantity": 1,
  "resourceKey": "tavern:ingredient",
  "displayName": "镇口酒馆",
  "resourceLabel": "食材"
}
```

- `businessKey` 是该功能建筑在订单、营业状态、服务路由里的唯一键。
- `serviceKeys` 声明这座建筑支持哪些服务，必须全部登记在注册表里。
- `displayName` / `resourceLabel` 只影响文案，让同一套玩法可以换名字复用。
- 旧 `cafe` 字段继续保留：咖啡馆仍由 `slice.cafe` + `townCafeService` facade 提供，不出现在通用 `economy.venues` 列表里。

## 玩法原型与建筑声明

玩法原型决定阶段与钱物语义，建筑声明只填名字、材料、价格与产出：

| playbook | 语义 | 付款方 | 产出 | 阶段 |
| --- | --- | --- | --- | --- |
| `shift` | 当班打工 | 店方托管工资 | 无 | prep → finish |
| `help_swap` | 帮工换物 | 店方托管 0 | 1 件道具 | prep → finish |
| `custom_order` | 定做 | 玩家付费 | 1 件道具 | brief → make |
| `purchase` | 现成商品点单 | 玩家付费 | 1 件道具 | order → pickup |
| `cafe_drink` / `cafe_shift` | 冻结的旧咖啡馆玩法 | 玩家 / 店方 | 无 | menu → serving |

换名字示例：把 `tavern` 的 `displayName` 改成「面包房」、`resourceLabel` 改成「面粉」，`help_swap` 的产出换成面包，玩法原样复用；把 `custom_order` 挂到木工房就是定做家具。

## 世界生成接入

初始化蓝图里的特殊建筑应携带功能标记，例如：

```json
{
  "key": "clothing_shop",
  "name": "临街裁缝铺",
  "reusable": false,
  "maxInstances": 1,
  "footprint": { "w": 4, "h": 3 },
  "special": true,
  "functionalKind": "shop"
}
```

布局生成时，从蓝图里收集 `functionalKind` 建筑，并要求至少一个功能建筑参与布局；生成完成后把对应建筑写入 `locations`，经营者从该地点的 NPC 中指定。当前已登记 `cafe`、`tavern`、`clothing_shop` 三种；setup 只会为“玩家填了经营者与地点”的建筑建档，留空即不开启；酒馆与裁缝铺是可选行，玩家自己指定哪栋建筑开张。新增功能建筑通过显式 setup 升级，不重复初始发行，不覆盖旧账户/库存。

## 服务与玩法边界

- 每个功能建筑至少有一种“到店做事”的服务：当班（`shift`）、帮工换物（`help_swap`）、定做（`custom_order`）或点单（`purchase`）。
- 熟客（常客）由“已结算的玩家付费服务”累计，只解锁对话主题并写一条共同经历，不发钱发物；口径与实现见 [功能建筑熟客系统](hd2d-venue-regulars.md)。
- 玩家配送单不作为功能建筑玩法；补货、原料运输由内部物流完成，不暴露给玩家。补货由 `maintainTownVenueRestock` 按建筑独立判断缺货与预算。
- 产出道具必须登记在 `venueProductTemplates()` 与 `itemTemplateService` 的效果白名单 `EFFECT_KINDS` 中，模型不能创造钱和道具。
- 敏感主题（如涉及成人内容的场所）需要单独功能开关与内容边界，不默认出现在所有世界观。

## 迁移

- 旧世界没有 `functionalBuildings` 时，继续按 `cafe` 字段读取，行为不变。
- 新世界 setup 在存在 4 位以上居民与 `cafe` 地点时，会创建咖啡馆档案；酒馆与裁缝铺作为可选行始终可选，留空不开启。
- 咖啡馆的冻结模板、已存档会话与回执字节保持不变；新增建筑走注册表模板，版本变化必须显式升级。
