# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概述

本地 AI 图像生成智能体。用户与可自定义人格的 AI 角色对话，AI 根据对话上下文判断是否需要生成图像，通过 ComfyUI (SDXL/FLUX) 出图后推送到前端。

## 技术栈

| 组件 | 技术 | 端口 |
|------|------|------|
| 前端 | Vue 3 + Pinia + Vue Router + Vite + vue-easy-lightbox | 5173 |
| 主控后端 | Node.js + Express (ESM) | 3099 |
| 向量服务 | Python FastAPI + ChromaDB + ONNX Runtime + 爬虫 | 8765 |
| LLM | DeepSeek API (兼容 OpenAI SDK，透传) | - |
| 生图引擎 | ComfyUI (WebSocket + HTTP) | 8188 |
| 数据库 | SQLite (better-sqlite3) + FTS5 | - |
| 嵌入模型 | Jina v2 base zh (768d, ONNX, 均值池化 + L2 归一) | - |

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
│  ├─ app.js                # 入口：中间件、路由挂载、WAL 定期 checkpoint、优雅退出
│  ├─ data/                 # 运行时数据（DB、图片、头像，gitignore）
│  ├─ public/               # web-ui build 产物（gitignore）
│  └─ src/
│     ├─ config.js          # 配置中心（dotenv + DB 持久化 + .env 写回，三通道同步）
│     ├─ db/index.js        # SQLite 表/FTS5/触发器/索引/种子/迁移/repairFtsIndex
│     ├─ llm/llm-client.js  # OpenAI 兼容客户端（chatSync + chatStream，含重试/超时/截断）
│     ├─ middleware/errorHandler.js
│     ├─ routes/
│     │  ├─ chat.js         # SSE 流式对话 + 三种生图触发 + 后处理（情绪/记忆/画像/好感度）
│     │  ├─ images.js       # 生图 API（tasks CRUD、直接生成、测试画风、健康检查）
│     │  ├─ characters.js   # 角色 CRUD + AI 生成（含联网搜索）+ 头像上传/AI 生成 + 送礼
│     │  ├─ config.js       # 配置读写（ComfyUI/LLM/用户/规则/画师收藏/功能开关）
│     │  ├─ moments.js      # 朋友圈（帖子生成含 SSE 推送、评论、点赞、AI 自动回复）
│     │  ├─ memory.js       # 记忆检索、碎片查询、情绪历史
│     │  ├─ relationships.js      # 角色间关系 CRUD（有向图）
│     │  ├─ userRelationships.js  # 用户→角色关系 CRUD
│     │  ├─ portraits.js          # 用户画像 CRUD（角色视角）
│     │  └─ notifications.js      # 主动聊天 SSE 推送 + 未读红点 + 强制触发
│     └─ services/
│        ├─ emotionEngine.js         # VAD 三维情绪引擎（双层衰减 + 规则表/LLM + 好感度变化）
│        ├─ memoryExtractor.js       # 异步记忆碎片提取（DeepSeek → 向量化 → ChromaDB + SQLite）
│        ├─ memorySearch.js          # 三路召回 + RRF 融合（keyword + vector + entity）
│        ├─ summarizer.js            # 滚动摘要（每 50 条消息触发一次）
│        ├─ vectorClient.js          # Python 向量服务 HTTP 客户端（embed/search/upsert/delete）
│        ├─ imageSkill.js            # 生图调度（提示词优化 → 注入 workflow → 提交 ComfyUI → 兜底文件夹）
│        ├─ comfyClient.js           # ComfyUI GUI→API 转换 + WebSocket 进度 + 轮询兜底
│        ├─ momentScheduler.js       # 朋友圈定时调度（每 10 分钟扫描，排队发帖）
│        ├─ proactiveChatScheduler.js # 主动聊天三线调度器（VAD + 频率 + 启动，含动机分档/配图）
│        ├─ portraitExtractor.js     # 用户画像异步提取（每 10 条触发，向量去重）
│        ├─ notificationBus.js       # 通知总线（SSE 广播，services↔routes 解耦）
│        ├─ webSearch.js             # 联网搜索（萌娘百科→Bing 降级，含 LLM 关键词提取）
│        └─ seeds.js                 # 默认角色种子数据
├─ web-ui/                  # Vue 3 前端 (Vite HMR, :5173)
│  ├─ vite.config.js        # Vite 配置（含 SSE 代理 timeout:0 防断开）
│  └─ src/
│     ├─ main.js            # 入口：hash mode 6 路由（/chat/:id, /moments, /gallery, /tavern, /settings）
│     ├─ userConfig.js      # 用户自有配置（头像/昵称/自画像，独立于角色）
│     ├─ stores/
│     │  ├─ chat.js         # 核心 store（角色/消息/SSE 消费/重试/主动消息处理/好感度实时更新）
│     │  ├─ moments.js      # 朋友圈 store（帖子分页/SSE 监听/评论/点赞）
│     │  ├─ settings.js     # 设置 store
│     │  └─ notifications.js # 主动聊天通知 store（未读红点/SSE 监听）
│     ├─ api/index.js       # 后端 API 封装（含 SSE ReadableStream 解析 + 多通道 SSE 连接）
│     ├─ views/             # 5 个视图页面
│     └─ components/        # 8 个通用组件（NavBar/Sidebar/Gallery/AvatarCropper 等）
├─ vector-service/          # 向量服务 (Python FastAPI, :8765)
│  ├─ server.py             # /embed /search /upsert /delete /health /scrape
│  ├─ embedding.py          # ONNX 推理（Jina v2, mean pooling + L2 normalize）
│  ├─ chroma_store.py       # ChromaDB 持久化（cosine 空间）
│  └─ download_model.py     # 模型下载脚本（~155MB, hf-mirror.com）
├─ workflow/                # ComfyUI workflow 模板
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

