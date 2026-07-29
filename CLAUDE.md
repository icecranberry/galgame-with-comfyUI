# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概述

本地 AI 虚拟伴侣平台（从"图像生成智能体"演化而来）。用户与可自定义人格的 AI 角色对话，角色具备情绪、记忆、好感度、日程作息，会主动聊天、发朋友圈、写信、参与群聊、经历生活片段（奇遇），并根据对话上下文通过 ComfyUI (SDXL/FLUX) 生成图像推送到前端。

## 技术栈

| 组件 | 技术 | 端口 |
|------|------|------|
| 前端 | Vue 3 + Pinia + Vue Router + Vite + vue-easy-lightbox | 5173 |
| 主控后端 | Node.js + Express (ESM) + sharp (图片压缩) | 3099 |
| 向量服务 | Python FastAPI + ChromaDB + ONNX Runtime + 爬虫 | 8765 |
| LLM | DeepSeek API (兼容 OpenAI SDK，透传) | - |
| 生图引擎 | ComfyUI (WebSocket + HTTP) | 8188 |
| 数据库 | SQLite (better-sqlite3) + FTS5 | - |
| 嵌入模型 | Jina v2 base zh (768d, ONNX, 均值池化 + L2 归一) | - |
| 安卓壳 | android-shell/（gitignore，本机存在，`npm run apk` 构建，含 SSE 通知服务） | - |

## 常用命令

```bash
# 一键启动全部开发服务（清理端口 → 检查环境 → 启动三项服务 → 自动打开浏览器）
npm run dev          # 项目根目录

# 分别启动
cd agent-core && npm run dev          # Express + nodemon --watch
cd web-ui && npm run dev              # Vite HMR
cd vector-service && ./venv/Scripts/python.exe -m uvicorn server:app --host 0.0.0.0 --port 8765

# 停止所有开发服务（优雅退出 → 等待 → taskkill）
npm run stop

# 生产部署（PM2）
pm2 start ecosystem.config.cjs

# 测试 ComfyUI 连接
curl http://localhost:3099/api/images/comfyui-health
```

## 项目结构

