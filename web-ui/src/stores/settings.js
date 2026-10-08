import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'
import { getSavedTheme, getSavedThemeMode, applyTheme, applyThemeMode, resolveThemeByMode, isValidThemeMode, onSystemThemeChange } from '../theme.js'

// 「跟随系统」的订阅只挂一次 —— setup store 在生产里是单例，但 HMR / 多次 createPinia
// 会让 setup 重跑，不守卫就会往 theme.js 的监听集合里越堆越多。
let systemThemeSubscribed = false

export const useSettingsStore = defineStore('settings', () => {
  const comfyWidth = ref(1600)
  const comfyHeight = ref(1200)
  const eventWidth = ref(1600)
  const eventHeight = ref(1200)
  const imageProvider = ref('comfyui')
  const imageGenMode = ref('smart') // 'off' | 'smart' | 'force'
  const deepThinkMode = ref(false)  // 私聊深度思考：planner 先规划媒介组合（文字/表情包/图片）再回复
  const realtimeAffinityDisplay = ref(false)
  const bgmMuted = ref(false) // 小镇 BGM 静音（system_settings 持久化，loadComfyConfig 后修正）
  const hasApiKey = ref(true) // 默认 true，避免闪红；onMounted 后修正
  const weatherCity = ref('')
  const theme = ref(getSavedTheme()) // main.js 已在挂载前应用过，这里只是同步状态
  const themeMode = ref(getSavedThemeMode()) // 'warm' | 'dark' | 'system' | 'auto'（真源见 theme.js 的 THEME_MODES）
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
      imageProvider.value = data.comfy?.imageProvider === 'novelai' ? 'novelai' : 'comfyui'
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
      if (data.features?.bgmMuted !== undefined) {
        bgmMuted.value = !!data.features.bgmMuted
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

  function setImageProvider(provider) {
    imageProvider.value = provider === 'novelai' ? 'novelai' : 'comfyui'
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

  /** 切换小镇 BGM 静音（只负责状态与持久化，播放/暂停由 TownView 侧响应） */
  async function setBgmMuted(v) {
    bgmMuted.value = !!v
    await api.updateFeatureFlag('bgmMuted', bgmMuted.value)
  }

  function setHasApiKey(v) { hasApiKey.value = v }

  async function setWeatherCity(city) {
    weatherCity.value = city
    await api.updateWeatherCity(city)
  }

  // 切换主题模式：暖色 / 暗夜 / 跟随系统 / 按时间
  // 立即应用到 <html data-theme>，持久化在 localStorage。
  // ★ 合法模式只认 theme.js 的 isValidThemeMode，**不要在这里再写一份 id 数组** ——
  //   那正是「新增模式漏改白名单 → 点击静默失效」的成因（本项目已踩过同类坑）。
  function setThemeMode(mode) {
    if (!isValidThemeMode(mode)) return
    themeMode.value = mode
    // applyThemeMode 返回实际生效的主题（'warm' | 'dark'），不必在外面重算一遍口径
    theme.value = applyThemeMode(mode)
  }

  // 自动模式的重新解析：
  //   auto   → 按时间（由 App.vue 的每分钟定时 + 回到前台触发刷新）
  //   system → 跟随系统（由 theme.js 的 media query 监听立即回调，见下方订阅）
  function refreshTheme() {
    if (themeMode.value !== 'auto' && themeMode.value !== 'system') return
    theme.value = applyTheme(resolveThemeByMode(themeMode.value))
  }

  // 「跟随系统」：用户在系统里切深浅色时**立刻**跟随。
  // 媒体查询监听常驻在 theme.js（非 system 模式不会回调），这里只负责把新主题同步进响应式状态
  // —— 于是每分钟轮询的 refreshTheme 只用来兜「按时间」，系统切换不必等它。
  if (!systemThemeSubscribed) {
    systemThemeSubscribed = true
    onSystemThemeChange((resolved) => { theme.value = resolved })
  }

  return { comfyWidth, comfyHeight, eventWidth, eventHeight, imageProvider, imageGenMode, deepThinkMode, realtimeAffinityDisplay, bgmMuted, hasApiKey, weatherCity, theme, themeMode, loadComfyConfig, setComfySize, setEventSize, setImageProvider, setImageGenMode, setDeepThinkMode, setRealtimeAffinityDisplay, setBgmMuted, setHasApiKey, setWeatherCity, setThemeMode, refreshTheme }
})
