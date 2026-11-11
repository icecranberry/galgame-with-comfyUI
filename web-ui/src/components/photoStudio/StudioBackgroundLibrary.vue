<template>
  <linshe-modal v-model="visible" title="背景场景库" variant="film" full full-height :transition-ms="300" body-class="modal-workspace-body">
    <template #header-extra><span class="modal-header-stat">场景<strong class="modal-header-stat-value">{{ catalog.entries.length }}</strong></span></template>
    <template #close="{ close }"><studio-button variant="icon" aria-label="关闭背景库" @click="close()">×</studio-button></template>
    <div class="backdrop-layout">
      <section class="backdrop-browser" aria-label="背景目录">
        <linshe-tabs v-model="mode" variant="film" :options="modes" :disabled="busy" aria-label="背景来源" />
        <Transition name="backdrop-content" mode="out-in">
          <div v-if="mode === 'library'" key="library" class="backdrop-library">
            <div class="backdrop-filters" role="group" aria-label="背景分类">
              <studio-button v-for="option in categoryOptions" :key="option.value" variant="chip" size="compact" :active="category === option.value" :aria-pressed="category === option.value" @click="category = option.value">{{ option.label }}</studio-button>
            </div>
            <div class="backdrop-index"><span>{{ filtered.length }} 个场景</span></div>
            <p v-if="loading" class="backdrop-note" role="status">正在翻开背景目录…</p>
            <div v-else-if="loadError" class="backdrop-load-error" role="alert"><p class="backdrop-note">{{ loadError }}</p><studio-button size="sm" @click="loadCatalog">重新加载</studio-button></div>
            <div v-else ref="sceneScroll" class="backdrop-scroll">
              <Transition name="backdrop-content" mode="out-in">
                <div :key="category" class="backdrop-scenes">
                  <div v-for="entry in filtered" :key="entry.id" class="backdrop-scene" :class="{ 'is-selected': selectedId === entry.id }" role="button" tabindex="0" :aria-pressed="selectedId === entry.id" @click="selectedId = entry.id" @keydown.enter.prevent="selectedId = entry.id" @keydown.space.prevent="selectedId = entry.id">
                    <div class="backdrop-scene-heading"><span class="backdrop-number">{{ entry.id.slice(-3) }}</span><strong>{{ entry.label }}</strong><span class="backdrop-check" aria-hidden="true">{{ selectedId === entry.id ? '✓' : '↗' }}</span></div><p>{{ entry.description }}</p>
                  </div>
                  <p v-if="!filtered.length" class="backdrop-note">该分类暂无场景。</p>
                </div>
              </Transition>
            </div>
          </div>
          <div v-else key="custom" class="backdrop-custom">
            <label for="studio-background-brief">写下你想拍摄的地方</label>
            <studio-input id="studio-background-brief" v-model="description" type="textarea" :rows="8" :maxlength="1500" :disabled="busy" placeholder="例如：雨后的旧街，路灯倒映在石板路上，远处有一家亮着暖灯的花店。" />
            <p class="backdrop-note">支持中文或英文，确认后转换为英文场景提示词。</p>
          </div>
        </Transition>
      </section>
      <section class="backdrop-preview" aria-label="本次拍摄背景">
        <div class="backdrop-preview-heading"><h3>本次背景</h3></div>
        <Transition name="backdrop-content" mode="out-in">
          <div :key="mode === 'custom' ? 'custom' : selectedId" class="backdrop-proof">
            <span class="backdrop-proof-category">{{ mode === 'custom' ? '自定义场景' : selected?.category || '默认背景' }}</span>
            <strong>{{ mode === 'custom' ? '你的取景地' : selected?.label || '白色背景' }}</strong>
            <p>{{ mode === 'custom' ? description || '把地点、时间与光线写在左侧。' : selected?.description || '白色无缝背景，硬质定向光与强烈阴影。' }}</p>
          </div>
        </Transition>
        <studio-button class="backdrop-random" variant="primary" block :disabled="busy || loading || !!loadError || !randomCandidates.length" title="从全部背景中随机挑选" @click="randomize">随机挑选 ↗</studio-button>
        <p v-if="error" class="backdrop-error" role="alert">{{ error }}</p>
        <p v-if="busy" class="backdrop-note" role="status">正在整理英文场景提示词…</p>
      </section>
    </div>
    <template #footer><studio-button variant="link" :disabled="busy || (!value && !selectedId && !description)" @click="clear">恢复白色背景</studio-button><studio-button variant="primary" :loading="busy" :disabled="busy || (mode === 'custom' && !description.trim())" @click="apply">{{ busy ? '正在准备背景' : '用于本次拍摄' }}</studio-button></template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { getPhotoStudioBackgrounds, generatePhotoStudioBackground } from '../../api/index.js'
