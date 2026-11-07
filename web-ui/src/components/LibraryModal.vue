<template>
    <linshe-modal
      :model-value="modelValue"
      :title="title"
      full
      @update:model-value="onLibraryVisibilityChange"
    >
      <template #header-extra>
        <span class="modal-header-stat"><strong class="modal-header-stat-value">{{ items.length }}</strong> 条</span>
        <span v-if="!isEvents" class="modal-header-stat">已勾选 <strong class="modal-header-stat-value is-active">{{ checkedCount }}</strong></span>
      </template>
      <div class="lib-body" :class="{ 'topic-library': !isEvents }">
          <!-- 生成器 -->
          <div class="gen-section" @paste="onScenePaste">
            <div class="gen-row">
              <div class="gen-input-wrap">
                <linshe-input
                  ref="directionInput"
                  @keydown.enter.exact.prevent="onDirectionEnter"
                  v-model="direction"
                  :disabled="describingImage"
                  class="gen-input"
                  type="textarea"
                  rows="2"
                  :placeholder="isEvents ? '输入想要生成的方向，如「校园生活」「赛博都市日常」「雨季独处」…（留空生成通用类型）' : '输入想要生成的方向，如「校园」「美食探店」「深夜emo」…（留空生成通用话题）'"
                />
                <div v-if="generating" class="scan-overlay">
                  <div class="scan-line"></div>
                  <div class="scan-text">幻想中…</div>
                </div>
              </div>
              <linshe-button variant="primary" @click="doGenerate" :disabled="generating || saving || describingImage">
                {{ generating ? '幻想中…' : '开始幻想' }}
              </linshe-button>
            </div>
            <div class="image-direction-row">
              <div v-show="false" aria-hidden="true">
                <linshe-input ref="imagePicker" type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" @change="onSceneImage" />
              </div>
              <linshe-button variant="secondary" size="sm" :loading="describingImage" :disabled="generating || saving || describingImage" @click="imagePicker?.$el?.click()">
                {{ describingImage ? '正在识别场景…' : '上传图片还原场景' }}
              </linshe-button>
              <Transition name="scene-import">
                <linshe-button v-if="sceneImageReady && !isEvents" variant="secondary" size="sm" :disabled="!direction.trim() || loading || generating || saving || describingImage || addingSceneDraft" @click="addSceneDraft">单独入库</linshe-button>
              </Transition>
              <span class="image-direction-hint" role="status">{{ describingImage ? '识别完成后自动填入上方，可继续修改' : '也可在上方输入框直接粘贴图片（Ctrl+V），最大 6MB；可先填写补充要求' }}</span>
            </div>

            <!-- 生成结果预览 -->
            <div v-if="previewVisible" class="preview-section">
              <div class="preview-header">
                <span class="preview-title">生成预览（{{ previewItems.length }} 条）— 可逐条编辑，确认后入库</span>
                <div class="preview-actions">
                  <linshe-button variant="primary" @click="savePreview" :disabled="saving">
                    {{ saving ? '保存中…' : '保存到自定义库' }}
                  </linshe-button>
                  <linshe-button variant="secondary" @click="discardPreview" :disabled="saving">丢弃</linshe-button>
                </div>
              </div>
              <TransitionGroup
                name="preview-card"
                tag="div"
                class="card-grid"
                @before-leave="onPreviewCardBeforeLeave"
                @after-leave="onPreviewCardAfterLeave"
              >
                <div
                  v-for="(item, i) in previewItems"
                  :key="item._previewKey"
                  class="item-card"
                  :class="{ editing: item._editing }"
                >
                  <CardHeightTransition :editing="item._editing">
                    <div v-if="item._editing" class="edit-form">
                      <label class="edit-field">
                        <span class="edit-label">名称</span>
                        <linshe-input v-model.trim="item.name" class="edit-input" size="sm" placeholder="名称" />
                      </label>
                      <label v-if="isEvents" class="edit-field">
                        <span class="edit-label">标签（逗号分隔）</span>
                        <linshe-input v-model="item.funFromText" class="edit-input" size="sm" placeholder="如 小确幸, 日常感" />
                      </label>
                      <label class="edit-field">
                        <span class="edit-label">描述</span>
                        <linshe-input v-model.trim="item.desc" class="edit-input edit-textarea" type="textarea" rows="6" />
                      </label>
                    </div>
                    <div v-else class="card-main">
                      <div class="card-title-row">
                        <span class="card-name">{{ item.name }}</span>
                      </div>
                      <div class="card-desc">{{ item.desc }}</div>
                      <div v-if="isEvents && item.funFrom && item.funFrom.length" class="card-tags">
                        <span v-for="(t, ti) in item.funFrom" :key="ti" class="tag">{{ t }}</span>
                      </div>
                    </div>
                  </CardHeightTransition>
                  <div class="card-actions">
                    <linshe-button v-if="!item._editing" variant="primary" size="sm" @click="savePreviewItem(i)" :disabled="saving">单独入库</linshe-button>
                    <linshe-button size="sm" @click="togglePreviewEdit(i)">{{ item._editing ? '取消' : '编辑' }}</linshe-button>
                    <linshe-button v-if="item._editing" variant="primary" size="sm" @click="previewItems[i]._editing = false">完成</linshe-button>
                    <linshe-button v-else variant="danger" size="sm" @click="removePreview(i)">删除</linshe-button>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- 系统组（默认折叠） -->
          <div class="group-section">
            <div class="group-header" @click="systemOpen = !systemOpen">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" :class="{ rotated: systemOpen }">
                <polyline points="9,6 15,12 9,18" />
              </svg>
              <span class="group-title">系统（{{ systemItems.length }}）</span>
              <span v-if="!isEvents" class="group-actions" @click.stop>
                <linshe-button variant="link" size="sm" @click="setAllChecked(true)">全选</linshe-button>
                <linshe-button variant="link" size="sm" @click="setAllChecked(false)">清空</linshe-button>
              </span>
              <span class="group-hint">{{ systemOpen ? '收起' : '展开' }}</span>
            </div>
            <CollapseTransition :show="systemOpen">
              <div class="card-grid">
                <LibraryItemCard
                  v-for="item in systemItems"
                  :key="item.id"
                  :item="item"
                  :is-events="isEvents"
                  :selectable="!isEvents"
                  :publishing="publishing"
                  @publish="openPublish"
                  @edit="startEdit"
                  @cancel="cancelEdit"
                  @save="saveItem"
                  @remove="removeItem"
                  @toggle-check="toggleTopicCheck"
                />
                <div v-if="systemItems.length === 0" class="empty-hint">暂无系统条目</div>
              </div>
            </CollapseTransition>
          </div>

          <!-- 自定义组 -->
          <div class="group-section">
            <div class="group-header" @click="customOpen = !customOpen">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" :class="{ rotated: customOpen }">
                <polyline points="9,6 15,12 9,18" />
              </svg>
              <span class="group-title">自定义（{{ customItems.length }}）</span>
              <span class="group-hint">{{ customOpen ? '收起' : '展开' }}</span>
            </div>
            <CollapseTransition :show="customOpen">
              <TransitionGroup name="custom-card" tag="div" class="card-grid">
                <div key="add-card" class="add-card" role="button" tabindex="0" @click="addItem" @keydown.enter.prevent="addItem" @keydown.space.prevent="addItem">＋ 手动新增</div>
                <LibraryItemCard
                  v-for="item in customItems"
                  :key="item.id || item._tempKey"
                  :ref="card => setCustomCardRef(item.id || item._tempKey, card)"
                  :item="item"
                  :is-events="isEvents"
                  :selectable="!isEvents"
                  :publishing="publishing"
                  @publish="openPublish"
                  @edit="startEdit"
                  @cancel="cancelEdit"
                  @save="saveItem"
                  @remove="removeItem"
                  @toggle-check="toggleTopicCheck"
                />
                <div v-if="customItems.length === 0" key="custom-empty" class="empty-hint">还没有自定义条目，用上方生成器或点「＋新增」添加</div>
              </TransitionGroup>
            </CollapseTransition>
          </div>
      </div>
    </linshe-modal>
    <linshe-modal v-model="publishOpen" title="选择角色" :transition-ms="300">
      <div class="publish-fields">
        <p class="publish-topic">
          <span class="publish-topic-label">{{ isEvents ? '奇遇话题' : '朋友圈话题' }}</span>
          <strong class="publish-topic-name">{{ publishItem?.name }}</strong>
        </p>
        <p v-if="charactersLoading" class="publish-hint" role="status">正在加载角色…</p>
        <template v-else-if="charactersError">
          <p class="publish-hint" role="alert">{{ charactersError }}</p>
          <linshe-button size="sm" @click="loadPublishCharacters">重新加载</linshe-button>
        </template>
        <p v-else-if="!publishCharacters.length" class="publish-hint">还没有角色，先去酒馆招募吧。</p>
        <div v-else class="publish-characters" role="group" aria-label="发送角色">
          <div
            v-for="character in publishCharacters"
            :key="character.id"
            class="publish-character"
            :class="{ 'is-selected': publishCharacterId === character.id, 'is-disabled': publishing }"
            role="button"
            :tabindex="publishing ? -1 : 0"
            :aria-label="character.display_name || character.name || '未命名角色'"
            :aria-pressed="publishCharacterId === character.id"
            :aria-disabled="publishing"
            @click="selectPublishCharacter(character.id)"
            @keydown.enter.prevent="selectPublishCharacter(character.id)"
            @keydown.space.prevent="selectPublishCharacter(character.id)"
          >
            <span class="publish-character-avatar" aria-hidden="true">
              <img
                v-if="character.avatar_path && !failedPublishAvatars.has(character.id)"
                :src="character.avatar_path"
                alt=""
                loading="lazy"
                draggable="false"
                @error="failedPublishAvatars.add(character.id)"
              />
              <span v-else>{{ (character.display_name || character.name || '?').charAt(0) }}</span>
              <svg class="publish-character-check" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5 10 3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="publish-character-name">{{ character.display_name || character.name || '未命名角色' }}</span>
          </div>
        </div>
        <p class="publish-hint" role="status">{{ publishing ? '正在生成，完成后会出现在列表中，可关闭此窗口等待。' : '角色将使用这个话题立即生成一条' + (isEvents ? '奇遇。' : '朋友圈。') }}</p>
      </div>
      <template #footer>
        <linshe-button @click="publishOpen = false">{{ publishing ? '关闭' : '取消' }}</linshe-button>
        <linshe-button variant="primary" :loading="publishing" :disabled="!publishCharacterId || charactersLoading || !!charactersError || publishing" @click="publishSelected">立即发送</linshe-button>
      </template>
    </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, inject, nextTick, onBeforeUnmount } from 'vue'
