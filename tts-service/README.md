# 邻舍本地 TTS

首版实现上传 → 裁剪 → 试听 → 角色绑定 → 私聊已保存气泡朗读。默认关闭，不改变聊天 LLM 协议。Node 与 Python 必须使用同一个音频目录。

## 部署：一个压缩包，解压即可使用

所有可分发的模型和依赖统一放在 **`tts-service/runtime/`**。服务脚本随邻舍主程序提供；你只需要分发一个 `linshe-tts-runtime.zip`，用户无需选择零散文件或安装 Python、Git、FFmpeg。

```text
邻舍/
└─ tts-service/
   ├─ runtime/       ← 解压后新增的唯一文件夹，包含全部模型和运行依赖
   ├─ cache/         # 自动下载缓存，不需要分发
   ├─ logs/          # 运行日志，不需要分发
   └─ …             # 邻舍自带的启动、下载与服务脚本
```

### 用户安装

1. 将配套版本的 `linshe-tts-runtime.zip` **解压到邻舍的 `tts-service` 文件夹**。
2. 确认出现 `tts-service/runtime/`（不要解压到 `runtime` 内，也不要额外套一个压缩包同名目录）。
3. 在邻舍点击「重启声音服务」，即可使用。

无需执行安装命令、下载依赖或配置路径。启动时自动修复换电脑后的 Python 路径并检查完整性。仍需保留已有的 ComfyUI 显存保护插件；它随主程序的 `comfy_guard/` 提供，不属于 Python 运行依赖。

### 制作分发压缩包

在已部署完成的机器上执行：

```powershell
.\tts-service\package.ps1
```

输出：`tts-service/dist/linshe-tts-runtime.zip`，旁边生成 SHA-256 校验文件。压缩包内部只有一个 `runtime/` 文件夹，自动包含隐藏目录 `.venv`、模型、辅助模型、源码、Python、FFmpeg、版本清单与许可证；自动排除 `.git`、Python 缓存和上游生成输出。使用 ZIP64，支持超过 4 GiB 的文件和压缩包。

若已有同名包，脚本会拒绝覆盖。可指定新名称：

```powershell
.\tts-service\package.ps1 -OutputPath 'D:\release\linshe-tts-runtime-v2.zip'
```

也可以直接把整个 `runtime` 文件夹压缩；不再需要挑选多个目录或单独拷贝清单。包必须与主程序版本匹配，不能手动改版本号冒充兼容。

### 自动下载与检查

```powershell
.\tts-service\setup.ps1             # 自动下载和安装
.\tts-service\setup.ps1 -CheckOnly  # 仅离线检查
.\tts-service\start.ps1             # 前台启动
.\tts-service\restart.ps1           # 后台启动或重启
```

自动安装同样写入 `tts-service/runtime/`，包括 Python、源码、依赖、模型、FFmpeg 及清单。下载失败时可重试，也可解压完整离线包补齐。完整包存在时，普通 `setup.ps1` 也只检查并返回，不访问网络。运行时禁止 Hugging Face / Transformers 联网，缺失文件直接提示补齐。

`runtime/` 内部由程序维护，分发者和用户无需操作：

```text
runtime/
├─ python/              # 完整 Python 3.11
├─ index-tts/           # 固定源码，含 .venv 与源码校验清单
├─ checkpoints/         # 主模型、分词器、hf_cache 辅助模型及模型清单
├─ tools/               # FFmpeg 与自动安装工具
└─ runtime.json         # 随包 Python 的相对位置
```

安装不修改 ComfyUI 的 Python 环境。`TTS_RUNTIME_DIR` / `TTS_MODEL_DIR` 不再改变部署位置；启动日志位于 `tts-service/logs/`。用户音频仍保存在 `agent-core/data/audio`，不进入分发包。音频操作默认优先使用 `runtime/tools/ffmpeg/bin`；显式 `FFMPEG_PATH` / `FFPROBE_PATH` 仍可覆盖。

首次接入时，将 `tts-service/comfy_guard` 整个目录复制到实际 ComfyUI 的 `custom_nodes/linshe_tts_guard` 并重启 ComfyUI；插件中的 `__init__.py` 必须直接位于该目录下。插件负责显存互斥，语音由独立 TTS 服务合成。

