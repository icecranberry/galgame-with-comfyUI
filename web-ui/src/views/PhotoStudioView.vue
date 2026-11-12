<template>
  <main class="studio-page">
    <header class="studio-header">
      <div class="studio-heading">
        <span class="studio-club">LINSHE / UNDERGROUND PHOTO CLUB</span>
        <h1>照相馆<span class="studio-raw" aria-hidden="true"><span>FILM</span><span>CYPHER</span></span></h1>
        <svg class="studio-tagline" viewBox="0 0 300 30" fill="none" aria-hidden="true"><path d="M4 19C74 1 178 1 289 9M38 25C122 13 198 17 252 22" stroke="currentColor" stroke-width="5" stroke-linecap="round" /></svg>
      </div>
      <studio-button class="studio-mobile-back" variant="icon-plain" aria-label="返回，打开侧边栏" title="返回" @click="toggleMobileSidebar"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></studio-button>
      <div class="studio-header-actions">
        <studio-button variant="nav" size="compact" block :aria-pressed="showHistory" @click="showHistory = !showHistory">{{ showHistory ? '返回取景' : '拍摄记录' }}</studio-button>
      </div>
    </header>
    <Transition name="studio-content" mode="out-in">
    <div v-if="showHistory" key="history" class="studio-history"><div class="history-heading"><h2>拍摄记录</h2><span>{{ jobs.length }} / 30</span></div><div v-if="jobs.length" class="history-grid"><article v-for="job in jobs" :key="job.id" class="history-item"><img v-if="job.output_url" :src="job.output_url" :alt="`${jobCharacters(job)} · ${job.pose_name}`" @click="openPhoto(job.output_url)" /><div v-else class="history-pending">{{ job.status === 'running' ? '冲印中…' : '拍摄失败' }}</div><div class="history-caption"><strong>{{ jobCharacters(job) }}</strong><span>{{ job.pose_name }}<template v-if="job.width && job.height"> · {{ job.width }} × {{ job.height }}</template></span><small v-if="job.error">{{ job.error }}</small></div></article></div><div v-else class="studio-empty">第一张照片还在等你拍摄。</div></div>
    <section v-else key="viewfinder" class="studio-body">
      <aside ref="posePanel" class="studio-pose" tabindex="-1">
        <div class="rail-title"><div><h2><span class="panel-number" aria-hidden="true">01</span>姿势底稿</h2></div><span v-if="recognizedPoses.length" class="rail-count">{{ recognizedPoses.length }} 张已识别</span></div><div class="pose-card" @click="poseOpen = true" @keydown.enter.prevent="poseOpen = true" @keydown.space.prevent="poseOpen = true" role="button" tabindex="0" aria-label="打开全屏姿势图库"><img v-if="selectedPose" :src="selectedPose.id === 'custom-upload' ? customPose.imageUrl : poseAsset(selectedPose.thumbnail)" :alt="selectedPose.name" /><div v-else class="pose-placeholder">姿势图库加载中…</div></div><div class="pose-caption"><strong>{{ selectedPose?.name || '请选择一个已识别的姿势' }}</strong><span v-if="selectedPose">{{ selectedPose.category }} · {{ selectedPose.system }}</span></div><div class="studio-pose-tools">
          <studio-button size="compact" :disabled="recognizedPoses.length < 2" @click="randomizePose">随机姿势</studio-button>
          <studio-button size="compact" :title="background ? `${background.label}：${background.description}` : '默认白色背景，点击更换'" @click="backgroundOpen = true"><span class="studio-background-label">{{ background ? background.label : '白色背景 ↗' }}</span></studio-button>
        </div>
        <div class="studio-settings"><h3>画幅设定<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" /></svg></h3><linshe-tabs class="size-ratios" variant="film" v-model="aspectRatio" size="sm" :options="aspectRatioOptions" aria-label="照片比例"><template #option="{ option }"><span class="ratio-option"><svg viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect :x="(28 - option.iconWidth) / 2" :y="(24 - option.iconHeight) / 2" :width="option.iconWidth" :height="option.iconHeight" rx="2" :stroke-dasharray="option.value === 'custom' ? '3 2' : undefined" /></svg><span>{{ option.label }}</span></span></template></linshe-tabs><div class="size-controls" aria-label="成片尺寸"><div class="size-control"><div><span>宽度</span><strong>{{ width }} px</strong></div><linshe-slider variant="film" :model-value="width" :min="dimensionControls.width.min" :max="dimensionControls.width.max" :step="dimensionControls.width.step" aria-label="成片宽度" @update:model-value="setWidth" /></div><div class="size-control"><div><span>高度</span><strong>{{ height }} px</strong></div><linshe-slider variant="film" :model-value="height" :min="dimensionControls.height.min" :max="dimensionControls.height.max" :step="dimensionControls.height.step" aria-label="成片高度" @update:model-value="setHeight" /></div></div></div>
      </aside>
      <section class="studio-darkroom">
<div class="film-frame-edge" aria-hidden="true"><span>35 / STUDIO</span><i></i><span>▸ 01</span></div><div v-if="capability && !capability.available" class="studio-error" role="status">{{ capability.error }}</div><div class="portrait-mat">
<div class="mat-patina" aria-hidden="true">
  <svg class="mat-stamp" viewBox="0 0 144 144" fill="none" focusable="false">
    <circle cx="72" cy="72" r="63" stroke="currentColor" stroke-width="2.5" />
    <circle cx="72" cy="72" r="56" stroke="currentColor" stroke-width="1" />
    <path d="M30 56h84M30 88h84" stroke="currentColor" stroke-width="1.5" />
    <text x="72" y="45" class="mat-stamp-small">LINSHE</text>
    <text x="72" y="78" class="mat-stamp-title">FILM CLUB</text>
    <text x="72" y="107" class="mat-stamp-small">暗房出品</text>
    <path d="m18 70 3 2-3 2-3-2Zm108 0 3 2-3 2-3-2Z" fill="currentColor" />
  </svg>
</div>
<span class="film-margin-note" aria-hidden="true"><span>SIDE A</span><span>FILM CLUB</span></span><Transition name="studio-exposure" mode="out-in">
<div v-if="(activeJob || shooting) && !groupPhotos.length" key="developing" class="developing-state" role="status"><div class="spinner"></div><h3>{{ activeJob ? stageLabel(activeJob.stage) : '正在架好相机' }}</h3><p>{{ activeJob ? `正在为 ${jobCharacters(activeJob)} 冲印 ${activeJob.pose_name}` : shootCharactersLabel }}</p><div class="develop-track" role="progressbar" :aria-label="activeJob ? stageLabel(activeJob.stage) : '正在架好相机'" :aria-valuenow="studioProgress" aria-valuemin="0" aria-valuemax="100"><span :style="{ transform: `scaleX(${studioProgress / 100})` }"></span></div></div><StudioPhotoDeck v-else-if="currentPhoto" key="photos" :photos="displayPhotos" :index="groupPhotos.length ? groupIndex : 0" :flash="photoFlash" @update:index="groupIndex = $event" @preview="openPhoto" @load="revealPhoto" @error="pendingPhotoId = ''" /><div v-else key="empty" class="empty-negative">
<svg class="negative-mark" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <g transform="rotate(9 48 48)" opacity=".35"><path d="M25 14h51v67H25z" /><path d="M30 20h41v44H30z" /></g>
  <g transform="rotate(-9 44 48)">
    <path d="M17 13h54v70H17z" fill="var(--studio-film)" />
    <path d="M23 19h42v45H23z" fill="currentColor" fill-opacity=".07" stroke-opacity=".35" />
    <path d="M27 29v-6h6m22 0h6v6M27 54v6h6m22 0h6v-6" stroke-width="1.5" />
    <path d="M37 38c-1-6 2-10 7-10s8 4 7 10c-.5 5-3 8-7 8s-6.5-3-7-8Z" />
    <path d="M33 57c1-6 5-9 11-9s10 3 11 9" />
    <path d="m27 73 18-1m4 0h8" stroke-width="2.5" />
  </g>
  <path d="m76 12 4-5m1 14 7-2M74 5l-1-3" stroke-width="2.5" />
  <path d="M13 72C4 76 10 87 38 89c17 1 36-4 39-10 2-5-6-8-14-8" stroke-width="1.5" />