```
project-root/
├─ agent-core/              # 主控后端 (Express, :3099)
│  ├─ app.js                # 入口：中间件、路由挂载、11 个调度器启动、WAL 定期 checkpoint、优雅退出
│  ├─ data/                 # 运行时数据（DB、图片、头像，gitignore）
│  ├─ public/               # web-ui build 产物（gitignore）
│  └─ src/
│     ├─ config.js          # 配置中心（dotenv + DB 持久化 + .env 写回，三通道同步）
│     ├─ builtinRules.js    # 内置规则统一管理（破限词/生图规则/判断规则/对话规则/意图正则）
│     ├─ db/index.js        # SQLite 表/FTS5/触发器/索引/种子/迁移/repairFtsIndex/规则读取
│     ├─ llm/llm-client.js  # OpenAI 兼容客户端（chatSync + chatStream，含重试/并发限制/usage 日志）
│     ├─ middleware/errorHandler.js
│     ├─ utils/sentenceSplitter.js  # 流式分句器（闸门检测 + 成对符号保护）
│     ├─ routes/
│     │  ├─ chat.js         # SSE 流式对话 + 三种生图触发 + 睡眠/回复队列拦截 + 后处理
│     │  ├─ groups.js       # 群聊 CRUD + 群消息 SSE 流 + 冷场续聊 nudge
│     │  ├─ images.js       # 生图 API（tasks CRUD、直接生成、测试画风、健康检查）
│     │  ├─ characters.js   # 角色 CRUD + AI 生成（含联网搜索）+ 头像上传/AI 生成 + 送礼
│     │  ├─ config.js       # 配置读写（ComfyUI/LLM profiles/用户/规则/画师收藏/功能开关）
│     │  ├─ moments.js      # 朋友圈（帖子生成、评论、点赞、AI 自动回复）
│     │  ├─ events.js       # 奇遇事件（列表/分支选择/结局/SSE 旧通道）
│     │  ├─ schedule.js     # 日程（概览/瞄一眼/重生成/重置世界线/电话及上门叫醒）
│     │  ├─ mailbox.js      # 信箱（用户写信 → 角色延迟手写回信）
│     │  ├─ workflows.js    # ComfyUI 工作流模板管理
│     │  ├─ stream.js       # 统一 SSE 端点 /api/stream（前端唯一长连接）
│     │  ├─ memory.js       # 记忆检索、碎片查询/删除（同步 Chroma）、情绪历史
│     │  ├─ relationships.js      # 角色间关系 CRUD（有向图）
│     │  ├─ userRelationships.js  # 用户→角色关系 CRUD（含誓约 is_oath）
│     │  ├─ portraits.js          # 用户画像 CRUD（角色视角）
│     │  └─ notifications.js      # 旧版主动聊天 SSE 通道（前端已迁走，安卓壳可能仍用）
│     └─ services/
│        ├─ contextAssembler.js      # 上下文组装（稳定块/摘要/checkpoint 历史/动态尾部 + hash）
│        ├─ emotionEngine.js         # VAD 三维情绪引擎（双层衰减 + 规则表/LLM + 好感度变化）
│        ├─ memoryExtractor.js       # 异步记忆碎片提取（LLM → 向量化 → ChromaDB + SQLite）
│        ├─ memorySearch.js          # 三路召回 + RRF 融合（keyword + vector + entity，统一 SQLite id 为 key）
│        ├─ summarizer.js            # 滚动摘要（每 10 条 assistant 消息推进一次 checkpoint）
│        ├─ vectorClient.js          # Python 向量服务 HTTP 客户端（embed/search/upsert/delete）
│        ├─ imageSkill.js            # 生图调度（注入 workflow → 提交 ComfyUI → 兜底文件夹，turbo/base/hybrid 选择）
│        ├─ comfyClient.js           # ComfyUI GUI→API 转换 + WebSocket 进度 + 轮询兜底
│        ├─ workflowTemplates.js     # 工作流模板内置副本（缺失自动恢复）
│        ├─ groupChatEngine.js       # 群聊引擎（单次 LLM 批量剧本 + 行协议流式解析）
│        ├─ groupIdleScheduler.js    # 群聊后台调度（预算制闲聊 + 角色自发建群）
│        ├─ momentScheduler.js       # 朋友圈定时调度（每 10 分钟扫描，排队发帖）
│        ├─ momentInteractionService.js # 朋友圈关系网互动（角色互评 + 连锁回复）
│        ├─ proactiveChatScheduler.js # 主动聊天三线调度器（VAD + 频率 + 启动，含动机分档/配图）
│        ├─ eventScheduler.js        # 奇遇调度（事件生成线 + 半程通知线）
│        ├─ eventGenerator.js        # 生活片段生成器（类型库 + 分支 + 结局入记忆）
│        ├─ scheduleGenerator.js     # 日程生成器（LLM 生成 24h 时间表模板）
│        ├─ scheduleManager.js       # 日程运行时（当前活动缓存/睡眠状态同步/临时唤醒）
│        ├─ replyQueueScheduler.js   # 回复队列调度（延迟回复合并 + 日程分散刷新，每 1 分钟）
│        ├─ wakeService.js           # 叫醒处理（电话/上门/摇醒 → 回复 + 抢占积压队列）
│        ├─ disturbModeScheduler.js  # 防打扰模式（时间段内关三开关，段外恢复原状态）
│        ├─ mailboxScheduler.js      # 信箱调度（每 60s 扫描待回信，含僵尸信件回收）
│        ├─ weatherService.js        # 实时天气（小时级缓存入 weather_hourly 表）
│        ├─ timeLight.js             # 时间+光线描述生成（融合天气，供各生图场景共用）
│        ├─ imageCompressor.js       # 图片压缩调度（OxiPng 无损 / AVIF，cursor 续传）
│        ├─ handwritingFontService.js # 角色手写字体分配（LLM 按人格从 23 种字体选）
│        ├─ portraitExtractor.js     # 用户画像异步提取（每 10 条触发，向量去重）
│        ├─ unifiedStreamBus.js      # 统一 SSE 总线（所有模块广播到同一组客户端）
│        ├─ notificationBus.js       # 旧通知总线（现转发到统一总线，待收尾删除）
│        ├─ eventNotificationBus.js  # 旧事件总线（同上）
│        ├─ llmConcurrency.js        # 后台 LLM 并发信号量（serializeBackgroundLLM 开启时生效）
│        ├─ llmTelemetry.js          # per-turn LLM 调用汇总（AsyncLocalStorage，静默 10s 出汇总日志）
│        ├─ characterSearch.js       # 角色名注册表（对话/事件中交叉角色检测）
│        ├─ oathUtils.js             # 誓约戒指描述（is_oath 角色外观追加）
│        ├─ webSearch.js             # 联网搜索（萌娘百科→Bing 降级，含 LLM 关键词提取）
│        └─ seeds.js                 # 默认角色种子数据
├─ web-ui/                  # Vue 3 前端 (Vite HMR, :5173)
│  ├─ vite.config.js        # Vite 配置（含 SSE 代理 timeout:0 防断开）
│  └─ src/
│     ├─ main.js            # 入口：hash mode 10 路由（/chat/:id /group/:id /moments /events /schedule /gallery /tavern /mailbox /settings）
│     ├─ userConfig.js      # 用户自有配置（头像/昵称/自画像，独立于角色）
│     ├─ stores/            # chat / groups / moments / events / schedule / mailbox / notifications / settings / unifiedStream
│     ├─ api/index.js       # 后端 API 封装（含 SSE ReadableStream 解析）
│     ├─ views/             # 9 个视图页面（ChatView / GroupChatView / MomentsView / EventsView / ScheduleView / GalleryView / TavernView / MailboxView / SettingsView）
│     └─ components/        # 28 个组件（NavBar/Sidebar/Gallery/关系图/信件/事件卡片等）
├─ vector-service/          # 向量服务 (Python FastAPI, :8765)
│  ├─ server.py             # /embed /search /upsert /delete /delete-by-conversation /health /scrape
│  ├─ embedding.py          # ONNX 推理（Jina v2, mean pooling + L2 normalize）
│  ├─ chroma_store.py       # ChromaDB 持久化（cosine 空间）
│  └─ download_model.py     # 模型下载脚本（~155MB, hf-mirror.com）
├─ workflow/                # ComfyUI workflow 模板（制图工作流.json = turbo，-pro.json = base）
├─ scripts/
│  ├─ dev.mjs               # 一键 dev 启动（端口清理含进程身份验证→环境检查→模型下载→三进程+浏览器）
│  └─ stop.mjs              # 一键停止所有 dev 服务
├─ ecosystem.config.cjs     # PM2 生产配置（agent-core + vector-svc）
└─ CLAUDE.md
```

