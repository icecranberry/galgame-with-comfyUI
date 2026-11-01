<template>
  <linshe-modal v-model="visibleModel" :title="`衣服库 · ${sceneLabel} — ${displayName}`" full panel-class="clothing-library-panel" body-class="clothing-library-body" :transition-ms="300">
    <p class="library-intro">选择服装 tag → 生成提示词 → 应用到「{{ sceneLabel }}」。身体特征沿用默认外观，回到详情卡保存后生效。</p>
    <div v-if="loading" class="empty" role="status">正在加载衣服库…</div>
    <div v-else-if="loadError" class="library-error" role="alert">{{ loadError }} <linshe-button size="sm" @click="loadCatalog">重新加载</linshe-button></div>
    <div v-else class="library-workspace">
      <linshe-tabs v-model="mobilePanel" class="library-mobile-tabs" :options="[{ value: 'browse', label: '浏览衣服' }, { value: 'draft', label: `生成提示词 · ${tags.length}` }]" aria-label="衣服库内容" />
      <div class="library-layout" :class="`is-${mobilePanel}`">
      <section class="library-browser" aria-label="服装词条">
        <linshe-tabs v-model="category" class="library-categories" :options="categoryOptions" size="sm" aria-label="服装分类" />
        <div class="library-filters">
          <label class="library-field"><span>搜索服装</span><linshe-input v-model="query" size="lg" placeholder="中文名称、英文 tag、材质…" aria-label="搜索服装" /></label>
          <div class="library-field"><span>细分类型</span><linshe-select v-model="subcategory" :options="subcategoryOptions" size="lg" searchable aria-label="细分类型" /></div>
        </div>
        <div class="library-results-head">
          <linshe-tabs v-model="scope" :options="[{ value: 'all', label: '全部词条' }, { value: 'selected', label: `只看已选 · ${tags.length}` }]" size="sm" aria-label="词条范围" />
          <span class="library-count" role="status">{{ filtered.length ? `已显示 ${visibleEntries.length} / ${filtered.length}` : '0 个匹配' }}</span>
        </div>
        <p v-if="scene === 'sleep'" class="library-hint">睡衣必须赤脚，已隐藏鞋袜词条。</p>
        <div ref="listViewport" class="library-list-viewport" tabindex="0" aria-label="服装列表，向下滚动自动加载更多" @scroll.passive="loadMoreIfNeeded">
        <Transition name="library-fade" mode="out-in" @before-enter="restoreListPosition" @after-enter="finishFiltering">
          <div :key="`${category}:${subcategory}:${query}:${scope}`" class="library-grid">
            <div
v-for="item in visibleEntries" :key="item.tag" class="library-item" :class="{ 'is-selected': tags.includes(item.tag), 'is-disabled': !!disabledReason(item) }"
              role="button" :tabindex="disabledReason(item) ? -1 : 0" :aria-pressed="tags.includes(item.tag)" :aria-disabled="!!disabledReason(item)"
              :aria-label="`${item.label}，${item.tag}${disabledReason(item) ? `，${disabledReason(item)}` : ''}`" :title="disabledReason(item) || item.description"
              @click="toggleTag(item)" @keydown.enter.prevent="toggleTag(item)" @keydown.space.prevent="toggleTag(item)"
