import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  THEME_MODES,
  THEME_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  SYSTEM_DARK_QUERY,
  isValidThemeMode,
  resolveThemeByMode,
  resolveThemeBySystem,
  resolveThemeByTime,
  getSavedThemeMode,
  applyThemeMode,
  onSystemThemeChange,
} from '../src/theme.js'

/**
 * 这组测试守的是一条**踩过的坑**：新增一个主题模式（如 system）时，
 * 某一处还留着旧的 id 白名单数组 —— 症状是「点击毫无反应」（静默 return），最难查。
 * 同源事故：路由白名单漏 `print` → category 变 null → 变成"不过滤"。
 *
 * 所以这里不逐个列举模式名，而是**遍历 THEME_MODES 真源**断言它们处处被认。
 */

/** 最小浏览器环境替身；返回可控的系统深浅色开关 */
function setupEnv(t, { stored = {}, systemDark = false } = {}) {
  const map = new Map(Object.entries(stored))
  const saved = {
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    matchMedia: Object.getOwnPropertyDescriptor(globalThis, 'matchMedia'),
  }

  const mediaListeners = new Set()
  let dark = systemDark
  const mq = {
    media: SYSTEM_DARK_QUERY,
    get matches() { return dark },
    addEventListener: (type, fn) => { if (type === 'change') mediaListeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'change') mediaListeners.delete(fn) },
    addListener: fn => mediaListeners.add(fn),       // 老 Safari 口径
    removeListener: fn => mediaListeners.delete(fn),
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, writable: true,
    value: {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: k => map.delete(k),
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true, writable: true,
    value: { documentElement: { dataset: {} } },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true, writable: true,
    value: q => { assert.equal(q, SYSTEM_DARK_QUERY); return mq },
  })

  t.after(() => {
    for (const [key, original] of Object.entries(saved)) {
      if (original) Object.defineProperty(globalThis, key, original)
      else delete globalThis[key]
    }
  })

  return {
    map,
    /** 模拟用户在系统里切换深浅色 */
    setSystemDark(next) {
      dark = next
      mediaListeners.forEach(fn => fn({ matches: next }))
    },
    hasSystemListener: () => mediaListeners.size > 0,
    appliedTheme: () => globalThis.document.documentElement.dataset.theme,
  }
}

test('每个主题模式都是合法模式，且解析出的实际主题只可能是 warm / dark', () => {
  assert.ok(THEME_MODES.length >= 4, '模式数量异常，真源可能被改动')
  for (const { id } of THEME_MODES) {
    assert.equal(isValidThemeMode(id), true, `THEME_MODES 里的 ${id} 必须是合法模式`)
    const t = resolveThemeByMode(id)
    assert.ok(['warm', 'dark'].includes(t), `${id} 解析出了非法主题 ${t}`)
  }
})

test('applyThemeMode 接受每一个模式（白名单漏项会让它静默回退）', (t) => {
  const env = setupEnv(t)
  for (const { id } of THEME_MODES) {
    env.map.clear()
    applyThemeMode(id)
    // 被拒的模式会被规范化成 warm 再落库；合法模式必须原样存下来
    assert.equal(env.map.get(THEME_MODE_STORAGE_KEY), id, `${id} 被 applyThemeMode 拒绝了（白名单漏项）`)
    assert.ok(['warm', 'dark'].includes(env.appliedTheme()), `${id} 没有把主题写到 <html data-theme>`)
  }
})

test('未知模式回退暖色，不会把非法值写进存储', (t) => {
  const env = setupEnv(t)
  assert.equal(isValidThemeMode('neon'), false)
  assert.equal(applyThemeMode('neon'), 'warm')
  assert.equal(env.appliedTheme(), 'warm')
  assert.equal(env.map.get(THEME_MODE_STORAGE_KEY), 'warm')
})

test('跟随系统：系统深色→暗夜，系统浅色→暖色', (t) => {
  setupEnv(t, { systemDark: true })
  assert.equal(resolveThemeBySystem(), 'dark')
  assert.equal(resolveThemeByMode('system'), 'dark')

  setupEnv(t, { systemDark: false })
  assert.equal(resolveThemeBySystem(), 'warm')
  assert.equal(resolveThemeByMode('system'), 'warm')
})

test('跟随系统：系统切换时立刻跟随，且只回调一次订阅方', (t) => {
  const env = setupEnv(t, { systemDark: false })
  applyThemeMode('system')
  assert.equal(env.hasSystemListener(), true, 'system 模式应挂上系统深浅色监听')

  const seen = []
  const off = onSystemThemeChange(t2 => seen.push(t2))

  env.setSystemDark(true)
  assert.equal(env.appliedTheme(), 'dark', '系统转深色后主题没跟上')
  env.setSystemDark(false)
  assert.equal(env.appliedTheme(), 'warm', '系统转浅色后主题没跟上')
  assert.deepEqual(seen, ['dark', 'warm'])

  off()
  env.setSystemDark(true)
  assert.deepEqual(seen, ['dark', 'warm'], '退订后仍收到回调')
})

test('固定模式与按时间模式不受系统深浅色影响', (t) => {
  const env = setupEnv(t, { systemDark: false })

  for (const fixed of ['warm', 'dark']) {
    applyThemeMode(fixed)
    env.setSystemDark(true)
    assert.equal(env.appliedTheme(), fixed, `${fixed} 模式被系统偏好带跑了`)
  }

  // 按时间：白天暖色 / 夜间暗夜（用纯函数钉住边界，不依赖跑测试时的真实时间）
  assert.equal(resolveThemeByTime(10), 'warm')
  assert.equal(resolveThemeByTime(18), 'dark')
  assert.equal(resolveThemeByTime(2), 'dark')
  assert.equal(resolveThemeByTime(6), 'warm')
})

test('存储口径：模式与「实际主题」分开存，模式优先', (t) => {
  // 跟随系统 + 系统深色：模式存 system，实际主题存 dark
  setupEnv(t, { stored: { [THEME_MODE_STORAGE_KEY]: 'system' }, systemDark: true })
  assert.equal(getSavedThemeMode(), 'system')
  assert.equal(applyThemeMode('system'), 'dark')
  assert.equal(globalThis.localStorage.getItem(THEME_STORAGE_KEY), 'dark')

  // 存储里是脏数据 → 回退默认模式 warm
  setupEnv(t, { stored: { [THEME_MODE_STORAGE_KEY]: 'rainbow' } })
  assert.equal(getSavedThemeMode(), 'warm')
})
