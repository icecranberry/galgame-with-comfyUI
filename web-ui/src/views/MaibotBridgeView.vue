<template>
    <div class="maibot-page">
    <header class="page-header">
      <button class="back" aria-label="返回系统设置" @click="router.push('/settings')">‹</button>
      <div>
        <h2>MaiBot 桥接</h2>
        <p>管理注入到 MaiBot 主聊天流的人格信息（角色卡 / 风格 / 记忆）与全部插件参数。</p>
      </div>
    </header>

    <div class="settings-grid">
      <!-- ① 连接设置 -->
      <section class="card">
        <h3>连接设置</h3>
        <label class="fl" for="webui-token">MaiBot WebUI Token</label>
        <div class="token-field">
          <input
            id="webui-token"
            v-model.trim="webuiToken"
            :type="showWebuiToken ? 'text' : 'password'"
            class="fi token-input"
            placeholder="填写 MaiBot WebUI 的访问 Token"
            @change="saveSettings"
            @keyup.enter="saveSettings"
          >
          <button
            type="button"
            class="token-toggle"
            :aria-label="showWebuiToken ? '隐藏 Token' : '显示 Token'"
            :title="showWebuiToken ? '隐藏 Token' : '显示 Token'"
            @click="showWebuiToken = !showWebuiToken"
          >
            <svg v-if="showWebuiToken" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <div class="admin-links">
          <span class="admin-links-title">后台入口</span>
          <div class="admin-links-grid">
            <a class="admin-link" href="http://127.0.0.1:8001/" target="_blank" rel="noopener">
              <span class="admin-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 6h16v14H4zM9 3h6M10 3v3M14 3v3M7 11h2M7 14h4M15 11h2M15 14h2"/></svg>
              </span>
              <span class="admin-link-copy">
                <span class="admin-link-name">MaiBot 后台</span>
                <span class="admin-link-meta">
                  <span class="admin-link-tag">QQ 机器人</span>
                  <span class="admin-link-token">默认 Token：<b>MaiBot.admin</b></span>
                  <span class="admin-link-url">127.0.0.1:8001</span>
                </span>
              </span>
              <span class="admin-link-open">打开<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
            </a>
            <a class="admin-link" href="http://127.0.0.1:5099/" target="_blank" rel="noopener">
              <span class="admin-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 6h16v14H4zM9 3h6M10 3v3M14 3v3M7 11h2M7 14h4M15 11h2M15 14h2"/></svg>
              </span>
              <span class="admin-link-copy">
                <span class="admin-link-name">Snowluma 后台</span>
                <span class="admin-link-meta">
                  <span class="admin-link-tag">消息接收器</span>
                  <span class="admin-link-token">默认 Token：<b>Snowluma.admin</b></span>
                  <span class="admin-link-url">127.0.0.1:5099</span>
                </span>
              </span>
              <span class="admin-link-open">打开<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
            </a>
          </div>
        </div>
      </section>

      <!-- ② 插件配置 -->
      <section class="card plugin-config-card">
        <h3>插件配置</h3>
        <label class="memory-check">
          <input type="checkbox" v-model="memoryCuration" @change="savePluginConfig">
          <span class="memory-check-box" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
          </span>
          <span class="memory-check-copy">
            <span class="memory-check-title">启用对话记忆摘要（同步回邻舍）</span>
            <span class="memory-check-desc">每 40 句真实聊天内容整理一份摘要，注入 MaiBot 主聊天流历史，并同步回邻舍；关闭后不再整理，并删除已保存的记忆摘要。</span>
          </span>
        </label>

        <label class="fl" for="character-select">注入角色</label>
        <DropdownSelect
          id="character-select"
          v-model="characterName"
          class="mb-select"
          :options="characterOptions"
          searchable
          placeholder="（未选择角色）"
          @update:model-value="onCharacterChange"
        />        <p class="fd hint-line">人格注入与行为 / 表达风格提炼为<b>始终开启</b>：每次回复都会把 system 人格整条替换为所选角色的人格，并由 LLM 依据人格生成行为风格与表达风格一并注入请求，<b>覆盖</b>麦麦设置里的「行为风格」与「表达风格」。</p>

        <label class="fl" for="image-mode-select">配图模式</label>
        <DropdownSelect
          id="image-mode-select"
          v-model="imageMode"
          class="mb-select"
          :options="imageModeOptions"
          @update:model-value="onImageModeChange"
        />

        <details class="advanced">
          <summary>高级参数</summary>
          <div class="advanced-body">
            <label class="fl" for="context-max-messages">传给邻舍判断/生图的上下文条数（默认 2）</label>
            <input id="context-max-messages" v-model.number="contextMaxMessages" type="number" class="fi" min="1" step="1" @change="savePluginConfig">
            <label class="fl" for="poll-interval">生图任务轮询间隔（秒）</label>
            <input id="poll-interval" v-model.number="pollInterval" type="number" class="fi" min="0.5" step="0.5" @change="savePluginConfig">
            <label class="fl" for="poll-timeout">生图任务轮询超时（秒）</label>
            <input id="poll-timeout" v-model.number="pollTimeout" type="number" class="fi" min="10" step="10" @change="savePluginConfig">
          </div>
        </details>
      </section>

      <!-- ③ 人格信息 -->
      <section class="card card-full">
      <h3>人格信息</h3>
      <div class="warn-box">
        <p class="warn-title">⚠ 人格覆盖提示</p>
        <p class="fd">启用桥接后，所选角色的 <b>人格卡片</b> 将<b>整条临时覆盖</b> MaiBot 当前 system 人格（覆盖MaiBot设置里的「人格设定」）；提炼的<b>行为风格 / 表达风格</b>也会作为请求指令注入，<b>覆盖</b>麦麦设置里的「行为风格」与「表达风格」。<b>不改变MaiBot原有人格，仅做临时替换</b></p>
      </div>
      <p class="fd hint-line">以下三项数据保存在插件本地，不写入邻舍数据库，按角色独立；修改后点「保存」立即生效，点「重新提炼风格」会依据当前 base_prompt 重新生成行为/表达风格并保存；切换角色时若该角色还没有行为/表达风格，会自动提炼并保存。</p>

      <div class="persona-grid">
        <div class="persona-main">
          <label class="fl" for="base-prompt-input">人格卡片</label>
          <textarea id="base-prompt-input" v-model="basePromptInput" class="fi persona-textarea" rows="22"></textarea>
        </div>
        <div class="persona-side">
          <label class="fl" for="behavior-style-input">行为风格</label>
          <textarea id="behavior-style-input" v-model="behaviorStyleInput" class="fi persona-textarea-sm" rows="6"></textarea>
          <label class="fl" for="reply-style-input">表达风格</label>
          <textarea id="reply-style-input" v-model="replyStyleInput" class="fi persona-textarea-sm" rows="6"></textarea>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-ghost" :disabled="refreshingPersona || autoDeriving" @click="refreshPersona">{{ refreshingPersona ? '更新中…' : '更新人格' }}</button>
        <button class="btn-primary" :disabled="deriving || autoDeriving" @click="derive">{{ deriving ? '提炼中…' : '重新提炼风格' }}</button>
        <button class="btn-primary" :disabled="savingPersona || autoDeriving" @click="savePersona">{{ savingPersona ? '保存中…' : '保存' }}</button>
      </div>
      </section>

      <!-- ④ 最新记忆整理 -->
      <section class="card card-full">
      <h3>最新记忆整理</h3>
      <p class="fd hint-line">只保留一份最新记忆，插件注入时也只带回去这一条；这里直接展示最近更新的一份，无需手动查询。</p>
      <div class="memory-box" :class="{ empty: !memoryContent }">{{ memoryContent || '（暂无记忆整理）' }}</div>
      <div class="card-actions">
        <button class="btn-danger" :disabled="!latestMemorySessionId || deletingMemory" @click="deleteMemory">{{ deletingMemory ? '删除中…' : '删除该记忆摘要' }}</button>
      </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DropdownSelect from '../components/DropdownSelect.vue'