## 核心架构决策

### 消息双表设计

- **`raw_messages`**: 完整 LLM 对话原文（包括 `{"prompt":"..."}` JSON 格式），给 LLM 构建上下文用。每轮 user + assistant 各一条。
- **`messages`**: 分句展示气泡，按句子拆分存储，每个气泡一条。带 `images`/`is_proactive` 列。前端通过 `seq` 排序。
- 这样把"LLM 需要的完整上下文"和"前端需要的分句展示"解耦。
- **群聊约定**: 群会话 conversation_id 为 `group_{id}`；raw 每轮一条、content 自带 `[名字]: 内容` 前缀（多行剧本），messages 每气泡一条、`speaker_character_id` 标记发言角色。

### 上下文组装与前缀缓存 (contextAssembler)

所有 1:1 对话请求经 `buildChatContext()` 统一组装（revision `chat-context-v3`），布局针对 DeepSeek 前缀缓存优化：

```
[system] 稳定块（舞台/人格/用户上下文，逐字节可复现） → [system] 摘要块 → checkpoint 历史 → 活跃聊天历史 → 最新 user 消息（尾部附 <dynamic_context> 动态块）
```

- 动态内容（情绪/记忆/日程/时间）一律放入最新 user 消息尾部的 `<dynamic_context>`，不污染稳定前缀。
- `getSplitHistory()` 以最新摘要的 `end_msg_id` 为冻结分界线：分界前为 checkpoint 历史（固定 10 条 assistant），分界后为活跃窗口（最多 10 条 assistant）。
- 群聊引擎同理：群名片/花名册/输出协议放稳定块（成员关系查询带 ORDER BY 保证行序确定），transcript append-only 增长。

### 滚动摘要 (Summarizer)

每 10 条 assistant 消息触发一次（含主动聊天），生成新摘要并把 checkpoint 边界（`rolling_summaries.end_msg_id`, `checkpoint_version=1`）向前推进。摘要既是记忆压缩也是上下文分界线。

### 人格引擎三层叠加

```
固定人格 (Base Prompt) → 动态情绪 (VAD Emotion Engine) → 动态记忆 (RRF RAG Recall)
```

情绪引擎细节：双层 VAD 模型 — `mood` (decay=0.98, 长期底色) + `instant` (decay=0.85, 即时反应)，综合情绪 = mood×0.4 + instant×0.6。刺激评估优先走规则表（高频场景），未命中才调 DeepSeek 兜底。每次对话后计算情绪变化并写入 `emotion_snapshots`（每 conversation 仅保留最新一条，UNIQUE 约束）。

### 好感度系统 (Affinity)

每次对话后情绪引擎计算 `affinity_delta`（-5~+5），更新 `user_relationships.affinity`（0~100，初始 50）。

