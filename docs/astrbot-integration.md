# AstrBot 集成

邻舍提供独立的 AstrBot 桥接 API、可安装的 AstrBot 插件，以及桌面启动器管理入口。原有 MaiBot 集成继续使用原路径。

## 首次接入

1. 打开邻舍启动器的 **AstrBot** 页，点击 **安装环境**。安装器从 AstrBot 官方仓库下载 `v4.29.1`，用 uv 准备独立 Python 3.12 环境，并预置邻舍插件。首次安装需要网络与 Git（优先使用邻舍捆绑 Git）；uv 缺失时安装在邻舍自己的 runtime 目录。
2. 点击 **启动 AstrBot**，打开后台完成模型和消息平台配置。可开启随邻舍启动、启动后打开后台；停止按钮和退出启动器会停止其管理的进程。默认后台端口为 6185，端口冲突时不会接管或结束外部进程。
3. 邻舍 **设置 → AstrBot 集成** 中选择初始角色、开放工具，启用集成并保存。
4. AstrBot 的邻舍插件配置中填写邻舍服务根地址和桥接 Token，保存并重载插件。可从邻舍复制配置。连接已有 AstrBot 时，下载页面提供的 ZIP 并在 AstrBot 插件管理上传。
5. 使用支持工具调用的模型和 AstrBot 内置 Agent 执行器。若 AstrBot 人格限定工具列表，需将 `linshe_*` 工具加入该列表。

本机默认地址是 `http://127.0.0.1:3099`。Docker Desktop 可填写 `http://host.docker.internal:3099`，其他设备填写可访问的邻舍地址。媒体由插件读取后以 base64 交给消息适配器，不要求消息适配器直接访问邻舍。

默认所有 AstrBot 会话可使用已开放工具；插件的 `allowed_sessions` 可填写 `/sid` 返回的会话标识以限制范围。Token 重置立即撤销旧 Token，需要同步更新插件。下载的 ZIP 不含凭据。邻舍管理接口沿用现有管理入口的访问约定；插件接口单独校验 Bearer Token，管理页面应置于可信网络或现有受保护的反向代理后。

## 人格与工具

选中角色的 `base_prompt`（缺失回退 `short_prompt`）在每轮 LLM 请求前作为稳定前缀注入，保留 AstrBot 原系统指令及聊天历史。人物卡更新会在下一轮读取；关闭注入可只使用工具。动态衣装不写入人格前缀，通过外观工具查询。切换角色后建议新建 AstrBot 会话。

已选择的角色同时是生图、TTS、人物卡、外观、日程、日记工具的默认角色；也可显式传入 `character_id`。

| 工具 | 能力 |
| --- | --- |
| `linshe_characters` | 列出角色和 ID |
| `linshe_character` | 查询完整人物卡 |
| `linshe_appearance` | 查询外观、生效衣装、限时服饰和可用形态 |
| `linshe_generate_image` | 按角色配置和用户描述生图，异步发送图片 |
| `linshe_tts` | 使用角色绑定音色朗读，异步发送语音 |
| `linshe_moments` | 分页查询朋友圈，可按角色过滤 |
| `linshe_moment` | 查询动态正文与评论 |
| `linshe_moment_images` | 把动态配图发送到会话，支持帖子 ID 或图片路径 |
| `linshe_events` | 查询角色、镇民和建筑奇遇列表 |
| `linshe_event` | 查询奇遇详情、选项与已有选择历史 |
| `linshe_schedule` | 查询今日日程与当前活动 |
| `linshe_newspaper` | 查询今日或指定日期的日报 |
| `linshe_diary` | 查询角色已生成的日记 |
| `linshe_world` | 查询当前世界观 |

查询不会主动生成内容；奇遇选项仍在邻舍奇遇页推进。生图复用邻舍现有提示词与生成服务，需要配置 LLM 和生图服务；TTS 需要启用语音服务并绑定角色音色。相同消息的相同生图请求会返回同一任务，避免模型重试重复生成。

生成结果会发送到发起工具调用的会话。默认等待 600 秒，可在插件中调节至 30–3600 秒；单个媒体上限 32MB。插件重载会取消等待，但邻舍已提交任务继续运行；可在邻舍查看完成结果。

## HTTP 接口

前缀为 `/api/astrbot`。除 `/admin/*` 外都要求集成已启用，并携带 `Authorization: Bearer <Token>`。查询和任务接口还会校验对应工具分组权限。

| 方法与路径 | 参数或结果 |
| --- | --- |
| `GET /health` | 桥接服务状态，不代表 AstrBot 消息平台已连通 |
| `GET /bootstrap` | 初始人格与当前允许的工具清单 |
| `GET /characters` | 角色列表 |
| `GET /character`、`/appearance`、`/schedule` | 可选 `character_id` |
| `GET /moments` | 可选 `limit`（最多 50）、`before_id`、`character_id`（只看该角色） |
| `GET /moments/:id` | 朋友圈详情 |
| `GET /moments/:id/images` | 朋友圈配图地址列表 |
| `GET /events` | 可选 `limit`，分别限制当前与历史列表 |
| `GET /events/by-id/:id` | 保留列表返回的 ID，支持数字、`town:`、`bfeat:` |
| `GET /newspaper` | 可选 `date`（YYYY-MM-DD） |
| `GET /diary` | 可选 `character_id`、`date` |
| `GET /world` | 世界观 |
| `POST /generate` | JSON：`requirement`、`session_id`、`request_id`，可选 `character_id`；返回 `task_id` |
| `GET /tasks/:id` | 仅查询 AstrBot 生图任务，完成后含 `image.url` |
| `POST /tts` | JSON：`text`，可选 `character_id`；返回语音任务 `id` |
| `GET /speech/:id` | 语音任务，完成后含 `audio_url` |

管理接口为 `GET/PUT /admin/settings`、`GET /admin/persona/:id`、`POST /admin/rotate-token` 和 `GET /admin/plugin.zip`，供邻舍设置页使用，不接受插件 Token 作为管理权限。

## 维护与验证

- 桥接实现：`agent-core/src/astrbot-bridge/`；`plugin/tools.json` 是后端、设置页和插件共用的工具清单。
- 配置保存于邻舍数据库的 `astrbot_bridge` 与 `astrbot_bridge_token`，不增加配置文件密钥。
- 启动器安装目录为 `AstrBot/`，依赖在该目录的 `.venv`；此目录排除出 Git 和发布包。重新点击安装环境可修复依赖和刷新邻舍插件，保留 AstrBot 自己的配置。
- 前端按项目原有方式构建，启动器需重新打包才能将入口更新到现有 EXE。
- 在 `agent-core` 下运行 `node --test test/astrbotBridge.test.js test/astrbotPlugin.test.js`。桥接测试使用独立内存数据库；Python 测试需要 `aiohttp`，启动器测试还需要 `PySide6`、`psutil`（缺失时明确跳过）。测试覆盖鉴权、权限、人物卡、现有内容查询、任务幂等、媒体发送、安装计划、插件配置保留和真实子进程启停，不调用生产模型或消息平台。

AstrBot API 参考：[工具注册](https://docs.astrbot.app/dev/star/guides/ai.html)、[请求钩子](https://docs.astrbot.app/dev/star/guides/listen-message-event.html)、[消息发送](https://docs.astrbot.app/dev/star/guides/send-message.html)、[固定安装版本](https://github.com/AstrBotDevs/AstrBot/releases/tag/v4.29.1)。
