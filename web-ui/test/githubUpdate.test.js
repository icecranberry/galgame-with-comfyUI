import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  normalizeVersion, compareVersions, pickLatestTag, selectNewTags, parseTagRef, tagAnnotation,
  shouldNotify, getSeenVersion, markUpdateSeen, checkForUpdate, resetCache,
} = await import('../src/utils/githubUpdate.js')
const { getAppVersion } = await import('../src/api/index.js')

// 「有更新噢」标签的判定口径：最新 tag 与本地版本的比较，以及
// 「弹层只列 tag 版本 + 该 tag 的注释（不列提交）」这条链路。
// 请求由浏览器直接发给 api.github.com，所以这里 mock 的是全局 fetch。

// localStorage 的缓存键（与 utils 里保持一致）
const CACHE_KEY = 'linshe:update-check:v2'
const SEEN_KEY = 'linshe:update-seen'

// refs 列表：附注 tag 的 object.type = 'tag'，object.sha 是 tag 对象自身的 sha（取注释要用它）；
// 轻量 tag 的 type = 'commit'，指向提交本身、没有注释。
const REFS = [
  { ref: 'refs/tags/v3.4.2', object: { type: 'tag', sha: 'a'.repeat(40) } },
  { ref: 'refs/tags/v3.1.0', object: { type: 'tag', sha: 'b'.repeat(40) } },
  { ref: 'refs/tags/v3.0.1', object: { type: 'tag', sha: 'c'.repeat(40) } },
  { ref: 'refs/tags/v3.0.0', object: { type: 'tag', sha: 'd'.repeat(40) } },
  { ref: 'refs/tags/v2.4.9', object: { type: 'tag', sha: 'e'.repeat(40) } },
  { ref: 'refs/tags/nightly', object: { type: 'commit', sha: 'f'.repeat(40) } },
]

const ANNOTATIONS = {
  ['a'.repeat(40)]: '世界视觉优化功能优化；角色外观快捷修正功能上线',
  ['b'.repeat(40)]: '表情包功能已上线',
  ['c'.repeat(40)]: '（密码写错了',
  ['d'.repeat(40)]: '不该被取到：本地版本自己那条',
  ['e'.repeat(40)]: '不该被取到：比本地版本旧',
}

const json = body => ({ ok: true, status: 200, text: async () => '', json: async () => body })

/** 装一个只认 refs / tag 详情两个端点的假 GitHub 接口 */
function mockGithub(t, { onTagRequest } = {}) {
  const calls = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url, options) => {
      const target = String(url)
      calls.push({ url: target, options })
      if (target.endsWith('/git/refs/tags')) return json(REFS)
      const sha = target.split('/git/tags/')[1]
      if (onTagRequest) onTagRequest(sha, calls.length)
      return json({ message: ANNOTATIONS[sha] ?? '' })
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'fetch', original)
    else delete globalThis.fetch
    resetCache()
  })
  return calls
}

/** 装一个内存版 localStorage，返回底层 Map 方便断言 */
function stubLocalStorage(t, initial) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map(initial ? Object.entries(initial) : [])
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  })
  return store
}

test('normalizeVersion 去掉 v 前缀与空白', () => {
  assert.equal(normalizeVersion('v3.4.2'), '3.4.2')
  assert.equal(normalizeVersion(' 3.0.0 '), '3.0.0')
  assert.equal(normalizeVersion(undefined), '')
})

test('compareVersions 按数字段比较，位数不同不按字符串排序', () => {
  assert.equal(compareVersions('3.0.0', '3.0.1'), -1)
  assert.equal(compareVersions('3.4.2', '3.4.2'), 0)
  assert.equal(compareVersions('v3.10.0', '3.9.9'), 1)
  assert.equal(compareVersions('3.3.1-beta.2', '3.3.1'), 0)
  assert.equal(compareVersions('3.2', '3.2.0'), 0)
})

