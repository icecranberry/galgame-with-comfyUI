<template>
  <div class="app-layout" :class="{ 'is-mobile': isMobile }">
    <!-- 移动端遮罩层：Sidebar 拉出时覆盖聊天区域 -->
    <Transition name="scrim-fade">
      <div v-if="isMobile && mobileSidebarOpen" class="mobile-scrim" @click="closeMobileSidebar"></div>
    </Transition>
    <Sidebar
      :is-mobile="isMobile"
      :mobile-open="mobileSidebarOpen"
      @char-selected="closeMobileSidebar"
    />
    <router-view />
  </div>
  <ConfirmDialog ref="confirmDialog" />
</template>

<script setup>
import { ref, onMounted, onUnmounted, provide } from 'vue'
import { useChatStore } from './stores/chat.js'
import { useSettingsStore } from './stores/settings.js'
import Sidebar from './components/Sidebar.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const chat = useChatStore()
const settings = useSettingsStore()
const confirmDialog = ref(null)

function confirm(opts) {
  return confirmDialog.value?.show(opts) ?? Promise.resolve(false)
}
provide('confirm', confirm)

// ══════════════════════════════════════════════════
// 移动端响应式 — Sidebar 抽屉状态
// ══════════════════════════════════════════════════
const MOBILE_MAX = 767
const isMobile = ref(false)
const mobileSidebarOpen = ref(false)

function checkMobile() {
  isMobile.value = window.innerWidth <= MOBILE_MAX
  if (!isMobile.value) mobileSidebarOpen.value = false
}

function toggleMobileSidebar() {
  mobileSidebarOpen.value = !mobileSidebarOpen.value
}

function closeMobileSidebar() {
  mobileSidebarOpen.value = false
}

provide('isMobile', isMobile)
provide('toggleMobileSidebar', toggleMobileSidebar)

onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)

  settings.loadComfyConfig()
  await chat.loadCharacters()

  if (isMobile.value) {
    // 移动端：默认展示角色列表，不自动选中角色
    mobileSidebarOpen.value = true
  } else if (chat.characters.length > 0 && !chat.activeCharId) {
    chat.selectChar(chat.characters[0].id)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

:root {
  --bg-primary: #f0ece8;
  --bg-secondary: #ffffff;
  --bg-tertiary: #ebebeb;
  --bg-hover: #e0e0e0;
  --border: #e0dcd6;
  --text-primary: #333333;
  --text-secondary: #8c8074;
  --text-bright: #111111;
  --accent: #e07b6c;
  --accent-hover: #cc6a5c;
  --accent-light: #f0a89a;
  --success: #52c41a;
  --warning: #faad14;
  --danger: #ff4d4f;

  /* Glassmorphism tokens */
  --glass-bg: rgba(255, 255, 255, 0.6);
  --glass-bg-strong: rgba(255, 255, 255, 0.38);
  --glass-border: rgba(255, 255, 255, 0.28);
  --glass-shadow: 0 2px 16px rgba(0, 0, 0, 0.03);
  --glass-blur: blur(18px);
}

html, body, #app {
  height: 100%;
  /* 100dvh 随 Chrome 地址栏显隐动态调整，100vh 作为旧浏览器兜底 */
  min-height: 100vh; min-height: 100dvh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  color: var(--text-primary);
  overflow: hidden;
}
html, body { background: var(--bg-primary); }
#app { background: transparent; }

.app-layout { display: flex; height: 100vh; height: 100dvh; position: relative; z-index: 1; }
#app { position: relative; z-index: 1; }

button {
  cursor: pointer; border: none; border-radius: 8px;
  padding: 7px 14px; font-size: 13px; font-weight: 500;
  transition: all 0.2s ease;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); box-shadow: 0 2px 12px rgba(224, 123, 108, 0.25); }
.btn-ghost {
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(12px);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-bright); }

input, textarea, select {
  background: rgba(255, 255, 255, 0.9); border: 1px solid #d5d0ca;
  border-radius: 8px; color: var(--text-bright); padding: 8px 12px;
  font-size: 13px; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
input:focus, textarea:focus, select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12);
}
textarea { resize: vertical; font-family: inherit; }

::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #d0d0d0; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #b0b0b0; }

/* ── 移动端 Sidebar 遮罩 ── */
.mobile-scrim {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 99;
}
.scrim-fade-enter-active { transition: opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.scrim-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.scrim-fade-enter-from,
.scrim-fade-leave-to { opacity: 0; }
</style>
