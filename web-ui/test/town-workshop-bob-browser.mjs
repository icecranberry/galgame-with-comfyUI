import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue'] }, server: { host: '127.0.0.1', port: 0, hmr: false } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' })
  const origin = new URL(server.resolvedUrls.local[0]).origin, posts = [], errors = []
  let available = false, open = true, enabled = true, lost = true, session = null
  const names = { 'town.workshop': '心情修复贴', 'town.workshop.bob_cut': '波波头发型卡' }
  page.on('pageerror', e => errors.push(e.message))
  await page.route(`${origin}/api/**`, async route => {
    const request = route.request(), url = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      if (url.endsWith('/economy')) return route.fulfill({ json: { enabled, worldId: 'fixture', worldEpoch: 1,
        service: { open, sessions: session ? [session] : [], catalog: Object.entries(names).map(([serviceKey, name]) => ({ serviceKey, name, description: '固定工坊制作', price: 30, available: serviceKey === 'town.workshop' || available, reason: serviceKey !== 'town.workshop' && !available ? 'SERVICE_LOCKED' : null })) } } })
      assert.equal(url, `/api/town/services/${session.sessionId}`)
      return route.fulfill({ json: session })
    }
    const body = request.postDataJSON(); posts.push({ url, body })
    assert.equal(url, '/api/town/services/offer')
    assert.equal(body.serviceKey, 'town.workshop.bob_cut')
    session ||= { sessionId: 'bob-session', worldId: 'fixture', worldEpoch: 1, serviceKey: body.serviceKey,
      serviceName: names[body.serviceKey], serviceDescription: '冻结的发型卡服务说明', status: 'offered', version: 1, phaseKey: 'theme', turns: [], choices: [] }
    if (lost) return route.abort('failed')
    return route.fulfill({ json: session })
  })
  const output = path.resolve(root, '../output/hd2d-b-workshop-ui')
  await fs.mkdir(output, { recursive: true })
  const capture = async (name, target = null) => {
    if (target) await target.scrollIntoViewIfNeeded()
    else await page.locator('.td-body').evaluate(el => { el.scrollTop = 0 })
    await page.screenshot({ path: path.join(output, name + '.png') })
  }
  const button = name => page.getByRole('button', { name, exact: true })
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重新读取服务' && !b.disabled))
  await page.goto(`${origin}/test/town-workshop-fixture.html`); await ready()
  assert.equal(posts.length, 0)
  assert.ok(await button('波波头发型卡').isDisabled())
  assert.ok(await page.getByText('波波头发型卡：首次工坊生产真实完成后解锁。', { exact: true }).isVisible())
  await capture('375-locked')
  available = true; open = false
  await button('重新读取服务').click(); await ready()
  await button('波波头发型卡').click()
  assert.ok(await button('查看本次报价（不收费）').isDisabled(), 'unlock is not proof of opening')
  open = true; enabled = false; await button('重新读取服务').click(); await ready()
  assert.ok(await button('查看本次报价（不收费）').isDisabled(), 'economic switch still gates new offers')
  enabled = true; await button('重新读取服务').click(); await ready()
  assert.match(await page.getByLabel('服务收费与退款规则').innerText(), /30 邻币 · 1 份材料/)
  await capture('375-unlocked')
  await capture('375-unlocked-offer-action', button('查看本次报价（不收费）'))
  await page.setViewportSize({ width: 740, height: 360 })
  await capture('740-available')
  await capture('740-available-offer-action', button('查看本次报价（不收费）'))
  await page.setViewportSize({ width: 375, height: 667 })
  await button('查看本次报价（不收费）').click(); await button('重试同一次服务操作').waitFor(); await ready()
  const original = structuredClone(posts[0].body)
  await page.reload(); await button('重试同一次服务操作').waitFor(); await ready()
  assert.equal(posts.length, 1, 'reopening never resends automatically')
  assert.equal(await page.getByLabel('选择工坊服务').count(), 0, 'pending offer cannot change selection')
  lost = false; await button('重试同一次服务操作').click(); await button('接受服务并支付 30 邻币').waitFor(); await ready()
  assert.deepEqual(posts[1].body, original)
  assert.match(await page.getByLabel('服务收费与退款规则').innerText(), /波波头发型卡/)
  await capture('375-bob-quote')
  await capture('375-bob-quote-accept', button('接受服务并支付 30 邻币'))
  // Restore a completed frozen session while the catalog is now locked/closed.
  session.status = 'completed'; session.settlement = { paid: 30, payout: 30, refund: 0, itemIds: [42] }
  available = false; open = false; enabled = false
  await page.evaluate(() => { fixture.sessionId.value = 'bob-session' }); await ready()
  await button('回到小镇').click(); await button('打开工坊').click(); await page.getByLabel('服务结算收据').waitFor(); await ready()
  assert.match(await page.locator('.town-dialogue-stage').innerText(), /手动使用后.*24 小时/)
  assert.match(await page.locator('.town-dialogue-stage').innerText(), /本次不新增免费回访/)
  assert.match(await page.locator('.town-dialogue-stage').innerText(), /冻结的发型卡服务说明/)
  assert.equal(posts.length, 2)
  assert.equal(await page.getByLabel('选择工坊服务').count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await capture('375-bob-receipt', page.getByLabel('服务结算收据'))
  await page.setViewportSize({ width: 740, height: 360 })
  await capture('740-bob-receipt', page.getByLabel('服务结算收据'))
  await button('回到小镇').scrollIntoViewIfNeeded(); assert.ok(await button('回到小镇').isVisible())
  // An old DTO without new fields always remains the old mood outcome.
  delete session.serviceKey; delete session.serviceName; delete session.serviceDescription
  await button('重新读取服务').click(); await ready()
  assert.equal(await page.getByText('心情修复贴', { exact: true }).count(), 1)
  assert.doesNotMatch(await page.locator('.town-dialogue-stage').innerText(), /24 小时/)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, posts: posts.length, identicalBobOfferRetry: true, frozenSessionRecovery: true, viewports: ['375x667', '740x360'], screenshots: output }))
} finally { await browser?.close(); await server.close() }
