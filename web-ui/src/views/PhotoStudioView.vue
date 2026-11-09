<template>
  <main class="studio-page">
    <header class="studio-header">
      <div class="studio-heading">
        <span class="studio-club">LINSHE / UNDERGROUND PHOTO CLUB</span>
        <h1>照相馆<span class="studio-raw" aria-hidden="true"><span>FILM</span><span>CYPHER</span></span></h1>
        <svg class="studio-tagline" viewBox="0 0 300 30" fill="none" aria-hidden="true"><path d="M4 19C74 1 178 1 289 9M38 25C122 13 198 17 252 22" stroke="currentColor" stroke-width="5" stroke-linecap="round" /></svg>
      </div>
      <div class="studio-stamp" aria-hidden="true"><span>STREET</span><strong>底片现场</strong><span>PORTRAIT SESSIONS</span></div>
      <div class="studio-header-actions">
        <studio-button variant="nav" size="sm" :aria-pressed="showHistory" @click="showHistory = !showHistory">{{ showHistory ? '返回取景' : '拍摄记录' }}</studio-button>
      </div>
    </header>
    <Transition name="studio-content" mode="out-in">
    <div v-if="showHistory" key="history" class="studio-history"><div class="history-heading"><h2>拍摄记录</h2><span>{{ jobs.length }} / 30</span></div><div v-if="jobs.length" class="history-grid"><article v-for="job in jobs" :key="job.id" class="history-item"><img v-if="job.output_url" :src="job.output_url" :alt="`${jobCharacters(job)} · ${job.pose_name}`" @click="openPhoto(job.output_url)" /><div v-else class="history-pending">{{ job.status === 'running' ? '冲印中…' : '拍摄失败' }}</div><div class="history-caption"><strong>{{ jobCharacters(job) }}</strong><span>{{ job.pose_name }}<template v-if="job.width && job.height"> · {{ job.width }} × {{ job.height }}</template></span><small v-if="job.error">{{ job.error }}</small></div></article></div><div v-else class="studio-empty">第一张照片还在等你拍摄。</div></div>
    <section v-else key="viewfinder" class="studio-body">
      <aside ref="posePanel" class="studio-pose" tabindex="-1"><div class="rail-title"><div><h2><span class="panel-number" aria-hidden="true">01</span>姿势底稿</h2></div><span v-if="recognizedPoses.length" class="rail-count">{{ recognizedPoses.length }} 张已识别</span></div><div class="pose-card" @click="poseOpen = true" @keydown.enter.prevent="poseOpen = true" @keydown.space.prevent="poseOpen = true" role="button" tabindex="0" aria-label="打开全屏姿势图库"><img v-if="selectedPose" :src="poseAsset(selectedPose.thumbnail)" :alt="selectedPose.name" /><div v-else class="pose-placeholder">姿势图库加载中…</div></div><div class="pose-caption"><strong>{{ selectedPose?.name || '请选择一个已识别的姿势' }}</strong><span>{{ selectedPose?.category }} · {{ selectedPose?.system }}</span></div><studio-button variant="secondary" size="sm" block :disabled="recognizedPoses.length < 2" @click="randomizePose"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-linecap="round" stroke-width="3" /></svg>随机姿势</studio-button><div class="studio-settings"><h3>画幅设定<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" /></svg></h3><linshe-tabs class="size-ratios" variant="film" v-model="aspectRatio" size="sm" :options="aspectRatioOptions" aria-label="照片比例"><template #option="{ option }"><span class="ratio-option"><svg viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect :x="(28 - option.iconWidth) / 2" :y="(24 - option.iconHeight) / 2" :width="option.iconWidth" :height="option.iconHeight" rx="2" :stroke-dasharray="option.value === 'custom' ? '3 2' : undefined" /></svg><span>{{ option.label }}</span></span></template></linshe-tabs><div class="size-controls" aria-label="成片尺寸"><div class="size-control"><div><span>宽度</span><strong>{{ width }} px</strong></div><linshe-slider variant="film" :model-value="width" :min="dimensionControls.width.min" :max="dimensionControls.width.max" :step="dimensionControls.width.step" aria-label="成片宽度" @update:model-value="setWidth" /></div><div class="size-control"><div><span>高度</span><strong>{{ height }} px</strong></div><linshe-slider variant="film" :model-value="height" :min="dimensionControls.height.min" :max="dimensionControls.height.max" :step="dimensionControls.height.step" aria-label="成片高度" @update:model-value="setHeight" /></div></div></div></aside>
      <section class="studio-darkroom"><div class="film-frame-edge" aria-hidden="true"><span>35 / STUDIO</span><i></i><span>▸ 01</span></div><div v-if="capability && !capability.available" class="studio-error" role="status">{{ capability.error }}</div><div class="portrait-mat"><span class="film-margin-note" aria-hidden="true"><span>SIDE A</span><span>FILM CLUB</span></span><div v-if="activeJob" class="developing-state"><div class="spinner"></div><h3>{{ stageLabel(activeJob.stage) }}</h3><p>正在为 {{ jobCharacters(activeJob) }} 冲印 {{ activeJob.pose_name }}</p><div class="develop-track"><span :style="{ transform: `scaleX(${Math.max(.06, activeJob.progress || 0)})` }"></span></div></div><figure v-else-if="currentPhoto" class="photo-print" :class="{ 'is-peeking': photoFlash }" :style="{ '--photo-aspect': photoAspect }"><img :src="currentPhoto.output_url" :alt="`${jobCharacters(currentPhoto)} · ${currentPhoto.pose_name}`" @load="revealPhoto(currentPhoto.id)" @error="pendingPhotoId = ''" @click="openPhoto(currentPhoto.output_url)" /><span v-if="photoFlash" class="photo-flash" aria-hidden="true"></span><figcaption><strong>{{ jobCharacters(currentPhoto) }}</strong><span>{{ currentPhoto.pose_name }}</span></figcaption></figure><div v-else class="empty-negative"><span class="negative-mark">✳</span><span>主角，就差你了。</span><p>选好姿势与角色，拍下这一幕。</p></div></div><div class="portrait-actions"><div class="portrait-selection"><span class="next-shot">下一张</span><strong>{{ shootCharactersLabel }}</strong><span>{{ selectedPose?.name || '尚未选姿势' }} · {{ width }} × {{ height }}</span></div><div class="mobile-studio-links"><studio-button variant="link" size="sm" @click="jumpToPanel(characterPanel)">选角色 ↗</studio-button><studio-button variant="link" size="sm" @click="jumpToPanel(posePanel)" title="调整姿势与画幅">姿势 ↗</studio-button></div><studio-button variant="primary" size="lg" :disabled="shootDisabled" :loading="shooting" @click="shoot"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.5" /></svg>{{ activeJob ? '正在冲印' : shooting ? '准备中…' : '按下快门 / SHOOT' }}</studio-button></div><div v-if="lastFailure && !activeJob" class="studio-error" role="status"><span>{{ lastFailure }}</span><studio-button variant="ghost" size="sm" @click="lastFailure = ''">知道了</studio-button></div></section>
      <aside ref="characterPanel" class="studio-characters" tabindex="-1"><div class="rail-title"><div><h2><span class="panel-number" aria-hidden="true">02</span>入镜人物</h2></div><span class="rail-count">{{ sortedCharacters.length }}</span></div><div class="character-slot-tools"><linshe-tabs v-model="characterSlot" variant="film" size="sm" :options="characterSlotOptions" aria-label="选择主角或搭档" /><studio-button v-if="characterSlot === 'second' && secondCharacterId" variant="ghost" size="sm" @click="secondCharacterId = ''">改为随机</studio-button></div><div class="character-grid"><div v-for="(character, characterIndex) in sortedCharacters" :key="character.id" class="character-choice" :title="character.display_name || character.name" :aria-label="character.display_name || character.name" :class="{ selected: isSelectedSlot(character), 'is-other-slot': isOtherSlot(character) }" role="button" tabindex="0" :aria-pressed="isSelectedSlot(character)" @click="selectCharacter(character)" @keydown.enter.prevent="selectCharacter(character)" @keydown.space.prevent="selectCharacter(character)"><div class="character-face"><img v-if="character.avatar_path || character.standing_url" :src="character.avatar_path || character.standing_url" alt="" loading="lazy" /><span v-else>{{ (character.display_name || character.name).slice(0, 1) }}</span><i v-if="characterSlotNumber(character)" :aria-label="characterSlotNumber(character) === 1 ? '主角' : '搭档'">{{ characterSlotNumber(character) === 1 ? '主角' : '搭档' }}</i></div><span class="contact-number" aria-hidden="true">{{ String(characterIndex + 1).padStart(2, '0') }}</span><span class="character-name">{{ character.display_name || character.name }}</span></div></div><div v-if="selectedPose?.system?.includes('双人')" class="reference-hint">双人姿势使用主角 + 搭档；未指定搭档时会随机选择一位。</div><div v-if="!characters.length" class="rail-empty">没有可选择的角色</div></aside>
    </section>
    </Transition>

    <linshe-modal v-model="poseOpen" title="已识别姿势" full full-height body-class="pose-library-body"><template #close="{ close, disabled }"><studio-button variant="icon" :disabled="disabled" aria-label="关闭姿势图库" @click="close()"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></studio-button></template><div class="library-tools"><linshe-input v-model="query" size="sm" placeholder="搜索动作、分类或编号…" aria-label="搜索姿势" /><linshe-select v-model="systemFilter" size="sm" :options="systemOptions" aria-label="姿势体系" placeholder="全部体系" /><linshe-select v-model="categoryFilter" size="sm" :options="categoryOptions" aria-label="姿势分类" placeholder="全部分类" /><linshe-select v-model="angleFilter" size="sm" :options="angleOptions" aria-label="相机角度" placeholder="全部角度" /><span class="library-count">{{ filteredPoses.length.toLocaleString() }} 张已识别，可用于拍摄</span></div><div class="pose-gallery-grid"><article v-for="pose in visiblePoses" :key="pose.id" :aria-label="`${pose.name}，${pose.category}，${pose.angle}，已识别`" class="pose-option" :class="{ selected: pose.id === poseId }" role="button" tabindex="0" :aria-pressed="pose.id === poseId" @click="selectPose(pose)" @keydown.enter.prevent="selectPose(pose)" @keydown.space.prevent="selectPose(pose)"><div class="pose-option-image"><img :src="poseAsset(pose.thumbnail)" alt="" loading="lazy" decoding="async" /><span>{{ pose.angle }}</span><i v-if="pose.id === poseId">✓</i></div><strong>{{ pose.name }}</strong><span>{{ pose.category }} · {{ pose.group }}</span></article></div><div v-if="visiblePoses.length < filteredPoses.length" class="load-more"><studio-button variant="secondary" size="sm" @click="loadMorePoses">继续浏览 {{ Math.min(filteredPoses.length - visiblePoses.length, 240) }} 张</studio-button></div></linshe-modal>
    <Teleport to="body"><div style="--vel-z-index: 14000"><ImageLightbox :visible="photoOpen" :imgs="[lightboxUrl]" :index="0" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="photoOpen = false" /></div></Teleport>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { usePhotoStudio } from '../composables/usePhotoStudio.js'
