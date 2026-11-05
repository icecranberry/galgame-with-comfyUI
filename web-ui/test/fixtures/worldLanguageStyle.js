import { createApp, h, reactive } from 'vue'
import WorldLanguageStyleModal from '../../src/components/WorldLanguageStyleModal.vue'
import LinsheModal from '../../src/components/ui/LinsheModal.vue'
import LinsheButton from '../../src/components/ui/LinsheButton.vue'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/components.css'
import '../../src/styles/animations.css'

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'warm'
const state = reactive({ open: true, worldId: 1, languageStyle: '', mode: 'success', requests: [], saved: [] })
let finishPolish
// 全部接口使用合成数据，禁止访问真实后端或消耗模型额度。
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body)
  state.requests.push({ url, body })
  if (url.endsWith('/language-style/polish')) {
    if (state.mode === 'pending') await new Promise(resolve => { finishPolish = resolve })
    if (state.mode === 'error') return Response.json({ error: '测试润色失败' }, { status: 502 })
    return Response.json({ ok: true, content: '## 文风要求：温柔幽默文风\n\n### 核心特征\n- 含蓄幽默：用轻巧的接话形成反差。\n\n### 用词与句式\n- 语言温和，长短句交替，保留自然停顿。\n\n### 禁止事项\n- 避免生硬说教和刻意堆梗。\n\n### 例句\n她把伞往他那边挪了挪。\n「靠近点，伞又不会害羞。」\n他笑了一声，终于不再和雨较劲。' })
  }
  if (options.method === 'PUT' && /\/world-settings\/\d+$/.test(url)) {
    if (state.mode === 'saveError') return Response.json({ error: '测试保存失败' }, { status: 500 })
    return Response.json({ ok: true, item: { id: state.worldId, language_style: body.language_style } })
  }
  throw new Error(`Unexpected fixture request: ${url}`)
}
createApp({ render: () => h('main', [
  h(LinsheModal, { modelValue: true, title: '世界观设置', transitionMs: 300 }, {
    default: () => h(LinsheButton, { onClick: () => { state.open = true } }, () => '语言风格'),
  }),
  h(WorldLanguageStyleModal, {
    modelValue: state.open, worldId: state.worldId, worldName: '日常世界', languageStyle: state.languageStyle,
    'onUpdate:modelValue': value => { state.open = value },
    onSaved: item => { state.saved.push(item); state.languageStyle = item.language_style },
  }),
]) }).mount('#app')
window.languageStyleFixture = { state, finishPolish: () => finishPolish?.() }
