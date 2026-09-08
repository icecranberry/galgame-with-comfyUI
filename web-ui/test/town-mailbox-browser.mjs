import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const server = await createServer({ configFile: false, root, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: ['vue','pinia','vue-router'] }, server: { hmr: false, watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = new URL(server.resolvedUrls.local[0]).origin
const output = path.resolve(root, '../output/hd2d-town-mailbox')
await fs.mkdir(output, { recursive: true })
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } })
  // Adversarial transport: a card response may complete even after abort. Exercise the
  // component generation guard, not just the browser's automatic request cancellation.
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window)
    window.__mailboxResponses = 0
    window.fetch = async (url, options) => {
      if (!String(url).startsWith('/api/town/mailbox-tasks')) return fetch(url, options)
      const response = await fetch(url, { ...options, signal: undefined })
      window.__mailboxResponses++
      return response
    }
  })
  const errors = [], writes = [], unknown = [], reads = []
  let cards = 'full', held = null
  const scope = { worldId: 'mailbox-fixture', worldEpoch: 2 }
  const locations = ['board','supplier','workshop'].map((key,i) => ({ id:i+1,key,name:['公告站','花园原料点','木木工坊'][i],x:i+3,y:4,radius:2 }))
  const map = { id:1,cols:12,rows:12,version:1,name:'隔离小镇',layers:{ground:[],objects:[],blocking:[]},assets:[] }
  const card = { orderId:'card-old',status:'open',reward:30,expiresAt:Date.now()+3600000,locations:{supplier:{name:'花园原料点'},workshop:{name:'木木工坊'}} }
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url()), type=request.resourceType()
    if (type==='image') return route.fulfill({ contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (type==='font' || (url.origin!==origin && type==='stylesheet')) return route.fulfill({ contentType:'text/css',body:'' })
    if (url.origin!==origin) { unknown.push(request.url()); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method()!=='GET') { writes.push({url:url.pathname,method:request.method()}); return route.fulfill({json:{ok:true}}) }
    reads.push(url.pathname)
    if (url.pathname==='/api/town/mailbox-tasks') {
      if (cards==='hold') { held=route; return }
      if (cards==='paging') {
        const cursor=url.searchParams.has('cursor')?JSON.parse(url.searchParams.get('cursor')).orderId:null
        const named=(id,name)=>({...card,orderId:id,locations:{supplier:{name},workshop:{name:'木木工坊'}}})
        const pages={
          first:{...scope,items:[],nextCursor:{createdAt:1,orderId:'scan-next'}},
          'scan-next':{...scope,items:[named('page-a','第一页原料点')],nextCursor:{createdAt:2,orderId:'append-next'}},
          'append-next':{...scope,items:[named('page-b','第二页原料点')],nextCursor:{createdAt:3,orderId:'world-next'}},
          'world-next':{worldId:'new-world',worldEpoch:3,items:[named('page-c','新世界原料点')],nextCursor:null},
        }
        assert.ok(pages[cursor||'first']);return route.fulfill({json:pages[cursor||'first']})
      }
      return route.fulfill({json:{...scope,enabled:cards!=='disabled',items:cards==='full'?[card]:[],nextCursor:null}})
    }
    const payloads = {
      '/api/mailbox':{letters:[{id:1,display_name:'木木',direction:'char_to_user',is_read:1,status:'completed',content:'信里的问候与正式委托分开显示。',reply_content:'信里的问候与正式委托分开显示。',created_at:'2026-09-08 01:00:00'}]},
      '/api/mailbox/unread':{unread:0,processing:0},
      '/api/town/state':{...scope,enabled:true,initialized:true,serverTime:Date.now(),map,locations,agents:[],encountersActive:[],player:{actorId:'player',agentKey:'me',displayName:'我',x:5,y:5,path:[],speed:1}},
      '/api/town/map':map,'/api/town/npcs':{npcs:[]},'/api/town/characters':{characters:[]},'/api/town/settings':{enabled:true,simulation:'legacy'},'/api/town/player/kit':{},'/api/town/assets':{assets:[]},
      '/api/town/liquidity':{...scope,liquidity:null},
      '/api/town/economy':{...scope,enabled:true,configured:true,wallet:{balance:73,available:73,reserved:0},orders:[],locations,participants:[],slice:{reward:30,locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}},service:null},
      '/api/town/appointments':{...scope,candidates:[],appointments:[]},'/api/town/deliveries':{...scope,items:[],nextCursor:null},
    }
    if (!(url.pathname in payloads)) { unknown.push(url.pathname); return route.fulfill({status:404,json:{error:'unhandled synthetic request'}}) }
    return route.fulfill({json:payloads[url.pathname]})
  })
  await page.goto(`${origin}/test/town-mailbox-fixture.html`)
  await page.locator('.town-mailbox-tasks').waitFor(); await page.locator('.letter-card').waitFor()
  for (const width of [1100,375]) {
    await page.setViewportSize({width,height:820})
    const bounds = await page.evaluate(() => ['.panel-list','.town-mailbox-tasks','.letter-list'].map(selector=>{
      const e=document.querySelector(selector), r=e.getBoundingClientRect();return {selector,left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth}
    }))
    for (const b of bounds) { assert.ok(b.left>=-1 && b.right<=width+1,JSON.stringify(b));assert.ok(b.scroll<=b.client+1,JSON.stringify(b)) }
    await page.screenshot({path:path.join(output,`mailbox-${width}.png`)})
  }
  await page.getByRole('button',{name:'去小镇查看',exact:true}).click()
  await page.getByRole('dialog',{name:'小镇生活',exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('.tl-content')?.textContent.includes('73'))
  assert.equal(await page.evaluate(()=>fixture.router.currentRoute.value.fullPath),'/town?panel=life')
  assert.equal(await page.evaluate(()=>fixture.town.snapshot.worldEpoch),2)
  assert.ok(reads.includes('/api/town/state') && reads.includes('/api/town/economy'))
  assert.equal(await page.locator('.town-mailbox-tasks').count(),0)
  assert.equal(writes.length,0)
  await page.screenshot({path:path.join(output,'town-life-375.png')})
  for (const mode of ['disabled','empty']) {
    cards=mode; await page.evaluate(()=>fixture.router.push('/mailbox'))
    await page.locator('.letter-card').waitFor(); await page.waitForLoadState('networkidle')
    assert.equal(await page.locator('.town-mailbox-tasks').count(),0)
    await page.evaluate(()=>fixture.router.push('/empty'))
  }
  cards='paging'; await page.evaluate(()=>fixture.router.push('/mailbox'))
  const more=page.getByRole('button',{name:'查看更多委托',exact:true})
  await more.waitFor()
  assert.equal(await page.locator('.town-mailbox-tasks article').count(),0)
  await more.click();await page.getByText('第一页原料点 → 木木工坊',{exact:true}).waitFor()
  await more.click();await page.getByText('第二页原料点 → 木木工坊',{exact:true}).waitFor()
  assert.equal(await page.locator('.town-mailbox-tasks article').count(),2)
  await more.click();await page.getByText('新世界原料点 → 木木工坊',{exact:true}).waitFor()
  assert.equal(await page.locator('.town-mailbox-tasks article').count(),1)
  assert.equal(await page.getByText('第一页原料点 → 木木工坊',{exact:true}).count(),0)
  assert.equal(await page.getByText('第二页原料点 → 木木工坊',{exact:true}).count(),0)
  assert.equal(await more.count(),0)
  await page.screenshot({path:path.join(output,'mailbox-new-world-375.png')})
  await page.evaluate(()=>fixture.router.push('/empty'))
  cards='hold'; await page.evaluate(()=>fixture.router.push('/mailbox'))
  await page.waitForFunction(()=>!!document.querySelector('.letter-card'))
  for(let n=0;n<100 && !held;n++) await new Promise(r=>setTimeout(r,20))
  assert.ok(held)
  const responseCount = await page.evaluate(()=>window.__mailboxResponses)
  await page.evaluate(()=>fixture.router.push('/empty'))
  await held.fulfill({json:{...scope,items:[{...card,orderId:'late-card'}],nextCursor:null}})
  await page.waitForFunction(count=>window.__mailboxResponses>count,responseCount)
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(await page.locator('.town-mailbox-tasks').count(),0)
  cards='empty'; await page.evaluate(()=>fixture.router.push('/mailbox')); await page.waitForLoadState('networkidle')
  assert.equal(await page.locator('.town-mailbox-tasks').count(),0)
  assert.deepEqual(writes,[]); assert.deepEqual(errors,[]); assert.deepEqual(unknown,[])
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,widths:[375,1100],writes,errors,unknown,reads},null,2))
  console.log('PASS real MailboxView → TownView memory router; 375/1100 layout; fresh life state; empty/disabled; cursor empty page/append/world replacement; late unmount; zero writes')
} finally { await browser?.close(); await server.close() }
