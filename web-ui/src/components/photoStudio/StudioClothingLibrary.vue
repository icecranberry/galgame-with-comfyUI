<template>
  <linshe-modal v-model="visible" title="服装 tag 库" variant="film" full full-height :transition-ms="300" body-class="modal-workspace-body">
    <template #title-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M9.5 6a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.1-1.5 2.5V12M12 12 3.2 17.3A1.5 1.5 0 0 0 4 20h16a1.5 1.5 0 0 0 .8-2.7L12 12Z" /></svg></template>
    <template #header-extra><span class="modal-header-stat">{{ slotKey === 'first' ? '主角' : '搭档' }}<strong class="modal-header-stat-value">{{ tags.length }} / 32</strong></span></template>
    <template #close="{ close }"><studio-button variant="icon" aria-label="关闭服装库" @click="close()">×</studio-button></template>
    <div v-if="loading" class="wardrobe-status" role="status">正在翻开服装目录…</div>
    <div v-else-if="loadError" class="wardrobe-status" role="alert">{{ loadError }}<studio-button size="sm" @click="loadCatalog">重新加载</studio-button></div>
    <div v-else class="wardrobe-layout">
      <section class="wardrobe-browser" aria-label="服装目录">
        <div class="wardrobe-filters">
          <studio-input v-model="query" placeholder="搜索服装、英文 tag 或材质" aria-label="搜索服装" />
          <studio-filter-options v-model="category" :options="categoryOptions" label="服装分类" />
          <Transition name="wardrobe-content" @after-leave="checkScroll">
            <div v-if="category !== 'all'">
              <studio-filter-options v-model="subcategory" :options="subcategoryOptions" label="服装子类" />
            </div>
          </Transition>
        </div>
        <div class="wardrobe-index"><span>WARDROBE / INDEX</span><span>{{ filtered.length }} 个词条</span></div>
        <div ref="scrollRoot" class="wardrobe-scroll" @scroll.passive="checkScroll">
          <Transition name="wardrobe-content" mode="out-in" @after-enter="checkScroll">
            <div :key="`${query}:${category}:${subcategory}`" class="wardrobe-tags">
              <div v-for="entry in visibleEntries" :key="entry.tag" role="button" tabindex="0" class="wardrobe-tag" :class="{ 'is-selected': tags.includes(entry.tag), 'is-disabled': busy || (tags.length >= 32 && !tags.includes(entry.tag)) }" :aria-pressed="tags.includes(entry.tag)" :aria-disabled="busy || (tags.length >= 32 && !tags.includes(entry.tag))" @click="toggle(entry.tag)" @keydown.enter.prevent="toggle(entry.tag)" @keydown.space.prevent="toggle(entry.tag)">
                <span class="wardrobe-tag-top"><strong>{{ entry.label }}</strong><span aria-hidden="true">{{ tags.includes(entry.tag) ? '✓' : '+' }}</span></span>
                <code>{{ entry.tag }}</code><p>{{ entry.description }}</p>
              </div>
              <p v-if="!filtered.length" class="wardrobe-hint">没有匹配的词条，试试其他分类或关键词。</p>
            </div>
          </Transition>
          <div v-if="visibleEntries.length < filtered.length" ref="loadSentinel" class="wardrobe-load-sentinel" aria-hidden="true"></div>
        </div>
      </section>
      <section class="wardrobe-draft" aria-label="本次拍摄搭配">
        <div class="wardrobe-draft-heading"><h3>本次搭配</h3><studio-button variant="link" size="sm" :disabled="busy || !tags.length" @click="tags = []">清空</studio-button></div>
        <div class="wardrobe-selected"><studio-button v-for="tag in tags" :key="tag" size="sm" :disabled="busy" :aria-label="`移除 ${entryMap.get(tag)?.label || tag}`" @click="toggle(tag)">{{ entryMap.get(tag)?.label || tag }} ×</studio-button><p v-if="!tags.length" class="wardrobe-hint">从目录挑选服装、颜色与材质。</p></div>
        <studio-input v-model="brief" type="textarea" :rows="2" :maxlength="2000" :disabled="busy" placeholder="自定义服装（可选，只做英文翻译）" aria-label="自定义服装" />
        <p v-if="error" class="wardrobe-error" role="alert">{{ error }}</p>
        <p class="wardrobe-hint">所选 tag 直接加入提示词；自定义描述仅翻译，不生成角色外观。</p><div v-if="promptText" class="wardrobe-prompt" aria-label="本次服装提示词">{{ promptText }}</div>
      </section>
    </div>
    <template #footer><studio-button v-if="outfit || draft" variant="link" size="sm" :disabled="busy" @click="clearOutfit">清除本次搭配</studio-button><span class="wardrobe-footer-note">只用于本次拍摄，不改写角色衣柜。</span><studio-button variant="primary" :loading="busy" :disabled="busy || (!tags.length && !brief.trim())" @click="apply">{{ busy ? '正在翻译服装' : '用于本次拍摄' }}</studio-button></template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { getClothingLibrary, generateStudioClothingDraft } from '../../api/index.js'
