# AI 小镇 v3：HD-2D、游戏化对话、经济生态与可扩展逻辑引擎

> 分支：`ai-town`
> 日期：2026-09-07
> 状态：规划稿，待实施
> 前序文档：`ai-town-plan.md` 的 v2 已实现，本计划在其上继续，不推翻已调通的寻路、NPC 作息、初始化向导和 SSE 基础。

---

## 1. 结论与可行性

### 1.1 核心结论

可以把当前 AI 小镇升级成接近《八方旅人》观感的 HD-2D 小镇，但不是直接复刻 Unreal 引擎的逐像素渲染。当前项目已经具备以下基础：

- 地图是 45° 等距的瓦片世界，地面、建筑、角色已经分离绘制。
- 建筑和角色使用独立透明 PNG 精灵，天然支持“立起来”的表达。
- 已有 y 深度排序、建筑遮挡、昼夜天气叠加、基本角色投影。
- NPC、入住角色、玩家都已经有正式立绘或可生成的 900×1600 立绘。
- 宝箱系统已经有稳定的道具效果模板 `ITEM_EFFECTS` 和 `backpack_items` 数据链路。
- 小镇已有 L0 移动模拟、L1 规则触发、L2 LLM 事件三层结构。

因此，本计划的可行路线是：

1. 保留现有等距逻辑坐标、A* 寻路和服务端权威移动。
2. 在 Canvas 2D 渲染层升级为 HD-2D 合成管线，不引入 WebGL 或 Three.js 作为第一阶段依赖。
3. 通过高分辨率素材、方向投影、软阴影、分深度带移轴模糊、太阳光、色彩分级来模拟 HD-2D。
4. 将当前浮动聊天面板升级为覆盖世界的立绘加游戏对话框。
5. 以整数账本和物品实例为基础建立可验证的封闭经济。
6. 建立声明式规则引擎和外部系统效果网关，让 NPC、商店、委托、奇遇、聊天、朋友圈、信箱、日程、记忆和背包真正互相驱动。

### 1.2 已核对的现状

| 项目 | 核对结果 |
|---|---|
| 当前分支 | `ai-town` |
| 当前渲染 | `web-ui/src/views/TownView.vue` 使用纯 Canvas 2D 绘制 45° 等距世界 |
| 当前素材 | 已存在 `town_assets` 和本地素材目录；样例建筑约为 224×224 到 288×384，建筑和 NPC 均为透明 PNG |
| 当前立绘 | NPC 有 900×1600 立绘，角色可复用 `standing_url`，玩家也有 `player_portrait` |
| 当前对话 | `TownNpcChat.vue` 已经有旁侧立绘，但消息仍是聊天气泡，不是游戏对话框 |
| 当前经济 | 没有钱包、账本、商店、NPC 资金、委托和定价系统 |
| 当前道具 | `itemService.js` 中有 `ITEM_EFFECTS` 模板、开箱、收下、使用、丢弃和效果链路 |
| 当前规则 | `townService.js` 已有 FSM 作息、相遇规则、问候规则和 LLM 队列，但规则是内联硬编码 |
| 当前数据 | 数据库中有 48 张小镇素材、8 个 NPC，但 `town_maps` 为 0，尚未存在正式确认开镇的地图 |
| 后端测试 | 显式运行 `node --test test/*.test.js src/services/town/*.test.js` 为 19/19 通过 |
| 测试脚本 | `npm test` 目前只匹配 `test/*.test.js`，漏掉 `src/services/town/*.test.js` |
| 前端构建 | 核对期间 `TownImageEditor.vue` 曾处于删除状态并导致构建失败；随后该文件已在工作树中恢复并修改，输出到临时目录的构建通过。当前工作树还有其他未提交修改，实施前不得整体重置 |

### 1.3 可行性判断

**HD-2D 渲染：可行。**

- 不需要重写地图逻辑。
- Canvas 2D 的离屏画布、`ctx.filter = 'blur()'`、多个深度带画布和预缓存阴影可以覆盖当前 50×50、最多十余名居民的场景。
- 远景移轴模糊只作用于世界画布，不作用于 HUD、对话框和立绘。
- 性能降级路径明确：低端设备关闭景深、减少深度带、使用简单椭圆投影。

**游戏对话框：可行且成本较低。**

- 立绘资产已经存在。
- 当前 `TownNpcChat.vue` 可以平滑演进为 `TownDialogue.vue`，无需重新生成立绘。

**经济系统：可行。**

- 宝箱已有可复用效果模板，商店和 NPC 库存可以共享同一套道具生成与效果落地逻辑。
- 采用整数最小货币单位、追加式账本和 SQLite 事务，可以保证购买、出售、发薪、补货、委托奖励的一致性。
- NPC 的资金、库存和价格完全由纯事件规则驱动，LLM 只负责可选文案和明确主题的互动叙事。

**可扩展逻辑引擎：可行。**