</svg><span>主角，就差你了。</span><p>选好姿势与角色，拍下这一幕。</p>
</div>
</Transition>
<div v-if="groupPhotos.length && (activeJob || shooting)" class="deck-developing" role="status"><StudioDevelopingIcon /><span>{{ activeJob ? stageLabel(activeJob.stage) : '正在架好相机' }}<template v-if="burstTotal > 1"> · {{ Math.min(groupPhotos.length + 1, burstTotal) }} / {{ burstTotal }}</template></span><div class="develop-track" role="progressbar" :aria-valuenow="studioProgress" aria-valuemin="0" aria-valuemax="100" aria-label="当前照片冲印进度"><span :style="{ transform: `scaleX(${studioProgress / 100})` }"></span></div></div>
<div v-if="shutterPulse" class="shutter-sweep" aria-hidden="true"><i></i><i></i><span>EXPOSED</span></div>
</div><div class="portrait-actions"><div class="portrait-selection"><span class="next-shot">下一张</span><strong>{{ shootCharactersLabel }}</strong><span>{{ selectedPose?.name || '尚未选姿势' }} · {{ width }} × {{ height }}</span></div><div class="mobile-studio-links"><studio-button variant="link" size="sm" @click="jumpToPanel(characterPanel)">选角色 ↗</studio-button><studio-button variant="link" size="sm" @click="jumpToPanel(posePanel)" title="调整姿势与画幅">姿势 ↗</studio-button></div><div class="studio-shutter"><studio-button variant="primary" size="lg" joined :exposing="shutterPulse" :disabled="shootDisabled" :loading="shooting" @click="shoot"><StudioDevelopingIcon v-if="activeJob" /><svg v-else class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.5" /></svg>{{ activeJob ? '正在冲印' : shooting ? '准备中…' : '按下快门 / SHOOT' }}</studio-button><StudioBurstControl v-model="burstCount" :disabled="burstRunning || shooting || !!activeJob" /></div></div><div v-if="lastFailure && !activeJob" class="studio-error" role="status"><span>{{ lastFailure }}</span><studio-button variant="ghost" size="sm" @click="lastFailure = ''">知道了</studio-button></div>
</section>
      <aside ref="characterPanel" class="studio-characters" tabindex="-1">
        <div class="rail-title"><div><h2><span class="panel-number" aria-hidden="true">02</span>入镜人物</h2></div><span class="rail-count">{{ sortedCharacters.length }}</span></div>
        <div class="character-slot-tools"><linshe-tabs v-model="characterSlot" variant="film" size="sm" :options="characterSlotOptions" aria-label="选择主角或搭档" /></div>
        <div class="character-grid">
          <div class="character-choice character-random" :class="{ selected: randomSlotSelected, 'is-disabled': !characters.length }" role="button" :tabindex="characters.length ? 0 : -1" :aria-pressed="randomSlotSelected" :aria-disabled="!characters.length" :aria-label="`随机${characterSlot === 'first' ? '主角' : '搭档'}，拍摄时随机选择`" title="拍摄时随机选择角色" @click="selectRandomCharacter" @keydown.enter.prevent="selectRandomCharacter" @keydown.space.prevent="selectRandomCharacter">
            <div class="character-face">
              <span><svg class="random-character-mark" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="30" cy="21" r="8" /><path d="M15 48v-4a15 15 0 0 1 23-13M40 15h12m-5-5 5 5-5 5M38 39h14m-5-5 5 5-5 5M48 52H36m5-5-5 5 5 5" /></svg></span>
              <i v-if="randomSlotSelected">{{ characterSlot === 'first' ? '主角' : '搭档' }}</i>
            </div>
            <div class="character-contact"><span class="contact-number" aria-hidden="true">00</span><span v-if="randomSlotSelected" class="character-outfit">{{ customOutfits[characterSlot] ? '本次搭配' : outfitLabels[slotOutfits[characterSlot] || 'work'] }}</span></div>
            <span class="character-name">随机角色</span>
          </div>
          <studio-outfit-picker v-for="(character, characterIndex) in sortedCharacters" :key="character.id" :character-id="character.id" :model-value="characterOutfit(character)" @open="selectOutfitCharacter(character)" @update:model-value="selectOutfit(character, $event)">
            <template #default="{ open, toggle, keydown, menuId, activeId }">
              <div class="character-choice" :title="character.display_name || character.name" :aria-label="`${character.display_name || character.name}，${outfitLabel(character)}，选择服装`" :class="{ selected: isSelectedSlot(character), 'is-other-slot': isOtherSlot(character) }" role="combobox" tabindex="0" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? menuId : undefined" :aria-activedescendant="activeId" @click="toggle" @keydown="keydown">
                <div class="character-face"><img v-if="character.avatar_path || character.standing_url" :src="character.avatar_path || character.standing_url" alt="" loading="lazy" /><span v-else>{{ (character.display_name || character.name).slice(0, 1) }}</span><i v-if="characterSlotNumber(character)" :aria-label="characterSlotNumber(character) === 1 ? '主角' : '搭档'">{{ characterSlotNumber(character) === 1 ? '主角' : '搭档' }}</i></div>
                <div class="character-contact"><span class="contact-number" aria-hidden="true">{{ String(characterIndex + 1).padStart(2, '0') }}</span><span v-if="characterSlotNumber(character)" class="character-outfit">{{ outfitLabel(character) }}</span></div>
                <span class="character-name">{{ character.display_name || character.name }}</span>
              </div>
            </template>
          </studio-outfit-picker>
        </div>
        <div class="studio-wardrobe-tools"><studio-button size="compact" block @click="clothingOpen = true">服装 tag 库 · {{ characterSlot === 'first' ? '主角' : '搭档' }}<span v-if="customOutfits[characterSlot]" class="studio-wardrobe-selected">· 已选择</span></studio-button></div>
        <StudioPromptTools v-model="polishPrompt" v-model:instruction="polishInstruction" v-model:expanded="polishSettingsOpen" :disabled="shooting || !!activeJob" :can-preview="canUseCharacters && !!selectedPose" :has-photo="!!currentPhoto" @preview="previewPrompt" @photo-prompt="showPhotoPrompt" />
        <div v-if="duoPose" class="reference-hint">双人姿势使用主角 + 搭档；随机角色会在拍摄时选取。</div><div v-if="!characters.length" class="rail-empty">没有可选择的角色</div>
      </aside>
    </section>
    </Transition>

    <linshe-modal v-model="poseOpen" title="已识别姿势" variant="film" full full-height :transition-ms="300" body-class="modal-workspace-body">
      <template #title-icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <circle cx="14" cy="4" r="2" /><path d="m4 7 5 3 4-2 4 4 4-2M13 8l-3 7-6 5M10 15l6 1 2 5" />
        </svg>
      </template>
      <template #header-extra>
        <span class="modal-header-stat">底稿<strong class="modal-header-stat-value">{{ filteredPoses.length }}</strong></span>
      </template>
      <template #close="{ close, disabled }">
        <studio-button variant="icon" :disabled="disabled" aria-label="关闭姿势图库" @click="close()">
          <StudioDevelopingIcon v-if="activeJob" />
          <svg v-else class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </studio-button>
      </template>
      <div class="pose-library">
        <div class="library-tools">
          <div class="pose-search-upload">
            <studio-input v-model="query" placeholder="搜索动作、分类或编号…/粘贴或者上传图片自定义姿势" aria-label="搜索姿势" />
            <studio-button :loading="describingPose" @click="poseFileInput?.click()">
              <svg v-if="!describingPose" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></svg>
              {{ describingPose ? '识别中…' : '上传图片' }}
            </studio-button>
            <input ref="poseFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden @change="uploadPose" />
          </div>
          <p v-if="poseUploadError" class="pose-upload-error" role="alert">{{ poseUploadError }}</p>
          <CollapseTransition :show="!!customPose">
            <div v-if="customPose" class="custom-pose-editor">
              <studio-input v-model="customPose.posePrompt" :disabled="describingPose" type="textarea" :rows="4" maxlength="6000" aria-label="自定义姿势英文提示词" />
              <div class="custom-pose-actions">
                <Transition name="pose-description">
                  <div v-if="poseDescriptionOpen" class="pose-description-input">
                    <studio-input id="pose-description-input" ref="poseDescriptionInput" v-model="poseDescription" :disabled="describingPose" maxlength="2000" placeholder="输入修改要求…" aria-label="姿势补充描述" @keyup.enter="!$event.isComposing && revisePose()" />
                  </div>
                </Transition>
                <studio-button size="compact" :loading="describingPose" :disabled="poseDescriptionOpen && !poseDescription.trim()" :aria-expanded="poseDescriptionOpen" aria-controls="pose-description-input" @click="revisePose">{{ poseDescriptionOpen ? '再次修改' : '补充描述' }}</studio-button>
              </div>
            </div>
          </CollapseTransition>
          <div class="library-system-row">
            <studio-filter-options v-model="systemFilter" :options="systemOptions" label="姿势体系" />
            <Transition name="studio-content">
              <div v-if="systemFilter" class="library-system-categories">
                <studio-filter-options v-model="categoryFilter" :options="categoryOptions" label="姿势分类" size="xs" />
              </div>
            </Transition>
          </div>
          <studio-filter-options v-model="angleFilter" :options="angleOptions" label="相机角度" />
        </div>
        <Transition name="studio-content" mode="out-in" @after-enter="checkPoseScroll">
          <div ref="poseScrollRoot" :key="`${query}:${systemFilter}:${categoryFilter}:${angleFilter}`" class="pose-gallery-grid" @scroll.passive="checkPoseScroll">
            <article v-for="pose in visiblePoses" :key="pose.id" :aria-label="`${pose.name}，${pose.category}，${pose.angle}，已识别`" class="pose-option" :class="{ selected: pose.id === poseId }" role="button" tabindex="0" :aria-pressed="pose.id === poseId" @click="selectPose(pose)" @keydown.enter.prevent="selectPose(pose)" @keydown.space.prevent="selectPose(pose)">
              <div class="pose-option-image">
                <img :src="poseAsset(pose.thumbnail)" alt="" loading="lazy" decoding="async" />
                <span>{{ pose.angle }}</span><i v-if="pose.id === poseId">✓</i>
              </div>
              <div class="pose-option-heading"><small>{{ pose.id.split('_').slice(-2, -1)[0] || 'POSE' }}</small><strong>{{ pose.name }}</strong></div>
              <span>{{ pose.category }} · {{ pose.group }}</span>
            </article>
            <div v-if="!filteredPoses.length" class="studio-empty">没有匹配的姿势，试试调整筛选。</div>
          </div>
        </Transition>
      </div>
    </linshe-modal>
    <StudioBackgroundLibrary v-model="backgroundOpen" :value="background" @applied="background = $event" />
    <StudioClothingLibrary v-model="clothingOpen" :slot-key="characterSlot" :outfit="customOutfits[characterSlot] || null" :draft="clothingDrafts[characterSlot] ?? null" @draft-change="saveClothingDraft" @applied="applyClothing" />
    <linshe-modal v-model="promptOpen" title="拍摄提示词" variant="film" wide :transition-ms="300"><template #close="{ close }"><studio-button variant="icon" aria-label="关闭提示词" @click="close()">×</studio-button></template><p v-if="promptLoading" class="studio-prompt-note" role="status">正在拼装…</p><p v-else-if="promptError" class="studio-prompt-note" role="alert">{{ promptError }}</p><div v-else class="studio-prompt-text" tabindex="0">{{ promptText }}</div></linshe-modal>
    <Teleport to="body"><div style="--vel-z-index: 14000"><ImageLightbox :visible="photoOpen" :imgs="lightboxImages" :index="lightboxIndex" :show-regenerate="false" :show-upscale="false" :show-delete="false" @hide="photoOpen = false" /></div></Teleport>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, inject } from 'vue'
