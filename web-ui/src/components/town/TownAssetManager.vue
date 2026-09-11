<template>
    <Transition name="tam-fade">
      <div v-if="open" class="tam-mask" @click.self="close">
        <div class="tam-panel" role="dialog" :aria-label="displayAsset?.name || '图片管理'">
          <div class="tam-head">
            <div class="tam-heading">
              <span class="tam-title">{{ displayAsset?.name || title || '图片管理' }}</span>
            </div>
            <div class="tam-head-actions">
              <linshe-button
                v-if="displayAsset?.id"
                variant="ghost"
                size="sm"
                @click="promptOpen = true"
              >✎ 图片提示词</linshe-button>
              <linshe-button variant="icon" size="sm" aria-label="关闭" @click="close">✕</linshe-button>
            </div>
          </div>

          <input
            ref="fileEl"
            class="tam-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="onFilePicked"
          >

          <div class="tam-editor">
            <!-- 地皮：单独一套菱形裁剪逻辑——在裁剪前原图上调菱形，而不是在已成型的 64×32 上裁 -->
            <TownTileCropper
              v-if="open && displayAsset?.id && useTileCropper"
              :key="`tile-${displayAsset.id}`"
              :asset-id="displayAsset.id"
              :src="tileSourceUrl"
              :preview-src="srcUrl"
              :initial="tileCropInitial"
              :generation-step="generationStep"
              :generation-params="generationParams"
              :is-portrait="portraitConfig"
              :config-status="generationStatus"
              @update:generation-params="queueGenerationConfigSave"
              @cropped="refreshAsset"
            >
              <template #actions>
                <linshe-button
                  variant="secondary" size="sm"
                  :loading="uploadBusy"
                  :disabled="!displayAsset?.id"
                  title="用本地图片替换这张地皮（会按地皮规格自动裁成菱形贴图）"
                  @click="pickUpload"
                >🖼 上传图片</linshe-button>
                <linshe-button
                  variant="secondary" size="sm"
                  :loading="regenBusy"
                  :disabled="!displayAsset?.id"
                  @click="regenerateAsset"
                >重新生成</linshe-button>
              </template>
            </TownTileCropper>
            <TownImageEditor
              v-else-if="open && displayAsset?.id"
              :key="displayAsset.id"
              :src="srcUrl"
              :asset-id="displayAsset.id"
              crop-mode
              :hint="editorHint"
              :generation-step="generationStep"
              :generation-params="generationParams"
              :is-portrait="portraitConfig"
              :config-status="generationStatus"
              @update:generation-params="queueGenerationConfigSave"
              @saved="refreshAsset"
              @cropped="refreshAsset"
            >
              <template #actions>
                <!-- HiresFix 只属于角色大立绘的详情：地皮 / 建筑 / 道具 / 像素小人不提供 -->
                <linshe-button
                  v-if="portraitConfig"
                  variant="secondary" size="sm"
                  :loading="hiresBusy"
                  @click="refineAsset"
                >HiresFix</linshe-button>
                <linshe-button
                  variant="secondary" size="sm"
                  :loading="uploadBusy"
                  :disabled="!displayAsset?.id"
                  title="用本地图片替换这张素材（会按素材规格自动抠白 / 裁切 / 缩放）"
                  @click="pickUpload"
                >🖼 上传图片</linshe-button>
                <linshe-button
                  variant="secondary" size="sm"
                  :loading="regenBusy"
                  :disabled="!displayAsset?.id"
                  @click="regenerateAsset"
                >重新生成</linshe-button>
              </template>
            </TownImageEditor>
          </div>

          <div v-if="error" class="tam-actions">
            <span class="tam-error">{{ error }}</span>
          </div>
        </div>
      </div>
    </Transition>

    <TownAssetPromptDialog
      :visible="promptOpen"
      :asset-id="displayAsset?.id || null"
      :title="`「${displayAsset?.name || '图片'}」提示词`"
      @close="promptOpen = false"
      @regenerated="refreshAsset"
    />
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import TownImageEditor from './TownImageEditor.vue'
import TownTileCropper from './TownTileCropper.vue'
import TownAssetPromptDialog from './TownAssetPromptDialog.vue'

const ASSET_STEP_LABELS = { tiles: '地皮', buildings: '建筑/道具', npcs: '居民', player: '玩家' }

const props = defineProps({
  open: { type: Boolean, default: false },
  asset: { type: Object, default: null },
  title: { type: String, default: '' },
  hint: { type: String, default: '点击底色或多余白色' },
  /** 传入后用于 NPC/玩家这类需要沿用向导配置的重绘；返回最新 asset 即可 */
  regenerate: { type: Function, default: null },
})

