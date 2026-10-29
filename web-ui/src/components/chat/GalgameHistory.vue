<template>
  <Transition name="gal-backlog" :duration="300" @after-leave="afterClose">
    <div v-if="open" class="gal-backlog" @click.self="close" @keydown.stop="onKeydown">
      <section ref="panel" class="backlog-paper" role="dialog" aria-modal="true" aria-label="历史回顾" tabindex="-1" :inert="suspended || undefined">
        <svg class="backlog-frame backlog-frame-shadow" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          <path d="M30 5 H970 L994 29 V670 L970 694 H30 L6 670 V29 Z" />
        </svg>
        <svg class="backlog-frame" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
          <path class="backlog-frame-paper" d="M30 5 H970 L994 29 V670 L970 694 H30 L6 670 V29 Z" />
          <path class="backlog-frame-inner" d="M35 14 H965 L984 34 V665 L965 684 H35 L16 665 V34 Z" />
        </svg>
        <header class="backlog-heading">
          <div class="backlog-title">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v15M3 4c3-1 6 0 9 2 3-2 6-3 9-2v15c-3-1-6 0-9 2-3-2-6-3-9-2Z" /><path d="m6 8 3 1m-3 3 3 1m6-4 3-1m-3 5 3-1" /></svg>
            <div><h2>历史回顾</h2><p :title="`与${characterName}的对话`">与{{ characterName }}的对话</p></div>
          </div>
          <div class="backlog-action backlog-return" role="button" tabindex="0" aria-label="返回对话" @click="close" @keydown.enter.prevent="close" @keydown.space.prevent="close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h12a6 6 0 0 1 6 6" /></svg><span>返回</span>
          </div>
        </header>

        <div ref="scrollArea" class="backlog-scroll" tabindex="0" aria-label="对话记录" :aria-busy="loading || loadingOlder">
          <div v-if="hasOlder" class="backlog-earlier">
            <div class="backlog-action" :class="{ 'is-disabled': loadingOlder || readingOlder }" role="button" :tabindex="loadingOlder || readingOlder ? -1 : 0" :aria-disabled="loadingOlder || readingOlder" @click="readEarlier" @keydown.enter.prevent="readEarlier" @keydown.space.prevent="readEarlier">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16 7-7 7 7m-14-6 7-7 7 7" /></svg>
              <span>{{ loadingOlder || readingOlder ? '正在翻阅…' : '翻阅更早的对话' }}</span>
            </div>
          </div>
          <div v-if="!messages.length" class="backlog-empty" role="status">
            <span class="backlog-diamond" aria-hidden="true">◇</span>
            <p>{{ loading ? '正在翻开你们的故事…' : '故事还没开始' }}</p>
            <span v-if="!loading">你们的第一句话会留在这里。</span>
          </div>
          <article v-for="message in messages" :key="message.id" class="backlog-entry" :class="{ 'is-user': message.role === 'user' }" :data-message-id="message.id">
            <header class="backlog-speaker">
              <strong><span aria-hidden="true">{{ message.role === 'user' ? '·' : '◇' }}</span>{{ message.role === 'user' ? '我' : characterName }}</strong>
              <time :datetime="message.created_at">{{ historyTime(message.created_at) }}</time>
            </header>
            <div class="backlog-lines">
              <div v-if="message.content" class="backlog-text">
                <template v-for="(line, index) in historySpeechLines(message)" :key="line.messageId || `text-${index}`"><span>{{ line.messageId ? Array.from(line.text).slice(0, -2).join('') : line.text }}</span><div v-if="line.messageId" class="backlog-speech-tail"><span>{{ Array.from(line.text).slice(-2).join('') }}</span><SpeechButton appearance="dialogue" :character-id="characterId" :character-name="characterName" :message-id="line.messageId" notify-errors /></div></template>
              </div>
              <p v-else-if="!message.images?.length">（图片或表情消息）</p>
              <div v-if="message.images?.length" class="backlog-images">
                <div v-for="(url, index) in message.images" :key="url" class="backlog-photo" role="button" tabindex="0" :aria-label="`查看历史图片 ${index + 1}`" @click="previewImages($event, message.images, index)" @keydown.enter.prevent="previewImages($event, message.images, index)" @keydown.space.prevent="previewImages($event, message.images, index)">
                  <img :src="url" alt="对话图片" loading="lazy">
                  <span>查看图片 <span aria-hidden="true">↗</span></span>
                </div>
              </div>
            </div>
          </article>
          <div v-if="messages.length" class="backlog-end" aria-hidden="true"><span>◇</span><span>此刻</span><span>◇</span></div>
        </div>

        <div v-if="error" class="backlog-error" role="alert">
          <span>{{ error }}</span>
          <div class="backlog-action" role="button" tabindex="0" @click="$emit('retry')" @keydown.enter.prevent="$emit('retry')" @keydown.space.prevent="$emit('retry')">重试</div>
        </div>
        <footer class="backlog-footer">
          <span class="backlog-hint">滚动翻阅<span class="backlog-key-hint"> · Esc 返回</span></span>
          <div v-if="messages.length" class="backlog-action" role="button" tabindex="0" @click="scrollToLatest" @keydown.enter.prevent="scrollToLatest" @keydown.space.prevent="scrollToLatest">
            <span>回到最新</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 8 7 7 7-7m-14 6 7 7 7-7" /></svg>
          </div>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import SpeechButton from '../SpeechButton.vue'
