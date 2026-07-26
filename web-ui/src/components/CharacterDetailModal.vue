<template>
  <Teleport to="body">
    <!-- ── 角色详情弹窗 ── -->
    <Transition name="modal-fade">
      <div v-if="visible && !showLoraModal" class="modal-overlay" @mousedown="onOverlayMouseDown" @click.self="onOverlayClick">
        <div class="modal-panel modal-wide" style="height:95vh;max-height:95vh">
          <div class="modal-header">
            <h3>{{ character?.display_name }}</h3>
            <button class="modal-close" @click="$emit('close')">✕</button>
          </div>

          <div class="modal-body modal-body-detail">
            <!-- 移动端工具栏 -->
            <div class="mobile-detail-toolbar" v-if="isMobile">
              <div class="toolbar-item toolbar-item-toggle">
                <span>不看ta的朋友圈</span>
                <label class="toggle-switch toolbar-switch">
                  <input type="checkbox" v-model="detail.momentsDisabled" @change="toggleMomentsDisabled" :disabled="detail.momentsToggling" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不主动聊天</span>
                <label class="toggle-switch toolbar-switch">
                  <input type="checkbox" v-model="detail.proactiveDisabled" @change="toggleProactiveDisabled" :disabled="detail.proactiveToggling" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toolbar-item toolbar-item-toggle">
                <span>不发生奇遇</span>
                <label class="toggle-switch toolbar-switch">
                  <input type="checkbox" v-model="detail.eventsDisabled" @change="toggleEventsDisabled" :disabled="detail.eventsToggling" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toolbar-item toolbar-item-btn" @click="openLoraModal">
                <span>设置 Lora</span>
                <span v-if="hasLoraSetup" class="toolbar-badge active">已配置</span>
                <span v-else class="toolbar-badge">未配置</span>
              </div>
            </div>
            <!-- 头像 -->
            <div class="detail-avatar-row">
              <div
                class="detail-avatar clickable"
                :style="character?.avatar_path ? { backgroundImage: `url(${character.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
                @click="$emit('open-avatar-editor', character)"
              >{{ character?.avatar_path ? '' : character?.display_name?.charAt(0) }}</div>
              <div>
                <button class="sp-btn-small" @click="$emit('open-avatar-editor', character)">更换头像</button>
                <button v-if="character?.avatar_path" class="sp-btn-small sp-btn-subtle" @click="$emit('remove-avatar', character)">移除</button>
              </div>
              <div v-if="character?.is_oath" class="detail-avatar-oath">
                <span class="oath-badge" @click="removeOath">
                  <span class="oath-badge-default">💍 已誓约</span>
                  <span class="oath-badge-hover">解除誓约</span>
                </span>
              </div>
            </div>

            <!-- 角色关系 -->
            <div class="detail-rel-section">
              <div class="detail-rel-header">
                <span class="detail-rel-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                    <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                  </svg>
                  角色关系网
                </span>
                <div class="detail-rel-btns">
                <button
                  v-if="detail.relationships.length > 0"
                  class="detail-rel-btn subtle"
                  @click="$emit('open-deduction', character)"
                >推演关系</button>
                <button
                  v-if="detail.relationships.length > 0"
                  class="detail-rel-btn subtle"
                  @click="$emit('open-relation-graph', character)"
                >管理关系图 &rarr;</button>
                </div>
              </div>
              <div v-if="detail.relationships.length > 0" class="detail-rel-list">
                <div v-for="rel in detail.relationships.slice(0, 5)" :key="rel.id" class="detail-rel-item">
                  <span class="rel-from">{{ character?.display_name }}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  <span class="rel-to">{{ rel.to_display_name }}</span>
                  <span class="rel-text">{{ rel.relationship_text }}</span>
                </div>
                <div v-if="detail.relationships.length > 5" class="detail-rel-more" @click="$emit('open-relation-graph', character)">
                  共 {{ detail.relationships.length }} 条关系，查看全部 &rarr;
                </div>
              </div>
              <div v-else class="detail-rel-empty">
                <template v-if="detail.relationshipsLoading">
                  <span class="rel-empty-spinner"></span> 加载中…
                </template>
                <template v-else>
                  <p class="rel-empty-desc">定义角色之间的关联，所有动作中都会自动感知这些关系</p>
                  <div class="detail-rel-ctas">
                  <button class="detail-rel-btn cta" @click="$emit('open-deduction', character)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    推演关系
                  </button>
                  <button class="detail-rel-btn cta" @click="$emit('open-relation-graph', character)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                      <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                    </svg>
                    手动设置关系
                  </button>
                  </div>
                </template>
              </div>
            </div>

            <div class="preview-card">
              <label class="fl">角色标识</label>
              <input v-model="detail.editCharName" class="fi" @input="detail.dirty = true" placeholder="英文/拼音，唯一标识" />
              <label class="fl" style="margin-top:12px">展示名</label>
              <input v-model="detail.editName" class="fi" @input="detail.dirty = true" />
              <label class="fl" style="margin-top:12px">人格提示词</label>
              <textarea v-model="detail.editPrompt" class="fi prompt-textarea" @input="detail.dirty = true"></textarea>
            </div>
          </div>

          <!-- 操作栏 sticky footer -->
          <div class="modal-footer">
            <div class="detail-actions">
              <button class="btn-ghost danger" @click="deleteChar">&#x1F5D1; 删除角色</button>
              <div class="detail-actions-right">
                <div class="recruit-appearance-hint">
                  外观描述补充tag查阅
                  <a :href="`https://animadex.net/?mode=characters&q=${encodeURIComponent(character?.name).replaceAll('_', '+')}`" target="_blank">animadex：{{character?.name}}</a>
                </div>
                <button class="btn-primary" :disabled="!detail.dirty" @click="saveCharDetail">保存</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 悬浮侧边栏（桌面端） -->
        <div class="detail-float" v-if="!isMobile">
          <div class="float-card float-card-toggle">
            <span class="float-label">不看ta的朋友圈</span>
            <label class="toggle-switch float-switch">
              <input type="checkbox" v-model="detail.momentsDisabled" @change="toggleMomentsDisabled" :disabled="detail.momentsToggling" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="float-card float-card-toggle">
            <span class="float-label">不主动聊天</span>
            <label class="toggle-switch float-switch">
              <input type="checkbox" v-model="detail.proactiveDisabled" @change="toggleProactiveDisabled" :disabled="detail.proactiveToggling" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="float-card float-card-toggle">
            <span class="float-label">不发生奇遇</span>
            <label class="toggle-switch float-switch">
              <input type="checkbox" v-model="detail.eventsDisabled" @change="toggleEventsDisabled" :disabled="detail.eventsToggling" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="float-card float-card-btn" @click="openLoraModal">
            <span class="float-label">设置 Lora</span>
            <span v-if="hasLoraSetup" class="float-badge active">已配置</span>
            <span v-else class="float-badge">未配置</span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Lora 设置弹窗 ── -->
    <Transition name="modal-fade">
      <div v-if="showLoraModal" class="modal-overlay" @click.self="closeLoraModal">
        <div class="modal-panel modal-wide">
          <div class="modal-header">
            <h3>LoRA 设置 — {{ character?.display_name }}</h3>
            <button class="modal-close" @click="closeLoraModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="lora-body-card">
              <!-- ── Lora 列表 ── -->
              <TransitionGroup name="lora-card" tag="div" class="lora-list">
                <div v-for="(item, idx) in loraItems" :key="idx" class="lora-item-card">
                  <button class="lora-remove-btn" @click="removeLoraGroup(idx)" title="移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                  <div class="lora-item-row">
                    <div class="form-group lora-path-group">
                      <label class="fl lora-inline-label">文件路径</label>
                      <div class="lora-autocomplete-wrap">
                        <input
                          v-model="item.path"
                          class="fi"
                          placeholder="在ComfyUI-aki-v3(或其他名称)\ComfyUI\models\loras下搜索..."
                          @focus="onLoraInputFocus(idx)"
                          @input="onLoraInput(idx)"
                          @keydown="onLoraKeydown($event, idx)"
                          @blur="onLoraInputBlur"
                        />
                        <ul v-if="activeLoraFileIdx === idx && loraSuggestions.length > 0" class="lora-dropdown">
                          <li
                            v-for="(file, di) in loraSuggestions"
                            :key="file.path"
                            :class="['lora-dropdown-item', { active: di === loraDropdownIdx }]"
                            @mousedown.prevent="selectLoraFile(idx, file)"
                          >
                            <span>{{ loraDisplayName(file) }}</span>
                          </li>
                        </ul>
                        <div v-else-if="activeLoraFileIdx === idx && lorasFiles.length === 0 && !loraFetching" class="lora-dropdown" style="padding:16px;text-align:center;font-size:13px;color:var(--text-secondary)">
                          请先在启动器中配置 ComfyUI 路径
                        </div>
                        <div v-else-if="activeLoraFileIdx === idx && loraFetching" class="lora-dropdown" style="padding:16px;text-align:center;font-size:13px;color:var(--text-secondary)">
                          加载中...
                        </div>
                      </div>
                    </div>
                    <div class="form-group lora-weight-group">
                      <label class="fl lora-inline-label">权重</label>
                      <input
                        v-model.number="item.weight"
                        type="number"
                        step="0.05"
                        min="0"
                        max="5"
                        class="fi lora-weight-input"
                      />
                    </div>
                  </div>
                  <div class="lora-trigger-row">
                    <label class="fl lora-inline-label">触发词</label>
                    <textarea
                      v-model="item.triggerWord"
                      class="fi"
                      rows="3"
                      placeholder="可选，用于增强 lora 效果的提示词"
                    ></textarea>
                  </div>
                </div>
              </TransitionGroup>

              <!-- ── 空状态 ── -->
              <div v-if="loraItems.length === 0" class="lora-empty-hint">
                尚未配置任何 LoRA，点击下方按钮添加
              </div>

              <!-- ── 添加 Lora 按钮 ── -->
              <button class="lora-add-btn" @click="addLoraGroup">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                添加 LoRA
              </button>

              <div class="lora-separator"></div>

              <!-- ── 自定义工作流 ── -->
              <div class="form-group">
              <label class="lora-check-label" @click.stop>
                <span class="lora-checkbox-wrap">
                  <input type="checkbox" v-model="customWorkflowEnabled" class="lora-checkbox" />
                  <span class="lora-checkmark">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </span>
                <span class="lora-check-text">启用自定义工作流</span>
              </label>
                <Transition name="lora-expand">
                  <div v-if="customWorkflowEnabled" class="lora-workflow-select">
                    <DropdownSelect v-model="editingCustomWorkflow" :options="customWorkflowOptions" placeholder="请选择自定义工作流（放在workflows文件夹下）" />
                    <p class="form-hint">单人图片才会启用自定工作流，可以给某个角色单独设置完全自由的工作流，同样会默认注入长、宽、画师串、画面描述、lora（如果设置了），不需要的节点可以去掉。</p>
                  </div>
                </Transition>
              </div>
            </div>

            <div class="modal-actions" style="margin-top:16px">
              <span class="lora-civitai-label">LoRA 获取：</span>
              <a :href="civitaiSearchUrl" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">
                CivitAI 搜索：{{ civitaiDisplayName }}
              </a>
              <span class="lora-civitai-label">或</span>
              <a :href="civitaiRedSearchUrl" target="_blank" rel="noopener noreferrer" class="lora-civitai-link">
                CivitAI.red 搜索：{{ civitaiDisplayName }}
              </a>
              <div style="flex:1"></div>
              <button class="btn-primary" @click="saveLora" :disabled="loraLoading">
                {{ loraLoading ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, inject } from 'vue'
import { useChatStore } from '../stores/chat.js'
import * as api from '../api/index.js'
import DropdownSelect from '../components/DropdownSelect.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  character: { type: Object, default: null },
})

