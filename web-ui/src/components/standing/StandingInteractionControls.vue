<template>
  <Transition name="interaction-fade"><div v-if="note" class="interaction-note" :style="bubbleBottom == null ? {} : { top: 'auto', bottom: `${bubbleBottom}px` }" role="status" aria-live="polite">{{ note }}</div></Transition>
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
const data=ref(null),connected=ref(false),note=ref(''),generation=ref(0)
const engine=createTouchReplyEngine()
const lifetime=createStandingInteractionLifetime({scope:()=>standingSelectionKey(props.base)})
const enabled=computed(()=>Boolean(props.base.imageUrl&&props.base.bounds))
const disabled=computed(()=>!enabled.value||!connected.value||!data.value||props.suspended||data.value.isSleeping)
function clear(){generation.value++;lifetime.clear();note.value='';emit('reaction',null)}
async function load(){
  const id=props.base.characterId,ticket=lifetime.begin()
  if(!id)return
  try{const value=await getStandingInteraction(id);if(!lifetime.current(ticket))return;data.value=value;connected.value=isUnifiedStreamConnected()}
  catch{if(lifetime.current(ticket))connected.value=false}
}
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
  if(standingSelectionKey(old)!==standingSelectionKey(next)){engine.reset();data.value=null;connected.value=false;load()}
},{immediate:true})
watch(()=>props.suspended,clear)
watch([enabled,disabled,generation,note],()=>emit('state',{enabled:enabled.value,disabled:disabled.value,generation:generation.value,speaking:Boolean(note.value)}),{immediate:true})
const offs=[onEvent('connected',load),onEvent('disconnected',()=>{lifetime.invalidate();connected.value=false;clear()}),onEvent('expression_standings_updated',e=>{if(String(e.characterId)===String(props.base.characterId))load()}),onEvent('schedule_state_change',e=>{if(String(e.character_id)===String(props.base.characterId)){lifetime.invalidate();connected.value=false;clear();load()}})]
window.addEventListener('blur',clear)
onBeforeUnmount(()=>{lifetime.dispose();clear();offs.forEach(fn=>fn());window.removeEventListener('blur',clear)})
defineExpose({act,clear})
</script>
<style scoped>
.interaction-note{position:absolute;z-index:4;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 32px);box-sizing:border-box;background:linear-gradient(var(--modal-bg),var(--modal-bg)),var(--bg-primary);color:var(--text-primary);border:2px solid var(--cel-outline);border-radius:var(--radius-lg);box-shadow:var(--shadow-hard-sm);padding:10px 16px;font-size:var(--fs-sm);line-height:1.6;text-align:center;overflow-wrap:anywhere;pointer-events:none}
/* Opaque, identically composited surfaces hide the body's border beneath the tail.
   A plain 45deg diamond joins both edges at the same height (skew caused a notch). */
.interaction-note::after{content:"";position:absolute;box-sizing:border-box;width:16px;height:16px;left:60%;bottom:-10px;background:linear-gradient(var(--modal-bg),var(--modal-bg)),var(--bg-primary);border-right:2px solid var(--cel-outline);border-bottom:2px solid var(--cel-outline);transform:rotate(45deg);border-bottom-right-radius:3px}
.interaction-fade-enter-active,.interaction-fade-leave-active{transition:opacity .3s ease}.interaction-fade-enter-from,.interaction-fade-leave-to{opacity:0}
</style>
