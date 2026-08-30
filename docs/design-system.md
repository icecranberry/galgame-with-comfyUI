# 邻舍.EXE Design System

邻舍.EXE 采用 **Cel Glow UI**：赛璐璐动漫游戏质感 × 柔光玻璃氛围——明亮、多彩、Q 弹、克制、内容优先。

配色为「蓝紫主导 · 橙红点睛」的多点拼色体系（每主题 4 个点缀色），支持多主题切换。Toast、GiftPanel、ImageGenBubble 是动效与反馈的内部范本，新功能应从它们与全局组件类延伸。

## 样式体系（styles/）

| 文件 | 职责 |
|---|---|
| `styles/tokens.css` | 唯一变量源：4 套主题（`:root` 默认 violet + `[data-theme]`）、赛璐璐 token、`--fun-*` 功能色、圆角/阴影/字号/动效/层级尺度 |
| `styles/base.css` | reset、元素默认（button/input/滚动条）、`:focus-visible`、**全局 prefers-reduced-motion 兜底** |
| `styles/components.css` | 共享组件类（见下） |
| `styles/animations.css` | keyframes 去重库、page/modal-fade/drawer 过渡、通用动画类（cel-spin/cel-waterflow/cel-jelly） |

引入顺序（main.js）：fonts → tokens → base → components → animations。**禁止在组件内硬编码主题色值**，必须引用变量。

**迁移约定**：组件改用全局组件类时必须删除自己的 scoped 副本（scoped 属性选择器优先级更高，双写会以本地为准）。

## 核心 Token

- **色彩**：`--accent`（主色，含 `-hover/-light/-rgb`）、`--accent-2/3/4`（点睛与多彩轮换）、`--fun-*`（功能色组：purple/pink/orange/teal/blue/gold/violet/neutral，不随主题）
- **赛璐璐**：`--cel-outline`（深描边）、`--border-strong`（组件 2px 描边）、`--shadow-hard / -sm`（偏移硬阴影）、`--btn-lip`（贴纸按钮底部厚度）、`--grad-cel`（两段式明暗渐变）、`--grad-brand`（日落拼色）、`--grad-soft`（幻彩浅底）、`--dot-color`（波点纹理）
- **尺度**：`--radius-sm/md/lg/xl/full`、`--shadow-xs/sm/md/lg + --shadow-glow + --focus-ring`、`--fs-xs~2xl`、`--dur-fast/base/slow`、`--ease-standard/out/spring/emph`、`--z-nav/drawer/modal/popover/toast/float`

## 组件类（components.css）

- **按钮**：`.btn-primary`（贴纸：实底+底厚+顶部高光，按下沉底）/ `.btn-ghost` / `.btn-tonal` / `.btn-danger` / `.btn-sm`；全局 `button:active` 按压下沉（`.no-press` 可豁免）
- **表面**：`.card`（毛玻璃+2px 描边+微硬阴影）/ `.card-solid` / `.card-interactive`（hover 上浮）
- **弹窗**：`.modal-overlay / -panel(±.modal-wide) / -header / -title / -close / -body / -footer / .modal-actions`——新弹窗一律使用，配合 `modal-fade` 过渡获得统一 pop 入场
- **其他**：`.chip(.active/.chip-x)`、`.avatar(-fallback)`、`.empty`（波点+悬浮图标）、`.skeleton`、`.icon-tile(.t-purple/pink/orange/teal/blue/gold/violet)`、`.sheen`（hover 斜光扫过）、`.sparkle(.s-low)`、`.stagger`（列表错峰入场，fill=backwards 不阻塞 hover/FLIP）

## 主题体系

* 4 套预设：`violet 晴紫`（默认）、`sunset 暖阳`、`ocean 海盐`、`sakura 蜜桃`；每套含底色/文字/4 个点缀色/渐变/光斑/波点色。
* 切换：`theme.js` + `stores/settings.js` → `<html data-theme>`，localStorage 持久化（设备级偏好）。
* 例外：信箱 / Toast / 世界观编辑器保留「暖纸」底色与深棕文字（质感岛），强调色仍用主题变量；金色礼物色、语义状态色不随主题。

## 动效规范

1. 只动 `transform` / `opacity`；时长用 `--dur-*`，缓动用 `--ease-*`（弹性一律 `--ease-spring`）
2. 入场：列表容器加 `.stagger`；弹窗用 `modal-fade`；页面切换走全局 `.page`
3. 反馈：按钮全局按压下沉；点赞用 `.like-burst`（heart-pop + ring-out）；徽标出现用 `.cel-jelly`
4. 氛围：光斑缓慢漂移（index.html，52-64s）、`.sparkle` 微闪——密度克制，不叠加多层环境动画
5. 加载：优先 `.skeleton` 骨架屏，其次 `.cel-spin` loader、pending 按钮用 `.cel-waterflow`
6. `prefers-reduced-motion` 由 base.css 全局兜底，组件无需单独处理

## 主题切换 / 角色聊天背景（既有能力）

* 设置页「外观」卡片切换主题；聊天背景经 `ChatBgPanel.vue`（本地上传 / ComfyUI 生成 / 恢复默认），渲染于 `ChatView` 的 `.chat-bg + .chat-bg-veil`，图片存 `data/images/chatbg/`（相册分类「聊天背景」）。

## 设计原则

新功能设计时先明确内容、主要操作和信息层级，再决定组件和布局；优先复用全局组件类与既有交互模式。

**目标：让新功能看起来像“邻舍的一部分”，而不是后来添加的独立页面。**
