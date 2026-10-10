<template>
  <Transition name="interaction-fade"><div v-if="message" class="interaction-note" :style="bubbleBottom == null ? {} : { top: 'auto', bottom: `${bubbleBottom}px` }" role="status" aria-live="polite">{{ message }}</div></Transition>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {getStandingInteraction} from '../../api/index.js'
import {onEvent,isUnifiedStreamConnected} from '../../stores/unifiedStream.js'
import {standingPresentationChanged,standingSelectionKey} from '../../utils/standingInteractionRules.js'
import {createStandingInteractionLifetime} from '../../utils/standingInteractionLifetime.js'
import {createTouchReplyEngine} from '../../utils/standingTouch.js'
const props=defineProps({base:{type:Object,required:true},suspended:Boolean,bubbleBottom:{type:Number,default:null}})
const emit=defineEmits(['state','reaction'])
const data=ref(null),connected=ref(isUnifiedStreamConnected()),note=ref(''),generation=ref(0),loadError=ref('')
const engine=createTouchReplyEngine()
const lifetime=createStandingInteractionLifetime({scope:()=>standingSelectionKey(props.base)})
// Feedback cancellation (blur/new chat) must not cancel a pending config retry.
const requests=createStandingInteractionLifetime({scope:()=>standingSelectionKey(props.base)})
let controller=null,retryDelay=1000
const enabled=computed(()=>Boolean(props.base.imageUrl&&props.base.bounds))
const disabled=computed(()=>!enabled.value||!connected.value||!data.value||props.suspended||data.value.isSleeping)
const message=computed(()=>{
  if(!enabled.value||props.suspended)return ''
  if(!connected.value)return '连接中，恢复后即可触摸…'
  if(loadError.value)return '触摸反馈暂时读取失败，正在自动重试…'
  if(!data.value)return '正在读取触摸反馈…'
  if(data.value.isSleeping)return '角色正在休息，醒来后即可触摸。'
  return note.value
})
function clear(){generation.value++;lifetime.clear();note.value='';emit('reaction',null)}
function stopLoading(){requests.invalidate();requests.clear();controller?.abort();controller=null}
async function load(){
  stopLoading()
  const id=props.base.characterId
  if(!id||props.suspended||!isUnifiedStreamConnected())return
  const ticket=requests.begin()
  controller=new AbortController()
  const own=controller
  requests.after('timeout',10000,()=>own.abort())
  try{
    const value=await getStandingInteraction(id,{signal:own.signal})
    if(!requests.current(ticket))return
    data.value=value;loadError.value='';retryDelay=1000
  }catch(error){
    if(!requests.current(ticket))return
    data.value=null;loadError.value=error.message||'读取失败';clear()
    requests.after('retry',retryDelay,load)
    retryDelay=Math.min(retryDelay*2,30000)
  }finally{
    if(requests.current(ticket)){requests.cancel('timeout');controller=null}
  }
}
function refresh(){connected.value=isUnifiedStreamConnected();retryDelay=1000;load()}
function act(part,point=null){
  if(disabled.value)return
  const result=engine.act(part,data.value.touchLines?.lines)
  if(!result)return
  note.value=result.text;emit('reaction',{...result,point})
  lifetime.after('motion',1100,()=>emit('reaction',null))
  lifetime.after('note',3200,()=>note.value='')
}
watch(()=>props.base,(next,old)=>{
  if(standingPresentationChanged(old,next))clear()
  if(standingSelectionKey(old)!==standingSelectionKey(next)){engine.reset();data.value=null;loadError.value='';refresh()}
},{immediate:true})
watch(()=>props.suspended,suspended=>{clear();if(suspended)stopLoading();else refresh()})
watch([enabled,disabled,generation,message],()=>emit('state',{enabled:enabled.value,disabled:disabled.value,generation:generation.value,speaking:Boolean(message.value)}),{immediate:true})
const offs=[onEvent('connected',refresh),onEvent('disconnected',()=>{stopLoading();connected.value=false;data.value=null;clear()}),onEvent('expression_standings_updated',e=>{if(String(e.characterId)===String(props.base.characterId))refresh()}),onEvent('schedule_state_change',e=>{if(String(e.character_id)===String(props.base.characterId)){data.value=null;clear();refresh()}})]
window.addEventListener('blur',clear)
window.addEventListener('focus',refresh)
onBeforeUnmount(()=>{stopLoading();requests.dispose();lifetime.dispose();clear();offs.forEach(fn=>fn());window.removeEventListener('blur',clear);window.removeEventListener('focus',refresh)})
defineExpose({act,clear})
</script>
<style scoped>
.interaction-note{position:absolute;z-index:4;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 32px);box-sizing:border-box;background:linear-gradient(var(--modal-bg),var(--modal-bg)),var(--bg-primary);color:var(--text-primary);border:2px solid var(--cel-outline);border-radius:var(--radius-lg);box-shadow:var(--shadow-hard-sm);padding:10px 16px;font-size:var(--fs-sm);line-height:1.6;text-align:center;overflow-wrap:anywhere;pointer-events:none}
/* Opaque, identically composited surfaces hide the body's border beneath the tail.
   A plain 45deg diamond joins both edges at the same height (skew caused a notch). */
.interaction-note::after{content:"";position:absolute;box-sizing:border-box;width:16px;height:16px;left:60%;bottom:-10px;background:linear-gradient(var(--modal-bg),var(--modal-bg)),var(--bg-primary);border-right:2px solid var(--cel-outline);border-bottom:2px solid var(--cel-outline);transform:rotate(45deg);border-bottom-right-radius:3px}
.interaction-fade-enter-active,.interaction-fade-leave-active{transition:opacity .3s ease}.interaction-fade-enter-from,.interaction-fade-leave-to{opacity:0}
</style>
