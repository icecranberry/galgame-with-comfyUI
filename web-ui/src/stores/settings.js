import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'
import { getSavedTheme, applyTheme } from '../theme.js'

export const useSettingsStore = defineStore('settings', () => {
  const comfyWidth = ref(1600)
  const comfyHeight = ref(1200)
  const eventWidth = ref(1600)
  const eventHeight = ref(1200)
  const imageGenMode = ref('smart') // 'off' | 'smart' | 'force'
  const deepThinkMode = ref(false)  // 私聊深度思考：planner 先规划媒介组合（文字/表情包/图片）再回复
  const realtimeAffinityDisplay = ref(false)
  const hasApiKey = ref(true) // 默认 true，避免闪红；onMounted 后修正
  const weatherCity = ref('')
  const theme = ref(getSavedTheme()) // main.js 已在挂载前应用过，这里只是同步状态
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
      if (data.features?.deepThinkMode !== undefined) {
        deepThinkMode.value = !!data.features.deepThinkMode
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

  /**
   * 切换私聊深度思考模式（planner 预规划）
   */
  async function setDeepThinkMode(v) {
    deepThinkMode.value = !!v
    await api.updateFeatureFlag('deepThinkMode', !!v)
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

  return { comfyWidth, comfyHeight, eventWidth, eventHeight, imageGenMode, deepThinkMode, realtimeAffinityDisplay, hasApiKey, weatherCity, theme, loadComfyConfig, setComfySize, setEventSize, setImageGenMode, setDeepThinkMode, setRealtimeAffinityDisplay, setHasApiKey, setWeatherCity, setTheme }
})