import {
  maibotDeleteLatestMemory,
  maibotDeriveStyle,
  maibotGetLatestMemory,
  maibotGetPluginConfig,
  maibotGetPluginPersona,
  maibotGetWebuiSettings,
  maibotListCharacters,
  maibotSaveWebuiSettings,
  maibotUpdatePluginConfig,
  maibotUpdatePluginPersona,
} from '../api/index.js'

const router = useRouter()
const toast = inject('toast', null)
function notify(text, type = 'success') { toast?.(text, type) }
const showInstallGuide = inject('showInstallGuide', null)
let installGuideShown = false
function promptInstallGuide() {
  if (installGuideShown) return
  installGuideShown = true
  showInstallGuide?.()
}

// ── 连接设置 ──
const webuiToken = ref('MaiBot.admin')
const showWebuiToken = ref(false)
const savingSettings = ref(false)

// ── 插件配置 ──
const baseUrl = ref('http://127.0.0.1:3099')
const characterName = ref('')
const memoryCuration = ref(false)
const imageMode = ref('auto')
const contextMaxMessages = ref(2)
const pollInterval = ref(2)
const pollTimeout = ref(180)
const imageModeOptions = [
  { value: 'auto', label: 'auto（由邻舍判断）' },
  { value: 'off', label: 'off（关闭配图）' },
  { value: 'always', label: 'always（总是配图）' },
]

