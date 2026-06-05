<template>
  <div class="app-layout">
    <Sidebar />
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useChatStore } from './stores/chat.js'
import { useCharacterStore } from './stores/character.js'
import Sidebar from './components/Sidebar.vue'

const chat = useChatStore()
const chars = useCharacterStore()

onMounted(async () => {
  await Promise.all([
    chat.loadConversations(),
    chars.loadCharacters(),
  ])
  if (chars.characters.length > 0 && !chat.currentCharId) {
    chat.currentCharId = chars.characters[0].id
  }
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-primary: #1a1b1e;
  --bg-secondary: #25262b;
  --bg-tertiary: #2c2e33;
  --bg-hover: #373a40;
  --border: #373a40;
  --text-primary: #c1c2c5;
  --text-secondary: #909296;
  --text-bright: #e4e5e6;
  --accent: #7c3aed;
  --accent-hover: #6d28d9;
  --accent-light: #8b5cf6;
  --success: #34d399;
  --warning: #fbbf24;
  --danger: #f87171;
  --user-bubble: #2d3748;
  --ai-bubble: #1a1b2e;
  --sidebar-width: 280px;
}

html, body, #app {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

.app-layout {
  display: flex;
  height: 100vh;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

button {
  cursor: pointer;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: white;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.btn-danger {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
}
.btn-danger:hover:not(:disabled) { background: var(--danger); color: white; }

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  padding: 4px 8px;
}
.btn-ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-bright);
}

input, textarea, select {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-bright);
  padding: 10px 14px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus {
  border-color: var(--accent);
}

textarea { resize: vertical; font-family: inherit; }

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bg-hover); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }

a { color: var(--accent-light); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
