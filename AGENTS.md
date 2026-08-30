## UI / UX

所有 UI 修改、新功能设计、页面设计必须遵循 `docs/design-system.md`。

涉及 UI 时：

1. 先阅读 `docs/design-system.md`
2. 优先复用现有组件和设计模式
3. 新功能必须融入现有设计语言，不得自行引入新的视觉风格
4. 修改完成后检查与现有 Toast、世界观、信箱等页面的一致性

除非任务明确要求，不要随意重做已有设计或引入新的 UI 体系。

## 按钮（LinsheButton）

web-ui 中所有常规按钮必须使用统一组件 `web-ui/src/components/LinsheButton.vue`，禁止写裸 `<button>` 标签或全局 button 样式。

1. 引入：`import LinsheButton from '.../components/LinsheButton.vue'`，模板中写 `<linshe-button>`
2. 按层级选 variant：`primary`（珊瑚实心，每屏至多一个主操作）/ `secondary`（白底珊瑚描边，默认）/ `danger`（红色）/ `ghost`（暖白糖纸，弱操作）/ `icon`（圆形图标钮，如弹窗关闭 ✕）/ `chip`（胶囊选择、页签，配 `:active`）/ `link`（文字链接）；尺寸用 `size="sm|md|lg"`
3. 禁用与加载用 `:disabled` / `loading` prop，不要手写禁用样式
4. 特殊交互元素（长按手势、动态配色、整卡热区、下拉菜单项、已有独立设计的控件）不套组件：用 `<div role="button" tabindex="0">` + 自包含样式，补齐 `cursor/text-align` 等基础属性，禁用态用 `.is-disabled` class + `aria-disabled` + 点击守卫
5. 调整按钮风格只改 `LinsheButton.vue`，不要在各页面里覆盖组件皮肤

## 输入框（LinsheInput）

web-ui 中所有文本输入框 / 文本域统一使用组件 `web-ui/src/components/LinsheInput.vue`，禁止手写 input/textarea 皮肤样式（背景、边框、圆角、focus 光环等）。

1. 引入：`import LinsheInput from '.../components/LinsheInput.vue'`，模板中写 `<linshe-input>`；文本域用 `type="textarea"`（配 `rows`）
2. `v-model` 与原生一致，支持 `.number` / `.trim` 修饰符；`id`、`min/max/step`、`maxlength`、`autocomplete`、`@keyup.enter` 等原生属性和事件直接透传；`ref` 拿到组件实例，已 expose `focus()` / `blur()` / `select()`
3. 尺寸用 `size="sm|md|lg"`（与 LinsheButton 对齐）；校验错误态用 `invalid` prop（红色描边），不要手写 `.xx-error` 样式；禁用用 `:disabled`
4. 组件上遗留的 `class="fi"` 只承担部分页面的表单间距（margin/width）布局，新页面不要依赖它
5. 特殊输入界面不套组件，保持自包含样式：聊天主输入框（`.chat-input`）、信纸 textarea（`.paper-textarea`）、透明嵌入输入（`.vn-input`、`.fav-input`、日程筛选胶囊搜索）、深色玻璃输入（TavernView `.inline-input`）、测试画风折叠输入（`.free-scene-textarea`）、提示词预览盒（`.generated-prompt-box`）
6. 调整输入框风格只改 `LinsheInput.vue`；`App.vue` 里的全局 `input, textarea` 样式只是少数未组件化控件的兜底

## 选择框（LinsheSelect）

web-ui 中所有下拉选择统一使用组件 `web-ui/src/components/LinsheSelect.vue`（原 `DropdownSelect.vue` 已改名收编），禁止手写 `<select>` 或下拉皮肤样式。

1. 引入：`import LinsheSelect from '.../components/LinsheSelect.vue'`，模板中写 `<linshe-select>`；`v-model` 绑定选中值，`options` 为 `{ label, value }` 数组
2. 触发器与 LinsheInput 同皮肤（软糖凹陷）；尺寸用 `size="sm|md|lg"`（与按钮/输入框对齐）；禁用用 `:disabled`
3. `searchable` 开启搜索过滤；`allow-free-input` 允许自由输入（输入即值，选项仅作联想）；`ref` 拿到组件实例，已 expose `open()`（程序化展开，如获取模型列表后自动弹出）
4. 特殊下拉界面（已有独立设计的胶囊搜索等）不套组件；调整选择框风格只改 `LinsheSelect.vue`，不要在各页面里覆盖组件皮肤

## 开关（LinsheSwitch）

web-ui 中所有拨动开关（toggle switch）统一使用组件 `web-ui/src/components/LinsheSwitch.vue`，禁止手写 `input[type=checkbox]` + slider 的开关皮肤（全局 `.switch`、`.toggle-switch`、`.lora-toggle-switch`、`.lora-enable-toggle`、MemorySettingsView 局部 `.switch` 等旧实现已全部收口删除）。