### 人格引擎三层叠加

```
固定人格 (Base Prompt) → 动态情绪 (VAD Emotion Engine) → 动态记忆 (RRF RAG Recall)
```

情绪引擎细节：双层 VAD 模型 — `mood` (decay=0.98, 长期底色) + `instant` (decay=0.85, 即时反应)，综合情绪 = mood×0.4 + instant×0.6。刺激评估优先走规则表（高频场景），未命中才调 DeepSeek 兜底。每次对话后计算情绪变化并写入 `emotion_snapshots`（每 conversation 仅保留最新一条，UNIQUE 约束）。

### 好感度系统 (Affinity)

每次对话后情绪引擎计算 `affinity_delta`（-5~+5），更新 `user_relationships.affinity`（0~100，初始 50）。

- **回归衰减**: 连续 24h 未互动，自动衰减 -1（下限 0）。`last_interaction_at` 记录最近互动时间。
- **送礼系统**: 小礼物 (+5, 冷却 1h) / 大礼物 (+15, 冷却 12h)。全局冷却（跨角色共享），`gift_history` 表持久化。
- **前端实时推送**: 对话 SSE 流中通过 `affinity_update` 事件推送变化量，ChatView 触发 roll 数值动画。

### 记忆系统：三路召回 + RRF 融合

每轮对话后异步提取记忆碎片（fact/preference/emotion）→ 向量化 → ChromaDB + SQLite。检索时三路并行：
1. **Keyword** — SQLite LIKE 多关键词匹配
2. **Vector** — ChromaDB 余弦相似度
3. **Entity** — 关键词匹配到的实体 → 二次 JOIN 扩展

RRF 融合排序（关键词/实体通道 k=60，向量通道 k=120 权重减半，fact 类型 1.5× 加权）取 Top 10 注入 system prompt。向量通道不能独立主导：必须有关键词或实体命中才会纳入融合。

### 用户画像系统 (User Portrait)

角色视角下的用户特征提取，每个角色独立维护其"眼中"的用户画像。

- **异步提取** (`portraitExtractor.js`): 每 10 条用户消息触发一次，LLM 从对话中提取三大维度（appearance/personality/preference），写入 `user_portraits` 表（`UNIQUE(character_id, trait_type, content)` 防重复）。
- **向量相似度去重**: 新 trait 与已有 portrait 批量嵌入 → 余弦相似度 > 0.85 判定为语义重复，跳过写入。向量服务不可用时静默回退到 UNIQUE 约束。
- **手动管理**: 前端 TavernView 中可查看/添加/编辑/删除画像，支持一键清空某角色的全部画像。

### 角色关系图 (Character Relationships)

有向关系图，两个独立的概念：
- **角色间关系** (`character_relationships`): 有向边 from→to + relationship_text，UNIQUE(from, to)。前端在 TavernView 的关系编辑面板中可视化。
- **用户-角色关系** (`user_relationships`): 单例用户对每个角色的关系描述 + 好感度数值。UNIQUE(character_id)。

### 图像生成三种触发路径

1. **路径 A（强匹配）**: 用户消息命中 `detectImageIntent()` 正则（70+ 条规则），直接注入 image_prompt 规则到 system prompt，强制模型输出 `{"prompt":"..."} JSON 格式`
2. **路径 B（模型自主）**: 模型在回复中自行输出 `<needImage>` 标签，后端二次请求模型补上 `{"prompt":"..."} JSON 格式`，走异步生图
3. **路径 C（静默判断）**: 系统强制开启，对话后调用一次轻量 DeepSeek（"是/否"，~300ms），判断是否应该配图。失败时默认不生图

### 灵性生图模式 (forceImageGen)

`config.features.forceImageGen=true` 时启用。per-conversation 计数器（`imageJudgeCounters`，初始值 3）：
- 用户每发一条消息，对应 conversation 的计数器 -1
- 计数器归零时跳过 LLM 判断，直接走路径 A（强匹配），强制生图
- 生图成功后计数器重置为 3

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

