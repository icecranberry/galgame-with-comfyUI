<template>
  <article
    class="status-card"
    :class="{ 'is-diary-revealed': diaryRevealed, 'card-dim': char.is_sleeping && !char.is_temp_woken }"
    @click="$emit('select')"
    @mouseleave="onCardLeave"
  >
    <div
      class="card-inner"
      @mouseenter="(e) => onEnter(e, char._description)"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @pointerdown="revealDiaryEntry"
      @focusin="revealDiaryEntry"
    >
      <!-- 顶部：头像 + 名字 -->
      <div class="card-top">
        <div class="avatar-box">
          <img v-if="char.avatar_path" :src="char.avatar_path" class="avatar-img" alt="" />
          <span v-else class="avatar-text">{{ char.display_name.charAt(0) }}</span>
        </div>
        <div class="name-row">
          <span class="char-name">{{ char.display_name }}</span>
          <span v-if="statusLabel" class="status-badge" :class="badgeClass">{{ statusLabel }}</span>
          <template v-if="!char.is_sleeping && tagList.length > 0">
            <span
              v-for="(tag, i) in displayedTags"
              :key="i"
              class="tag-badge"
              :class="i === 0 ? 'tag-green' : 'tag-orange'"
            >{{ tag }}</span>
          </template>
        </div>
      </div>

      <!-- 中部：地点 + 行为 -->
      <div class="card-mid">
        <div class="info-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          <span>{{ char._location || '未知地点' }}</span>
        </div>
        <div class="info-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <span>{{ char._behavior || '暂无信息' }}</span>
        </div>
      </div>

      <!-- 左上角置顶按钮 -->
      <div
        class="card-pin-btn"
        :class="{ pinned: char.pinned, 'like-burst': pinBursting }"
        role="button"
        tabindex="0"
        :title="char.pinned ? '取消置顶' : '置顶'"
        @click.stop="onPin"
        @keydown.enter.prevent="onPin"
        @keydown.space.prevent="onPin"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" :fill="char.pinned ? 'currentColor' : 'none'" :stroke="char.pinned ? 'none' : 'currentColor'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </div>

      <!-- 右上角相机按钮（有日程才显示） -->
      <div
        v-if="tagList.length"
        class="peek-btn"
        role="button"
        tabindex="0"
        @click.stop="$emit('peek')"
        @keydown.enter.prevent="$emit('peek')"
        @keydown.space.prevent="$emit('peek')"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </div>

      <!-- 睡眠中 → 电话叫醒按钮 -->
      <div
        v-if="char.is_sleeping && !char.is_temp_woken"
        class="wake-btn"
        role="button"
        tabindex="0"
        :class="{ shaking: wakeShaking }"
        :style="{ top: tagList.length ? '56px' : '10px' }"
        @click.stop="onWake"
        @keydown.enter.prevent="onWake"
        @keydown.space.prevent="onWake"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </div>

      <!-- 底部 -->
      <div class="card-foot" v-if="footnote">
        <span>{{ footnote }}</span>
      </div>
    </div>

    <!-- 卡下沿伸出的日记入口：卡片面（.card-inner）之下的兄弟节点，
         z-index:-1 才是真的在卡片后面 —— 见下方样式注释 -->
    <div
      class="card-diary-bar"
      role="button"
      tabindex="0"
      :aria-label="`翻开${char.display_name}的日记本`"
      @click.stop="$emit('diary')"
      @keydown.enter.prevent="$emit('diary')"
      @keydown.space.prevent="$emit('diary')"
    >
      <diary-icon :size="15" :stroke-width="2" />
      <span>日记</span>
    </div>
  </article>

  <!-- Tooltip -->
  <Teleport to="body">
    <div
      v-if="tooltip.show"
      class="hover-tip"
      :class="{ flip: tooltip.flip }"
      :style="tipStyle"
    >
{{ tooltip.text }}
</div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTooltip } from '../composables/useTooltip.js'
import { useBurst } from '../composables/useBurst.js'
import DiaryIcon from './DiaryIcon.vue'

const props = defineProps<{
  char: any
}>()

const emit = defineEmits(['select', 'peek', 'wake', 'pin', 'diary'])

const wakeShaking = ref(false)
const wakeBusy = ref(false)

// 置顶按钮的点击特效：复用 animations.css 的 .like-burst（爱心 pop + 粒子环）。
// 状态卡每张都是独立实例，用单元素形态即可。
const { bursting: pinBursting, burst: burstPin } = useBurst()

function onPin() {
  burstPin()
  emit('pin')
}

function onWake() {
  if (wakeBusy.value) return
  wakeBusy.value = true
  wakeShaking.value = true
  setTimeout(() => {
    wakeShaking.value = false
    wakeBusy.value = false
  }, 1600)
  setTimeout(() => { emit('wake') }, 1000)
}

const { tooltip, tipStyle, onEnter, onMove, onLeave } = useTooltip()