import { usePhotoStudio } from '../composables/usePhotoStudio.js'
import { createPhotoStudioBurst } from '../composables/photoStudioBurst.js'
import StudioButton from '../components/photoStudio/StudioButton.vue'
import StudioBurstControl from '../components/photoStudio/StudioBurstControl.vue'
import StudioPhotoDeck from '../components/photoStudio/StudioPhotoDeck.vue'
import StudioDevelopingIcon from '../components/photoStudio/StudioDevelopingIcon.vue'
import StudioOutfitPicker from '../components/photoStudio/StudioOutfitPicker.vue'
import StudioBackgroundLibrary from '../components/photoStudio/StudioBackgroundLibrary.vue'
import StudioClothingLibrary from '../components/photoStudio/StudioClothingLibrary.vue'
import CollapseTransition from '../components/CollapseTransition.vue'
import StudioPromptTools from '../components/photoStudio/StudioPromptTools.vue'
import { getPhotoStudioPrompt, getPhotoStudioBackgrounds, describePhotoStudioPose } from '../api/index.js'
import { STUDIO_OUTFIT_LABELS } from '../utils/studioWardrobe.js'
import { prepareCameraShutterSound, playCameraShutterSound } from '../utils/cameraShutterSound.js'
import StudioInput from '../components/photoStudio/StudioInput.vue'
import StudioFilterOptions from '../components/photoStudio/StudioFilterOptions.vue'
import LinsheSlider from '../components/ui/LinsheSlider.vue'
import LinsheTabs from '../components/ui/LinsheTabs.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import { PHOTO_ASPECT_RATIOS, initialPhotoStudioFrame, clampPhotoDimension, photoDimensionControls, resizePhoto } from '../utils/photoStudioDimensions.js'