const emit = defineEmits([
  'close',
  'saved',
  'deleted',
  'open-avatar-editor',
  'remove-avatar',
  'open-relation-graph',
  'open-deduction',
  'lora-saved',
])

const chat = useChatStore()
const confirmFn = inject('confirm')
const toastFn = inject('toast')
const isMobile = inject('isMobile')

// ── 详情编辑状态 ──
const detail = reactive({
  editCharName: '',
  editName: '',
  editPrompt: '',
  relationships: [],
  relationshipsLoading: false,
  momentsDisabled: false,
  proactiveDisabled: false,
  eventsDisabled: false,
  dirty: false,
  momentsToggling: false,
  proactiveToggling: false,
  eventsToggling: false,
})

// ── Lora 设置状态 ──
const showLoraModal = ref(false)
const customWorkflows = ref([])
const customWorkflowEnabled = ref(false)
const editingCustomWorkflow = ref('')
const loraLoading = ref(false)
const loraItems = ref([])
const lorasFiles = ref([])
const activeLoraFileIdx = ref(null)
const loraDropdownIdx = ref(-1)
const loraSuggestions = ref([])
const loraFetching = ref(false)

const clickShouldClose = ref(false)

function onOverlayMouseDown(e) {
  if (e.target === e.currentTarget) {
    const textareaWasFocused = document.activeElement?.closest?.('.prompt-textarea') ?? false
    clickShouldClose.value = !textareaWasFocused
  } else {
    clickShouldClose.value = false
  }
}
function onOverlayClick() {
  if (clickShouldClose.value) {
    clickShouldClose.value = false
    emit('close')
  }
  clickShouldClose.value = false
}

