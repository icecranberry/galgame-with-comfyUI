import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'

export const useSettingsStore = defineStore('settings', () => {
  const comfyWidth = ref(1600)
  const comfyHeight = ref(1200)
  const eventWidth = ref(1600)
  const eventHeight = ref(1200)
  const imageGenMode = ref('smart') // 'off' | 'smart' | 'force'
  const realtimeAffinityDisplay = ref(false)
  const hasApiKey = ref(true) // 默认 true，避免闪红；onMounted 后修正
  const weatherCity = ref('')
  let loaded = false

  // ── localStorage 迁移：旧版存在 localStorage，新版存 DB ──
  const legacyForceImageGen = localStorage.getItem('forceImageGen')
  if (legacyForceImageGen !== null) {
    imageGenMode.value = legacyForceImageGen === 'true' ? 'force' : 'smart'
    localStorage.removeItem('forceImageGen')
    // 异步持久化到后端（fire-and-forget）
    api.updateFeatureFlag('imageGenMode', imageGenMode.value).catch(() => {})
  }

  async function loadComfyConfig() {
    if (loaded) return
    try {
      const data = await api.getConfig()
      comfyWidth.value = data.comfy?.width || 1600
      comfyHeight.value = data.comfy?.height || 1200
      eventWidth.value = data.comfy?.eventWidth || 1600
      eventHeight.value = data.comfy?.eventHeight || 1200
      if (data.features?.imageGenMode !== undefined) {
        imageGenMode.value = data.features.imageGenMode
      } else if (data.features?.forceImageGen !== undefined) {
        imageGenMode.value = data.features.forceImageGen ? 'force' : 'smart'
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
   * 切换配图模式：'off'（关闭）/ 'smart'（灵性判断）/ 'force'（强制生图）
   */
  async function setImageGenMode(mode) {
    if (!['off', 'smart', 'force'].includes(mode)) return
    imageGenMode.value = mode
    await api.updateFeatureFlag('imageGenMode', mode)
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

  return { comfyWidth, comfyHeight, eventWidth, eventHeight, imageGenMode, realtimeAffinityDisplay, hasApiKey, weatherCity, loadComfyConfig, setComfySize, setEventSize, setImageGenMode, setRealtimeAffinityDisplay, setHasApiKey, setWeatherCity }
})
