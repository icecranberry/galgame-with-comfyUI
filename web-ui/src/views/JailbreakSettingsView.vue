<template>
  <div class="jailbreak-page">
    <header class="page-header">
      <linshe-button class="back" variant="icon" size="lg" aria-label="返回系统设置" @click="router.push('/settings')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </linshe-button>
      <div>
        <h2>破限规则集</h2>
        <p>给模型一段「别拒答」的底稿，并决定它注入哪些对话链路。上游作者的破限词始终排在它前面。</p>
      </div>
      <span class="mode-badge" :class="enabled ? 'on' : 'off'">{{ enabled ? '已启用' : '已停用' }}</span>
    </header>

    <div v-if="loading" class="state-card">正在加载…</div>
    <div v-else-if="loadError" class="state-card error">
      <p>{{ loadError }}</p>
      <linshe-button variant="secondary" @click="load">重新加载</linshe-button>
    </div>

    <template v-else>
      <!-- ① 总开关 + 当前生效摘要：先回答「现在到底在用什么」 -->
      <section class="card overview">
        <div class="overview-main">
          <div>
            <h3>启用破限注入</h3>
            <p>关掉之后，所有 LLM 调用都不会再插入这段底稿（上游作者的破限词不受影响，那是各调用链自己拼的）。</p>
          </div>
          <linshe-switch
            v-model="enabled"
            size="md"
            :on-text="enabled ? '已启用' : ''"
            :off-text="enabled ? '' : '已停用'"
            aria-label="启用破限注入"
            @change="toggleEnabled"
          />
        </div>
        <div class="effective">
          <span class="effective-label">当前生效</span>
          <strong>{{ activeRuleName || '—' }}</strong>
          <span class="effective-meta">{{ sourceLabel }} · {{ contentLength }} 字</span>
        </div>
      </section>

      <!-- ② 注入范围：哪些调用链要注入 -->
      <section class="card">
        <div class="section-title">
          <div>
            <h3>注入范围</h3>
            <p>只在这些链路上插入。全部关掉等于不注入（但总开关别关，方便下次一键恢复）。</p>
          </div>
          <div class="section-actions">
            <linshe-button variant="ghost" size="sm" @click="applyAllTargets(true)">全选</linshe-button>
            <linshe-button variant="ghost" size="sm" @click="applyAllTargets(false)">全不选</linshe-button>
          </div>
        </div>
        <div class="target-grid">
          <div v-for="key in availableTargets" :key="key" class="target-item">
            <linshe-switch
              :model-value="targets.includes(key)"
              size="sm"
              :aria-label="targetLabels[key] || key"
              @change="value => toggleTarget(key, value)"
            />
            <span class="target-name">{{ targetLabels[key] || key }}</span>
            <code class="target-key">{{ key }}</code>
          </div>
        </div>
      </section>

      <!-- ③ 规则集列表 + 编辑器 -->
      <section class="card">
        <div class="section-title">
          <div>
            <h3>规则集</h3>
            <p>可以存多套底稿随时切换；内置的三套不可删除，内置项也不改内容（想改就复制一份）。</p>
          </div>
          <linshe-button variant="secondary" size="sm" :disabled="busy" @click="createNew">新建</linshe-button>
        </div>

        <ul class="rule-list">
          <li
            v-for="rule in rules"
            :key="rule.id"
            class="rule-row"
            :class="{ selected: rule.id === selectedId, active: rule.id === activeId }"
            role="button"
            tabindex="0"
            @click="selectRule(rule.id)"
            @keydown.enter.prevent="selectRule(rule.id)"
            @keydown.space.prevent="selectRule(rule.id)"
          >
            <div class="rule-main">
              <span class="rule-name">{{ rule.name }}</span>
              <span v-if="rule.builtin" class="tag builtin">内置</span>
              <span v-if="rule.id === activeId" class="tag live">使用中</span>
              <span v-if="!rule.targets || rule.targets.length === 0" class="tag muted">不投递</span>
            </div>
            <div class="rule-actions" @click.stop>
              <linshe-button
                v-if="rule.id !== activeId"
                variant="ghost"
                size="sm"
                :disabled="busy"
                @click="activate(rule.id)"
              >设为使用</linshe-button>
              <linshe-button
                v-if="!rule.builtin"
                variant="danger"
                size="sm"
                :disabled="busy"
                @click="askDelete(rule)"
              >删除</linshe-button>
            </div>
          </li>
        </ul>

        <!-- 编辑器 -->
        <div v-if="draft" class="editor">
          <div class="editor-head">
            <h4>{{ isNewDraft ? '新建规则集' : '编辑规则集' }}</h4>
            <span v-if="draftBuiltin" class="editor-note">内置规则集：只能改名称与投递范围，正文请复制一份再改</span>
          </div>

          <label class="field">
            <span>名称</span>
            <linshe-input v-model.trim="draft.name" :maxlength="64" placeholder="给这套规则起个名字" />
          </label>

          <label class="field">
            <span>正文</span>
            <linshe-input
              v-model="draft.content"
              type="textarea"
              :rows="12"
              :disabled="draftBuiltin"
              placeholder="支持 {{cwd}} 这类插值点；其它花括号会被自动拆开以免被模板引擎吃掉"
            />
          </label>

          <div class="editor-tools">
            <linshe-button
              v-if="draftBuiltin && !isNewDraft"
              variant="ghost"
              size="sm"
              :disabled="busy"
              @click="copyToNew"
            >复制一份再改</linshe-button>
            <linshe-button
              variant="ghost"
              size="sm"
              :disabled="busy || draftBuiltin"
              @click="resetDraftContent"
            >恢复默认正文</linshe-button>
          </div>

          <div class="editor-foot">
            <linshe-button variant="primary" :loading="busy" @click="saveDraft">保存</linshe-button>
            <linshe-button variant="ghost" :disabled="busy" @click="cancelDraft">取消</linshe-button>
            <span v-if="draftBytes > limits.maxRuleBytes" class="warn">
              正文 {{ Math.round(draftBytes / 1024) }} KB，超过单套上限 {{ Math.round(limits.maxRuleBytes / 1024) }} KB 会被截断
            </span>
          </div>
        </div>
      </section>
    </template>

    <!-- 删除 / 恢复默认的确认 -->
    <linshe-modal v-model="confirmOpen" :title="confirmTitle" width="sm">
      <p class="confirm-text">{{ confirmText }}</p>
      <template #footer>
        <linshe-button variant="ghost" :disabled="busy" @click="confirmOpen = false">取消</linshe-button>
        <linshe-button :variant="confirmDanger ? 'danger' : 'primary'" :loading="busy" @click="runConfirm">
          {{ confirmActionLabel }}
        </linshe-button>
      </template>
    </linshe-modal>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import LinsheSwitch from '../components/ui/LinsheSwitch.vue'
