<template>
  <main ref="stage" class="standing-display" :class="{ paused: hidden, interacting: interaction.enabled, 'gravity-active': gravityActive }" aria-label="角色立绘展示">
    <Transition name="standing-character" mode="out-in">
      <div v-if="shown.characterId" :key="shown.characterId" class="standing-actor">
        <div v-if="!shown.imageUrl" class="standing-empty" role="status">
          <p>当前角色未生成{{ shown.missingCount || 1 }}套立绘</p>
          <p>请去角色卡的立绘管理内创建</p>
          <linshe-button size="sm" :loading="openingStandingManager" @click="openStandingManager">前往当前角色立绘管理 ↗</linshe-button>
        </div>
        <Transition name="standing-reason">
          <div v-if="bubble && shown.imageUrl && !interaction.speaking" :key="bubble.id" class="standing-reason" :style="{ bottom: `${geometry.height + 30}px`, left: '50%' }" role="status">
            <svg class="thought-cloud" viewBox="0 0 320 140" preserveAspectRatio="none" aria-hidden="true"><path d="M40 112 C8 115 3 77 22 64 C6 40 32 15 59 24 C65 2 101 1 119 16 C140 0 169 5 179 16 C204 0 240 7 249 25 C280 15 306 39 294 61 C324 80 309 112 282 111 C271 137 234 135 215 122 C190 141 161 137 148 125 C120 143 91 134 82 121 C65 132 44 130 40 112 Z" /></svg>
            <span class="thought-text">{{ bubble.text }}</span>
            <i class="thought-dot thought-dot-large" aria-hidden="true" /><i class="thought-dot thought-dot-small" aria-hidden="true" />
          </div>
        </Transition>
        <div :key="feedback" class="standing-feedback" :class="{ react: feedback > 0, interacting: interaction.enabled }">
          <div class="standing-gravity" :style="gravityStyle">
          <div class="touch-motion">
          <div class="standing-sway">
<div class="standing-breath">
            <Transition name="standing-expression">
              <div v-if="visual.imageUrl" :key="visual.imageUrl" class="standing-image" :style="{ width: `${geometry.width}px`, height: `${geometry.height}px` }">
                <StandingTouchMotion :reaction="reaction" :contact="touchContact" :bounds="shown.bounds">
                <img :src="visual.imageUrl" alt="" :style="geometry.image" draggable="false">
                <StandingInteractionLayer ref="interactionLayer" v-if="interaction.enabled && shown.bounds && !reaction?.slot" :bounds="shown.bounds" :disabled="interaction.disabled" :generation="interaction.generation" @contact="touchContact=$event" @action="(action,point)=>interactionControls?.act(action,point)" />
</StandingTouchMotion>
                <StandingTouchRipple v-if="reaction && !reaction.passive" :key="reaction.id" :style="ripplePosition" />
              </div>
            </Transition>
          </div>
</div>
</div>
        </div>
        </div>
      </div>
    </Transition>
    <Transition name="standing-reason">
      <div v-if="gravityAvailable && !gravityReduced && gravityPermission !== 'granted' && !mobileSidebarOpen && shown.imageUrl" class="gravity-controls">
        <linshe-button size="sm" variant="ghost" :loading="gravityRequesting" @click="authorizeGravity">{{ gravityPermission === 'denied' ? '重新授权' : '授权体感' }}</linshe-button>
      </div>
    </Transition>
    <StandingInteractionControls ref="interactionControls" :base="shown" :bubble-bottom="geometry.height + 42" :suspended="hidden || mobileSidebarOpen || pendingImage" @state="interaction=$event" @reaction="reaction=$event" />
  </main>
  <Transition name="scrim-fade">
    <div v-if="isMobile && mobileSidebarOpen" class="mobile-scrim" @click="mobileSidebarOpen = false"></div>
  </Transition>
  <Sidebar v-if="sidebarReady && isMobile" :is-mobile="true" :mobile-open="mobileSidebarOpen" @char-selected="mobileSidebarOpen = false" />
  <Toast ref="displayToast" />
  <ExpressionStandingManager :open="showStandingManager" :character="managedCharacter" @close="closeStandingManager" />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import ExpressionStandingManager from '../components/ExpressionStandingManager.vue'