import LinsheModal from '../ui/LinsheModal.vue'
import LinsheTabs from '../ui/LinsheTabs.vue'
import StudioButton from './StudioButton.vue'
import StudioInput from './StudioInput.vue'

const props = defineProps({ modelValue: Boolean, value: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue', 'applied'])
const visible = computed({ get: () => props.modelValue, set: value => { if (!value) cancel(); emit('update:modelValue', value) } })
const catalog = ref({ categories: [], entries: [] }), loading = ref(false), loadError = ref('')
const modes = [{ value: 'library', label: '场景目录' }, { value: 'custom', label: '自定义' }]
const sceneScroll = ref(null)
const mode = ref('library'), category = ref('all'), selectedId = ref(''), description = ref('')
const busy = ref(false), error = ref('')
let revision = 0, controller
const categoryOptions = computed(() => [{ value: 'all', label: '全部分类' }, ...catalog.value.categories])
const selected = computed(() => catalog.value.entries.find(entry => entry.id === selectedId.value))
const filtered = computed(() => catalog.value.entries.filter(entry => category.value === 'all' || entry.category === category.value))
const randomCandidates = computed(() => catalog.value.entries.filter(entry => entry.id !== selectedId.value))
function randomize() {
  if (!props.modelValue || busy.value || loading.value || loadError.value || !randomCandidates.value.length) return
  const entry = randomCandidates.value[Math.floor(Math.random() * randomCandidates.value.length)]
  mode.value = 'library'
  category.value = entry.category
  selectedId.value = entry.id
}
async function loadCatalog() {
  if (loading.value) return
  loading.value = true; loadError.value = ''
  try { catalog.value = await getPhotoStudioBackgrounds() } catch (err) { loadError.value = err.message } finally { loading.value = false }
}
function cancel() { revision++; controller?.abort(); controller = undefined; busy.value = false }
watch(() => props.modelValue, open => {
  cancel()
  if (!open) return
  mode.value = props.value?.source === 'custom' ? 'custom' : 'library'
  selectedId.value = props.value?.source === 'library' ? props.value.id : ''
  description.value = props.value?.source === 'custom' ? props.value.description : ''
  category.value = 'all'; error.value = ''
  if (!catalog.value.entries.length) void loadCatalog()
}, { immediate: true })
watch([mode, description, selectedId], () => { error.value = '' })
watch(category, () => { if (sceneScroll.value) sceneScroll.value.scrollTop = 0 })
onBeforeUnmount(cancel)
function commit(value) { emit('applied', value); visible.value = false }
function clear() { if (props.modelValue && !busy.value) commit(null) }
async function apply() {
  if (!props.modelValue || busy.value) return
  if (mode.value === 'library') {
    commit(selected.value ? { ...selected.value, source: 'library' } : null)
    return
  }
  const brief = description.value.trim()
  if (!brief) return
  if (props.value?.source === 'custom' && props.value.description === brief && props.value.prompt) { commit({ ...props.value }); return }
  const current = ++revision
  controller = new AbortController(); busy.value = true; error.value = ''
  try {
    const { prompt } = await generatePhotoStudioBackground({ description: brief, signal: controller.signal })
    if (current !== revision || !props.modelValue) return
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('没有获得有效的背景提示词，请重试')
    commit({ source: 'custom', label: '自定义背景', description: brief, prompt })
  } catch (err) { if (current === revision && props.modelValue) error.value = err.message }
  finally { if (current === revision) { busy.value = false; controller = undefined } }
}
</script>

<style scoped>
.backdrop-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;height:100%;min-height:0;color:var(--studio-ink)}
.backdrop-browser{display:flex;flex-direction:column;min-width:0;min-height:0;gap:18px;padding:20px;background:url('../../assets/studio-photocopy.svg'),var(--studio-paper)}
.backdrop-library{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px}.backdrop-filters{display:flex;flex-wrap:wrap;gap:8px;flex-shrink:0}.backdrop-index{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:2px solid var(--studio-ink);font:12px/1.5 monospace;color:var(--studio-muted)}
.backdrop-scroll{overflow:auto;min-height:0;flex:1;padding:0 3px}.backdrop-scenes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.backdrop-scene{padding:17px 8px;border-bottom:1px dashed var(--studio-line);cursor:pointer;text-align:left;transition:background .3s,box-shadow .3s}.backdrop-scene:hover,.backdrop-scene.is-selected{background:color-mix(in srgb,var(--studio-tag) 9%,transparent)}.backdrop-scene.is-selected{box-shadow:inset 3px 0 var(--studio-tag)}.backdrop-scene:focus-visible{outline:2px solid var(--studio-tag);outline-offset:-2px}.backdrop-scene-heading{display:flex;align-items:baseline;gap:10px}.backdrop-number{font:11px/1.5 monospace;color:var(--studio-muted)}.backdrop-scene-heading strong{font-size:15px}.backdrop-check{margin-left:auto;color:var(--studio-tag);font-weight:900}.backdrop-scene p{margin:7px 0 0;font-size:12px;line-height:1.7;color:var(--studio-muted)}
.backdrop-preview{padding:24px 20px;background:var(--studio-bg);border-left:1px solid var(--studio-ink);overflow:auto}.backdrop-preview-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.backdrop-preview-heading h3{margin:0;font-size:23px;font-weight:900}.backdrop-proof{margin:24px 0;padding:24px 0;border-top:3px solid var(--studio-ink);border-bottom:1px dashed var(--studio-line);overflow-wrap:anywhere}.backdrop-proof-category{display:inline-block;color:var(--studio-tag);font-size:12px;font-weight:800}.backdrop-proof>strong{display:block;margin:14px 0;font-size:32px;line-height:1.3;letter-spacing:-1px}.backdrop-proof p{margin:0;font-size:14px;line-height:1.9;white-space:pre-wrap;max-height:38dvh;overflow:auto}.backdrop-note,.backdrop-error{margin:0;font-size:13px;line-height:1.8;color:var(--studio-muted)}.backdrop-error{color:var(--fun-orange)}.backdrop-load-error{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.backdrop-custom{display:flex;flex-direction:column;gap:14px;overflow:auto}.backdrop-custom>label{font-size:16px;font-weight:800}
.backdrop-content-enter-active,.backdrop-content-leave-active{transition:opacity .3s,transform .3s}.backdrop-content-enter-from,.backdrop-content-leave-to{opacity:0;transform:translateY(5px)}
@media(max-width:700px){.backdrop-layout{grid-template-columns:1fr;height:auto;overflow:auto}.backdrop-browser{padding:14px;min-height:360px;max-height:58dvh;flex-shrink:0}.backdrop-filters{max-height:132px;overflow:auto;gap:6px}.backdrop-scenes{gap:0 10px}.backdrop-scene{padding:14px 5px}.backdrop-scene-heading{gap:6px}.backdrop-scene-heading strong{font-size:14px}.backdrop-number{font-size:10px}.backdrop-preview{border-left:0;border-top:2px solid var(--studio-ink);padding:18px 14px;overflow:visible}.backdrop-proof{margin:16px 0 0;padding:16px 0}.backdrop-random{margin-top:12px}.backdrop-proof>strong{font-size:26px}.backdrop-proof p{max-height:22dvh}}
@media(prefers-reduced-motion:reduce){.backdrop-content-enter-active,.backdrop-content-leave-active,.backdrop-scene{transition:none}.backdrop-content-enter-from,.backdrop-content-leave-to{transform:none}}
</style>
