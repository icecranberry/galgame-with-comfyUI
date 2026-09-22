<template>
  <section ref="root" class="town-dialogue-stage" role="dialog" aria-modal="true" :aria-label="`与${displayName}对话`"
    :style="viewportStyle" :class="{ compact }" tabindex="-1" @keydown.stop="onKeydown" @keyup.stop @pointerdown.stop @mousedown.stop @click.stop="onStageClick" @wheel.stop @touchstart.stop @touchmove.stop>
    <div class="td-portraits" aria-label="对话人物">
      <figure v-for="person in portraits" :key="person.side">
        <img v-if="person.url && !failedImages[person.url]" :src="person.url" :alt="`${person.name}立绘`" @error="failedImages[person.url] = true">
        <div v-else class="td-placeholder" aria-hidden="true">{{ person.name.slice(0, 1) }}</div>
        <figcaption>{{ person.name }}</figcaption>
        <div v-if="person.side === 'left' && npcBubble && chatActive && !historyOpen" :key="npcBubble.id ?? bubbleIndex"
          class="td-say-bubble" role="status" aria-live="polite">
          <span class="td-say-name">{{ displayName }}</span>
          <p>{{ npcBubble.content }}</p>
        </div>
      </figure>
    </div>
    <div class="td-panel" @click.stop>
      <svg class="td-dialog-shape" viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
        <path d="M22 15 L216 8 L406 17 L574 11 L589 44 L582 174 L594 360 L574 401 L351 411 L173 400 L23 408 L9 375 L18 209 L8 53 Z" fill="#fffaf1" stroke="#8d7968" stroke-width="2" vector-effect="non-scaling-stroke" />
        <path d="M29 24 L216 18 L405 26 L567 21 M29 392 L173 385 L350 395 L566 387" fill="none" stroke="#e0c9aa" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <header>
        <div><span class="td-kicker">小镇 · 相谈</span><h2>{{ displayName }}</h2></div>
        <div class="td-actions">
          <linshe-button variant="ghost" size="sm" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">{{ historyOpen ? '收起记录' : '历史' }}</linshe-button>
          <linshe-button variant="icon" size="sm" aria-label="关闭对话" @click="$emit('close')">✕</linshe-button>
        </div>
      </header>
      <div class="td-page" :key="pageKey">
        <div ref="body" class="td-body" :class="{ 'td-body--history': historyOpen }" tabindex="0" :aria-live="historyOpen ? 'polite' : 'off'" :aria-label="historyOpen ? '最近对话记录' : chatActive ? '当前对话' : '场景'">
          <template v-if="historyOpen">
            <p v-if="loading" role="status">正在读取对话…</p>
            <template v-else>
              <linshe-button v-if="hasMoreHistory" variant="link" size="sm" @click="$emit('load-older')">更早的记录</linshe-button>
              <p v-if="!messages.length" class="td-muted">这是你们在镇上的第一次交谈</p>
              <div v-else class="td-chat">
                <article v-for="(message, index) in messages" :key="message.id ?? index" class="td-bubble" :class="message.role === 'user' ? 'is-user' : 'is-npc'">
                  <span class="td-speaker">{{ message.role === 'user' ? playerName : displayName }}</span>
                  <slot name="message" :message="message"><p>{{ message.content }}</p></slot>
                </article>
              </div>
            </template>
          </template>
          <template v-else-if="chatActive">
            <p v-if="loading" role="status">正在读取对话…</p>
            <p v-else-if="!messages.length" class="td-muted">打个招呼，开始这次交谈吧。</p>
            <div v-else class="td-chat">
              <article v-for="(message, index) in recentMessages" :key="message.id ?? index" class="td-bubble" :class="message.role === 'user' ? 'is-user' : 'is-npc'">
                <span class="td-speaker">{{ message.role === 'user' ? playerName : displayName }}</span>
                <slot name="message" :message="message"><p>{{ message.content }}</p></slot>
              </article>
            </div>
          </template>
        </div>
        <slot v-if="!historyOpen" name="feedback" />
        <div v-if="actions.length" class="td-extra">
          <TownVnChoice v-for="item in actions" :key="item.key" :disabled="loading || sending || blocked" @select="$emit('action', item.key)">{{ item.label }}</TownVnChoice>
        </div>
        <p v-if="sending" class="td-status" role="status">正在回应…关闭后可重新打开查看记录。</p>
        <p v-else-if="status" class="td-status" role="status">{{ status }}</p>
        <div v-if="error" class="td-error" role="alert">
          <span>{{ error }}</span>
          <linshe-button v-if="retryable" variant="link" size="sm" :disabled="loading || sending" @click="$emit('retry')">重试同一条消息</linshe-button>
          <linshe-button variant="link" size="sm" :disabled="loading || sending" @click="$emit('reload')">重新读取记录</linshe-button>
        </div>
        <form v-if="showInput && chatActive" class="td-input" @submit.prevent="submit">
          <linshe-input ref="input" v-model="draft" size="sm" :disabled="loading || sending || blocked" :maxlength="maxLength" aria-label="对话内容" placeholder="说点什么…"
            @compositionstart="composing = true" @compositionend="composing = false" @keydown.enter="onEnter" />
          <linshe-button type="submit" variant="primary" size="sm" :loading="sending" :disabled="loading || blocked || !draft.trim()">发送</linshe-button>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import TownVnChoice from './TownVnChoice.vue'
