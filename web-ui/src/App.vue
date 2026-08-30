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
    <div class="page-host">
      <router-view v-slot="{ Component }">
        <Transition name="page">
          <component v-if="Component" :is="Component" :key="route.path" />
        </Transition>
      </router-view>
    </div>
  </div>
  <ConfirmDialog ref="confirmDialog" />
  <Toast ref="toastEl" />
  <InstallGuideDialog ref="guideDialog" />
  <ImageEditTaskFloater />

  <!-- 手机端访问提示 Toast -->
  <Transition name="toast-slide">
    <div v-if="mobileToast.visible" class="mobile-toast">
      <span class="toast-text">手机网页访问 <b>{{ mobileToast.url }}</b>打开邻舍</span>
    </div>
  </Transition>
</template>

<script setup>
import { ref, onMounted, onUnmounted, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from './stores/chat.js'
import { useSettingsStore } from './stores/settings.js'
import { useProactiveStore } from './stores/notifications.js'
import { forceProactive } from './api/index.js'
import { loadUserConfig } from './userConfig.js'
import { playNotificationSound } from './utils/sound.js'
import { useMailboxStore } from './stores/mailbox.js'
import NavBar from './components/NavBar.vue'
import Sidebar from './components/Sidebar.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Toast from './components/Toast.vue'
import InstallGuideDialog from './components/InstallGuideDialog.vue'
import ImageEditTaskFloater from './components/ImageEditTaskFloater.vue'
import { MAIBOT_AFTER_START_STEPS, MAIBOT_INSTALL_STEPS, MAIBOT_INTRO_TEXT } from './data/maibotTutorial.js'

const chat = useChatStore()
const settings = useSettingsStore()
const proactive = useProactiveStore()
const mailbox = useMailboxStore()
const route = useRoute()
const confirmDialog = ref(null)
const toastEl = ref(null)
const guideDialog = ref(null)

// ── 手机端访问 Toast（启动器打开时通过 ?mobile_ip= 传入）──
const mobileToast = ref({ visible: false, url: '' })

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
function toast(message, type = 'info', duration) {
  toastEl.value?.show(message, type, duration)
}
function showGuide(opts) {
  return guideDialog.value?.show(opts) ?? Promise.resolve()
}
function showInstallGuide() {
  return showGuide({
    title: 'MaiBot 安装教程',
    intro: MAIBOT_INTRO_TEXT,
    steps: MAIBOT_INSTALL_STEPS,
    afterStartSteps: MAIBOT_AFTER_START_STEPS,
  })
}
provide('confirm', confirm)
provide('toast', toast)
provide('showGuide', showGuide)
provide('showInstallGuide', showInstallGuide)

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

function handleAndroidBack() {
  if (!isMobile.value || mobileSidebarOpen.value) return false
  mobileSidebarOpen.value = true
  return true
}

provide('isMobile', isMobile)
provide('toggleMobileSidebar', toggleMobileSidebar)

onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  window.addEventListener('linshe:notification-opened', closeMobileSidebar)
  window.__linsheHandleAndroidBack = handleAndroidBack

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
      playNotificationSound()
    }
  })

  // 订阅日程延迟回复 SSE 事件
  try {
    const { onEvent } = await import('./stores/unifiedStream.js')
    onEvent('delayed_reply', (data) => {
      chat.handleDelayedReply(data)
      // 非当前活跃角色 → 播放提示音 + 红点（延迟回复也应有通知）
      if (data.character_id !== chat.activeCharId) {
        playNotificationSound()
        proactive.addProactive(data)
      }
    })
  } catch { /* unifiedStream may not be ready */ }

  // 信箱新回信 → 播放提示音
  watch(() => mailbox.unreadCount, (newVal, oldVal) => {
    if (newVal > oldVal) playNotificationSound()
  })

  if (isMobile.value) {
    // 移动端：角色列表默认藏在屏幕左侧，用户点击按钮才拉出
  } else if (chat.characters.length > 0 && !chat.activeCharId && !route.params.id) {
    // 仅在无路由角色参数时自动选第一个（有路由时 ChatView 会根据路由自行 selectChar）
    chat.selectChar(chat.characters[0].id)
  }

  // ── 手机端访问 Toast：启动器通过 ?mobile_ip= 传入本机 IP，底部浮窗 2s ──
  const TOAST_KEY = 'mobile_toast_shown'
  const params = new URLSearchParams(window.location.search)
  const mobileIp = params.get('mobile_ip')
  if (mobileIp && !sessionStorage.getItem(TOAST_KEY)) {
    sessionStorage.setItem(TOAST_KEY, '1')
    mobileToast.value = { visible: true, url: `http://${mobileIp}:3099` }
    setTimeout(() => { mobileToast.value.visible = false }, 5000)
  }
  // 清理 URL 中的 mobile_ip 参数（无论是否弹 toast）
  if (mobileIp) {
    params.delete('mobile_ip')
    const newSearch = params.toString()
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash
    window.history.replaceState(null, '', newUrl)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  window.removeEventListener('linshe:notification-opened', closeMobileSidebar)
  if (window.__linsheHandleAndroidBack === handleAndroidBack) {
    delete window.__linsheHandleAndroidBack
  }
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
  --danger: #e25c5c;

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
.page-host { position: relative; flex: 1; min-width: 0; }
/* Route transition: 0.25s fade between pages */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.25s ease;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.page-enter-from,
.page-leave-to {
  opacity: 0;
}
#app { position: relative; z-index: 1; }

/* 按钮统一使用 LinsheButton 组件（web-ui/src/components/ui/LinsheButton.vue），
   不再提供全局 button 标签样式，避免样式污染。 */

/* 文本输入框统一使用 LinsheInput 组件（web-ui/src/components/ui/LinsheInput.vue）。
   以下全局样式仅作为 select 等未组件化控件及特殊输入界面的兜底，观感与 LinsheInput 保持一致。 */
input, textarea, select {
  background: #fffdfb; border: 1.5px solid #e3dcd2;
  border-radius: 10px; color: var(--text-bright); padding: 8px 12px;
  font-size: 13px; outline: none; caret-color: var(--accent);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
input:focus, textarea:focus, select:focus {
  border-color: var(--accent); background: #fff;
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.14);
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

/* ── 手机端访问 Toast（底部浮窗，2s 自动消失）── */
.mobile-toast {
  position: fixed;
  bottom: 88px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(46, 42, 39, 0.92);
  color: #FCFAF8;
  font-size: 14px;
  padding: 14px 26px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(12px);
  white-space: nowrap;
  pointer-events: none;
}
.mobile-toast b {
  color: #F0A89A;
  font-weight: 600;
}
.toast-icon { font-size: 18px; flex-shrink: 0; }
.toast-text { line-height: 1.4; }

/* Toast 动画：底部滑入 + 淡入 */
.toast-slide-enter-active {
  transition: all 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.toast-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.55, 0.06, 0.68, 0.19);
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

.modal-fade-enter-active { transition: opacity 0.3s ease; }
.modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

</style>
