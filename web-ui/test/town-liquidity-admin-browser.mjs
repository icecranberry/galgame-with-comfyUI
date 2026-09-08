// Real components and index API with synthetic HTTP only. Never enable real configuration.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia'] }, server: { hmr: false, host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, reducedMotion: 'reduce' })
  const origin = new URL(server.resolvedUrls.local[0]).origin, writes = [], errors = []
  const settings = { simulation: 'legacy', economyEnabled: false, liquidityEnabled: false }
  const liquidity = { enabled: false, limits: { reserve: 60, rolling24h: 30, rolling7d: 210, grossWorld: 600, circulation: 4000 }, grossIssued: 0, remainingWorldBudget: 600, issued24h: 0, issued7d: 0, availableFund: 59, activationAllowed: false }
  let readFailure = false
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request(), url = new URL(req.url()).pathname
    if (req.method() === 'PUT') {
      assert.equal(url, '/api/town/settings'); const body = req.postDataJSON(); writes.push(body)
      if (body.liquidityEnabled && liquidity.availableFund < liquidity.limits.reserve) return route.fulfill({ status: 409, json: { error: '开启公共基金保障至少需要60邻币可用准备金。' } })
      Object.assign(settings, body); liquidity.enabled = settings.liquidityEnabled
      return route.fulfill({ json: { applied: settings } })
    }
    assert.equal(req.method(), 'GET')
    if (url === '/api/town/settings') return route.fulfill({ status: readFailure ? 503 : 200, json: readFailure ? { error: 'failed' } : settings })
    if (url === '/api/town/liquidity') return route.fulfill({ json: { liquidity } })
    assert.ok(['/api/town/npcs', '/api/town/characters', '/api/town/player/kit'].includes(url), url)
    return route.fulfill({ json: {} })
  })
  await page.goto(`${origin}/test/town-liquidity-admin-fixture.html`)
  const open = page.getByRole('button', { name: '打开管理' }), close = page.getByRole('button', { name: '关闭', exact: true })
  const save = page.getByRole('button', { name: '保存设置', exact: true }), toggle = page.getByRole('switch', { name: '公共基金有限保障' })
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '保存设置' && !b.disabled))
  await open.tap(); await page.getByRole('button', { name: '设置', exact: true }).tap(); await ready()
  assert.equal(await toggle.isChecked(), false); assert.equal(writes.length, 0)
  await toggle.tap(); assert.equal(writes.length, 0)
  await save.tap(); await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /60邻币/)
  assert.equal(settings.liquidityEnabled, false); assert.equal(await page.getByText('设置已保存。').count(), 0)
  await close.tap(); await open.tap(); await ready(); assert.equal(await toggle.isChecked(), false)
  liquidity.availableFund = 60; liquidity.activationAllowed = true
  await page.getByRole('button', { name: '重新读取设置与基金状态' }).tap(); await ready()
  await toggle.tap(); await save.tap(); await page.getByText('设置已保存。').waitFor()
  assert.equal(settings.liquidityEnabled, true); assert.equal(writes.length, 2)
  await close.tap(); await open.tap(); await ready(); assert.equal(await toggle.isChecked(), true)
  Object.assign(liquidity.limits, { reserve: 75, rolling24h: 40, rolling7d: 280, grossWorld: 800, circulation: 5000 })
  Object.assign(liquidity, { grossIssued: 80, remainingWorldBudget: 720, issued24h: 12, issued7d: 70 })
  await page.getByRole('button', { name: '重新读取设置与基金状态' }).tap(); await ready()
  const status = page.locator('[aria-label="公共基金保障状态"]')
  for (const value of ['75', '40', '280', '800', '5000', '720']) assert.ok((await status.innerText()).includes(value))
  for (const [width, height] of [[375, 667], [375, 300], [740, 360]]) {
    await page.setViewportSize({ width, height }); await toggle.scrollIntoViewIfNeeded()
    const dialog = page.getByRole('dialog'), box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await toggle.tap(); await toggle.tap(); assert.equal(writes.length, 2)
    const out = path.resolve(root, '../output/hd2d-liquidity-admin'); await fs.mkdir(out, { recursive: true })
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) })
    await save.scrollIntoViewIfNeeded(); assert.ok(await save.isVisible())
  }
  readFailure = true; await close.tap(); await open.tap(); await page.getByRole('alert').waitFor()
  assert.equal(await save.isDisabled(), true); assert.equal(await toggle.isDisabled(), true)
  readFailure = false; await page.getByRole('button', { name: '重新读取设置与基金状态' }).tap(); await ready()
  assert.deepEqual(errors, []); assert.equal(writes.length, 2)
  console.log(JSON.stringify({ passed: true, writes: writes.length, realConfigurationTouched: false }))
} finally { await browser?.close(); await server.close() }
