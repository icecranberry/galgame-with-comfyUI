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

      <section class="card memory-manager">
        <div class="manager-heading">
          <div>
            <h3>记忆管理</h3>
            <p>查看 SQLite 中的记忆正文。删除采用软删除，并同步安排向量删除任务。</p>
          </div>
          <button class="ghost compact" :disabled="memoriesLoading" @click="loadMemories">刷新</button>
        </div>
        <div class="memory-filters">
          <label>限定会话
            <select v-model="memoryFilters.conversationId" @change="applyMemoryFilters">
              <option value="">全部会话</option>
              <optgroup v-if="characterConversations.length" label="角色私聊">
                <option v-for="item in characterConversations" :key="item.id" :value="item.id">{{ item.name }}</option>
              </optgroup>
              <optgroup v-if="groupConversations.length" label="群聊">
                <option v-for="item in groupConversations" :key="item.id" :value="item.id">{{ item.name }}</option>
              </optgroup>
            </select>
          </label>
          <label>记忆类型
            <select v-model="memoryFilters.memoryType" @change="applyMemoryFilters">
              <option value="">全部类型</option>
              <option value="knowledge">知识</option>
              <option value="skill">技能</option>
              <option value="emotion">情绪</option>
              <option value="event">事件</option>
            </select>
          </label>
          <label>状态
            <select v-model="memoryFilters.status" @change="applyMemoryFilters">
              <option value="active">有效</option>
              <option value="superseded">已被替代</option>
              <option value="deleted">已删除</option>
              <option value="all">全部状态</option>
            </select>
          </label>
          <button class="primary filter-button" :disabled="memoriesLoading" @click="applyMemoryFilters">筛选</button>
        </div>

        <div v-if="memoriesLoading" class="inline-state">正在加载记忆…</div>
        <div v-else-if="memories.length === 0" class="inline-state">没有符合条件的记忆。</div>
        <div v-else class="memory-list">
          <article v-for="item in memories" :key="item.memory_id" class="memory-item">
            <div class="memory-item-main">
              <div class="memory-meta">
                <span class="type-pill">{{ memoryTypeLabel(item.memory_type) }}</span>
                <span :class="['status-pill', item.status]">{{ memoryStatusLabel(item.status) }}</span>
                <span class="conversation-label" :title="item.conversation_id || '无会话 ID'">
                  {{ conversationName(item.conversation_id) }}
                  <code>{{ item.conversation_id || '无会话' }}</code>
                </span>
                <span>{{ formatDate(item.updated_at || item.created_at) }}</span>
              </div>
              <div class="memory-judgment">{{ item.judgment || item.content }}</div>
              <div v-if="item.reasoning" class="memory-reasoning">依据：{{ item.reasoning }}</div>
              <div v-if="item.tags?.length" class="memory-tags">
                <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
              </div>
              <div class="memory-index-state">
                索引：{{ embeddingStateLabel(item.embedding_state) }}
                <span v-if="item.embedding_error" class="index-error" :title="item.embedding_error"> · {{ item.embedding_error }}</span>
              </div>
            </div>
            <button v-if="item.status !== 'deleted'" class="danger-link" :disabled="deletingMemoryId === item.memory_id" @click="removeMemory(item)">
              {{ deletingMemoryId === item.memory_id ? '删除中…' : '软删除' }}
            </button>
          </article>
        </div>
        <div class="pagination">
          <span>共 {{ memoryTotal }} 条 · 第 {{ memoryPage }} / {{ memoryPageCount }} 页</span>
          <div>
            <button class="ghost compact" :disabled="memoryPage <= 1 || memoriesLoading" @click="changeMemoryPage(-1)">上一页</button>
            <button class="ghost compact" :disabled="memoryPage >= memoryPageCount || memoriesLoading" @click="changeMemoryPage(1)">下一页</button>
          </div>
        </div>
      </section>

      <div class="management-grid">
        <section class="card recall-tester">
          <div class="manager-heading">
            <div><h3>召回测试</h3><p>使用当前文本、向量和重排序配置执行一次真实召回。</p></div>
          </div>
          <label>查询内容<input v-model.trim="recallQuery" placeholder="输入想验证的记忆线索" @keyup.enter="runRecallTest"></label>
          <label>限定会话（可空）
            <select v-model="recallConversationId">
              <option value="">全部会话</option>
              <optgroup v-if="characterConversations.length" label="角色私聊">
                <option v-for="item in characterConversations" :key="item.id" :value="item.id">{{ item.name }}</option>
              </optgroup>
              <optgroup v-if="groupConversations.length" label="群聊">
                <option v-for="item in groupConversations" :key="item.id" :value="item.id">{{ item.name }}</option>
              </optgroup>
            </select>
          </label>
          <button class="ghost" :disabled="recallLoading || !recallQuery" @click="runRecallTest">{{ recallLoading ? '召回中…' : '测试召回' }}</button>
          <div v-if="recallResults.length" class="recall-results">
            <div v-for="(item, index) in recallResults" :key="item.memory_id || index" class="recall-item">
              <div><strong>{{ index + 1 }}. {{ item.judgment || item.content }}</strong></div>
              <small>{{ conversationName(item.conversation_id) }} <code>{{ item.conversation_id }}</code> · {{ memoryTypeLabel(item.memory_type) }} · 分数 {{ formatScore(item.score) }} · {{ (item.sources || []).join(' + ') }}</small>
            </div>
          </div>
          <div v-else-if="recallTested && !recallLoading" class="inline-state">没有召回到相关记忆。</div>
        </section>

        <section class="card index-jobs">
          <div class="manager-heading">
            <div><h3>最近索引任务</h3><p>显示最近 30 条向量写入和删除任务。</p></div>
            <button class="ghost compact" :disabled="jobsLoading" @click="loadIndexJobs">刷新</button>
          </div>
          <div v-if="jobsLoading" class="inline-state">正在加载任务…</div>
          <div v-else-if="indexJobs.length === 0" class="inline-state">暂无索引任务。</div>
          <div v-else class="job-list">
            <div v-for="job in indexJobs" :key="job.id" class="job-item">
              <div><code>#{{ job.id }}</code> {{ job.job_type === 'delete' ? '删除' : '写入' }} · <span :class="['job-status', job.status]">{{ jobStatusLabel(job.status) }}</span></div>
              <small :title="job.memory_id">{{ shortMemoryId(job.memory_id) }} · {{ formatDate(job.updated_at || job.created_at) }}</small>
              <div v-if="job.error" class="job-error" :title="job.error">{{ job.error }}</div>
            </div>
          </div>
        </section>
      </div>

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
import { computed, inject, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  deleteMemoryFragment,
  getMemoryConfig,
  getMemoryFragments,
  getMemoryIndexJobs,
  getMemoryStats,
  listCharacters,
  listGroups,
  reindexMemories,
  retryFailedMemories,
  searchMemories,
  testMemoryEmbedding,
  testMemoryReranker,
  updateMemoryConfig,
} from '../api/index.js'

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
const confirmDialog = inject('confirm', null)
const loading = ref(true)
const saving = ref(false)
const maintaining = ref(false)
const testingEmbedding = ref(false)
const testingReranker = ref(false)
const message = ref('')
const messageType = ref('ok')
const stats = reactive({ rows: [], profile: null, mode: 'text' })

