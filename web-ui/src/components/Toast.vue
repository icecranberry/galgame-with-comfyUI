<template>
  <Teleport v-if="ready" to="body">
    <div class="toast-container __toast__root" aria-live="polite" style="z-index: 99999; isolation: isolate;">
      <TransitionGroup name="toast-item">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="toast-card"
          :class="'toast-' + item.type"
          @click="dismiss(item.id)"
        >
          <svg class="toast-icon" viewBox="0 0 24 24" fill="none">
            <!-- error -->
            <template v-if="item.type === 'error'">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/>
              <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </template>
            <!-- warning -->
            <template v-else-if="item.type === 'warning'">
              <path d="M12 2L2 22h20L12 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <line x1="12" y1="10" x2="12" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none"/>
            </template>
            <!-- success -->
            <template v-else-if="item.type === 'success'">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/>
              <path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </template>
            <!-- info -->
            <template v-else>
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/>
              <line x1="12" y1="8" x2="12" y2="13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>
            </template>
          </svg>
          <span class="toast-text">{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue'

let _id = 0
const toasts = ref([])
const ready = ref(false)

function show(message, type = 'info', duration) {
  if (duration === undefined) {
    duration = type === 'error' ? 4500 : 3000
  }
  const id = ++_id
  toasts.value.push({ id, message, type })
  setTimeout(() => dismiss(id), duration)
}

function dismiss(id) {
  const idx = toasts.value.findIndex(t => t.id === id)
  if (idx !== -1) toasts.value.splice(idx, 1)
}

onMounted(() => {
  setTimeout(() => { ready.value = true })
})

defineExpose({ show })
</script>

<style>
.__toast__root {
  z-index: 99999 !important;
  isolation: isolate;
}
</style>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: none;
}

.toast-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.45;
  pointer-events: auto;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
  max-width: min(480px, calc(100vw - 32px));
  word-break: break-word;
}

.toast-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

/* ── type styles ── */
.toast-error {
  background: #fff0f0;
  border: 1px solid #f5c0c0;
  color: #d9363e;
}
.toast-error .toast-icon { color: #d9363e; }

.toast-warning {
  background: #fff8e8;
  border: 1px solid #f0d080;
  color: #b8860b;
}
.toast-warning .toast-icon { color: #b8860b; }

.toast-success {
  background: #f0faf0;
  border: 1px solid #b8d8b8;
  color: #389e0d;
}
.toast-success .toast-icon { color: #389e0d; }

.toast-info {
  background: #faf6f4;
  border: 1px solid #e0d0c8;
  color: var(--text-bright);
}
.toast-info .toast-icon { color: var(--accent); }

/* ── TransitionGroup animations ── */
.toast-item-enter-active {
  transition: all 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.toast-item-leave-active {
  transition: all 0.22s cubic-bezier(0.55, 0.06, 0.68, 0.19);
}
.toast-item-enter-from {
  opacity: 0;
  transform: translateY(-16px) scale(0.96);
}
.toast-item-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .toast-item-enter-active,
  .toast-item-leave-active {
    transition: opacity 0.15s ease;
  }
  .toast-item-enter-from,
  .toast-item-leave-to {
    transform: none;
  }
}
</style>
