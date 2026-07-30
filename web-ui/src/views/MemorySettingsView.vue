<template>
  <div class="memory-page">
    <header class="page-header">
      <button class="back" @click="router.push('/settings')">‹</button>
      <div>
        <h2>聊天记忆</h2>
        <p>独立于绘图知识库；未配置嵌入模型时使用本地文本召回。</p>
      </div>
      <span :class="['mode-badge', form.embedding.enabled ? 'hybrid' : 'text']">
        {{ form.embedding.enabled ? '混合模式' : '文本模式' }}
      </span>
    </header>

    <div v-if="loading" class="state-card">正在加载…</div>
    <template v-else>
      <section class="card overview">
        <div>
          <h3>工作方式</h3>
          <p>每个完整对话轮次后台判断是否值得记忆，并以判断句、依据和标签保存。嵌入和重排序失败时自动回退，不影响聊天和记忆写入。</p>
        </div>
        <div class="stats">
          <div><strong>{{ activeCount }}</strong><span>有效记忆</span></div>
          <div><strong>{{ indexedCount }}</strong><span>已索引</span></div>
          <div><strong>{{ failedCount }}</strong><span>索引失败</span></div>
        </div>
      </section>

      <div class="grid">
        <section class="card">
          <div class="section-title">
            <div><h3>嵌入模型</h3><p>OpenAI-compatible <code>/embeddings</code></p></div>
            <label class="switch"><input v-model="form.embedding.enabled" type="checkbox"><span></span></label>
          </div>
          <template v-if="form.embedding.enabled">
            <label>供应商
              <select v-model="form.embedding.provider" @change="applyEmbeddingProvider">
                <option v-for="item in embeddingProviders" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </label>
            <label>服务地址<input v-model.trim="form.embedding.baseURL" placeholder="https://api.openai.com/v1"></label>
            <label>模型<input v-model.trim="form.embedding.model" placeholder="text-embedding-3-small"></label>
            <label>API Key<input v-model="form.embedding.apiKey" type="password" :placeholder="embeddingKeyHint"></label>
            <div class="two-col">
              <label>向量维度（可空）<input v-model.number="form.embedding.dimensions" type="number" min="1"></label>
              <label>超时 ms<input v-model.number="form.embedding.timeoutMs" type="number" min="1000"></label>
            </div>
            <label>附加请求头 JSON<textarea v-model="embeddingHeaders" rows="3"></textarea></label>
            <button class="ghost" :disabled="testingEmbedding" @click="testEmbedding">{{ testingEmbedding ? '测试中…' : '测试嵌入连接' }}</button>
          </template>
          <p v-else class="disabled-note">不配置也可完整工作：SQLite 文本索引负责召回。</p>
        </section>

        <section class="card">
          <div class="section-title">
            <div><h3>重排序模型</h3><p>Jina / Cohere-compatible <code>/rerank</code></p></div>
            <label class="switch"><input v-model="form.reranker.enabled" type="checkbox"><span></span></label>
          </div>
          <template v-if="form.reranker.enabled">
            <label>供应商
              <select v-model="form.reranker.provider" @change="applyRerankerProvider">
                <option v-for="item in rerankerProviders" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </label>
            <label>服务地址<input v-model.trim="form.reranker.baseURL" placeholder="https://api.jina.ai/v1"></label>
            <label>模型<input v-model.trim="form.reranker.model" placeholder="jina-reranker-v2-base-multilingual"></label>
            <label>API Key<input v-model="form.reranker.apiKey" type="password" :placeholder="rerankerKeyHint"></label>
            <div class="two-col">
              <label>返回数量<input v-model.number="form.reranker.topN" type="number" min="1" max="50"></label>
              <label>超时 ms<input v-model.number="form.reranker.timeoutMs" type="number" min="1000"></label>
            </div>
            <label>附加请求头 JSON<textarea v-model="rerankerHeaders" rows="3"></textarea></label>
            <button class="ghost" :disabled="testingReranker" @click="testReranker">{{ testingReranker ? '测试中…' : '测试重排序连接' }}</button>
          </template>
          <p v-else class="disabled-note">关闭时使用文本排序或文本＋向量融合排序。</p>
        </section>
      </div>

      <section class="card params">
        <h3>召回参数</h3>
        <div class="three-col">
          <label>最终注入数量<input v-model.number="form.topK" type="number" min="1" max="20"></label>
          <label>文本候选数<input v-model.number="form.textCandidates" type="number" min="5" max="100"></label>
          <label>向量候选数<input v-model.number="form.vectorCandidates" type="number" min="5" max="100"></label>
        </div>
        <p>当前 profile：<code>{{ stats.profile || '无（文本模式）' }}</code></p>
      </section>

      <section class="card warning">
        <h3>隔离说明</h3>
        <p>这些配置只用于聊天记忆。绘图库 RAG 继续固定使用本地 Jina ONNX 和 <code>image_prompt_knowledge</code> corpus，不会随这里的模型切换。</p>
      </section>

      <div class="actions">
        <button class="ghost" :disabled="maintaining" @click="retryFailed">重试失败项</button>
        <button class="ghost" :disabled="maintaining" @click="reindex">重建聊天索引</button>
        <button class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
      </div>
      <p v-if="message" :class="['message', messageType]">{{ message }}</p>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getMemoryConfig, updateMemoryConfig, testMemoryEmbedding, testMemoryReranker, getMemoryStats, reindexMemories, retryFailedMemories } from '../api/index.js'

