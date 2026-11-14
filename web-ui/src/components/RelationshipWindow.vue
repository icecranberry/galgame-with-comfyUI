<template>
  <Teleport to="body">
    <Transition name="relationship-window" :duration="300" @after-leave="afterLeave">
      <div v-if="visible" class="relationship-veil" :style="{ zIndex: layer }" @pointerdown="backdropStarted = $event.target === $event.currentTarget" @click.self="backdropStarted && closeOnBackdrop && close()">
        <section ref="panel" class="relationship-window" :class="{ 'is-atlas': full, 'is-wide': wide }" role="dialog" aria-modal="true" :aria-label="title" :inert="suspended || undefined" tabindex="-1">
          <header class="relationship-window-heading">
            <span class="relationship-seal" aria-hidden="true">✧</span>
            <h2>{{ title }}</h2>
            <div v-if="$slots['header-extra']" class="relationship-window-extra"><slot name="header-extra" /></div>
            <button type="button" class="rel-button rel-icon relationship-close" aria-label="关闭" :disabled="closeDisabled || checking" @click="close">×</button>
          </header>
          <div class="relationship-window-body"><slot /></div>
          <footer v-if="$slots.footer" class="relationship-window-footer"><slot name="footer" /></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { nextModalLayer, registerModal } from './ui/modalStack.js'
import '../styles/relationship.css'

const props = defineProps({ visible: Boolean, title: { type: String, default: '' }, full: Boolean, wide: Boolean,
  suspended: Boolean, closeDisabled: Boolean, closeOnBackdrop: { type: Boolean, default: true }, beforeClose: { type: Function, default: null }, zIndex: { type: Number, default: 11000 } })
const emit = defineEmits(['close', 'after-leave'])
const panel = ref(null), layer = ref(props.zIndex), checking = ref(false)
let unregister, previousFocus, version = 0, backdropStarted = false
async function close() {
  if (!props.visible || props.suspended || props.closeDisabled || checking.value) return
  const current = version
  checking.value = true
  try {
    if (props.beforeClose && await props.beforeClose() === false) return
    if (current === version && props.visible && !props.closeDisabled) emit('close')
  } finally { checking.value = false }
}
function afterLeave() {
  if (props.visible) return
  unregister?.(); unregister = null
  if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true })
  previousFocus = null
  emit('after-leave')
}
watch(() => props.visible, async visible => {
  const current = ++version
  if (!visible) return
  previousFocus = document.activeElement
  await nextTick()
  if (current !== version || !panel.value) return
  unregister?.()
  layer.value = nextModalLayer(document, props.zIndex)
  unregister = registerModal({ panel: panel.value, layer: () => layer.value, suspended: () => props.suspended, escape: close })
  panel.value.focus({ preventScroll: true })
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { ++version; unregister?.() })
</script>
