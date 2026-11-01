<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="peek-overlay" @click="emit('close')">
        <div class="peek-film" :class="{ 'pk-shutter-fire': shutterFire }" :style="filmStyle" @click.stop>
          <!-- 胶卷上黑边 + 白色矩形齿孔 -->
          <div class="pk-film-edge pk-film-edge-top" aria-hidden="true"></div>

          <!-- 图片区域（尺寸以奇遇参数为基准） -->
          <div class="pk-body" :style="bodyStyle">
            <template v-if="loading">
              <div class="pk-wait">
                <div class="pk-ring-container">
                  <svg viewBox="0 0 80 80" class="pk-ring">
                    <circle
                      cx="40" cy="40" r="34" fill="none"
                      stroke="var(--pk-ring-track)" stroke-width="3"
                    />
                    <circle
                      cx="40" cy="40" r="34" fill="none" stroke="var(--accent)"
                      stroke-width="3" stroke-linecap="round"
                      :stroke-dasharray="2 * Math.PI * 34"
                      :stroke-dashoffset="2 * Math.PI * 34 * (1 - progress / 100)"
                      class="pk-ring-progress"
                    />
                  </svg>
                  <div class="pk-ring-pct">{{ progress }}%</div>
                </div>
                <div class="pk-wait-phrase">
                  <Transition name="phrase" mode="out-in">
                    <p :key="phraseIndex">{{ phrases[phraseIndex] }}</p>
                  </Transition>
                </div>
              </div>
            </template>
            <template v-else-if="error">
              <div class="pk-err"><p>生成失败</p><span>{{ error }}</span><linshe-button class="btn-glass" variant="secondary" @click="emit('retake')">重试</linshe-button></div>
            </template>
            <div v-else-if="image" class="pk-shutter-stage">
              <div class="pk-shutter-flash"></div>
              <div class="pk-shutter-curtain pk-curtain-top"></div>
              <div class="pk-shutter-curtain pk-curtain-bottom"></div>
              <img :src="image" class="pk-img" @click="emit('open-image')" />
            </div>
          </div>

          <!-- 胶卷下黑边 + 白色矩形齿孔 -->
          <div class="pk-film-edge pk-film-edge-bottom" aria-hidden="true"></div>

          <!-- 底部信息栏 -->
          <div class="pk-bar">
            <div class="pk-char">
              <div class="pk-char-avatar">
                <img v-if="character?.avatar_path" :src="character.avatar_path" class="pk-char-avatar-img" alt="" />
                <span v-else class="pk-char-avatar-text">{{ character?.display_name?.charAt(0) || '' }}</span>
              </div>
              <div><b>{{ activity?.activity || '瞄一眼' }}</b><span v-if="activity?.location">{{ activity.location }}</span></div>
            </div>
            <div class="pk-actions">
              <linshe-button v-if="image && !loading" class="pk-retake-btn" variant="secondary" size="sm" :disabled="busy" @click="emit('retake')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23,4 23,10 17,10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                <span class="pk-retake-label">{{ busy ? '拍摄中...' : '再拍一张' }}</span>
              </linshe-button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { useSettingsStore } from '../../stores/settings.js'

const props = defineProps({
  visible: Boolean,
  character: { type: Object, default: null },
  activity: { type: Object, default: null },
  loading: Boolean,
  error: { type: String, default: '' },
  image: { type: String, default: '' },
  busy: Boolean,
})
const emit = defineEmits(['close', 'retake', 'open-image'])
const settingsStore = useSettingsStore()

// ── 加载文案轮播（与系统瞄一眼一致）──
const phrases = [
  '正在寻找拍摄角度……',
  '正在抓取表情……',
  '正在选择机位……',
  '正在寻找人在哪……',
  '正在翻找相机镜头……',
  '正在调整光圈参数……',
  '正在构图对焦……',
  '正在等待最佳光线……',
]
const phraseIndex = ref(0)
let phraseTimer = null
watch(() => props.loading, (loading) => {
  if (phraseTimer) { clearInterval(phraseTimer); phraseTimer = null }
  if (!loading) return
  phraseIndex.value = 0
  phraseTimer = setInterval(() => { phraseIndex.value = (phraseIndex.value + 1) % phrases.length }, 3000)
}, { immediate: true })

// ── 进度：虚拟进度推进，图片到达即 100% ──
const simulated = ref(0)
let progressTimer = null
function startProgress() {
  stopProgress()
  simulated.value = 0
  progressTimer = setInterval(() => {
    if (simulated.value < 95) simulated.value = Math.min(95, simulated.value + 1 + Math.random() * 3)
  }, 700)
}
function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null } }
const progress = computed(() => (props.image ? 100 : Math.floor(simulated.value)))
watch(() => [props.visible, props.loading, props.image], ([visible, loading, image]) => {
  if (visible && loading && !image) startProgress()
  else stopProgress()
  if (!visible) simulated.value = 0
}, { immediate: true })

// ── 相机快门动画：图片到达时触发 ──
const shutterFire = ref(false)
watch(() => props.image, (image) => {
  if (!image) { shutterFire.value = false; return }
  shutterFire.value = false
  nextTick(() => requestAnimationFrame(() => { shutterFire.value = true }))
})

