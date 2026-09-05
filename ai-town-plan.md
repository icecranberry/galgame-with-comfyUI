# AI 小镇（瓦片地图 × 生成式像素素材 × 世界观初始化 × 本地行为生态）方案 v2

> 状态：v2 重构定稿（未实施）。v1 的「程序化画布 + 角色日程投影」MVP 已实现但效果不合格；v2 保留其引擎层，推倒世界层重做。
> 核心变更：地图 = ComfyUI 生成的像素瓦片；世界 = 按世界观一键初始化（素材 → 布图 → 确认）；NPC = 轻量小镇居民（本地行为生态，LLM 仅关键步骤）；整个世界全程可编辑。

---

## 0. 一句话结论

邻舍已有的「大脑」（人设/日程/记忆/关系/情绪）不动；小镇要补的是「身体和舞台」：**ComfyUI 生成一整套像素瓦片与精灵素材 → 世界观驱动初始化出一张 50×50 瓦片小镇 → 轻量 NPC 以本地作息引擎在镇上生活 → 地图全程可编辑。** LLM 只出现在初始化、相遇对话、就地聊天等关键步骤，日常运转零 LLM 成本。

---

## 1. 现状盘点：保留什么、推倒什么

动手前先 `git commit` 当前 ai-town 分支存档。

| 处置 | 内容 | 说明 |
|---|---|---|
| **保留（≈40%）** | `townPathfinding.js`（A* + 占位，纯函数带单测）、`townBus.js`（SSE）、`stores/town.js` 骨架（订阅/时钟同步/断线重连）、`townService.js` 的 tick 循环/插值推进/相遇 L1 规则/LLM 串行队列/天气接入、`town_encounters` / `town_chat_messages` 表、app.js / config / unifiedStream 接线 | 瓦片地图照样要寻路、要服务端权威推进、要客户端插值；「时钟对齐、占位避让、重启状态重建」这类容易出 bug 的部分已经调通，重写产出一模一样 |
| **推倒重写（≈60%）** | `townSeed.js`（硬编码 7 POI 假地图）、`TownView.vue` 程序化绘制（色块屋顶/emoji 图标）、地图数据模型（walk_grid）、NPC = 角色日程投影这套 | 这四样正是 v1 效果不合格的根源：没有瓦片、没有素材生成、没有世界初始化、生态空洞 |
| **全新（大头）** | 素材管线（生成/抠白/像素化）、世界初始化向导、地图编辑器、NPC 本地行为引擎 | 本来就不存在，无论如何都要写 |

第一个交付物：本文档。每阶段完成后同步更新里程碑状态。

---

## 2. 素材管线（第一优先级，ComfyUI → 像素素材库）

### 2.1 生成规格

| kind | 生成尺寸 | prompt 要点 | 后处理 | 像素密度 |
|---|---|---|---|---|
| ground 地砖（草/泥土/广场砖/水…） | 512×512 | seamless tileable texture, flat top-down view | 直接像素化 | 64×64 |
| road 道路（直路/转角/人行道…） | 512×512 | seamless tileable, top-down | 直接像素化 | 64×64 |
| building 建筑 | 768×768（特殊建筑 768×1024） | pure white background, front view, complete building | 抠白 → 像素化 | 按占格比例 |
| prop 道具（树/长椅/路灯/花丛…） | 512×512 | white background, single object | 抠白 → 像素化 | 48×48 |
| NPC 精灵 | 768×768 × 4 张 | white background, full body, chibi pixel sprite, facing down/up/left/right | 抠白 → 像素化 | 约 32×48 |
| 玩家精灵 | 同 NPC | 同上 + 用户配置（nickname/gender/appearance/persona）外观描述 | 同上 | 同上 |

- 地砖是方形，生成完整素材直接用；建筑/道具/精灵是白底图，抠掉白色成透明 PNG 再用。
- 全部素材像素风格；像素化到低密度后由前端 nearest-neighbor 放大保持颗粒感。

### 2.2 Prompt 组装与风格统一

每张素材 prompt = **固定像素风基础串** + **世界观 styleTags** + kind 专属串 + 素材具体描述：

