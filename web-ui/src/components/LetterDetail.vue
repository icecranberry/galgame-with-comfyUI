<template>
  <div class="letter-detail">
    <!-- Character Context Card -->
    <div class="context-card">
      <img
        v-if="letter.avatar_path"
        :src="letter.avatar_path"
        class="context-avatar"
        alt=""
      />
      <span v-else class="context-avatar context-avatar-fallback">{{ (letter.display_name || '?')[0] }}</span>
      <div class="context-info">
        <div class="context-name">{{ letter.display_name }}</div>
        <div class="context-meta">
          <span class="context-time">📨 {{ letter.direction === 'char_to_user' ? '寄来' : '寄出' }} · {{ timeAgo(letter.created_at) }}</span>
        </div>
      </div>
      <div class="context-status">
        <span v-if="statusClass" class="status-chip" :class="statusClass">
          <span class="chip-dot"></span>
          {{ statusLabel }}
        </span>
      </div>
    </div>

    <!-- Letter Content Card -->
    <div class="letter-content-card">
      <!-- User's outgoing letter -->
      <template v-if="letter.direction === 'user_to_char' && letter.status !== 'completed'">
        <div class="letter-heading">寄出的信</div>
        <div class="letter-body-text">{{ letter.content }}</div>
      </template>

      <!-- Character's reply -->
      <template v-else>
        <div class="letter-heading">回信</div>
        <div class="letter-body-text handwritten" :style="handwritingFontStyle">{{ letter.reply_content }}</div>
      </template>
    </div>

    <!-- Original letter (shown under reply) -->
    <div v-if="letter.direction === 'char_to_user' && letter.content" class="original-card">
      <div class="original-toggle" @click="showOriginal = !showOriginal">
        📨 我的原信
        <span class="toggle-arrow" :class="{ open: showOriginal }">▾</span>
      </div>
      <div v-if="showOriginal" class="original-body">{{ letter.content }}</div>
    </div>

    <!-- Images Card (portrait + illustration) -->
    <div
      v-if="letter.paper_path || letter.portrait_path || letter.illustration_path"
      class="images-card"
    >
      <div class="images-grid">
        <div v-if="letter.portrait_path" class="image-frame portrait-frame">
          <img :src="letter.portrait_path" alt="" />
          <span class="image-caption">提笔瞬间</span>
        </div>
        <div v-if="letter.illustration_path" class="image-frame illustration-frame">
          <img :src="letter.illustration_path" alt="" />
          <span class="image-caption">信中风景</span>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="detail-actions">
      <button class="btn btn-danger" @click="$emit('delete', letter.id)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
        删除信件
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getFontFamily, loadFont, getPageDefaultFontFamily } from '../composables/useHandwritingFont.js'

const props = defineProps({
  letter: { type: Object, required: true },
})
defineEmits(['delete'])

const showOriginal = ref(false)

const handwritingFontStyle = computed(() => {
  const fontId = props.letter?.handwriting_font
  if (!fontId) return { fontFamily: getPageDefaultFontFamily() }
  return { fontFamily: getFontFamily(fontId) }
})

const statusClass = computed(() => {
  if (props.letter.status === 'processing') return 'status-processing'
  if (props.letter.status === 'completed') return 'status-done'
  if (props.letter.status === 'failed') return 'status-failed'
  return ''
})

const statusLabel = computed(() => {
  if (props.letter.status === 'processing') return '正在回信...'
  if (props.letter.status === 'completed') return '已回复'
  if (props.letter.status === 'failed') return '退回'
  return ''
})

function timeAgo(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  if (isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

onMounted(() => {
  const fontId = props.letter?.handwriting_font
  if (fontId) loadFont(fontId)
})
</script>

<style scoped>
.letter-detail {
  padding: 20px 24px 16px;
  display: flex; flex-direction: column; gap: 14px;
  height: 100%; overflow-y: auto;
}

/* ── Context Card ── */
.context-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(var(--accent-rgb),0.08);
  border-radius: 14px;
}
.context-avatar {
  width: 44px; height: 44px; border-radius: 12px; object-fit: cover; flex-shrink: 0;
}
.context-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: #fff; font-size: 18px; font-weight: 700;
}
.context-info { flex: 1; min-width: 0; }
.context-name { font-size: 15px; font-weight: 600; color: #3a2a1a; margin-bottom: 2px; }
.context-meta { font-size: 11px; color: #9a8a7a; }

.status-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 8px; flex-shrink: 0;
}
.chip-dot { width: 5px; height: 5px; border-radius: 50%; }
.status-chip.status-processing { color: #3a7bbf; background: rgba(91,155,213,0.12); }
.status-chip.status-processing .chip-dot { background: #5b9bd5; }
.status-chip.status-done { color: #3d8b40; background: rgba(106,191,105,0.12); }
.status-chip.status-done .chip-dot { background: #6abf69; }
.status-chip.status-failed { color: #c62828; background: rgba(229,115,115,0.12); }
.status-chip.status-failed .chip-dot { background: #e57373; }

/* ── Content Card ── */
.letter-content-card {
  background: rgba(255,255,255,0.7);
  border: 1px solid rgba(var(--accent-rgb),0.08);
  border-radius: 14px;
  padding: 22px 26px;
}
.letter-heading {
  font-size: 12px; font-weight: 600; color: #9a8a7a; text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 14px;
}
.letter-body-text {
  font-size: 15px; line-height: 2; color: #3a2a1a;
  white-space: pre-wrap; word-break: break-word;
}
.letter-body-text.handwritten {
  font-size: 18px; line-height: 2.2;
}

/* ── Original Card ── */
.original-card {
  background: rgba(255,255,255,0.5);
  border: 1px solid rgba(var(--accent-rgb),0.06);
  border-radius: 12px; overflow: hidden;
}
.original-toggle {
  font-size: 12px; font-weight: 600; color: #8a7a6a;
  padding: 10px 16px; cursor: pointer; display: flex; align-items: center; gap: 4px;
  user-select: none;
}
.original-toggle:hover { color: #5a4a3a; }
.toggle-arrow { transition: transform 0.2s; }
.toggle-arrow.open { transform: rotate(180deg); }
.original-body {
  padding: 0 16px 14px;
  font-size: 13px; line-height: 1.7; color: #5a4a3a;
  white-space: pre-wrap; word-break: break-word;
  border-top: 1px solid rgba(var(--accent-rgb),0.06);
  margin-top: 4px; padding-top: 12px;
}

/* ── Images Card ── */
.images-card {
  background: rgba(255,255,255,0.6);
  border: 1px solid rgba(var(--accent-rgb),0.08);
  border-radius: 14px; padding: 16px;
}
.images-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.image-frame {
  border-radius: 10px; overflow: hidden;
  border: 3px solid #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  position: relative;
}
.image-frame img {
  width: 100%; display: block;
}
.portrait-frame img { aspect-ratio: 3/4; object-fit: cover; }
.illustration-frame img { aspect-ratio: 4/3; object-fit: cover; }
.image-caption {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.5));
  color: #fff; font-size: 10px; font-weight: 600;
  padding: 16px 8px 6px; text-align: center;
}

/* ── Actions ── */
.detail-actions {
  display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px;
}
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 0.15s; border: none;
}
.btn-danger {
  background: rgba(244,67,54,0.06); border: 1px solid rgba(244,67,54,0.15);
  color: #c0392b;
}
.btn-danger:hover { background: rgba(244,67,54,0.12); }
</style>
