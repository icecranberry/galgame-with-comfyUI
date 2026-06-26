<template>
  <nav class="nav-bar">
    <div class="nav-top">
      <router-link to="/chat" class="nav-item" :class="{ active: $route.path.startsWith('/chat') }" title="聊天">
        <div class="nav-icon-wrap">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span v-if="proactive.unreadCount > 0" class="nav-dot">{{ proactive.unreadCount > 99 ? '99+' : proactive.unreadCount }}</span>
        </div>
        <span class="nav-label">聊天</span>
      </router-link>

      <div class="nav-item" :class="{ active: $route.path.startsWith('/moments') }" title="朋友圈" @click="handleMomentsClick">
        <div class="nav-icon-wrap">
          <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor">
            <path d="M679.17 398.982V126.497s-133.338-71.481-288.989-16.366l288.99 288.851z m25.245 160.303V137.748s157.63 71.434 202.052 244.963L704.415 559.285z m-84.8 122.527l290.99-273.649s51.488 83.709-25.293 273.649H619.614z m-148.586 34.695h393.014S816.6 845.102 646.788 898.195L471.03 716.507z m-128.293-86.811v256.18s102.072 65.365 276.878 21.477L342.736 629.696z m-227.366 13.25l199.075-178.62v406.207c0-0.001-120.272-41.75-199.075-227.587z m-5.045-28.57S64.787 467.442 128.48 339.824h273.81L110.326 614.377z m35.357-303.193s57.603-130.594 214.21-191.87l186.894 191.87H145.682z" />
          </svg>
          <span v-if="moments.newPostCount > 0" class="nav-dot">{{ moments.newPostCount > 99 ? '99+' : moments.newPostCount }}</span>
        </div>
        <span class="nav-label">朋友圈</span>
      </div>

      <router-link to="/gallery" class="nav-item" :class="{ active: $route.path.startsWith('/gallery') }" title="相册">
        <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor">
          <path stroke="currentColor" stroke-width="20" d="M898.8 748.4c-11.9 0-21.5-9.6-21.5-21.5V254.1c0-23.7-19.3-43-43-43H189.7c-23.7 0-43 19.3-43 43v515.7c0 23.7 19.3 43 43 43h537.2c11.9 0 21.5 9.6 21.5 21.5s-9.6 21.5-21.5 21.5H189.7c-47.4 0-86-38.5-86-86V254.1c0-47.4 38.5-86 86-86h644.7c47.4 0 86 38.6 86 86v472.8c0 11.8-9.6 21.4-21.5 21.4z"/>
          <path stroke="currentColor" stroke-width="20" d="M742.1 849.5a21.3 21.3 0 0 1-15.2-6.3L311.5 427.8 139.5 571c-8.9 7.9-22.5 7.1-30.3-1.8-7.9-8.9-7.1-22.4 1.8-30.3l172-150.4c8.5-7.5 21.4-7.2 29.5 0.9l429.8 429.8c8.4 8.4 8.4 22 0 30.4zM914.2 741.9c-4.2 4.3-9.8 6.5-15.4 6.5-5.4 0-10.8-2-15-6.1L657.1 520.8l-121.9 121.9c-8.4 8.4-22 8.4-30.4 0s-8.4-22 0-30.4l137-137c8.3-8.3 21.8-8.4 30.2-0.2l221.8 213.5c8.5 8.3 8.7 21.9 0.4 30.3z"/>
        </svg>
        <span class="nav-label">相册</span>
      </router-link>

      <router-link to="/tavern" class="nav-item" :class="{ active: $route.path.startsWith('/tavern') }" title="酒馆">
        <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor">
          <path d="M924.4 85.5H100.9c-19.3 0-35 15.7-35 35s15.7 35 35 35h59.7v790.2l348.7-179.8 355.3 179.2V155.5h59.7c19.3 0 35-15.7 35-35 0.1-19.4-15.6-35-34.9-35zM794.7 831.4L509 687.3 230.6 830.8V155.5h564.1v675.9z"/>
          <path d="M416.8 489.1h60.8v60.8c0 19.3 15.7 35 35 35s35-15.7 35-35v-60.8h60.8c19.3 0 35-15.7 35-35s-15.7-35-35-35h-60.8v-60.8c0-19.3-15.7-35-35-35s-35 15.7-35 35v60.8h-60.8c-19.3 0-35 15.7-35 35s15.7 35 35 35z"/>
        </svg>
        <span class="nav-label">酒馆</span>
      </router-link>

    </div>

    <div class="nav-bottom">
      <router-link to="/settings" class="nav-item" :class="{ active: $route.path === '/settings' }" title="设置">
        <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor">
          <path d="M416.4 958h191.2V849.7c0-12.7 6.4-25.5 19.1-31.9 31.9-12.7 63.7-31.9 89.2-51 12.7-6.4 25.5-6.4 38.2 0l95.6 57.3 95.6-165.7-95.6-57.3C837 588.5 830.6 575.7 837 563c0-19.1 6.4-31.9 6.4-51s0-31.9-6.4-51c0-12.7 6.4-25.5 12.7-31.9l95.6-57.3-95.6-165.7-95.6 57.3c-12.7 6.4-25.5 6.4-38.2 0-25.5-19.1-57.3-38.2-89.2-51-12.7-12.7-19.1-25.5-19.1-38.2V66H416.4v108.3c0 12.7-6.4 25.5-19.1 31.9-31.9 12.7-63.7 31.9-89.2 51-12.7 6.4-25.5 6.4-38.2 0l-95.6-51-95.6 165.6 95.6 57.3c12.7 6.4 19.1 19.1 12.7 31.9 0 19.1-6.4 31.9-6.4 51s0 31.9 6.4 51c6.4 12.7 0 25.5-12.7 31.9l-95.6 57.3 95.6 165.7 95.6-57.3c12.7-6.4 25.5-6.4 38.2 0 25.5 19.1 57.3 38.2 89.2 51 12.7 6.4 19.1 19.1 19.1 31.9V958z m223 63.7H384.6c-19.1 0-31.9-12.7-31.9-31.9v-121c-25.5-12.7-51-25.5-70.1-38.2l-101.9 63.7c-12.7 6.4-31.9 6.4-44.6-12.7L8.6 658.6c-12.7-19.1-6.4-38.2 12.7-44.6l101.9-63.7v-76.5L21.4 410.1c-19.1-6.4-25.5-25.5-12.7-44.6l127.4-223c6.4-12.7 25.5-19.1 44.6-6.4l101.9 63.7c19.1-12.7 44.6-31.9 70.1-38.2V34.1c0-19.1 12.7-31.9 31.9-31.9h254.9c19.1 0 31.9 12.7 31.9 31.9v121.1c25.5 12.7 51 25.5 70.1 38.2l101.9-63.7c12.7-6.4 31.9-6.4 44.6 12.7l127.4 223c12.7 19.1 6.4 38.2-12.7 44.6l-101.9 63.7v76.5l101.9 63.7c12.7 6.4 19.1 25.5 12.7 44.6L888 881.5c-6.4 12.7-25.5 19.1-44.6 12.7l-101.9-63.7c-19.1 12.7-44.6 31.9-70.1 38.2v121.1c-0.1 19.2-12.8 31.9-32 31.9zM512 703.2c-108.3 0-191.2-82.8-191.2-191.2S403.7 320.8 512 320.8 703.2 403.7 703.2 512 620.3 703.2 512 703.2z m0-318.6c-70.1 0-127.4 57.3-127.4 127.4S441.9 639.4 512 639.4 639.4 582.1 639.4 512 582.1 384.6 512 384.6z"/>
        </svg>
        <span class="nav-label">设置</span>
      </router-link>
    </div>
  </nav>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMomentsStore } from '../stores/moments.js'
