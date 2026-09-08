// One current 60/80 sample only. Never imports/runs the stress correctness suite.
import {createServer} from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {syntheticAssets} from './fixtures/townStressScene.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.resolve(root,'../output/hd2d-m7-profiler-only')
await fs.mkdir(output,{recursive:true})
const hashes={}
for(const file of ['src/town/renderers/Hd2dTownRenderer.js','src/town/renderers/interactionOcclusion.js','src/town/renderers/cardLayers.js','src/town/renderers/CanvasTownRenderer.js','test/hd2d-stress-fixture.html']){
  hashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')
}
const server=await createServer({root,configFile:false,cacheDir:path.join(output,'.vite'),optimizeDeps:{noDiscovery:true,include:['three']},server:{host:'127.0.0.1',port:5201,strictPort:true,hmr:false,watch:null},plugins:[{name:'profiler-synthetic-only',configureServer(s){s.middlewares.use('/stress-assets',(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!syntheticAssets[name]){res.writeHead(404).end();return}res.setHeader('Content-Type','image/svg+xml');res.end(syntheticAssets[name])})}}]})
await server.listen()
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'})
const page=await browser.newPage({viewport:{width:1100,height:720},deviceScaleFactor:1}),errors=[]
const cdp=await page.context().newCDPSession(page)
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:5201'?r.continue():r.abort())
const frames=n=>page.evaluate(n=>new Promise(resolve=>{const frame=()=>--n?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame)}),n)
const collect=(count,anchor)=>page.evaluate(async({count,anchor})=>{
  let last=anchor?await new Promise(resolve=>requestAnimationFrame(resolve)):null
  const start=performance.now(),samples=[]
  for(let i=0;i<count;i++)await new Promise(resolve=>requestAnimationFrame(now=>{
    const cpu={...probe.lastCpu}
    samples.push({rafAt:now,interval:last===null?null:now-last,draw:probe.draws,cpu,
      renderOutsideComposer:cpu.render-cpu.composite,otherDraw:cpu.total-cpu.update-cpu.render,
      calls:probe.hd.renderer.info.render.calls})
    last=now;resolve()
  }))
  return {start,end:performance.now(),hidden:document.hidden,samples,
    longTasks:probe.longTasks.filter(t=>t.start>=start)}
},{count,anchor})
const stat=values=>{const a=[...values].sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}}
let result,profile
try{
  await page.goto('http://127.0.0.1:5201/test/hd2d-stress-fixture.html')
  await page.waitForFunction(()=>window.probe?.ready())
  await page.evaluate(()=>{probe.setCount(60);probe.setMode('standard')})
  await page.waitForFunction(()=>probe.hd.agents.size===60&&probe.ready())
  await frames(30)
  const unprofiled=await collect(180,true)
  // This is a separate subsequent window, not a profile of the preceding 180.
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
  const profiled=await collect(120,false)
  ;({profile}=await cdp.send('Profiler.stop'))
  const environment=await page.evaluate(()=>{
    const r=probe.hd,gl=r.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,glError:gl.getError(),
      mode:probe.mode,residents:probe.agents.length,objects:r.objects.size,
      volumes:[...r.objects.values()].filter(m=>m.userData.volume).length,
      dpr:r.renderer.getPixelRatio(),shadow:r.sun.shadow.mapSize.x,tilt:r.tiltPass.defocus,
      memory:{...r.renderer.info.memory,programs:r.renderer.info.programs.length}}
  })
  result={capturedAt:new Date().toISOString(),browser:browser.version(),hashes,environment,
    scope:'Current scene only; separate unprofiled180 and subsequent profiled120 windows; no historical causal comparison',
    unprofiled,profiled,errors}
  for(const window of [unprofiled,profiled]){
    window.summary={frame:stat(window.samples.map(s=>s.interval).filter(v=>v!==null)),
      cpu:Object.fromEntries(['total','update','render','composite'].map(k=>[k,stat(window.samples.map(s=>s.cpu[k]))])),
      renderOutsideComposer:stat(window.samples.map(s=>s.renderOutsideComposer)),otherDraw:stat(window.samples.map(s=>s.otherDraw)),calls:stat(window.samples.map(s=>s.calls))}
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2))
  await fs.writeFile(path.join(output,'cpu-profile.cpuprofile'),JSON.stringify(profile))
  assert.equal(environment.residents,60);assert.equal(environment.objects,80);assert.equal(environment.volumes,3)
  assert.equal(environment.glError,0);assert(!unprofiled.hidden&&!profiled.hidden);assert.deepEqual(errors,[])
  console.log(JSON.stringify({captureComplete:true,output,unprofiled:unprofiled.summary,profiled:profiled.summary}))
}finally{await cdp.detach();await browser.close();await server.close()}
// Offline analysis only after browser closes. Inclusive totals overlap by design.
if(profile){
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(),self=new Map(),inclusive=new Map()
  for(const node of profile.nodes)for(const child of node.children||[])parents.set(child,node.id)
  const categories={idle:0,gc:0,programSelection:0,canvas:0,occlusionRaycast:0,shaderCompile:0}
  for(let i=0;i<profile.samples.length;i++){
    let id=profile.samples[i];const dt=profile.timeDeltas[i]||0,chain=[]
    self.set(id,(self.get(id)||0)+dt)
    while(id){inclusive.set(id,(inclusive.get(id)||0)+dt);chain.push(nodes.get(id).callFrame);id=parents.get(id)}
    const has=predicate=>chain.some(predicate)
    if(has(f=>f.functionName==='(idle)'))categories.idle+=dt
    if(has(f=>f.functionName==='(garbage collector)'))categories.gc+=dt
    if(has(f=>['getParameters','getProgram','setProgram'].includes(f.functionName)))categories.programSelection+=dt
    if(has(f=>f.url.includes('CanvasTownRenderer')))categories.canvas+=dt
    if(has(f=>/volumeOccludesAgent|raycast|intersectObject/.test(f.functionName)))categories.occlusionRaycast+=dt
    if(has(f=>/compileShader|linkProgram|WebGLProgram$/.test(f.functionName)))categories.shaderCompile+=dt
  }
  const top=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,35).map(([id,time])=>({nodeId:id,ms:time/1000,...nodes.get(id).callFrame,line:nodes.get(id).callFrame.lineNumber+1}))
  const analysis={scope:'Only the subsequent 120-frame profile; weighted sampled time, not exact function CPU or GPU execution time',durationMs:(profile.endTime-profile.startTime)/1000,samples:profile.samples.length,
    categoriesMs:Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,v/1000])),self:top(self),inclusive:top(inclusive)}
  await fs.writeFile(path.join(output,'analysis.json'),JSON.stringify(analysis,null,2))
  console.log(JSON.stringify({analysisComplete:true,durationMs:analysis.durationMs,categories:analysis.categoriesMs}))
}