如果上游生成到 `max_mel_tokens` 上限仍没有结束标记，适配器会在解码异常尾音前中止，并使用更短的文本分段和确定性解码重试一次；再次异常则返回失败并删除临时结果，不截断后冒充完整语音。合成策略版本参与缓存键，升级后不会复用旧策略生成的音频；更新适配器后需要重启声音服务，更新缓存策略后需要重启 Node。此检查针对缺失结束标记，不能替代听感验收或识别所有错读。

默认采样使用试听选定的 P90 配置：`num_beams=3`、`temperature=0.8`、`top_p=0.9`、`top_k=30`，不固定生产请求的随机种子。配置集中在 `server.py` 的 `DEFAULT_GENERATION_OPTIONS`，健康检查返回 `generation_defaults`；修改时同步更新 Node 的 `SYNTHESIS_VERSION`，避免继续命中旧参数的音频缓存。

音色编辑中的「高级参数」允许每个已保存音色分别覆盖这四项，并恢复上述默认值。范围：temperature 0.1～1.5、top_p 0.1～1、top_k 整数 0～100（0 不限制）、num_beams 整数 1～5。Node 与 Python 两端均校验；`voices.generation_params` 保存 JSON，旧记录 `{}` 自动使用默认值。试听通过 `generation_params` 传入草稿，不修改音色；保存后聊天朗读使用该音色的参数。所有有效参数纳入音频缓存键；历史气泡的已有音频保留。

安装脚本会预下载语音特征、声纹和声码器等辅助模型，避免首次推理时下载占用工作进程的加载时限。启动脚本直接使用独立环境内的 Python，避免 `uv run` 根据上游 `.python-version` 重建环境。固定模型快照不等于已在每台显卡上验证可用，需完成下方真机验收。

启动脚本启用 UTF-8，HTTP 主进程与推理子进程也显式配置 UTF-8 日志。Windows 后台启动或重定向日志时，系统默认 GBK 无法打印 `♪`、emoji 等字符，会使上游在打印待合成文本时中断。遇到旧版本的 `gbk codec can't encode` 错误，更新并重启 TTS 服务后，在原聊天气泡点击「重试朗读」即可；无需重录音色或修改聊天内容。

### 可选环境变量

| 变量 | 默认值 / 用途 |
| --- | --- |
| `TTS_SERVICE_URL` | Node 调用地址，`http://127.0.0.1:7861` |
| `TTS_PORT` | Python 监听端口，`7861`，仅绑定本机回环 |
| `TTS_RUNTIME_DIR` | 已停用；统一使用项目内 `tts-service` |
| `TTS_SERVICE_TOKEN` | 两端一致的可选令牌；Python 不接受带 Origin 的浏览器跨域请求 |
| `TTS_AUDIO_DIR` | 默认仓库 `agent-core/data/audio`；自定义时两端配置相同绝对路径 |
| `TTS_MODEL_DIR` | 已停用；统一使用 `tts-service/runtime/checkpoints` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | 显式覆盖；否则优先使用 `tts-service/runtime/tools/ffmpeg/bin`，最后回退 PATH |

Node 的变量可放入 `agent-core/.env`。Python 从启动进程环境读取，不会读取 Node 的 `.env`。

## 数据与调度

离线布局回归：`python -m unittest discover -s tts-service/test`。真实运行包检查设置 `RUN_TTS_BUNDLE_TEST=1` 后运行 `python -m unittest discover -s tts-service/test -p test_bundle_integration.py`；同时设置 `RUN_TTS_BUNDLE_GPU_TEST=1` 才执行真实合成（要求本机 ComfyUI 保护插件在线且生产 TTS 工作进程已卸载）。设置 `TTS_BUNDLE_ARCHIVE` 为生成的 ZIP 绝对路径可追加真实解压验证；测试禁止外网连接、使用临时音频目录，结束时卸载模型并释放自己的显存锁。