>
              <div class="library-item-copy">
                <div class="library-item-heading"><strong>{{ item.label }}</strong><span class="library-choice" aria-hidden="true">{{ tags.includes(item.tag) ? '✓' : '+' }}</span></div>
                <code>{{ item.tag }}</code>
                <p>{{ item.description }}</p>
                <span v-if="disabledReason(item)" class="library-item-note">{{ disabledReason(item) }}</span>
              </div>
            </div>
            <div v-if="!filtered.length" class="library-empty"><strong>{{ scope === 'selected' && !tags.length ? '还没有选择服装' : '没有找到匹配的词条' }}</strong><p>可以切换分类、清除筛选，或返回全部词条继续挑选。</p><linshe-button size="sm" @click="clearFilters">查看全部词条</linshe-button></div>
            <p v-else class="library-list-end">{{ hasMore ? '继续向下滚动，自动显示更多' : `已显示全部 ${filtered.length} 个词条` }}</p>
          </div>
        </Transition>
        </div>
      </section>
      <section class="library-selection" aria-label="生成提示词">
        <div class="library-section">
        <div class="library-selected-head"><h3>已选搭配 <span>{{ tags.length }} / 32</span></h3><linshe-button variant="link" size="sm" :disabled="busy || !tags.length" @click="tags = []">清空</linshe-button></div>
        <div class="library-selected-tags">
          <linshe-button v-for="tag in tags" :key="tag" variant="chip" active :disabled="busy" :title="tag" :aria-label="`移除 ${entryMap.get(tag)?.label || tag}`" @click="tags = tags.filter(value => value !== tag)">{{ entryMap.get(tag)?.label || tag }} ×</linshe-button>
          <p v-if="!tags.length" class="library-hint">选取单品、颜色、材质与细节，可跨分类组合。点击词条添加，再次点击移除。</p>
        </div>
        </div>
        <div class="library-section">
        <label class="library-section-label" for="clothing-library-brief">补充要求 <span>可选</span></label>
        <linshe-input id="clothing-library-brief" v-model="brief" type="textarea" size="lg" :rows="3" :maxlength="2000" :disabled="busy" placeholder="例如：上衣扎进裙腰，金色纽扣" />
        <p class="library-hint">未指定的细节由邻舍补全。</p>
        <linshe-button variant="secondary" :loading="busy" :disabled="busy || !tags.length" @click="generateDraft">{{ busy ? '正在生成…' : result ? '重新生成提示词' : '生成服装提示词' }}</linshe-button>
        <p v-if="error" class="library-error" role="alert">{{ error }}</p>
        </div>
        <div class="library-section library-result" aria-label="外观提示词">
          <div class="library-selected-head"><h3>外观提示词</h3><linshe-tabs v-if="result || resultMode === 'edit'" v-model="resultMode" :options="[{ value: 'read', label: '阅读' }, { value: 'edit', label: '编辑' }]" size="sm" aria-label="提示词显示方式" /></div>
          <Transition name="library-fade" mode="out-in">
            <p v-if="!result && resultMode !== 'edit'" key="empty" class="library-hint">生成后在这里预览和编辑，确认后应用到「{{ sceneLabel }}」。</p>
            <div v-else-if="resultMode === 'read'" key="read" class="library-prompt" tabindex="0" aria-label="外观提示词预览">{{ result }}</div>
            <linshe-input v-else id="clothing-library-result" key="edit" v-model="result" type="textarea" size="lg" :rows="12" aria-label="编辑外观提示词" />
          </Transition>
          <p v-if="result" class="library-hint">改选 tag 或修改补充要求后，需要重新生成。应用后请回到详情卡保存。</p>
        </div>
      </section>
      </div>
    </div>
    <template #footer>
      <linshe-button variant="primary" :disabled="busy || !result.trim()" @click="apply">应用到「{{ sceneLabel }}」</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import * as api from '../api/index.js'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import { useClothingDraft, getSavedClothingTags } from '../composables/useClothingDraft.js'

const props = defineProps({
  modelValue: Boolean,
  generateHandler: { type: Function, default: null },
  characterId: { type: [Number, String], default: null },
  displayName: { type: String, default: '' },
  basePrompt: { type: String, default: '' },
  currentAppearance: { type: String, default: '' },
  scene: { type: String, default: 'work' },
  sceneLabel: { type: String, default: '默认' },
})
const emit = defineEmits(['update:modelValue', 'applied'])
const visibleModel = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const catalog = ref({ categories: [], entries: [] })
const loading = ref(false)
const loadError = ref('')
const query = ref('')
const category = ref('all')
const subcategory = ref('all')
const BATCH_SIZE = 24
const visibleCount = ref(BATCH_SIZE)
const scope = ref('all')
const mobilePanel = ref('browse')
const resultMode = ref('read')
const listViewport = ref(null)
let filtering = false
const { tags, brief, result, error, busy, createDraft, reset, cancel } = useClothingDraft(payload => (props.generateHandler || api.generateClothingAppearanceDraft)(payload), () => ({ characterId: props.characterId, basePrompt: props.basePrompt, scene: props.scene }))