test('parseTagRef 只认 tag 引用，并区分附注 tag 与轻量 tag', () => {
  assert.deepEqual(parseTagRef({ ref: 'refs/tags/v3.4.2', object: { type: 'tag', sha: 'abc' } }), {
    tag: 'v3.4.2', version: '3.4.2', sha: 'abc', annotated: true,
  })
  // 轻量 tag 指向提交本身，没有 tag 对象也就没有注释
  assert.equal(parseTagRef({ ref: 'refs/tags/nightly', object: { type: 'commit', sha: 'f' } }).annotated, false)
  assert.equal(parseTagRef({ ref: 'refs/heads/main', object: { type: 'commit', sha: 'f' } }), null)
  assert.equal(parseTagRef({}), null)
})

test('tagAnnotation 去掉首尾空白、统一换行，过长截断', () => {
  assert.equal(tagAnnotation('  修复边缘bug\n\n'), '修复边缘bug')
  assert.equal(tagAnnotation('第一行\r\n第二行'), '第一行\n第二行')
  assert.equal(tagAnnotation(''), '')
  assert.equal(tagAnnotation(undefined), '')
  const long = tagAnnotation('啊'.repeat(900))
  assert.equal(long.length, 401) // 400 字 + 省略号
  assert.ok(long.endsWith('…'))
})

test('pickLatestTag 挑出版本号最大的 tag，与接口返回顺序无关', () => {
  const tags = REFS.map(parseTagRef).filter(Boolean)
  assert.equal(pickLatestTag(tags).version, '3.4.2')
  assert.equal(pickLatestTag([]), null)
})

test('selectNewTags 只留比当前版本新的 tag，并按版本降序排列（最新在前）', () => {
  const tags = REFS.map(parseTagRef).filter(Boolean)
  assert.deepEqual(selectNewTags(tags, '3.0.0').map(t => t.version), ['3.4.2', '3.1.0', '3.0.1'])
  assert.deepEqual(selectNewTags(tags, '3.4.2'), [])
})

test('checkForUpdate：本地 3.0.0 vs 最新 3.4.2 → 逐 tag 列出注释，不拉提交', async t => {
  const calls = mockGithub(t)

  const info = await checkForUpdate({ currentVersion: '3.0.0' })
  assert.equal(info.hasUpdate, true)
  assert.equal(info.current, '3.0.0')
  assert.equal(info.latest, '3.4.2')
  assert.equal(info.latestTag, 'v3.4.2')
  assert.equal(info.tagCount, 3)
  assert.equal(info.annotationsTrimmed, false)
  assert.equal(info.compareUrl, 'https://github.com/icecranberry/galgame-with-comfyUI/compare/v3.0.0...v3.4.2')

  // 弹层内容 = tag 版本号 + 该 tag 的注释，逐条对上；本地版本自己与更旧的 tag 不出现
  assert.deepEqual(info.tags, [
    { tag: 'v3.4.2', version: '3.4.2', annotation: '世界视觉优化功能优化；角色外观快捷修正功能上线' },
    { tag: 'v3.1.0', version: '3.1.0', annotation: '表情包功能已上线' },
    { tag: 'v3.0.1', version: '3.0.1', annotation: '（密码写错了' },
  ])

  // 请求确实由前端直接发给 api.github.com，且不该带 User-Agent（浏览器禁止脚本改它）
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/icecranberry\/galgame-with-comfyUI\/git\/refs\/tags$/)
  assert.equal(calls[0].options.headers['User-Agent'], undefined)
  // 只取 tag 注释，不请求 compare / commits
  assert.deepEqual(calls.slice(1).map(c => c.url.split('/git/tags/')[1]).sort(), ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)])
  assert.ok(calls.every(c => !c.url.includes('compare') && !c.url.includes('/commits')))

  // 第二次调用走缓存：不再打接口
  const before = calls.length
  await checkForUpdate({ currentVersion: '3.0.0' })
  assert.equal(calls.length, before)

  // force 绕过缓存重查（1 次 refs + 3 次注释）
  await checkForUpdate({ force: true, currentVersion: '3.0.0' })
  assert.equal(calls.length, before + 4)
})

