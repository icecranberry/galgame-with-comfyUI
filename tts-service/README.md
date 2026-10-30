# 邻舍本地语音服务

本地语音仅使用 **IndexTTS 2.0**，不提供模型切换。支持中文、英文，使用角色参考音频或内置男女基础声音，无需填写参考台词。全局「本地模型 / API 接入」仍然互斥，角色页只显示当前模式的音色参数。

音色管理可开启默认关闭的「情感增强」。应用使用当前配置的 LLM，结合当前台词及同一会话的上、下各一句，生成八维情绪向量并传给 IndexTTS；会增加 LLM 消耗与首次合成等待。无相邻台词时使用已有材料，试听和独立台词仅分析当前文本。只在创建新语音任务时分析，命中缓存不重复调用；开关及上下文区分缓存。分析请求限时 15 秒、不重试，失败回退自然朗读。该功能仅用于本地模式，不加载 QwenEmotion；更新适配器后需重启声音服务，以启用向量透传。

内置音色可保存音高（±4 半音）、共鸣（共振峰 ±15%）、语速（0.5～2 倍）、厚度、清晰度及空气感（后三项均 ±6 dB）。这些是参考声音设计参数：基础样音 → 本地 R3 DSP → 不可变参考 WAV → IndexTTS 克隆。`agent-core` 用 CPU Worker 和随应用打包的 `rubberband-wasm@3.3.0` 生成参考音频，复用浏览器试听的 R3 引擎实现；不加载模型或占用 GPU。均衡对应 180 Hz 低架、2800 Hz／Q 0.9 峰值、8000 Hz 高架，并预留余量、限制峰值。保留历史明亮度的参考均衡兼容。语速只改变参考音频，最终台词的节奏由模型生成，不保证按滑条倍数输出。

编辑页默认选择「录制／上传」，仅内置来源提供声音调节和一套实时样音播放器。浏览器通过 Web Audio AudioWorklet 与 Rubber Band WASM R3 Finer、标准分析窗口实时预听，拖动时不请求服务、不占 GPU。原声设置直通解码样本。保存时先生成独立的参考 WAV，记录 `base_sample_id` 保留原始基础音；重新打开时仍从原始基础音按已存参数预听，不对已加工音频叠加效果。「恢复原声」重新使用原始样本；原样本及旧引用文件不被覆盖。试听草稿不改写已保存音色。实际合成使用加工后的参考路径，调节参数不传给 TTS 适配服务，也不再对生成结果变调、均衡或变速。新旧内置音色都按新链路处理；缓存按原始样本、设计参数和参考处理版本隔离旧的合成后处理结果。新音色可直接保存，模型合成试听可选，高级采样参数仍正常影响模型合成。录制／上传不继承内置草稿，历史录音的旧合成参数保持兼容。需要 AudioWorklet 的 localhost／HTTPS 环境。试听与导出共用 R3 引擎及均衡含义，浏览器解码／重采样与有限片段导出仍有细微差异；模型对参考音色的复现也不是逐样本还原，大幅移调仍会损失音质。`voice_effects.py` 的合成后处理仅保留给历史录音配置，内置设计链路不调用它。

内置中文男女样音、来源与许可在 `agent-core/assets/voices/`，属于主程序资源，应随主程序分发；不依赖另下模型，也不在运行时联网。女声使用 IndexTTS 2.0 官方 Demo 的 voice_11.wav 中文参考片段（试听对比 B，保留 48 kHz 单声道，仅转 PCM16 并匹配试听音量），男声继续使用 Qwen 生成的普通话青年样音；界面名称保持「基础女声」「基础男声」。首次使用复制为不可变参考样本；角色的调节参数独立保存，上传和录音的原流程保留。基础音的来源说明见该目录 README。

角色已有录音、音色绑定、采样参数和 API 配置均保留。旧模型选择自动迁移到 2.0；缓存包含固定模型版本，不复用其他模型生成的结果。

## 目录