const embeddingProviders = [
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'text-embedding-3-small', dimensions: 1536 },
  { id: 'siliconflow', name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', dimensions: 1024 },
  { id: 'jina', name: 'Jina AI', baseURL: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3', dimensions: 1024 },
  { id: 'custom', name: '自定义（OpenAI-compatible）' },
]
const rerankerProviders = [
  { id: 'jina', name: 'Jina AI', baseURL: 'https://api.jina.ai/v1', model: 'jina-reranker-v2-base-multilingual' },
  { id: 'cohere', name: 'Cohere', baseURL: 'https://api.cohere.com/v2', model: 'rerank-v3.5' },
  { id: 'siliconflow', name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-reranker-v2-m3' },
  { id: 'voyage', name: 'Voyage AI', baseURL: 'https://api.voyageai.com/v1', model: 'rerank-2.5' },
  { id: 'custom', name: '自定义（Jina/Cohere-compatible）' },
]

const router = useRouter()
const loading = ref(true)
const saving = ref(false)
const maintaining = ref(false)
const testingEmbedding = ref(false)
const testingReranker = ref(false)
const message = ref('')
const messageType = ref('ok')
const stats = reactive({ rows: [], profile: null, mode: 'text' })
const form = reactive({
  enabled: true, topK: 7, textCandidates: 24, vectorCandidates: 24,
  embedding: { enabled: false, provider: 'custom', baseURL: '', apiKey: '', model: '', dimensions: null, headers: {}, timeoutMs: 8000, hasApiKey: false },
  reranker: { enabled: false, provider: 'custom', baseURL: '', apiKey: '', model: '', topN: 7, headers: {}, timeoutMs: 8000, hasApiKey: false },
})
const embeddingHeaders = ref('{}')
const rerankerHeaders = ref('{}')
const activeCount = computed(() => sumRows(row => row.status === 'active'))
const indexedCount = computed(() => sumRows(row => row.status === 'active' && row.embedding_state === 'indexed'))
const failedCount = computed(() => sumRows(row => row.status === 'active' && row.embedding_state === 'failed'))
const embeddingKeyHint = computed(() => form.embedding.hasApiKey ? '已保存，留空保持不变' : '可空')
const rerankerKeyHint = computed(() => form.reranker.hasApiKey ? '已保存，留空保持不变' : '可空')

function sumRows(predicate) { return stats.rows.filter(predicate).reduce((sum, row) => sum + row.count, 0) }
function providerPayload(provider, headersText) {
  let headers
  try { headers = JSON.parse(headersText) } catch { throw new Error('附加请求头必须是有效 JSON') }
  if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error('附加请求头必须是 JSON 对象')
  return { ...provider, headers }
}
function payload() {
  return {
    enabled: form.enabled, topK: form.topK, textCandidates: form.textCandidates, vectorCandidates: form.vectorCandidates,
    embedding: providerPayload(form.embedding, embeddingHeaders.value),
    reranker: providerPayload(form.reranker, rerankerHeaders.value),
  }
}
function notify(text, type = 'ok') { message.value = text; messageType.value = type }
function applyProviderPreset(target, providers) {
  const preset = providers.find(item => item.id === target.provider)
  if (!preset || preset.id === 'custom') return
  target.baseURL = preset.baseURL
  target.model = preset.model
  if (Object.prototype.hasOwnProperty.call(preset, 'dimensions')) target.dimensions = preset.dimensions
}
function applyEmbeddingProvider() { applyProviderPreset(form.embedding, embeddingProviders) }
function applyRerankerProvider() { applyProviderPreset(form.reranker, rerankerProviders) }

async function load() {
  loading.value = true
  try {
    const [config, stat] = await Promise.all([getMemoryConfig(), getMemoryStats()])
    Object.assign(form, config)
    form.embedding = { ...form.embedding, ...config.embedding }
    form.reranker = { ...form.reranker, ...config.reranker }
    embeddingHeaders.value = JSON.stringify(config.embedding.headers || {}, null, 2)
    rerankerHeaders.value = JSON.stringify(config.reranker.headers || {}, null, 2)
    Object.assign(stats, stat)
  } catch (error) { notify(error.message, 'error') }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try { await updateMemoryConfig(payload()); await load(); notify('聊天记忆设置已保存') }
  catch (error) { notify(error.message, 'error') }
  finally { saving.value = false }
}
async function testEmbedding() {
  testingEmbedding.value = true
  try { const result = await testMemoryEmbedding(providerPayload(form.embedding, embeddingHeaders.value)); notify(`嵌入连接正常，维度 ${result.dimensions}`) }
  catch (error) { notify(error.message, 'error') }
  finally { testingEmbedding.value = false }
}
async function testReranker() {
  testingReranker.value = true
  try { await testMemoryReranker(providerPayload(form.reranker, rerankerHeaders.value)); notify('重排序连接正常') }
  catch (error) { notify(error.message, 'error') }
  finally { testingReranker.value = false }
}
async function reindex() {
  maintaining.value = true
  try { const result = await reindexMemories(); notify(`索引处理完成：${result.indexed}/${result.total}`); await load() }
  catch (error) { notify(error.message, 'error') }
  finally { maintaining.value = false }
}
async function retryFailed() {
  maintaining.value = true
  try { const result = await retryFailedMemories(); notify(`重试完成：${result.indexed}/${result.total}`); await load() }
  catch (error) { notify(error.message, 'error') }
  finally { maintaining.value = false }
}

onMounted(load)
</script>

<style scoped>
.memory-page { flex: 1; height: 100vh; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }
.page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 4px; font-size: 24px; }
.page-header p, .card p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.back { width: 38px; height: 38px; border: 1px solid var(--glass-border); border-radius: 12px; background: var(--glass-bg); color: var(--text-bright); font-size: 28px; cursor: pointer; }
.mode-badge { margin-left: auto; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.mode-badge.text { background: rgba(85, 130, 180, .14); color: #4677a8; }
.mode-badge.hybrid { background: rgba(224, 123, 108, .16); color: var(--accent); }
.card, .state-card { background: var(--glass-bg); backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-border); border-radius: 16px; padding: 22px; box-shadow: var(--glass-shadow); }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.overview { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.stats { display: flex; gap: 24px; flex-shrink: 0; }
.stats div { display: flex; flex-direction: column; align-items: center; min-width: 64px; }
.stats strong { font-size: 22px; color: var(--accent); }
.stats span { font-size: 11px; color: var(--text-secondary); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.section-title { display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px; }
label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
input, textarea, select { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 9px 11px; border: 1px solid #e2d6c7; border-radius: 8px; background: rgba(255,255,255,.9); color: var(--text-bright); font: inherit; }
select { cursor: pointer; }
textarea { resize: vertical; font-family: ui-monospace, monospace; }
.two-col, .three-col { display: grid; gap: 12px; }
.two-col { grid-template-columns: 1fr 1fr; }
.three-col { grid-template-columns: repeat(3, 1fr); }
.params, .warning { margin-top: 16px; }
.disabled-note { padding: 16px; background: rgba(85, 130, 180, .08); border-radius: 10px; }
.warning { border-color: rgba(224, 123, 108, .35); }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
button.primary, button.ghost { border-radius: 9px; padding: 10px 18px; font-weight: 600; cursor: pointer; }
button.primary { border: 0; background: var(--accent); color: white; }
button.ghost { border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-bright); }
button:disabled { opacity: .55; cursor: default; }
.message { text-align: right; margin-top: 10px; font-size: 13px; }
.message.ok { color: #4d9666; }.message.error { color: #c34f4f; }
.switch { margin: 0; position: relative; width: 42px; height: 24px; }
.switch input { display: none; }.switch span { position: absolute; inset: 0; border-radius: 14px; background: #c9c3ba; transition: .2s; }
.switch span::after { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; border-radius: 50%; background: white; transition: .2s; }
.switch input:checked + span { background: var(--accent); }.switch input:checked + span::after { transform: translateX(18px); }
code { font-family: ui-monospace, monospace; }
@media (max-width: 800px) { .memory-page { padding: 16px; }.grid { grid-template-columns: 1fr; }.overview { flex-direction: column; }.stats { justify-content: space-around; }.three-col { grid-template-columns: 1fr; }.actions { flex-wrap: wrap; }.mode-badge { display: none; } }
</style>