import LinsheModal from '../ui/LinsheModal.vue'
import StudioInput from './StudioInput.vue'
import StudioFilterOptions from './StudioFilterOptions.vue'
import StudioButton from './StudioButton.vue'

const props = defineProps({ modelValue: Boolean, slotKey: { type: String, default: 'first' }, outfit: { type: Object, default: null }, draft: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'applied', 'draft-change'])
const visible = computed({ get: () => props.modelValue, set: value => { if (!value) cancel(); emit('update:modelValue', value) } })
const catalog = ref({ categories: [], entries: [] }), loading = ref(false), loadError = ref('')
const query = ref(''), category = ref('all'), subcategory = ref('all'), limit = ref(60)
const scrollRoot = ref(null), loadSentinel = ref(null)
let paging = false, disposed = false
const tags = ref([]), brief = ref(''), translatedBrief = ref(''), customPrompt = ref(''), error = ref(''), busy = ref(false)
let revision = 0, controller
let restoring = false, editingSlot = null
const promptText = computed(() => [tags.value.join(', '), brief.value.trim() === translatedBrief.value ? customPrompt.value : ''].filter(Boolean).join(', '))
function cancel() { revision++; controller?.abort(); controller = undefined; busy.value = false }
watch(brief, () => { cancel(); error.value = '' }, { flush: 'sync' })
watch([tags, brief], () => {
  if (restoring || !props.modelValue || editingSlot !== props.slotKey) return
  emit('draft-change', { slot: editingSlot, outfit: {
    tags: [...tags.value], brief: brief.value,
    customPrompt: brief.value.trim() === translatedBrief.value ? customPrompt.value : '',
  } })
}, { deep: true, flush: 'sync' })
onBeforeUnmount(cancel)
const entries = computed(() => catalog.value.entries.filter(entry => entry.kind === 'outfit'))
const entryMap = computed(() => new Map(entries.value.map(entry => [entry.tag, entry])))
const categoryOptions = computed(() => [{ value: 'all', label: '全部分类' }, ...catalog.value.categories.filter(category => entries.value.some(entry => entry.categories.includes(category.value)))])
const categoryEntries = computed(() => entries.value.filter(entry => category.value === 'all' || entry.categories.includes(category.value)))
const subcategoryOptions = computed(() => [{ value: 'all', label: '全部子类' }, ...[...new Set(categoryEntries.value.flatMap(entry => entry.subcategories))].map(value => ({ value, label: value }))])
const filtered = computed(() => { const term = query.value.trim().toLowerCase().replaceAll('_', ' '); return categoryEntries.value.filter(entry => (subcategory.value === 'all' || entry.subcategories.includes(subcategory.value)) && (!term || `${entry.label} ${entry.tag} ${entry.description}`.toLowerCase().replaceAll('_', ' ').includes(term))) })
const visibleEntries = computed(() => filtered.value.slice(0, limit.value))
watch(category, () => { subcategory.value = 'all' })
watch([query, category, subcategory], () => { limit.value = 60; if (scrollRoot.value) scrollRoot.value.scrollTop = 0 })
async function loadMore() {
  if (disposed || !props.modelValue || loading.value || paging || limit.value >= filtered.value.length) return
  paging = true
  limit.value = Math.min(limit.value + 60, filtered.value.length)
  await nextTick()
  paging = false
  checkScroll()
}
function checkScroll() {
  const root = scrollRoot.value
  if (root?.clientHeight > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 180) void loadMore()
}
watch([scrollRoot, loadSentinel, () => props.modelValue], ([root, sentinel, open], _, onCleanup) => {
  if (!open || !root || !sentinel || typeof IntersectionObserver === 'undefined') return
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) void loadMore()
  }, { root, rootMargin: '180px 0px' })
  observer.observe(sentinel)
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })
onBeforeUnmount(() => { disposed = true })
async function loadCatalog() {
  loading.value = true; loadError.value = ''
  try { catalog.value = await getClothingLibrary() } catch (err) { loadError.value = err.message } finally { loading.value = false }
}
// Clothing belongs to a shooting slot; changing its occupant must preserve this draft.
watch([() => props.modelValue, () => props.slotKey], ([open]) => {
  if (!open) { cancel(); return }
  const saved = props.draft ?? props.outfit
  restoring = true
  cancel(); editingSlot = props.slotKey
  tags.value = [...(saved?.tags || [])]; brief.value = saved?.brief || ''
  translatedBrief.value = brief.value.trim(); customPrompt.value = saved?.customPrompt || ''; error.value = ''
  restoring = false
  query.value = ''; category.value = 'all'; subcategory.value = 'all'; limit.value = 60
  if (scrollRoot.value) scrollRoot.value.scrollTop = 0
  if (!catalog.value.entries.length) void loadCatalog()
}, { immediate: true })
function toggle(tag) {
  if (busy.value) return
  if (tags.value.includes(tag)) tags.value = tags.value.filter(value => value !== tag)
  else if (tags.value.length < 32) tags.value = [...tags.value, tag]
}
function clearOutfit() {
  if (!props.modelValue || busy.value) return
  emit('applied', { slot: props.slotKey, outfit: null })
  visible.value = false
}
async function apply() {
  if (!props.modelValue || busy.value || (!tags.value.length && !brief.value.trim())) return
  const current = ++revision, slot = props.slotKey, selectedTags = [...tags.value], text = brief.value.trim()
  error.value = ''
  let prompt = text ? customPrompt.value : ''
  if (text && (text !== translatedBrief.value || !prompt)) {
    controller = new AbortController(); busy.value = true
    try {
      const response = await generateStudioClothingDraft({ brief: text, signal: controller.signal })
      if (current !== revision || disposed || !props.modelValue || slot !== props.slotKey) return
      if (!response?.prompt?.trim()) throw new Error('翻译结果为空，请重试')
      prompt = response.prompt.trim(); translatedBrief.value = text; customPrompt.value = prompt
    } catch (err) { if (current === revision) error.value = err.message; return }
    finally { if (current === revision) { busy.value = false; controller = undefined } }
  }
  if (current !== revision || disposed || !props.modelValue || slot !== props.slotKey) return
  emit('applied', { slot, outfit: { tags: selectedTags, brief: text, customPrompt: prompt } })
  visible.value = false
}

