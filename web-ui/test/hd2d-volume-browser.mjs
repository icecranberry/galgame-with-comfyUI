// Offline renderer only. No production Vite config, API, Vue store or model/DB process.
import { createServer } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(root, '../output/hd2d-m7-volume')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
await fs.mkdir(output, {recursive:true})
const baseline = execFileSync('git', ['show','HEAD:web-ui/src/town/renderers/Hd2dTownRenderer.js'], {cwd:root,encoding:'utf8'})
const server = await createServer({root, configFile:false, cacheDir:path.join(output,'.vite'), optimizeDeps:{noDiscovery:true,include:['three']}, server:{host:'127.0.0.1',port:5197,strictPort:true,hmr:false,watch:null}, plugins:[{
  name:'offline-volume-assets', configureServer(s){s.middlewares.use((req,res,next)=>{
    if(req.url.startsWith('/fixture-card.svg')) {res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><path d="M8 38L32 10L56 38V92H8Z" fill="#b78d6b"/><path d="M4 38L32 4L60 38Z" fill="#855645"/><path d="M25 66H39V92H25Z" fill="#504839"/></svg>');return}next()
  })},
  resolveId(id){if(id.endsWith('/Hd2dTownRenderer.baseline.js'))return path.join(root,'src/town/renderers/Hd2dTownRenderer.baseline.js')},
  load(id){if(id.endsWith('/Hd2dTownRenderer.baseline.js'))return baseline},
}]})
await server.listen()
const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'})
const page = await browser.newPage({viewport:{width:1000,height:720},deviceScaleFactor:1})
const errors=[], results={}
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(m.type()==='error' && !m.text().includes('favicon')) errors.push(m.text())})
await page.route('**/*',route=>{
  const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||u.protocol==='data:' ? route.continue() : route.abort()
})
const open = async query=>{await page.goto(`http://127.0.0.1:5197/test/hd2d-volume-fixture.html?${query}`);await page.waitForFunction(()=>window.probe && [...probe.renderer.textures.values()].every(e=>e.ready||e.failed));await page.evaluate(()=>probe.draw())}
try {
  for(const profile of ['cafe','workshop','notice_station']) {
    await open(`profile=${profile}`)
    results[profile]=await page.evaluate(()=>{
      const r=probe.renderer,g=r.objects.get('building');probe.draw()
      const p=r.project({x:4.5,y:1,z:8.05}), hit=r.pick(p)
      const ground=r.pick(r.project({x:5.5,y:0,z:7.5}),{groundOnly:true})
      return {glError:r.renderer.getContext().getError(),memory:{...r.renderer.info.memory},volume:!!g.userData.volume,casters:g.children.filter(m=>m.castShadow).length,pick:hit?.kind,ground,day:g.userData.lamps.map(m=>m.emissiveIntensity)}
    })
    assert.equal(results[profile].glError,0);assert.equal(results[profile].casters,1);assert(results[profile].volume)
    assert.equal(results[profile].pick,'object');assert.deepEqual(results[profile].ground.cell,{x:5,y:7})
    assert(results[profile].day.every(v=>v===0))
    await page.screenshot({path:path.join(output,`${profile}-day.png`)})
    await page.evaluate(()=>{probe.weather.hour=21;probe.draw()})
    assert(await page.evaluate(()=>probe.renderer.objects.get('building').userData.lamps.every(m=>m.emissiveIntensity===1.4)))
    await page.screenshot({path:path.join(output,`${profile}-night.png`)})
  }
  // Rebuild profiles, remove objects, and expire face textures: no GPU accumulation.
  results.resources=await page.evaluate(async()=>{
    const r=probe.renderer, original=structuredClone(probe.map.layers.objects)
    probe.map.layers.objects=[];r.setScene(probe.map);probe.draw()
    const empty={...r.renderer.info.memory}, cycles=[]
    for(let i=0;i<12;i++){
      probe.map.layers.objects=original;probe.setProfile(['cafe','workshop','notice_station'][i%3]);probe.draw()
      probe.map.layers.objects=[];r.setScene(probe.map);probe.draw()
      cycles.push({...r.renderer.info.memory})
    }
    probe.map.layers.objects=original;probe.setProfile('cafe');probe.weather.hour=12;probe.draw()
    return {empty,cycles,glError:r.renderer.getContext().getError()}
  })
  assert(results.resources.cycles.every(m=>m.geometries===results.resources.empty.geometries && m.textures===results.resources.empty.textures))
  assert.equal(results.resources.glError,0)
  await page.evaluate(()=>probe.setTextures({roof:probe.svg('<path d="M0 0H64V96H0Z" fill="#c18b69"/><path d="M0 24H64M0 48H64M0 72H64" stroke="#765746" stroke-width="3"/>'),sign:probe.svg('<path d="M32 0H64V96H32Z" fill="#edc87c"/>')}))
  await page.waitForFunction(()=>[...probe.renderer.textures.values()].every(e=>e.ready||e.failed))
  results.alpha=await page.evaluate(()=>{
    const r=probe.renderer;probe.draw()
    const sign=r.objects.get('building').children.find(m=>m.userData.face==='sign')
    return {transparent:r.alphaHit({object:sign,uv:{x:.1,y:.5}}),opaque:r.alphaHit({object:sign,uv:{x:.9,y:.5}}),maps:r.objects.get('building').children.filter(m=>m.material?.map).length}
  })
  assert.equal(results.alpha.transparent,false);assert.equal(results.alpha.opaque,true);assert(results.alpha.maps>=3)
  results.activeTextures=await page.evaluate(()=>{
    const r=probe.renderer;r.frame+=360;r.frame-=r.frame%120;r.frame--;probe.draw()
    return r.textures.size
  })
  assert.equal(results.activeTextures,2,'in-use face textures survive cache collection')
  await page.screenshot({path:path.join(output,'cafe-textured.png')})
  results.textureEviction=await page.evaluate(()=>{
    const r=probe.renderer;probe.setTextures({});r.frame+=240;r.frame-=r.frame%120;r.frame--;probe.draw()
    probe.draw()
    return {cached:r.textures.size,glError:r.renderer.getContext().getError(),memory:{...r.renderer.info.memory}}
  })
  assert.equal(results.textureEviction.cached,0);assert.equal(results.textureEviction.glError,0)
  assert.equal(results.textureEviction.memory.textures,results.resources.empty.textures)
  results.modeTransition=await page.evaluate(()=>{
    const r=probe.renderer, old=r.objects.get('building'), expected=old.children.length;let geometries=0,materials=0
    old.traverse(m=>{m.geometry?.addEventListener('dispose',()=>geometries++);m.material?.addEventListener('dispose',()=>materials++)})
    probe.asset.meta.modularVolumeVersion=2;r.setScene(probe.map);probe.draw()
    const fallback=!r.objects.get('building').userData.volume
    probe.asset.meta.modularVolumeVersion=1;r.setScene(probe.map);probe.draw()
    return {fallback,restored:!!r.objects.get('building').userData.volume,geometries,materials,expected,glError:r.renderer.getContext().getError()}
  })
  assert(results.modeTransition.fallback&&results.modeTransition.restored)
  assert.equal(results.modeTransition.geometries,results.modeTransition.expected);assert.equal(results.modeTransition.materials,results.modeTransition.expected)
  assert.equal(results.modeTransition.glError,0)
  results.occlusion=await page.evaluate(async()=>{
    const {adaptAgent}=await import('/src/town/renderers/TownSceneAdapter.js')
    const r=probe.renderer
    r.updateAgents([adaptAgent({agentKey:'front',displayName:'前'},{x:5,y:8},'down',0),adaptAgent({agentKey:'back',displayName:'后'},{x:4,y:4},'down',0)])
    probe.draw()
    const front=r.pick(r.project({x:5.5,y:.6,z:8.5})),back=r.pick(r.project({x:4.5,y:.6,z:4.5}))
    const agentsOnly=r.pick(r.project({x:4.5,y:.6,z:4.5}),{agentsOnly:true})
    const gl=r.renderer.getContext(),pixel=new Uint8Array(4),p=r.project({x:5.5,y:1,z:8.5})
    gl.readPixels(Math.floor(p.x),gl.drawingBufferHeight-1-Math.floor(p.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel)
    return {front:front?.agent?.agentKey,back:back?.kind,agentsOnly:agentsOnly?.agent?.agentKey,frontPixel:[...pixel],glError:gl.getError()}
  })
  assert.equal(results.occlusion.front,'front');assert.equal(results.occlusion.back,'object');assert.equal(results.occlusion.agentsOnly,'back');assert.equal(results.occlusion.glError,0)
  assert(results.occlusion.frontPixel[0]>results.occlusion.frontPixel[1]*1.2,'foreground coral portrait must remain visible over the wall, not only pickable')
  await page.screenshot({path:path.join(output,'cafe-occlusion.png')})
  await page.evaluate(()=>{probe.renderer.updateAgents([]);probe.draw()})
  // Compare current legacy output byte-for-byte with renderer source from HEAD.
  await open('legacy=1&baseline=1');const before=await page.screenshot({path:path.join(output,'legacy-baseline.png')})
  await open('legacy=1');const after=await page.screenshot({path:path.join(output,'legacy-current.png')})
  assert(before.equals(after),'legacy fixture screenshot must match HEAD renderer exactly')
  results.legacySnapshotIdentical=true
  results.dispose=await page.evaluate(()=>{const r=probe.renderer;r.dispose();r.dispose();return {objects:r.objects.size,textures:r.textures.size,canvas:document.querySelectorAll('#scene canvas').length}})
  assert.deepEqual(results.dispose,{objects:0,textures:0,canvas:0})
  assert.deepEqual(errors,[])
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify({passed:true,output,results}))
} finally {await browser.close();await server.close()}
