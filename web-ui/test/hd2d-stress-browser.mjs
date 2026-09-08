// Run from repo root. Isolated local fixtures only; no app server, DB or model.
import {createServer} from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {syntheticAssets} from './fixtures/townStressScene.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.resolve(root,`../output/hd2d-m7-stress${process.env.STRESS_LABEL?`-${process.env.STRESS_LABEL}`:''}`)
await fs.mkdir(output,{recursive:true})
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const server=await createServer({root,configFile:false,cacheDir:path.join(output,'.vite'),optimizeDeps:{noDiscovery:true,include:['three']},server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false,watch:null},plugins:[{name:'synthetic-assets',configureServer(s){s.middlewares.use('/stress-assets',(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!syntheticAssets[name]){res.writeHead(404).end();return}res.setHeader('Content-Type','image/svg+xml');res.end(syntheticAssets[name])})}}]})
await server.listen()
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'})
const page=await browser.newPage({viewport:{width:1100,height:720},deviceScaleFactor:1})
const errors=[],results={environment:{headless:true,viewport:{width:1100,height:720},host:'Windows desktop',android:false},performance:[]}
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())})
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
const frames=n=>page.evaluate(n=>new Promise(resolve=>{const step=()=>{if(--n<=0)resolve();else requestAnimationFrame(step)};requestAnimationFrame(step)}),n)
const ready=async()=>{await page.waitForFunction(()=>window.probe?.ready());await frames(4)}
const measure=async(count,mode)=>{
  await page.evaluate(({count,mode})=>{probe.setCount(count);probe.setMode(mode)},{count,mode});await ready();await frames(30)
  const data=await page.evaluate(async()=>{
    const start=performance.now(),samples=[],cpu=[],calls=[];let last
    for(let i=0;i<181;i++)await new Promise(resolve=>requestAnimationFrame(now=>{if(last!==undefined){samples.push(now-last);cpu.push({...probe.lastCpu});calls.push(probe.hd?.renderer.info.render.calls||0)}last=now;resolve()}))
    const sorted=a=>[...a].sort((a,b)=>a-b),stat=a=>{const s=sorted(a);return {p50:s[Math.floor(s.length*.5)],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)}}
    const r=probe.hd,gl=r?.renderer.getContext(),debug=gl?.getExtension('WEBGL_debug_renderer_info')
    let geometryBytes=0,textureBytes=0,targetsBytes=0
    if(r){const seen=new Set();r.scene.traverse(m=>{const g=m.geometry;if(g&&!seen.has(g)){seen.add(g);for(const a of Object.values(g.attributes))geometryBytes+=a.array.byteLength;geometryBytes+=g.index?.array.byteLength||0}})
      for(const e of r.textures.values())if(e.ready)textureBytes+=e.texture.image.width*e.texture.image.height*4*(e.texture.generateMipmaps?4/3:1)
      // Conservative attachment estimate, not actual driver VRAM. RGBA16F + depth32 + MSAA.
      for(const t of [r.composer.renderTarget1,r.composer.renderTarget2,r.tiltPass.horizontal,r.tiltPass.vertical])targetsBytes+=t.width*t.height*((t.texture.type===1016?8:4)+(t.depthBuffer?4:0))*(1+(t.samples||0))
      targetsBytes+=r.sun.shadow.mapSize.x*r.sun.shadow.mapSize.y*8
    }
    return {residents:probe.agents.length,mode:probe.mode,samples,frame:stat(samples),cpu:Object.fromEntries(['total','update','render','composite'].map(k=>[k,stat(cpu.map(s=>s[k]))])),drawCalls:stat(calls),longTasks:probe.longTasks.filter(t=>t.start>=start),
      gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,glError:gl?.getError()??null,memory:r?{...r.renderer.info.memory,programs:r.renderer.info.programs.length,geometryBytes,textureBytes,targetsBytes}:null,
      config:r?{dpr:r.renderer.getPixelRatio(),shadow:r.sun.shadow.mapSize.x,tilt:r.tiltPass.defocus,volumes:[...r.objects.values()].filter(m=>m.userData.volume).length,objects:r.objects.size,chunks:r.chunks.size}:null,hidden:document.hidden}
  })
  assert.equal(data.hidden,false);if(data.glError!==null)assert.equal(data.glError,0)
  if(data.config){assert.equal(data.config.objects,80);assert.equal(data.config.volumes,3)}
  results.performance.push(data);console.log(JSON.stringify({count,mode,frame:data.frame,cpu:data.cpu.total,calls:data.drawCalls.p50}))
  await page.screenshot({path:path.join(output,`${count}-${mode}.png`)})
}
try{
  await page.goto('http://127.0.0.1:5198/test/hd2d-stress-fixture.html');await ready()
  if(process.env.STRESS_STEADY_ONLY==='1'){
    results.scope='One current focus-shader steady baseline; no A/B, CPU profile or repeated correctness suite'
    for(const count of [20,50,60])for(const mode of ['low','standard'])await measure(count,mode)
    const target=results.performance.find(r=>r.residents===60&&r.mode==='standard')
    results.desktopTarget={residents:60,objects:80,p95:target.frame.p95,targetMs:20,passed:target.frame.p95<=20,scope:'This headless desktop fixture only; not Android or complete visual acceptance'}
    assert.deepEqual(errors,[])
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
    console.log(JSON.stringify({passed:true,desktopTarget:results.desktopTarget,output}))
  }else{
  if(process.env.STRESS_VERIFY_ONLY!=='1'){
  const setSinglePass=value=>page.evaluate(value=>{for(const g of probe.hd.objects.values())if(g.userData.volume)g.traverse(m=>{if(m.material&&!m.userData.pickIgnore)m.material.forceSinglePass=value})},value)
  await page.evaluate(()=>{probe.setCount(50);probe.moving=false});await ready();await frames(30)
  results.singlePassAB=[];const images=[]
  for(const value of [false,true]){
    await setSinglePass(value);await frames(30)
    results.singlePassAB.push(await page.evaluate(async value=>{const samples=[];for(let i=0;i<120;i++)await new Promise(resolve=>requestAnimationFrame(()=>{samples.push(probe.lastCpu.total);resolve()}));samples.sort((a,b)=>a-b);return {singlePass:value,cpuP50:samples[60],cpuP95:samples[113],calls:probe.hd.renderer.info.render.calls}},value))
    await page.evaluate(()=>{probe.pause();probe.draw(1000)})
    images.push(await page.screenshot({path:path.join(output,`single-pass-${value}.png`)}));await page.evaluate(()=>probe.resume())
  }
  assert(images[0].equals(images[1]),'single-pass optimization must preserve synthetic mixed-scene pixels')
  results.singlePassPixelIdentical=true
  assert(results.singlePassAB[1].calls<results.singlePassAB[0].calls)
  console.log(JSON.stringify({singlePassAB:results.singlePassAB,pixelIdentical:true}))
  await fs.writeFile(path.join(output,'diagnostic.json'),JSON.stringify(results,null,2))
  }
  if(process.env.STRESS_AB_ONLY!=='1'){
  if(process.env.STRESS_VERIFY_ONLY!=='1'){
  await page.evaluate(()=>probe.moving=true)
  for(const count of [20,50])for(const mode of ['canvas','low','standard','tilt'])await measure(count,mode)
  await measure(60,'standard')
  const target=results.performance.find(r=>r.residents===60&&r.mode==='standard')
  results.desktopTarget={residents:60,objects:80,p95:target.frame.p95,targetMs:20,passed:target.frame.p95<=20,scope:'This headless desktop fixture only; not Android or complete visual acceptance'}
  const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await frames(120)
  const {profile}=await cdp.send('Profiler.stop');await cdp.detach()
  await fs.writeFile(path.join(output,'cpu-profile.cpuprofile'),JSON.stringify(profile))
  results.cpuHotspots=profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,20).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url,hits:n.hitCount}))
  }
  // Actual mouse events through the same screen/ground conversion as the host.
  results.mapping=[];results.agentPicks=[]
  await page.evaluate(()=>{probe.moving=false;probe.camera={x:0,y:760,zoom:.5};probe.setCount(50)})
  for(const mode of ['canvas','standard','tilt']){
    await page.evaluate(mode=>probe.setMode(mode),mode);await ready()
    for(const [x,y,value] of [[18,25,1],[18,25,0],[17,23,0],[17,23,1]]){
      const p=await page.evaluate(({x,y,value})=>{probe.editing=true;probe.editValue=value;return probe.groundPoint(x,y)},{x,y,value})
      await page.mouse.click(p.x,p.y)
      const actual=await page.evaluate(()=>probe.edits.at(-1));assert.deepEqual(actual,{x,y,value,blocked:!!value});results.mapping.push({mode,...actual})
    }
    await page.evaluate(()=>{probe.editing=false;probe.agentOnly=true})
    for(const i of [0,1,2,49]){
      const p=await page.evaluate(i=>{const a=probe.agents[i],p=probe.groundPoint(a.x,a.y);p.y-=i===49?12:18;return p},i)
      await page.mouse.click(p.x,p.y)
      const pick=await page.evaluate(()=>probe.picks.at(-1));assert.equal(pick.agent,`resident:${i}`);results.agentPicks.push({mode,index:i,agent:pick.agent})
    }
    await page.evaluate(()=>probe.agentOnly=false)
  }
  await page.evaluate(()=>probe.editing=false)
  // Context loss exercises renderer callback -> 2D fallback -> user reselect/new context.
  const context=await page.evaluate(()=>{const r=probe.hd;const ext=r.renderer.getContext().getExtension('WEBGL_lose_context');if(ext)ext.loseContext();return !!ext})
  assert(context,'context-loss extension required for this fixture')
  await page.waitForFunction(()=>probe.mode==='canvas'&&!probe.hd);await frames(4)
  results.contextLost=await page.evaluate(()=>({failures:probe.failures.length,canvas:document.querySelectorAll('canvas').length,release:probe.releases.at(-1),raf:!!probe.raf}))
  assert.equal(results.contextLost.failures,1);assert.equal(results.contextLost.canvas,1);assert(results.contextLost.raf)
  await page.screenshot({path:path.join(output,'contextlost-canvas.png')})
  await page.evaluate(()=>probe.setMode('standard'));await ready()
  results.recovered=await page.evaluate(()=>({mode:probe.mode,gl:probe.hd.renderer.getContext().getError(),objects:probe.hd.objects.size,raf:!!probe.raf}))
  assert.deepEqual(results.recovered,{mode:'standard',gl:0,objects:80,raf:true})
  await page.screenshot({path:path.join(output,'recovered-hd.png')})
  const textureBaseline=await page.evaluate(()=>probe.hd.textures.size)
  for(const version of [2,3,4]){
    await page.evaluate(version=>{for(const a of probe.map.assets)if([3,4].includes(a.id))a.meta.updatedAt=version;probe.refreshScene()},version);await ready()
    await page.evaluate(()=>{const r=probe.hd;r.frame+=360;r.frame-=r.frame%120;r.frame--;probe.draw(1000)})
  }
  results.textureVersions=await page.evaluate(()=>({cached:probe.hd.textures.size,gl:probe.hd.renderer.getContext().getError()}))
  assert.equal(results.textureVersions.cached,textureBaseline);assert.equal(results.textureVersions.gl,0)
  await page.evaluate(()=>{probe.map.assets.find(a=>a.id===3).imagePath='/stress-assets/missing.svg';probe.refreshScene()});await ready()
  results.missingTexture=await page.evaluate(()=>({failed:[...probe.hd.textures.values()].some(e=>e.failed),fallback:!probe.hd.objects.get('legacy:0').material.map,objects:probe.hd.objects.size,gl:probe.hd.renderer.getContext().getError()}))
  assert.deepEqual(results.missingTexture,{failed:true,fallback:true,objects:80,gl:0})
  await page.screenshot({path:path.join(output,'missing-texture.png')})
  await page.evaluate(()=>{probe.map.assets.find(a=>a.id===3).imagePath='/stress-assets/card.svg';probe.refreshScene()});await ready()
  await page.evaluate(()=>{probe.setMode('canvas');probe.simulateUnavailable=true;probe.setMode('standard')});await frames(2)
  assert.equal(await page.evaluate(()=>probe.mode),'canvas');await page.evaluate(()=>probe.simulateUnavailable=false)
  // Twenty full GPU dispose/recreate cycles, preserving the same scene and input owner.
  results.cycles=[]
  for(let i=0;i<20;i++){
    await page.evaluate(()=>probe.setMode('standard'));await ready()
    const live=await page.evaluate(()=>({...probe.hd.renderer.info.memory,canvases:document.querySelectorAll('canvas').length}))
    await page.evaluate(()=>probe.setMode('canvas'));await frames(2)
    const released=await page.evaluate(()=>probe.releases.at(-1));assert.equal(released.memory.geometries,0);assert.equal(released.memory.textures,0);assert.equal(released.objects,0);assert.equal(released.textures,0)
    results.cycles.push({live,released})
  }
  assert(results.cycles.every(c=>c.live.geometries===results.cycles[0].live.geometries&&c.live.textures===results.cycles[0].live.textures&&c.live.canvases===2))
  // Use a real background tab when the headless host exposes visibility changes.
  const cover=await browser.newPage();await cover.goto('about:blank');await cover.bringToFront()
  const hidden=await page.evaluate(()=>document.hidden),hiddenDraws=await page.evaluate(()=>probe.draws)
  await cover.evaluate(()=>new Promise(resolve=>{let n=8;function frame(){if(--n)requestAnimationFrame(frame);else resolve()}requestAnimationFrame(frame)}))
  results.visibility={supported:hidden,paused:hidden?await page.evaluate(()=>!probe.raf&&probe.draws)===hiddenDraws:null}
  if(hidden)assert(results.visibility.paused)
  await page.bringToFront();await cover.close();await frames(4)
  // Explicit event fixture covers the visibility handler when headless tabs stay visible.
  const beforeHidden=await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));return probe.draws})
  await frames(4);assert.equal(await page.evaluate(()=>probe.draws),beforeHidden)
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await frames(4)
  results.visibility.syntheticHandler=await page.evaluate(()=>!!probe.raf&&probe.draws)>beforeHidden
  assert(results.visibility.syntheticHandler)
  await page.evaluate(()=>probe.pause());const paused=await page.evaluate(()=>probe.draws);await frames(5);assert.equal(await page.evaluate(()=>probe.draws),paused)
  await page.evaluate(()=>{probe.resume();probe.resume()});await frames(5);const resumed=await page.evaluate(()=>probe.draws);assert(resumed-paused>=4&&resumed-paused<=6,'resume must not create a second RAF')
  await page.evaluate(()=>probe.dispose());await frames(3)
  results.disposed=await page.evaluate(()=>({raf:probe.raf,canvases:document.querySelectorAll('canvas').length,hd:!!probe.hd,draws:probe.draws}))
  await frames(3);assert.equal(await page.evaluate(()=>probe.draws),results.disposed.draws)
  assert.equal(results.disposed.raf,0);assert.equal(results.disposed.canvases,0);assert.deepEqual(errors,[])
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify({passed:true,desktopTarget:results.desktopTarget,output}))
  }
  }
}finally{await browser.close();await server.close()}
