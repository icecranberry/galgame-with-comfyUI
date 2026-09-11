<template>
  <section ref="root" class="town-dialogue-stage" role="dialog" aria-modal="true" :aria-label="`与${displayName}对话`"
    :style="viewportStyle" :class="{ compact }" tabindex="-1" @keydown.stop="onKeydown" @keyup.stop @pointerdown.stop @mousedown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
    <div class="td-portraits" aria-label="对话人物" :inert="zoomed ? true : undefined">
      <figure v-for="person in portraits" :key="person.side">
        <img v-if="person.url && !failedImages[person.url]" :src="person.url" :alt="`${person.name}立绘`" @error="failedImages[person.url] = true">
        <div v-else class="td-placeholder" aria-hidden="true">{{ person.name.slice(0, 1) }}</div>
        <figcaption>{{ person.name }} <linshe-button v-if="person.url && !failedImages[person.url]" variant="icon" size="sm" :aria-label="`放大${person.name}立绘`" @click="zoomed = person.url">⤢</linshe-button></figcaption>
      </figure>
    </div>
    <div v-if="zoomed" class="td-zoom" @click.self="zoomed = null"><img :src="zoomed" alt="立绘大图"><linshe-button variant="icon" size="sm" aria-label="关闭立绘" @click="zoomed = null">✕</linshe-button></div>
    <div class="td-panel" :inert="zoomed ? true : undefined">
      <svg class="td-dialog-shape" viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
        <path d="M22 15 L216 8 L406 17 L574 11 L589 44 L582 174 L594 360 L574 401 L351 411 L173 400 L23 408 L9 375 L18 209 L8 53 Z" fill="#fffaf1" stroke="#8d7968" stroke-width="2" vector-effect="non-scaling-stroke" />
        <path d="M29 24 L216 18 L405 26 L567 21 M29 392 L173 385 L350 395 L566 387" fill="none" stroke="#e0c9aa" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <header>
        <div><span class="td-kicker">小镇 · 相谈</span><h2>{{ displayName }}</h2></div>
        <div class="td-actions">
          <linshe-button variant="ghost" size="sm" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">{{ historyOpen ? '返回对白' : '历史' }}</linshe-button>
          <linshe-button variant="icon" size="sm" aria-label="关闭对话" @click="$emit('close')">✕</linshe-button>
        </div>
      </header>
      <div ref="body" class="td-body" tabindex="0" aria-live="polite" :aria-label="historyOpen ? '最近对话记录' : '当前对白'">
        <p v-if="loading" role="status">正在读取对话…</p>
        <template v-else>
          <linshe-button v-if="historyOpen && hasMoreHistory" variant="link" size="sm" @click="$emit('load-older')">更早的记录</linshe-button>
          <p v-if="!messages.length" class="td-muted">这是你们在镇上的第一次交谈</p>
          <article v-for="(message, index) in shownMessages" :key="message.id ?? index">
            <span class="td-speaker">{{ message.role === 'user' ? playerName : displayName }}</span>
            <slot name="message" :message="message"><p>{{ message.content }}</p></slot>
          </article>
        </template>
      </div>
      <p v-if="sending" class="td-status" role="status">正在回应…关闭后可重新打开查看记录。</p>
      <p v-else-if="status" class="td-status" role="status">{{ status }}</p>
      <div v-if="error" class="td-error" role="alert">
        <span>{{ error }}</span>
        <linshe-button v-if="retryable" variant="link" size="sm" :disabled="loading || sending" @click="$emit('retry')">重试同一条消息</linshe-button>
        <linshe-button variant="link" size="sm" :disabled="loading || sending" @click="$emit('reload')">重新读取记录</linshe-button>
      </div>
      <form class="td-input" @submit.prevent="submit">
        <linshe-input ref="input" v-model="draft" size="sm" :disabled="loading || sending || blocked" :maxlength="maxLength" aria-label="对话内容" placeholder="说点什么…"
          @compositionstart="composing = true" @compositionend="composing = false" @keydown.enter="onEnter" />
        <linshe-button type="submit" variant="primary" size="sm" :loading="sending" :disabled="loading || blocked || !draft.trim()">发送</linshe-button>
      </form>
      <linshe-button v-if="showActivity" variant="link" size="sm" @click="$emit('activity')">查看居民近况</linshe-button>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
