<template>
  <linshe-modal :model-value="modelValue" title="相片装裱" variant="film" full body-class="modal-workspace-body" :transition-ms="300" :close-disabled="busy" :suspended="lightboxOpen" @update:model-value="$emit('update:modelValue', $event)" @after-leave="releasePreview">
    <template #title><div class="finish-heading"><h3 class="finish-title"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 3h26v26H3zM8 8h16v13H8zM7 25h10M21 25h4" /></svg>暗房装裱</h3><span class="finish-status" role="status">{{ loading ? '正在读取原片…' : busy ? '正在处理…' : dirty ? '未保存' : finish ? '已保存成品' : '原片保留' }}</span></div></template>
    <template #close="{ close, disabled }"><studio-button variant="icon-plain" :disabled="disabled" aria-label="关闭装裱" @click="close()"><svg class="finish-close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19" /></svg></studio-button></template>
    <div class="finish-workspace">
      <section class="finish-proof" aria-label="装裱预览">
        <div class="finish-stage" :class="{ 'has-filter-layers': filterLayers.length > 1 || layerPanelPresent }" :aria-busy="loading || rendering">
          <div ref="previewHost" class="finish-canvas" :class="{ 'is-comparing': comparing }" role="img" aria-label="装裱成品预览" />
          <img v-if="source && comparing" class="finish-original" :src="photo.output_url" alt="原片对比" />
          <span v-if="loading" class="finish-placeholder" role="status">正在读取原片…</span>
          <span v-else-if="!source" class="finish-placeholder">原片未载入</span>
          <span v-if="comparing" class="finish-original-label">原片</span>
          <Transition name="finish-layers" appear @before-enter="layerPanelPresent = true" @after-leave="layerPanelPresent = false">
            <studio-filter-layers v-if="filterLayers.length > 1" :layers="filterLayers" :selected="selectedLayer" :disabled="busy || !source" @select="selectLayer" @remove="removeFilter" @update="updateFilter" />
          </Transition>
        </div>
        <div class="finish-proof-actions">
          <div class="finish-proof-main-actions">
          <studio-button :disabled="!source || busy" :aria-pressed="comparing" @click="comparing = !comparing">{{ comparing ? '返回成品' : '对比原片' }}</studio-button>
          <studio-button variant="ghost" :disabled="!rendered || rendering || busy" @click="enlarge">放大查看</studio-button>
          <studio-button variant="ghost" :disabled="!source || busy" @click="reset">重置</studio-button>
          </div>
          <studio-button class="finish-reuse" variant="chip" size="sm" :active="reuseForNewPhotos" :aria-pressed="reuseForNewPhotos" :disabled="busy" @click="reuseForNewPhotos = !reuseForNewPhotos">新片沿用 {{ reuseForNewPhotos ? 'ON' : 'OFF' }}</studio-button>
        </div>
      </section>
      <section class="finish-options" aria-label="相框与滤镜">
        <div class="finish-mode" role="group" aria-label="装裱模式"><studio-button v-for="mode in [{ label: '相框', value: 'frame' }, { label: '滤镜', value: 'filter' }]" :key="mode.value" variant="finish-tab" :active="tab === mode.value" :aria-pressed="tab === mode.value" :disabled="busy" @click="tab = mode.value">{{ mode.label }}</studio-button></div>
        <Transition name="finish-tab">
            <div v-if="tab === 'filter'" class="finish-filter-tools">
              <studio-button size="xs" block :disabled="busy || !source || addingLayer || filterLayers.length >= 20" @click="beginLayer">{{ addingLayer ? '请选择新层滤镜' : '叠加滤镜' }}</studio-button>
              <studio-button v-if="addingLayer" variant="ghost" size="compact" :disabled="busy" @click="addingLayer = false">取消</studio-button>
            </div>
        </Transition>
        <Transition name="finish-tab" mode="out-in" @after-enter="scrollSelectedChoice">
          <div :key="tab" class="finish-choice-panel">
            <div ref="choiceRail" class="finish-choices" :aria-label="tab === 'frame' ? '选择相框' : '选择滤镜'">
              <div v-for="option in choices" :key="option.value" class="finish-choice" :class="{ 'is-selected': isSelected(option.value), 'is-current': recipe[tab] === option.value, 'is-disabled': busy || !source }" role="button" :tabindex="busy || !source ? -1 : 0" :aria-pressed="isSelected(option.value)" :aria-disabled="busy || !source" @click="select(option.value)" @keydown.enter.prevent="select(option.value)" @keydown.space.prevent="select(option.value)">
                <div class="finish-choice-image"><img v-if="thumbnails[`${tab}:${option.value}`]" :src="thumbnails[`${tab}:${option.value}`]" alt="" /></div>
                <span>{{ option.label }}</span><span v-if="isSelected(option.value)" class="finish-check" aria-hidden="true">✓</span>
              </div>
            </div>
            <template v-if="tab === 'frame'">
              <div v-if="recipe.frame === 'gallery'" class="finish-setting"><span>框色</span><studio-filter-options v-model="recipe.tone" label="画廊配色" size="compact" :disabled="busy" :options="[{ label: '荧光黄', value: 'light' }, { label: '烈焰橙', value: 'dark' }]" /></div>
              <div v-if="['ticket', 'journal', 'postal'].includes(recipe.frame)" class="finish-caption"><label for="studio-finish-caption">相纸题字</label><studio-input id="studio-finish-caption" v-model="recipe.caption" :disabled="busy" maxlength="60" placeholder="留一句话，或写下日期…" @focus="revealCaption" /></div>
              <div v-if="recipe.frame === 'polaroid'" class="finish-caption"><label for="studio-camera-settings">拍摄参数（装饰）</label><studio-input id="studio-camera-settings" v-model="recipe.cameraSettings" :disabled="busy" maxlength="80" placeholder="35mm · f/2 · 1/125s · ISO 100" @focus="revealCaption" /></div>
            </template>
          </div>
        </Transition>
        <Transition name="finish-tab">
        <div v-if="tab === 'frame' || filterLayers.length < 2" class="finish-adjustments" :aria-label="tab === 'frame' ? '边框宽度调节' : '滤镜强度调节'">
          <Transition name="finish-tab" mode="out-in">
            <div v-if="tab === 'frame'" key="border" class="finish-border-adjustment finish-setting"><span>边框</span><studio-filter-options v-model="recipe.border" label="边框宽度" :disabled="busy || !source || recipe.frame === 'none'" :options="[{ label: '细边', value: 'thin' }, { label: '宽边', value: 'wide' }]" /></div>
            <div v-else key="intensity">
              <div class="finish-setting"><label for="studio-finish-intensity">{{ filterLayers.length > 1 ? `${currentFilterLabel}强度` : '强度' }}</label><div class="finish-intensity-meta"><studio-button v-if="['silver', 'glitch'].includes(recipe.filter)" variant="chip" size="compact" :active="recipe.grain" :disabled="busy" :aria-pressed="recipe.grain" aria-label="胶片颗粒" @click="updateFilter({ grain: !recipe.grain })">颗粒 {{ recipe.grain ? 'ON' : 'OFF' }}</studio-button><strong>{{ recipe.filter === 'none' ? '原色' : `${recipe.intensity}%` }}</strong></div></div>
              <studio-range id="studio-finish-intensity" :model-value="recipe.filter === 'none' ? 0 : recipe.intensity" :disabled="busy || recipe.filter === 'none' || !source" :min="0" :max="100" @update:model-value="updateFilter({ intensity: $event })" />
            </div>
          </Transition>
        </div>
        </Transition>
        <p v-if="error" class="finish-message is-error" role="alert">{{ error }} <studio-button v-if="!source && !loading" variant="link" @click="loadPhoto">重试</studio-button></p>
        <p v-else-if="notice" class="finish-message" role="status">{{ notice }}</p>
      </section>
    </div>
    <template #footer>
      <div class="finish-footer-actions">
      <studio-button variant="primary" :disabled="!rendered || loading || rendering || busy" :loading="action === 'save'" @click="save">应用特效</studio-button>
      </div>
    </template>
  </linshe-modal>
  <Teleport to="body"><div style="--vel-z-index: 16000"><ImageLightbox :visible="lightboxOpen" :imgs="lightboxImages" :show-download="true" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="closeLightbox" /></div></Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import LinsheModal from '../ui/LinsheModal.vue'
