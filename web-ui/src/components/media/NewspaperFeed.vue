<template>
  <div class="newspaper-feed" :aria-busy="loading">
    <TransitionGroup name="edition" tag="div">
      <NewspaperPreview
        v-for="paper in displayedPapers"
        :key="paper.publish_date"
        :paper="paper"
        :unread="unread && paper.publish_date === todayPaper?.publish_date"
        @open="emit('open', paper)"
      />
    </TransitionGroup>
    <NewspaperPreview v-if="empty && !loading && !error" @open="emit('open', null)" />
    <div ref="sentinel" class="edition-status" role="status" aria-live="polite">
      <span v-if="loading">正在翻找{{ initialized ? '更早的' : '最近的' }}报纸…</span>
      <template v-else-if="error">
        <span>{{ error }}</span>
        <media-game-button size="sm" @click="loadMore">重新加载</media-game-button>
      </template>
      <span v-else-if="!hasMore && !empty">已翻到最早一期 · 故事仍在继续</span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NewspaperPreview from './NewspaperPreview.vue'
import MediaGameButton from './MediaGameButton.vue'
import { useNewspaperFeed } from '../../composables/useNewspaperFeed.js'

const props = defineProps({
  todayPaper: { type: Object, default: null },
  unread: Boolean,
  refreshKey: { type: Number, default: 0 },
})
const emit = defineEmits(['open'])
const { papers, loading, error, initialized, hasMore, empty, loadMore, refresh, dispose } = useNewspaperFeed()
const sentinel = ref(null)
let observer
// 当期补图后直接更新已有预览，不重新请求已加载的往期。
const displayedPapers = computed(() => papers.value.map(paper =>
  paper.publish_date === props.todayPaper?.publish_date ? props.todayPaper : paper))

async function observeBottom() {
  await nextTick()
  if (!sentinel.value || !observer) return
  observer.disconnect()
  observer.observe(sentinel.value)
}

onMounted(() => {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !error.value) loadMore()
  }, { root: sentinel.value.closest('.media-view'), rootMargin: '0px 0px 200px 0px' })
  loadMore()
  observeBottom()
})
// 加载后哨兵仍在视口内时继续补足；错误时停下，允许用户主动重试。
watch(loading, busy => { if (!busy) observeBottom() })
watch(() => props.refreshKey, refresh)
watch(() => props.todayPaper?.publish_date, date => {
  if (date && initialized.value && !papers.value.some(paper => paper.publish_date === date)) refresh()
})
onBeforeUnmount(() => { observer?.disconnect(); dispose() })
</script>

<style scoped>
.edition-status {
  min-height: 80px;
  margin: 0 20px 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}
.edition-enter-active, .edition-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.edition-enter-from, .edition-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