const props = defineProps({
  displayName: { type: String, default: '邻居' }, playerName: { type: String, default: '我' },
  portraitUrl: String, playerPortraitUrl: String,
  messages: { type: Array, default: () => [] }, loading: Boolean, sending: Boolean, blocked: Boolean,
  error: { type: String, default: '' },
  status: { type: String, default: '' }, hasMoreHistory: Boolean, maxLength: { type: Number, default: 200 },
  retryable: Boolean, draftRestore: Object, showActivity: Boolean,
})
const emit = defineEmits(['send', 'close', 'reload', 'load-older', 'retry', 'activity'])
const root = ref(null), input = ref(null), body = ref(null)
const draft = ref(''), composing = ref(false), historyOpen = ref(false), failedImages = ref({})
const viewportStyle = ref({}), compact = ref(false), zoomed = ref(null)
watch(() => props.draftRestore, value => { if (value) draft.value = value.text })
const portraits = computed(() => [
  { side: 'left', name: props.displayName, url: props.portraitUrl },
  { side: 'right', name: props.playerName, url: props.playerPortraitUrl },
])
const shownMessages = computed(() => {
  if (historyOpen.value) return props.messages
  const lastUser = props.messages.findLastIndex(message => message.role === 'user')
  const start = lastUser < 0 ? Math.max(0, props.messages.length - 1) : (lastUser < props.messages.length - 1 ? lastUser + 1 : lastUser)
  return props.messages.slice(start)
})
function submit() {
  if (composing.value || props.loading || props.sending || props.blocked || !draft.value.trim()) return
  emit('send', draft.value.trim())
  draft.value = ''
}
function onEnter(event) {
  event.preventDefault()
  if (!event.isComposing && event.keyCode !== 229 && !event.repeat) submit()
}
function onKeydown(event) {
  if (event.key === 'Escape' && !event.isComposing && !composing.value) {
    event.preventDefault()
    if (zoomed.value) zoomed.value = null
    else if (historyOpen.value) historyOpen.value = false
    else emit('close')
  }
  if (event.key !== 'Tab') return
  const elements = [...root.value.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')].filter(el => !el.closest('[inert]') && el.getClientRects().length)
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function resize() {
  const parent = root.value?.parentElement
  if (!parent) return
  const bounds = parent.getBoundingClientRect()
  // 父层（.npc-stage / 门店面板的 stage-host）的真实布局尺寸。offsetWidth / offsetHeight
  // 不受 CSS transform 影响，而 getBoundingClientRect 会：手机竖屏时 .town-view 被
  // rotate(90deg) 撑成横屏，包围盒的宽高是互换的 —— 直接用包围盒高度当可用高度，
  // 会把 390 算成 844，舞台被撑到屏幕外，两侧立绘就一个都看不见了。
  const localWidth = parent.offsetWidth || bounds.width
  const localHeight = parent.offsetHeight || bounds.height
  const rotated = localWidth > localHeight + 1
    && Math.abs(bounds.width - localHeight) < 1.5
    && Math.abs(bounds.height - localWidth) < 1.5
  const viewport = window.visualViewport
  const visibleTop = viewport ? Math.max(bounds.top, viewport.offsetTop) : bounds.top
  const visibleBottom = viewport ? Math.min(bounds.bottom, viewport.offsetTop + viewport.height) : bounds.bottom
  const visibleLeft = viewport ? Math.max(bounds.left, viewport.offsetLeft) : bounds.left
  const visibleRight = viewport ? Math.min(bounds.right, viewport.offsetLeft + viewport.width) : bounds.right
  // 旋转 90° 后舞台的纵向对应屏幕的横向，可用高度要按屏幕宽度算
  const height = Math.max(0, rotated ? visibleRight - visibleLeft : visibleBottom - visibleTop)
  const offset = Math.max(0, rotated ? bounds.right - visibleRight : visibleTop - bounds.top)
  // 收起立绘（compact）只在两种情况：可用高度被屏幕键盘 / 浏览器 UI 挤掉，
  // 或高度真的矮到放不下面板。手机横屏整屏本来就只有 ~380px 高，不能再按绝对高度一刀切，
  // 否则舞台上永远只剩对话框、双方立绘一个都看不见。
  compact.value = height < 260 || (height < 420 && height < localHeight - 120)
  // 旋转后的横屏里，行内高度会顶掉 CSS 给顶栏留的那 108px（可用高度也不是本地纵向，
  // 屏幕键盘挡的是本地横向，写进来只会把舞台撑出屏幕），所以没被挤掉时交回
  // CSS 的 min(680px, calc(100% - 108px))；其余情况保持原有行为。
  viewportStyle.value = (rotated && height >= localHeight - 1)
    ? {}
    : { top: `${offset}px`, height: `${height}px` }
}
let previousFocus, observer
let zoomTrigger
watch(zoomed, async value => {
  if (value) zoomTrigger = document.activeElement
  await nextTick()
  if (value) root.value?.querySelector('.td-zoom button')?.focus()
  else if (zoomTrigger?.isConnected) zoomTrigger.focus({ preventScroll: true })
})
watch(() => [props.messages.length, props.sending, historyOpen.value], async () => {
  await nextTick()
  if (body.value) body.value.scrollTop = historyOpen.value ? body.value.scrollHeight : 0
})
watch(() => props.loading || props.sending || props.blocked, async busy => {
  await nextTick()
  if (!busy && root.value?.contains(document.activeElement) && !matchMedia('(pointer: coarse)').matches) input.value?.focus({ preventScroll: true })
})
onMounted(() => {
  previousFocus = document.activeElement
  root.value.focus({ preventScroll: true })
  observer = new ResizeObserver(resize)
  observer.observe(root.value.parentElement)
  window.visualViewport?.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('scroll', resize)
  resize()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.visualViewport?.removeEventListener('resize', resize)
  window.visualViewport?.removeEventListener('scroll', resize)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<style scoped>
.town-dialogue-stage { position: absolute; inset: auto 0 0; height: min(680px, calc(100% - 108px)); z-index: 60; display: grid; grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(0, 1fr) minmax(330px, 540px) minmax(0, 1fr); align-items: end; gap: 8px; box-sizing: border-box; padding: 0 18px 24px; pointer-events: none; color: #574a40; overscroll-behavior: contain; outline: none; }
.td-portraits { display: contents; }
.td-portraits figure { pointer-events: auto; position: relative; align-self: stretch; margin: 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.td-portraits figure:first-child { grid-column: 1; }
.td-portraits figure:last-child { grid-column: 3; }
.td-portraits img { min-height: 0; height: 75vh; max-height: 100%; width: 100%; object-fit: contain; object-position: bottom; filter: drop-shadow(0 8px 16px #362a382e); }
.td-portraits figcaption { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: #fffaf1; text-shadow: 0 1px 4px #302822; font-size: 14px; }
.td-placeholder { background: #f4f1eeed; color: #947f6d; border-radius: 48px 48px 12px 12px; padding: 24px; font-size: 32px; }
.td-panel { pointer-events: auto; position: relative; isolation: isolate; grid-column: 2; grid-row: 1; align-self: end; width: 100%; max-width: 540px; height: min(420px, 100%); min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; padding: 27px 30px 30px; }
.td-dialog-shape { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; filter: drop-shadow(0 8px 18px #362a3826); pointer-events: none; }
header, .td-actions, .td-input { display: flex; align-items: center; gap: 10px; }
header { justify-content: space-between; }
h2 { color: #59483d; font-size: 20px; font-weight: 700; margin: 4px 0 8px; }
.td-kicker { color: #a1846e; font-size: 10px; letter-spacing: .15em; }
.td-speaker, .td-muted { font-size: 12px; color: #947f6d; }
.td-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; overflow-wrap: anywhere; }
article { margin: 10px 0 18px; }
article p { white-space: pre-wrap; line-height: 1.8; margin: 4px 0; font-size: 15px; }
.td-input { margin-top: 12px; }
.td-input > :first-child { flex: 1; min-width: 0; }
.td-status, .td-error { font-size: 12px; margin: 6px 0 0; }
.td-error { color: #ad5147; }
@container town-world (max-width: 700px) {
  .town-dialogue-stage { height: calc(100% - 112px); grid-template-columns: 1fr 1fr; grid-template-rows: minmax(80px, 1fr) minmax(220px, 48%); gap: 0; padding: 0 6px 10px; }
  .td-portraits { display: flex; justify-content: space-between; grid-column: 1 / -1; grid-row: 1; width: 100%; height: 100%; }
  .td-portraits figure { grid-column: auto; grid-row: auto; width: 48%; height: 100%; padding: 0 8px; }
  .td-panel { grid-column: 1 / -1; grid-row: 2; width: 100%; max-width: none; height: 100%; padding: 23px 25px; }
}
.compact .td-portraits { display: none; }
.compact .td-panel { grid-column: 1 / -1; width: 100%; height: 100%; }
.td-zoom { position: absolute; inset: 0; z-index: 2; background: rgba(0,0,0,.45); display: flex; justify-content: center; align-items: center; pointer-events: auto; }
.td-zoom img { max-width: 85%; max-height: 90%; object-fit: contain; }
/* 手机横屏：整屏高度通常只有 ~380px。旧规则是 @media (max-height: 500px) 直接
   .td-portraits { display: none }，而横屏手机高度必然小于 500px —— 等于手机上永远看不到双方立绘。
   现在改成：有立绘的舞台只收紧留白、把中栏收窄，让两侧立绘站得住；
   真正该收起立绘的场合（屏幕键盘弹出）交给 JS 的 compact 判断。 */
@media (max-height: 560px) {
  .town-dialogue-stage { grid-template-columns: minmax(0, 1fr) minmax(0, min(46%, 480px)) minmax(0, 1fr); padding: 0 12px 12px; }
  .td-panel { padding: 22px 24px 24px; }
}
/* 舞台本身没有立绘（工坊 / 门店的对话只有占位字母）时，矮屏不必为两侧留位，面板独占整行居中 */
@media (max-height: 560px) {
  .town-dialogue-stage:not(:has(.td-portraits img)) { grid-template-columns: minmax(0, 1fr); }
  .town-dialogue-stage:not(:has(.td-portraits img)) .td-portraits { display: none; }
  .town-dialogue-stage:not(:has(.td-portraits img)) .td-panel { grid-column: 1; justify-self: center; width: 100%; height: 100%; }
}
</style>
