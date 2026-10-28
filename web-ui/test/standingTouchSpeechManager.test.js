import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { TOUCH_LABELS as labels } from '../src/utils/standingTouch.js'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'

const source=readFileSync(new URL('../src/components/standing/StandingTouchLinesManager.vue',import.meta.url),'utf8')
const code=compileScript(parse(source).descriptor,{id:'touch-speech-manager-test'}).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g,(_,names)=>`const { ${names} } = Vue`)
  .replace(/^import .*$/gm,'').replace('export default','return')
function saved(version='v1') {
  const lines=Object.fromEntries(Object.keys(labels).map(part=>[part,['一句台词','第二句','第三句']]))
  return {status:'ready',version,lines,speech:{enabled:true,configured:true,reason:'',lines:Object.fromEntries(Object.entries(lines).map(([part,texts])=>[part,texts.map((text,index)=>({text,status:index===0?'completed':'empty',audio_url:index===0?`/${part}.wav`:null}))]))}}
}
async function fixture(t, overrides={}) {
  const props=Vue.reactive({open:true,characterId:1,name:'角色'}), calls=[],events=[]
  const deps={Vue,labels,LinsheModal:{},LinsheButton:{},LinsheInput:{},VoiceAudioPlayer:{},
    speechPlayer:createSpeechPlayback(),onEvent:()=>()=>{},setInterval:()=>0,clearInterval:()=>{},
    getStandingTouchLines:async()=>saved(),saveStandingTouchLines:async()=>saved('v2'),generateStandingTouchLines:async()=>saved('v2'),
    generateStandingTouchSpeech:async(id,body)=>{calls.push({id,body});return saved()},...overrides}
  const component=new Function(...Object.keys(deps),code)(...Object.values(deps))
  let state
  const renderer=Vue.createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode(){},nextSibling(){}})
  const app=renderer.createApp({setup(){state=component.setup(props,{expose(){},emit:(...args)=>events.push(args)});return()=>null}})
  app.mount({});t.after(()=>app.unmount())
  await Vue.nextTick()
  return {state,props,calls,events,deps}
}
test('saved speech matches exact text; editing immediately stops preview and prevents unsaved generation',async t=>{
  const f=await fixture(t),audio={paused:false,currentTime:0,pause(){this.paused=true}}
  assert.equal(f.state.speechLine('head',0).audio_url,'/head.wav')
  f.state.onPreviewPlay({target:audio})
  f.state.draft.value.head[0]='修改后的台词'
  assert.equal(audio.paused,true)
  assert.equal(f.state.canGenerateSpeech.value,false)
  assert.equal(f.state.speechLine('head',0),null)
  await f.state.generateSpeech('head',0)
  assert.equal(f.calls.length,0)
  f.state.accept(saved('v2'),true)
  f.state.state.value.speech.lines.head[0].text='旧版本台词'
  assert.equal(f.state.speechLine('head',0),null)
})
test('unconfigured/disabled characters and active jobs cannot start a single-line request',async t=>{
  const f=await fixture(t)
  f.state.state.value.speech.configured=false
  await f.state.generateSpeech('head',0)
  f.state.state.value.speech.configured=true;f.state.state.value.speech.enabled=false
  await f.state.generateSpeech('head',0)
  f.state.state.value.speech.enabled=true;f.state.state.value.speech.lines.head[0].status='queued'
  await f.state.generateSpeech('head',0)
  assert.equal(f.calls.length,0)
  assert.equal(f.state.speechStats.value.pending,1)
})
test('single-line retry sends saved version and force; bulk generation only fills missing speech',async t=>{
  const f=await fixture(t)
  await f.state.generateSpeech('head',0)
  await f.state.generateSpeech()
  assert.deepEqual(f.calls,[{id:1,body:{expectedVersion:'v1',part:'head',index:0,force:true}},{id:1,body:{expectedVersion:'v1'}}])
  assert.equal(f.events.length,2)
})
test('polling preserves edits and the edit version so concurrent saves conflict instead of overwriting',async t=>{
  const f=await fixture(t)
  f.state.draft.value.head[0]='我的草稿'
  const newer=saved('v2');newer.lines.head[0]='另一端的新台词'
  f.state.accept(newer)
  assert.equal(f.state.draft.value.head[0],'我的草稿')
  assert.equal(f.state.state.value.version,'v1')
  assert.equal(f.state.dirty.value,true)
  assert.equal(f.state.speechLine('head',0),null)
})
test('closing stops playback and ignores a late generation response from the closed character',async t=>{
  let resolve
  const f=await fixture(t,{generateStandingTouchSpeech:()=>new Promise(done=>{resolve=done})})
  const pending=f.state.generateSpeech('head',0)
  const audio={paused:false,currentTime:0,pause(){this.paused=true}}
  f.state.onPreviewPlay({target:audio})
  f.props.open=false;await Vue.nextTick()
  assert.equal(audio.paused,true)
  resolve(saved('v2'));await pending
  assert.equal(f.state.state.value.version,'v1')
  assert.deepEqual(f.events,[])
  assert.equal(f.state.working.value,'')
})
test('voice changes immediately stop and invalidate preview; ordinary progress updates keep playback',async t=>{
  const f=await fixture(t),audio={paused:false,currentTime:0,pause(){this.paused=true}}
  f.state.onPreviewPlay({target:audio})
  f.state.standingUpdated({characterId:2,voiceChanged:true})
  assert.equal(audio.paused,false)
  f.state.standingUpdated({characterId:1})
  await Vue.nextTick()
  assert.equal(audio.paused,false)
  f.state.standingUpdated({characterId:1,voiceChanged:true})
  assert.equal(audio.paused,true)
  assert.equal(f.state.speechLine('head',0),null)
  assert.equal(f.state.canGenerateSpeech.value,false)
  const lateAudio={paused:false,pause(){this.paused=true}}
  f.state.onPreviewPlay({target:lateAudio})
  assert.equal(lateAudio.paused,true)
})
test('voice changes during a pending mutation cannot restore old audio from its late response',async t=>{
  let resolveMutation,resolveRefresh
  // Keep the following refresh unresolved to inspect the delayed mutation result.
  let reads=0
  const g=await fixture(t,{
    generateStandingTouchSpeech:()=>new Promise(done=>{resolveMutation=done}),
    getStandingTouchLines:()=>++reads===1?Promise.resolve(saved()):new Promise(done=>{resolveRefresh=done}),
  })
  const late=g.state.generateSpeech('head',0)
  g.state.standingUpdated({characterId:1,voiceChanged:true})
  resolveMutation(saved('v2'));await late
  assert.equal(g.state.state.value.speech,null)
  assert.equal(g.state.canGenerateSpeech.value,false)
  const current=saved('v2');current.speech.lines.head[0]={text:'一句台词',status:'empty',audio_url:null}
  resolveRefresh(current);await Vue.nextTick()
  assert.equal(g.state.speechLine('head',0).audio_url,null)
})