import { historySpeechLines } from '../../utils/historySpeech.js'

const props = defineProps({
  open: Boolean,
  characterId: { type: Number, required: true },
  characterName: { type: String, default: '' },
  messages: { type: Array, default: () => [] },
  hasOlder: Boolean,
  loading: Boolean,
  loadingOlder: Boolean,
  loadOlder: { type: Function, required: true },
  error: { type: String, default: '' },
  suspended: Boolean,
})
const emit = defineEmits(['update:open', 'present-change', 'preview-images', 'retry'])
const panel = ref(null), scrollArea = ref(null), readingOlder = ref(false)
let previousFocus = null, imageFocus = null

watch(() => props.open, async open => {
  if (!open) return
  previousFocus = document.activeElement
  emit('present-change', true)
  await nextTick()
  if (!props.open) return
  if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  panel.value?.focus({ preventScroll: true })
}, { immediate: true })

watch(() => props.suspended, async suspended => {
  if (!suspended && props.open && imageFocus?.isConnected) {
    await nextTick()
    imageFocus.focus({ preventScroll: true })
  }
})

function close() { if (!props.suspended) emit('update:open', false) }
async function afterClose() {
  if (props.open) return
  emit('present-change', false)
  await nextTick()
  if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true })
}
function previewImages(event, images, index) {
  imageFocus = event.currentTarget
  emit('preview-images', images, index)
}
function scrollToLatest() {
  const body = scrollArea.value
  if (body) body.scrollTo({ top: body.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
async function readEarlier() {
  if (props.loadingOlder || readingOlder.value || !props.hasOlder) return
  const body = scrollArea.value
  // 新记录插入上方时，保持正在阅读的旧记录在原位置。
  const oldHeight = body.scrollHeight, oldTop = body.scrollTop
  readingOlder.value = true
  try {
    await props.loadOlder()
    await nextTick()
    if (props.open && body === scrollArea.value) {
      body.scrollTop = oldTop + body.scrollHeight - oldHeight
      if (document.activeElement === document.body) body.focus({ preventScroll: true })
    }
  } finally { readingOlder.value = false }
}
function onKeydown(event) {
  if (props.suspended || event.isComposing) return
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const focusable = [...(panel.value?.querySelectorAll('[tabindex="0"]') || [])].filter(el => el.getClientRects().length && el.getAttribute('aria-disabled') !== 'true')
  const first = focusable[0], last = focusable.at(-1)
  if (!first) { event.preventDefault(); panel.value?.focus(); return }
  if (document.activeElement === panel.value) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function historyTime(value) {
  if (!value) return ''
  const date = new Date(/Z|\+\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.gal-backlog { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: max(24px, env(safe-area-inset-top)) max(28px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(28px, env(safe-area-inset-left)); background: var(--dialogue-shadow); }
.backlog-paper { position: relative; isolation: isolate; display: flex; flex-direction: column; width: min(1100px, 100%); height: 100%; max-height: 880px; min-height: 0; padding: 30px clamp(28px, 4vw, 58px) 20px; color: var(--dialogue-ink); outline: none; }
.backlog-paper > :not(.backlog-frame) { position: relative; z-index: 1; }
/* Retain the animation layers at transition end; Android otherwise briefly drops the paper. */
.gal-backlog { will-change: opacity; }
.backlog-paper { will-change: transform; }
.backlog-frame { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.backlog-frame-shadow { top: 5px; fill: var(--dialogue-shadow); }
.backlog-frame-paper { fill: var(--dialogue-paper); stroke: var(--dialogue-outline); stroke-width: 2; vector-effect: non-scaling-stroke; }
.backlog-frame-inner { fill: none; stroke: var(--dialogue-inner); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.backlog-heading { display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; gap: 20px; padding-bottom: 20px; border-bottom: 2px solid var(--dialogue-rule); }
.backlog-title { display: flex; align-items: center; gap: 15px; min-width: 0; }
.backlog-title > svg { width: 33px; height: 33px; flex-shrink: 0; }
.backlog-title > div { min-width: 0; }
.backlog-title h2 { margin: 0; font-size: clamp(22px, 2.2vw, 29px); line-height: 1.4; letter-spacing: .14em; }
.backlog-title p { margin: 4px 0 0; color: var(--dialogue-muted); font-size: var(--fs-sm); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.backlog-paper svg:not(.backlog-frame) { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.backlog-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 5px 8px; font-size: var(--fs-sm); font-weight: 600; letter-spacing: .06em; text-align: center; cursor: pointer; user-select: none; transition: opacity .3s var(--ease-standard), transform .3s var(--ease-standard); }
.backlog-action svg { width: 20px; height: 20px; flex-shrink: 0; }
@media (hover: hover) and (pointer: fine) { .backlog-action:hover:not(.is-disabled) { transform: translateY(-2px); } }
@media (hover: hover) and (pointer: fine) { .backlog-action:active:not(.is-disabled) { transform: translateY(1px); } }
.backlog-action.is-disabled { cursor: wait; opacity: .55; }
.backlog-return { flex-shrink: 0; font-size: var(--fs-md); }
.backlog-action:focus-visible, .backlog-photo:focus-visible, .backlog-scroll:focus-visible { outline: 2px solid var(--dialogue-ink); outline-offset: 2px; }
.backlog-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; overflow-anchor: none; padding: 0 18px 0 4px; margin: 10px -18px 0 -4px; scrollbar-width: thin; scrollbar-color: var(--dialogue-outline) transparent; }
.backlog-scroll::-webkit-scrollbar { width: 4px; }
.backlog-scroll::-webkit-scrollbar-thumb { background: var(--dialogue-outline); }
.backlog-earlier { display: flex; align-items: center; gap: 16px; padding: 8px 0 10px; color: var(--dialogue-muted); }
.backlog-earlier::before, .backlog-earlier::after { content: ''; height: 1px; flex: 1; background: var(--dialogue-rule); }
.backlog-entry { display: grid; grid-template-columns: 155px minmax(0, 1fr); gap: 24px; padding: 25px 0; border-bottom: 1px solid var(--dialogue-rule); }
.backlog-speaker { padding-top: 2px; }
.backlog-speaker strong { display: flex; align-items: baseline; gap: 9px; overflow-wrap: anywhere; font-size: 17px; line-height: 1.7; }
.backlog-speaker strong > span { flex-shrink: 0; width: 12px; font-size: 16px; text-align: center; }
.backlog-speaker time { display: block; padding-left: 21px; margin-top: 4px; font-size: 11px; letter-spacing: .04em; color: var(--dialogue-muted); }
.is-user .backlog-speaker { color: var(--dialogue-muted); }
.backlog-lines { min-width: 0; font-size: 17px; line-height: 1.9; }
.backlog-speech-tail { display:inline-block; white-space:nowrap; }
.backlog-text > span, .backlog-lines p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.backlog-images { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.backlog-images:first-child { margin-top: 0; }
.backlog-photo { padding: 6px 6px 0; border: 0; border-radius: 0; background: var(--dialogue-photo-paper); box-shadow: var(--dialogue-photo-shadow); cursor: zoom-in; text-align: right; }
.backlog-photo img { display: block; width: 150px; height: 112px; object-fit: contain; border-radius: 0; }
.backlog-photo > span { display: block; font-size: 11px; line-height: 26px; color: var(--dialogue-photo-caption); }
.backlog-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 100%; padding: 36px 0; text-align: center; color: var(--dialogue-muted); font-size: var(--fs-sm); }
.backlog-empty p { font-size: 20px; color: var(--dialogue-ink); }
.backlog-diamond { font-size: 38px; }
.backlog-end { display: flex; justify-content: center; align-items: center; gap: 18px; padding: 25px 0; color: var(--dialogue-muted); font-size: 12px; letter-spacing: .18em; }
.backlog-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-shrink: 0; padding-top: 8px; border-top: 2px solid var(--dialogue-rule); }
.backlog-hint { font-size: 11px; letter-spacing: .06em; color: var(--dialogue-muted); }
.backlog-error { display: flex; justify-content: space-between; align-items: center; gap: 10px; color: var(--danger); font-size: var(--fs-sm); }
.gal-backlog-enter-active, .gal-backlog-leave-active { transition: opacity .3s var(--ease-standard); }
.gal-backlog-enter-active .backlog-paper, .gal-backlog-leave-active .backlog-paper { transition: transform .3s var(--ease-standard); }
.gal-backlog-enter-from, .gal-backlog-leave-to { opacity: 0; }
.gal-backlog-enter-from .backlog-paper, .gal-backlog-leave-to .backlog-paper { transform: translateY(12px); }
@media (max-width: 767px) {
  .gal-backlog { padding: max(12px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)); }
  .backlog-paper { padding: 24px 25px 14px; }
  .backlog-heading { padding-bottom: 14px; gap: 10px; }
  .backlog-title { gap: 10px; }
  .backlog-title > svg { width: 25px; height: 25px; }
  .backlog-title h2 { font-size: 22px; }
  .backlog-title p { font-size: 11px; }
  .backlog-entry { grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 20px 0; }
  .backlog-speaker { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .backlog-speaker strong { font-size: 15px; }
  .backlog-speaker time { flex-shrink: 0; padding-left: 0; margin: 0; font-size: 10px; }
  .backlog-lines { font-size: 16px; }
  .backlog-scroll { margin-right: -10px; padding-right: 10px; }
  .backlog-key-hint { display: none; }
  .backlog-photo img { width: 128px; height: 100px; }
}
@media (max-height: 520px) {
  .gal-backlog { padding: max(8px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
  .backlog-paper { padding: 16px 28px 10px; }
  .backlog-heading { padding-bottom: 6px; }
  .backlog-title { gap: 10px; }
  .backlog-title h2 { font-size: 20px; }
  .backlog-title > svg { width: 25px; height: 25px; }
  .backlog-title p, .backlog-key-hint { display: none; }
  .backlog-action { min-height: 36px; font-size: 12px; }
  .backlog-entry { padding: 14px 0; gap: 12px; }
  .backlog-speaker strong, .backlog-lines { font-size: 14px; }
  .backlog-lines { line-height: 1.7; }
  .backlog-end { padding: 12px 0; }
}
</style>
