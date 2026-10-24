# 邻舍 AstrBot 插件

1. 启动邻舍，在「设置 → AstrBot 集成」选择初始角色、开放的工具并保存启用。
2. 邻舍启动器的 AstrBot 页可一键安装、启动和停止，安装时已预置本插件。连接已有 AstrBot 时，在插件管理中上传本 ZIP（或复制本目录到 AstrBot/data/plugins/astrbot_plugin_linshe）。
3. 在插件配置填写邻舍根地址与桥接 Token，保存并重载插件。
4. AstrBot 使用支持工具调用的模型与内置 Agent 执行器；若人格限制了工具列表，请勾选 linshe_* 工具。

插件在每轮请求前读取邻舍配置，角色人物卡作为稳定人格前缀注入，保留 AstrBot 的历史和其他系统指令。关闭人格注入可只使用工具。动态外观、日程与日报由工具实时查询；查询不会触发生成。切换角色后建议新建 AstrBot 会话，避免旧角色历史影响回答。

生图与 TTS 提交后后台轮询，完成时发送至发起的会话；插件重载会取消等待，已提交的邻舍生成任务继续运行。生图要求邻舍的 LLM 与生图服务已配置；TTS 要求启用邻舍语音服务并为角色绑定音色。

同机地址通常为 http://127.0.0.1:3099。Docker 中改用能访问宿主的地址（Windows Docker Desktop 可用 http://host.docker.internal:3099）；跨设备填写邻舍电脑局域网地址。媒体由插件读取后转成 base64 交给消息适配器，只有 AstrBot 需要能够访问邻舍，适配器无需直接访问邻舍地址。单个媒体上限 32MB。

默认所有 AstrBot 会话都能使用已开放的工具。如需限定群聊/私聊，在 allowed_sessions 填写 /sid 返回的标识。重置邻舍 Token 后必须同步修改插件配置。ZIP 不包含凭据。

官方接口依据：[工具注册](https://docs.astrbot.app/dev/star/guides/ai.html)、[请求钩子](https://docs.astrbot.app/dev/star/guides/listen-message-event.html)、[消息发送](https://docs.astrbot.app/dev/star/guides/send-message.html)。