test('checkForUpdate：本地已经是最新时只发 refs 一个请求', async t => {
  const calls = mockGithub(t)
  const info = await checkForUpdate({ currentVersion: '3.4.2' })
  assert.equal(info.hasUpdate, false)
  assert.equal(info.tags.length, 0)
  assert.equal(calls.length, 1)
})

test('checkForUpdate：缓存按本地版本分键，换版本号不会复用旧结论', async t => {
  mockGithub(t)
  const first = await checkForUpdate({ currentVersion: '3.0.0' })
  const second = await checkForUpdate({ currentVersion: '3.4.2' })
  assert.equal(first.hasUpdate, true)
  assert.equal(second.hasUpdate, false)
})

test('checkForUpdate：单条注释取失败只丢这一条，tag 仍然列出', async t => {
  mockGithub(t, { onTagRequest: sha => { if (sha === 'b'.repeat(40)) throw new Error('GitHub 接口返回 500') } })
  const info = await checkForUpdate({ currentVersion: '3.0.0' })
  assert.equal(info.hasUpdate, true)
  assert.deepEqual(info.tags.map(g => g.tag), ['v3.4.2', 'v3.1.0', 'v3.0.1'])
  assert.deepEqual(info.tags.map(g => g.annotation), ['世界视觉优化功能优化；角色外观快捷修正功能上线', '', '（密码写错了'])
  // 有失败就算降级结果，不该被缓存住
  assert.equal(info.annotationsFailed, true)
})

test('checkForUpdate：注释全取失败时算降级结果，并且不落缓存好让下次重试', async t => {
  const store = stubLocalStorage(t)
  mockGithub(t, { onTagRequest: () => { throw new Error('GitHub 接口限流了') } })

  const info = await checkForUpdate({ currentVersion: '3.0.0' })
  assert.equal(info.hasUpdate, true)
  assert.equal(info.annotationsFailed, true)
  assert.deepEqual(info.tags.map(g => g.annotation), ['', '', ''])
  assert.equal(store.has(CACHE_KEY), false)
})

test('checkForUpdate：注释正常时不算降级，要落缓存', async t => {
  const store = stubLocalStorage(t)
  mockGithub(t)

  const info = await checkForUpdate({ currentVersion: '3.0.0' })
  assert.equal(info.annotationsFailed, false)
  assert.equal(store.has(CACHE_KEY), true)
})

test('checkForUpdate：结果写进 localStorage，跨页面重载不用重新请求', async t => {
  const store = stubLocalStorage(t)
  const calls = mockGithub(t)

  await checkForUpdate({ currentVersion: '3.0.0' })
  const persisted = JSON.parse(store.get(CACHE_KEY))
  assert.equal(persisted.key, '3.0.0')
  assert.equal(persisted.data.latestTag, 'v3.4.2')
  assert.equal(calls.length, 4)
})

test('checkForUpdate：内存缓存为空时回落到 localStorage，且不再打接口', async t => {
  stubLocalStorage(t, {
    [CACHE_KEY]: JSON.stringify({
      key: '3.0.0',
      at: Date.now(),
      data: { hasUpdate: true, latestTag: 'v3.9.9', current: '3.0.0', tags: [] },
    }),
  })
  const calls = mockGithub(t)

  const info = await checkForUpdate({ currentVersion: '3.0.0' })
  assert.equal(info.latestTag, 'v3.9.9')
  assert.equal(calls.length, 0)
})

test('checkForUpdate：额度用光时给一句人话，不把 403 抖给用户', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({ ok: false, status: 403, text: async () => 'rate limit exceeded' }),
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'fetch', original)
    else delete globalThis.fetch
    resetCache()
  })
  await assert.rejects(() => checkForUpdate({ currentVersion: '3.0.0' }), /限流/)
})

