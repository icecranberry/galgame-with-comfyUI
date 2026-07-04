/**
 * 日程 Store
 *
 * 管理所有角色的日程概览 + 单个角色的详细日程。
 * 支持瞄一眼快照（异步生图 → SSE 推送）。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

export const useScheduleStore = defineStore('schedule', () => {
  // ── 状态 ──
  const characters = ref([])           // 所有角色概览
  const currentSchedule = ref(null)    // 当前展开角色的详细日程
  const loading = ref(false)
  const peekGenerating = ref(false)    // 瞄一眼生图中
  const peekImage = ref(null)          // 快照 base64 结果
  const peekError = ref(null)

  // ── 计算属性 ──
  const sleepingCharacters = computed(() =>
    characters.value.filter(c => c.is_sleeping)
  )

  const delayedCharacters = computed(() =>
    characters.value.filter(c => c.reply_delay > 0 && !c.is_sleeping)
  )

  // ── 方法 ──

  async function fetchOverview(silent = false) {
    if (!silent) loading.value = true
    try {
      const data = await api.getScheduleOverview()
      characters.value = data.characters || []
    } catch (err) {
      console.error('[schedule] fetchOverview failed:', err.message)
    } finally {
      if (!silent) loading.value = false
    }
  }

  async function fetchCharacterSchedule(characterId) {
    const data = await api.getCharacterSchedule(characterId)
    currentSchedule.value = data
    return data
  }

  async function peekSnapshot(characterId) {
    peekGenerating.value = true
    peekImage.value = null
    peekError.value = null

    try {
      // 立即返回活动信息，图片异步通过 SSE 推送
      await api.peekSnapshot(characterId, true)
      // 图片结果将通过 unifiedStream 的 schedule_peek_ready 事件回调处理
    } catch (err) {
      peekError.value = err.message
      console.error('[schedule] peekSnapshot failed:', err.message)
    } finally {
      peekGenerating.value = false
    }
  }

  function setPeekImage(base64) {
    peekImage.value = base64
  }

  function clearPeek() {
    peekImage.value = null
    peekError.value = null
  }

  async function regenerateSchedule(characterId) {
    try {
      const result = await api.regenerateSchedule(characterId)
      // 静默刷新概览（不显示 loading，避免 card-grid 闪烁）
      await Promise.all([
        fetchOverview(true),
        characterId === currentSchedule.value?.character_id
          ? fetchCharacterSchedule(characterId)
          : Promise.resolve(),
      ])
      return result
    } catch (err) {
      console.error('[schedule] regenerateSchedule failed:', err.message)
      throw err
    }
  }

  return {
    characters, currentSchedule, loading,
    peekGenerating, peekImage, peekError,
    sleepingCharacters, delayedCharacters,
    fetchOverview, fetchCharacterSchedule,
    peekSnapshot, setPeekImage, clearPeek,
    regenerateSchedule,
  }
})