const FILTERED_CUSTOM_WORKFLOW_NAMES = ['制图工作流.json', '制图工作流-加入lora.json', '制图工作流-加入lora2.json', '制图工作流-加入lora3.json']
const filteredWorkflows = computed(() =>
  (customWorkflows.value || []).filter(w => !FILTERED_CUSTOM_WORKFLOW_NAMES.includes(w.filename))
)
const customWorkflowOptions = computed(() =>
  filteredWorkflows.value.map(w => ({ value: w.filename, label: w.label }))
)

const civitaiSearchUrl = computed(() => {
  const name = (props.character?.name || props.character?.display_name || '').replaceAll('_', ' ')
  return `https://civitai.com/search/models?baseModel=Anima&sortBy=models_v9&query=${encodeURIComponent(name)}`
})
const civitaiRedSearchUrl = computed(() => {
  const name = (props.character?.name || props.character?.display_name || '').replaceAll('_', ' ')
  return `https://civitai.red/search/models?baseModel=Anima&sortBy=models_v9&query=${encodeURIComponent(name)}`
})
const civitaiDisplayName = computed(() => {
  return (props.character?.name || props.character?.display_name || '').replaceAll('_', ' ')
})

const hasLoraSetup = computed(() => {
  const c = props.character
  if (!c) return false
  return (_parseCharLoras(c.loras).length > 0) || !!c.custom_workflow
})

