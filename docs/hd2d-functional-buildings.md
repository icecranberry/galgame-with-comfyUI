# 功能建筑（Functional Building）分类

2026-09-09 从咖啡馆打工玩法中抽出的通用分类。功能建筑指“世界生成时被标记为可互动经营场所”的特殊建筑，例如咖啡馆、服装店、小卖部、酒馆等；以后一个世界可以同时存在多个功能建筑，各自拥有经营者、地点、账户、库存和服务模板。

## 分类定义

一个建筑成为功能建筑需要满足：

1. 它是地图上的特殊建筑（`special: true`），有稳定 `locationKey`。
2. 它绑定一位 canonical actor 作为经营者（轻量 NPC 或已关联角色均可，当前实现先以 NPC 为准）。
3. 它至少注册一个服务模板，例如 `town.cafe.work_shift`、`town.cafe.drink_coffee`。
4. 它的钱、物料、订单和服务结算都走统一账本/库存/服务引擎，不另建第二套经济系统。

## 档案结构

当前先存进 `town_business_slices.config.functionalBuildings`，保持旧世界 `cafe` 字段兼容：

```json
{
  "businessKey": "cafe",
  "kind": "cafe",
  "actorId": "cafe-actor-id",
  "locationKey": "cafe",
  "accountId": "cafe-account-id",
  "supplierStockId": "supplier-bean-stock-id",
  "stockId": "cafe-bean-stock-id",
  "serviceKeys": ["town.cafe.work_shift", "town.cafe.drink_coffee"],
  "reward": 30,
  "materialQuantity": 1,
  "resourceKey": "cafe:coffee_bean"
}
```

- `businessKey` 是该功能建筑在订单、营业状态、服务路由里的唯一键。
- `serviceKeys` 声明这座建筑支持哪些服务；首个实例只实现 `work_shift` 与 `drink_coffee`。
- 旧 `cafe` 字段继续保留，避免已生成存档与 source hash 变化；新世界写 `functionalBuildings`。

## 世界生成接入

初始化蓝图里的特殊建筑应携带功能标记，例如：

```json
{
  "key": "clothing_shop",
  "name": "临街服装店",
  "reusable": false,
  "maxInstances": 1,
  "footprint": { "w": 4, "h": 3 },
  "special": true,
  "functionalKind": "shop"
}
```

布局生成时，从蓝图里收集 `functionalKind` 建筑，并要求至少一个功能建筑参与布局；生成完成后把对应建筑写入 `locations`，经营者从该地点的 NPC 中指定。当前首例是 `cafe`；后续增加服装店、小卖部、酒馆时，只需把新的功能建筑档案注册进 `functionalBuildings`，并添加对应的服务模板，不需要改经济引擎。

## 服务与玩法边界

- 每个功能建筑至少有一种“到店做事”的服务，当前先统一用 `work_shift`：玩家到店当班，咖啡馆/店铺把工资托管进 escrow，完成后付给玩家，取消退回店铺。
- 后续可按 `kind` 增加专属服务：服装店 `tailor_alteration`、小卖部 `restock_counter`、酒馆 `night_shift` 等。
- 玩家配送单不作为功能建筑玩法；补货、原料运输由内部物流完成，不暴露给玩家。
- 敏感主题（如涉及成人内容的场所）需要单独功能开关与内容边界，不默认出现在所有世界观。

## 迁移

- 旧世界没有 `functionalBuildings` 时，继续按 `cafe` 字段读取，行为不变。
- 新世界 setup 在存在 4 位以上居民与 `cafe` 地点时，会创建 `functionalBuildings` 档案。
- 后续新增功能建筑通过显式 setup 升级，不重复初始发行，不覆盖旧账户/库存。