// ── 角色与人格 ──
const characters = ref([])
const characterOptions = computed(() => characters.value.map(c => ({ value: c.name, label: c.display_name || c.name })))
const personaData = ref({ characters: {} })
const basePromptInput = ref('')
const behaviorStyleInput = ref('')
const replyStyleInput = ref('')
const deriving = ref(false)
const savingPersona = ref(false)
const refreshingPersona = ref(false)
const autoDeriveInFlight = new Set()
const autoDeriving = computed(() => autoDeriveInFlight.size > 0)

// ── 记忆 ──
const latestMemorySessionId = ref(null)
const memoryContent = ref('')
const deletingMemory = ref(false)

function selectedCharacter() {
  return characters.value.find(c => c.name === characterName.value) || null
}

function currentPersonaEntry() {
  const char = selectedCharacter()
  if (!char) return null
  return (personaData.value.characters || {})[char.name] || {}
}

function effectiveBasePrompt() {
  const char = selectedCharacter()
  if (!char) return ''
  const entry = (personaData.value.characters || {})[char.name] || {}
  return (entry.base_prompt || '').trim() || char.base_prompt || ''
}

function renderSavedStyles() {
  const char = selectedCharacter()
  if (!char) return
  const entry = currentPersonaEntry() || {}
  basePromptInput.value = (entry.base_prompt || '').trim() || char.base_prompt || ''
  behaviorStyleInput.value = (entry.behavior_style || '').trim()
  replyStyleInput.value = (entry.reply_style || '').trim()
}

async function loadConfig() {
  const data = await maibotGetPluginConfig()
  const pluginConfig = data.config || {}
  const bridge = pluginConfig.bridge || {}
  const memory = pluginConfig.memory || {}
  const image = pluginConfig.image || {}
  baseUrl.value = bridge.base_url || 'http://127.0.0.1:3099'
  const charName = bridge.character_name || ''
  if (charName) {
    const byCharacter = characters.value.find(c => c.name === charName || c.display_name === charName)
    characterName.value = byCharacter ? byCharacter.name : ''
  }
  memoryCuration.value = memory.memory_curation === true
  if (image.image_mode) imageMode.value = image.image_mode
  contextMaxMessages.value = image.context_max_messages ?? 2
  pollInterval.value = image.poll_interval_sec ?? 2
  pollTimeout.value = image.poll_timeout_sec ?? 180
}

async function loadPersona() {
  try {
    const data = await maibotGetPluginPersona()
    personaData.value = (data && data.characters) ? { characters: data.characters } : { characters: {} }
    renderSavedStyles()
    return true
  } catch (err) {
    notify('读取插件本地人格数据失败: ' + err.message, 'error')
    renderSavedStyles()
    return false
  }
}

