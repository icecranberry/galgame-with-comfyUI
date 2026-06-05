import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import ChatView from './views/ChatView.vue'
import SettingsView from './views/SettingsView.vue'

const routes = [
  { path: '/', redirect: '/chat' },
  { path: '/chat', component: ChatView },
  { path: '/chat/:id', component: ChatView },
  { path: '/settings', component: SettingsView },
]

const router = createRouter({ history: createWebHashHistory(), routes })
const pinia = createPinia()

createApp(App).use(router).use(pinia).mount('#app')
