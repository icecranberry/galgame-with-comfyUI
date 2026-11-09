<template>
  <main class="studio-page">
    <header class="studio-header"><div class="studio-nav" role="button" tabindex="0" aria-label="返回酒馆" @click="router.push('/tavern')" @keydown.enter.prevent="router.push('/tavern')" @keydown.space.prevent="router.push('/tavern')"><span aria-hidden="true">‹</span> 酒馆</div><div class="studio-heading"><span class="studio-kicker">LINSHΞ · PORTRAIT ROOM</span><h1>照相馆</h1></div><div class="studio-nav studio-nav--history" role="button" tabindex="0" :aria-pressed="showHistory" @click="showHistory = !showHistory" @keydown.enter.prevent="showHistory = !showHistory" @keydown.space.prevent="showHistory = !showHistory">{{ showHistory ? '返回取景' : '拍摄记录' }}</div></header>
    <Transition name="studio-content" mode="out-in">
    <div v-if="showHistory" key="history" class="studio-history"><div class="history-heading"><h2>拍摄记录</h2><span>{{ jobs.length }} / 30</span></div><div v-if="jobs.length" class="history-grid"><article v-for="job in jobs" :key="job.id" class="history-item"><img v-if="job.output_url" :src="job.output_url" :alt="`${jobCharacters(job)} · ${job.pose_name}`" @click="openPhoto(job.output_url)" /><div v-else class="history-pending">{{ job.status === 'running' ? '冲印中…' : '拍摄失败' }}</div><div class="history-caption"><strong>{{ jobCharacters(job) }}</strong><span>{{ job.pose_name }}<template v-if="job.width && job.height"> · {{ job.width }} × {{ job.height }}</template></span><small v-if="job.error">{{ job.error }}</small></div></article></div><div v-else class="studio-empty">第一张照片还在等你拍摄。</div></div>
    <section v-else key="viewfinder" class="studio-body">
      <aside class="studio-pose"><div class="rail-title"><div><span class="rail-index">01 / POSE</span><h2>选姿势</h2></div><span v-if="recognizedPoses.length" class="rail-count">{{ recognizedPoses.length }} 张已识别</span></div><div class="pose-card" @click="poseOpen = true" @keydown.enter.prevent="poseOpen = true" @keydown.space.prevent="poseOpen = true" role="button" tabindex="0" aria-label="打开全屏姿势图库"><img v-if="selectedPose" :src="poseAsset(selectedPose.thumbnail)" :alt="selectedPose.name" /><div v-else class="pose-placeholder">姿势图库加载中…</div><span class="pose-angle">{{ selectedPose?.angle || '—' }}</span></div><div class="pose-caption"><strong>{{ selectedPose?.name || '请选择一个已识别的姿势' }}</strong><span>{{ selectedPose?.category }} · {{ selectedPose?.system }}</span><small>{{ selectedPose ? '姿势动作已识别' : '当前图库暂时没有已识别的姿势' }}</small></div><linshe-button variant="secondary" size="sm" block @click="poseOpen = true">选择已识别姿势 <span class="button-count">{{ recognizedPoses.length }}</span></linshe-button></aside>
      <section class="studio-darkroom"><div class="darkroom-top"><span>02 / THE PORTRAIT</span><span class="engine-state" :class="{ ready: capability?.available }"><i></i>{{ capability?.engine || (capability?.available ? '暗房就绪' : capability ? '暗房未就绪' : '暗房检查中') }}</span></div><linshe-tabs class="size-ratios" v-model="aspectRatio" size="sm" :options="aspectRatioOptions" aria-label="照片比例" /><div class="size-controls" aria-label="成片尺寸"><div class="size-control"><div><span>宽度</span><strong>{{ width }} px</strong></div><linshe-slider :model-value="width" :min="dimensionControls.width.min" :max="dimensionControls.width.max" :step="dimensionControls.width.step" aria-label="成片宽度" @update:model-value="setWidth" /></div><div class="size-control"><div><span>高度</span><strong>{{ height }} px</strong></div><linshe-slider :model-value="height" :min="dimensionControls.height.min" :max="dimensionControls.height.max" :step="dimensionControls.height.step" aria-label="成片高度" @update:model-value="setHeight" /></div></div><div v-if="capability && !capability.available" class="studio-error" role="status">{{ capability.error }}</div><div class="portrait-mat"><div v-if="activeJob" class="developing-state"><div class="spinner"></div><h3>{{ stageLabel(activeJob.stage) }}</h3><p>正在为 {{ jobCharacters(activeJob) }} 冲印 {{ activeJob.pose_name }}</p><div class="develop-track"><span :style="{ transform: `scaleX(${Math.max(.06, activeJob.progress || 0)})` }"></span></div></div><figure v-else-if="currentPhoto" class="photo-print" :class="{ 'is-peeking': photoFlash }" :style="{ '--photo-aspect': photoAspect }"><img :src="currentPhoto.output_url" :alt="`${jobCharacters(currentPhoto)} · ${currentPhoto.pose_name}`" @load="revealPhoto(currentPhoto.id)" @error="pendingPhotoId = ''" @click="openPhoto(currentPhoto.output_url)" /><span v-if="photoFlash" class="photo-flash" aria-hidden="true"></span><figcaption><strong>{{ jobCharacters(currentPhoto) }}</strong><span>{{ currentPhoto.pose_name }}</span></figcaption></figure><div v-else class="empty-negative"><span class="negative-mark">✳</span><span>READY FOR YOUR PORTRAIT</span><p>一张姿势，和一位角色。<br />接下来，由暗房完成合影。</p></div></div><div v-if="lastFailure && !activeJob" class="studio-error" role="status"><span>{{ lastFailure }}</span><linshe-button variant="ghost" size="sm" @click="lastFailure = ''">知道了</linshe-button></div></section>
      <aside class="studio-characters"><div class="rail-title"><div><span class="rail-index">03 / CHARACTER</span><h2>选角色</h2></div><span class="rail-count">{{ sortedCharacters.length }}</span></div><div class="character-slot-tools"><linshe-tabs v-model="characterSlot" size="sm" :options="characterSlotOptions" aria-label="选择主角或搭档" /><linshe-button v-if="characterSlot === 'second' && secondCharacterId" variant="ghost" size="sm" @click="secondCharacterId = ''">改为随机</linshe-button></div><div class="character-grid"><div v-for="character in sortedCharacters" :key="character.id" class="character-choice" :class="{ selected: isSelectedSlot(character), 'is-other-slot': isOtherSlot(character) }" role="button" tabindex="0" :aria-pressed="isSelectedSlot(character)" @click="selectCharacter(character)" @keydown.enter.prevent="selectCharacter(character)" @keydown.space.prevent="selectCharacter(character)"><div class="character-face"><img v-if="character.avatar_path || character.standing_url" :src="character.avatar_path || character.standing_url" alt="" loading="lazy" /><span v-else>{{ (character.display_name || character.name).slice(0, 1) }}</span><i v-if="characterSlotNumber(character)" :aria-label="characterSlotNumber(character) === 1 ? '主角' : '搭档'">{{ characterSlotNumber(character) }}</i></div><span class="character-name">{{ character.display_name || character.name }}</span></div></div><div v-if="selectedPose?.system?.includes('双人')" class="reference-hint">双人姿势使用主角 + 搭档；未指定搭档时会随机选择一位。</div><div v-if="!characters.length" class="rail-empty">没有可选择的角色</div></aside>
    </section>
    </Transition>
    <section v-if="!showHistory" class="shoot-bar"><div class="shoot-summary"><span>今日人像</span><strong>{{ shootCharactersLabel }}</strong><span>×</span><strong>{{ selectedPose?.name || '尚未选姿势' }}</strong><small>{{ width }} × {{ height }}</small></div><linshe-button variant="primary" size="lg" :disabled="shootDisabled" :loading="shooting" @click="shoot"><span class="shutter">◉</span>{{ activeJob ? '正在冲印' : shooting ? '准备中…' : '拍下这张' }}</linshe-button></section>
    <linshe-modal v-model="poseOpen" title="已识别姿势" full full-height body-class="pose-library-body"><div class="library-tools"><linshe-input v-model="query" size="sm" placeholder="搜索动作、分类或编号…" aria-label="搜索姿势" /><linshe-select v-model="systemFilter" size="sm" :options="systemOptions" aria-label="姿势体系" placeholder="全部体系" /><linshe-select v-model="categoryFilter" size="sm" :options="categoryOptions" aria-label="姿势分类" placeholder="全部分类" /><linshe-select v-model="angleFilter" size="sm" :options="angleOptions" aria-label="相机角度" placeholder="全部角度" /><span class="library-count">{{ filteredPoses.length.toLocaleString() }} 张已识别，可用于拍摄</span></div><div class="pose-gallery-grid"><article v-for="pose in visiblePoses" :key="pose.id" :aria-label="`${pose.name}，${pose.category}，${pose.angle}，已识别`" class="pose-option" :class="{ selected: pose.id === poseId }" role="button" tabindex="0" :aria-pressed="pose.id === poseId" @click="selectPose(pose)" @keydown.enter.prevent="selectPose(pose)" @keydown.space.prevent="selectPose(pose)"><div class="pose-option-image"><img :src="poseAsset(pose.thumbnail)" alt="" loading="lazy" decoding="async" /><span>{{ pose.angle }}</span><i v-if="pose.id === poseId">✓</i></div><strong>{{ pose.name }}</strong><span>{{ pose.category }} · {{ pose.group }}</span></article></div><div v-if="visiblePoses.length < filteredPoses.length" class="load-more"><linshe-button variant="secondary" size="sm" @click="loadMorePoses">继续浏览 {{ Math.min(filteredPoses.length - visiblePoses.length, 240) }} 张</linshe-button></div></linshe-modal>
    <Teleport to="body"><div style="--vel-z-index: 14000"><ImageLightbox :visible="photoOpen" :imgs="[lightboxUrl]" :index="0" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="photoOpen = false" /></div></Teleport>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePhotoStudio } from '../composables/usePhotoStudio.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'