- 现有 L0/L1 可以保留，L1 以上抽成声明式规则。
- 条件使用受限路径和操作符，动作使用注册表，不使用 `eval`，可以做到安全、可测试、可审计。
- LLM 仅在确定性规则无法覆盖，或需要生成叙事内容时介入，并始终返回经过校验的结构化 JSON。

---

## 2. 设计边界与原则

### 2.1 要做的

- 保持现有等距地面和逻辑坐标，不把 2D 逻辑世界改成真 3D。
- 让建筑、道具、角色看起来立起来，拥有统一光照方向、接触阴影和远处景深。
- 将 NPC 和角色对话统一成覆盖世界的“立绘 + 对话框”体验。
- 建立玩家钱包、NPC 钱包、账本、商店库存、委托、付费服务和受控资金循环。
- 建立声明式逻辑引擎和活动日志，驱动 NPC 与小镇生态。
- 建立有明确主题、可由 AI 判断结束、结束会真正落库和结算的互动会话。
- 把小镇事件与朋友圈、奇遇、聊天、群聊、信箱、日程、背包、记忆、关系、外观系统联动。
- 所有新功能带开关、迁移、回滚和测试。

### 2.2 不做的

- 第一阶段不重写为 WebGL/Three.js 真 3D 渲染。
- 不把《八方旅人》的镜头语言、逐帧动态光影或复杂粒子系统作为硬指标，只追求可识别的 HD-2D 风格。
- 不为了 NPC 经济模拟给所有 NPC 建立完整聊天角色的重负担大脑。
- 不让 LLM 直接改钱、改物品或改数据库，只允许其输出经过后端校验的意图。
- 不引入新的整体 UI 风格；界面继续遵循 `docs/design-system.md`。

### 2.3 兼容和回滚

- 新增 `render_profile`，已有世界默认 `legacy_v2`，新世界默认 `hd2d_v1`。
- `legacy_v2` 保留当前绘制路径，直到 HD-2D 视觉验收通过。
- 经济、逻辑和主题互动均由 feature flag 控制。
- 资产升级按 kind 分批执行，不删除旧图直到新图生成成功。
- 地图对象、POI、NPC、相遇记录和聊天记录保持不动。
- 重置世界时才清理经济、委托、规则状态和互动会话，正常升级不清理。

---

## 3. HD-2D 渲染升级

### 3.1 视觉目标

目标不是引擎级复刻，而是达到以下可辨识特征：

- 高分辨率手绘质感建筑和道具。
- 低分辨率像素角色与高精度环境形成对比。
- 建筑和角色有统一方向的软投影和接触阴影。
- 地面保持等距顶面，但具备更丰富的材质、AO 和色彩层次。
- 远景和近景轻微失焦，玩家所在焦点带清晰。
- 有柔和的太阳光束、暖色或冷色分级和暗角。
- 对话立绘和 UI 永远保持清晰，不参与景深。

### 3.2 素材规格

| kind | 当前 | HD-2D 目标 | 变化 |
|---|---:|---|---|
| ground | 1536×1536，像素化 64×32 | 2048×2048，处理为 128×64 或 256×128 | 提高地面质感，保留顶面菱形裁切和锚点 |
| road | 同 ground | 同 ground | 同上 |
| building | 1536×1536/2048，像素化到占格宽度 | 2048×2048，特殊建筑 2048×2732，不像素化 | 保留贴纸式裁切、无底座；提高细节和轮廓 |
| prop | 512×512，像素化 64×64 | 1024×1024 或 1536×1536，不像素化 | 更清晰的道具轮廓和材质 |
| npc/player sprite | 600×800，正/背 | 600×800 起步，先保留正/背，后续可扩展四方向和 2 帧行走 | 保持像素小人，渲染采用 nearest 或整数倍缩放 |
| portrait | 900×1600 | 保持 | 不重做，除非用户主动重生成 |

新建筑 prompt 方向：

- `HD-2D diorama cutout`
- `high-detail hand-painted texture`
- `45-degree isometric view`
- `two visible walls and roof`
- `strong readable silhouette`
- `pure white background`
- `clean straight bottom cutout`
- `no ground, no base, no platform`
- `soft baked ambient occlusion`
- `cinematic but restrained color palette`

新道具和地面 prompt 由 `townPromptBuilder.js` / `townAssetService.js` 扩展，不新增第二套 prompt 生成逻辑。

### 3.3 渲染管线

保留现有屏幕坐标换算、拾取、移动插值、A* 和服务端 tick。渲染拆成以下合成层：

```text
far ground band (blur)
far object/agent band (blur)
mid-far band (light blur)
focus band (sharp, centered on player)
mid-near band (light blur)
near band (blur)
weather overlay
god rays / bloom
color grade / vignette
HUD and dialogue (outside canvas, never blurred)
```

实现要点：

- 静态地面和道路仍烘焙到离屏画布。
- 按世界 y 深度把静态地面切成 5 个深度带缓存。
- 建筑、道具、角色按其底部锚点归入深度带，带内继续按 y 排序。
- 深度带在相机或焦点变化时重绘，不逐帧无条件 `filter` 大画布。
- `ctx.filter` 不支持时降级为 3 个深度带，或使用服务端预模糊素材。
- 动态角色的拾取仍基于未模糊的逻辑坐标，不受视觉模糊影响。
- 当前 `objectOccludes` 的遮挡判断保留，并统一改为使用新的合成顺序。

