# 游戏模块多维度测试报告（2026-11-23）

> 范围：`agent-core/src/games/*`（桥接/管理/导入/SDK/媒体）、`games/official/midnight-tavern`（服务端 922 行 + 前端约 6300 行）、`games/official/trpg-simulator`（抽查）、`web-ui` 集成层（GameCenter / GamePlayer / games/components）。
> 方法：全量精读静态审计 + 针对运行中实例（127.0.0.1:3099）的 API 实测 + 浏览器 UI 走查（桌面 1280×720 / 移动 390×844 / 无宿主直开）。
> 说明：agent-core 在测试期间为用户正在运行的实例；所有实测仅使用只读或无副作用请求，未触碰用户存档内容。

---

## 一、总体结论

架构质量整体**高于一般项目水准**：路径穿越双重防护（`inside()` 字符校验 + `realpath` 复核）、存档乐观锁（revision/editVersion 双层）、ZIP/GitHub 导入的符号链接与大小写冲突防御、`gameMedia` 暂存-复核-回滚的原子写、客户端 `commit()` 的冲突重试协议、3D 工坊的懒加载 + 降级渲染器，都是经过认真设计的东西。运行时实测的 6 组错误路径全部返回预期状态码。

但存在 **1 个必须尽快处理的安全问题（P0）**、**2 个用户可触达的死局/回归问题（P1）**，以及一批中低优先级的设计与体验问题。

---

## 二、P0 / P1 发现

### P0-1 主站 CORS 全开放 × 游戏桥接 = 任意网页可读角色隐私、烧 LLM 额度、改删存档

- 证据：`agent-core/app.js:85` `app.use(cors())`（Express cors 默认 `Access-Control-Allow-Origin: *`）；实测带 `Origin: https://evil.example` 请求 `/api/games` 返回 `Access-Control-Allow-Origin: *` 且正常返回数据。
- 游戏模块显著放大了暴露面：
  - `gameRoutes.js:74` `POST /:gameId/sdk/bridge` 无任何鉴权，`gameBridge.js:38-58` 的白名单里 `get_character_profile`（原始人设）、`get_tavern_dialogue_material`（**日程 + 朋友圈 + 私聊总结**）、`read_character_standings`、`list_character_memories` 全部可读。实测跨域 POST 直接返回了角色 1 的日程详情。
  - `gameRoutes.js:75-76` `sdk/llm`、`sdk/image` 可被任意网页调用 → 消耗用户配置的 LLM/生图额度。
  - `gameRoutes.js:82-101` sessions 读写删端点同样跨域可用 → 任意网页可**改写/删除用户存档**。
- 风险场景：用户浏览器里打开任意恶意/广告页面，该页面 JS 可直接 `fetch('http://127.0.0.1:3099/api/games/midnight-tavern/sdk/bridge', {method:'POST', ...})` 读取数据（CORS 放行，响应可读）。
- 建议（按成本从低到高）：
  1. 最小改动：给 `/api/games` 路由挂 Origin 校验中间件——仅放行同源与 `Sec-Fetch-Site: same-origin`；对非浏览器流量（curl/OneBot 桥）放行无 Origin 的请求即可，不破坏现有本地工具链。
  2. 彻底方案：`cors()` 收敛为主站实际需要的白名单（主站前端与 API 同源，绝大多数场景根本不需要 CORS）。
  3. 若保留跨域能力，bridge/llm/image/session 写操作要求宿主注入的一次性 token（GamePlayer 已有 `channel` 机制可复用）。

### P1-1 损坏存档 → 酒馆永久死局，且全产品没有自救入口

- 证据：`server/index.mjs:434-452` `openProgress()`：只要存在任何会话但没有任何一个合法的 schema 1/2 存档，就永远 `409 '无法恢复酒馆进度。'`；`gameRoutes.js:97-101` 的删除端点游戏内没有任何 UI 调用（`app.js` 的 `actions` 表无删除/重置动作）；`GameCenter.vue` 亦无存档管理界面；`gameManager.js:178` 官方游戏禁止卸载（连带无法用"卸载并清数据"自救）。
- 影响：一次 DB 迁移事故、磁盘写入损坏或未来 schema 演进失误，都会让玩家（尤其是非技术用户）永远进不去酒馆，只能手写 curl。
- 建议：在酒馆内加"重开酒馆"（调用已有 `sdk.save.delete` + 重新 open），或至少在 GameCenter 给官方游戏提供存档列表/删除入口。API 能力都是现成的，缺的只是 UI。

