<template>
  <section class="angel-summon" :class="{ 'is-compact': compact, 'is-busy': busy, 'is-invoked': invoked && canSubmit }" :aria-busy="busy">
    <div class="summon-stage" aria-hidden="true">
      <div class="sanctum-light" />
      <div class="sanctum-rays" />
      <svg class="sanctum-lines" viewBox="0 0 800 360" fill="none">
        <path class="sanctum-arch" d="M240 350V184C240 94 310 32 400 12C490 32 560 94 560 184V350M258 350V184C258 110 318 50 400 31C482 50 542 110 542 184V350" />
        <g class="sanctum-orbit">
          <circle cx="400" cy="176" r="132" /><circle cx="400" cy="176" r="118" stroke-dasharray="1 9" />
          <path d="M400 34V54M400 298V318M258 176H278M522 176H542M300 76L314 90M486 262L500 276M300 276L314 262M486 90L500 76" />
        </g>
        <g v-for="side in [-1, 1]" :key="side" :transform="`translate(400 196) scale(${side} 1)`">
          <g class="sanctum-wing">
            <path d="M66 32C130 0 196 -70 290 -104C258 -49 204 7 106 48C183 28 243 -1 300 -42C269 14 212 52 116 63C185 65 232 53 274 34C241 78 186 90 116 78C170 100 213 103 244 98C199 127 143 116 90 89" />
            <path v-for="n in 7" :key="n" :d="`M${88 + n * 12} ${26 - n * 7} Q${174 + n * 8} ${-8 - n * 9} ${192 + n * 12} ${-32 - n * 10}`" />
          </g>
        </g>
        <path class="sanctum-floor" d="M116 334H684M198 345H602M392 334L400 326L408 334L400 342Z" />
        <g class="sanctum-stars"><path v-for="star in stars" :key="star.x" :transform="`translate(${star.x} ${star.y}) scale(${star.s})`" d="M0 -8L2 -2L8 0L2 2L0 8L-2 2L-8 0L-2 -2Z" /></g>
      </svg>
      <AngelEmblem class="summon-angel" />
      <Transition name="summon-fade"><div v-if="busy" class="ritual-scanner"><span class="ritual-scan" /></div></Transition>
    </div>
    <header class="summon-head">
      <h2 class="summon-title">{{ busy ? '天使正在降临' : '召唤你的天使' }}</h2>
      <div class="summon-caption" role="status" aria-live="polite">
        <Transition name="summon-word" mode="out-in"><p :key="busy ? ritualText : 'idle'" class="summon-guide">{{ busy ? ritualText : '择定秉性，让独属于你的灵魂自光中降生' }}</p></Transition>
      </div>
    </header>
    <div class="summon-form">
      <div class="summon-chips" role="group" aria-label="天使性格">
        <GodSacredButton v-for="opt in options" :key="opt.key" variant="sigil" :active="selected.includes(opt.key)" :aria-pressed="selected.includes(opt.key)" :disabled="busy" touch-target @click="toggle(opt.key)">
          {{ opt.label }}
        </GodSacredButton>
        <GodSacredButton variant="sigil" :active="customOpen || !!customText.trim()" :aria-expanded="customOpen" :aria-controls="customId" :disabled="busy" touch-target @click="toggleCustom">自定义</GodSacredButton>
      </div>
      <CollapseTransition :show="customOpen">
        <div :id="customId" class="summon-custom">
          <LinsheInput ref="customInput" v-model="customText" type="textarea" :rows="3" :disabled="busy" maxlength="800" aria-label="自定义天使要求" placeholder="写下你的要求：性格、说话方式、外观细节……" />
          <div class="summon-custom-count">{{ customText.length }} / 800</div>
        </div>
      </CollapseTransition>
      <p v-if="error" class="summon-error" role="alert">{{ error }}</p>
    </div>
    <div class="summon-actions">
      <div class="rite-flare" aria-hidden="true" />
      <GodSacredButton variant="ritual" size="lg" :disabled="!canSubmit" @pointerenter="invoked = true" @pointerleave="invoked = false" @focusin="invoked = true" @focusout="invoked = false" @click="submit">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2L14 9L21 12L14 15L12 22L10 15L3 12L10 9Z" stroke="currentColor" /><path d="M3 4L5 6M19 18L21 20M3 20L5 18M19 6L21 4" stroke="currentColor" /></svg>
        {{ busy ? '仪式进行中' : '仪式召唤' }}
      </GodSacredButton>
    </div>
    <Transition name="summon-fade"><div v-if="busy" class="ritual-progress" aria-hidden="true"><span /></div></Transition>
  </section>
</template>

<script setup>
import { computed, ref, watch, nextTick, useId, onBeforeUnmount } from 'vue'
import GodSacredButton from './GodSacredButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import CollapseTransition from '../CollapseTransition.vue'
import AngelEmblem from './AngelEmblem.vue'

