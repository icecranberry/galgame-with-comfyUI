import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia'] }, server: { hmr: false, watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = new URL(server.resolvedUrls.local[0]).origin
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = [], commands = [], unknown = []
  let holdMovement = false, releaseMovement, signalMovement
  const scope = { worldId: 'fixture', worldEpoch: 1 }
  const locations = ['board', 'raw', 'shop'].map((key, i) => ({ key, id: i + 1, name: ['公告站', '原料站', '木木工坊'][i], x: i + 3, y: 4, radius: 2 }))
  const agents = [{ actorId: 'resident', agentKey: 'char:1', characterId: 1, displayName: '木木', kind: 'char', x: 6, y: 5, sleeping: false, activityText: '在工坊整理材料', locationName: '木木工坊', path: [], speed: 1 }]
  const map = { id: 1, cols: 12, rows: 12, version: 1, name: '隔离小镇', layers: { ground: [], objects: [], blocking: [] }, assets: [] }
  page.on('pageerror', error => errors.push(error.message))
  const routeHandler = async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin) { unknown.push(req.url()); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const endpoint = url.pathname.replace('/api/town/', '')
    if (req.method() !== 'GET') {
      commands.push({ endpoint, body: req.postDataJSON() })
      if (endpoint === 'player/move' && holdMovement) {
        holdMovement = false
        const released = new Promise(resolve => { releaseMovement = resolve })
        signalMovement()
        await released
        return route.fulfill({ status: 409, json: { error: '旧世界移动已失效', code: 'STALE_WORLD' } })
      }
      return route.fulfill({ json: { ok: true } })
    }
    const payloads = {
      state: { ...scope, enabled: true, initialized: true, serverTime: Date.now(), map, locations, agents, encountersActive: [],
        player: { actorId: 'player', agentKey: 'me', displayName: '我', x: 5, y: 5, path: [], speed: 1 } },
      map, npcs: { npcs: [] }, characters: { characters: [] }, settings: { enabled: true, simulation: 'legacy' },
      'player/kit': {}, assets: { assets: [] },
      liquidity: { ...scope, liquidity: null },
      economy: { ...scope, enabled: true, configured: true, wallet: { balance: 30, available: 30, reserved: 0 }, orders: [], locations,
        slice: { reward: 30, locationKeys: { board: 'board', supplier: 'raw', workshop: 'shop' } }, participants: [],
        service: { providerActorId: 'resident', locationKey: 'shop', open: true, sessions: [], hours: '09:00–18:00（北京时间）' } },
      appointments: { ...scope, candidates: [], appointments: [] },
      deliveries: { ...scope, items: [{ eventId: 'failed-record', consumerKey: 'town.experience', consumerName: '经历记录',
        sourceType: 'town.service.settled', status: 'dead', attempts: 5, occurredAt: Date.now(), lastErrorCode: 'DELIVERY_FAILED' }], nextCursor: null },
      'actors/resident/activities': { ...scope, actorId: 'resident', activities: [], experiences: [{ eventId: 'experience', occurredAt: Date.now(), summary: '你们一起完成了工坊制作。' }], nextCursor: null },
    }
    if (!(endpoint in payloads)) { unknown.push(endpoint); return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } }) }
    return route.fulfill({ json: payloads[endpoint] })
  }
  await page.route('**/*', routeHandler)
  await page.goto(`${origin}/test/town-view-fixture.html`)
  await page.waitForFunction(() => window.fixture?.town.loaded && !document.querySelector('.town-boot-mask'))
  await page.getByRole('button', { name: '生活', exact: true }).click()
  await page.getByRole('dialog', { name: '小镇生活' }).waitFor()
  await page.keyboard.press('w')
  assert.equal(commands.length, 0, 'life panel must lock map movement')
  await page.getByRole('button', { name: '查看回访邀请与预约' }).click()
  await page.getByRole('dialog', { name: '免费回访' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: '小镇生活' }).count(), 0)
  await page.keyboard.press('w')
  assert.equal(commands.length, 0, 'appointment panel must keep movement lock')
  await page.getByRole('button', { name: '关闭免费回访' }).click()
  // Canvas compatibility projection: resident is one grid east of player; hit its torso.
  await page.locator('.town-canvas').click({ position: { x: 550 + 48, y: 380 + 24 - 20 } })
  await page.getByRole('dialog', { name: '邻居资料' }).waitFor()
  await page.getByRole('button', { name: '居民近况', exact: true }).click()
  await page.getByRole('dialog', { name: '居民近况' }).waitFor()
  await page.getByText('你们一起完成了工坊制作。', { exact: true }).waitFor()
  await page.keyboard.press('w')
  assert.equal(commands.length, 0, 'activity panel must lock map movement')
  await page.evaluate(() => { fixture.town.snapshot = { ...fixture.town.snapshot, worldEpoch: 2 } })
  assert.equal(await page.getByRole('dialog', { name: '居民近况' }).count(), 0)
  const out = path.resolve(root, '../output/hd2d-town-view'); await fs.mkdir(out, { recursive: true })
  for (const [width, height] of [[1100, 760], [375, 667], [740, 360]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('button', { name: '生活', exact: true }).click()
    await page.getByRole('button', { name: '查看回访邀请与预约' }).click()
    const panel = page.getByRole('dialog', { name: '免费回访' })
    await panel.waitFor()
    const box = await panel.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1)
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
    await page.getByRole('button', { name: '关闭免费回访' }).click()
  }
  await page.setViewportSize({ width: 1100, height: 760 })
  scope.worldEpoch = 2
  await page.getByRole('button', { name: '生活', exact: true }).click()
  await page.getByRole('dialog', { name: '小镇生活' }).waitFor()
  scope.worldEpoch = 3
  await page.evaluate(() => { fixture.town.snapshot = { ...fixture.town.snapshot, worldEpoch: 3 } })
  assert.equal(await page.getByRole('dialog', { name: '小镇生活' }).count(), 0)
  await page.getByRole('button', { name: '生活', exact: true }).click()
  holdMovement = true
  const movementStarted = new Promise(resolve => { signalMovement = resolve })
  await page.getByRole('button', { name: '前往', exact: true }).first().click()
  await movementStarted
  scope.worldEpoch = 4
  await page.evaluate(() => { fixture.town.snapshot = { ...fixture.town.snapshot, worldEpoch: 4 } })
  await page.getByRole('button', { name: '生活', exact: true }).click()
  await page.getByRole('dialog', { name: '小镇生活' }).waitFor()
  releaseMovement()
  await page.waitForLoadState('networkidle')
  assert.equal(await page.locator('.town-dialogue-notice').count(), 0, 'old movement failure cannot appear in new world')
  assert.equal(commands.length, 1, 'only explicit travel generated a command')
  await page.evaluate(() => fixture.unmount())
  const touch = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true })
  touch.on('pageerror', error => errors.push(error.message))
  await touch.route('**/*', routeHandler)
  await touch.goto(`${origin}/test/town-view-fixture.html`)
  await touch.waitForFunction(() => window.fixture?.town.loaded && !document.querySelector('.town-boot-mask'))
  assert.equal(await touch.evaluate(() => matchMedia('(pointer:coarse)').matches), true)
  assert.notEqual(await touch.locator('.town-view').evaluate(el => getComputedStyle(el).transform), 'none')
  await touch.getByRole('button', { name: '生活', exact: true }).click()
  await touch.getByRole('button', { name: '查看回访邀请与预约' }).click()
  const touchPanel = touch.getByRole('dialog', { name: '免费回访' })
  await touchPanel.waitFor()
  const touchBox = await touchPanel.boundingBox()
  assert.ok(touchBox.x >= 0 && touchBox.y >= 0 && touchBox.x + touchBox.width <= 376 && touchBox.y + touchBox.height <= 668)
  await touch.screenshot({ path: path.join(out, 'touch-portrait.png') })
  await touch.getByRole('button', { name: '关闭免费回访' }).tap()
  await touch.getByRole('button', { name: '管理', exact: true }).tap()
  await touch.getByRole('button', { name: '设置', exact: true }).tap()
  await touch.getByRole('button', { name: '查看记录投递状态' }).tap()
  await touch.getByRole('dialog', { name: '记录投递状态' }).waitFor()
  await touch.getByRole('button', { name: '重新投递', exact: true }).waitFor()
  await touch.keyboard.press('w')
  assert.equal(commands.length, 1, 'diagnostics reads and keys never retry or move')
  await touch.screenshot({ path: path.join(out, 'touch-diagnostics.png') })
  await touch.getByRole('button', { name: '关闭记录投递状态' }).tap()
  await touch.getByRole('dialog', { name: '小镇管理', exact: true }).waitFor()
  await touch.evaluate(() => fixture.unmount())
  await touch.close()
  assert.deepEqual(errors, []); assert.deepEqual(unknown, [])
  console.log('PASS: real TownView mount, life to appointments, canvas resident activity, input locks, epoch close, three viewports, unmount')
} finally { await browser?.close(); await server.close() }
