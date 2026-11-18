<template>
  <div v-if="game.source !== 'official'" ref="root" class="game-card-menu">
    <GameAction ref="trigger" variant="quiet" compact :disabled="disabled" :aria-label="`更多操作：${game.name}`" aria-haspopup="menu" :aria-expanded="open" :aria-controls="menuId" @click="open ? close() : show()" @keydown="onTriggerKeydown">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg>
    </GameAction>
    <Transition name="game-card-menu">
      <div v-show="open" :id="menuId" ref="menu" class="game-card-menu__items" role="menu" :aria-label="`${game.name}的管理操作`" :inert="!open" @keydown="onMenuKeydown">
        <GameAction role="menuitem" tabindex="-1" variant="danger" :disabled="disabled" @click="uninstall">卸载游戏</GameAction>
      </div>
    </Transition>
  </div>
</template>
<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount, useId } from 'vue'
import GameAction from './GameAction.vue'

const props = defineProps({ game: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['uninstall'])
const open = ref(false), root = ref(null), trigger = ref(null), menu = ref(null), menuId = `game-menu-${useId()}`
const items = () => [...(menu.value?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
function close(restoreFocus = false) { open.value = false; if (restoreFocus) trigger.value?.$el.focus({ preventScroll: true }) }
async function show(last = false) {
  if (props.disabled || props.game.source === 'official') return
  open.value = true
  await nextTick()
  if (open.value) (last ? items().at(-1) : items()[0])?.focus({ preventScroll: true })
}
function uninstall() {
  if (props.disabled || props.game.source === 'official') return
  close(true); emit('uninstall')
}
function onTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void show(event.key === 'ArrowUp') }
  else if (event.key === 'Escape' && open.value) { event.preventDefault(); close(true) }
}
function onMenuKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (event.key === 'Tab') { close(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const list = items(), current = list.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus({ preventScroll: true })
}
function onOutside(event) { if (open.value && !root.value?.contains(event.target)) close() }
watch(() => props.disabled, disabled => { if (disabled) close() })
onMounted(() => { document.addEventListener('pointerdown', onOutside); document.addEventListener('focusin', onOutside) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onOutside); document.removeEventListener('focusin', onOutside) })
</script>
<style scoped>
.game-card-menu { position:relative;z-index:5; }
.game-card-menu__items { position:absolute;top:calc(100% + 6px);right:0;width:152px;padding:7px;display:grid;gap:4px;background:var(--game-bg);border:var(--game-control-border,1px) solid var(--game-line);box-shadow:var(--game-control-shadow,5px 5px 0 #090f0d88);transform-origin:top right; }
.game-card-menu-enter-active,.game-card-menu-leave-active { transition:opacity .3s,transform .3s; }
.game-card-menu-enter-from,.game-card-menu-leave-to { opacity:0;transform:translateY(-6px); }
@media(prefers-reduced-motion:reduce) { .game-card-menu-enter-active,.game-card-menu-leave-active { transition:none; } }
</style>
