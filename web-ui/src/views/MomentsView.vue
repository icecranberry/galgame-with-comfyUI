<template>
  <div class="moments-view">
    <!-- 顶栏 -->
    <div class="moments-header" :class="{ 'header-hidden': !headerVisible }">
      <span class="moments-title" @click="isMobile && toggleMobileSidebar()" :class="{ 'is-clickable': isMobile }">朋友圈</span>
      <button class="btn-post" @click="showPicker = !showPicker" :disabled="genPending">
        {{ genPending ? '扰动中...' : '💫扰动世界线' }}
      </button>
    </div>

    <!-- 角色选择器 -->
    <Transition name="picker-fade">
      <div v-if="showPicker" class="picker-dropdown">
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

      <!-- 帖子列表 -->
      <TransitionGroup name="post-enter" tag="div" class="moments-list">
        <MomentCard
          v-for="post in moments.visiblePosts"
          :key="post.id"
          :post="post"
          @preview="onPreview"
        />
      </TransitionGroup>

      <!-- 加载更多 -->
      <div v-if="moments.loading" class="load-more">加载中...</div>
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import { useMomentsStore } from '../stores/moments.js'
import { useChatStore } from '../stores/chat.js'
import { loadUserConfig } from '../userConfig.js'
import MomentCard from '../components/MomentCard.vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'

const moments = useMomentsStore()
const chat = useChatStore()
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')

const showPicker = ref(false)
const genPending = ref(false)
const previewImage = ref(null)
const scrollContainer = ref(null)

const characters = computed(() => chat.characters)

function onPreview({ images, index }) {
  previewImage.value = images[index]
}

onMounted(async () => {
  await chat.loadCharacters()
  await loadUserConfig()
  await moments.loadPosts()
})

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
  padding: 8px 18px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--accent);
  color: #fff;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-post:hover:not(:disabled) { background: var(--accent-hover); box-shadow: 0 2px 12px rgba(224, 123, 108, 0.25); }
.btn-post:disabled { opacity: 0.5; cursor: not-allowed; }

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
  max-height: 320px;
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
  .picker-dropdown { right: 12px; }
}
</style>
