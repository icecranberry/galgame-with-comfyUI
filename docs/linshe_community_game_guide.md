# 邻舍.EXE 社区游戏开发指南

社区游戏由独立前端和可选的单文件后端插件组成，通过 `LinSheGameSDK` 使用邻舍的角色资料、存档、LLM 和生图服务。官方跑团的规则、模组与运行机制见[游戏模块文档](game-module.md)。

- **游戏目录**。社区游戏的本地试玩包必须放在 `agent-core/data/games_community/<gameId>/`。`games/official/` 仅供随主仓库发布的官方游戏使用，禁止在此创建、开发或提交社区游戏。
- **UI 风格**。每个游戏都必须采用符合题材和核心玩法的风格化 UI，并保持自己的视觉语言。在确定游戏主题时，必须同步规划 UI 主题，明确整体视觉风格，以及它如何体现在主要界面、控件和玩法反馈中。
- **游戏命名**。游戏名称必须有趣、好记，体现题材或玩法的看点。禁止套用「邻舍＋类型／玩法」这类模板化名称。

## 1. 创建游戏与本地调试

### 创建游戏目录

在运行邻舍后端的机器上找到含有 `agent-core/` 的邻舍根目录。为新游戏选一个未被使用的 `id`，然后在 `agent-core/data/games_community/<gameId>/` 创建游戏目录。把 `game.json` 放在该目录根部，目录名与清单中的 `id` 必须一致。

邻舍源码仓库的 `.gitignore` 已用 `agent-core/data/` 覆盖所有社区游戏目录。开发时沿用这条规则即可。源码仓库里可用 `git check-ignore -v -- agent-core/data/games_community/hello-linshe/game.json` 查看命中的规则。

### 制作并运行最小示例

以下最小示例用于验证 SDK 连接和存档，使用 `hello-linshe` 作为游戏 ID。在邻舍根目录执行建目录命令，然后创建下面的两个 UTF-8 文件。

```powershell
New-Item -ItemType Directory -Path .\agent-core\data\games_community\hello-linshe\web
```

```text
agent-core/data/games_community/hello-linshe/
├── game.json
└── web/
    └── index.html
```

**`game.json`**

```json
{
  "id": "hello-linshe",
  "name": "再按一下",
  "version": "1.0.0",
  "description": "数一数已经来过多少次。",
  "entry": "web/index.html",
  "nsfw": false,
  "permissions": ["save:rw"]
}
```

**`web/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>再按一下</title>
  <style>
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 1rem system-ui; }
    main { padding: 1rem; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>再按一下</h1>
    <p>当前计数 <output id="count">0</output></p>
    <button id="increment" disabled>+1 并保存</button>
    <p id="status" role="status">正在连接邻舍…</p>
  </main>
  <script>
    const sdk = window.LinSheGameSDK;
    const count = document.getElementById('count');
    const increment = document.getElementById('increment');
    const status = document.getElementById('status');
    let save;

    async function start() {
      if (!sdk) throw new Error('请从邻舍游戏中心打开游戏');
      await sdk.ready;
      const [latest] = await sdk.save.list();
      save = latest ? await sdk.save.load(latest.sessionId) : null;
      count.textContent = save?.state.count ?? 0;
      status.textContent = save ? '已读档' : '第一次游玩';
      increment.disabled = false;
    }

    increment.addEventListener('click', async () => {
      increment.disabled = true;
      status.textContent = '正在保存…';
      try {
        const nextState = { ...save?.state, count: (save?.state.count ?? 0) + 1 };
        save = await sdk.save.write(
          save?.sessionId ?? crypto.randomUUID(), '计数进度', nextState, save?.revision ?? 0
        );
        count.textContent = save.state.count;
        status.textContent = '已保存';
        increment.disabled = false;
      } catch (error) {
        status.textContent = `保存失败（${error.message}）。退出重进可重新读取进度。`;
      }
    });

    start().catch(error => { status.textContent = error.message; });
  </script>
</body>
</html>
```

