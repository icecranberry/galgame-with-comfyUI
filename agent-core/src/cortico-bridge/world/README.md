# cortico-world-linshe

把邻舍（Linshe）的角色人设资料、内容查询、生图与语音能力接入 Cortico 的 World 扩展。

工具通过邻舍桥接 API（`<邻舍地址>/api/cortico`，纯本地无鉴权）读写；生图、语音与朋友圈配图以工具回执附件（`log:` 句柄）交给 Persona，由 QQ World 的 `qq_draft` 发送。

## 配置

部署 `config.json` 的 `worlds.linshe` 段：

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `false` | 是否挂载 |
| `baseUrl` | `http://127.0.0.1:3099` | 邻舍服务根地址 |
| `taskTimeoutSec` | `240` | 生图/语音任务在工具内等待的上限 |