2026-10-26：本机运行环境与模型已整理至 runtime 布局；离线 Python 导入、文本归一化、启动检查和中文 GPU 合成通过，runtime 布局下冷请求 94.359 秒（打包同时进行）。服务已切换为使用项目内 Python。旧的 `D:/AI/IndexTTS-2.5` 保留，不参与新启动流程。

- `voice_samples` 保存原文件、统一格式预览和不可变的裁剪片段；`voices` 保存版本、语言、语速与素材引用；`character_voices` 负责复用绑定。修改参考或默认参数会递增音色版本，旧任务保留自己的素材与参数快照。
- `speech_jobs` 保存清洗后的对白、参考哈希参与的缓存键、模型版本、状态和输出；`message_speech` 关联真正保存的气泡 ID。消息与角色删除按外键处理引用，删除音色必须先解除所有角色绑定。原素材暂保留，不做自动磁盘回收。
- 上传限 25MB / 120 秒，参考片段限 1～15 秒。FFmpeg 转单声道 24kHz PCM，仅裁掉首尾静音，保留内部停顿；轻度降噪可选。音量/削波检查是幅度启发式，不是语音识别或说话人检测。
- 缓存命中不占 GPU；新任务与全部应用内 ComfyUI 提交共享 FIFO，当前生图结束后才切换。不无限重试，等待外部 ComfyUI 队列最多 120 秒。
- ComfyUI 插件拒绝语音租约期间的新外部标准提交（423，需稍后重试），并在交出租约前实际卸载模型、清空 CUDA 缓存。
- 连续语音复用 Python 推理工作进程与租约；最后一次合成结束后空闲 10 分钟回收工作进程，期间再次合成会重新计时。应用内生图请求到来时立即走回收流程，确认工作进程退出并释放租约后才提交生图，不等待空闲计时结束。失败也回收工作进程。外部 ComfyUI 直接提交仍受租约保护，不能绕过应用内调度。单次冷加载上限 240 秒，推理上限 300 秒。
- 取消立即阻止任务结果变成可播放状态；若 GPU 推理已经开始，仍等它退出或超时回收后才释放租约。取消共享缓存任务会影响所有正在等它的请求。
- Node / Python 异常退出后，遗留任务标为失败。保护锁不靠 TTL 猜测显存已释放；先恢复 Python 服务，再点击「酒馆 → 音色管理 → 恢复显存调度」。该操作确认工作进程已退出后才重置锁。
- SSE `speech_update` 更新界面，同时按任务查询补偿丢失事件。只在当前手动点击仍有效时播放；换角色、离开聊天、切换试听会停止上一条音频，后台任务完成不会突然播音。

## 验证

```powershell
cd agent-core
node --test test/speech.test.js
cd ../web-ui
node --test test/speechPlayback.test.js test/speechTask.test.js test/systemAudioRecorder.test.js test/voiceManager.test.js
node build.mjs --outDir node_modules/.cache/tts-build
cd ..
python -m unittest discover -s tts-service/test
```

针对 Windows GBK 日志导致私聊合成失败的真机回归（需本机 TTS 与 ComfyUI 保护插件在线，使用内存数据库）：

```powershell
$env:RUN_TTS_UNICODE_TESTS = '1'
$env:TTS_TEST_REFERENCE = 'D:/AI/IndexTTS-2.5/index-tts/examples/voice_03.wav'
node --test agent-core/test/speechUnicode.integration.test.js
Remove-Item Env:RUN_TTS_UNICODE_TESTS
Remove-Item Env:TTS_TEST_REFERENCE
```

2026-10-13 已验证普通试听、含 `♪` 的私聊原句、含 emoji 的私聊、生成音频读取与缓存复用。GBK 重定向输出的 Python 回归在修复前复现编码异常，修复后通过；Python 7 项、Node TTS 8 项、Unicode 真机集成 1 项通过。真机测试在结束时释放显存并清理自身素材，不修改用户聊天或角色绑定。

2026-10-08 开发验证：