async function loadAll() {
  try {
    const settings = await maibotGetWebuiSettings()
    webuiToken.value = settings.token || 'MaiBot.admin'
  } catch (err) {
    notify('读取连接设置失败: ' + err.message, 'error')
    promptInstallGuide()
  }

  try {
    const chars = await maibotListCharacters()
    characters.value = chars.characters || []
    // 角色列表按显示名称首字母（拼音）排序
    const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' })
    characters.value.sort((a, b) => collator.compare(a.display_name || a.name, b.display_name || b.name))
  } catch (err) {
    notify('读取邻舍角色失败: ' + err.message, 'error')
    promptInstallGuide()
  }

  try {
    await loadConfig()
  } catch (err) {
    notify('读取插件配置失败: ' + err.message + '（请先配置连接设置）', 'error')
    promptInstallGuide()
  }

  const personaLoaded = await loadPersona()
  if (!personaLoaded) promptInstallGuide()
  if (personaLoaded) maybeAutoDerive()

  await loadLatestMemory()
}

// ── 连接设置操作 ──
async function saveSettings() {
  savingSettings.value = true
  try {
    await maibotSaveWebuiSettings(webuiToken.value.trim())
    notify('连接设置已保存')
  } catch (err) { notify('保存失败: ' + err.message, 'error') }
  finally { savingSettings.value = false }
}


// ── 插件配置改动即存：任一字段变化时直接 PUT，成功后不提示，失败时 Toast 展示错误 ──
let pluginConfigSaving = false
let pluginConfigSaveAgain = false
function buildPluginConfigBody() {
  return {
    config: {
      plugin: { enabled: true },
      bridge: {
        base_url: baseUrl.value.trim() || 'http://127.0.0.1:3099',
        character_name: characterName.value,
      },
      memory: { memory_curation: memoryCuration.value },
      image: {
        image_mode: imageMode.value,
        context_max_messages: Math.max(Number(contextMaxMessages.value) || 2, 1),
        poll_interval_sec: Math.max(Number(pollInterval.value) || 2, 0.5),
        poll_timeout_sec: Math.max(Number(pollTimeout.value) || 180, 10),
      },
    },
  }
}
async function savePluginConfig() {
  if (pluginConfigSaving) { pluginConfigSaveAgain = true; return }
  pluginConfigSaving = true
  try {
    // maibotUpdatePluginConfig 负责外层 { config: ... } 包裹，这里只传内部配置对象
    await maibotUpdatePluginConfig(buildPluginConfigBody().config)
  } catch (err) {
    notify('插件配置保存失败: ' + err.message, 'error')
  } finally {
    pluginConfigSaving = false
    if (pluginConfigSaveAgain) { pluginConfigSaveAgain = false; savePluginConfig() }
  }
}

function onCharacterChange(value) {
  // 显式 @update:model-value 可能先于 v-model 赋值执行，用事件值同步状态再保存
  if (value !== undefined) characterName.value = value
  savePluginConfig()
  renderSavedStyles()
  // 切换角色后重新拉取插件本地数据，展示该角色已保存/提炼的最新内容
  loadPersona().then((loaded) => {
    if (loaded) maybeAutoDerive()
  })
}

function onImageModeChange(value) {
  if (value !== undefined) imageMode.value = value
  savePluginConfig()
}

// ── 人格保存 / 提炼 ──
async function savePersonaToStore(characterName, entry) {
  const payload = { character_name: characterName }
  if (entry.base_prompt !== undefined) payload.base_prompt = entry.base_prompt
  if (entry.behavior_style !== undefined) payload.behavior_style = entry.behavior_style
  if (entry.reply_style !== undefined) payload.reply_style = entry.reply_style
  await maibotUpdatePluginPersona(payload)
  if (!personaData.value.characters) personaData.value.characters = {}
  const existing = personaData.value.characters[characterName] || {}
  personaData.value.characters[characterName] = { ...existing, ...entry }
}

// 提炼并保存：调用邻舍 derive-style 生成行为/表达风格，并写入插件本地 persona_store.json
async function deriveAndSave(characterName, basePrompt) {
  const data = await maibotDeriveStyle(basePrompt)
  const entry = {
    base_prompt: basePrompt.trim(),
    behavior_style: data.behavior_style || '',
    reply_style: data.reply_style || '',
  }
  await savePersonaToStore(characterName, entry)
  return entry
}

