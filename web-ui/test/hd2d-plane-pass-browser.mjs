import {createServer} from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {syntheticAssets} from './fixtures/townStressScene.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),timing=process.env.PLANE_PASS_ABBA==='1'
const output=path.resolve(root,`../output/hd2d-m7-plane-pass${timing?'-abba':process.env.PLANE_PASS_SCREEN_DIAG==='1'?'-screen-diagnostic':process.env.PLANE_PASS_DIAG==='1'?'-diagnostic':'-raw-gate'}`)
await fs.mkdir(output,{recursive:true})
const assets={...syntheticAssets,'fractional.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><path d="M8 38L32 10L56 38V92H8Z" fill="#b78d6b"/><circle cx="16" cy="65" r="14" fill="#fff" opacity=".4"/><path d="M0 10H64V30H0Z" fill="#566b56" opacity=".35"/></svg>'}
const server=await createServer({root,configFile:false,cacheDir:path.join(output,'.vite'),optimizeDeps:{noDiscovery:true,include:['three']},server:{host:'127.0.0.1',port:5202,strictPort:true,hmr:false,watch:null},plugins:[{name:'plane-fixture',configureServer(s){s.middlewares.use('/stress-assets',(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!assets[name]){res.writeHead(404).end();return}res.setHeader('Content-Type','image/svg+xml');res.end(assets[name])})}}]})
await server.listen()
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'}),page=await browser.newPage({viewport:{width:1100,height:720},deviceScaleFactor:1})
const results={timing,cases:[]},errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:5202'?r.continue():r.abort())
try{
  await page.goto('http://127.0.0.1:5202/test/hd2d-plane-pass-fixture.html');await page.waitForFunction(()=>probe.loaded)
  if(process.env.PLANE_PASS_SCREEN_DIAG==='1'){
    for(const hour of [12,22]){
      await page.evaluate(hour=>probe.scene('dense',hour),hour);await page.waitForFunction(()=>{probe.draw(1000);return probe.ready()})
      for(const [index,single]of [false,false,true,true,false,false].entries()){
        await page.evaluate(single=>new Promise(resolve=>requestAnimationFrame(()=>{probe.setPass(single);probe.draw(1000);resolve()})),single)
        await page.screenshot({path:path.join(output,`screen-${hour}-${index}-${single?'B':'A'}.png`)})
      }
    }
  }else if(!timing){
    const scenarios=process.env.PLANE_PASS_DIAG==='1'&&process.env.PLANE_PASS_DIAG_FULL!=='1'?[['flipped',22]]:[['dense',12],['dense',22],['card',12],['volume',22],['flipped',12],['flipped',22]]
    for(const [kind,hour]of scenarios){
      await page.evaluate(({kind,hour})=>probe.scene(kind,hour),{kind,hour});await page.waitForFunction(()=>{probe.draw(1000);return probe.ready()})
      // Fixed preparation for BOTH shader variants after a scene/light change.
      // Never select a matching frame or tolerate differences: A/A and B/B below
      // must themselves be stable before asserting exact A/B bytes.
      if(process.env.PLANE_PASS_DIAG!=='1')await page.evaluate(async()=>{
        for(const single of [false,true]){probe.setPass(single);for(let i=0;i<30;i++)await new Promise(resolve=>requestAnimationFrame(()=>{probe.draw(1000);resolve()}))}
      })
      if(process.env.PLANE_PASS_DIAG==='1'&&kind==='flipped'&&hour===22){
        results.rawDiagnostic=await page.evaluate(()=>{
          const modes=[]
          for(const single of [false,true,false]){
            probe.setPass(single)
            const values=[];for(let i=0;i<6;i++){const pixels=probe.rawColor(),index=((innerHeight-1-165)*innerWidth+690)*4;values.push([...pixels.slice(index,index+4)])}
            modes.push({single,values})
          }
          const hit=probe.r.pick({x:690,y:165})
          return {modes,pick:{kind:hit?.kind,object:hit?.object,cell:hit?.cell},materials:[...probe.r.objects].map(([id,m])=>({id,volume:!!m.userData.volume,position:m.position.toArray(),scale:m.scale.toArray()}))}
        })
        console.log(JSON.stringify({rawDiagnostic:results.rawDiagnostic}))
      }
      for(const category of (process.env.PLANE_PASS_DIAG==='1'?['cards:0','cards:1','agents','shadows','all']:['cards','agents','shadows','all'])){
        const result=await page.evaluate(category=>{
          probe.setPass(false);const before=probe.capture(),repeatBefore=probe.capture()
          probe.setPass(true,category);const after=probe.capture(),repeatAfter=probe.capture()
          const differences=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n}
          const changed=[];for(let i=0;i<before.color.length&&changed.length<16;i++)if(before.color[i]!==after.color[i])changed.push({x:Math.floor(i/4)%before.width,y:before.height-1-Math.floor(i/4/before.width),channel:i%4,before:before.color[i],after:after.color[i]})
          return {category,changed,dimensions:[before.width,before.height],byteLengths:{color:before.color.length,depth:before.depth.length,shadow:before.shadowPixels.length},repeatBeforeBytes:differences(before.color,repeatBefore.color),repeatAfterBytes:differences(after.color,repeatAfter.color),colorBytes:differences(before.color,after.color),depthBytes:differences(before.depth,after.depth),shadowBytes:differences(before.shadowPixels,after.shadowPixels),samePick:JSON.stringify(before.picks)===JSON.stringify(after.picks),casters:[before.casters,after.casters],calls:[before.calls,after.calls],fades:after.fades,gl:after.gl,
            materialCounts:Object.fromEntries(Object.entries(probe.materials()).map(([k,v])=>[k,v.length]))}
        },category)
        results.cases.push({kind,hour,...result})
        await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
        console.log(JSON.stringify({kind,hour,...result}))
        if(process.env.PLANE_PASS_DIAG!=='1'){assert.equal(result.repeatBeforeBytes,0,'unchanged A/A must be stable');assert.equal(result.repeatAfterBytes,0,'unchanged B/B must be stable')}
        if(result.colorBytes||result.depthBytes||result.shadowBytes){
          for(const value of [false,true]){await page.evaluate(({value,category})=>{probe.setPass(value,category);probe.draw(1000)},{value,category});await page.screenshot({path:path.join(output,`${kind}-${hour}-${category.replace(':','-')}-${value?'single':'double'}-difference.png`)})}
          if(process.env.PLANE_PASS_DIAG!=='1')throw Error('Pixel difference: stop before changing production defaults')
        }
        assert(result.samePick);assert.equal(result.casters[0],result.casters[1]);assert.equal(result.gl,0)
      }
      // PNG diagnostics are recorded without a tolerance and do not gate raw renderer equality.
      const screenshots=[]
      for(const value of [false,false,true,true]){await page.evaluate(value=>new Promise(resolve=>requestAnimationFrame(()=>{probe.setPass(value);probe.draw(1000);resolve()})),value);screenshots.push(await page.screenshot({path:path.join(output,`${kind}-${hour}-${value?'single':'double'}-${screenshots.length}.png`)}))}
      const png=await page.evaluate(async images=>{
        const pixels=[]
        for(const image of images){const bytes=Uint8Array.from(atob(image),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);pixels.push(ctx.getImageData(0,0,canvas.width,canvas.height).data);bitmap.close()}
        return [[0,1,'AA'],[0,2,'AB'],[2,3,'BB']].map(([a,b,pair])=>{let changedChannels=0;for(let i=0;i<pixels[a].length;i++)if(pixels[a][i]!==pixels[b][i])changedChannels++;return {pair,changedChannels}})
      },screenshots.map(buffer=>buffer.toString('base64')))
      ;(results.pngDiagnostics||=[]).push({kind,hour,png})
    }
  }else{
    // Only run after an explicit exclusive timing window; never alongside correctness readbacks.
    await page.evaluate(()=>{probe.scene('dense',12);probe.run()})
    await page.waitForFunction(()=>probe.ready())
    for(const [index,single]of [false,true,true,false].entries()){
      await page.evaluate(single=>probe.setPass(single),single)
      const samples=await page.evaluate(async()=>{
        const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve))
        for(let i=0;i<30;i++)await frame()
        let last=await frame();const values=[]
        for(let i=0;i<180;i++){const now=await frame();values.push({at:now,interval:now-last,cpu:{...probe.lastCpu},calls:probe.r.renderer.info.render.calls});last=now}
        return values
      })
      results.cases.push({index,label:single?'B-single':'A-double',samples})
    }
    await page.evaluate(()=>probe.pause())
  }
  results.errors=errors;assert.deepEqual(errors,[]);results.passed=true
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify({passed:!results.cases.some(r=>r.colorBytes||r.depthBytes||r.shadowBytes),timing,output}))
}catch(error){
  results.passed=false;results.failure=error.message;results.errors=errors
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  throw error
}finally{await browser.close();await server.close()}