- **回归衰减**: 连续 24h 未互动，自动衰减 -1（下限 0）。`last_interaction_at` 记录最近互动时间。
- **送礼系统**: 小礼物 (+5, 冷却 1h) / 大礼物 (+15, 冷却 12h)。全局冷却（跨角色共享），`gift_history` 表持久化。
- **誓约 (is_oath)**: `user_relationships.is_oath=1` 的角色视为誓约关系，`oathUtils.appendOathRing()` 在人格/生图 prompt 中追加银白细戒指外观描述。
- **前端实时推送**: 对话 SSE 流中通过 `affinity_update` 事件推送变化量，ChatView 触发 roll 数值动画。

### 记忆系统：三路召回 + RRF 融合

每轮对话后异步提取记忆碎片（fact/preference/emotion）→ 向量化 → ChromaDB + SQLite（`memory_fragments.chroma_id` 关联两库）。检索时三路并行：
1. **Keyword** — SQLite LIKE 多关键词匹配（中文滑窗分词 2-4 字）
2. **Vector** — ChromaDB 余弦相似度，命中后**用 chroma_id 反查 SQLite id 作为统一 RRF key**（SQLite 中已删除的孤儿向量直接丢弃），content/entities 以 SQLite 为准
3. **Entity** — 关键词匹配到的实体 → 二次 JOIN 扩展

RRF 融合排序（关键词/实体通道 k=60，向量通道 k=120 权重减半，fact 类型 1.5× 加权）取 Top 10 注入 system prompt。向量通道不能独立主导：必须有关键词或实体命中才会纳入融合。

**数据一致性**: 单条删除（`DELETE /api/memory/fragments/:id`）与会话级清空都会同步删除 ChromaDB 向量，防止已删记忆从向量通道"复活"。eventGenerator 写入的事件记忆不向量化（无 chroma_id），仅走 keyword/entity 通道。

已知调优计划见 `RAG_OPTIMIZATION_PLAN.md`（角色名污染、DF 过滤、逐条证据下限、时间衰减等，尚未实施）。

### 用户画像系统 (User Portrait)

角色视角下的用户特征提取，每个角色独立维护其"眼中"的用户画像。

- **异步提取** (`portraitExtractor.js`): 每 10 条用户消息触发一次，LLM 从对话中提取三大维度（appearance/personality/preference），写入 `user_portraits` 表（`UNIQUE(character_id, trait_type, content)` 防重复）。
- **向量相似度去重**: 新 trait 与已有 portrait 批量嵌入 → 余弦相似度 > 0.85 判定为语义重复，跳过写入。向量服务不可用时静默回退到 UNIQUE 约束。
- **手动管理**: 前端 TavernView 中可查看/添加/编辑/删除画像，支持一键清空某角色的全部画像。

### 角色关系图 (Character Relationships)

有向关系图，两个独立的概念：
- **角色间关系** (`character_relationships`): 有向边 from→to + relationship_text，UNIQUE(from, to)。前端在 TavernView 的关系编辑面板中可视化。
- **用户-角色关系** (`user_relationships`): 单例用户对每个角色的关系描述 + 好感度数值 + 誓约标记。UNIQUE(character_id)。

### 交叉角色检测 (characterSearch)

内存角色名注册表（启动/角色变更时 `refresh()`）。chat.js 扫描最近三轮对话 + 用户输入，检测提及的其他角色，将其人格/外观注入上下文与生图 prompt（群像图）。事件生成同样复用 `matchAll()`。

### 图像生成三种触发路径

1. **路径 A（强匹配）**: 用户消息命中 `detectImageIntent()` 正则（70+ 条规则，内置于 builtinRules.js），直接注入 image_prompt 规则到 system prompt，强制模型输出 `{"prompt":"..."} JSON 格式`
2. **路径 B（模型自主）**: 模型在回复中自行输出 `<needImage>` 标签，后端二次请求模型补上 `{"prompt":"..."} JSON 格式`，走异步生图
3. **路径 C（静默判断）**: 系统强制开启，对话后调用一次轻量 DeepSeek（"是/否"，~300ms），判断是否应该配图。失败时默认不生图

### 工作流模式 (turbo / base / hybrid)

`config.workflow.mode` 三种取值：`turbo`（制图工作流.json，快速）、`base`（-pro.json，高质量）、`hybrid`（按场景映射：chat→turbo，moments/events/schedule/mailbox→base，`config.workflow.scene` 可配）。`workflowTemplates.js` 内置模板副本，启动时自动补全缺失文件（不覆盖已有）。LoRA 通过动态注入 `LoraLoaderModelOnly` 节点堆叠实现（全局画风 LoRA + 角色 LoRA）。