const props = defineProps({
  options: { type: Array, default: () => [] },
  initial: { type: Array, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  custom: { type: String, default: '' },
})
const emit = defineEmits(['submit'])
const selected = ref([])
const customOpen = ref(!!props.custom)
const customText = ref(props.custom || '')
const customInput = ref(null)
const customId = useId()
const invoked = ref(false)
const canSubmit = computed(() => !props.busy && (selected.value.length > 0 || !!customText.value.trim()))
const stars = [{ x: 174, y: 118, s: .65 }, { x: 626, y: 118, s: .65 }, { x: 310, y: 56, s: .45 }, { x: 490, y: 56, s: .45 }, { x: 130, y: 254, s: .4 }, { x: 670, y: 254, s: .4 }]
function normalize(value) {
  const list = Array.isArray(value) ? value.filter(key => props.options.some(opt => opt.key === key)) : []
  return list.length ? [...new Set(list)] : ['gentle']
}
selected.value = normalize(props.initial)
watch(() => props.initial, value => { selected.value = normalize(value) })
watch(() => props.options, () => { selected.value = normalize(selected.value) })
watch(() => props.custom, value => { customText.value = value || ''; customOpen.value = !!value })
function toggle(key) {
  if (props.busy) return
  selected.value = selected.value.includes(key) ? selected.value.filter(item => item !== key) : [...selected.value, key]
}
async function toggleCustom() {
  if (props.busy) return
  customOpen.value = !customOpen.value
  if (customOpen.value) { await nextTick(); customInput.value?.focus() }
}
function submit() {
  if (!canSubmit.value) return
  invoked.value = false
  emit('submit', { personalities: [...selected.value], custom: customText.value.trim() })
}
// 氛围文案，不冒充后端阶段或百分比；请求完成才结束仪式。
const RITUAL_LINES = ['正在聆听你的祈愿…', '为灵魂编织性情与记忆…', '将白袍、羽翼与光环写入形象…', '正在描绘她的言语与日常…', '云庭的回音仍在汇聚，请稍候…']
const ritualText = ref(RITUAL_LINES[0])
let ritualTimer
watch(() => props.busy, busy => {
  clearInterval(ritualTimer)
  if (!busy) return
  let index = 0
  ritualText.value = RITUAL_LINES[0]
  ritualTimer = setInterval(() => { index = Math.min(index + 1, RITUAL_LINES.length - 1); ritualText.value = RITUAL_LINES[index] }, 4200)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(ritualTimer))
</script>

<style scoped>
/* 只裁剪本组件的装饰溢出；内容仍按自然高度排版，由宿主正常滚动。
   透明渐变 / mask 不会缩小滚动边界，hover 放大的光晕也必须受此边界约束。 */
.angel-summon { --rite-gold:color-mix(in srgb,var(--fun-gold) 58%,var(--text-primary)); position:relative; isolation:isolate; overflow:clip; width:100%; max-width:820px; margin:auto; padding:0 12px 28px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; text-align:center; }
.summon-stage { position:relative; width:100%; height:clamp(230px,26vw,330px); flex-shrink:0; pointer-events:none; mask-image:linear-gradient(transparent,#000 12%,#000 88%,transparent); }
.sanctum-lines { position:absolute; width:100%; height:100%; inset:0; color:var(--rite-gold); stroke:currentColor; stroke-width:1; overflow:visible; }
.sanctum-arch { opacity:.28; }
.sanctum-floor { opacity:.45; }
.sanctum-orbit { transform-origin:400px 176px; opacity:.25; transition:opacity .3s, transform .3s; }
.sanctum-wing { opacity:.35; transform-origin:0 0; transform:scale(.92); transition:opacity .3s, transform .3s; fill:color-mix(in srgb,var(--fun-gold) 5%,transparent); }
.sanctum-stars { fill:var(--rite-gold); stroke:none; opacity:.6; }
.sanctum-light { position:absolute; inset:-10% 8% -12%; background:radial-gradient(ellipse at 50% 45%,color-mix(in srgb,var(--fun-gold) 25%,transparent),transparent 64%); opacity:.65; transition:opacity .3s,transform .3s; }
.sanctum-light::after { content:''; position:absolute; inset:0 25%; background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--fun-gold) 16%,transparent),transparent); clip-path:polygon(42% 0,58% 0,100% 100%,0 100%); }
.sanctum-rays { position:absolute; height:145%; aspect-ratio:1; left:50%; top:50%; transform:translate(-50%,-50%) rotate(-12deg) scale(.8); background:repeating-conic-gradient(from 0deg,transparent 0deg 11deg,color-mix(in srgb,var(--fun-gold) 32%,transparent) 12deg 13deg,transparent 14deg 20deg); mask-image:radial-gradient(circle,transparent 16%,#000 28%,transparent 69%); opacity:0; transition:opacity .3s,transform .3s; }
.summon-angel { position:absolute; width:clamp(220px,28vw,320px); height:100%; left:50%; transform:translateX(-50%); filter:drop-shadow(0 8px 18px color-mix(in srgb,var(--fun-gold) 18%,transparent)); }
.is-invoked .sanctum-wing,.is-busy .sanctum-wing { opacity:.85; transform:scale(1.05); }
.is-invoked .sanctum-orbit,.is-busy .sanctum-orbit { opacity:.75; transform:rotate(24deg); }
.is-invoked .sanctum-rays,.is-busy .sanctum-rays { opacity:1; transform:translate(-50%,-50%) rotate(0deg) scale(1.12); }
.is-invoked .sanctum-light,.is-busy .sanctum-light { opacity:1; transform:scale(1.18); }
.summon-head { position:relative; margin:4px 0 22px; }
.summon-title { margin:0; font-family:'STSong','SimSun',serif; font-size:clamp(28px,3vw,38px); font-weight:500; line-height:1.5; letter-spacing:.18em; color:var(--text-primary); }
.summon-caption { display:grid; min-height:28px; margin-top:8px; align-items:center; }
.summon-guide { margin:0; font-size:var(--fs-sm); line-height:1.8; color:color-mix(in srgb,var(--text-primary) 35%,var(--text-secondary)); letter-spacing:.06em; text-wrap:balance; }
.summon-form { width:min(100%,640px); }
.summon-chips { display:flex; flex-wrap:wrap; justify-content:center; gap:12px; }
.summon-custom { padding-top:18px; text-align:left; }
.summon-custom-count { padding-top:7px; text-align:right; font-size:var(--fs-xs); color:color-mix(in srgb,var(--text-primary) 35%,var(--text-secondary)); font-variant-numeric:tabular-nums; }
.summon-error { margin:14px 0 0; font-size:var(--fs-sm); color:color-mix(in srgb,var(--danger) 65%,var(--text-primary)); line-height:1.7; }
.summon-actions { position:relative; display:flex; justify-content:center; width:min(100%,480px); margin-top:26px; isolation:isolate; }
.rite-flare { position:absolute; pointer-events:none; inset:-26px 0; overflow:clip; mask-image:radial-gradient(ellipse,#000 30%,transparent 70%); opacity:0; transform:scaleX(.4); transition:opacity .3s,transform .3s; background:radial-gradient(ellipse,color-mix(in srgb,var(--fun-gold) 50%,transparent),transparent 66%); }
.is-invoked .rite-flare { opacity:1; transform:scaleX(1); }
.rite-flare::after { content:''; position:absolute; inset:0; background:radial-gradient(ellipse,color-mix(in srgb,var(--fun-gold) 50%,transparent),transparent 65%); animation:rite-flow 2.4s ease-in-out infinite paused; }
.is-invoked .rite-flare::after { animation-play-state:running; }
@keyframes rite-flow { 0%,100% { transform:translateX(-12%) scale(.8); opacity:.3; } 50% { transform:translateX(12%) scale(1.15); opacity:1; } }
.ritual-scanner { position:absolute; inset:0 12%; overflow:hidden; mask-image:linear-gradient(transparent,#000 10%,#000 90%,transparent); }
.ritual-scan { position:absolute; inset:0 0 auto; height:28%; border-bottom:1px solid var(--rite-gold); background:linear-gradient(transparent,color-mix(in srgb,var(--fun-gold) 26%,transparent)); box-shadow:0 8px 24px color-mix(in srgb,var(--fun-gold) 24%,transparent); animation:ritual-scan 2.8s ease-in-out infinite; }
.ritual-progress { position:relative; width:180px; height:2px; margin-top:18px; overflow:hidden; background:color-mix(in srgb,var(--fun-gold) 20%,transparent); }
.ritual-progress span { display:block; width:40%; height:100%; background:var(--rite-gold); animation:ritual-progress 1.8s ease-in-out infinite; }
.is-busy .sanctum-orbit { animation:ritual-orbit 24s linear infinite; }
@keyframes ritual-scan { 0% { transform:translateY(-110%); opacity:0; } 15%,80% { opacity:1; } 100% { transform:translateY(370%); opacity:0; } }
@keyframes ritual-progress { from { transform:translateX(-110%); } to { transform:translateX(360%); } }
@keyframes ritual-orbit { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
.summon-fade-enter-active,.summon-fade-leave-active,.summon-word-enter-active,.summon-word-leave-active { transition:opacity .3s,transform .3s; }
.summon-fade-enter-from,.summon-fade-leave-to { opacity:0; }
.summon-word-enter-from { opacity:0; transform:translateY(5px); }
.summon-word-leave-to { opacity:0; transform:translateY(-5px); }
.is-compact { padding:0 8px 12px; }
.is-compact .summon-stage { height:240px; }
.is-compact .summon-title { font-size:28px; }
@media(max-width:600px) {
  .angel-summon { padding:0 0 20px; }
  .summon-stage { height:230px; }
  .summon-angel { width:250px; }
  .summon-head { margin:0 0 18px; }
  .summon-title { font-size:28px; letter-spacing:.12em; }
  .summon-chips { gap:10px; }
  .summon-actions { margin-top:22px; }
  .is-compact .summon-stage { height:190px; }
}
</style>
