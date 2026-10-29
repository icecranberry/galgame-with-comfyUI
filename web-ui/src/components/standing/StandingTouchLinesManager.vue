<template>
  <linshe-modal :model-value="open" wide :transition-ms="300" :title="`${name || '角色'} · 立绘反馈台词`" @close="$emit('close')">
    <div class="lines-summary">
      <p class="lines-hint" role="status">{{ statusText }}</p>
      <p v-if="error" class="lines-error" role="alert">失败原因：{{ error }}</p>
      <p v-if="dirty" class="lines-hint">有未保存的修改，请保存后再生成或试听语音。</p>
    </div>
    <div class="lines-toolbar">
      <linshe-button :loading="working==='generate' || generating" :disabled="loading || !!working || generating || dirty" @click="mutate('generate')">{{ state.lines ? '重新生成全部台词' : '生成全部台词' }}</linshe-button>
      <linshe-button :loading="working==='speech'" :disabled="!canGenerateSpeech || speechBusy || !speechMissing" @click="generateSpeech()">{{ speechStats.failed ? '补齐 / 重试语音' : '一键生成角色语音' }}</linshe-button>
      <linshe-button variant="ghost" :disabled="!!working" @click="refresh(true)">重新读取</linshe-button>
    </div>
    <div class="lines-speech-summary" role="status" aria-live="polite">
      <span>反馈语音 <strong>{{ speechStats.ready }}</strong> / {{ speechStats.total }}</span>
      <span v-if="speechStats.pending">生成中 <strong>{{ speechStats.pending }}</strong></span>
      <span v-if="speechStats.failed" class="lines-error">失败 <strong>{{ speechStats.failed }}</strong></span>
      <span v-if="state.speech?.reason">{{ state.speech.reason }}</span>
    </div>
    <p class="lines-description">生成台词不会重画立绘。语音仅使用已保存的台词与角色已配置的声音，生成后点击播放即可试听；修改台词后需重新生成对应语音。</p>
    <div v-if="loading" class="lines-hint">正在读取台词…</div>
    <div v-else class="lines-grid">
      <fieldset v-for="(label,part) in labels" :key="part" class="lines-part">
        <legend>{{ label }}</legend>
        <div v-for="(_,index) in draft[part]" :key="index" class="lines-item">
          <linshe-input v-model="draft[part][index]" :aria-label="`${label}台词 ${index+1}`" :placeholder="`${label} · 第 ${index+1} 句`" :disabled="generating || !!working" />
          <div class="lines-speech-actions">
            <span class="lines-hint">第 {{ index+1 }} 句 · {{ speechStatus(part,index) }}</span>
            <linshe-button size="sm" variant="ghost" :loading="speechPending(part,index)" :disabled="!canGenerateSpeech || speechPending(part,index) || !draft[part][index].trim()" @click="generateSpeech(part,index)">{{ speechLine(part,index)?.audio_url ? '重新生成语音' : speechLine(part,index)?.status === 'failed' ? '重试语音' : '生成语音' }}</linshe-button>
          </div>
          <p v-if="speechLine(part,index)?.error" class="lines-error" role="alert">{{ speechLine(part,index).error }}</p>
          <Transition name="lines-audio">
            <VoiceAudioPlayer v-if="speechLine(part,index)?.audio_url" :src="speechLine(part,index).audio_url" :label="`${label}第${index+1}句反馈语音`" preload="none" @play="onPreviewPlay" />
          </Transition>
        </div>
      </fieldset>
    </div>
    <template #footer>
      <linshe-button variant="primary" :loading="working==='save'" :disabled="loading || !!working || generating || !dirty" @click="mutate('save')">保存台词</linshe-button>
    </template>
  </linshe-modal>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import LinsheModal from '../ui/LinsheModal.vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import VoiceAudioPlayer from '../VoiceAudioPlayer.vue'