### 3.4 投影

- 新增 `townSettings` 中的 `sunAzimuthDeg`、`sunAltitudeDeg`、`shadowOpacity`。
- 建筑和大型道具使用资产 alpha 轮廓预生成方向投影缓存，而不是要求 ComfyUI 在每张图里画投影。
- 投影先画在单独阴影层，再画对象和角色。
- 角色使用更明显的方向软投影，动画时投影与脚底锚点保持稳定。
- 旧素材无 alpha 轮廓缓存时，先按 footprint 菱形生成兼容投影。
- 建筑遮挡时仍使用现有半透明规则，后续可增强为轮廓遮挡或正片叠底阴影。

### 3.5 移轴模糊

- 焦点平面跟随玩家世界 y。
- 远、近景使用 5 带高斯模糊，带间使用透明渐变羽化。
- 只在世界画布内做，不套 `backdrop-filter`。
- 对话、商店、委托和 HUD 保持锐利。
- 设置中允许关闭、调节强度，移动端默认降低强度或关闭。

### 3.6 数据模型和迁移

`town_assets.meta_json` 新增：

```json
{
  "renderProfile": "hd2d_v1",
  "renderVersion": 1,
  "pixelStyle": "environment|character",
  "shadowSource": "alpha|footprint|none",
  "heightTiles": 3,
  "renderScale": 1
}
```

`town_maps.layers_json` 顶层可增加：

```json
{
  "renderProfile": "hd2d_v1",
  "camera": {
    "yaw": 45,
    "sunAzimuthDeg": 135
  }
}
```

迁移策略：

- 旧素材不立即失效，进入兼容模式。
- 管理面板增加“一键升级到 HD-2D 素材”按钮，只重生成 building/prop/sprite，保留地图和 NPC 数据。
- 每次生成成功后覆盖 `updatedAt`，与现有 URL 缓存穿透机制一致。
- 新世界初始化直接使用 HD-2D 参数。

### 3.7 验收标准

- 同一地图在 `legacy_v2` 和 `hd2d_v1` 都能运行。
- 建筑、角色、玩家均有方向投影，建筑脚下没有底座或地砖穿帮。
- 玩家移动时焦点带跟随，远景有可见但克制的模糊。
- 缩放、拖拽、双击跟随、WASD、编辑器工具在景深开启后仍正确。
- 桌面目标 60 FPS，低端或移动端可降级到 30 FPS 并自动减少效果。
- 多端断线重连后地图版本和视觉参数一致。
- 保存多张桌面和移动端验收截图到 `output/`。

---

## 4. 游戏化立绘对话

### 4.1 组件方案

新增 `web-ui/src/components/town/TownDialogue.vue`，由 `TownView.vue` 统一使用，兼容 NPC、入住角色和特殊会话。

组件输入建议：

```text
actorKey
actorType        npc | character | player | encounter
actorName
job
portraitUrl
mood
mode             chat | menu | shop | service | quest | encounter
lines
options
sending
canContinue
```

布局目标：

- 世界保持可见，不弹整页遮罩。
- 立绘从屏幕下方进入，人物脚下与对话框形成视觉连接。
- 对话框为底部横贯布局，桌面端立绘居左或居右，窄屏自动压缩。
- 对话文字使用打字机或分段揭示，点击继续不会误触发世界移动。
- 历史记录可折叠显示，但默认只显示当前对白。
- 商店和服务菜单显示物品卡、价格、数量、确认按钮。
- 主题互动显示明确目标、进度、剩余步数和可选行动。
- 结束动画播放后真正关闭会话并刷新钱包、背包、日志和 NPC 状态。

### 4.2 立绘解析优先级

| 对象 | 优先级 |
|---|---|
| NPC | `npc_{id}_portrait` → 头像或占位 |
| 入住角色 | `characters.standing_url` → `char_{id}_portrait` → 头像 |
| 玩家 | `player_portrait` → 用户外观占位 |
| 多人相遇 | 当前说话者立绘为主，旁边可显示另一人小头像 |

所有立绘生成继续走现有 `townNpcService.generateNpcPortrait`、`generateCharacterPortrait` 和 `characterPersona.js` 的统一入口，禁止各页面重新写外观截取正则。

### 4.3 对话数据

- NPC 普通聊天继续使用 `town_npc_chat_messages`。
- 多人相遇继续使用 `town_chat_messages`。
- 商店、服务、委托和主题会话新增统一 `town_interaction_sessions` 和 `town_interaction_messages`。
- 对话结束后，可在关系、记忆、朋友圈或奇遇中产生后续结果，但普通打招呼不强制写 LLM 记忆。

### 4.4 UI 规范

