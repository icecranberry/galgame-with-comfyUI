<template>
  <Transition name="chat-retry">
    <div v-if="chat.failedTurn && !chat.streaming" class="chat-retry-notice" role="status">
      <span>{{ chat.failedTurn.error }}</span>
      <linshe-button variant="link" size="sm" @click="chat.retryFailedMessage">重试回应</linshe-button>
    </div>
  </Transition>
</template>

<script setup>
import { useChatStore } from '../../stores/chat.js'
import LinsheButton from '../ui/LinsheButton.vue'
const chat = useChatStore()
</script>

<style scoped>
.chat-retry-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 8px 16px; font-size: var(--fs-sm); line-height: 1.5; color: var(--text-secondary); background: var(--bg-secondary); }
.chat-retry-enter-active, .chat-retry-leave-active { transition: opacity 0.3s ease; }
.chat-retry-enter-from, .chat-retry-leave-to { opacity: 0; }
</style>