const MEMORY_PAGE_SIZE = 20
const memories = ref([])
const memoryTotal = ref(0)
const memoryPage = ref(1)
const memoriesLoading = ref(false)
const deletingMemoryId = ref(null)
const memoryFilters = reactive({ conversationId: '', memoryType: '', status: 'active' })
const memoryPageCount = computed(() => Math.max(1, Math.ceil(memoryTotal.value / MEMORY_PAGE_SIZE)))
const characters = ref([])
const groups = ref([])
const characterConversations = computed(() => characters.value.map(character => ({
  id: `char_${character.id}`,
  name: character.display_name || character.name || `角色 ${character.id}`,
})))
const groupConversations = computed(() => groups.value.map(group => ({
  id: `group_${group.id}`,
  name: group.name || `群聊 ${group.id}`,
})))
const conversationLabels = computed(() => new Map([
  ...characterConversations.value.map(item => [item.id, `私聊 · ${item.name}`]),
  ...groupConversations.value.map(item => [item.id, `群聊 · ${item.name}`]),
]))

const recallQuery = ref('')
const recallConversationId = ref('')
const recallResults = ref([])
const recallLoading = ref(false)
const recallTested = ref(false)

const indexJobs = ref([])
const jobsLoading = ref(false)

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

function memoryTypeLabel(type) {
  return ({ knowledge: '知识', skill: '技能', emotion: '情绪', event: '事件' })[type] || type || '未知'
}
function memoryStatusLabel(status) {
  return ({ active: '有效', superseded: '已被替代', deleted: '已删除' })[status] || status || '未知'
}
function embeddingStateLabel(state) {
  return ({ indexed: '已索引', pending: '等待中', failed: '失败', stale: '待重建', disabled: '文本模式' })[state] || state || '未知'
}
function jobStatusLabel(status) {
  return ({ pending: '等待中', completed: '完成', failed: '失败' })[status] || status || '未知'
}
function formatDate(value) {
  if (!value) return '未知时间'
  const parsed = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('zh-CN', { hour12: false })
}
function formatScore(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—' }
function shortMemoryId(value) {
  const text = String(value || '无 memory_id')
  return text.length > 24 ? `${text.slice(0, 12)}…${text.slice(-8)}` : text
}
function conversationName(conversationId) {
  if (!conversationId) return '无会话'
  return conversationLabels.value.get(conversationId)
    || (conversationId.startsWith('char_') ? '已删除角色的私聊' : conversationId.startsWith('group_') ? '已解散的群聊' : '未知会话')
}

async function loadConversationDirectory() {
  try {
    const [characterResult, groupResult] = await Promise.all([listCharacters(), listGroups()])
    characters.value = characterResult.characters || []
    groups.value = groupResult.groups || []
  } catch (error) { notify(`会话名称加载失败：${error.message}`, 'error') }
}

async function loadMemories() {
  memoriesLoading.value = true
  try {
    const result = await getMemoryFragments({
      conversation_id: memoryFilters.conversationId,
      memory_type: memoryFilters.memoryType,
      status: memoryFilters.status,
      limit: MEMORY_PAGE_SIZE,
      offset: (memoryPage.value - 1) * MEMORY_PAGE_SIZE,
    })
    memories.value = result.fragments || []
    memoryTotal.value = result.total || 0
    if (memoryPage.value > memoryPageCount.value) {
      memoryPage.value = memoryPageCount.value
      return await loadMemories()
    }
  } catch (error) { notify(error.message, 'error') }
  finally { memoriesLoading.value = false }
}
function applyMemoryFilters() {
  memoryPage.value = 1
  loadMemories()
}
function changeMemoryPage(delta) {
  memoryPage.value = Math.min(memoryPageCount.value, Math.max(1, memoryPage.value + delta))
  loadMemories()
}
async function removeMemory(item) {
  const prompt = `确定软删除这条记忆吗？\n\n${item.judgment || item.content}`
  const confirmed = confirmDialog
    ? await confirmDialog({ title: '软删除记忆', message: prompt, okText: '删除', danger: true })
    : window.confirm(prompt)
  if (!confirmed) return
  deletingMemoryId.value = item.memory_id
  try {
    await deleteMemoryFragment(item.memory_id)
    notify('记忆已软删除，向量删除任务已安排')
    await Promise.all([loadMemories(), loadIndexJobs(), refreshStats()])
  } catch (error) { notify(error.message, 'error') }
  finally { deletingMemoryId.value = null }
}

async function runRecallTest() {
  if (!recallQuery.value || recallLoading.value) return
  recallLoading.value = true
  recallTested.value = true
  try {
    const result = await searchMemories(recallQuery.value, { conversationId: recallConversationId.value, topK: 20 })
    recallResults.value = result.results || []
  } catch (error) {
    recallResults.value = []
    notify(error.message, 'error')
  } finally { recallLoading.value = false }
}

async function loadIndexJobs() {
  jobsLoading.value = true
  try { indexJobs.value = (await getMemoryIndexJobs(30)).jobs || [] }
  catch (error) { notify(error.message, 'error') }
  finally { jobsLoading.value = false }
}

async function refreshStats() {
  try { Object.assign(stats, await getMemoryStats()) }
  catch (error) { notify(error.message, 'error') }
}

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
  try {
    const result = await reindexMemories()
    notify(`索引处理完成：${result.indexed}/${result.total}`)
    await Promise.all([load(), loadMemories(), loadIndexJobs()])
  }
  catch (error) { notify(error.message, 'error') }
  finally { maintaining.value = false }
}
async function retryFailed() {
  maintaining.value = true
  try {
    const result = await retryFailedMemories()
    notify(`重试完成：${result.indexed}/${result.total}`)
    await Promise.all([load(), loadMemories(), loadIndexJobs()])
  }
  catch (error) { notify(error.message, 'error') }
  finally { maintaining.value = false }
}

