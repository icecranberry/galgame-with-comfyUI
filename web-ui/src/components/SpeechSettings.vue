<template>
  <section class="speech-settings" aria-label="语音设置">
    <div class="speech-heading">
      <div class="speech-title">
        <h4>启用语音朗读</h4>
      </div>
      <linshe-switch :model-value="speechEnabled" :disabled="busy" size="sm" aria-label="启用语音朗读" on-text="已开启" off-text="未开启" @update:model-value="toggle" />
    </div>
    <div class="speech-heading speech-auto-play">
      <div class="speech-title">
        <h4>对话自动播放</h4>
        <p>停留在私聊或群聊页面时，自动合成并依次播放新分句。需要开启语音朗读并为角色配置声音，不补播历史消息。</p>
      </div>
      <linshe-switch :model-value="speechAutoPlay" :disabled="busy || disabled" size="sm" aria-label="对话自动播放" on-text="已开启" off-text="未开启" @update:model-value="toggleAutoPlay" />
    </div>
    <div class="speech-mode">
      <linshe-tabs :model-value="mode" :options="modes" :disabled="busy || disabled || localModelBusy || checking || restarting || recovering" aria-label="语音接入方式" @update:model-value="switchMode" />
    </div>
    <Transition name="speech-maintenance" mode="out-in">
    <div v-if="mode === 'api'" key="api" class="speech-api">
      <p class="speech-feedback">使用 OpenAI 兼容的语音合成协议。连接信息由所有角色共用，每个角色独立设置音色和参数；本地录音与参数会保留。</p>
      <label class="speech-field">完整 API 地址<linshe-input v-model="api.endpoint" :disabled="busy || disabled" placeholder="https://example.com/v1/audio/speech" /></label>
      <div class="speech-api-grid">
        <label class="speech-field">模型<linshe-input v-model="api.model" :disabled="busy || disabled" placeholder="tts-1" /></label>
        <label class="speech-field">API Key<linshe-input v-model="apiKey" type="password" autocomplete="new-password" :disabled="busy || disabled" :placeholder="api.has_key ? '已保存，留空保留原 Key' : '填写 Key；无鉴权接口可留空'" /></label>
      </div>
      <label class="speech-field">音色上传地址（创建克隆音色 ID 时填写）<linshe-input v-model="api.upload_endpoint" :disabled="busy || disabled" placeholder="https://api.siliconflow.cn/v1/uploads/audio/voice" /><span class="speech-feedback">克隆按硅基流动兼容协议接入，共用上方模型与 Key。直接传 references 无需填写上传地址；服务商和模型须支持对应功能，普通 OpenAI 兼容接口不一定支持。</span></label>
      <div class="speech-api-actions">
        <linshe-button size="sm" :loading="busy" :disabled="busy || disabled || !api.endpoint.trim() || !api.model.trim()" @click="saveApi">保存 API 连接</linshe-button>
        <linshe-button v-if="api.has_key" variant="ghost" size="sm" :disabled="busy || disabled" @click="clearKey = !clearKey">{{ clearKey ? '取消清除 Key' : '清除已存 Key' }}</linshe-button>
        <span class="speech-feedback">{{ clearKey ? '保存后清除 Key' : '保存后在角色声音中生成试听，验证连接' }}</span>
      </div>
    </div>
    <div v-else key="local">
    <div class="speech-heading speech-auto-play">
      <div class="speech-title">
        <h4>情感增强</h4>
        <p>结合上文、下文各一句推断朗读情绪，会增加 LLM 消耗。</p>
      </div>
      <linshe-switch :model-value="emotionEnhancement" :disabled="busy || disabled" size="sm" aria-label="情感增强" on-text="已开启" off-text="未开启" @update:model-value="toggleEmotionEnhancement" />
    </div>
    <LocalSpeechModels :disabled="busy || disabled || checking || restarting || recovering" @changed="applySettings" @busy="localModelBusy = $event" />
    <div class="speech-service-row">
      <span class="speech-status" :class="{ 'is-ready': ready, 'is-error': !!error }" role="status">
        <i aria-hidden="true" />{{ restarting ? '正在重启声音服务…' : checking ? '正在检查服务…' : ready ? '本地服务已就绪' : error ? '服务需要检查' : '本地服务待检查' }}
      </span>
      <div class="speech-actions">
        <linshe-button variant="link" size="sm" :loading="checking" :disabled="recovering || restarting || localModelBusy" @click="check">检查连接</linshe-button>
        <linshe-button variant="secondary" size="sm" :loading="restarting" :disabled="checking || recovering || localModelBusy" @click="restart">重启声音服务</linshe-button>
        <linshe-button variant="ghost" size="sm" :aria-expanded="maintenanceOpen" @click="maintenanceOpen = !maintenanceOpen">
          服务维护
          <svg class="speech-chevron" :class="{ 'is-open': maintenanceOpen }" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </linshe-button>
      </div>
    </div>
    <Transition name="speech-maintenance">
      <div v-if="maintenanceOpen" class="speech-maintenance">
        <div>
          <strong>释放语音显存</strong>
          <p>声音生成卡住时可尝试恢复，当前任务结束后会回收语音模型。</p>
          <span class="speech-endpoint">本地服务 · 127.0.0.1:7861</span>
        </div>
        <linshe-button size="sm" :loading="recovering" :disabled="checking || restarting" @click="recover">恢复显存调度</linshe-button>
      </div>
    </Transition>
    </div>
    </Transition>
    <div class="speech-cache-row">
      <linshe-button variant="ghost" size="sm" :loading="clearingCache" :disabled="busy || disabled" @click="clearCache">清理历史声音缓存</linshe-button>
      <span class="speech-feedback">清理本地及 API 生成的语音，保留音色和参考录音。</span>
    </div>
    <p v-if="error" class="speech-feedback is-error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="speech-feedback" role="status">{{ notice }}</p>
  </section>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheSwitch from './ui/LinsheSwitch.vue'
