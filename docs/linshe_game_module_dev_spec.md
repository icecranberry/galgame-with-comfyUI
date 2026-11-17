# 邻舍.EXE 游戏模块与跑团模拟器开发规格说明书（面向 6.1 sol 执行）

> **适用项目**：[邻舍.EXE (`icecranberry/galgame-with-comfyUI`)](https://github.com/icecranberry/galgame-with-comfyUI)
>
> **核心技术栈**：`web-ui/`（Vue 3 + Pinia + Vite）、`agent-core/`（Node.js + Express + SQLite）、ComfyUI / NovelAI 生图服务
>
> **UI 设计原则**：游戏模块采用独立前端包挂载，**完全不需要遵循主站 `linshe-` 组件规范与设计系统**，允许各游戏采用完全风格化的独立 UI（如跑团模拟器采用暗黑克苏鲁/复古桌游 HUD 风格）。

## 一、 整体架构与数据隔离策略

### 1.1 代码与数据分离原则

| 类别 | 存储路径 | Git 策略 | 更新与清理规则 | 
| ----- | ----- | ----- | ----- | 
| **官方游戏本体** | `games/official/<gameId>/` | 纳入仓库版本控制 | 随主程序版本发布直接覆盖更新 | 
| **社区导入游戏** | `agent-core/data/games_community/<gameId>/` | `.gitignore` 忽略 | GitHub 拉取或 `.zip` 解压落盘 | 
| **游戏存档与日志** | SQLite（`agent-core/data/` 现有数据库新增表） | `.gitignore` 忽略 | 独立存储，不随官方游戏更新被覆盖 | 
| **游戏生图落盘** | `agent-core/data/game/<gameId>/<sessionId>/` | `.gitignore` 忽略 | 仅在当前存档展示；删档或卸载游戏时级联清理 | 

### 1.2 建议新增的项目目录结构

```
galgame-with-comfyUI/
├── games/
│   └── official/
│       └── trpg-simulator/           # 官方首作：跑团模拟器
│           ├── game.json             # 清单文件
│           ├── web/                  # 独立构建的前端产物 (index.html + assets/)
│           ├── server/
│           │   └── index.mjs         # 后端扩展插件（单文件 ESM）
│           └── scenarios/            # 官方内置短篇 CoC 模组 JSON
├── agent-core/
│   ├── src/
│   │   └── games/
│   │       ├── gameManager.js        # 游戏扫描、game.json 校验、插件加载与卸载
│   │       ├── gameBridge.js         # 复用神说模块只读工具，过滤敏感密钥
│   │       ├── gameImporter.js       # GitHub Topic 直连抓取、本地缓存、Zip 解压校验
│   │       └── gameRoutes.js         # Express 路由注册
│   └── data/
│       ├── games_community/          # 社区游戏安装目录
│       └── game/                     # 游戏生成图片落盘根目录
└── web-ui/
    └── src/
        └── views/
            ├── GameCenter.vue        # 游戏中心（官方库、社区工坊、Zip 导入）
            └── GamePlayer.vue        # 独立游戏宿主容器（iframe + LinSheGameSDK 桥接）

```

## 二、 数据库与清单规范

### 2.1 SQLite 新增表结构

在 `agent-core` 初始化脚本中新增两张表：

1. **`installed_games`**

   * `id` (TEXT PRIMARY KEY)：游戏唯一标识（与 `game.json` 中 `id` 一致）

   * `source` (TEXT)：`'official'` | `'github'` | `'zip'`

   * `name` (TEXT) / `version` (TEXT) / `author` (TEXT)

   * `repo_url` (TEXT, 可选)：GitHub 仓库地址（用于检查社区游戏更新）

   * `install_path` (TEXT)：本地绝对或相对数据路径

   * `manifest_json` (TEXT)：完整 `game.json` 缓存

   * `installed_at` (INTEGER) / `updated_at` (INTEGER)

2. **`game_sessions`**

   * `session_id` (TEXT PRIMARY KEY)

   * `game_id` (TEXT, 关联 `installed_games.id`)

   * `title` (TEXT)：存档名称（如模组名 + 时间）

   * `state_json` (TEXT)：游戏完整状态机 JSON

   * `created_at` (INTEGER) / `updated_at` (INTEGER)

### 2.2 清单文件 `game.json` 规范

```
{
  "id": "trpg-simulator",
  "name": "跑团模拟器",
  "version": "1.0.0",
  "author": "icecranberry",
  "description": "支持玩家扮演 KP 或调查员的轻量化 CoC 跑团模拟器",
  "cover": "web/cover.png",
  "entry": "web/index.html",
  "serverEntry": "server/index.mjs",
  "minAppVersion": "3.5.0",
  "permissions": [
    "bridge:read",
    "llm:chat",
    "image:generate",
    "save:rw"
  ],
  "tags": ["TRPG", "CoC", "官方"]
}

```

## 三、 社区游戏收集与本地载入方案（本地直连 Topic + 缓存）

无需维护中心索引服务器或定时爬虫，采用 **「用户本地直接请求 GitHub Topic API + 本地 TTL 缓存 + 手动 URL / Zip 导入」** 的去中心化收集方式：

### 3.1 本地直连 GitHub Topic 抓取与缓存（`gameImporter.js`）

1. **Topic 搜索抓取**：当用户在「游戏中心 -> 社区工坊」浏览列表时，由 `agent-core` 直接请求 GitHub Search API：
   * `GET https://api.github.com/search/repositories?q=topic:linshe-game&sort=updated&order=desc`
2. **并发拉取并校验 `game.json`**：
   * 拿到命中仓库的 `full_name` 与 `default_branch` 后，并发请求 Raw 静态文件（不消耗 GitHub API 60 次/小时的限流额度）：
     `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/game.json`
   * 自动过滤掉没有 `game.json` 或缺少必填字段（`id`、`name`、`version`、`entry`）的无效仓库，将合法仓库的 `stargazers_count`、`updated_at`、`html_url`、`default_branch` 与 `game.json` 合并返回前端。
3. **防限流与网络稳定性保障**：
   * **本地 TTL 缓存（15~30 分钟）**：将抓取结果缓存在内存或 SQLite 中，切换页面优先读缓存；仅当用户主动点击「刷新」或缓存过期时重新请求 GitHub，避免触发未登录 Search API 的 10 次/分钟限流。
   * **可选 Token 与加速前缀**：在「设置」中预留可选的 `GitHub Token`（用于放宽限流至 30 次/分钟）及可选的 `GitHub Raw/Archive 镜像前缀`（兼容国内网络环境）。

### 3.2 本地《邻舍.EXE》载入端

在 `web-ui` 的「游戏中心 -> 社区工坊」提供三种载入方式：

1. **社区列表一键安装**：展示上述抓取并校验通过的社区游戏卡片；用户点击「安装」时，后端拼接 `https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip` 下载压缩包并安装。

2. **指定 GitHub 仓库导入**：用户直接粘贴任意 GitHub 仓库 URL（`owner/repo` 或完整链接），按上述同样逻辑拉取并校验 `game.json`。

3. **本地 `.zip` 导入**：用户拖拽或选择本地 `.zip` 文件上传。

**解压与安全校验要点**：

* 解压时剥离 GitHub Archive 自带的外层 `<repo>-<branch>/` 目录，确保 `game.json` 位于安装目录根层级。

* 对 Zip 内每个 Entry 做 `path.resolve` 路径归一化检查，严禁写入目标安装目录之外（防止 Zip-Slip 路径穿越）。

* 导入后立即校验 `game.json` 字段完整性，不合法则回滚删除临时目录并返回明确报错。

## 四、 后端插件加载、桥接工具与生图改造（`agent-core`）

### 4.1 插件加载器（`gameManager.js`）

* **依赖约束**：由于项目面向 Windows 整合包用户，社区游戏 `serverEntry` 必须为**单文件 ESM（如 `esbuild` 打包产物 `.mjs`）**，仅可使用 Node.js 内置模块与宿主传入的上下文，**严禁在安装时执行 `npm install`**。

* **生命周期与隔离**：

  * 启用或首次请求某游戏时，动态 `import(pathToFileURL(serverEntry))`。

  * 传入受控上下文 `ctx`：`{ gameId, gameDataDir, bridgeTools, llm, imageService, db, router }`。

  * 所有挂载到 `/api/games/:gameId/ext/*` 的扩展路由统一包裹异步 `try/catch` 错误处理，防止单个游戏插件异常导致 `agent-core` 主进程崩溃。

  * 卸载、更新或停用游戏时，若插件导出了 `onUnload()` 钩子，先行调用清理定时器与内存状态。

### 4.2 复用神说模块工具（`gameBridge.js`）

* 直接复用神说模块中已暴露的只读查询工具（如获取角色列表、角色人设、立绘、人物关系、长期记忆摘要、小镇状态、相册图片等），同时提供两套暴露方式：

  1. **REST / SDK 直接调用**：供游戏前端或插件逻辑直接读取数据；

  2. **Agent Tool 注册**：供游戏内部创建的 AI Agent（如跑团的 KP Agent）作为 Function Calling 工具调用。

* **关键过滤**：在构建 `bridgeTools` 白名单时，**显式屏蔽**读取 `.env`、系统设置中的 LLM API Key、NovelAI 密钥、向量库管理等敏感接口。

### 4.3 生图落盘定向改造

扩展现有的 ComfyUI / NovelAI 生图调用服务，新增可选参数：

```
{
  prompt: "...",
  negativePrompt: "...",
  outputScope: "game",     // 默认为 "album"
  gameId: "trpg-simulator",
  sessionId: "sess_12345"
}

```

* 当 `outputScope === 'game'` 时，图片直接保存至 `agent-core/data/game/<gameId>/<sessionId>/<timestamp>_<uuid>.png`，并通过静态路由 `/game-media/:gameId/:sessionId/:filename` 提供访问。

* 额外提供一个桥接接口 `POST /api/games/:gameId/media/promote-to-album`，允许玩家在游戏内手动将满意的 CG/剧照收藏到主相册。

### 4.4 核心路由清单（`gameRoutes.js`）

| 方法 | 路径 | 用途 | 
| ----- | ----- | ----- | 
| `GET` | `/api/games` | 获取已安装游戏列表（官方 + 社区） | 
| `GET` | `/api/games/community/discover` | 直连 GitHub Topic `linshe-game` 并带缓存返回社区游戏列表（支持 `?refresh=1`） | 
| `POST` | `/api/games/import/github` | 从 GitHub 仓库下载并安装游戏 | 
| `POST` | `/api/games/import/zip` | 上传 `.zip` 压缩包安装游戏 | 
| `DELETE` | `/api/games/:gameId` | 卸载社区游戏（可选连带清理存档与 `data/game/` 图片） | 
| `GET` | `/game-assets/:gameId/*` | 托管游戏前端静态文件 | 
| `POST` | `/api/games/:gameId/sdk/bridge` | 调用神说只读工具 | 
| `POST` | `/api/games/:gameId/sdk/llm` | 代理 LLM 对话/结构化生成请求 | 
| `POST` | `/api/games/:gameId/sdk/image` | 触发 ComfyUI/NovelAI 生图并落盘 `data/game/` | 
| `GET/POST/DELETE` | `/api/games/:gameId/sessions/*` | 游戏存档的读取、保存与删除 | 
| `ALL` | `/api/games/:gameId/ext/*` | 转发至游戏自带 `serverEntry` 注册的扩展路由 | 

## 五、 前端宿主与 `LinSheGameSDK`（`web-ui`）

1. **宿主容器（`GamePlayer.vue`）**：

   * 全屏容器（`width: 100vw; height: 100dvh;`，兼容桌面端与 `android-shell` 移动端），左上角保留极简半透明悬浮退出按钮（返回游戏中心）。

   * 使用 `<iframe :src="gameEntryUrl" />` 挂载游戏独立前端，**主站 CSS 与 `linshe-` 组件样式不会渗透进 `iframe`**，游戏可完全自由发挥 UI 风格。

2. **`LinSheGameSDK` 通信协议**：

   * 宿主通过 `window.addEventListener('message', ...)` 监听来自 `iframe` 的 RPC 请求，游戏包内只需引入宿主注入或随 SDK 提供的轻量 `linshe-game-sdk.js`：

     * `sdk.bridge.call(toolName, args)`

     * `sdk.llm.chat(messages, options)`

     * `sdk.image.generate(options)`

     * `sdk.save.list()` / `sdk.save.load(sessionId)` / `sdk.save.write(sessionId, title, state)`

     * `sdk.ext.request(subPath, fetchOptions)`

     * `sdk.ui.exit()`

## 六、 官方首作：跑团模拟器（`trpg-simulator`）详细设计

### 6.1 风格化 UI 与专属 HUD

* **视觉风格**：暗黑复古克苏鲁 / 羊皮纸桌面风（深炭色背景、暗金描边、打字机等宽字体数值、纸质纹理线索卡），完全独立设计。

* **界面布局**：

  * **顶部全员状态栏**：横向排列所有调查员迷你卡片（角色头像、实时 HP/SAN 进度条、`疯狂`/`昏迷`/`退场` 状态徽章）。

  * **主舞台区**：Galgame 式场景背景图（支持渐变切换）+ KP/当前发言角色立绘 + 对话与行动气泡流。

  * **模式 A 专属 KP 控制台（右侧可折叠面板）**：场景切换器、手动点名检定（选角色 + 选技能 + 设难度）、HP/SAN 增减按钮、线索卡发放器、密信发送框、NPC 替身发言框。

  * **悬浮功能抽屉**：右下角「线索卡背包」「全员角色卡」「日志回溯」；检定时屏幕居中弹出 **D100 滚骰动画层**。

### 6.2 轻量化 CoC 数据模型

1. **调查员卡（`Investigator`）**：

   * 基础属性：`STR`, `CON`, `DEX`, `INT`, `POW`, `APP`, `SIZ`, `EDU`

   * 实时状态：`hp`, `maxHp`, `san`, `maxSan`, `mp`, `insane` (bool), `outOfAction` (bool)

   * 核心技能（约 12 项）：`侦查`, `图书馆`, `聆听`, `话术`, `说服`, `心理学`, `格斗`, `闪避`, `急救`, `神秘学`, `锁匠`, `潜行`

   * 物品与密信：`inventory: string[]`, `handout: string`

   * *角色导入联动*：通过 `bridgeTools` 读取邻舍「酒馆」角色人设与外观 Tag，开局时用一次 LLM 调用自动生成契合人设的 CoC 属性与 2\~3 个特长技能。

2. **标准模组结构（`scenario.json`）**：

   * 官方内置 2\~3 个 15\~30 分钟的完整短篇模组（如古宅失踪、深夜列车、雾港灯塔）。

   * **外部剧本解析接口（`POST /ext/parse-scenario`）**：玩家上传 `.md` / `.txt` / `.json` 剧本后，由后端调用 LLM 提取为以下标准结构，并在开局前展示可编辑预览：

     ```
     {
       "meta": { "title": "", "era": "1920s / 现代", "stylePrompt": "dark lovecraftian oil painting..." },
       "scenes": [{ "id": "s1", "name": "", "publicDesc": "", "hiddenNotes": "", "imagePrompt": "" }],
       "clues": [{ "id": "c1", "title": "", "content": "", "sceneId": "s1", "requiredSkill": "侦查", "isSecret": false }],
       "npcs": [{ "id": "n1", "name": "", "persona": "", "secret": "" }],
       "keeperSecrets": "模组完整真相、幕后黑手与关键事件时间线"
     }
     
     ```

### 6.3 核心引擎流转（双模式 + 分段批处理 + 断点）

1. **三层上下文严格隔离**：

   * `publicLog`：公共场景、对话、公开掷骰结果（全员可见）；

   * `kpSecrets`：模组真相、隐藏节点、暗骰结果（**模式 A 下绝对不注入 AI 调查员 Prompt**）；

   * `handouts[charId]`：私密线索与单独的 SAN 幻觉，仅注入对应角色。

2. **AI 调查员「分段批处理 + 检定断点」**：

   * 后端调用 LLM 一次模拟除玩家外所有存活且未退场（`!outOfAction`）的 AI 调查员互动，强制输出 JSON 数组：

     ```
     [
       { "speaker": "角色A", "dialogue": "这扇门锁死了，我试试看能不能撬开。", "action": "拿出撬锁工具蹲在门前", "check": { "skill": "锁匠", "reason": "尝试撬开地下室铁门" } },
       { "speaker": "角色B", "dialogue": "小心点，我帮你照着手电筒。", "action": "举起手电筒戒备" }
     ]
     
     ```

   * **断点截断**：前端按群聊节奏逐条弹出气泡；一旦遇到带有 `check` 字段的条目，**立即停止推送该条之后的气泡**，把“实际已播出的条数”回传后端锁定上下文，随即进入掷骰与裁决流程。

   * **玩家插话抢麦**：玩家在气泡推送中途打字插话或点击暂停时，前端立即作废队列中未播出的气泡，并将已播出截断点与玩家新发言合并提交后端开启下一轮。

3. **确定性 D100 规则引擎（`server/index.mjs`）**：

   * 由后端真随机生成 `1~100`，对比目标技能值计算结果等级：

     * `1` 或 `<= 5`（视简化规则）：大成功

     * `<= floor(skill / 5)`：极难成功

     * `<= floor(skill / 2)`：困难成功

     * `<= skill`：普通成功

     * `> skill` 且 `< 96`：失败

     * `>= 96`（或 `100`）：大失败

   * **退场判定**：`hp <= 0` 或 `san <= 0` 时，自动标记 `outOfAction = true`，从后续批量扮演名单中剔除，提示玩家选择“引入替补调查员”或“推进结局”。

4. **模式 B：角色当 KP（KP Agent）**：

   * 实例化 KP Agent 时，System Prompt 拼接：`[所选邻舍角色的性格/口癖]` + `[CoC 轻量化主持规范]` + `[完整模组 keeperSecrets]`。

   * 为 KP Agent 注册专属 Function Calling Tools：

     * `request_and_roll_dice(targetChar, skill, difficulty)`

     * `update_investigator_stat(targetChar, hpDelta, sanDelta, reason)`

     * `reveal_clue(clueId, targetCharOrAll)`

     * `switch_scene(sceneId)`

     * `send_secret_handout(targetChar, content)`

### 6.4 长局摘要、主世界记忆隔离与异步生图

* **幕间自动摘要**：每次调用 `switch_scene` 时，后端自动将上一幕压缩为结构化摘要（`已获线索 + 关键事件 + 角色状态变化`），后续请求仅携带「模组大纲 + 历次幕间摘要 + 当前幕最近 15 轮原文」，防止长局上下文爆炸。

* **主世界记忆隔离**：跑团过程中不写入主世界的长期记忆；结团画面提供可选开关——「将本次跑团作为“桌游/剧本杀回忆”写入角色长期记忆」，避免角色在日常私聊中把克苏鲁遭遇当成真实经历。

* **非阻塞关键节点生图**：在**切换场景**、**掷出大成功 / 大失败**、**触发遭遇战**时，后端异步调用 `imageService`（带 `outputScope: 'game'`），Prompt 自动拼接 `scenario.meta.stylePrompt` + 当前场景/事件描述（默认优先场景空镜或事件特写，保证出图速度与稳定性）；前端先正常推进文字与动画，收到图片落盘推送后热更新背景或弹出事件 CG 卡。

## 七、 给 6.1 sol 的分阶段执行清单

1. **Stage 1（后端底座）**：实现 `installed_games` / `game_sessions` SQLite 表、`gameManager.js`（扫描、校验、插件加载与错误隔离）、`gameBridge.js`（复用神说只读工具并过滤密钥），以及生图服务的 `outputScope: 'game'` 落盘改造。

2. **Stage 2（导入与前端宿主）**：实现 `gameImporter.js`（GitHub Topic `linshe-game` 直连抓取与 TTL 缓存、GitHub Archive 下载、Zip 安全解压）、`GameCenter.vue`、`GamePlayer.vue` 与 `LinSheGameSDK`。

3. **Stage 3（跑团后端插件）**：编写 `games/official/trpg-simulator/server/index.mjs`（D100 规则引擎、三层上下文、分段批处理、KP Agent Tools、外部剧本解析器、幕间摘要、异步生图触发）。

4. **Stage 4（跑团风格化前端与内置模组）**：构建 `games/official/trpg-simulator/web/` 独立暗黑桌游风界面（全员 HUD、D100 骰子动画、线索背包、模式 A KP 控制台、结团记忆写入开关），并内置至少 1\~2 个完整短篇 CoC 模组 JSON。