import StudioButton from './StudioButton.vue'
import StudioFilterOptions from './StudioFilterOptions.vue'
import StudioInput from './StudioInput.vue'
import StudioRange from './StudioRange.vue'
import StudioFilterLayers from './StudioFilterLayers.vue'
import ImageLightbox from '../ImageLightbox.vue'
import { savePhotoStudioFinish } from '../../api/index.js'
import { STUDIO_FRAMES, STUDIO_FILTERS, defaultFinishRecipe, normalizeStudioFrame, normalizeStudioFilter, studioFilterLayers, loadFinishImage, renderStudioFinish, finishBlob } from '../../utils/photoStudioFinish.js'

const props = defineProps({ modelValue: Boolean, photo: { type: Object, default: null }, finish: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'saved'])
const recipe = ref(defaultFinishRecipe()), tab = ref('frame'), previewHost = ref(null), choiceRail = ref(null)
const source = shallowRef(null), rendered = shallowRef(null), thumbnails = ref({})
const loading = ref(false), rendering = ref(false), action = ref(''), comparing = ref(false), error = ref(''), notice = ref('')
const lightboxOpen = ref(false), lightboxImages = ref([]), savedRecipe = ref('')
let loadVersion = 0, timer, disposed = false, lightboxUrl = '', entrySelectedLayer = -1
const busy = computed(() => !!action.value)
const reuseForNewPhotos = ref(true)
const entryReuseForNewPhotos = ref(true)
const addingLayer = ref(false), selectedLayer = ref(-1)
const layerPanelPresent = ref(false)
const filterLayers = computed(() => studioFilterLayers(recipe.value))
const currentFilterLabel = computed(() => STUDIO_FILTERS.find(option => option.value === recipe.value.filter)?.label || '')
const dirty = computed(() => JSON.stringify(recipe.value) !== savedRecipe.value || reuseForNewPhotos.value !== entryReuseForNewPhotos.value)
const choices = computed(() => tab.value === 'frame' ? STUDIO_FRAMES : STUDIO_FILTERS)
function isSelected(value) {
  return tab.value === 'frame' ? recipe.value.frame === value : !addingLayer.value && recipe.value.filter === value
}
function setFilters(filters, index = filters.length - 1) {
  selectedLayer.value = filters.length ? Math.max(0, Math.min(index, filters.length - 1)) : -1
  const current = filters[selectedLayer.value]
  recipe.value = { ...recipe.value, filters, filter: current?.filter || 'none', intensity: current?.intensity ?? 100, grain: current?.grain ?? true }
  comparing.value = false
}
function beginLayer() {
  if (busy.value || !source.value || addingLayer.value || filterLayers.value.length >= 20) return
  addingLayer.value = true
}
function selectLayer(index) {
  if (busy.value || !source.value || !filterLayers.value[index]) return
  addingLayer.value = false
  setFilters(filterLayers.value, index)
  tab.value = 'filter'
  nextTick(scrollSelectedChoice)
}
function select(value) {
  if (busy.value || !source.value) return
  if (tab.value === 'frame') { recipe.value.frame = value; comparing.value = false; return }
  if (value === 'none') {
    if (addingLayer.value) addingLayer.value = false
    else removeFilter(selectedLayer.value)
    return
  }
  if (addingLayer.value) {
    setFilters([...filterLayers.value, { filter: value, intensity: 100, grain: true }])
    addingLayer.value = false
  } else if (filterLayers.value.length) updateFilter({ filter: value })
  else setFilters([{ filter: value, intensity: recipe.value.intensity, grain: recipe.value.grain }])
}
function updateFilter(patch) {
  if (busy.value || !source.value || recipe.value.filter === 'none') return
  const filters = filterLayers.value.map((layer, index) => index === selectedLayer.value ? { ...layer, ...patch } : layer)
  setFilters(filters, selectedLayer.value)
}
function removeFilter(index) {
  if (busy.value || !source.value || !filterLayers.value[index]) return
  addingLayer.value = false
  const next = selectedLayer.value > index ? selectedLayer.value - 1 : selectedLayer.value
  setFilters(filterLayers.value.filter((_, layerIndex) => layerIndex !== index), next)
}
function reset() {
  if (busy.value || !source.value || !savedRecipe.value) return
  selectedLayer.value = entrySelectedLayer
  recipe.value = JSON.parse(savedRecipe.value)
  reuseForNewPhotos.value = entryReuseForNewPhotos.value
  comparing.value = false; addingLayer.value = false
  nextTick(scrollSelectedChoice)
}
function revealCaption(event) {
  const input = event.target
  requestAnimationFrame(() => {
    if (!input.isConnected || !props.modelValue) return
    const area = input.closest('.finish-choice-panel')
    const overflow = input.getBoundingClientRect().bottom - area.getBoundingClientRect().bottom + 8
    if (overflow > 0) area.scrollTop += overflow
  })
}
function scrollSelectedChoice() {
  const rail = choiceRail.value, selected = rail?.querySelector('.is-current')
  if (!rail || !selected) return
  if (rail.scrollWidth > rail.clientWidth) {
    const offset = selected.getBoundingClientRect().left - rail.getBoundingClientRect().left
    rail.scrollLeft += offset - (rail.clientWidth - selected.clientWidth) / 2
  } else {
    const area = rail.closest('.finish-choice-panel'), box = selected.getBoundingClientRect(), viewport = area.getBoundingClientRect()
    if (box.top < viewport.top || box.bottom > viewport.bottom) area.scrollTop += box.top - viewport.top - (area.clientHeight - box.height) / 2
  }
}
function draw() {
  clearTimeout(timer)
  if (!source.value || !props.modelValue) { rendering.value = false; return }
  try {
    const output = renderStudioFinish(source.value, recipe.value)
    if (rendered.value) rendered.value.width = rendered.value.height = 1
    rendered.value = output
    previewHost.value?.replaceChildren(output)
  } catch (err) { rendered.value = null; error.value = err.message }
  finally { rendering.value = false }
}
function queueDraw() {
  if (!source.value || !props.modelValue) return
  rendering.value = true
  clearTimeout(timer); timer = setTimeout(draw, 90)
}
watch(recipe, () => {
  error.value = ''; notice.value = ''; queueDraw()
}, { deep: true, flush: 'sync' })
function beginEdit() {
  // Keep the committed entry state isolated from every in-window draft edit.
  const previous = props.finish?.recipe ? JSON.parse(JSON.stringify(props.finish.recipe)) : null
  recipe.value = { ...defaultFinishRecipe(), ...previous, frame: normalizeStudioFrame(previous?.frame ?? defaultFinishRecipe().frame), filter: normalizeStudioFilter(previous?.filter || 'none'), version: 3, intensity: previous?.version === 3 ? previous.intensity : 100 }
  selectedLayer.value = recipe.value.filter === 'none' ? -1 : 0
  if (previous?.filters) {
    const filters = studioFilterLayers(recipe.value)
    const index = filters.findIndex(layer => layer.filter === recipe.value.filter && layer.intensity === recipe.value.intensity && layer.grain === recipe.value.grain)
    setFilters(filters, index < 0 ? filters.length - 1 : index)
  }
  reuseForNewPhotos.value = true
  entryReuseForNewPhotos.value = reuseForNewPhotos.value
  savedRecipe.value = JSON.stringify(recipe.value)
  entrySelectedLayer = selectedLayer.value
  comparing.value = false; addingLayer.value = false
}
async function loadPhoto() {
  const version = ++loadVersion
  loading.value = true; error.value = ''; notice.value = ''; source.value = null; thumbnails.value = {}
  if (rendered.value) rendered.value.width = rendered.value.height = 1
  rendered.value = null; comparing.value = false
  try {
    const image = await loadFinishImage(props.photo.output_url)
    if (disposed || version !== loadVersion || !props.modelValue) return
    source.value = image
    await nextTick(); draw()
    const thumbs = {}
    for (const [kind, options] of [['frame', STUDIO_FRAMES], ['filter', STUDIO_FILTERS]]) {
      for (const option of options) {
        const small = renderStudioFinish(image, { ...defaultFinishRecipe(), frame: 'none', [kind]: option.value }, { maxSide: 160 })
        thumbs[`${kind}:${option.value}`] = small.toDataURL('image/png')
        small.width = small.height = 1
        if (Object.keys(thumbs).length % 4 === 0) {
          thumbnails.value = { ...thumbs }
          await new Promise(resolve => setTimeout(resolve, 0))
          if (disposed || version !== loadVersion || !props.modelValue) return
        }
      }
    }
    thumbnails.value = thumbs
    await nextTick(); scrollSelectedChoice()
  } catch (err) { if (version === loadVersion) error.value = err.message }
  finally { if (version === loadVersion) loading.value = false }
}
watch(() => [props.modelValue, props.photo?.id], ([open]) => {
  if (open && props.photo) { beginEdit(); void loadPhoto() }
  else { loadVersion++; clearTimeout(timer); rendering.value = false; loading.value = false; closeLightbox() }
}, { immediate: true })
async function save() {
  if (busy.value || !rendered.value || loading.value || rendering.value) return
  action.value = 'save'; error.value = ''; notice.value = ''
  const snapshot = JSON.parse(JSON.stringify(recipe.value)), id = props.photo.id
  try {
    const blob = await finishBlob(rendered.value)
    if (blob.size > 32 * 1024 * 1024) throw new Error('成品超过 32MB，请关闭颗粒或选择较小的原片')
    const { finish, defaults } = await savePhotoStudioFinish(id, snapshot, blob, reuseForNewPhotos.value)
    emit('saved', finish, defaults); savedRecipe.value = JSON.stringify(snapshot)
    emit('update:modelValue', false)
  } catch (err) { error.value = err.message }
  finally { action.value = '' }
}
async function enlarge() {
  if (!rendered.value || busy.value) return
  action.value = 'preview'
  try {
    closeLightbox()
    lightboxUrl = comparing.value ? '' : URL.createObjectURL(await finishBlob(rendered.value))
    lightboxImages.value = [comparing.value ? props.photo.output_url : lightboxUrl]; lightboxOpen.value = true
  } catch (err) { error.value = err.message }
  finally { action.value = '' }
}
function closeLightbox() {
  lightboxOpen.value = false
  if (lightboxUrl) { const url = lightboxUrl; setTimeout(() => URL.revokeObjectURL(url), 400); lightboxUrl = '' }
}
function releasePreview() {
  if (props.modelValue && !disposed) return
  if (rendered.value) rendered.value.width = rendered.value.height = 1
  rendered.value = null; source.value = null; thumbnails.value = {}
}
onBeforeUnmount(() => { disposed = true; loadVersion++; clearTimeout(timer); closeLightbox(); releasePreview() })
</script>

