<template>
  <Teleport to="body">
    <Transition name="svc-modal">
      <div v-if="open" class="svc-overlay" @click="onOverlayClick">
        <div class="svc-film" @click.stop>
          <div class="svc-film-edge svc-film-edge-top" aria-hidden="true"></div>

          <div class="svc-body">
            <template v-if="phase === 'loading'">
              <div class="svc-wait">
                <div class="svc-ring-container">
                  <svg viewBox="0 0 80 80" class="svc-ring">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3" />
                    <circle
cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" stroke-width="3"
                      stroke-linecap="round" :stroke-dasharray="2 * Math.PI * 34"
                      :stroke-dashoffset="2 * Math.PI * 34 * (1 - progress / 100)"
                      class="svc-ring-progress"
/>
                  </svg>
                  <div class="svc-ring-pct">{{ progress }}%</div>
                </div>
                <div class="svc-wait-phrase">
                  <Transition name="svc-phrase" mode="out-in">
                    <p :key="phraseIndex">{{ currentPhrase }}</p>
                  </Transition>
                </div>
              </div>
            </template>

            <template v-else-if="phase === 'error'">
              <div class="svc-error">
                <p>这次没能成行</p>
                <span>{{ error }}</span>
                <linshe-button v-if="kind !== 'gift'" variant="secondary" size="sm" @click="retry">再试一次</linshe-button>
              </div>
            </template>

            <div v-else class="svc-shot" :class="{ fire: shutter }">
              <img v-if="imageUrl" :src="imageUrl" class="svc-img" alt="" @click="zoom = true" />
              <div v-else class="svc-img svc-img-empty">画面生成中</div>
              <!-- 相机快门：白闪 + 上下帘幕，和「瞄一眼」同款 -->
              <div class="svc-shutter-flash" aria-hidden="true"></div>
              <div class="svc-shutter-curtain svc-curtain-top" aria-hidden="true"></div>
              <div class="svc-shutter-curtain svc-curtain-bottom" aria-hidden="true"></div>
            </div>
          </div>

          <div class="svc-film-edge svc-film-edge-bottom" aria-hidden="true"></div>

          <div class="svc-bar">
            <div class="svc-who">
              <b>{{ npcName || '邻居' }}</b>
              <span class="svc-offer">{{ offerTitle }}</span>
            </div>
            <div v-if="money" class="svc-coin" :class="money.delta >= 0 ? 'is-earn' : 'is-pay'">
              {{ money.delta >= 0 ? '+' : '' }}{{ money.delta }} 金币
            </div>
          </div>
        </div>

        <Transition name="svc-tale">
          <div v-if="phase === 'ready'" class="svc-tale" @click.stop>
            <p class="svc-tale-text">{{ tale }}</p>
            <div v-if="options.length" class="svc-options">
              <linshe-button
v-for="option in options" :key="option.tone" variant="secondary" size="sm"
                :class="option.tone === 'bold' ? 'is-bold' : ''" :disabled="busy" @click="choose(option)"
>
                <span>{{ option.label }}</span>
                <span v-if="option.delta != null" class="svc-opt-price" :class="option.delta >= 0 ? 'is-earn' : 'is-pay'">
                  {{ option.delta >= 0 ? '+' : '' }}{{ option.delta }}
                </span>
              </linshe-button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- 查看详情：复用全站统一的图片灯箱（缩放 / 旋转 / 拖拽 / ESC 关闭） -->
  <Teleport to="body">
    <ImageLightbox :visible="zoom" :imgs="imageUrl ? [imageUrl] : []" :z-index="1300" @hide="zoom = false" />
  </Teleport>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import ImageLightbox from '../ImageLightbox.vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { onEvent } from '../../stores/unifiedStream.js'
import { continueNpcService } from '../../api/townLife.js'

const props = defineProps({
  open: Boolean,
  session: Object,
  worldId: String,
  worldEpoch: Number,
})
const emit = defineEmits(['close', 'money'])
const toast = inject('toast', null)

const phase = ref('loading')
const realPct = ref(0)
const simulatedPct = ref(0)
const imageUrl = ref(null)
const tale = ref('')
const options = ref([])
const money = ref(null)
const error = ref('')
const busy = ref(false)
const shutter = ref(false)
const zoom = ref(false)
const currentSession = ref(null)