import * as api from '../api/index.js'
import LibraryItemCard from './LibraryItemCard.vue'
import CollapseTransition from './CollapseTransition.vue'
import CardHeightTransition from './CardHeightTransition.vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheButton from './ui/LinsheButton.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  type: { type: String, default: 'event-types' }, // 'event-types' | 'topics'
})
const emit = defineEmits(['update:modelValue', 'published'])

const toastFn = inject('toast')
const confirmFn = inject('confirm')

const isEvents = computed(() => props.type === 'event-types')
const title = computed(() => (isEvents.value ? '奇遇事件库' : '朋友圈话题库'))

const publishOpen = ref(false)
const publishItem = ref(null)
const publishCharacterId = ref(null)
const publishCharacters = ref([])
const charactersLoading = ref(false)
const charactersError = ref('')
const publishing = ref(false)
const failedPublishAvatars = ref(new Set())

function selectPublishCharacter(id) {
  if (publishing.value) return
  publishCharacterId.value = id
}

// 嵌套弹窗按 Esc 时只关闭角色选择窗，保留话题库。
function onLibraryVisibilityChange(value) {
  if (!value && publishOpen.value) return
  emit('update:modelValue', value)
}

watch(() => [props.modelValue, props.type], () => { publishOpen.value = false })

async function loadPublishCharacters() {
  if (charactersLoading.value) return
  charactersLoading.value = true
  charactersError.value = ''
  try {
    const result = await api.listCharacters()
    publishCharacters.value = [...(result.characters || [])].sort((left, right) =>
      (left.display_name || left.name || '').localeCompare(
        right.display_name || right.name || '', 'zh-CN-u-co-pinyin', { sensitivity: 'base' },
      ),
    )
  } catch (err) {
    charactersError.value = err.message || '角色加载失败，请重试'
  } finally {
    charactersLoading.value = false
  }
}