### 灵性生图模式 (forceImageGen)

`config.features.forceImageGen=true` 时启用。per-conversation 计数器（`imageJudgeCounters`，初始值 3）：
- 用户每发一条消息，对应 conversation 的计数器 -1
- 计数器归零时跳过 LLM 判断，直接走路径 A（强匹配），强制生图
- 生图成功后计数器重置为 3

### 日程系统 (Schedule)

角色拥有 LLM 生成的 24 小时日程模板（8-15 个活动），决定"此刻在干什么"和回复延迟。

- **生成** (`scheduleGenerator.js`): 角色创建时立即生成；每日分散刷新（replyQueueScheduler 每 tick 只刷 1 个角色）；可手动强制重生成 / 重置世界线（全员重生成，SSE 推进度）。
- **运行时** (`scheduleManager.js`): 当前活动 1 分钟缓存；`is_sleeping`/`sleep_until` 状态同步到 characters 表；临时唤醒（temporary_wake_until）管理。
- **回复延迟拦截** (chat.js 入口): 角色忙碌 → 用户消息写入 `reply_queue`，返回 queued 响应不启动对话流；睡眠 (delay=-1) → 建立 SSE 推送 Zzz 消息 + "瞄一眼"睡颜生图。另有 DB `is_sleeping` 标志兜底拦截（日程未命中时）。
- **回复队列** (`replyQueueScheduler.js`, 每 1 分钟): 到期 waiting 条目按角色合并为一条回复（对所有延迟类型通用）；sleeping 回复后恢复朋友圈/奇遇系统。
- **叫醒** (`wakeService.js` + schedule 路由): 电话叫醒（40% 概率，最多 3 次）/ 上门摇醒（必成）。被叫醒后原子抢占 reply_queue 积压消息一并回复，groggy 状态提示注入首条消息。

### 奇遇事件系统 (Events / 生活片段)

角色"今天的生活状态"快照，非剧情事件。EVENT_TYPES 类型库按时段组织（晨间/出门前/…），desc 只描述状态，具体内容由 LLM 按人格+世界观自由创作。

- **调度** (`eventScheduler.js`) 两条线：事件生成线（freq=1 时每 30 分钟扫描，到期结算 + 冷却 4-12h 后生成新事件，processing 锁防并发）；半程通知线（每 3 分钟，事件过半未互动 → 生成主动消息紧急联络，走主动聊天通道推送）。
- **交互** (`eventGenerator.js`): generateEvent 生成片段+配图 → 用户选择分支 generateNextBranch 接续 → 到期 concludeEvent 生成结局并写入记忆（未互动的事件记忆会被下一次覆盖替换）。
- 事件 VAD 影响：进行中事件通过 `getEventVadModifier()` 参与情绪计算。

### 群聊系统 (Group Chat)

**核心设计（高缓存）**: 每轮只发起一次 LLM 调用，输出多角色多条消息的"剧本"，行协议 `角色名: 内容`（或 `角色名: {"prompt":"..."}` 发图），流式解析逐条落库+推送，每轮最多 6 条。

- **上下文布局**: 舞台块（与 1:1 同串）→ 群名片（花名册/成员关系/输出协议，稳定）→ 群滚动摘要 → transcript（append-only）→ 本轮指令。
- **触发**: 用户发言（`POST /api/groups/:id/chat`，SSE）；冷场续聊 nudge；后台闲聊（`groupIdleScheduler` 每 10 分钟扫描，每群每日预算 `groupIdleBudget` 轮，跨天重置）；角色自发建群（每 6h 判定，30% 概率，好感度≥60 且有关系出边的角色拉关系角色建群，上限 3 个）。
- **记忆/摘要**: 复用 summarizer（transcript 超 40 条 raw 推进边界保留 24 条）与 memoryExtractor。

### 信箱系统 (Mailbox)

用户写信给角色，角色 3~10 分钟后"手写"回信。

- `mailboxScheduler.js` 每 60s 扫描 pending 信件；启动时回收卡在 processing 的僵尸信件。
- 回信 LLM 上下文含：人格 + 情绪 + 日程 + 记忆检索（hybridSearch）；可随信生图。
- **手写字体** (`handwritingFontService.js`): LLM 按角色人格从 23 种中文手写字体中选一种，存 `characters.handwriting_font`，前端信件渲染使用。

### 主动聊天系统 (Proactive Chat)

