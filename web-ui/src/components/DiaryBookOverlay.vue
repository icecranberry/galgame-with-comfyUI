<template>
  <Teleport to="body">
    <Transition name="diary-fade">
      <div
        v-if="store.open"
        class="diary-overlay"
        @click.self="requestClose"
        @keydown.esc.stop.prevent="requestClose"
      >
        <div class="diary-stage" role="dialog" aria-modal="true" :aria-label="`${store.characterName}的日记`">
          <!-- 顶栏：谁的本子 + 操作 -->
          <div class="diary-bar">
            <div class="db-who">
              <span class="db-avatar">
                <img v-if="store.characterAvatar" :src="store.characterAvatar" alt="" />
                <span v-else>{{ (store.characterName || '？').charAt(0) }}</span>
              </span>
              <span class="db-name">{{ store.characterName }}</span>
              <span class="db-sub">的日记</span>
              <span class="db-date-chip">{{ dateLabel }}</span>
              <span v-if="store.generating" class="db-writing">
                <span class="db-writing-dot"></span>正在写…
              </span>
            </div>
            <div class="db-actions">
              <button
                type="button"
                class="db-btn"
                :aria-expanded="store.historyOpen"
                :class="{ 'is-selected': store.historyOpen }"
                title="翻开以前的日记"
                @click="toggleHistory"
              >
                <diary-icon :size="14" />
                <span>历史日记</span>
              </button>
              <button
                type="button"
                v-if="store.isToday"
                class="db-btn"
                :aria-busy="store.generating"
                :disabled="store.generating"
                @click="onGenerate"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><polyline points="23 20 23 14 17 14" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
                <span>{{ store.generating ? '正在写…' : store.hasDiary ? '重新生成' : '写今天的日记' }}</span>
              </button>
              <button type="button" class="db-close" title="合上日记" aria-label="合上日记" @click="requestClose">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>

          <!-- 书本 -->
          <div
            class="diary-book"
            :class="{ 'is-flipping': store.flipping }"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @pointercancel="onSwipeCancel"
          >
            <div class="book-frame">
              <!-- 封面：打开时向左翻开并淡出，露出里面的内页 -->
              <div class="book-cover" :class="{ 'cover-open': coverOpened }" aria-hidden="true">
                <div class="cover-face">
                  <div class="cover-frame">
                    <div class="cover-ornament">✦</div>
                    <h3 class="cover-name">{{ store.characterName }}</h3>
                    <p class="cover-title">的日记</p>
                    <div class="cover-rule"></div>
                    <p class="cover-hint">{{ coverHint }}</p>
                  </div>
                </div>
              </div>

              <!-- 书脊与翻页层：贴在书框上，不随内页滚动 -->
              <div v-if="store.hasDiary" class="book-spine" aria-hidden="true"></div>
              <div
                v-if="store.flipping"
                class="page-flip"
                :class="store.flipDirection < 0 ? 'flip-forward' : 'flip-back'"
                aria-hidden="true"
              ></div>

              <!-- 内页：一整条流，由 CSS 多栏均分成两列（正文与配图交错分布） -->
              <div class="book-spread">
                <div v-if="store.loading && !store.diary" class="sheet-state">
                  <div class="page-skeleton">
                    <div class="sk-line" v-for="n in 8" :key="n" :style="{ width: (52 + Math.random() * 44) + '%' }"></div>
                  </div>
                </div>

                <template v-else-if="store.hasDiary">
                  <header class="sheet-head">
                    <div class="page-date">{{ dateLabel }}</div>
                    <h2 class="page-title" :style="fontStyle">{{ store.diary.title }}</h2>
                    <div class="page-meta">
                      <span v-if="store.diary.mood" class="page-chip">心情 · {{ store.diary.mood }}</span>
                      <span v-if="store.diary.weather" class="page-chip">天气 · {{ store.diary.weather }}</span>
                    </div>
                  </header>

                  <div class="diary-flow">
                    <template v-for="(block, i) in flowBlocks" :key="`${block.type}-${i}`">
                      <p v-if="block.type === 'text'" class="flow-text" :style="fontStyle">{{ block.text }}</p>
                      <figure
                        v-else
                        class="photo-card"
                        :class="[`tilt-${block.slot % 3}`, { 'is-empty': !block.url }]"
                      >
                        <img
                          v-if="block.url"
                          :src="block.url"
                          alt=""
                          loading="lazy"
                          decoding="async"
                          @click="openLightbox(block.slot)"
                        />
                        <div v-else class="photo-empty">
                          <span v-if="store.generating" class="photo-spinner"></span>
                          <template v-else>
                            <span class="photo-empty-mark">✕</span>
                            <span class="photo-empty-text">这张没画出来</span>
                          </template>
                        </div>
                        <span v-if="block.url" class="photo-tape" aria-hidden="true"></span>
                      </figure>
                    </template>
                  </div>

                  <div v-if="store.error" class="page-note is-error">
                    配图没画全：{{ store.error }} 点右上角「重新生成」可以再写一遍。
                  </div>
                  <div v-else-if="store.generating" class="page-note">正在重新写这一页，写完会自己换上来…</div>
                </template>

                <div v-else-if="store.generating" class="sheet-state">
                  <div class="page-empty-icon"><span class="book-spinner"></span></div>
                  <p class="page-empty-title">正在回想今天…</p>
                  <span class="page-empty-hint">写完之后这一页会自己出现，也可以先合上本子去做别的。</span>
                </div>

                <div v-else class="sheet-state">
                  <diary-icon :size="42" class="page-empty-icon-svg" />
                  <p class="page-empty-title">{{ store.isToday ? '今天这一页还是空的' : '这一天没有留下日记' }}</p>
                  <span class="page-empty-hint">
                    {{ store.isToday ? '让 ta 把今天的日程里值得记住的部分写成一篇日记。' : '只有当天写过日记，才会留下这一页。' }}
                  </span>
                  <linshe-button
                    v-if="store.isToday"
                    variant="primary"
                    class="page-empty-btn"
                    :loading="store.generating"
                    @click="onGenerate"
                  >
                    写今天的日记
                  </linshe-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 翻页导航 -->
          <nav class="diary-nav" aria-label="日记翻页">
            <button
                type="button"
              class="nav-btn"
              :disabled="!store.olderEntry || store.loading || store.flipping"
              :title="store.olderEntry ? `翻到 ${labelOf(store.olderEntry.date)}` : '没有更早的日记了'"
              @click="store.stepOlder()"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              <span>{{ store.olderEntry ? '较早一篇' : '已到最早' }}</span>
            </button>
            <span class="nav-hint" aria-live="polite"><span class="nav-caption">翻阅日记</span>{{ navHint }}</span>
            <button
                type="button"
              class="nav-btn"
              :disabled="!store.newerEntry || store.loading || store.flipping"
              :title="store.newerEntry ? `翻到 ${labelOf(store.newerEntry.date)}` : '已经是最新的一篇'"
              @click="store.stepNewer()"
            >
              <span>{{ store.newerEntry ? '较新一篇' : '已到最新' }}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </nav>
        </div>

        <!-- 历史日记抽屉 -->
        <Transition name="diary-history">
          <aside v-if="store.historyOpen" class="diary-history" @click.stop>
            <div class="dh-head">
              <span class="dh-title">以前的日记</span>
              <linshe-button variant="icon" size="sm" title="收起" @click="store.historyOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </linshe-button>
            </div>
            <div class="dh-list">
              <div v-if="store.historyLoading && !store.history.length" class="dh-empty">正在翻找…</div>
              <div v-else-if="!store.history.length" class="dh-empty">本子里还没有别的日记</div>
              <div
                v-for="entry in store.history"
                :key="entry.date"
                class="dh-item"
                :class="{ 'is-current': entry.date === store.date }"
                role="button"
                tabindex="0"
                @click="pickEntry(entry)"
                @keydown.enter.prevent="pickEntry(entry)"
              >
                <div class="dh-item-head">
                  <span class="dh-item-date">{{ shortLabelOf(entry.date) }}</span>
                  <span v-if="entry.mood" class="dh-item-mood">{{ entry.mood }}</span>
                </div>
                <span class="dh-item-title">{{ entry.title || '无题' }}</span>
              </div>
            </div>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- 与日报一致：挂到 body，并用灯箱实际使用的 CSS 变量覆盖层级。 -->
  <Teleport to="body">
    <div style="--vel-z-index: 14000">
      <ImageLightbox
        :visible="lightboxVisible"
        :imgs="store.images"
        :index="lightboxIndex"
        :show-regenerate="false"
        :show-upscale="false"
        :show-delete="false"
        :loop="true"
        @hide="lightboxVisible = false"
      />
    </div>
  </Teleport>