import StudioButton from '../components/photoStudio/StudioButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'
import LinsheSlider from '../components/ui/LinsheSlider.vue'
import LinsheTabs from '../components/ui/LinsheTabs.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import { PHOTO_ASPECT_RATIOS, clampPhotoDimension, inferPhotoAspectRatio, photoDimensionControls, resizePhoto } from '../utils/photoStudioDimensions.js'

const posePanel = ref(null), characterPanel = ref(null)
function jumpToPanel(panel) {
  if (!panel) return
  panel.focus({ preventScroll: true })
  panel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
}
const { catalog, characters, jobs, capability, load, poll, create } = usePhotoStudio()
const saved = (() => { try { return JSON.parse(sessionStorage.getItem('photo-studio-selection') || '{}') } catch { return {} } })()
const poseId = ref(saved.poseId || ''), characterId = ref(saved.characterId || ''), secondCharacterId = ref(saved.secondCharacterId || '')
const width = ref(clampPhotoDimension(saved.width || 1200)), height = ref(clampPhotoDimension(saved.height || 1600)), characterSlot = ref('first')
const aspectRatio = ref([...PHOTO_ASPECT_RATIOS, 'custom'].includes(saved.aspectRatio) ? saved.aspectRatio : inferPhotoAspectRatio(width.value, height.value))
const poseOpen = ref(false), photoOpen = ref(false), showHistory = ref(false), shooting = ref(false), photoFlash = ref(false)
const query = ref(''), systemFilter = ref(''), categoryFilter = ref(''), angleFilter = ref('')
const lightboxUrl = ref(''), lastFailure = ref(''), selectedJobId = ref(sessionStorage.getItem('photo-studio-job') || ''), visiblePoseCount = ref(240)
let pollTimer, listTimer, flashTimer, studioReady = false, pendingPhotoId = '', disposed = false
const characterSlotOptions = [{ label: '主角', value: 'first' }, { label: '搭档', value: 'second' }]
const aspectRatioOptions = PHOTO_ASPECT_RATIOS.map(value => {
  const [w, h] = value.split(':').map(Number)
  const scale = 20 / Math.max(w, h)
  return { label: value, value, iconWidth: w * scale, iconHeight: h * scale }
})
aspectRatioOptions.push({ label: '自定义', value: 'custom', iconWidth: 19, iconHeight: 19 })
const selectedPose = computed(() => catalog.value.find(item => item.id === poseId.value))
const recognizedPoses = computed(() => catalog.value.filter(item => !!item.posePrompt))
const selectedCharacter = computed(() => characters.value.find(item => Number(item.id) === Number(characterId.value)))
const selectedSecondCharacter = computed(() => characters.value.find(item => Number(item.id) === Number(secondCharacterId.value)))
const activeJob = computed(() => jobs.value.find(item => item.status === 'running'))
const currentPhoto = computed(() => jobs.value.find(item => item.id === selectedJobId.value && item.status === 'done') || jobs.value.find(item => item.status === 'done'))
const characterCollator = new Intl.Collator('zh-u-co-pinyin', { sensitivity: 'base', numeric: true })
const sortedCharacters = computed(() => [...characters.value].sort((a, b) => characterCollator.compare(a.display_name || a.name || '', b.display_name || b.name || '') || Number(a.id) - Number(b.id)))
const duoPose = computed(() => !!selectedPose.value?.system?.includes('双人') || /^pair/i.test(selectedPose.value?.id || ''))
const shootCharactersLabel = computed(() => {
  const first = selectedCharacter.value?.display_name || selectedCharacter.value?.name || '尚未选人'
  if (!duoPose.value) return first
  return `${first} + ${selectedSecondCharacter.value?.display_name || selectedSecondCharacter.value?.name || '随机搭档'}`
})
const systemOptions = computed(() => [{ label: '全部体系', value: '' }, ...unique('system').map(value => ({ label: value, value }))])
const categoryOptions = computed(() => [{ label: '全部分类', value: '' }, ...unique('category').map(value => ({ label: value, value }))])
const angleOptions = computed(() => [{ label: '全部角度', value: '' }, ...unique('angle').map(value => ({ label: value, value }))])
const filteredPoses = computed(() => { const term = query.value.trim().toLowerCase(); return recognizedPoses.value.filter(item => (!systemFilter.value || item.system === systemFilter.value) && (!categoryFilter.value || item.category === categoryFilter.value) && (!angleFilter.value || item.angle === angleFilter.value) && (!term || `${item.name} ${item.category} ${item.group} ${item.system} ${item.id}`.toLowerCase().includes(term))) })
const visiblePoses = computed(() => filteredPoses.value.slice(0, visiblePoseCount.value))
const shootDisabled = computed(() => shooting.value || !!activeJob.value || !capability.value?.available || !selectedPose.value?.posePrompt || !selectedCharacter.value)
const dimensionControls = computed(() => photoDimensionControls(aspectRatio.value))
const photoAspect = computed(() => Number(currentPhoto.value?.width) / Number(currentPhoto.value?.height) || 3 / 4)
function unique(field) { return [...new Set(catalog.value.filter(item => !systemFilter.value || item.system === systemFilter.value).map(item => item[field]))].sort((a, b) => a.localeCompare(b, 'zh')) }
function loadMorePoses() { visiblePoseCount.value += 240 }
function syncAspect(anchor) {
  const dimensions = resizePhoto({ width: width.value, height: height.value, ratio: aspectRatio.value, anchor })
  width.value = dimensions.width
  height.value = dimensions.height
}
function setWidth(value) { width.value = clampPhotoDimension(value); syncAspect('width') }
function setHeight(value) { height.value = clampPhotoDimension(value); syncAspect('height') }
watch(aspectRatio, value => { if (value !== 'custom') syncAspect('width') })
function persistSelection() { sessionStorage.setItem('photo-studio-selection', JSON.stringify({ poseId: poseId.value, characterId: characterId.value, secondCharacterId: secondCharacterId.value, width: width.value, height: height.value, aspectRatio: aspectRatio.value })) }
watch([poseId, characterId, secondCharacterId, width, height, aspectRatio], persistSelection)
watch([query, systemFilter, categoryFilter, angleFilter], () => { visiblePoseCount.value = 240 })
watch(() => currentPhoto.value?.id, (id, previousId) => {
  if (!studioReady || !id || id === previousId || showHistory.value) return
  pendingPhotoId = id
  photoFlash.value = false
})
function revealPhoto(id) {
  // Wait for the actual image to decode; API completion alone can precede a slow image download.
  if (id !== pendingPhotoId || activeJob.value || showHistory.value) return
  pendingPhotoId = ''
  photoFlash.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { photoFlash.value = false }, 420)
}
watch(showHistory, () => {
  pendingPhotoId = ''
  photoFlash.value = false
  clearTimeout(flashTimer)
})
function poseAsset(relative) { return `/api/photo-studio/assets/${relative}` }
function randomizePose() {
  const candidates = recognizedPoses.value.filter(pose => pose.id !== poseId.value)
  if (!candidates.length) return
  selectPose(candidates[Math.floor(Math.random() * candidates.length)])
}
function selectPose(pose) { poseId.value = pose.id; poseOpen.value = false }
function isSelectedSlot(character) { return Number(character.id) === Number(characterSlot.value === 'first' ? characterId.value : secondCharacterId.value) }
function isOtherSlot(character) { return characterSlot.value === 'first' ? Number(character.id) === Number(secondCharacterId.value) : Number(character.id) === Number(characterId.value) }
function characterSlotNumber(character) { if (Number(character.id) === Number(characterId.value)) return 1; if (secondCharacterId.value && Number(character.id) === Number(secondCharacterId.value)) return 2; return 0 }
function selectCharacter(character) {
  if (characterSlot.value === 'first') {
    characterId.value = character.id
    if (Number(secondCharacterId.value) === Number(character.id)) secondCharacterId.value = ''
  } else {
    secondCharacterId.value = Number(character.id) === Number(characterId.value) ? '' : character.id
  }
}
function jobCharacters(job) { return [job.character_name, job.character2_name].filter(Boolean).join(' + ') }
function stageLabel(stage) { return ({ preparing: '正在架好相机', queued: '已进入暗房队列', generating: '正在拍摄', saving: '正在冲印照片' })[stage] || '正在拍摄' }
function openPhoto(url) { lightboxUrl.value = url; photoOpen.value = true }
async function shoot() { if (shootDisabled.value) return; shooting.value = true; lastFailure.value = ''; try { const job = await create({ id: crypto.randomUUID(), characterId: characterId.value, secondCharacterId: duoPose.value ? (secondCharacterId.value || null) : null, poseId: poseId.value, width: width.value, height: height.value }); selectedJobId.value = job.id; sessionStorage.setItem('photo-studio-job', job.id); await poll() } catch (error) { lastFailure.value = error.message } finally { shooting.value = false } }
onMounted(async () => { await load(); if (disposed) return; if (!recognizedPoses.value.some(item => item.id === poseId.value)) poseId.value = recognizedPoses.value[0]?.id || ''; if (!sortedCharacters.value.some(item => Number(item.id) === Number(characterId.value))) characterId.value = sortedCharacters.value[0]?.id || ''; if (Number(secondCharacterId.value) === Number(characterId.value)) secondCharacterId.value = ''; syncAspect('width'); await Promise.resolve(); if (disposed) return; studioReady = true; persistSelection(); pollTimer = setInterval(poll, 1800); listTimer = setInterval(load, 7000) })
onBeforeUnmount(() => { disposed = true; clearInterval(pollTimer); clearInterval(listTimer); clearTimeout(flashTimer) })
</script>