import { useProactiveStore } from '../stores/notifications.js'

const router = useRouter()
const route = useRoute()
const moments = useMomentsStore()
const proactive = useProactiveStore()

function handleMomentsClick() {
  if (route.path === '/moments') {
    moments.requestScrollToTop()
  } else {
    router.push('/moments')
  }
}

onMounted(() => {
  moments.connectSSE()
})

onUnmounted(() => {
  moments.disconnectSSE()
})
</script>

<style scoped>
.nav-bar {
  width: 75px;
  min-width: 75px;
  height: 100vh;
  height: 100dvh;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255, 255, 255, 0.25);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  z-index: 10;
  user-select: none;
}

.nav-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.nav-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  border-radius: 12px;
  width: 65px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.28);
  color: var(--text-bright);
}

.nav-item.active {
  background: rgba(224, 123, 108, 0.1);
  color: var(--accent);
}

.nav-label {
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
}

.nav-icon-wrap {
  position: relative;
  display: flex;
}

.nav-dot {
  position: absolute;
  top: -5px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 10px;
  background: var(--danger);
  border: 1.5px solid rgba(255, 255, 255, 0.8);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
  white-space: nowrap;
  animation: jelly-pop 0.45s cubic-bezier(0.17, 0.89, 0.32, 1.35);
}

@keyframes jelly-pop {
  0%   { transform: scale(0); opacity: 0; }
  60%  { transform: scale(1.25); opacity: 1; }
  80%  { transform: scale(0.92); }
  100% { transform: scale(1); opacity: 1; }
}

/* 移动端隐藏 NavBar */
@media (max-width: 767px) {
  .nav-bar {
    display: none;
  }
}
</style>