</template>

<script setup>
/**
 * 全屏日记本：内页是一整条流，正文段落与配图交错排布，再由 CSS 多栏均分成两列
 * （文字与图片混在一起、左右两列高度接近）；可滑动、可前后翻阅历史。
 * 宿主挂在 App.vue，状态全在 stores/diary.js；日程页入口、右下角生成提示的「翻开看看」都打开它。
 *
 * 字体：正文用「信件系统」给角色配好的手写字体（characters.handwriting_font，随日记快照）。
 * 开场动画：封面绕书脊向左翻开（rotateY）后淡出，露出内页；合上时 0.3s 淡出。
 */
import { computed, onMounted, onUnmounted, ref, watch, inject } from 'vue'
import { useDiaryStore, todayKey } from '../stores/diary.js'
import { buildDiaryFlow } from '../utils/diaryFlow.js'
import { getFontFamily, getPageDefaultFontFamily, loadFont } from '../composables/useHandwritingFont.js'
import DiaryIcon from './DiaryIcon.vue'
import LinsheButton from './ui/LinsheButton.vue'
import ImageLightbox from './ImageLightbox.vue'

const DIARY_IMAGE_SLOTS = 3

const store = useDiaryStore()
const toast = inject('toast', null)

const coverOpened = ref(false)
const lightboxVisible = ref(false)
const lightboxIndex = ref(0)