const kind = computed(() => currentSession.value?.kind || props.session?.kind || 'service')
const kindLabel = computed(() => (kind.value === 'work' ? '打工' : kind.value === 'gift' ? '礼物' : '服务'))
const npcName = computed(() => currentSession.value?.npcName || props.session?.npcName || '')
const offerTitle = computed(() => currentSession.value?.offerTitle || props.session?.offerTitle || '')
const progress = computed(() => {
  if (phase.value === 'ready') return 100
  const fake = Number.isFinite(simulatedPct.value) ? simulatedPct.value : 0
  const real = Number.isFinite(realPct.value) ? realPct.value : 0
  return Math.max(0, Math.min(100, Math.round(Math.max(fake, real))))
})

// 加载文案轮播：和「瞄一眼」同款的上浮淡出 / 下方浮入。
// 服务是「别人伺候你」、打工是「你去伺候别人」，两套文案分开写，具体一点、带点自嘲。
const phrases = computed(() => {
  // 礼物：把小镇货摊买来的道具送给角色，等 TA 拆开、用起来的样子。
  if (kind.value === 'gift') return [
    '正在把礼物递过去',
    '正在看 TA 拆开包装',
    '正在想 TA 会不会喜欢',
    '正在等 TA 抬起头',
    '正在把这一刻拍下来',
  ]
  return (kind.value === 'work'
  ? [
      '正在把袖子挽到手肘',
      '正在找那把不知道被谁顺走的扫帚',
      '正在和一堆杂物较劲',
      '正在擦汗，顺便直起腰看看还剩多少',
      '正在假装这点活根本不算什么',
      '正在等雇主把要求补完',
    ]
  : [
      '正在把垫子拍松，请你躺下',
      '正在把工具一件件摆整齐',
      '正在找一个不硌人的角度',
      '正在问你这力道还行不行',
      '正在假装没听见你喊「轻点」',
      '正在给你递一杯温水',
    ])
})
const phraseIndex = ref(0)
const currentPhrase = computed(() => `${phrases.value[phraseIndex.value % phrases.value.length]}\u2026\u2026`)
let phraseTimer = null
function startPhrases() {
  stopPhrases()
  phraseIndex.value = 0
  phraseTimer = setInterval(() => { phraseIndex.value = (phraseIndex.value + 1) % phrases.value.length }, 3000)
}
function stopPhrases() { if (phraseTimer) { clearInterval(phraseTimer); phraseTimer = null } }

let simTimer = null
let maxed = false
function startProgress() {
  stopProgress()
  simulatedPct.value = 0
  realPct.value = 0
  maxed = false
  const tick = () => {
    simTimer = setTimeout(() => {
      if (phase.value !== 'loading') return
      if (realPct.value > simulatedPct.value) { tick(); return }
      if (!maxed) {
        simulatedPct.value = Math.min(95, simulatedPct.value + 1 + Math.random() * 3)
        if (simulatedPct.value >= 95) maxed = true
      }
      tick()
    }, 380 + Math.random() * 900)
  }
  tick()
}
function stopProgress() { if (simTimer) { clearTimeout(simTimer); simTimer = null } }

function beginSession(session) {
  currentSession.value = session
  phase.value = 'loading'
  imageUrl.value = null
  tale.value = ''
  options.value = []
  money.value = null
  error.value = ''
  busy.value = false
  shutter.value = false
  startProgress()
  startPhrases()
}

function applyReady(data) {
  if (data.error) {
    phase.value = 'error'
    error.value = messageForCode(data.error)
    stopProgress()
    stopPhrases()
    return
  }
  imageUrl.value = data.images?.[0] || null
  tale.value = data.tale || ''
  options.value = Array.isArray(data.options) ? data.options : []
  money.value = data.money || null
  phase.value = 'ready'
  busy.value = false
  simulatedPct.value = 100
  stopProgress()
  stopPhrases()
  shutter.value = false
  requestAnimationFrame(() => { shutter.value = true })
  if (money.value && money.value.delta) {
    const gain = money.value.delta > 0
    if (toast) toast(`${gain ? '+' : ''}${money.value.delta} 金币，${kindLabel.value}${gain ? '收入' : '支出'}`, gain ? 'success' : 'info')
    emit('money', money.value)
  }
}

function messageForCode(code) {
  return ({
    SERVICE_IMAGE_FAILED: '画面没能画出来，请重试。',
    SERVICE_JSON_MISSING: '这段经历没能生成出来，请重试。',
    SERVICE_PAYLOAD_INCOMPLETE: '这段经历不完整，请重试。',
    INSUFFICIENT_FUNDS: '可用金币不足，这次先算了。',
    ACTOR_UNAVAILABLE: '居民现在不在镇上。',
    STALE_EPOCH: '小镇已变化，请关闭后重新进入。',
    GIFT_IMAGE_FAILED: '画面没能画出来。',
    GIFT_JSON_MISSING: '这段礼物故事没能写出来。',
    GIFT_PAYLOAD_INCOMPLETE: '这段礼物故事不完整。',
    CHARACTER_NOT_FOUND: '目标角色不存在。',
  })[code] || code || '这次没能成行。'
}