1. 使用源码仓库时，在邻舍根目录运行 `npm run dev`，打开终端显示的 Vite 地址，默认是 `http://localhost:5173`。开发模式会扫描新游戏。若已在开发模式下运行，保存完两个文件后等后端重启就绪即可。使用整合包时，两个文件就位后通过启动器启动邻舍。已运行的整合包需要重启后端，或把两个文件打成 ZIP 直接导入。
2. 打开「游戏中心 → 我的游戏 → 再按一下」，点击「开始游戏」。
3. 点「+1 并保存」，等页面显示「已保存」，再通过左上角「游戏馆」退出并重进。首次试玩时预期显示「已读档」，计数仍是 `1`。

### 反复修改和试玩

用源码的 `npm run dev` 启动并通过 Vite 地址试玩时，官方游戏和社区游戏都支持保存后自动加载。

| 修改 | 源码开发模式 | 整合包 |
| --- | --- | --- |
| 前端入口所在目录的 HTML、CSS、JS 或素材（通常是 `web/`） | 只自动重载正在预览这款游戏的 iframe。 | 刷新游戏页面，或退出后重新进入。 |
| 新增游戏目录 | 保存完整的清单和入口文件，等后端自动扫描，再打开游戏馆查看。 | 重启后端，或将游戏打成 ZIP 后导入。 |
| `game.json` 或 `serverEntry` 指向的 `.mjs` | 后端自动重启。已打开的游戏预览等待后端就绪后重新读取清单并重载。 | 重启后端，再进入游戏测试。 |

重载会重置游戏页面里尚未保存的状态。沿用同一个游戏 `id`，可以带着同一份存档反复试玩。用浏览器开发者工具选中游戏 iframe 查看控制台和网络请求。使用 Vite 等构建工具时，可以让监听构建（如 `npx vite build --watch`）把产物写入前端入口所在目录。开发模式会在产物写入后自动重载预览。

`games_community` 是邻舍管理的运行目录，卸载游戏会删除其中对应的目录。需要版本管理时，把源码保存在游戏自己的项目或 Git 仓库里，将可运行文件复制或构建到本地游戏目录。

## 2. 清单与前端打包

| 清单字段 | 要求 |
| --- | --- |
| `id` | 必填，游戏的唯一标识。1–80 个 ASCII 字符，首位是字母或数字，其余可用字母、数字、下划线和连字符，避开 Windows 保留名称。建议用小写并加作者前缀，例如 `xiaozhideng-paper-lantern`。发布后保持固定。`id` 只改字母大小写仍视为冲突。 |
| `name`、`version` | 必填。版本使用 `x.y.z`，例如 `1.0.0`。 |
| `entry` | 必填，包内已有的 `.html` 文件。推荐 `web/index.html`。 |
| `nsfw` | 必填，JSON 布尔值。包含成人向等不宜在工作或公共环境展示的内容时填 `true`，否则填 `false`。 |
| `author`、`description`、`tags` | 可选，填写作者、简介和字符串标签数组，方便玩家识别作品。 |
| `cover` | 可选，相对包根目录的路径，图片放在前端入口同目录或其子目录，例如 `web/cover.png`。 |
| `permissions` | 可选，数组。省略时没有已声明的宿主权限。只声明用到的能力，见下方权限表。 |
| `minAppVersion` | 可选，格式为 `x.y.z`。发布时填写实际验证过的最低宿主版本，并在 README 注明。快速开始以已有「游戏中心」的构建为基线。 |
| `serverEntry` | 可选，指向包内的单文件 `.mjs`，例如 `server/index.mjs`。 |

`nsfw: true` 的游戏在「社区工坊」中默认隐藏，勾选「显示 NSFW」后才出现在列表里。这类游戏在「社区工坊」和「我的游戏」的卡片文案区右上角会显示紫色斜缎带 `NSFW`。游戏只需在清单里声明该值，缎带由邻舍主项目绘制。工坊收录、安装和首次扫描本地游戏都要求明确声明，既有安装若缺少此字段也可继续运行，作者可在下次发布时补上。

清单路径使用 `/` 分隔。游戏加载在 `/game-assets/<gameId>/` 下，宿主从前端入口所在目录提供静态文件。使用相对资源路径，把编译后的 HTML、脚本、字体和素材一起放进包里。Vite 设置 `base: './'`，其他构建工具也应输出相对资源地址。