async function loadCatalog() {
  loading.value = true
  loadError.value = ''
  try {
    catalog.value = await api.getClothingLibrary()
    if (props.modelValue) restoreSelection()
  }
  catch (err) { loadError.value = err.message || '衣服库加载失败' }
  finally { loading.value = false }
}
const entryMap = computed(() => new Map(catalog.value.entries.map(entry => [entry.tag, entry])))
// 仅展示当前场景适用的词条；生成中、达到选择上限属于临时状态，不改变列表。
function isAvailableEntry(entry) {
  return entry.kind === 'outfit' && !(props.scene === 'sleep' && entry.categories.some(value => ['鞋子', '袜子'].includes(value)))
}
const availableEntries = computed(() => catalog.value.entries.filter(isAvailableEntry))
const categoryOptions = computed(() => {
  const categories = new Set(availableEntries.value.flatMap(entry => entry.categories))
  return [{ value: 'all', label: '全部分类' }, ...catalog.value.categories.filter(option => categories.has(option.value))]
})
const categoryEntries = computed(() => availableEntries.value.filter(entry => category.value === 'all' || entry.categories.includes(category.value)))
const subcategoryOptions = computed(() => [{ value: 'all', label: '全部子类' }, ...[...new Set(categoryEntries.value.flatMap(entry => entry.subcategories))].map(value => ({ value, label: value }))])
const filtered = computed(() => {
  const search = query.value.trim().toLowerCase().replace(/_/g, ' ')
  const entries = categoryEntries.value.filter(entry => (scope.value !== 'selected' || tags.value.includes(entry.tag)) && (subcategory.value === 'all' || entry.subcategories.includes(subcategory.value)) && (!search || `${entry.tag} ${entry.label} ${entry.description}`.toLowerCase().replace(/_/g, ' ').includes(search)))
  if (!search) return entries
  const score = entry => {
    const tag = entry.tag.toLowerCase().replace(/_/g, ' ')
    if (tag === search || entry.label === search) return 0
    return `${tag} ${entry.label}`.toLowerCase().includes(search) ? 1 : 2
  }
  return entries.sort((a, b) => score(a) - score(b))
})
const visibleEntries = computed(() => filtered.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filtered.value.length)
watch(category, () => { subcategory.value = 'all' })
watch(scope, value => {
  if (value === 'selected') { category.value = 'all'; subcategory.value = 'all'; query.value = '' }
})
watch([tags, brief], () => { resultMode.value = 'read' }, { deep: true })
watch([query, category, subcategory, scope], () => {
  filtering = true
  visibleCount.value = BATCH_SIZE
})
watch([visibleCount, () => filtered.value.length, mobilePanel], () => nextTick(loadMoreIfNeeded), { flush: 'post' })
watch(listViewport, (viewport, _, onCleanup) => {
  if (!viewport) return
  filtering = false
  const observer = new ResizeObserver(loadMoreIfNeeded)
  observer.observe(viewport)
  onCleanup(() => observer.disconnect())
  nextTick(loadMoreIfNeeded)
}, { flush: 'post' })
watch(() => [props.modelValue, props.characterId, props.scene], ([open], previous) => {
  if (open) {
    reset(); clearFilters(); mobilePanel.value = 'browse'; resultMode.value = 'read'; visibleCount.value = BATCH_SIZE
    if (!catalog.value.entries.length && !loading.value) loadCatalog()
    else if (catalog.value.entries.length) restoreSelection()
  } else if (previous?.[0]) cancel()
}, { immediate: true })
function restoreSelection() {
  tags.value = getSavedClothingTags(props.currentAppearance).filter(tag => {
    const entry = entryMap.value.get(tag)
    return entry && isAvailableEntry(entry)
  })
}
function disabledReason(item) {
  if (busy.value) return '正在生成，请稍候'
  if (item.kind !== 'outfit') return '动作 / 场景 tag，不用于静态外观'
  if (props.scene === 'sleep' && item.categories.some(value => ['鞋子', '袜子'].includes(value))) return '睡衣必须赤脚，不穿鞋袜'
  if (tags.value.length >= 32 && !tags.value.includes(item.tag)) return '最多选择 32 个 tag'
  return ''
}
function toggleTag(item) {
  if (disabledReason(item)) return
  tags.value = tags.value.includes(item.tag) ? tags.value.filter(tag => tag !== item.tag) : [...tags.value, item.tag]
}
function clearFilters() {
  query.value = ''; category.value = 'all'; subcategory.value = 'all'; scope.value = 'all'; visibleCount.value = BATCH_SIZE
}
function restoreListPosition() {
  if (!listViewport.value) return
  listViewport.value.scrollTop = 0
}
function finishFiltering() {
  filtering = false
  loadMoreIfNeeded()
}
function loadMoreIfNeeded() {
  const viewport = listViewport.value
  if (!props.modelValue || filtering || !hasMore.value || !viewport?.clientHeight) return
  if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 240) {
    visibleCount.value = Math.min(visibleCount.value + BATCH_SIZE, filtered.value.length)
  }
}
async function generateDraft() {
  resultMode.value = 'read'
  await createDraft()
}
function apply() {
  if (busy.value || !result.value.trim()) return
  emit('applied', { characterId: props.characterId, scene: props.scene, appearance: result.value.trim() })
  visibleModel.value = false
}
</script>

