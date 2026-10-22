# NovelAI 接入与排错

在设置页「图片生成服务 → NovelAI」选择连接方式：

| 连接方式 | 生成接口 | 检测方式 |
| --- | --- | --- |
| NovelAI 官方 | `https://image.novelai.net/ai/generate-image` | `/user/subscription` 订阅鉴权 |
| NovelAI 原生协议中转 | 自定义地址下的 `/ai/generate-image` | `/user/subscription`，中转可能未开放 |
| OpenAI 兼容中转 | 自定义地址下的 `/v1/images/generations` | `/v1/models`，中转可能未开放 |

旧配置保留原行为：`official` 对应官方域名，`relay` 对应 OpenAI 兼容中转；`native` 是新增原生中转模式。协议和地址应按中转站文档选择，不通过多次试生图猜测协议。

地址支持域名、带服务前缀的路径、`/v1`（兼容模式）、`/ai`（原生模式）或完整生图地址。不会重复拼接 `/v1`；自定义前缀保留。地址不能包含凭据、查询参数或片段。接口若重定向，会提示填写最终地址，不自动转发凭据。

官方填写账户设置中的 Persistent API Token；中转填写该中转站签发的 Key。粘贴的 `Bearer ` 前缀会自动去除，请求统一发送一次 Bearer。原生生成支持 ZIP、JSON Base64 和直接图片；兼容生成支持 `data[].b64_json` 和 `data[].url`。下载图片 URL 时不附带服务 Key。

官方与原生模式显示内置绘图模型，也允许手动输入。检测成功只说明订阅接口鉴权成功，不保证每个模型可用。中转的模型/订阅检测返回 401、403、404、405 或 501 时显示「尚未验证」，保留 HTTP 状态、目标端点和提示，不断言生图 Key 无效。可按服务商文档手动填写模型，用图片实验室验证实际生成（会消耗相应服务额度）。

### 只提供生图接口的中转站

部分中转站只实现 NovelAI 原生协议的 `/ai/generate-image`，没有 `/user/subscription`、`/v1/models` 这些检测接口，请求会落到站点前端页面（`200 text/html`）。这种情况：

- 检测按钮不显示「未连接」，而是「尚未验证」，并说明该地址返回的是网页而非 API；随后用一次**空 body 的生图请求**确认生图接口是否在线（空 body 只触发参数校验，不会出图、不计费）。
- 这类站点只能用「NovelAI 原生协议中转」，OpenAI 兼容（`/v1/images/generations`）通常没有实现。
- 鉴权是否有效、模型是否可用只能靠实际生成确认（画风测试 / 图片实验室）。例如 `novel.nekoprompt.top` 只接受该站签发的 `nk-` 开头中转 Key，Key 不对时返回 401「请使用服务器签发的中转 Key」。

## 后端网络代理

点击默认折叠的「网络代理」后填写代理地址，例如 `http://127.0.0.1:7890`，支持 HTTP/HTTPS 代理。此地址是从**运行后端的机器**连接：远程服务器或容器中的 `127.0.0.1` 不代表浏览器所在电脑。收起入口不会清空或停用已填写的代理。

留空时显式读取后端进程环境中的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（含小写形式）；未设置则直连。显式填写的代理优先。代理仅用于 NovelAI 生成、检测及返回图片下载，不修改其他服务的全局网络配置。

也可使用 `NOVELAI_API_FORMAT=official|native|relay`、`NOVELAI_URL`、`NOVELAI_API_KEY`、`NOVELAI_PROXY_URL` 设置初始值；已保存的数据库配置优先。

## 多套配置（切换）

NovelAI 参数区顶部是一排配置胶囊，与「LLM 接口」的多配置同一套交互：

- 一份配置＝整套 NovelAI 参数：连接方式、接口地址、代理、模型、画师串、分辨率、采样器/噪声调度/步数/引导强度、质量与反向提示词、API Key。
- 首次进入时用当前生效参数自动生成「默认配置」并激活，所以界面上永远有一套生效中的配置。
- 「新增配置」以当前生效的这套为底**复制一份**（含 API Key），命名后即可分别修改；之后哪套在用就改哪套。
- 切换胶囊会把整套参数（含密钥）写回生效配置，并同时更新对应的单项设置键（`novelai_*`），重启后仍生效。
- 在参数区保存改动时会自动回写当前激活的配置快照，切换走再切回来不会丢改动。
- 删除只删配置快照；删掉正在使用的那套会回落到列表里的第一套，最后一套不可删。

存储：`system_settings.novelai_profiles`（JSON 快照数组）与 `system_settings.active_novelai_profile_id`；密钥只存在快照内，接口只回显是否已保存与掩码预览。

## 实现参考与验证


连接检测总超时为 30 秒，生成及图片读取总超时为 180 秒。DNS、TLS、连接拒绝与超时分别提示；不自动重试生成，避免重复计费。浏览器可访问官网并不意味着后端已经使用同一代理。

## 实现参考与验证

- 本地 SillyTavern 的 `src/endpoints/novelai.js`：原生参数、Bearer 认证、ZIP 图片处理。
- 本地 SillyTavern 的 `src/request-proxy.js`：显式配置出站代理的思路。邻舍使用原生 fetch，采用 Undici dispatcher，不能照搬 `http.globalAgent`。
- [NovelAI 当前官方 schema](https://image.novelai.net/docs/doc.json)：官方 JSON 响应与订阅路径；没有照搬本地旧酒馆的 `api.novelai.net/user/subscription`。
- 回归验证：在 `agent-core` 执行 `node --test test/novelaiClient.test.js test/llmConfig.test.js`。测试使用本地 HTTP 代理及模拟上游，不调用付费生成。
