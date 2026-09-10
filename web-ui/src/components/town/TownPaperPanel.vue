<template>
  <Teleport to="body">
    <div v-if="open" class="tl-overlay" @click.self="$emit('close')" @keydown.stop="onKeydown" @keyup.stop
      @pointerdown.stop @mousedown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <section ref="panel" class="tl-panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" :style="viewportStyle">
        <header class="tl-header">
          <div><span class="tl-kicker">{{ kicker }}</span><h2>{{ title }}</h2></div>
          <linshe-button variant="icon" size="sm" :aria-label="`关闭${title}`" @click="$emit('close')">✕</linshe-button>
        </header>
        <div ref="content" class="tl-content" :aria-busy="busy"><slot /></div>
        <footer class="tl-footer"><span>{{ footerText }}</span>
          <linshe-button variant="ghost" size="sm" :disabled="refreshDisabled" @click="$emit('refresh')">{{ refreshing ? '读取中…' : '重新读取' }}</linshe-button></footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
// 小镇里的暖纸面板外壳：遮罩、纸面、页脚与焦点/视口处理只写一次，
// 钱袋与公告站等「在世界里打开」的界面共用同一套外观，不各写一份皮肤。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'

const props = defineProps({ open: Boolean, title: { type: String, default: '小镇' }, kicker: { type: String, default: '邻舍小镇' },
  busy: Boolean, refreshing: Boolean, refreshDisabled: Boolean, footerText: { type: String, default: '钱物与到达状态以小镇确认为准' } })
const emit = defineEmits(['close', 'refresh'])

const panel = ref(null), content = ref(null), viewportStyle = ref({})
let previousFocus = null, contentObserver = null

// 面板里的控件（如待确认操作的重试钮）被移除后焦点会掉到 body，把焦点收回面板，键盘用户不会掉出弹窗。
function observeContent() {
  contentObserver?.disconnect()
  if (!content.value) { contentObserver = null; return }
  contentObserver = new MutationObserver(() => { if (props.open && document.activeElement === document.body) panel.value?.focus({ preventScroll: true }) })
  contentObserver.observe(content.value, { childList: true, subtree: true })
}

function onKeydown(event) {
  if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab') return
  const elements = [...panel.value.querySelectorAll('button:not(:disabled), [role="combobox"]:not([aria-disabled="true"]), [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = elements[0], last = elements.at(-1)
  if (!elements.length) { event.preventDefault(); panel.value.focus() }
  else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function resize() {
  const viewport = window.visualViewport
  viewportStyle.value = viewport ? { maxHeight: `${Math.max(120, viewport.height - 24)}px` } : {}
}
watch(() => props.open, async open => {
  if (open) {
    previousFocus = document.activeElement
    await nextTick(); resize(); panel.value?.focus({ preventScroll: true }); observeContent()
  } else if (previousFocus?.isConnected) { previousFocus.focus({ preventScroll: true }); previousFocus = null }
}, { immediate: true })
onMounted(() => { window.visualViewport?.addEventListener('resize', resize) })
onBeforeUnmount(() => { window.visualViewport?.removeEventListener('resize', resize); contentObserver?.disconnect(); contentObserver = null })
</script>

<style scoped>
.tl-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 12px; background: rgba(0,0,0,.45); box-sizing: border-box; }
.tl-panel { width: min(640px, 100%); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; background: #f4f1eeed; color: #554a43; border-radius: 22px; box-shadow: 0 12px 36px #352a231f; overflow: hidden; font-size: 14px; line-height: 1.65; text-align: left; outline: none; }
.tl-header, .tl-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; flex-shrink: 0; }
.tl-kicker { color: #9b8c80; font-size: 12px; letter-spacing: .12em; }
.tl-panel h2 { font-size: 22px; margin: 2px 0 0; font-weight: 600; }
.tl-content { padding: 0 24px 12px; overflow-y: auto; overscroll-behavior: contain; min-height: 0; }
.tl-notice:empty { display: none; }.tl-notice { font-size: 13px; }.tl-error { color: #b8574f; }
.tl-footer { color: #9a8c80; font-size: 11px; padding-top: 12px; padding-bottom: max(16px,env(safe-area-inset-bottom)); }
@media (max-width: 520px) { .tl-panel { border-radius: 18px; }.tl-header, .tl-footer { padding-left: 18px; padding-right: 18px; }.tl-content { padding: 0 18px 8px; }.tl-header { padding-top: 16px; padding-bottom: 16px; } }
</style>
