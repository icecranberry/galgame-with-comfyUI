// Only run after the shared performance window ends. Real drawer/store; mocked HTTP.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
// Expose the real dispatcher only inside this fixture, without editing unifiedStream.
const events = { name: 'schedule-fixture-events', transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/src/stores/unifiedStream.js')) return code + '\nexport const __fixtureDispatch = _dispatch;' } }
const server = await createServer({ configFile: false, root, plugins: [events, vue()], optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia'] }, server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' })
  const origin = new URL(server.resolvedUrls.local[0]).origin, calls = [], errors = []
  let epoch = 1, worldId = 'w', overlayFailure = false, baseFailure = false, empty = false, heldResolve, holdNext = false, holdBaseId = null, baseResolve
  page.on('pageerror', e => errors.push(e.message))
  const dto = id => ({ worldId, worldEpoch: epoch, characterId: id, timeZone: 'Asia/Shanghai', appointments: empty ? [] : [{ appointmentId: `private-${id}`, startAt: Date.UTC(2026, 8, 8, 1, 30), endAt: Date.UTC(2026, 8, 8, 2), location: `工坊${id}`, status: 'accepted', availability: id === 1 ? 'currently_free' : 'needs_reconfirmation', reason: 'PRIVATE_CODE' }] })
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request(), url = new URL(req.url()).pathname; assert.equal(req.method(), 'GET'); calls.push(url)
    const match = url.match(/^\/api\/schedule\/(\d+)(\/overlays)?$/); assert.ok(match, url)
    const id = Number(match[1])
    if (match[2]) {
      if (holdNext) { holdNext = false; heldResolve(route); return }
      return route.fulfill({ status: overlayFailure ? 503 : 200, json: overlayFailure ? { error: 'unavailable' } : dto(id) })
    }
    if (id === holdBaseId) { holdBaseId = null; baseResolve(route); return }
    return route.fulfill({ status: baseFailure ? 503 : 200, json: baseFailure ? {} : { character_id: id, activities: [{ startTime: '08:00', activity: `原活动${id}`, location: '书房', isCurrent: true }] } })
  })
  await page.goto(`${origin}/test/town-schedule-fixture.html`)
  const overlay = page.getByRole('region', { name: '已接受的回访安排' })
  await overlay.getByText('工坊1', { exact: true }).waitFor()
  assert.match(await overlay.innerText(), /09:30/); assert.match(await overlay.innerText(), /北京时间/)
  assert.doesNotMatch(await overlay.innerText(), /private|PRIVATE_CODE/)
  assert.equal(await page.locator('.dr-timeline .tl-item').count(), 1)
  await page.getByRole('button', { name: '瞄一眼', exact: true }).click()
  assert.equal(await page.evaluate(() => fixture.peek.activity), '原活动1')
  const baseCount = () => calls.filter(url => !url.endsWith('/overlays')).length
  const before = baseCount()
  overlayFailure = true; await page.evaluate(() => fixture.world({ worldId: 'w', worldEpoch: 1 }))
  await page.getByText('回访安排暂时无法读取，原日程不受影响。').waitFor()
  assert.equal(baseCount(), before); assert.equal(await page.locator('.tl-act').innerText(), '原活动1')
  overlayFailure = false
  const held = new Promise(resolve => { heldResolve = resolve }); holdNext = true
  await page.getByRole('button', { name: '重新读取回访' }).click(); const old = await held
  await page.evaluate(() => { fixture.id.value = 2 }); await overlay.getByText('工坊2', { exact: true }).waitFor()
  await old.fulfill({ json: dto(1) }).catch(() => {})
  assert.doesNotMatch(await overlay.innerText(), /工坊1/); assert.match(await overlay.innerText(), /需重新确认/)
  const heldEpoch = new Promise(resolve => { heldResolve = resolve }); holdNext = true
  await page.getByRole('button', { name: '重新读取回访' }).click(); const stale = await heldEpoch
  const oldDto = dto(2); epoch = 2
  await page.evaluate(() => fixture.world({ worldId: 'w', worldEpoch: 2 })); await overlay.getByText('工坊2', { exact: true }).waitFor()
  await stale.fulfill({ json: oldDto }).catch(() => {})
  assert.equal(await page.evaluate(() => fixture.store.townOverlays.worldEpoch), 2)
  assert.equal(baseCount(), before + 1)
  // A lost reset notification must not pin the store to its last SSE epoch.
  epoch = 3
  await page.getByRole('button', { name: '重新读取回访' }).click()
  await page.waitForFunction(() => fixture.store.townOverlays?.worldEpoch === 3)
  epoch = 2
  await page.getByRole('button', { name: '重新读取回访' }).click()
  await page.getByText('小镇已更新，请重新读取回访安排。').waitFor()
  assert.equal(await page.evaluate(() => fixture.store.townOverlays), null)
  epoch = 3
  await page.getByRole('button', { name: '重新读取回访' }).click()
  await page.waitForFunction(() => fixture.store.townOverlays?.worldEpoch === 3)
  worldId = 'new-world'; epoch = 1
  await page.getByRole('button', { name: '重新读取回访' }).click()
  await page.waitForFunction(() => fixture.store.townOverlays?.worldId === 'new-world')
  assert.equal(baseCount(), before + 1)
  const out = path.resolve(root, '../output/hd2d-schedule-overlays'); await fs.mkdir(out, { recursive: true })
  for (const [width, height] of [[375, 667], [740, 360]]) {
    await page.setViewportSize({ width, height }); await overlay.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
  }
  const heldClose = new Promise(resolve => { heldResolve = resolve }); holdNext = true
  await page.getByRole('button', { name: '重新读取回访' }).click(); const closedRead = await heldClose
  const beforeClose = dto(2)
  await page.evaluate(() => { fixture.open.value = false }); empty = true
  await page.evaluate(() => { fixture.open.value = true })
  await page.waitForFunction(() => !fixture.store.townOverlaysLoading)
  await closedRead.fulfill({ json: beforeClose }).catch(() => {})
  assert.equal(await overlay.count(), 0)
  empty = true; await page.evaluate(() => fixture.world({ worldId: 'new-world', worldEpoch: 1 }))
  await page.waitForFunction(() => !fixture.store.townOverlaysLoading)
  assert.equal(await overlay.count(), 0)
  // Base failure must still reject; overlay success is not a replacement schedule.
  baseFailure = true; await page.evaluate(() => { fixture.id.value = 3 })
  await page.waitForFunction(() => document.querySelector('[data-base-error]').textContent.includes('503'))
  assert.equal(await page.locator('.tl-item').count(), 0)
  baseFailure = false
  const delayedBase = new Promise(resolve => { baseResolve = resolve }); holdBaseId = 4
  await page.evaluate(() => { fixture.id.value = 4 }); const oldBase = await delayedBase
  await page.evaluate(() => { fixture.id.value = 5 })
  await page.waitForFunction(() => fixture.store.currentSchedule?.character_id === 5)
  await oldBase.fulfill({ json: { character_id: 4, activities: [{ activity: '旧角色4', isCurrent: true }] } })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => fixture.store.currentSchedule.character_id), 5)
  assert.equal(await page.locator('.tl-act').innerText(), '原活动5')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, baseGets: baseCount(), overlayGets: calls.length - baseCount() }))
} finally { await browser?.close(); await server.close() }