const emit = defineEmits(['close', 'updated'])

const localAsset = ref(null)
const promptOpen = ref(false)
const regenBusy = ref(false)
const hiresBusy = ref(false)
const uploadBusy = ref(false)
const fileEl = ref(null)
const error = ref('')
const generationSettings = ref(null)
const generationSaving = ref(false)
const generationStatus = ref('')
const generationLoaded = ref(false)
let generationSaveTimer = null
let generationSavePending = false
let pendingGenerationPayload = null

const displayAsset = computed(() => localAsset.value || props.asset)
const srcUrl = computed(() => displayAsset.value?.image_path
  ? `${displayAsset.value.image_path}?v=${displayAsset.value.meta?.updatedAt ?? Date.now()}`
  : displayAsset.value?.src || '')

/** 地皮 / 道路：成品是 64×32 菱形贴图，单独走菱形裁剪逻辑（其余素材仍是通用编辑器） */
const isTileAsset = computed(() => ['ground', 'road'].includes(String(displayAsset.value?.kind || '')))
const tileSourceUrl = computed(() => {
  const meta = displayAsset.value?.meta
  if (!meta?.sourceImage) return ''
  return `${meta.sourceImage}?v=${meta.sourceUpdatedAt ?? meta.updatedAt ?? 0}`
})
const useTileCropper = computed(() => isTileAsset.value && !!tileSourceUrl.value)
/** 初始菱形：用户上次调的 > 生成时自动检测的 */
const tileCropInitial = computed(() => displayAsset.value?.meta?.tileCrop || displayAsset.value?.meta?.sourceDiamond || null)
const editorHint = computed(() => (isTileAsset.value ? '这张地皮没有裁剪前原图，重新生成后才能用菱形微调' : props.hint))

function generationStepForAsset(asset) {
  const kind = String(asset?.kind || '')
  const key = String(asset?.key || '')
  if (kind === 'ground' || kind === 'road') return 'tiles'
  if (kind === 'building' || kind === 'prop') return 'buildings'
  if (kind === 'player' || key.startsWith('player')) return 'player'
  return 'npcs'
}

const generationStep = computed(() => generationStepForAsset(displayAsset.value))
const portraitConfig = computed(() => displayAsset.value?.kind === 'portrait')
const generationTypeName = computed(() => ASSET_STEP_LABELS[generationStep.value] || '通用')
const stepConfig = computed(() => generationSettings.value?.generation?.steps?.[generationStep.value] || null)
const generationParams = computed(() => {
  const current = stepConfig.value || {}
  return {
    prefix: portraitConfig.value ? '' : (current.prefix ?? ''),
    artist: current.artist ?? '@ebora',
    loras: Array.isArray(current.loras) ? current.loras : [],
    portraitLoras: current.portraitLoras === true,
  }
})

function normalizeGenerationPayload(payload = {}) {
  const current = stepConfig.value || {}
  const loras = (Array.isArray(payload.loras) ? payload.loras : [])
    .filter(lora => lora && typeof lora.path === 'string' && lora.path.trim())
    .map(lora => ({
      path: lora.path.trim(),
      weight: Number(lora.weight ?? 1),
      triggerWord: typeof lora.triggerWord === 'string' ? lora.triggerWord : '',
    }))
  const artist = payload.artist ?? current.artist ?? '@ebora'
  const portraitLoras = payload.portraitLoras === true
  const prefix = portraitConfig.value ? (current.prefix ?? '') : (payload.prefix ?? '')
  const effectiveLoras = portraitConfig.value && !portraitLoras ? [] : loras
  return { prefix, artist, loras, portraitLoras, effectiveLoras }
}

async function loadGenerationSettings() {
  try {
    generationSettings.value = await api.fetchTownSettings()
    generationLoaded.value = true
  } catch (err) {
    generationStatus.value = err?.message || '生成配置读取失败'
  }
}

/** 与向导一致：编辑后防抖写入 system_settings */
function queueGenerationConfigSave(payload = {}) {
  if (!generationLoaded.value || !displayAsset.value?.id) return
  pendingGenerationPayload = normalizeGenerationPayload(payload)
  generationStatus.value = '保存中…'
  if (generationSaveTimer) clearTimeout(generationSaveTimer)
  generationSaveTimer = setTimeout(saveGenerationConfig, 400)
}

