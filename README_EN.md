# 🎮 Neighbor · galgame-with-comfyUI

[中文](./README.md)

A **local AI companion app** inspired by visual novels. Chat with customizable characters, trigger **ComfyUI**-powered image generation (Anima) from conversation context, with emotion simulation, long-term memory retrieval, and a social-feed-style "Moments" system.

---

## ✨ Features

| Module | Description |
|--------|-------------|
| 🧠 **Personality Engine** | Fixed persona + VAD 3D emotion (Valence/Arousal/Dominance) + dynamic memory — three-layer overlay |
| 💬 **Streaming Chat** | SSE real-time typewriter effect, sentence-split bubbles, silent retry & idempotency |
| 🖼️ **Smart Image Gen** | Three trigger paths (intent match / model-driven / silent judge), with force-gen fallback mode |
| 🎭 **Emotion System** | Dual-layer VAD decay model — long-term mood + instant reaction, LLM-evaluated stimulus |
| 🗂️ **Memory Retrieval** | Three-way recall (keyword + vector semantic + entity expansion) + RRF fusion ranking |
| 📱 **Moments Feed** | AI characters auto-post with images, users can comment & like, AI auto-replies |
| 🖼️ **Gallery** | All generated images grouped by date, lazy loading + Lightbox preview |
| 🏠 **Tavern** | Character recruitment / browsing / editing, AI one-click character generation, user profile |

---

## 📸 Screenshots

| Chat | Moments |
|------|---------|
| [![Chat page](https://github.com/user-attachments/assets/2a08cbe1-f4c8-4814-a986-fc2d47fc8e85)](https://github.com/user-attachments/assets/2a08cbe1-f4c8-4814-a986-fc2d47fc8e85) | [![Moments page](https://github.com/user-attachments/assets/7de290fe-3eb3-4d10-a329-81993cf19c56)](https://github.com/user-attachments/assets/7de290fe-3eb3-4d10-a329-81993cf19c56) |

| Gallery | Tavern |
|---------|--------|
| [![Gallery page](https://github.com/user-attachments/assets/6b746150-7974-43fa-b2f5-677406f23bcd)](https://github.com/user-attachments/assets/6b746150-7974-43fa-b2f5-677406f23bcd) | [![Tavern page](https://github.com/user-attachments/assets/8f77d9ac-7c38-4ccd-b467-880eb56c10b9)](https://github.com/user-attachments/assets/8f77d9ac-7c38-4ccd-b467-880eb56c10b9) |

| Mobile View |
|-------------|
| [![Mobile view](https://github.com/user-attachments/assets/c8d86580-94a5-4822-96bf-4dc9e459f201)](https://github.com/user-attachments/assets/c8d86580-94a5-4822-96bf-4dc9e459f201) |

---

## 🚀 Installation & Usage

### 1. Download

Download the latest release package from [Releases](https://github.com/icecranberry/galgame-with-comfyUI/releases) and extract it anywhere.

### 2. Prerequisites

The launcher **auto-detects and installs** Node.js, Python, Git, and other dependencies. You only need:

| Required | Notes |
|----------|-------|
| **ComfyUI** | Installed and running on `:8188`, Anima models ready |
| **DeepSeek API Key** | Configure in launcher settings, or manually edit `agent-core/.env` |

### 3. Launch

Double-click **`邻舍.EXE.exe`** to open the launcher, then:

1. **Settings** → set ComfyUI launcher path (optional, for one-click ComfyUI launch)
2. **Home** → click **「▶ 启动邻舍」** (Launch)

On first run, the launcher auto-completes environment checks, dependency installation, frontend build, and model download. Once ready, the browser opens automatically.

> 💡 The launcher supports version switching via git tags — upgrade/downgrade from the **Version** tab.

---

## 🏗️ Architecture

```
Browser (Vue 3 SPA, :5173)
  │  HTTP + SSE
  ▼
Node.js + Express (Core :3099)
  ├── Chat routing & session management
  ├── Personality engine
  ├── Memory manager (SQLite + rolling summaries + RAG)
  ├── DeepSeek API client
  └── ComfyUI client (image gen scheduler)
  │
  ├── HTTP → Python FastAPI (Vector Service :8765)
  │           ├── ChromaDB
  │           └── ONNX Embedding (Jina v2 base zh, 768d)
  │
  └── WebSocket/HTTP → ComfyUI (:8188)
                        └── Anima inference
```

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vue 3 + Pinia + Vue Router + Vite |
| Backend | Node.js + Express (ESM) |
| Vector Service | Python FastAPI + ChromaDB + ONNX Runtime |
| LLM | DeepSeek API (OpenAI-compatible) |
| Image Engine | ComfyUI (WebSocket + HTTP) |
| Database | SQLite (better-sqlite3) + FTS5 |
| Embedding | Jina v2 base zh (768d, mean pooling + L2 norm) |
| Launcher | PySide6 (Qt) + PyInstaller |

---

## 🛠️ Developer Guide

For source code development and contributions:

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.10 (with venv)
- **Git**
- **ComfyUI** installed and running on `:8188`
- **DeepSeek API Key**

### Quick Start

```bash
# 1. Clone
git clone https://github.com/icecranberry/galgame-with-comfyUI.git
cd galgame-with-comfyUI

# 2. Install dependencies
cd agent-core && npm install && cd ..
cd web-ui && npm install && cd ..

# 3. Configure environment
cp agent-core/.env.example agent-core/.env
# Edit agent-core/.env with your DeepSeek API Key and ComfyUI address

# 4. Initialize embedding model
cd vector-service
python -m venv venv
# Windows:
venv/Scripts/pip install -r requirements.txt
# macOS/Linux:
# source venv/bin/pip install -r requirements.txt
python download_model.py
cd ..

# 5. Start development services
npm run dev

# Stop services
npm run stop
```

Open `http://localhost:5173`

### Build Launcher

```bash
cd launcher
build.bat          # Produces 邻舍.EXE.exe
```

---

## ⚙️ Configuration

All settings support runtime hot-reload with persistence across restarts:

| Setting | Description |
|---------|-------------|
| LLM API | Key / BaseURL / Model |
| ComfyUI | URL / Artist style / Resolution |
| Feature Flags | 7 toggles: emotion, memory, auto-judge, prompt optimize, etc. |
| Global Rules | system_prompt / image_prompt / judge_prompt (online editing) |

---

## 📁 Project Structure

```
├── agent-core/          # Core backend (Express, :3099)
│   ├── src/
│   │   ├── routes/      # chat / images / characters / memory / moments / config
│   │   ├── services/    # emotion engine / memory retrieval / image gen / moments / ComfyUI client
│   │   ├── llm/         # DeepSeek client
│   │   └── db/          # SQLite schema & migrations
│   └── app.js
├── web-ui/              # Vue 3 frontend (Vite, :5173)
│   └── src/
│       ├── views/       # Chat / Tavern / Moments / Gallery / Settings
│       ├── components/  # NavBar / Sidebar / ImageGenBubble / MomentCard / Gallery
│       └── stores/      # Pinia stores
├── vector-service/      # Python vector service (FastAPI, :8765)
│   ├── server.py
│   ├── embedding.py     # ONNX inference
│   └── chroma_store.py  # ChromaDB wrapper
├── launcher/            # 邻舍.EXE launcher (PySide6 + PyInstaller)
│   ├── launcher/        # Launcher source
│   ├── main.py          # Entry point
│   └── build.bat        # Build script
├── workflow/            # ComfyUI workflow templates & prompt rules
├── scripts/             # dev / stop scripts
└── ecosystem.config.cjs # PM2 production config
```

---

## 📄 License

MIT