游戏运行在仅允许脚本的隔离 iframe 中。将进度交给 SDK 存档，主站样式与浏览器存储在游戏中不可用。宿主限制直接 `fetch`、WebSocket、Worker 和外部 CDN。静态数据可在构建时随脚本打包，需要运行时请求的数据走 SDK。移动端可用 `100dvh` 并给宿主返回按钮和安全区留出空间。

## 3. 使用 SDK

宿主会在游戏脚本之前自动注入 `window.LinSheGameSDK`。初始化时 `await sdk.ready` 并处理握手失败。LLM 和生图复用玩家在邻舍配置的服务，游戏包无需保存服务密钥。

| 清单权限 | 前端 SDK | 后端插件 |
| --- | --- | --- |
| `save:rw` | `save.list/load/write/delete` | `ctx.db.list/load/write` |
| `image:generate` | `image.generate` | `ctx.imageService.generate` |
| `bridge:read` | `bridge.call` | `ctx.bridgeTools.call` |
| `llm:chat` | `llm.chat` | `ctx.llm` 的模型调用 |

### 3.1 存档

- `sdk.save.list()` 返回本游戏的存档摘要，按最后更新时间倒序。`sdk.save.load(sessionId)` 读取完整存档，包括 `title`、`state` 和 `revision`。
- `sdk.save.write(sessionId, title, state, revision)` 返回写入后的存档。创建存档用 `crypto.randomUUID()` 生成全局唯一的 ID，传 `0` 表示预期尚无此存档。之后传最近一次载入或写入返回的 `revision`，写入冲突时重新载入，再让玩家决定如何保存。
- `state` 接受可序列化的 JSON 对象或数组，社区游戏单档上限为 4 MiB。给复杂存档加自己的 `schemaVersion`，方便新版读档时迁移。
- `sdk.save.delete(sessionId)` 删除存档及旧版随档图片。相册成片由相册独立管理。切换游戏或重进时，用 `list` 重新找到存档。

### 3.2 生图与自动归档

先声明 `save:rw` 和 `image:generate`，并成功创建当前游戏的存档。将下方代码放进「生成场景」按钮的异步点击处理器，其中 `save` 是当前存档，`preview` 是用于预览的 `<img>`。等待期间禁用按钮，失败时显示 SDK 错误。

```js
if (!save) throw new Error('请先保存游戏');
const { url } = await sdk.image.generate({
  sessionId: save.sessionId,
  prompt: 'a quiet train station at dusk, warm lights, landscape illustration',
  negativePrompt: 'lowres, blurry',
  width: 1024,
  height: 576
});
preview.src = url;
save = await sdk.save.write(
  save.sessionId, save.title, { ...save.state, imageUrl: url }, save.revision
);
```

生图返回 `{ url, urls }`，其中 `url` 是首张图片的相册地址，可以直接赋给 `img.src`。存档只记录返回的地址，例如 `state.imageUrl`。若生图完成后存档写入发生冲突，先重新载入存档再保存已返回的地址。

每次生图成功，宿主在返回结果前将本次所有成片自动保存到「相册 → 游戏」，每张图片只保存在 `agent-core/data/images/game/` 一处。前端 SDK 和后端插件走同一流程，批量出图也会逐张归档。游戏收到结果即可展示，无需等待玩家确认。相册中删除成片后，存档里对应的图片地址会失效。已有游戏请移除手动保存、收藏和 `sdk.image.promote` 调用。

### 3.3 读取邻舍资料与调用 LLM

`bridge.call(toolName, args)` 只接受宿主的只读白名单。角色列表可以为空，选择角色后再查询详细资料。

| 工具 | 用途 |
| --- | --- |
| `get_characters`、`get_character_profile` | 角色列表与指定角色的原始人设、头像、立绘。详情传 `{ characterId }`。 |
| `get_relationships`、`get_standings` | 关系与立绘资料，均传 `{ characterId }`。 |
| `get_memories`、`search_character_memory` | 按角色分页列出记忆，或按 `{ characterId, query, limit }` 搜索。 |
| `get_album`、`read_character_emotion`、`get_town_state` | 相册查询、指定角色情绪和当前小镇状态。 |

