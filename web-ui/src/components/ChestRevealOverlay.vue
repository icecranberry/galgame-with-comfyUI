<template>
  <!-- ── 全屏开箱演出（蓄力 → 图片生成完毕 → 开盖揭示） ── -->
  <Teleport to="body">
    <Transition name="fs-fade">
      <div v-if="show" class="fs-overlay">
        <div class="fs-backdrop"></div>
        <div class="fs-flash" :class="{ on: flashOn }"></div>
        <div class="fs-content">
          <div v-if="chestAnim === 'charging'" class="fs-status" aria-live="polite">
            <Transition name="fs-tip" mode="out-in">
              <span :key="tip">{{ tip }}</span>
            </Transition>
          </div>
          <div class="fs-stage">
            <div
              class="fs-chest-wrap"
              :class="{ 'is-pokable': chestAnim === 'charging', 'is-jelly': jellyOn }"
              @click="pokeChest"
              @animationend="jellyOn = false"
            >
              <ChestSvg class="fs-chest" :state="chestAnim" :boost="chargeBoost"/>
            </div>
            <Transition name="fs-reveal">
              <div v-if="revealVisible && item" class="fs-item">
                <div class="fs-item-float">
                  <div class="fs-item-halo" aria-hidden="true"></div>
                  <div class="fs-item-rays" aria-hidden="true"></div>
                  <div class="fs-item-image">
                    <img v-if="item.image_url" :src="item.image_url" alt=""/>
                    <ItemFallbackIcon v-else/>
                  </div>
                </div>
                <div class="fs-item-name-row">
                  <span class="fs-item-name">{{ item.name }}</span>
                </div>
                <p class="fs-item-desc">{{ item.description }}</p>
              </div>
            </Transition>
          </div>
          <div v-if="revealVisible" class="fs-actions">
            <linshe-button variant="primary" size="lg" :loading="collecting" @click="$emit('collect')">收入背包</linshe-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import ChestSvg from './ChestSvg.vue'
import ItemFallbackIcon from './ItemFallbackIcon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  chestAnim: { type: String, default: 'idle' }, // idle | charging | opening | opened | exiting
  flashOn: { type: Boolean, default: false },
  chargeBoost: { type: Boolean, default: false },
  item: { type: Object, default: null },
  collecting: { type: Boolean, default: false },
})

defineEmits(['collect'])

const revealVisible = computed(() => props.chestAnim === 'opened' || props.chestAnim === 'exiting')

// 蓄力等待期文案轮播（与酒馆招募加载同一节奏：2.2s 一换）
const CHEST_TIPS = [
  '正在努力解锁宝箱…',
  '正在破解锁孔上的符文…',
  '符文微微亮了一下…',
  '箱缝里漏出了金色的光…',
  '好像听到里面叮当作响…',
  '正在跟锁芯讲道理…',
  '封印松动了一点点…',
  '偷偷摇了摇箱子…',
  '正在给宝箱挠痒痒…',
  '喝了口水',
  '宝箱似乎更有精神了',
  '宝箱今天不想上班…'
]
const tip = ref(CHEST_TIPS[0])
let tipTimer = null

watch(
  () => props.show && props.chestAnim === 'charging',
  (active) => { active ? startTips() : stopTips() },
  { immediate: true },
)

function startTips() {
  stopTips()
  tip.value = CHEST_TIPS[0]
  let idx = 0
  tipTimer = setInterval(() => {
    idx = (idx + 1) % CHEST_TIPS.length
    tip.value = CHEST_TIPS[idx]
  }, 2200)
}

function stopTips() {
  if (tipTimer) { clearInterval(tipTimer); tipTimer = null }
}

// 蓄力期点击宝箱：果冻式弹动反馈
const jellyOn = ref(false)
function pokeChest() {
  if (props.chestAnim !== 'charging') return
  jellyOn.value = false
  requestAnimationFrame(() => { jellyOn.value = true })
}

onUnmounted(stopTips)
</script>

<style scoped>
.fs-overlay {
  position: fixed;
  inset: 0;
  z-index: 10100;
  overflow: hidden;
}
.fs-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 42%, rgba(74, 48, 26, 0.6), rgba(13, 9, 5, 0.97) 72%);
}
.fs-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 50% 46%, rgba(255, 244, 214, 0.95), rgba(255, 244, 214, 0) 62%);
  opacity: 0;
}
.fs-flash.on { animation: fs-flash-anim 0.72s ease-out; }
@keyframes fs-flash-anim {
  0% { opacity: 0; transform: scale(0.5); }
  28% { opacity: 0.5; }
  100% { opacity: 0; transform: scale(1.4); }
}

