// 全局样式体系：token → 基础 → 组件类 → 动效
// （HarmonyOS Sans 已子集化，经 index.html 的 /fonts/fonts-split.css 加载，不再打包全量字体）
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
import App from './App.vue'
import ChatView from './views/ChatView.vue'

// 路由级代码分割：首屏只加载聊天页，其余视图按需拉取
const MomentsView = () => import('./views/MomentsView.vue')
const EventsView = () => import('./views/EventsView.vue')
const ScheduleView = () => import('./views/ScheduleView.vue')
const GalleryView = () => import('./views/GalleryView.vue')
const TavernView = () => import('./views/TavernView.vue')
const MailboxView = () => import('./views/MailboxView.vue')
const SettingsView = () => import('./views/SettingsView.vue')
const MemorySettingsView = () => import('./views/MemorySettingsView.vue')
const MaibotBridgeView = () => import('./views/MaibotBridgeView.vue')
const GroupChatView = () => import('./views/GroupChatView.vue')

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
  { path: '/backpack', component: () => import('./views/BackpackView.vue') },
  { path: '/settings', component: SettingsView },
  { path: '/settings/memory', component: MemorySettingsView },
  { path: '/settings/maibot', component: MaibotBridgeView },
]

const router = createRouter({ history: createWebHashHistory(), routes })
const pinia = createPinia()

const app = createApp(App).use(router).use(pinia)
router.isReady().then(() => app.mount('#app'))
