import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

/**
 * 《邻舍日报》未读状态（唯一来源）
 *
 * 报纸每天清晨由后端印出，前端「未读」＝ 今天已有报纸 && 这一期还没被打开看过。
 * 已读日期记在 localStorage，沿用历史键名（升级不丢已读状态）；
 * 未读标志同时驱动网络导航红点、传统报纸页签与日报预览；打开整张报纸后才标记已读。
 */

/** 已读期号日期（YYYY-MM-DD）：与历史版本同键，不要改 */
const READ_KEY = 'linshe.newspaper.last_read'
/** 报纸一天一期，60s 一次足以在印出后亮起点（与 mailbox store 同频） */
const POLL_INTERVAL_MS = 60000

function readStoredDate() {
  try {
    return localStorage.getItem(READ_KEY) || ''
  } catch {
    return '' // 隐私模式 / 无 localStorage 环境静默
  }
}

function writeStoredDate(date) {
  try {
    localStorage.setItem(READ_KEY, date)
  } catch { /* 隐私模式静默 */ }
}

export const useNewspaperStore = defineStore('newspaper', () => {
  const todayPaper = ref(null)
  const lastReadDate = ref(readStoredDate())
  const loading = ref(false)

  let pollTimer = null
  let _pollingRefs = 0

  /** 今天的报纸已印出、且这一期没看过 */
  const unread = computed(() => {
    const date = todayPaper.value?.publish_date
    return Boolean(date) && date !== lastReadDate.value
  })

  async function fetchToday() {
    loading.value = true
    try {
      const data = await api.getTodayNewspaper()
      todayPaper.value = data?.newspaper || null
    } catch (err) {
      console.error('[newspaper] fetchToday error:', err)
    } finally {
      loading.value = false
    }
    return todayPaper.value
  }

  /** 打开看过即消红点（同一期内不再提醒；配图补印不重新点亮） */
  function markRead(paper) {
    const target = paper || todayPaper.value
    const date = target?.publish_date
    if (!date) return
    // 传进来的就是刚看过的那一期，顺手对齐本地缓存：
    // 跨天时轮询还没带回新一期，旧数据会让红点读完还亮着
    todayPaper.value = target
    if (date === lastReadDate.value) return
    lastReadDate.value = date
    writeStoredDate(date)
  }

  function startPolling() {
    _pollingRefs++
    if (_pollingRefs > 1) return
    fetchToday()
    pollTimer = setInterval(fetchToday, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    _pollingRefs = Math.max(0, _pollingRefs - 1)
    if (_pollingRefs > 0) return
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return {
    todayPaper, lastReadDate, loading, unread,
    fetchToday, markRead, startPolling, stopPolling,
  }
})