`sdk.llm.chat(messages, options)` 接收带字符串 `content` 的消息数组，返回文本字符串。`responseFormat: 'json'` 向提供商请求 JSON 输出。提示词仍应给出完整 JSON 样例与字段约束，调用方对返回文本执行 `JSON.parse` 并校验字段。普通 `llm.chat` 默认关闭世界书。

`await sdk.ui.exit()` 可返回游戏馆。需要接收插件事件时，用 `const unsubscribe = sdk.on('event-name', handler)` 注册监听，离开相关界面时调用 `unsubscribe()`。

### 3.4 角色姓名匹配

游戏内以本局角色名作为唯一关联键，适用于玩家、AI 队友、主持人和剧本 NPC。入场前确认姓名能唯一匹配。遇到重名时，排除无法区分的候选，或在开局前为角色确定唯一的局内姓名。该姓名在本局内固定，服务端按当前操作允许的名单校验。

- 前端业务请求、LLM 消息、工具参数及回执和存档统一使用姓名。对白可用 `speaker`，目标可用 `characterName`。角色状态按姓名索引，个人道具可以直接放在对应角色的背包里。移除 `characterId`、`actorId`、`ownerId` 等角色编号，也要检查快照、历史回放和工具续调用。
- 社区 SDK 的通用资料查询沿用上一节的参数。查资料所需的 `characterId` 只在调用主站只读桥接时使用，查询结果进入游戏逻辑前按姓名选取所需字段。官方深夜酒馆和跑团已有按姓名读取资料的专用桥接。
- 场景、线索和道具保留各自的编号，例如 `sceneId`、`clueId` 和 `itemId`。游戏、存档和回合编号继续按各自的协议传递。
- 未发布的游戏切换到姓名关联时，可以递增存档版本并跳过旧格式。已发布游戏按[保留数据更新](#保留数据更新)验证存档迁移。

## 4. 分发、工坊发布与保留存档更新

本地试玩通过后再准备分发。分发内容从单个游戏目录整理，包括 `game.json`、`web/` 和该游戏运行所需的插件或数据文件。保持清单引用的相对路径，排除存档、密钥和开发依赖。

### 发布到 GitHub 工坊

1. 使用游戏自己的公开 GitHub 仓库，将游戏文件和 README 提交并推送到默认分支。让 `game.json` 直接位于仓库根目录，`web/` 和可选的 `server/` 与它同级。README 可写明安装方式、最低宿主版本、用到的能力和玩法。
2. 在仓库的 Topics 添加 `linshe-game`。邻舍在打开「社区工坊」时按需查询 GitHub，检查最近更新的最多 30 个候选仓库的根清单。工坊结果缓存 20 分钟，可点「刷新工坊」主动查询。
3. 从玩家侧验证安装。工坊列表可直接安装，也可在「导入游戏」中填写 `owner/repo` 或 GitHub 仓库主页链接。邻舍用 Git 浅克隆默认分支，将该分支跟踪的文件校验后安装到本地。安装目录只保存游戏文件，发布时推送仓库即可。

整合包优先使用随包附带的 Git。源码环境从系统 PATH 查找 Git。游戏仓库需要包含可直接运行的构建产物，文件总计至多 100 MiB，单文件至多 20 MiB，最多 5,000 个文件。符号链接和 Git 子模块请改为随仓库一起提交的普通文件。

工坊的「连接设置」可填写 HTTP 代理地址，例如 `http://127.0.0.1:7890`，仓库搜索、清单和 Git 拉取共用这个地址。留空并保存会直连。未设置时，邻舍会探测本机常见 HTTP 代理端口，验证能连到 GitHub 后记住并回填。自动发现的代理临时失效时，本次连接会回退到直连，已记住的端口可供下次使用。端口更换后可点「自动探测代理」更新。网页版本检查和启动器访问 GitHub 时也会读取这个设置。

GitHub Token 用于 GitHub API 限流场景。Raw 镜像前缀用于工坊读取仓库中的清单。

### 可选的 ZIP 分发

在包含 `game.json` 和 `web/` 的游戏目录内运行下面的 PowerShell 命令。进阶游戏按清单一并打包后端插件和其他随包数据。

```powershell
Compress-Archive -Path .\game.json, .\web -DestinationPath ..\hello-linshe.zip
```

玩家通过「游戏中心 → 导入游戏 → 选择 ZIP 文件」安装。使用 AES 或 ZipCrypto 加密的 ZIP 会在选中后提示输入密码，输错可以直接重试。ZIP 可在根目录放一份 `game.json`，也可带一层唯一的游戏外壳目录。压缩包上限 50 MiB，解压合计上限 100 MiB，单个文件上限 20 MiB，最多 5,000 个条目。打包时排除开发依赖和符号链接，避免只有大小写区别的同名路径。

### 保留数据更新

保留存档、旧版随档图片和插件数据需要同时匹配原游戏的 `id` 和来源。只要游戏仍在安装，或卸载后还有数据，另一来源的游戏就不能使用这个 ID。工坊会把这类仓库标为「ID 冲突」，从仓库链接、ZIP 导入或本地扫描也无法认领这些数据。两款不同作品撞 ID 时，应给其中一款分配新的 ID。

1. 从 GitHub 发布新版时，保持原仓库地址和 `game.json` 的 `id`，增加 `version`，并验证新版能读旧档。如果存档结构有变化，按存档里的版本迁移。
2. 在「我的游戏」打开游戏的更多菜单，选择「从仓库更新」。邻舍从原 GitHub 仓库拉取默认分支，核对游戏 ID 后替换游戏文件，保留存档、旧版随档图片和插件数据。
3. 更新完成后，重新进入游戏检查旧存档和游戏内图片。

ZIP 安装时会记录包内所有游戏文件的指纹。重新打包、压缩或加密后，只要包内相对路径和文件内容都一样，就能用相同 ID 恢复已有数据。新版 ZIP、旧版未记录指纹的 ZIP，以及 ZIP 与 GitHub 之间的切换无法确认同源。需要连续保档更新的发布版请从同一个 GitHub 仓库安装。本地开发请直接修改原游戏目录并重载，保留数据卸载后再手动放入同名目录会被拦截。

## 5. 可选后端插件

在清单加入 `"serverEntry": "server/index.mjs"` 后，宿主会在首次访问扩展接口时加载模块。安装时校验并复制文件。运行所需的 npm 依赖在发布前打包进单文件，保留 Node.js 内置模块引用。下方命令以 esbuild 为例。

```sh
npx esbuild server/src/index.js --bundle --platform=node --format=esm --outfile=server/index.mjs
```

默认导出一个接收 `ctx` 的注册函数。下面的插件不需要额外的清单权限，在收到请求时发出一个事件并返回结果。

```js
export default function registerGamePlugin({ router, events }) {
  router.post('/ping', (_req, res) => {
    events.emit('ping', { message: '邻舍收到请求' });
    res.json({ ok: true });
  });
}
```

前端等待 `sdk.ready` 后可调用 `sdk.ext.request('/ping', { method: 'POST' })`，实际映射到 `/api/games/<gameId>/ext/ping`。需要接收事件时先用 `sdk.on('ping', handler)` 注册。`ext.request` 支持 GET、POST、PUT、PATCH、DELETE，请求体可传 JSON 对象或 JSON 字符串。

- `ctx.db` 提供当前游戏的存档列表、读取和写入，须声明 `save:rw`。`ctx.gameDataDir` 是宿主为当前游戏提供的数据目录，自定义文件只放在这个目录。用计时器或持有资源的插件可返回 `{ onUnload() {} }`，或导出同名函数，在停用、更新和卸载时释放资源。
- 清单权限约束宿主提供的接口。后端模块以邻舍进程的权限执行，仍有 Node.js 的本机能力。作者应在 README 明示后端扩展的用途及数据访问范围，玩家应选择可信来源。
- 社区桥接只开放白名单读操作。主站设置、凭据、任意 HTTP 请求及长期记忆写入没有通用 SDK 入口。官方跑团的玩家资料、立绘管理和结团记忆属于[官方游戏的接入范围](game-module.md)，社区包应以本文的接口为准。
