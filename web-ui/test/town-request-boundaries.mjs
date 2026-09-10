// Real component regression probes; only mocked HTTP.
import assert from 'node:assert/strict'
export async function checkLifeBoundary(browser, origin) {
  const page = await browser.newPage()
  let failRead = false, epoch = 1; const posts = []
  const economy = () => ({ enabled: true, configured: true, worldId: 'fixture', worldEpoch: epoch, wallet: { balance: 0, reserved: 0, available: 0 }, slice: { reward: 30, locationKeys: {} }, orders: [], participants: [], locations: [], service: null })
  await page.route(`${origin}/api/**`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: failRead ? 503 : 200, json: failRead ? { error: 'unavailable' } : economy() })
    posts.push(route.request().postDataJSON())
    if (posts.length === 1) return route.abort('failed')
    return route.fulfill({ status: 409, json: { code: 'STALE_EPOCH', error: '小镇已更新' } })
  })
  await page.goto(`${origin}/test/town-life-fixture.html`)
  await page.getByRole('button', { name: '打开公告站面板', exact: true }).click()
  await page.getByRole('button', { name: '发布配送委托', exact: true }).click()
  const retry = page.getByRole('button', { name: '重试同一次操作', exact: true })
  await retry.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重新读取' && !b.disabled))
  await page.getByRole('button', { name: '关闭公告站' }).click()
  epoch = 2; failRead = true
  await page.getByRole('button', { name: '打开公告站面板' }).click()
  await page.getByRole('alert').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '重新读取' && !b.disabled))
  assert.equal(await retry.isEnabled(), false)
  await retry.evaluate(el => el.click())
  assert.equal(posts.length, 1)
  failRead = false
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.getByText('小镇已更新，旧操作已停止。请按当前状态重新选择。').waitFor()
  assert.equal(await retry.count(), 0); assert.equal(posts.length, 1)
  await page.close()
}
export async function checkWorkshopBoundary(browser, origin) {
  const workshop = await browser.newPage(); let pendingRoute, resolveHeld
  const held = new Promise(resolve => { resolveHeld = resolve })
  const reads = []
  const a = { sessionId: 'a', worldId: 'fixture', worldEpoch: 1, status: 'offered', version: 1, phaseKey: 'offer', turnCount: 0, choices: [], turns: [] }
  const b = { ...a, sessionId: 'b', status: 'completed', phaseKey: 'done', settlement: { paid: 30, payout: 30, refund: 0, itemIds: [1] } }
  await workshop.route(`${origin}/api/**`, async route => {
    const url = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST') { pendingRoute = route; resolveHeld(); return }
    if (url.endsWith('/economy')) return route.fulfill({ json: { enabled: true, worldId: 'fixture', worldEpoch: 1, service: { sessions: [a, b] } } })
    reads.push(url)
    return route.fulfill({ json: url.endsWith('/b') ? b : a })
  })
  await workshop.goto(`${origin}/test/town-workshop-fixture.html`)
  await workshop.evaluate(() => { fixture.sessionId.value = 'a' })
  await workshop.getByRole('button', { name: '接受服务并支付 30 邻币', exact: true }).click(); await held
  await workshop.evaluate(() => { fixture.sessionId.value = 'b' })
  await workshop.getByRole('region', { name: '服务结算收据' }).waitFor()
  a.status = 'active'; a.phaseKey = 'theme'; a.choices = ['choose_theme']; a.version = 2
  await pendingRoute.fulfill({ json: a })
  await workshop.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await workshop.evaluate(() => fixture.sessionId.value), 'b')
  assert.equal(reads.at(-1), '/api/town/services/b')
  assert.equal(await workshop.getByRole('region', { name: '服务结算收据' }).count(), 1)
  assert.equal(await workshop.getByRole('button', { name: '选好主题，继续', exact: true }).count(), 0)
  await workshop.close()
}
export async function checkLateErrorBoundary(browser, origin, kind) {
    const appointment = kind === 'appointment', view = await browser.newPage()
    const overview = appointment ? { worldId: 'w', worldEpoch: 1, candidates: [], appointments: [] } : { worldId: 'w', worldEpoch: 1, items: [], nextCursor: null }
    const key = appointment ? 'town-appointment-pending-v1' : 'town-delivery-retry-v1'
    const command = appointment ? { kind: 'accept', worldId: 'w', path: '/candidates/c/accept', body: { worldEpoch: 1, expectedVersion: 1, startAt: Date.now() + 3600000, idempotencyKey: 'old-command' } } : { worldId: 'w', body: { worldEpoch: 1, eventId: 'e', consumerKey: 'town.experience', idempotencyKey: 'old-command' } }
    await view.addInitScript(({ key, command }) => sessionStorage.setItem(key, JSON.stringify(command)), { key, command })
    let holdRead = false, release, resolveRead
    const gotRead = new Promise(resolve => { resolveRead = resolve })
    await view.route(`${origin}/api/**`, async route => {
      if (route.request().method() === 'POST') { holdRead = true; return route.fulfill({ status: 409, json: { code: appointment ? 'SCHEDULE_UNAVAILABLE' : 'DELIVERY_ACTIVE' } }) }
      if (holdRead) { holdRead = false; release = route; resolveRead(); return }
      return route.fulfill({ json: overview })
    })
    await view.goto(`${origin}/test/${appointment ? 'town-appointments' : 'town-deliveries'}-fixture.html`)
    const trigger = view.getByRole('button', { name: appointment ? '查看免费回访' : '查看投递', exact: true })
    await trigger.click(); await view.getByRole('button', { name: '重试原请求', exact: true }).click(); await gotRead
    await view.getByRole('button', { name: appointment ? '关闭免费回访' : '关闭记录投递状态', exact: true }).click()
    await trigger.click(); await view.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
    assert.equal(await view.getByRole('alert').count(), 0)
    await release.fulfill({ json: overview }); await view.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await view.getByRole('alert').count(), 0)
    assert.equal(await view.getByRole('button', { name: '重试原请求', exact: true }).isEnabled(), true)
    await view.close()
  }
