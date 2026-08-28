<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="modal-overlay">
        <div class="modal-panel modal-wide emoji-manager-modal">
          <div class="modal-header">
            <h3>表情包管理</h3>
            <button class="modal-close" @click="close"></button>
          </div>

          <div class="emoji-body">
            <!-- 生成 prompt 时的全局扫描遮罩 -->
            <div v-if="starting" class="emoji-gen-overlay">
              <div class="emoji-gen-line"></div>
              <div class="emoji-gen-glow"></div>
              <div class="emoji-gen-content">
                <div class="emoji-gen-label">表情脚本生成中</div>
                <div class="emoji-gen-phrase">
                  <Transition name="emoji-gen-phrase" mode="out-in">
                    <p :key="scanTipIndex">{{ scanTips[scanTipIndex] }}</p>
                  </Transition>
                </div>
              </div>
            </div>
            <!-- 左侧：角色头像列表（单选） -->
            <div class="emoji-left">
              <div class="emoji-left-title">角色列表</div>
              <div class="emoji-char-list">
                <div
                  v-for="c in characters"
                  :key="c.id"
                  class="emoji-char-item"
                  :class="{ active: selectedCharId === c.id }"
                  @click="selectedCharId = c.id"
                >
                  <div
                    class="emoji-char-avatar"
                    :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : {}"
                  >{{ c.avatar_path ? '' : (c.display_name || c.name || '?').charAt(0) }}</div>
                   <div class="emoji-char-meta">
                     <div class="emoji-char-name">{{ c.display_name || c.name }}</div>
                     <div class="emoji-char-count">
                       <span v-if="charGenerating(c.id)" class="emoji-spinner"></span>
                       <span>{{ doneCount(c.id) }}/{{ emojiKeys.length }}</span>
                     </div>
                  </div>
                </div>
              </div>
              <button
                class="emoji-batch-btn"
                :disabled="batchRunning || generating || characters.length === 0"
                @click="openBatchDialog"
              >
                {{ batchRunning ? `生成中 ${batchIndex + 1}/${characters.length}` : '全部生成' }}
              </button>
            </div>

            <!-- 右侧：生成控制 + 表情包网格 -->
            <div class="emoji-right">
              <div class="emoji-toolbar-row">
                <button class="emoji-gear" title="高级设置" @click="showAdvancedSettings = true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <span
                  class="emoji-mode-badge"
                  :class="styleMode"
                  title="当前表情包风格，可在高级设置中切换"
                >{{ styleMode === 'half_body' ? '半身' : '猪鼻大头' }}</span>
                <input
                  v-model="style"
                  class="fi emoji-style-input"
                  type="text"
                  placeholder="自定义表情包整体风格（可选，留空则不注入）"
                />
                <button
                  class="btn-primary"
                  :disabled="generating || selectedCharId === null"
                  @click="generateAll"
                >
                  {{ generating ? '生成中...' : '生成表情包' }}
                </button>
              </div>

              <div v-if="batchRunning" class="emoji-progress-strip">
                <span class="emoji-spinner"></span>
                <span class="emoji-progress-label">正在为「{{ batchCurrentName }}」提炼表情脚本（{{ batchIndex + 1 }}/{{ characters.length }}）</span>
              </div>
              <div v-if="imageProgressVisible" class="emoji-progress-strip">
                <span class="emoji-spinner"></span>
                <span class="emoji-progress-label">{{ imageProgressText }}</span>
              </div>
              <div v-if="selectedCharId === null" class="emoji-empty">
                请在左侧选择要管理表情包的角色
              </div>

              <div v-if="selectedCharId !== null && emojiKeys.length > 0" class="emoji-char-section">
                <div class="emoji-char-title">{{ charName(selectedCharId) }}</div>
                <TransitionGroup name="emoji-reveal" tag="div" class="emoji-grid">
                  <div
                    v-for="key in emojiKeys"
                    :key="key"
                    class="emoji-card"
                    :class="{ done: isDone(selectedCharId, key), empty: !rowFor(selectedCharId, key), generating: isGenerating(selectedCharId, key), failed: isFailed(selectedCharId, key) }"
                  >
                    <div class="emoji-card-head">
                      <span class="emoji-key">{{ key }}</span>
                      <span class="emoji-status">
                        <span v-if="isGenerating(selectedCharId, key)">...</span>
                        <span v-else-if="isFailed(selectedCharId, key)">!</span>
                      </span>
                    </div>

                    <button
                      v-if="isDone(selectedCharId, key)"
                      class="emoji-card-delete"
                      type="button"
                      :title="deletingKey === selectedCharId + ':' + key ? '删除中...' : '删除'"
                      :disabled="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || deletingKey === selectedCharId + ':' + key"
                      @click.stop="removeEmoji(selectedCharId, key)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </button>

                    <template v-if="rowFor(selectedCharId, key)">
                      <div class="emoji-image-wrap">
                        <img v-if="isDone(selectedCharId, key) && rowImage(selectedCharId, key)" :src="rowImage(selectedCharId, key)" class="emoji-image" />
                        <div v-else class="emoji-image-placeholder">+</div>
                      </div>
                      <div class="emoji-card-actions">
                        <button
                          class="btn-ghost btn-sm"
                          :disabled="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || isGenerating(selectedCharId, key)"
                          @click="openUpload(selectedCharId, key)"
                        >上传</button>
                        <button
                          class="btn-ghost btn-sm"
                          :disabled="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key || isGenerating(selectedCharId, key)"
                          @click="generateOneImage(selectedCharId, key)"
                        >重新生成</button>
                      </div>
                      <div v-if="rowError(selectedCharId, key)" class="emoji-error">{{ rowError(selectedCharId, key) }}</div>
                    </template>

                    <template v-else>
                      <div class="emoji-empty-slot" @click="openUpload(selectedCharId, key)">
                        <span v-if="isGenerating(selectedCharId, key)" class="emoji-spinner"></span>
                        <span v-else class="emoji-empty-plus">+</span>
                      </div>
                      <div v-if="rowError(selectedCharId, key)" class="emoji-error">{{ rowError(selectedCharId, key) }}</div>
                    </template>

                    <div v-if="busyKey === selectedCharId + ':' + key || uploadingKey === selectedCharId + ':' + key" class="emoji-scan-overlay">
                      <span class="emoji-spinner"></span>
                    </div>
                  </div>
                </TransitionGroup>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 高级设置弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showAdvancedSettings" class="modal-overlay advanced-overlay">
        <div class="modal-panel advanced-panel">
          <div class="modal-header">
            <h3>高级设置</h3>
            <button class="modal-close" @click="showAdvancedSettings = false"></button>
          </div>

          <div class="advanced-body">
            <div class="advanced-section">
              <div class="advanced-label">画师串</div>
              <input v-model="artist" class="fi advanced-artist-input" type="text" placeholder="@ebora" />
              <div class="advanced-hint">生成表情包时固定使用该画师串，不再沿用对话画师串。</div>
            </div>

            <div class="advanced-section">
              <div class="advanced-label">表情类别</div>
              <div class="advanced-cat-list">
                <div v-for="(k, i) in categoryDrafts" :key="i" class="advanced-cat-row">
                  <span class="advanced-cat-index">{{ i + 1 }}</span>
                  <input v-model="categoryDrafts[i]" class="fi advanced-cat-input" type="text" />
                </div>
                </div>
              <div v-if="categoryError" class="emoji-error">{{ categoryError }}</div>
            </div>

            <div class="advanced-section">
              <div class="advanced-label">表情包风格</div>
              <div class="emoji-style-segmented">
                <button type="button" :class="['emoji-style-chip', { active: styleMode === 'half_body' }]" @click="styleMode = 'half_body'">半身</button>
                <button type="button" :class="['emoji-style-chip', { active: styleMode === 'chibi_head' }]" @click="styleMode = 'chibi_head'">猪鼻大头</button>
              </div>
              <div class="advanced-hint">{{ styleModeHint }}</div>
            </div>

            <div class="advanced-section">
              <div class="advanced-label">表情包起手式Tag</div>
              <textarea
                v-model="fixedTagsDraft"
                class="fi advanced-tags-input"
                rows="3"
                placeholder="chibi character, big head, ...（逗号分隔）"
              ></textarea>
              <div class="advanced-hint">生成 prompt 后由系统硬编码前置到每条表情 prompt 开头（英文，逗号分隔，已存在的 tag 自动去重）。</div>
              <div v-if="fixedTagsError" class="emoji-error">{{ fixedTagsError }}</div>
            </div>
          </div>

          <div class="advanced-footer">
            <button class="btn-ghost" @click="showAdvancedSettings = false">取消</button>
            <button class="btn-primary" :disabled="categorySaving" @click="saveAdvancedSettings">保存</button>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 全部生成弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showBatchDialog" class="modal-overlay advanced-overlay">
        <div class="modal-panel batch-panel">
          <div class="modal-header">
            <h3>全部生成</h3>
            <button class="modal-close" @click="showBatchDialog = false"></button>
          </div>

          <div class="advanced-body">
            <div class="advanced-section">
              <div class="advanced-label">自定义整体风格</div>
              <input
                v-model="batchStyle"
                class="fi advanced-artist-input"
                type="text"
                placeholder="可选，留空则不注入整体风格"
                @keyup.enter="startBatchGenerate"
              />
              <div class="advanced-hint">将按角色列表顺序，为全部 {{ characters.length }} 个角色逐个生成表情包。</div>
            </div>
          </div>

          <div class="advanced-footer">
            <button class="btn-ghost" @click="showBatchDialog = false">取消</button>
            <button class="btn-primary" @click="startBatchGenerate">开始生成</button>
          </div>
        </div>
      </div>
    </Transition>
    <input ref="uploadInputRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden @change="onUploadFileChange" />
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import * as api from '../api/index.js'

