// 主题定义与应用。主题变量组在 styles/tokens.css 的 :root / [data-theme] 中。
// 本模块保持无依赖（不引 pinia），供 main.js 在挂载前同步应用主题，避免首帧闪烁。
export const THEME_MODE_STORAGE_KEY = 'linshe_theme_mode'
// 旧版主题键保留兼容：新的选择统一走 THEME_MODE_STORAGE_KEY。
// （它只写不读 —— 读的永远是「模式」，再由模式解析出实际主题，这样跟随系统/按时间才能重新解析。）
export const THEME_STORAGE_KEY = 'linshe_theme'

/**
 * 主题**模式**（用户的选择）。实际生效的主题由 resolveThemeByMode() 解析：
 *   warm   暖色      —— 固定浅色
 *   dark   暗夜      —— 固定深色
 *   system 跟随系统  —— 读 prefers-color-scheme，系统深色用「暗夜」、浅色用「暖色」
 *   auto   按时间    —— 18:00~06:00 用「暗夜」，其余用「暖色」
 *
 * ★ 这是模式的**唯一真源**。新增模式只需在这里加一项，
 *   校验（isValidThemeMode）、设置页选项、状态解析全都会自动跟上 ——
 *   别在别处（store / 页面）再写一份 id 白名单数组：
 *   历史上「白名单漏项」已经连踩两次（路由白名单漏 print → category 变 null），
 *   症状是**点击毫无反应**，最难查。
 */
export const THEME_MODES = [
  { id: 'warm', name: '暖色' },
  { id: 'dark', name: '暗夜' },
  { id: 'system', name: '跟随系统' },
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

/** 跟随系统用的媒体查询：系统偏好深色 */
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

export function isValidTheme(id) {
  return THEMES.some(t => t.id === id)
}

export function isValidThemeMode(mode) {
  return THEME_MODES.some(m => m.id === mode)
}

export function resolveThemeByTime(hour = new Date().getHours()) {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR ? 'dark' : 'warm'
}

/** 系统偏好查询对象；无 matchMedia 的环境（极老浏览器）返回 null */
function getSystemDarkMedia() {
  try {
    const mm = globalThis.matchMedia
    return typeof mm === 'function' ? mm(SYSTEM_DARK_QUERY) : null
  } catch {
    return null
  }
}

/**
 * 跟随系统：系统深色 → 暗夜，系统浅色 → 暖色。
 * 本 app 的「浅色」就是暖色（珊瑚暖纸），没有第三个中性浅色主题，所以是一对一映射。
 * 取不到系统偏好时回退 **暖色**（app 的默认主题），而不是按时间猜。
 */
export function resolveThemeBySystem() {
  const mq = getSystemDarkMedia()
  return mq && mq.matches ? 'dark' : 'warm'
}

/**
 * 把「模式」解析成实际生效的主题 id（总是 'warm' | 'dark'）。
 * 未知模式回退暖色 —— 与 getSavedThemeMode() 的兜底一致。
 */
export function resolveThemeByMode(mode) {
  if (mode === 'auto') return resolveThemeByTime()
  if (mode === 'system') return resolveThemeBySystem()
  return isValidTheme(mode) ? mode : 'warm'
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
  return resolveThemeByMode(getSavedThemeMode())
}

/** 把主题写到 <html data-theme>（tokens.css 据此选变量组），返回实际应用的主题 id */
export function applyTheme(id) {
  if (!isValidTheme(id)) id = 'warm'
  currentTheme = id
  try {
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = id
  } catch { /* 无 DOM 环境（单测等）忽略 */ }
  try { localStorage.setItem(THEME_STORAGE_KEY, id) } catch { /* 隐私模式等场景忽略 */ }
  return id
}

// ── 模块内状态 ──
// 当前模式 / 当前实际主题：给系统监听器判断「现在该不该跟随」用。
let currentMode = null
let currentTheme = null
// 记的是「已绑定的那个 media 对象」而不是一个布尔标志 ——
// 布尔标志在 matchMedia 返回新对象时会误判为"已绑"（单测里每次重建替身就踩到），
// 按对象判等则该重绑就重绑，浏览器里同一 query 返回同一对象、不会重复绑定。
let boundSystemMedia = null
const systemThemeListeners = new Set()

/**
 * 绑定系统深浅色监听（同一个 media 对象只绑一次，与当前模式无关）。
 * 监听器常驻、但只在 mode === 'system' 时生效 —— 这样切模式不必反复解绑/重绑，
 * 也不会因为漏解绑而堆积监听器。
 */
function ensureSystemWatcher() {
  const mq = getSystemDarkMedia()
  if (!mq) return
  if (boundSystemMedia === mq) return
  const onChange = () => {
    if (currentMode !== 'system') return
    const t = applyTheme(resolveThemeBySystem())
    systemThemeListeners.forEach(fn => {
      try { fn(t) } catch { /* 订阅方异常不该影响主题本身 */ }
    })
  }
  try {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else if (typeof mq.addListener === 'function') mq.addListener(onChange)   // 老 Safari
    else return
  } catch {
    return
  }
  boundSystemMedia = mq
}

/**
 * 订阅「系统深浅色变化导致主题切换」。返回退订函数。
 * 只有 mode === 'system' 时才会被回调；调用方（settings store）用它同步响应式状态，
 * 这样 UI 里读 settingsStore.theme 的地方也会跟着系统变。
 */
export function onSystemThemeChange(fn) {
  if (typeof fn !== 'function') return () => {}
  systemThemeListeners.add(fn)
  return () => systemThemeListeners.delete(fn)
}

/**
 * 应用主题模式：暖色 / 暗夜 / 跟随系统 / 按时间。
 * 返回**实际生效的主题 id**（调用方据此同步自己的状态，不必各自再解析一遍）。
 */
export function applyThemeMode(mode) {
  if (!isValidThemeMode(mode)) mode = 'warm'
  currentMode = mode
  try { localStorage.setItem(THEME_MODE_STORAGE_KEY, mode) } catch { /* 隐私模式等场景忽略 */ }
  ensureSystemWatcher()
  return applyTheme(resolveThemeByMode(mode))
}

/** 当前实际生效的主题（'warm' | 'dark'），未初始化时为 null */
export function getCurrentTheme() {
  return currentTheme
}

/** 当前主题模式，未初始化时为 null */
export function getCurrentThemeMode() {
  return currentMode
}

// 应用启动时调用：应用本地保存的主题模式
export function initTheme() {
  return applyThemeMode(getSavedThemeMode())
}