- 基础串：`pixel art, clean pixel edges, limited color palette, no anti-aliasing, no text, no watermark, no outline glow`
- styleTags 由初始化蓝图产出（如 `warm pastel fantasy village, soft colors`），整套素材共享 → 风格一致
- 生成统一走 `generateImageRaw(prompt, { scene: 'town', disableRAG: true, artist, width, height })`；需在 `imageSkill.resolveWorkflowPath` / `config.workflow.scene` 白名单 / `imagePromptPreparer.sceneAliases` 增加 `town` 场景键

### 2.3 风格小样确认（质量兜底，先于批量）

批量生成前先出 **3 张小样**（草地 + 道路 + 一栋建筑）供用户确认风格；不合意调整基础串/styleTags 重出，确认后才跑批量。最坏浪费 3 张图，避免整套 50+ 张素材风格跑偏。

### 2.4 后处理（sharp，纯本地，配 node:test 单测）

新文件 `agent-core/src/services/town/assetPostProcess.js`：

- `pixelate(buffer, targetW, targetH)`：box 降采样到目标像素密度，存小图，前端 nearest 放大
- `removeWhiteBackground(buffer, tolerance)`：从四边泛洪的**连通**白区判定背景 + 亮度容差阈值 → alpha 二值化（0/255 硬边，避免半透明毛边，符合像素风）。白色衣物靠连通性保护不被误抠；容差可调；抠坏可单张重生成

### 2.5 存储与数据表

- 磁盘：`agent-core/data/town/assets/`，app.js 注册静态路由 `/town-assets`（独立于 `data/images`，不进 imageCompressor 扫描、不污染图库）
- 新表：

