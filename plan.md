# Plan: 本地 AI 图像生成智能体

> **创建**: 2026-06-05 &nbsp;|&nbsp; **状态**: 已确认，待实施

---

## 技术决策

| 决策项 | 选型 | 
|--------|------|
| 后端框架 | Node.js + Express |
| LLM | DeepSeek API（兼容 OpenAI SDK） |
| 数据库 | SQLite + better-sqlite3（含 FTS5） |
| 向量数据库 | ChromaDB |
| Embedding | Jina v2 base zh (768d, ONNX Runtime) |
| 情绪引擎 | 自建 VAD 三维模型 |
| 生图后端 | ComfyUI（已跑通，RTX 5070 Ti） |
| 进程管理 | PM2 |
| 前端 | Vue |

---

## 一、系统架构

```
浏览器 (Vue SPA, localhost)
  │  HTTP + SSE
  ▼
Node.js + Express (主控 :3000)
  ├── 对话路由 & 会话管理
  ├── 人格引擎（固定人格 + 动态情绪 + 动态记忆）
  ├── 记忆管理器（SQLite 全量留存 + 滚动摘要 + RAG）
  ├── DeepSeek API 调用（对话 / 摘要 / 实体抽取）
  └── ComfyUI 客户端（生图调度）
  │
  ├── HTTP → Python FastAPI (向量服务 :8765)
  │           ├── ChromaDB（向量存储/检索）
  │           └── ONNX Embedding（Jina v2 base zh）
  │
  └── WebSocket/HTTP → ComfyUI (:8188)
                        └── SDXL / FLUX 模型推理

PM2 管理: Node.js + Python 向量服务 + ComfyUI（三个进程）
```

---

## 二、数据模型

```sql
-- 原始消息（底片，不物理删除）
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,           -- user | assistant | system
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content, content='messages', content_rowid='id'
);

-- 记忆碎片（对话中提取的事实/偏好/情绪）
CREATE TABLE memory_fragments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  source_msg_id INTEGER REFERENCES messages(id),
  fragment_type TEXT,           -- fact | preference | emotion
  content TEXT NOT NULL,
  entities TEXT,                -- JSON
  chroma_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 滚动摘要（每 50 条消息生成一次）
CREATE TABLE rolling_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  start_msg_id INTEGER,
  end_msg_id INTEGER,
  summary TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 情绪快照（每轮对话后存档）
CREATE TABLE emotion_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  after_msg_id INTEGER REFERENCES messages(id),
  valence REAL, arousal REAL, dominance REAL,
  dominant_emotion TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 生图任务
CREATE TABLE image_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  prompt_original TEXT NOT NULL,
  prompt_refined TEXT,
  style TEXT,
  resolution TEXT,
  workflow_json TEXT,
  comfyui_prompt_id TEXT,
  status TEXT DEFAULT 'pending',  -- pending | running | done | failed
  output_paths TEXT,              -- JSON 数组
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME
);
```

---

## 三、三层记忆方案

### 第一层：全量留存
- 所有消息写入 SQLite，标记软删除，永不物理删除
- 支持按时间/会话全文回溯

### 第二层：滚动摘要
- 每个会话累计 50 条新消息触发一次
- 调用 DeepSeek：新摘要 = LLM(上一段摘要 + 最近 50 条消息)
- 每次构建 system prompt 注入最近 2-3 段摘要

### 第三层：RAG 记忆碎片

**异步提取**（每轮对话后）：
1. DeepSeek 提取消息中的事实、偏好、情绪碎片 + 实体
2. 碎片文本 → ONNX Embedding → ChromaDB
3. 碎片元信息 + 实体 → SQLite memory_fragments

**三路召回**（每次对话时）：
```
用户输入
  ├─→ 关键词召回 (SQLite FTS5, BM25)     → Top 20
  ├─→ 向量语义召回 (ChromaDB, cosine)     → Top 20
  └─→ 实体聚合召回 (SQLite, 实体 JOIN)    → Top 20
               │
               └─→ RRF 融合排序 (k=60) → Top 10 → 注入 system prompt
```

---

## 四、人格引擎

三层叠加：

```
┌────────────────────────────────┐
│ 固定人格 (Base Prompt)          │  ← 角色原型，每次对话完整传入
├────────────────────────────────┤
│ 动态情绪 (Emotion Engine)       │  ← VAD 三维，每轮对话更新
│ valence / arousal / dominance  │
├────────────────────────────────┤
│ 动态记忆 (RAG Recall)           │  ← RRF 融合检索的记忆碎片
└────────────────────────────────┘
```

### 情绪引擎设计

