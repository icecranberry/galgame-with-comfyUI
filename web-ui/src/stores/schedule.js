/**
 * 日程 Store
 *
 * 管理所有角色的日程概览 + 单个角色的详细日程。
 * 支持瞄一眼快照（异步生图 → SSE 推送）。
 * 管理「重置世界线」任务状态（含后台静默运行 + 页面刷新恢复）。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

export const useScheduleStore = defineStore('schedule', () => {
  // ── 状态 ──
  const characters = ref([])           // 所有角色概览
  const currentSchedule = ref(null)    // 当前展开角色的详细日程
  const loading = ref(false)
  const peekGenerating = ref(false)    // 瞄一眼生图中
  const peekImage = ref(null)          // 快照 base64 结果
  const peekError = ref(null)

  // ── 重置世界线状态（store 级，跨页面持久）──
  const resetTask = ref(null) // { phase, current, total, currentName, errors, processing, backgrounded }

  // ── 计算属性 ──
  const sleepingCharacters = computed(() =>
    characters.value.filter(c => c.is_sleeping)
  )

  const delayedCharacters = computed(() =>
    characters.value.filter(c => c.reply_delay > 0 && !c.is_sleeping)
  )

  // ── 重置世界线方法 ──

  /** 启动重置任务（调用 API 后调用） */
  function startResetTask(total) {
    resetTask.value = {
      phase: 'running',
      current: 0,
      total,
      currentName: '',
      errors: [],
      processing: true,
      backgrounded: false,
    }
  }

  /** 切换到后台静默运行（关闭弹窗但不取消任务） */
  function backgroundResetTask() {
    if (resetTask.value) {
      resetTask.value.backgrounded = true
    }
  }

  /** 从后台恢复显示（重新打开弹窗） */
  function showResetTask() {
    if (resetTask.value) {
      resetTask.value.backgrounded = false
    }
  }

  /** 完成/关闭重置任务 */
  function finishResetTask() {
    resetTask.value = null
  }

  // ── 持久 SSE 监听（store 初始化时注册，不受页面切换影响）──
  onEvent('schedule_reset_progress', (data) => {
    if (!resetTask.value) return

    if (data.phase === 'running') {
      resetTask.value.phase = 'running'
      resetTask.value.current = data.current || 0
      resetTask.value.total = data.total || resetTask.value.total
      resetTask.value.currentName = data.character_name || ''
      resetTask.value.processing = true
      if (data.status === 'error' && data.character_name) {
        resetTask.value.errors.push({ name: data.character_name, error: data.error || '未知错误' })
      }
    } else if (data.phase === 'complete' || data.phase === 'cancelled') {
      resetTask.value.phase = data.phase
      resetTask.value.current = data.current || resetTask.value.current
      resetTask.value.processing = false
      resetTask.value.backgrounded = false
      // 静默刷新概览（不触发 loading，避免 card-grid 闪烁）
      fetchOverview(true)
    } else if (data.phase === 'error') {
      resetTask.value.phase = 'cancelled'
      resetTask.value.processing = false
      resetTask.value.backgrounded = false
    }
  })

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
    resetTask,
    startResetTask, backgroundResetTask, showResetTask, finishResetTask,
    fetchOverview, fetchCharacterSchedule,
    peekSnapshot, setPeekImage, clearPeek,
    regenerateSchedule,
  }
})