import { useStandingGravity } from '../composables/useStandingGravity.js'
import Toast from '../components/Toast.vue'
import Sidebar from '../components/Sidebar.vue'
import StandingTouchRipple from '../components/standing/StandingTouchRipple.vue'
import StandingTouchMotion from '../components/standing/StandingTouchMotion.vue'
import StandingInteractionLayer from '../components/standing/StandingInteractionLayer.vue'
import StandingInteractionControls from '../components/standing/StandingInteractionControls.vue'
import { useChatStore } from '../stores/chat.js'
import { createMobileSidebarBackHandler } from '../utils/mobileSidebarBack.js'
import { getStandingDisplayState } from '../api/index.js'
import { standingGeometry } from '../utils/standingGeometry.js'
import { standingPresentationChanged } from '../utils/standingInteractionRules.js'
import { onEvent, startUnifiedStream, stopUnifiedStream } from '../stores/unifiedStream.js'
const stage = ref(null), shown = ref({}), bubble = ref(null), hidden = ref(document.hidden), feedback = ref(0)
const interactionControls=ref(null),interaction=ref({enabled:false}),reaction=ref(null)
const interactionLayer=ref(null),pendingImage=ref(false),touchContact=ref(null)
const visual=computed(()=>reaction.value?.slot || shown.value)
const ripplePosition=computed(()=>{const r=reaction.value,b=shown.value.bounds;if(!r?.point||r.slot||!b)return {};return {left:`${(r.point.x*b.imageWidth-b.x)/b.width*100}%`,top:`${(r.point.y*b.imageHeight-b.y)/b.height*100}%`}})
const size = ref({ width: window.innerWidth, height: window.innerHeight })
let latest = null, loadVersion = 0, observer
const originalTitle = document.title
const displayToast = ref(null)
const mobileSidebarOpen = ref(false), sidebarReady = ref(false)
const isDesktopWindow = new URLSearchParams(window.location.hash.split('?')[1]).get('desktop') === '1'
const isMobile = computed(() => !isDesktopWindow && size.value.width <= 767)
const { available: gravityAvailable, permission: gravityPermission,
  requesting: gravityRequesting, reduced: gravityReduced,
  active: gravityActive, style: gravityStyle, authorize: authorizeGravity } = useStandingGravity({
  excluded: isDesktopWindow,
  suspended: computed(() => hidden.value || mobileSidebarOpen.value || pendingImage.value || !shown.value.imageUrl),
  touching: computed(() => Boolean(touchContact.value)),
})
const chat = useChatStore()
const showStandingManager = ref(false), openingStandingManager = ref(false), managedCharacter = ref(null)
async function openStandingManager() {
  const characterId = shown.value.characterId
  if (!characterId || openingStandingManager.value) return
  openingStandingManager.value = true
  try {
    await chat.loadCharacters()
    if (shown.value.characterId !== characterId) return
    const character = chat.characters.find(item => String(item.id) === String(characterId))
    if (!character) throw new Error('当前角色不存在，请刷新后重试')
    managedCharacter.value = character
    showStandingManager.value = true
  } catch (error) {
    displayToast.value?.show(error.message || '角色加载失败，请稍后重试', 'error')
  } finally {
    openingStandingManager.value = false
  }
}
function closeStandingManager() {
  showStandingManager.value = false
  sync()
}
const handleAndroidBack = createMobileSidebarBackHandler({
  isMobile: () => isMobile.value,
  isOpen: () => mobileSidebarOpen.value,
  open: () => {
    sidebarReady.value = true
    mobileSidebarOpen.value = true
    chat.loadCharacters().catch(() => displayToast.value?.show('角色列表加载失败，请稍后重试', 'error'))
  },
})
const geometry = computed(() => standingGeometry(visual.value.bounds, size.value.width, size.value.height,{vertical:180,horizontal:32}))
function updateBubble(reason) {
  bubble.value = reason?.text?.trim() ? reason : null
}
async function apply(data) {
  if (latest?.epoch === data.epoch && latest.revision >= data.revision) return
  if(standingPresentationChanged(shown.value,data))interactionControls.value?.clear()
  latest = data
  const ticket = ++loadVersion
  pendingImage.value=true
  if (data.imageUrl && data.imageUrl !== shown.value.imageUrl) {
    try { await new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = reject; img.src = data.imageUrl }) }
    catch { data = { ...data, imageUrl: null } }
  }
  if (ticket !== loadVersion) return
  pendingImage.value=false
  const previous = shown.value
  shown.value = data
  if (previous.characterId === data.characterId && previous.replyVersion !== undefined && data.replyVersion > previous.replyVersion) feedback.value++
  updateBubble(data.reason)
}
async function sync() { try { await apply(await getStandingDisplayState()) } catch { /* Retain last frame while disconnected. */ } }
function visibility() { hidden.value = document.hidden; if (!hidden.value) sync() }
const offs = [onEvent('standing_display_state', apply), onEvent('connected', sync)]
onMounted(() => {
  if (!isDesktopWindow) window.__linsheHandleAndroidBack = handleAndroidBack
  if (new URLSearchParams(window.location.hash.split('?')[1]).get('desktop') === '1') {
    document.title = '用手机查看效果更佳~'
    displayToast.value?.show('用手机查看效果更佳~', 'info', 3000)
  }
  document.documentElement.classList.add('standing-display-only')
  observer = new ResizeObserver(entries => { const r = entries[0].contentRect; size.value = { width: r.width, height: r.height } })
  observer.observe(stage.value)
  document.addEventListener('visibilitychange', visibility)
  startUnifiedStream(); sync()
})
onBeforeUnmount(() => {
  if (window.__linsheHandleAndroidBack === handleAndroidBack) delete window.__linsheHandleAndroidBack
  document.title = originalTitle
  loadVersion++; observer?.disconnect(); offs.forEach(fn => fn()); stopUnifiedStream()
  document.removeEventListener('visibilitychange', visibility)
  document.documentElement.classList.remove('standing-display-only')
})
</script>

