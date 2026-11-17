# 邻舍.EXE 第三方游戏开发指南（社区开发者版）

欢迎为 [邻舍.EXE (`icecranberry/galgame-with-comfyUI`)](https://github.com/icecranberry/galgame-with-comfyUI) 开发社区游戏！  
本项目的游戏模块采用**独立前端包 + 可选单文件后端插件**的开放架构：你可以完全自由地设计游戏玩法与视觉 UI（无需遵循主站 `linshe-` 组件规范），同时通过官方提供的 `LinSheGameSDK` 直接调用邻舍里的角色人设、记忆、关系、LLM 对话与 ComfyUI/NovelAI 生图能力。

---

## 一、 核心特点与约束

1. **UI 完全自由**：你的游戏运行在独立的全屏宿主容器中，可以使用原生 HTML/JS、Vue、React、Canvas、PixiJS 或任何前端框架，风格完全由你定义。
2. **零配置调用 AI 与生图**：不需要自己申请或配置 API Key，直接通过 `LinSheGameSDK` 复用玩家在《邻舍.EXE》里配置好的大语言模型和 ComfyUI / NovelAI 生图服务。
3. **数据隔离与自动落盘**：游戏产生的图片会自动落盘在本地 `data/game/<gameId>/<sessionId>/` 目录，不会弄乱玩家的主相册；存档也由宿主统一持久化到 SQLite。
4. **纯本地免 `npm install` 约束**：如果你的游戏包含后端扩展脚本，**必须预先打包成单文件 ESM（`.mjs`）**，且不可依赖未打包的第三方 `node_modules`，以保证在 Windows 整合包环境下开箱即用。

---

## 二、 标准游戏包目录结构

### 最简纯前端游戏（适合视觉小说、文字冒险、小游戏）
```text
my-awesome-game/
├── game.json           # 【必填】游戏清单
├── README.md           # 游戏说明与玩法介绍
└── web/
    ├── index.html      # 入口页面
    ├── cover.png       # 游戏封面图（建议 16:9）
    └── assets/         # 你的 JS / CSS / 音效 / 图片资源
```

### 进阶全栈游戏（含自定义后端逻辑、规则引擎或 Agent）
```text
my-trpg-game/
├── game.json
├── README.md
├── web/
│   └── index.html
└── server/
    └── index.mjs       # 【可选】单文件打包的后端插件
```

---

## 三、 `game.json` 清单规范

根目录必须包含合法的 `game.json`：

```json
{
  "id": "my-awesome-game",
  "name": "你的游戏名称",
  "version": "1.0.0",
  "author": "你的名字或 GitHub ID",
  "description": "一句话介绍你的游戏玩法",
  "cover": "web/cover.png",
  "entry": "web/index.html",
  "serverEntry": "server/index.mjs",
  "minAppVersion": "3.5.0",
  "permissions": [
    "bridge:read",
    "llm:chat",
    "image:generate",
    "save:rw"
  ],
  "tags": ["文字冒险", "CoC", "联动"]
}
```

**字段说明**：
- `id`：全局唯一标识，仅允许小写字母、数字和连字符（`a-z0-9-`）。
- `entry`：前端入口 HTML 的相对路径。
- `serverEntry`：可选，后端插件入口相对路径；纯前端游戏可省略该字段。
- `permissions`：声明游戏需要使用的宿主能力。

---

## 四、 前端开发与 `LinSheGameSDK` API

### 4.1 构建与路径注意事项
- **必须使用相对路径**：你的前端会被挂载在 `/game-assets/<gameId>/` 下。如果使用 Vite/Webpack 打包，**务必设置 `base: './'`**，切勿使用 `/assets/...` 绝对路径。
- **移动端适配**：《邻舍.EXE》支持 Android 网页壳，建议界面采用 `100dvh` 响应式布局，避免核心按钮被虚拟键盘或屏幕边缘遮挡。

### 4.2 引入与调用 `LinSheGameSDK`

宿主环境会在加载游戏时自动注入 `window.LinSheGameSDK`（如在本地独立调试，可引入 mock 垫片）。常用异步接口如下：

#### 1. 调用邻舍只读数据（角色、记忆、关系、小镇）
```javascript
// 获取所有已创建的邻舍角色列表
const characters = await window.LinSheGameSDK.bridge.call('get_characters');

// 获取指定角色的详细人设、外观 Tag 与状态
const profile = await window.LinSheGameSDK.bridge.call('get_character_profile', {
  characterId: characters[0].id
});

// 获取角色间的关系与好感度 / 近期记忆摘要 / 小镇状态
const relations = await window.LinSheGameSDK.bridge.call('get_relationships', { characterId: characters[0].id });
const memories = await window.LinSheGameSDK.bridge.call('get_memories', { characterId: characters[0].id });
const townState = await window.LinSheGameSDK.bridge.call('get_town_state');
```

#### 2. 调用 LLM 生成文本或 JSON
```javascript
const reply = await window.LinSheGameSDK.llm.chat([
  { role: 'system', content: '你是一名神秘的占卜师...' },
  { role: 'user', content: '帮我抽取今天的塔罗牌。' }
], {
  temperature: 0.8,
  responseFormat: 'json' // 可选：要求模型输出结构化 JSON
});
```

#### 3. 调用 ComfyUI / NovelAI 生图（自动落盘 `data/game/`）
```javascript
const imgResult = await window.LinSheGameSDK.image.generate({
  sessionId: 'save_001',
  prompt: '1girl, mysterious library, candlelight, oil painting style',
  negativePrompt: 'lowres, bad anatomy',
  width: 1024,
  height: 576
});

// 返回可直接用于 <img src="..."> 的本地访问路径
document.getElementById('bg').src = imgResult.url;
```

#### 4. 读写游戏存档
```javascript
// 保存当前进度（state 为任意可序列化 JSON 对象）
await window.LinSheGameSDK.save.write('save_001', '第一章：雾夜', {
  chapter: 1,
  hp: 10,
  inventory: ['黄铜钥匙']
});

// 读取存档列表与具体存档
const saves = await window.LinSheGameSDK.save.list();
const saveData = await window.LinSheGameSDK.save.load('save_001');
```

#### 5. 请求自定义后端插件与退出游戏
```javascript
// 请求 server/index.mjs 注册的扩展接口（实际映射为 /api/games/<gameId>/ext/roll）
const dice = await window.LinSheGameSDK.ext.request('/roll', {
  method: 'POST',
  body: JSON.stringify({ sides: 100 })
});

// 通知主程序退出当前游戏，返回游戏中心
window.LinSheGameSDK.ui.exit();
```

---

## 五、 后端扩展插件开发规范（可选）

如果纯前端无法满足你的需求（例如你需要真随机骰子引擎、复杂状态机或自定义 Agent 循环），可以在 `game.json` 中声明 `"serverEntry": "server/index.mjs"`。

### 5.1 编写与打包要求
- 可以使用 Node.js 内置模块（`crypto`、`path`、`fs/promises` 等），若使用了 npm 第三方库，**请用 `esbuild` 打包成单文件**：
  ```bash
  npx esbuild server/src/index.js --bundle --platform=node --format=esm --outfile=server/index.mjs
  ```
- 文件操作请严格限制在宿主传入的 `ctx.gameDataDir` 内，不要修改主程序目录文件。

### 5.2 插件导出模板（`server/index.mjs`）

```javascript
export default function registerGamePlugin(ctx) {
  const { router, llm, imageService, bridgeTools, gameDataDir } = ctx;

  // 注册自定义接口：前端通过 sdk.ext.request('/roll', ...) 访问
  router.post('/roll', async (req, res) => {
    const sides = Number(req.body?.sides || 100);
    const value = Math.floor(Math.random() * sides) + 1;
    res.json({ ok: true, value });
  });

  // 可选：返回清理函数，在玩家卸载或更新游戏时由宿主自动调用
  return {
    onUnload() {
      // 清理你的定时器或内存缓存
    }
  };
}
```

---

## 六、 本地测试与发布到社区索引

### 6.1 本地测试流程
1. 将你的游戏文件夹打成 `.zip` 压缩包（确保 `game.json` 在压缩包根目录，或单层子目录内）。
2. 打开《邻舍.EXE》 -> 进入「游戏中心」 -> 点击「导入本地压缩包」即可运行，或直接复制文件夹到 `agent-core/data/games_community/<gameId>/` 后刷新页面。
3. 在浏览器开发者工具中查看控制台与网络面板（`iframe` 内支持独立断点调试）。

### 6.2 发布到 GitHub 并被社区工坊自动收录
《邻舍.EXE》采用类似插件市场的 GitHub 定向收集机制，只需 3 步即可让所有玩家在软件内搜到并一键安装你的游戏：

1. 将你的游戏代码推送到一个**公开的 GitHub 仓库**（确保仓库根目录直接放有 `game.json` 和 `README.md`）。
2. 进入你的 GitHub 仓库主页，点击右侧 **About** 旁的齿轮图标，在 **Topics** 中添加标签：
   `linshe-game`
3. 社区索引爬虫会定期抓取带有 `linshe-game` 标签且 `game.json` 校验通过的仓库，自动上架到「游戏中心 -> 社区工坊」列表中。玩家也可以直接复制你的 GitHub 仓库链接在软件内导入。

### 6.3 发布前自检清单
- [ ] `game.json` 字段完整，`id` 无特殊字符且不与常见游戏冲突。
- [ ] 前端所有资源引用均为相对路径（如 Vite 已设置 `base: './'`）。
- [ ] 若包含 `serverEntry`，已打包为单文件 `.mjs` 且不依赖外部 `node_modules`。
- [ ] 未在代码中硬编码任何个人 API Key 或绝对本地磁盘路径（如 `C:\Users\...`）。