- 常规按钮使用 `LinsheButton`。
- 文本输入使用 `LinsheInput`。
- 下拉筛选使用 `LinsheSelect`。
- 开关使用 `LinsheSwitch`。
- 视觉小说式选项是既有独立交互模式，可沿用 `EventCard.vue` 的 `div role="button"` 风格，不套通用按钮。
- 对话框使用近实心的暖色面板，避免 `backdrop-filter`。
- 不嵌套卡片；商店物品卡只作为重复单项。
- 移动端检查姓名、价格、按钮文字不溢出、不遮挡立绘。
- 对话关闭后恢复 TownView 的键盘和镜头控制。

---

## 5. 经济系统

### 5.1 货币原则

- 单货币，内部使用整数最小单位 `amount_minor`。
- UI 显示名称可配置，默认“金币”。
- 所有资金变动经过同一 `townEconomyService`，使用 SQLite 事务。
- 钱包余额不可为负。
- 所有交易追加写入账本，不做覆盖式余额历史。
- 价格和补货逻辑是纯确定性规则，LLM 不决定数值。

### 5.2 核心表

```sql
CREATE TABLE town_wallets (
  owner_key TEXT PRIMARY KEY,               -- 'me' | 'npc:27'
  owner_kind TEXT NOT NULL,
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK(balance_minor >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME
);

CREATE TABLE town_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id TEXT NOT NULL,
  debit_owner_key TEXT,
  credit_owner_key TEXT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  reason_key TEXT NOT NULL,
  reason_json TEXT DEFAULT '{}',
  source_type TEXT NOT NULL,
  source_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE town_shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_id INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'common',
  payload_json TEXT DEFAULT '{}',
  image_url TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  base_price_minor INTEGER NOT NULL,
  current_price_minor INTEGER NOT NULL,
  restock_at DATETIME,
  source_rule_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE town_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  giver_npc_id INTEGER,
  location_id INTEGER,
  goal_type TEXT NOT NULL,
  goal_json TEXT NOT NULL,
  reward_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  expires_at DATETIME,
  seed TEXT NOT NULL,
  source_rule_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
```

### 5.3 钱包与账本

- `applyTransfer({debitKey, creditKey, amount, reason, source})` 是唯一资金入口。
- 同一 SQLite 事务内检查余额、更新双方版本、写一条账本。
- 若只有玩家与 NPC，内部闭环；若系统奖励或维护费，使用 `system_treasury` 作为源或汇。
- 服务退费、任务失败补偿、取消委托都走明确 reason，避免隐形改钱。
- 提供 `getEconomyState()` 返回玩家余额、NPC 资金摘要、近期账本和总流通量。

### 5.4 玩家赚钱渠道

| 渠道 | 机制 | LLM | 说明 |
|---|---|---:|---|
| 每日委托板 | 确定性生成送货、跑腿、采集、传话等目标 | 否 | 主循环，服务器校验完成条件 |
| 向 NPC 出售道具 | 复用宝箱道具模板和背包实例 | 否 | NPC 按职业接受不同类别 |
| 付费服务奖励 | 服务成功或达成目标后给钱或道具 | 可选 | 奖励由服务合约白名单决定 |
| 主题互动奖励 | AI 判断结束后，按主题合约结算 | 是 | 数值仍由后端限制 |
| 跨系统事件奖励 | 奇遇、朋友圈、信箱任务完成后回写小镇 | 否或按原系统 | 通过外部效果网关 |
| 每日补贴或开镇奖励 | 有上限，不能成为刷钱入口 | 否 | 可配置关闭 |

### 5.5 NPC 库存和服务

- `town_shop_items.template_key` 直接引用 `ITEM_EFFECTS` 的 key。
- 库存由每日种子、NPC 职业、POI、库存上限和钱包余额生成。
- 补货是规则效果，不在 tick 中写 LLM 调用。
- 玩家购买时：
  - NPC 钱包减少，玩家钱包增加，实际为买方付钱、卖方收钱。
  - 库存减一。
  - 从缓存或异步生成创建 `backpack_items`。
- 玩家出售时：
  - 校验背包道具可用且未生效。
  - 删除或标记玩家背包实例。
  - 创建 NPC 商店库存行。
  - 资金从 NPC 流向玩家。
- 价格波动限制在基础价的 0.5 到 1.8 倍，防止套利刷钱。
- 同一道具图片优先复用 `item_visual_cache`，没有缓存才异步生图。

### 5.6 内循环和资金锚点

- `system_treasury` 每日向 NPC 发放有限工资。
- NPC 补货时向 treasury 支付进货和维护费。
- 玩家消费流回 NPC，玩家出售消耗 NPC 资金，玩家做委托从 NPC 获得工资。
- NPC 与 NPC 之间可做纯模拟交易，只写钱包、库存和活动日志。
- 全局资金总量默认守恒，只有配置好的每日奖励池允许新增货币。
- 价格、工资、奖励都有上下限，避免通货膨胀和无限刷取。

### 5.7 付费服务

服务定义示例：

