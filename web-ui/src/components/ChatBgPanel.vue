<template>
  <div class="chat-bg-panel">
    <div class="cbp-title">聊天背景</div>
    <div class="cbp-preview" :class="{ 'is-default': !currentBg }" :style="currentBg ? { backgroundImage: `url(${currentBg})` } : {}">
      <span v-if="!currentBg" class="cbp-default-hint">默认 · 主题柔光背景</span>
      <span v-else class="cbp-custom-hint">自定义背景</span>
    </div>
    <div class="cbp-actions">
      <linshe-button class="cbp-act" variant="secondary" size="sm" :disabled="busy" @click="pickFile">本地上传</linshe-button>
      <linshe-button v-if="currentBg" class="cbp-act" variant="ghost" size="sm" :disabled="busy" @click="resetBg">恢复默认</linshe-button>
    </div>
    <input ref="fileEl" type="file" accept="image/*" hidden @change="onFile" />
    <div v-if="busyText" class="cbp-note">{{ busyText }}</div>
  </div>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'

const props = defineProps({
  character: { type: Object, default: null },
})
const emit = defineEmits(['updated'])

const toast = inject('toast', () => {})

const currentBg = computed(() => props.character?.chat_bg_path || '')
const busy = ref(false)
const busyText = ref('')
const fileEl = ref(null)

function pickFile() { fileEl.value?.click() }

/** 本地图片压缩：最长边 1600px，转 JPEG，控制 base64 体积 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const MAX = 1600
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')) }
    img.src = url
  })
}

async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !props.character) return
  if (!file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return }
  try {
    busy.value = true; busyText.value = '处理图片中…'
    const base64 = await compressImage(file)
    await saveBg(base64)
  } catch (err) {
    toast(err.message || '上传失败', 'error')
  } finally {
    busy.value = false; busyText.value = ''
  }
}

async function saveBg(base64) {
  try {
    busy.value = true; busyText.value = '保存中…'
    const r = await api.uploadChatBg(props.character.id, base64)
    if (r.ok) {
      emit('updated', r.chat_bg_path)
      toast(base64 ? '聊天背景已更新' : '已恢复默认背景')
    } else {
      toast(r.error || '保存失败', 'error')
    }
  } catch (err) {
    toast(err.message || '保存失败', 'error')
  } finally {
    busy.value = false; busyText.value = ''
  }
}

function resetBg() { saveBg('') }
</script>

<style scoped>
.chat-bg-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}
.cbp-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 1px;
}
.cbp-preview {
  height: 92px;
  border-radius: 10px;
  background-size: cover;
  background-position: center;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.cbp-preview.is-default {
  background: var(--bg-tertiary);
}
.cbp-default-hint, .cbp-custom-hint {
  font-size: 11.5px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.72);
  padding: 3px 10px;
  border-radius: 20px;
  backdrop-filter: blur(6px);
}
.cbp-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
}
.cbp-act {
  flex: 1;
  min-width: 0;
}
.cbp-note {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>