- Node TTS 测试验证清洗、缓存/音色参数失效、发言人校验、去重、失败重试、取消、离线隔离、模型复用、FIFO 与引用保留；音频导入/裁剪使用真实 FFmpeg、合成音频测试夹具。
- Python 测试以替身验证路径限制、工作进程回收、外部排队与异步提交竞争保护，不加载 GPU 模型。
- 前端播放器测试、构建、桌面 1280×900 与手机 390×844 的暖色/暗夜弹窗检查。原音/合成音的真实听感未验收。
- 前端全量 299 项通过。后端全量 706 项：690 通过、15 失败、1 跳过；15 个失败位于 `eventSchedule.test.js` 和 `townNpcMomentGenerator.test.js`，在修改前基线隔离副本中也全部复现。

### 真机验收仍需完成

2026-10-08 已在本机 `D:\AI\IndexTTS-2.5` 安装固定版本、全部推理权重及官方 WebUI（Python 3.11.13、PyTorch 2.8.0 + CUDA 12.8）。RTX 5070 Ti 16GB 上已完成 API 中文冷/热合成与卸载验证：冷请求 57.64 秒（含模型加载），热请求 3.91 秒；整卡显存采样峰值 9020 MiB，卸载后 3132 MiB，工作进程确认退出。测试使用官方示例 `voice_03.wav`，未代表用户角色的声音质量验收，也未代表 8GB 显卡验证。

随后已安装 ComfyUI 保护插件并在空闲时重启，正式 GPU 集成测试通过（`agent-core/test/speechGpu.integration.test.js`）：

- 三段官方参考音频分别绑定到内存数据库中的测试角色，验证真实合成、同消息缓存命中与跨角色请求拒绝；未改动用户角色或数据库。
- 冷请求 51.02 秒；换音色后的热请求 4.30 / 6.13 秒。1000 字请求耗时 127.88 秒，生成约 152.07 秒音频；1001 字拒绝。
- 15 秒空闲卸载后工作进程退出，ComfyUI 锁释放；持锁期间外部 `/prompt` 返回 423。
- 真实 Anima 任务执行时语音保持 queued，TTS 工作进程不启动；图像完成后语音成功。反向切换先确认 TTS 进程退出再生成图片，整个反向请求耗时 9.61 秒。
- 生图使用本机 Anima Base V1.0、512×512、4 步，仅用于加载/排队/切换验证，不代表正式分辨率的生图性能或画质。整轮整卡显存采样峰值 9641 MiB（包含桌面等其他进程）；最终 TTS 卸载后的 6827 MiB 包含 ComfyUI 已重新加载的图像模型，不是 TTS 残留。
- 测试创建的音色素材、参考音频与生成语音均已清理。结果文件在本机 `D:\AI\IndexTTS-2.5\acceptance\gpu-report.json`。

普通测试默认跳过真实 GPU 集成测试。复跑时先启动 API 服务并确认 ComfyUI 保护插件已加载，然后在仓库根目录运行（参考录音与工作流必须是本机已有文件；工作流使用 API 格式且包含 KSampler）：

```powershell
$env:RUN_TTS_GPU_TESTS = '1'
$env:TTS_TEST_REFERENCES = '["D:/AI/IndexTTS-2.5/index-tts/examples/voice_03.wav","D:/AI/IndexTTS-2.5/index-tts/examples/voice_04.wav","D:/AI/IndexTTS-2.5/index-tts/examples/voice_05.wav"]'
$env:TTS_TEST_IMAGE_WORKFLOW = 'D:\AI\IndexTTS-2.5\acceptance\anima-gpu-smoke.json'
$env:TTS_TEST_REPORT = 'D:\AI\IndexTTS-2.5\acceptance\gpu-report.json'
node --test agent-core/test/speechGpu.integration.test.js
Remove-Item Env:RUN_TTS_GPU_TESTS
```

### 2026-10-13 合并后验收

