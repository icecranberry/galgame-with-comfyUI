# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---



---

## 项目概述

本地 AI 图像生成智能体。用户与可自定义人格的 AI 角色对话，AI 根据对话上下文判断是否需要生成图像，通过 ComfyUI (SDXL/FLUX) 出图后推送到前端。

## 技术栈

| 组件 | 技术 | 端口 |
|------|------|------|
| 前端 | Vue 3 + Pinia + Vue Router + Vite + vue-easy-lightbox | 5173 |
| 主控后端 | Node.js + Express (ESM) | 3099 |
| 向量服务 | Python FastAPI + ChromaDB + ONNX Runtime | 8765 |
| LLM | DeepSeek API (兼容 OpenAI SDK，透传) | - |
| 生图引擎 | ComfyUI (WebSocket + HTTP) | 8188 |
| 数据库 | SQLite (better-sqlite3) + FTS5 | - |
| 嵌入模型 | Jina v2 base zh (768d, ONNX, 均值池化 + L2 归一) | - |

## 常用命令

```bash
# 一键启动全部开发服务（清理端口 → 检查环境 → 启动三项服务 → 自动打开浏览器）
npm run dev          # 项目根目录

# 分别启动
cd agent-core && npm run dev          # Express + node --watch
cd web-ui && npm run dev              # Vite HMR
cd vector-service && ./venv/Scripts/python.exe -m uvicorn server:app --host 0.0.0.0 --port 8765

# 停止所有开发服务
npm run stop

# 生产部署（PM2）
pm2 start ecosystem.config.cjs

# 测试 ComfyUI 连接
curl http://localhost:3099/api/images/comfyui-health

# 初始化向量模型
cd vector-service && python download_model.py
```

## 项目结构

