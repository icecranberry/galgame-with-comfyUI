<template>
  <div class="memory-page">
    <header class="page-header">
      <button class="back" aria-label="返回系统设置" @click="router.push('/settings')">‹</button>
      <div>
        <h2>聊天记忆</h2>
        <p>角色会整理你们聊过的重要内容，并在之后的对话中自然想起来。</p>
      </div>
      <span class="mode-badge hybrid">自动选择模型</span>
    </header>

    <div v-if="loading" class="state-card">正在加载…</div>
    <template v-else>
      <section class="card overview">
        <div>
          <h3>它会记住什么</h3>
          <p>系统会从聊天中挑选值得保留的内容，例如重要经历、喜好、约定和情绪。即使智能查找暂时不可用，也不会影响正常聊天和保存记忆。</p>
        </div>
        <div class="stats">
          <div><strong>{{ activeCount }}</strong><span>已保存</span></div>
          <div><strong>{{ indexedCount }}</strong><span>智能查找可用</span></div>
          <div><strong>{{ failedCount }}</strong><span>需要处理</span></div>
        </div>
      </section>

      <details ref="advancedRef" class="advanced-settings" open :class="{ 'is-open': advancedOpen }">
        <summary @click.prevent="toggleAdvanced">
          <span>高级设置</span>
          <small>智能匹配、结果优化和查找数量</small>
        </summary>
        <div class="advanced-content" :class="{ collapsing: advancedCollapsing }">
      <div class="grid">
        <section class="card">
          <div class="section-title">
            <div><h3>自定义智能匹配（可选）</h3><p>系统已有默认模型；开启并完整填写后，会优先使用你的模型。</p></div>
            <label class="switch"><input v-model="form.embedding.enabled" type="checkbox" aria-label="使用自定义智能匹配模型"><span></span></label>
          </div>
          <CollapseTransition :show="form.embedding.enabled">
            <div class="collapse-body">
            <label>服务商
              <DropdownSelect
                class="memory-select"
                :model-value="form.embedding.provider"
                :options="embeddingProviderOptions"
                placeholder="请选择服务商"
                @update:model-value="selectEmbeddingProvider"
              />
            </label>
            <label>服务地址<input v-model.trim="form.embedding.baseURL" placeholder="https://api.openai.com/v1"></label>
            <label>模型名称<input v-model.trim="form.embedding.model" placeholder="text-embedding-3-small"></label>
            <label>访问密钥（API Key）<input v-model="form.embedding.apiKey" type="password" :placeholder="embeddingKeyHint"></label>
            <div class="two-col">
              <label>结果维度（可不填）<input v-model.number="form.embedding.dimensions" type="number" min="1"></label>
              <label>最长等待时间（毫秒）<input v-model.number="form.embedding.timeoutMs" type="number" min="1000"></label>
            </div>
            <label>高级请求设置（JSON）<textarea v-model="embeddingHeaders" rows="3"></textarea></label>
            <button class="ghost" :disabled="testingEmbedding" @click="testEmbedding">{{ testingEmbedding ? '测试中…' : '测试智能匹配' }}</button>
            </div>
          </CollapseTransition>
          <p v-if="!form.embedding.enabled" class="disabled-note">当前使用系统默认模型；默认服务当天失败 5 次后，会自动切换到本地模型。</p>
        </section>

        <section class="card">
          <div class="section-title">
            <div><h3>自定义结果排序（可选）</h3><p>系统已有默认排序模型；开启并完整填写后，会优先使用你的模型。</p></div>
            <label class="switch"><input v-model="form.reranker.enabled" type="checkbox" aria-label="使用自定义结果排序模型"><span></span></label>
          </div>
          <CollapseTransition :show="form.reranker.enabled">
            <div class="collapse-body">
            <label>服务商
              <DropdownSelect
                class="memory-select"
                :model-value="form.reranker.provider"
                :options="rerankerProviderOptions"
                placeholder="请选择服务商"
                @update:model-value="selectRerankerProvider"
              />
            </label>
            <label>服务地址<input v-model.trim="form.reranker.baseURL" placeholder="https://api.jina.ai/v1"></label>
            <label>模型名称<input v-model.trim="form.reranker.model" placeholder="jina-reranker-v2-base-multilingual"></label>
            <label>访问密钥（API Key）<input v-model="form.reranker.apiKey" type="password" :placeholder="rerankerKeyHint"></label>
            <div class="two-col">
              <label>保留几条结果<input v-model.number="form.reranker.topN" type="number" min="1" max="50"></label>
              <label>最长等待时间（毫秒）<input v-model.number="form.reranker.timeoutMs" type="number" min="1000"></label>
            </div>
            <label>高级请求设置（JSON）<textarea v-model="rerankerHeaders" rows="3"></textarea></label>
            <button class="ghost" :disabled="testingReranker" @click="testReranker">{{ testingReranker ? '测试中…' : '测试结果优化' }}</button>
            </div>
          </CollapseTransition>
          <p v-if="!form.reranker.enabled" class="disabled-note">当前使用系统默认排序模型；默认服务当天失败 5 次后，会自动切换到本地模型。</p>
        </section>
      </div>

      <section class="card" style="margin-top: 16px;">
        <div class="section-title">
          <div><h3>未互动奇遇记忆</h3><p>关闭后，角色经历但用户未参与的奇遇在结束总结时不再写入聊天记忆（RAG），但仍会归档到往期奇遇。</p></div>
          <label class="switch"><input v-model="form.recordUnengagedEvents" type="checkbox" aria-label="RAG不记录未互动奇遇"><span></span></label>
        </div>
      </section>

      <section class="card" style="margin-top: 16px;">
        <div class="section-title">
          <div><h3>主动回想</h3><p>角色会在需要时主动检索自己的记忆（可能略微增加回复等待）。</p></div>
          <label class="switch"><input v-model="form.activeSearch.enabled" type="checkbox" aria-label="主动回想"><span></span></label>
        </div>
        <CollapseTransition :show="form.activeSearch.enabled">
          <div class="collapse-body">
            <label>回想最长等待时间（毫秒）<input v-model.number="form.activeSearch.timeoutMs" type="number" min="1000" max="30000"></label>
            <p class="disabled-note">开启后，角色遇到“你应该记得”的话题时会自主发起一次记忆检索，结果只用于当轮回复。</p>
          </div>
        </CollapseTransition>
      </section>

      <section class="card" style="margin-top: 16px;">
        <div class="section-title">
          <div><h3>记忆整理（睡眠期）</h3><p>用户不聊天时，后台自动整理记忆：冲突消解、泛化归纳、强度衰减归档、画像建议。</p></div>
          <label class="switch"><input v-model="form.consolidation.enabled" type="checkbox" aria-label="记忆整理"><span></span></label>
        </div>
        <CollapseTransition :show="form.consolidation.enabled">
          <div class="collapse-body">
            <label>空闲判定（分钟，距最后一条消息）<input v-model.number="form.consolidation.idleDelayMinutes" type="number" min="5" max="720"></label>
            <label>单轮整理模型调用上限<input v-model.number="form.consolidation.llmCallsPerRun" type="number" min="0" max="30"></label>
            <div style="margin-top: 8px;">
              <button class="ghost compact" :disabled="consolidating" @click="triggerConsolidation">{{ consolidating ? '整理中…' : '立即整理一次' }}</button>
            </div>
            <p class="disabled-note">整理永远避开聊天进行中；模型调用预算用尽时，剩余任务留到下轮继续。</p>
          </div>
        </CollapseTransition>
      </section>

      <section class="card" style="margin-top: 16px;">
        <div class="section-title">
          <div><h3>上下文预算</h3><p>限制随每轮消息注入的动态上下文总量，超出时按“历史减半 → 记忆裁剪 → 整块丢弃”逐级降级。</p></div>
          <label class="switch"><input v-model="form.contextBudget.enabled" type="checkbox" aria-label="上下文预算"><span></span></label>
        </div>
        <CollapseTransition :show="form.contextBudget.enabled">
          <div class="collapse-body">
            <label>动态上下文 token 预算<input v-model.number="form.contextBudget.dynamicTokens" type="number" min="2000" max="100000"></label>
            <p class="disabled-note">稳定人设部分不参与预算；降级过程会记录在服务端日志，不会静默截断。</p>
          </div>
        </CollapseTransition>
      </section>

      <section class="card params">
        <h3>查找范围</h3>
        <div class="three-col">
          <label>每次最多使用几条记忆<input v-model.number="form.topK" type="number" min="1" max="20"></label>
          <label>按文字查找的数量<input v-model.number="form.textCandidates" type="number" min="5" max="100"></label>
          <label>按意思查找的数量<input v-model.number="form.vectorCandidates" type="number" min="5" max="100"></label>
        </div>
        <p>当前方式：优先使用完整的自定义配置，否则自动使用系统默认或本地模型。</p>
      </section>

      <section class="card warning">
        <h3>不会影响绘图功能</h3>
        <p>这里的设置只影响聊天记忆，不会改变绘图知识库或图片生成效果。</p>
      </section>

      <div class="actions">
        <button class="ghost" :disabled="maintaining" @click="retryFailed">重新处理失败项</button>
        <button class="ghost" :disabled="maintaining" @click="reindex">重新整理全部记忆</button>
        <button class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
      </div>
        </div>
      </details>

      <section class="card memory-manager">
        <div class="manager-heading">
          <div>
            <h3>记忆管理</h3>
            <p>查看角色保存的聊天记忆，也可以删除不希望角色继续记住的内容。</p>
          </div>
          <button v-if="memoriesQueried" class="ghost compact" :disabled="memoriesLoading" @click="loadMemories">刷新</button>
        </div>
        <div class="memory-filters">
          <label>选择角色
            <DropdownSelect
              class="memory-select"
              :model-value="memoryFilters.conversationId"
              :options="characterOptions"
              placeholder="输入角色名称"
              aria-label="选择或搜索角色"
              searchable
              @update:model-value="selectMemoryConversation"
            />
          </label>
          <label>记忆类型
            <DropdownSelect
              class="memory-select"
              :model-value="memoryFilters.memoryType"
              :options="memoryTypeOptions"
              @update:model-value="selectMemoryType"
            />
          </label>
          <label>使用状态
            <DropdownSelect
              class="memory-select"
              :model-value="memoryFilters.status"
              :options="memoryStatusOptions"
              @update:model-value="selectMemoryStatus"
            />
          </label>
          <button class="primary filter-button" :disabled="memoriesLoading" @click="queryMemories">{{ memoriesLoading ? '查询中…' : '查询记忆' }}</button>
        </div>

        <Transition name="fade" mode="out-in">
        <div v-if="!memoriesQueried" key="empty" class="inline-state">选择角色和条件，然后点击“查询记忆”。</div>
        <div v-else-if="memoriesLoading" key="loading" class="inline-state">正在加载记忆…</div>
        <div v-else-if="memories.length === 0" key="none" class="inline-state">没有符合条件的记忆。</div>
        <TransitionGroup v-else key="list" name="list" tag="div" class="memory-list">
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
              <div v-if="item.reasoning" class="memory-reasoning">记住原因：{{ item.reasoning }}</div>
              <div v-if="item.tags?.length" class="memory-tags">
                <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
              </div>
              <div class="memory-index-state">
                整理状态：{{ embeddingStateLabel(item.embedding_state) }}
                <span v-if="item.embedding_error" class="index-error" :title="item.embedding_error"> · {{ item.embedding_error }}</span>
              </div>
            </div>
            <button v-if="item.status === 'archived'" class="ghost compact" :disabled="restoringMemoryId === item.memory_id" @click="restoreMemory(item)">
              {{ restoringMemoryId === item.memory_id ? '恢复中…' : '恢复' }}
            </button>
            <button v-if="item.status !== 'deleted'" class="danger-link" :disabled="deletingMemoryId === item.memory_id" @click="removeMemory(item)">
              {{ deletingMemoryId === item.memory_id ? '删除中…' : '删除' }}
            </button>
          </article>
        </TransitionGroup>
        </Transition>
        <div v-if="memoriesQueried" class="pagination">
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
            <div><h3>测试能否想起</h3><p>输入一段聊天内容，看看角色会找到哪些相关记忆。</p></div>
          </div>
          <label>聊天内容<input v-model.trim="recallQuery" placeholder="例如：我最喜欢什么食物？" @keyup.enter="runRecallTest"></label>
          <label>选择角色（可不选）
            <div class="recall-inline">
              <DropdownSelect
                v-model="recallConversationId"
                class="memory-select"
                :options="characterOptions"
                placeholder="输入角色名称"
                aria-label="选择或搜索角色"
                searchable
              />
              <button class="primary" :disabled="recallLoading || !recallQuery" @click="runRecallTest">{{ recallLoading ? '查找中…' : '开始测试' }}</button>
            </div>
          </label>
          <Transition name="fade" mode="out-in">
          <TransitionGroup v-if="recallResults.length" key="results" name="list" tag="div" class="recall-results">
            <div v-for="(item, index) in recallResults" :key="item.memory_id || index" class="recall-item">
              <div><strong>{{ index + 1 }}. {{ item.judgment || item.content }}</strong></div>
              <small>{{ conversationName(item.conversation_id) }} · {{ memoryTypeLabel(item.memory_type) }} · 相关度 {{ formatScore(item.score) }} · {{ sourceLabels(item.sources) }}</small>
            </div>
          </TransitionGroup>
          <div v-else-if="recallTested && !recallLoading" key="none" class="inline-state">没有找到相关记忆。</div>
          </Transition>
        </section>

        <section class="card index-jobs">
          <div class="manager-heading">
            <div><h3>最近处理记录</h3><p>显示最近 30 条记忆整理和删除记录。</p></div>
            <button class="ghost compact" :disabled="jobsLoading" @click="loadIndexJobs">刷新</button>
          </div>
          <div v-if="jobsLoading" class="inline-state">正在加载记录…</div>
          <div v-else-if="indexJobs.length === 0" class="inline-state">暂无处理记录。</div>
          <div v-else class="job-list">
            <div v-for="job in indexJobs" :key="job.id" class="job-item">
              <div class="job-heading">
                <strong>{{ job.job_type === 'delete' ? '删除记忆' : '整理记忆' }}</strong>
                <span :class="['job-status', job.status]">{{ jobStatusLabel(job.status) }}</span>
              </div>
              <div class="job-meta">
                <span v-if="job.memory_type" class="type-pill">{{ memoryTypeLabel(job.memory_type) }}</span>
                <span v-if="job.conversation_id">{{ conversationName(job.conversation_id) }}</span>
                <span>{{ formatDate(job.updated_at || job.created_at) }}</span>
              </div>
              <details v-if="job.memory_content" class="job-details">
                <summary>
                  <span class="job-preview">{{ job.memory_content }}</span>
                  <span class="job-detail-action" aria-hidden="true"></span>
                </summary>
                <div v-if="job.memory_reasoning" class="job-reasoning">记住原因：{{ job.memory_reasoning }}</div>
                <div v-if="job.tags.length" class="job-tags">
                  <span v-for="tag in job.tags" :key="tag">{{ tag }}</span>
                </div>
              </details>
              <div v-else class="job-unavailable">这条记录的记忆内容已不可用。</div>
              <div v-if="job.error" class="job-error" :title="job.error">{{ job.error }}</div>
            </div>
          </div>
        </section>
      </div>

    </template>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import DropdownSelect from '../components/DropdownSelect.vue'
