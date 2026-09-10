import { checkLifeBoundary } from './town-request-boundaries.mjs'
// Isolated Vite + real Vue controls; synthetic HTTP only. No backend/DB/model.
// PLAYWRIGHT_MODULE points to playwright/core; BROWSER_CHANNEL defaults to msedge.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
// Always exercise the real api/index.js exports.
const plugins = [vue()]
const server = await createServer({ configFile: false, root, plugins, optimizeDeps: { noDiscovery: true, include: ['vue'] }, server: { hmr: false, watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = new URL(server.resolvedUrls.local[0]).origin
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, timezoneId: 'America/Los_Angeles' })
  const errors = [], posts = [], receipts = new Map()
  let rejectArrival = false, loseAck = false, delay = 0, failedRead = false
  const state = { enabled: false, configured: false, worldId: 'fixture', worldEpoch: 1,
    wallet: { balance: 0, reserved: 0, available: 0 }, slice: null, orders: [],
    participants: [{ actorId: 'a', displayName: '小满' }, { actorId: 'b', displayName: '阿禾' }, { actorId: 'c', displayName: '木木' }],
    locations: [{ key: 'board', name: '街角公告站', x: 0, y: 0 }, { key: 'supplier', name: '花园原料点', x: 2, y: 2 }, { key: 'workshop', name: '木木工坊', x: 3, y: 3 }], service: null }
  page.on('pageerror', e => errors.push(e.message))
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request(), url = new URL(req.url()).pathname
    if (req.method() === 'GET' && url === '/api/town/economy') {
      return route.fulfill({ status: failedRead ? 503 : 200, json: failedRead ? { error: '读取失败' } : state })
    }
    if (req.method() === 'GET' && url === '/api/town/services/s-life') return route.fulfill({ json: state.service.sessions[0] })
    assert.equal(req.method(), 'POST')
    const body = req.postDataJSON(); posts.push({ url, body })
    assert.equal(body.worldEpoch, state.worldEpoch); assert.ok(body.idempotencyKey)
    assert.equal('actorId' in body, false); assert.equal('playerId' in body, false)
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    if (receipts.has(body.idempotencyKey)) return route.fulfill({ json: receipts.get(body.idempotencyKey) })
    if (url.endsWith('/setup')) {
      assert.equal(new Set(Object.values(body.npcActorIds)).size, 3)
      assert.equal(new Set(Object.values(body.locationKeys)).size, 3)
      state.enabled = true; state.configured = true
      state.slice = { npcActorIds: body.npcActorIds, locationKeys: body.locationKeys, reward: 30, materialQuantity: 2 }
    } else if (url.endsWith('/publish')) {
      if (state.orders.some(o => ['open', 'accepted', 'picked_up'].includes(o.status))) return route.fulfill({ status: 409, json: { error: '已有进行中的委托', code: 'ACTIVE_ORDER_EXISTS' } })
      state.orders.unshift({ orderId: `order-${state.orders.length + 1}`, status: 'open', version: 1, expiresAt: Date.now() + 3600000,
        config: { locationKeys: state.slice.locationKeys, reward: 30 } })
    } else {
      const order = state.orders.find(o => url.includes(`/${o.orderId}/`)); assert.ok(order)
      if (body.expectedVersion !== order.version) return route.fulfill({ status: 409, json: { error: '状态已变化', code: 'VERSION_CONFLICT' } })
      if (rejectArrival) return route.fulfill({ status: 409, json: { error: 'NOT_ARRIVED', code: 'NOT_ARRIVED' } })
      const command = url.split('/').at(-1)
      order.status = { accept: 'accepted', pickup: 'picked_up', complete: 'completed', cancel: 'cancelled' }[command]
      order.version++
      if (command === 'complete') state.wallet.balance = state.wallet.available = state.wallet.available + 30
    }
    const response = { ok: true }; receipts.set(body.idempotencyKey, response)
    if (loseAck) return route.abort('failed')
    return route.fulfill({ json: response })
  })
  const output = path.resolve(root, '../output/hd2d-m4-life')
  await fs.mkdir(output, { recursive: true })
  const button = name => page.getByRole('button', { name, exact: true })
  const ready = () => page.waitForFunction(() => !document.querySelector('.tl-content')?.getAttribute('aria-busy') || document.querySelector('.tl-content')?.getAttribute('aria-busy') === 'false')
  await page.goto(`${origin}/test/town-life-fixture.html`)
  await button('打开钱袋面板').click()
  await button('开启配送生活').waitFor(); await ready()
  assert.equal(posts.length, 0); assert.ok(await button('开启配送生活').isDisabled())
  await page.keyboard.press('w'); assert.equal(await page.evaluate(() => fixture.keys), 0)
  await page.screenshot({ path: path.join(output, 'setup-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'setup-mobile.png') })
  for (const [label, option] of [['委托居民', '小满'], ['供货居民', '阿禾'], ['工坊居民', '木木'], ['公告站地点', '街角公告站'], ['领取材料地点', '花园原料点'], ['工坊地点', '木木工坊']]) {
    await page.getByRole('combobox', { name: label, exact: true }).click()
    await page.getByRole('option', { name: option, exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[role="listbox"]'))
  }
  assert.ok(await button('开启配送生活').isEnabled()); assert.equal(posts.length, 0)
  await page.setViewportSize({ width: 1100, height: 820 })
  delay = 120
  await button('开启配送生活').click()
  await button('开启配送生活').dispatchEvent('click')
  // 开张在钱袋面板，配送与备料在公告站面板：同屏只开一个窗口，等开张确认后再换面板。
  await page.getByText('镇上的事，到地方办').waitFor()
  await button('关闭钱袋').click()
  await button('打开公告站面板').click()
  await button('发布配送委托').waitFor(); await ready()
  assert.equal(posts.length, 1)
  await button('发布配送委托').click(); await button('接取委托').waitFor(); await ready()
  const expiryBeforeDisplay = state.orders[0].expiresAt
  const beijingExpiry = new Date(expiryBeforeDisplay).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  assert.ok((await page.locator('.tl-order').first().innerText()).includes(`截止 ${beijingExpiry}（北京时间）`))
  assert.equal(state.orders[0].expiresAt, expiryBeforeDisplay)
  assert.equal(posts.length, 2); assert.ok(await button('接取委托').isEnabled()) // zero balance
  rejectArrival = true
  await button('接取委托').click(); await page.getByRole('alert').waitFor(); await ready()
  assert.match(await page.getByRole('alert').innerText(), /还没有到达/)
  const rejectedId = posts.at(-1).body.idempotencyKey
  const beforeRead = posts.length
  await button('重新读取').click(); await ready(); assert.equal(posts.length, beforeRead)
  await button('前往公告站').click(); assert.equal(await page.evaluate(() => fixture.moves.at(-1)), 'board')
  rejectArrival = false
  await button('重试同一次操作').click(); await button('领取材料').waitFor(); await ready()
  assert.equal(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)), true, 'removed retry control must retain keyboard focus')
  assert.equal(posts.at(-1).body.idempotencyKey, rejectedId)
  state.enabled = false
  await button('重新读取').click(); await ready()
  assert.ok(await button('发布配送委托').isDisabled())
  assert.ok(await button('领取材料').isEnabled()); assert.ok(await button('取消委托').isEnabled())
  await button('领取材料').click(); await button('交付材料').waitFor(); await ready()
  await page.screenshot({ path: path.join(output, 'delivery-desktop.png') })
  loseAck = true
  await button('交付材料').click(); await page.getByRole('alert').waitFor(); await ready()
  assert.equal(state.wallet.available, 30)
  const completionId = posts.at(-1).body.idempotencyKey
  await button('关闭公告站').click(); await button('打开公告站面板').click(); await ready()
  await button('重试同一次操作').waitFor()
  await page.reload(); await button('打开公告站面板').click(); await button('重试同一次操作').waitFor(); await ready()
  loseAck = false
  await button('重试同一次操作').click(); await ready()
  assert.equal(posts.at(-1).body.idempotencyKey, completionId); assert.equal(state.wallet.available, 30)
  assert.equal(await button('交付材料').count(), 0)
  // No unsupported commerce/service/backpack replacement controls.
  assert.equal(await page.getByRole('button', { name: /商城|服务|背包/ }).count(), 0)
  for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 740, height: 360 }, { width: 375, height: 300 }]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => document.querySelector('.tl-panel').getBoundingClientRect().bottom <= innerHeight)
    const bounds = await page.getByRole('dialog').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(output, `${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1100, height: 820 })
  state.enabled = true; await button('重新读取').click(); await ready()
  await button('发布配送委托').click(); await button('接取委托').waitFor(); await ready()
  state.enabled = false; await button('重新读取').click(); await ready()
  assert.ok(await button('接取委托').isDisabled())
  state.enabled = true; await button('重新读取').click(); await ready()
  await button('发布配送委托').click(); await page.getByRole('alert').waitFor(); await ready()
  assert.match(await page.getByRole('alert').innerText(), /进行中的委托/)
  const beforeReset = posts.length
  await button('使用最新状态').click(); assert.equal(posts.length, beforeReset)
  await button('接取委托').click(); await button('领取材料').waitFor(); await ready()
  state.enabled = false; await button('重新读取').click(); await ready()
  await button('取消委托').click()
  const beforeCancel = posts.length
  await button('继续配送').click(); assert.equal(posts.length, beforeCancel)
  await button('取消委托').click(); await button('确认取消').click(); await ready()
  assert.equal(state.orders[0].status, 'cancelled'); assert.equal(state.wallet.available, 30)
  await button('重新读取').focus(); await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭公告站')
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
  failedRead = true; await button('打开公告站面板').click(); await page.getByRole('alert').waitFor(); await ready()
  assert.ok(await button('发布配送委托').isDisabled())
  const before = posts.length; await button('重新读取').click(); await ready(); assert.equal(posts.length, before)
  failedRead = false
  // 工坊/咖啡馆/店铺的玩法面板改由世界里点建筑或掌柜打开，那条链路见 town-view-browser.mjs。
  state.production = { batches: [{ productionId: 'internal-reserved', status: 'reserved', config: { recipe: { quantity: 1 } } },
    ...Array.from({ length: 3 }, (_, i) => ({ productionId: `internal-completed-${i}`, status: 'completed', config: { recipe: { quantity: 1 } } })),
    { status: 'cancelled' }, { status: 'expired' }], resource: { capacity: 200, remaining: 197, reserved: 1, available: 196 } }
  await button('重新读取').click(); await ready()
  const production = page.getByRole('region', { name: '工坊备料' })
  assert.match(await production.innerText(), /备料中 1 份 · 已补货 3 份/)
  assert.match(await production.innerText(), /197 \/ 200/)
  assert.match(await production.innerText(), /可采集 196/)
  assert.doesNotMatch(await production.innerText(), /internal-/)
  assert.equal(await production.getByRole('button').count(), 0); assert.equal(posts.length, before)
  state.liquidity = { enabled: false, availableFund: 59, activationAllowed: false, grossIssued: 80, remainingWorldBudget: 720, issued24h: 12, issued7d: 70,
    limits: { reserve: 75, rolling24h: 40, rolling7d: 280, grossWorld: 800, circulation: 5000 } }
  await button('关闭公告站').click(); await button('打开钱袋面板').click(); await ready()
  await button('重新读取').click(); await ready()
  const liquidity = page.getByRole('region', { name: '公共基金', exact: true })
  assert.match(await liquidity.innerText(), /可用 59/); assert.match(await liquidity.innerText(), /累计补助 80/)
  for (const value of ['75', '40', '280', '800', '5,000']) assert.ok((await liquidity.innerText()).includes(value))
  assert.equal(await liquidity.getByRole('button').count(), 0)
  state.liquidity.availableFund = null
  await button('关闭钱袋').click(); await button('打开钱袋面板').click(); await ready()
  assert.match(await liquidity.innerText(), /基金尚未配置/)
  assert.doesNotMatch(await liquidity.innerText(), /可用 0/); assert.equal(posts.length, before)
  await checkLifeBoundary(browser, origin)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, posts: posts.length, balance: state.wallet.available, screenshots: output }))
} finally { await browser?.close(); await server.close() }
