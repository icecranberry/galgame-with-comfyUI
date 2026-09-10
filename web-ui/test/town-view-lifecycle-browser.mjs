// Only synthetic HTTP/SSE; real TownView/store/renderers perform every cleanup.
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(root,'../output/hd2d-town-view-lifecycle')
await fs.mkdir(out,{recursive:true})
const sockets=new Set(),requests=[],unknown=[],heldImages=[];let connections=0,closed=0,slowEndpoint=null,imageUrl='/lifecycle.svg'
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><path d="M8 38L32 10L56 38V92H8Z" fill="#b78d6b"/><path d="M4 38L32 4L60 38Z" fill="#855645"/></svg>'
const scope={worldId:'lifecycle-fixture',worldEpoch:1}
const assets=[{id:1,kind:'building',status:'ready',imagePath:'/lifecycle.svg',meta:{footprint:{w:3,h:2}}},{id:2,kind:'building',status:'ready',imagePath:'/lifecycle.svg',meta:{footprint:{w:3,h:3},doorOffset:{dx:1,dy:2},projection:'modular_volume',modularVolumeVersion:1,buildingProfile:'cafe'}}]
const map={id:1,cols:12,rows:12,version:1,name:'生命周期隔离小镇',assets,layers:{ground:[],road:[],objects:[{id:'legacy',assetId:1,x:2,y:4},{id:'volume',assetId:2,x:8,y:4}],blockOverride:[]}}
const agent={actorId:'resident',agentKey:'char:1',characterId:1,displayName:'木木',kind:'char',x:6,y:5,path:[],speed:1,sprites:{down:'/lifecycle.svg',up:'/lifecycle.svg'}}
const state=()=>({...scope,enabled:true,initialized:true,serverTime:Date.now(),map,locations:[],agents:[agent],encountersActive:[],weather:{hour:12,text:'晴'},player:{actorId:'player',agentKey:'me',displayName:'我',x:5,y:5,path:[],speed:1,sprites:{down:imageUrl,up:imageUrl}}})
const emit=(event,data)=>{for(const s of sockets)s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}
const server=await createServer({root,configFile:false,cacheDir:path.join(out,'.vite'),plugins:[vue(),{
  name:'lifecycle-observation-and-transport',
  transform(code,id){
    if(id.endsWith('/src/views/TownView.vue'))return code.replace('img.src = url',"globalThis.__life.observeWait(entry.ready, 'image');\n    img.src = url").replace('await preloadWorldResources()',"await globalThis.__life.observeWait(preloadWorldResources(), 'preload')").replace('await prepareWorldResources()',"await globalThis.__life.observeWait(prepareWorldResources(), 'prepare')")
    if(id.endsWith('/src/stores/unifiedStream.js'))return `${code}\nexport const __lifecycleSubscriptions=()=>Object.fromEntries([..._handlers].map(([key,set])=>[key,set.size]));`
    if(id.endsWith('/src/town/renderers/CanvasTownRenderer.js'))return code.replace('let scene = null, staticCanvas = null, staticDirty = true','globalThis.__life?.canvasCreated();\nlet scene = null, staticCanvas = null, staticDirty = true').replace('dispose() { staticCanvas = null;','dispose() { globalThis.__life?.canvasDisposed(); staticCanvas = null;')
  },
  configureServer(s){s.middlewares.use((req,res,next)=>{
    const url=new URL(req.url,'http://localhost')
    if(url.pathname==='/lifecycle.svg'){const respond=()=>{if(!res.destroyed){res.setHeader('Content-Type','image/svg+xml');res.end(svg)}};if(url.searchParams.has('hold'))heldImages.push(respond);else respond();return}
    if(!url.pathname.startsWith('/api/'))return next()
    requests.push({path:url.pathname,method:req.method,at:Date.now()})
    if(url.pathname==='/api/stream'){connections++;sockets.add(res);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('event: connected\ndata: {}\n\n');res.on('close',()=>{sockets.delete(res);closed++});return}
    const endpoint=url.pathname.replace('/api/town/','')
    const payloads={state:state(),map,assets:{assets},npcs:{npcs:[]},characters:{characters:[]},settings:{enabled:true},'player/kit':{},economy:{...scope,enabled:true,configured:false,wallet:{balance:0,reserved:0,available:0},orders:[],locations:[],participants:[],slice:null,service:null,venues:[]}}
    if(req.method==='POST'&&endpoint==='player/dir'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));return}
    if(req.method!=='GET'||!(endpoint in payloads)){unknown.push({method:req.method,path:url.pathname});res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Unexpected fixture request"}');return}
    const respond=()=>{if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payloads[endpoint]))}}
    if(endpoint===slowEndpoint)setTimeout(respond,900);else respond()
  })},
}],optimizeDeps:{noDiscovery:true,include:['vue','pinia','three']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null}})
await server.listen();const origin=new URL(server.resolvedUrls.local[0]).origin
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'}),page=await browser.newPage({viewport:{width:1100,height:760}})
const source=await fs.readFile(path.join(root,'src/views/TownView.vue'))
const errors=[],results={sourceHash:createHash('sha256').update(source).digest('hex'),rounds:[],limitations:['Headless desktop only; no Android or genuine hidden-page claim.','One shared Pinia and host-owned unified SSE connection persist across 20 ready-state mounts and three interrupted mounts.','Instrumentation observes native callbacks and original cleanup; no fixture cleanup substitutes for TownView.','The one-off Vue setDevtoolsHook initialization timer is recorded but excluded from component residual assertions; it must expire naturally by the final snapshot. Vite may retain an epoch-0 host heartbeat; it is recorded separately and never cancelled by the fixture.','Global listeners are read through CDP on window/document. Detached DOM listener reachability and total JS heap retention are not proved. GPU evidence is Three.js allocation counters and original dispose observations, not driver memory measurement.','Early cases delay state or map responses by 900ms and observe 6.7s after unmount. A third Canvas case holds an image HTTP response until after unmount and observes the original image/preload/prepare Promise settlement without resolving it in the fixture.']}
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort())
await page.addInitScript(()=>{
  const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window),timeout=setTimeout.bind(window),clearT=clearTimeout.bind(window),interval=setInterval.bind(window),clearI=clearInterval.bind(window),RO=ResizeObserver
  const pending=new Map(),observers=[],images=[],scheduled=[],waits=[],calls={raf:0,timer:0,resize:0,late:0},canvas={created:0,disposed:0},NativeImage=Image
  const life=window.__life={epoch:0,phase:'host',canvasCreated(){canvas.created++},canvasDisposed(){canvas.disposed++},observeWait(promise,kind){const record={epoch:life.epoch,kind,settled:false};waits.push(record);promise.then(value=>Object.assign(record,{settled:true,value,settledPhase:life.phase}),()=>Object.assign(record,{settled:true,rejected:true,settledPhase:life.phase}));return promise}}
  const entry=(kind)=>{const e={kind,epoch:life.epoch,phase:life.phase,at:performance.now(),source:new Error().stack};scheduled.push(e);return e}
  window.Image=class extends NativeImage{constructor(...args){super(...args);images.push({...entry('image'),ref:new WeakRef(this)})}}
  window.requestAnimationFrame=fn=>{const e=entry('raf');let id=raf(now=>{pending.delete(`r${id}`);calls.raf++;if(life.phase==='unmounted')calls.late++;fn(now)});pending.set(`r${id}`,e);return id}
  window.cancelAnimationFrame=id=>{pending.delete(`r${id}`);return cancel(id)}
  window.setTimeout=(fn,delay,...args)=>{const e=entry('timeout');let id=timeout(()=>{pending.delete(`t${id}`);calls.timer++;if(life.phase==='unmounted'&&e.epoch)calls.late++;typeof fn==='function'?fn(...args):(0,eval)(fn)},delay);pending.set(`t${id}`,e);return id}
  window.setInterval=(fn,delay,...args)=>{const e=entry('interval');let id=interval(()=>{calls.timer++;if(life.phase==='unmounted'&&e.epoch)calls.late++;fn(...args)},delay);pending.set(`t${id}`,e);return id}
  window.clearTimeout=id=>{pending.delete(`t${id}`);return clearT(id)}
  window.clearInterval=id=>{pending.delete(`t${id}`);return clearI(id)}
  window.ResizeObserver=class extends RO{
    constructor(fn){super((entries,observer)=>{calls.resize++;fn(entries,observer)});this.record={epoch:life.epoch,active:new Set(),disconnects:0,ref:new WeakRef(this)};observers.push(this.record)}
    observe(target,opts){super.observe(target,opts);this.record.active.add(target)}
    unobserve(target){super.unobserve(target);this.record.active.delete(target)}
    disconnect(){super.disconnect();this.record.active.clear();this.record.disconnects++}
  }
  const compact=e=>({...e,source:e.source?.split('\n').slice(1,7).join('\n')})
  life.snapshot=()=>({waits:waits.map(w=>({...w})),pending:[...pending.values()].map(compact),postUnmountScheduled:scheduled.filter(e=>e.phase==='unmounted').map(compact),images:images.map(e=>({epoch:e.epoch,phase:e.phase,source:compact(e).source,alive:!!e.ref.deref(),src:e.ref.deref()?.src,hasOnload:!!e.ref.deref()?.onload,hasOnerror:!!e.ref.deref()?.onerror})),observers:observers.map(r=>({epoch:r.epoch,active:r.active.size,disconnects:r.disconnects,alive:!!r.ref.deref()})),calls:{...calls},canvas:{...canvas}})
})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const cdp=await page.context().newCDPSession(page)
const listeners=async()=>{
  const result={}
  for(const name of ['window','document']){
    const {result:object}=await cdp.send('Runtime.evaluate',{expression:name})
    const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:object.objectId})
    result[name]=listeners.map(l=>({type:l.type,capture:l.useCapture,once:l.once,passive:l.passive,line:l.lineNumber})).sort((a,b)=>a.type.localeCompare(b.type)||a.line-b.line)
    await cdp.send('Runtime.releaseObject',{objectId:object.objectId})
  }return result
}
const subscriptions=s=>Object.values(s.subscriptions).reduce((a,b)=>a+b,0)
try{
  await page.goto(`${origin}/test/town-view-lifecycle-fixture.html`);await page.waitForFunction(()=>!!window.fixture)
  await page.evaluate(()=>fixture.startHost());await page.waitForFunction(()=>!!window.fixture)
  for(let i=0;i<100&&sockets.size!==1;i++)await delay(20)
  assert.equal(sockets.size,1)
  results.initial={state:await page.evaluate(()=>fixture.snapshot()),listeners:await listeners()}
  for(let epoch=1;epoch<=20;epoch++){
    const mode=epoch%2?'canvas':'balanced'
    await page.evaluate(({mode,epoch})=>fixture.mount(mode,epoch),{mode,epoch})
    await page.waitForFunction(()=>fixture.ready())
    if(mode==='balanced')await page.waitForFunction(()=>fixture.snapshot().renderers.some(r=>r.alive&&!r.disposed&&r.memory?.geometries>0))
    emit('town_ping',{})
    await page.waitForFunction(()=>fixture.town.connected)
    const mounted=await page.evaluate(()=>fixture.snapshot()),mountedListeners=await listeners()
    assert.equal(subscriptions(mounted),10);assert.equal(mounted.canvases,mode==='canvas'?1:2)
    await page.keyboard.down('w');await delay(30)
    const moving=await page.evaluate(()=>fixture.snapshot())
    assert(moving.instrumentation.pending.some(p=>p.kind==='interval'&&p.epoch===epoch),'real movement interval must be active before unmount')
    if(epoch===1||epoch===2)await page.screenshot({path:path.join(out,`${mode}-mounted.png`)})
    await page.evaluate(()=>fixture.unmount());await page.keyboard.up('w')
    const immediate=await page.evaluate(()=>fixture.snapshot())
    emit('town_ping',{});await delay(400)
    const after=await page.evaluate(()=>fixture.snapshot()),afterListeners=await listeners()
    const residual=after.instrumentation.pending.filter(p=>p.epoch>0&&!p.source.includes('setDevtoolsHook'))
    const observation={epoch,mode,mounted,mountedListeners,immediate,after,afterListeners,residual}
    results.rounds.push(observation)
    await fs.writeFile(path.join(out,'results.json'),JSON.stringify({...results,errors,unknown,connections,closed},null,2))
    assert.equal(subscriptions(after),0);assert.equal(after.connected,false);assert.equal(after.canvases,0)
    assert.deepEqual(residual,[]);assert(after.instrumentation.observers.every(o=>o.active===0&&o.disconnects>0))
    assert(after.renderers.every(r=>!r.alive||(r.disposed&&r.memory.geometries===0&&r.memory.textures===0&&!r.attached)))
    assert.equal(after.instrumentation.canvas.created,epoch);assert.equal(after.instrumentation.canvas.disposed,epoch)
    assert.equal(after.actions.start,epoch);assert.equal(after.actions.stop,epoch)
    if(epoch>1)assert.deepEqual(afterListeners,results.rounds[0].afterListeners,'global listeners must not accumulate across actual mounts')
    assert.equal(after.instrumentation.calls.raf,immediate.instrumentation.calls.raf,'no component RAF runs after unmount')
    console.log(JSON.stringify({epoch,mode,subscriptions:subscriptions(after),pending:residual.length,canvases:after.canvases,activeObservers:after.instrumentation.observers.filter(o=>o.active).length}))
  }
  results.early=[]
  for(const [i,endpoint] of ['state','map'].entries()){
    slowEndpoint=endpoint
    const epoch=21+i
    // Simulate entering a not-yet-loaded world, while keeping the real store instance.
    await page.evaluate(()=>{fixture.town.snapshot=null;fixture.town.mapData=null;fixture.town.loaded=false})
    const requestStart=requests.length
    await page.evaluate(({epoch})=>fixture.mount('balanced',epoch),{epoch})
    for(let i=0;i<150&&!requests.slice(requestStart).some(r=>r.path===`/api/town/${endpoint}`);i++)await delay(10)
    assert(requests.slice(requestStart).some(r=>r.path===`/api/town/${endpoint}`))
    await page.evaluate(()=>fixture.unmount())
    const immediate=await page.evaluate(()=>fixture.snapshot())
    await delay(1500)
    const late=await page.evaluate(()=>fixture.snapshot())
    await delay(5200)
    const settled=await page.evaluate(()=>fixture.snapshot())
    const scheduled=settled.instrumentation.postUnmountScheduled.filter(s=>s.epoch===epoch)
    const newImages=settled.instrumentation.images.filter(s=>s.epoch===epoch&&s.phase==='unmounted')
    results.early.push({endpoint,epoch,immediate,late,settled,scheduled,newImages,requests:requests.slice(requestStart)})
    await fs.writeFile(path.join(out,'early-unmount.json'),JSON.stringify(results.early,null,2))
    console.log(JSON.stringify({early:endpoint,postUnmountScheduled:scheduled.map(s=>s.kind),newImages:newImages.length,pending:settled.instrumentation.pending.filter(s=>s.epoch===epoch).length}))
    slowEndpoint=null
  }
  imageUrl='/lifecycle.svg?hold=1'
  for(const asset of assets)asset.imagePath=imageUrl
  agent.sprites={down:imageUrl,up:imageUrl}
  await page.evaluate(()=>{fixture.town.snapshot=null;fixture.town.mapData=null;fixture.town.loaded=false})
  await page.evaluate(()=>fixture.mount('canvas',23))
  await page.waitForFunction(()=>fixture.snapshot().instrumentation.waits.some(w=>w.epoch===23&&w.kind==='preload'&&!w.settled))
  for(let i=0;i<100&&!heldImages.length;i++)await delay(10)
  assert(heldImages.length>0,'image HTTP response must still be held')
  const imageMounted=await page.evaluate(()=>fixture.snapshot())
  await page.evaluate(()=>fixture.unmount())
  await delay(100)
  const imageUnmounted=await page.evaluate(()=>fixture.snapshot())
  const imageWaits=imageUnmounted.instrumentation.waits.filter(w=>w.epoch===23)
  results.slowImage={mounted:imageMounted,unmounted:imageUnmounted,heldResponses:heldImages.length}
  await fs.writeFile(path.join(out,'slow-image.json'),JSON.stringify(results.slowImage,null,2))
  assert(imageWaits.some(w=>w.kind==='image'&&w.value===false&&w.settled))
  assert(imageWaits.some(w=>w.kind==='prepare'&&w.settled))
  assert(imageWaits.every(w=>w.settled),'original image/preload/prepare promises must settle before HTTP response')
  assert(imageUnmounted.instrumentation.images.filter(e=>e.epoch===23).every(e=>!e.hasOnload&&!e.hasOnerror))
  assert.deepEqual(imageUnmounted.instrumentation.postUnmountScheduled.filter(e=>e.epoch===23),[])
  for(const respond of heldImages.splice(0))respond()
  await delay(400)
  results.slowImage.afterResponse=await page.evaluate(()=>fixture.snapshot())
  assert.deepEqual(results.slowImage.afterResponse.instrumentation.postUnmountScheduled.filter(e=>e.epoch===23),[])
  await fs.writeFile(path.join(out,'slow-image.json'),JSON.stringify(results.slowImage,null,2))
  console.log(JSON.stringify({slowImage:'PASS',waits:imageWaits}))
  results.beforeHostStop={connections,closed,sockets:sockets.size}
  await page.evaluate(()=>fixture.stopHost())
  for(let i=0;i<100&&sockets.size;i++)await delay(20)
  results.hostClosed={connections,closed,sockets:sockets.size,state:await page.evaluate(()=>fixture.snapshot())}
  assert.equal(sockets.size,0);assert.equal(connections,1);assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  assert.deepEqual(results.hostClosed.state.instrumentation.pending.filter(p=>!(p.epoch===0&&p.source.includes('/@vite/client'))),[],'only recorded host Vite infrastructure may remain')
  await page.screenshot({path:path.join(out,'after-20-unmounts.png')})
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({...results,errors,unknown,requests},null,2))
  await fs.writeFile(path.join(out,'README.md'),`# Real TownView lifecycle\n\nPASS: 20 same-page ready-state mount/unmount rounds (10 Canvas + 10 HD), real stores and synthetic HTTP/SSE. Each round: 10 town subscriptions mounted -> 0 unmounted; no residual component timers/RAF, active ResizeObservers, attached canvases or surviving measured Three.js geometry/texture allocations. Canvas create/dispose and Town stream start/stop each 20/20 at round 20. Global listeners do not accumulate. One host SSE connection persists until host stop, then closes.\n\nEarly unmount observations (additional rounds 21/22):\n${results.early.map(e=>`- Slow /${e.endpoint}: ${e.scheduled.length} schedules after unmount (${e.scheduled.filter(s=>s.kind==='raf').length} RAF, ${e.scheduled.filter(s=>s.kind==='timeout').length} timeout), ${e.newImages.length} new Images.`).join('\n')}\n\nEarly cleanup asserts zero post-unmount schedules and Images by default (LIFECYCLE_OBSERVE_EARLY=1 only for diagnostic baselines). Round 23 holds the image HTTP response: image ready resolves false and preload/prepare settle after original unmount, before the response is released; handlers are removed and no new schedules occur after response release. See slow-image.json. Baseline evidence is frozen separately in baseline/ and *.before.json.\n\n${results.limitations.map(s=>'- '+s).join('\n')}\n\nTownView SHA256: ${results.sourceHash}. See results.json for listener inventories and every mounted/immediate/400ms-unmounted snapshot, and early-unmount.json for callback stacks and delayed snapshots. All cleanup comes from original production functions.\n`)
  if(process.env.LIFECYCLE_OBSERVE_EARLY!=='1')for(const e of results.early){assert.equal(e.scheduled.length,0,`/${e.endpoint} must not schedule after unmount`);assert.equal(e.newImages.length,0)}
  console.log(JSON.stringify({normalPassed:true,rounds:20,earlyFindings:results.early.map(e=>({endpoint:e.endpoint,scheduled:e.scheduled.length,images:e.newImages.length})),output:out}))
}catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,results,errors,unknown},null,2));throw error}
finally{await cdp.detach();await browser.close();for(const s of sockets)s.end();await server.close()}
