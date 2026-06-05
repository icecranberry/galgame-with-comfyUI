<template>
  <div class="app-layout">
    <Sidebar />
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useChatStore } from './stores/chat.js'
import Sidebar from './components/Sidebar.vue'

const chat = useChatStore()
onMounted(async () => {
  await chat.loadCharacters()
  if (chat.characters.length > 0 && !chat.activeCharId) {
    chat.selectChar(chat.characters[0].id)
  }
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-primary: #f5f5f5;
  --bg-secondary: #ffffff;
  --bg-tertiary: #ebebeb;
  --bg-hover: #e0e0e0;
  --border: #e0e0e0;
  --text-primary: #333333;
  --text-secondary: #999999;
  --text-bright: #111111;
  --accent: #5b8def;
  --accent-hover: #4a7de0;
  --accent-light: #7ba5f5;
  --success: #52c41a;
  --warning: #faad14;
  --danger: #ff4d4f;
}

html, body, #app {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

.app-layout { display: flex; height: 100vh; }

button {
  cursor: pointer; border: none; border-radius: 6px;
  padding: 7px 14px; font-size: 13px; font-weight: 500; transition: all 0.15s;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-bright); }

input, textarea, select {
  background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text-bright); padding: 8px 12px;
  font-size: 13px; outline: none; transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus { border-color: var(--accent); }
textarea { resize: vertical; font-family: inherit; }

::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #d0d0d0; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #b0b0b0; }
</style>