import CollapseTransition from '../components/CollapseTransition.vue'
import {
  deleteMemoryFragment,
  getConsolidationJobs,
  getMemoryConfig,
  getMemoryFragments,
  getMemoryIndexJobs,
  getMemoryStats,
  listCharacters,
  listGroups,
  reindexMemories,
  restoreMemoryFragment,
  retryFailedMemories,
  runConsolidationNow,
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
const embeddingProviderOptions = embeddingProviders.map(item => ({ value: item.id, label: item.name }))
const rerankerProviderOptions = rerankerProviders.map(item => ({ value: item.id, label: item.name }))
const memoryTypeOptions = [
  { value: '', label: '全部类型' },
  { value: 'knowledge', label: '信息' },
  { value: 'skill', label: '技能' },
  { value: 'emotion', label: '情绪' },
  { value: 'event', label: '经历' },
]
const memoryStatusOptions = [
  { value: 'active', label: '正在使用' },
  { value: 'archived', label: '已归档' },
  { value: 'superseded', label: '已有更新' },
  { value: 'deleted', label: '已删除' },
  { value: 'all', label: '全部状态' },
]

const router = useRouter()
const confirmDialog = inject('confirm', null)
const toast = inject('toast', null)
const loading = ref(true)
const saving = ref(false)
const maintaining = ref(false)
const testingEmbedding = ref(false)
const testingReranker = ref(false)
const advancedOpen = ref(false)
const advancedCollapsing = ref(false)
const advancedRef = ref(null)

function toggleAdvanced() {
  const content = advancedRef.value?.querySelector('.advanced-content')
  if (!content) return
  if (!advancedOpen.value) {
    // 展开：先设 max-height 为当前 scrollHeight，触发过渡
    content.style.maxHeight = content.scrollHeight + 'px'
    advancedOpen.value = true
    // 过渡结束后放开 max-height 以适应内部交互（如下拉框展开）
    content.addEventListener('transitionend', function handler() {
      content.style.maxHeight = 'none'
      content.removeEventListener('transitionend', handler)
    })
  } else {
    // 收拢：先把 none 转成具体 px 值（触发 reflow），再降为 0
    content.style.maxHeight = content.scrollHeight + 'px'
    advancedCollapsing.value = true
    requestAnimationFrame(() => {
      content.style.maxHeight = '0px'
      content.addEventListener('transitionend', function handler() {
        advancedCollapsing.value = false
        advancedOpen.value = false
        content.style.maxHeight = ''
        content.removeEventListener('transitionend', handler)
      })
    })
  }
}
const stats = reactive({ rows: [], profile: null, mode: 'text' })

const MEMORY_PAGE_SIZE = 20
const memories = ref([])
const memoryTotal = ref(0)
const memoryPage = ref(1)
const memoriesLoading = ref(false)
const memoriesQueried = ref(false)
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
const characterOptions = computed(() => [
  { value: '', label: '全部角色' },
  ...characterConversations.value.map(item => ({ value: item.id, label: item.name })),
])

const recallQuery = ref('')
const recallConversationId = ref('')
const recallResults = ref([])
const recallLoading = ref(false)
const recallTested = ref(false)

const indexJobs = ref([])
const jobsLoading = ref(false)
const restoringMemoryId = ref(null)
const consolidating = ref(false)

const form = reactive({
  enabled: true, topK: 7, textCandidates: 24, vectorCandidates: 24, recordUnengagedEvents: true,
  activeSearch: { enabled: false, timeoutMs: 4000 },
  consolidation: { enabled: true, idleDelayMinutes: 30, llmCallsPerRun: 6 },
  contextBudget: { enabled: false, dynamicTokens: 8000 },
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
    enabled: form.enabled, topK: form.topK, textCandidates: form.textCandidates, vectorCandidates: form.vectorCandidates, recordUnengagedEvents: form.recordUnengagedEvents,
    activeSearch: { enabled: form.activeSearch.enabled, timeoutMs: form.activeSearch.timeoutMs },
    consolidation: { enabled: form.consolidation.enabled, idleDelayMinutes: form.consolidation.idleDelayMinutes, llmCallsPerRun: form.consolidation.llmCallsPerRun },
    contextBudget: { enabled: form.contextBudget.enabled, dynamicTokens: form.contextBudget.dynamicTokens },
    embedding: providerPayload(form.embedding, embeddingHeaders.value),
    reranker: providerPayload(form.reranker, rerankerHeaders.value),
  }
}
function notify(text, type = 'ok') {
  const toastType = type === 'error' ? 'error' : 'success'
  toast?.(text, toastType)
}
function applyProviderPreset(target, providers) {
  const preset = providers.find(item => item.id === target.provider)
  if (!preset || preset.id === 'custom') return
  target.baseURL = preset.baseURL
  target.model = preset.model
  if (Object.prototype.hasOwnProperty.call(preset, 'dimensions')) target.dimensions = preset.dimensions
}
function selectEmbeddingProvider(value) {
  form.embedding.provider = value
  applyProviderPreset(form.embedding, embeddingProviders)
}
function selectRerankerProvider(value) {
  form.reranker.provider = value
  applyProviderPreset(form.reranker, rerankerProviders)
}

function memoryTypeLabel(type) {
  return ({ knowledge: '信息', skill: '技能', emotion: '情绪', event: '经历' })[type] || type || '未知'
}
function memoryStatusLabel(status) {
  return ({ active: '正在使用', archived: '已归档', superseded: '已有更新', deleted: '已删除' })[status] || status || '未知'
}
function embeddingStateLabel(state) {
  return ({ indexed: '已整理', pending: '等待整理', failed: '整理失败', stale: '需要重新整理', disabled: '等待智能整理' })[state] || state || '未知'
}
function jobStatusLabel(status) {
  return ({ pending: '等待处理', processing: '正在处理', completed: '已完成', failed: '处理失败' })[status] || status || '未知'
}
function formatDate(value) {
  if (!value) return '未知时间'
  const parsed = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('zh-CN', { hour12: false })
}
function formatScore(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—' }
function sourceLabels(sources) {
  const labels = { fts: '文字匹配', ngram: '相近文字', vector: '意思匹配' }
  return (sources || []).map(source => labels[source] || source).join(' + ')
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
  } catch (error) { notify(`角色列表加载失败：${error.message}`, 'error') }
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
function queryMemories() {
  memoriesQueried.value = true
  memoryPage.value = 1
  loadMemories()
}
function resetMemoryQuery() {
  memoriesQueried.value = false
  memories.value = []
  memoryTotal.value = 0
  memoryPage.value = 1
}
function selectMemoryConversation(value) {
  memoryFilters.conversationId = value
  resetMemoryQuery()
}
function selectMemoryType(value) {
  memoryFilters.memoryType = value
  resetMemoryQuery()
}
function selectMemoryStatus(value) {
  memoryFilters.status = value
  resetMemoryQuery()
}
function changeMemoryPage(delta) {
  memoryPage.value = Math.min(memoryPageCount.value, Math.max(1, memoryPage.value + delta))
  loadMemories()
}
// 阶段四：archived 记忆恢复（恢复后 stale 触发重嵌入，重新可见于检索）
async function restoreMemory(item) {
  restoringMemoryId.value = item.memory_id
  try {
    await restoreMemoryFragment(item.memory_id)
    notify('这条记忆已恢复，角色可以重新想起它')
    await Promise.all([loadMemories(), refreshStats()])
  } catch (error) { notify(`恢复失败：${error.message}`, 'error') }
  finally { restoringMemoryId.value = null }
}
// 阶段三：手动触发一轮记忆整理（聊天进行中服务端会拒绝）
async function triggerConsolidation() {
  consolidating.value = true
  try {
    const result = await runConsolidationNow()
    if (result.skipped) {
      notify(result.skipped === 'chat-active' ? '正在聊天中，稍后再整理' : '本轮未满足整理条件')
    } else {
      const calls = result.llmCallsUsed ?? 0
      notify(`整理完成，本轮调用 ${calls} 次记忆整理模型`)
    }
    await loadIndexJobs()
  } catch (error) { notify(`整理失败：${error.message}`, 'error') }
  finally { consolidating.value = false }
}
async function removeMemory(item) {
  const prompt = `删除后，这条内容不会再被角色想起。确定删除吗？\n\n${item.judgment || item.content}`
  const confirmed = confirmDialog
    ? await confirmDialog({ title: '删除记忆', message: prompt, okText: '删除', danger: true })
    : window.confirm(prompt)
  if (!confirmed) return
  deletingMemoryId.value = item.memory_id
  try {
    await deleteMemoryFragment(item.memory_id)
    notify('这条记忆已删除，角色不会再想起它')
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
  try {
    const jobs = (await getMemoryIndexJobs(30)).jobs || []
    indexJobs.value = jobs.map(job => ({ ...job, tags: parseJobTags(job.memory_tags) }))
  }
  catch (error) { notify(error.message, 'error') }
  finally { jobsLoading.value = false }
}

function parseJobTags(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function refreshStats() {
  try { Object.assign(stats, await getMemoryStats()) }
  catch (error) { notify(error.message, 'error') }
}

async function applyConfig() {
  const [config, stat] = await Promise.all([getMemoryConfig(), getMemoryStats()])
  Object.assign(form, config)
  form.embedding = { ...form.embedding, ...config.embedding }
  form.reranker = { ...form.reranker, ...config.reranker }
  form.activeSearch = { ...form.activeSearch, ...(config.activeSearch || {}) }
  form.consolidation = { ...form.consolidation, ...(config.consolidation || {}) }
  form.contextBudget = { ...form.contextBudget, ...(config.contextBudget || {}) }
  embeddingHeaders.value = JSON.stringify(config.embedding.headers || {}, null, 2)
  rerankerHeaders.value = JSON.stringify(config.reranker.headers || {}, null, 2)
  Object.assign(stats, stat)
}
async function load() {
  loading.value = true
  try { await applyConfig() }
  catch (error) { notify(error.message, 'error') }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try { await updateMemoryConfig(payload()); await applyConfig(); notify('聊天记忆设置已保存') }
  catch (error) { notify(error.message, 'error') }
  finally { saving.value = false }
}
async function testEmbedding() {
  testingEmbedding.value = true
  try { const result = await testMemoryEmbedding(providerPayload(form.embedding, embeddingHeaders.value)); notify(`智能匹配连接正常，结果维度 ${result.dimensions}`) }
  catch (error) { notify(error.message, 'error') }
  finally { testingEmbedding.value = false }
}
async function testReranker() {
  testingReranker.value = true
  try { await testMemoryReranker(providerPayload(form.reranker, rerankerHeaders.value)); notify('结果优化连接正常') }
  catch (error) { notify(error.message, 'error') }
  finally { testingReranker.value = false }
}
async function reindex() {
  maintaining.value = true
  try {
    const result = await reindexMemories()
    notify(`已加入后台整理队列：${result.queued}/${result.total}`)
    await Promise.all([applyConfig(), memoriesQueried.value ? loadMemories() : Promise.resolve(), loadIndexJobs()])
  }
  catch (error) { notify(error.message, 'error') }
  finally { maintaining.value = false }
}
async function retryFailed() {
  maintaining.value = true
  try {
    const result = await retryFailedMemories()
    notify(`失败项已重新加入队列：${result.queued}/${result.total}`)
    await Promise.all([applyConfig(), memoriesQueried.value ? loadMemories() : Promise.resolve(), loadIndexJobs()])
  }
  catch (error) { notify(error.message, 'error') }
  finally { maintaining.value = false }
}

onMounted(() => Promise.all([load(), loadConversationDirectory(), loadIndexJobs()]))
</script>

<style scoped>
.memory-page { flex: 1; height: 100vh; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }
.page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 4px; font-size: 24px; }
.page-header p, .card p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.back { width: 38px; height: 38px; border: 1px solid var(--glass-border); border-radius: 12px; background: var(--glass-bg); color: var(--text-bright); font-size: 28px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.mode-badge { margin-left: auto; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.mode-badge.text { background: rgba(85, 130, 180, .14); color: #4677a8; }
.mode-badge.hybrid { background: rgba(var(--accent-rgb), .16); color: var(--accent); }
.card, .state-card { background: var(--glass-bg); backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-border); border-radius: 16px; padding: 22px; box-shadow: var(--glass-shadow); }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.advanced-settings { position: relative; z-index: 40; margin-bottom: 16px; border: 1px solid var(--glass-border); border-radius: 16px; background: var(--glass-bg); box-shadow: var(--glass-shadow); }
.advanced-settings summary { min-height: 52px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 14px 18px; cursor: pointer; list-style: none; }
.advanced-settings summary::-webkit-details-marker { display: none; }
.advanced-settings summary::after { content: '›'; margin-left: auto; color: var(--text-secondary); font-size: 24px; line-height: 1; transform: rotate(90deg); transition: transform .3s ease; }
.advanced-settings.is-open summary::after { transform: rotate(-90deg); }
.advanced-settings summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 14px; }
.advanced-settings summary span { font-size: 15px; font-weight: 700; }
.advanced-settings summary small { color: var(--text-secondary); font-size: 12px; }
.advanced-content { padding: 0 16px 16px; overflow: hidden; max-height: 0; transition: max-height .3s cubic-bezier(0.22, 0.61, 0.36, 1), padding .3s cubic-bezier(0.22, 0.61, 0.36, 1); }
.advanced-content.collapsing { padding-top: 0; padding-bottom: 0; }
.overview { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.stats { display: flex; gap: 24px; flex-shrink: 0; }
.stats div { display: flex; flex-direction: column; align-items: center; min-width: 64px; }
.stats strong { font-size: 22px; color: var(--accent); }
.stats span { font-size: 11px; color: var(--text-secondary); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.section-title { display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px; }
label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
input, textarea { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 9px 11px; border: 1px solid #e2d6c7; border-radius: 8px; background: rgba(255,255,255,.9); color: var(--text-bright); font: inherit; }
.memory-select { margin-top: 6px; }
textarea { resize: vertical; font-family: ui-monospace, monospace; }
.two-col, .three-col { display: grid; gap: 12px; }
.two-col { grid-template-columns: 1fr 1fr; }
.three-col { grid-template-columns: repeat(3, 1fr); }
.params, .warning { margin-top: 16px; }
.disabled-note { padding: 16px; background: rgba(85, 130, 180, .08); border-radius: 10px; }
.collapse-body { padding-top: 4px; }
.warning { border-color: rgba(var(--accent-rgb), .35); }
.memory-manager { position: relative; z-index: 30; margin-top: 16px; }
.manager-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.memory-filters { display: grid; grid-template-columns: minmax(180px, 1.5fr) minmax(130px, .75fr) minmax(130px, .75fr) auto; gap: 12px; align-items: end; }
.memory-filters label { margin-bottom: 0; }
.filter-button { height: 38px; margin-bottom: 0; white-space: nowrap; }
.inline-state { padding: 22px; text-align: center; color: var(--text-secondary); font-size: 13px; }
.memory-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; position: relative; }
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
.memory-tags span { padding: 3px 7px; border-radius: 6px; background: rgba(var(--accent-rgb), .09); color: var(--accent); font-size: 11px; }
.memory-index-state { margin-top: 9px; color: var(--text-secondary); font-size: 11px; }
.index-error { color: #c34f4f; display: inline-block; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.danger-link { flex-shrink: 0; padding: 6px 8px; border: 0; background: transparent; color: #c34f4f; cursor: pointer; font-size: 12px; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; color: var(--text-secondary); font-size: 12px; }
.pagination > div { display: flex; gap: 8px; }
button.compact { padding: 7px 11px; font-size: 12px; }
.management-grid { position: relative; z-index: 20; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
.recall-tester { position: relative; z-index: 2; }
.recall-inline { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.recall-inline .memory-select { flex: 1; margin-top: 0; }
.recall-inline .primary { flex-shrink: 0; height: 38px; }
.index-jobs { position: relative; z-index: 1; }
.recall-results, .job-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; max-height: 420px; overflow-y: auto; position: relative; }
.recall-item, .job-item { padding: 11px 12px; border-radius: 10px; background: rgba(255,255,255,.38); border: 1px solid rgba(125, 105, 85, .12); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.recall-item small, .job-item small { color: var(--text-secondary); }
.job-item { display: grid; gap: 8px; }
.job-heading, .job-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.job-heading { justify-content: space-between; font-size: 13px; }
.job-meta { color: var(--text-secondary); font-size: 11px; }
.job-details { border-top: 1px solid rgba(125, 105, 85, .12); padding-top: 7px; }
.job-details summary { min-height: 44px; display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; cursor: pointer; list-style: none; color: var(--text-bright); }
.job-details summary::-webkit-details-marker { display: none; }
.job-preview { min-width: 0; flex: 1; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.6; }
.job-details[open] .job-preview { display: block; overflow: visible; }
.job-detail-action { flex-shrink: 0; color: var(--accent); font-size: 11px; white-space: nowrap; }
.job-detail-action::after { content: '查看详情'; }
.job-details[open] .job-detail-action::after { content: '收起'; }
.job-reasoning { margin-top: 4px; padding: 8px 10px; border-radius: 7px; background: rgba(85, 130, 180, .07); color: var(--text-secondary); line-height: 1.6; }
.job-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.job-tags span { padding: 2px 6px; border-radius: 6px; background: rgba(var(--accent-rgb), .09); color: var(--accent); font-size: 10px; }
.job-unavailable { color: var(--text-secondary); font-size: 11px; }
.job-status.completed { color: #3f8759; }.job-status.pending { color: #9a742e; }.job-status.processing { color: #367aa3; }.job-status.failed { color: #c34f4f; }
.job-error { color: #c34f4f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
button.primary, button.ghost { border-radius: 9px; padding: 10px 18px; font-weight: 600; cursor: pointer; }
button.primary { border: 0; background: var(--accent); color: white; }
button.ghost { border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-bright); }
button:disabled { opacity: .55; cursor: default; }

/* ── 列表/状态切换过渡 ── */
.fade-enter-active, .fade-leave-active { transition: opacity .25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.list-enter-active, .list-leave-active { transition: opacity .25s ease; }
.list-leave-active { position: absolute; left: 0; right: 0; }
.list-move { transition: transform .3s cubic-bezier(0.22, 0.61, 0.36, 1); }
.list-enter-from, .list-leave-to { opacity: 0; }
code { font-family: ui-monospace, monospace; }
.switch { margin: 0; position: relative; width: 42px; height: 24px; cursor: pointer; }
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
