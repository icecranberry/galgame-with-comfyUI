import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import fs from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const server=await createServer({configFile:false,root,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue','pinia','three']},server:{host:'127.0.0.1',port:0,hmr:false}})
await server.listen()
const origin=new URL(server.resolvedUrls.local[0]).origin
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
let browser
try {
 browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'})
 const output=path.resolve(root,'../output/hd2d-renderer-recovery');await fs.mkdir(output,{recursive:true})
 const results=[]
 for(const mode of ['balanced','low']) {
  const page=await browser.newPage({viewport:{width:1000,height:720}}),calls=[],errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const map={id:1,cols:12,rows:12,version:1,name:'恢复测试',assets:[],layers:{ground:[],road:[],objects:[],blockOverride:[]}}
  await page.route(`${origin}/api/**`,async route=>{
   const req=route.request(),url=new URL(req.url()).pathname;calls.push({url,method:req.method()})
   const endpoint=url.replace('/api/town/',''),payloads={state:{worldId:'recovery',worldEpoch:1,enabled:true,initialized:true,serverTime:Date.now(),map,locations:[],agents:[],encountersActive:[],weather:{text:'晴',hour:12},player:null},map,assets:{assets:[]},npcs:{npcs:[]},characters:{characters:[]},settings:{enabled:true},'player/kit':{}}
   assert.equal(req.method(),'GET');assert.ok(endpoint in payloads,url)
   await route.fulfill({json:payloads[endpoint]})
  })
  await page.goto(`${origin}/test/town-renderer-recovery-fixture.html?mode=${mode}`)
  await page.waitForFunction(()=>fixture.town.loaded&&!document.querySelector('.town-boot-mask')&&fixture.renderers.length===1)
  await page.evaluate(()=>{
   const extension=fixture.renderers.at(-1).renderer.getContext().getExtension('WEBGL_lose_context')
   if(!extension)throw new Error('WEBGL_lose_context unavailable')
   extension.loseContext()
  })
  const retry=page.getByRole('button',{name:'重试 HD2D',exact:true});await retry.waitFor()
  assert.equal(await page.locator('canvas').count(),1)
  await page.screenshot({path:path.join(output,`${mode}-fallback.png`)})
  const before=calls.length
  await retry.evaluate(el=>{el.click();el.click()})
  await page.waitForFunction(()=>fixture.renderers.length===2&&document.querySelectorAll('canvas').length===2&&!document.querySelector('.town-render-notice'))
  assert.equal(await page.evaluate(()=>fixture.renderers.at(-1).quality),'balanced','restored renderer is fixed HD2D balanced')
  assert.equal(calls.length,before,'renderer recovery must not issue business HTTP or open SSE')
  assert.equal(await page.evaluate(()=>fixture.renderers[0].disposed),true)
  await page.screenshot({path:path.join(output,`${mode}-restored.png`)})
  // Repeat loss; immediately leave during the async retry continuation.
  await page.evaluate(()=>fixture.renderers.at(-1).renderer.getContext().getExtension('WEBGL_lose_context').loseContext())
  await retry.waitFor()
  await retry.evaluate(el=>{el.click();fixture.unmount()})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(await page.locator('canvas').count(),0)
  assert.equal(await page.evaluate(()=>fixture.renderers.length),2,'unmount fence prevents a late renderer mount')
  assert.deepEqual(errors,[])
  results.push({mode,recovered:true,duplicateClickMounts:1,unmountFenced:true,posts:calls.filter(c=>c.method==='POST').length,newSSE:0})
  await page.close()
 }
 console.log(JSON.stringify({passed:true,results,screenshots:output}))
} finally {await browser?.close();await server.close()}
