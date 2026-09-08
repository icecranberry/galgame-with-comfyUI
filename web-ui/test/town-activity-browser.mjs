// Real Vue/Edge with isolated HTTP fixtures; no backend or model calls.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
// Exercise main's real api/index.js re-export.
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue'] }, server: { hmr: false, host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } })
  const origin = new URL(server.resolvedUrls.local[0]).origin, errors = [], requests = []
  let fail = false, epoch = 1, worldId = 'w', delayed = null, hold = false, holdNext, heldResolve, actorReason = 'PATH_UNREACHABLE', weatherRows = null
  page.on('pageerror', error => errors.push(error.message))
  const row = (seq, phase, reasonCode) => ({ seq, phase, reasonCode, actionId: 'secret-uuid', eventId: `event-${seq}`, ruleKey: 'technical.rule', ruleVersion: 1, locationKey: 'internal-place', occurredAt: 1788804000000, result: { sql: 'SELECT secret' } })
  await page.route(`${origin}/api/**`, async route => {
    assert.equal(route.request().method(), 'GET')
    const url = new URL(route.request().url()), actorId = url.pathname.split('/').at(-2), cursor = url.searchParams.get('cursor')
    requests.push({ actorId, cursor })
    if (holdNext) { holdNext = false; heldResolve(route); return }
    if (hold && actorId === 'a') { delayed = route; return }
    if (fail) return route.fulfill({ status: 503, json: { error: 'SQL secret' } })
    return route.fulfill({ json: { worldId, worldEpoch: epoch, actorId,
      activities: actorId === 'b' ? weatherRows || [row(9, 'failed', actorReason)] : cursor === '0' ? [row(1, 'running', 'START'), row(2, 'completed', 'DURATION_ELAPSED')] : [row(2, 'completed', 'DURATION_ELAPSED'), row(3, 'failed', 'UNKNOWN_INTERNAL_REASON')],
      experiences: [{ eventId: 'secret-event', summary: actorId === 'b' ? '完成了花园配送。' : '送达材料，获得 30 邻币。', occurredAt: 1788804000000 }], nextCursor: actorId === 'a' && cursor === '0' ? 2 : null } })
  })
  await page.goto(`${origin}/test/town-activity-fixture.html`)
  const trigger = page.getByRole('button', { name: '查看居民近况', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog'), refresh = page.getByRole('button', { name: '重新读取', exact: true })
  await page.getByText('本次行动的计时已完成；这不代表报酬已结算。').waitFor()
  assert.match(await dialog.innerText(), /正在工作/)
  await page.evaluate(() => { fixture.actor.value.action.phase = 'reserved' })
  await page.getByRole('region', { name: '此刻' }).getByText('准备行动', { exact: true }).waitFor()
  assert.doesNotMatch(await page.getByRole('region', { name: '此刻' }).innerText(), /正在工作/)
  await page.evaluate(() => { fixture.actor.value.action.phase = 'running' })
  assert.doesNotMatch(await dialog.innerText(), /secret|technical|SELECT|internal-place/)
  await page.getByRole('button', { name: '加载更多' }).click()
  await page.getByText('具体缘由暂未提供。').waitFor()
  assert.equal(await page.getByRole('region', { name: '行动缘由' }).locator('li').count(), 3)
  assert.equal(await page.getByRole('region', { name: '近期已结算经历' }).locator('li').count(), 1)
  fail = true; await refresh.click(); await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('region', { name: '行动缘由' }).locator('li').count(), 3)
  assert.doesNotMatch(await page.getByRole('alert').innerText(), /SQL/)
  fail = false; await refresh.click(); await page.getByRole('button', { name: '加载更多' }).waitFor()
  epoch = 2; await page.getByRole('button', { name: '加载更多' }).click()
  await page.getByText('小镇已更新，请重新读取居民记录。').waitFor()
  assert.equal(await page.getByRole('region', { name: '行动缘由' }).locator('li').count(), 0)
  await refresh.click(); await page.getByRole('button', { name: '加载更多' }).waitFor()
  hold = true; await refresh.click()
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'))
  await page.evaluate(() => { fixture.actor.value = { actorId: 'b', displayName: '小满', activityText: '在花园附近' } })
  await page.getByText('完成了花园配送。').waitFor()
  if (delayed) await delayed.fulfill({ json: { worldId: 'w', worldEpoch: 1, actorId: 'a', activities: [], experiences: [{ eventId: 'old', summary: '旧居民响应' }], nextCursor: null } }).catch(() => {})
  assert.doesNotMatch(await dialog.innerText(), /旧居民响应|阿禾/)
  for (const [width, height] of [[375, 667], [740, 360]]) {
    await page.setViewportSize({ width, height })
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    const out = path.resolve(root, '../output/hd2d-m3-activity'); await fs.mkdir(out, { recursive: true })
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
  }
  await page.getByRole('button', { name: '关闭居民近况' }).focus()
  await page.keyboard.press('Shift+Tab'); assert.equal(await refresh.evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Tab'); assert.equal(await page.getByRole('button', { name: '关闭居民近况' }).evaluate(el => el === document.activeElement), true)
  const keys = await page.evaluate(() => fixture.keys)
  await page.keyboard.press('w'); assert.equal(await page.evaluate(() => fixture.keys), keys)
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
  await trigger.click(); await page.getByText('完成了花园配送。').waitFor()
  // Even the first response must match the world scope supplied by the caller.
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
  await page.evaluate(() => { fixture.actor.value = { ...fixture.actor.value, worldId: 'new-world', worldEpoch: 3 } })
  await trigger.click(); await page.getByText('小镇已更新，请重新读取居民记录。').waitFor()
  assert.equal(await page.getByRole('region', { name: '近期已结算经历' }).locator('li').count(), 0)
  worldId = 'new-world'; epoch = 3
  await refresh.click(); await page.getByText('完成了花园配送。').waitFor()
  // Same actor, epoch changes while its old request is still pending.
  const held = new Promise(resolve => { heldResolve = resolve }); holdNext = true
  await refresh.click(); const oldRoute = await held
  epoch = 4
  await page.evaluate(() => { fixture.actor.value.worldEpoch = 4 })
  await page.getByText('完成了花园配送。').waitFor()
  await oldRoute.fulfill({ json: { worldId: 'new-world', worldEpoch: 3, actorId: 'b', activities: [], experiences: [{ eventId: 'old-epoch', summary: '旧世界响应' }], nextCursor: null } }).catch(() => {})
  assert.doesNotMatch(await dialog.innerText(), /旧世界响应/)
  const beforeWorldChange = requests.length
  worldId = 'another-world'
  await page.evaluate(() => { fixture.actor.value.worldId = 'another-world' })
  await page.getByText('完成了花园配送。').waitFor()
  assert.equal(requests.length, beforeWorldChange + 1)
  // First-page refresh with the correct world but the wrong epoch is rejected too.
  epoch = 5; await refresh.click(); await page.getByText('小镇已更新，请重新读取居民记录。').waitFor()
  assert.equal(await page.getByRole('region', { name: '近期已结算经历' }).locator('li').count(), 0)
  await page.evaluate(() => { fixture.actor.value.worldEpoch = 5 })
  await page.getByText('完成了花园配送。').waitFor()
  for (const [code, text] of [['SIMULATION_SCOPE_ENDED', '本次居民行动安排已结束，原行动已停止。'], ['MEMBERSHIP_CHANGED', '居民的参与状态已变化，原行动已停止。'], ['SERVICE_ACCEPTED', '已接受工坊服务，原行动让位于本次接待。']]) {
    actorReason = code; await refresh.click(); await page.getByText(text, { exact: true }).waitFor()
    assert.doesNotMatch(await dialog.innerText(), new RegExp(code))
  }
  // Only a canonical weather rule and valid UTC millisecond suffix get the purpose label.
  weatherRows = ['town.weather.shelter:1788804000000', 'town.weather.shelter:1788804000000:extra',
    'fake.town.weather.shelter:1788804000000', 'town.weather.shelter:NaN', 'town.weather.shelter:8640000000000001',
    'town.weather.shelter:01', 'town.weather.shelter:1.5'].map((ruleKey, i) => ({ ...row(20 + i, i === 0 ? 'running' : 'cancelled', i === 0 ? 'START' : 'SCHEDULE_CHANGED'), ruleKey }))
  await refresh.click(); await page.getByText('本次行动用于回家避雨。', { exact: true }).waitFor()
  assert.equal(await page.getByText('本次行动用于回家避雨。', { exact: true }).count(), 1)
  const history = page.getByRole('region', { name: '行动缘由' })
  assert.match(await history.locator('li').first().innerText(), /进行中/)
  assert.match(await history.locator('li').first().innerText(), /行动已开始。/)
  assert.match(await history.locator('li').nth(1).innerText(), /安排变化，原行动已停止。/)
  assert.doesNotMatch(await history.innerText(), /town\.weather|1788804000000|已到家|现在仍下雨|日程变化/)
  await page.setViewportSize({ width: 375, height: 667 })
  await history.locator('li').first().scrollIntoViewIfNeeded()
  const weatherOut = path.resolve(root, '../output/hd2d-m3-activity'); await fs.mkdir(weatherOut, { recursive: true })
  await page.screenshot({ path: path.join(weatherOut, '375-weather-shelter.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, requests: requests.length, viewports: ['375x667', '740x360'] }))
} finally { await browser?.close(); await server.close() }
