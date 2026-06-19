<template>
  <div class="moments-view">
    <!-- 顶栏 -->
    <div class="moments-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <span class="moments-title" @click="isMobile && toggleMobileSidebar()" :class="{ 'is-clickable': isMobile }">朋友圈</span>
      <button class="btn-post" @click.stop="showPicker = !showPicker" :disabled="genPending">
        {{ genPending ? '扰动中' : '🎬 扰动世界线' }}
      </button>
    </div>

    <!-- 角色选择器 -->
    <Transition name="picker-fade">
      <div v-if="showPicker" ref="pickerRef" class="picker-dropdown" @click.stop>
        <div class="picker-title">选择发朋友圈的角色：</div>
        <div
          v-for="c in characters"
          :key="c.id"
          class="picker-item"
          @click="triggerGenerate(c)"
        >
          <div
            class="picker-avatar"
            :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: c.avatar_color || '#e07b6c' }"
          >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
          <span>{{ c.display_name }}</span>
        </div>
      </div>
    </Transition>

    <!-- 内容区 -->
    <div ref="scrollContainer" class="moments-feed" @scroll="onScroll">

      <!-- 角色筛选条 -->
      <div class="moments-filter-bar">
        <div
          ref="filterScrollRef"
          class="filter-scroll"
          @wheel="onFilterWheel"
        >
          <div
            class="filter-avatar filter-all"
            :class="{ active: moments.filterCharacterId === null }"
            @click="moments.setFilter(null)"
          >全部</div>
          <!-- 赞过筛选 -->
          <div
            class="filter-avatar filter-heart"
            :class="{ active: moments.filterLiked }"
            @click="moments.toggleFilterLiked()"
            title="只看赞过的"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" :fill="moments.filterLiked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
          <div
            v-for="ch in moments.charactersWithPosts"
            :key="ch.character_id"
            class="filter-avatar"
            :class="{ active: moments.filterCharacterId === ch.character_id }"
            :style="ch.avatar_path
              ? { backgroundImage: `url(${ch.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' }
              : { background: ch.avatar_color || '#e07b6c' }"
            @click="moments.setFilter(ch.character_id)"
          >{{ ch.avatar_path ? '' : ch.display_name?.charAt(0) || '?' }}</div>
        </div>
      </div>

      <!-- 帖子列表 -->
      <TransitionGroup name="post-enter" tag="div" class="moments-list">
        <MomentCard
          v-for="post in moments.visiblePosts"
          :key="post.id"
          :post="post"
          @preview="onPreview"
          @share="onShare"
        />
      </TransitionGroup>

      <!-- 加载更多 -->
      <div v-if="moments.loading" class="load-more">加载中...</div>
      <div v-else-if="moments.filterLiked && moments.filteredPosts.length === 0 && !moments.loading" class="load-more">— 还没有赞过的帖子 —</div>
      <div v-else-if="!moments.hasMore && moments.posts.length > 0" class="load-more">— 没有更多了 —</div>
    </div>

    <!-- 图片预览 -->
    <VueEasyLightbox
      :visible="!!previewImage"
      :imgs="previewImage"
      :max-zoom="6"
      :min-zoom="0.3"
      :zoom-scale="0.35"
      @hide="previewImage = null"
    />

    <!-- 分享卡片 -->
    <ShareCard
      :post="sharePost"
      :visible="!!sharePost"
      @close="onShareClose"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import { useMomentsStore } from '../stores/moments.js'
import { useChatStore } from '../stores/chat.js'
import { loadUserConfig } from '../userConfig.js'
import MomentCard from '../components/MomentCard.vue'
import ShareCard from '../components/ShareCard.vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'

const moments = useMomentsStore()
const chat = useChatStore()
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')

const showPicker = ref(false)
const pickerRef = ref(null)
const genPending = ref(false)
const previewImage = ref(null)
const sharePost = ref(null)
const scrollContainer = ref(null)
const filterScrollRef = ref(null)

function onFilterWheel(e) {
  const el = filterScrollRef.value
  if (!el) return
  const atLeftEdge = el.scrollLeft <= 0 && e.deltaY < 0
  const atRightEdge = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0
  if (atLeftEdge || atRightEdge) return
  e.preventDefault()
  el.scrollBy({ left: e.deltaY, behavior: 'smooth' })
}

const characters = computed(() => chat.characters)

function onPreview({ images, index }) {
  previewImage.value = images[index]
}

function onShare(post) {
  sharePost.value = post
}

function onShareClose() {
  sharePost.value = null
}

onMounted(async () => {
  moments.isViewingMoments = true
  moments.resetFilters()
  await chat.loadCharacters()
  await loadUserConfig()
  await moments.loadPosts()
  // 显式标记已读：兜底防止 loadPosts 因 loading guard 跳过内部 markSeen
  moments.markSeen()
  // 点击空白关闭选择器
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  moments.isViewingMoments = false
  document.removeEventListener('click', onDocumentClick)
})

function onDocumentClick(e) {
  const picker = pickerRef.value
  if (!picker || !showPicker.value) return
  // 点击在弹窗内部由 @click.stop 阻止冒泡，走到这里的一定是外部点击
  showPicker.value = false
}

// ── 滚动方向感知：下滑隐藏顶栏，上滑显示（仅移动端）──
const headerVisible = ref(true)
let lastScrollTop = 0

// 无限滚动
function onScroll() {
  const el = scrollContainer.value
  if (!el) return

  if (isMobile) {
    const delta = el.scrollTop - lastScrollTop
    if (el.scrollTop > 60 && delta > 8) {
      headerVisible.value = false
    } else if (delta < -4) {
      headerVisible.value = true
    }
    lastScrollTop = el.scrollTop
  }

  const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (distToBottom < 200 && !moments.loading && moments.hasMore) {
    moments.loadMore()
  }
}

async function triggerGenerate(c) {
  showPicker.value = false
  genPending.value = true
  try {
    await moments.generatePost(c.id)
  } catch (err) {
    console.error('[MomentsView] generate error:', err)
  } finally {
    genPending.value = false
  }
}
</script>

<style scoped>
.moments-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: transparent;
  position: relative;
}

/* 顶栏 */
.moments-header {
  padding: 14px 24px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.header-hidden { transform: translateY(-100%); }
.moments-title {
  font-size: 18px; font-weight: 700; color: var(--text-bright);
}
.is-clickable { cursor: pointer; }

.btn-post {
  padding: 8px 22px;
  border-radius: 14px;
  border: 2px solid transparent;
  background: linear-gradient(
    120deg,
    #f8edea 0%,
    #f2eaf4 35%,
    #eaf0f8 65%,
    #f8edea 100%
  );
  background-size: 220% 100%;
  color: #c06a5a;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  letter-spacing: 1px;
  transition:
    border-color 0.35s ease,
    box-shadow 0.35s ease,
    color 0.3s ease;
}

.btn-post:hover:not(:disabled) {
  border: 2px solid rgba(224, 123, 108, 0.55);
  box-shadow: 0 3px 20px rgba(224, 123, 108, 0.10);
  color: #a85545;
  animation: waterflow 1s ease-in-out infinite;
}

@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}

.btn-post:disabled {
  opacity: 0.4; cursor: not-allowed;
}

/* 角色选择器下拉 */
.picker-dropdown {
  position: absolute;
  top: 60px;
  right: 24px;
  z-index: 100;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  padding: 12px;
  min-width: 200px;
  max-height: 448px;
  overflow-y: auto;
}
.picker-title {
  font-size: 12px; color: var(--text-secondary);
  padding: 4px 8px 8px;
}
.picker-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  cursor: pointer;
  font-size: 14px; color: var(--text-primary);
  transition: background 0.15s;
}
.picker-item:hover { background: rgba(224, 123, 108, 0.08); }
.picker-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 14px; font-weight: 700; flex-shrink: 0;
}

.picker-fade-enter-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.picker-fade-leave-active { transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); }
.picker-fade-enter-from, .picker-fade-leave-to { opacity: 0; transform: translateY(-8px); }

/* 内容区 */
.moments-feed {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

/* 筛选条外层：与帖子列表同宽 */
.moments-filter-bar {
  max-width: 600px;
  margin: 0 auto;
  padding: 0 0 14px 0;
}

/* 内层滚动容器：padding 给阴影和缩放留空间，负 margin 保持对齐 */
.filter-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 8px 6px;
  margin: -8px -6px 0;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.filter-scroll::-webkit-scrollbar { display: none; }

/* 所有头像（含「全部」）统一尺寸模型 */
.filter-avatar {
  flex-shrink: 0;
  width: 54px;
  height: 54px;
  box-sizing: border-box;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.55;
  border: 2px solid var(--glass-border);
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  user-select: none;
  background-size: cover;
  background-position: center;
}
.filter-avatar.active {
  opacity: 1;
  border-color: var(--accent);
  transform: scale(1.08);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.25);
}
.filter-avatar:hover:not(.active) {
  opacity: 0.85;
  border-color: var(--text-secondary);
}

/* 「全部」按钮：只覆盖视觉属性，结构尺寸继承 .filter-avatar */
.filter-all {
  background: rgba(255,255,255,0.75);
  color: var(--text-secondary);
  font-size: 12px;
  width: 54px;
  height: 54px;
  font-weight: 600;
  opacity: 0.7;
}
.filter-all.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  opacity: 1;
}

/* 赞过筛选心形按钮 */
.filter-heart {
  background: rgba(255,255,255,0.75);
  color: var(--text-secondary);
  opacity: 0.7;
}
.filter-heart.active {
  background: rgba(255, 77, 79, 0.12);
  color: #ff4d6d;
  border-color: #ff4d6d;
  opacity: 1;
}

.moments-list {
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 卡片插入动画：新卡片从顶部滑入 */
.post-enter-enter-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.post-enter-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.post-enter-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

/* 空态 */
.moments-empty {
  text-align: center;
  padding: 80px 16px;
  color: var(--text-secondary);
}
.empty-icon { font-size: 56px; margin-bottom: 16px; }
.moments-empty p { font-size: 15px; margin-bottom: 6px; }
.empty-hint { font-size: 13px; opacity: 0.7; }
.btn-post-empty {
  margin-top: 16px;
  padding: 10px 24px;
  font-size: 14px;
}

.load-more {
  text-align: center;
  padding: 20px;
  font-size: 13px;
  color: var(--text-secondary);
}

/* 移动端 */
@media (max-width: 767px) {
  .moments-view { position: relative; }
  .moments-header {
    padding: 12px 16px;
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  }
  .moments-feed { padding: 80px 12px 8px; }
  .moments-list { max-width: 100%; }
  .moments-filter-bar { max-width: 100%; padding: 0 0 6px 0; }
  .picker-dropdown { right: 12px; }
}
</style>