```text
tts-service/
├─ local-models.json              # 仅 IndexTTS 2.0
├─ versions-2.0.json              # 固定代码与权重版本
├─ setup.ps1 / start.ps1 / restart.ps1 / server.py
└─ runtime/
   ├─ python/                    # 基础 Python 3.11.13
   ├─ tools/                     # FFmpeg、ffprobe、安装工具
   ├─ runtime.json               # Python 的相对位置
   ├─ selected-model.json        # 2.0
   └─ indextts-2.0/
      ├─ source/
      │  ├─ indextts/
      │  ├─ .venv/               # 独立依赖环境
      │  └─ linshe-code-version.json
      └─ checkpoints/            # 2.0 权重、hf_cache 辅助模型、完整性清单
```

用户录音、参考片段与生成语音仍在 `agent-core/data/audio`，角色绑定和参数在应用数据库中，不进入离线包。旧布局的 `runtime/index-tts` 与 `runtime/checkpoints-2.0` 会迁移到新目录，不覆盖已有新安装。已确认的旧 2.5 权重归档到 `cache/retired-indextts-2.5`，不再读取或打包。

## 安装与启动（Windows）

```powershell
.\tts-service\setup.ps1
.\tts-service\start.ps1

# 仅检查，不联网
.\tts-service\setup.ps1 -CheckOnly
```

兼容 `-ModelVersion 2.0`，不接受其他安装版本。音色管理提供安装 / 修复、应用本地模型及安装状态；安装可以后台继续，显式应用后重启服务并校验版本。角色页面保留高级采样参数。

安装不修改系统 Python 或 ComfyUI 环境，依赖按固定源码的 uv.lock 安装。模型下载保留官网 / 镜像回退、有限次数重试与 Hub 断点续传，失败不要删除 `.incomplete`。`TTS_HF_ENDPOINTS` 可指定逗号分隔的 HTTPS 下载站点，`HF_ENDPOINT` 可指定优先下载源。

## 离线下载与打包

首次离线安装需要包含基础 Python、工具和 `indextts-2.0` 的完整包。将包解压到 `tts-service`，得到上述 `runtime/` 布局；不要再套一层包名目录。已有配套 Python 与工具时，也可以只放入完整的 `runtime/indextts-2.0` 模型目录。

完整模型目录必须包含源码、`.venv`、主权重、`hf_cache` 辅助模型及完整性清单；只下载模型网站的几个权重文件不等于完整运行包。完整包存在时，普通 setup 直接检查并返回，不联网。启动和推理强制离线；缺失文件明确报错，不自动下载。

```powershell
# 完整包：IndexTTS 2.0 ＋ 基础 Python / 工具
.\tts-service\package.ps1

# 增量包：仅 indextts-2.0 模型目录
.\tts-service\package.ps1 -ModelOnly
```

输出在 `tts-service/dist`，文件名为 `linshe-tts-indextts-2.0.zip`，增量包后缀为 `-model.zip`；可用 `-OutputPath` 指定输出。ZIP64 支持超过 4 GiB 的文件，每个包旁生成 SHA-256 文件。只打包 IndexTTS 2.0 和必要运行文件，排除其他模型目录、旧权重、用户音频、下载缓存、`.git`、`__pycache__` 与上游生成输出；增量包不改当前选择。

安装完成后会精简纯推理不需要的 PyTorch `torch/lib/*.lib` 编译链接库、`ffplay.exe` 和经 SHA-256 确认相同的重复语音编码权重；离线打包也排除这些文件。保留全部 DLL、必需模型、FFmpeg/ffprobe 和许可文件。当前适配器关闭 DeepSpeed 与自定义 CUDA 内核；精简环境不适合编译 PyTorch 扩展，若以后启用这些功能需重新安装完整依赖。已有完整安装可手动精简（不带 `--apply` 仅预览）：

```powershell
.\tts-service\runtime\indextts-2.0\source\.venv\Scripts\python.exe -X utf8 .\tts-service\compact_runtime.py --apply
```

迁移到另一台电脑后会修复虚拟环境的基础 Python 路径。已兼容 Python 3.11 路径文件、Kaldi FST 与 SentencePiece 的 Windows 中文路径问题，无需移动到英文目录或修改系统区域设置。离线包应与主程序版本匹配，不能手动修改清单版本号冒充兼容。