```
情绪状态 = 长期心情底色 (mood, decay=0.98) + 实时 VAD (decay=0.85)
         ↓
长期心情: 几十轮才明显变化
实时 VAD: 每轮更新，指数衰减 + 新刺激叠加
         ↓
最终情绪 = mood × 0.4 + 实时 × 0.6
         ↓
注入 Prompt: "[情绪状态] 你{心情}，{精力}，{姿态}。请据此调整语气。"
```

**核心流程**：
1. 每轮对话后，用 DeepSeek 评估本轮对话对情绪的影响（输出 Δ 增量）
2. 指数衰减：`new = current × 0.88 + baseline × (1 - 0.88)`
3. 叠加刺激：`new += Δ`
4. 数值 → 自然语言 Prompt 片段

---

## 五、ComfyUI 集成

### 集成方式

选用 `@stable-canvas/comfyui-client`（Node.js 客户端，支持 WebSocket 进度监听）

### 流程

```
用户: "画一只猫"
  ↓
1. DeepSeek 优化提示词（简短描述 → 高质量生图 prompt）
  ↓
2. 匹配 Workflow 模板（文生图 / 图生图 / 风格迁移）
  ↓
3. 注入参数（prompt, seed, steps, cfg, 分辨率）
  ↓
4. POST /prompt → ComfyUI
  ↓
5. WebSocket 监听进度（executing → progress → executed）
  ↓
6. 读取 output 目录图片 → 返回路径
  ↓
7. SSE → Vue 前端渲染
```

### Workflow 模板

| 模板 | 用途 | 
|------|------|
| `txt2img_sdxl.json` | SDXL 文生图 |
| `txt2img_flux.json` | FLUX 文生图 |
| `img2img.json` | 图生图 |
| `inpaint.json` | 局部修复 |

---

## 六、Vue 前端

### 页面结构

```
┌──────────────────────────────────────────┐
│  侧边栏           │  聊天区 + 图片预览     │
│  ┌──────────┐    │  ┌──────────────────┐ │
│  │ 会话列表  │    │  │ 消息流（打字机）  │ │
│  │ 角色管理  │    │  │ 生图进度（实时）  │ │
│  │ 新建对话  │    │  │ 图片展示/下载    │ │
│  └──────────┘    │  └──────────────────┘ │
│                  │                       │
│  ┌──────────┐    │  ┌──────────────────┐ │
│  │ 记忆面板  │    │  │ 输入区 + 生图面板 │ │
│  │ 情绪仪表  │    │  │ 风格/分辨率选择  │ │
│  └──────────┘    │  └──────────────────┘ │
└──────────────────────────────────────────┘
```

### 技术要点
- SSE 流式接收对话（打字机效果）
- 生图进度实时推送（WebSocket 状态 → SSE 转推前端）
- 图片懒加载 + 大图预览
- 情绪仪表盘（实时显示 VAD 三维）

---

## 七、实施阶段

### Phase 1: 基础设施（3-4 天）
- Node.js 项目初始化，Express 骨架
- SQLite 建表 + FTS5 + 触发器
- Python 向量服务（FastAPI + ChromaDB + ONNX Embedding）
- DeepSeek API 封装

### Phase 2: 记忆系统（3-4 天）
- 全量消息存储
- 记忆碎片异步提取 + 向量化
- 滚动摘要生成器
- 三路召回 + RRF 融合

### Phase 3: 人格与对话（2-3 天）
- 固定人格 Prompt 模板
- 情绪引擎（VAD + DeepSeek 评估 + 指数衰减）
- 三层叠加组装器
- 流式对话 + SSE 推送

### Phase 4: 生图集成（2-3 天）
- ComfyUI 客户端封装
- 提示词优化模块
- Workflow 模板管理
- 生图任务队列

### Phase 5: Vue 前端（3-4 天）
- 项目脚手架 + 路由
- 聊天界面（流式对话 + 打字机效果）
- 生图面板（参数选择 + 进度 + 预览）
- 情绪仪表盘 + 记忆面板

### Phase 6: 整合（1-2 天）
- PM2 ecosystem 配置
- 端到端测试
- 使用文档

---

## 八、进程配置

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'agent-core',
      script: 'app.js',
      cwd: './agent-core',
      wait_ready: true,
      listen_timeout: 5000,
    },
    {
      name: 'vector-svc',
      script: 'uvicorn',
      args: 'server:app --port 8765',
      interpreter: 'python',
      cwd: './vector-service',
      wait_ready: true,
    },
    {
      name: 'comfyui',
      script: 'main.py',
      interpreter: 'python',
      cwd: '/path/to/ComfyUI',
    },
  ],
};
```