const props = defineProps({
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const toast = inject('toast')
const confirmFn = inject('confirm', null)
const show = ref(true)
const selectedCharId = ref(null)
const style = ref('')
const artist = ref('@ebora')
const emojiRows = ref([])
const emojiKeys = ref([])
const starting = ref(false)
const busyKey = ref('')
const pendingUpload = ref(null)
const uploadingKey = ref('')
const deletingKey = ref('')
const uploadInputRef = ref(null)
const showAdvancedSettings = ref(false)
const categoryDrafts = ref([])
const categorySaving = ref(false)
const categoryError = ref('')
const fixedTagsDraft = ref('')
const fixedTagsError = ref('')
const styleMode = ref('chibi_head')
const styleModeHint = computed(() => styleMode.value === 'half_body'
  ? '起手式 tag 将额外追加 half body。'
  : '按 chibi character, big head 风格生成表情包，并禁止模型添加角色服装描述。')
const showBatchDialog = ref(false)
const batchStyle = ref('')
const batchRunning = ref(false)
const batchIndex = ref(0)
let pollTimer = null
const scanTipIndex = ref(0)
let scanTipTimer = null

function close() {
  show.value = false
  batchRunning.value = false
  stopPolling()
  setTimeout(() => emit('close'), 180)
}

function charName(id) {
  return props.characters.find(c => c.id === id)?.display_name || `角色 #${id}`
}

function rowFor(charId, key) {
  return emojiRows.value.find(r => r.character_id === charId && r.emoji_key === key)
}

function isDone(charId, key) {
  const row = rowFor(charId, key)
  return row?.status === 'done' && !!row?.image_path
}
function isGenerating(charId, key) {
  return rowFor(charId, key)?.status === 'generating'
}
function isFailed(charId, key) {
  return rowFor(charId, key)?.status === 'failed'
}
function rowImage(charId, key) {
  return rowFor(charId, key)?.image_path || ''
}
function rowError(charId, key) {
  return rowFor(charId, key)?.error_message || ''
}
function doneCount(charId) {
  return emojiRows.value.filter(r => r.character_id === charId && r.status === 'done' && r.image_path).length
}
function charGenerating(charId) {
  if (starting.value && selectedCharId.value === charId) return true
  if (uploadingKey.value.startsWith(charId + ':')) return true
  return busyKey.value.startsWith(charId + ':') || emojiRows.value.some(r => r.character_id === charId && r.status === 'generating')
}

const generatingRowsCount = computed(() => emojiRows.value.filter(r => r.status === 'generating').length)
const selectedGeneratingCount = computed(() => emojiRows.value.filter(r => r.character_id === selectedCharId.value && r.status === 'generating').length)
const generating = computed(() => starting.value || busyKey.value !== '' || uploadingKey.value !== '' || deletingKey.value !== '' || generatingRowsCount.value > 0 || batchRunning.value)
const imageProgressVisible = computed(() => !starting.value && !batchRunning.value && (busyKey.value !== '' || generatingRowsCount.value > 0))
const batchCurrentName = computed(() => {
  const c = props.characters[batchIndex.value]
  return c?.display_name || c?.name || ''
})
const imageProgressText = computed(() => {
  if (busyKey.value) return `正在重新生成「${busyKey.value.split(':')[1]}」...`
  const gen = selectedGeneratingCount.value
  if (gen > 0) {
    const done = doneCount(selectedCharId.value)
    return done > 0 ? `已生成 ${done} 张 · 还有 ${gen} 张仍在生成中` : `正在生成 ${gen} 张表情包...`
  }
  if (generatingRowsCount.value > 0) return `其他角色还有 ${generatingRowsCount.value} 张表情包正在生成中`
  return ''
})
const scanTips = [
  '正在为角色提炼表情脚本…',
  '正在翻阅角色档案与外观特征…',
  '正在推敲每个表情的镜头语言…',
  '正在校准 Q 版比例和线条…',
  '正在检查白色背景与留白…',
  '正在给表情加入一点小情绪…',
  '正在整理角色辨识度细节…',
  '正在把灵感写进提示词…',
]

async function loadOverview() {
  try {
    const d = await api.getEmojiOverview()
    emojiRows.value = d.emojis || []
    if (selectedCharId.value === null && d.characters?.length) {
      selectedCharId.value = d.characters[0].id
    }
  } catch (err) {
    toast?.('加载表情包数据失败: ' + err.message, 'error')
  }
}

async function loadCategories() {
  try {
    const d = await api.getEmojiCategories()
    emojiKeys.value = d.keys || []
    categoryDrafts.value = [...emojiKeys.value]
  } catch (err) {
    emojiKeys.value = []
    categoryDrafts.value = []
    toast?.('加载表情类别失败: ' + err.message, 'error')
  }
  try {
    const t = await api.getEmojiFixedTags()
    fixedTagsDraft.value = t.tags || ''
    styleMode.value = t.styleMode === 'half_body' ? 'half_body' : 'chibi_head'
  } catch {
    fixedTagsDraft.value = ''
  }
}

/** 一键生成：先创造 prompt，再立即提交 ComfyUI 生成图片 */
async function generateAll() {
  if (selectedCharId.value === null || generating.value) return
  starting.value = true
  try {
    await api.generateEmojiPrompts([selectedCharId.value], style.value.trim())
    await api.generateEmojiImages([selectedCharId.value], [], artist.value)
    await loadOverview()
    if (generatingRowsCount.value > 0) startPolling()
    toast?.('表情包已开始生成', 'success')
  } catch (err) {
    toast?.('生成表情包失败: ' + err.message, 'error')
  } finally {
    starting.value = false
  }
}

function openBatchDialog() {
  if (generating.value || props.characters.length === 0) return
  batchStyle.value = style.value
  showBatchDialog.value = true
}

/** 全部生成：按角色列表顺序逐个生成 prompt 并提交图片任务，关闭弹窗可中止剩余角色 */
async function startBatchGenerate() {
  if (batchRunning.value || generating.value) return
  const chars = [...props.characters]
  if (chars.length === 0) return
  showBatchDialog.value = false
  batchRunning.value = true
  const styleText = batchStyle.value.trim()
  let okCount = 0
  try {
    for (let i = 0; i < chars.length; i++) {
      if (!batchRunning.value) return
      batchIndex.value = i
      const c = chars[i]
      const name = c.display_name || c.name || `角色 #${c.id}`
      try {
        const p = await api.generateEmojiPrompts([c.id], styleText)
        if (p?.error) throw new Error(p.error)
        const g = await api.generateEmojiImages([c.id], [], artist.value)
        if (g?.error) throw new Error(g.error)
        okCount++
      } catch (err) {
        toast?.(`「${name}」生成失败: ${err.message}`, 'error')
      }
      await loadOverview()
      if (emojiRows.value.some(r => r.status === 'generating')) startPolling()
    }
    if (batchRunning.value && okCount > 0) {
      toast?.(`已为 ${okCount}/${chars.length} 个角色提交表情包生成`, 'success')
    }
  } finally {
    batchRunning.value = false
  }
}

async function generateOneImage(charId, key) {
  if (batchRunning.value) return
  const row = rowFor(charId, key)
  if (!row?.prompt) {
    toast?.('请先生成 prompt', 'info')
    return
  }
  busyKey.value = charId + ':' + key
  try {
    const d = await api.regenerateEmojiImage(charId, key, artist.value)
    if (d.error) throw new Error(d.error)
    if (d.ok) toast?.(`「${key}」图片已生成`, 'success')
    else toast?.(d.error || '生成失败', 'error')
    await loadOverview()
  } catch (err) {
    toast?.('生成失败: ' + err.message, 'error')
  } finally {
    busyKey.value = ''
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function openUpload(charId, key) {
  if (batchRunning.value || starting.value || busyKey.value || uploadingKey.value || isGenerating(charId, key)) return
  pendingUpload.value = { charId, key }
  uploadInputRef.value?.click()
}

async function onUploadFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  const target = pendingUpload.value
  pendingUpload.value = null
  if (!file || !target) return
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type)) {
    toast?.('请选择 PNG / JPG / WEBP / GIF / BMP 图片', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    toast?.('图片不能超过 6MB', 'error')
    return
  }
  let base64
  try {
    base64 = await readFileAsDataURL(file)
  } catch (err) {
    toast?.('读取图片失败: ' + err.message, 'error')
    return
  }
  const keyId = target.charId + ':' + target.key
  uploadingKey.value = keyId
  try {
    const d = await api.uploadEmojiImage(target.charId, target.key, base64)
    if (d.error) throw new Error(d.error)
    toast?.(`「${target.key}」图片已上传`, 'success')
    await loadOverview()
  } catch (err) {
    toast?.('上传失败: ' + err.message, 'error')
  } finally {
    uploadingKey.value = ''
  }
}

async function removeEmoji(charId, key) {
  const keyId = charId + ':' + key
  if (batchRunning.value || deletingKey.value || busyKey.value || uploadingKey.value) return
  const confirmed = confirmFn
    ? await confirmFn({ title: '清空表情图片', message: `确定清空「${key}」的图片吗？`, okText: '清空', danger: true })
    : window.confirm(`确定清空「${key}」的图片吗？`)
  if (!confirmed) return
  deletingKey.value = keyId
  try {
    const d = await api.deleteEmoji(charId, key)
    if (d.error) throw new Error(d.error)
    await loadOverview()
    toast?.(`「${key}」图片已清空`, 'success')
  } catch (err) {
    toast?.('删除失败: ' + err.message, 'error')
  } finally {
    deletingKey.value = ''
  }
}

async function saveAdvancedSettings() {
  const keys = categoryDrafts.value.map(k => String(k || '').trim())
  const tagsText = String(fixedTagsDraft.value || '').trim()
  categoryError.value = ''
  fixedTagsError.value = ''
  if (keys.length !== 15 || keys.some(k => !k)) {
    categoryError.value = '表情类别固定为 15 个，且名称不能为空'
    return
  }
  if (!tagsText) {
    fixedTagsError.value = '固定 tag 不能为空'
    return
  }
  categorySaving.value = true
  try {
    const d = await api.updateEmojiCategories(keys)
    if (d.error) throw new Error(d.error)
    emojiKeys.value = d.keys || []
    categoryDrafts.value = [...emojiKeys.value]
    const t = await api.updateEmojiFixedTags(tagsText, styleMode.value)
    if (t.error) throw new Error(t.error)
    fixedTagsDraft.value = t.tags || tagsText
    if (t.styleMode) styleMode.value = t.styleMode
    showAdvancedSettings.value = false
    toast?.('高级设置已保存', 'success')
  } catch (err) {
    categoryError.value = err.message
    toast?.('保存失败: ' + err.message, 'error')
  } finally {
    categorySaving.value = false
  }
}

function startScanTips() {
  if (scanTipTimer) return
  scanTipIndex.value = 0
  let idx = 0
  scanTipTimer = setInterval(() => {
    idx = (idx + 1) % scanTips.length
    scanTipIndex.value = idx
  }, 2200)
}

function stopScanTips() {
  if (scanTipTimer) {
    clearInterval(scanTipTimer)
    scanTipTimer = null
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    await loadOverview()
    if (generatingRowsCount.value === 0) stopPolling()
  }, 2500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(starting, (active) => {
  if (active) startScanTips()
  else stopScanTips()
}, { immediate: true })

onMounted(async () => {
  if (props.characters.length > 0) selectedCharId.value = props.characters[0].id
  loadCategories()
  await loadOverview()
  if (generatingRowsCount.value > 0) startPolling()
})

onBeforeUnmount(() => {
  batchRunning.value = false
  stopPolling()
  stopScanTips()
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
}
.modal-panel {
  background: #f4f1eeed; border-radius: 18px;
  width: min(880px, 96vw); max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal-wide { width: min(1100px, 97vw); }
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}
.modal-header h3 { font-size: 17px; font-weight: 600; color: var(--text-bright); }
.modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: var(--glass-bg-strong);
  color: var(--text-secondary); font-size: 15px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-bright); }
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel { animation: emoji-modal-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
@keyframes emoji-modal-pop {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.emoji-manager-modal {
  width: min(1180px, 94vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.emoji-body {
  flex: 1;
  position: relative;
  display: flex;
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: hidden;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  margin: 0 20px 20px;
}

/* ── 生成 prompt 时全局扫描遮罩（招募同款）── */
.emoji-gen-overlay {
  position: absolute; inset: 0; z-index: 20;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.emoji-gen-line {
  position: absolute; left: 12%; right: 12%; height: 2px;
  background: linear-gradient(90deg, transparent, rgba(224,123,108,0.3), var(--accent), rgba(224,123,108,0.3), transparent);
  animation: emoji-gen-sweep 2.2s ease-in-out infinite;
  box-shadow: 0 0 26px rgba(224,123,108,0.55), 0 0 8px rgba(224,123,108,0.25);
  z-index: 2; pointer-events: none;
}
@keyframes emoji-gen-sweep {
  0%   { top: 8%; opacity: 0.15; }
  25%  { top: 92%; opacity: 1; }
  50%  { top: 92%; opacity: 0.15; }
  75%  { top: 8%; opacity: 1; }
  100% { top: 8%; opacity: 0.15; }
}
.emoji-gen-glow {
  position: absolute; left: 20%; right: 20%; height: 70px;
  background: radial-gradient(ellipse at center, rgba(224,123,108,0.13) 0%, rgba(224,123,108,0.04) 40%, transparent 70%);
  animation: emoji-gen-glow-follow 2.2s ease-in-out infinite;
  z-index: 1; pointer-events: none; filter: blur(8px);
}
@keyframes emoji-gen-glow-follow {
  0%   { top: 6%; opacity: 0.2; }
  25%  { top: 72%; opacity: 0.9; }
  50%  { top: 72%; opacity: 0.2; }
  75%  { top: 6%; opacity: 0.9; }
  100% { top: 6%; opacity: 0.2; }
}
.emoji-gen-content {
  position: relative; z-index: 3;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 24px 20px; text-align: center;
}
.emoji-gen-label {
  font-size: 14px; font-weight: 700; color: var(--accent);
  animation: emoji-gen-label-pulse 1.4s ease-in-out infinite;
}
@keyframes emoji-gen-label-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}
.emoji-gen-phrase {
  position: relative; min-height: 22px; width: 100%;
  display: flex; align-items: center; justify-content: center;
}
.emoji-gen-phrase p {
  margin: 0; font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap;
}
.emoji-gen-phrase-enter-active, .emoji-gen-phrase-leave-active {
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.emoji-gen-phrase-leave-to {
  transform: translateY(-14px); opacity: 0;
}
.emoji-gen-phrase-enter-from {
  transform: translateY(14px); opacity: 0;
}
.emoji-left {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--glass-border);
  padding: 0 12px 0 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.emoji-left-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.emoji-char-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 6px 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
}
.emoji-char-list::-webkit-scrollbar { width: 4px; height: 4px; }
.emoji-char-list::-webkit-scrollbar-track { background: transparent; }
.emoji-char-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.14);
  border-radius: 4px;
}
.emoji-char-list::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.26); }
.emoji-char-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}
.emoji-char-item:hover { background: rgba(0, 0, 0, 0.04); }
.emoji-char-item.active {
  background: rgba(224, 123, 108, 0.12);
  border-color: var(--accent);
}
.emoji-char-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: #e07b6c;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600;
  flex-shrink: 0;
  background-size: cover;
  background-position: center;
}
.emoji-char-meta { min-width: 0; }
.emoji-char-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.emoji-char-count { font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; }
.emoji-batch-btn {
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px dashed rgba(224, 123, 108, 0.35);
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.emoji-batch-btn:hover:not(:disabled) {
  border-style: solid;
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.08);
}
.emoji-batch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.emoji-right {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.emoji-toolbar-row {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  background: #fff;
  padding: 10px 14px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.emoji-gear {
  width: 30px; height: 30px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  font-size: 17px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s ease;
}
.emoji-gear:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: rotate(60deg);
}
.emoji-mode-badge {
  flex-shrink: 0;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: default;
}
.emoji-mode-badge.half_body { background: #FBEAE6; color: #D96A59; }
.emoji-mode-badge.chibi_head { background: #E8F1EA; color: #5B8C6E; }
.emoji-style-input {
  flex: 1;
  min-width: 240px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}
.emoji-progress-strip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(224, 123, 108, 0.08);
  border: 1px solid rgba(224, 123, 108, 0.16);
  color: var(--accent); font-size: 13px; font-weight: 600;
}
.emoji-spinner {
  display: inline-block; flex-shrink: 0;
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(224, 123, 108, 0.22);
  border-top-color: var(--accent);
  animation: emoji-spin 0.8s linear infinite;
}
@keyframes emoji-spin {
  to { transform: rotate(360deg); }
}
.emoji-char-count .emoji-spinner {
  width: 11px; height: 11px; border-width: 1.5px;
  margin-right: 4px; vertical-align: -1px;
}
.emoji-scan-overlay .emoji-spinner {
  width: 22px; height: 22px; border-width: 2.5px;
}
.emoji-progress-label {
  min-width: 0;
}
.emoji-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}
.emoji-char-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px 4px 4px 0;
}
.emoji-char-section::-webkit-scrollbar { display: none; }
.emoji-char-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-bright);
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  padding-left: 5px;
}
.emoji-reveal-enter-active {
  transition: opacity 0.55s ease, transform 0.45s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.emoji-reveal-enter-from {
  opacity: 0; transform: translateY(10px) scale(0.97);
}
.emoji-reveal-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.emoji-reveal-leave-to {
  opacity: 0; transform: scale(0.97);
}
.emoji-card {
  position: relative;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.3);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
.emoji-card.generating {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.emoji-card.failed { border-color: #e06b6b; }
.emoji-card.empty {
  border-style: dashed;
  border-color: rgba(224, 123, 108, 0.28);
  cursor: pointer;
}
.emoji-card.empty:hover {
  border-color: var(--accent);
}
.emoji-card-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  width: 26px;
  height: 26px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(224, 123, 108, 0.38);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #e07b6c;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 0.16s ease, transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}
.emoji-card:hover .emoji-card-delete {
  opacity: 1;
  transform: translateY(0);
}
.emoji-card-delete:hover:not(:disabled) {
  background: #e07b6c;
  border-color: #e07b6c;
  color: #fff;
}
.emoji-card-delete:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.emoji-card.generating.empty {
  border-style: solid; cursor: default;
}
.emoji-card.generating .emoji-empty-slot { cursor: default; }
.emoji-empty-slot {
  width: 100%; aspect-ratio: 1;
  border-radius: 8px;
  background: rgba(224, 123, 108, 0.04);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}
.emoji-empty-slot:hover { background: rgba(224, 123, 108, 0.1); }
.emoji-empty-plus {
  font-size: 34px; line-height: 1;
  color: var(--accent-light);
}
.emoji-empty-slot .emoji-spinner {
  width: 22px; height: 22px; border-width: 2.5px;
}
.emoji-card-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.emoji-key { font-weight: 600; }
.emoji-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #f4f4f4;
  display: flex;
  align-items: center;
  justify-content: center;
}
.emoji-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.emoji-image-placeholder {
  color: var(--accent-light);
  font-size: 28px;
  line-height: 1;
}
.emoji-card-actions {
  display: flex;
  gap: 6px;
}
.emoji-card-actions .btn-sm {
  flex: 1;
  font-size: 12px;
  padding: 5px 8px;
}
.emoji-error {
  font-size: 11px;
  color: #c0392b;
}
.emoji-scan-overlay {
  position: absolute;
  inset: 0;
  background: transparent;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  overflow: hidden;
  pointer-events: none;
}

.btn-sm {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.5);
  cursor: pointer;
}
.btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.advanced-overlay {
  z-index: 10001;
}
.advanced-panel {
  width: min(560px, 94vw);
}
.batch-panel {
  width: min(460px, 94vw);
}
.advanced-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
.advanced-section {
  margin-bottom: 18px;
}
.advanced-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
  margin-bottom: 8px;
}
.advanced-artist-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}
.advanced-tags-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  word-break: break-all;
}
.emoji-style-segmented {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
  padding: 3px;
  background: #F5F1EC;
  border-radius: 10px;
}
.emoji-style-chip {
  padding: 8px 6px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #6F675F;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  text-align: center;
  white-space: nowrap;
}
.emoji-style-chip:hover { color: #E07B6C; }
.emoji-style-chip.active {
  background: #FFFEFC;
  color: #E07B6C;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(125, 105, 85, 0.12);
}
.advanced-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.advanced-cat-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 10px;
}
.advanced-cat-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.advanced-cat-index {
  width: 22px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.advanced-cat-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 7px 8px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}
.advanced-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--glass-border);
}
@media (max-width: 767px) {
  .emoji-body { flex-direction: column; }
  .emoji-left { width: 100%; border-right: none; border-bottom: 1px solid var(--glass-border); padding-bottom: 10px; }
  .emoji-char-list { flex-direction: row; overflow-x: auto; }
  .emoji-char-item { flex-shrink: 0; }
}
</style>
