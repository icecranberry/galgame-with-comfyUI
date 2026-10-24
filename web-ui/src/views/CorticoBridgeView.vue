<template>
  <div class="cortico-page">
    <header class="page-header">
      <linshe-button variant="icon" size="lg" class="back" aria-label="返回系统设置" @click="router.push('/settings')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </linshe-button>
      <div>
        <h2>Cortico 集成</h2>
        <p>让邻舍角色走进 Cortico 人格机器人，也带上她的声音与小镇生活。</p>
      </div>
    </header>
    <Transition name="bridge-fade" mode="out-in">
      <p v-if="loading" class="status-line" role="status">正在读取集成配置…</p>
      <div v-else-if="loadError" class="card error-state" role="alert">
        <p>{{ loadError }}</p><linshe-button @click="load">重新加载</linshe-button>
      </div>
      <div v-else class="settings-grid">
        <section class="card connection-card">
          <div class="section-heading"><h3>后台入口</h3></div>
          <div class="admin-links-grid">
              <a class="admin-link" href="http://127.0.0.1:7900/" target="_blank" rel="noopener">
                <span class="admin-link-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 6h16v14H4zM9 3h6M10 3v3M14 3v3M7 11h2M7 14h4M15 11h2M15 14h2"/></svg>
                </span>
                <span class="admin-link-copy">
                  <span class="admin-link-name">Cortico 后台</span>
                  <span class="admin-link-meta">
                    <span class="admin-link-tag">人格机器人</span>
                    <span class="admin-link-token">默认无密码，仅本机</span>
                    <span class="admin-link-url">127.0.0.1:7900</span>
                  </span>
                </span>
                <span class="admin-link-open">打开<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
              </a>
              <a class="admin-link" href="http://127.0.0.1:5099/" target="_blank" rel="noopener">
                <span class="admin-link-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 6h16v14H4zM9 3h6M10 3v3M14 3v3M7 11h2M7 14h4M15 11h2M15 14h2"/></svg>
                </span>
                <span class="admin-link-copy">
                  <span class="admin-link-name">SnowLuma 后台</span>
                  <span class="admin-link-meta">
                    <span class="admin-link-tag">消息接收器</span>
                    <span class="admin-link-token">默认密码：<b>SnowLuma.admin</b></span>
                    <span class="admin-link-url">127.0.0.1:5099</span>
                  </span>
                </span>
                <span class="admin-link-open">打开<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
              </a>
          </div>
        </section>
        <section class="card persona-card">
          <div class="section-heading"><h3>初始角色人格</h3></div>
          <label class="field-label" for="cortico-character">选择邻舍角色</label>
          <linshe-select id="cortico-character" v-model="draft.character_id" :options="characterOptions" searchable placeholder="选择初始角色" />
          <p class="hint">人物卡随角色更新，Cortico 人格前缀实时拉取（约半分钟内生效）；切换角色后建议在 Cortico 后台重置会话，避免旧角色的对话记忆串味。</p>
          <Transition name="bridge-fade" mode="out-in"><div :key="previewKey" class="persona-preview"><p v-if="personaLoading" class="description">正在读取人物卡…</p><p v-else-if="personaError" class="error-text">{{ personaError }}</p><pre v-else-if="personaText">{{ personaText }}</pre><p v-else class="description">{{ characters.length ? '选择一个角色，预览她的初始人格。' : '还没有邻舍角色，请先在角色管理中添加。' }}</p></div></Transition>
          <p class="hint">省略角色 ID 的工具默认使用上方角色。</p>
        </section>
        <section class="card tools-card">
          <div class="section-heading"><h3>预置工具</h3><span class="compact-stat">已开放 <b>{{ enabledToolCount }}</b> / {{ tools.length }}</span></div>
          <p class="description">查询读取邻舍现有内容；生图与语音由模型在回执里拿到媒体后经 QQ 消息发送。奇遇选项继续在邻舍奇遇页推进。</p>
          <div class="tool-grid"><div v-for="group in groups" :key="group.id" class="tool-row"><div><h4>{{ group.label }}</h4><p class="hint">{{ group.description }}</p></div><linshe-switch :model-value="draft.tools.includes(group.id)" :aria-label="`开放${group.label}工具`" @update:model-value="toggleTool(group.id, $event)" /></div></div>
          <p class="hint">生图需要已配置 LLM 与生图服务；TTS 需要启用语音服务并绑定角色音色。Cortico 侧接入范围由 QQ World 的监听名单决定。</p>
        </section>
      </div>
    </Transition>
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
import { corticoGetSettings, corticoSaveSettings, corticoGetPersona } from '../api/index.js'