// ── Lora 辅助 ──
function _parseCharLoras(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}

// ═══════════════════════════════════════
// 详情弹窗
// ═══════════════════════════════════════

watch(() => [props.visible, props.character], ([v, c]) => {
  if (v && c) {
    init(c)
  }
})

function refreshRelationships() {
  if (!props.character) return
  detail.relationshipsLoading = true
  api.getRelationships(props.character.id).then(res => {
    detail.relationships = res.relationships || []
  }).catch(() => {
    detail.relationships = []
  }).finally(() => {
    detail.relationshipsLoading = false
  })
}

defineExpose({ refreshRelationships })

function init(c) {
  detail.editCharName = c.name || ''
  detail.editName = c.display_name || ''
  detail.editPrompt = c.base_prompt || ''
  detail.momentsDisabled = !!c.moments_disabled
  detail.proactiveDisabled = !!c.proactive_disabled
  detail.eventsDisabled = !!c.events_disabled
  detail.dirty = false
  detail.relationships = []
  detail.relationshipsLoading = true
  api.getRelationships(c.id).then(res => {
    detail.relationships = res.relationships || []
  }).catch(() => {
    detail.relationships = []
  }).finally(() => {
    detail.relationshipsLoading = false
  })
}

async function removeOath() {
  const c = props.character
  if (!c || !c.is_oath) return
  const ok = await confirmFn({
    title: '解除誓约',
    message: `确定要解除与「${c.display_name}」的誓约吗？\n解除后，双方的特殊关系状态将会结束。`,
    okText: '解除誓约',
  })
  if (!ok) return
  try {
    await api.removeOath(c.id)
    c.is_oath = 0
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.is_oath = 0
    toastFn('誓约已解除', 'success')
  } catch (e) {
    toastFn('解除誓约失败', 'error')
    console.error('removeOath failed:', e)
  }
}

async function saveCharDetail() {
  const c = props.character
  if (!c || !detail.dirty) return
  await api.updateCharacter(c.id, {
    name: detail.editCharName,
    display_name: detail.editName,
    base_prompt: detail.editPrompt,
    moments_disabled: detail.momentsDisabled,
    proactive_disabled: detail.proactiveDisabled,
    events_disabled: detail.eventsDisabled,
  })
  c.name = detail.editCharName
  c.display_name = detail.editName
  detail.dirty = false
  emit('saved', c)
}

async function deleteChar() {
  const c = props.character
  if (!c) return
  if (c.name === 'default') {
    toastFn('默认角色不能删除', 'warning')
    return
  }
  const ok = await confirmFn({
    title: '删除角色',
    message: `确定要删除「${c.display_name}」吗？\n聊天记录和朋友圈内容也将一并删除。`,
    okText: '删除', danger: true,
  })
  if (!ok) return
  await api.deleteCharacter(c.id)
  emit('deleted', c)
}

// ── 开关 — 即时持久化 ──

async function toggleMomentsDisabled() {
  const c = props.character
  if (!c) return
  detail.momentsToggling = true
  try {
    await api.updateCharacter(c.id, { moments_disabled: detail.momentsDisabled })
    c.moments_disabled = detail.momentsDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.moments_disabled = detail.momentsDisabled
  } catch (e) {
    detail.momentsDisabled = !detail.momentsDisabled
    console.error('toggleMomentsDisabled failed:', e)
  } finally {
    detail.momentsToggling = false
  }
}

async function toggleProactiveDisabled() {
  const c = props.character
  if (!c) return
  detail.proactiveToggling = true
  try {
    await api.updateCharacter(c.id, { proactive_disabled: detail.proactiveDisabled })
    c.proactive_disabled = detail.proactiveDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.proactive_disabled = detail.proactiveDisabled
  } catch (e) {
    detail.proactiveDisabled = !detail.proactiveDisabled
    console.error('toggleProactiveDisabled failed:', e)
  } finally {
    detail.proactiveToggling = false
  }
}

