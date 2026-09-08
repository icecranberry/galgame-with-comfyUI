// Full production ScheduleView, actual character-card clicks/onSelectChar, real store/drawer.
// No selection callback replacement. API is intercepted; no model or generation calls.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const events = { name: 'view-fixture-events', transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/src/stores/unifiedStream.js')) return code + '\nexport const __fixtureDispatch = _dispatch; export const __fixtureHandlerCount = type => _handlers.get(type)?.size || 0;' } }
const server = await createServer({ configFile: false, root, plugins: [events, vue()], optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia', 'vue-router'] }, server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' })
  await page.clock.install()
  const origin = new URL(server.resolvedUrls.local[0]).origin, calls = [], errors = [], held = new Map(), waiters = new Map()
  const delayIds = new Set([1]); let epoch = 1, availability = 'currently_free', regenerations = 0, expired = false
  let holdReset = false, resetRoute
  const base = id => ({ character_id: id, activities: [{ startTime: '08:00', activity: `基础活动${id}`, location: '书房', isCurrent: true }] })
  const take = id => held.has(id) ? Promise.resolve(held.get(id)) : new Promise(resolve => waiters.set(id, resolve))
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request(), url = new URL(req.url()).pathname; calls.push(url)
    if (req.method() === 'POST') {
      assert.equal(url, '/api/schedule/2/regenerate'); regenerations++; availability = 'currently_free'
      return route.fulfill({ json: { ok: true } })
    }
    assert.equal(req.method(), 'GET')
    if (url === '/api/config') return route.fulfill({ json: {} })
    if (url === '/api/schedule/reset-status') { if (holdReset) { resetRoute = route; return }; return route.fulfill({ json: { active: false } }) }
    if (url === '/api/schedule') return route.fulfill({ json: { characters: [1, 2].map(id => ({ id, display_name: `角色${id}`, current_activity: '书房 · 阅读', is_sleeping: false, reply_delay: 0 })) } })
    const match = url.match(/^\/api\/schedule\/(\d+)(\/overlays)?$/); assert.ok(match, url)
    const id = Number(match[1])
    if (match[2]) return route.fulfill({ json: { worldId: 'w', worldEpoch: epoch, characterId: id, timeZone: 'Asia/Shanghai', appointments: expired ? [] : [{ appointmentId: `a${id}`, startAt: 1788831000000, endAt: 1788832800000, location: `回访地点${id}`, status: 'accepted', availability }] } })
    if (delayIds.has(id)) { delayIds.delete(id); held.set(id, route); waiters.get(id)?.(route); waiters.delete(id); return }
    return route.fulfill({ json: base(id) })
  })
  await page.goto(`${origin}/test/town-schedule-view-fixture.html`)
  const card = id => page.locator('.status-card').filter({ hasText: `角色${id}` })
  const close = { click: () => page.locator('.drawer-overlay').click({ position: { x: 10, y: 10 } }) }
  await card(1).click(); const oldA = await take(1); held.delete(1)
  assert.equal(await page.locator('.drawer-panel').evaluate(el => el.contains(document.activeElement)), true, 'opening the real drawer must move keyboard focus inside')
  await close.click(); await page.locator('.drawer-overlay').waitFor({ state: 'hidden' })
  await card(2).click(); await page.locator('.tl-act').getByText('基础活动2', { exact: true }).waitFor()
  await oldA.fulfill({ json: base(1) })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.locator('.tl-act').innerText(), '基础活动2')
  assert.equal(await page.locator('.dr-info h3').innerText(), '角色2')
  assert.equal(await page.evaluate(() => fixture.store.currentSchedule.character_id), 2)
  // The old A error/finally must not clear B's loading skeleton either.
  await close.click(); await page.locator('.drawer-overlay').waitFor({ state: 'hidden' })
  delayIds.add(1); delayIds.add(2)
  await card(1).click(); const errorA = await take(1); held.delete(1)
  await close.click(); await page.locator('.drawer-overlay').waitFor({ state: 'hidden' })
  await card(2).click(); const newB = await take(2); held.delete(2)
  await errorA.fulfill({ status: 503, json: { error: 'old A failed' } })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.locator('.dr-skel').count(), 1)
  await newB.fulfill({ json: base(2) }); await page.locator('.tl-act').getByText('基础活动2', { exact: true }).waitFor()
  const baseCount = () => calls.filter(url => /^\/api\/schedule\/\d+$/.test(url)).length
  const before = baseCount(); epoch = 2
  await page.evaluate(() => fixture.world({ worldId: 'w', worldEpoch: 2 }))
  await page.waitForFunction(() => fixture.store.townOverlays?.worldEpoch === 2)
  assert.equal(baseCount(), before)
  assert.equal(await page.locator('.dr-overlays').getByText('回访地点2', { exact: true }).count(), 1)
  // Legacy mode need not emit town_state_updated when the base schedule changes.
  availability = 'needs_reconfirmation'
  const overviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/schedule')
  await page.evaluate(() => fixture.event('schedule_state_change', { characterId: 2 }))
  await overviewResponse
  await page.waitForFunction(() => !fixture.store.townOverlaysLoading)
  assert.equal(await page.evaluate(() => fixture.store.townOverlays.appointments[0].availability), 'needs_reconfirmation')
  assert.equal(baseCount(), before, 'schedule notification must not fetch/ensure the base detail')
  assert.equal(regenerations, 0)
  await page.evaluate(() => fixture.store.regenerateSchedule(2, 'fixture-only'))
  assert.equal(await page.evaluate(() => fixture.store.townOverlays.appointments[0].availability), 'currently_free')
  assert.equal(regenerations, 1, 'only the explicitly requested replan POST is allowed')
  // No SSE: the existing visible-page interval retires a naturally expired card.
  const baseBeforeTimer = baseCount(), overlayBeforeTimer = calls.filter(url => url.endsWith('/overlays')).length
  expired = true
  await page.clock.fastForward(60_000)
  await page.waitForFunction(() => fixture.store.townOverlays?.appointments.length === 0 && !fixture.store.townOverlaysLoading)
  assert.equal(await page.locator('.dr-overlays').count(), 0)
  assert.equal(baseCount(), baseBeforeTimer)
  assert.equal(calls.filter(url => url.endsWith('/overlays')).length, overlayBeforeTimer + 1)
  // Returning focus refreshes only the currently selected character's overlay too.
  expired = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => fixture.store.townOverlays?.appointments.length === 1 && !fixture.store.townOverlaysLoading)
  assert.equal(baseCount(), baseBeforeTimer)
  const lastControl = page.getByRole('button', { name: '重新读取回访', exact: true })
  await lastControl.focus(); await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('button', { name: '瞄一眼', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Shift+Tab'); assert.equal(await lastControl.evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Escape'); await page.locator('.drawer-overlay').waitFor({ state: 'hidden' })
  const afterClose = calls.length
  await page.evaluate(() => fixture.event('town_state_updated', { worldId: 'w', worldEpoch: 2 }))
  assert.equal(calls.length, afterClose, 'closed drawer must not keep reading overlays')
  const overlaysAfterClose = calls.filter(url => url.endsWith('/overlays')).length
  await page.clock.fastForward(60_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  assert.equal(calls.filter(url => url.endsWith('/overlays')).length, overlaysAfterClose)
  // Actual mount/unmount with the real dispatcher: owned subscriptions must be released.
  const counts = () => page.evaluate(() => ['schedule_peek_ready', 'schedule_peek_progress'].map(fixture.handlerCount))
  assert.deepEqual(await counts(), [1, 1])
  await page.evaluate(() => fixture.mount(false))
  assert.deepEqual(await counts(), [0, 0], 'normal unmount must unsubscribe both peek handlers')
  holdReset = true
  await page.evaluate(() => fixture.mount(true))
  for (let attempt = 0; !resetRoute && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(resetRoute)
  await page.evaluate(() => fixture.mount(false))
  const resetResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/schedule/reset-status')
  await resetRoute.fulfill({ json: { active: true, total: 9, current: 3, currentName: 'late reset' } })
  await resetResponse
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await counts(), [0, 0], 'late mounted continuation must not register handlers')
  assert.equal(await page.evaluate(() => fixture.store.resetTask), null, 'late reset status must not mutate the shared store')
  resetRoute = null
  await page.evaluate(() => fixture.mount(true))
  for (let attempt = 0; !resetRoute && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(resetRoute)
  await page.evaluate(() => fixture.mount(false))
  const failedResetResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/schedule/reset-status')
  await resetRoute.fulfill({ status: 503, json: { error: 'fixture late failure' } })
  await failedResetResponse
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await counts(), [0, 0], 'late reset failure must not fall through to subscriptions')
  holdReset = false
  await page.evaluate(() => fixture.mount(true))
  await page.waitForFunction(() => fixture.handlerCount('schedule_peek_ready') === 1)
  assert.deepEqual(await counts(), [1, 1], 'reentry owns exactly one pair')
  await page.evaluate(() => fixture.mount(false))
  assert.deepEqual(await counts(), [0, 0])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, scope: 'real ScheduleView card-click integration', baseGets: baseCount(), explicitRegenerations: regenerations, automaticRegeneration: false }))
} finally { await browser?.close(); await server.close() }