const router = useRouter(), toast = inject('toast', null)
const loading = ref(true), loadError = ref('')
const draft = ref({ enabled: false, inject_persona: true, character_id: null, public_url: '', tools: [] }), saved = ref(null)
const characters = ref([]), tools = ref([])
const personaText = ref(''), personaError = ref(''), personaLoading = ref(false)
const characterOptions = computed(() => characters.value.map(c => ({ value: c.id, label: c.display_name || c.name })))
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
function toggleTool(id, enabled) { draft.value.tools = enabled ? [...draft.value.tools, id] : draft.value.tools.filter(t => t !== id); save() }
async function load() {
  loading.value = true; loadError.value = ''
  try {
    const data = await corticoGetSettings()
    saved.value = data.settings; draft.value = structuredClone(data.settings)
    draft.value.inject_persona = true
    characters.value = data.characters; tools.value = data.tools
  } catch (e) { loadError.value = e.message } finally { loading.value = false }
}
let previewRequest = 0
watch(() => draft.value.character_id, async id => {
  const request = ++previewRequest
  personaText.value = ''; personaError.value = ''; personaLoading.value = !!id
  save()
  if (!id) return
  try { const data = await corticoGetPersona(id); if (request === previewRequest) personaText.value = data.system_prompt }
  catch (e) { if (request === previewRequest) personaError.value = e.message }
  finally { if (request === previewRequest) personaLoading.value = false }
})
async function save() {
  try {
    const data = await corticoSaveSettings(JSON.parse(JSON.stringify({ ...draft.value, inject_persona: true })))
    saved.value = data.settings; draft.value = structuredClone(data.settings); draft.value.inject_persona = true
  }
  catch (e) { toast?.(e.message, 'error'); draft.value = structuredClone(saved.value); draft.value.inject_persona = true }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast?.('已复制', 'success') }
  catch { toast?.('复制失败，请手动选择并复制', 'error') }
}
onMounted(load)
</script>

<style scoped>
.cortico-page { flex: 1; height: 100vh; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }

.page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 4px; font-size: 24px; }
.page-header p, .card p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.back { flex-shrink: 0; }

.settings-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; width: 100%; }
.card { padding: 24px; display: flex; flex-direction: column; }
.card h3 { font-size: 15px; color: var(--text-bright); margin: 0; font-weight: 600; }
h4 { margin: 0 0 4px; font-size: var(--fs-sm); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.description { margin: 0 0 14px !important; }
.field-label { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 8px; }
.field-row { display: flex; gap: 8px; align-items: center; }.field-row > :first-child { flex: 1; min-width: 0; }
.hint { margin: 8px 0 0; font-size: var(--fs-xs); line-height: 1.7; color: var(--text-secondary); overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }

/* ── 后台入口链接（与 MaiBot 桥接页同一套皮肤） ── */
.admin-links-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.admin-link {
  display: flex; align-items: center; gap: 12px; min-width: 0;
  padding: 12px 14px;
  background: rgba(var(--accent-rgb), 0.08);
  border: 1.5px solid rgba(var(--accent-rgb), 0.32); border-radius: 12px;
  text-decoration: none; color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(var(--accent-rgb), 0.08);
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}
.admin-link:hover {
  transform: translateY(-1px);
  border-color: var(--accent); background: rgba(var(--accent-rgb), 0.14);
  box-shadow: 0 8px 20px rgba(var(--accent-rgb), 0.18);
}
.admin-link-icon {
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; background: var(--accent); color: #fff;
  box-shadow: 0 4px 12px rgba(var(--accent-rgb), 0.28);
}
.admin-link-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.admin-link-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.admin-link-name { font-size: 14px; font-weight: 800; color: var(--text-bright); }
.admin-link-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.admin-link-tag {
  font-size: 11px; font-weight: 600; color: var(--accent);
  padding: 2px 8px; border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.14);
}
.admin-link-url { font-size: 11px; color: var(--text-secondary); font-family: ui-monospace, monospace; white-space: nowrap; }
.admin-link-token {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  padding: 3px 8px; border-radius: 999px; white-space: nowrap;
  background: rgba(var(--accent-rgb), 0.12);
  border: 1px solid rgba(var(--accent-rgb), 0.24);
}
.admin-link-token b { color: var(--accent); font-family: ui-monospace, monospace; font-weight: 700; }
.admin-link-open {
  margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 999px;
  background: var(--accent); color: #fff; font-size: 12px; font-weight: 700;
  box-shadow: 0 3px 10px rgba(var(--accent-rgb), 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.admin-link:hover .admin-link-open { transform: translateX(2px); box-shadow: 0 5px 14px rgba(var(--accent-rgb), 0.36); }
.admin-link-open svg { width: 14px; height: 14px; }

.persona-preview { min-height: 180px; max-height: 380px; overflow: auto; margin-top: 18px; padding: 16px; border-radius: var(--radius-md); background: var(--bg-secondary); }
.persona-preview pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: var(--fs-sm); line-height: 1.8; margin: 0; }
.tools-card .hint { margin: 0; }
.tool-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; }
.tool-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.tools-card > .hint { margin-top: 14px; }
.compact-stat, .status-line { font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.7; }.compact-stat b { color: var(--accent); }
.error-text, .error-state p { color: var(--danger); font-size: var(--fs-sm); line-height: 1.7; }
.bridge-fade-enter-active, .bridge-fade-leave-active { transition: opacity .3s var(--ease-standard); }.bridge-fade-enter-from, .bridge-fade-leave-to { opacity: 0; }
@media (max-width: 767px) { .admin-links-grid { grid-template-columns: 1fr; } .tool-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .cortico-page { padding: 16px; }.card { padding: 18px; }.page-header { align-items: flex-start; gap: 12px; } }
</style>