</script>

<style scoped>
.wardrobe-layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;min-height:0;height:100%;color:var(--studio-ink)}
.wardrobe-browser{display:flex;flex-direction:column;min-height:0;min-width:0;padding:20px;background:url('../../assets/studio-photocopy.svg'),var(--studio-paper)}
.wardrobe-filters{display:flex;flex-direction:column;gap:10px;max-height:min(300px,38dvh);overflow:auto;flex-shrink:0;padding:4px;scrollbar-color:var(--studio-muted) var(--studio-paper)}.wardrobe-filters>*{flex-shrink:0}
.wardrobe-index{display:flex;justify-content:space-between;gap:12px;padding:16px 0 10px;font:12px/1.5 monospace;color:var(--studio-muted);border-bottom:2px solid var(--studio-ink)}
.wardrobe-scroll{flex:1;min-height:0;overflow:auto;padding:12px 3px}.wardrobe-tags{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:0 18px}
.wardrobe-tag{padding:14px 4px;min-width:0;border-bottom:1px dashed var(--studio-line);cursor:pointer;text-align:left;transition:background .3s,color .3s,box-shadow .3s}.wardrobe-tag-top{display:flex;justify-content:space-between;gap:10px;font-size:15px}.wardrobe-tag-top>span{color:var(--studio-tag);font-weight:900}.wardrobe-tag code{display:block;margin-top:6px;font-size:12px;overflow-wrap:anywhere;color:var(--studio-muted)}.wardrobe-tag p{margin:7px 0 0;font-size:12px;line-height:1.6;color:var(--studio-muted)}
.wardrobe-tag:hover,.wardrobe-tag.is-selected{background:color-mix(in srgb,var(--studio-tag) 9%,transparent)}.wardrobe-tag.is-selected{box-shadow:inset 3px 0 var(--studio-tag);padding-inline:12px 4px}.wardrobe-tag:focus-visible{outline:2px solid var(--studio-tag);outline-offset:1px}.wardrobe-tag.is-disabled{opacity:.5;cursor:not-allowed}
.wardrobe-draft{min-width:0;overflow:auto;padding:20px;border-left:1px solid var(--studio-ink);background:var(--studio-bg);display:flex;flex-direction:column;gap:16px}.wardrobe-draft>*{flex-shrink:0}.wardrobe-draft-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.wardrobe-draft h3{margin:0;font-size:23px;font-weight:900}.wardrobe-selected{display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow:auto}.wardrobe-hint,.wardrobe-error{margin:0;font-size:13px;line-height:1.7;color:var(--studio-muted)}.wardrobe-error{color:var(--fun-orange)}.wardrobe-footer-note{margin-right:auto;font-size:12px;line-height:1.6;color:var(--studio-muted)}.wardrobe-status{padding:32px;display:flex;gap:16px;align-items:center;font-size:14px}
.wardrobe-content-enter-active,.wardrobe-content-leave-active{transition:opacity .3s,transform .3s}.wardrobe-content-enter-from,.wardrobe-content-leave-to{opacity:0;transform:translateY(5px)}
.wardrobe-load-sentinel{height:1px}
.wardrobe-prompt{font:12px/1.8 monospace;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--studio-muted)}
@media(max-width:700px){.wardrobe-layout{grid-template-columns:1fr;overflow:auto;height:auto}.wardrobe-browser,.wardrobe-draft{padding:14px}.wardrobe-browser{min-height:min(480px,62dvh);max-height:62dvh;flex-shrink:0}.wardrobe-filters{max-height:min(220px,28dvh)}.wardrobe-draft{border-left:0;border-top:2px solid var(--studio-ink);overflow:visible}.wardrobe-tags{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.wardrobe-tag-top{font-size:14px}.wardrobe-tag p{font-size:12px}.wardrobe-footer-note{flex-basis:100%}}
</style>
