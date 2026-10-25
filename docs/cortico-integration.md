# Cortico 集成

邻舍提供独立的 Cortico 桥接 API、三个 Cortico 扩展包（`cortico-world-linshe`、`cortico-bot-linshe`、`cortico-world-qq-linshe`），以及桌面启动器管理入口。原有 MaiBot 集成继续使用原路径。

## 首次接入

1. 打开邻舍启动器的 **Cortico** 页，点击 **安装环境**。安装器从 [Cortico 官方仓库](https://github.com/Pal-AI-Lab/Cortico)克隆源码到根目录 `Cortico/`，用 pnpm 准备依赖，把邻舍扩展包 link 进 `Cortico/extensions/`，并创建 `linshe` 部署。需要 Node.js 22+（自带 corepack）与 Git（优先使用邻舍捆绑 Git）。
2. 点击 **启动 Cortico**，打开后台（默认 `http://127.0.0.1:7900/`）配置模型端点与 QQ World。启动时会自动把邻舍服务地址同步进部署 `config.json`；可开启随邻舍启动、启动后打开后台，停止按钮和退出启动器会停止其管理的进程。端口冲突时不会接管或结束外部进程。
3. QQ 连接：Cortico 的 QQ World 走 OneBot v11 正向 WebSocket 连接 SnowLuma（默认 `ws://127.0.0.1:3001`，Token 即 SnowLuma 的 access token）。在 QQ World 的监听名单里添加要接入的群与私聊。
4. 邻舍 **设置 → Cortico 集成** 中选择初始角色、开放工具并保存；集成本地恒为启用，页面只保留 Cortico 后台与 SnowLuma 后台两个入口。
5. 模型端点使用 Responses API 兼容服务（内建 `openai-responses-compat`）。

## 人格与工具

两个扩展包都在 `agent-core/src/cortico-bridge/` 下，随邻舍仓库维护：

- `cortico-bot-linshe`（bot 包）：人格前缀由 `persona/PREFIX.md` 渲染——角色人设从桥接 API `/bootstrap` 实时拉取（约半分钟缓存），外加 QQ 举止守则、MEMORY.md 记忆与各 World 环境段。人物卡更新最迟半分钟生效；关闭注入则以通用助手兜底。切换角色后建议新建对话。行为 / 表达风格提炼自人物卡（按角色独立存储，设置页可编辑、可重新提炼，自动附「回复限制在30字内」与 Unicode emoji 禁令两行），随人物卡一起进前缀；保存风格或切换角色会即时触发 Cortico 前缀重载。
- `cortico-world-linshe`（world 包）：把下表工具暴露给模型。查询类直接转述桥接返回；生图、语音、朋友圈配图在工具内等待任务完成后以回执附件（`log:` 句柄）交付，由 QQ World 的 `qq_draft` 发送（图片走 `image` 参数，语音条独占一条消息只传 `voice`）。
- `cortico-world-qq-linshe`（world 包，`qq-segmented/`）：内置 QQ World 的分句变体（id `qq-linshe`），出站文字按邻舍私聊同一分句规则切分——起草时冻结分段并预览，确认后依次发送，图片与引用只附首段，失败保留余段、再次确认只补发剩余。**内置 `qq` World 必须保持停用**（两者工具同名，不能同时挂载）；启动器负责把部署配置从 `worlds.qq` 迁移到 `worlds.qq-linshe` 并停用旧段。上游 Cortico 源码零改动，详见 `qq-segmented/README.md`。控制台渠道暂保持整条发送。

已选择的角色同时是生图、TTS、人物卡、外观、日程、日记工具的默认角色；也可显式传入 `character_id`。

| 工具 | 能力 |
| --- | --- |
| `linshe_characters` | 列出角色和 ID |
| `linshe_character` | 查询完整人物卡 |
| `linshe_appearance` | 查询外观、生效衣装、限时服饰和可用形态 |
| `linshe_generate_image` | 按角色配置和用户描述生图，完成后随回执返回图片 |
| `linshe_draw` | 泛用画图：自由画面描述（人物、物品、场景皆可），描述中提到的角色自动带上外观；完成后随回执返回图片 |
| `linshe_tts` | 使用角色绑定音色朗读，完成后随回执返回语音 |
| `linshe_task` | 查询生图或语音任务状态；语音传 `kind="speech"` 与字符串 `task_id`，生图沿用数字 `task_id` |
| `linshe_moments` | 分页查询朋友圈，可按角色过滤 |
| `linshe_moment` | 查询动态正文与评论 |
| `linshe_moment_images` | 取回动态配图，由模型逐条发送到会话 |
| `linshe_schedule` | 查询日程与当前活动；默认只返回当前时间前后一小时，传 `full=true` 返回今日完整日程 |
| `linshe_newspaper` | 查询今日或指定日期的日报 |
| `linshe_diary` | 查询角色已生成的日记 |
| `linshe_world` | 查询当前世界观 |

查询不会主动生成内容；奇遇不在 Cortico 暴露（奇遇查询工具已下线，玩法回到邻舍奇遇页推进）。生图复用邻舍现有提示词与生成服务，需要配置 LLM 和生图服务；`linshe_draw` 走图片实验室「自由画面描述」链路（分层提示词 + 画面交叉参考）；TTS 需要启用语音服务并绑定角色音色。相同参数的生图请求返回同一任务（可用 `nonce` 区分），避免模型重试重复生成。

生图/语音等待上限由部署 `config.json` 的 `worlds.linshe.taskTimeoutSec` 控制（默认 240 秒）；超时回执给出任务 ID，模型可用 `linshe_task` 继续查询。

## HTTP 接口

前缀为 `/api/cortico`。邻舍是纯本地项目，桥接不做 Token 鉴权且恒为启用，仅工具分组开关约束能力面。

| 方法与路径 | 参数或结果 |
| --- | --- |
| `GET /health` | 桥接服务状态，不代表 QQ 连接已建立 |
| `GET /bootstrap` | 初始人格（含 `behavior_style` / `reply_style` 风格两段）与当前允许的工具清单 |
| `GET /characters` | 角色列表 |
| `GET /character`、`/appearance` | 可选 `character_id` |
| `GET /schedule` | 可选 `character_id`、`full`（`1`/`true` 返回今日完整日程；默认只返回当前时间前后一小时的条目，回执带 `scope` 与当前 `time`） |
| `GET /moments` | 可选 `limit`（最多 50）、`before_id`、`character_id`（只看该角色） |
| `GET /moments/:id` | 朋友圈详情 |
| `GET /moments/:id/images` | 朋友圈配图地址列表 |
| `GET /newspaper` | 可选 `date`（YYYY-MM-DD） |
| `GET /diary` | 可选 `character_id`、`date` |
| `GET /world` | 世界观 |
| `POST /generate` | JSON：`requirement`、`session_id`、`request_id`，可选 `character_id`；返回 `task_id` |
| `POST /draw` | JSON：`requirement`（自由画面描述）、`session_id`、`request_id`；走图片实验室链路，返回 `task_id` |
| `GET /tasks/:id` | 仅查询 Cortico 生图任务，完成后含 `image.url` |
| `POST /tts` | JSON：`text`，可选 `character_id`；返回语音任务 `id` |
| `GET /speech/:id` | 语音任务，完成后含 `audio_url` |

管理接口为 `GET/PUT /admin/settings`（`PUT` 可携带 `behavior_style` / `reply_style`，写入当前角色的风格）、`GET /admin/persona/:id` 与 `POST /admin/derive-style`（从人物卡提炼风格，纯预览不落库）、`POST /admin/clear-context`（转发 Cortico WebUI 的会话清空，删除当前对话记录并按最新人格前缀重开；Cortico 未运行时返回 502），供邻舍设置页与启动器使用，不向跨站浏览器开放。

## 维护与验证

- 桥接实现：`agent-core/src/cortico-bridge/`（`router.js`、`settings.js`、`tools.json` 共用工具清单，`world/`、`bot/` 为 Cortico 扩展包）。
- 扩展包改动后运行 `pnpm check:extension <包目录>`（在 Cortico 仓库根下）校验，并重启 Cortico 进程。
- 配置保存于邻舍数据库的 `cortico_bridge`；桥接为纯本地直连，无鉴权凭据。
- 启动器安装目录为 `Cortico/`；此目录排除出 Git 和发布包。重新点击安装环境可修复依赖并刷新扩展链接，保留部署配置。
- 前端按项目原有方式构建，启动器需重新打包才能将入口更新到现有 EXE。
- 在 `agent-core` 下运行 `node --test test/corticoBridge.test.js test/corticoPersonaDelivery.test.js`。桥接测试使用独立内存数据库，覆盖启用开关、工具分组权限、人物卡与风格存取、现有内容查询与任务幂等，不调用生产模型或消息平台；投递测试需要根目录 `Cortico/` checkout，缺失时自动跳过。