<style scoped>
.library-intro, .library-hint, .library-count { color: var(--text-secondary); font-size: var(--fs-base); line-height: 1.65; }
.library-intro { margin: 0 0 16px; flex-shrink: 0; }
.library-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 12px; }
.library-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, .52fr); gap: 24px; flex: 1; min-height: 0; }
.library-browser, .library-selection { min-width: 0; min-height: 0; }
.library-browser { display: flex; flex-direction: column; gap: 12px; }
.library-mobile-tabs { display: none; }
.library-categories { grid-template-columns: repeat(5, minmax(0, 1fr)); grid-auto-flow: row; flex-shrink: 0; }
.library-filters { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; align-items: end; }
.library-field { display: flex; flex-direction: column; min-width: 0; gap: 6px; font-size: var(--fs-base); color: var(--text-secondary); }
.library-results-head, .library-selected-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.library-count { font-variant-numeric: tabular-nums; }
.library-list-viewport { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 4px; }
.library-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 8px; align-items: stretch; }
.library-item { border: 1.5px solid var(--border); border-radius: var(--radius-md); background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; text-align: left; transition: background-color .3s var(--ease-standard), border-color .3s var(--ease-standard); }
.library-item:hover:not(.is-disabled) { border-color: var(--accent); }
.library-item:focus-visible, .library-list-viewport:focus-visible, .library-prompt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.library-item.is-selected { border-color: var(--accent); background: rgba(var(--accent-rgb), .12); }
.library-item.is-disabled { cursor: not-allowed; background: var(--bg-tertiary); }
.library-item-copy { padding: 10px 12px; }
.library-item-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.library-item-copy strong { font-size: var(--fs-md); line-height: 1.4; overflow-wrap: anywhere; }
.library-choice { flex-shrink: 0; font-size: var(--fs-lg); font-weight: 700; color: var(--text-secondary); }
.is-selected .library-choice { color: var(--accent); }
.is-disabled .library-choice { visibility: hidden; }
.library-item-copy code { display: block; color: var(--text-secondary); margin-top: 2px; font-family: ui-monospace, Consolas, monospace; font-size: var(--fs-sm); line-height: 1.4; overflow-wrap: anywhere; }
.library-item-copy p { margin: 4px 0 0; font-size: var(--fs-base); line-height: 1.5; overflow-wrap: anywhere; }
.library-item-note { display: block; margin-top: 4px; font-size: var(--fs-sm); color: var(--text-secondary); }
.library-list-end { grid-column: 1 / -1; margin: 8px 0; text-align: center; color: var(--text-secondary); font-size: var(--fs-base); }
.library-selection { display: flex; flex-direction: column; gap: 24px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 0 4px 4px 24px; border-left: 1px solid var(--border); }
.library-section { display: flex; flex-direction: column; gap: 12px; }
.library-section + .library-section { padding-top: 20px; border-top: 1px solid var(--border); }
.library-selected-head h3, .library-section-label { margin: 0; font-size: var(--fs-lg); font-weight: 700; color: var(--text-primary); }
.library-selected-head h3 span, .library-section-label span { margin-left: 4px; font-size: var(--fs-base); font-weight: 400; color: var(--text-secondary); }
.library-selected-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.library-hint { margin: 0; }
.library-error { color: var(--danger); font-size: var(--fs-md); line-height: 1.6; }
.library-prompt { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-lg); line-height: 1.85; color: var(--text-primary); }
.library-empty { grid-column: 1 / -1; text-align: center; padding: 32px 16px; font-size: var(--fs-md); color: var(--text-secondary); line-height: 1.75; }
.library-fade-enter-active, .library-fade-leave-active { transition: opacity .3s var(--ease-standard); }
.library-fade-enter-from, .library-fade-leave-to { opacity: 0; }
@media (max-width: 900px) {
  .library-mobile-tabs { display: grid; }
  .library-layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .library-browser, .library-selection { grid-area: 1 / 1; transition: opacity .3s var(--ease-standard), visibility 0s; }
  .is-browse .library-selection, .is-draft .library-browser { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .3s var(--ease-standard), visibility 0s .3s; }
  .library-selection { border-left: 0; padding-left: 4px; }
}
@media (max-width: 480px) {
  .library-intro { display: none; }
  .library-browser { gap: 8px; }
  .library-filters { gap: 8px; }
  .library-field > span { font-size: var(--fs-sm); }
  .library-results-head { gap: 4px; }
  .library-item-copy { padding: 8px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .library-fade-enter-active, .library-fade-leave-active, .library-item, .library-browser, .library-selection { transition: none !important; }
}
</style>

<style>
/* 仅调整衣服库布局，窗体与控件皮肤沿用 Linshe。 */
.clothing-library-panel { --modal-full-width: min(1280px, 96vw); }
.linshe-modal .modal-body.clothing-library-body { display: flex; flex-direction: column; overflow: hidden; }
@media (max-width: 480px), (max-height: 500px) {
  .linshe-modal .modal-body.clothing-library-body { padding: 12px; }
}
/* 横屏矮窗口让整个正文滚动，避免筛选栏挤没词条。 */
@media (max-height: 600px) {
  .linshe-modal .modal-body.clothing-library-body { overflow-y: auto; }
  .clothing-library-body .library-workspace { min-height: 440px; flex-shrink: 0; }
}
</style>
