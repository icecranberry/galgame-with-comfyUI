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
6. 调整输入框风格只改 `LinsheInput.vue`；`App.vue` 里的全局 `input, textarea` 样式只是 select 等未组件化控件的兜底

## LLM 输出

编写或修改 LLM 生成相关的 prompt 时：

1. 如果要求模型输出 JSON 格式，必须在 prompt 中举例说明 JSON 输出的完整格式（字段名 + 示例值），不能只口头描述
2. 示例中每个字段的值要写明该字段的内容要求与约束（如字数、语气、格式、禁止项），让模型照着填，参考 `agent-core/src/services/eventGenerator.js` 中 `formatPrompt` 的写法
3. 必须明确要求模型严格按示例格式输出，不要输出任何解释或 JSON 以外的文字
4. 新增或修改输出字段时，同步更新 prompt 中的 JSON 示例与解析代码，保持两者一致