.fs-content {
  user-select: none;
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.fs-status {
  min-height: 26px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 4px;
  color: #f3e6c8;
  text-align: center;
}
/* 舞台：宝箱与揭示道具共用同一坐标系，道具悬浮其上不影响宝箱布局 */
.fs-stage {
  position: relative;
  width: min(430px, 64vw);
}
.fs-chest-wrap {
  width: 100%;
  transform-origin: 50% 100%;
}
/* 蓄力期可戳：点击宝箱果冻式弹动一下，作为等待期的即时正反馈 */
.fs-chest-wrap.is-pokable { cursor: pointer; }
.fs-chest-wrap.is-jelly { animation: fs-chest-jelly 0.62s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
@keyframes fs-chest-jelly {
  0% { transform: scale(1, 1); }
  18% { transform: scale(1.06, 0.9); }
  38% { transform: scale(0.94, 1.07); }
  58% { transform: scale(1.03, 0.97); }
  78% { transform: scale(0.99, 1.015); }
  100% { transform: scale(1, 1); }
}
.fs-item {
  position: absolute;
  left: 0;
  right: 0;
  top: 27%;
  margin: 0 auto;
  width: min(360px, 86vw);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* 图标整体缓慢浮动（冒泡感），金光层跟随 */
.fs-item-float {
  position: relative;
  animation: fs-float-bob 3.4s ease-in-out 1.8s infinite;
}
@keyframes fs-float-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
/* 金光：柔光晕 + 缓转光芒，衬在道具图后面 */
.fs-item-halo,
.fs-item-rays {
  position: absolute;
  left: 50%;
  top: 50%;
  pointer-events: none;
  border-radius: 50%;
  z-index: 0;
}
.fs-item-halo {
  width: 330px;
  height: 330px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255, 238, 178, 0.55) 0%, rgba(255, 214, 118, 0.24) 34%, rgba(255, 201, 77, 0) 70%);
  animation: fs-halo-breathe 2.8s ease-in-out 1.8s infinite;
}
@keyframes fs-halo-breathe {
  0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.72; transform: translate(-50%, -50%) scale(1.07); }
}
.fs-item-rays {
  width: 400px;
  height: 400px;
  background: repeating-conic-gradient(from 0deg, rgba(255, 216, 130, 0.3) 0deg 8deg, rgba(255, 216, 130, 0) 8deg 26deg);
  -webkit-mask-image: radial-gradient(circle, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.32) 40%, transparent 68%);
  mask-image: radial-gradient(circle, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.32) 40%, transparent 68%);
  animation: fs-rays-spin 16s linear infinite;
}
@keyframes fs-rays-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
.fs-item-image {
  position: relative;
  z-index: 1;
  width: 198px;
  height: 198px;
  border-radius: 18px;
  background: #f5efe7;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fs-item-image img { width: 100%; height: 100%; object-fit: cover; }
.fs-item-name-row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.fs-item-name { font-size: 19px; font-weight: 800; color: #fdf4dd; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5); }
.fs-item-desc {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: #cbb99a;
  text-align: center;
  max-width: 340px;
}
/* 收下按钮钉在底部：出现/消失不推移舞台内容 */
.fs-actions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 48px;
  display: flex;
  justify-content: center;
}

/* 揭示：道具从箱口渐入、冒泡般上浮弹出（弹性过冲） */
.fs-reveal-enter-active {
  transition: transform 0.82s cubic-bezier(0.22, 1.12, 0.36, 1) 0.08s, opacity 0.36s ease-out 0.08s;
}
.fs-reveal-enter-from { opacity: 0; transform: translateY(58px) scale(0.68); }

.fs-fade-enter-active, .fs-fade-leave-active { transition: opacity 0.3s ease; }
.fs-fade-enter-from, .fs-fade-leave-to { opacity: 0; }

/* 蓄力文案轮换：轻浮入轻浮出，不跳动布局 */
.fs-tip-enter-active, .fs-tip-leave-active { transition: opacity 0.24s ease, transform 0.24s ease; }
.fs-tip-enter-from { opacity: 0; transform: translateY(6px); }
.fs-tip-leave-to { opacity: 0; transform: translateY(-6px); }

@media (prefers-reduced-motion: reduce) {
  .fs-chest-wrap.is-jelly { animation: none; }
  .fs-tip-enter-active, .fs-tip-leave-active { transition: none; }
  .fs-tip-enter-from, .fs-tip-leave-to { transform: none; }
}
</style>