const statusMap: Record<string, { label: string; cls: string }> = {
  sleeping:  { label: '在梦乡',     cls: 'badge-sleep' },
  drowsy:    { label: '迷迷糊糊',   cls: 'badge-drowsy' },
  delayed:   { label: '正忙',       cls: 'badge-busy' },
  available: { label: '',           cls: '' },
  event:     { label: '',           cls: '' },
}

const computedStatus = computed(() => {
  if (props.char.is_sleeping) {
    return props.char.is_temp_woken ? 'drowsy' : 'sleeping'
  }
  if (props.char._hasEvent) return 'event'
  if (props.char.reply_delay > 0) return 'delayed'
  return 'available'
})

const statusLabel = computed(() => statusMap[computedStatus.value]?.label || '')
const badgeClass = computed(() => statusMap[computedStatus.value]?.cls || '')

function normalizeTags(raw) {
  if (Array.isArray(raw)) return raw.map(tag => String(tag).trim()).filter(Boolean)
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) || typeof parsed === 'string') return normalizeTags(parsed)
    } catch {}
    return trimmed.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean)
  }
  return []
}

const tagList = computed(() => normalizeTags(props.char?.tags))
const displayedTags = computed(() => tagList.value.slice(0, 2).reverse())

// 卡底日记入口的显示：桌面靠 :hover，触摸/键盘聚焦靠这个标记（没有 hover 的端也能展开一栏）
const diaryRevealed = ref(false)
function revealDiaryEntry() { diaryRevealed.value = true }
function onCardLeave() {
  onLeave()
  diaryRevealed.value = false
}

const footnote = computed(() => {
  if (props.char.is_sleeping && !props.char.is_temp_woken) {
    return props.char._description || ''
  }
  if (props.char.is_temp_woken) {
    return props.char._description || '被叫醒了...'
  }
  if (props.char._description && props.char._description !== props.char._behavior) {
    return props.char._description
  }
  return ''
})
</script>

<style scoped>
/* 卡片外框：只负责定位与命中，可见的「卡面」在 .card-inner 上。
   这么分是为了让卡下沿伸出的日记入口（.card-diary-bar，z-index:-1）真的画在卡面之后：
   同一层叠上下文里，负 z-index 的子节点画在该上下文自己的背景*之上*、
   但画在 .card-inner（定位元素，z-index:auto → 定位层）之下。 */
.status-card {
  --diary-height: 32px;
  isolation: isolate;
  position: relative; display: flex;
  background: transparent;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.4,0,0.2,1);
}

.status-card:hover { transform: translateY(-2px); }

.card-inner {
  flex: 1; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0;
  position: relative;
  /* 卡面：毛玻璃底 + 1px 描边 + 18px 圆角 */
  /* 实色底托住玻璃色，避免背后的日记条透进卡面。 */
  background: linear-gradient(var(--glass-bg), var(--glass-bg)), var(--bg-primary);
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  box-shadow: var(--glass-shadow);
  transition: border-color 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s cubic-bezier(0.4,0,0.2,1);
}

.status-card:hover .card-inner,
.status-card.is-diary-revealed .card-inner,
.status-card:focus-within .card-inner {
  border-color: var(--border);
  box-shadow: none;   /* 展开时卡面不投影：投影会糊到下面这条上，交界处显出一道深带 */
}

.card-dim { opacity: 0.65; }

/* ── 右上角叫醒按钮 ── */
.wake-btn {
  position: absolute; top: 10px; right: 10px;
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  box-sizing: border-box;
  border: none; background: transparent;
  color: var(--text-secondary); cursor: pointer; user-select: none;
  transition: all 0.2s;
  opacity: 0;
  padding: 7px 12px;
}
.status-card:hover .wake-btn { opacity: 1; }
.wake-btn:hover {
  background: rgba(var(--accent-rgb),0.08);
  color: var(--accent);
}
.wake-btn.shaking {
  animation: phone-shake 0.4s ease-in-out 2;
}
@keyframes phone-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-4px) rotate(-2deg); }
  30% { transform: translateX(4px) rotate(2deg); }
  45% { transform: translateX(-3px) rotate(-1deg); }
  60% { transform: translateX(3px) rotate(1deg); }
  75% { transform: translateX(-1px); }
}

/* ── 右上角相机按钮 ── */
.peek-btn {
  position: absolute; top: 10px; right: 10px;
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  box-sizing: border-box;
  border: none; background: transparent;
  color: var(--text-secondary); cursor: pointer; user-select: none;
  transition: all 0.2s;
  opacity: 0;
  padding: 7px 12px;
}
.status-card:hover .peek-btn { opacity: 1; }
.peek-btn:hover {
  background: rgba(var(--accent-rgb),0.08);
  color: var(--accent);
}

/* ── 卡下沿伸出的日记入口 ──
   顶边插进卡片里面（比卡片底边高一个圆角半径），所以卡片两个底角被圆角让出来的那块
   由它的身体自然填满，接缝处不留空；层级在卡面之后（z-index:-1），插进去的那截被卡面盖住。
   出现方式：从卡面后方向下滑出；上方始终重叠 18px，填满底部圆角。 */