async function choose(option) {
  if (busy.value || !currentSession.value) return
  busy.value = true
  const session = currentSession.value
  try {
    const next = await continueNpcService(session.npcId, {
      sessionId: session.sessionId, choice: option.tone, choiceLabel: option.label,
      worldId: props.worldId, worldEpoch: props.worldEpoch,
    })
    beginSession({ ...session, ...next, sessionId: session.sessionId })
  } catch (err) {
    busy.value = false
    error.value = messageForCode(err.code || err.message)
    if (toast) toast(error.value, 'error')
  }
}

async function retry() {
  const session = currentSession.value
  if (!session) return
  busy.value = true
  try {
    const next = await continueNpcService(session.npcId, {
      sessionId: session.sessionId, choice: 'normal', choiceLabel: '再来一次',
      worldId: props.worldId, worldEpoch: props.worldEpoch,
    })
    beginSession({ ...session, ...next, sessionId: session.sessionId })
  } catch (err) {
    busy.value = false
    error.value = messageForCode(err.code || err.message)
  }
}

function onOverlayClick() { emit('close') }

let unsubscribers = []
function subscribe() {
  unsubscribers.push(onEvent('town_npc_service_progress', d => {
    if (!d || d.sessionId !== currentSession.value?.sessionId) return
    // 只认有限数值：后端万一传来对象 / null / NaN，也不能把百分比算成 NaN%
    const pct = Number(d.progress)
    if (!Number.isFinite(pct)) return
    realPct.value = Math.max(0, Math.min(100, pct))
  }))
  unsubscribers.push(onEvent('town_npc_service_ready', d => {
    if (!d || d.sessionId !== currentSession.value?.sessionId) return
    applyReady(d)
  }))
  // 礼物叙事：道具送出去之后由 itemGiftNarrative 异步产出，payload 口径与小镇服务一致。
  unsubscribers.push(onEvent('item_gift_progress', d => {
    if (!d || d.sessionId !== currentSession.value?.sessionId) return
    const pct = Number(d.progress)
    if (!Number.isFinite(pct)) return
    realPct.value = Math.max(0, Math.min(100, pct))
  }))
  unsubscribers.push(onEvent('item_gift_ready', d => {
    if (!d || d.sessionId !== currentSession.value?.sessionId) return
    applyReady({ ...d, images: d.imageUrl ? [d.imageUrl] : [], options: [], money: null })
  }))
}
function unsubscribe() { for (const off of unsubscribers.splice(0)) off() }

watch(() => props.open, open => {
  if (open) {
    beginSession(props.session || {})
    subscribe()
  } else {
    unsubscribe()
    stopProgress()
    stopPhrases()
    zoom.value = false
  }
})
watch(() => props.session, session => {
  if (props.open && session && session.sessionId !== currentSession.value?.sessionId) beginSession(session)
})
onBeforeUnmount(() => { unsubscribe(); stopProgress(); stopPhrases() })
</script>

