<template>
  <section class="speech-settings" aria-label="语音设置">
    <div class="speech-heading">
      <div class="speech-title">
        <h4>让角色开口说话</h4>
        <p>绑定音色后，点击聊天气泡即可朗读</p>
      </div>
      <linshe-switch :model-value="speechEnabled" :disabled="busy" size="sm" aria-label="启用语音朗读" on-text="已开启" off-text="未开启" @update:model-value="toggle" />
    </div>
    <div class="speech-service-row">
      <span class="speech-status" :class="{ 'is-ready': ready, 'is-error': !!error }" role="status">
        <i aria-hidden="true" />{{ checking ? '正在检查服务…' : ready ? '本地服务已就绪' : error ? '服务需要检查' : '本地服务待检查' }}
      </span>
      <div class="speech-actions">
        <linshe-button variant="link" size="sm" :loading="checking" :disabled="recovering" @click="check">检查连接</linshe-button>
        <linshe-button variant="ghost" size="sm" :aria-expanded="maintenanceOpen" @click="maintenanceOpen = !maintenanceOpen">
          服务维护
          <svg class="speech-chevron" :class="{ 'is-open': maintenanceOpen }" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </linshe-button>
      </div>
    </div>
    <p v-if="error" class="speech-feedback is-error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="speech-feedback" role="status">{{ notice }}</p>
    <Transition name="speech-maintenance">
      <div v-if="maintenanceOpen" class="speech-maintenance">
        <div>
          <strong>释放语音显存</strong>
          <p>声音生成卡住时可尝试恢复，当前任务结束后会回收语音模型。</p>
          <span class="speech-endpoint">本地服务 · 127.0.0.1:7861</span>
        </div>
        <linshe-button size="sm" :loading="recovering" :disabled="checking" @click="recover">恢复显存调度</linshe-button>
      </div>
    </Transition>
  </section>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheSwitch from './ui/LinsheSwitch.vue'
import { ttsApi } from '../api/tts.js'
import { speechEnabled, stopSpeech } from '../stores/speech.js'
const busy = ref(true), checking = ref(false), recovering = ref(false), ready = ref(false)
const maintenanceOpen = ref(false), error = ref(''), notice = ref('')
async function toggle(enabled) {
  busy.value = true; error.value = ''; notice.value = ''
  try { speechEnabled.value = (await ttsApi('/settings', { enabled }, 'PUT')).enabled; if (!enabled) stopSpeech() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function check() {
  checking.value = true; error.value = ''; notice.value = ''
  try {
    const s = await ttsApi('/health')
    ready.value = !!(s.online && s.compatible && s.ready)
    if (!ready.value) error.value = s.error || '服务未就绪或模型版本不匹配'
  } catch (e) { ready.value = false; error.value = e.message }
  finally { checking.value = false }
}
async function recover() {
  recovering.value = true; error.value = ''; notice.value = ''
  try { await ttsApi('/recover', {}); notice.value = '语音模型已释放，调度已恢复' }
  catch (e) { error.value = e.message }
  finally { recovering.value = false }
}
onMounted(async () => {
  try { speechEnabled.value = (await ttsApi('/settings')).enabled }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
})
</script>
<style scoped>
.speech-settings { padding:18px 20px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--bg-sunken); }
.speech-heading,.speech-service-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.speech-title { min-width:0; }
.speech-title h4 { margin:0 0 5px; color:var(--text-primary); font-size:var(--fs-md); font-weight:700; }
.speech-title p,.speech-maintenance p { margin:0; color:var(--text-secondary); font-size:var(--fs-xs); line-height:1.6; }
.speech-heading > :last-child { flex-shrink:0; }
.speech-service-row { margin-top:14px; padding-top:12px; border-top:1px solid var(--border); flex-wrap:wrap; gap:8px 16px; }
.speech-status { display:inline-flex; align-items:center; gap:7px; color:var(--text-secondary); font-size:var(--fs-xs); }
.speech-status i { width:6px; height:6px; border-radius:50%; background:currentColor; flex-shrink:0; }
.speech-status.is-ready { color:var(--success); }
.speech-status.is-error,.speech-feedback.is-error { color:var(--danger); }
.speech-actions { display:flex; align-items:center; gap:10px; margin-left:auto; }
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
  .speech-settings { padding:14px; }
  .speech-heading { align-items:flex-start; gap:12px; }
  .speech-title h4 { font-size:var(--fs-sm); }
  .speech-maintenance { align-items:flex-start; flex-direction:column; gap:12px; }
}
</style>
