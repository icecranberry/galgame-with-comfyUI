<template>
  <div class="cortico-page">
    <header class="page-header">
      <linshe-button variant="icon" size="lg" aria-label="返回系统设置" @click="router.push('/settings')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6" /></svg>
      </linshe-button>
      <div><h2>Cortico 集成</h2><p>让邻舍角色走进 Cortico 人格机器人，也带上她的声音与小镇生活。</p></div>
    </header>
    <Transition name="bridge-fade" mode="out-in">
      <p v-if="loading" class="status-line" role="status">正在读取集成配置…</p>
      <div v-else-if="loadError" class="card error-state" role="alert">
        <p>{{ loadError }}</p><linshe-button @click="load">重新加载</linshe-button>
      </div>
      <div v-else class="settings-grid">
        <section class="card connection-card">
          <div class="section-heading"><h3>连接与安装</h3><linshe-switch v-model="draft.enabled" aria-label="启用 Cortico 集成" on-text="启用" off-text="停用" /></div>
          <p class="description">Cortico 的邻舍 World 通过桥接 API 读取角色与工具。角色和工具权限在这里管理。</p>
          <label class="field-label" for="cortico-url">邻舍服务地址</label>
          <linshe-input id="cortico-url" v-model.trim="draft.public_url" placeholder="http://127.0.0.1:3099" />
          <p class="hint">填写 Cortico 能访问的地址。同机默认本机地址；跨设备用邻舍电脑的局域网 IP。</p>
          <label class="field-label" for="cortico-token">桥接 Token</label>
          <div class="field-row"><linshe-input id="cortico-token" :model-value="token" :type="showToken ? 'text' : 'password'" readonly /><linshe-button variant="ghost" size="sm" @click="showToken = !showToken">{{ showToken ? '隐藏' : '显示' }}</linshe-button></div>
          <div class="actions">
            <linshe-button size="sm" @click="copy(token)">复制 Token</linshe-button>
            <linshe-button size="sm" :disabled="dirty" @click="copyConfig">复制部署配置</linshe-button>
            <linshe-button variant="ghost" size="sm" @click="rotateVisible = true">重置 Token</linshe-button>
          </div>
          <div class="install-steps">
            <h4>接入步骤</h4>
            <ol><li>在邻舍启动器的 Cortico 页完成安装并启动，linshe 部署与扩展包已随安装就绪。</li><li>自行部署时，把下面复制的配置写进部署的 config.json 与 .env，再启动部署。</li><li>QQ 连接由 Cortico 的 QQ World 走 OneBot v11 连接 SnowLuma（默认 ws://127.0.0.1:3001），群与私聊在 QQ World 的监听名单里配置。</li></ol>
            <div class="actions"><a class="text-link" href="https://github.com/Pal-AI-Lab/Cortico" target="_blank" rel="noopener noreferrer">Cortico 项目 ↗</a></div>
          </div>
        </section>
        <section class="card persona-card">
          <div class="section-heading"><h3>初始角色人格</h3><linshe-switch v-model="draft.inject_persona" aria-label="注入邻舍人物卡" /></div>
          <label class="field-label" for="cortico-character">选择邻舍角色</label>
          <linshe-select id="cortico-character" v-model="draft.character_id" :options="characterOptions" searchable placeholder="选择初始角色" />
          <p class="hint">人物卡随角色更新，Cortico 人格前缀实时拉取（约半分钟内生效）。切换角色后建议新建对话。</p>
          <Transition name="bridge-fade" mode="out-in"><div :key="previewKey" class="persona-preview"><p v-if="personaLoading" class="description">正在读取人物卡…</p><p v-else-if="personaError" class="error-text">{{ personaError }}</p><pre v-else-if="personaText">{{ personaText }}</pre><p v-else class="description">{{ characters.length ? '选择一个角色，预览她的初始人格。' : '还没有邻舍角色，请先在角色管理中添加。' }}</p></div></Transition>
          <p class="hint">关闭人格注入后仍可使用已开放的工具。省略角色 ID 的工具默认使用上方角色。</p>
        </section>
        <section class="card tools-card">
          <div class="section-heading"><h3>预置工具</h3><span class="compact-stat">已开放 <b>{{ enabledToolCount }}</b> / {{ tools.length }}</span></div>
          <p class="description">查询读取邻舍现有内容；生图与语音由模型在回执里拿到媒体后经 QQ 消息发送。奇遇选项继续在邻舍奇遇页推进。</p>
          <div class="tool-grid"><div v-for="group in groups" :key="group.id" class="tool-row"><div><h4>{{ group.label }}</h4><p class="hint">{{ group.description }}</p></div><linshe-switch :model-value="draft.tools.includes(group.id)" :aria-label="`开放${group.label}工具`" @update:model-value="toggleTool(group.id, $event)" /></div></div>
          <p class="hint">生图需要已配置 LLM 与生图服务；TTS 需要启用语音服务并绑定角色音色。Cortico 侧接入范围由 QQ World 的监听名单决定。</p>
        </section>
        <div class="save-bar"><span class="status-line" role="status">{{ dirty ? '有未保存的修改' : saved?.enabled ? '集成已启用' : '集成已停用' }}</span><div class="actions"><linshe-button :loading="testing" :disabled="dirty || !saved?.enabled" @click="testConnection">测试邻舍接口</linshe-button><linshe-button variant="primary" :loading="saving" @click="save">保存配置</linshe-button></div></div>
      </div>
    </Transition>
    <linshe-modal v-model="rotateVisible" title="重置桥接 Token" :transition-ms="300">
      <p class="description">重置后，Cortico 当前 Token 会立即失效。请将新 Token 更新到部署 .env 的 LINSHE_BRIDGE_TOKEN 并重启部署。</p>
      <template #footer><linshe-button @click="rotateVisible = false">取消</linshe-button><linshe-button variant="danger" :loading="rotating" @click="rotate">重置 Token</linshe-button></template>
    </linshe-modal>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'