```
project-root/
├─ agent-core/              # 主控后端 (Express, :3099)
│  ├─ app.js                # 入口：中间件、路由挂载、优雅退出
│  ├─ data/                 # 运行时数据（DB、图片、头像，gitignore）
│  ├─ public/               # web-ui build 产物（gitignore）
│  └─ src/
│     ├─ config.js          # 配置中心（dotenv + 运行时持久化 .env）
│     ├─ db/index.js        # SQLite 表、FTS5、触发器、索引、种子规则
│     ├─ llm/deepseek.js    # OpenAI 兼容客户端（同步 + 流式）
│     ├─ middleware/
│     │  └─ errorHandler.js
│     ├─ routes/
│     │  ├─ chat.js         # 核心对话路由（SSE 流式 + 生图触发 + 后处理）
│     │  ├─ images.js       # 生图 API（tasks 增删查、直接生成、测试画风、健康检查）
│     │  ├─ characters.js   # 角色 CRUD + AI 生成角色 + 头像上传
│     │  ├─ memory.js       # 记忆检索、碎片查询、情绪历史
│     │  ├─ moments.js      # 朋友圈 API（帖子生成、评论、点赞、自动回复）
│     │  └─ config.js       # 配置读写（ComfyUI 参数、feature flags、全局规则、用户头像）
│     └─ services/
│        ├─ emotionEngine.js    # VAD 三维情绪引擎（双层衰减 + 规则表/LLM 刺激评估）
│        ├─ memoryExtractor.js  # 异步记忆碎片提取（DeepSeek → 向量化 → ChromaDB + SQLite）
│        ├─ memorySearch.js     # 三路召回 + RRF 融合（keyword + vector + entity）
│        ├─ summarizer.js       # 滚动摘要（每 50 条消息触发一次）
│        ├─ vectorClient.js     # Python 向量服务 HTTP 客户端
│        ├─ imageSkill.js       # 生图调度（提示词优化 → 注入 workflow → 提交 ComfyUI → 兜底文件夹）
│        ├─ comfyClient.js      # ComfyUI 客户端（GUI→API 转换 + WebSocket 进度 + 轮询兜底）
│        ├─ momentScheduler.js   # 朋友圈定时调度器（每 10 分钟扫描，排队发帖）
│        └─ seeds.js            # 默认角色种子数据
├─ web-ui/                  # Vue 3 前端 (Vite HMR, :5173)
│  ├─ vite.config.js        # Vite 配置（含 SSE 代理 timeout:0 防断开）
│  └─ src/
│     ├─ main.js            # 入口：Vue + Pinia + Router (hash mode, 6 路由)
│     ├─ userConfig.js      # 用户自有配置模块（头像/昵称/自画像，独立于角色）
│     ├─ stores/
│     │  ├─ chat.js         # 全局核心 store（角色、消息、SSE 流式消费、重试逻辑）
│     │  ├─ settings.js     # 设置 store
│     │  └─ moments.js      # 朋友圈 store（帖子分页、评论、点赞）
│     ├─ api/index.js       # 后端 API 封装（含 SSE ReadableStream 解析 + 朋友圈 API）
│     ├─ views/
│     │  ├─ ChatView.vue    # 主聊天视图
│     │  ├─ TavernView.vue  # 酒馆：角色浏览/招募/编辑 + 用户信息管理
│     │  ├─ MomentsView.vue # 朋友圈时间线
│     │  ├─ GalleryView.vue # 相册：按日期分组的图片浏览
│     │  └─ SettingsView.vue
│     └─ components/
│        ├─ NavBar.vue      # 底部 Tab 导航（酒馆/聊天/朋友圈/相册/设置）
│        ├─ Sidebar.vue     # 桌面端侧边栏
│        ├─ ImageGenBubble.vue
│        ├─ MomentCard.vue  # 朋友圈帖子卡片
│        ├─ Gallery.vue     # 相册网格（天级分组 + 懒加载 + Lightbox）
│        ├─ AvatarCropper.vue
│        └─ ConfirmDialog.vue
├─ vector-service/          # 向量服务 (Python FastAPI, :8765)
│  ├─ server.py             # FastAPI 入口（/embed /search /upsert /delete /health）
│  ├─ embedding.py          # ONNX 推理（Jina v2, mean pooling + L2 normalize）
│  ├─ chroma_store.py       # ChromaDB 持久化封装（cosine 空间）
│  ├─ config.py
│  └─ download_model.py     # 模型下载脚本
├─ workflow/                # ComfyUI workflow 模板 + 提示词规则
│  ├─ skill外置AI智能体使用的单图工作流.json
│  └─ 提示词生成助手.txt
├─ scripts/
│  ├─ dev.mjs               # 一键 dev 启动脚本（端口清理 → 环境检查 → 启动三进程）
│  └─ stop.mjs              # 一键停止所有 dev 服务
├─ ecosystem.config.cjs     # PM2 生产配置
└─ CLAUDE.md
```

## 核心架构决策

### 消息双表设计

- **`raw_messages`**: 完整 LLM 对话原文（包括{"prompt":"..."} JSON 格式），给 LLM 构建上下文用。每轮 user + assistant 各一条。
- **`messages`**: 分句展示气泡，按句子拆分存储，每个气泡一条。带 `images` 列关联生图结果。前端通过 `seq` 排序。
- 这样把"LLM 需要的完整上下文"和"前端需要的分句展示"解耦。

### 人格引擎三层叠加

```
固定人格 (Base Prompt) → 动态情绪 (VAD Emotion Engine) → 动态记忆 (RRF RAG Recall)
```

情绪引擎细节：双层 VAD 模型 — `mood` (decay=0.98, 长期底色) + `instant` (decay=0.85, 即时反应)，综合情绪 = mood×0.4 + instant×0.6。刺激评估优先走规则表（高频场景，快且免费），未命中才调 DeepSeek 兜底。

### 记忆系统：三路召回 + RRF 融合