<style scoped>
.studio-history{max-width:1500px;margin:auto}.history-heading{display:flex;align-items:center;justify-content:space-between}.history-heading h2{font-family:var(--font-display,serif)}.history-heading>span{font-size:12px;color:var(--text-secondary)}.history-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px}.history-item{background:var(--studio-paper);padding:10px;border:1px solid var(--studio-line);box-shadow:0 4px 12px var(--studio-shadow)}.history-item>img,.history-pending{width:100%;aspect-ratio:3/4;object-fit:contain;border-radius:0}.history-item>img{cursor:zoom-in}.history-pending{display:grid;place-items:center;background:var(--bg-sunken);color:var(--text-secondary);font-size:13px}.history-caption{display:grid;gap:5px;padding:9px 3px 2px}.history-caption>span,.history-caption small{font-size:11px;color:var(--text-secondary)}.history-caption small{color:var(--fun-orange)}.studio-empty{padding:40px;text-align:center;color:var(--text-secondary)}
.library-tools{display:grid;grid-template-columns:minmax(180px,1fr) repeat(3,minmax(130px,190px)) auto;align-items:center;gap:9px;padding:2px 1px 14px}.library-count{font-size:11px;color:var(--text-secondary);text-align:right;white-space:nowrap}.pose-gallery-grid{height:min(66dvh,760px);overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));align-content:start;gap:15px;padding:5px 3px 16px}.pose-option{min-width:0;cursor:pointer;border-radius:var(--radius-md);padding:6px;display:grid;gap:5px;transition:background .3s,transform .3s}.pose-option:hover{background:var(--bg-sunken);transform:translateY(-2px)}.pose-option.selected{background:color-mix(in srgb,var(--accent-light) 65%,var(--bg-secondary))}.pose-option-image{position:relative;aspect-ratio:3/4;overflow:hidden;border-radius:var(--radius-md);background:var(--bg-sunken)}.pose-option-image img{width:100%;height:100%;object-fit:cover}.pose-option-image>span{position:absolute;left:6px;top:6px;padding:3px 6px;background:var(--bg-secondary);border-radius:var(--radius-full);font-size:9px}.pose-option-image>i{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:white;font-style:normal}.pose-option>strong,.pose-option>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pose-option>strong{font-size:11px}.pose-option>span{font-size:10px;color:var(--text-secondary)}.photo-lightbox-body{display:flex;justify-content:center;overflow:auto}.photo-lightbox-image{max-width:100%;max-height:70dvh;object-fit:contain}