async function derive() {
  const char = selectedCharacter()
  const base = effectiveBasePrompt()
  if (!base) { notify('没有可提炼的 base_prompt', 'error'); return }
  notify('正在提炼行为 / 表达风格…', 'info')
  const prevBehavior = behaviorStyleInput.value
  const prevReply = replyStyleInput.value
  behaviorStyleInput.value = '正在提炼行为风格…'
  replyStyleInput.value = '正在提炼表达风格…'
  deriving.value = true
  try {
    const entry = await deriveAndSave(char.name, basePromptInput.value.trim() || base)
    if (selectedCharacter() && selectedCharacter().name === char.name) {
      behaviorStyleInput.value = entry.behavior_style
      replyStyleInput.value = entry.reply_style
    }
    notify('已重新提炼并保存到插件本地')
  } catch (err) {
    if (selectedCharacter() && selectedCharacter().name === char.name) {
      behaviorStyleInput.value = prevBehavior
      replyStyleInput.value = prevReply
    }
    notify('提炼失败: ' + err.message, 'error')
  } finally { deriving.value = false }
}

// 自动提炼：切换/选中角色时，若缺少行为/表达风格，自动依据 base_prompt 提炼并保存
async function maybeAutoDerive() {
  const char = selectedCharacter()
  if (!char) return
  const base = effectiveBasePrompt()
  if (!base) return
  const entry = (personaData.value.characters || {})[char.name] || {}
  if ((entry.behavior_style || '').trim() && (entry.reply_style || '').trim()) return
  if (autoDeriveInFlight.has(char.name)) return
  autoDeriveInFlight.add(char.name)
  const isCurrent = () => selectedCharacter() && selectedCharacter().name === char.name
  const prevBehavior = behaviorStyleInput.value
  const prevReply = replyStyleInput.value
  if (isCurrent()) {
    behaviorStyleInput.value = '正在自动提炼行为风格…'
    replyStyleInput.value = '正在自动提炼表达风格…'
  }
  notify('正在为「' + (char.display_name || char.name) + '」自动提炼行为 / 表达风格…', 'info')
  try {
    const derived = await deriveAndSave(char.name, base)
    if (isCurrent()) {
      behaviorStyleInput.value = derived.behavior_style
      replyStyleInput.value = derived.reply_style
      notify('已自动提炼并保存到插件本地')
    }
  } catch (err) {
    if (isCurrent()) {
      behaviorStyleInput.value = prevBehavior
      replyStyleInput.value = prevReply
    }
    notify('自动提炼失败: ' + err.message, 'error')
  } finally {
    autoDeriveInFlight.delete(char.name)
  }
}

async function savePersona() {
  const char = selectedCharacter()
  if (!char) { notify('请先选择角色', 'error'); return }
  if (autoDeriveInFlight.has(char.name)) { notify('该角色正在自动提炼中，请稍候再保存', 'error'); return }
  savingPersona.value = true
  try {
    const entry = {
      base_prompt: basePromptInput.value.trim(),
      behavior_style: behaviorStyleInput.value.trim(),
      reply_style: replyStyleInput.value.trim(),
    }
    await savePersonaToStore(char.name, entry)
    renderSavedStyles()
    notify('已保存到插件本地（persona_store.json）')
  } catch (err) { notify('保存失败: ' + err.message, 'error') }
  finally { savingPersona.value = false }
}

// 重新拉取人格：用邻舍角色库里的最新 base_prompt 覆盖插件本地副本
async function refreshPersona() {
  const char = selectedCharacter()
  if (!char) { notify('请先选择角色', 'error'); return }
  if (autoDeriveInFlight.has(char.name)) { notify('该角色正在自动提炼中，请稍候再更新人格', 'error'); return }
  refreshingPersona.value = true
  notify('正在从邻舍重新拉取人格…', 'info')
  try {
    const chars = await maibotListCharacters()
    const fresh = (chars.characters || []).find(c => c.name === char.name)
    if (!fresh) { notify('邻舍角色库中找不到该角色', 'error'); return }
    const basePrompt = (fresh.base_prompt || '').trim()
    if (!basePrompt) { notify('邻舍角色库中没有可用的 base_prompt', 'error'); return }
    await savePersonaToStore(char.name, { base_prompt: basePrompt })
    const index = characters.value.findIndex(c => c.name === char.name)
    if (index >= 0) characters.value[index] = fresh; else characters.value.push(fresh)
    await loadPersona()
    notify('已重新拉取并保存人格（persona_store.json）')
  } catch (err) {
    notify('更新人格失败: ' + err.message, 'error')
  } finally { refreshingPersona.value = false }
}

