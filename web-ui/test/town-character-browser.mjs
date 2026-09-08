// Full original frontend HTTP/SSE parser + Pinia store against an in-memory server.
// No backend/proxy, DB, model, real assets or persistent fixture history.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const calls = [], streams = new Set(), errors = []
const histories = new Map([[41, [{ id: 1, role: 'assistant', content: '原聊天历史', images: '[]' }]], [42, [{ id: 2, role: 'assistant', content: '另一位角色的历史', images: '[]' }]]])
let nextId = 100, replyDelay = 80, historyDelay = 0, historyFailure = false, stopFailure = false
const retryKeys = []
const svg = '/fixture-portrait.svg'
const event = (res, name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
const server = await createServer({ configFile: false, root, plugins: [vue(), { name: 'offline-dialogue-api', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://fixture').pathname
    if (url === svg) { res.setHeader('Content-Type','image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300"><circle cx="90" cy="60" r="40" fill="#d4a08c"/><path d="M40 110H140V290H40Z" fill="#7fa88a"/></svg>'); return }
    if (!url.startsWith('/api/')) return next()
    calls.push([req.method, url])
    const json = (data, status=200) => { res.statusCode=status; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)) }
    if (url === '/api/stream') { res.setHeader('Content-Type','text/event-stream'); event(res,'connected',{}); streams.add(res); req.on('close', () => streams.delete(res)); return }
    if (url === '/api/town/economy') return json({ enabled:true, configured:true,worldId:'fixture',worldEpoch:2,wallet:{available:0,balance:0,reserved:0},slice:{reward:30,locationKeys:{board:'board',supplier:'supply',workshop:'workshop'}},locations:[{key:'board',name:'公告站'}],participants:[{actorId:'actor:41',displayName:'小满'}],orders:[],service:{providerActorId:'actor:41',locationKey:'workshop',open:true,sessions:[]} })
    if (url === '/api/config') return json({ features: { imageGenMode: 'smart', deepThinkMode: true } })
    if (url === '/api/characters') return json({ characters: [{ id: 41, display_name: '小满', standing_url: svg }, { id: 42, display_name: '阿青' }] })
    if (url === '/api/town/npcs') return json({ npcs: [] })
    if (url === '/api/town/characters') return json({ characters: [] })
    if (url === '/api/town/settings') return json({})
    if (url === '/api/town/player/kit') return json({ portrait: null })
    if (url === '/api/town/player/dir') { await new Promise(r => setTimeout(r, 120)); return json({ ok: !stopFailure }) }
    const match = url.match(/^\/api\/characters\/(\d+)\/(messages|chat)$/)
    if (!match) { errors.push(`Unexpected ${req.method} ${url}`); return json({ error: 'Unexpected fixture API' },418) }
    const id = Number(match[1]), history = histories.get(id)
    if (match[2] === 'messages') {
      const data = JSON.parse(JSON.stringify(history))
      if (historyDelay) await new Promise(r => setTimeout(r, id === 41 ? historyDelay : 0))
      return historyFailure ? json({ error: 'fixture failure' },503) : json({ messages: data })
    }
    let body = ''; for await (const chunk of req) body += chunk
    const payload = JSON.parse(body)
    assert.equal(payload.image_mode, 'smart'); assert.equal(payload.deep_think, true)
    assert(payload.client_msg_id)
    if (payload.message !== '普通页面') assert.deepEqual(payload.townContext, { worldId: 'fixture', worldEpoch: 1, actorId: `actor:${id}` })
    else assert(!Object.hasOwn(payload, 'townContext'))
    if (payload.message === '距离拒绝') return json({ error: '请走近角色后再说话', code: 'TOWN_CHAT_TOO_FAR' },409)
    if (payload.message === '忙碌拒绝') return json({ error: '角色正在提供服务，请稍后再说话', code: 'TOWN_CHAT_BUSY' },409)
    if (payload.message === '格式拒绝') return json({ error: '上下文格式错误', code: 'TOWN_CHAT_CONTEXT_INVALID' },400)
    if (!history.some(m => m.clientMsgId === payload.client_msg_id)) history.push({ id: nextId++, role: 'user', content: payload.message, clientMsgId: payload.client_msg_id, images: '[]' })
    if (payload.message === '稍后回复') return json({ queued: true, currentActivity: '散步', delayMinutes: 2 })
    res.setHeader('Content-Type','text/event-stream')
    if (payload.message === '重试') { retryKeys.push(payload.client_msg_id); if (retryKeys.length === 1) return res.end() }
    event(res, 'token', { content: '你好，' })
    await new Promise(r => setTimeout(r, replyDelay))
    event(res, 'token', { content: '镇上见。' })
    const saved = { id: nextId++, role: 'assistant', content: '你好，镇上见。', images: '[]' }
    history.push(saved)
    event(res, 'msg_saved', saved)
    event(res, 'bubble_break', {})
    event(res, 'generate_start', { taskId: `fixture-image-${saved.id}` })
    event(res, 'generate_done', { taskId: `fixture-image-${saved.id}`, images: [{ url: svg }] })
    event(res, 'affinity_update', { affinity: 56, affinityDelta: 1 })
    res.end()
  })
} }], server: { hmr: false, watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 5193, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
page.on('pageerror', e => errors.push(e.message))
const output = path.resolve(root,'../output/hd2d-m2-character')
const input = page.getByRole('textbox', { name: '对话内容' })
const ready = () => page.waitForFunction(() => document.querySelector('input[aria-label="对话内容"]')?.disabled === false)
try {
  await page.goto('http://127.0.0.1:5193/test/town-character-fixture.html')
  await ready()
  assert.equal((await page.locator('article').innerText()).replace(/\n+/g,'\n'), '小满\n原聊天历史')
  replyDelay = 400
  await input.fill('普通回复'); await input.press('Enter')
  await page.getByText('你好，', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭对话' }).click()
  await page.evaluate(() => { probe.open.value = true })
  await ready()
  assert.equal(calls.filter(c => c[0] === 'POST' && c[1].endsWith('/chat')).length,1)
  assert.equal(await page.evaluate(() => probe.chat.realtimeAffinity.affinity),56)
  assert.equal(await page.locator('.tcc-image').count(),1)
  await input.fill('稍后回复'); await input.press('Enter'); await ready()
  await page.getByText('正在散步，稍后会回复你，消息仍保存在原聊天记录中。').waitFor()
  const delayed = { id: nextId++, role: 'assistant', content: '散步回来了', images: '[]' }
  histories.get(41).push(delayed)
  for (const res of streams) event(res, 'delayed_reply', { character_id: 41, messages: [delayed], created_at: new Date().toISOString() })
  await page.getByText('散步回来了', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => probe.chat.messages.filter(m => m.content === '散步回来了').length),1)
  await input.fill('重试'); await input.press('Enter'); await ready()
  assert.equal(retryKeys.length,2); assert.equal(retryKeys[0],retryKeys[1])
  assert(await page.evaluate(()=>probe.chat.messages.filter(m=>m.type==='image_gen').every(m=>m.genStatus==='done')))
  await page.getByRole('button', { name: '历史', exact: true }).click()
  await page.getByText('原聊天历史', { exact: true }).waitFor()
  await fs.mkdir(output,{recursive:true}); await page.screenshot({path:path.join(output,'character-desktop.png')})
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:path.join(output,'character-mobile.png')})
  await page.keyboard.press('Escape')
  // Active A reply survives switching to B: B waits, rather than aborting A or writing into it.
  replyDelay=500
  await input.fill('切换中'); await input.press('Enter')
  await page.evaluate(() => { probe.id.value=42 })
  await page.getByText('另一位邻居正在回应，结束后即可开始交谈。').waitFor()
  await ready(); assert.equal(await page.evaluate(() => probe.chat.activeCharId),42)
  assert.equal((await page.locator('article').innerText()).replace(/\n+/g,'\n'),'阿青\n另一位角色的历史')
  historyDelay=350
  await page.evaluate(() => { probe.id.value=41 })
  await page.waitForTimeout(40)
  await page.evaluate(() => { probe.id.value=42 })
  await ready(); await page.waitForTimeout(400)
  assert.equal((await page.locator('article').innerText()).replace(/\n+/g,'\n'),'阿青\n另一位角色的历史')
  historyDelay=0; historyFailure=true
  await page.evaluate(() => { probe.id.value=41 })
  await page.getByRole('alert').waitFor(); assert(await input.isDisabled())
  historyFailure=false
  await page.getByRole('button',{name:'重新读取记录'}).click(); await ready()
  assert.equal(calls.filter(c=>c[1]==='/api/stream').length,1)
  for (const rejected of ['距离拒绝','格式拒绝','忙碌拒绝']) {
    const postCount = calls.filter(c=>c[0]==='POST').length
    await input.fill(rejected); await input.press('Enter')
    await page.getByRole('alert').waitFor()
    assert(await input.isDisabled())
    assert.equal(await input.inputValue(),rejected)
    assert.equal(await page.evaluate(text=>probe.chat.messages.filter(m=>m.content===text).length,rejected),0)
    await page.waitForTimeout(150)
    assert.equal(calls.filter(c=>c[0]==='POST').length,postCount+1)
    await page.getByRole('button',{name:'关闭对话'}).click()
    await page.evaluate(()=>{probe.open.value=true}); await ready()
  }
  // Busy snapshots block new sends without aborting a turn already streaming.
  replyDelay=350
  await input.fill('忙碌前已接受'); await input.press('Enter')
  await page.getByText('你好，',{exact:true}).waitFor()
  await page.evaluate(()=>{probe.busy.value=true})
  await page.waitForFunction(()=>!probe.chat.streaming)
  assert(await input.isDisabled())
  assert(await page.evaluate(()=>probe.chat.messages.some(m=>m.content==='你好，镇上见。')))
  const busyPostCount=calls.filter(c=>c[0]==='POST').length
  await page.getByRole('button',{name:'发送',exact:true}).dispatchEvent('click')
  assert.equal(calls.filter(c=>c[0]==='POST').length,busyPostCount)
  await page.evaluate(()=>{probe.busy.value=false}); await ready()
  await page.evaluate(()=>probe.chat.sendMessage('普通页面','smart',true))

  await page.evaluate(() => probe.stop())
  // Real TownView fixture: stop acknowledgement precedes stage, no route change, all map input stays isolated.
  await page.setViewportSize({width:1100,height:700})
  await page.goto('http://127.0.0.1:5193/test/town-character-fixture.html?town=1')
  await page.waitForFunction(() => probe.view?.resourcesReady)
  await page.evaluate(()=>{probe.view.town.snapshot.agents[0].busyReason='SERVICE_BUSY';probe.view.selectedAgentKey='char:41'})
  await page.getByText('正在提供工坊服务，请稍后再交谈',{exact:true}).waitFor()
  assert(await page.getByRole('button',{name:'就地交谈'}).isDisabled())
  const stopsBeforeBusy=calls.filter(c=>c[1]==='/api/town/player/dir').length
  await page.evaluate(()=>probe.view.goChat(41))
  assert.equal(calls.filter(c=>c[1]==='/api/town/player/dir').length,stopsBeforeBusy)
  assert.equal(await page.locator('.town-dialogue-stage').count(),0)
  await page.evaluate(()=>{probe.view.town.snapshot.agents[0].busyReason=null;probe.view.selectedAgentKey=null})
  await page.keyboard.down('w')
  await page.evaluate(() => { probe.view.goChat(41) })
  assert.equal(await page.locator('.town-dialogue-stage').count(),0)
  await ready()
  await page.waitForTimeout(350)
  const stageLayout = await page.evaluate(() => {
    const figures = [...document.querySelectorAll('.td-portraits figure')].map(el => el.getBoundingClientRect())
    const panel = document.querySelector('.td-panel').getBoundingClientRect()
    return { panel, first: figures[0], last: figures.at(-1) }
  })
  assert(stageLayout.first.right <= stageLayout.panel.left + 1)
  assert(stageLayout.last.left >= stageLayout.panel.right - 1)
  assert(Math.abs(stageLayout.first.bottom - stageLayout.panel.bottom) < 2)
  assert(Math.abs(stageLayout.last.bottom - stageLayout.panel.bottom) < 2)
  await page.mouse.click(550, 120)
  await page.locator('.town-dialogue-stage').waitFor({ state: 'detached' })
  await page.evaluate(() => { probe.view.goChat(41) }); await ready()
  const movesBefore = await page.evaluate(() => probe.moves.length)
  await page.waitForTimeout(200)
  await input.fill('wasd隔离')
  await input.press('ArrowUp')
  await page.locator('canvas.town-canvas').dispatchEvent('click',{offsetX:20,offsetY:20})
  assert.equal(await page.evaluate(() => probe.moves.length),movesBefore)
  assert(page.url().endsWith('?town=1'))
  await page.getByRole('button',{name:'关闭对话'}).click()
  await page.locator('.town-dialogue-stage').waitFor({ state: 'detached' })
  await page.keyboard.up('w')
  await page.evaluate(() => { probe.view.goChat(42) }); await ready()
  assert.equal(await page.locator('h2').innerText(),'阿青')
  assert(!calls.some(c=>c[1].includes('/town/npcs/')))
  await page.getByRole('button',{name:'关闭对话'}).click()
  await page.locator('.town-dialogue-stage').waitFor({ state: 'detached' })
  stopFailure=true
  await page.evaluate(() => { probe.view.goChat(41) })
  await page.getByText('暂时没能停下脚步，请再点一次邻居。').waitFor()
  assert.equal(await page.locator('.town-dialogue-stage').count(),0)
  stopFailure=false
  await page.evaluate(() => { probe.view.goChat(41) }); await ready()
  await page.evaluate(() => { probe.view.closeDialogue() })
  await page.locator('.town-dialogue-stage').waitFor({ state: 'detached' })
  await page.evaluate(() => { probe.view.goChat(41) }); await ready()
  await page.evaluate(() => { probe.vm.$.setupState.town.snapshot.worldEpoch=2 })
  await page.getByText('小镇或人物已变化，请重新选择邻居。').waitFor()
  await page.locator('.town-dialogue-stage').waitFor({state:'detached'})
  // Life/Workshop remain usable while the provider is SERVICE_BUSY.
  await page.evaluate(()=>{probe.view.town.snapshot.agents[0].busyReason='SERVICE_BUSY';probe.view.town.snapshot.locations=[{key:'board',x:1,y:2}]})
  await page.getByRole('button',{name:'生活',exact:true}).click()
  await page.getByRole('dialog',{name:'小镇生活'}).waitFor()
  await page.getByRole('button',{name:'了解工坊服务'}).click()
  await page.locator('.tws-overlay').waitFor()
  await page.locator('.tws-overlay').getByRole('button',{name:'关闭对话'}).click()
  await page.locator('.tws-overlay').waitFor({state:'detached'})
  await page.getByRole('button',{name:'前往',exact:true}).first().click()
  await page.getByRole('dialog',{name:'小镇生活'}).waitFor({state:'detached'})
  assert.deepEqual(await page.evaluate(()=>probe.moves.at(-1)),{x:1,y:2})
  assert.deepEqual(errors,[])
  console.log('PASS: original history/HTTP/SSE/images/affinity/retry key/delayed reply, close/reopen, selection races, shared stream, TownView stop+input+linked identity, offline only')
} finally { for(const res of streams) res.end(); await browser.close(); await server.close() }