function openPublish(item) {
  if (publishing.value || !item.id) return
  publishItem.value = { ...item }
  publishCharacterId.value = null
  failedPublishAvatars.value.clear()
  publishOpen.value = true
  loadPublishCharacters()
}

async function publishSelected() {
  if (publishing.value || !publishItem.value || !publishCharacterId.value || charactersLoading.value || charactersError.value) return
  const item = publishItem.value
  const characterId = publishCharacterId.value
  const eventMode = isEvents.value
  publishing.value = true
  try {
    if (eventMode) await api.generateEvent(characterId, item.key)
    else await api.generateMoment(characterId, item.id)
    publishOpen.value = false
    toastFn(eventMode ? '奇遇已生成，可前往奇遇列表查看' : '朋友圈已发送', 'success')
    emit('published')
  } catch (err) {
    const errorMessages = {
      already_active_event: '这个角色还有未结束的奇遇，请先完成或取消后再试',
      events_disabled: '奇遇功能尚未启用，请先在设置中开启',
      character_not_found: '这个角色已不存在，请重新选择',
    }
    toastFn(errorMessages[err.message] || err.message || '发送失败，请重试', 'error')
  } finally {
    publishing.value = false
  }
}

const items = ref([])
const loading = ref(false)
const systemOpen = ref(false) // 系统组默认折叠
const customOpen = ref(true)