import {TOUCH_LABELS as labels} from '../../utils/standingTouch.js'
import {getStandingTouchLines,saveStandingTouchLines,generateStandingTouchLines,generateStandingTouchSpeech} from '../../api/index.js'
import {onEvent} from '../../stores/unifiedStream.js'
import {speechPlayer} from '../../stores/speech.js'
const props=defineProps({open:Boolean,characterId:Number,name:String})
const emit=defineEmits(['close','saved'])
const blank=()=>Object.fromEntries(Object.keys(labels).map(k=>[k,['','','']]))
const draft=ref(blank()),baseline=ref(JSON.stringify(draft.value)),state=ref({status:'empty',version:null,lines:null}),loading=ref(false),working=ref(''),error=ref('')
const dirty=computed(()=>JSON.stringify(draft.value)!==baseline.value)
const generating=computed(()=>state.value.status==='generating')
const canGenerateSpeech=computed(()=>!loading.value&&!working.value&&!generating.value&&!dirty.value&&!!state.value.lines&&!!state.value.speech?.enabled&&!!state.value.speech?.configured)
const speechStats=computed(()=>{
  const lines=Object.values(state.value.speech?.lines||{}).flat()
  return {total:Object.values(state.value.lines||{}).flat().length,ready:lines.filter(line=>line.status==='completed'&&line.audio_url).length,pending:lines.filter(line=>['queued','generating'].includes(line.status)).length,failed:lines.filter(line=>['failed','cancelled'].includes(line.status)).length}
})
const speechBusy=computed(()=>speechStats.value.pending>0)
const speechMissing=computed(()=>speechStats.value.ready<speechStats.value.total)
const statusText=computed(()=>({empty:'尚未生成专属台词，可以单独生成或手动填写。',generating:'台词正在生成，完成后会自动显示。',ready:'当前台词 · 10 个部位',failed:state.value.lines?'上次生成失败，已有台词仍保留。':'上次生成失败，可重新生成或手动填写。'})[state.value.status])
let serial=0,timer,previewAudio=null,voiceRevision=0
function stopPreview(){previewAudio?.pause();previewAudio=null}
function onPreviewPlay(event){
  if(!props.open||dirty.value||!state.value.speech){event.target.pause();return}
  previewAudio=event.target;speechPlayer.adopt(event.target)
}
function speechLine(part,index){
  const line=state.value.speech?.lines?.[part]?.[index]
  return !dirty.value&&line?.text===draft.value[part]?.[index]?line:null
}
function speechPending(part,index){return ['queued','generating'].includes(speechLine(part,index)?.status)}
function speechStatus(part,index){
  if(dirty.value)return '请先保存台词'
  return ({completed:'可试听',queued:'排队中',generating:'生成中',failed:'生成失败',cancelled:'已取消'})[speechLine(part,index)?.status]||'尚未生成语音'
}
async function generateSpeech(part,index){
  if(!canGenerateSpeech.value||(part&&speechPending(part,index)))return
  stopPreview()
  const id=props.characterId,ticket=++serial,voiceVersion=voiceRevision;working.value='speech';error.value=''
  try{
    const body={expectedVersion:state.value.version,...(part?{part,index,force:true}:{})}
    const value=await generateStandingTouchSpeech(id,body)
    if(ticket!==serial||!props.open||id!==props.characterId)return
    accept(value,true,voiceVersion);emit('saved')
  }catch(e){if(ticket===serial)error.value=e.message}
  finally{if(ticket===serial){working.value='';if(voiceVersion!==voiceRevision)refresh()}}
}
function accept(value,replace=false,voiceVersion=voiceRevision){
  // A delayed response may describe the previous voice even after a config event.
  if(voiceVersion!==voiceRevision)value={...value,speech:null}
  // Keep the edit version while dirty, so concurrent changes cause a conflict.
  if(replace||!dirty.value){state.value=value;draft.value=Object.fromEntries(Object.keys(labels).map(key=>[key, value.lines?.[key]?.length ? [...value.lines[key]] : ['','','']]));baseline.value=JSON.stringify(draft.value)}
  else state.value={...value,version:state.value.version}
}
async function refresh(replace=false){
  if(!props.open||!props.characterId||working.value)return
  const ticket=++serial,id=props.characterId,voiceVersion=voiceRevision
  try{const value=await getStandingTouchLines(id);if(ticket!==serial||!props.open||id!==props.characterId)return;accept(value,replace,voiceVersion);error.value=value.error||''}
  catch(e){if(ticket===serial)error.value=e.message}
  finally{if(ticket===serial)loading.value=false}
}
async function mutate(kind){
  if(working.value||generating.value)return
  stopPreview()
  const id=props.characterId,ticket=++serial,voiceVersion=voiceRevision;working.value=kind;error.value=''
  try{
    const value=kind==='save'?await saveStandingTouchLines(id,{expectedVersion:state.value.version,lines:JSON.parse(JSON.stringify(draft.value))}):await generateStandingTouchLines(id,state.value.version)
    if(ticket!==serial||!props.open||id!==props.characterId)return
    accept(value,true,voiceVersion);emit('saved')
  }catch(e){if(ticket===serial)error.value=e.message}
  finally{if(ticket===serial){working.value='';if(voiceVersion!==voiceRevision)refresh()}}
}
watch(()=>[props.open,props.characterId],()=>{
  serial++;clearInterval(timer);stopPreview();working.value='';error.value=''
  if(!props.open)return
  draft.value=blank();baseline.value=JSON.stringify(draft.value);state.value={status:'empty',version:null,lines:null};loading.value=true
  refresh(true);timer=setInterval(()=>refresh(),2500)
},{immediate:true})
function standingUpdated(event){
  if(String(event.characterId)!==String(props.characterId))return
  if(event.voiceChanged){voiceRevision++;stopPreview();state.value={...state.value,speech:null}}
  refresh()
}
const off=onEvent('expression_standings_updated',standingUpdated)
const offSpeech=onEvent('speech_update',e=>{if(String(e.character_id)===String(props.characterId))refresh()})
watch(dirty,value=>{if(value)stopPreview()},{flush:'sync'})
onBeforeUnmount(()=>{serial++;clearInterval(timer);stopPreview();off();offSpeech()})
</script>
<style scoped>
.lines-hint{font-size:var(--fs-sm);color:var(--text-secondary);margin:0;line-height:1.6}
.lines-summary{display:grid;gap:6px;min-width:0}
.lines-error{margin:0;font-size:var(--fs-sm);line-height:1.6;color:var(--fun-pink);overflow-wrap:anywhere}
.lines-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:16px 0 10px}
.lines-description{margin:0 0 20px;font-size:var(--fs-sm);color:var(--text-secondary);line-height:1.6;overflow-wrap:anywhere}
.lines-speech-summary{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;margin:0 0 8px;color:var(--text-secondary);font-size:var(--fs-sm);line-height:1.6}
.lines-speech-summary strong{color:var(--text-primary);font-variant-numeric:tabular-nums}
.lines-item{display:grid;gap:8px;min-width:0;padding:6px 0}
.lines-item+.lines-item{border-top:1px solid var(--border);padding-top:14px}
.lines-speech-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px}
.lines-audio-enter-active,.lines-audio-leave-active{transition:opacity .3s var(--ease-standard)}
.lines-audio-enter-from,.lines-audio-leave-to{opacity:0}
.lines-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.lines-part{min-width:0;margin:0;padding:12px;display:grid;gap:8px;border:1px solid var(--border);border-radius:var(--radius-md)}
.lines-part legend{padding:0 6px;font-weight:600;font-size:var(--fs-sm);color:var(--text-primary)}
@media(max-width:600px){.lines-grid{grid-template-columns:1fr}}
</style>