// ── 最新记忆整理 ──
async function loadLatestMemory() {
  try {
    const data = await maibotGetLatestMemory()
    latestMemorySessionId.value = data.session_id || null
    memoryContent.value = data.content
      ? data.content + '\n\n（更新于 ' + (data.updated_at || '-') + '）'
      : ''
  } catch (err) { notify('读取最新记忆失败: ' + err.message, 'error') }
}

async function deleteMemory() {
  if (!latestMemorySessionId.value) { notify('当前没有可删除的记忆摘要', 'error'); return }
  deletingMemory.value = true
  try {
    const data = await maibotDeleteLatestMemory(latestMemorySessionId.value)
    notify('已删除 ' + data.deleted + ' 条记忆摘要')
    await loadLatestMemory()
  } catch (err) { notify('删除失败: ' + err.message, 'error') }
  finally { deletingMemory.value = false }
}

onMounted(loadAll)
</script>

<style scoped>
.maibot-page { flex: 1; height: 100vh; height: 100dvh; overflow-y: auto; padding: 32px; color: var(--text-bright); }

.page-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.page-header h2 { margin: 0 0 4px; font-size: 24px; }
.page-header p, .card p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.back {
  width: 38px; height: 38px; flex-shrink: 0;
  border: 1px solid var(--glass-border); border-radius: 12px;
  background: var(--glass-bg); color: var(--text-bright);
  font-size: 28px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0;
}

.settings-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; width: 100%; }
.card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--glass-shadow);
  display: flex;
  flex-direction: column;
}
.card-full { grid-column: 1 / -1; }
.plugin-config-card { position: relative; z-index: 30; }
.card h3 { font-size: 15px; color: var(--text-bright); margin-bottom: 12px; font-weight: 600; }

.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 6px; }
.fd { font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.fd b { color: var(--accent); font-weight: 600; }
.hint-line { margin-top: 10px; }

.fi {
  width: 100%; padding: 9px 12px; font-size: 13px; margin-bottom: 14px;
  border-radius: 8px; background: rgba(255, 255, 255, 0.9);
  border: 1px solid #e2d6c7; color: var(--text-bright); outline: none;
}
.fi:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }
textarea.fi { font-family: inherit; resize: vertical; }

/* ── Token 显示/隐藏 ── */
.token-field { position: relative; margin-bottom: 14px; }
.token-field .fi { margin-bottom: 0; padding-right: 42px; }
.token-toggle {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px; padding: 0;
  color: var(--text-secondary); cursor: pointer;
}
.token-toggle:hover { color: var(--accent); background: rgba(224, 123, 108, 0.08); }
.token-toggle svg { width: 18px; height: 18px; }

.mb-select { position: relative; z-index: 40; margin-bottom: 14px; }
.card-actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.card-actions .btn-primary { padding-left: 18px; padding-right: 18px; }

