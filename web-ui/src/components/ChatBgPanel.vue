<template>
  <div class="chat-bg-panel">
    <div class="cbp-title">聊天背景</div>
    <div class="cbp-preview" :class="{ 'is-default': !currentBg }" :style="currentBg ? { backgroundImage: `url(${currentBg})` } : {}">
      <span v-if="!currentBg" class="cbp-default-hint">默认 · 主题柔光背景</span>
      <span v-else class="cbp-custom-hint">自定义背景</span>
    </div>
    <div class="cbp-actions">
      <button class="cbp-btn" :disabled="busy" @click="pickFile">本地上传</button>
      <button class="cbp-btn" :disabled="busy" @click="showGen = !showGen">{{ showGen ? '收起' : 'AI 生成' }}</button>
      <button v-if="currentBg" class="cbp-btn cbp-btn-quiet" :disabled="busy" @click="resetBg">恢复默认</button>
    </div>
    <input ref="fileEl" type="file" accept="image/*" hidden @change="onFile" />

    <div v-if="showGen" class="cbp-gen">
      <input v-model="genPrompt" class="cbp-gen-input"
        :placeholder="`场景描述，留空则根据「${char?.display_name || '角色'}」的设定想象 TA 的空间`"
        @keydown.enter="doGenerate" />
      <button class="cbp-btn cbp-btn-primary" :disabled="busy" @click="doGenerate">{{ generating ? '生成中…' : '生成' }}</button>
    </div>
    <div v-if="busyText" class="cbp-note">{{ busyText }}</div>

    <Transition name="cbp-fade">
      <div v-if="pendingImage" class="cbp-confirm">
        <img :src="pendingImage" class="cbp-confirm-img" alt="背景预览" />
        <div class="cbp-confirm-actions">
          <button class="cbp-btn cbp-btn-primary" :disabled="busy" @click="confirmPending">使用此图</button>
          <button class="cbp-btn cbp-btn-quiet" :disabled="busy" @click="pendingImage = ''">取消</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import * as api from '../api/index.js'

const props = defineProps({
  character: { type: Object, default: null },
})
const emit = defineEmits(['updated'])

const toast = inject('toast', () => {})

const currentBg = computed(() => props.character?.chat_bg_path || '')
const busy = ref(false)
const busyText = ref('')
const generating = computed(() => busy.value && busyText.value.includes('生成'))
const showGen = ref(false)
const genPrompt = ref('')
const pendingImage = ref('')
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

async function doGenerate() {
  if (!props.character || busy.value) return
  try {
    busy.value = true; busyText.value = '正在生成背景，可能需要几十秒…'
    pendingImage.value = ''
    const r = await api.generateChatBg(props.character.id, genPrompt.value.trim())
    const img = r.images?.[0]
    if (img?.base64 || img?.url) {
      pendingImage.value = img.base64 || img.url
    } else {
      toast('未拿到生成结果，请重试', 'error')
    }
  } catch (err) {
    toast(err.message || '生成失败', 'error')
  } finally {
    busy.value = false; busyText.value = ''
  }
}

async function confirmPending() {
  if (!pendingImage.value) return
  const base64 = pendingImage.value
  pendingImage.value = ''
  await saveBg(base64)
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
  gap: 8px;
}
.cbp-btn {
  padding: 7px 12px;
  border-radius: 9px;
  font-size: 12.5px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: all 0.2s ease;
}
.cbp-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.cbp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cbp-btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.cbp-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  color: #fff;
  border-color: var(--accent-hover);
}
.cbp-btn-quiet { border-color: transparent; color: var(--text-secondary); }
.cbp-gen {
  display: flex;
  gap: 8px;
}
.cbp-gen-input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
}
.cbp-note {
  font-size: 12px;
  color: var(--text-secondary);
}
.cbp-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cbp-confirm-img {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.cbp-confirm-actions {
  display: flex;
  gap: 8px;
}
.cbp-fade-enter-active, .cbp-fade-leave-active { transition: opacity 0.25s ease; }
.cbp-fade-enter-from, .cbp-fade-leave-to { opacity: 0; }
</style>