<style scoped>
/* 遮罩与「瞄一眼」同款：轻遮罩 + 模糊 */
.svc-overlay {
  position: fixed; inset: 0; z-index: 1200; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 14px; padding: 20px;
  background: rgba(0, 0, 0, .3); backdrop-filter: blur(4px);
}
/* 胶卷框：直角，和「瞄一眼」的相片框一致 */
.svc-film {
  position: relative; display: flex; flex-direction: column; width: min(88vw, 720px);
  background: #111; box-shadow: 0 12px 52px rgba(0, 0, 0, .4); overflow: hidden;
}
/* 上下黑边 + 白色矩形齿孔 */
.svc-film-edge { height: 20px; flex-shrink: 0; background: #111; position: relative; overflow: hidden; }
.svc-film-edge::before {
  content: ''; position: absolute; top: 4px; bottom: 4px; left: 11px; right: 11px;
  background: repeating-linear-gradient(90deg,
    rgba(255, 255, 255, .88) 0px, rgba(255, 255, 255, .88) 8px,
    transparent 8px, transparent 22px);
}
.svc-body {
  position: relative; flex-shrink: 0; aspect-ratio: 4 / 3; background: #111;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}

/*  加载：环形进度 + 文案轮播（参考瞄一眼）  */
.svc-wait { text-align: center; padding: 32px 24px; color: rgba(255, 255, 255, .72); }
.svc-ring-container { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
.svc-ring { width: 80px; height: 80px; transform: rotate(-90deg); }
.svc-ring-progress { transition: stroke-dashoffset .4s ease; }
.svc-ring-pct {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums;
}
.svc-wait-phrase { position: relative; min-height: 24px; display: flex; align-items: center; justify-content: center; }
.svc-wait-phrase p { margin: 10px 0 0; font-size: .88rem; white-space: nowrap; }
.svc-phrase-enter-active, .svc-phrase-leave-active { transition: all .45s cubic-bezier(.4, 0, .2, 1); }
.svc-phrase-leave-to { transform: translateY(-14px); opacity: 0; }
.svc-phrase-enter-from { transform: translateY(14px); opacity: 0; }

.svc-error { display: flex; flex-direction: column; align-items: center; gap: 10px; color: rgba(255, 255, 255, .9); text-align: center; padding: 0 24px; }
.svc-error span { color: rgba(255, 255, 255, .6); font-size: 13px; }

/*  出图 + 相机快门（与瞄一眼同款：白闪 + 上下帘幕）  */
.svc-shot { position: absolute; inset: 0; overflow: hidden; }
.svc-img { width: 100%; height: 100%; object-fit: contain; display: block; cursor: zoom-in; }
.svc-img-empty { display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, .5); }
.svc-shutter-flash { position: absolute; inset: 0; z-index: 10; background: #fff; opacity: 0; pointer-events: none; }
.svc-shot.fire .svc-shutter-flash { animation: svc-shutter-flash .35s cubic-bezier(.4, 0, .2, 1) forwards; }
@keyframes svc-shutter-flash { 0% { opacity: .85; } 45% { opacity: .6; } 100% { opacity: 0; } }
.svc-shutter-curtain {
  position: absolute; left: 0; right: 0; z-index: 9; height: 51%; pointer-events: none;
  background: linear-gradient(180deg, #1a1a1a 0%, #2a2a2a 30%, #1a1a1a 100%);
}
.svc-curtain-top { top: 0; transform-origin: top center; box-shadow: 0 2px 8px rgba(0, 0, 0, .5); }
.svc-curtain-bottom { bottom: 0; transform-origin: bottom center; box-shadow: 0 -2px 8px rgba(0, 0, 0, .5); }
.svc-shot.fire .svc-curtain-top { animation: svc-curtain-top .38s .04s cubic-bezier(.25, .46, .45, .94) forwards; }
.svc-shot.fire .svc-curtain-bottom { animation: svc-curtain-bottom .38s .04s cubic-bezier(.25, .46, .45, .94) forwards; }
@keyframes svc-curtain-top { 0% { transform: scaleY(1); } 100% { transform: scaleY(0); } }
@keyframes svc-curtain-bottom { 0% { transform: scaleY(1); } 100% { transform: scaleY(0); } }

/*  底部信息栏：主题色（和瞄一眼的 pk-bar 一致）  */
.svc-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; background: var(--bg-secondary); color: var(--text-bright); flex-shrink: 0;
}
.svc-who { display: flex; align-items: center; gap: 8px; min-width: 0; }
.svc-who b { font-size: .85rem; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.svc-offer { color: var(--text-secondary); font-size: .72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.svc-coin { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 14px; flex-shrink: 0; }
.svc-coin.is-earn { color: #3f8f5f; }
.svc-coin.is-pay { color: #b06a3f; }

/*  趣事面板：主题色、直角  */
.svc-tale {
  width: min(88vw, 720px); background: var(--bg-secondary); color: var(--text-bright);
  border-radius: 0; padding: 14px 16px; box-shadow: 0 12px 44px rgba(0, 0, 0, .3);
  display: flex; flex-direction: column; gap: 10px;
}
.svc-tale-text { margin: 0; font-size: 14px; line-height: 1.7; }
.svc-options { display: flex; gap: 8px; flex-wrap: wrap; }
.svc-options :deep(.is-bold) { border-color: var(--accent); }
.svc-opt-price { font-variant-numeric: tabular-nums; font-weight: 600; }
.svc-opt-price.is-earn { color: #3f8f5f; }
.svc-opt-price.is-pay { color: #b06a3f; }

.svc-tale-enter-active, .svc-tale-leave-active { transition: opacity .28s ease, transform .28s cubic-bezier(.22, .61, .36, 1); }
.svc-tale-enter-from, .svc-tale-leave-to { opacity: 0; transform: translateY(10px); }

.svc-modal-enter-active, .svc-modal-leave-active { transition: opacity .22s ease; }
.svc-modal-enter-from, .svc-modal-leave-to { opacity: 0; }
</style>
