<template>
  <section class="local-speech-models" aria-label="本地语音模型">
    <div class="local-model-heading"><h4>本地语音 · IndexTTS 2.0</h4><span>所有角色统一使用</span></div>
    <p class="local-model-hint">支持中英文，使用角色已配置的音色。朗读时自动启动服务、按需加载模型。</p>
    <div class="local-model-actions">
      <span class="local-model-hint" role="status">{{ loading ? '正在检查安装…' : selected?.installed ? 'IndexTTS 2.0 已安装' : 'IndexTTS 2.0 尚未安装完整' }}</span>
      <linshe-button size="sm" :loading="installing" :disabled="loading || using || installing || disabled" @click="installPromptOpen = true">{{ selected?.installed ? '检查 / 修复安装' : '安装 IndexTTS 2.0' }}</linshe-button>
      <linshe-button variant="link" size="sm" :disabled="using || loading" @click="refresh">刷新安装状态</linshe-button>
    </div>
    <p v-if="installing" class="local-model-hint" role="status">正在安装 IndexTTS 2.0，首次需要下载模型。可以关闭窗口，安装会在后台继续。</p>
    <linshe-button v-if="status?.installation.log" variant="link" size="sm" :aria-expanded="logOpen" @click="logOpen = !logOpen">{{ logOpen ? '收起安装输出' : '查看安装输出' }}</linshe-button>
    <Transition name="local-model-content"><pre v-if="logOpen && status?.installation.log" class="local-model-log">{{ status.installation.log }}</pre></Transition>
    <p v-if="error || status?.installation.error" class="local-model-hint is-error" role="alert">{{ error || status.installation.error }}</p>
    <p v-else-if="notice" class="local-model-hint" role="status">{{ notice }}</p>
    <linshe-modal v-model="installPromptOpen" title="安装语音服务" :transition-ms="300">
      <div class="local-install-guide">
        <p>网络能够直连外网时，可以选择自动下载安装。无法直连外网时，建议下载离线依赖包。</p>
        <div class="local-install-download">
          <a href="https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE" target="_blank" rel="noopener noreferrer">下载离线依赖包（夸克网盘） ↗</a>
          <span class="local-model-hint">提取码：<strong>SWwE</strong></span>
        </div>
        <p>解压离线依赖包后，将其中的 <code>runtime</code> 文件夹放到邻舍根目录的 <code>tts-service</code> 文件夹中，最终目录结构为：</p>
        <code class="local-install-path">tts-service/runtime</code>
        <p class="local-model-hint">放好后，关闭此提示并点击「刷新安装状态」。</p>
      </div>
      <template #footer>
        <linshe-button @click="installPromptOpen = false">关闭</linshe-button>
        <linshe-button variant="primary" :disabled="loading || using || installing || disabled" @click="install">自动下载安装</linshe-button>
      </template>
    </linshe-modal>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheModal from './ui/LinsheModal.vue'
import { ttsApi } from '../api/tts.js'
import { stopSpeech } from '../stores/speech.js'
const props = defineProps({ disabled: Boolean })
const emit = defineEmits(['changed', 'busy'])
const status = ref(null), loading = ref(true), using = ref(false), error = ref(''), notice = ref('')
const logOpen = ref(false)
const installPromptOpen = ref(false)
const installing = computed(() => status.value?.installation.status === 'running')
const selected = computed(() => status.value?.models.find(model => model.id === '2.0'))
watch(using, value => emit('busy', value))
let disposed = false, timer, revision = 0
async function refresh() {
  const current = ++revision
  clearTimeout(timer)
  try {
    const result = await ttsApi('/local-models')
    if (disposed || current !== revision) return
    status.value = result
    if (result.installation.status === 'running' || result.using) timer = setTimeout(() => refresh(), 2000)
  } catch (e) { if (!disposed && current === revision) error.value = e.message }
  finally { if (!disposed && current === revision) loading.value = false }
}
async function install() {
  if (using.value || installing.value || loading.value || props.disabled) return
  installPromptOpen.value = false
  error.value = ''; notice.value = ''
  // Block repeat clicks until the backend returns its background task status.
  loading.value = true
  try { await ttsApi('/local-models/install', { model: '2.0' }); if (!disposed) await refresh() }
  catch (e) { if (!disposed) error.value = e.message }
  finally { if (!disposed) loading.value = false }
}
async function use() {
  if (using.value || installing.value || !selected.value?.installed || loading.value) return
  using.value = true; error.value = ''; notice.value = ''; stopSpeech()
  try {
    const result = await ttsApi('/local-models/use', { model: '2.0' })
    if (disposed) return
    emit('changed', result.settings); notice.value = 'IndexTTS 2.0 已就绪'
    await refresh()
  } catch (e) { if (!disposed) { error.value = e.message; await refresh() } }
  finally { if (!disposed) using.value = false }
}
onMounted(refresh)
onBeforeUnmount(() => { disposed = true; revision++; clearTimeout(timer); emit('busy', false) })
</script>
<style scoped>
.local-speech-models { display:grid; gap:12px; margin-top:14px; }
.local-model-heading,.local-model-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.local-model-heading { justify-content:space-between; }
.local-model-heading h4 { margin:0; font-size:var(--fs-sm); color:var(--text-primary); }
.local-model-heading span,.local-model-hint { margin:0; font-size:var(--fs-xs); color:var(--text-secondary); line-height:1.6; overflow-wrap:anywhere; }
.local-model-hint.is-error { color:var(--danger); }
.local-install-guide { display:grid; gap:14px; color:var(--text-primary); font-size:var(--fs-sm); line-height:1.7; overflow-wrap:anywhere; }
.local-install-guide p { margin:0; }
.local-install-download { display:flex; align-items:center; flex-wrap:wrap; gap:8px 16px; }
.local-install-download a { color:var(--accent); text-underline-offset:3px; }
.local-install-path { display:block; padding:12px; border-radius:var(--radius-sm); background:var(--bg-secondary); font-size:var(--fs-sm); }
.local-model-log { min-width:0; margin:0; color:var(--text-secondary); font-size:var(--fs-xs); max-height:180px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.5; }
.local-model-content-enter-active,.local-model-content-leave-active { transition:opacity .3s ease; }
.local-model-content-enter-from,.local-model-content-leave-to { opacity:0; }
</style>
