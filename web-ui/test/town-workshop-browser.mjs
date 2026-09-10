import { checkWorkshopBoundary } from './town-request-boundaries.mjs'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const plugins = [vue()]
const server = await createServer({ configFile: false, root, plugins, optimizeDeps: { noDiscovery: true, include: ['vue'] }, server: { hmr: false, watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = new URL(server.resolvedUrls.local[0]).origin
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } })
  const posts = [], errors = [], receipts = new Map()
  let loseAck = false, balance = 90, worldEpoch = 1, session = null, sessionCount = 0, resolving = false, economyEnabled = false, serviceOpen = false
  const choices = { theme: ['choose_theme', 'clarify', 'cancel'], materials: ['confirm_materials', 'clarify', 'cancel'], crafting: ['craft', 'clarify', 'cancel'], delivery: ['deliver', 'clarify', 'cancel'] }
  const update = () => { session.choices = session.status === 'active' ? choices[session.phaseKey] : []; session.dialogue = session.status === 'active' ? '按照你的心意，一起完成这件小作品。' : '' }
  page.on('pageerror', e => errors.push(e.message))
  await page.route(`${origin}/api/**`, async route => {
    const req = route.request(), url = new URL(req.url()).pathname
    if (req.method() === 'GET') {
      if (url.endsWith('/economy')) return route.fulfill({ json: { enabled: economyEnabled, worldId: 'fixture', worldEpoch, service: { open: serviceOpen, hours: '09:00–18:00（北京时间）', sessions: session ? [session] : [] } } })
      assert.equal(url, `/api/town/services/${session.sessionId}`)
      return route.fulfill({ json: session })
    }
    const body = req.postDataJSON(); posts.push({ url, body })
    assert.equal(body.worldEpoch, worldEpoch); assert.ok(body.idempotencyKey)
    assert.equal('actorId' in body, false)
    await new Promise(resolve => setTimeout(resolve, 100))
    if (receipts.has(body.idempotencyKey)) return route.fulfill({ json: receipts.get(body.idempotencyKey) })
    const action = url.split('/').at(-1)
    if (action === 'offer') {
      session = { sessionId: `s${++sessionCount}`, worldId: 'fixture', worldEpoch, status: 'offered', phaseKey: 'theme', version: 1,
        template: { price: 30, maxTurns: 8 }, turnCount: 0, materialsConsumed: false, crafted: false, settlement: null, choices: [], dialogue: '', turns: [] }
    } else {
      assert.equal(body.expectedVersion, session.version)
      if (action === 'accept') { balance -= 30; session.status = 'active' }
      if (action === 'turn') {
        assert.ok(session.choices.includes(body.intentKey)); session.turnCount++
        session.turns.push({ clientTurnId: body.idempotencyKey, input: body, response: { dialogue: '好，就按这个想法来。' } })
        if (body.intentKey === 'choose_theme') session.phaseKey = 'materials'
        if (body.intentKey === 'confirm_materials') { session.phaseKey = 'crafting'; session.materialsConsumed = true }
        if (body.intentKey === 'craft') { session.phaseKey = 'delivery'; session.crafted = true }
        if (body.intentKey === 'deliver') {
          session.status = 'completed'; session.settlement = { paid: 30, payout: 30, refund: 0, itemIds: [42] }
        }
        if (resolving) session.status = 'resolving'
      }
      if (action === 'cancel') {
        const paid = session.status === 'offered' ? 0 : 30, fee = session.materialsConsumed ? 10 : 0
        balance += paid - fee; session.status = 'cancelled'; session.settlement = { paid, payout: fee, refund: paid - fee, itemIds: [] }
      }
      session.version++
    }
    update(); const response = structuredClone(session); receipts.set(body.idempotencyKey, response)
    if (loseAck) return route.abort('failed')
    return route.fulfill({ json: response })
  })
  const button = name => page.getByRole('button', { name, exact: true })
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重新读取服务' && !b.disabled))
  await page.goto(`${origin}/test/town-workshop-fixture.html`)
  await ready(); assert.equal(posts.length, 0)
  assert.ok(await page.getByText('工坊暂未营业，请稍后再来', { exact: true }).isVisible())
  assert.ok(await page.getByText('· 09:00–18:00（北京时间）', { exact: true }).isVisible())
  assert.ok(await button('查看本次报价（不收费）').isDisabled())
  economyEnabled = true; serviceOpen = true; await button('重新读取服务').click(); await ready()
  assert.match(await page.getByLabel('服务收费与退款规则').innerText(), /制作前取消全退 30/)
  assert.match(await page.getByLabel('服务收费与退款规则').innerText(), /退回 20/)
  await button('查看本次报价（不收费）').click(); await button('接受服务并支付 30 邻币').waitFor(); await ready()
  assert.equal(posts.length, 1); assert.equal(balance, 90)
  economyEnabled = false; serviceOpen = false; await button('重新读取服务').click(); await ready()
  assert.ok(await button('接受服务并支付 30 邻币').isDisabled())
  assert.ok(await button('谢绝本次服务').isEnabled())
  economyEnabled = true; await button('重新读取服务').click(); await ready()
  loseAck = true
  await button('接受服务并支付 30 邻币').focus(); await button('接受服务并支付 30 邻币').evaluate(element => { element.click(); element.click() })
  await button('重试同一次服务操作').waitFor(); await ready(); assert.equal(balance, 60); assert.equal(posts.length, 2)
  assert.equal(await page.locator('.town-dialogue-stage').evaluate(el => el.contains(document.activeElement)), true, 'service transition must retain keyboard focus')
  const acceptId = posts.at(-1).body.idempotencyKey
  await page.reload(); await button('重试同一次服务操作').waitFor(); await ready()
  loseAck = false
  await button('重试同一次服务操作').click(); await button('选好主题，继续').waitFor(); await ready()
  assert.equal(posts.at(-1).body.idempotencyKey, acceptId); assert.equal(balance, 60)
  economyEnabled = false; await button('重新读取服务').click(); await ready()
  assert.ok(await button('选好主题，继续').isEnabled())
  await page.evaluate(id => { fixture.sessionId.value = id }, session.sessionId); await ready()
  const beforeReopen = posts.length
  await button('回到小镇').click(); await button('打开工坊').click()
  await button('选好主题，继续').waitFor(); await ready()
  assert.equal(posts.length, beforeReopen); assert.equal(session.status, 'active')
  const input = page.getByRole('textbox', { name: '对话内容' })
  await input.fill('我喜欢雨后的主题'); await input.press('w')
  assert.equal(await page.evaluate(() => fixture.keys), 0)
  await input.press('Enter'); await ready(); assert.equal(posts.at(-1).body.intentKey, 'clarify')
  await button('选好主题，继续').click(); await button('确认材料并开始制作').waitFor(); await ready()
  assert.match(await page.getByLabel('服务收费与退款规则').innerText(), /点击「确认材料并开始制作」后/)
  const output = path.resolve(root, '../output/hd2d-m5-workshop'); await fs.mkdir(output, { recursive: true })
  await page.screenshot({ path: path.join(output, 'materials-desktop.png') })
  await button('确认材料并开始制作').click(); await button('完成制作').waitFor(); await ready()
  await button('完成制作').click(); await button('收下心情修复贴').waitFor(); await ready()
  await button('收下心情修复贴').click(); await page.getByLabel('服务结算收据').waitFor(); await ready()
  assert.match(await page.getByLabel('服务结算收据').innerText(), /原有背包/)
  assert.equal(await button('收下心情修复贴').count(), 0); assert.equal(await input.count(), 0)
  for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 740, height: 360 }, { width: 375, height: 300 }]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => document.querySelector('.td-panel').getBoundingClientRect().bottom <= innerHeight)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(output, `${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1100, height: 820 })
  async function newService() {
    economyEnabled = true; serviceOpen = true
    await button('回到小镇').click(); await page.evaluate(() => { fixture.sessionId.value = null })
    await button('打开工坊').click(); await ready()
    await button('查看本次报价（不收费）').click(); await button('接受服务并支付 30 邻币').waitFor(); await ready()
    await button('接受服务并支付 30 邻币').click(); await button('选好主题，继续').waitFor(); await ready()
    economyEnabled = false; await button('重新读取服务').click(); await ready()
  }
  await newService()
  await button('取消服务').click(); const beforeCancel = posts.length
  assert.match(await page.getByLabel('确认取消服务').innerText(), /退回全部 30/)
  assert.equal(posts.length, beforeCancel)
  await button('确认取消服务').click(); await ready(); assert.equal(session.settlement.refund, 30)
  await newService()
  await button('选好主题，继续').click(); await button('确认材料并开始制作').waitFor(); await ready()
  await button('确认材料并开始制作').click(); await button('完成制作').waitFor(); await ready()
  await button('取消服务').click(); assert.match(await page.getByLabel('确认取消服务').innerText(), /退回 20/)
  await button('确认取消服务').click(); await ready(); assert.equal(session.settlement.payout, 10); assert.equal(session.settlement.refund, 20)
  await newService(); resolving = true
  await button('选好主题，继续').click(); await ready()
  assert.equal(await button('确认材料并开始制作').count(), 0); assert.equal(await input.count(), 0)
  const beforeRead = posts.length
  await button('重新读取服务').click(); await ready(); assert.equal(posts.length, beforeRead)
  session.status = 'failed'; session.settlement = { paid: 30, payout: 0, refund: 30, itemIds: [] }; update()
  await button('重新读取服务').click(); await ready()
  assert.match(await page.getByLabel('服务结算收据').innerText(), /已退回 30/)
  await button('回到小镇').click(); await button('打开工坊').click(); await ready()
  economyEnabled = true; await button('重新读取服务').click(); await ready()
  loseAck = true
  await button('查看本次报价（不收费）').click(); await button('重试同一次服务操作').waitFor(); await ready()
  worldEpoch = 2
  const beforeEpoch = posts.length
  await button('重新读取服务').click(); await ready()
  assert.equal(await button('重试同一次服务操作').count(), 0)
  assert.equal(posts.length, beforeEpoch)
  assert.match(await page.locator('.td-error').innerText(), /小镇已更新/)
  await checkWorkshopBoundary(browser, origin)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, posts: posts.length, screenshots: output }))
} finally { await browser?.close(); await server.close() }
