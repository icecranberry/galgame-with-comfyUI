# cortico-bot-linshe

邻舍角色人格的 Cortico bot 代码包。Persona 的系统前缀由 `persona/PREFIX.md` 渲染:角色人设从邻舍桥接 API（`/api/cortico/bootstrap`）实时拉取（30 秒短缓存）,记忆是一份 MEMORY.md,各 World 的环境提示词各占一节。

声明渠道:`console`、`qq`、`linshe`。deployment.json 以 `{"bot": "cortico-bot-linshe"}` 引用本包。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `displayName` | `邻舍` | WebUI 标题与控制台发送方名称 |
| `web.port` | `7900` | WebUI 端口 |
| `rounds` | `soft 8 / hard 16` | 一轮唤醒的工具调用上限（发图需 draft→confirm 往返） |
| `worlds.linshe.baseUrl` | `http://127.0.0.1:3099` | Persona 拉人设用的邻舍地址 |

桥接 Token 走部署 `.env` 的 `LINSHE_BRIDGE_TOKEN`,与 `cortico-world-linshe` 共用。