/* ── 后台入口链接 ── */
.admin-links { margin: 0 0 16px; }
.admin-links-title { display: block; font-size: 13px; font-weight: 600; color: var(--text-bright); margin-bottom: 8px; }
.admin-links-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.admin-link {
  display: flex; align-items: center; gap: 12px; min-width: 0;
  padding: 12px 14px;
  background: rgba(224, 123, 108, 0.08);
  border: 1.5px solid rgba(224, 123, 108, 0.32); border-radius: 12px;
  text-decoration: none; color: var(--text-primary);
  box-shadow: 0 1px 4px rgba(224, 123, 108, 0.08);
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}
.admin-link:hover {
  transform: translateY(-1px);
  border-color: var(--accent); background: rgba(224, 123, 108, 0.14);
  box-shadow: 0 8px 20px rgba(224, 123, 108, 0.18);
}
.admin-link-icon {
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; background: var(--accent); color: #fff;
  box-shadow: 0 4px 12px rgba(224, 123, 108, 0.28);
}
.admin-link-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.admin-link-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.admin-link-name { font-size: 14px; font-weight: 800; color: var(--text-bright); }
.admin-link-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.admin-link-tag {
  font-size: 11px; font-weight: 600; color: var(--accent);
  padding: 2px 8px; border-radius: 999px;
  background: rgba(224, 123, 108, 0.14);
}
.admin-link-url { font-size: 11px; color: var(--text-secondary); font-family: ui-monospace, monospace; white-space: nowrap; }
.admin-link-token {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  padding: 3px 8px; border-radius: 999px; white-space: nowrap;
  background: rgba(224, 123, 108, 0.12);
  border: 1px solid rgba(224, 123, 108, 0.24);
}
.admin-link-token b { color: var(--accent); font-family: ui-monospace, monospace; font-weight: 700; }
.admin-link-open {
  margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 999px;
  background: var(--accent); color: #fff; font-size: 12px; font-weight: 700;
  box-shadow: 0 3px 10px rgba(224, 123, 108, 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.admin-link:hover .admin-link-open { transform: translateX(2px); box-shadow: 0 5px 14px rgba(224, 123, 108, 0.36); }
.admin-link-open svg { width: 14px; height: 14px; }

/* ── 记忆摘要开关 ── */
/* ── 对话记忆摘要勾选 ── */
.memory-check {
  position: relative; display: flex; align-items: flex-start; gap: 10px;
  margin: 0 0 16px; padding: 12px 14px; cursor: pointer;
  border: 1px solid rgba(224, 123, 108, 0.22); border-radius: 10px;
  background: rgba(224, 123, 108, 0.04);
}
.memory-check input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.memory-check-box {
  width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--text-secondary); border-radius: 5px;
  background: rgba(255, 255, 255, 0.85);
  transition: border-color 0.2s ease, background 0.2s ease;
}
.memory-check-box svg {
  width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 3;
  stroke-linecap: round; stroke-linejoin: round; opacity: 0;
  transition: opacity 0.15s ease;
}
.memory-check input:checked + .memory-check-box { background: var(--accent); border-color: var(--accent); }
.memory-check input:checked + .memory-check-box svg { opacity: 1; }
.memory-check input:focus-visible + .memory-check-box { box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.2); }
.memory-check-copy { min-width: 0; }
.memory-check-title { display: block; font-size: 13px; font-weight: 600; color: var(--text-bright); line-height: 1.5; }
.memory-check-desc { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.5; }

/* ── 高级参数 ── */
.advanced { border-top: 1px dashed var(--border); margin-top: 4px; padding-top: 12px; }
.advanced summary {
  cursor: pointer; font-weight: 600; font-size: 13px; color: var(--accent);
  user-select: none; list-style: none; display: flex; align-items: center; gap: 6px;
}
.advanced summary::-webkit-details-marker { display: none; }
.advanced[open] summary { color: var(--text-bright); }
.advanced summary:hover { text-decoration: underline; }
.advanced-body { margin-top: 12px; }

/* ── 人格信息 ── */
.warn-box {
  padding: 14px 16px; margin-bottom: 12px;
  border: 1px solid rgba(224, 123, 108, 0.35);
  border-radius: 10px; background: rgba(224, 123, 108, 0.05);
}
.warn-title { font-size: 13px; font-weight: 700; color: var(--accent); margin: 0 0 6px; }
.persona-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 12px; }
.persona-side { display: flex; flex-direction: column; }
.persona-textarea { min-height: 460px; height: 460px; margin-bottom: 0; }
.persona-textarea-sm { min-height: 140px; height: 140px; margin-bottom: 16px; }
.persona-side .persona-textarea-sm:last-child { margin-bottom: 0; }

/* ── 记忆展示 ── */
.memory-box {
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(125, 105, 85, 0.14); border-radius: 10px;
  padding: 14px; font-size: 12.5px; white-space: pre-wrap; word-break: break-word;
  max-height: 260px; overflow: auto; margin-top: 8px; line-height: 1.6;
}
.memory-box.empty { color: var(--text-secondary); font-style: italic; }

.btn-danger {
  background: transparent; border: 1px solid var(--danger); color: var(--danger);
  border-radius: 9px; padding: 10px 18px; font-weight: 600;
}
.btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }

@media (max-width: 767px) {
  .maibot-page { padding: 16px; }
  .admin-links-grid { grid-template-columns: 1fr; }
  .settings-grid { grid-template-columns: 1fr; }
  .persona-grid { grid-template-columns: 1fr; }
  .persona-textarea { min-height: 360px; height: 360px; }
}
</style>
