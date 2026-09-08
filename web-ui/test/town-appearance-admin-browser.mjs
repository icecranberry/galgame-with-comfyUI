import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const server=await createServer({configFile:false,root,plugins:[vue()],optimizeDeps:{noDiscovery:true,include:['vue','pinia']},server:{hmr:false,watch:{ignored:['**/*']},host:'127.0.0.1',port:0}})
await server.listen();const origin=new URL(server.resolvedUrls.local[0]).origin
let browser
try {
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'})
  const page=await browser.newPage({viewport:{width:375,height:820},reducedMotion:'reduce'})
  const posts=[],errors=[],unknown=[]
  let rejectStale = true, rejectCharStale = true
  let holdNpcRead = false, releaseNpcRead, signalHeldNpcRead
  let holdNpcGeneration = false, releaseNpcGeneration, signalHeldNpcGeneration
  const asset=(id,status)=>({id,name:`素材${id}`,status:'ready',image_path:`/fixture/${id}.svg`,appearanceStatus:status,meta:{}})
  const npcs=[{id:1,displayName:'过时居民',townEnabled:true,portrait:asset(11,'unknown'),sprites:{down:asset(12,'needs_update'),up:asset(13,'current')},routine:[]},
    {id:2,displayName:'缺图居民',townEnabled:true,portrait:null,sprites:{down:asset(22,'unknown')},routine:[]}]
  const chars=[{id:1,displayName:'自有角色',townEnabled:true,portraitId:31,portraitUrl:'/fixture/portrait.svg',standingUrl:'/fixture/standing.svg',sprites:{down:'/fixture/32.svg',up:'/fixture/33.svg'},spriteIds:{down:32,up:33},spriteCount:2,appearanceStatus:{portrait:'current',standing:'unknown',sprites:{down:'unknown',up:'needs_update'}}},
    {id:2,displayName:'仅复用立绘',townEnabled:true,standingUrl:'/fixture/standing.svg',sprites:{},spriteIds:{},spriteCount:0,appearanceStatus:{portrait:'current',standing:'unknown',sprites:{}}},
    {id:3,displayName:'没有自有素材',townEnabled:true,sprites:{},spriteIds:{},spriteCount:0,appearanceStatus:{portrait:'current',sprites:{down:'current',up:'current'}}}]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(req.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="90" height="150"><rect width="90" height="150" fill="#e9ddcf"/><circle cx="45" cy="40" r="19" fill="#c99b86"/><path d="M24 70h42v55H24z" fill="#9aaf9b"/></svg>'})
    if(url.origin!==origin){unknown.push(req.url());return route.abort()}
    if(!url.pathname.startsWith('/api/'))return route.continue()
    if(req.method()==='POST'){
      const body=req.postDataJSON();posts.push({path:url.pathname,body})
      if(url.pathname==='/api/town/npcs/1/sprites'&&holdNpcGeneration){
        holdNpcGeneration=false
        const released=new Promise(resolve=>{releaseNpcGeneration=resolve})
        signalHeldNpcGeneration()
        await released
      }
      if(url.pathname==='/api/town/npcs/1/sprites'&&body.refreshAppearance===true&&rejectStale){rejectStale=false;return route.fulfill({status:409,json:{error:'生成所用外观已变化',code:'TOWN_ASSET_STALE'}})}
      if(url.pathname==='/api/town/characters/1/sprites'&&body.refreshAppearance===true&&rejectCharStale){rejectCharStale=false;return route.fulfill({status:409,json:{error:'生成所用外观已变化',code:'TOWN_ASSET_STALE'}})}
      if(url.pathname==='/api/town/npcs/2/sprites')return route.fulfill({status:503,json:{error:'generation unavailable'}})
      if(url.pathname==='/api/town/npcs/1/sprites'&&body.refreshAppearance===true)Object.values(npcs[0].sprites).forEach(a=>{a.appearanceStatus='current'})
      return route.fulfill({json:{ok:true}})
    }
    const payloads={'/api/town/npcs':{npcs},'/api/town/characters':{characters:chars},'/api/town/player/kit':{},'/api/town/settings':{},'/api/town/liquidity':{liquidity:null}}
    if(!(url.pathname in payloads)){unknown.push(url.pathname);return route.fulfill({status:404,json:{error:'unexpected'}})}
    if(url.pathname==='/api/town/npcs'&&holdNpcRead){
      holdNpcRead=false
      const previous=structuredClone(payloads[url.pathname])
      const released=new Promise(resolve=>{releaseNpcRead=resolve})
      signalHeldNpcRead()
      await released
      return route.fulfill({json:previous})
    }
    return route.fulfill({json:payloads[url.pathname]})
  })
  await page.goto(`${origin}/test/town-appearance-admin-fixture.html`)
  await page.getByRole('button',{name:'打开管理',exact:true}).click()
  const row=name=>page.locator('.ap-row').filter({hasText:name})
  const back=()=>page.getByRole('button',{name:'← 返回',exact:true}).click()
  await row('过时居民').click()
  assert.equal(await page.getByLabel('立绘外观状态').innerText(),'未记录外观版本')
  assert.equal(await page.getByLabel('正面小人外观状态').innerText(),'外观已变化，图片待更新')
  assert.equal(await page.getByLabel('背面小人外观状态').innerText(),'与当前外观一致')
  assert.equal(posts.length,0)
  const output=path.resolve(root,'../output/hd2d-appearance-admin');await fs.mkdir(output,{recursive:true})
  for(const width of [375,1100]){
    await page.setViewportSize({width,height:820})
    assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true)
    await page.screenshot({path:path.join(output,`npc-${width}.png`)})
  }
  await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).click()
  assert.deepEqual(posts.at(-1),{path:'/api/town/npcs/1/sprites',body:{refreshAppearance:true}})
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(),/未更新成功/)
  assert.match(await page.locator('.ap-sprite-wrap').first().locator('img').getAttribute('src'),/12.svg/)
  assert.equal(await page.getByLabel('正面小人外观状态').innerText(),'外观已变化，图片待更新')
  await page.getByRole('button',{name:'重新读取素材状态',exact:true}).click()
  await page.waitForLoadState('networkidle');assert.equal(posts.length,1)
  await page.setViewportSize({width:375,height:820})
  await page.getByRole('alert').scrollIntoViewIfNeeded()
  await page.screenshot({path:path.join(output,'stale-error-375.png')})
  await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).click()
  await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).waitFor({state:'hidden'})
  assert.equal(await page.getByLabel('正面小人外观状态').innerText(),'与当前外观一致')
  await back();await row('缺图居民').click()
  assert.equal(await page.getByLabel('背面小人外观状态').count(),0)
  await page.getByRole('button',{name:'生成缺失小人',exact:true}).click()
  assert.deepEqual(posts.at(-1),{path:'/api/town/npcs/2/sprites',body:{}})
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(),/未更新成功/)
  assert.doesNotMatch(await page.getByRole('alert').innerText(),/外观已变化/)
  await back();await page.getByRole('button',{name:'角色素材',exact:true}).click()
  assert.match(await row('仅复用立绘').innerText(),/未记录外观版本/)
  assert.doesNotMatch(await row('没有自有素材').innerText(),/与当前外观一致|未记录外观版本/)
  await row('自有角色').click()
  assert.equal(await page.getByLabel('立绘外观状态').innerText(),'与当前外观一致')
  assert.match(await page.locator('.ap-portrait-box img').getAttribute('src'),/portrait.svg/)
  assert.equal(await page.getByLabel('正面小人外观状态').innerText(),'未记录外观版本')
  await page.setViewportSize({width:1100,height:820})
  await page.screenshot({path:path.join(output,'character-1100.png')})
  await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).click()
  assert.deepEqual(posts.at(-1),{path:'/api/town/characters/1/sprites',body:{refreshAppearance:true}})
  await page.getByRole('alert').waitFor()
  assert.match(await page.locator('.ap-sprite-wrap').first().locator('img').getAttribute('src'),/32.svg/)
  await page.getByRole('button',{name:'重新读取素材状态',exact:true}).click()
  await page.waitForLoadState('networkidle');assert.equal(posts.length,4)
  assert.equal(await page.getByLabel('正面小人外观状态').innerText(),'未记录外观版本')
  await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).click()
  await page.getByRole('alert').waitFor({state:'hidden'})
  await back();await row('仅复用立绘').click()
  assert.equal(await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).count(),0)
  assert.equal(posts.length,5)
  // NPC retains its original overrides contract; only the new field is normalized.
  const legacy = {direction:'up',force:true,styleTags:['pixel'],promptPrefix:'旧前缀',loras:[{name:'fixture',strength:0.5}],artist:'fixture-artist'}
  await page.evaluate(async legacy=>{
    const api=await import('/src/api/index.js')
    const options={...legacy,refreshAppearance:'true'}
    await api.generateTownNpcSprites(9,options)
    if(options.refreshAppearance!=='true')throw new Error('caller options mutated')
    await api.generateTownNpcSprites(9,{...legacy,refreshAppearance:false})
    await api.generateTownNpcSprites(9,{...legacy,refreshAppearance:true})
    await api.generateTownCharacterSprites(9,{refreshAppearance:false,prompt:'ignored'})
  },legacy)
  assert.deepEqual(posts.slice(-4),[
    {path:'/api/town/npcs/9/sprites',body:legacy},
    {path:'/api/town/npcs/9/sprites',body:{...legacy,refreshAppearance:false}},
    {path:'/api/town/npcs/9/sprites',body:{...legacy,refreshAppearance:true}},
    {path:'/api/town/characters/9/sprites',body:{refreshAppearance:false}},
  ])
  // Reopening reads appearance again; a previous open's delayed snapshot cannot undo it.
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  holdNpcRead=true
  const heldReadStarted=new Promise(resolve=>{signalHeldNpcRead=resolve})
  await page.getByRole('button',{name:'打开管理',exact:true}).click()
  await heldReadStarted
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  npcs[0].sprites.down.appearanceStatus='needs_update'
  await page.getByRole('button',{name:'打开管理',exact:true}).click()
  await back()
  await page.getByRole('button',{name:'居民',exact:true}).click()
  await row('过时居民').click()
  await page.getByLabel('正面小人外观状态').filter({hasText:'外观已变化，图片待更新'}).waitFor()
  releaseNpcRead()
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByLabel('正面小人外观状态').innerText(),'外观已变化，图片待更新')
  assert.equal(posts.length,9)
  // A pending generation stays disabled across close/open and refreshes current reads on completion.
  holdNpcGeneration=true
  const generationStarted=new Promise(resolve=>{signalHeldNpcGeneration=resolve})
  await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).click()
  await generationStarted
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByRole('button',{name:'打开管理',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'按当前外观更新小人',exact:true}).isDisabled(),true)
  releaseNpcGeneration()
  await page.getByLabel('正面小人外观状态').filter({hasText:'与当前外观一致'}).waitFor()
  assert.equal(posts.length,10)
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  holdNpcRead=true
  const preWorldReadStarted=new Promise(resolve=>{signalHeldNpcRead=resolve})
  await page.getByRole('button',{name:'打开管理',exact:true}).click()
  await preWorldReadStarted
  npcs[0].displayName='新世界居民'
  await page.evaluate(async()=>{
    const {useTownStore}=await import('/src/stores/town.js')
    useTownStore().snapshot={worldId:'world-after-reset',worldEpoch:2}
  })
  await row('新世界居民').waitFor()
  releaseNpcRead()
  await page.waitForLoadState('networkidle')
  assert.equal(await row('过时居民').count(),0)
  assert.equal(await row('新世界居民').count(),1)
  assert.equal(posts.length,10)
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,posts,errors,unknown},null,2))
  console.log('PASS appearance per asset, missing/unknown separation, manual-only refresh, original default API, whitelist, standing priority')
}finally{await browser?.close();await server.close()}
