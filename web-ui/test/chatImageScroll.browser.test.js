import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

test('双路SSE：图片先完成也要等两个文字气泡结束，再单独缓动入场', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  const { createServer } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue()], server: { host: '127.0.0.1', port: 0 } })
  await server.listen(); t.after(() => server.close())
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  t.after(() => browser.close())
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route(/\/api\//, route => new URL(route.request().url()).pathname.startsWith('/api/')
      ? route.fulfill({ contentType: 'application/json', body: '{}' }) : route.continue())
    await page.goto(`${server.resolvedUrls.local[0]}test/fixtures/chatImageScroll.html`)
    await page.waitForFunction(() => window.chatScrollFixture)
    await page.evaluate(width => { document.documentElement.dataset.theme = width < 768 ? 'dark' : 'warm' }, width)
    await page.waitForTimeout(2300)
    await page.evaluate(() => window.chatScrollFixture.controlledTurn())
    await page.waitForTimeout(600)
    await page.evaluate(() => {
      const f = window.chatScrollFixture
      f.imageEvent('generate_start')
      f.imageEvent('generate_done', { images: [{ url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="pink"/></svg>') }] })
      f.textEvent('token', { content: '第一句测试回复。' }); f.textEvent('bubble_break')
    })
    await page.getByText('第一句测试回复。', { exact: true }).waitFor()
    await page.waitForTimeout(450)
    assert.equal(await page.locator('.igb').count(), 0)
    await page.evaluate(() => window.chatScrollFixture.textEvent('token', { content: '第二句测试回复。' }))
    await page.getByText('第二句测试回复。', { exact: true }).waitFor()
    await page.waitForTimeout(450)
    assert.equal(await page.locator('.igb').count(), 0, '第二句话出现也不等于文字流已经结束')
    await page.evaluate(() => window.chatScrollFixture.endTurn())
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.igb').count(), 0, '最后一句文字与图片分开呈现')
    await page.locator('.igb-img').waitFor()
    await page.waitForTimeout(250)
    const list = page.locator('.message-list')
    assert.ok(await list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop > 5), '已完成的新图片仍有600ms跟随，而非直接跳底')
    await page.waitForTimeout(500)
    assert.ok(await list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 2))
    assert.equal(await page.evaluate(() => window.chatScrollFixture.chat.messages.at(-1).type), 'image_gen')
    assert.deepEqual(errors, [])
    await page.close()
  }
})

test('私聊图片从占位入场到慢速加载完成连续跟随，手动阅读不被抢回', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 }, async t => {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  const { createServer } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue()], server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  t.after(() => server.close())
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  t.after(() => browser.close())
  for (const width of [1280, 390]) for (const theme of ['warm', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route(/\/api\//, route => new URL(route.request().url()).pathname.startsWith('/api/')
      ? route.fulfill({ contentType: 'application/json', body: '{}' }) : route.continue())
    let releaseImage
    const imageGate = new Promise(resolve => { releaseImage = resolve })
    await page.route('**/scroll-test.svg', async route => {
      await imageGate
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="pink"/></svg>' })
    })
    await page.goto(`${server.resolvedUrls.local[0]}test/fixtures/chatImageScroll.html`)
    await page.waitForFunction(() => window.chatScrollFixture)
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.waitForTimeout(2300) // 历史首屏追底结束，不人为重置 scrollTop 或跟随状态。
    const list = page.locator('.message-list')
    // 独立生图事件会将图片插在对应消息后，后面可能已有文字；不能仅判断列表末项。
    await page.evaluate(() => window.chatScrollFixture.pending(true))
    await page.waitForTimeout(350)
    const mid = await list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
    await page.waitForTimeout(400)
    const end = await list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
    assert.ok(mid > 5 && end < 2, `${width}/${theme}: 图片占位应持续缓动 600ms，mid=${mid}, end=${end}`)
    const before = await list.evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight }))
    await page.evaluate(() => window.chatScrollFixture.done('/scroll-test.svg'))
    await page.waitForTimeout(250)
    const waiting = await list.evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight }))
    assert.deepEqual(waiting, before, '网络图片未加载时保留占位，不能先塌陷并跳动')
    releaseImage()
    await page.waitForFunction(() => document.querySelector('.igb-img')?.complete)
    await page.waitForTimeout(250)
    assert.ok(await list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop > 5), '图片实际撑高后也应有可见缓动')
    await page.evaluate(() => {
      const chat = window.chatScrollFixture.chat
      chat.messages.push({ id: 9001, type: 'text', role: 'assistant', content: '图片之后紧接着的文字。', created_at: '2026-11-05T10:01:00Z' })
    })
    await page.waitForTimeout(500)
    assert.ok(await list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 2), '慢速加载后仍跟随，不能误判为用户上翻')
    await list.hover()
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(300)
    const readingTop = await list.evaluate(el => el.scrollTop)
    await page.evaluate(() => window.chatScrollFixture.pending(false, .75))
    await page.waitForTimeout(750)
    assert.equal(await page.locator('.igb-pct').last().textContent(), '75%', '延迟挂载的生成气泡从真实进度开始')
    assert.ok(Math.abs(await list.evaluate(el => el.scrollTop) - readingTop) < 2, '上翻历史时不追底')
    await page.route('**/missing-scroll-test.svg', route => route.fulfill({ status: 404, body: 'missing' }))
    await page.evaluate(() => window.chatScrollFixture.done('/missing-scroll-test.svg'))
    await page.waitForFunction(() => document.querySelectorAll('.igb-missing').length === 1 && !document.querySelector('.igb-awaiting'))
    assert.ok(Math.abs(await list.evaluate(el => el.scrollTop) - readingTop) < 2, '加载失败也退出等待，且不抢回阅读位置')
    assert.deepEqual(errors, [])
    await page.close()
  }
})