<style>
@property --standing-sway-strength { syntax:"<number>"; inherits:false; initial-value:1; }
.standing-display-only .bg-geo,.standing-display-only .bg-pattern { display:none; }
</style>
<style scoped>
.standing-display { position:fixed; inset:0; background:var(--bg-primary); overflow:hidden; color:var(--text-primary); }
.standing-actor { position:absolute; inset:0; }
.standing-empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:24px; text-align:center; color:var(--text-secondary); font-size:var(--fs-sm); line-height:1.7; }
.standing-empty p { margin:0; }
.standing-empty p:first-child { color:var(--text-primary); font-size:var(--fs-base); font-weight:600; }
.standing-feedback { position:absolute; bottom:max(16px,env(safe-area-inset-bottom)); left:50%; width:0; }
.standing-gravity { position:relative; }
.gravity-controls { position:absolute; z-index:5; top:max(12px,env(safe-area-inset-top)); right:max(12px,env(safe-area-inset-right)); display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px; max-width:calc(100% - 24px); }
.touch-motion{position:relative;transform-origin:center bottom}
@media(prefers-reduced-motion:reduce){.touch-motion,.standing-breath,.standing-sway,.standing-feedback{animation:none!important}}
.standing-sway,.standing-breath { position:relative; transform-origin:center bottom; }
.standing-image { position:absolute; bottom:0; left:0; transform:translateX(-50%); overflow:hidden; }
.standing-image img { position:absolute; max-width:none; object-fit:fill; }
.standing-breath { animation:standing-breathe 4.5s ease-in-out infinite; }
.standing-sway { animation:standing-sway 7s ease-in-out infinite; --standing-sway-strength:1; transition:--standing-sway-strength .3s ease; }
.gravity-active .standing-sway { --standing-sway-strength:0; }
.standing-feedback.react { animation:standing-react .4s ease-in-out; }
.standing-reason { position:absolute; left:50%; transform:translateX(-50%); width:max-content; max-width:calc(100% - 40px); padding:23px 34px; font-size:var(--fs-base); overflow-wrap:anywhere; }
.thought-cloud { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
.thought-cloud path { fill:var(--modal-bg); stroke:var(--cel-outline); stroke-width:2.5; vector-effect:non-scaling-stroke; stroke-linejoin:round; }
.thought-text { position:relative; display:block; max-height:56px; overflow:auto; text-align:center; }
.thought-dot { position:absolute; background:var(--modal-bg); border:2px solid var(--cel-outline); border-radius:50%; }
.thought-dot-large { width:17px; height:13px; bottom:-13px; left:60%; transform:rotate(-15deg); }
.thought-dot-small { width:8px; height:7px; bottom:-26px; left:56%; }
.standing-character-enter-active,.standing-character-leave-active { transition:transform .3s var(--ease-out),opacity .3s ease; }
.standing-character-enter-from { transform:translateX(100%); opacity:0; }
.standing-character-leave-to { transform:translateX(-100%); opacity:0; }
.standing-expression-enter-active,.standing-expression-leave-active,.standing-reason-enter-active,.standing-reason-leave-active { transition:opacity .3s ease; }
.standing-expression-enter-from,.standing-expression-leave-to,.standing-reason-enter-from,.standing-reason-leave-to { opacity:0; }
.paused * { animation-play-state:paused !important; }
@keyframes standing-breathe { 0%,100% { transform:scaleY(1); } 50% { transform:scaleY(1.0075); } }
@keyframes standing-sway { 0%,100% { transform:rotate(calc(-.3deg * var(--standing-sway-strength))); } 50% { transform:rotate(calc(.3deg * var(--standing-sway-strength))); } }
@keyframes standing-react { 0%,100% { transform:rotate(0); } 50% { transform:rotate(.6deg); } }
</style>
