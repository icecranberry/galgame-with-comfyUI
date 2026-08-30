// HarmonyOS Sans — 全局字体
import './assets/fonts/fonts.css'
// 全局样式体系：token → 基础 → 组件类 → 动效
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/animations.css'
import { initTheme } from './theme.js'

// 挂载前同步应用本地主题，避免首帧闪烁
initTheme()

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import MemorySettingsView from './views/MemorySettingsView.vue'
import MaibotBridgeView from './views/MaibotBridgeView.vue'
import App from './App.vue'
import ChatView from './views/ChatView.vue'
import SettingsView from './views/SettingsView.vue'
import MomentsView from './views/MomentsView.vue'
import GalleryView from './views/GalleryView.vue'
import TavernView from './views/TavernView.vue'
import EventsView from './views/EventsView.vue'
import ScheduleView from './views/ScheduleView.vue'
import MailboxView from './views/MailboxView.vue'
import GroupChatView from './views/GroupChatView.vue'

const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/chat', component: ChatView },
  { path: '/chat/:id', component: ChatView },
  { path: '/group/:id', component: GroupChatView },
  { path: '/moments', component: MomentsView },
  { path: '/events', component: EventsView },
  { path: '/schedule', component: ScheduleView },
  { path: '/gallery', component: GalleryView },
  { path: '/tavern', component: TavernView },
  { path: '/mailbox', component: MailboxView },
  { path: '/settings', component: SettingsView },
  { path: '/settings/memory', component: MemorySettingsView },
  { path: '/settings/maibot', component: MaibotBridgeView },
]

const router = createRouter({ history: createWebHashHistory(), routes })
const pinia = createPinia()

const app = createApp(App).use(router).use(pinia)
router.isReady().then(() => app.mount('#app'))