- 真实 GPU 集成测试通过：冷合成 89.121 秒，切换两个音色后的热合成 5.278 / 6.335 秒，1000 字合成 138.561 秒；验证缓存、跨角色消息隔离、空闲卸载、外部提交保护，以及 Anima 与 TTS 双向切换。整卡显存采样峰值 11667 MiB，包含其他进程；结束时 TTS 工作进程已退出。
- 浏览器使用内存数据库和临时角色跑通：MediaRecorder 录制 → 原音播放 → 上传 → FFmpeg 裁剪 → 真实 GPU 合成试听 → 保存绑定 → 聊天朗读 → 取消重试 → 缓存播放与停止。共享声源由官方示例音频替代，浏览器实际编码录音；未将此测试视为操作系统共享选择器、桌面置顶小窗或用户角色音色听感验收。桌面 1280×900、手机 390×844 的暖色 / 暗夜配置窗和录音窗均检查布局。
- 修复录音试听事件回调丢失播放器上下文；试听与聊天共用可取消任务，收到迟到的创建响应后仍能取消后台任务，关闭窗口后不会恢复旧试听。正在推理的任务仍按原调度规则等待退出后释放显存。
- 角色声音窗口复用语音开关与服务检查，关闭语音或语速无效时在提交前提示；增加取消试听和首次加载提示。切换角色加载失败时清空上一个角色的绑定；保存音色接口返回完整参考地址和版本，绑定失败后的重试仍能试听。
- TTS 前端 17 项、Node 8 项、Python 6 项和真实 GPU 集成 1 项测试通过；构建与本次修改文件的 ESLint 检查通过。前端全量 382 项：370 通过，12 失败；失败位于角色置顶、日记音效、版本查询与群聊已读测试，均在修改前 HEAD 的隔离副本复现，未在本次 TTS 验收中改动这些模块。

官方 WebUI 不参与邻舍调度，试用期间不要同时生图，切换前使用安装目录的 `Stop.cmd`。用户角色的声音质量、8GB 显卡与下列异常场景仍需独立验收：

1. 安装固定版本与 ComfyUI 保护插件，检查服务就绪；选择 2～3 个角色的参考录音，用不同于录音的台词试听。
2. 记录冷加载、热推理、1000 字上限、不同音色切换、峰值显存与生图切换延迟。
3. 验证真实生图正在执行时排队、语音期间外部标准提交被拒绝、结束后可以恢复生图。
4. 验证模型 OOM、服务断开、Node 重启、手动取消与浏览器自动播放限制，不影响文字消息保存。

酒馆的「立绘管理」之后新增「音色管理」，支持搜索角色、筛选未绑定角色、为角色创建或更换自己的声音。音色创建时固定归属当前角色，保存后自动使用；选择自己的历史音色立即切换，不再提供绑定或解绑步骤。删除当前音色后自动使用该角色最近保存的其他音色，删完才没有声音；不能跨角色使用音色。角色配置中的「已存音色」仅用于选择、试听和删除该角色自己的声音；创建音色时在「新声音」中选择录制或上传。「录制系统声音」直接打开桌面置顶小窗：点击开始后选择浏览器共享来源并勾选音频，停止后试听并使用录音，继续裁剪、合成试听与保存。IndexTTS 2.5 不需要参考音频台词，因此没有引入 ASR。共享的画面不录制、不上传，也不调用麦克风。最长录制 119 秒；关闭窗口或结束共享会停止采集。录制要求浏览器支持 Document Picture-in-Picture；不支持时提示上传音频，不再提供页面内录音窗。录音需要安全上下文（本机 localhost/127.0.0.1 或 HTTPS）及浏览器系统音频支持。

本次验证：前端 305 项测试、后端语音 8 项测试通过，前端构建通过；包含取消授权等待、关闭释放音轨、外部结束共享、大小/时长限制、无时长 WebM 导入回归。页面检查覆盖酒馆入口、角色搜索、声音配置、暖色/暗夜录音窗及窄屏布局。浏览器真实 MediaRecorder 使用合成声源验证开始、停止、回放控件与录音 Blob 交付，未冒充真实系统音频采集或桌面置顶窗口验收。

阶段二/三中的自动朗读、批量/麦克风导入、辅助选段、缓存清理、情绪映射、小镇/群聊/BGM 联动尚未启用。

上游依据：[固定代码](https://github.com/index-tts/index-tts/tree/d9e41aac89fd00b3d71497fddb287b7f24613712)、[固定模型](https://huggingface.co/IndexTeam/IndexTTS-2.5/tree/c39ce5ba981572cb187443877ff559dfb246ce63)。