test('checkForUpdate：接口报错时抛出，交给 store 静默处理', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'fetch', original)
    else delete globalThis.fetch
    resetCache()
  })
  await assert.rejects(() => checkForUpdate({ currentVersion: '3.0.0' }), /500/)
})

test('getSeenVersion / markUpdateSeen 记的是去掉 v 的版本号', t => {
  const store = stubLocalStorage(t)
  assert.equal(getSeenVersion(), '')
  assert.equal(markUpdateSeen('v3.4.2'), '3.4.2')
  assert.equal(store.get(SEEN_KEY), '3.4.2')
  assert.equal(getSeenVersion(), '3.4.2')
})

test('shouldNotify：有更新且这个版本没看过才提醒，看过之后要等更高的新 tag', () => {
  const info = { hasUpdate: true, latest: '3.4.2' }
  assert.equal(shouldNotify(info, ''), true)          // 从没看过
  assert.equal(shouldNotify(info, '3.0.0'), true)     // 看过更旧的版本
  assert.equal(shouldNotify(info, '3.4.2'), false)    // 这个版本已经看过了
  assert.equal(shouldNotify(info, '3.5.0'), false)    // 记录比远端还新，别误报
  assert.equal(shouldNotify({ hasUpdate: true, latest: '3.5.0' }, '3.4.2'), true) // 远端又更新了
  assert.equal(shouldNotify({ hasUpdate: false, latest: '3.4.2' }, ''), false)   // 本地就是最新
  assert.equal(shouldNotify(null, ''), false)
  assert.equal(shouldNotify(undefined, '3.0.0'), false)
})

test('getSeenVersion / markUpdateSeen：存储不可用（隐私模式）时不抛错', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage disabled') },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  })
  assert.equal(getSeenVersion(), '')
  assert.equal(markUpdateSeen('v3.4.2'), '3.4.2')
})

test('checkForUpdate：连不上 GitHub 时报人话，不把原始网络错误抖给用户', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => { throw new TypeError('Failed to fetch') },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'fetch', original)
    else delete globalThis.fetch
    resetCache()
  })
  await assert.rejects(() => checkForUpdate({ currentVersion: '3.0.0' }), /连不上 GitHub/)
})
// ── 本地版本号从哪来 ──
// 「本地装的是哪版」只有本机能知道，所以由后端读仓库根目录的 VERSION（GET /api/version）。
// 前端不再写死版本号：写死的话每次发版都得记得改一处，漏改就会一直报「有更新」。

test('getAppVersion：本地版本号问后端要，前端不写死', async t => {
  const calls = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url, options) => {
      calls.push({ url: String(url), options })
      return { ok: true, status: 200, json: async () => ({ version: '3.4.2' }) }
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'fetch', original)
    else delete globalThis.fetch
  })
  assert.equal(await getAppVersion(), '3.4.2')
  assert.equal(calls[0].url, '/api/version')
})

test('getAppVersion：后端没给版本号时返回空串（调用方据此跳过提示）', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'fetch', original)
    else delete globalThis.fetch
  })
  assert.equal(await getAppVersion(), '')
})

test('checkForUpdate：没拿到可用的本地版本号时不打接口，直接报错', async t => {
  const store = stubLocalStorage(t)
  const calls = mockGithub(t)
  await assert.rejects(() => checkForUpdate({}), /本地版本号/)
  await assert.rejects(() => checkForUpdate({ currentVersion: '  ' }), /本地版本号/)
  // 未打 tag 时发布包里 VERSION 写的是 'dev'：拿去比会报「落后几十个版本」的假警报
  await assert.rejects(() => checkForUpdate({ currentVersion: 'dev' }), /本地版本号/)
  assert.equal(calls.length, 0)
  assert.equal(store.has(CACHE_KEY), false)
})