1. 引入：`import LinsheSwitch from '.../components/LinsheSwitch.vue'`，模板中写 `<linshe-switch>`；`v-model` 绑定布尔值
2. `@change` 在值更新后触发（参数为新布尔值）；`title` / `aria-label` 等属性透传到内部 input；禁用用 `:disabled`；需要「已启用/已禁用」这类状态文字用 `on-text` / `off-text`（传其一即显示，文字在开关左侧，不要在外面再包一层 label）
3. 尺寸用 `size="sm|md|lg"`（默认 md），与 LinsheButton / LinsheInput 尺寸档位对齐
4. 调整开关风格只改 `LinsheSwitch.vue`，不要在各页面里覆盖组件皮肤

## LLM 输出

编写或修改 LLM 生成相关的 prompt 时：

1. 如果要求模型输出 JSON 格式，必须在 prompt 中举例说明 JSON 输出的完整格式（字段名 + 示例值），不能只口头描述
2. 示例中每个字段的值要写明该字段的内容要求与约束（如字数、语气、格式、禁止项），让模型照着填，参考 `agent-core/src/services/eventGenerator.js` 中 `formatPrompt` 的写法
3. 必须明确要求模型严格按示例格式输出，不要输出任何解释或 JSON 以外的文字
4. 新增或修改输出字段时，同步更新 prompt 中的 JSON 示例与解析代码，保持两者一致

## 角色生图人格组装（characterPersona）

所有「配合生图」的角色人格拼接——整卡 `base_prompt`，或 `short_prompt + ## 你的外观` 段——必须统一走 `agent-core/src/services/characterPersona.js`，禁止在各模块内写 `match(/##\s*你的外观/)` 之类的正则自行截取（历史上 16+ 处内联实现口径不一，已全部收口）。

**什么时候用哪种：**

1. `buildCharacterPersona(character, opts)` 是主入口：
   - `variant: 'short'`（默认）＝ `short_prompt + 外观段`，用于多角色参考（事件/朋友圈 otherPersona）、群聊成员资料卡、梦境 system3、maibot 桥生图描述器等紧凑场景
   - `variant: 'full'` ＝ 整卡 `base_prompt`（缺失回退 `short_prompt`），用于角色以完整人格出场的生图：私聊 needImage 配图、主动聊天、日程拍照、事件一/二期、礼物反应、信件、AI 头像、发帖 LLM
   - `person`：把「你」替换为指定名（`display_name`、`'角色'` 等），`null` 保持第一人称；short 只替换外观段（short_prompt 本就是第三人称），full 替换整卡
   - `outfits`：默认 `'auto'` 自动注入生效外观并附优先级说明；传 `null` 显式关闭；单测可显式传 `{limited, exclusive}`
2. 只要外观段（不含人格，如表情包 system3、主动聊天配图的外观块）用 `buildCharacterAppearanceSection(character, opts)`（含 `## 你的外观` 标题行与注入，标题自行取舍）；画面交叉参考（图中出现其他角色）用 `buildImageCrossRefInfo(char, opts)`，不要再引用已删除的 `extractImageCrossRefInfo`
3. **传入对象的 `id` 必须是角色 id**（自动注入按它查外观）。JOIN/别名行要先重映射：如 mailboxScheduler 传 `{ id: letter.char_id, base_prompt: letter.base_prompt, short_prompt: ... }`

**什么时候不用：** 非生图用途不套本入口，保持原逻辑——聊天人格稳定块（chat.js 身份块）、记忆整理、关系图谱、日程模板与字体分配（取外观段之前/之后文本）、`cropPersonalityForEmotion` 等 short_prompt 维护逻辑。`appendOathRing` 仍由各调用方在组装结果之后追加，职责不并入本入口。

**角色外观系统：**

1. 数据源两张表：`character_outfits`（角色专属形态/装甲/衣服，每角色同时只启用一套，启用互斥由 `outfitService` 保证；详情卡 UI 入口暂注释隐藏在 `CharacterDetailModal.vue`，搜「暂时隐藏」）、`global_outfits`（通用限时服饰如女仆装 tag 组合，可多套叠加；管理方式未定，`condition_json` 预留注入条件，当前 `enabled` 即生效）
2. 查询生效外观只走 `outfitService.getActiveOutfits(characterId)`；注入文本格式与着装优先级说明（两者都有 / 只有限时 / 只有专属三种）只改 `buildOutfitInjectionBlocks`，不要在调用点拼
3. 修改拼接口径（正则、连接符、注入格式）只改 `characterPersona.js`，并同步维护 `agent-core/test/characterPersona.test.js`（含无外观时与旧口径逐字节一致的回归断言）

