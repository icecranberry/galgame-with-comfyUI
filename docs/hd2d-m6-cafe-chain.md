# HD2D M6 咖啡馆 A 链：固定契约、补货与饮品服务

2026-09-09 按 [下一切片交接](hd2d-m6-cafe-next-slice.md) 完成后端固定经营契约、有预算补货配送和固定手冲咖啡服务。同日用户确认不再以送货为玩家玩法，因此新增“打工 / 临时代班”模式：玩家到咖啡馆当班领工资，配送只保留为内部物流兼容，不再作为新世界玩家入口。未接入正式生活帖/活动卡，也未完成天气客流、安卓真机与真实存档人工验收。

## 已落地

- **固定经营合同。** `townBusinessService.setup` 可选接收 `npcActorIds.cafe` 与 `locationKeys.cafe`；老世界在补传前保持原 config 字节不变，旧工坊请求/收据 source hash 不受影响。已有 slices 可在同一 epoch 显式升级，重建不会重复初始发行。
- **独立账目与物料。** cafe 账户初始 600 邻币，`cafe:coffee_bean` 独立于 `delivery:raw_material`；供货方与咖啡馆各有一个 stock，不复用工坊 stockId。配送报酬仍为 30，从咖啡馆账户支付，不从公共基金支付。
- **补货命令。** `orders.publish` 支持 `businessKey:'cafe'`，发布/领取/交付/取消/过期/重建均复用真实到达与托管边界。运行时在咖啡馆可用豆子 <=2、无在途咖啡馆委托、供货方有货且账户有预算时自动发布一份补货单；重复 tick 由业务请求幂等和 active 检查防止重复发单。
- **固定饮品服务。** 新增独立 `townCafeService.js`，价格 18、每次消耗 1 份豆子，菜单→冲煮两阶段，取消未冲煮全退，完成才结算；不产出背包道具，收据 `itemIds:[]`。模型缺失/失败不会卡流程，因为本地流程本身完整。
- **正式经历。** `townExperienceService` 识别咖啡馆收据并写入同一经历/记忆管道；工坊免费回访只认 `town.workshop`，不会把咖啡馆结算变成回访源。
- **兼容。** 工坊配送订单 config 保持旧字节，信箱任务卡继续验证；原工坊服务、B 链、流动性政策、M3 工作适配均未改变。前端 API 已放开 `businessKey:'cafe'` 与 `town.cafe.drink_coffee`。
- **打工 / 临时代班。** 新增 `town.cafe.work_shift`：玩家到店接受班次，咖啡馆把 24 邻币工资托管进 escrow，完成固定小任务后付给玩家，取消则全额退回咖啡馆；不要求玩家垫付，也不使用玩家配送委托。
- **游戏化 UI 锚点。** 生活面板在有咖啡馆时隐藏配送入口，改为“去咖啡馆打工”；打工/饮品共用 `TownDialogueStage` 的 SVG 暖纸舞台，新增 `TownCafeWorkPanel.vue`。

## 验证

- 新增 `agent-core/test/townCafeChain.test.js` 6 项：切片共存不重复发行、咖啡馆配送、饮品服务结算/取消、打工发薪/取消退薪。
- 完整后端检查点：`@agent-core` 下 `node --test --test-reporter=spec --test-concurrency=4 test/*.test.js`，**657/657 通过**，116.1s，日志 `output/hd2d-cafe-work-backend-checkpoint.log`。
- 前端 API：`web-ui/test/town-life-api.test.mjs` **6/6 通过**。
- 隔离构建：`web-ui` 下 `npm.cmd run build -- --outDir ../output/hd2d-cafe-work/ui-build`，243 modules 通过；仅既有混合导入与 chunk 体积警告。

## 尚未完成

- 咖啡馆打工入口与游戏化暖纸面板已接入；信箱咖啡馆任务卡仍待接入。
- 天气只影响有界需求选择的规则未实现；当前补货按固定阈值自动发布。
- 正式生活帖/活动卡源适配仍按 [生态矩阵](hd2d-m6-integration-matrix.md) 属于后续工作。
- 长期回放、断货/预算耗尽、Android 真机与真实存档人工操作尚未加入本轮咖啡馆路径验收。