```json
{
  "key": "fortune_telling",
  "name": "占卜服务",
  "priceMinor": 2000,
  "paymentMode": "upfront",
  "allowedOutcomes": ["mood_hint", "small_reward"],
  "maxTurns": 4,
  "needsLLM": true,
  "theme": "给玩家占卜一件与小镇最近事件有关的事"
}
```

- 服务启动、进行、结束都记录会话。
- 付费方式支持 `upfront`、`on_complete`、`per_turn`，默认 `upfront`。
- LLM 失败、用户取消或超时按合约退款或部分结算。
- 服务效果只能命中合约白名单，例如心情提示、临时 buff、小额奖励、关系变化、朋友圈触发。

### 5.8 UI 和 API

- 顶部 HUD 显示余额。
- 新增“委托板”和“小镇动态”面板，复用现有暖色浮层风格。
- 钱包和账本从余额 chip 展开，不进背包弹窗。
- 商店入口通过 NPC 对话框的“商店”或“服务”操作进入。
- 新增 SSE：`town_economy`、`town_jobs`、`town_stock`、`town_log`。
- 所有 API 挂 `/api/town/*`，不在 `/api/items` 下扩出第二套语义。

---

## 6. 可扩展逻辑引擎

### 6.1 分层

保留并继续使用：

```text
L0  确定性移动、寻路、作息 FSM
L1  声明式规则引擎
L2  主题互动、叙事生成、状态气泡、相遇对话
L3  外部系统效果网关
```

L1 从当前内联规则中抽出，但移动和寻路不进入规则解释器。

### 6.2 规则格式

规则存数据库或内置注册表，示例：

```json
{
  "id": "shop.restock.morning",
  "enabled": true,
  "priority": 20,
  "weight": 1,
  "trigger": {
    "type": "cron",
    "time": "07:30"
  },
  "conditions": [
    { "path": "npc.job", "op": "in", "value": ["铁匠", "妖精店店主"] },
    { "path": "wallet.balanceMinor", "op": ">=", "value": 500 }
  ],
  "effects": [
    { "action": "shop.restock", "params": { "templateKeys": ["energy", "mood_fix"] } },
    { "action": "npc.set_state", "params": { "key": "shop_open", "value": true } },
    { "action": "log.activity", "params": { "summary": "NPC 正在整理今日货架" } }
  ],
  "cooldownSeconds": 86400,
  "audit": true
}
```

规则约束：

- 条件路径来自白名单黑板的受限 JSON Path。
- 操作符仅支持 `eq`、`ne`、`gt`、`gte`、`lt`、`lte`、`in`、`contains`、`empty`、`has_flag`、`between`、`any`、`all`、`not`。
- 动作来自注册表，不执行任意代码。
- 触发类型支持 `interval`、`cron`、`state`、`proximity`、`stock`、`job`、`random`、`on_event`。
- 每次执行写入活动日志，包含规则 id、命中条件和结果。
- 冷却、每日预算、全局并发和幂等 key 由引擎统一处理。

### 6.3 黑板

`town_logic_state` 保存 world、npc、character 和 player 的轻量状态：

```text
mood
energy
busy
shop_open
current_job
last_interaction
last_restock
relationship_heat
```

状态是数据，不是 LLM prompt 源。LLM 只在需要叙事时读取黑板摘要。

### 6.4 动作注册表

第一阶段提供：

```text
npc.move_to
npc.set_state
npc.say
shop.restock
shop.change_price
inventory.give_item
inventory.take_item
economy.transfer
job.spawn
job.complete
interaction.start
interaction.end
log.activity
external.spawn_event
external.post_moment
external.send_letter
external.send_proactive_message
external.write_memory
external.update_relationship
external.apply_outfit
```

外部动作通过 `townExternalEffects.js` 适配现有服务，不在规则文件里复制聊天、信箱、朋友圈的具体实现。

### 6.5 活动日志

新增：

```sql
CREATE TABLE town_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key TEXT,
  rule_id TEXT,
  action_key TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT DEFAULT '{}',
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- 保留最近 7 天或最近 2000 条，具体以设置为准。
- 默认只展示玩家和当前世界有关的动作。
- 管理面板可筛选 NPC、经济、外部系统、LLM 和错误。
- 日志用于排查“谁在哪里做了什么、为什么触发、结果如何”。

### 6.6 LLM 回退

- 规则引擎先尝试所有确定性动作。
- 只有规则或主题声明 `needsLLM: true` 时进入 LLM。
- 小镇 LLM 继续走独立串行队列和 `features.townLLM` 开关。
- LLM 输出必须符合 AGENTS.md：JSON 字段完整示例、逐字段约束、禁止 JSON 以外文字。
- 解析失败最多重试 2 次，随后使用确定性兜底，不阻塞世界运行。

---

## 7. 明确主题的 AI 互动

### 7.1 与现有奇遇的区别

| 能力 | 现有奇遇 | 新主题互动 |
|---|---|---|
| 目标 | 随机生活片段，可自由选择 | 有明确 `themeKey` 和 `goal` |
| 边界 | 主要按时间到期结束 | AI 可主动判断 `shouldEnd: true`，立即进入结算 |
| 使用场景 | 聊天侧的生活事件 | 小镇内服务、委托、交易、剧情任务 |
| 状态 | `character_events` | `town_interaction_sessions` |
| 结果 | 记忆和事件历史 | 钱包、背包、NPC 状态、外部系统、记忆、日志 |
| 数量 | 全局少量 | 用户当前一个主会话，后台少量 |

### 7.2 会话状态机

```text
idle
  -> open      玩家与 NPC 开始明确主题
  -> running   每轮用户选择或自由输入
  -> settling  AI 返回 shouldEnd 或达到最大轮数
  -> completed / failed / expired / cancelled