import LinsheSwitch from '../components/ui/LinsheSwitch.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import { corticoGetSettings, corticoSaveSettings, corticoGetPersona, corticoRotateToken, corticoTestConnection } from '../api/index.js'

const router = useRouter(), toast = inject('toast', null)
const loading = ref(true), loadError = ref(''), saving = ref(false), testing = ref(false), rotating = ref(false)
const draft = ref({ enabled: false, inject_persona: true, character_id: null, public_url: '', tools: [] }), saved = ref(null)
const characters = ref([]), tools = ref([]), token = ref(''), showToken = ref(false), rotateVisible = ref(false)
const personaText = ref(''), personaError = ref(''), personaLoading = ref(false)
const characterOptions = computed(() => characters.value.map(c => ({ value: c.id, label: c.display_name || c.name })))
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(saved.value))
const enabledToolCount = computed(() => tools.value.filter(t => draft.value.tools.includes(t.group)).length)
const previewKey = computed(() => `${draft.value.character_id}:${personaLoading.value}`)
const groups = [
  { id: 'characters', label: '人物卡', description: '角色列表与完整人格' },
  { id: 'images', label: '角色生图', description: '沿用角色外观与生图配置' },
  { id: 'tts', label: '角色语音', description: '用绑定的音色朗读对白' },
  { id: 'moments', label: '朋友圈', description: '动态、图片与评论' },
  { id: 'appearance', label: '外观与衣装', description: '原本外观、形态与限时服饰' },
  { id: 'events', label: '奇遇', description: '当前故事与历史选项' },
  { id: 'schedule', label: '日程', description: '今日安排与当前活动' },
  { id: 'newspaper', label: '邻舍日报', description: '今日报纸与往期内容' },
  { id: 'diary', label: '角色日记', description: '查询已写下的日记' },
  { id: 'world', label: '世界观', description: '邻舍当前世界设定' },
]
function toggleTool(id, enabled) { draft.value.tools = enabled ? [...draft.value.tools, id] : draft.value.tools.filter(t => t !== id) }
async function load() {
  loading.value = true; loadError.value = ''
  try {
    const data = await corticoGetSettings()
    saved.value = data.settings; draft.value = structuredClone(data.settings)
    characters.value = data.characters; token.value = data.token; tools.value = data.tools
  } catch (e) { loadError.value = e.message } finally { loading.value = false }
}
let previewRequest = 0
watch(() => draft.value.character_id, async id => {
  const request = ++previewRequest
  personaText.value = ''; personaError.value = ''; personaLoading.value = !!id
  if (!id) return
  try { const data = await corticoGetPersona(id); if (request === previewRequest) personaText.value = data.system_prompt }
  catch (e) { if (request === previewRequest) personaError.value = e.message }
  finally { if (request === previewRequest) personaLoading.value = false }
})
async function save() {
  saving.value = true
  try { const data = await corticoSaveSettings(JSON.parse(JSON.stringify(draft.value))); saved.value = data.settings; draft.value = structuredClone(data.settings); toast?.('Cortico 配置已保存', 'success') }
  catch (e) { toast?.(e.message, 'error') } finally { saving.value = false }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast?.('已复制', 'success') }
  catch { toast?.('复制失败，请手动选择并复制', 'error') }
}
function copyConfig() {
  copy(JSON.stringify({
    'config.json': { worlds: { linshe: { enabled: true, baseUrl: saved.value.public_url } } },
    '.env': { LINSHE_BRIDGE_TOKEN: token.value },
  }, null, 2))
}
async function rotate() {
  rotating.value = true
  try { token.value = (await corticoRotateToken()).token; rotateVisible.value = false; toast?.('Token 已重置，请更新 Cortico 部署的 .env 并重启', 'success') }
  catch (e) { toast?.(e.message, 'error') } finally { rotating.value = false }
}
async function testConnection() {
  testing.value = true
  try { await corticoTestConnection(token.value); toast?.('邻舍桥接接口可用，Cortico 侧请发起一次对话验证', 'success') }
  catch (e) { toast?.(e.message, 'error') } finally { testing.value = false }
}
onMounted(load)
</script>