/* Film darkroom: sprockets, contact prints and engraved camera controls. */
.studio-page { min-height:100dvh; padding:22px 30px 30px; color:var(--studio-ink); background:url('../assets/studio-photocopy.svg'),repeating-linear-gradient(174deg,transparent 0 75px,color-mix(in srgb,var(--studio-ink) 4%,transparent) 76px,transparent 78px 150px),var(--studio-bg); animation:studio-enter .3s ease both; }
.studio-header { width:100%; max-width:2200px; margin:0 auto 24px; padding:0 4px 12px; display:grid; grid-template-columns:1fr auto auto; align-items:center; gap:32px; min-height:126px; background:transparent; border-bottom:0; position:relative; }

.studio-heading { display:flex; flex-direction:column; align-items:flex-start; gap:4px; position:relative; padding:0; justify-self:start; }
.studio-heading h1 { display:flex; align-items:center; gap:25px; margin:0; font-family:inherit; font-size:clamp(52px,5.6vw,84px); font-weight:950; letter-spacing:-.08em; line-height:1; color:var(--studio-ink); }
.studio-club { font:800 11px/1.5 monospace; letter-spacing:.13em; color:var(--studio-muted); }
.studio-emblem { display:none; }.studio-raw { position:relative; color:var(--studio-tag); display:grid; gap:.08em; font:italic 900 .34em/1.12 Impact,"Arial Narrow",sans-serif; letter-spacing:.01em; transform:rotate(-13deg); text-decoration:none; }
.studio-raw::after { content:""; position:absolute; inset:-5px -10px; border:2px solid var(--studio-tag); border-radius:47% 42% 44% 38%; transform:rotate(7deg); }
.film-margin-note { position:absolute; left:76px; top:50%; width:220px; text-align:center; transform:translate(-50%,-50%) rotate(-90deg); transform-origin:center; display:grid; gap:.12em; font:900 clamp(24px,2vw,30px)/1.12 Impact,"Arial Narrow",sans-serif; letter-spacing:.01em; white-space:nowrap; color:color-mix(in srgb,var(--studio-film-text) 15%,transparent); pointer-events:none; }
.studio-tagline { width:210px; height:22px; color:var(--studio-tag); margin-top:-5px; }
.studio-stamp { display:grid; text-align:center; gap:2px; padding:9px 16px; color:var(--studio-ink); border:3px double var(--studio-ink); transform:rotate(7deg); background:var(--studio-paper); }
.studio-stamp::after { content:""; height:12px; margin-top:4px; background:repeating-linear-gradient(90deg,var(--studio-ink) 0 1px,transparent 1px 3px,var(--studio-ink) 3px 6px,transparent 6px 8px,var(--studio-ink) 8px 10px,transparent 10px 15px); }
.studio-stamp span { font:800 10px/1.3 monospace; letter-spacing:.13em; }.studio-stamp strong { font-size:24px; letter-spacing:-.07em; font-weight:950; }
.studio-header-actions { display:flex; gap:10px; align-items:center; }
.nav-icon { width:22px; height:22px; flex-shrink:0; }
.studio-body { width:100%; max-width:2200px; margin:auto; display:grid; grid-template-columns:244px minmax(0,1fr) 286px; gap:22px; height:max(680px,calc(100dvh - 196px)); align-items:stretch; }
.studio-pose,.studio-characters { display:flex; flex-direction:column; min-width:0; min-height:0; gap:12px; position:relative; padding:14px 12px; background:url('../assets/studio-photocopy.svg'),var(--studio-paper); box-shadow:0 4px 12px var(--studio-shadow); }
.studio-pose { transform:rotate(-.65deg); }.studio-characters { transform:rotate(.65deg); }
.studio-pose::after,.studio-characters::after { content:''; position:absolute; left:0; right:0; bottom:-7px; height:9px; background:var(--studio-paper); clip-path:polygon(0 0,100% 0,100% 80%,92% 44%,84% 100%,77% 53%,70% 85%,62% 45%,54% 92%,45% 40%,37% 100%,29% 56%,20% 87%,11% 43%,0 90%); pointer-events:none; }
.rail-title { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:5px; min-height:38px; padding:0 0 9px; border-bottom:1px dashed var(--studio-ink); }
.rail-title h2 { display:flex; align-items:center; gap:10px; margin:0; font-size:19px; font-weight:850; letter-spacing:-.03em; }
.panel-number { font:950 21px/1 Impact,sans-serif; color:var(--studio-tag); background:transparent; padding:0; }
.rail-count { font-size:11px; color:var(--studio-muted); white-space:nowrap; }
.pose-card { flex:1; min-height:120px; position:relative; padding:16px 8px 10px; background:var(--dialogue-photo-paper); border:1px solid var(--studio-line); box-shadow:none; cursor:pointer; transition:box-shadow .3s; }
.pose-card::before { content:""; position:absolute; top:-8px; left:calc(50% - 37px); width:74px; height:23px; background:repeating-linear-gradient(90deg,transparent 0 5px,color-mix(in srgb,var(--studio-film) 12%,transparent) 6px 7px),var(--studio-tape); transform:rotate(-5deg); clip-path:polygon(2% 0,100% 5%,97% 100%,0 93%); z-index:1; }
.pose-card>img { width:100%; height:100%; object-fit:contain; }.pose-card:hover { border-color:var(--studio-accent); box-shadow:0 6px 16px var(--studio-shadow); }
.pose-placeholder { display:grid; place-items:center; height:100%; color:var(--dialogue-photo-caption); }
.pose-caption { display:grid; gap:4px; padding-top:4px; }.pose-caption strong { font-size:14px; line-height:1.5; }.pose-caption>span { font-size:12px; color:var(--studio-muted); line-height:1.5; }
.studio-settings { flex-shrink:0; border-top:1px solid var(--studio-line); padding-top:12px; margin-top:4px; }
.studio-settings h3 { display:flex; align-items:center; justify-content:space-between; margin:0 0 8px; font-size:13px; font-weight:650; letter-spacing:.06em; }.studio-settings h3 svg { width:18px; height:18px; color:var(--studio-muted); }
.size-ratios { grid-auto-flow:row; grid-template-columns:repeat(4,minmax(0,1fr)); }.ratio-option { display:flex; flex-direction:column; gap:3px; align-items:center; font-size:12px; }.ratio-option svg { width:26px; height:24px; flex:none; }
.size-controls { display:grid; gap:4px; margin-top:10px; }.size-control { min-width:0; }.size-control>div { display:flex; align-items:baseline; justify-content:space-between; font-size:12px; color:var(--studio-muted); }.size-control strong { color:var(--studio-ink); font:500 13px/1.5 monospace; }
.studio-darkroom { display:flex; flex-direction:column; min-width:0; min-height:0; position:relative; isolation:isolate; background:var(--studio-film); border:0; border-radius:0; box-shadow:0 6px 16px var(--studio-shadow); overflow:hidden; }
.film-frame-edge { display:flex; align-items:center; gap:14px; height:20px; flex-shrink:0; padding:0 40px; color:var(--studio-film-muted); font:700 9px/1 monospace; letter-spacing:.14em; pointer-events:none; }
.film-frame-edge i { flex:1; height:4px; opacity:.4; background:repeating-linear-gradient(90deg,var(--studio-perforation) 0 1px,transparent 1px 12px); }
.portrait-mat { flex:1; min-height:0; container-type:size; display:grid; place-items:center; position:relative; overflow:hidden; padding:18px 44px 20px; background:linear-gradient(90deg,var(--studio-film-edge) 30px,transparent 30px,transparent calc(100% - 30px),var(--studio-film-edge) calc(100% - 30px)); }
.portrait-mat::before,.portrait-mat::after { content:''; position:absolute; top:12px; bottom:12px; width:12px; background:linear-gradient(var(--studio-perforation) 0 13px,transparent 13px 28px) 0 0 / 12px 28px repeat-y; pointer-events:none; opacity:.8; }.portrait-mat::before { left:9px; }.portrait-mat::after { right:9px; }
.photo-print { margin:0; display:flex; flex-direction:column; gap:8px; max-width:100%; max-height:100%; width:min(100cqw,calc((100cqh - 46px) * var(--photo-aspect) + 20px)); padding:10px; background:var(--dialogue-photo-paper); box-shadow:7px 6px 0 color-mix(in srgb,var(--studio-film-text) 16%,transparent),0 10px 30px var(--studio-shadow); position:relative; }
.photo-print::before { content:""; position:absolute; top:-9px; left:calc(50% - 44px); width:88px; height:20px; background:repeating-linear-gradient(90deg,transparent 0 5px,color-mix(in srgb,var(--studio-film) 14%,transparent) 6px 7px),var(--studio-tape); clip-path:polygon(0 8%,98% 0,100% 90%,2% 100%); transform:rotate(3deg); pointer-events:none; }
.photo-print img { display:block; width:100%; min-height:0; max-height:calc(100cqh - 46px); object-fit:contain; cursor:zoom-in; }
.photo-print figcaption { color:var(--dialogue-photo-caption); display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; font-size:12px; line-height:20px; }.photo-print figcaption strong,.photo-print figcaption span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.photo-print figcaption span { font-size:11px; }
.photo-print.is-peeking img { animation:photo-peek 420ms var(--ease-standard) both; }.photo-flash { position:absolute; inset:0; pointer-events:none; background:var(--dialogue-photo-paper); animation:photo-flash 420ms ease-out both; }
.portrait-actions { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; padding:14px 18px; background:var(--studio-paper); border-top:7px solid var(--studio-shutter); }
.portrait-selection { display:grid; gap:3px; min-width:0; }.portrait-selection strong { font-size:17px; font-weight:650; line-height:1.4; overflow-wrap:anywhere; }.portrait-selection>span { font-size:12px; color:var(--studio-muted); overflow-wrap:anywhere; }.portrait-selection .next-shot { font:10px/1.5 monospace; letter-spacing:.16em; }.portrait-actions>.studio-button { flex-shrink:0; }
.mobile-studio-links { display:none; }.mobile-studio-links>.studio-button { min-height:44px; }
.character-slot-tools { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }.character-slot-tools>.ls-tabs { flex:1; min-width:170px; }
.character-grid { flex:1; min-height:0; overflow:auto; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-auto-rows:max-content; gap:12px 8px; align-content:start; padding:8px; background:var(--studio-film); border:0; border-radius:0; scrollbar-color:var(--studio-shutter) var(--studio-film); }
.character-choice { min-width:0; position:relative; display:flex; flex-direction:column; align-items:center; gap:0; padding:4px 4px 0; cursor:pointer; border:1px solid transparent; background:transparent; text-align:center; transition:background .3s,border-color .3s,box-shadow .3s; }
.character-choice.selected { border-color:var(--studio-shutter); box-shadow:none; background:var(--studio-film-edge); }.character-choice.is-other-slot { border-color:var(--studio-film-muted); }
.character-choice.selected::after { content:''; position:absolute; inset:-2px; border:2px solid var(--studio-shutter); border-radius:35% 6% 30% 5%; transform:rotate(-4deg); pointer-events:none; }
.character-face { width:100%; aspect-ratio:1; flex:none; position:relative; background:var(--studio-film-edge); }.character-face img,.character-face>span { display:block; width:100%; height:100%; object-fit:cover; }.character-face>span { display:grid; place-items:center; font-size:25px; color:var(--studio-film-text); }.character-face i { position:absolute; left:0; bottom:0; padding:2px 5px; background:var(--studio-shutter); color:var(--studio-film); font-size:10px; font-style:normal; font-weight:600; }
.contact-number { align-self:flex-start; font:italic 700 12px/1.6 monospace; color:var(--studio-shutter); letter-spacing:.1em; padding-top:3px; }
.character-name { width:100%; flex:none; font-size:12px; line-height:1.5; min-height:25px; padding:0 0 5px; color:var(--studio-film-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:400; }
.reference-hint,.rail-empty { font-size:12px; line-height:1.6; color:var(--studio-muted); }
.empty-negative,.developing-state { text-align:center; color:var(--studio-film-text); position:relative; padding:24px; }.empty-negative { display:grid; justify-items:center; gap:16px; }.negative-mark { font-size:60px; color:var(--studio-shutter); }.empty-negative>span:nth-child(2) { font-size:clamp(20px,2.5vw,30px); font-family:Georgia,'Songti SC',serif; }.empty-negative p,.developing-state p { margin:0; font-size:14px; line-height:1.7; color:var(--studio-film-muted); }.developing-state { width:min(100%,410px); }.developing-state h3 { font-size:23px; }.spinner { margin:auto; width:40px; height:40px; border:2px solid var(--studio-film-muted); border-top-color:var(--studio-shutter); border-radius:50%; animation:studio-spin .8s linear infinite; }.develop-track { height:3px; background:var(--studio-film-edge); margin-top:24px; }.develop-track span { display:block; width:100%; height:100%; transform-origin:left; background:var(--studio-shutter); transition:transform .3s; }.studio-error { font-size:13px; line-height:1.6; padding:10px 14px; background:var(--studio-paper); color:var(--fun-orange); display:flex; align-items:center; justify-content:space-between; gap:8px; overflow-wrap:anywhere; }
.character-choice:focus-visible { outline:2px solid var(--studio-shutter); outline-offset:2px; }.pose-card:focus-visible { outline:2px solid var(--studio-accent); outline-offset:3px; }
@media(hover:hover) { .character-choice:hover { background:var(--studio-film-edge); border-color:var(--studio-shutter); } }
.studio-content-enter-active,.studio-content-leave-active { transition:opacity .3s,transform .3s; }.studio-content-enter-from,.studio-content-leave-to { opacity:0; transform:translateY(6px); }
@media(min-width:981px) {
  .studio-header { grid-template-columns:244px minmax(0,1fr) 286px; gap:22px; height:126px; box-sizing:border-box; padding-inline:0; }
  .studio-darkroom { margin-top:-150px; }
  .studio-heading { grid-column:1; grid-row:1; align-self:start; justify-content:center; width:100%; height:114px; gap:8px; max-width:100%; }
  .studio-heading h1 { font-size:54px; gap:12px; }
  .studio-club { font-size:10px; letter-spacing:.06em; }
  .studio-tagline { width:100%; height:26px; }
  .studio-stamp { grid-column:3; grid-row:1; justify-self:start; padding-inline:8px; }
  .studio-header-actions { grid-column:3; grid-row:1; justify-self:end; }
}
@media(min-width:1800px) { .studio-header { grid-template-columns:280px minmax(0,1fr) 330px; gap:32px; }.studio-heading h1 { font-size:62px; } }
@media(min-width:981px) and (max-width:1200px) { .studio-header { grid-template-columns:210px minmax(0,1fr) 206px; gap:18px; }.studio-heading h1 { font-size:46px; gap:10px; }.studio-club { font-size:9px; } }
@media(min-width:1800px) { .studio-body { grid-template-columns:280px minmax(0,1fr) 330px; gap:32px; }.character-name { font-size:14px; }.rail-title h2 { font-size:19px; } }
@media(max-width:1200px) { .film-margin-note { display:none; } .studio-page { padding:16px 18px 24px; }.studio-header { width:100%; margin-inline:0; padding-inline:0; gap:20px; }.studio-stamp { display:none; }.studio-body { grid-template-columns:210px minmax(0,1fr) 206px; gap:18px; }.character-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.rail-title h2 { font-size:16px; }.rail-title { flex-wrap:wrap; }.portrait-actions { flex-wrap:wrap; }.portrait-actions>.studio-button { margin-left:auto; } }
@media(max-width:980px) { .mobile-studio-links { display:flex; flex-direction:row; gap:8px; align-items:center; margin-left:auto; flex-shrink:0; }.studio-pose,.studio-characters { scroll-margin-top:16px; }.studio-body { height:auto; grid-template-columns:1fr 1fr; gap:22px; }.studio-darkroom { grid-column:1/-1; grid-row:1; height:max(520px,75dvh); }.studio-pose { grid-column:1; }.studio-characters { grid-column:2; }.pose-card { flex:none; height:240px; }.character-grid { max-height:530px; }.library-tools { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }.library-count { grid-column:1/-1; text-align:left; }.pose-gallery-grid { grid-template-columns:repeat(auto-fill,minmax(105px,1fr)); } }
@media(max-width:520px) { .studio-page { padding:12px 12px 24px; }.studio-header { width:100%; margin-inline:0; padding:8px 0 0; grid-template-columns:1fr; gap:16px; margin-bottom:20px; }.studio-heading { grid-column:1; grid-row:1; justify-self:start; padding-left:6px; }.studio-heading h1 { font-size:58px; gap:22px; }.studio-header-actions { grid-row:2; justify-content:flex-end; }.studio-tagline { width:180px; height:18px; }.studio-club { font-size:10px; }.studio-body { grid-template-columns:1fr; gap:24px; }.studio-darkroom { height:max(510px,70dvh); }.film-frame-edge { padding-inline:26px; }.portrait-mat { padding:8px 26px 16px; background:linear-gradient(90deg,var(--studio-film-edge) 18px,transparent 18px,transparent calc(100% - 18px),var(--studio-film-edge) calc(100% - 18px)); }.portrait-mat::before,.portrait-mat::after { width:8px; background-size:8px 28px; }.portrait-mat::before { left:5px; }.portrait-mat::after { right:5px; }.portrait-actions { padding:12px; gap:10px; }.portrait-selection strong { font-size:16px; }.portrait-actions>.studio-button { margin-left:0; width:100%; }.photo-print figcaption span { display:none; }.studio-pose,.studio-characters { grid-column:1; }.studio-characters { grid-row:2; }.studio-pose,.studio-characters { transform:none; }.character-grid { grid-template-columns:repeat(3,minmax(0,1fr)); max-height:310px; }.character-name { font-size:13px; }.pose-card { height:260px; }.size-ratios { grid-template-columns:repeat(4,minmax(0,1fr)); }.size-controls { grid-template-columns:1fr 1fr; gap:16px; }.rail-title h2 { font-size:18px; }.portrait-selection>span { font-size:11px; } }
@media(prefers-reduced-motion:reduce) { .studio-page,.studio-page * { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
@keyframes studio-enter{from{opacity:0}to{opacity:1}}@keyframes studio-spin{to{transform:rotate(360deg)}}
@keyframes photo-peek{0%{opacity:.18;filter:blur(6px) brightness(1.45);transform:scale(.975)}18%{opacity:1;filter:blur(0) brightness(1.12);transform:scale(1.015)}42%{filter:brightness(1)}100%{opacity:1;filter:none;transform:scale(1)}}
@keyframes photo-flash{0%,100%{opacity:0}7%{opacity:.96}15%{opacity:.15}23%{opacity:.62}38%{opacity:0}}
</style>