// ── 弹窗尺寸：以奇遇参数 aspect-ratio 为准，比例始终贴合，不超视口 ──
const bodyStyle = computed(() => {
  const ew = settingsStore.eventWidth || 1600
  const eh = settingsStore.eventHeight || 1200
  const ratio = ew / eh
  const chromeH = 124
  const chromeW = 40 + 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const mobile = vw < 768
  const availW = mobile ? vw - chromeW : vw * 0.88 - chromeW
  const availH = mobile ? vh * 0.92 - chromeH : vh * 0.88 - chromeH
  let bodyW, bodyH
  if (availW / ratio <= availH) { bodyW = availW; bodyH = bodyW / ratio }
  else { bodyH = availH; bodyW = bodyH * ratio }
  return { width: `${Math.round(bodyW)}px`, height: `${Math.round(bodyH)}px` }
})
const filmStyle = computed(() => ({ width: bodyStyle.value.width }))
</script>

<style scoped>
/* ── Peek Modal（照搬 ScheduleView 的胶卷框样式）── */
.peek-overlay {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.peek-film {
  width: fit-content; max-width: 90vw; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 52px rgba(0,0,0,0.4);
}

/* ── 胶卷上下黑边 + 白色矩形齿孔 ── */
.pk-film-edge {
  height: 20px; flex-shrink: 0;
  background: #111;
  position: relative;
  overflow: hidden;
}
.pk-film-edge::before {
  content: '';
  position: absolute;
  top: 4px; bottom: 4px; left: 11px; right: 11px;
  background: repeating-linear-gradient(
    90deg,
    rgba(255,255,255,0.88) 0px,
    rgba(255,255,255,0.88) 8px,
    transparent 8px,
    transparent 22px
  );
}
/* ── 底部信息栏 ── */
.pk-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-secondary); flex-shrink: 0;
  position: relative;
}
.pk-char { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pk-char-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--accent); flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.pk-char-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
.pk-char-avatar-text { color: var(--on-accent); font-size: 13px; font-weight: 600; line-height: 1; user-select: none; }
.pk-char b { display: block; font-size: 0.85rem; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-char span { font-size: 0.72rem; color: var(--text-secondary); }
.pk-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.pk-body { flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #111; overflow: hidden; }

/* ═══ 相机快门动画 ═══ */
.pk-shutter-stage {
  position: relative; width: 100%; height: 100%;
  overflow: hidden;
}
.pk-shutter-flash {
  position: absolute; inset: 0; z-index: 10;
  background: #fff;
  opacity: 0; pointer-events: none;
}
.pk-shutter-fire .pk-shutter-flash {
  animation: shutter-flash 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes shutter-flash {
  0%   { opacity: 0.85; }
  45%  { opacity: 0.6; }
  100% { opacity: 0; }
}
.pk-shutter-curtain {
  position: absolute; left: 0; right: 0; z-index: 9;
  height: 51%;
  background: linear-gradient(180deg, #1a1a1a 0%, #2a2a2a 30%, #1a1a1a 100%);
  pointer-events: none;
}
.pk-curtain-top {
  top: 0;
  transform-origin: top center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.pk-curtain-bottom {
  bottom: 0;
  transform-origin: bottom center;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.5);
}
.pk-shutter-fire .pk-curtain-top {
  animation: shutter-open-top 0.38s 0.04s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}
.pk-shutter-fire .pk-curtain-bottom {
  animation: shutter-open-bottom 0.38s 0.04s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}
@keyframes shutter-open-top {
  0%   { transform: scaleY(1); }
  100% { transform: scaleY(0); }
}
@keyframes shutter-open-bottom {
  0%   { transform: scaleY(1); }
  100% { transform: scaleY(0); }
}

.pk-wait { text-align: center; padding: 32px 24px; color: var(--text-secondary); }
.pk-wait p { margin: 10px 0 0; font-size: 0.85rem; }
.pk-wait-phrase {
  position: relative;
  min-height: 24px;
  display: flex; align-items: center; justify-content: center;
}
.pk-wait-phrase p {
  margin: 10px 0 0; font-size: 0.88rem;
  white-space: nowrap;
}
.phrase-enter-active,
.phrase-leave-active {
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.phrase-leave-to {
  transform: translateY(-14px);
  opacity: 0;
}
.phrase-enter-from {
  transform: translateY(14px);
  opacity: 0;
}
.pk-wait span { font-size: 0.73rem; color: var(--pk-hint); }
.pk-ring-container { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
.pk-ring { width: 80px; height: 80px; transform: rotate(-90deg); }
.pk-ring-progress { transition: stroke-dashoffset 0.4s ease; }
.pk-ring-pct {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 600; color: var(--accent);
}
.pk-err { text-align: center; padding: 36px; }
.pk-err p { color: var(--danger); margin: 0 0 4px; font-size: 0.9rem; }
.pk-err span { display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 12px; }
.pk-img { width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer; }
.pk-retake-btn {
  gap: 5px;
  padding: 6px 16px;
  white-space: nowrap;
}

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-active .peek-film, .modal-leave-active .peek-film { transition: transform 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .peek-film { transform: scale(0.95) translateY(10px); }
.modal-leave-to .peek-film { transform: scale(0.95) translateY(10px); }
</style>