<style scoped>
.cortico-page { flex: 1; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }
.page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 6px; font-size: var(--fs-2xl); }
.page-header p, .description { margin: 0 0 14px; font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.7; }
.page-header p { margin: 0; }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1280px; }
.card { padding: 24px; min-width: 0; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
h3 { margin: 0; font-size: var(--fs-lg); } h4 { margin: 0 0 4px; font-size: var(--fs-sm); }
.field-label { display: block; font-size: var(--fs-sm); font-weight: 600; margin: 16px 0 8px; }
.field-row { display: flex; gap: 8px; align-items: center; }.field-row > :first-child { flex: 1; min-width: 0; }
.hint { margin: 8px 0 0; font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
.install-steps { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border); }
.install-steps ol { margin: 10px 0; padding-left: 22px; font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.9; }
.text-link { color: var(--accent); font-size: var(--fs-sm); }
.persona-preview { min-height: 180px; max-height: 340px; overflow: auto; margin-top: 18px; padding: 16px; border-radius: var(--radius-md); background: var(--bg-secondary); }
.persona-preview pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: var(--fs-sm); line-height: 1.8; margin: 0; }
.tools-card, .save-bar { grid-column: 1 / -1; }
.tool-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; }
.tool-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.tool-row .hint { margin: 0; }
.compact-stat, .status-line { font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.7; }.compact-stat b { color: var(--accent); }
.save-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 0 0 28px; }.save-bar .actions { margin: 0; }
.error-text, .error-state p { color: var(--danger); font-size: var(--fs-sm); line-height: 1.7; }
.bridge-fade-enter-active, .bridge-fade-leave-active { transition: opacity .3s var(--ease-standard); }.bridge-fade-enter-from, .bridge-fade-leave-to { opacity: 0; }
@media (max-width: 900px) { .settings-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .cortico-page { padding: 16px; }.card { padding: 18px; }.tool-grid { grid-template-columns: 1fr; }.page-header { align-items: flex-start; gap: 12px; }.save-bar .actions { width: 100%; } }
</style>