<style scoped>
.finish-heading { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:8px; }
.finish-title { margin:0; display:flex; align-items:center; gap:12px; color:var(--studio-ink); font-size:clamp(22px,3vw,32px); font-weight:950; letter-spacing:-.04em; line-height:1.2; }
.finish-title svg { width:36px; height:36px; fill:none; stroke:var(--studio-tag); stroke-width:2.5; transform:rotate(-8deg); }
.finish-close-icon { width:24px; height:24px; fill:none; stroke:currentColor; stroke-width:2; }
.finish-mode { display:flex; gap:8px; border-bottom:1px solid var(--studio-ink); padding-bottom:6px; }

.finish-workspace { display:grid; flex:1; min-height:0; padding:12px; overflow:hidden; grid-template-columns:minmax(0,1fr) minmax(280px,340px); gap:24px; color:var(--studio-ink); }
.finish-proof,.finish-options { min-width:0; }
.finish-proof { display:flex; flex-direction:column; min-height:0; container-type:inline-size; }
.finish-stage { flex:1; min-height:240px; position:relative; padding:20px; background:url('../../assets/studio-photocopy.svg'),var(--studio-film); border-block:8px solid var(--studio-film-edge); display:grid; place-items:center; overflow:hidden; }
.finish-canvas { width:100%; height:100%; min-height:0; display:flex; align-items:center; justify-content:center; transition:opacity .3s; }
.finish-canvas :deep(canvas) { display:block; max-width:100%; max-height:100%; object-fit:contain; }
.finish-canvas.is-comparing { opacity:0; }
.finish-original { position:absolute; inset:20px; width:calc(100% - 40px); height:calc(100% - 40px); object-fit:contain; }
.finish-placeholder { position:absolute; color:var(--studio-film-muted); font-size:var(--fs-sm); }
.finish-original-label { position:absolute; left:12px; top:12px; padding:4px 8px; background:var(--studio-paper); color:var(--studio-ink); font-size:var(--fs-sm); }
.finish-proof-actions { flex-shrink:0; display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:8px; margin-top:12px; }
.finish-proof-main-actions { grid-column:2; display:flex; flex-wrap:wrap; max-width:100%; justify-content:center; gap:8px; }
.finish-reuse { grid-column:3; justify-self:end; }
.finish-filter-tools { display:flex; flex-direction:column; align-items:stretch; gap:8px; }
@container(max-width:500px) {
  .finish-proof-actions { grid-template-columns:1fr; }
  .finish-proof-main-actions { grid-column:1; justify-self:center; }
  .finish-reuse { grid-column:1; }
}
.finish-options { display:flex; flex-direction:column; min-height:0; overflow:hidden; gap:16px; padding:2px 4px 4px 18px; border-left:1px dashed var(--studio-line); scrollbar-width:thin; scrollbar-color:var(--studio-line) transparent; }
.finish-options > * { flex-shrink:0; }
.finish-options > .finish-choice-panel { flex:1 1 0; min-height:0; overflow-y:auto; }
.finish-choice-panel { display:flex; flex-direction:column; gap:16px; padding:2px 3px 8px; scrollbar-width:thin; scrollbar-color:var(--studio-line) transparent; }
.finish-choice-panel > * { flex-shrink:0; }
.finish-adjustments { flex:none; padding-top:10px; border-top:1px dashed var(--studio-line); background:var(--studio-paper); }
.finish-adjustments { min-height:77px; }
.finish-border-adjustment { min-height:66px; }
.finish-intensity-meta { display:flex; align-items:center; justify-content:flex-end; gap:8px; min-height:30px; }
.finish-choices { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.finish-choice { min-width:0; position:relative; padding:5px 5px 8px; border:1px solid transparent; border-bottom:2px solid var(--studio-line); background:transparent; cursor:pointer; text-align:center; transition:border-color .3s,background .3s; }
.finish-choice:hover { border-color:var(--studio-line); }.finish-choice.is-selected { border-color:var(--studio-tag); background:var(--studio-accent-soft); box-shadow:inset 0 -3px 0 var(--studio-tag); }
.finish-choice:focus-visible { outline:2px solid var(--studio-accent); outline-offset:3px; }
.finish-choice.is-disabled { opacity:.5; cursor:default; }
.finish-choice-image { height:84px; display:grid; place-items:center; margin-bottom:7px; }
.finish-choice-image img { max-width:100%; max-height:84px; object-fit:contain; }
.finish-choice span { font-size:var(--fs-sm); line-height:1.4; }
.finish-check { position:absolute; top:3px; right:5px; color:var(--studio-accent); font-weight:700; }
.finish-setting { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:var(--fs-sm); }
.finish-caption { display:flex; flex-direction:column; gap:8px; font-size:var(--fs-sm); }
.finish-message { margin:0; color:var(--studio-muted); font-size:var(--fs-sm); line-height:1.6; overflow-wrap:anywhere; }
.finish-message.is-error { color:var(--danger); }
.finish-status { color:var(--studio-muted); font-size:var(--fs-sm); line-height:1.5; }
.finish-footer-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:6px; width:100%; }
.finish-tab-enter-active,.finish-tab-leave-active { transition:opacity .3s; }
.finish-tab-enter-from,.finish-tab-leave-to { opacity:0; }
.finish-layers-enter-active,.finish-layers-leave-active { transition:opacity .3s,transform .3s; }
.finish-layers-enter-from,.finish-layers-leave-to { opacity:0; transform:translateX(8px); pointer-events:none; }
@media(max-width:760px) {
  .finish-workspace { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); gap:14px; }
  .finish-options { border-left:0; padding-left:0; gap:8px; }
  .finish-stage { flex:none; height:clamp(90px,calc(100dvh - 620px),30dvh); min-height:0; padding:10px; }
  .finish-stage.has-filter-layers { min-height:180px; }
  .finish-original { inset:12px; width:calc(100% - 24px); height:calc(100% - 24px); }
  .finish-choices { display:flex; overflow-x:auto; gap:8px; padding:3px 3px 8px; scrollbar-width:thin; scrollbar-color:var(--studio-line) transparent; }
  .finish-choice { flex:0 0 82px; }
  .finish-choice-image,.finish-choice-image img { height:68px; max-height:68px; }
}
@media(max-width:760px) and (max-height:760px) {
  .finish-stage { height:clamp(90px,calc(100dvh - 620px),26dvh); min-height:0; }
  .finish-workspace { gap:8px; }.finish-options { gap:6px; }.finish-adjustments { padding-top:6px; }
  .finish-proof-actions { margin-top:8px; }.finish-title { gap:8px; }.finish-title svg { width:28px; height:28px; }
  .finish-status { font-size:11px; }.finish-choice-image,.finish-choice-image img { height:56px; max-height:56px; }
}
@media(max-width:760px) and (max-height:600px) { .finish-workspace { gap:8px; }.finish-proof-actions { margin-top:6px; }.finish-choice-image,.finish-choice-image img { height:44px; max-height:44px; } }
@media(min-width:600px) and (max-width:760px) and (max-height:600px) {
  .finish-workspace { grid-template-columns:minmax(0,1fr) minmax(240px,1fr); grid-template-rows:minmax(0,1fr); gap:16px; }
  .finish-stage { flex:1; height:auto; min-height:90px; }
  .finish-choices { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); overflow-x:visible; }
  .finish-choice { padding-inline:2px; }.finish-proof-actions { gap:4px; }
}
@media(prefers-reduced-motion:reduce) { .finish-canvas,.finish-choice,.finish-tab-enter-active,.finish-tab-leave-active,.finish-layers-enter-active,.finish-layers-leave-active { transition:none; } }
</style>
