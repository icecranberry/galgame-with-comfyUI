import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

test('头像选择与裁剪：页签过渡、返回、异步保存和双主题窄屏', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  const { createServer } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">
    import { createApp, h, reactive } from 'vue'
    import Avatar from '/src/components/AvatarCropper.vue'
    import '/src/styles/tokens.css'
    import '/src/styles/base.css'
    import '/src/styles/components.css'
    import '/src/styles/animations.css'
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fa806f'; ctx.fillRect(0, 0, 800, 600)
    const image = canvas.toDataURL()
    const state = reactive({ open: true, recent: 0, saved: '', closed: 0 })
    window.avatarFixture = state
    createApp({ render: () => state.open ? h(Avatar, {
      title: '设置头像', characterId: 1, showRecentTab: true, showGenerateTab: true, recentImages: [image],
      generateHandler: () => new Promise(resolve => { window.finishGenerate = () => resolve({ success: true, images: [{ base64: image }] }) }),
      saveHandler: data => new Promise((resolve, reject) => { state.saved = data; window.finishSave = resolve; window.failSave = () => reject(new Error('保存失败测试')) }),
      onSwitchToRecent: () => state.recent++, onClose: () => { state.closed++; state.open = false },
    }) : null }).mount('#app')
  </script></body></html>`
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue(), {
    name: 'avatar-test-fixture', configureServer(server) {
      server.middlewares.use('/avatar-fixture.html', async (_req, res, next) => {
        try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/avatar-fixture.html', fixture)) }
        catch (error) { next(error) }
      })
    },
  }], server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  t.after(() => server.close())
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${server.resolvedUrls.local[0]}avatar-fixture.html`)
  const dialog = page.getByRole('dialog')
  const tab = name => page.getByRole('tab', { name, exact: true })
  const settle = () => page.waitForFunction(() => !document.querySelector('[class*="-enter-active"], [class*="-leave-active"]'))
  const reopen = async () => { await page.evaluate(() => { window.avatarFixture.open = true }); await dialog.waitFor(); await settle() }
  await dialog.waitFor().catch(error => { throw new Error(`${error.message}; browser errors: ${errors.join('; ')}`) })
  await settle()
  for (const theme of ['warm', 'dark']) for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
    await tab('最近图片').click()
    await page.waitForFunction(() => !!document.querySelector('.av-tab-enter-active'))
    assert.equal(await page.locator('.av-tab-enter-active').evaluate(el => getComputedStyle(el).transitionDuration), '0.3s, 0.3s')
    await settle()
    await page.locator('.av-thumb').click()
    await page.locator('.crop-canvas').waitFor()
    await settle()
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, '窗口不超出视口')
    assert.equal(await page.locator('.crop-canvas').evaluate(el => el.width), 520)
    assert.ok(await page.locator('.crop-canvas').evaluate(el => el.getContext('2d').getImageData(260, 260, 1, 1).data[0]) > 200, '裁剪画布已绘制')
    const before = await page.locator('.crop-zoom-info').textContent()
    await page.locator('.crop-canvas').hover()
    await page.mouse.wheel(0, -100)
    await page.waitForFunction(value => document.querySelector('.crop-zoom-info').textContent !== value, before)
    if (process.env.AVATAR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVATAR_SCREENSHOT_DIR}/avatar-crop-${theme}-${width}.png` })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await tab('最近图片').waitFor()
    await settle()
    assert.equal(await page.evaluate(() => window.avatarFixture.open), true, '裁剪关闭返回选图')
    await tab('上传图片').click()
    await settle()
    if (process.env.AVATAR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVATAR_SCREENSHOT_DIR}/avatar-picker-${theme}-${width}.png` })
  }
  await tab('生成头像').click()
  await page.getByRole('button', { name: '开始生成' }).click()
  assert.equal(await tab('上传图片').getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.avatarFixture.open), true)
  await page.evaluate(() => window.finishGenerate())
  await page.locator('.crop-canvas').waitFor()
  await settle()
  await page.getByRole('button', { name: '保存头像', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true)
  await page.evaluate(() => window.failSave())
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  await page.getByRole('button', { name: '保存头像', exact: true }).click()
  await page.evaluate(() => window.finishSave())
  await page.waitForFunction(() => !!document.querySelector('.modal-fade-leave-active'))
  assert.equal(await page.evaluate(() => window.avatarFixture.closed), 0, '保存完成仍等待退出动画')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.avatarFixture.closed), 1)
  assert.match(await page.evaluate(() => window.avatarFixture.saved), /^data:image\/png/)
  await reopen()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
})