角色在用户不在线时主动发起对话，三条线并行调度：

**线路 A · VAD/好感度调度**（每 5 分钟扫描）：
1. 查找 `next_proactive_at <= now` 且 `proactive_disabled=0` 的角色
2. 计算 `proactiveScore = timeScore×0.5 + affinityScore×0.3 + vadScore×0.2`（sigmoid 函数，距上次聊天时间越久/好感度越高/情绪越积极，分数越高）
3. score 映射为下次间隔（1h~15h），加 ±30% 随机抖动防扎堆
4. 生成自然口语开场白（15~50 字），LLM 调用使用角色人格 + VAD 情绪 + 好感度状态

**线路 B · 频率强制线**：`proactiveChatFreq` 映射为固定计时器（freq=1→5min, freq=0.1→2h），定时随机触发一个角色，独立于 VAD 评分。

**线路 C · 启动暖场线**：服务启动 1~3 分钟后单次随机触发一个角色，给用户"有人找"的第一印象。触发完即结束。

**聊天动机按好感度分档**（向下兼容，高好感度覆盖低档全部话题）：
- 基础（affinity≥0）: 分享见闻、好奇提问、日常问候等 6 种
- 中等（affinity≥60）: 无聊了、回忆往事、吐槽发泄等 8 种
- 密友（affinity≥70）: 分享秘密、聊人生困惑、撒娇等 5 种
- NSFW（affinity≥80）: 深夜发情、睡前撩拨等 5 种

**未回复连续计数** (`proactive_streak`): 角色每发一次主动消息 +1，用户回复后归零。streak≥3 时暂停该角色的主动聊天。streak=1/≥2 时有不同的语气策略（自然过渡→自嘲解围），随机选取避免 LLM 形成固定模式。**重逢提示**: 当 streak≥2 且用户回复时，在 LLM 上下文中注入 system 级"重逢提醒"，告知角色用户回来了。

**配图生成**: 部分动机（如天气感叹、分享美食）会额外调用 LLM 生成画面描述 prompt，走 ComfyUI 异步生图后随消息一起 SSE 推送。

### 朋友圈系统 (Moments)

AI 角色自动发朋友圈，用户可评论、点赞，角色 AI 自动回复评论。

- **定时调度** (`momentScheduler.js`): 每 10 分钟扫描 `next_moment_at <= now` 的角色，每次只处理一个（排队串行）。发帖后随机设定 2~8 小时后的下次发帖时间。
- **帖子生成** (`generateMomentPost`): 单次 LLM 调用同时输出文案和配图 prompt（JSON 格式）。45 种随机风格覆盖全生活场景。JSON 解析多层兜底：正则提取 → JSON.parse → 补全截断 → 全文本兜底。
- **关系网互动** (`momentInteractionService.js`): 帖子发布后，关系网中的角色 Sigmoid 概率来评论（第 1 个必选，之后每个 50%），发帖人必回，30% 连锁继续，全帖最多 3 轮。与用户评论逻辑完全解耦。
- **评论自动回复**: 用户评论后，LLM 基于角色人设 + 帖子内容 + 评论区上下文生成 15~50 字回复。回复失败不阻塞评论写入。
- **独立生图参数**: 朋友圈配图使用 `momentsArtist`/`momentsWidth`(1600)/`momentsHeight`(1200)，与聊天生图分开配置（奇遇同理有 `eventArtist` 等）。生图失败不阻塞发帖。
- **未读时序方案**: `last_moments_seen_at` 时间戳，未读数 = `COUNT(*) WHERE created_at > last_seen`。

### 天气与时间光线 (Weather + TimeLight)

- `weatherService.js`: 每小时更新城市天气到 `weather_hourly` 表（内置密钥混淆，city 可配）。
- `timeLight.js`: 按当前小时映射中文时段 + 光线描述，融合天气修饰（晴/阴/雨→光线影响），供聊天生图、朋友圈、奇遇、瞄一眼等所有生图场景统一注入，避免"深夜大晴天"穿帮。

### 防打扰模式 (Disturb Mode)

`disturbModeScheduler.js` 每 10 分钟检测：在配置时间段内（默认 22:00-08:00，可跳过周末）将选中角色的 moments/proactive/events 三开关置 1，段外恢复 `dnd_original_state` 保存的原始状态。可选隐藏世界观（`hideWorld`，仅在 prompt 构建时生效不改 DB）。

### 统一 SSE 总线 (unifiedStreamBus)

前端只维护一条 SSE 长连接 `/api/stream`（释放 HTTP/1.1 6 连接限制）：