```

关键规则：

- 每个玩家同时最多一个主互动会话，避免多个对话框叠加。
- 每轮用户操作后执行一次结构化 LLM，或命中确定性脚本。
- `maxTurns`、`expiresAt`、AI `shouldEnd` 三条结束线同时存在。
- 只要 AI 判断应结束，后端立即进入 `finalizeSession`。
- 结束必须写会话结果、资金、物品、日志和可选外部效果。
- 用户点“结束互动”可主动请求结束，后端仍走正常结算。

### 7.3 LLM 输出示例

未来 prompt 中必须包含类似完整示例：

```json
{
  "reply": "占卜师把晶石放到你手边：我看到你今天会错过一班车，但会在长椅旁得到一条有用的消息。",
  "speaker": "npc",
  "options": [
    {
      "id": "a",
      "label": "问清是哪条消息",
      "intent": "追问预言细节"
    },
    {
      "id": "b",
      "label": "先付钱离开",
      "intent": "结束占卜"
    }
  ],
  "statePatch": {
    "trust": 1,
    "topicRevealed": true
  },
  "shouldEnd": false,
  "endReason": null,
  "proposedOutcome": null
}
```

字段约束需要写清：

- `reply` 60 到 180 字，符合 NPC 人格和主题。
- `speaker` 只能是 `npc`、`player`、`narrator`。
- `options` 为 0 到 3 项，选项标签不超过 12 字。
- `statePatch` 只能修改会话黑板白名单字段。
- `shouldEnd` 为布尔值，主题目标完成时必须为 `true`。
- `endReason` 只能取 `goal_done`、`player_refused`、`npc_dismissed`、`interrupted`。
- `proposedOutcome` 只能引用服务合约允许的 outcome key 和参数。
- 严格只输出 JSON，不输出解释。

### 7.4 结算安全

- LLM 只能提议 outcome，不能直接写钱包和背包。
- 后端将 `proposedOutcome` 与服务合约白名单比对。
- 金额受 `minRewardMinor` 和 `maxRewardMinor` 限制。
- 结算和外部效果使用事务或可重试幂等动作。
- LLM 失败时不扣除全额服务费，按合约执行退款或降级为简短确定性结局。

---

## 8. 小镇内外系统联动矩阵

| 小镇能力 | 聊天 | 朋友圈 | 奇遇 | 群聊 | 信箱 | 日程 | 背包 | 记忆 | 关系 | 外观 |
|---|---|---|---:|---|---:|---|---:|---|---:|
| NPC 商店成交 | 主动消息 | 可发一条“补货/售罄” | 可触发 `found_item` 类事件 | 不默认 | 不默认 | 影响营业状态 | 购买/出售 | 写交易摘要 | 影响信任 | 道具可改外观 |
| 委托完成 | 感谢消息 | NPC 可发帖 | 完成后触发后续奇遇 | 可提到 | 可写感谢信 | 可生成后续日程 | 奖励道具 | 写完成记忆 | 提升关系 | 不默认 |
| 付费服务 | 服务内对话 | 结束后可发感想 | 主题事件本身 | 不默认 | 可发邀请 | 临时占用 NPC 状态 | 奖励或消耗 | 写服务结果 | 影响好感 | 服务可换装 |
| 主题互动 | 会话消息 | 结果帖 | 可作为事件奖励 | 可触发群讨论 | 可发后续信 | 改变短期日程 | 给道具 | 完整记录 | 提升或降低 | 按主题 |
| NPC 相遇 | 现有 | 不默认 | 可影响奇遇语境 | 不默认 | 不默认 | 影响忙碌 | 不默认 | 已有摘要 | 促进关系 | 不默认 |
| 规则引擎 | 可触发 | 可触发 | 可触发 | 可触发 | 可触发 | 可触发 | 可触发 | 可触发 | 可触发 | 可触发 |

---

## 9. 里程碑

### M0：分支预检与构建修复

**目标**

- 不丢失当前 `ai-town` 工作树已有改动。
- 让前端构建通过。
- 统一后端测试入口。
- 锁定当前数据库状态作为升级前快照。

**内容**

- 检查工作树中 `TownImageEditor.vue` 的未提交修改，确认是否保留；不得用 `git checkout` 整体重置工作树。
- 如该文件再次缺失或内容不可用，先调整 `TownInitWizard.vue` 的依赖和对应编辑流程，再继续。
- 修 `npm test`，使其包含 `src/services/town/*.test.js`。
- 将当前 48 张素材、8 个 NPC、无正式地图的状态记录进计划备注。

**验收**

- `npm run build` 通过。
- 一条测试命令通过当前 19/19 测试。
- 不新增额外 UI 重做。

### M1：HD-2D 渲染

**目标**

- `legacy_v2` 与 `hd2d_v1` 双模式。
- 新素材 prompt 和渲染管线可运行。
- 投影、焦点带、景深、分级完成。

**内容**

- 扩展 `townAssetService.js`、`townPromptBuilder.js`、`assetPostProcess.js`。
- 重构 `TownView.vue` 的渲染部分为合成器模块，避免组件继续膨胀。
- 增加 `TownRenderSettings` 和管理面板开关。
- 提供素材兼容投影和一键升级。
- 视觉验收截图。

**验收**

- 两种模式可切换。
- 50×50 地图、8 到 16 个 NPC 场景达到目标帧率。
- 编辑器、缩放、拖拽、WASD、拾取和遮挡全部正常。
- 生成的 HD-2D 建筑、角色投影和远景模糊可见。
- 移动端有降级路径。

### M2：立绘游戏对话框

**目标**

- 统一 NPC、入住角色、玩家和相遇对话。
- 立绘进入、对话框、打字机、选项、历史、关闭状态完整。

**内容**

- 新建 `TownDialogue.vue`。
- 渐进替换 `TownNpcChat.vue`，保留旧组件直到验收。
- 补充角色立绘解析和多人对话状态。
- 与 TownView 的点击、键盘和镜头状态互斥。

**验收**

- NPC 点击后世界暂停，立绘和对话框正常显示。
- 消息不被游戏 HUD 截断，窄屏不溢出。
- 普通按钮、输入框、选择框和开关符合 `Linshe*` 规范。
- 关闭后角色状态和镜头恢复正常。
- 与现有 Toast、信箱、世界观弹窗视觉一致。

### M3：经济系统

**目标**

- 钱包、账本、商店、库存、委托和付费服务首版。
- 所有资金变动可审计，数值受控。

**内容**

- 新增 `townEconomyService.js`、`townShopService.js`、`townJobService.js`。
- 扩展 `itemService.js`，复用宝箱模板生成商店道具。
- 新增 HUD、钱包账本、委托板、商店对话框。
- 纯事件逻辑生成库存、价格、工资和委托。

**验收**

- 买、卖、退款、补货、发薪、委托奖励均通过事务。
- 无负余额、无重复扣款、无重复发奖。
- 关闭 LLM 后经济仍可运行。
- 长跑模拟不出现余额爆炸或商店死锁。
- 单测覆盖转账回滚、价格边界、委托防重放。

### M4：逻辑引擎与活动日志

**目标**

- L1 行为可声明式配置。
- NPC 活动可追溯。
- 外部系统效果通过统一网关触发。

**内容**

- 新增规则引擎、动作注册表、黑板、活动日志。
- 把现有问候、补货、开店、委托和跨系统触发改为规则。
- 管理面板提供近期动态查看和调试过滤。
- 保留当前 L0 移动和 LLM 队列。

**验收**

- 内置规则与旧逻辑行为一致或更清晰。
- 随机规则和状态压力测试无崩溃。
- 每个 NPC 关键动作有日志。
- 规则改动不需要改渲染和寻路代码。

### M5：主题互动与全面联动

**目标**

- 明确主题的 AI 会话可以按 AI 判断真正结束。
- 小镇事件能够回写朋友圈、奇遇、聊天、群聊、信箱、日程、背包、记忆、关系和外观。

**内容**

- 新增 `townInteractionService.js` 和会话表。
- 接入确定性服务菜单和 LLM 结构化回合。
- 新增 `townExternalEffects.js`。
- 完成奖励白名单、结算事务、取消和退款。
- 补足所有 LLM JSON prompt 示例和解析代码。

**验收**

- 一个占卜或跑腿主题能完整走完开始、推进、AI 主动结束、结算。
- AI 不结束时，最大轮数和用户结束仍能正常收尾。
- LLM 失败时经济和会话不损坏。
- 至少跑通三个跨系统闭环：经济加背包、经济加关系加记忆、主题互动加奇遇或信箱。
- JSON prompt 与解析代码字段一致，单测覆盖非法输出。

### M6：测试、打磨和文档

**目标**

- 所有开关、迁移、视觉和成本边界收口。

**内容**

- 补齐规则、经济、主题互动、渲染参数单测。
- 桌面和移动端视觉回归。
- 补写 `plan.md` 完成状态和 `ai-town-plan.md` v3 摘要。
- 更新 README 中的小镇说明。
- 增加 LLM 成本和失败率护栏。

**验收**

- `npm test` 和前端构建通过。
- 新系统全部可由 feature flag 关闭。
- 重置世界不会破坏其他非小镇数据。
- 小镇整体仍像“邻舍.EXE”的一部分，而不是独立游戏客户端。

---

## 10. 新文件与改动范围

### 10.1 后端新增

```text
agent-core/src/services/town/townEconomyService.js
agent-core/src/services/town/townShopService.js
agent-core/src/services/town/townJobService.js
agent-core/src/services/town/townRuleEngine.js
agent-core/src/services/town/townActionRegistry.js
agent-core/src/services/town/townActivityLog.js
agent-core/src/services/town/townInteractionService.js
agent-core/src/services/town/townExternalEffects.js
agent-core/src/services/town/townRenderConfig.js
```

### 10.2 后端修改

```text
agent-core/src/services/town/townAssetService.js
agent-core/src/services/town/townPromptBuilder.js
agent-core/src/services/town/assetPostProcess.js
agent-core/src/services/town/townService.js
agent-core/src/services/town/townNpcService.js
agent-core/src/services/town/townInitService.js
agent-core/src/routes/town.js
agent-core/src/services/itemService.js
agent-core/src/db/index.js
agent-core/src/config.js
agent-core/src/services/unifiedStreamBus.js
agent-core/package.json
```

### 10.3 前端新增

```text
web-ui/src/components/town/TownDialogue.vue
web-ui/src/components/town/TownWalletPanel.vue
web-ui/src/components/town/TownJobPanel.vue
web-ui/src/components/town/TownActivityPanel.vue
web-ui/src/composables/town/townHd2d.js
web-ui/src/composables/town/townInteraction.js
web-ui/src/stores/townEconomy.js
```

### 10.4 前端修改

```text
web-ui/src/views/TownView.vue
web-ui/src/components/town/TownNpcChat.vue
web-ui/src/components/town/TownAdminPanel.vue
web-ui/src/components/town/TownInitWizard.vue
web-ui/src/stores/town.js
web-ui/src/api/index.js
web-ui/src/stores/unifiedStream.js
```

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| HD-2D 变成“滤镜叠滤镜”的廉价效果 | 先定样图，再做管线；只启用低强度景深，重点放在素材轮廓、光照和投影 |
| Canvas 景深拖慢低端设备 | 5 带缓存、移动端 3 带或关闭、`ctx.filter` 不支持时预模糊 |
| 旧素材升级失败导致小镇空白 | 旧图保留，新图 ready 后才替换；兼容渲染路径长期存在 |
| 经济刷钱或数值爆炸 | 整数账本、价格上下限、每日工资上限、全市场预算、事务和压测 |
| LLM 自行改钱或错误结束 | 后端白名单结算；AI 只提意图；最大轮数、超时、退款兜底 |
| 规则引擎过于抽象，增加维护成本 | 第一阶段只覆盖明确动作；不把寻路和核心移动迁移进去；注册表而非自由代码 |
| 与现有聊天、奇遇、信箱产生重复通知 | 外部效果网关统一限流和去重；日志记录来源 |
| 迁移破坏未完成的世界初始化 | 支持无地图数据；新初始化直接走 HD-2D；已有素材走升级按钮 |
| 工作树中已有未提交的 `TownImageEditor.vue` 和构建产物修改 | M0 先确认改动意图，保留并配合已有修改，不擅自整体重置工作树 |

---

## 12. LLM 成本预算

| 场景 | 频率 | LLM | 备注 |
|---|---:|---|---|
| HD-2D 素材 prompt | 初始化和升级时 | 建筑/道具/精灵各一次 | 可失败回退静态 prompt |
| NPC 补货、价格、委托生成 | 每日 | 否 | 纯规则 |
| 普通 NPC 聊天 | 用户点击 | 是 | 沿用现有独立队列 |
| 付费服务菜单 | 用户打开 | 否 | 菜单来自服务定义 |
| 主题互动每轮 | 用户行动 | 是 | 最大轮数和每日预算限制 |
| 主题互动结算 | 会话结束 | 是 | 一次，失败走确定性兜底 |
| 小镇状态气泡 | 每 45 分钟 | 是 | 沿用现有批量调用 |
| 外部系统触发 | 规则命中 | 否或复用原系统 | 网关不额外制造 LLM 风暴 |
| 总开关 | 全局 | 否 | `features.townLLM=false` 时小镇仍存活 |

---

## 13. 定义完成

完成不是“页面能打开”，而是同时满足：

- 当前小镇旧模式和 HD-2D 新模式可切换。
- 建筑和角色有正确投影，远景有移轴模糊。
- NPC 和角色对话采用立绘加游戏对话框。
- 玩家能通过多种方式赚钱，NPC 能提供服务和出售道具。
- 资金、物品、NPC 库存和委托构成可观察的闭环。
- 规则引擎可声明式定义行为，活动日志可解释行为。
- 明确主题互动由 AI 判断并真正结束，结算写入数据和外部系统。
- 关闭所有 LLM 后，小镇移动、商店、委托和基础经济仍可运行。
- 单测、构建、截图验收和回滚开关全部通过。