### P1-2 GamePlayer 源码修复未构建，线上产物仍遮挡酒馆 HUD

- 证据：浏览器实测截图——桌面端左上角时钟显示 `ight 3 · 00:16`（"N" 被宿主的「← 游戏馆」浮层盖住），移动端 390px 下 `Night 3` 整个被盖没。
- 根因链：`web-ui/src/views/GamePlayer.vue:4` 源码已加 `!['trpg-simulator','midnight-tavern'].includes(game?.id)` 排除官方游戏；但 `agent-core/public/assets/GamePlayer-DD6j82bg.js`（v4.5.0 产物，commit 4731ebd4）中 `midnight-tavern` 出现次数为 0 —— **改动没有重新 build**。`.game-exit` 定位在 `left/top safe-area`，恰好压在游戏 `.bar-status`（时钟）上。
- 建议：立即 `npm run build` 并入库产物；顺带给 `.game-exit` 保留问题做一次回归确认（即使官方游戏已排除，未来社区游戏仍会叠加在游戏 HUD 上，可考虑浮层移到右下或让游戏声明 HUD 安全区）。

---

## 三、P2 发现（按维度）

### 安全维度

- **S-1 SDK init 无来源校验 + 游戏资源无 frame-ancestors**：`linshe-game-sdk.js:8` 接受任意 parent 发来的 `linshe:host:init`（未检查 `event.origin`，沙箱下 origin 恒为 "null" 也无法区分）；`gameRoutes.js:132` 的 CSP 有 `frame-src 'none'` 但没有 `frame-ancestors`，任意网站可以 iframe 嵌入 `/game-assets/.../index.html` 并冒充宿主：伪造 RPC 结果与事件，在游戏画面内呈现攻击者选择的内容（钓鱼面）。建议给 `/game-assets` 响应加 `frame-ancestors 'self'`，一行解决。
- **S-2 GitHub Token 明文存 DB**：`gameImporter.js:239` token 直接进 settings 表。本地应用可接受，但与 P0-1 叠加后（CORS 全开）`GET /api/games/settings` 若未来返回 token 就会泄露——当前 `publicSettings()` 只回 `hasToken` ✓，属"保持现状，别改坏"。

### 正确性 / 可靠性维度

- **R-1 temperature=0 失效**：`gameServices.js:79` `Number(options.temperature) || 0.7` —— 0 是 falsy，游戏要 0（确定性骰子类判定）拿到的永远是 0.7。改 `Number.isFinite(Number(options.temperature)) ? … : 0.7`。
- **R-2 客户端整包覆写 × 服务端 patchMedia 的竞态窗口**：`server/index.mjs:777-785` patchMedia（后台补写生图 URL）不做 editVersion 校验，靠 revision 冲突失败；失败后 drink-card / tipsy-cg 的已生成图 URL 丢失，媒体条目留在 pending，下次触发会**重新生成一张新图**（旧的浪费）。概率低、可自愈（standing 有 identity 去重 ✓，卡/CG 没有内容级去重）。可接受的设计权衡，建议至少在 `patchMedia` 失败时重读一次再写。
- **R-3 generateScene 参数未校验数组**：`gameServices.js:351` `characters.filter(...)` —— `background` 为 false 且 `characters` 未传时 TypeError→500。跑团面输入应先 `Array.isArray` 校验。
- **R-4 LLM 失败静默降级**：`server/index.mjs:490-494` `narrate` 捕获一切异常返回 `{}` → `offlineChat` 罐头台词。韧性设计很好，但玩家无从知道"现在的对话不是 LLM 写的"。建议失败时发一次 `notice('侍应生今晚上不了台面，先说几句客套话。')` 之类的轻提示（可防用户以为人设崩了）。

