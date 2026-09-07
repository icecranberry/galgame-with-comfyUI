// Usage: node test/hd2d-browser.mjs. PLAYWRIGHT_MODULE may point to an existing install.
// Isolated Vite fixture; never starts the backend, SSE, generation or DB writes.
import { createServer } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const output = process.env.HD2D_TEST_OUTPUT || path.resolve(root, '../output/hd2d-m1')
await fs.mkdir(output, { recursive: true })
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5189, strictPort: true }, plugins: [{ name: 'fixture-assets', configureServer(server) { server.middlewares.use('/fixture-assets', async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1)
  if (!/^asset_\d+_[\w]+\.png$/.test(name)) { res.writeHead(400).end(); return }
  if (process.env.TOWN_REAL_ASSETS !== '1') {
    const ground = /grass|plaza/.test(name)
    const shape = ground ? `<path d="M32 0L64 16L32 32L0 16Z" fill="${name.includes('grass') ? '#8daf6c' : '#c9b490'}" stroke="#f5f4ee"/>` : name.includes('residential') ? '<path d="M8 38L32 10L56 38V92H8Z" fill="#b78d6b"/><path d="M4 38L32 4L60 38Z" fill="#855645"/><path d="M25 66H39V92H25Z" fill="#504839"/>' : '<circle cx="32" cy="18" r="12" fill="#b47d53"/><path d="M20 30H44L49 70H40V94H32V70H25V94H16Z" fill="#566b56"/>'
    res.setHeader('Content-Type', 'image/svg+xml')
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="${ground ? 32 : 96}">${shape}</svg>`); return
  }
  try { const data = await fs.readFile(path.resolve(root, '../agent-core/data/town/assets', name)); res.setHeader('Content-Type', 'image/png'); res.end(data) }
  catch { res.writeHead(404).end() }
}) } }] })
await server.listen()
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) })
const page = await browser.newPage({ viewport: { width: 1100, height: 650 }, deviceScaleFactor: 1 })
const errors = [], results = {}
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })
try {
  await page.goto('http://127.0.0.1:5189/test/hd2d-fixture.html')
  await page.waitForFunction(() => window.probe?.renderer?.textures.size >= 4 && [...probe.renderer.textures.values()].every(t => t.ready || t.failed))
  await page.screenshot({ path: path.join(output, 'day.png') })
  results.render = await page.evaluate(() => {
    const r = probe.renderer; probe.draw()
    const p = r.project({ x: 7.5, y: 0.8, z: 9.5 })
    const hit = r.pick(p)
    return { glError: r.renderer.getContext().getError(), geometries: r.renderer.info.memory.geometries, textures: r.renderer.info.memory.textures, pick: hit?.kind, agent: hit?.agent?.agentKey, loaded: [...r.textures.values()].filter(t => t.ready).length }
  })
  assert.equal(results.render.loaded, 4)
  assert.equal(results.render.glError, 0)
  assert.equal(results.render.agent, 'npc:34')
  results.agentMotion = await page.evaluate(() => {
    const r = probe.renderer
    probe.moving = true; probe.nowMs = 0; probe.draw()
    const mesh = r.agents.get('me'), base = mesh.position.y, contact = mesh.userData.contact.position.y
    probe.nowMs = Math.PI * 55; probe.draw()
    const rise = mesh.position.y - base
    const result = { rise, contactDelta: mesh.userData.contact.position.y - contact, samples: r.composer.readBuffer.samples, alphaToCoverage: mesh.material.alphaToCoverage, mipmaps: mesh.material.map.generateMipmaps }
    probe.moving = false; probe.nowMs = 0; probe.draw()
    return result
  })
  assert(Math.abs(results.agentMotion.rise - 2.2 / (32 * Math.SQRT2 * Math.cos(Math.PI / 6))) < 1e-8)
  assert.equal(results.agentMotion.contactDelta, 0)
  assert(results.agentMotion.samples > 1 && results.agentMotion.alphaToCoverage && results.agentMotion.mipmaps)

  results.shadowContrast = await page.evaluate(() => {
    const r = probe.renderer, gl = r.renderer.getContext()
    r.setQuality('balanced', false)
    const read = () => {
      probe.draw()
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
      return pixels
    }
    const shadow = read(); r.sun.castShadow = false; const lit = read(); r.sun.castShadow = true
    let changedPixels = 0, maxDelta = 0
    for (let i = 0; i < lit.length; i += 4) {
      const delta = (lit[i]+lit[i+1]+lit[i+2]-shadow[i]-shadow[i+1]-shadow[i+2])/3
      if (delta > 35) changedPixels++
      maxDelta = Math.max(maxDelta, delta)
    }
    r.setQuality('balanced', true); probe.draw()
    return { changedPixels, maxDelta }
  })
  assert(results.shadowContrast.changedPixels > 1000, 'directional shadows must produce substantial visible street coverage')
  assert(results.shadowContrast.maxDelta > 60, 'directional shadows must retain strong light/dark contrast')
  await page.evaluate(() => { probe.weather.hour = 21 })
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(output, 'night.png') })
  await page.evaluate(() => { probe.weather.hour = 17; probe.weather.text = '雨' })
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(output, 'rain-dusk.png') })
  results.chunk = await page.evaluate(() => {
    const r = probe.renderer, old = r.chunks.get('road:0:0:2')
    probe.map.layers.objects[0].x++
    r.setScene(probe.map); probe.draw()
    return old === r.chunks.get('road:0:0:2')
  })
  assert(results.chunk, 'object edit must preserve unchanged terrain chunks')
  await page.evaluate(() => { probe.renderer.setQuality('low', false) })
  results.low = await page.evaluate(async () => {
    const samples = []; let last = performance.now()
    for (let i = 0; i < 60; i++) await new Promise(resolve => requestAnimationFrame(now => { samples.push(now - last); last = now; resolve() }))
    samples.sort((a,b) => a-b)
    return { p50: samples[30], p95: samples[57], shadows: probe.renderer.renderer.shadowMap.enabled }
  })
  assert.equal(results.low.shadows, true)
  results.largeMap = await page.evaluate(async () => {
    const r = probe.renderer
    const map = { ...probe.map, cols: 50, rows: 50, layers: { ...probe.map.layers, ground: Array.from({ length: 50 }, () => Array(50).fill(1)), road: [], objects: Array.from({ length: 40 }, (_, i) => ({ id: `building:${i}`, assetId: 3, x: (i % 8) * 6, y: Math.floor(i / 8) * 8 + 4 })) } }
    r.setScene(map); r.setCamera({ x: 0, y: 800, zoom: 0.5 })
    for (let i = 0; i < 24; i++) probe.agents.push({ ...probe.agents[0], agentKey: `fixture:${i}`, x: i * 2, y: 25 })
    const samples = []; let last = performance.now()
    for (let i = 0; i < 60; i++) await new Promise(resolve => requestAnimationFrame(now => { samples.push(now - last); last = now; resolve() }))
    samples.sort((a,b) => a-b)
    return { p50: samples[30], p95: samples[57], chunks: r.chunks.size, agents: r.agents.size, geometries: r.renderer.info.memory.geometries, textures: r.renderer.info.memory.textures, glError: r.renderer.getContext().getError() }
  })
  assert.equal(results.largeMap.chunks, 16)
  assert.equal(results.largeMap.glError, 0)
  await page.screenshot({ path: path.join(output, 'large-map-low.png') })
  results.disposed = await page.evaluate(() => { const r = probe.renderer; r.dispose(); return { ...r.renderer.info.memory } })
  assert.equal(results.disposed.geometries, 0)
  assert.equal(results.disposed.textures, 0)
  assert.equal(await page.locator('canvas').count(), 0)

  await page.goto('http://127.0.0.1:5189/test/hd2d-fixture.html?street=1')
  await page.waitForFunction(() => window.probe?.renderer?.textures.size >= 8 && [...probe.renderer.textures.values()].every(t => t.ready || t.failed))
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(output, 'street-day.png') })
  results.street = await page.evaluate(() => {
    const r = probe.renderer
    return { proxies: [...r.objects.values()].filter(m => m.userData.shadowProxy).length, duplicateShadows: [...r.objects.values()].some(m => m.userData.shadowProxy && m.castShadow), depthTexture: !!r.composer.readBuffer.depthTexture, glError: r.renderer.getContext().getError() }
  })
  assert.equal(results.street.proxies, 8)
  assert.equal(results.street.duplicateShadows, false)
  assert.equal(results.street.glError, 0)
  await page.evaluate(() => { probe.renderer.setQuality('balanced', false) })
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'street-no-dof.png') })
  await page.evaluate(() => { probe.renderer.setQuality('balanced', true); probe.weather.hour = 17 })
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'street-sunset.png') })
  results.propFeet = await page.evaluate(() => {
    const r = probe.renderer
    probe.weather.hour = 12
    r.setQuality('balanced', false)
    r.setCamera({ x: -144, y: 450, zoom: 3.2 })
    probe.draw()
    return ['flower:a', 'flower:b', 'lamp:13:13', 'bench'].map(id => {
      const m = r.objects.get(id), v = m.userData.footV
      const footHeight = m.position.y + (.5 - v) * m.scale.y
      const contact = m.userData.contact.position
      const foot = r.project({ x: contact.x, y: 0, z: contact.z })
      const dto = m.userData.dto, expected = r.project(dto.ground)
      const paddingPixels = (1 - v) * dto.width / (m.material.map.image.width / m.material.map.image.height) * 3.2
      const g = m.userData.projectedShadow.geometry.attributes.position
      const mix = axis => ((g[axis](0) + g[axis](1)) * (1 - v) + (g[axis](2) + g[axis](3)) * v) / 2
      const shadowFootError = Math.hypot(mix('getX') - m.position.x, mix('getZ') - m.position.z)
      return { id, v, footHeight, shadowFootError, alignmentError: Math.abs(foot.y - (expected.y - paddingPixels)), castShadow: m.castShadow || !!m.userData.projectedShadow?.visible }
    })
  })
  for (const foot of results.propFeet) {
    assert(Math.abs(foot.footHeight) < 1e-8, `${foot.id} visible base must touch ground`)
    assert(foot.alignmentError < 1e-6, `${foot.id} ground contact must match visible screen foot ${JSON.stringify(foot)}`)
    assert(foot.shadowFootError < 1e-5, `${foot.id} projected silhouette must attach to the visible foot`)
    assert(foot.castShadow)
  }
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'prop-feet.png') })
  await page.evaluate(() => {
    probe.map.layers.objects = probe.map.layers.objects.filter(o => ['flower:a', 'flower:b', 'tree:8:17', 'lamp:13:13', 'bench'].includes(o.id))
    probe.renderer.setScene(probe.map); probe.draw()
  })
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'props-detail.png') })
  results.occlusion = await page.evaluate(() => {
    const r = probe.renderer
    probe.map.layers.objects = [{ id: 'occluder', assetId: 3, x: 4, y: 6 }]
    probe.agents.length = 0
    probe.player.x = 7; probe.player.y = 6
    r.setScene(probe.map); r.setCamera({ x: 0, y: 176, zoom: 2.5 }); probe.draw()
    const building = r.objects.get('occluder'), character = r.agents.get('me')
    const front = { building: building.renderOrder, character: character.renderOrder, fade: building.material.userData.townFade.value }
    const orders = []
    probe.moving = true
    for (let i = 0; i < 12; i++) { probe.nowMs = i * 30; probe.draw(); orders.push(character.renderOrder - building.renderOrder) }
    probe.moving = false; probe.nowMs = 0; probe.draw()
    return { front, orders, depthTest: character.material.depthTest }
  })
  assert(results.occlusion.front.character > results.occlusion.front.building)
  assert.equal(results.occlusion.front.fade, 1)
  assert(results.occlusion.orders.every(order => order > 0))
  assert.equal(results.occlusion.depthTest, false)
  await page.screenshot({ path: path.join(output, 'character-front.png') })
  results.occlusion.behind = await page.evaluate(() => {
    probe.player.x = 5; probe.player.y = 5; probe.draw()
    const r = probe.renderer, building = r.objects.get('occluder'), character = r.agents.get('me')
    return { building: building.renderOrder, character: character.renderOrder, fade: building.material.userData.townFade.value }
  })
  assert(results.occlusion.behind.character < results.occlusion.behind.building)
  assert.equal(results.occlusion.behind.fade, .32)
  results.behindPick = await page.evaluate(() => {
    const r = probe.renderer, m = r.agents.get('me')
    const point = r.project({ x: m.position.x, y: .9, z: m.position.z })
    return r.pick(point, { agentsOnly: true })?.agent?.agentKey
  })
  assert.equal(results.behindPick, 'me')
  await page.screenshot({ path: path.join(output, 'character-behind.png') })

  await page.evaluate(() => probe.renderer.dispose())

  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (!pathname.startsWith('/api/')) return route.continue()
    let response = pathname.endsWith('/assets') ? { assets: await page.evaluate(() => probe.map.assets.map(a => ({ ...a, imagePath: undefined, image_path: a.imagePath, status: 'ready', name: `素材${a.id}` }))) } : {}
    if (pathname.endsWith('/npcs/34')) response = { npc: { portrait: { status: 'ready', image_path: '/fixture-assets/asset_278_npc_34_portrait.png' } } }
    if (pathname.endsWith('/player/kit')) response = { portrait: { id: 293, status: 'ready', image_path: '/fixture-assets/asset_293_player_portrait.png' }, sprites: {} }
    if (pathname.endsWith('/player/portrait') || pathname.includes('/player/sprites/')) {
      (results.playerManagement ||= []).push(pathname)
      response = { kit: { portrait: { id: 293, status: 'ready', image_path: '/fixture-assets/asset_293_player_portrait.png' }, sprites: {} } }
    }
    if (pathname.endsWith('/npcs')) response = { npcs: [{ id: 34, display_name: '邻居', displayName: '邻居', persona: '第一段人设。\n第二段人设。', routine: [] }] }
    if (pathname.endsWith('/npcs/34/messages')) response = { messages: [{ role: 'npc', content: '午后的风很舒服，要一起去广场走走吗？' }] }
    if (pathname.endsWith('/npcs/34/chat')) response = { reply: '好呀，我们慢慢走。' }
    if (pathname.endsWith('/town/map') && route.request().method() === 'PUT') results.savedMap = route.request().postDataJSON()
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
  })
  await page.goto('http://127.0.0.1:5189/test/hd2d-fixture.html?page=1')
  await page.waitForFunction(() => document.querySelectorAll('canvas').length === 2)
  assert.equal(await page.getByLabel('镜头俯视角度').count(), 0)
  await page.getByText('管理', { exact: true }).click()
  const admin = page.getByRole('dialog', { name: '小镇管理', exact: true })
  await admin.getByText('我（玩家）', { exact: true }).click()
  await admin.getByRole('button', { name: '重新生成我的立绘', exact: true }).click()
  await admin.getByRole('button', { name: '重生成正面小人', exact: true }).click()
  await admin.getByRole('button', { name: '重生成背面小人', exact: true }).click()
  assert.deepEqual(results.playerManagement, ['/api/town/player/portrait', '/api/town/player/sprites/down', '/api/town/player/sprites/up'])
  await page.screenshot({ path: path.join(output, 'player-management.png') })
  await admin.getByRole('button', { name: '← 返回', exact: true }).click()
  await admin.locator('.ap-row').filter({ hasText: '邻居' }).click()
  assert.equal(await admin.locator('.ap-persona').evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap')
  assert((await admin.locator('.ap-persona').textContent()).includes('\n'))
  await admin.getByLabel('关闭', { exact: true }).click()
  const quality = page.getByLabel('小镇画质')
  // Repeated switches release each old renderer; world subscriptions remain untouched.
  for (let i = 0; i < 20; i++) {
    await quality.click(); await page.getByText('兼容画面', { exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 1)
    await quality.click(); await page.getByText('HD2D', { exact: true }).last().click()
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 2)
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(output, 'town-page.png') })
  // A short viewport puts the entering input below the visible bottom. Focusing it
  // must not scroll the hidden-overflow world or shift either canvas upward.
  await page.setViewportSize({ width: 1100, height: 450 })
  await page.waitForFunction(() => document.querySelector('.town-canvas').getBoundingClientRect().height === 450)
  const worldBeforeDialog = await page.locator('.town-canvas').boundingBox()
  await page.locator('.town-canvas').click({ position: { x: 502, y: 147 } })
  await page.getByRole('dialog', { name: '与邻居对话', exact: true }).waitFor()
  results.dialogMotion = await page.locator('.npc-stage').evaluate(el => ({
    fadeDuration: getComputedStyle(el).transitionDuration,
    portraits: [...el.querySelectorAll('.nc-portrait')].map(p => getComputedStyle(p).transitionDuration),
    panelDuration: getComputedStyle(el.querySelector('.nc-main')).transitionDuration,
  }))
  assert.equal(results.dialogMotion.fadeDuration, '0.3s')
  assert(results.dialogMotion.portraits.every(duration => duration === '0.3s'))
  assert.equal(results.dialogMotion.panelDuration, '0.3s')
  await page.waitForFunction(() => !document.querySelector('.npc-stage-enter-active'))
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '对话内容')
  assert.deepEqual(await page.locator('.town-canvas').boundingBox(), worldBeforeDialog)
  results.dialogWorld = await page.locator('.town-view').evaluate(el => ({ scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, canvasTops: [...el.querySelectorAll('canvas')].map(c => c.getBoundingClientRect().top) }))
  assert.equal(results.dialogWorld.scrollTop, 0)
  assert.equal(results.dialogWorld.scrollLeft, 0)
  assert(results.dialogWorld.canvasTops.every(top => top === worldBeforeDialog.y))
  assert(await page.locator('.nc-input-row').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), 'input must fit inside the world even in short windows')
  assert(await page.locator('.nc-main').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), 'dialog must not overflow its grid row')
  await page.screenshot({ path: path.join(output, 'dialog-short-viewport.png') })
  await page.setViewportSize({ width: 1100, height: 650 })
  await page.waitForFunction(() => [...document.querySelectorAll('.nc-portrait img')].length === 2 && [...document.querySelectorAll('.nc-portrait img')].every(img => img.complete && img.naturalWidth))
  await page.getByLabel('对话内容').fill('一起去广场吧。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('好呀，我们慢慢走。', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'npc-dialog-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'npc-dialog-mobile.png') })
  assert(await page.locator('.nc-main').evaluate(el => el.getBoundingClientRect().right <= innerWidth))
  const movesBeforeDismiss = await page.evaluate(() => probe.moves.length)
  await page.locator('.nc-portrait-left').click()
  assert.equal(await page.locator('.npc-stage').count(), 1)
  await page.locator('.npc-stage').click({ position: { x: 200, y: 95 } })
  assert(await page.locator('.npc-stage').evaluate(el => el.classList.contains('npc-stage-leave-active')))
  await page.locator('.npc-stage').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => probe.moves.length), movesBeforeDismiss, 'dismiss must not move the player')
  await page.setViewportSize({ width: 1100, height: 650 })

  // Use the shared select through its actual UI.
  await quality.click(); await page.getByText('兼容画面', { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('canvas').length === 1)
  await page.screenshot({ path: path.join(output, 'canvas-page.png') })
  await quality.click(); await page.getByText('HD2D', { exact: true }).last().click()
  await page.waitForFunction(() => document.querySelectorAll('canvas').length === 2)
  const world = page.locator('.town-canvas')
  await world.click({ position: { x: 630, y: 360 } })
  assert.equal(await page.evaluate(() => probe.moves.length), 1)
  await page.getByText('编辑', { exact: true }).click()
  await page.getByText('建筑', { exact: true }).click()
  await page.getByText('素材3', { exact: true }).click()
  await world.click({ position: { x: 715, y: 450 } })
  await page.screenshot({ path: path.join(output, 'editor.png') })
  await page.getByText('保存地图', { exact: true }).click()
  await page.getByText('编辑', { exact: true }).waitFor()
  assert.equal(results.savedMap.layers.objects.length, 3)
  results.savedMap = { objects: results.savedMap.layers.objects, locations: results.savedMap.locations }
  results.page = await page.evaluate(() => ({ starts: probe.starts, stops: probe.stops, moves: probe.moves }))
  assert.equal(results.page.starts, 1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(output, 'mobile.png') })
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => { probe.app.unmount(); probe.mount() })
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 2)
  }
  results.lifecycle = await page.evaluate(() => ({ starts: probe.starts, stops: probe.stops, canvases: document.querySelectorAll('canvas').length }))
  assert.deepEqual(results.lifecycle, { starts: 21, stops: 20, canvases: 2 })
  // Context loss is a real GPU event, not a simulated UI preference.
  await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(c => c !== document.querySelector('.town-canvas'))
    canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
  })
  await page.getByRole('status').filter({ hasText: '兼容画面' }).waitFor()
  assert.equal(await page.locator('canvas').count(), 1)
  await page.evaluate(() => probe.app.unmount())
  assert.equal(await page.evaluate(() => probe.stops), 21)
  const noGl = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await noGl.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args) }
  })
  await noGl.goto('http://127.0.0.1:5189/test/hd2d-fixture.html?page=1')
  await noGl.getByRole('status').filter({ hasText: '无法启用 HD2D' }).waitFor()
  assert.equal(await noGl.locator('canvas').count(), 1)
  await noGl.close()
  results.errors = errors
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { if (errors.length) console.error('Browser errors:', errors); await browser.close(); await server.close() }