## 服务与显存调度

适配器默认监听 `127.0.0.1:7861`，只允许回环 Host，拒绝浏览器 Origin，`X-TTS-Token` 与 `TTS_SERVICE_TOKEN` 匹配。Node 通过 `TTS_SERVICE_URL` 连接。一键重启仅终止本项目准确匹配的适配器及其推理子进程，不终止其他端口占用者。

`GET /health` 返回固定版本、就绪状态和工作进程状态；`POST /synthesize` 接收受控相对 WAV 路径；`POST /unload` 等待推理进程退出，释放完整 CUDA 上下文。合成先写临时文件，再原子发布。缺少停止 token 会缩短分段重试，仍异常则丢弃，不发布不完整音频。

邻舍 GPU FIFO 与 `comfy_guard` 协调生图和语音：语音等待生图退出后获取 lease，语音期间阻止外部标准 prompt 提交。取消任务不会提前释放仍在推理的 GPU；确认卸载后才释放 lease。工作进程空闲时自动卸载。后端进程重启后的首次本地合成，会先检查服务空闲、确认旧工作进程已卸载，再恢复 ComfyUI 中遗留的 lease，避免空队列仍一直等待显存。忙碌或无法确认退出时保留锁并报错。独立官方 WebUI 不参与调度。

本地合成请求发现服务离线时，在 GPU FIFO 内自动启动本项目已安装的服务并等待健康检查，然后继续合成；多个请求不会重复启动。启动采用 `restart.ps1 -StartOnly`，不会杀死正在启动或无响应的现有进程。在线但缺模型或版本不匹配时明确报错，不自动下载、不重启。远程地址及非 Windows 主机需在服务所在主机启动。

`TTS_AUDIO_DIR` 可用于隔离验证；后端音频工具默认优先 `runtime/tools/ffmpeg/bin`，`FFMPEG_PATH` / `FFPROBE_PATH` 可覆盖。旧 `TTS_RUNTIME_DIR` / `TTS_MODEL_DIR` 不改变部署布局。

## API 与角色音色

API 使用 OpenAI 兼容语音协议：全局保存完整端点、Bearer Key、模型；角色保存 voice、speed、instructions 和附加 JSON。Key 只回显是否保存，留空保留旧值。API 与本地配置独立保存，切换不删除录音或参数。

保留上传参考音频创建音色 ID、直接传 `references: [{ audio, text }]` 两种克隆方式，实际能力由服务端决定。可以直接选择角色已有本地参考音频，复制为独立 API 素材，不改本地绑定或录音；没有台词时传空 text，需要服务端支持免台词克隆。试听草稿不覆盖已保存配置。

系统录音使用浏览器置顶小窗与共享音频，不调用麦克风，不录制或上传共享画面；不支持时提示上传。需要 localhost / HTTPS 和浏览器系统音频支持。录制最长 119 秒；上传限制 25 MB / 120 秒，参考片段为 1～15 秒。

## 验证

```powershell
.\tts-service\runtime\indextts-2.0\source\.venv\Scripts\python.exe -m unittest discover -s tts-service/test

# 可选实际离线 GPU 验证：ComfyUI guard 须可用，生产推理进程须已卸载
$env:RUN_TTS_BUNDLE_TEST = '1'
$env:RUN_TTS_BUNDLE_GPU_TEST = '1'
$env:TTS_BUNDLE_TEST_SINGLE_MODEL = '1'
.\tts-service\runtime\indextts-2.0\source\.venv\Scripts\python.exe -m unittest discover -s tts-service/test -p test_bundle_integration.py
```

上游固定版本：[IndexTTS 代码](https://github.com/index-tts/index-tts/tree/d9e41aac89fd00b3d71497fddb287b7f24613712)、[IndexTTS 2 权重](https://huggingface.co/IndexTeam/IndexTTS-2/tree/740dcaff396282ffb241903d150ac011cd4b1ede)。
