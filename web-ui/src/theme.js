// 主题定义与应用。主题变量组在 App.vue 的 :root / [data-theme] 中。
// 本模块保持无依赖（不引 pinia），供 main.js 在挂载前同步应用主题，避免首帧闪烁。
export const THEME_STORAGE_KEY = 'linshe_theme'

export const THEMES = [
  {
    id: 'violet',
    name: '晴紫',
    desc: '蓝紫×橙红拼色',
    swatches: ['#6c5ce7', '#a35df0', '#ff7a5c', '#f3f2fb'],
  },
  {
    id: 'sunset',
    name: '暖阳',
    desc: '亮橙红主导',
    swatches: ['#ff6f52', '#ff8a5c', '#f0508a', '#fbf3ee'],
  },
  {
    id: 'ocean',
    name: '海盐',
    desc: '蓝青×暖橙',
    swatches: ['#4a90e8', '#5f7bf0', '#ffa94d', '#eef4fb'],
  },
  {
    id: 'sakura',
    name: '蜜桃',
    desc: '粉紫×莓果',
    swatches: ['#ef6f9f', '#d66fd0', '#8b6cf0', '#fbf0f5'],
  },
]

export function isValidTheme(id) {
  return THEMES.some(t => t.id === id)
}

export function getSavedTheme() {
  try {
    const id = localStorage.getItem(THEME_STORAGE_KEY)
    return isValidTheme(id) ? id : 'violet'
  } catch {
    return 'violet'
  }
}

export function applyTheme(id) {
  if (!isValidTheme(id)) id = 'violet'
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(THEME_STORAGE_KEY, id) } catch { /* 隐私模式等场景忽略 */ }
}

// 应用启动时调用：应用本地保存的主题
export function initTheme() {
  applyTheme(getSavedTheme())
}