const direction = ref('')
const directionInput = ref(null)
const imagePicker = ref(null)
const describingImage = ref(false)
const sceneImageReady = ref(false)
const addingSceneDraft = ref(false)
const customCardRefs = new Map()
let sceneFocusTimer = null
let imageRequest = null

function cancelImageRecognition() {
  imageRequest?.abort()
  imageRequest = null
  describingImage.value = false
  sceneImageReady.value = false
  addingSceneDraft.value = false
  clearTimeout(sceneFocusTimer)
}

watch(() => [props.modelValue, props.type], cancelImageRecognition)
onBeforeUnmount(cancelImageRecognition)

function onSceneImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  recognizeSceneImage(file)
}

function onScenePaste(event) {
  const clipboard = event.clipboardData
  const imageItem = Array.from(clipboard?.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'))
  const file = imageItem?.getAsFile() || Array.from(clipboard?.files || []).find(file => file.type.startsWith('image/'))
  if (!file) return // 普通文字粘贴保持原生行为
  event.preventDefault()
  recognizeSceneImage(file)
}

async function recognizeSceneImage(file) {
  if (!file || describingImage.value || generating.value || saving.value) return
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
    return toastFn('请选择 PNG、JPG、WEBP、GIF 或 AVIF 图片', 'error')
  }
  if (file.size > 6 * 1024 * 1024) return toastFn('图片不能超过 6MB', 'error')
  const controller = new AbortController()
  imageRequest = controller
  describingImage.value = true
  const originalDirection = direction.value
  const libraryType = props.type
  try {
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('图片读取失败，请重试'))
      reader.readAsDataURL(file)
    })
    if (controller.signal.aborted) return
    const result = await api.describeLibraryImage(libraryType, image, originalDirection, controller.signal)
    if (controller.signal.aborted || imageRequest !== controller) return
    if (!result.direction?.trim()) throw new Error('未识别到场景，请重试')
    direction.value = result.direction
    sceneImageReady.value = true
    toastFn(isEvents.value ? '场景已填入，可修改后开始幻想' : '场景已填入，可单独入库或继续幻想', 'success')
  } catch (err) {
    if (!controller.signal.aborted) toastFn(err.message || '图片识别失败，请重试', 'error')
  } finally {
    if (imageRequest === controller) {
      imageRequest = null
      describingImage.value = false
      await nextTick()
      directionInput.value?.focus()
    }
  }
}
const generating = ref(false)
const saving = ref(false)
const previewItems = ref([])
const previewVisible = ref(false)
const previewLeavingCount = ref(0)