onMounted(() => Promise.all([load(), loadConversationDirectory(), loadMemories(), loadIndexJobs()]))
</script>

<style scoped>
.memory-page { flex: 1; height: 100vh; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }
.page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 4px; font-size: 24px; }
.page-header p, .card p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.back { width: 38px; height: 38px; border: 1px solid var(--glass-border); border-radius: 12px; background: var(--glass-bg); color: var(--text-bright); font-size: 28px; cursor: pointer;display: flex;align-items: center; }
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
.memory-manager { margin-top: 16px; }
.manager-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.memory-filters { display: grid; grid-template-columns: minmax(180px, 1.5fr) minmax(130px, .75fr) minmax(130px, .75fr) auto; gap: 12px; align-items: end; }
.memory-filters label { margin-bottom: 0; }
.filter-button { height: 38px; margin-bottom: 0; white-space: nowrap; }
.inline-state { padding: 22px; text-align: center; color: var(--text-secondary); font-size: 13px; }
.memory-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.memory-item { display: flex; align-items: flex-start; gap: 16px; padding: 15px; border: 1px solid rgba(125, 105, 85, .14); border-radius: 12px; background: rgba(255,255,255,.36); }
.memory-item-main { min-width: 0; flex: 1; }
.memory-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; color: var(--text-secondary); font-size: 11px; }
.memory-meta code { overflow-wrap: anywhere; }
.conversation-label { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: var(--text-bright); }
.conversation-label code { color: var(--text-secondary); font-size: 10px; font-weight: 400; }
.type-pill, .status-pill { padding: 3px 7px; border-radius: 999px; font-weight: 700; }
.type-pill { color: #4677a8; background: rgba(85, 130, 180, .12); }
.status-pill.active { color: #3f8759; background: rgba(77, 150, 102, .12); }
.status-pill.superseded { color: #9a742e; background: rgba(190, 145, 55, .13); }
.status-pill.deleted { color: #a75555; background: rgba(195, 79, 79, .11); }
.memory-judgment { margin-top: 9px; font-size: 14px; font-weight: 650; line-height: 1.55; overflow-wrap: anywhere; }
.memory-reasoning { margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.memory-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.memory-tags span { padding: 3px 7px; border-radius: 6px; background: rgba(224, 123, 108, .09); color: var(--accent); font-size: 11px; }
.memory-index-state { margin-top: 9px; color: var(--text-secondary); font-size: 11px; }
.index-error { color: #c34f4f; display: inline-block; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.danger-link { flex-shrink: 0; padding: 6px 8px; border: 0; background: transparent; color: #c34f4f; cursor: pointer; font-size: 12px; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; color: var(--text-secondary); font-size: 12px; }
.pagination > div { display: flex; gap: 8px; }
button.compact { padding: 7px 11px; font-size: 12px; }
.management-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
.recall-results, .job-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; max-height: 420px; overflow-y: auto; }
.recall-item, .job-item { padding: 11px 12px; border-radius: 10px; background: rgba(255,255,255,.38); border: 1px solid rgba(125, 105, 85, .12); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.recall-item small, .job-item small { color: var(--text-secondary); }
.job-item { display: grid; gap: 3px; }
.job-status.completed { color: #3f8759; }.job-status.pending { color: #9a742e; }.job-status.failed { color: #c34f4f; }
.job-error { color: #c34f4f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
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
@media (max-width: 800px) {
  .memory-page { padding: 16px; }
  .grid, .management-grid { grid-template-columns: 1fr; }
  .overview { flex-direction: column; }
  .stats { justify-content: space-around; }
  .three-col, .memory-filters { grid-template-columns: 1fr; }
  .filter-button { width: 100%; }
  .memory-item { flex-direction: column; }
  .danger-link { align-self: flex-end; }
  .pagination { align-items: flex-start; flex-direction: column; }
  .actions { flex-wrap: wrap; }
  .mode-badge { display: none; }
}
</style>
