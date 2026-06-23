<template>
  <!-- API Key 未配置横幅 -->
  <div v-if="!settings.hasApiKey" class="api-key-banner">
    <span class="banner-icon">⚠️</span>
    <span class="banner-text">尚未配置 API Key，请前往设置页面填写 DeepSeek（或其他兼容）API Key</span>
    <router-link to="/settings" class="banner-link">前往设置 →</router-link>
  </div>
  <div class="app-layout" :class="{ 'is-mobile': isMobile }">
    <!-- 移动端遮罩层：Sidebar 拉出时覆盖聊天区域 -->
    <Transition name="scrim-fade">
      <div v-if="isMobile && mobileSidebarOpen" class="mobile-scrim" @click="closeMobileSidebar"></div>
    </Transition>
    <NavBar />
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
import { useRoute } from 'vue-router'
import { useChatStore } from './stores/chat.js'
import { useSettingsStore } from './stores/settings.js'
import { useProactiveStore } from './stores/notifications.js'
import { forceProactive } from './api/index.js'
import { loadUserConfig } from './userConfig.js'
import NavBar from './components/NavBar.vue'
import Sidebar from './components/Sidebar.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const chat = useChatStore()
const settings = useSettingsStore()
const proactive = useProactiveStore()
const route = useRoute()
const confirmDialog = ref(null)

// ── 临时调试：强制主动聊天 ──
const forceLoading = ref(false)
const forceResult = ref('')
async function onForceProactive() {
  if (forceLoading.value) return
  forceLoading.value = true
  forceResult.value = ''
  try {
    const r = await forceProactive()
    if (r.ok) {
      forceResult.value = `${r.character}: ${r.motive} — "${r.greeting}"`
      setTimeout(() => { forceResult.value = '' }, 5000)
    } else {
      forceResult.value = r.error || '失败'
    }
  } catch (e) {
    forceResult.value = e.message || '请求失败'
  } finally {
    forceLoading.value = false
  }
}

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

// ── 主动聊天通知提示音 (Web Audio API, C5-E5 双音) ──
let _audioCtx = null
function playProactiveSound() {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = _audioCtx

    // 第一音 C5 ~523Hz, 100ms
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime)
    gain1.gain.setValueAtTime(0.12, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.1)

    // 第二音 E5 ~659Hz, 100ms, 延迟 0.1s
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1)
    gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.1)
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(ctx.currentTime + 0.1)
    osc2.stop(ctx.currentTime + 0.2)
  } catch {
    // 浏览器不支持 AudioContext 时静默
  }
}

onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)

  settings.loadComfyConfig()
  loadUserConfig()  // 应用启动即加载，不阻塞渲染
  await chat.loadCharacters()

  // 连接主动聊天 SSE 通知流
  proactive.connectSSE()
  proactive.setOnMessage((data) => {
    // 更新聊天 store
    chat.handleProactiveMessage(data)

    // 非当前活跃角色 → 播放提示音
    if (data.character_id !== chat.activeCharId) {
      playProactiveSound()
    }
  })

  if (isMobile.value) {
    // 移动端：角色列表默认藏在屏幕左侧，用户点击按钮才拉出
  } else if (chat.characters.length > 0 && !chat.activeCharId && !route.params.id) {
    // 仅在无路由角色参数时自动选第一个（有路由时 ChatView 会根据路由自行 selectChar）
    chat.selectChar(chat.characters[0].id)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  proactive.disconnectSSE()
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
  min-height: 100vh; min-height: 100dvh;
  font-family: 'HarmonyOS Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  color: var(--text-primary);
  overflow: hidden;
}
html, body { background: var(--bg-primary); }
#app { background: transparent; display: flex; flex-direction: column; }

.app-layout { display: flex; flex: 1; min-height: 0; position: relative; z-index: 1; }
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

/* ── API Key 未配置横幅 ── */
.api-key-banner {
  width: 100%;
  background: #e04444;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 16px;
  font-size: 14px;
  z-index: 1000;
  position: relative;
  flex-shrink: 0;
}
.banner-icon { font-size: 16px; flex-shrink: 0; }
.banner-text { font-weight: 500; }
.banner-link {
  color: #fff;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  white-space: nowrap;
  margin-left: 4px;
  transition: opacity 0.15s;
}
.banner-link:hover { opacity: 0.8; }

/* ── 全局 toggle switch（ChatView / SettingsView 共用）── */
.switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: var(--bg-hover); border-radius: 24px; cursor: pointer; transition: 0.2s; }
.slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: var(--accent); }
.switch input:checked + .slider::before { transform: translateX(20px); }

</style>