import {
  getJailbreakRules,
  createJailbreakRule,
  updateJailbreakRule,
  deleteJailbreakRule,
  activateJailbreakRule,
  setJailbreakTargets,
  getJailbreak,
  updateJailbreak,
} from '../api/index.js'
// 纯逻辑抽到独立模块：本仓没有组件挂载能力（无 @vue/test-utils / jsdom），
// 拆出来才能被单测直接跑。"范围勾选是集合运算""草稿 targets 是副本"
// 这两条最容易出隐错，必须有单测盯着。
import {
  pickRule,
  newDraft,
  copyToNewDraft,
  toggleTargetIn,
  setAllTargets,
  cancelPick,
  isBuiltinRule,
  draftByteLength,
} from '../utils/jailbreakRuleDraft.js'

const router = useRouter()
// toast 走 App 提供的注入（与 SettingsView 同口径：toastFn(message, type)）。
// 本仓只有这一个 toast 入口，不自造 composable。
const toastFn = inject('toast', null)
function notify(message, type = 'info') {
  toastFn?.(message, type)
}

const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const enabled = ref(true)

const rules = ref([])
const activeId = ref('')
const activeRuleName = ref('')
const sourceLabel = ref('')
const contentLength = ref(0)

const availableTargets = ref([])
const targetLabels = ref({})
const targets = ref([])
const limits = reactive({ maxRuleBytes: 64 * 1024, maxRulesBytes: 256 * 1024, maxNameLength: 64 })