async function toggleEventsDisabled() {
  const c = props.character
  if (!c) return
  detail.eventsToggling = true
  try {
    await api.updateCharacter(c.id, { events_disabled: detail.eventsDisabled })
    c.events_disabled = detail.eventsDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.events_disabled = detail.eventsDisabled
  } catch (e) {
    detail.eventsDisabled = !detail.eventsDisabled
    console.error('toggleEventsDisabled failed:', e)
  } finally {
    detail.eventsToggling = false
  }
}

// ═══════════════════════════════════════
// Lora 弹窗
// ═══════════════════════════════════════

async function fetchWorkflows() {
  try {
    const data = await api.getWorkflows()
    customWorkflows.value = data.workflows || []
  } catch { customWorkflows.value = [] }
}

function addLoraGroup() {
  loraItems.value.push({ path: '', weight: 0.6, triggerWord: '' })
}

function removeLoraGroup(idx) {
  loraItems.value.splice(idx, 1)
}

async function fetchLorasFiles() {
  loraFetching.value = true
  try {
    const data = await api.fetchLorasFiles()
    lorasFiles.value = data.files || []
  } catch { lorasFiles.value = [] }
  loraFetching.value = false
}

function loraDisplayName(file) {
  return file.source ? `[${file.source}] ${file.name}` : file.name
}

function filterLoras(query) {
  if (!query) return lorasFiles.value
  const q = query.toLowerCase().replace(/\\/g, '/')
  return lorasFiles.value.filter(f => {
    const display = loraDisplayName(f).toLowerCase()
    return display.includes(q) || f.name.toLowerCase().includes(q)
  })
}

function onLoraInputFocus(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(loraItems.value[idx]?.path || '')
}

function onLoraInput(idx) {
  activeLoraFileIdx.value = idx
  loraDropdownIdx.value = -1
  loraSuggestions.value = filterLoras(loraItems.value[idx]?.path || '')
}

function onLoraInputBlur() {
  setTimeout(() => { activeLoraFileIdx.value = null }, 150)
}

function selectLoraFile(idx, file) {
  loraItems.value[idx].path = file.name
  activeLoraFileIdx.value = null
}

function onLoraKeydown(e, idx) {
  if (activeLoraFileIdx.value !== idx) return
  const items = loraSuggestions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    loraDropdownIdx.value = Math.min(loraDropdownIdx.value + 1, items.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    loraDropdownIdx.value = Math.max(loraDropdownIdx.value - 1, -1)
  } else if (e.key === 'Enter' && loraDropdownIdx.value >= 0) {
    e.preventDefault()
    selectLoraFile(idx, items[loraDropdownIdx.value])
  } else if (e.key === 'Escape') {
    activeLoraFileIdx.value = null
  }
}

function openLoraModal() {
  if (!props.character) return
  const c = props.character
  customWorkflowEnabled.value = !!c.custom_workflow
  editingCustomWorkflow.value = c.custom_workflow || ''
  const loras = _parseCharLoras(c.loras)
  loraItems.value = loras.length > 0
    ? JSON.parse(JSON.stringify(loras))
    : []
  showLoraModal.value = true
  if (customWorkflows.value.length === 0) fetchWorkflows()
  fetchLorasFiles()
}

function closeLoraModal() {
  showLoraModal.value = false
}

async function saveLora() {
  if (!props.character) return
  const c = props.character
  const customWf = (customWorkflowEnabled.value && editingCustomWorkflow.value) ? editingCustomWorkflow.value : ''
  const validLoras = loraItems.value.filter(l => l.path && l.path.trim())
  loraLoading.value = true
  try {
    await api.updateCharacter(c.id, {
      custom_workflow: customWf || null,
      loras: validLoras,
    })
    c.custom_workflow = customWf || null
    c.loras = validLoras.length > 0 ? JSON.stringify(validLoras) : null
    showLoraModal.value = false
    emit('lora-saved', c)
  } catch (e) {
    console.error('saveLora failed:', e)
  } finally {
    loraLoading.value = false
  }
}
</script>

<style scoped>
/* ═══ 弹窗共用 ═══ */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
}

.modal-panel {
  background: #f4f1eeed; border-radius: 18px;
  width: min(880px, 96vw); max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden; backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal-wide { width: min(900px, 97vw); }

.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
}
.modal-header h3 { font-size: 17px; font-weight: 600; color: var(--text-bright); }

.modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: var(--glass-bg-strong);
  color: var(--text-secondary); font-size: 15px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-bright); }

.modal-body {
  padding: 0px 22px 22px;
  overflow-y: auto; flex: 1;
}

