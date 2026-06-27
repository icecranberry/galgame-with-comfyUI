// HarmonyOS Sans — 全局字体
import './assets/fonts/fonts.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import ChatView from './views/ChatView.vue'
import SettingsView from './views/SettingsView.vue'
import MomentsView from './views/MomentsView.vue'
import GalleryView from './views/GalleryView.vue'
import TavernView from './views/TavernView.vue'
import EventsView from './views/EventsView.vue'

const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/chat', component: ChatView },
  { path: '/chat/:id', component: ChatView },
  { path: '/moments', component: MomentsView },
  { path: '/events', component: EventsView },
  { path: '/gallery', component: GalleryView },
  { path: '/tavern', component: TavernView },
  { path: '/settings', component: SettingsView },
]

const router = createRouter({ history: createWebHashHistory(), routes })
const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
