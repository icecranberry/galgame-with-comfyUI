import { checkLateErrorBoundary } from './town-request-boundaries.mjs'
// Synthetic API only, real Vue/Edge. No transaction or model endpoints.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
// Exercise main's real api/index.js exports without fixture substitutions.
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia'] }, server: { hmr: false, host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, reducedMotion: 'reduce' })
  const origin = new URL(server.resolvedUrls.local[0]).origin, posts = [], errors = [], receipts = new Map()
  let worldId = 'w', worldEpoch = 1, failRead = false, loseAck = false, reject = false
  const row = (eventId, consumerKey, status) => ({ eventId, consumerKey, consumerName: consumerKey === 'town.experience' ? '经历记录' : '回访预约', status, attempts: 3, nextRetryAt: 1788804000000, occurredAt: 1788803000000, lastErrorCode: 'MEMORY_DISABLED', sourceType: 'town.service.settled' })
  const records = [row('secret-1', 'town.experience', 'dead'), row('secret-2', 'town.appointment', 'pending'), row('secret-3', 'town.experience', 'processing'), row('secret-1', 'town.appointment', 'dead')]
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request(), url = new URL(req.url())
    if (req.method() === 'GET') {
      if (url.pathname !== '/api/town/deliveries') {
        assert.ok(['/api/town/settings', '/api/town/liquidity', '/api/town/npcs', '/api/town/characters', '/api/town/player/kit'].includes(url.pathname))
        return route.fulfill({ json: {} })
      }
      if (failRead) return route.fulfill({ status: 503, json: { error: 'SQL secret' } })
      const more = url.searchParams.has('cursorSeq')
      if (more) { assert.equal(url.searchParams.get('cursorSeq'), '3'); assert.equal(url.searchParams.get('cursorConsumer'), 'town.experience') }
      return route.fulfill({ json: { worldId, worldEpoch, items: more ? records.slice(2) : records.slice(0, 3), nextCursor: more ? null : { seq: 3, consumerKey: 'town.experience' } } })
    }
    assert.equal(req.method(), 'POST'); assert.equal(url.pathname, '/api/town/deliveries/retry')
    const body = req.postDataJSON(); posts.push(body)
    assert.deepEqual(Object.keys(body).sort(), ['consumerKey', 'eventId', 'idempotencyKey', 'worldEpoch'])
    if (receipts.has(body.idempotencyKey)) return route.fulfill({ json: receipts.get(body.idempotencyKey) })
    if (reject) return route.fulfill({ status: 409, json: { code: 'DELIVERY_ACTIVE' } })
    const target = records.find(r => r.eventId === body.eventId && r.consumerKey === body.consumerKey)
    assert.equal(target.status, 'dead'); target.status = 'pending'
    const result = { worldId, worldEpoch, eventId: body.eventId, consumerKey: body.consumerKey, status: 'pending', requeued: true }
    receipts.set(body.idempotencyKey, result)
    if (loseAck) { loseAck = false; return route.abort('failed') }
    return route.fulfill({ json: result })
  })
  await page.goto(`${origin}/test/town-deliveries-fixture.html`)
  const open = page.getByRole('button', { name: '查看投递', exact: true }), dialog = page.getByRole('dialog')
  const refresh = page.getByRole('button', { name: '重新读取', exact: true }), retry = page.getByRole('button', { name: '重新投递', exact: true })
  const ready = () => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  await open.tap(); await retry.waitFor(); await ready()
  assert.equal(await retry.count(), 1); assert.equal(posts.length, 0)
  assert.doesNotMatch(await dialog.innerText(), /secret|town\.|MEMORY_DISABLED|SQL/)
  await page.getByRole('button', { name: '加载更多' }).tap(); await ready()
  assert.equal(await page.getByRole('list', { name: '投递记录' }).locator('li').count(), 4); assert.equal(await retry.count(), 2)
  // Same event, two consumers must remain distinct.
  loseAck = true; await retry.first().evaluate(el => { el.click(); el.click() })
  await page.getByRole('button', { name: '重试原请求' }).waitFor(); await ready(); assert.equal(posts.length, 1)
  await page.reload(); await open.tap(); await page.getByRole('button', { name: '重试原请求' }).waitFor(); await ready()
  await refresh.tap(); await ready(); assert.equal(posts.length, 1)
  await page.getByRole('button', { name: '重试原请求' }).tap(); await page.getByText('重投请求已确认，当前处理进度以重新读取的列表为准。').waitFor(); await ready()
  assert.deepEqual(posts[0], posts[1]); assert.equal(await retry.count(), 0)
  await page.getByRole('button', { name: '加载更多' }).tap(); await ready(); reject = true
  await retry.tap(); await page.getByRole('alert').waitFor(); await ready()
  assert.match(await page.getByRole('alert').innerText(), /等待或处理中/)
  await page.getByRole('button', { name: '使用最新状态' }).tap(); reject = false
  failRead = true; await refresh.tap(); await ready(); assert.ok(await page.getByRole('alert').count())
  failRead = false; await refresh.tap(); await ready(); await page.getByRole('button', { name: '加载更多' }).tap(); await ready()
  const out = path.resolve(root, '../output/hd2d-deliveries'); await fs.mkdir(out, { recursive: true })
  for (const [width, height] of [[375, 667], [375, 300], [740, 360]]) {
    await page.setViewportSize({ width, height }); await retry.scrollIntoViewIfNeeded()
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
  }
  loseAck = true; await retry.tap(); await page.getByRole('button', { name: '重试原请求' }).waitFor(); await ready()
  worldEpoch = 2; await refresh.tap(); await ready()
  await page.getByText('小镇已更新，旧的重投请求已清除。').waitFor(); assert.equal(await page.getByRole('button', { name: '重试原请求' }).count(), 0)
  worldId = 'another'; await page.getByRole('button', { name: '加载更多' }).tap(); await ready()
  await page.getByText('小镇已更新，请从头重新读取记录。').waitFor(); assert.equal(await page.getByRole('list', { name: '投递记录' }).locator('li').count(), 0)
  await refresh.tap(); await ready(); await page.getByRole('button', { name: '加载更多' }).tap(); await ready()
  await page.getByRole('button', { name: '关闭记录投递状态' }).focus(); await page.keyboard.press('Shift+Tab')
  assert.equal(await refresh.evaluate(el => el === document.activeElement), true)
  const keys = await page.evaluate(() => fixture.keys); await page.keyboard.press('w'); assert.equal(await page.evaluate(() => fixture.keys), keys)
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await open.evaluate(el => el === document.activeElement), true)
  assert.equal(posts.length, 4)
  // The weak Admin settings entry opens the same panel and returns focus.
  await page.goto(`${origin}/test/town-liquidity-admin-fixture.html`)
  await page.getByRole('button', { name: '打开管理' }).tap(); await page.getByRole('button', { name: '设置', exact: true }).tap()
  const entry = page.getByRole('button', { name: '查看记录投递状态' })
  await entry.tap(); await page.getByRole('dialog', { name: '记录投递状态' }).waitFor(); await ready()
  await page.getByRole('dialog', { name: '小镇管理', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('dialog').count(), 1)
  await page.getByRole('button', { name: '关闭记录投递状态' }).tap()
  await page.getByRole('dialog', { name: '小镇管理', exact: true }).waitFor()
  assert.equal(await entry.evaluate(el => el === document.activeElement), true)
  assert.equal(posts.length, 4); assert.deepEqual(errors, [])
  await checkLateErrorBoundary(browser, origin, 'diagnostics')
  console.log(JSON.stringify({ passed: true, posts: posts.length, viewports: ['375x667', '375x300', '740x360'] }))
} finally { await browser?.close(); await server.close() }