import LinsheSlider from '../components/ui/LinsheSlider.vue'
import LinsheTabs from '../components/ui/LinsheTabs.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import { PHOTO_ASPECT_RATIOS, clampPhotoDimension, inferPhotoAspectRatio, photoDimensionControls, resizePhoto } from '../utils/photoStudioDimensions.js'

const router = useRouter()
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
const aspectRatioOptions = PHOTO_ASPECT_RATIOS.map(value => ({ label: value, value }))
aspectRatioOptions.push({ label: '自定义', value: 'custom' })
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
.studio-page{min-height:100dvh;padding:clamp(18px,3.5vw,42px);padding-bottom:calc(100px + env(safe-area-inset-bottom));color:var(--text-primary);background:radial-gradient(ellipse at 52% 46%,color-mix(in srgb,var(--bg-sunken) 85%,transparent),transparent 62%),var(--bg-primary);animation:studio-enter .32s ease both}
.studio-header{max-width:1660px;margin:0 auto 26px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center}.studio-header>:first-child{justify-self:start}.studio-header>:last-child{justify-self:end}.studio-header :deep(.ls-btn){min-height:40px}.studio-heading{text-align:center}.studio-kicker,.rail-index,.darkroom-top,.empty-negative>span:nth-child(2){font-family:inherit;font-weight:700;font-size:10px;letter-spacing:.16em;color:var(--text-secondary)}.studio-heading h1{font-family:inherit;font-size:clamp(25px,3vw,36px);font-weight:650;letter-spacing:.04em;margin:3px 0 0}.studio-body{max-width:1660px;margin:0 auto;display:grid;grid-template-columns:minmax(190px,240px) minmax(0,1fr) minmax(200px,260px);gap:clamp(15px,2.2vw,32px);align-items:stretch;min-height:min(690px,calc(100dvh - 182px))}.studio-pose,.studio-characters{display:flex;flex-direction:column;gap:14px;min-width:0}.rail-title{display:flex;align-items:center;justify-content:space-between;min-height:43px}.rail-title h2{font-family:inherit;font-size:21px;margin:2px 0 0}.rail-count{border:1px solid var(--border);border-radius:var(--radius-full);padding:4px 9px;color:var(--text-secondary);font-size:11px}.pose-card{position:relative;aspect-ratio:3/4;overflow:hidden;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--bg-sunken);cursor:pointer;transition:transform .3s var(--ease-out),border-color .3s}.pose-card:hover{transform:translateY(-2px);border-color:var(--accent)}.pose-card>img{width:100%;height:100%;object-fit:cover}.pose-angle{position:absolute;top:10px;left:10px;padding:5px 9px;border-radius:var(--radius-full);background:var(--bg-secondary);font-size:11px}.pose-placeholder{height:100%;display:grid;place-items:center;color:var(--text-secondary)}.pose-caption{display:grid;gap:5px}.pose-caption strong{font-size:14px}.pose-caption>span{font-size:11px;color:var(--text-secondary)}.button-count{margin-left:7px;color:var(--text-secondary)}
.studio-darkroom{display:flex;flex-direction:column;min-width:0;border-radius:var(--radius-xl);padding:15px 18px 10px;background:var(--bg-sunken);border:1px solid var(--border);box-shadow:var(--shadow-sm)}.darkroom-top,.darkroom-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.darkroom-top{min-height:28px}.engine-state{display:inline-flex;align-items:center;gap:7px}.engine-state i{width:7px;height:7px;background:var(--fun-orange);border-radius:50%}.engine-state.ready i{background:var(--fun-teal)}.portrait-mat{flex:1;min-height:350px;display:grid;place-items:center;padding:clamp(16px,4vw,56px);background:radial-gradient(ellipse at center,color-mix(in srgb,var(--bg-secondary) 78%,transparent),transparent 74%)}.empty-negative{text-align:center;display:flex;flex-direction:column;align-items:center;gap:13px;color:var(--text-secondary)}.negative-mark{display:grid;place-items:center;width:62px;height:62px;border:1px solid var(--border);border-radius:50%;font-size:27px;color:var(--accent);margin-bottom:7px}.empty-negative p{font-size:14px;line-height:1.8;margin:0}.photo-print{margin:0;max-height:62dvh;padding:12px 12px 48px;background:var(--bg-secondary);box-shadow:var(--shadow-lg);transform:rotate(-.45deg);position:relative;max-width:100%}.photo-print img{display:block;max-height:calc(62dvh - 70px);max-width:min(100%,620px);width:auto;height:auto;object-fit:contain;cursor:zoom-in}.photo-print figcaption{position:absolute;bottom:13px;left:14px;right:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;white-space:nowrap;overflow:hidden}.photo-print figcaption span{overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-size:11px}.darkroom-footer{min-height:42px;border-top:1px solid var(--border);font-size:11px;color:var(--text-secondary)}.developing-state{text-align:center;width:min(100%,410px)}.developing-state h3{font-family:inherit;font-size:23px}.developing-state p{font-size:12px;color:var(--text-secondary)}.spinner{margin:auto;width:40px;height:40px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:studio-spin .8s linear infinite}.develop-track{height:3px;background:var(--border);margin-top:26px}.develop-track span{display:block;width:100%;height:100%;transform-origin:left;background:var(--accent);transition:transform .4s}.studio-error{line-height:1.6;overflow-wrap:anywhere;display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--fun-orange);font-size:12px}
.character-grid{max-height:65dvh;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px 5px;align-content:start;padding:3px 2px 12px}.character-choice{min-width:0;text-align:center;cursor:pointer;border-radius:var(--radius-md);padding:5px 2px;transition:background .3s,transform .3s}.character-choice:hover{transform:translateY(-2px)}.character-choice.selected{background:color-mix(in srgb,var(--accent-light) 75%,transparent)}.character-face{width:clamp(48px,5vw,65px);aspect-ratio:1;margin:auto auto 5px;position:relative;border-radius:50%;background:var(--bg-sunken);overflow:hidden;border:2px solid transparent}.character-choice.selected .character-face{border-color:var(--accent)}.character-face img{width:100%;height:100%;object-fit:cover}.character-face>span{height:100%;display:grid;place-items:center}.character-face i{position:absolute;right:0;bottom:0;width:18px;height:18px;display:grid;place-items:center;border-radius:50%;font-size:10px;font-style:normal;background:var(--accent);color:white}.character-name{font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reference-hint,.rail-empty{font-size:11px;line-height:1.6;color:var(--text-secondary)}
.shoot-bar{position:fixed;z-index:var(--z-nav);left:calc(var(--sidebar-width,0px) + 18px);right:18px;bottom:calc(12px + env(safe-area-inset-bottom));max-width:990px;margin:auto;padding:10px 12px 10px 18px;border:1px solid var(--border);border-radius:var(--radius-xl);background:color-mix(in srgb,var(--bg-secondary) 94%,transparent);box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:space-between;gap:16px}.shoot-summary{display:flex;align-items:center;gap:9px;min-width:0;overflow:hidden;white-space:nowrap;font-size:12px;color:var(--text-secondary)}.shoot-summary strong{max-width:180px;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)}.shutter{font-size:21px;margin-right:9px;vertical-align:-2px}.studio-history{max-width:1500px;margin:auto}.history-heading{display:flex;align-items:center;justify-content:space-between}.history-heading h2{font-family:var(--font-display,serif)}.history-heading>span{font-size:12px;color:var(--text-secondary)}.history-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px}.history-item{background:var(--bg-secondary);padding:9px;border:1px solid var(--border);border-radius:var(--radius-lg)}.history-item>img,.history-pending{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:var(--radius-md)}.history-item>img{cursor:zoom-in}.history-pending{display:grid;place-items:center;background:var(--bg-sunken);color:var(--text-secondary);font-size:13px}.history-caption{display:grid;gap:5px;padding:9px 3px 2px}.history-caption>span,.history-caption small{font-size:11px;color:var(--text-secondary)}.history-caption small{color:var(--fun-orange)}.studio-empty{padding:40px;text-align:center;color:var(--text-secondary)}
.library-tools{display:grid;grid-template-columns:minmax(180px,1fr) repeat(3,minmax(130px,190px)) auto;align-items:center;gap:9px;padding:2px 1px 14px}.library-count{font-size:11px;color:var(--text-secondary);text-align:right;white-space:nowrap}.pose-gallery-grid{height:min(66dvh,760px);overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));align-content:start;gap:15px;padding:5px 3px 16px}.pose-option{min-width:0;cursor:pointer;border-radius:var(--radius-md);padding:6px;display:grid;gap:5px;transition:background .3s,transform .3s}.pose-option:hover{background:var(--bg-sunken);transform:translateY(-2px)}.pose-option.selected{background:color-mix(in srgb,var(--accent-light) 65%,var(--bg-secondary))}.pose-option-image{position:relative;aspect-ratio:3/4;overflow:hidden;border-radius:var(--radius-md);background:var(--bg-sunken)}.pose-option-image img{width:100%;height:100%;object-fit:cover}.pose-option-image>span{position:absolute;left:6px;top:6px;padding:3px 6px;background:var(--bg-secondary);border-radius:var(--radius-full);font-size:9px}.pose-option-image>i{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:white;font-style:normal}.pose-option>strong,.pose-option>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pose-option>strong{font-size:11px}.pose-option>span{font-size:10px;color:var(--text-secondary)}.photo-lightbox-body{display:flex;justify-content:center;overflow:auto}.photo-lightbox-image{max-width:100%;max-height:70dvh;object-fit:contain}
.size-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:6px 2px 2px}.size-control{min-width:0}.size-control>div{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:var(--text-secondary);font-size:11px}.size-control strong{color:var(--text-primary);font-size:12px;font-variant-numeric:tabular-nums}.size-control :deep(.ls-slider){display:block;width:calc(100% - 20px);margin:1px 10px}.character-slot-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.character-slot-tools :deep(.ls-tabs){flex:1;min-width:170px}.character-choice.is-other-slot{outline:1px dashed var(--border-strong);outline-offset:1px}.character-choice .character-face i{font-weight:700;font-style:normal}.pose-caption small{color:var(--text-secondary);font-size:10px;line-height:1.4}.pose-prompt-state{font-size:9px;color:var(--text-secondary)}.pose-option.prompt-ready .pose-prompt-state{color:color-mix(in srgb,var(--fun-teal) 75%,var(--text-primary))}.shoot-summary small{font-size:10px;color:var(--text-secondary);font-variant-numeric:tabular-nums}
@media(max-width:1150px){.studio-body{grid-template-columns:minmax(175px,210px) minmax(0,1fr) minmax(180px,220px);gap:12px}.character-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:980px){.studio-page{padding:12px;padding-bottom:calc(104px + env(safe-area-inset-bottom))}.studio-header{margin-bottom:14px}.studio-kicker{font-size:8px}.studio-body{grid-template-columns:1fr;gap:11px;min-height:0}.studio-pose{display:grid;grid-template-columns:68px minmax(0,1fr);gap:5px 12px;align-items:center}.studio-pose .rail-title{grid-column:1/-1;min-height:32px}.studio-pose .rail-title h2{font-size:16px}.pose-card{grid-column:1;grid-row:2/4;width:68px;aspect-ratio:3/4}.pose-caption{grid-column:2;grid-row:2;align-self:end}.studio-pose>.ls-btn{grid-column:2;grid-row:3;justify-self:start;width:auto!important;min-height:34px}.studio-characters{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}.studio-characters .rail-title{grid-column:1;grid-row:1;min-height:36px}.studio-characters>.ls-input,.studio-characters>:deep(.ls-input){grid-column:2;grid-row:1;width:min(36vw,200px)}.character-slot-tools{grid-column:1/-1;grid-row:2}.character-grid{grid-column:1/-1;grid-row:3;display:flex;overflow-x:auto;overflow-y:hidden;gap:6px;padding:2px 2px 7px;scroll-snap-type:x proximity}.character-choice{flex:0 0 62px;scroll-snap-align:start}.character-face{width:48px}.reference-hint,.rail-empty{grid-column:1/-1}.studio-darkroom{grid-row:3;min-height:min(47dvh,520px);padding:10px}.darkroom-top{font-size:9px}.size-controls{gap:7px;padding-top:2px}.size-control>div{font-size:10px}.size-control strong{font-size:11px}.portrait-mat{min-height:250px;padding:15px}.photo-print{max-height:43dvh}.photo-print img{max-height:calc(43dvh - 65px)}.darkroom-footer{font-size:10px}.shoot-bar{left:9px;right:9px;bottom:calc(8px + env(safe-area-inset-bottom));padding:8px 9px 8px 13px;gap:8px}.shoot-summary{font-size:10px;gap:5px}.shoot-summary strong{max-width:22vw}.shoot-summary small{display:none}.shoot-bar :deep(.ls-btn){min-height:44px;flex:0 0 auto}.library-tools{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.library-tools>.ls-input-wrapper,.library-tools>:deep(.ls-input-wrapper){grid-column:1/-1}.library-count{grid-column:1/-1;text-align:left}.pose-gallery-grid{height:calc(67dvh - 90px);grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px}.pose-option{padding:4px}}
@media(max-width:380px){.studio-heading h1{font-size:23px}.studio-header :deep(.ls-btn){padding-inline:8px}.studio-page{padding-inline:9px}.character-choice{flex-basis:56px}.shoot-summary strong{max-width:18vw}.shoot-bar{padding-left:8px}.shoot-bar :deep(.ls-btn){font-size:12px;padding-inline:11px}.studio-darkroom{min-height:42dvh}}
@media(prefers-reduced-motion:reduce){.studio-page,.studio-page *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
.studio-content-enter-active,.studio-content-leave-active{transition:opacity .3s ease,transform .3s ease}.studio-content-enter-from,.studio-content-leave-to{opacity:0;transform:translateY(6px)}
/* Photo-studio refinements: keep controls in the page flow and let the center frame use its grid row. */
.studio-page{display:flex;flex-direction:column;padding-bottom:calc(104px + env(safe-area-inset-bottom))}
.studio-nav{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:44px;min-height:44px;padding:0 12px;border:1px solid var(--border);border-bottom-width:3px;border-radius:var(--radius-md);background:var(--bg-secondary);color:var(--text-primary);font-size:13px;font-weight:650;cursor:pointer;user-select:none;transition:transform var(--dur-interaction) var(--ease-standard),border-color var(--dur-interaction) var(--ease-standard),color var(--dur-interaction) var(--ease-standard)}
.studio-nav:hover{transform:translateY(-1px);border-color:var(--accent);color:var(--accent)}
.studio-nav:active{transform:translateY(1px);border-bottom-width:1px}
.studio-nav:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.studio-nav--history{justify-self:end;color:var(--accent)}
.studio-body{min-height:0;height:clamp(470px,calc(100dvh - 246px),920px);}
.studio-darkroom{display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto;min-height:0;height:100%;}
.size-ratios{min-width:0;margin:4px 0 2px;}
.size-ratios:deep(.ls-tabs){grid-auto-flow:unset;grid-auto-columns:initial;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;padding:2px;}
.size-ratios:deep(.ls-tabs__item){min-width:0;min-height:28px;padding:5px 3px;font-size:10px;}
.size-controls{padding-top:0;}
.portrait-mat{min-height:0;overflow:hidden;padding:clamp(8px,1.7vw,22px);}
.photo-print{display:flex;flex-direction:column;align-items:center;gap:7px;width:auto;height:100%;max-width:100%;max-height:100%;aspect-ratio:var(--photo-aspect);padding:10px 10px 8px;overflow:hidden;}
.photo-print img{flex:1 1 auto;min-width:0;min-height:0;width:auto;height:auto;max-width:100%;max-height:calc(100% - 25px);object-fit:contain;}
.photo-print figcaption{position:static;flex:0 0 auto;width:100%;min-width:0;}
.photo-print.is-peeking img{animation:photo-peek 420ms var(--ease-standard) both;}
.photo-flash{position:absolute;z-index:1;inset:0;pointer-events:none;background:var(--bg-secondary);opacity:0;animation:photo-flash 760ms ease-out both;}
.shoot-bar{position:fixed;z-index:var(--z-nav);left:calc(var(--nav-width,75px) + 18px);right:18px;bottom:calc(12px + env(safe-area-inset-bottom));width:auto;max-width:990px;margin:0 auto;}
.character-choice.is-other-slot{outline:none;}
.character-choice{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:88px;padding:7px 4px 6px;border:1px solid transparent;border-radius:var(--radius-md);background:transparent;transition:background-color var(--dur-interaction) var(--ease-standard),border-color var(--dur-interaction) var(--ease-standard),transform var(--dur-interaction) var(--ease-standard);}
.character-choice.selected{border-color:color-mix(in srgb,var(--accent) 48%,var(--border));background:color-mix(in srgb,var(--bg-sunken) 74%,var(--bg-secondary));}
.character-face{overflow:visible;isolation:isolate;transition:transform var(--dur-interaction) var(--ease-standard);}
.character-face img,.character-face>span{position:absolute;inset:0;border:2px solid var(--bg-secondary);border-radius:50%;overflow:hidden;transition:border-color var(--dur-interaction) var(--ease-standard);}
.character-face img{display:block;}
.character-choice.selected .character-face img,.character-choice.selected .character-face>span{border-color:var(--accent);}
.character-face i{z-index:2;right:-3px;bottom:-2px;width:20px;height:20px;border:2px solid var(--bg-secondary);box-shadow:var(--shadow-xs);line-height:1;}
.character-choice.selected .character-face i{background:var(--accent);color:var(--on-accent);}
.character-name{max-width:100%;line-height:1.3;}
@media(hover:hover){.character-choice:hover{outline:1px dashed color-mix(in srgb,var(--accent) 65%,var(--border-strong));outline-offset:1px;transform:translateY(-1px);background:color-mix(in srgb,var(--bg-sunken) 42%,transparent);}}
.character-choice:focus-visible{outline:1px dashed color-mix(in srgb,var(--accent) 65%,var(--border-strong));outline-offset:1px;}
@media(min-width:981px){.studio-pose,.studio-characters{min-height:0}.pose-card{flex:1 1 0;min-height:0}.character-grid{flex:1;max-height:none}}
.studio-body{width:100%;max-width:1800px;}
.pose-card,.pose-option-image{background:var(--bg-secondary);}
.pose-card>img,.pose-option-image img{object-fit:contain;}
.photo-print img{max-width:100%;}
@media(max-width:980px){
  .studio-body{height:auto;min-height:0;}
  .studio-darkroom{height:auto;min-height:440px;grid-template-rows:auto auto auto minmax(240px,1fr) auto;}
  .portrait-mat{min-height:0;}
  .photo-print{height:min(41dvh,420px);max-height:100%;}
  .photo-print img{max-height:calc(100% - 25px);}
  .shoot-bar{left:9px;right:9px;bottom:calc(8px + env(safe-area-inset-bottom));width:auto;margin:0;}
  .size-ratios:deep(.ls-tabs__item){font-size:11px;}
}
@media(max-width:520px){
  .studio-header{grid-template-columns:auto 1fr auto;gap:6px;}
  .studio-nav{min-height:40px;padding-inline:8px;font-size:11px;}
  .studio-heading h1{font-size:23px;}
  .studio-kicker{letter-spacing:.09em;}
  .size-ratios:deep(.ls-tabs__item){min-height:30px;padding-inline:2px;font-size:10px;}
  .size-control>div{gap:3px;}
  .shoot-summary{flex-wrap:wrap;white-space:normal;line-height:1.25;}
  .shoot-summary strong{max-width:30vw;}
}
@keyframes studio-enter{from{opacity:0}to{opacity:1}}@keyframes studio-spin{to{transform:rotate(360deg)}}
@keyframes photo-peek{0%{opacity:.18;filter:blur(6px) brightness(1.45);transform:scale(.975)}18%{opacity:1;filter:blur(0) brightness(1.12);transform:scale(1.015)}42%{filter:brightness(1)}100%{opacity:1;filter:none;transform:scale(1)}}
@keyframes photo-flash{0%,100%{opacity:0}7%{opacity:.96}15%{opacity:.15}23%{opacity:.62}38%{opacity:0}}
</style>