每轮对话后异步提取记忆碎片（fact/preference/emotion）→ 向量化 → ChromaDB + SQLite。检索时三路并行：
1. **Keyword** — SQLite LIKE 多关键词匹配
2. **Vector** — ChromaDB 余弦相似度
3. **Entity** — 关键词匹配到的实体 → 二次 JOIN 扩展

RRF (k=60) 融合排序后取 Top 10 注入 system prompt。

### 图像生成三种触发路径

1. **路径 A（强匹配）**: 用户消息命中 `detectImageIntent()` 正则（70+ 条规则），直接注入 image_prompt 规则到 system prompt，强制模型输出 `{"prompt":"..."} JSON 格式` 
2. **路径 B（模型自主）**: 模型在回复中自行输出 `<needImage>` 标签，后端二次请求模型补上 `{"prompt":"..."} JSON 格式`，走异步生图
3. **路径 C（静默判断）**: `autoImageJudge=true` 时，对话后调用一次轻量 DeepSeek（"是/否"，~300ms），判断是否应该配图。失败时默认不生图

### 灵性生图模式 (forceImageGen)

`config.features.forceImageGen=true` 时启用。per-conversation 计数器（`imageJudgeCounters`，初始值 3）：
- 用户每发一条消息，对应 conversation 的计数器 -1
- 计数器归零时跳过 LLM 判断，直接走路径 A（强匹配），强制生图
- 生图成功后计数器重置为 3
- 本质上是一个"每 3 轮对话至少配一张图"的保底机制

### 朋友圈系统 (Moments)

AI 角色自动发朋友圈，用户可评论、点赞，角色 AI 自动回复评论。

- **定时调度** (`momentScheduler.js`): 每 10 分钟扫描 `next_moment_at <= now` 的角色，每次只处理一个（排队串行，避免并发生图撑爆 ComfyUI）。发帖后随机设定 2~8 小时后的下次发帖时间。
- **帖子生成** (`generateMomentPost` in moments.js): 单次 LLM 调用同时输出文案和配图 prompt（JSON 格式），确保图文语义一致。45 种随机风格，覆盖自拍/美食/风景/日常/恋爱/游戏/城市/心情等生活全场景。
- **评论自动回复** (`generateCharacterReply`): 用户评论后，LLM 基于角色人设 + 帖子内容 + 评论区上下文自动生成 15~50 字的角色回复。回复失败不阻塞评论写入。
- **独立生图参数**: 朋友圈配图使用 `momentsArtist`、`momentsWidth` (1600)、`momentsHeight` (1200)，与聊天生图分开配置。生图失败不阻塞发帖（无图但有文案）。
- **DB 表**: `moment_posts`、`moment_comments`、`moment_likes`（UNIQUE 约束实现 toggle）
- **前端**: `MomentsView.vue` + `MomentCard.vue` 实现时间线 UI，前端分页加载（每批 20 条，全量数据一次请求，slice 分批渲染）。`vue-easy-lightbox` 支持图片放大查看。`NavBar.vue` 底部 Tab 导航。

### 相册系统 (Gallery)

生成图片的统一浏览入口，按日期分组展示所有已生成图片。

- **数据来源**: 后端 `/api/images/list` 接口，返回 `data/images/` 目录下所有图片（含聊天生图和朋友圈配图）
- **前端** (`Gallery.vue` + `GalleryView.vue`): 按天分组（今天/昨天/具体日期），grid 布局展示缩略图，`vue-easy-lightbox` 支持全屏预览/缩放/左右切换
- **加载策略**: 初始加载 50 张，滚动到底部懒加载更多（分批渲染，每批 30 张），`loaded` 事件向上通知总数

### 酒馆系统 (Tavern)

角色招募、浏览、管理的统一入口页面。