**前端接收**: `notifications.js` store 通过独立 SSE 通道 (`/api/notifications/stream`) 实时监听，主动消息到达时角色列表冒泡排序 + 未读红点。如正在与对应角色聊天，消息直接追加到对话流。

### 朋友圈系统 (Moments)

AI 角色自动发朋友圈，用户可评论、点赞，角色 AI 自动回复评论。

- **定时调度** (`momentScheduler.js`): 每 10 分钟扫描 `next_moment_at <= now` 的角色，每次只处理一个（排队串行）。发帖后随机设定 2~8 小时后的下次发帖时间。
- **帖子生成** (`generateMomentPost`): 单次 LLM 调用同时输出文案和配图 prompt（JSON 格式）。45 种随机风格覆盖全生活场景。JSON 解析多层兜底：正则提取 → JSON.parse → 补全截断 → 全文本兜底。
- **SSE 实时推送**: 新帖生成后通过 `/api/moments/stream` 推送到前端，MomentsView 实时展示。
- **评论自动回复**: 用户评论后，LLM 基于角色人设 + 帖子内容 + 评论区上下文生成 15~50 字回复。回复失败不阻塞评论写入。
- **独立生图参数**: 朋友圈配图使用 `momentsArtist`/`momentsWidth`(1600)/`momentsHeight`(1200)，与聊天生图分开配置。生图失败不阻塞发帖。
- **未读时序方案**: `last_moments_seen_at` 时间戳，未读数 = `COUNT(*) WHERE created_at > last_seen`。

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

- **`system_settings` DB 表**：ComfyUI 参数、Feature Flags、用户信息。启动时 DB 优先覆盖代码默认值。
- **`.env` 文件**：LLM API Key/BaseURL/Model、ComfyUI URL。通过 `persistEnv()` 写回 `.env`。
- **内存**: `config` 对象保持实时值，update 函数同时更新内存 + 持久化。

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
- 双 SSE 通道：chat（对话流）+ notifications（主动消息推送），独立于主 SSE

### ComfyUI WebSocket 进度 + 轮询兜底

优先 WebSocket 监听实时进度（progress/executing/execution_error），60s 无活动则判定卡死。WS 失败或异常关闭时自动回退到轮询 history 接口（最多 600s）。`node:null` 消息到达后立即结算（不等 close），500ms 等待写盘后从 history 下载 base64 图片。

### Feature Flags

`config.features` 控制 8 个开关：

| Flag | 默认 | 说明 |
|------|------|------|
| `emotion` | 开 | VAD 情绪引擎 |
| `memory` | 开 | 记忆系统（RAG 三路召回 + 异步碎片提取） |
| `promptOptimize` | 关 | 生图时用 LLM 润色 prompt |
| `replyGuesses` | 关 | 回复猜想（AI 回复后生成用户可能的下一句回复） |
| `forceImageGen` | 关 | 灵性生图（每 3 轮强制一张） |
| `realtimeAffinityDisplay` | 关 | 好感度实时显示（对话 SSE 推送 affinity_update） |
| `proactiveChat` | 开 | 主动聊天（角色自主发起对话） |
| `proactiveChatFreq` | 0.5 | 主动聊天频率 0~1，影响线路 B 定时器间隔 |

### 全局规则系统

`global_rules` 表中存储系统指令片段，按 key 索引：

- **`system_rules`**: 拼入每个角色的 system prompt 头部（含 `<roleplay>` 标签控制角色扮演激活范围）
- **`world_setting`**: 世界观设定，独立注入不拼入批量规则
- **`image_prompt`**: 生图提示词规则，路径 A/主动聊天配图时按需读取
- **`judge_prompt`**: 生图判断规则，路径 C 静默判断时使用
- **`image_intent`**: 生图意图检测正则规则集

`judge_prompt` 和 `image_prompt` 等元规则可通过 `/api/config/rules/:key` 在线编辑。

### 通知总线 (Notification Bus)

独立于 Express Router 的轻量 SSE 广播通道，解决 `services ↔ routes` 循环依赖：
- `proactiveChatScheduler` 生成主动消息后调用 `broadcastProactiveMessage(data)`
- `notificationBus.js` 维护 SSE 客户端 Set，广播 `event: proactive_message`
- `notifications.js` 路由通过 `addSSEClient`/`removeSSEClient` 管理连接

### 前端渲染优化

- **消息虚拟窗口**: 全量消息一次性加载到内存，`renderStart` + `visibleMessages` 控制渲染窗口，初始 50 条，上滚展开 30 条
- **历史生图气泡**: `rawToMessages()` 解析 `messages.images` JSON 列，为历史上已有图片的消息自动插入 `image_gen` 类型气泡
- **主动消息即时追加**: SSE 监听到主动消息时，如为当前活跃角色则直接追加到消息列表
- **角色列表动态排序**: 主动消息到达时按 `last_message_at` 降序重排，活跃角色冒泡到顶部