const systemItems = computed(() => items.value.filter(i => i.source === 'default'))
const customItems = computed(() => items.value.filter(i => i.source === 'custom'))

// ── 话题勾选（仅朋友圈话题库；奇遇事件库不启用）──
// 勾选决定这条话题参不参与抽取，条目本身保留，随时能再勾回来。
const checkedCount = computed(() => items.value.filter(i => i.checked !== 0).length)

async function toggleTopicCheck(item) {
  const next = item.checked === 0 ? 1 : 0
  const prev = item.checked
  item.checked = next
  try {
    await api.setTopicsChecked({ ids: [item.id], checked: next === 1 })
  } catch (err) {
    item.checked = prev
    console.warn('[library] toggle topic check failed:', err?.message)
  }
}

async function setAllChecked(checked) {
  try {
    await api.setTopicsChecked({ all: true, checked })
    for (const it of items.value) it.checked = checked ? 1 : 0
  } catch (err) {
    console.warn('[library] set all checked failed:', err?.message)
  }
}

// ── 加载 ──

async function load() {
  loading.value = true
  try {
    items.value = isEvents.value ? await api.listEventTypes() : await api.listTopics()
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, async (v) => {
  if (v) {
    direction.value = ''
    previewItems.value = []
    previewVisible.value = false
    previewLeavingCount.value = 0
    load()
    await nextTick()
    directionInput.value?.focus()
  }
})


// ── 生成器 ──

function onDirectionEnter(e) {
  if (e.isComposing || e.keyCode === 229) return
  if (generating.value || saving.value || describingImage.value) return
  e.target.blur()
  doGenerate()
}

async function doGenerate() {
  if (generating.value || saving.value || describingImage.value) return
  generating.value = true
  try {
    const res = isEvents.value
      ? await api.generateEventTypes(direction.value.trim())
      : await api.generateTopics(direction.value.trim())
    const generatedItems = (res.items || []).map((it, index) => ({
      ...it,
      funFromText: (it.funFrom || []).join(', '),
      _editing: false,
      _previewKey: `preview_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    }))
    previewVisible.value = generatedItems.length > 0
    previewItems.value = generatedItems
    if (previewItems.value.length === 0) toastFn('没有生成到内容，换个方向试试', 'error')
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    generating.value = false
  }
}

function discardPreview() {
  previewLeavingCount.value += previewItems.value.length
  previewItems.value = []
}

function onPreviewCardBeforeLeave(el) {
  const grid = el.parentElement
  if (!grid) return

  const cardRect = el.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  el.style.left = `${cardRect.left - gridRect.left}px`
  el.style.top = `${cardRect.top - gridRect.top}px`
  el.style.width = `${cardRect.width}px`
  el.style.height = `${cardRect.height}px`
}

function onPreviewCardAfterLeave(el) {
  el.style.left = ''
  el.style.top = ''
  el.style.width = ''
  el.style.height = ''
  previewLeavingCount.value = Math.max(0, previewLeavingCount.value - 1)
  if (previewItems.value.length === 0 && previewLeavingCount.value === 0) {
    previewVisible.value = false
  }
}

function togglePreviewEdit(idx) {
  const item = previewItems.value[idx]
  if (item._editing) {
    item._editing = false
    // 还原编辑前的字段
    if (item._original) {
      const restored = JSON.parse(item._original)
      previewItems.value[idx] = { ...restored, funFromText: (restored.funFrom || []).join(', ') }
    }
  } else {
    item._original = JSON.stringify({ key: item.key, name: item.name, durationMin: item.durationMin, urgency: item.urgency, funFrom: item.funFrom, desc: item.desc, _previewKey: item._previewKey })
    item._editing = true
  }
}

function removePreview(idx) {
  previewLeavingCount.value += 1
  previewItems.value.splice(idx, 1)
}

function cleanPayload(item) {
  if (isEvents.value) {
    const funFrom = typeof item.funFromText === 'string'
      ? item.funFromText.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : (item.funFrom || [])
    return { key: item.key, name: item.name, durationMin: item.durationMin, urgency: item.urgency, funFrom, desc: item.desc }
  }
  return { name: item.name, desc: item.desc }
}

async function savePreviewItem(idx) {
  const item = previewItems.value[idx]
  if (!item || saving.value) return
  const payload = cleanPayload(item)
  if (!payload.name || !payload.name.trim()) return toastFn('名称不能为空', 'error')
  saving.value = true
  try {
    const res = isEvents.value
      ? await api.saveEventTypeBatch([payload])
      : await api.saveTopicBatch([payload])
    const saved = (res.saved || [])[0]
    if (saved) {
      if (!customOpen.value) {
        customOpen.value = true
        await nextTick()
      }
      items.value = [...items.value, saved]
      previewLeavingCount.value += 1
      previewItems.value.splice(idx, 1)
      toastFn('已入库', 'success')
    } else {
      toastFn((res.errors && res.errors[0] && res.errors[0].message) || '入库失败', 'error')
    }
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    saving.value = false
  }
}

async function savePreview() {
  if (saving.value) return
  const payload = previewItems.value.map(it => cleanPayload(it)).filter(it => it.name && it.name.trim())
  if (payload.length === 0) return toastFn('没有可保存的有效条目（名称不能为空）', 'error')
  saving.value = true
  try {
    const res = isEvents.value
      ? await api.saveEventTypeBatch(payload)
      : await api.saveTopicBatch(payload)
    const saved = res.saved || []
    if (saved.length > 0 && !customOpen.value) {
      customOpen.value = true
      await nextTick()
    }
    items.value = [...items.value, ...saved]
    toastFn(`已保存 ${saved.length} 条${res.errors && res.errors.length ? `，跳过 ${res.errors.length} 条无效` : ''}`)
    previewLeavingCount.value += previewItems.value.length
    previewItems.value = []
  } catch (err) {
    toastFn(err.message, 'error')
  } finally {
    saving.value = false
  }
}

// ── 列表条目：编辑 / 新增 / 删除 ──

function setCustomCardRef(key, card) {
  if (card) customCardRefs.set(key, card)
  else customCardRefs.delete(key)
}

async function addSceneDraft() {
  if (isEvents.value || !sceneImageReady.value || !direction.value.trim() || loading.value || generating.value || saving.value || describingImage.value || addingSceneDraft.value) return
  addingSceneDraft.value = true
  const draft = {
    source: 'custom', name: '自定义事件', desc: direction.value,
    _editing: true, _tempKey: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  }
  customOpen.value = true
  items.value.unshift(draft)
  await nextTick()
  if (!props.modelValue || !addingSceneDraft.value) return
  // 等分组展开与卡片入场完成，再定位，避免滚到仍被折叠区域裁切的位置。
  sceneFocusTimer = setTimeout(() => {
    customCardRefs.get(draft._tempKey)?.focusEditor()
    addingSceneDraft.value = false
  }, 300)
}

function startEdit(item) {
  item._original = JSON.stringify(item)
  item._editing = true
}

function cancelEdit(item) {
  // 新增中的空卡片：直接移除
  if (!item.id) {
    items.value = items.value.filter(i => i !== item)
    return
  }
  if (item._original) {
    const restored = JSON.parse(item._original)
    const idx = items.value.indexOf(item)
    items.value[idx] = { ...restored }
  } else {
    item._editing = false
  }
}

async function saveItem(item) {
  if (isEvents.value) {
    if (!item.key || !item.key.trim()) return toastFn('key 不能为空', 'error')
    if (!item.name || !item.name.trim()) return toastFn('名称不能为空', 'error')
  } else if (!item.name || !item.name.trim()) {
    return toastFn('名称不能为空', 'error')
  }

  try {
    let saved
    if (item.id) {
      saved = isEvents.value ? await api.updateEventType(item.id, cleanPayload(item)) : await api.updateTopic(item.id, cleanPayload(item))
    } else {
      saved = isEvents.value ? await api.createEventType(cleanPayload(item)) : await api.createTopic(cleanPayload(item))
    }
    const idx = items.value.indexOf(item)
    items.value[idx] = { ...saved }
    toastFn('已保存')
  } catch (err) {
    toastFn(err.message, 'error')
  }
}

async function removeItem(item) {
  const ok = confirmFn ? await confirmFn(`确定删除「${item.name}」吗？`) : true
  if (!ok) return
  try {
    if (item.id) {
      if (isEvents.value) await api.deleteEventType(item.id)
      else await api.deleteTopic(item.id)
    }
    items.value = items.value.filter(i => i !== item)
    toastFn('已删除')
  } catch (err) {
    toastFn(err.message, 'error')
  }
}

function addItem() {
  const blank = isEvents.value
    ? { source: 'custom', key: '', name: '', durationMin: 60, urgency: 1, funFrom: [], desc: '', _editing: true, _tempKey: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
    : { source: 'custom', name: '', desc: '', _editing: true, _tempKey: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
  items.value.push(blank)
}
</script>

<style scoped>

.lib-body {
  padding: 0 4px 12px;
}

.publish-fields { display: flex; flex-direction: column; gap: 12px; }
.publish-topic {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--text-secondary) 6%, transparent);
  overflow-wrap: anywhere;
}
.publish-topic-label {
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.publish-topic-name {
  color: var(--text-primary);
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.6;
}
.publish-hint { margin: 0; color: var(--text-secondary); font-size: var(--fs-sm); line-height: 1.6; }
.publish-characters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
  max-height: min(360px, 45dvh);
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: 3px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.publish-character {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 10px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  text-align: center;
  transition: background-color 0.3s ease, border-color 0.3s ease, opacity 0.3s ease;
}
@media (hover: hover) {
  .publish-character:not(.is-disabled):hover {
    background: color-mix(in srgb, var(--text-secondary) 6%, transparent);
  }
}
.publish-character.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.publish-character:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.publish-character.is-disabled { opacity: 0.6; cursor: not-allowed; }
.publish-character-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  font-size: var(--fs-xl);
  font-weight: 600;
}
.publish-character-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.publish-character-check {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--modal-lining-bg);
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--on-accent);
  opacity: 0;
  transform: scale(0.8);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.publish-character.is-selected .publish-character-check { opacity: 1; transform: scale(1); }
.publish-character-name { font-size: var(--fs-sm); font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }

/* 生成器 */
.gen-section { margin-bottom: 20px; }
.image-direction-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.image-direction-hint { color: var(--text-secondary); font-size: var(--fs-xs); }
.scene-import-enter-active, .scene-import-leave-active { transition: opacity 0.3s ease; }
.scene-import-enter-from, .scene-import-leave-to { opacity: 0; }
.gen-row { display: flex; gap: 10px; align-items: stretch; }
.gen-input-wrap { position: relative; flex: 1; min-width: 0; }
.gen-input-wrap .gen-input { width: 100%; box-sizing: border-box; }
.gen-input {
  flex: 1; min-height: 48px;
  padding: 10px 12px;
}

/* ── 生成中扫描线（酒馆同款）── */
.scan-overlay {
  position: absolute; inset: 0;
  background: var(--glass-bg-veil);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  z-index: 10; overflow: hidden;
}
.scan-line {
  position: absolute; left: 8%; right: 8%; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent, var(--accent)), transparent);
  animation: lib-scan-sweep 2s ease-in-out infinite;
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.6), 0 0 8px rgba(var(--accent-rgb), 0.3);
}
@keyframes lib-scan-sweep {
  0%   { top: 10%; opacity: 0.2; }
  25%  { top: 90%; opacity: 1; }
  50%  { top: 90%; opacity: 0.2; }
  75%  { top: 10%; opacity: 1; }
  100% { top: 10%; opacity: 0.2; }
}
.scan-text {
  font-size: 13px; color: var(--accent, var(--accent)); font-weight: 600;
  animation: lib-scan-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.3);
}
@keyframes lib-scan-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.97); }
  50%      { opacity: 1;   transform: scale(1); }
}

/* 生成预览 */
.preview-section {
  margin-top: 14px; padding: 12px;
  border: 1px dashed rgba(var(--accent-rgb), 0.4);
  border-radius: 12px; background: rgba(var(--accent-rgb), 0.03);
}
.preview-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 10px;
}
.preview-title { font-size: 13px; font-weight: 600; color: var(--accent-hover); }
.preview-actions { display: flex; gap: 8px; }

/* 分组 */
.group-section { margin-bottom: 22px; }
.group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 4px; cursor: pointer; user-select: none;
  border-top: 1px solid var(--tint-subtle);
}
.group-header svg { transition: transform 0.25s; color: var(--text-secondary, #888); flex-shrink: 0; }
.group-header svg.rotated { transform: rotate(90deg); }
.group-title { font-size: 14px; font-weight: 700; color: var(--text-primary, #333); }
.group-hint { font-size: 11px; color: var(--text-secondary, #888); }
/* 全选 / 清空：靠右，且不要冒泡到分组头的展开收起 */
.group-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.add-card {
  min-height: 130px;
  border: 1.5px dashed var(--accent, var(--accent));
  border-radius: 12px;
  background: transparent; color: var(--accent, var(--accent));
  font-size: 13px; font-family: inherit; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
  user-select: none;
}
.add-card:hover { background: rgba(var(--accent-rgb),0.06); }

/* 卡片网格 */
.topic-library {
  --library-description-lines: 6;
  --library-description-min-height: 9.6em;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 10px;
  position: relative;
}
.item-card {
  display: flex; flex-direction: column; justify-content: space-between;
  border: 1px solid var(--glass-border);
  border-radius: 12px; padding: 12px;
  background: var(--glass-bg);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.item-card:hover { border-color: rgba(var(--accent-rgb),0.35); box-shadow: 0 3px 16px rgba(var(--accent-rgb),0.06); }
.item-card.editing { border-color: var(--accent, var(--accent)); box-shadow: 0 0 0 2px rgba(var(--accent-rgb),0.15); }
.card-main { min-width: 0; }
.card-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.card-name { font-size: 14px; font-weight: 700; color: var(--text-bright, #2b2b2b); }
.card-desc {
  font-size: 12px; color: var(--text-primary, #555);
  line-height: 1.6; margin-top: 6px;
  min-height: var(--library-description-min-height, 0);
  display: -webkit-box; -webkit-line-clamp: var(--library-description-lines, 3); -webkit-box-orient: vertical; overflow: hidden;
}
.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: rgba(var(--accent-rgb),0.1); color: var(--accent-hover);
}
.card-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }

/* 编辑表单 */
.edit-form { display: flex; flex-direction: column; gap: 8px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; }
.edit-label { font-size: 11px; color: var(--text-secondary, #888); }
.edit-input {
  padding: 6px 8px;
  font-size: 12px; box-sizing: border-box;
}

.empty-hint {
  grid-column: 1 / -1;
  font-size: 12px; color: var(--text-secondary, #888);
  padding: 18px; text-align: center; background: var(--tint-faint);
  border-radius: 10px;
}

/* 卡片入库动效：预览卡向下退场，自定义卡从下方向上进入 */
.preview-card-enter-active,
.custom-card-enter-active {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease-out;
  will-change: transform, opacity;
}
.preview-card-leave-active,
.custom-card-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.18s ease-in;
  will-change: transform, opacity;
  pointer-events: none;
}
.preview-card-leave-active {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
}
.preview-card-enter-from,
.custom-card-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.preview-card-leave-to,
.custom-card-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
.preview-card-move,
.custom-card-move {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .preview-card-enter-active,
  .preview-card-leave-active,
  .preview-card-move,
  .custom-card-enter-active,
  .custom-card-leave-active,
  .custom-card-move {
    transition-duration: 0.01ms !important;
  }
  .preview-card-enter-from,
  .preview-card-leave-to,
  .custom-card-enter-from,
  .custom-card-leave-to {
    transform: none;
  }
}

.modal-fade-enter-active, .modal-fade-leave-active { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; transform: scale(0.98); }
</style>