### 架构 / 设计维度

- **A-1 官方游戏特例硬编码散布 5 处**：`gameRoutes.js:85,92`（按 id 禁 trpg 直读存档）、`gameManager.js:99`（tavernDefinitions）、`gameServices.js:124,139,304,341`（tipsy-cg 规则、世界观重申、立绘/跑团画面工具按 id+source 限制）、`gameRepository.js:16`（trpg 32MiB）、`gameRoutes.js:100` 等。建议改为 game.json 能力声明（如 `"capabilities": ["tavern-standing","trpg-replay"]`），路由与 service 按能力放行，消除"官方=硬编码"模式，也让社区游戏未来能声明同等能力。
- **A-2 存档地址只记 URL 的悬空风险**：`f1af9f37` 后新图入册、存档仅记地址；实测旧存档全部指向 legacy `/game-media/`（35MB 旧文件仍在，兼容路由 200 ✓）。但相册删图后存档内 URL 悬空——前端 `document error` 处理器会隐藏图片（`app.js:886-902` ✓），体验是"照片悄悄消失"。建议悬空时显示"照片已遗失"占位而非无声隐藏。
- **A-3 media 字典无淘汰**：`reserveStanding` 按 `guest×tier×portrait hash` 生成 key，立绘换期/换 portrait 会累积新条目；10 杯酒已 24 条。长期游玩与 4MiB 存档上限之间的余量尚大，列观察项。

### 体验 / 视觉维度

- **U-1 TRPG 首屏 4–10 秒纯黑屏无加载指示**（实测两次，第二次 10s 后才出 SCENARIOS 大厅）。建议加一个品牌化 loading 层。
- **U-2 input maxlength 与代码截断不一致**：`index.html:138` `maxlength="40"`，`app.js:34` 实际按 20 字（code point）截断——用户可粘 40 字被静默砍半，输入框也不给"还剩几字"反馈。
- **U-3 NSFW 过滤只是前端显示层**：`GameCenter.vue:155-158` 默认隐藏，无确认门、无持久化；刷新后勾选即看。作为本机应用可接受，若未来分发需补持久化 + 年龄确认。

### 性能 / 资产维度

- **F-1 未压缩大图**：`bg-tavern-bar.png` 1.5MB（stage.css 引用）、`cover.png` 1.26MB。同目录 `bg-tavern-ledger.webp` 165KB 证明 webp 管线现成——把这两张转 webp 约省 2.5MB 首屏流量。其余 props 13-15KB/张 ✓，`bar-scene.js` 744K 已 idle 懒加载 ✓（`station.js:292-294`），SFX base64 内嵌 104K ✓。
- **F-2 孤儿音频**：`bar-build/audio/ui-board-open.mp3` 未被 `bar-audio.js` 引用（imports 12 项中只有 `ui-workshop-open.mp3`），删除或接线二选一。
- **F-3 仓库卫生**：根目录残留 `llm-log-readable.txt`（untracked 调试产物），应删除。

### 测试 / 工程维度

- **T-1 游戏模块零自动化测试**：`agent-core/test/` 无任何 game/tavern/trpg 文件。922 行酒馆服务端包含大量纯函数和高回归风险逻辑：`potionDose`（协议校验）、`recipeEffects`（效果合成）、`migrateProgress`（schema 1→2 迁移）、`latestFor/editVersion` 并发协议。按"最少必要测试"原则不要求全覆盖，但**迁移与配方校验这两个"错了会毁存档"的纯函数值得各给一个最小用例集**（它们全是纯输入输出，写起来便宜）。
- **T-2 官方 game.json 的 `permissions` 与实际能力不符**：两个官方游戏都声明了全部四项权限，实际 trpg 的直读存档被代码禁掉、tavern 的 bridge 用的是扩展清单——permissions 目前只是"准入门槛"不是"能力上限"（`assertPermission` 检查的恰恰是这份声明）。建议权限语义二选一：要么如实声明最小集，要么文档明确它是"声明可用"而非"仅限"。

