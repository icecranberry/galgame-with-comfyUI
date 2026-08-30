import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'
import { getSavedTheme, applyTheme } from '../theme.js'

export const useSettingsStore = defineStore('settings', () => {
  const comfyWidth = ref(1600)
  const comfyHeight = ref(1200)
  const eventWidth = ref(1600)
  const eventHeight = ref(1200)
  const forceImageGen = ref(false)
  const realtimeAffinityDisplay = ref(false)
  const hasApiKey = ref(true) // 默认 true，避免闪红；onMounted 后修正
  const weatherCity = ref('')
  const theme = ref(getSavedTheme()) // main.js 已在挂载前应用过，这里只是同步状态
  let loaded = false

  // ── localStorage 迁移：旧版存在 localStorage，新版存 DB ──
  const legacyForceImageGen = localStorage.getItem('forceImageGen')
  if (legacyForceImageGen !== null) {
    forceImageGen.value = legacyForceImageGen === 'true'
    localStorage.removeItem('forceImageGen')
    // 异步持久化到后端（fire-and-forget）
    api.updateFeatureFlag('forceImageGen', forceImageGen.value).catch(() => {})
  }

  async function loadComfyConfig() {
    if (loaded) return
    try {
      const data = await api.getConfig()
      comfyWidth.value = data.comfy?.width || 1600
      comfyHeight.value = data.comfy?.height || 1200
      eventWidth.value = data.comfy?.eventWidth || 1600
      eventHeight.value = data.comfy?.eventHeight || 1200
      if (data.features?.forceImageGen !== undefined) {
        forceImageGen.value = data.features.forceImageGen
      }
      if (data.features?.realtimeAffinityDisplay !== undefined) {
        realtimeAffinityDisplay.value = data.features.realtimeAffinityDisplay
      }
      hasApiKey.value = data.llm?.hasApiKey ?? false
      weatherCity.value = data.weather?.city || ''
      loaded = true
    } catch {
      // keep defaults
    }
  }

  /**
   * 由外部调用更新（SettingsView 保存后同步）
   */
  function setComfySize(width, height) {
    comfyWidth.value = width
    comfyHeight.value = height
  }

  function setEventSize(width, height) {
    eventWidth.value = width
    eventHeight.value = height
  }

  /**
   * 切换强制生图开关，持久化到后端
   */
  async function setForceImageGen(v) {
    forceImageGen.value = v
    await api.updateFeatureFlag('forceImageGen', v)
  }

  async function setRealtimeAffinityDisplay(v) {
    realtimeAffinityDisplay.value = v
    await api.updateFeatureFlag('realtimeAffinityDisplay', v)
  }

  function setHasApiKey(v) { hasApiKey.value = v }

  async function setWeatherCity(city) {
    weatherCity.value = city
    await api.updateWeatherCity(city)
  }

  // 切换主题：立即应用到 <html data-theme>，持久化在 localStorage（设备级 UI 偏好，不进后端）
  function setTheme(id) {
    theme.value = id
    applyTheme(id)
  }

  return { comfyWidth, comfyHeight, eventWidth, eventHeight, forceImageGen, realtimeAffinityDisplay, hasApiKey, weatherCity, theme, loadComfyConfig, setComfySize, setEventSize, setForceImageGen, setRealtimeAffinityDisplay, setHasApiKey, setWeatherCity, setTheme }
})
