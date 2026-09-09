// 主题定义与应用。主题变量组在 styles/tokens.css 的 :root / [data-theme] 中。
// 本模块保持无依赖（不引 pinia），供 main.js 在挂载前同步应用主题，避免首帧闪烁。
export const THEME_MODE_STORAGE_KEY = 'linshe_theme_mode'
// 旧版主题键保留兼容：新的选择统一走 THEME_MODE_STORAGE_KEY。
export const THEME_STORAGE_KEY = 'linshe_theme'

export const THEME_MODES = [
  { id: 'warm', name: '暖色' },
  { id: 'dark', name: '暗夜' },
  { id: 'auto', name: '按时间' },
]

export const THEMES = [
  {
    id: 'warm',
    name: '暖色',
    desc: '珊瑚暖纸，默认配色',
    swatches: ['#e07b6c', '#f0a89a', '#f0ece8', '#ffffff'],
  },
  {
    id: 'dark',
    name: '暗夜',
    desc: '深色玻璃，夜间低亮度',
    swatches: ['#ff7a64', '#ffa58f', '#221e28', '#16131a'],
  },
]

const NIGHT_START_HOUR = 18
const NIGHT_END_HOUR = 6

export function isValidTheme(id) {
  return THEMES.some(t => t.id === id)
}

export function isValidThemeMode(mode) {
  return THEME_MODES.some(m => m.id === mode)
}

export function resolveThemeByTime(hour = new Date().getHours()) {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR ? 'dark' : 'warm'
}

export function getSavedThemeMode() {
  try {
    const mode = localStorage.getItem(THEME_MODE_STORAGE_KEY)
    return isValidThemeMode(mode) ? mode : 'warm'
  } catch {
    return 'warm'
  }
}

export function getSavedTheme() {
  const mode = getSavedThemeMode()
  return mode === 'auto' ? resolveThemeByTime() : mode
}

export function applyTheme(id) {
  if (!isValidTheme(id)) id = 'warm'
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(THEME_STORAGE_KEY, id) } catch { /* 隐私模式等场景忽略 */ }
}

// 应用主题模式：暖色 / 暗夜 / 按时间（auto 由当前本地时间决定实际主题）
export function applyThemeMode(mode) {
  if (!isValidThemeMode(mode)) mode = 'warm'
  try { localStorage.setItem(THEME_MODE_STORAGE_KEY, mode) } catch { /* 隐私模式等场景忽略 */ }
  applyTheme(mode === 'auto' ? resolveThemeByTime() : mode)
}

// 应用启动时调用：应用本地保存的主题模式
export function initTheme() {
  applyThemeMode(getSavedThemeMode())
}