let openTimer = null

store.connect()

// ── 翻开 / 合上（遮罩 0.3s 渐入渐出，封面 0.95s 翻开） ──
watch(() => store.open, (open) => {
  if (openTimer) { clearTimeout(openTimer); openTimer = null }
  coverOpened.value = false
  if (open) {
    // 下一帧再翻封面，让 0.95s 的翻开过渡真的跑起来
    openTimer = window.setTimeout(() => { coverOpened.value = true }, 30)
  }
}, { immediate: true })

function requestClose() {
  if (lightboxVisible.value) { lightboxVisible.value = false; return }
  store.closeBook()
}

// ── 手写字体（与信件同一套） ──
const fontStyle = computed(() => {
  const fontId = store.diary?.handwriting_font
  if (!fontId) return { fontFamily: getPageDefaultFontFamily() }
  return { fontFamily: getFontFamily(fontId) }
})
watch(() => store.diary?.handwriting_font, (fontId) => { if (fontId) loadFont(fontId) }, { immediate: true })

// ── 日期文案 ──
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

function labelOf(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!m) return dateKey || ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const prefix = dateKey === todayKey() ? '今天 · ' : ''
  return `${prefix}${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日 · ${WEEKDAYS[d.getDay()]}`
}

const dateLabel = computed(() => labelOf(store.date))
/** 历史列表用的短日期：今年不写年份，省下的宽度留给标题 */
function shortLabelOf(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!m) return dateKey || ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const sameYear = Number(m[1]) === new Date().getFullYear()
  const ymd = sameYear ? `${Number(m[2])}月${Number(m[3])}日` : `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
  return `${dateKey === todayKey() ? '今天 · ' : ''}${ymd} · ${WEEKDAYS[d.getDay()]}`
}

const coverHint = computed(() => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(store.date || ''))
  if (!m) return '我的日记'
  return `${Number(m[1])}.${m[2]}.${m[3]} 周${WEEKDAY_SHORT[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()]}`
})

const navHint = computed(() => {
  if (store.loading) return '翻页中…'
  if (!store.olderEntry && !store.newerEntry) return store.isToday ? '今天' : '本子里只有这一篇'
  if (!store.olderEntry) return '这是最早的一篇'
  if (!store.newerEntry) return '已经是最新的一篇'
  return '左右滑动也能翻页'
})

// ── 版面：正文段落与三张配图交错成一条流，交给多栏均分两列 ──
const flowBlocks = computed(() => {
  const slots = Array.from({ length: DIARY_IMAGE_SLOTS }, (_, i) => store.images[i] || '')
  return buildDiaryFlow(store.diary?.content || '', slots)
})

function openLightbox(slotIndex) {
  if (!store.images[slotIndex]) return
  lightboxIndex.value = slotIndex
  lightboxVisible.value = true
}

// ── 生成 / 重新生成 ──
async function onGenerate() {
  try {
    await store.generate()
    toast?.(store.hasDiary ? '正在重新写这一篇日记' : '开始写今天的日记', 'info')
  } catch (err) {
    toast?.(err.message || '日记生成启动失败', 'error')
  }
}

// ── 历史 ──
function toggleHistory() {
  store.historyOpen = !store.historyOpen
  if (store.historyOpen && !store.history.length) store.loadHistory()
}

function pickEntry(entry) {
  const direction = entry.date < store.date ? 1 : -1
  store.goTo(entry.date, { direction })
  store.historyOpen = false
}

// ── 滑动翻阅 ──
let swipe = null
function onSwipeStart(e) {
  if (e.pointerType !== 'touch') return
  swipe = { x: e.clientX, y: e.clientY }
}
function onSwipeCancel() { swipe = null }
function onSwipeEnd(e) {
  if (!swipe) return
  const dx = e.clientX - swipe.x
  const dy = e.clientY - swipe.y
  swipe = null
  if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return
  if (dx > 0) store.stepOlder()
  else store.stepNewer()
}

// ── 键盘翻页 ──
function onKeydown(e) {
  if (!store.open) return
  if (e.key === 'Escape') requestClose()
  else if (e.key === 'ArrowLeft') store.stepOlder()
  else if (e.key === 'ArrowRight') store.stepNewer()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (openTimer) clearTimeout(openTimer)
})
</script>

<style scoped>
.diary-overlay {
  --diary-control-paper: var(--bg-sunken);
  position: fixed;
  inset: 0;
  z-index: 11500;
  display: grid;
  place-items: center;
  padding: 20px 24px;
  background: rgba(0, 0, 0, 0.45);
}

.diary-fade-enter-active { transition: opacity 0.3s ease; }
.diary-fade-leave-active { transition: opacity 0.3s ease; }
.diary-fade-enter-from, .diary-fade-leave-to { opacity: 0; }

.diary-stage {
  width: min(1180px, 96vw);
  max-height: 94dvh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── 顶栏 ── */
.diary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: var(--diary-control-paper);
  color: var(--town-paper-ink);
  border: 1px solid var(--town-paper-line);
  box-shadow: var(--shadow-sm);
}

.db-who { display: flex; align-items: center; gap: 8px; min-width: 0; }

.db-avatar {
  width: 30px; height: 30px; flex: none;
  border-radius: 50%;
  overflow: hidden;
  display: grid; place-items: center;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 13px; font-weight: 700;
}
.db-avatar img { width: 100%; height: 100%; object-fit: cover; }

.db-name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-sub { font-size: 12px; opacity: 0.7; }
.db-date-chip {
  font-size: 12px;
  padding: 2px 9px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.14);
  white-space: nowrap;
}
.db-writing { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; opacity: 0.85; }
.db-writing-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  animation: db-pulse 1.1s ease-in-out infinite;
}
@keyframes db-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

.db-actions { display: flex; align-items: center; gap: 8px; flex: none; }
/* 独立手账控件：薄纸签与墨色图标，不继承通用软糖按钮皮肤。 */
.db-btn, .db-close, .nav-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--town-paper-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: none;
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.db-btn + .db-btn { border-color: var(--town-paper-line); }
.db-btn:hover:not(:disabled), .db-btn.is-selected, .nav-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--town-paper-accent) 10%, transparent);
  color: var(--town-paper-accent);
}
.db-btn:focus-visible, .db-close:focus-visible, .nav-btn:focus-visible {
  outline: 2px solid var(--town-paper-accent);
  outline-offset: 3px;
}
.db-btn:active:not(:disabled), .db-close:active, .nav-btn:active:not(:disabled) { transform: translateY(1px); }
.db-btn:disabled, .nav-btn:disabled { cursor: default; opacity: 0.48; transform: none; }
.db-close { width: 40px; padding: 0; margin-left: 4px; border-left-color: var(--town-paper-line); border-radius: 0; }
.db-close:hover { color: var(--town-paper-accent); background: color-mix(in srgb, var(--town-paper-accent) 10%, transparent); }
.db-btn[aria-busy="true"] svg { animation: cel-spin 1.4s linear infinite; }
:global([data-theme="dark"]) .diary-overlay { --diary-control-paper: var(--bg-primary); }
:global([data-theme="dark"]) .diary-bar,
:global([data-theme="dark"]) .diary-nav { --town-paper-ink: var(--text-primary); --town-paper-muted: var(--text-secondary); --town-paper-line: var(--border-strong); --town-paper-accent: var(--accent); }

/* ── 书 ── */
.diary-book {
  perspective: 1800px;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
}

/* 尺寸由内部的 .book-spread 决定，封面绝对定位铺在上面，翻开时不会被裁切 */
.book-frame { position: relative; }

.book-spread {
  position: relative;
  width: min(1180px, 96vw);
  height: min(80dvh, 880px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 26px 34px 30px;
  border-radius: var(--radius-lg);
  /* 暖纸内页：不用信件纸（那是带航空边条的整张信封），日记本自己是一张干净的手账纸 */
  background: #f9f3e6;
  box-shadow: 0 18px 48px rgba(30, 20, 12, 0.42), inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}

.book-spine {
  position: absolute;
  top: 0; bottom: 0; left: 50%;
  width: 26px;
  transform: translateX(-50%);
  pointer-events: none;
  border-radius: var(--radius-lg);
  z-index: 2;
  background: linear-gradient(90deg,
    rgba(120, 96, 70, 0) 0%,
    rgba(120, 96, 70, 0.13) 42%,
    rgba(90, 70, 48, 0.2) 50%,
    rgba(120, 96, 70, 0.13) 58%,
    rgba(120, 96, 70, 0) 100%);
}

/* ── 抬头（跨两栏） ── */
.sheet-head { margin-bottom: 16px; }
.page-date { font-size: 12px; letter-spacing: 1px; color: #9b8a75; }
.page-title {
  margin: 6px 0 8px;
  font-size: 24px;
  font-weight: 500;
  line-height: 1.45;
  color: #4a3524;
}
.page-meta { display: flex; flex-wrap: wrap; gap: 8px; }
.page-chip {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: rgba(174, 100, 81, 0.12);
  color: var(--town-paper-accent);
}

/* ── 内页流：两列均分，正文与配图交错 ── */
.diary-flow {
  columns: 2;
  column-gap: 46px;
  column-fill: balance;
}

.flow-text {
  margin: 0 0 14px;
  font-size: clamp(14.5px, 1.05vw, 16px);
  line-height: 1.92;
  color: #4a3a2a;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: justify;
}

.photo-card {
  position: relative;
  break-inside: avoid;
  margin: 0 0 18px;
  display: flex;
  justify-content: center;
  border-radius: 8px;
  background: #fff;
  padding: 8px 8px 11px;
  box-shadow: 0 6px 18px rgba(70, 52, 36, 0.18), 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.photo-card img {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 33dvh;
  min-height: 120px;   /* 图未解码前也撑住卡片高度，避免加载完成时整页跳动 */
  object-fit: contain;
  border-radius: 4px;
  background: #efe8dd;
  cursor: zoom-in;
}
.tilt-0 { transform: rotate(-0.9deg); }
.tilt-1 { transform: rotate(0.7deg); }
.tilt-2 { transform: rotate(-0.4deg); }

.photo-tape {
  position: absolute;
  top: -7px;
  left: 50%;
  width: 56px;
  height: 16px;
  transform: translateX(-50%) rotate(-2deg);
  background: rgba(226, 205, 160, 0.72);
  box-shadow: 0 1px 2px rgba(80, 60, 40, 0.16);
}

.photo-empty {
  width: 100%;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 4px;
  border: 1px dashed rgba(150, 122, 90, 0.4);
  background: rgba(240, 232, 220, 0.5);
  color: #a08e78;
  font-size: 12px;
}
.photo-empty-mark { font-size: 18px; opacity: 0.6; }

.page-note {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.6;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: rgba(120, 96, 70, 0.1);
  color: #7a6650;
}
.page-note.is-error { background: rgba(var(--accent-rgb), 0.12); color: var(--town-paper-accent); }

/* ── 空 / 加载 / 生成中 ── */
.sheet-state {
  min-height: min(60dvh, 560px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px 8px;
  color: #8b7a64;
}
.page-empty-icon { font-size: 26px; }
.page-empty-icon-svg { color: rgba(139, 122, 100, 0.5); margin-bottom: 4px; }
.page-empty-title { margin: 0; font-size: 15px; font-weight: 700; color: #6b533a; }
.page-empty-hint { font-size: 12.5px; line-height: 1.6; max-width: 320px; }
.page-empty-btn { margin-top: 8px; }

.book-spinner, .photo-spinner {
  display: inline-block;
  border-radius: 50%;
  border: 2.5px solid rgba(var(--accent-rgb), 0.24);
  border-top-color: var(--accent);
  animation: cel-spin 0.8s linear infinite;
}
.book-spinner { width: 26px; height: 26px; }
.photo-spinner { width: 18px; height: 18px; }

/* ── 翻页动画（覆盖书的右半，圆角跟随书角） ── */
.page-flip {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 50%;
  z-index: 3;
  transform-origin: left center;
  pointer-events: none;
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
  background: linear-gradient(90deg, rgba(255, 253, 248, 0.96), rgba(226, 214, 196, 0.9));
  box-shadow: -8px 0 22px rgba(60, 44, 28, 0.22);
  animation: flip-back 0.42s cubic-bezier(0.4, 0.1, 0.3, 1) both;
}
.page-flip.flip-forward { animation-name: flip-forward; }

@keyframes flip-forward {
  from { transform: rotateY(0deg); opacity: 1; }
  to { transform: rotateY(-176deg); opacity: 0.1; }
}
@keyframes flip-back {
  from { transform: rotateY(-176deg); opacity: 0.1; }
  to { transform: rotateY(0deg); opacity: 1; }
}

/* ── 封面 / 翻开动画 ── */
.book-cover {
  position: absolute;
  inset: 0;
  z-index: 4;
  transform-origin: left center;
  transform-style: preserve-3d;
  transform: rotateY(0deg);
  transition: transform 0.95s cubic-bezier(0.24, 0.62, 0.3, 1), opacity 0.3s ease;
  backface-visibility: hidden;
}
.book-cover.cover-open {
  transform: rotateY(-168deg);
  opacity: 0;
  transition: transform 0.95s cubic-bezier(0.24, 0.62, 0.3, 1), opacity 0.34s ease 0.58s;
}

.cover-face {
  height: 100%;
  border-radius: var(--radius-lg);
  display: grid;
  place-items: center;
  background:
    linear-gradient(150deg, rgba(255, 255, 255, 0.16), rgba(0, 0, 0, 0.16)),
    linear-gradient(160deg, #7d4a3c 0%, #6a3b31 55%, #57302a 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 236, 210, 0.28), inset 0 0 60px rgba(0, 0, 0, 0.28);
}

.cover-frame {
  text-align: center;
  color: #f6e6cf;
  padding: 28px 34px;
  border: 1px solid rgba(246, 230, 207, 0.35);
  border-radius: var(--radius-md);
  min-width: 62%;
}
.cover-ornament { font-size: 18px; opacity: 0.7; }
.cover-name { margin: 10px 0 2px; font-size: 26px; font-weight: 700; letter-spacing: 2px; }
.cover-title { margin: 0; font-size: 15px; opacity: 0.86; letter-spacing: 6px; }
.cover-rule { width: 46px; height: 1px; margin: 16px auto; background: rgba(246, 230, 207, 0.4); }
.cover-hint { margin: 0; font-size: 12px; opacity: 0.7; letter-spacing: 1px; }

/* ── 底栏翻页 ── */
.diary-nav {
  display: grid;
  grid-template-columns: 1fr minmax(130px, auto) 1fr;
  align-items: center;
  align-self: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--town-paper-line);
  border-radius: 12px;
  background: var(--diary-control-paper);
  box-shadow: var(--shadow-sm);
}
.nav-btn { min-width: 106px; min-height: 44px; }
.nav-hint { display: flex; flex-direction: column; gap: 3px; text-align: center; font-size: 12px; color: var(--town-paper-muted); }
.nav-caption { font-size: 10px; letter-spacing: 2px; color: var(--town-paper-accent); }


/* ── 历史抽屉 ── */
.diary-history {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(320px, 82vw);
  z-index: 11600;
  display: flex;
  flex-direction: column;
  background: #f9f3e6;
  box-shadow: -14px 0 40px rgba(30, 20, 12, 0.36);
}
.diary-history-enter-active, .diary-history-leave-active { transition: transform 0.3s ease, opacity 0.3s ease; }
.diary-history-enter-from, .diary-history-leave-to { transform: translateX(100%); opacity: 0.4; }

.dh-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 14px 10px 18px;
  border-bottom: 1px solid rgba(150, 122, 90, 0.25);
}
.dh-title { font-size: 13px; font-weight: 700; color: #6b533a; letter-spacing: 1px; }
.dh-list { flex: 1; overflow-y: auto; padding: 8px 10px 18px; }
.dh-empty { padding: 26px 10px; text-align: center; font-size: 12.5px; color: #9b8a75; }

.dh-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast, 0.16s) ease;
}
.dh-item:hover { background: rgba(174, 100, 81, 0.09); }
.dh-item.is-current { background: rgba(174, 100, 81, 0.14); }
.dh-item-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dh-item-date { font-size: 11.5px; color: #9b8a75; white-space: nowrap; }
.dh-item-title { font-size: 13.5px; font-weight: 600; color: #5a4130; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dh-item-mood { font-size: 11.5px; color: var(--town-paper-accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }

/* ── 骨架 ── */
.page-skeleton { display: flex; flex-direction: column; gap: 12px; padding-top: 10px; }
.sk-line { height: 13px; border-radius: 6px; background: rgba(150, 122, 90, 0.18); animation: sk-pulse 1.4s ease-in-out infinite; }
@keyframes sk-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }

/* ── 手机端：内页收成单列长页，整页滚动 ── */
@media (max-width: 767px) {
  .diary-overlay { padding: 0; place-items: stretch; overflow-y: auto; overscroll-behavior: contain; }
  .diary-stage {
    width: 100vw;
    max-height: none;
    gap: 0;
  }
  .diary-bar {
    border-radius: 0;
    padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px;
    flex-wrap: wrap;
    /* 顶栏留在正常文档流中，随日记整页滚动。 */
    position: static;
    background: var(--diary-control-paper);
  }
  .db-name, .db-sub { font-size: 13px; }
  .db-date-chip { display: none; }
  .db-who { flex: 1 1 100%; }
  .db-actions { width: 100%; gap: 6px; }
  .db-btn, .db-close { min-height: 44px; }
  .db-close { margin-left: auto; width: 44px; }
  .diary-nav { width: 100%; grid-template-columns: 1fr minmax(0, 1.2fr) 1fr; gap: 2px; border-radius: 0; padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px)); }
  .nav-btn { min-width: 0; padding: 0 5px; font-size: 12px; }
  .nav-hint { font-size: 11px; }
  .diary-book { perspective: none; display: block; }
  .book-frame { width: 100%; }
  .book-spread {
    width: 100%;
    height: auto;
    max-height: none;
    overflow: visible;
    border-radius: 0;
    padding: 18px 18px 22px;
    box-shadow: none;
  }
  .book-spine, .photo-tape, .page-flip { display: none; }
  .book-cover { border-radius: 0; }
  .cover-face { border-radius: 0; }
  .diary-flow { columns: 1; }
  .page-title { font-size: 20px; }
  .flow-text { font-size: 15.5px; line-height: 1.95; }
  .photo-card img { max-height: none; }
  .sheet-state { min-height: 60dvh; }
  .diary-history { width: 88vw; }
}
</style>