const selectedId = ref('')
const draft = ref(null)
const isNewDraft = ref(false)
const draftBuiltin = computed(() => {
  if (isNewDraft.value) return false
  return isBuiltinRule(rules.value, selectedId.value)
})

const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmText = ref('')
const confirmActionLabel = ref('确认')
const confirmDanger = ref(false)
let confirmHandler = null

const draftBytes = computed(() => {
  // 与后端 Buffer.byteLength(..., 'utf8') 同口径：中文按 3 字节算，别用 .length
  return draftByteLength(draft.value?.content)
})

const SOURCE_TEXT = {
  default: '代码默认正文',
  db: '旧版单份正文（jailbreak_prompt）',
  rule: '规则集自带正文',
}

function selectRule(id) {
  const { id: pickedId, draft: picked } = pickRule(rules.value, id)
  selectedId.value = pickedId
  isNewDraft.value = false
  draft.value = picked
}

function createNew() {
  isNewDraft.value = true
  selectedId.value = ''
  draft.value = newDraft(availableTargets.value).draft
}

function cancelDraft() {
  const { id: pickedId, draft: picked } = cancelPick(rules.value, isNewDraft.value, selectedId.value)
  selectedId.value = pickedId
  isNewDraft.value = false
  draft.value = picked
}

function resetDraftContent() {
  if (!draft.value) return
  askConfirm({
    title: '恢复默认正文',
    text: '把编辑器里的正文清空？保存后这套规则集会回落到代码自带的默认底稿。',
    actionLabel: '恢复默认',
    danger: false,
    onConfirm: () => { draft.value.content = '' },
  })
}

function copyToNew() {
  if (!draft.value) return
  const { id: pickedId, draft: picked } = copyToNewDraft(draft.value)
  isNewDraft.value = true
  selectedId.value = pickedId
  draft.value = picked
}

function askDelete(rule) {
  askConfirm({
    title: '删除规则集',
    text: `确定删除「${rule.name}」？删掉之后无法恢复。`,
    actionLabel: '删除',
    danger: true,
    onConfirm: async () => {
      await deleteJailbreakRule(rule.id)
      notify('已删除', 'success')
      await load()
      if (!selectedId.value && rules.value[0]) selectRule(rules.value[0].id)
    },
  })
}

function askConfirm({ title, text, actionLabel, danger, onConfirm }) {
  confirmTitle.value = title
  confirmText.value = text
  confirmActionLabel.value = actionLabel
  confirmDanger.value = danger
  confirmHandler = onConfirm
  confirmOpen.value = true
}

async function runConfirm() {
  const handler = confirmHandler
  confirmHandler = null
  confirmOpen.value = false
  if (!handler) return
  busy.value = true
  try {
    await handler()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [rulesRes, flag] = await Promise.all([getJailbreakRules(), getJailbreak()])
    rules.value = rulesRes.rules || []
    activeId.value = rulesRes.activeId || ''
    activeRuleName.value = rulesRes.active?.name || ''
    sourceLabel.value = SOURCE_TEXT[rulesRes.active?.source] || rulesRes.active?.source || ''
    contentLength.value = (rulesRes.active?.content || '').length
    availableTargets.value = rulesRes.availableTargets || []
    targetLabels.value = rulesRes.targetLabels || {}
    targets.value = rulesRes.targets || []
    if (rulesRes.limits) Object.assign(limits, rulesRes.limits)
    enabled.value = flag.enabled !== false

    // 默认选中「当前使用中」那套，比选中列表第一套更符合直觉
    const initial = rules.value.find(r => r.id === activeId.value) || rules.value[0]
    if (initial) selectRule(initial.id)
  } catch (err) {
    loadError.value = err.message
  } finally {
    loading.value = false
  }
}

