// Isolated Vite + synthetic HTTP fixtures. No backend, database, SSE or model calls.
// PLAYWRIGHT_MODULE can point to an existing playwright/core installation; BROWSER_CHANNEL defaults to msedge.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const server = await createServer({ configFile: false, root, plugins: [vue()], server: { hmr: false, watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 5192, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
const errors = [], calls = [], history = [{ role: 'npc', content: '欢迎来到小镇。' }]
let busyReject = false, fail = false, processing = false, lostAck = false, delay = 0, portraitVersion = 0
const requestIds = [], replies = new Map()
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><circle cx="90" cy="60" r="40" fill="#d4a08c"/><path d="M40 110H140V290H40Z" fill="#7fa88a"/></svg>')
page.on('pageerror', e => errors.push(e.message))
await page.route('http://127.0.0.1:5192/api/**', async route => {
  const request = route.request(), url = new URL(request.url()).pathname
  calls.push([request.method(), url])
  const json = data => route.fulfill({ json: data })
  if (/\/npcs\/\d+$/.test(url)) return json({ npc: { characterId: url.endsWith('/2') ? 42 : null, portrait: portraitVersion ? { status: 'ready', image_path: '/fixture-portrait.svg', meta: { updatedAt: portraitVersion } } : null } })
  if (url.endsWith('/messages')) return json({ messages: history })
  if (url.endsWith('/kit')) return json({ portrait: null })
  if (url.endsWith('/chat')) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const payload = request.postDataJSON()
    assert(payload.clientMessageId)
    assert.equal(payload.worldId,'fixture'); assert.equal(payload.worldEpoch,1)
    requestIds.push(payload.clientMessageId)
    if (busyReject) return route.fulfill({status:409,json:{error:'正在提供服务',code:'NPC_BUSY'}})
    if (fail) return route.fulfill({ status: 409, json: { error: 'fixture failure', code: 'DIALOGUE_FAILED' } })
    if (processing) return route.fulfill({ status: 409, json: { error: 'fixture processing', code: 'DIALOGUE_PROCESSING' } })
    if (replies.has(payload.clientMessageId)) return json(replies.get(payload.clientMessageId))
    history.push({ role: 'user', content: request.postDataJSON().message }, { role: 'npc', content: '沿着街道散散步吧。'.repeat(35) })
    const result = { reply: history.at(-1).content, source: 'fixture', requestId: payload.clientMessageId }
    replies.set(payload.clientMessageId,result)
    if (lostAck) return route.abort('failed')
    return json(result)
  }
  throw new Error(`Unexpected API ${url}`)
})
await page.route('**/fixture-portrait.svg?*', route => route.fulfill({ contentType: 'image/svg+xml', body: decodeURIComponent(svg.split(',')[1]) }))
const output = path.resolve(root, '../output/hd2d-m2-npc')
try {
  await page.goto('http://127.0.0.1:5192/test/town-dialogue-fixture.html')
  const input = page.getByRole('textbox', { name: '对话内容' })
  await input.waitFor()
  await page.waitForFunction(() => !document.querySelector('input').disabled)
  await input.fill('你好')
  await input.dispatchEvent('compositionstart')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  assert.equal(calls.filter(c => c[0] === 'POST').length, 0)
  await input.dispatchEvent('compositionend')
  await input.press('w')
  assert.equal(await page.evaluate(() => fixture.keys), 0)
  delay = 150
  await input.press('Enter')
  await page.getByRole('button', { name: '发送', exact: true }).dispatchEvent('click')
  await page.waitForFunction(() => !document.querySelector('input').disabled)
  assert.equal(calls.filter(c => c[0] === 'POST').length, 1)
  await page.getByRole('button', { name: '历史', exact: true }).click()
  assert.equal(await page.locator('article').count(), 3)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('article').count(), 1)
  await fs.mkdir(output, { recursive: true })
  await page.screenshot({ path: path.join(output, 'desktop.png') })
  for (const viewport of [{ width: 390, height: 844 }, { width: 740, height: 360 }, { width: 390, height: 300 }]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => document.querySelector('input').getBoundingClientRect().bottom <= innerHeight)
    const box = await input.boundingBox()
    assert(box.y >= 0 && box.x >= 0 && box.x + box.width <= viewport.width)
    await page.screenshot({ path: path.join(output, `${viewport.width}x${viewport.height}.png`) })
  }
  fail = true
  await input.fill('发送失败测试')
  await input.press('Enter')
  await page.getByRole('alert').waitFor()
  assert(await input.isDisabled())
  await page.getByRole('button', { name: '重新读取记录' }).click()
  await page.waitForFunction(() => !document.querySelector('input').disabled)
  assert.equal(calls.filter(c => c[0] === 'POST').length, 2)
  fail = false; processing = true
  await input.fill('仍在处理中'); await input.press('Enter')
  await page.getByRole('button',{name:'重试同一条消息'}).waitFor()
  await page.getByRole('button',{name:'重新读取记录'}).click()
  assert(await input.isDisabled())
  processing = false
  await page.getByRole('button',{name:'重试同一条消息'}).click()
  await page.waitForFunction(()=>!document.querySelector('input').disabled)
  assert.equal(requestIds.at(-1),requestIds.at(-2))
  assert.notEqual(requestIds.at(-1),requestIds[1])
  lostAck = true
  await input.fill('响应丢失'); await input.press('Enter')
  await page.getByRole('button',{name:'重试同一条消息'}).waitFor()
  const committedLength = history.length
  await page.getByRole('button',{name:'关闭对话'}).click()
  await page.evaluate(()=>{fixture.open.value=true})
  await page.getByRole('button',{name:'重试同一条消息'}).waitFor()
  lostAck = false
  await page.getByRole('button',{name:'重试同一条消息'}).click()
  await page.waitForFunction(()=>!document.querySelector('input').disabled)
  assert.equal(history.length,committedLength)
  assert.equal(requestIds.at(-1),requestIds.at(-2))

  await page.evaluate(()=>{fixture.busy.value=true})
  assert(await input.isDisabled())
  await page.evaluate(()=>{fixture.busy.value=false})
  await page.waitForFunction(()=>!document.querySelector('input').disabled)
  await page.evaluate(() => { fixture.id.value = 2 })
  await page.waitForFunction(() => fixture.linked === 42)
  assert(!calls.some(c => c[1] === '/api/town/npcs/2/messages' || c[1] === '/api/town/npcs/2/chat'))
  await page.setViewportSize({ width: 1100, height: 700 })
  portraitVersion = 1
  await page.evaluate(() => { fixture.id.value = 1 })
  await page.waitForFunction(() => !document.querySelector('input').disabled)
  await page.getByRole('button', { name: '放大小满立绘' }).click()
  await page.getByRole('button', { name: '关闭立绘' }).waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭立绘')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.td-zoom').count(), 0)
  await page.locator('.td-portraits img').dispatchEvent('error')
  assert.equal(await page.locator('.td-portraits img').count(), 0)
  portraitVersion = 2
  await page.evaluate(() => { fixture.id.value = 2 })
  await page.waitForFunction(() => fixture.linked === 42)
  // Late replies after switching identity must not appear in the new dialogue.
  fail = false; delay = 350
  await page.evaluate(() => { fixture.id.value = 1 })
  await page.waitForFunction(() => !document.querySelector('input').disabled)
  await input.fill('旧请求')
  await input.press('Enter')
  await page.evaluate(() => { fixture.id.value = 2 })
  await page.waitForTimeout(500)
  assert.equal(await page.locator('article').count(), 0)
  await page.evaluate(()=>{fixture.id.value=1})
  await page.waitForFunction(()=>!document.querySelector('input').disabled)
  busyReject=true
  await input.fill('服务中拒绝');await input.press('Enter')
  await page.getByText('居民正在提供工坊服务，请稍后重新打开对话。',{exact:true}).waitFor()
  assert(await input.isDisabled())
  assert.equal(await page.getByRole('button',{name:'重试同一条消息'}).count(),0)
  await page.getByRole('button', { name: '查看居民近况' }).click()
  assert.equal(await page.evaluate(() => fixture.activityOpened), 1)
  assert.deepEqual(errors, [])
  console.log('PASS: fixture API routing, identity precedence, history, IME, duplicate submit, failure/reload, stale response, keyboard isolation, desktop/mobile layout')
} finally { await browser.close(); await server.close() }


