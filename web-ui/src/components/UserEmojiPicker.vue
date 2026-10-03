<template>
  <Teleport to="body">
    <div class="ue-overlay" @click.self="$emit('close')">
      <div class="ue-panel">
        <div class="ue-header">
          <span class="ue-title">我的表情</span>
          <linshe-button variant="icon" aria-label="关闭表情面板" @click="$emit('close')">✕</linshe-button>
        </div>

        <div v-if="loading" class="ue-empty">加载中…</div>

        <div v-else-if="!emojis.length" class="ue-empty">
          还没有表情。<br />点下面的「＋ 上传表情」选一张图，起个名字就能用了。
        </div>

        <div v-else class="ue-grid">
          <div
            v-for="e in emojis"
            :key="e.key"
            class="ue-item"
            role="button"
            tabindex="0"
            :title="`插入 [${e.key}]`"
            @click="$emit('pick', e.key)"
            @keydown.enter.prevent="$emit('pick', e.key)"
            @keydown.space.prevent="$emit('pick', e.key)"
          >
            <img :src="e.image_path" :alt="e.key" loading="lazy" />
            <span class="ue-name">{{ e.key }}</span>
            <div
              class="ue-del"
              role="button"
              tabindex="0"
              title="删除这个表情"
              @click.stop="remove(e)"
              @keydown.enter.stop.prevent="remove(e)"
              @keydown.space.stop.prevent="remove(e)"
            >✕</div>
          </div>
        </div>

        <div class="ue-footer">
          <template v-if="pending">
            <linshe-input
              v-model="pendingKey"
              size="sm"
              class="ue-key-input"
              placeholder="表情名字（如 开心）"
              maxlength="24"
              @keyup.enter="confirmUpload"
            />
            <linshe-button variant="primary" size="sm" :disabled="!pendingKey.trim() || uploading" :loading="uploading" @click="confirmUpload">确定</linshe-button>
            <linshe-button variant="ghost" size="sm" :disabled="uploading" @click="cancelUpload">取消</linshe-button>
          </template>
          <template v-else>
            <linshe-button variant="secondary" size="sm" @click="pickFile">＋ 上传表情</linshe-button>
            <span class="ue-hint">选中后会插入到输入框，可以再补文字一起发</span>
          </template>
        </div>

        <input ref="fileEl" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden @change="onFile" />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'

const emit = defineEmits(['close', 'pick'])
const toastFn = inject('toast', null)
const confirmFn = inject('confirm', null)

const emojis = ref([])
const loading = ref(true)
const fileEl = ref(null)
const pending = ref(false)
const pendingKey = ref('')
const pendingBase64 = ref('')
const uploading = ref(false)

function toast(msg, type) {
  if (toastFn) toastFn(msg, type)
}

async function load() {
  loading.value = true
  try {
    const d = await api.listUserEmojis()
    emojis.value = d.emojis || []
  } catch {
    emojis.value = []
  } finally {
    loading.value = false
  }
}

function pickFile() {
  fileEl.value?.click()
}

function onFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''            // 允许连续选同一个文件
  if (!file) return
  if (file.size > 6 * 1024 * 1024) return toast('图片不能超过 6MB', 'error')
  const reader = new FileReader()
  reader.onload = () => {
    pendingBase64.value = String(reader.result || '')
    // 默认用文件名（去扩展名）当名字，省得每次都手打
    pendingKey.value = file.name.replace(/\.[^.]+$/, '').slice(0, 24)
    pending.value = true
  }
  reader.onerror = () => toast('读取图片失败', 'error')
  reader.readAsDataURL(file)
}

function cancelUpload() {
  pending.value = false
  pendingKey.value = ''
  pendingBase64.value = ''
}

async function confirmUpload() {
  const key = pendingKey.value.trim()
  if (!key) return
  uploading.value = true
  try {
    await api.uploadUserEmoji(key, pendingBase64.value)
    cancelUpload()
    await load()
    toast(`已添加表情「${key}」`, 'success')
  } catch (err) {
    toast(err?.message || '上传失败', 'error')
  } finally {
    uploading.value = false
  }
}

async function remove(e) {
  // 删除前确认：按钮常显后容易误触（与 EmojiManagerModal 同一套口径）
  const message = `确定删除表情「${e.key}」吗？删掉后聊天里已发过的 [${e.key}] 标记会变成纯文字。`
  const confirmed = confirmFn
    ? await confirmFn({ title: '删除表情', message, okText: '删除', danger: true })
    : window.confirm(message)
  if (!confirmed) return
  try {
    await api.deleteUserEmoji(e.key)
    emojis.value = emojis.value.filter(x => x.key !== e.key)
    toast(`已删除「${e.key}」`, 'success')
  } catch (err) {
    toast(err?.message || '删除失败', 'error')
  }
}

onMounted(load)
</script>

<style scoped>
.ue-overlay {
  position: fixed; inset: 0; z-index: 1200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  padding: 16px;
  animation: ueFade 0.18s ease;
}
.ue-panel {
  width: 420px;
  max-width: 100%;
  max-height: calc(100dvh - 120px);
  display: flex; flex-direction: column;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  box-shadow: 0 12px 48px rgba(46, 42, 39, 0.18);
  overflow: hidden;
  animation: ueUp 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
}
@keyframes ueFade { from { opacity: 0; } }
@keyframes ueUp { from { opacity: 0; transform: translateY(20px) scale(0.97); } }

.ue-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
  font-size: 14px; font-weight: 600; color: var(--text-bright);
}
.ue-empty {
  padding: 28px 20px; text-align: center;
  font-size: 13px; line-height: 1.7; color: var(--text-secondary);
}
.ue-grid {
  flex: 1; min-height: 0; overflow-y: auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px; padding: 4px 16px 12px;
}
.ue-item {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 6px; border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ue-item:hover { background: var(--bg-hover); }
.ue-item img {
  width: 56px; height: 56px; object-fit: contain;
  border-radius: 8px; background: rgba(0, 0, 0, 0.03);
}
.ue-name {
  max-width: 100%; font-size: 11px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ue-del {
  position: absolute; top: 2px; right: 2px;
  width: 19px; height: 19px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; line-height: 1;
  /* 常显：之前用 opacity:0 + hover 才出现，移动端没有 hover，等于永远看不到这个按钮 */
  background: rgba(0, 0, 0, 0.42); color: #fff;
  opacity: 0.72;
  transition: opacity 0.15s ease, background 0.15s ease, transform 0.15s ease;
  z-index: 1;
}
.ue-item:hover .ue-del { opacity: 1; }
.ue-del:hover { background: rgba(220, 70, 70, 0.95); transform: scale(1.08); }

.ue-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--glass-border);
}
.ue-key-input { flex: 1; min-width: 0; }
.ue-hint { font-size: 11px; color: var(--text-secondary); }
</style>
