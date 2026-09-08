import { checkLateErrorBoundary } from './town-request-boundaries.mjs'
// Isolated real Vue/Edge: synthetic API, no backend/model calls.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
// Exercise the real api/index.js exports supplied by main.
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue'] }, server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, timezoneId: 'America/Los_Angeles' })
  const origin = new URL(server.resolvedUrls.local[0]).origin, posts = [], errors = [], receipts = new Map()
  const now = Date.UTC(2026, 8, 8, 0), expiry = now + 7 * 86400000
  await page.addInitScript(value => { Date.now = () => value }, now)
  let failRead = false, rejectSchedule = false, loseAck = false, delay = false
  const candidate = id => ({ candidateId: id, scope: { worldId: 'w', worldEpoch: 1 }, providerActorId: 'provider-secret', characterId: 7, locationKey: 'place-secret', status: 'offered', version: 1, expiresAt: expiry, durationMs: 1800000, price: 0 })
  const state = { worldId: 'w', worldEpoch: 1, candidates: [candidate('candidate-secret')], appointments: [] }
  page.on('pageerror', e => errors.push(e.message))
  await page.route(`${origin}/api/**`, async route => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ status: failRead ? 503 : 200, json: failRead ? { error: 'SQL secret' } : state })
    assert.equal(request.method(), 'POST')
    const body = request.postDataJSON(), url = new URL(request.url()).pathname
    posts.push({ url, body }); assert.equal(body.worldEpoch, state.worldEpoch)
    assert.deepEqual(Object.keys(body).sort(), url.endsWith('/accept') ? ['expectedVersion', 'idempotencyKey', 'startAt', 'worldEpoch'] : ['expectedVersion', 'idempotencyKey', 'worldEpoch'])
    if (delay) await new Promise(resolve => setTimeout(resolve, 200))
    if (receipts.has(body.idempotencyKey)) return route.fulfill({ json: receipts.get(body.idempotencyKey) })
    if (rejectSchedule) return route.fulfill({ status: 409, json: { code: 'SCHEDULE_UNAVAILABLE' } })
    let result
    if (url.endsWith('/accept')) {
      const invited = state.candidates[0]; assert.equal(body.expectedVersion, invited.version)
      result = { ...invited, appointmentId: `appointment-${state.appointments.length}`, startAt: body.startAt, endAt: body.startAt + 1800000, status: 'accepted' }
      state.candidates = []; state.appointments.push(result)
    } else { result = state.appointments.find(a => url.includes(a.appointmentId)); assert.equal(body.expectedVersion, result.version); result.status = 'cancelled'; result.version++ }
    receipts.set(body.idempotencyKey, structuredClone(result))
    if (loseAck) { loseAck = false; return route.abort('failed') }
    return route.fulfill({ json: result })
  })
  await page.goto(`${origin}/test/town-appointments-fixture.html`)
  const trigger = page.getByRole('button', { name: '查看免费回访', exact: true }), dialog = page.getByRole('dialog')
  const refresh = page.getByRole('button', { name: '重新读取', exact: true })
  const input = page.getByLabel('开始时间（北京时间 UTC+8）')
  const preview = page.getByRole('button', { name: '核对回访时间' }), confirm = page.getByRole('button', { name: '确认预约此时间' })
  await trigger.click(); await input.waitFor()
  assert.equal(posts.length, 0); assert.equal(await input.inputValue(), '')
  assert.doesNotMatch(await dialog.innerText(), /secret|UUID|SQL/)
  assert.match(await dialog.innerText(), /工坊回访/)
  assert.doesNotMatch(await dialog.innerText(), /来信|信箱/)
  await input.fill('2026-09-08T07:30'); await preview.click(); await page.getByRole('alert').waitFor(); assert.equal(posts.length, 0)
  await input.fill('2026-09-15T07:45'); await preview.click(); assert.equal(posts.length, 0)
  await input.fill('2026-09-08T09:30'); await preview.click()
  await page.getByRole('region', { name: '确认回访安排' }).waitFor()
  assert.match(await page.getByRole('region', { name: '确认回访安排' }).innerText(), /09:30.*10:00/s); assert.equal(posts.length, 0)
  const out = path.resolve(root, '../output/hd2d-m6-appointments'); await fs.mkdir(out, { recursive: true })
  for (const [width, height] of [[375, 667], [740, 360]]) {
    await page.setViewportSize({ width, height }); await confirm.scrollIntoViewIfNeeded()
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
  }
  loseAck = true; delay = true
  await confirm.focus(); await confirm.evaluate(el => { el.click(); el.click() })
  await page.getByRole('button', { name: '重试原请求' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'removed confirmation control must not lose focus to the page')
  assert.equal(posts.length, 1); assert.equal(posts[0].body.startAt, Date.UTC(2026, 8, 8, 1, 30))
  await page.reload(); await trigger.click(); await page.getByRole('button', { name: '重试原请求' }).waitFor()
  assert.equal(posts.length, 1)
  await refresh.click(); assert.equal(posts.length, 1)
  await page.getByRole('button', { name: '重试原请求' }).click()
  await page.getByText('预约已确认，请按约定时间前往。').waitFor()
  assert.deepEqual(posts[0], posts[1]); assert.equal(state.appointments.length, 1)
  await page.getByRole('button', { name: '取消这次回访' }).click()
  assert.equal(posts.length, 2)
  await page.getByRole('button', { name: '确认取消预约' }).click(); await page.getByText('回访已取消。').waitFor()
  assert.equal(state.appointments[0].status, 'cancelled')
  state.candidates = [candidate('candidate-second')]
  await refresh.click(); await input.waitFor()
  rejectSchedule = true; await input.fill('2026-09-09T10:00'); await preview.click(); await confirm.click()
  await page.getByText(/这个时段无法确认双方都有空/).waitFor()
  await page.getByRole('button', { name: '按最新状态重新选择' }).click()
  assert.equal(posts.length, 4)
  failRead = true; await refresh.click(); await page.getByRole('alert').waitFor()
  assert.equal(await preview.isDisabled(), true)
  failRead = false; rejectSchedule = false; await refresh.click(); await input.waitFor()
  await input.fill('2026-09-10T10:00'); await preview.click()
  loseAck = true; await confirm.click(); await page.getByRole('button', { name: '重试原请求' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  state.worldEpoch = 2; state.candidates = []; state.appointments = []
  await refresh.click(); await page.getByText('小镇已更新，旧的待确认操作已清除。').waitFor()
  assert.equal(await page.getByRole('button', { name: '重试原请求' }).count(), 0); assert.equal(posts.length, 5)
  await page.getByRole('button', { name: '关闭免费回访' }).focus()
  await page.keyboard.press('Shift+Tab'); assert.equal(await refresh.evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Tab'); assert.equal(await page.getByRole('button', { name: '关闭免费回访' }).evaluate(el => el === document.activeElement), true)
  const keys = await page.evaluate(() => fixture.keys); await page.keyboard.press('w'); assert.equal(await page.evaluate(() => fixture.keys), keys)
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
  await trigger.click(); await page.getByText('暂时没有可接受的回访邀请。').waitFor(); assert.equal(posts.length, 5)
  await checkLateErrorBoundary(browser, origin, 'appointment')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, posts: posts.length, timezone: 'America/Los_Angeles', viewports: ['375x667', '740x360'] }))
} finally { await browser?.close(); await server.close() }
