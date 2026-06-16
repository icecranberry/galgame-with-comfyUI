# 🎮 galgame-with-comfyUI

[English](./README_EN.md)

受 Galgame 启发的**本地 AI 陪伴应用**。与可自定义人格的角色对话，AI 根据上下文自动触发 **ComfyUI** 生图（Anima），具备三维情绪模拟、长期记忆检索、朋友圈动态系统。

---

## ✨ 核心特性

| 模块 | 说明 |
|------|------|
| 🧠 **人格引擎** | 固定人格 + VAD 三维情绪（效价/唤醒/支配）+ 动态记忆，三层叠加驱动角色行为 |
| 💬 **流式对话** | SSE 实时打字机效果，分句气泡展示，静默重试与幂等去重 |
| 🖼️ **智能生图** | 三种触发路径（意图匹配 / 模型自主 / 静默判断），灵性生图模式保底 |
| 🎭 **情绪系统** | 双层 VAD 衰减模型，长期 mood + 即时反应，LLM 评估刺激增量 |
| 🗂️ **记忆检索** | 三路召回（关键词 + 向量语义 + 实体扩展）+ RRF 融合排序 |
| 📱 **朋友圈** | AI 角色自动发帖配图，用户可评论点赞，AI 自动回复评论 |
| 🖼️ **相册** | 所有生成图片按日期分组浏览，懒加载 + Lightbox 预览 |
| 🏠 **酒馆** | 角色招募 / 浏览 / 编辑，AI 一键生成角色，用户信息管理 |

---

## 🏗️ 系统架构

```
浏览器 (Vue 3 SPA, :5173)
  │  HTTP + SSE
  ▼
Node.js + Express (主控 :3099)
  ├── 对话路由 & 会话管理
  ├── 人格引擎（固定人格 + 动态情绪 + 动态记忆）
  ├── 记忆管理器（SQLite 全量留存 + 滚动摘要 + RAG）
  ├── DeepSeek API 调用
  └── ComfyUI 客户端（生图调度）
  │
  ├── HTTP → Python FastAPI (向量服务 :8765)
  │           ├── ChromaDB（向量存储/检索）
  │           └── ONNX Embedding（Jina v2 base zh, 768d）
  │
  └── WebSocket/HTTP → ComfyUI (:8188)
                        └── Anima 推理
```

---

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | Vue 3 + Pinia + Vue Router + Vite |
| 主控后端 | Node.js + Express (ESM) |
| 向量服务 | Python FastAPI + ChromaDB + ONNX Runtime |
| LLM | DeepSeek API（兼容 OpenAI SDK） |
| 生图引擎 | ComfyUI (WebSocket + HTTP) |
| 数据库 | SQLite (better-sqlite3) + FTS5 |
| 嵌入模型 | Jina v2 base zh (768d, 均值池化 + L2 归一) |

---

## 📋 前置条件

- **Node.js** ≥ 18
- **Python** ≥ 3.10（含 venv）
- **ComfyUI** 已安装并运行在 `:8188`（Anima 模型已就绪）
- **DeepSeek API Key**

---

## 🚀 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/icecranberry/galgame-with-comfyUI.git
cd galgame-with-comfyUI

# 2. 安装依赖
cd agent-core && npm install && cd ..
cd web-ui && npm install && cd ..

# 3. 配置环境变量
cp agent-core/.env.example agent-core/.env
# 编辑 agent-core/.env，填入 DeepSeek API Key 和 ComfyUI 地址

# 4. 初始化向量模型
cd vector-service
python -m venv venv
venv/Scripts/pip install -r requirements.txt  # Windows
# source venv/bin/pip install -r requirements.txt  # macOS/Linux
python download_model.py
cd ..

# 5. 一键启动开发服务
npm run dev

# 停止服务
npm run stop
```

启动后访问 `http://localhost:5173`

---

## ⚙️ 配置

所有配置支持运行时热更新，重启后持久化：

| 配置项 | 说明 |
|--------|------|
| LLM API | Key / BaseURL / Model |
| ComfyUI | URL / 画师风格 / 分辨率 |
| Feature Flags | 情绪 / 记忆 / 生图判断 / 提示词优化 等 7 项 |
| 全局规则 | system_prompt / image_prompt / judge_prompt 在线编辑 |

---

## 📁 项目结构

```
├── agent-core/          # 主控后端 (Express, :3099)
│   ├── src/
│   │   ├── routes/      # chat / images / characters / memory / moments / config
│   │   ├── services/    # 情绪引擎 / 记忆检索 / 生图调度 / 朋友圈 / ComfyUI客户端
│   │   ├── llm/         # DeepSeek 客户端
│   │   └── db/          # SQLite 表定义 & 迁移
│   └── app.js
├── web-ui/              # Vue 3 前端 (Vite, :5173)
│   └── src/
│       ├── views/       # Chat / Tavern / Moments / Gallery / Settings
│       ├── components/  # NavBar / Sidebar / ImageGenBubble / MomentCard / Gallery
│       └── stores/      # Pinia stores
├── vector-service/      # Python 向量服务 (FastAPI, :8765)
│   ├── server.py
│   ├── embedding.py     # ONNX 推理
│   └── chroma_store.py  # ChromaDB 封装
├── workflow/            # ComfyUI workflow 模板 & 提示词规则
├── scripts/             # dev / stop 脚本
└── ecosystem.config.cjs # PM2 生产配置
```

---

## 📄 License

MIT
