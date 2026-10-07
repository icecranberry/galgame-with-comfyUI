/**
 * 角色日记 store —— 全屏日记本的唯一状态源。
 *
 * 日记本宿主挂在 App.vue（全局），所以日程页的角色卡片 / 详情抽屉 / 右下角生成提示
 * 都能打开同一本书：openBook({ characterId, date }) 即可。
 *
 * 生成在后台跑（后端 diaryGenerator），本 store 只负责：
 *   1. 拉取某一角色某一天的日记与历史简目；
 *   2. 订阅 diary_* SSE 事件，把「生成中 → 正文就绪 → 配图就绪 / 失败」同步进书里。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'
import { playPageFlipSound, preparePageFlipSound } from '../utils/pageFlipSound.js'

/** 本地日期键 YYYY-MM-DD（与后端 getLocalDateKey 同口径：宿主本地时区） */
export function todayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const useDiaryStore = defineStore('diary', () => {  // ── 书本开关与当前角色 ──
  const open = ref(false)
  const characterId = ref(null)
  const characterName = ref('')
  const characterAvatar = ref('')

  // ── 当前这一页 ──
  const date = ref(todayKey())
  const diary = ref(null)
  const generating = ref(false)
  const loading = ref(false)
  const error = ref('')

  // ── 历史日记简目 ──
  const history = ref([])
  const historyOpen = ref(false)
  const historyLoading = ref(false)

  // ── 翻页动画方向：1 = 往后翻（更早的日记），-1 = 往前翻 ──
  const flipDirection = ref(1)
  const flipping = ref(false)

  let _unsubs = []
  let _connected = false
  let bookRequest = 0

  const isToday = computed(() => date.value === todayKey())
  const hasDiary = computed(() => Boolean(diary.value && diary.value.content))
  const images = computed(() => (Array.isArray(diary.value?.images) ? diary.value.images : []))
  const canGenerate = computed(() => isToday.value && !generating.value)
  /** 历史简目里位于当前页之后（更早）的一篇 */
  const olderEntry = computed(() => history.value.find(e => e.date < date.value) || null)
  const newerEntry = computed(() => [...history.value].reverse().find(e => e.date > date.value) || null)

  function _matchesEvent(payload) {
    if (!payload || Number(payload.character_id) !== Number(characterId.value)) return false
    // 事件只针对「今天」；当前页不在今天时不打断浏览
    return payload.date === date.value
  }

  function _applyPayload(payload) {
    if (payload?.diary) diary.value = payload.diary
  }

  function connect() {
    if (_connected) return
    _connected = true
    _unsubs = [
      onEvent('diary_start', (d) => {
        generating.value = true
        error.value = ''
        if (_matchesEvent(d)) loadDiary(date.value, { silent: true })
        else if (Number(d?.character_id) === Number(characterId.value) && d.date === todayKey() && !historyOpen.value) loadHistory({ silent: true })
      }),
      onEvent('diary_progress', () => { /* 进度由右下角生成提示承担 */ }),
      onEvent('diary_text_ready', (d) => {
        if (_matchesEvent(d)) _applyPayload(d)
      }),
      onEvent('diary_done', (d) => {
        generating.value = false
        if (_matchesEvent(d)) _applyPayload(d)
        if (Number(d?.character_id) === Number(characterId.value)) loadHistory({ silent: true })
      }),
      onEvent('diary_error', (d) => {
        generating.value = false
        if (_matchesEvent(d)) {
          error.value = d.error || '日记生成失败'
          loadDiary(date.value, { silent: true })
        }
      }),
    ]
  }

  function disconnect() {
    for (const un of _unsubs) un()
    _unsubs = []
    _connected = false
  }

  async function loadDiary(targetDate, { silent = false } = {}) {
    if (!characterId.value) return
    const requestedCharacter = characterId.value
    const requestedBook = bookRequest
    if (!silent) loading.value = true
    try {
      const res = await api.getDiary(characterId.value, targetDate)
      if (targetDate !== date.value || requestedCharacter !== characterId.value || requestedBook !== bookRequest) return
      diary.value = res?.diary || null
      generating.value = Boolean(res?.generating)
      error.value = res?.diary?.status === 'failed' ? (res.diary.error || '') : ''
      return diary.value
    } catch (err) {
      if (!silent) error.value = err.message || '日记加载失败'
      console.error('[diary] load failed:', err.message)
    } finally {
      if (!silent) loading.value = false
    }
  }

  async function loadHistory({ silent = false } = {}) {
    if (!characterId.value) return
    if (!silent) historyLoading.value = true
    try {
      const res = await api.listDiaries(characterId.value)
      history.value = res?.diaries || []
    } catch (err) {
      console.error('[diary] history failed:', err.message)
    } finally {
      if (!silent) historyLoading.value = false
    }
  }

  /** 打开日记本（默认停在今天） */
  async function openBook({ characterId: id, characterName: name = '', characterAvatar: avatar = '', date: targetDate } = {}) {
    if (!id) return
    const request = ++bookRequest
    preparePageFlipSound()
    const switched = Number(id) !== Number(characterId.value)
    characterId.value = Number(id)
    if (name) characterName.value = name
    if (avatar !== undefined) characterAvatar.value = avatar
    if (switched) {
      history.value = []
      diary.value = null
      generating.value = false
      error.value = ''
    }
    open.value = true
    historyOpen.value = false
    date.value = targetDate || todayKey()
    await Promise.all([
      loadDiary(date.value).then(loaded => {
        if (request === bookRequest && open.value && loaded?.content?.trim()) playPageFlipSound()
      }),
      loadHistory({ silent: true }),
    ])
  }

  function closeBook() {
    bookRequest++
    open.value = false
    historyOpen.value = false
  }

  /** 翻到某一篇（历史列表点击 / 前后翻页都用它） */
  async function goTo(targetDate, { direction = 1 } = {}) {
    if (!targetDate || targetDate === date.value) return
    bookRequest++
    playPageFlipSound()
    flipDirection.value = direction < 0 ? -1 : 1
    flipping.value = true
    date.value = targetDate
    await loadDiary(targetDate)
    window.setTimeout(() => { flipping.value = false }, 420)
  }

  function stepOlder() {
    if (olderEntry.value) goTo(olderEntry.value.date, { direction: 1 })
  }

  function stepNewer() {
    if (newerEntry.value) goTo(newerEntry.value.date, { direction: -1 })
  }

  /** 生成 / 重新生成当前这一页（只对今天开放） */
  async function generate() {
    if (!characterId.value || generating.value) return
    if (!isToday.value) return
    generating.value = true
    error.value = ''
    try {
      const res = await api.generateDiary(characterId.value, date.value)
      generating.value = Boolean(res?.generating)
      if (res?.diary) diary.value = res.diary
    } catch (err) {
      generating.value = false
      error.value = err.message || '日记生成启动失败'
      throw err
    }
  }

  /** 直接给某个角色某一天起一次生成（右下角生成提示里的「重试」用，不依赖日记本是否打开） */
  async function generateFor(id, targetDate) {
    return api.generateDiary(id, targetDate)
  }

  return {
    open, characterId, characterName, characterAvatar,
    date, diary, generating, loading, error,
    history, historyOpen, historyLoading,
    flipDirection, flipping,
    isToday, hasDiary, images, canGenerate, olderEntry, newerEntry,
    connect, disconnect,
    openBook, closeBook, goTo, stepOlder, stepNewer,
    loadDiary, loadHistory, generate, generateFor,
  }
})