- 后端所有模块通过 `broadcast(eventType, data)` 广播：`proactive_message` / `new_post` / `new_event` / `event_update` / `group_message` / `schedule_*` / 压缩进度等。
- 前端 `stores/unifiedStream.js` 单连接 + 指数退避重连（1s→30s），各 store 通过 `onEvent(type, handler)` 订阅；断连期间靠各 store 的 30s poll 兜底。
- **迁移未收尾**: 旧端点 `/api/notifications/stream`、`/api/moments/stream`、`/api/events/stream` 及 notificationBus/eventNotificationBus 壳仍保留（现均转发到统一总线；安卓壳的 SSE 通知服务可能依赖旧端点，删除前需确认）。

### LLM 调用治理

- **后台并发限制** (`llmConcurrency.js`): `serializeBackgroundLLM=true` 时，后台任务（朋友圈/奇遇/主动聊天配图等 LLM+ComfyUI 全流程）经信号量限流（`backgroundLLMMaxConcurrency`，默认 3）。云端 API 用户默认关闭、零开销。
- **per-turn 汇总** (`llmTelemetry.js`): chat/groups 路由入口 `beginTurn(conversationId)` 后，本轮所有 LLM 调用（含响应结束后的异步后处理链）经 AsyncLocalStorage 自动归集，最后一次调用后静默 10s 输出汇总日志：调用次数、prompt/输出 token、缓存命中率、按 label 明细。后台调度器的调用不参与（保留单次日志）。
- **usage 日志**: 每次调用打印 token 用量与前缀缓存命中率（DeepSeek `prompt_cache_hit_tokens` / OpenAI 风格 `cached_tokens`）。

### 图片压缩 (imageCompressor)

- 定时任务：平时小压缩（30min/3 张），凌晨大压缩（10min/15 张）；也可立即全量压缩（SSE 推进度，可取消）。
- 两种模式：OxiPng（无损重编码覆盖原 PNG）/ AVIF（quality=50，删除原 PNG）。
- cursor 状态持久化（`data/image-compressor-state.json`），重启续传。app.js 的 `/images` 静态服务对已转 AVIF 的 .png 请求自动返回同名 .avif。

### 联网搜索 (Web Search)

角色生成/创建时，通过联网搜索获取 ACG 角色的真实背景资料，提升角色还原度。

- **搜索链路**: 萌娘百科（MediaWiki API）→ 无结果时降级到 Bing HTML 抓取
- **智能提取**: LLM 先从用户输入中提取核心角色名 + 作品上下文（如"绝区零里的千夏" → name="千夏", context="绝区零"），没有作品上下文则跳过搜索（视为原创角色）
- **重定向跟随**: 处理萌娘百科的角色简称/别名重定向（如"丽娜"→"亚历山德丽娜·莎芭丝缇安"）
- **消歧义处理**: 检测到消歧义页面时，尝试拼接作品名构造具体页面
- **深度抓取**: 命中后调用 Python 爬虫服务 (`/scrape`) 提取 infobox（本名/发色/瞳色/身高/萌点等字段）+ 正文，Node.js 侧有纯文本兜底提取
- **超时策略**: 萌娘百科单次 5s，Bing 抓取 8s

### 流式分句器 (SentenceSplitter)

核心机制：
- **3 字闸门检测**: 滑动窗口检测 `{"` 和 `{p`（含 Unicode 变体），命中后立即停止分句输出（防止生图 prompt JSON 暴露给用户），但 `fullContent` 继续累积
- **成对符号保护**: `《》【】「」（） "" ''` 配对时禁止在符号内分句
- **倒推补救**: 如果闸门在流开头就命中导致零气泡，从 `fullContent` 剥离 prompt JSON 后重新过一遍分句器
- 配合 20 字闸门 + 中英文标点分句规则（`。！？～~，`），在 SSE 流式输出时实时断句为气泡段

### Config 运行时持久化（三通道同步）

- **`system_settings` DB 表**：ComfyUI 参数、Feature Flags、用户信息、压缩/工作流/防打扰配置。启动时 DB 优先覆盖代码默认值。
- **`.env` 文件**：LLM API Key/BaseURL/Model、ComfyUI URL。通过 `persistEnv()` 写回 `.env`。
- **内存**: `config` 对象保持实时值，update 函数同时更新内存 + 持久化。
- **LLM Profiles**: 多套 LLM 配置快照（`/api/config/llm/profiles`），可切换激活。API Key 读取接口只返回脱敏预览。

### 优雅退出机制

避免 SQLite WAL 损坏和数据丢失：