.card-diary-bar {
  position: absolute;
  top: calc(100% - 18px);
  left: 0; right: 0;
  height: calc(18px + var(--diary-height));
  box-sizing: border-box;
  padding-top: 18px;
  z-index: -1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 0 0 18px 18px;
  border: 1px solid var(--glass-border);
  border-top: none;
  /* 实色（不透明）：半透明会和卡面的毛玻璃在交界处叠出深一层。
     取「卡面玻璃色 × 60% + 页面底色」= 卡面实际呈色的近似值，交界处没有颜色台阶 */
  background: color-mix(in srgb, var(--bg-secondary) 60%, var(--bg-primary));
  color: var(--accent);
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em;
  cursor: pointer; user-select: none;
  /* 投影只压在露出来那截的下沿，别糊到卡面（卡面半透明，会被看穿） */
  box-shadow: 0 20px 16px -18px rgba(70, 52, 44, 0.45);
  transform: translateY(calc(-1 * var(--diary-height)));
  opacity: 0;
  pointer-events: none;
  transition: transform var(--dur-interaction) var(--ease-standard), opacity var(--dur-interaction) var(--ease-standard);
}

/* 展开态：hover（桌面）/ is-diary-revealed（触摸）/ focus-within（键盘）。
   卡片同时抬到同排 / 后排卡片之上，伸出去的部分才不会被下一张卡盖住 */
.status-card:hover,
.status-card.is-diary-revealed,
.status-card:focus-within {
  z-index: 3;
}
.status-card:hover .card-diary-bar,
.status-card.is-diary-revealed .card-diary-bar,
.status-card:focus-within .card-diary-bar {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}
.card-diary-bar:hover { color: var(--accent-hover); }

/* ── 左上角置顶按钮（未置顶时悬停卡片才浮现） ── */.card-pin-btn {
  position: absolute; top: 6px; left: 6px;
  z-index: 1;
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  box-sizing: border-box;
  border: none; background: transparent;
  color: var(--text-secondary); cursor: pointer; user-select: none;
  transition: all 0.2s;
  opacity: 0;
}
.status-card:hover .card-pin-btn { opacity: 0.6; }
.card-pin-btn:hover {
  opacity: 1;
  background: rgba(var(--accent-rgb),0.08);
  color: var(--accent);
}
.card-pin-btn.pinned {
  opacity: 1;
  color: var(--accent);
  background: rgba(var(--accent-rgb),0.1);
}

/* ── Top ── */
.card-top {
  display: flex; align-items: center; gap: 12px;
}

.avatar-box {
  width: 42px; height: 42px;
  background: #e07b6c;
  border-radius: 50%; overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0,0,0,0.06);
  display: flex; align-items: center; justify-content: center;
}
.avatar-img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}
.avatar-text {
  color: #fff; font-size: 18px; font-weight: 600;
  line-height: 1; user-select: none;
}

.name-row {
  display: flex; align-items: center; gap: 8px;
  min-width: 0; flex: 1;
}
.char-name {
  font-size: 0.92rem; font-weight: 600; color: var(--text-bright);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.status-badge {
  font-size: 0.65rem; padding: 2px 8px; border-radius: 999px;
  font-weight: 600; white-space: nowrap; flex-shrink: 0;
}

.badge-busy   { background: rgba(var(--accent-rgb),0.1);  color: #c06858; }
.badge-sleep  { background: rgba(149,128,204,0.1);  color: #7c6db8; }
.badge-drowsy { background: rgba(140,160,190,0.1);  color: #6d84a8; }

.tag-badge {
  font-size: 0.65rem; padding: 2px 8px; border-radius: 999px;
  font-weight: 600; white-space: nowrap; flex-shrink: 0;
}
.tag-green  { background: rgba(82,196,26,0.1);  color: #389e0d; }
.tag-orange { background: rgba(250,173,20,0.1); color: #d48806; }
.tag-overflow { background: rgba(0,0,0,0.04); color: var(--text-secondary); }

/* ── Mid ── */
.card-mid {
  display: flex; flex-direction: column; gap: 5px;
}
.info-line {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.82rem; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.info-line svg { flex-shrink: 0; opacity: 0.4; color: var(--text-secondary); }

/* ── Foot ── */
.card-foot {
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 0.73rem; color: #c5bfb6; line-height: 1.5;
}

/* ── Tooltip ── */
.hover-tip {
  position: fixed; z-index: 2000; pointer-events: none;
  max-width: 260px; padding: 6px 12px;
  background: rgba(40,40,40,0.88); color: #f0f0f0;
  border-radius: 8px; font-size: 0.78rem; line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  backdrop-filter: blur(6px);
}

/* 手机端从详情抽屉进入日记，不显示卡片下沿入口。 */
@media (max-width: 767px) {
  .card-diary-bar { display: none; }
}
</style>