---

## 四、P3 / 观察项

| # | 位置 | 内容 |
|---|------|------|
| 1 | `server/index.mjs:748` vs `:6` | drunk 档截断 30 字、blackout 32 字，两个魔法数字不一致 |
| 2 | `gameManager.js:33-35` | `compatible()` 对 `3.6.0-beta` 类预发布 VERSION 会 `Number("0-beta")=NaN` → 判为不兼容 |
| 3 | `gameRoutes.js:60-62` | SSE 每连接挂一个 `events` 监听，`setMaxListeners(100)`——十几个标签页同开游玩会丢事件（仅 warn） |
| 4 | `server/index.mjs:566` | `availableGuests` 中本地客人只在 `residents.length < 2 || state.people[guest.id]` 时出现——逻辑对但可读性差，值得一行注释 |
| 5 | `view.js:450-453` | 纪念墙 reports 排序用 `state.wall.indexOf(questId)`，而 wall 里存的是 drinkId → 恒 -1，排序分支实际无效（legacy 遗留） |
| 6 | `GameCenter.vue` | 实测 Playwright actionability 点击超时——卡片区域随 SSE 数据更新整体重渲染，自动化与读屏器连续性受影响（真实用户无感） |
| 7 | `server/index.mjs:109-113` | 三位本地客人（林栀/陈砚/苏弥）引用 `./lin.svg` 等——实测存在✓，但它们不在 assets 目录清单里的话会走头像降级；建议纳入资产核对脚本 |

---

## 五、运行时实测记录（全部通过项）

| 维度 | 用例 | 结果 |
|------|------|------|
| 语法 | 全部游戏 JS（backend 14 文件 + tavern 前端 + build 源 + trpg server）`node --check` | ✅ 全过 |
| 路径安全 | `/game-assets/midnight-tavern/web/../server/index.mjs`、直接访问 `server/` 目录 | ✅ 403「游戏资源不可访问」 |
| 白名单 | `sdk/bridge` 调用非白名单工具 | ✅ 403「此工具不在游戏只读白名单中」 |
| 并发控制 | 对真实存档发过期 `editVersion` 的 `/chat/turn` | ✅ 409「请重新载入」，且未产生写入 |
| 会话校验 | 伪造 sessionId / 缺 sessionId | ✅ 404 / 400，错误文案明确 |
| 存档健康 | 读取真实存档（Night 3, schema 2, editVersion 576, 10 杯酒, 24 media） | ✅ 无 pending 媒体、无悬空引用 |
| 旧图兼容 | legacy `/game-media/...` URL | ✅ 200（旧文件仍在，兼容路由生效） |
| 角色目录 | `/char/roster`（bridge 链路） | ✅ 返回角色目录与头像 |
| 无宿主降级 | 直接打开 `index.html` | ✅ 10s 后显示"请从邻舍游戏中心打开游戏"+重试按钮 |
| 静态资产 | 代码引用的全部 props/music/cover 逐一核对 | ✅ 无缺失、无孤儿大图（除 F-2 音频） |
| 构建一致性 | `cocktail-look.js` 由 `server/index.mjs` 源码构建 | ✅ 服务端/客户端共享同一实现，无分叉 |
| UI 走查 | 游戏中心（像素馆风格、tablist 键盘导航、NSFW ribbon）、酒馆桌面/移动、TRPG 大厅 | ✅ 布局完好；300ms 过渡、reduced-motion、焦点管理、aria 全套均落实（见 P1-2 遮挡问题） |

---

## 六、修复优先级建议

1. **现在就做**：P0-1 CORS 收敛（一行中间件）＋ P1-2 `npm run build` 重建产物。
2. **本迭代**：P1-1 存档自救入口（游戏内"重开酒馆"）；S-1 `frame-ancestors 'self'`；R-1 temperature。
3. **下迭代**：A-1 能力声明化重构；T-1 两个纯函数的最小测试集；F-1 大图 webp；U-1 TRPG loading 层。
4. **顺手清理**：F-2 孤儿音频、F-3 根目录日志残留、U-2 maxlength。
