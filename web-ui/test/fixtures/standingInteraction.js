// Real production view, synthetic images and an in-memory server. No request
// falls through to the user's backend, character data or generation services.
import {createApp,h,reactive} from 'vue'
import {createPinia} from 'pinia'
import StandingDisplayView from '../../src/views/StandingDisplayView.vue'
import LinsheButton from '../../src/components/ui/LinsheButton.vue'
import {TOUCH_LABELS} from '../../src/utils/standingTouch.js'
import {runStandingGestureChecks} from './standingInteractionDriver.js'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/components.css'
import '../../src/styles/animations.css'

const metrics=reactive({requests:0,writes:0,forbidden:0,character:1,theme:'warm',sleep:false,delayed:false,gesture:'未操作',checks:'',running:false,composition:0,offline:false,reduced:false})
// Fixture-only media preference override to exercise both motion branches
// without changing the user's browser or OS accessibility preference.
const nativeMatchMedia=window.matchMedia.bind(window)
let fullMotionPreview=false
const motionMedia=nativeMatchMedia('(prefers-reduced-motion: reduce)')
window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'?new Proxy(motionMedia,{get(target,key){if(key==='matches')return fullMotionPreview?false:target.matches;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}}):nativeMatchMedia(query)
let downAt=0,moves=0
document.addEventListener('pointerdown',event=>{if(event.target.closest('.interaction-hit')){downAt=performance.now();moves=0}},true)
document.addEventListener('pointermove',()=>moves++,true)
document.addEventListener('pointerup',()=>{if(downAt){metrics.gesture=`${Math.round(performance.now()-downAt)}ms / ${moves} 次移动`;downAt=0}},true)
document.addEventListener('pointercancel',()=>downAt=0,true)
const encode=new TextEncoder()
let stream,selection=1,revision=1,reply=0,version=1
let configFailures=0
let motionStyle
function reducedMotion(){
 metrics.reduced=!metrics.reduced
 motionStyle?.remove();motionStyle=null
 if(!metrics.reduced)return
 // Apply the actual compiled production reduce branches, without changing
 // the user's OS preference or copying/reimplementing animation rules.
 const rules=[]
 for(const sheet of document.styleSheets)for(const rule of sheet.cssRules){
  if(rule.conditionText?.includes('prefers-reduced-motion: reduce'))rules.push(...[...rule.cssRules].map(child=>child.cssText))
 }
 motionStyle=document.createElement('style');motionStyle.textContent=rules.join('\n');document.head.append(motionStyle)
}
const makeImage=(color,label,offset=0)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><g transform="translate(${offset},0)"><ellipse cx="200" cy="737" rx="85" ry="12" fill="#ccc"/><path d="M165 390L145 710Q160 740 185 710L200 480L215 710Q245 740 255 710L235 390" fill="${color}" stroke="#333" stroke-width="5"/><path d="M150 180Q200 150 250 180L275 410L125 410Z" fill="${color}" stroke="#333" stroke-width="5"/><circle cx="200" cy="110" r="65" fill="#f8d8c4" stroke="#333" stroke-width="5"/><path d="M140 90Q140 15 220 40Q280 45 260 110L235 70L220 85L210 65L190 85L180 60Z" fill="#654c56"/><path d="M175 110h8m34 0h8M188 138q12 8 24 0" fill="none" stroke="#333" stroke-width="5"/><text x="200" y="280" text-anchor="middle" font-size="28" fill="#333">${label}</text></g></svg>`)
const images={normal:makeImage('#db9caa','基础'),pleased:makeImage('#b8d5b5','愉快'),surprised:makeImage('#e8cc88','惊讶'),other:makeImage('#aebfdf','角色 B',30)}
const bounds={x:100,y:30,width:200,height:720,imageWidth:400,imageHeight:800}
const initialRegions={head:{cx:.5,cy:.09,rx:.14,ry:.045},cheek:{cx:.54,cy:.155,rx:.07,ry:.035}}
const configs=new Map()
function config(id){
 if(!configs.has(id))configs.set(id,{characterId:id,name:`测试角色 ${id}`,isSleeping:false,version:0,config:{style:'lively',expressionsEnabled:true,bindings:{pleased:{slotId:'pleased',imageVersion:1},surprised:{slotId:'surprised',imageVersion:1},annoyed:null},compatibleSources:[{slotId:'normal',imageVersion:1}],linesEnabled:false,lines:{pat:[],stroke:[],poke:[],overstimulated:[],feather:[],plush:[]}},slots:['normal','pleased','surprised'].map(slotId=>({slotId,name:slotId,imageUrl:id===2?images.other:images[slotId],imageVersion:1,bounds,regionVersion:1,regions:structuredClone(initialRegions),regionDraft:null,regionsStale:false}))})
 const data=configs.get(id)
 data.touchLines={status:'ready',lines:Object.fromEntries(Object.entries(TOUCH_LABELS).map(([key,label])=>[key,[`角色${id}：你碰到我的${label}啦。`,`角色${id}：${label}有一点痒呢。`,`角色${id}：轻一点碰${label}哦。`]]))}
 return data
}
function snapshot(){const slot=config(metrics.character).slots[0];return {epoch:'fixture',revision,selectionVersion:selection,characterId:metrics.character,slotId:'normal',resolvedSlotId:'normal',replyVersion:reply,imageVersion:slot.imageVersion,imageUrl:slot.imageUrl,bounds:slot.bounds,reason:reply?{id:reply,text:`聊天更新 ${reply}`} :null}}
function composition(){
 metrics.composition=(metrics.composition+1)%3;selection++;version++
 const kind=metrics.composition
 for(const data of [config(1),config(2)]){
  for(const slot of data.slots){
   const raw=data.characterId===2?images.other:images[slot.slotId]
   slot.imageVersion=version
   if(kind===2){
    slot.imageUrl='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><image href="${raw}" x="200" y="200" width="400" height="800"/></svg>`)
    slot.bounds={...bounds,x:300,y:230,imageWidth:800,imageHeight:1200}
    slot.regions=Object.fromEntries(Object.entries(initialRegions).map(([key,r])=>[key,{cx:(r.cx*400+200)/800,cy:(r.cy*800+200)/1200,rx:r.rx/2,ry:r.ry*800/1200}]))
   }else if(kind===1){
    slot.imageUrl='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><image href="${raw}" x="35" width="400" height="800"/></svg>`)
    slot.bounds={...bounds,x:135};slot.regions=Object.fromEntries(Object.entries(initialRegions).map(([key,r])=>[key,{...r,cx:r.cx+35/400}]))
   }else{slot.imageUrl=raw;slot.bounds=bounds;slot.regions=structuredClone(initialRegions)}
  }
  data.config.compatibleSources=[{slotId:'normal',imageVersion:version}]
  for(const ref of Object.values(data.config.bindings))if(ref)ref.imageVersion=version
 }
 update();send('expression_standings_updated',{characterId:metrics.character})
}
function send(event,data){stream?.enqueue(encode.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))}
function update(){revision++;send('standing_display_state',snapshot())}
window.fetch=async(url,options={})=>{
 metrics.requests++
 const path=String(url)
 if(metrics.offline)return Response.json({error:'Fixture offline'},{status:503})
 if(path==='/api/stream')return new Response(new ReadableStream({start(c){stream=c;send('connected',{});options.signal?.addEventListener('abort',()=>{try{c.close()}catch{};if(stream===c)stream=null},{once:true})},cancel(){stream=null}}),{headers:{'Content-Type':'text/event-stream'}})
 if(path==='/api/standing-display/state')return Response.json(snapshot())
 const match=path.match(/^\/api\/characters\/(\d+)\/standing-interaction$/)
 if(match&&configFailures>0){configFailures--;return Response.json({error:'Injected configuration failure'},{status:503})}
 if(match){const id=Number(match[1]);const data=config(id);data.isSleeping=metrics.sleep;if(options.method==='PUT'){metrics.writes++;data.config=JSON.parse(options.body).config;data.version++}const copy=structuredClone(data);if(metrics.delayed)await new Promise(r=>setTimeout(r,700));return Response.json(copy)}
 const region=path.match(/^\/api\/characters\/(\d+)\/expression-standings\/([^/]+)\/interaction-regions$/)
 if(region&&options.method==='PUT'){metrics.writes++;const data=config(Number(region[1]));const slot=data.slots.find(s=>s.slotId===decodeURIComponent(region[2]));slot.regions=JSON.parse(options.body).regions;slot.regionVersion++;return Response.json(data)}
 metrics.forbidden++;return Response.json({error:`Forbidden fixture request: ${path}`},{status:500})
}
const action=(text,fn)=>h(LinsheButton,{size:'sm',onClick:fn},()=>text)
createApp({render(){return [h(StandingDisplayView),h('aside',{style:'position:fixed;z-index:80;left:4px;right:4px;top:4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;background:var(--modal-bg);padding:6px;border-radius:8px'},[
 action('换角色',()=>{metrics.character=metrics.character===1?2:1;selection++;version=1;update()}),
 action('聊天更新',()=>{reply++;update()}),
 action('切换主题',()=>{metrics.theme=metrics.theme==='warm'?'dark':'warm';document.documentElement.dataset.theme=metrics.theme}),
 action('睡眠切换',()=>{metrics.sleep=!metrics.sleep;send('schedule_state_change',{character_id:metrics.character,is_sleeping:metrics.sleep})}),
 action('更新图片版本',()=>{version++;const data=config(metrics.character);const slot=data.slots[0];slot.imageVersion=version;slot.regionsStale=true;slot.regionDraft=slot.regions;slot.regions=null;update();send('expression_standings_updated',{characterId:metrics.character})}),
 action('延迟配置',()=>metrics.delayed=!metrics.delayed),
 action('模拟配置失败',()=>{configFailures=2;send('expression_standings_updated',{characterId:metrics.character})}),
 action('切换构图',composition),
 action('断线/重连',()=>{metrics.offline=!metrics.offline;if(metrics.offline){stream?.close();stream=null}}),
 action('减少动效预览',reducedMotion),
 action('完整触摸动效预览',()=>{fullMotionPreview=!fullMotionPreview;motionMedia.dispatchEvent(new Event('change'));metrics.checks=fullMotionPreview?'完整弹性触摸动效预览':'使用系统动态效果偏好'}),
 h(LinsheButton,{size:'sm',disabled:metrics.running,onClick:async()=>{metrics.running=true;metrics.checks='正在运行生产组件手势回归（合成输入）';try{await runStandingGestureChecks(text=>metrics.checks=text)}catch(error){metrics.checks=`FAIL ${error.message}`}finally{metrics.running=false}}},()=>metrics.running?'手势检查中…':'运行手势回归'),
 metrics.checks?h('pre',{id:'gesture-check-results',style:'font-size:10px;white-space:pre-wrap;margin:0;max-height:145px;overflow:auto;width:100%'},metrics.checks):null,
 h('output',{style:'font-size:12px',id:'fixture-metrics'},`角色 ${metrics.character} · 请求 ${metrics.requests} · 写入 ${metrics.writes} · 禁止请求 ${metrics.forbidden} · ${metrics.theme} · ${['普通构图','头部偏右','大幅透明留白'][metrics.composition]} · 离线 ${metrics.offline} · 减少动效 ${metrics.reduced} · 延迟 ${metrics.delayed} · 手势 ${metrics.gesture}`)
 ])]}}).use(createPinia()).mount('#app')