```sql
CREATE TABLE town_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- ground | road | building | prop | npc | player
  key TEXT,                    -- grass_01 / residential / cafe / npc_3_down / char_12_right
  name TEXT NOT NULL,          -- 显示名（青草地 / 普通居民楼）
  image_path TEXT NOT NULL,    -- /town-assets/xxx.png
  meta_json TEXT DEFAULT '{}', -- footprint{w,h}/blocking 格/cellW,cellH/direction/reusable/maxInstances/styleTags/pixelSize
  source_prompt TEXT DEFAULT '',
  world_setting_id INTEGER,
  status TEXT DEFAULT 'pending',  -- pending | ready | failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.6 API 与 SSE

- `GET /api/town/assets`（列表）、`POST /api/town/assets`（单张生成）、`POST /api/town/assets/:id/regenerate`、`DELETE /api/town/assets/:id`、`POST /api/town/assets/batch`（串行队列）
- 批量走**独立串行队列**，不与聊天配图抢 ComfyUI；逐张 SSE `town_assets_updated` 上报

---

## 3. 瓦片地图模型 + 渲染器 + 编辑模式

### 3.1 数据模型

`town_maps` 增列 `layers_json / tile_size / world_setting_id / version`：

```
layers_json = {
  ground: [[assetId|null]], road: [[assetId|null]],      // 50×50 索引矩阵
  objects: [{ id, assetId, x, y, flip }],                // 建筑/树/长椅，y 为底部锚点
  blockOverride: [[0|1|-1]]                              // 手动可走性覆盖，-1 = 默认
}
```

- 可走性 = 非 blockOverride=1 且未被对象 blocking 格占用（建筑主体阻挡、门前留空，来自 asset meta），运行时计算；`walk_grid` 列废弃
- `town_locations`（POI/别名/ambient）保留，增 `object_id` 绑定建筑对象

### 3.2 渲染器（TownView.vue 重写，纯 canvas 2D）

- ground + road 烘焙进离屏静态画布（地图/缩放变更时重烘焙），`imageSmoothingEnabled = false`
- 对象与角色合并逐帧 y 排序（角色可走到建筑「后面」，被遮挡时建筑半透明）
- 摄像机：滚轮缩放（0.5~2.5×）、拖拽平移、双击跟随玩家；点击拾取经逆变换换算格坐标
- 精灵：按移动向量选前后左右贴图，单帧 + 滑步弹跳 + 左右镜像（v2 不做多帧动画，留作后续增强）
- 昼夜/天气 tint 与雨雪粒子保留

### 3.3 编辑模式（TownView 内开关，带确认）

- 左侧素材库面板：kind 分 tab 缩略图网格 + 「AI 生成新素材」（输入描述 → 单张生成入库即用）+ 每张素材的重生成/删除
- 工具栏：地砖画笔/矩形填充（ground、road 两层）、建筑放置（ghost 预览 footprint、碰撞红显）、对象删除、阻挡涂刷、POI 绑定与别名编辑
- 保存 → `PUT /api/town/map` → version+1 → SSE `town_map_updated` 广播，其他端重载

---

## 4. 世界初始化向导（核心流程）

无地图时小镇页显示向导入口。七步：

1. **配置**：选世界观（world_settings 下拉）+ NPC 数量（默认 8，3~16）+ 地图规格（默认 50×50）
2. **LLM 蓝图**（一次调用，JSON 按 AGENTS.md 规范带完整字段示例）：styleTags、素材清单、NPC 名册。清单在 UI 中可增删后开始
3. **风格小样**：3 张（草地/道路/一栋建筑）确认风格，不合意调整重出
4. **批量生图**：先全部基础方块，再建筑与道具，再 NPC 精灵；串行队列逐张 SSE `town_init_progress`；失败可重试，断点续跑（job 状态存 `data/town/init-state.json`）
5. **LLM 布图**：输入 = 可用素材清单（类型 + 名 + 占格尺寸），输出 = **紧凑布局 JSON**（不输出 2500 格矩阵，保证可靠性）；本地展开为图层，A* 连通校验，不连通自动补路
6. **用户确认**：真实素材实时渲染预览 → 确认开镇 / 重掷布局（复用已生成素材，不重生图）/ 进编辑器手改
7. **落库开镇**：写 town_maps / town_locations、批量建轻量 NPC、生成玩家精灵、广播 `town_map_updated`

**素材复用原则**（用户明确要求）：小镇里至少一半格子是重复的地砖/道路/草/树；基础方块大量复用。建筑一半左右是**通用建筑**（普通居民楼/公厕/公交站这类，`reusable: true + maxInstances`，多实例复用），另一半是**特殊建筑**（市民广场/兽人咖啡厅/天使广场这类世界观专属，唯一）。先生成基础方块，再生成建筑，最后按方块类型和名字让 LLM 布置地图（JSON 返回），用户确认。

### 4.1 蓝图 JSON 示例（prompt 中带完整示例）

```json
{
  "styleTags": "温暖柔和的奇幻小镇，粉彩色调（英文短语，用于所有素材生成 prompt）",
  "groundAssets": [
    { "key": "grass_01", "name": "青草地", "desc": "short green grass with tiny flowers", "variants": 2 },
    { "key": "road_01", "name": "石板路", "desc": "cobblestone path", "variants": 2 }
  ],
  "buildings": [
    { "key": "residential", "name": "普通居民楼", "desc": "simple two-story house", "reusable": true, "maxInstances": 6, "footprint": { "w": 4, "h": 3 }, "special": false },
    { "key": "cafe", "name": "兽人咖啡厅", "desc": "cozy cafe run by an orc barista", "reusable": false, "maxInstances": 1, "footprint": { "w": 5, "h": 4 }, "special": true }
  ],
  "props": [
    { "key": "tree_01", "name": "橡树", "desc": "round oak tree", "blocking": true }
  ],
  "npcs": [
    { "displayName": "咕噜", "persona": "开朗的兽人面包师（一句话人设+性格关键词）", "appearanceDesc": "矮壮的绿皮兽人，白色围裙（英文，用于精灵生成）", "job": "面包师", "home": "residential", "traits": { "social": 0.8, "outdoor": 0.6, "nightOwl": false } }
  ]
}
```

### 4.2 布图 JSON 示例（紧凑区域格式，非逐格矩阵）

```json
{
  "groundRects": [
    { "assetKey": "grass_01", "x": 0, "y": 0, "w": 50, "h": 50 },
    { "assetKey": "plaza_tile", "x": 20, "y": 20, "w": 10, "h": 10 }
  ],
  "roadPaths": [
    { "assetKey": "road_01", "points": [[25, 0], [25, 49]] }
  ],
  "placedObjects": [
    { "assetKey": "cafe", "instance": 1, "x": 8, "y": 10 },
    { "assetKey": "residential", "instance": 2, "x": 30, "y": 30 }
  ],
  "locations": [
    { "key": "cafe", "objectRef": "cafe:1", "name": "兽人咖啡厅", "aliases": ["咖啡厅", "咖啡馆"], "ambient": "咖啡香和烤面包味" }
  ],
  "npcSpawns": [ { "npcRef": "咕噜", "locationKey": "cafe" } ]
}
```

---

## 5. 轻量 NPC 与本地行为生态

**定位（用户决策）**：世界观生成的 NPC 是**轻量小镇居民**——不进 characters 表、不占聊天侧边栏、没有日程/记忆/关系全套大脑，只在镇上生活与就地对话。现有角色默认不进镇；小镇管理里可管理他们的四方向像素小人素材并一键生成缺失资源，生成后可 opt-in 入住（入住者沿用 daily_schedules 投影驱动）。

### 5.1 新表

```sql
CREATE TABLE town_npcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  persona TEXT DEFAULT '',           -- 轻量人设卡（一段话 + 性格关键词）
  appearance_desc TEXT DEFAULT '',   -- 精灵生成用外观描述
  job TEXT DEFAULT '', home_location_id INTEGER,
  routine_json TEXT DEFAULT '[]',    -- [{start:"08:00",end:"12:00",activity,locationKey}]
  traits_json TEXT DEFAULT '{}',     -- {vad, social, outdoor, nightOwl, 作息偏移}
  sprite_ready INTEGER DEFAULT 0,    -- 4 方向素材齐备标记
  town_enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE town_npc_chat_messages ( -- 玩家与 NPC 就地对话历史（注入后续对话）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_id INTEGER NOT NULL,
  role TEXT NOT NULL,                -- user | npc
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 行为分层（本地驱动为核心，LLM 仅关键步骤）

| 层 | 频率 | 成本 | 内容 |
|---|---|---|---|
| L0 确定性模拟 | 每 tick | 0 | FSM（sleeping/idle/commuting/working/socializing/reacting）+ 移动/占位/避让，纯本地 |
| L1 规则触发 | 每 tick | 0 | 相遇判定（距离/冷却/上限/概率）、玩家靠近反应（本地模板短语库气泡问候）、天气/时段修正（雨天少外出） |
| L2 LLM 事件 | 事件驱动 | 中 | 相遇对话、批量状态气泡、玩家点击 NPC 就地聊天 |
| L3 记忆回写 | 事件后 | 低 | 相遇摘要进 memory 体系（现有）；NPC 就地对话存 town_npc_chat_messages 注入后续对话 |

- **NPC 驱动**：初始化时 LLM 一次性生成 routine_json，此后**永久本地执行**；空闲时段按 traits 偏好伪随机选地闲逛
- **入住角色驱动**：daily_schedules 投影（现有 refreshAgentActivity 逻辑保留）
- **玩家点击 NPC 就地聊天**（新）：persona + 现场语境（「我正在喷泉广场闲逛」）+ 最近对话历史 → 前端内嵌聊天面板，不走 ChatView
- tick 间隔沿用 `config.town.tickSeconds`（默认 60s）；LLM 走现有串行队列 + `features.townLLM` 独立开关，失败降级为纯移动模拟

### 5.3 玩家

- `town_players` 增 `sprite_asset_id / appearance_desc`；精灵按用户配置（nickname/gender/appearance/persona）+ 世界观风格生成四方向
- 移动：点击寻路（保留）+ WASD/方向键连续移动（本地节流上报，服务端校验）

---

## 6. 管理面板（小镇页右上入口）

- **居民管理**：NPC 列表（四方向精灵预览、启停、重生成精灵、重掷人设/作息、删除、新增单个 NPC）
- **角色素材**：现有 characters 的精灵生成状态列表 + **「一键生成所有缺失素材」**（批量队列，外观走 `buildCharacterAppearanceSection`，遵守 characterPersona 统一入口规范）+ 完成后可开「入住小镇」
- **小镇设置**：config.town 各参数（tick 间隔/速度/相遇概率等）+ 「重新初始化世界」（带确认）

---

## 7. 前端与 API 汇总

- `stores/town.js` 扩展 assets/map/init/npcs/管理 actions；`api/index.js` 新增对应函数
- `unifiedStream.js` 注册新事件：`town_init_progress / town_map_updated / town_assets_updated`
- 新路由均挂 `/api/town/*`（routes/town.js 扩展）
- UI 全部遵循 `docs/design-system.md` 暖色珊瑚风 + LinsheButton/Input/Select/Switch 组件规范；LLM prompt 一律按 AGENTS.md 带 JSON 完整示例

---

## 8. 里程碑（每阶段独立可验收）

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 | git 存档 + 本文档定稿 | 文档定稿 |
| M1 素材管线 | 生成/抠白/像素化 + town_assets 表 + API/SSE + 素材库面板 | 能生成并预览合格的地砖与抠白建筑，后处理单测通过 |
| M2 瓦片地图 | 数据模型迁移 + 渲染器（烘焙/y 排序/摄像机/精灵）+ 编辑模式全套 | 手动铺图保存后多端一致，角色在建筑前后正确遮挡 |
| M3 世界初始化 | 向导（蓝图 → 风格小样 → 批量生图 → 布图 → 确认 → 开镇）+ 玩家精灵 | 选世界观一键出镇，断点续跑可用，确认前可重掷布局 |
| M4 NPC 生态 | 轻量 NPC 建档/作息引擎/FSM/就地聊天 + 管理面板（含一键补素材、角色入住） | NPC 全天按作息流动、相遇聊天、点击可对话且带现场语境 |
| M5 打磨 | 昼夜天气联动瓦片渲染、遮挡半透明、设置项、测试接入 npm test、文档同步 | 小镇完整可用且像邻舍的一部分 |

---

## 9. LLM 成本预算

| 项 | 频率 | 调用 |
|---|---|---|
| 蓝图/布图/作息 | 初始化一次 | 3 次（重掷布局 +1） |
| 相遇对话 | 全局限流 ≤ 2 场同时、每对冷却 3h | 每场 1 次生成 + 1 次摘要回写 |
| 状态气泡 | 每 45 分钟批量 | 每时段 1 次（全部角色一个 JSON 数组） |
| 就地聊天 | 用户点击 NPC 时 | 按需 |
| **日均运行** | 8 NPC | ≈ 10~25 次，远低于一次朋友圈刷新风暴 |

护栏：小镇 LLM 串行队列独立于聊天池；`config.features.townLLM` 总开关；LLM 失败/超时降级为纯移动模拟（小镇永远「活着」，只是没人说话）。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 素材风格跑偏/质量不过关 | 风格小样先行确认（3 张成本试错）+ 每张素材独立重生成 + 基础串/styleTags 全套统一 |
| 抠白误伤白色衣物 | 连通性保护（只抠四边连通背景）+ 容差可调 + 单张重生成 |
| 瓦片接缝感 | seamless 提示词 + 低像素密度弱化 + 多变体随机铺贴打散 |
| LLM 布图不可靠 | 紧凑区域 JSON 而非逐格矩阵 + 本地 A* 连通校验自动补路 + 确认/重掷/手改三重兜底 |
| 批量生图挤占聊天配图 | 独立串行队列 + 向导实时进度可见 |
| 50×50 性能 | 静态层烘焙 + 视口裁剪 + 页面隐藏暂停渲染 |
| 旧数据迁移 | 现有 seed 演示地图作废，首次进入走向导；town 相遇历史表保留不动 |

---

## 11. 参考资料

- Generative Agents 论文：https://arxiv.org/abs/2304.03442 ｜ 代码：https://github.com/joonspk-research/generative_agents
- AI Town：https://github.com/a16z-infra/ai-town （先读 `ARCHITECTURE.md`，低频步进 + 服务端权威 + 客户端插值的骨架来源）
- 本仓库相关：`docs/design-system.md`（UI 规范）、`AGENTS.md`（LLM prompt JSON 示例规范、characterPersona 统一入口）、`agent-core/src/services/comfyClient.js` + `imageSkill.js`（生图管线）、`agent-core/src/routes/characters.js` `runPersonaGeneration`（人设生成，extraContext 模式）
