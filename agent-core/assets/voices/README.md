# 邻舍内置基础声音

`female.wav` 来自 IndexTeam 官方 IndexTTS 2.0 Demo 的 `examples/voice_11.wav`，是官方发布的中文女声参考片段，并非在本项目中额外合成的音频。官方没有唯一命名的「默认女声」，本项目选用这一段作为「基础女声」。`male.wav` 继续使用 Qwen3-TTS-12Hz-1.7B-VoiceDesign 合成的普通话青年男声。应用仅打包这两段 WAV，不在运行时联网生成基础样音。

女声来源：[IndexTTS 2.0 官方示例目录](https://huggingface.co/spaces/IndexTeam/IndexTTS-2-Demo/tree/b01840e8e4fd9753743a6d0466cd73ae1d634a68/examples)、[voice_11.wav 原文件](https://huggingface.co/spaces/IndexTeam/IndexTTS-2-Demo/blob/b01840e8e4fd9753743a6d0466cd73ae1d634a68/examples/voice_11.wav)。本机附带的文件与官方 LFS SHA-256 一致：`82730e38498413d4371a76e841cd91fa2f74843b79ad3b606d45ad8a7b7a736c`。保留随上游分发的许可说明 `INDEXTTS-LICENSE` 与 `INDEXTTS-LICENSE_ZH.txt`。官方未在示例清单中提供参考音频逐字稿，`cases.jsonl` 的 `text` 是目标合成文本，不能当作这段录音的逐字稿，因此本地女声 transcript 留空，不推断录音者身份或年龄。

女声采用试听对比中选定的 B，保留原始对白、原始 48 kHz 采样率与单声道。原文件为 float32，转换为 PCM16 并施加 1.1637606666860891 倍线性增益，与用户试听的 B 文件完全一致；不重采样、不变调、不均衡、不降噪、不变速，也不重新合成。时长约 7.86 秒。

男声来源：[Qwen3-TTS 演示](https://huggingface.co/spaces/Qwen/Qwen3-TTS)、[VoiceDesign 模型](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign)。男声于 2026-10-30 生成，Qwen 模型许可 Apache-2.0，副本见 `QWEN-TTS-LICENSE`。男声为 24 kHz、单声道、PCM16，时长约 6.70 秒，仅施加 0.94 倍线性增益预留峰值余量；台词为项目自写文本：

> 你好，今天过得怎么样？先坐下来休息一会儿，慢慢说，我会认真听。

清单 `catalog.json` 分别记录来源、声音标识、语言、时长、处理步骤及 SHA-256；女声额外记录原文件及处理后 PCM 的 SHA-256，便于核验来源和打包版本。界面名称保持「基础女声」「基础男声」。实时声音调节只提供给内置声音及由其保存的音色，录制／上传不提供此功能；内置声音只保留调节区的一套实时播放器。

打包时必须保留本目录；首次使用按内容哈希复制到用户音频目录，不改变原文件。不同角色可引用同一基础素材，调节参数分别保存，并烘焙为独立参考 WAV 供模型克隆。已经保存的旧基础声音仍引用原来的不可变音频，不随内置样音替换而改变。