const toggleMobileSidebar = inject('toggleMobileSidebar', () => {})
const posePanel = ref(null), characterPanel = ref(null)
function jumpToPanel(panel) {
  if (!panel) return
  panel.focus({ preventScroll: true })
  panel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
}
const studio = usePhotoStudio({ persistent: true })
const { catalog, characters, jobs, capability, load } = studio
const burst = createPhotoStudioBurst(studio, { prepareSound: prepareCameraShutterSound, playSound: playCameraShutterSound })
const { groupIndex, groupPhotos, burstRunning, burstTotal, shooting, exposure, lastFailure, selectedJobId } = burst
const saved = (() => { try { return JSON.parse(sessionStorage.getItem('photo-studio-selection') || '{}') } catch { return {} } })()
const burstCount = ref(Math.max(1, Math.min(10, Math.round(Number(saved.burstCount) || 1))))
const customPoseKey = 'photo-studio-custom-pose'
const customPose = ref((() => {
  try {
    const value = JSON.parse(localStorage.getItem(customPoseKey) || 'null')
    return value && typeof value.posePrompt === 'string' && [1, 2].includes(value.personCount) && typeof value.imageUrl === 'string' && value.imageUrl.startsWith('/images/photo_studio/pose-ref-') ? value : null
  } catch { return null }
})())
const poseFileInput = ref(null), describingPose = ref(false), poseUploadError = ref('')
const poseDescriptionOpen = ref(false), poseDescriptionInput = ref(null)
const poseDescription = ref(typeof customPose.value?.description === 'string' ? customPose.value.description : '')
watch(poseDescription, value => { if (customPose.value) customPose.value.description = value }, { flush: 'sync' })
let poseRequest
watch(customPose, value => {
  try { localStorage.setItem(customPoseKey, JSON.stringify(value)) }
  catch { poseUploadError.value = '自动保存失败，当前编辑仍可用于本次拍摄' }
}, { deep: true, flush: 'sync' })
function uploadPose(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  return recognizePose(file)
}
function pastePose(event) {
  if (!poseOpen.value || event.defaultPrevented) return
  const clipboard = event.clipboardData
  const item = Array.from(clipboard?.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'))
  const file = item?.getAsFile() || Array.from(clipboard?.files || []).find(file => file.type.startsWith('image/'))
  if (!file) return
  event.preventDefault()
  return recognizePose(file)
}
async function recognizePose(source, direction = '') {
  if (!source || describingPose.value) return
  poseUploadError.value = ''
  const controller = new AbortController()
  poseRequest = controller
  describingPose.value = true
  try {
    const file = typeof source === 'function' ? await source(controller.signal) : source
    if (controller.signal.aborted || disposed) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) throw new Error('请选择 PNG、JPG、WEBP、GIF 或 AVIF 图片')
    if (file.size > 6 * 1024 * 1024) throw new Error('图片不能超过 6MB')
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('图片读取失败，请重试'))
      reader.readAsDataURL(file)
    })
    if (controller.signal.aborted) return
    const result = await describePhotoStudioPose(image, controller.signal, direction)
    if (controller.signal.aborted || disposed) return
    customPose.value = { ...result, ...(direction ? { description: direction } : {}) }
    poseDescription.value = direction
    if (!direction) poseDescriptionOpen.value = false
    poseId.value = 'custom-upload'
    persistSelection()
  } catch (error) {
    if (!controller.signal.aborted && !disposed) poseUploadError.value = error.message || '姿势识别失败，请重试'
  } finally {
    if (poseRequest === controller) { poseRequest = null; describingPose.value = false }
  }
}
async function revisePose() {
  if (!customPose.value || describingPose.value || disposed) return
  if (!poseDescriptionOpen.value) {
    poseDescriptionOpen.value = true
    await nextTick()
    if (!disposed && poseDescriptionOpen.value) poseDescriptionInput.value?.focus()
    return
  }
  const direction = poseDescription.value.trim()
  if (!direction) return
  const imageUrl = customPose.value.imageUrl
  return recognizePose(async signal => {
    const response = await fetch(imageUrl, { signal })
    if (!response.ok) throw new Error('参考图读取失败，请重新上传图片')
    const file = await response.blob()
    // Older static servers return AVIF references as application/octet-stream.
    if (!file.type || file.type === 'application/octet-stream') {
      const extension = imageUrl.match(/\.(png|jpe?g|webp|gif|avif)$/i)?.[1]?.toLowerCase()
      if (extension) return new Blob([file], { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` })
    }
    return file
  }, direction)
}
const poseId = ref(saved.poseId || ''), characterId = ref(saved.characterId || ''), secondCharacterId = ref(saved.secondCharacterId || '')
// Migrate only the saved occupants once; future character changes never move clothing.
function restoreSlotEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(['first', 'second'].flatMap(slot => {
    const key = saved.clothingBinding === 'slot' ? slot : slot === 'first' ? saved.characterId : saved.secondCharacterId
    return key != null && Object.hasOwn(value, key) ? [[slot, value[key]]] : []
  }))
}
const slotOutfits = ref(Object.fromEntries(Object.entries(restoreSlotEntries(saved.clothingBinding === 'slot' ? saved.slotOutfits : saved.characterOutfits)).filter(([, scene]) => Object.hasOwn(STUDIO_OUTFIT_LABELS, scene))))
const customOutfits = ref(restoreCustomOutfits(saved.customOutfits))
const clothingDrafts = ref(restoreCustomOutfits(saved.clothingDrafts, true))
function restoreCustomOutfits(value, keepDrafts = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(restoreSlotEntries(value)).flatMap(([id, outfit]) => {
    if (!outfit || typeof outfit !== 'object') return []
    const tags = Array.isArray(outfit.tags) ? outfit.tags.filter(tag => typeof tag === 'string' && tag.trim()).slice(0, 32) : []
    const brief = typeof outfit.brief === 'string' ? outfit.brief : ''
    const customPrompt = typeof outfit.customPrompt === 'string' ? outfit.customPrompt : ''
    return keepDrafts || tags.length || customPrompt ? [[id, { tags, brief, customPrompt }]] : []
  }))
}
const clothingOpen = ref(false), promptOpen = ref(false), promptLoading = ref(false), promptText = ref(''), promptError = ref('')
const polishPreferenceKey = 'photo-studio-polish-enabled'
const polishInstruction = ref(typeof saved.polishInstruction === 'string' ? saved.polishInstruction : '')
const polishSettingsOpen = ref(false)
const polishPrompt = ref((() => {
  try { return localStorage.getItem(polishPreferenceKey) === 'true' } catch { return false }
})())
watch(polishPrompt, enabled => {
  try { localStorage.setItem(polishPreferenceKey, String(enabled)) } catch { /* Keep the switch usable if storage is unavailable. */ }
}, { flush: 'sync' })
const backgroundOpen = ref(false)
const background = ref(saved.background && ['library', 'custom'].includes(saved.background.source) ? saved.background : null)
const shutterPulse = ref(false)
let promptRevision = 0, shutterTimer
const outfitLabels = STUDIO_OUTFIT_LABELS
const initialFrame = initialPhotoStudioFrame(saved)
const width = ref(initialFrame.width), height = ref(initialFrame.height), characterSlot = ref('first')
const aspectRatio = ref(initialFrame.aspectRatio)
const poseOpen = ref(false), photoOpen = ref(false), showHistory = ref(false), photoFlash = ref(false)
const poseScrollRoot = ref(null)
let pagingPoses = false
const query = ref(''), systemFilter = ref(''), categoryFilter = ref(''), angleFilter = ref('')
const lightboxImages = ref([]), lightboxIndex = ref(0), visiblePoseCount = ref(240)
let flashTimer, studioReady = false, pendingPhotoId = '', disposed = false
const characterSlotOptions = [{ label: '主角', value: 'first' }, { label: '搭档', value: 'second' }]
const aspectRatioOptions = PHOTO_ASPECT_RATIOS.map(value => {
  const [w, h] = value.split(':').map(Number)
  const scale = 20 / Math.max(w, h)
  return { label: value, value, iconWidth: w * scale, iconHeight: h * scale }
})
aspectRatioOptions.push({ label: '自定义', value: 'custom', iconWidth: 19, iconHeight: 19 })
const selectedPose = computed(() => poseId.value === 'custom-upload' && customPose.value ? { id: 'custom-upload', name: '自定义姿势', category: '上传参考图', system: customPose.value.personCount === 2 ? '双人' : '单人', posePrompt: customPose.value.posePrompt } : catalog.value.find(item => item.id === poseId.value))
const recognizedPoses = computed(() => catalog.value.filter(item => !!item.posePrompt))
const selectedCharacter = computed(() => characters.value.find(item => Number(item.id) === Number(characterId.value)))
const selectedSecondCharacter = computed(() => characters.value.find(item => Number(item.id) === Number(secondCharacterId.value)))
const randomSlotSelected = computed(() => !(characterSlot.value === 'first' ? characterId.value : secondCharacterId.value))
const activeJob = computed(() => jobs.value.find(item => item.status === 'running'))
// Match schedule peek: simulated progress fills quiet periods; real sampling wins.
const realPct = ref(0), simulatedPct = ref(0)
const studioProgress = computed(() => Math.max(Math.floor(simulatedPct.value), realPct.value))
let progressTimer, progressRunning = false, progressJobId = ''
function stopFakeProgress() {
  clearTimeout(progressTimer)
  progressTimer = undefined
  progressRunning = false
}
function scheduleProgressTick() {
  progressTimer = setTimeout(() => {
    if (!progressRunning) return
    if (realPct.value <= simulatedPct.value && simulatedPct.value < 95) {
      simulatedPct.value = Math.min(95, simulatedPct.value + 1 + Math.random() * 3)
    }
    scheduleProgressTick()
  }, 400 + Math.random() * 1200)
}
function startFakeProgress() {
  stopFakeProgress()
  realPct.value = 0
  simulatedPct.value = 0
  progressJobId = ''
  progressRunning = true
  scheduleProgressTick()
}
watch([activeJob, shooting], ([job, submitting]) => {
  if (job || submitting) {
    if (!progressRunning || (job && progressJobId && job.id !== progressJobId)) startFakeProgress()
    if (job) {
      progressJobId = job.id
      if (job.stage === 'sampling' && job.progress != null && Number.isFinite(Number(job.progress))) {
        realPct.value = Math.round(Math.min(1, Math.max(0, Number(job.progress))) * 100)
      }
    }
  } else {
    stopFakeProgress()
    if (jobs.value.some(job => job.id === progressJobId && job.status === 'done')) {
      simulatedPct.value = 100
    }
  }
}, { immediate: true })
const currentPhoto = computed(() => groupPhotos.value[groupIndex.value] || jobs.value.find(item => item.id === selectedJobId.value && item.status === 'done') || jobs.value.find(item => item.status === 'done'))
const displayPhotos = computed(() => groupPhotos.value.length ? groupPhotos.value : currentPhoto.value ? [currentPhoto.value] : [])
const characterCollator = new Intl.Collator('zh-u-co-pinyin', { sensitivity: 'base', numeric: true })
const sortedCharacters = computed(() => [...characters.value].sort((a, b) => characterCollator.compare(a.display_name || a.name || '', b.display_name || b.name || '') || Number(a.id) - Number(b.id)))
const duoPose = computed(() => !!selectedPose.value?.system?.includes('双人') || /^pair/i.test(selectedPose.value?.id || ''))
const shootCharactersLabel = computed(() => {
  const first = selectedCharacter.value?.display_name || selectedCharacter.value?.name || (characters.value.length ? '随机主角' : '尚未选人')
  if (!duoPose.value) return first
  return `${first} + ${selectedSecondCharacter.value?.display_name || selectedSecondCharacter.value?.name || '随机搭档'}`
})
const systemOptions = computed(() => [{ label: '全部体系', value: '' }, ...unique('system').map(value => ({ label: value, value }))])
const categoryOptions = computed(() => [{ label: '全部分类', value: '' }, ...unique('category').map(value => ({ label: value, value }))])
const angleOptions = computed(() => [{ label: '全部角度', value: '' }, ...unique('angle').map(value => ({ label: value, value }))])
const filteredPoses = computed(() => { const term = query.value.trim().toLowerCase(); return recognizedPoses.value.filter(item => (!systemFilter.value || item.system === systemFilter.value) && (!categoryFilter.value || item.category === categoryFilter.value) && (!angleFilter.value || item.angle === angleFilter.value) && (!term || `${item.name} ${item.category} ${item.group} ${item.system} ${item.id}`.toLowerCase().includes(term))) })
const visiblePoses = computed(() => filteredPoses.value.slice(0, visiblePoseCount.value))
const canUseCharacters = computed(() => characters.value.length >= (duoPose.value ? 2 : 1) && (!characterId.value || !!selectedCharacter.value) && (!duoPose.value || !secondCharacterId.value || !!selectedSecondCharacter.value))
const shotUnavailable = computed(() => shooting.value || !!activeJob.value || !capability.value?.available || !selectedPose.value?.posePrompt?.trim() || !canUseCharacters.value)
const shootDisabled = computed(() => burstRunning.value || shotUnavailable.value)
const dimensionControls = computed(() => photoDimensionControls(aspectRatio.value))
function unique(field) { return [...new Set(catalog.value.filter(item => field === 'system' || !systemFilter.value || item.system === systemFilter.value).map(item => item[field]))].sort((a, b) => a.localeCompare(b, 'zh')) }
async function loadMorePoses() {
  if (disposed || !poseOpen.value || pagingPoses || visiblePoseCount.value >= filteredPoses.value.length) return
  pagingPoses = true
  visiblePoseCount.value = Math.min(visiblePoseCount.value + 240, filteredPoses.value.length)
  await nextTick()
  pagingPoses = false
  checkPoseScroll()
}
function checkPoseScroll() {
  const root = poseScrollRoot.value
  if (root?.clientHeight > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 180) void loadMorePoses()
}
watch([poseScrollRoot, poseOpen], checkPoseScroll, { flush: 'post' })
function syncAspect(anchor) {
  const dimensions = resizePhoto({ width: width.value, height: height.value, ratio: aspectRatio.value, anchor })
  width.value = dimensions.width
  height.value = dimensions.height
}
function setWidth(value) { width.value = clampPhotoDimension(value); syncAspect('width') }
function setHeight(value) { height.value = clampPhotoDimension(value); syncAspect('height') }
watch(aspectRatio, value => { if (value !== 'custom') syncAspect('width') })
function persistSelection() { sessionStorage.setItem('photo-studio-selection', JSON.stringify({ burstCount: burstCount.value, poseId: poseId.value, characterId: characterId.value, secondCharacterId: secondCharacterId.value, width: width.value, height: height.value, aspectRatio: aspectRatio.value, frameVersion: 2, background: background.value, polishInstruction: polishInstruction.value, clothingBinding: 'slot', slotOutfits: slotOutfits.value, customOutfits: customOutfits.value, clothingDrafts: clothingDrafts.value })) }
watch([burstCount, poseId, characterId, secondCharacterId, width, height, aspectRatio, background, polishInstruction], persistSelection)
watch([slotOutfits, customOutfits, clothingDrafts], persistSelection, { deep: true, flush: 'sync' })
watch(systemFilter, () => {
  categoryFilter.value = ''
  if (!angleOptions.value.some(option => option.value === angleFilter.value)) angleFilter.value = ''
})
watch([query, systemFilter, categoryFilter, angleFilter], () => { visiblePoseCount.value = 240; if (poseScrollRoot.value) poseScrollRoot.value.scrollTop = 0 })
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
function selectRandomCharacter() {
  if (!characters.value.length) return
  if (characterSlot.value === 'first') characterId.value = ''
  else secondCharacterId.value = ''
}
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
function outfitSlot(character) {
  return characterSlotNumber(character) === 1 ? 'first' : characterSlotNumber(character) === 2 ? 'second' : characterSlot.value
}
function characterOutfit(character, slot = outfitSlot(character)) {
  const scene = slotOutfits.value[slot] || 'work'
  return Array.isArray(character.outfitScenes) && !character.outfitScenes.includes(scene) ? 'work' : scene
}
function outfitLabel(character) { return customOutfits.value[outfitSlot(character)] ? '本次搭配' : outfitLabels[characterOutfit(character)] }
function selectOutfitCharacter(character) {
  selectCharacter(character)
}
function selectOutfit(character, scene) {
  selectCharacter(character)
  slotOutfits.value[characterSlot.value] = scene
}
function jobCharacters(job) { return [job.character_name, job.character2_name].filter(Boolean).join(' + ') }
function stageLabel(stage) { return ({ polishing: 'AI 正在润色提示词', polishing_retry: 'AI 正在补全遗漏的 tag', preparing: '正在架好相机', queued: '已进入暗房队列', generating: '正在处理画面', sampling: '正在采样', saving: '正在冲印照片' })[stage] || '正在拍摄' }
function openPhoto(url) {
  const photos = displayPhotos.value.map(photo => photo.output_url)
  lightboxImages.value = photos.includes(url) ? photos : [url]
  lightboxIndex.value = Math.max(0, lightboxImages.value.indexOf(url))
  photoOpen.value = true
}
function shotInput() {
  return { characterId: characterId.value || null, secondCharacterId: duoPose.value ? (secondCharacterId.value || null) : null,
    poseId: poseId.value, ...(poseId.value === 'custom-upload' ? { customPose: { posePrompt: customPose.value?.posePrompt, personCount: customPose.value?.personCount } } : {}), outfitScene: selectedCharacter.value ? characterOutfit(selectedCharacter.value, 'first') : slotOutfits.value.first || 'work',
    secondOutfitScene: duoPose.value ? (selectedSecondCharacter.value ? characterOutfit(selectedSecondCharacter.value, 'second') : slotOutfits.value.second || 'work') : 'work',
    clothingTags: customOutfits.value.first?.tags || [],
    customClothingPrompt: customOutfits.value.first?.customPrompt || '',
    secondClothingTags: duoPose.value ? customOutfits.value.second?.tags || [] : [],
    secondCustomClothingPrompt: duoPose.value ? customOutfits.value.second?.customPrompt || '' : '',
    backgroundId: background.value?.source === 'library' ? background.value.id : '',
    customBackgroundPrompt: background.value?.source === 'custom' ? background.value.prompt : '',
    width: width.value, height: height.value, polishPrompt: polishPrompt.value, polishInstruction: polishInstruction.value }
}
function saveClothingDraft({ slot: id, outfit }) { clothingDrafts.value[id] = outfit }
function applyClothing({ slot: id, outfit }) {
  if (outfit) {
    customOutfits.value[id] = outfit
    clothingDrafts.value[id] = { ...outfit, tags: [...outfit.tags] }
  } else {
    delete customOutfits.value[id]
    delete clothingDrafts.value[id]
  }
}
function showPhotoPrompt() {
  if (!currentPhoto.value) return
  promptText.value = currentPhoto.value.prompt; promptError.value = ''; promptLoading.value = false
  promptRevision++; promptOpen.value = true
}
async function previewPrompt() {
  const revision = ++promptRevision
  promptOpen.value = true; promptLoading.value = true; promptError.value = ''; promptText.value = ''
  try { const result = await getPhotoStudioPrompt(shotInput()); if (revision === promptRevision && !disposed) promptText.value = result.prompt }
  catch (error) { if (revision === promptRevision && !disposed) promptError.value = error.message }
  finally { if (revision === promptRevision && !disposed) promptLoading.value = false }
}
function shoot() {
  if (shootDisabled.value) return
  return burst.start(burstCount.value, shotInput)
}
watch(exposure, () => {
  polishSettingsOpen.value = false
  shutterPulse.value = true
  clearTimeout(shutterTimer)
  shutterTimer = setTimeout(() => { shutterPulse.value = false }, 700)
}, { flush: 'sync' })
// Preset names and descriptions are catalog data, not a frozen session snapshot.
async function refreshSavedBackground() {
  const savedBackground = background.value
  if (savedBackground?.source !== 'library') return
  try {
    const catalog = await getPhotoStudioBackgrounds()
    if (disposed || background.value !== savedBackground) return
    const entry = catalog.entries.find(item => item.id === savedBackground.id)
    background.value = entry ? { ...entry, source: 'library' } : null
  } catch { /* Keep the current selection available when the catalog is offline. */ }
}
onMounted(refreshSavedBackground)
onMounted(() => { globalThis.document?.addEventListener('paste', pastePose) })
onBeforeUnmount(() => { globalThis.document?.removeEventListener('paste', pastePose) })
onMounted(async () => { await load(); if (disposed) return; if (!(poseId.value === 'custom-upload' && customPose.value) && !recognizedPoses.value.some(item => item.id === poseId.value)) poseId.value = recognizedPoses.value[0]?.id || ''; if (saved.characterId !== '' && saved.characterId !== null && !sortedCharacters.value.some(item => Number(item.id) === Number(characterId.value))) characterId.value = sortedCharacters.value[0]?.id || ''; if (Number(secondCharacterId.value) === Number(characterId.value)) secondCharacterId.value = ''; syncAspect('width'); await Promise.resolve(); if (disposed) return; studioReady = true; persistSelection() })
onBeforeUnmount(() => { burst.detachInput(shotInput); disposed = true; poseRequest?.abort(); stopFakeProgress(); clearTimeout(flashTimer); clearTimeout(shutterTimer); promptRevision++ })
</script>

<style scoped>
.studio-pose-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;flex-shrink:0}.studio-pose-tools>.studio-button{min-width:0}
.studio-background-label{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.studio-pose-tools :deep(.studio-button__content){min-width:0;max-width:100%}

.studio-history{max-width:1500px;margin:auto}.history-heading{display:flex;align-items:center;justify-content:space-between}.history-heading h2{font-family:var(--font-display,serif)}.history-heading>span{font-size:12px;color:var(--text-secondary)}.history-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px}.history-item{background:var(--studio-paper);padding:10px;border:1px solid var(--studio-line);box-shadow:0 4px 12px var(--studio-shadow)}.history-item>img,.history-pending{width:100%;aspect-ratio:3/4;object-fit:contain;border-radius:0}.history-item>img{cursor:zoom-in}.history-pending{display:grid;place-items:center;background:var(--bg-sunken);color:var(--text-secondary);font-size:13px}.history-caption{display:grid;gap:5px;padding:9px 3px 2px}.history-caption>span,.history-caption small{font-size:11px;color:var(--text-secondary)}.history-caption small{color:var(--fun-orange)}.studio-empty{padding:40px;text-align:center;color:var(--text-secondary)}
.pose-search-upload{display:flex;align-items:center;gap:8px;min-width:0}.pose-search-upload>.studio-input{flex:1;width:0}.pose-search-upload>.studio-button{padding-inline:10px}.custom-pose-editor{display:grid;gap:8px;padding-top:8px}.custom-pose-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0}.pose-description-input{flex:1;min-width:0;max-width:100%}.pose-description-enter-active,.pose-description-leave-active{overflow:hidden;transition:max-width .3s ease,opacity .3s ease}.pose-description-enter-from,.pose-description-leave-to{max-width:0;opacity:0}.pose-upload-error{margin:0;color:var(--studio-tag);font-size:var(--fs-sm);line-height:1.6}
.pose-library{display:flex;flex-direction:column;min-height:0;height:100%;padding:12px}.pose-library>.library-tools{flex-shrink:0}
.library-tools{display:flex;flex-direction:column;gap:10px;padding:4px 4px 12px;scrollbar-color:var(--studio-muted) var(--studio-paper)}.library-tools>*{flex-shrink:0}
.library-system-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-width:0}.library-system-row>.studio-filter-options{flex:0 1 auto;max-width:100%}.library-system-categories{flex:1 1 220px;min-width:0}
.pose-gallery-grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));align-content:start;gap:24px 16px;padding:16px;background:var(--studio-film);scrollbar-color:var(--studio-shutter) var(--studio-film)}
.pose-option{min-width:0;cursor:pointer;text-align:left;display:grid;gap:7px;padding:7px;border:1px solid transparent;color:var(--studio-film-text);position:relative;transition:background .3s,transform .3s,border-color .3s}.pose-option:hover{background:var(--studio-film-edge);transform:translateY(-3px)}.pose-option.selected{border-color:var(--studio-shutter)}.pose-option.selected::after{content:'';position:absolute;inset:-3px;border:2px solid var(--studio-shutter);border-radius:30% 3% 24% 4%;transform:rotate(-2deg);pointer-events:none}.pose-option:focus-visible{outline:2px solid var(--studio-shutter);outline-offset:3px}
.pose-option-image{position:relative;aspect-ratio:3/4;overflow:hidden;background:var(--dialogue-photo-paper);padding:4px}.pose-option-image img{width:100%;height:100%;object-fit:contain}.pose-option-image>span{position:absolute;left:4px;top:4px;padding:3px 6px;background:var(--studio-film);color:var(--studio-film-text);font-size:11px}.pose-option-image>i{position:absolute;right:4px;bottom:4px;padding:4px 8px;display:grid;place-items:center;background:var(--studio-shutter);color:var(--studio-film);font-style:normal;font-weight:900}.pose-option-heading{display:flex;gap:8px;align-items:baseline;min-width:0}.pose-option-heading small{font:italic 700 12px/1.5 monospace;color:var(--studio-shutter);flex-shrink:0}.pose-option-heading strong{font-size:13px;line-height:1.5;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.pose-option>span{font-size:11px;color:var(--studio-film-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.studio-wardrobe-tools{display:grid;gap:4px}.studio-wardrobe-selected{color:var(--studio-tag);white-space:nowrap}.studio-prompt-note{margin:0;font-size:14px;line-height:1.7;color:var(--studio-muted)}.studio-prompt-text{white-space:pre-wrap;font-size:14px;line-height:1.8;color:var(--studio-ink);overflow-wrap:anywhere}
.studio-exposure-enter-active{transition:opacity .3s,transform .3s}.studio-exposure-enter-from{opacity:0;transform:translateY(14px)}.studio-exposure-leave-active{transition:opacity .3s,transform .3s,filter .3s}.studio-exposure-leave-to{opacity:0;transform:translateY(-20px) rotate(-4deg) scale(.94);filter:blur(2px)}
.studio-photo-deck.studio-exposure-leave-active{transform-origin:50% 0;animation:studio-print-away .45s cubic-bezier(.55,0,.8,.4) both;transition:none}
@keyframes studio-print-away{0%{opacity:1;transform:none}25%{opacity:1;transform:translateY(8px) rotate(-2deg)}100%{opacity:0;transform:translateY(-65%) rotate(9deg) scale(.82);filter:blur(3px)}}
.shutter-sweep{position:absolute;inset:0;z-index:3;overflow:hidden;pointer-events:none}.shutter-sweep i{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 6px,var(--studio-film-edge) 7px 8px),var(--studio-film);border-bottom:3px solid var(--studio-shutter);animation:studio-curtain .7s cubic-bezier(.7,0,.2,1) both;clip-path:polygon(0 0,100% 0,100% 52%,0 48%)}.shutter-sweep i:nth-child(2){rotate:180deg}.shutter-sweep span{position:absolute;left:50%;top:50%;padding:8px 18px;border:3px solid var(--studio-shutter);color:var(--studio-shutter);font:italic 900 clamp(28px,4vw,56px)/1 Impact,sans-serif;letter-spacing:.06em;animation:studio-exposed .7s ease both}
@keyframes studio-curtain{0%{transform:translateY(-100%)}35%,55%{transform:translateY(0)}100%{transform:translateY(-100%)}}@keyframes studio-exposed{0%,25%{opacity:0;transform:translate(-50%,-50%) rotate(-10deg) scale(1.4)}40%,55%{opacity:1;transform:translate(-50%,-50%) rotate(-10deg) scale(1)}85%,100%{opacity:0;transform:translate(-50%,-65%) rotate(-10deg) scale(.98)}}

/* Film darkroom: sprockets, contact prints and engraved camera controls. */
.studio-page { position:absolute; inset:0; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior-y:contain; padding:22px 30px 10px; color:var(--studio-ink); background:url('../assets/studio-photocopy.svg'),repeating-linear-gradient(174deg,transparent 0 75px,color-mix(in srgb,var(--studio-ink) 4%,transparent) 76px,transparent 78px 150px),var(--studio-bg); animation:studio-enter .3s ease both; }
.studio-header { width:100%; max-width:2200px; margin:0 auto 24px; padding:0 4px 12px; display:grid; grid-template-columns:minmax(0,1fr) minmax(180px,286px); align-items:center; gap:32px; min-height:126px; background:transparent; border-bottom:0; position:relative; }

.studio-heading { display:flex; flex-direction:column; align-items:flex-start; gap:4px; position:relative; padding:0; justify-self:start; }
.studio-heading h1 { display:flex; align-items:center; gap:25px; margin:0; font-family:inherit; font-size:clamp(52px,5.6vw,84px); font-weight:950; letter-spacing:-.08em; line-height:1; color:var(--studio-ink); }
.studio-club { font:800 11px/1.5 monospace; letter-spacing:.13em; color:var(--studio-muted); }
.studio-emblem { display:none; }.studio-raw { position:relative; color:var(--studio-tag); display:grid; gap:.08em; font:italic 900 .34em/1.12 Impact,"Arial Narrow",sans-serif; letter-spacing:.01em; transform:rotate(-13deg); text-decoration:none; }
.studio-raw::after { content:""; position:absolute; inset:-5px -10px; border:2px solid var(--studio-tag); border-radius:47% 42% 44% 38%; transform:rotate(7deg); }
.film-margin-note { position:absolute; left:76px; top:50%; width:220px; text-align:center; transform:translate(-50%,-50%) rotate(-90deg); transform-origin:center; display:grid; gap:.12em; font:900 clamp(24px,2vw,30px)/1.12 Impact,"Arial Narrow",sans-serif; letter-spacing:.01em; white-space:nowrap; color:color-mix(in srgb,var(--studio-film-text) 15%,transparent); pointer-events:none; }
.studio-tagline { width:210px; height:22px; color:var(--studio-tag); margin-top:-5px; }
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
.portrait-mat { flex:1; min-height:0; container-type:size; display:grid; place-items:center; position:relative; isolation:isolate; overflow:hidden; padding:18px 44px 20px; background:linear-gradient(90deg,var(--studio-film-edge) 30px,transparent 30px,transparent calc(100% - 30px),var(--studio-film-edge) calc(100% - 30px)); }
/* Keep the worn darkroom surface behind the print and out of hit testing. */
.mat-patina { position:absolute; inset:0; z-index:-1; pointer-events:none; user-select:none; }
.mat-patina::before { content:''; position:absolute; inset:0; background:url('../assets/studio-photocopy.svg') repeat; opacity:.55; mix-blend-mode:screen; }
.mat-stamp { position:absolute; right:48px; bottom:28px; width:clamp(96px,20cqw,136px); height:auto; color:var(--studio-shutter); opacity:.24; transform:rotate(-14deg); mask:url('../assets/studio-worn-ink.svg') center / 100% 100%; }
.mat-stamp text { fill:currentColor; text-anchor:middle; font-family:'Arial Narrow',sans-serif; font-weight:800; }
.mat-stamp-small { font-size:11px; letter-spacing:2px; }
.mat-stamp-title { font-size:17px; letter-spacing:-.5px; }
@media(max-width:520px) {
  .mat-stamp { right:28px; bottom:22px; width:88px; opacity:.19; }
}
.portrait-mat::before,.portrait-mat::after { content:''; position:absolute; top:12px; bottom:12px; width:12px; background:linear-gradient(var(--studio-perforation) 0 13px,transparent 13px 28px) 0 0 / 12px 28px repeat-y; pointer-events:none; opacity:.8; }.portrait-mat::before { left:9px; }.portrait-mat::after { right:9px; }

.portrait-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; padding:14px 18px; background:var(--studio-paper); border-top:7px solid var(--studio-shutter); }
.portrait-selection { display:grid; gap:3px; min-width:0; }.portrait-selection strong { font-size:17px; font-weight:650; line-height:1.4; overflow-wrap:anywhere; }.portrait-selection>span { font-size:12px; color:var(--studio-muted); overflow-wrap:anywhere; }.portrait-selection .next-shot { font:10px/1.5 monospace; letter-spacing:.16em; }.portrait-actions>.studio-shutter { flex-shrink:0; }
.mobile-studio-links { display:none; }.mobile-studio-links>.studio-button { min-height:44px; }
.character-slot-tools { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }.character-slot-tools>.ls-tabs { flex:1; min-width:170px; }
.character-grid { flex:1; min-height:0; overflow:auto; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-auto-rows:max-content; gap:12px 8px; align-content:start; padding:8px; background:var(--studio-film); border:0; border-radius:0; scrollbar-color:var(--studio-shutter) var(--studio-film); }
.character-choice { min-width:0; position:relative; display:flex; flex-direction:column; align-items:center; gap:0; padding:4px 4px 0; cursor:pointer; border:1px solid transparent; background:transparent; text-align:center; transition:background .3s,border-color .3s,box-shadow .3s; }
.character-choice.selected { border-color:var(--studio-shutter); box-shadow:none; background:var(--studio-film-edge); }.character-choice.is-other-slot { border-color:var(--studio-film-muted); }
.character-choice.selected::after { content:''; position:absolute; inset:-2px; border:2px solid var(--studio-shutter); border-radius:35% 6% 30% 5%; transform:rotate(-4deg); pointer-events:none; }
.random-character-mark { width:64%; height:64%; }.character-choice.is-disabled { cursor:not-allowed; opacity:.5; }
.character-face { width:100%; aspect-ratio:1; flex:none; position:relative; background:var(--studio-film-edge); }.character-face img,.character-face>span { display:block; width:100%; height:100%; border-radius:50%; object-fit:cover; }.character-face>span { display:grid; place-items:center; font-size:25px; color:var(--studio-film-text); }.character-face i { position:absolute; left:0; bottom:0; padding:2px 5px; background:var(--studio-shutter); color:var(--studio-film); font-size:10px; font-style:normal; font-weight:600; }
.character-contact { width:100%; display:flex; align-items:center; justify-content:space-between; gap:4px; min-height:24px; }
.character-outfit { font-size:var(--fs-xs); color:var(--studio-film-muted); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.contact-number { align-self:flex-start; font:italic 700 12px/1.6 monospace; color:var(--studio-shutter); letter-spacing:.1em; padding-top:3px; }
.character-name { width:100%; flex:none; font-size:12px; line-height:1.5; min-height:25px; padding:0 0 5px; color:var(--studio-film-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:400; }
.reference-hint,.rail-empty { font-size:12px; line-height:1.6; color:var(--studio-muted); }
.empty-negative,.developing-state { text-align:center; color:var(--studio-film-text); position:relative; padding:24px; }.empty-negative { display:grid; justify-items:center; gap:16px; }.negative-mark { display:block; width:88px; height:88px; color:var(--studio-shutter); }.empty-negative>span:nth-child(2) { font-size:clamp(20px,2.5vw,30px); font-family:Georgia,'Songti SC',serif; }.empty-negative p,.developing-state p { margin:0; font-size:14px; line-height:1.7; color:var(--studio-film-muted); }.developing-state { width:min(100%,410px); }.developing-state h3 { font-size:23px; }.spinner { margin:auto; width:40px; height:40px; border:2px solid var(--studio-film-muted); border-top-color:var(--studio-shutter); border-radius:50%; animation:studio-spin .8s linear infinite; }.develop-track { overflow:hidden; height:3px; background:var(--studio-film-edge); margin-top:24px; }.develop-track span { display:block; width:100%; height:100%; transform-origin:left; background:var(--studio-shutter); transition:transform .3s; }.studio-error { font-size:13px; line-height:1.6; padding:10px 14px; background:var(--studio-paper); color:var(--fun-orange); display:flex; align-items:center; justify-content:space-between; gap:8px; overflow-wrap:anywhere; }
.character-choice:focus-visible { outline:2px solid var(--studio-shutter); outline-offset:2px; }.pose-card:focus-visible { outline:2px solid var(--studio-accent); outline-offset:3px; }
@media(hover:hover) { .character-choice:hover:not(.is-disabled) { background:var(--studio-film-edge); border-color:var(--studio-shutter); } }
.studio-content-enter-active,.studio-content-leave-active { transition:opacity .3s,transform .3s; }.studio-content-enter-from,.studio-content-leave-to { opacity:0; transform:translateY(6px); }
@media(min-width:981px) {
  .studio-header { grid-template-columns:244px minmax(0,1fr) 286px; gap:22px; height:126px; box-sizing:border-box; padding-inline:0; }
  .studio-darkroom { margin-top:-150px; }
  .studio-heading { grid-column:1; grid-row:1; align-self:start; justify-content:center; width:100%; height:114px; gap:8px; max-width:100%; }
  .studio-heading h1 { font-size:54px; gap:12px; }
  .studio-club { font-size:10px; letter-spacing:.06em; }
  .studio-tagline { width:100%; height:26px; }
  .studio-header-actions { grid-column:3; grid-row:1; align-self:start; justify-self:stretch; }
  .studio-characters { margin-top:-98px; gap:8px; }
}
@media(min-width:981px) and (pointer:coarse) { .studio-characters { margin-top:-90px; } }
@media(min-width:1800px) { .studio-header { grid-template-columns:280px minmax(0,1fr) 330px; gap:32px; }.studio-heading h1 { font-size:62px; } }
@media(min-width:981px) and (max-width:1200px) { .studio-header { grid-template-columns:210px minmax(0,1fr) 206px; gap:18px; }.studio-heading h1 { font-size:46px; gap:10px; }.studio-club { font-size:9px; } }
@media(min-width:1800px) { .studio-body { grid-template-columns:280px minmax(0,1fr) 330px; gap:32px; }.character-name { font-size:14px; }.rail-title h2 { font-size:19px; } }
@media(max-width:1200px) { .film-margin-note { display:none; } .studio-page { padding:16px 18px 24px; }.studio-header { width:100%; margin-inline:0; padding-inline:0; gap:20px; }.studio-body { grid-template-columns:210px minmax(0,1fr) 206px; gap:18px; }.character-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.rail-title h2 { font-size:16px; }.rail-title { flex-wrap:wrap; }.portrait-actions { flex-wrap:wrap; }.portrait-actions>.studio-shutter { margin-left:auto; } }
@media(max-width:980px) { .mobile-studio-links { display:flex; flex-direction:row; gap:8px; align-items:center; margin-left:auto; flex-shrink:0; }.studio-pose,.studio-characters { scroll-margin-top:16px; }.studio-body { height:auto; grid-template-columns:1fr 1fr; gap:22px; }.studio-darkroom { grid-column:1/-1; grid-row:1; height:max(520px,75dvh); }.studio-pose { grid-column:1; }.studio-characters { grid-column:2; }.pose-card { flex:none; height:240px; }.character-grid { max-height:530px; }.library-tools { gap:8px; }.library-count { grid-column:1/-1; text-align:left; }.pose-gallery-grid { grid-template-columns:repeat(auto-fill,minmax(105px,1fr)); } }
@media(max-width:520px) { .studio-page { padding:12px 12px 24px; }.studio-header { width:100%; margin-inline:0; padding:8px 0 0; grid-template-columns:1fr; gap:16px; margin-bottom:20px; }.studio-heading { grid-column:1; grid-row:1; justify-self:start; padding-left:6px; }.studio-heading h1 { font-size:58px; gap:22px; }.studio-header-actions { grid-row:2; justify-content:flex-end; }.studio-tagline { width:180px; height:18px; }.studio-club { font-size:10px; }.studio-body { grid-template-columns:1fr; gap:24px; }.studio-darkroom { height:max(510px,70dvh); }.film-frame-edge { padding-inline:26px; }.portrait-mat { padding:8px 26px 16px; background:linear-gradient(90deg,var(--studio-film-edge) 18px,transparent 18px,transparent calc(100% - 18px),var(--studio-film-edge) calc(100% - 18px)); }.portrait-mat::before,.portrait-mat::after { width:8px; background-size:8px 28px; }.portrait-mat::before { left:5px; }.portrait-mat::after { right:5px; }.portrait-actions { padding:12px; gap:10px; }.portrait-selection strong { font-size:16px; }.portrait-actions>.studio-shutter { margin-left:0; width:100%; }.studio-pose,.studio-characters { grid-column:1; }.studio-characters { grid-row:2; }.studio-pose,.studio-characters { transform:none; }.character-grid { grid-template-columns:repeat(3,minmax(0,1fr)); max-height:310px; }.character-name { font-size:13px; }.pose-card { height:260px; }.size-ratios { grid-template-columns:repeat(4,minmax(0,1fr)); }.size-controls { grid-template-columns:1fr 1fr; gap:16px; }.rail-title h2 { font-size:18px; }.portrait-selection>span { font-size:11px; } }
.portrait-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px}.portrait-selection{grid-column:1;grid-row:1}.portrait-actions>.studio-shutter{grid-column:2;grid-row:1}.mobile-studio-links{grid-column:1/-1;grid-row:2;justify-self:end}
@media(max-width:600px){.portrait-actions{grid-template-columns:1fr;gap:10px}.portrait-actions>.studio-shutter{grid-column:1;grid-row:2;width:100%}.mobile-studio-links{grid-row:3;justify-self:start;margin:0}}
@media(prefers-reduced-motion:reduce) { .pose-description-enter-active,.pose-description-leave-active{transition:none}.shutter-sweep{display:none}.studio-page,.studio-page * { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
@keyframes studio-enter{from{opacity:0}to{opacity:1}}@keyframes studio-spin{to{transform:rotate(360deg)}}
.studio-shutter { display:flex; min-width:0; }
.studio-shutter>.studio-button { flex:1; min-width:0; }
.studio-mobile-back { display:none; }
.deck-developing { position:absolute; z-index:13; left:32px; right:32px; bottom:6px; display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--studio-film); color:var(--studio-film-text); font-size:var(--fs-xs); }
.deck-developing .develop-track { position:absolute; left:0; right:0; bottom:0; margin:0; }
@media(max-width:767px) { .studio-mobile-back { display:inline-flex; position:absolute; right:0; top:0; z-index:2; }.studio-header-actions { padding-top:36px; } }
@media(max-width:520px) { .studio-header-actions { padding-top:0; }.studio-heading h1 { font-size:clamp(44px,13vw,58px); gap:18px; }.studio-club { max-width:calc(100vw - 92px); font-size:9px; letter-spacing:.06em; } }
</style>
