import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'
import { readMediaSeen, markMediaSeen } from '../utils/mediaCategoryEntry.js'

export const useMediaStore = defineStore('media', () => {
  const seen = ref(readMediaSeen())
  const categories = ref({ digital: { count: 0 }, social: { count: 0 } })
  const newPostCount = computed(() => categories.value.digital.count + categories.value.social.count)
  const refreshSignal = ref(0)
  function requestRefresh() { refreshSignal.value++ }
  let revision = 0
  let pending = null
  let timer = null
  let subscriptions = []

  // 请求串行合并；查询中收到新帖/已读变化时丢弃旧结果，再补一次。
  function refreshUnreadCount() {
    revision++
    if (pending) return pending
    pending = (async () => {
      let version
      do {
        version = revision
        try {
          const data = await api.getMediaUnread(seen.value)
          if (version === revision) categories.value = data.categories
        } catch { /* 暂时离线时保留计数，重连/回到前台时补齐 */ }
      } while (version !== revision)
    })().finally(() => { pending = null })
    return pending
  }

  function scheduleRefresh() {
    clearTimeout(timer)
    timer = setTimeout(refreshUnreadCount, 150)
  }

  function markSeen(category, latestId) {
    seen.value = markMediaSeen(seen.value, category, latestId)
    return refreshUnreadCount()
  }

  function syncStorage(event) {
    if (event && event.key !== null && event.key !== 'linshe.media.last_seen') return
    const stored = readMediaSeen()
    for (const key of ['digital', 'social']) seen.value[key] = Math.max(seen.value[key], stored[key])
    scheduleRefresh()
  }

  function onVisible() {
    if (document.visibilityState === 'visible') syncStorage()
  }

  function connectSSE() {
    if (subscriptions.length) return
    subscriptions = [
      onEvent('media_new_posts', scheduleRefresh),
      onEvent('media_post_deleted', scheduleRefresh),
      onEvent('connected', scheduleRefresh),
    ]
    window.addEventListener('storage', syncStorage)
    document.addEventListener('visibilitychange', onVisible)
    scheduleRefresh()
  }

  function disconnectSSE() {
    subscriptions.forEach(unsubscribe => unsubscribe())
    subscriptions = []
    clearTimeout(timer)
    window.removeEventListener('storage', syncStorage)
    document.removeEventListener('visibilitychange', onVisible)
  }

  return { categories, newPostCount, refreshSignal, requestRefresh, refreshUnreadCount, markSeen, connectSSE, disconnectSSE }
})