import LinsheTabs from './ui/LinsheTabs.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LocalSpeechModels from './LocalSpeechModels.vue'
import { ttsApi } from '../api/tts.js'
import { speechEnabled, speechAutoPlay, stopSpeech, invalidateSpeechCache } from '../stores/speech.js'
defineProps({ disabled: Boolean })
const emit = defineEmits(['changed'])
const mode = ref('local'), api = ref({ endpoint: '', model: '', has_key: false }), apiKey = ref(''), clearKey = ref(false)
const localModelBusy = ref(false), clearingCache = ref(false)
const emotionEnhancement = ref(false)
const modes = [{ label: '本地模型', value: 'local' }, { label: 'API 接入', value: 'api' }]
function applySettings(settings) {
  speechEnabled.value = settings.enabled
  speechAutoPlay.value = settings.auto_play === true
  emotionEnhancement.value = settings.emotion_enhancement === true
  mode.value = settings.mode || 'local'
  if (settings.api) api.value = { ...settings.api }
  apiKey.value = ''; clearKey.value = false
  emit('changed', settings)
}
async function switchMode(value) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''; stopSpeech()
  try {
    const settings = await ttsApi('/settings', { mode: value }, 'PUT')
    // Switching modes must not erase an unsaved connection draft either.
    mode.value = settings.mode; emit('changed', settings)
    notice.value = value === 'api' ? '已切换 API，本地音色与参数仍保留' : '已切回本地，继续使用原来的音色与参数'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function saveApi() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    applySettings(await ttsApi('/settings', { api: { endpoint: api.value.endpoint, model: api.value.model, upload_endpoint: api.value.upload_endpoint || '', key: apiKey.value, clear_key: clearKey.value } }, 'PUT'))
    stopSpeech(); notice.value = 'API 连接已保存，可在角色声音中生成试听'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
const busy = ref(true), checking = ref(false), recovering = ref(false), restarting = ref(false), ready = ref(false)
const maintenanceOpen = ref(false), error = ref(''), notice = ref('')
async function clearCache() {
  if (busy.value || clearingCache.value) return
  clearingCache.value = true; error.value = ''; notice.value = ''
  try {
    const result = await ttsApi('/cache', {}, 'DELETE')
    invalidateSpeechCache(result)
    notice.value = `已清理 ${result.files} 个语音文件，释放 ${(result.bytes / 1024 / 1024).toFixed(1)} MB`
    if (result.failed) error.value = `${notice.value}；${result.failed} 个文件暂未清理，请稍后重试`
  } catch (e) { error.value = e.message }
  finally { clearingCache.value = false }
}
async function toggle(enabled) {
  busy.value = true; error.value = ''; notice.value = ''
  try { speechEnabled.value = (await ttsApi('/settings', { enabled }, 'PUT')).enabled; if (!enabled) stopSpeech() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function toggleAutoPlay(auto_play) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    speechAutoPlay.value = (await ttsApi('/settings', { auto_play }, 'PUT')).auto_play === true
    if (!speechAutoPlay.value) stopSpeech()
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function toggleEmotionEnhancement(emotion_enhancement) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const settings = await ttsApi('/settings', { emotion_enhancement }, 'PUT')
    emotionEnhancement.value = settings.emotion_enhancement === true
    stopSpeech()
    emit('changed', settings)
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function check() {
  if (checking.value || recovering.value || restarting.value) return
  checking.value = true; error.value = ''; notice.value = ''
  try {
    const s = await ttsApi('/health')
    ready.value = !!(s.online && s.compatible && s.ready)
    if (!ready.value) error.value = s.error || '服务未就绪或模型版本不匹配'
  } catch (e) { ready.value = false; error.value = e.message }
  finally { checking.value = false }
}
async function recover() {
  if (checking.value || recovering.value || restarting.value) return
  recovering.value = true; error.value = ''; notice.value = ''
  try { await ttsApi('/recover', {}); notice.value = '语音模型已释放，调度已恢复' }
  catch (e) { error.value = e.message }
  finally { recovering.value = false }
}
async function restart() {
  if (checking.value || recovering.value || restarting.value) return
  restarting.value = true; ready.value = false; error.value = ''; notice.value = '正在等待当前任务结束并重启服务…'
  stopSpeech()
  try {
    const s = await ttsApi('/restart', {})
    ready.value = !!(s.online && s.compatible && s.ready)
    if (ready.value) notice.value = '声音服务已重启，可以继续试听或朗读'
    else { notice.value = ''; error.value = s.error || '服务已启动，但模型尚未就绪或版本不匹配' }
  } catch (e) { notice.value = ''; error.value = e.message }
  finally { restarting.value = false }
}
onMounted(async () => {
  try { applySettings(await ttsApi('/settings')) }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
})
</script>
<style scoped>
.speech-settings { padding:18px 20px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--bg-sunken); }
.speech-mode { margin-top:16px; padding-top:16px; border-top:1px solid var(--border); }
.speech-auto-play { margin-top:14px; padding-top:14px; border-top:1px solid var(--border); }
.speech-api { display:grid; gap:12px; margin-top:14px; }
.speech-field { display:flex; flex-direction:column; gap:6px; min-width:0; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; }
.speech-api-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.speech-api-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.speech-cache-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin-top:14px; padding-top:12px; border-top:1px solid var(--border); }
.speech-cache-row .speech-feedback { margin:0; }
.speech-api-actions .speech-feedback { margin:0; }
.speech-heading,.speech-service-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.speech-title { min-width:0; }
.speech-title h4 { margin:0 0 5px; color:var(--text-primary); font-size:var(--fs-md); font-weight:700; }
.speech-title h4:only-child { margin:0; }
.speech-title p,.speech-maintenance p { margin:0; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; }
.speech-heading > :last-child { flex-shrink:0; }
.speech-service-row { margin-top:14px; padding-top:12px; border-top:1px solid var(--border); flex-wrap:wrap; gap:8px 16px; }
.speech-status { display:inline-flex; align-items:center; gap:7px; color:var(--text-secondary); font-size:var(--fs-xs); }
.speech-status i { width:6px; height:6px; border-radius:50%; background:currentColor; flex-shrink:0; }
.speech-status.is-ready { color:var(--success); }
.speech-status.is-error,.speech-feedback.is-error { color:var(--danger); }
.speech-actions { display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end; gap:10px; margin-left:auto; }
.speech-chevron { width:14px; height:14px; transition:transform .3s ease; }
.speech-chevron.is-open { transform:rotate(180deg); }
.speech-feedback { margin:10px 0 0; font-size:var(--fs-xs); line-height:1.6; color:var(--text-secondary); overflow-wrap:anywhere; }
.speech-maintenance { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:14px; padding-top:14px; border-top:1px solid var(--border); }
.speech-maintenance strong { display:block; margin-bottom:5px; color:var(--text-primary); font-size:var(--fs-sm); }
.speech-maintenance > :last-child { flex-shrink:0; }
.speech-endpoint { display:block; margin-top:6px; color:var(--text-secondary); font-size:var(--fs-xs); }
.speech-maintenance-enter-active,.speech-maintenance-leave-active { transition:opacity .3s ease,transform .3s ease; }
.speech-maintenance-enter-from,.speech-maintenance-leave-to { opacity:0; transform:translateY(-5px); }
@media(max-width:480px) {
  .speech-api-grid { grid-template-columns:minmax(0,1fr); }
  .speech-settings { padding:14px; }
  .speech-heading { align-items:flex-start; gap:12px; }
  .speech-title h4 { font-size:var(--fs-sm); }
  .speech-maintenance { align-items:flex-start; flex-direction:column; gap:12px; }
}
</style>
