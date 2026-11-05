import { createApp, h, reactive } from 'vue'
import Modal from '../../src/components/ui/LinsheModal.vue'
import Button from '../../src/components/ui/LinsheButton.vue'
import CloseButton from '../../src/components/ui/LinsheCloseButton.vue'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/components.css'
import '../../src/styles/animations.css'

const state = reactive({ outer: false, inner: false, disabled: false, backdrop: true, guard: false, guarded: false, calls: [], error: false })
window.modalFixture = state
let resolveGuard
window.resolveModalGuard = value => resolveGuard?.(value)
const action = (label, onClick) => h(Button, { onClick }, () => label)
createApp({ render: () => [
  action('打开主窗口', () => { state.outer = true }),
  h(Modal, {
    modelValue: state.outer, title: '主窗口', 'onUpdate:modelValue': value => { state.outer = value },
    onClose: () => state.calls.push('outer'),
  }, { default: () => [
    action('打开子窗口', () => { state.inner = true }),
    action('最后一个操作', () => {}),
  ] }),
  h(Modal, {
    modelValue: state.inner, title: '子窗口', closeDisabled: state.disabled, closeOnBackdrop: state.backdrop,
    beforeClose: () => { if (state.error) throw new Error('guard failed'); if (state.guard) return new Promise(resolve => { resolveGuard = resolve }); return true },
    'onUpdate:modelValue': value => { state.inner = value },
    onClose: reason => state.calls.push(reason), onCloseError: () => { state.guarded = true },
  }, { default: () => action('子窗口操作', () => {}) }),
  h(CloseButton, { label: '独立关闭按钮', disabled: true }),
] }).mount('#app')