.modal-body-detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-body-detail .preview-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.modal-body-detail .prompt-textarea {
  flex: 1;
  min-height: 0;
  resize: none;
  overflow-y: auto;
  scrollbar-width: auto;
  scrollbar-color: var(--text-secondary) transparent;
}
.modal-body-detail .prompt-textarea::-webkit-scrollbar { width: 10px; }
.modal-body-detail .prompt-textarea::-webkit-scrollbar-track { background: transparent; }
.modal-body-detail .prompt-textarea::-webkit-scrollbar-thumb { background: var(--text-secondary); border-radius: 5px; }
.modal-body-detail .prompt-textarea::-webkit-scrollbar-thumb:hover { background: var(--text-primary); }

.modal-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;align-items: center;
}

/* ═══ Toggle Switch ═══ */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #c5c0ba;
  border-radius: 22px;
  transition: background 0.25s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px; width: 18px;
  left: 2px; bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s;
}
.toggle-switch input:checked + .toggle-slider { background: var(--accent); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(18px); }

/* ═══ 详情编辑 ═══ */
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 4px; }
.fi { width: 100%; padding: 9px 12px; font-size: 13px; border-radius: 8px; background: rgba(255,255,255,0.9); border: 1px solid #d5d0ca; color: var(--text-bright); outline: none; }
.fi:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }

.detail-avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.detail-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 26px; font-weight: 700; flex-shrink: 0;
}
.detail-avatar.clickable { cursor: pointer; transition: opacity 0.15s; }
.detail-avatar.clickable:hover { opacity: 0.85; }

/* ═══ 角色关系区块 ═══ */
.detail-rel-section {
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(224, 123, 108, 0.04);
  border: 1px solid rgba(224, 123, 108, 0.1);
}
.detail-rel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.detail-rel-title { font-size: 13px; font-weight: 700; color: var(--text-bright); display: flex; align-items: center; gap: 6px; }
.detail-rel-btn { display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 8px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.detail-rel-btn.subtle { background: rgba(224, 123, 108, 0.06); border: 1px solid rgba(224, 123, 108, 0.15); color: var(--accent); font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 10px; }
.detail-rel-btn.subtle:hover { background: rgba(224, 123, 108, 0.14); border-color: rgba(224, 123, 108, 0.3); color: #d06a5a; }
.detail-rel-btn.cta { padding: 10px 22px; font-size: 14px; background: var(--accent); color: #fff; box-shadow: 0 2px 12px rgba(224, 123, 108, 0.25); }
.detail-rel-btn.cta:hover { background: var(--accent-hover); box-shadow: 0 4px 18px rgba(224, 123, 108, 0.35); transform: translateY(-1px); }
.detail-rel-btns { display: flex; align-items: center; gap: 6px; }
.detail-rel-ctas { display: flex; align-items: center; gap: 8px; }
.detail-rel-list { display: flex; flex-direction: column; gap: 6px; }
.detail-rel-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.6); font-size: 12px; }
.rel-from, .rel-to { font-weight: 600; color: var(--text-bright); }
.rel-text { color: var(--accent); font-weight: 500; padding: 1px 8px; border-radius: 4px; background: rgba(224, 123, 108, 0.1); }
.detail-rel-more { font-size: 12px; color: var(--accent); font-weight: 500; cursor: pointer; text-align: center; padding: 4px 0; transition: opacity 0.15s; }
.detail-rel-more:hover { opacity: 0.7; }
.detail-rel-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 8px 8px; text-align: center; }
.rel-empty-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; max-width: 360px; }
.rel-empty-spinner { width: 14px; height: 14px; border: 2px solid rgba(224, 123, 108, 0.2); border-top-color: var(--accent); border-radius: 50%; animation: rel-spin 0.6s linear infinite; }
@keyframes rel-spin { to { transform: rotate(360deg); } }