- **角色网格** (`TavernView.vue`): 响应式卡片网格展示所有角色（含消息数/状态），首格为「招募」入口卡片
- **AI 生成角色**: 用户输入描述（如"芙宁娜/傲娇猫娘/我的野蛮女友"），后端调用 DeepSeek 将描述展开为完整角色（display_name + base_prompt + emotion_baseline），前端预览确认后入库
- **角色详情编辑**: 弹窗内直接编辑角色名、人格提示词、VAD 情绪基线（滑块），支持上传/移除头像
- **用户信息管理**: 页面内嵌用户昵称/自画像编辑（与角色分开存储，走 `/api/config/user` 接口），用户头像上传（`AvatarCropper`）
- 路由: `/tavern`，NavBar 底部第二 Tab

### 流式分句器 (SentenceSplitter)

核心：3 字滑动窗口检测 `<pr` 前缀阻断 prompt 标签暴露给用户。配合 20 字闸门 + 中英文标点分句规则（`。！？～~，`），在 SSE 流式输出时实时断句为气泡段。

### Config 运行时持久化

配置通过双通道持久化，保证重启后不丢失：
- **`system_settings` DB 表**：ComfyUI 参数（画师、分辨率）和所有 Feature Flags 写入 `system_settings` 表，启动时 DB 优先覆盖 `.env` 默认值
- **`.env` 文件**：LLM API Key/BaseURL/Model、ComfyUI URL、用户昵称/人设通过 `persistEnv()` 写回 `.env`
- `config.js` 中的 `updateComfyConfig()`、`updateFeatureFlag()`、`updateLlmConfig()`、`updateUserConfig()` 同时更新内存 + 持久化

### 优雅退出机制

避免 SQLite WAL 损坏和数据丢失：

1. **`npm run stop`**（或 Ctrl+C 在 dev 脚本中）→ 向 `http://localhost:3099/api/shutdown` 发 POST 请求
2. **agent-core** 收到 shutdown 请求后：先 `server.close()` 关闭 HTTP（拒绝新连接），再 `closeDb()` 安全关闭 SQLite
3. 5 秒硬超时兜底：`setTimeout(() => process.exit(1), 5000).unref()`
4. **dev.mjs** 在 taskkill 前会先调 shutdown API + 等 5 秒，防止 Windows 强杀导致 WAL 损坏
5. shutdown 端点通过 flag 防重入（`shuttingDown`），避免 SIGINT + API 双重触发

### 前端流式消费与健壮性

- SSE → `ReadableStream` 解析 → Pinia store 消费（含 3 次重试 + 30s 安全超时）
- `client_msg_id` 幂等键防重入（后端 `raw_messages` 上加 partial unique index）
- 流中断静默重试：无完整气泡且无 msg_saved → 清理临时气泡 → 递减退避重试（最多 2 次额外尝试）

### ComfyUI WebSocket 进度 + 轮询兜底

优先 WebSocket 监听实时进度（progress/executing/execution_error），60s 无活动则判定卡死。WS 失败或异常关闭时自动回退到轮询 history 接口（最多 600s）。`node:null` 消息到达后立即结算（不等 close），500ms 等待 ComfyUI 写盘后从 history 下载 base64 图片。

### Feature Flags

`config.features` 控制七个开关，均由环境变量驱动：
- `emotion` (默认开) — 情绪引擎
- `memory` (默认开) — 记忆系统（RAG 三路召回避注入 + 异步碎片提取）
- `autoImageJudge` (默认开) — 静默生图判断
- `promptOptimize` (默认关) — 生图时用 LLM 润色 prompt
- `replyGuesses` (默认关) — 回复猜想（AI 回复后生成用户可能的下一句回复）
- `forceImageGen` (默认关) — 灵性生图模式（每 3 轮对话强制生成一张图）

### 全局规则系统

`global_rules` 表中存储系统指令片段。两类规则：
- **系统级规则** (如 `system_rules`): 拼入每个角色的 system prompt 头部，提供格式约束和角色扮演框架
- **元规则** (如 `judge_prompt`, `image_prompt`): 不拼入 system prompt，由特定流程按需读取

`judge_prompt` 和 `image_prompt` 可通过 `/api/config/rules/:key` 在线编辑。