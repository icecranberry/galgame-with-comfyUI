import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const server=await createServer({configFile:false,root,plugins:[vue(),{name:'real-dispatch',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/stores/unifiedStream.js'))return code+'\nexport const __fixtureDispatch=_dispatch;'}}],optimizeDeps:{noDiscovery:true,include:['vue','pinia']},server:{host:'127.0.0.1',port:0,hmr:false}})
await server.listen()
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
let browser
try {
 browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'})
 const page=await browser.newPage(),origin=new URL(server.resolvedUrls.local[0]).origin,calls=[]
 await page.clock.install({time:new Date('2026-09-08T00:59:00Z')})
 let hour=8,validUntil=100,hold=false,held
 await page.route(`${origin}/api/**`,async route=>{
  assert.equal(route.request().method(),'GET');assert.equal(new URL(route.request().url()).pathname,'/api/town/state');calls.push('GET')
  if(hold){held=route;return}
  await route.fulfill({json:{worldId:'w',worldEpoch:1,serverTime:await page.evaluate(()=>Date.now()),agents:[],map:null,weather:{hour,validUntil,text:hour===8?'晴':'雨'}}})
 })
 await page.goto(`${origin}/test/town-weather-ping-fixture.html`);await page.waitForFunction(()=>!!window.fixture)
 await page.evaluate(()=>fixture.town.startTownStream());await page.waitForFunction(()=>fixture.town.loaded)
 const ping=()=>page.evaluate(()=>fixture.event('town_ping',{serverTime:Date.now()+500}))
 await ping();await page.clock.fastForward(121);assert.equal(calls.length,1,'initial load suppresses adjacent ping GET')
 hour=9;validUntil=200
 await page.clock.fastForward(60000);await ping();await page.clock.fastForward(121)
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 assert.equal(await page.evaluate(()=>fixture.town.weather.hour),9,'legacy ping must refresh the hour')
 assert.equal(await page.evaluate(()=>fixture.town.weather.validUntil),200)
 assert.equal(calls.length,2)
 await page.evaluate(()=>fixture.event('town_ping',{serverTime:Date.now()+500}));assert.equal(await page.evaluate(()=>fixture.town.serverOffset),500)
 await page.clock.fastForward(121);assert.equal(calls.length,2)
 // Ping and rules notification in one batch share the original 120ms debounce.
 await page.clock.fastForward(60000)
 const mergedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/town/state')
 await page.evaluate(()=>{fixture.event('town_ping',{serverTime:Date.now()});fixture.event('town_state_updated',{})})
 await page.clock.fastForward(121);await mergedResponse
 assert.equal(calls.length,3)
 // The ping throttle must not suppress rules updates.
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/town/state')
 await page.evaluate(()=>fixture.event('town_state_updated',{}));await page.clock.fastForward(121);await response
 assert.equal(calls.length,4)
 // A backwards wall clock must allow a fresh snapshot and reset the throttle baseline.
 hour=10;validUntil=300
 await page.clock.setSystemTime(new Date('2026-09-08T00:00:00Z'))
 const rollbackResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/town/state')
 await ping();await page.clock.fastForward(121);await rollbackResponse
 await page.waitForFunction(()=>fixture.town.weather.hour===10)
 assert.equal(await page.evaluate(()=>fixture.town.weather.validUntil),300)
 assert.equal(calls.length,5)
 await ping();await page.clock.fastForward(121);assert.equal(calls.length,5,'rollback refresh rebases the throttle')
 // Invalid ping doesn't schedule work, nor change the last valid clock offset.
 const offset=await page.evaluate(()=>fixture.town.serverOffset)
 await page.clock.fastForward(60000)
 await page.evaluate(()=>{fixture.event('town_ping',{});fixture.event('town_ping',{serverTime:'bad'})})
 await page.clock.fastForward(121);assert.equal(calls.length,5);assert.equal(await page.evaluate(()=>fixture.town.serverOffset),offset)
 await ping();await page.evaluate(()=>fixture.town.stopTownStream());await page.clock.fastForward(121)
 assert.equal(calls.length,5,'stop cancels a scheduled refresh')
 await ping();await page.clock.fastForward(60000);assert.equal(calls.length,5,'inactive store does not GET')
 hold=true;await page.evaluate(()=>fixture.town.startTownStream())
 for(let i=0;!held&&i<100;i++)await new Promise(r=>setTimeout(r,10))
 assert.ok(held);await page.evaluate(()=>fixture.town.stopTownStream())
 await held.fulfill({json:{worldId:'w',worldEpoch:1,serverTime:1,agents:[],map:null,weather:{hour:23,validUntil:999}}})
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 assert.equal(await page.evaluate(()=>fixture.town.weather.hour),10);assert.equal(await page.evaluate(()=>fixture.town.connected),false)
 console.log(JSON.stringify({passed:true,gets:calls.length,posts:0,legacyHourRefresh:true,mergedPingAndState:true,clockRollbackRefresh:true,stopFenced:true}))
}finally{await browser?.close();await server.close()}
