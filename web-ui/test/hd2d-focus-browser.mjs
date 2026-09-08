import {createServer} from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {syntheticAssets} from './fixtures/townStressScene.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(root,'../output/hd2d-m7-focus')
await fs.mkdir(output,{recursive:true})
// Prefer captured pre-fix sources; clean checkouts can reconstruct just the old
// all-resident + soft-alpha policy without keeping a second production renderer.
const read=name=>fs.readFile(path.join(root,'src/town/renderers',`${name}.js`),'utf8')
let oldRenderer,oldLook,baselineSource='captured pre-fix renderer and sceneLook'
try{oldRenderer=await fs.readFile(path.join(output,'baseline/Hd2dTownRenderer.js'),'utf8');oldLook=await fs.readFile(path.join(output,'baseline/sceneLook.js'),'utf8')}
catch{baselineSource='reconstructed old all-resident/soft-alpha policy';oldRenderer=(await read('Hd2dTownRenderer')).replace('const subjects = [...this.agents.values()].filter(mesh => isInteractionSubject(mesh.userData.dto.agent, keys))','const subjects = [...this.agents.values()]').replace('? volumeOccludesAgent(building, agent, this.camera, hit => this.alphaHit(hit))','? false');oldLook=(await read('sceneLook')).replace("'./interactionOcclusion.js'","'./interactionOcclusion.focus-baseline.js'")}
oldRenderer=oldRenderer.replace("'./sceneLook.js'","'./sceneLook.focus-baseline.js'")
const sources={Hd2dTownRenderer:oldRenderer,sceneLook:oldLook,interactionOcclusion:(await read('interactionOcclusion')).replace('if (townFade < 1. && townCoverage(gl_FragCoord.xy) >= townFade) discard;','diffuseColor.a *= townFade;')}
const server=await createServer({root,configFile:false,cacheDir:path.join(output,'.vite'),optimizeDeps:{noDiscovery:true,include:['three']},server:{host:'127.0.0.1',port:5199,strictPort:true,hmr:false,watch:null},plugins:[{name:'focus-fixture',configureServer(s){s.middlewares.use('/stress-assets',(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);res.setHeader('Content-Type','image/svg+xml');res.end(syntheticAssets[name])})},resolveId(id){if(id.endsWith('.focus-baseline.js'))return path.join(root,'src/town/renderers',path.basename(id))},load(id){if(id.endsWith('.focus-baseline.js'))return sources[path.basename(id).split('.')[0]]}}]})
await server.listen()
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'}),page=await browser.newPage({viewport:{width:1100,height:720}})
const errors=[],results={baselineSource}
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())})
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
const open=async baseline=>{await page.goto(`http://127.0.0.1:5199/test/hd2d-focus-fixture.html${baseline?'?baseline=1':''}`);await page.waitForFunction(()=>window.probe?.ready);await page.evaluate(()=>probe.draw())}
const shot=async name=>{await page.evaluate(()=>probe.draw());await page.screenshot({path:path.join(output,`${name}.png`)})}
try{
  await open(true);results.denseBefore=await page.evaluate(()=>probe.fades());await shot('dense-before')
  await page.evaluate(()=>probe.renderer.dispose())
  await open(false);results.denseAfter=await page.evaluate(()=>{probe.points=probe.agents.map(a=>({x:a.x+.5,z:a.y+.5}));probe.draw();return probe.fades()});await shot('dense-after')
  assert(results.denseBefore.length>5);assert(results.denseAfter.length>5)
  results.isolated=[]
  for(const volume of [false,true]){
    const state=await page.evaluate(volume=>{
      probe.isolated(volume);probe.agents=[probe.resident('npc:a',4,volume?4:5,'actor:a'),probe.resident('npc:b',10,volume?4:5,'actor:b')];probe.draw()
      return {initial:probe.fades()}
    },volume)
    assert.deepEqual(state.initial,['a','b'])
    state.focusA=await page.evaluate(()=>{probe.keys=['npc:a'];probe.draw();return probe.fades()});assert.deepEqual(state.focusA,['a','b'])
    await shot(`${volume?'volume':'card'}-focus-a`)
    state.focusB=await page.evaluate(()=>{probe.keys=['actor:b'];probe.draw();return probe.fades()});assert.deepEqual(state.focusB,['a','b'])
    state.stale=await page.evaluate(()=>{probe.keys=['removed-actor'];probe.draw();return probe.fades()});assert.deepEqual(state.stale,['a','b'])
    state.defaultMe=await page.evaluate(()=>{probe.keys=undefined;probe.agents[0].agentKey='me';probe.draw();return probe.fades()});assert.deepEqual(state.defaultMe,['a','b'])
    state.meAndDialogue=await page.evaluate(()=>{probe.keys=['actor:b'];probe.draw();return probe.fades()});assert.deepEqual(state.meAndDialogue,['a','b'])
    state.left=await page.evaluate(()=>{probe.keys=undefined;probe.agents[0].x=1;probe.agents[0].y=30;probe.draw();return probe.fades()});assert.deepEqual(state.left,['b'])
    await shot(`${volume?'volume':'card'}-restored`)
    // Snapshot source picking and physical shadow topology across focus changes.
    state.pickAndDepth=await page.evaluate(volume=>{
      const r=probe.renderer;probe.agents[0]=probe.resident('npc:a',4,volume?4:5,'actor:a')
      probe.keys=[];probe.draw()
      const points=[];for(let y=180;y<650;y+=19)for(let x=130;x<650;x+=19)points.push({x,y})
      const pick=()=>points.map(p=>{const h=r.pick(p);return `${h?.kind}:${h?.object?.id||h?.agent?.agentKey||JSON.stringify(h?.cell)}`})
      const color=()=>{const gl=r.renderer.getContext(),p=new Uint8Array(innerWidth*innerHeight*4);gl.readPixels(0,0,innerWidth,innerHeight,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}
      const beforePick=pick(),beforeColor=color(),beforeDepth=probe.depthPixels()
      const casters=()=>{let n=0;r.scene.traverse(m=>{if(m.castShadow)n++});return n}
      const beforeCasters=casters()
      probe.keys=['npc:a'];probe.draw();const afterPick=pick(),afterColor=color(),afterDepth=probe.depthPixels()
      const box=new probe.T.Box3().setFromObject(r.objects.get('a')),corners=[]
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(r.project({x,y,z}))
      const bounds={x0:Math.min(...corners.map(p=>p.x))-2,x1:Math.max(...corners.map(p=>p.x))+2,y0:Math.min(...corners.map(p=>p.y))-2,y1:Math.max(...corners.map(p=>p.y))+2}
      let depthChanged=0,pairedColor=0,outsideColor=0
      for(let i=0;i<beforeDepth.length;i+=4){
        const changed=beforeColor[i]!==afterColor[i]||beforeColor[i+1]!==afterColor[i+1]||beforeColor[i+2]!==afterColor[i+2]
        if(beforeDepth[i]!==afterDepth[i]||beforeDepth[i+1]!==afterDepth[i+1]||beforeDepth[i+2]!==afterDepth[i+2]||beforeDepth[i+3]!==afterDepth[i+3]){depthChanged++;if(changed)pairedColor++}
        const x=(i/4)%innerWidth,y=innerHeight-1-Math.floor(i/4/innerWidth)
        if(changed&&(x<bounds.x0||x>bounds.x1||y<bounds.y0||y>bounds.y1))outsideColor++
      }
      return {samePick:JSON.stringify(beforePick)===JSON.stringify(afterPick),beforeCasters,afterCasters:casters(),depthChanged,pairedColor,outsideColor,gl:r.renderer.getContext().getError()}
    },volume)
    assert(state.pickAndDepth.samePick);assert.equal(state.pickAndDepth.beforeCasters,state.pickAndDepth.afterCasters);assert.equal(state.pickAndDepth.depthChanged,0);assert.equal(state.pickAndDepth.gl,0)
    assert.equal(state.pickAndDepth.pairedColor,0);
    state.viewport = []
    for (const [label, targetNdc] of [['partial', .995], ['outside', 1.6], ['returned', 0]]) {
      const edge = await page.evaluate(async targetNdc => {
        const { visibleBodySamples } = await import('/src/town/renderers/interactionOcclusion.js')
        const r = probe.renderer, agent = r.agents.get('npc:a')
        const screen = r.project(agent.position)
        r.setCamera({ ...r.cameraState, y: r.cameraState.y + (screen.y - (1 - targetNdc) * innerHeight / 2) / r.cameraState.zoom })
        probe.draw()
        const count = [...visibleBodySamples(agent, r.camera)].length
        return { count, fades: probe.fades(), gl: r.renderer.getContext().getError() }
      }, targetNdc)
      if (label === 'outside') { assert.equal(edge.count, 0); assert.deepEqual(edge.fades, []) }
      else { assert(edge.count > 0); assert.deepEqual(edge.fades, ['a','b']) }
      assert.equal(edge.gl, 0)
      state.viewport.push({ label, ...edge })
      await shot(`${volume?'volume':'card'}-viewport-${label}`)
    }
    assert(state.viewport[0].count < state.viewport[2].count, 'partly clipped body remains eligible')
    results.isolated.push({volume,...state})
  }
  results.canvas=await page.evaluate(async()=>{
    const {createCanvasTownRenderer}=await import('/src/town/renderers/CanvasTownRenderer.js')
    probe.isolated(false);probe.draw()
    const image=[...probe.renderer.textures.values()].find(e=>e.ready&&e.texture.image.src?.includes('card.svg')).texture.image
    const c=document.createElement('canvas').getContext('2d'),drawImage=c.drawImage.bind(c);let alphas=[]
    c.drawImage=(...args)=>{if(args[0]===image)alphas.push(c.globalAlpha);drawImage(...args)}
    const canvas=createCanvasTownRenderer({getImg:url=>url?.includes('card.svg')?image:null,agentFacing:()=> 'down'})
    canvas.setScene(probe.map)
    const frames=[{agent:{agentKey:'npc:a',actorId:'actor:a'},pos:{x:5,y:6}},{agent:{agentKey:'npc:b',actorId:'actor:b'},pos:{x:11,y:6}}]
    const draw=opts=>{alphas=[];canvas.draw(c,frames,0,opts);return [...alphas]}
    const initial=draw(),focusA=draw({interactionActorKeys:['npc:a']}),focusB=draw({interactionActorKeys:['actor:b']}),restored=draw({interactionActorKeys:[]}),hover=draw({hover:'npc:a'})
    frames[0].agent.agentKey='me';const me=draw();canvas.dispose();return {initial,focusA,focusB,restored,hover,me}
  })
  assert.deepEqual(results.canvas.initial,[0.62,0.62]);assert.deepEqual(results.canvas.restored,[0.62,0.62])
  assert(results.canvas.focusA[0]<1&&results.canvas.focusA[1]<1);assert(results.canvas.focusB[0]<1&&results.canvas.focusB[1]<1)
  assert.deepEqual(results.canvas.hover,results.canvas.focusA);assert.deepEqual(results.canvas.me,results.canvas.focusA)
  assert.deepEqual(errors,[])
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:true,output,results}))
}finally{await browser.close();await server.close()}