async function saveGenerationConfig() {
  if (generationSaving.value) {
    generationSavePending = true
    return
  }
  if (!pendingGenerationPayload || !displayAsset.value?.id) return
  const payload = pendingGenerationPayload
  pendingGenerationPayload = null
  const step = generationStep.value
  generationSaving.value = true
  try {
    await api.updateTownAssetGeneration(displayAsset.value.id, {
      artist: null,
      loras: null,
      promptPrefix: null,
    })
    await api.updateTownSettings({
      generation: {
        steps: {
          [step]: {
            prefix: payload.prefix,
            artist: payload.artist,
            loras: payload.loras,
            portraitLoras: payload.portraitLoras,
          },
        },
      },
    })
    generationSettings.value = await api.fetchTownSettings()
    generationStatus.value = `${generationTypeName.value}配置已同步`
    await refreshAsset()
  } catch (err) {
    generationStatus.value = err?.message || '生成配置保存失败'
  } finally {
    generationSaving.value = false
    if (generationSavePending) {
      generationSavePending = false
      saveGenerationConfig()
    }
  }
}

async function flushGenerationConfigSave() {
  if (generationSaveTimer) {
    clearTimeout(generationSaveTimer)
    generationSaveTimer = null
  }
  await saveGenerationConfig()
}
function close() {
  if (regenBusy.value || hiresBusy.value) return
  emit('close')
}

async function refreshAsset() {
  const id = displayAsset.value?.id
  if (!id) return null
  try {
    const data = await api.fetchTownAsset(id)
    localAsset.value = data.asset || null
    emit('updated', data.asset)
    return data.asset
  } catch (err) {
    error.value = err?.message || '图片信息刷新失败'
    return null
  }
}

async function regenerateAsset() {
  const asset = displayAsset.value
  if (!asset?.id || regenBusy.value) return
  await flushGenerationConfigSave()
  regenBusy.value = true
  error.value = ''
  try {
    let next = null
    if (props.regenerate) next = await props.regenerate(asset)
    else {
      const data = await api.regenerateTownAsset(asset.id, {})
      next = data.asset
    }
    localAsset.value = next || await refreshAsset()
    if (next) emit('updated', next)
  } catch (err) {
    error.value = err?.message || '重新生成失败'
  } finally {
    regenBusy.value = false
  }
}

async function refineAsset() {
  const asset = displayAsset.value
  if (!asset?.id || hiresBusy.value) return
  hiresBusy.value = true
  error.value = ''
  try {
    const data = await api.refineTownAssetHires(asset.id)
    localAsset.value = data.asset
    emit('updated', data.asset)
  } catch (err) {
    error.value = err?.message || 'HiresFix 失败'
  } finally {
    hiresBusy.value = false
  }
}

// ── 主动上传本地图片替换这张素材 ──

function pickUpload() {
  if (uploadBusy.value) return
  error.value = ''
  fileEl.value?.click()
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function onFilePicked(event) {
  const file = event?.target?.files?.[0]
  if (event?.target) event.target.value = '' // 清空后同一个文件也能再次上传
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    error.value = '请上传 PNG / JPG / WEBP 图片'
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    error.value = '图片过大，请压缩后再上传（不超过 6MB）'
    return
  }
  const asset = displayAsset.value
  if (!asset?.id) return
  error.value = ''
  uploadBusy.value = true
  try {
    await flushGenerationConfigSave()
    const dataUrl = await readAsDataUrl(file)
    const data = await api.uploadTownAssetImage(asset.id, dataUrl)
    localAsset.value = data.asset || null
    if (data.asset) emit('updated', data.asset)
  } catch (err) {
    error.value = `上传失败：${err?.message || err}`
  } finally {
    uploadBusy.value = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    localAsset.value = null
    promptOpen.value = false
    error.value = ''
    generationStatus.value = ''
    generationSettings.value = null
    generationLoaded.value = false
    await Promise.all([refreshAsset(), loadGenerationSettings()])
  } else {
    await flushGenerationConfigSave()
  }
})
</script>

<style scoped>
.tam-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1160;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.tam-panel {
  width: min(1080px, calc(100vw - 40px));
  max-height: min(98vh, 1080px);
  background: #f4f1eeed;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.25);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.tam-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tam-heading { min-width: 0; }
.tam-title { font-size: 15px; font-weight: 700; color: var(--text-bright); }
.tam-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.tam-editor {
  display: flex;
  flex-direction: column;
}

.tam-file { display: none; }

.tam-actions {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.tam-error {
  font-size: 11px;
  color: #c0564a;
  background: rgba(192, 86, 74, 0.08);
  border-radius: 8px;
  padding: 5px 9px;
}

.tam-fade-enter-active, .tam-fade-leave-active { transition: opacity 0.2s ease; }
.tam-fade-enter-from, .tam-fade-leave-to { opacity: 0; }
</style>
