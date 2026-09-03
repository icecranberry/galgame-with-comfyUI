<template>
  <div class="letter-write">
    <!-- Recipient context -->
    <div class="write-context">
      <img
        v-if="char.avatar_path"
        :src="char.avatar_path"
        class="write-avatar"
        alt=""
      />
      <span v-else class="write-avatar write-avatar-fallback">{{ (char.display_name || char.name || '?')[0] }}</span>
      <div class="write-context-text">
        <div class="write-to-name">致 {{ char.display_name || char.name }}</div>
        <div class="write-hint">写下你想对 TA 说的话</div>
      </div>
    </div>

    <!-- Letter paper -->
    <div class="paper-frame">
      <div class="paper-bg" :style="{ backgroundImage: `url(${paperUrl})` }"></div>
      <div class="paper-content">
        <textarea
          ref="textareaRef"
          v-model="content"
          class="paper-textarea"
          placeholder="... . . / -.-- --- ..- / - --- -- --- .-. .-. --- .--"
          rows="6"
          :style="{ fontFamily: WRITE_FONT }"
        ></textarea>
      </div>
    </div>

    <!-- Actions -->
    <div class="write-actions">
      <linshe-button variant="secondary" @click="$emit('cancel')">取消</linshe-button>
      <linshe-button variant="primary" :disabled="!content.trim()" :loading="sending" @click="send">
        <svg v-if="!sending" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>
        {{ sending ? '寄送中...' : '寄出' }}
      </linshe-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useMailboxStore } from '../stores/mailbox.js'
import { getWriteFontFamily } from '../composables/useHandwritingFont.js'
import LinsheButton from './ui/LinsheButton.vue'

const WRITE_FONT = getWriteFontFamily()

const props = defineProps({
  char: { type: Object, required: true },
})
const emit = defineEmits(['sent', 'cancel'])

const store = useMailboxStore()
const content = ref('')
const sending = ref(false)
const textareaRef = ref(null)
const paperUrl = '/letter-paper.avif'

async function send() {
  const text = content.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const result = await store.sendLetter(props.char.id, '', text)
    emit('sent', result)
  } catch (err) {
    console.error('[LetterWrite] send error:', err)
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.letter-write {
  display: flex; flex-direction: column;
  padding: 20px 24px; gap: 16px; height: 100%;
}

/* ── Context ── */
.write-context {
  display: flex; align-items: center; gap: 12px;
  padding: 0 4px; flex-shrink: 0;
}
.write-avatar {
  width: 44px; height: 44px; border-radius: 12px; object-fit: cover;
}
.write-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: #fff; font-size: 18px; font-weight: 700;
}
.write-context-text { flex: 1; }
.write-to-name { font-size: 15px; font-weight: 600; color: #3a2a1a; margin-bottom: 2px; }
.write-hint { font-size: 12px; color: #9a8a7a; }

/* ── Paper ── */
.paper-frame {
  flex: 1; position: relative; border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(180,160,140,0.2);
  box-shadow: 0 2px 16px rgba(0,0,0,0.04);
}
.paper-bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
}
.paper-content {
  position: relative; z-index: 1;
  height: 100%; display: flex; flex-direction: column;
  padding: 24px 28px;
}
.paper-textarea {
  flex: 1; width: 98%; resize: none;
  background: rgba(255,255,255,0.55);
  border: none; border-radius: 8px;
  padding: 14px 16px;
  font-size: 18px; line-height: 2;
  color: #3a2a1a;
}
.paper-textarea:focus { outline: none; background: rgba(255,255,255,0.7); }
.paper-textarea::placeholder { color: #baaa9a; }
.paper-footer {
  display: flex; justify-content: flex-end;
  padding-top: 10px;
}
.char-count {
  font-size: 12px; color: #8a7a6a;
  background: rgba(255,255,255,0.5);
  padding: 2px 10px; border-radius: 6px;
}

/* ── Actions ── */
.write-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  flex-shrink: 0; padding: 0 4px;
}
</style>