import LinsheInput from '../ui/LinsheInput.vue'
const props = defineProps({
  displayName: { type: String, default: '邻居' }, playerName: { type: String, default: '我' },
  portraitUrl: String, playerPortraitUrl: String,
  messages: { type: Array, default: () => [] }, loading: Boolean, sending: Boolean, blocked: Boolean,
  showInput: { type: Boolean, default: true },
  chatActive: { type: Boolean, default: false },
  error: { type: String, default: '' },
  status: { type: String, default: '' }, hasMoreHistory: Boolean, maxLength: { type: Number, default: 200 },
  retryable: Boolean, draftRestore: Object, actions: { type: Array, default: () => [] },
})
const emit = defineEmits(['send', 'close', 'reload', 'load-older', 'retry', 'action'])
const root = ref(null), input = ref(null), body = ref(null)
const draft = ref(''), composing = ref(false), historyOpen = ref(false), failedImages = ref({})
const viewportStyle = ref({}), compact = ref(false)
watch(() => props.draftRestore, value => { if (value) draft.value = value.text })
// 对话模式只展示最近几条；完整记录交给「历史」按钮展开
const pageKey = computed(() => (props.chatActive ? 'chat' : 'idle'))
const recentMessages = computed(() => props.messages.slice(-10))
// 立绘右侧冒泡：只有本次发出消息后收到的新回复才冒泡，进入对话模式不会把旧消息顶上来
const bubbleIndex = ref(-1)
let awaitingReply = false
watch(() => props.sending, sending => {
  if (!sending) return
  awaitingReply = true
  bubbleIndex.value = -1
})
watch(() => props.messages, list => {
  if (!awaitingReply || !props.chatActive) return
  const last = list[list.length - 1]
  if (last && last.role !== 'user' && last.content) {
    bubbleIndex.value = list.length - 1
    awaitingReply = false
  }
})
watch(() => props.chatActive, active => {
  if (active) return
  awaitingReply = false
  bubbleIndex.value = -1
})
const npcBubble = computed(() => bubbleIndex.value >= 0 ? props.messages[bubbleIndex.value] : null)
const portraits = computed(() => [
  { side: 'left', name: props.displayName, url: props.portraitUrl },
  { side: 'right', name: props.playerName, url: props.playerPortraitUrl },
])
function submit() {
  if (composing.value || props.loading || props.sending || props.blocked || !draft.value.trim()) return
  emit('send', draft.value.trim())
  draft.value = ''
}
function onEnter(event) {
  event.preventDefault()
  if (!event.isComposing && event.keyCode !== 229 && !event.repeat) submit()
}
// td-panel 以外都算空白：立绘、舞台留白、屏幕其它位置，点一下都能退出对话
function onStageClick(event) {
  // 键盘触发的 click 没有坐标，交给各自按钮处理，不算空白点击
  if (event.detail === 0) return
  // 面板内的点击已在 .td-panel 上截断冒泡；这里再按目标与坐标兜两层，
  // 万一目标元素在 mousedown 与 click 之间被重渲染掉、冒泡路径丢失，也不会误关
  if (event.target instanceof Element && event.target.closest('.td-panel')) return
  const rect = root.value?.querySelector('.td-panel')?.getBoundingClientRect()
  if (rect && event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom) return
  emit('close')
}
function onKeydown(event) {
  if (event.key === 'Escape' && !event.isComposing && !composing.value) {
    event.preventDefault()
    if (historyOpen.value) historyOpen.value = false
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
watch(() => [props.messages.length, props.sending, historyOpen.value, props.chatActive], async () => {
  await nextTick()
  if (body.value) body.value.scrollTop = (historyOpen.value || props.chatActive) ? body.value.scrollHeight : 0
})
watch(() => props.loading || props.sending || props.blocked, async busy => {
  await nextTick()
  if (!busy && props.chatActive && root.value?.contains(document.activeElement) && !matchMedia('(pointer: coarse)').matches) input.value?.focus({ preventScroll: true })
})
// 进入对话模式后把焦点交给输入框
watch(() => props.chatActive, async active => {
  if (!active) return
  await nextTick()
  if (!matchMedia('(pointer: coarse)').matches) input.value?.focus({ preventScroll: true })
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
.town-dialogue-stage { position: absolute; inset: auto 0 0; height: min(680px, calc(100% - 108px)); z-index: 60; display: grid; grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(0, 1fr) minmax(330px, 540px) minmax(0, 1fr); align-items: end; gap: 8px; box-sizing: border-box; padding: 0 18px 24px; pointer-events: none; color: #574a40; overscroll-behavior: contain; outline: none;
  /* 暖纸色岛：舞台在两种主题下都是纸面观感，糖纸控件 token 在此重映射到小镇纸色，
     暗夜里 ghost 按钮 / 输入框才不会变成深色玻璃浮在奶油纸上 */
  --bg-secondary: #ffffff;
  --bg-tertiary: #f3ecdf;
  --border: #e0c9aa;
  --border-strong: var(--town-paper-line);
  --text-secondary: var(--town-paper-muted);
  --text-bright: var(--town-paper-ink); }
.td-portraits { display: contents; }
.td-portraits figure { pointer-events: auto; position: relative; align-self: stretch; margin: 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.td-portraits figure:first-child { grid-column: 1; }
.td-portraits figure:last-child { grid-column: 3; }
.td-portraits img { min-height: 0; height: 75vh; max-height: 100%; width: 100%; object-fit: contain; object-position: bottom; filter: drop-shadow(0 8px 16px #362a382e); }
.td-portraits figcaption { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: #fffaf1; text-shadow: 0 1px 4px #302822; font-size: 14px; }
/* NPC 说话气泡：从立绘右侧冒出来，只在对话模式出现 */
.td-say-bubble { position: absolute; left: calc(100% + 12px); top: 10%; z-index: 5; width: max-content; max-width: min(300px, 40vw); padding: 10px 14px; border: 2px solid #8d7968; border-radius: 16px 16px 16px 4px; background: #fffdf7; color: #554a43; box-shadow: 0 4px 0 rgba(141, 121, 104, .32), 0 10px 22px rgba(54, 42, 56, .18); pointer-events: none; animation: td-bubble-pop .3s var(--ease-spring); }
.td-say-bubble::after { content: ''; position: absolute; left: -8px; top: 16px; width: 12px; height: 12px; background: #fffdf7; border-left: 2px solid #8d7968; border-bottom: 2px solid #8d7968; transform: rotate(45deg); }
.td-say-bubble p { margin: 2px 0 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.td-say-name { font-size: 11px; color: #947f6d; }
@keyframes td-bubble-pop { from { opacity: 0; transform: translate(-10px, 8px) scale(.92); } to { opacity: 1; transform: none; } }
.td-placeholder { background: #f4f1eeed; color: #947f6d; border-radius: 48px 48px 12px 12px; padding: 24px; font-size: 32px; }
.td-panel { pointer-events: auto; position: relative; isolation: isolate; grid-column: 2; grid-row: 1; align-self: end; width: 100%; max-width: 540px; height: min(420px, 100%); min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; padding: 27px 30px 30px; }
.td-dialog-shape { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; filter: drop-shadow(0 8px 18px #362a3826); pointer-events: none; }
header, .td-actions, .td-input { display: flex; align-items: center; gap: 10px; }
header { justify-content: space-between; }
h2 { color: #59483d; font-size: 20px; font-weight: 700; margin: 4px 0 8px; }
.td-kicker { color: #a1846e; font-size: 10px; letter-spacing: .15em; }
.td-speaker, .td-muted { font-size: 12px; color: #947f6d; }
/* overflow-x 同样 clip：消息里的果冻按钮贴边放大时会把横向滚动条闪出来（同 TownResidentActions） */
.td-page { flex: 1; min-height: 0; display: flex; flex-direction: column; animation: td-page-in .3s var(--ease-out) both; }
@keyframes td-page-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
.td-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: clip; overflow-clip-margin: 6px; overscroll-behavior: contain; overflow-wrap: anywhere; }
/* 对话记录：玩家靠右、NPC 靠左的暖纸气泡 */
.td-chat { display: flex; flex-direction: column; gap: 10px; padding: 2px 0; }
.td-bubble { max-width: 86%; margin: 0; padding: 8px 12px; border: 2px solid var(--town-paper-line); border-radius: 14px; background: #fffdf7; box-shadow: 0 2px 0 rgba(141, 121, 104, .22); }
.td-bubble.is-user { align-self: flex-end; border-color: #dcb894; background: linear-gradient(180deg, #fff3e6, #ffe3c9); border-bottom-right-radius: 4px; }
.td-bubble.is-npc { align-self: flex-start; border-bottom-left-radius: 4px; }
.td-bubble p { white-space: pre-wrap; line-height: 1.7; margin: 2px 0 0; font-size: 14px; }
.td-bubble .td-speaker { display: block; font-size: 11px; color: #947f6d; }
.td-input { margin-top: 12px; }
.td-input > :first-child { flex: 1; min-width: 0; }
.td-status, .td-error { font-size: 12px; margin: 6px 0 0; }
.td-error { color: #ad5147; }
/* 舞台级游戏选项与 #feedback 里的居民选项同一语言：ghost 糖纸按钮、同一行距 */
.td-extra { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 0; }
@container town-world (max-width: 700px) {
  .td-say-bubble { left: calc(100% + 8px); right: auto; top: 4%; max-width: min(300px, 46vw); }
  .town-dialogue-stage { height: calc(100% - 112px); grid-template-columns: 1fr 1fr; grid-template-rows: minmax(80px, 1fr) minmax(220px, 48%); gap: 0; padding: 0 6px 10px; }
  .td-portraits { display: flex; justify-content: space-between; grid-column: 1 / -1; grid-row: 1; width: 100%; height: 100%; }
  .td-portraits figure { grid-column: auto; grid-row: auto; width: 48%; height: 100%; padding: 0 8px; }
  .td-panel { grid-column: 1 / -1; grid-row: 2; width: 100%; max-width: none; height: 100%; padding: 23px 25px; }
}
.compact .td-portraits { display: none; }
.compact .td-panel { grid-column: 1 / -1; width: 100%; height: 100%; }
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
