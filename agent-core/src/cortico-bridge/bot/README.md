# cortico-bot-linshe

邻舍角色人格的 Cortico bot 代码包。Persona 的系统前缀由 `persona/PREFIX.md` 渲染:每次构建前缀时从邻舍桥接 API（`/api/cortico/bootstrap`）实时拉取角色人设（含按角色存储的行为 / 表达风格两节，紧跟人物卡之后），记忆是一份 MEMORY.md，各 World 的环境提示词各占一节。

声明渠道:`console`、`qq`、`linshe`。deployment.json 以 `{"bot": "cortico-bot-linshe"}` 引用本包。

Persona 的 `onDelivery` 为控制台来信补充渠道来源事实；`PREFIX.md` 要求按当前来信渠道调用 `console_send` 或 `qq_draft` / `qq_confirm` 回复。普通 assistant 文本不会显示在聊天窗口。

QQ 渠道的出站分句由独立的 [`cortico-world-qq-linshe`](../qq-segmented/README.md) World 扩展承载：它继承内置 qq World，只在出站文字上按 `agent-core/src/utils/sentenceSplitter.js`（与邻舍私聊同一模块）分句——起草时显示分句预览，确认后依次发送，图片和引用只附首段，语音仍独占一条消息，发送失败保留未发出的段落、再次确认只补发剩余。本包不感知分句差异；控制台保持整条发送。

本包通过项目内 `link:` 安装。上游 Cortico 源码保持零改动，升级不需要重新打补丁；只有当上游改动 QQWorld 的草稿/确认内部缝隙时，分句扩展才会构造报错提示更新。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `displayName` | `邻舍` | WebUI 标题与控制台发送方名称 |
| `web.port` | `7900` | WebUI 端口 |
| `rounds` | `soft 8 / hard 16` | 一轮唤醒的工具调用上限（发图需 draft→confirm 往返） |
| `worlds.linshe.baseUrl` | `http://127.0.0.1:3099` | Persona 拉人设用的邻舍地址 |