/* ═══ 誓约状态（头像行内） ═══ */
.detail-avatar-oath { display: flex; align-items: center; margin-left: auto; flex-shrink: 0; }
.oath-badge {
  position: relative; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; padding: 4px 14px; border-radius: 20px;
  background: linear-gradient(135deg, rgba(212, 168, 83, 0.18), rgba(212, 168, 83, 0.08));
  border: 1px solid rgba(212, 168, 83, 0.25);
  cursor: pointer; user-select: none; overflow: hidden;
  transition: all 0.25s ease; min-width: 80px; height: 28px;
}
.oath-badge:hover {
  border-color: rgba(200, 80, 70, 0.25);
  background: linear-gradient(135deg, rgba(200, 80, 70, 0.08), rgba(200, 80, 70, 0.03));
}
.oath-badge-default, .oath-badge-hover {
  position: absolute; transition: all 0.25s ease;
  white-space: nowrap; letter-spacing: 0.3px;
}
.oath-badge-default { opacity: 1; transform: translateY(0); color: #a8853a; }
.oath-badge-hover { opacity: 0; transform: translateY(8px); color: rgba(200, 80, 70, 0.6); }
.oath-badge:hover .oath-badge-default { opacity: 0; transform: translateY(-8px); }
.oath-badge:hover .oath-badge-hover { opacity: 1; transform: translateY(0); }

/* ═══ 悬浮侧边栏 ═══ */
.detail-float {
  position: absolute;
  left: calc(50% + min(450px, 48.5vw) + 16px);
  top: 70px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 20px;
}
.float-card {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: 14px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  transition: all 0.15s; width: 220px;
}
.float-card-toggle { justify-content: space-between; gap: 0; }
.float-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
.float-switch { flex-shrink: 0; }
.float-card-btn { cursor: pointer; justify-content: space-between; gap: 0; }
.float-card-btn:hover { border-color: var(--accent); box-shadow: 0 4px 20px rgba(224, 123, 108, 0.12); }
.float-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--bg-muted, #f0f0f0); color: var(--text-secondary); }
.float-badge.active { background: rgba(224, 123, 108, 0.15); color: var(--accent); }

/* ═══ 操作栏 ═══ */
.modal-footer {
  flex-shrink: 0;
  padding: 10px 22px 18px;
  border-top: 1px solid var(--glass-border);
  background: inherit;
}
.detail-actions { display: flex; align-items: center; margin-top: 0; gap: 10px; }
.detail-actions-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.recruit-appearance-hint {
  font-size: 11px;
  color: var(--text-muted, #999);
  white-space: nowrap;
}
.recruit-appearance-hint a {
  color: var(--text-muted, #999);
  text-decoration: underline;
}
.btn-ghost.danger { color: var(--danger); }
.btn-ghost.danger:hover { background: rgba(255, 77, 79, 0.08); }

/* ═══ 弹窗动画 ═══ */
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel { animation: modal-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
@keyframes modal-pop { 0% { transform: scale(0.92); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

/* ═══ 通用 ═══ */
.sp-btn-small { padding: 6px 14px; font-size: 12px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-bg-strong); color: var(--text-primary); cursor: pointer; margin-right: 6px; transition: all 0.15s; }
.sp-btn-small:hover { border-color: var(--accent); }
.sp-btn-subtle { color: var(--text-secondary); border-color: transparent; background: transparent; }
.sp-btn-subtle:hover { color: var(--danger); border-color: transparent; }

.prompt-textarea { min-height: 500px; resize: vertical; font-family: inherit; }

.modal-wide .fi { background: var(--bg-primary); border: 1px solid var(--glass-border); transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.modal-wide .fi:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.1); }
.modal-wide .prompt-textarea { padding: 12px; border-radius: 10px; font-size: 12px; line-height: 1.7; color: var(--text-primary); }

.btn-primary { background: var(--accent); color: white; padding: 8px 20px; border-radius: 10px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; border: none; color: var(--text-secondary); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }

.preview-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px; padding: 18px; }

/* ═══ Lora 设置 ═══ */
.lora-body-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px; padding: 18px; }
.lora-expand-enter-active { transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-expand-leave-active { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-expand-enter-from { opacity: 0; max-height: 0; transform: translateY(-6px); }
.lora-expand-enter-to { opacity: 1; max-height: 180px; transform: translateY(0); }
.lora-expand-leave-from { opacity: 1; max-height: 180px; transform: translateY(0); }
.lora-expand-leave-to { opacity: 0; max-height: 0; transform: translateY(-6px); }
.form-group { margin-bottom: 16px; }
.form-group .fl { display: block; margin-bottom: 6px; }
.form-hint { margin: 4px 0 0; font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
.lora-workflow-select { margin-top: 8px; }
.lora-separator { border-top: 1px solid var(--border); margin: 24px 0 20px; }
.lora-check-label { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.lora-checkbox { position: absolute; opacity: 0; width: 0; height: 0; }
.lora-checkbox-wrap { position: relative; width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.lora-checkmark { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--glass-border); background: var(--bg-primary); display: flex; align-items: center; justify-content: center; transition: all 0.15s; cursor: pointer; }
.lora-checkmark svg { opacity: 0; transform: scale(0.5); transition: all 0.15s; }
.lora-checkbox:checked + .lora-checkmark { background: var(--accent); border-color: var(--accent); }
.lora-checkbox:checked + .lora-checkmark svg { opacity: 1; transform: scale(1); }
.lora-check-text { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.lora-list { display: flex; flex-direction: column; gap: 10px; }
.lora-item-card { position: relative; background: var(--bg-primary); border: 1px solid var(--glass-border); border-radius: 12px; padding: 10px 32px 10px 12px; }
.lora-remove-btn { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; border: none; background: rgba(255, 77, 79, 0.08); color: var(--danger); font-size: 12px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; z-index: 1; padding: 0; }
.lora-remove-btn:hover { background: rgba(255, 77, 79, 0.2); }
.lora-item-row { display: flex; gap: 10px; align-items: flex-end; }
.lora-item-row .form-group, .lora-trigger-row .form-group { margin-bottom: 0; }
.lora-path-group { flex: 2; min-width: 0; }
.lora-autocomplete-wrap { position: relative; }
.lora-dropdown {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  max-height: 220px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e2d6c7;
  border-radius: 8px;
  z-index: 10001;
  list-style: none;
  padding: 4px;
  margin: 0;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  transform-origin: top center;
}
.lora-dropdown-item {
  display: flex; align-items: center;
  padding: 9px 10px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-bright);
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.lora-dropdown-item:hover {
  background: rgba(224,123,108,0.08);
  color: var(--accent);
}
.lora-dropdown-item.active {
  background: rgba(224,123,108,0.06);
  color: var(--accent);
  font-weight: 600;
}
.lora-weight-group { flex: 0 0 72px; }
.lora-inline-label { font-size: 11px; margin-bottom: 3px; }
.lora-item-card .fi { background: var(--glass-bg); }
.lora-weight-input { text-align: center; padding: 9px 4px; }
.lora-trigger-row { margin-top: 8px; }
.lora-trigger-row textarea { resize: vertical; min-height: 60px; width: 100%; }
.lora-card-enter-active, .lora-card-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.lora-card-enter-from, .lora-card-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; border-width: 0; }
.lora-card-enter-to, .lora-card-leave-from { opacity: 1; max-height: 120px; }
.lora-empty-hint { text-align: center; font-size: 13px; color: var(--text-secondary); padding: 20px 0; margin-bottom: 8px; }
.lora-add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px 0; border: 1.5px dashed var(--glass-border); border-radius: 10px; background: transparent; color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; margin: 5px 0; }
.lora-add-btn:hover { border-color: var(--accent); background: rgba(224, 123, 108, 0.05); }

.lora-civitai-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; margin: 0 2px; }
.lora-civitai-link { font-size: 12px; color: var(--accent); text-decoration: none; white-space: nowrap; opacity: 0.85; transition: opacity 0.15s; }
.lora-civitai-link:hover { opacity: 1; text-decoration: underline; }

/* ═══ 移动端 ═══ */
@media (max-width: 767px) {
  .modal-panel, .modal-wide { width: 100vw; max-height: 100vh; max-height: 100dvh; border-radius: 0; }
  .modal-header { padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top, 0px)); }
  .modal-header h3 { font-size: 15px; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; }
  .modal-close { flex-shrink: 0; }
  .modal-body { padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .detail-avatar-row { gap: 10px; margin-bottom: 12px; }
  .detail-avatar { width: 52px; height: 52px; font-size: 22px; }
  .detail-actions { flex-wrap: wrap; gap: 8px; }
  .detail-actions-right { margin-left: 0; flex-wrap: wrap; gap: 8px; }
  .modal-footer { padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px)); }
  .prompt-textarea { min-height: 350px; font-size: 16px; }
  .modal-wide .prompt-textarea { font-size: 16px; }
  .modal-body-detail { overflow-y: auto; }
  .modal-body-detail .preview-card { flex: none; }
  .modal-body-detail .prompt-textarea { flex: none; min-height: 300px; }
  .modal-wide .fi { font-size: 16px; }
  .detail-rel-section { padding: 12px; margin-bottom: 14px; }
  .detail-rel-btn { padding: 5px 10px; font-size: 11px; }

  .mobile-detail-toolbar { display: flex; flex-direction: column; gap: 4px; padding: 8px 0 12px; }
  .toolbar-item { display: flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 8px; background: rgba(224, 123, 108, 0.08); color: var(--accent); font-size: 12px; font-weight: 600; cursor: pointer; justify-content: center; white-space: nowrap; -webkit-tap-highlight-color: transparent; user-select: none; }
  .toolbar-item:active { background: rgba(224, 123, 108, 0.16); }
  .toolbar-item-toggle { cursor: default; justify-content: space-between; background: rgba(0, 0, 0, 0.04); color: var(--text-secondary); font-weight: 500; }
  .toolbar-switch { width: 34px; height: 18px; flex-shrink: 0; }
  .toolbar-switch .toggle-slider::before { height: 14px; width: 14px; }
  .toolbar-switch input:checked + .toggle-slider::before { transform: translateX(16px); }
  .toolbar-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--bg-muted, #f0f0f0); color: var(--text-secondary); flex-shrink: 0; }
  .toolbar-badge.active { background: rgba(224, 123, 108, 0.15); color: var(--accent); }

  .form-group .fl { font-size: 12px; }
  .form-hint { font-size: 10px; }
}
</style>