1. `npm run stop`（或 Ctrl+C）→ 向 `http://localhost:3099/api/shutdown` 发 POST 请求
2. agent-core 收到 shutdown：先 WAL checkpoint (TRUNCATE) → `server.close()` → `closeDb()` → `process.exit(0)`
3. 5 秒硬超时兜底 + shuttingDown flag 防重入
4. 定期 WAL checkpoint（每 5 分钟 PASSIVE，已 `.unref()` 不阻塞退出），将异常退出数据损失窗口缩小到 ≤5 分钟
5. dev.mjs 在 taskkill 前先调 shutdown API + 等 5 秒

### 前端流式消费与健壮性

- SSE → `ReadableStream` 解析 → Pinia store 消费（含 3 次 fetch 重试 + 2 次 stream 内部重试 + 自适应安全超时：纯文本 30s/生图 600s）
- `client_msg_id` 幂等键防重入（`raw_messages` 上 partial unique index）
- 流中断静默重试：无完整气泡且无 msg_saved → 清理临时气泡 → 递减退避重试
- 双 SSE 通道：chat/groups（对话流，请求级）+ `/api/stream`（统一推送，常驻单连接）

### ComfyUI WebSocket 进度 + 轮询兜底

优先 WebSocket 监听实时进度（progress/executing/execution_error），60s 无活动则判定卡死。WS 失败或异常关闭时自动回退到轮询 history 接口（最多 600s）。`node:null` 消息到达后立即结算（不等 close），500ms 等待写盘后从 history 下载 base64 图片。

### Feature Flags

`config.features` 当前开关（在线可改，DB 持久化）：

| Flag | 默认 | 说明 |
|------|------|------|
| `emotion` | 开 | VAD 情绪引擎 |
| `memory` | 开 | 记忆系统（RAG 三路召回 + 异步碎片提取） |
| `replyGuesses` | 关 | 回复猜想（AI 回复后生成用户可能的下一句回复） |
| `forceImageGen` | 关 | 灵性生图（每 3 轮强制一张） |
| `realtimeAffinityDisplay` | 关 | 好感度实时显示（对话 SSE 推送 affinity_update） |
| `proactiveChat` | 开 | 主动聊天（角色自主发起对话） |
| `proactiveChatFreq` | 0.5 | 主动聊天频率 0~1，影响线路 B 定时器间隔 |
| `events` | 开 | 奇遇事件系统 |
| `eventFreq` | 1 | 奇遇触发频率 0~1，0=关闭自动触发 |
| `schedule` | 开 | 日程系统（延迟回复/睡眠拦截） |
| `disturbMode` | 关 | 防打扰模式 |
| `weather` | 开 | 实时天气 |
| `groupChat` | 开 | 群聊系统 |
| `groupIdleBudget` | 5 | 每群每日后台闲聊轮数上限，0=关闭 |
| `serializeBackgroundLLM` | 关 | 后台 LLM 任务并发限制 |
| `backgroundLLMMaxConcurrency` | 3 | 后台最大并发数 (1-10) |
| `mergeMessages` | 关 | 合并连续同角色消息（兼容 LM Studio 严格 Jinja 模板） |

### 规则系统（内置 + 用户自定义）

**内置规则** 统一收束在 `builtinRules.js`（不存 DB、不可在线编辑）：`system_rules`（破限词，含 `<roleplay>` 标签控制角色扮演激活范围）、`image_prompt`（生图提示词格式规则）、`judge_prompt`（路径 C 生图判断）、`dialogue_rules`（核心对话规则）、`image_intent`（意图检测正则）。DB 侧 `getGlobalRule(key)` 对内置 key 直接返回硬编码常量。

**用户自定义**：`global_rules` 表只存用户新增的规则片段（`/api/config/rules` 管理，内置 key 被过滤不可覆盖）；世界观在独立的 `world_settings` 表（支持多套、`is_active` 切换），经 `getWorldSetting()` 注入（防打扰 hideWorld 时段返回 null）。

### 前端渲染优化

- **消息虚拟窗口**: 全量消息一次性加载到内存，`renderStart` + `visibleMessages` 控制渲染窗口，初始 50 条，上滚展开 30 条
- **历史生图气泡**: `rawToMessages()` 解析 `messages.images` JSON 列，为历史上已有图片的消息自动插入 `image_gen` 类型气泡
- **主动消息即时追加**: SSE 监听到主动消息时，如为当前活跃角色则直接追加到消息列表
- **角色列表动态排序**: 主动消息到达时按 `last_message_at` 降序重排，活跃角色冒泡到顶部