async function toggleEnabled(value) {
  busy.value = true
  try {
    await updateJailbreak({ enabled: value === true })
  } catch (err) {
    enabled.value = !value
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

async function toggleTarget(key, value) {
  // 集合运算走模块（取消一个不影响其余八个；全取消 = 空数组，不回填）
  const next = toggleTargetIn(targets.value, key, value)
  const previous = [...targets.value]
  targets.value = next
  busy.value = true
  try {
    const res = await setJailbreakTargets(next)
    targets.value = res.targets || next
  } catch (err) {
    targets.value = previous
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

/** 全选/全不选：走模块的 setAllTargets 保持口径一致 */
async function applyAllTargets(on) {
  busy.value = true
  try {
    const res = await setJailbreakTargets(setAllTargets(availableTargets.value, on))
    targets.value = res.targets || []
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

async function activate(id) {
  busy.value = true
  try {
    await activateJailbreakRule(id)
    notify('已切换', 'success')
    await load()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

async function saveDraft() {
  if (!draft.value) return
  const name = String(draft.value.name || '').trim()
  if (!name) {
    notify('请先填名称', 'error')
    return
  }
  busy.value = true
  try {
    if (isNewDraft.value) {
      const res = await createJailbreakRule({ name, content: draft.value.content, targets: draft.value.targets })
      notify('已新建', 'success')
      isNewDraft.value = false
      await load()
      if (res.rule?.id) selectRule(res.rule.id)
    } else {
      await updateJailbreakRule(selectedId.value, { name, content: draft.value.content, targets: draft.value.targets })
      notify('已保存', 'success')
      await load()
      selectRule(selectedId.value)
    }
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.jailbreak-page { flex: 1; height: 100vh; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }
.page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 4px; font-size: 24px; }
.page-header p, .card p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.page-header .back { flex-shrink: 0; }
.mode-badge { margin-left: auto; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.mode-badge.on { background: rgba(var(--accent-rgb), .16); color: var(--accent); }
.mode-badge.off { background: rgba(120, 120, 120, .16); color: var(--text-secondary); }
.card, .state-card {
  background: var(--glass-bg); backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border); border-radius: 16px; padding: 22px;
  box-shadow: var(--glass-shadow); margin-bottom: 16px;
}
.state-card { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.state-card.error { border-color: rgba(200, 80, 80, .4); }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.card h4 { margin: 0; font-size: 14px; }
.overview-main { display: flex; align-items: flex-start; gap: 18px; }
.overview-main > div { flex: 1; }
.effective { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--glass-border); }
.effective-label { color: var(--text-secondary); font-size: 12px; }
.effective strong { font-size: 14px; }
.effective-meta { color: var(--text-secondary); font-size: 12px; }
.section-title { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
.section-title > div:first-child { flex: 1; }
.section-actions { display: flex; gap: 6px; flex-shrink: 0; }
.target-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 18px; }
.target-item { display: flex; align-items: center; gap: 8px; }
.target-name { font-size: 13px; }
.target-key { color: var(--text-secondary); font-size: 11px; opacity: .7; }
.rule-list { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rule-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border: 1px solid var(--glass-border); border-radius: 12px; cursor: pointer;
  transition: border-color .3s ease, background .3s ease;
}
.rule-row:hover { background: rgba(var(--accent-rgb), .06); }
.rule-row.selected { border-color: rgba(var(--accent-rgb), .5); background: rgba(var(--accent-rgb), .08); }
.rule-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rule-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; text-align: left; }
.rule-name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rule-actions { display: flex; gap: 6px; flex-shrink: 0; }
.tag { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.tag.builtin { background: rgba(120, 120, 120, .16); color: var(--text-secondary); }
.tag.live { background: rgba(var(--accent-rgb), .18); color: var(--accent); }
.tag.muted { background: rgba(200, 140, 60, .18); color: #b07a2a; }
.editor { border-top: 1px solid var(--glass-border); padding-top: 18px; }
.editor-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.editor-note { color: var(--text-secondary); font-size: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field > span { color: var(--text-secondary); font-size: 12px; }
.editor-tools { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.editor-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.warn { color: #b07a2a; font-size: 12px; }
.confirm-text { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.7; }
@media (max-width: 720px) {
  .jailbreak-page { padding: 18px; }
  .overview-main { flex-direction: column; gap: 12px; }
  .rule-row { flex-wrap: wrap; }
  .rule-actions { width: 100%; justify-content: flex-end; }
}
</style>
