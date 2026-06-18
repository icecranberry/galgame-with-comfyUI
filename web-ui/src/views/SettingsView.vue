<template>
  <div ref="scrollEl" class="settings-view" @scroll="onSettingsScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar()" :class="{ 'is-clickable': isMobile }">系统参数</h2>
      <span class="hint">修改即时生效，无需重启</span>
    </div>

    <div class="settings-grid">
      <!-- ComfyUI params: 对话配图 + 朋友圈配图 -->
      <div class="card">
        <h3>画师串 & 分辨率</h3>
        <p class="fd">建议选择0~2个画风，英文逗号分隔，参考来源：https://anima.mooshieblob.com/</p>

        <!-- 对话配图 -->
        <div class="moments-subsection">
          <h4 class="subsection-title">▸ 对话配图</h4>
          <input v-model="form.artist" class="fi" @input="markDirty" placeholder="画师串"/>
          <div class="fr">
            <div class="fh"><label class="fl">宽度</label><input v-model.number="form.width" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
            <div class="fh"><label class="fl">高度</label><input v-model.number="form.height" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
          </div>
          <div class="fpresets">
            <span class="pl">预设：</span>
            <button v-for="p in presets" :key="p.label" class="pbtn" @click="applyPreset(p, 'chat')">{{ p.label }}</button>
          </div>
        </div>

        <div class="moments-divider"></div>

        <!-- 朋友圈配图 -->
        <div class="moments-subsection">
          <h4 class="subsection-title">▸ 朋友圈配图</h4>
          <input v-model="form.momentsArtist" class="fi" @input="markDirty" placeholder="画师串"/>
          <div class="fr">
            <div class="fh"><label class="fl">宽度</label><input v-model.number="form.momentsWidth" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
            <div class="fh"><label class="fl">高度</label><input v-model.number="form.momentsHeight" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
          </div>
          <div class="fpresets">
            <span class="pl">预设：</span>
            <button v-for="p in presets" :key="p.label" class="pbtn" @click="applyPreset(p, 'moments')">{{ p.label }}</button>
          </div>
        </div>

        <div class="sa">
          <button class="btn-primary" :disabled="!dirty" @click="saveComfy">保存</button>
          <span v-if="saved" class="smsg">已保存</span>
        </div>
      </div>

      <!-- 测试画风：选择对话配图/朋友圈配图，发送固定提示词测试 -->
      <div class="card">
        <h3>测试画风</h3>
        <p class="fd">使用上方对应画师串和分辨率，以固定提示词发送生图请求，图片仅作预览不保存</p>
        <p class="fd">Anima文生图模型的数据库大约在2025年9月，过新的角色不识别，越久的角色特征越稳定</p>

        <div class="style-test-row">
          <button
            class="btn-primary style-test-btn"
            :disabled="styleTesting"
            @click="runStyleTest"
          >
            {{ styleTesting ? '生成中...' : '🎨 发送测试' }}
          </button>
          <button
            :class="['test-mode-btn', { active: testMode === 'chat' }]"
            :disabled="styleTesting"
            @click="testMode = 'chat'"
          >对话配图</button>
          <button
            :class="['test-mode-btn', { active: testMode === 'moments' }]"
            :disabled="styleTesting"
            @click="testMode = 'moments'"
          >朋友圈配图</button>
          <button class="test-prompt-btn" @click="openPromptEditor">测试提示词</button>
        </div>

        <div v-if="styleError" class="style-error">{{ styleError }}</div>

        <div v-if="styleTesting" class="style-loading">
          <span class="style-spinner"></span>
          <span>ComfyUI 正在生成图片，请耐心等待...</span>
        </div>

        <div v-if="styleImages.length > 0" class="style-result">
          <div v-if="styleElapsed != null" class="style-elapsed">
            ⏱ 生成耗时 {{ formatElapsed(styleElapsed) }}
          </div>
          <img
            v-for="(img, i) in styleImages"
            :key="i"
            :src="img.base64"
            class="style-preview-img"
            @click="openLightbox(i)"
            alt="测试画风结果"
          />
        </div>

        <!-- 全屏预览 -->
        <Teleport to="body">
          <VueEasyLightbox
            :visible="lightboxVisible"
            :imgs="lightboxImgs"
            :index="lightboxIndex"
            :max-zoom="6"
            :min-zoom="0.3"
            :zoom-scale="0.35"
            @hide="lightboxVisible = false"
          />
        </Teleport>
      </div>

      <!-- 测试提示词编辑弹窗 -->
      <Teleport to="body">
        <div v-if="showPromptEditor" class="prompt-editor-overlay" @click.self="showPromptEditor = false">
          <div class="prompt-editor-modal">
            <div class="prompt-editor-header">
              <h3>编辑测试提示词</h3>
              <button class="prompt-editor-close" @click="showPromptEditor = false">✕</button>
            </div>
            <div class="prompt-editor-body">
              <div class="prompt-editor-field">
                <label class="fl">对话配图提示词</label>
                <textarea v-model="testPrompts.chat" class="fi prompt-textarea" rows="5"></textarea>
              </div>
              <div class="prompt-editor-field">
                <label class="fl">朋友圈配图提示词</label>
                <textarea v-model="testPrompts.moments" class="fi prompt-textarea" rows="5"></textarea>
              </div>
            </div>
            <div class="prompt-editor-actions">
              <button class="btn-ghost" @click="resetTestPrompts">恢复默认</button>
              <button class="btn-primary" @click="saveTestPrompts">保存</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- LLM API 设置 -->
      <div class="card">
        <h3>LLM API 设置</h3>
        <p class="fd">配置 AI 对话和角色生成所使用的 LLM 接口</p>

        <!-- API Key -->
        <label class="fl">API Key</label>
        <div class="apikey-row">
          <input
            v-model="llmApiKey"
            :type="showApiKey ? 'text' : 'password'"
            class="fi"
            style="margin-bottom:0"
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            @input="markLlmDirty"
          />
          <button class="sp-btn-small" style="flex-shrink:0" @click="showApiKey = !showApiKey">
            {{ showApiKey ? '隐藏' : '显示' }}
          </button>
        </div>
        <div v-if="llmPreview.hasApiKey" class="key-status">
          <span class="key-ok">🔑 当前:</span>
          <code class="key-preview">{{ llmPreview.preview }}</code>
        </div>
        <div v-else class="key-status key-missing">⚠️ 未设置，AI 对话功能不可用</div>

        <!-- API 地址 -->
        <label class="fl" style="margin-top:14px">API 地址</label>
        <select v-model="llmBaseURL" class="fi" style="margin-bottom:6px" @change="markLlmDirty">
          <option value="https://api.deepseek.com">DeepSeek</option>
          <option value="https://dashscope.aliyuncs.com/compatible-mode/v1">通义千问 (DashScope)</option>
          <option value="https://api.moonshot.cn/v1">Moonshot (Kimi)</option>
          <option value="https://api.openai.com/v1">OpenAI</option>
          <option value="">自定义…</option>
        </select>
        <input v-if="isCustomBaseURL" v-model="llmBaseURL" class="fi" placeholder="https://your-api-endpoint/v1" @input="markLlmDirty" />

        <!-- 模型 -->
        <label class="fl" style="margin-top:14px">模型</label>
        <input v-model="llmModel" class="fi" placeholder="deepseek-chat" @input="markLlmDirty" />

        <div class="sa" style="margin-top:12px">
          <button class="btn-primary" :disabled="!llmDirty" @click="saveLlmConfig">保存</button>
          <span v-if="llmSaved" class="smsg">已保存</span>
        </div>
      </div>


      <!-- 功能开关 -->
      <div class="card">
        <h3>功能开关</h3>

        <div class="toggle-row">
          <div>
            <div class="tl">情绪刺激评估</div>
            <div class="td">每轮对话后评估 AI 情绪变化，影响回复语气</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.emotion" @change="saveFeature('emotion', features.emotion)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">记忆碎片提取</div>
            <div class="td">从对话中提取事实/偏好/情绪碎片存入向量数据库</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.memoryExtract" @change="saveFeature('memoryExtract', features.memoryExtract)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">Anima 提示词优化</div>
            <div class="td">画面描述将携带Anima提示词助手多请求一次LLM，能够优化特定动作姿势</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.promptOptimize" @change="saveFeature('promptOptimize', features.promptOptimize)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">智能配图判断</div>
            <div class="td">回复后提交LLM自动二次判断是否需要配图增强表达，无需用户主动要求</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.autoImageJudge" @change="saveFeature('autoImageJudge', features.autoImageJudge)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">聊天候选词</div>
            <div class="td">LLM回复后预测用户接下来可能说的话，在输入框上方显示快捷候选</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.replyGuesses" @change="saveFeature('replyGuesses', features.replyGuesses)" />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <!-- ComfyUI 连接 -->
      <div class="card">
        <h3>ComfyUI 连接</h3>
        <p class="fd">ComfyUI 服务地址，默认 http://localhost:8188</p>
        <input v-model="comfyUrl" class="fi" placeholder="http://localhost:8188" @input="markConnDirty" />
        <div class="sr">
          <span :class="['sd', health?.connected ? 'on' : 'off']"></span>
          <span>{{ health?.connected ? '已连接' : '未连接' }}</span>
        </div>
        <div class="sa" style="margin-top:12px">
          <button class="btn-primary" :disabled="!connDirty" @click="saveComfyUrl">保存</button>
          <span v-if="connSaved" class="smsg">已保存</span>
          <button class="btn-ghost" @click="checkHealth">刷新连接</button>
        </div>
      </div>
    </div>

    <!-- 全局规则 — 跨满宽 -->
    <div class="card card-full">
      <h3>全局规则</h3>
      <p class="fd">追加到每个角色 system prompt 末尾的通用指令，修改即时生效</p>

      <div class="rules-grid">
        <div v-for="rule in rules" :key="rule.rule_key" class="rule-block">
          <div class="rule-header">
            <span class="rule-label">{{ ruleLabels[rule.rule_key] || rule.rule_key }}</span>
          </div>
          <textarea
            class="rule-textarea"
            :value="rule._content"
            @input="rule._content = $event.target.value; markRuleDirty(rule.rule_key)"
            rows="10"
          ></textarea>
          <div class="rule-actions">
            <button class="btn-primary btn-sm" :disabled="!rulesDirty[rule.rule_key]" @click="saveRule(rule)">保存</button>
            <span v-if="rulesSaved[rule.rule_key]" class="smsg">已保存</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue'
import { getConfig, updateComfyConfig, updateLlmConfig, updateFeatureFlag, comfyuiHealth, getGlobalRules, updateGlobalRule, testStyle } from '../api/index.js'
import { useSettingsStore } from '../stores/settings.js'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'

const settingsStore = useSettingsStore()
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')

// ── 移动端滚动方向感知：下滑隐藏标题，上滑显示 ──
const scrollEl = ref(null)
const headerVisible = ref(true)
let settingsLastScroll = 0
function onSettingsScroll() {
  if (!isMobile) return
  const el = scrollEl.value
  if (!el) return
  const delta = el.scrollTop - settingsLastScroll
  if (el.scrollTop > 40 && delta > 8) {
    headerVisible.value = false
  } else if (delta < -4) {
    headerVisible.value = true
  }
  settingsLastScroll = el.scrollTop
}

const form = ref({ artist: '', width: 1600, height: 1200, momentsArtist: '', momentsWidth: 1600, momentsHeight: 1200 })
const comfyUrl = ref('')
const connDirty = ref(false)
const connSaved = ref(false)
const features = reactive({ emotion: false, memory: false, memoryExtract: false, autoImageJudge: false, promptOptimize: false, replyGuesses: false })
const dirty = ref(false)
const saved = ref(false)
const health = ref(null)
const rules = ref([])
const rulesDirty = ref({})
const rulesSaved = ref({})

const ruleLabels = {
  image_intent: '图像生成判断',
  system_rules: '系统规则',
  dialogue_rules: '聊天规则',
  image_prompt: '图像生成指令',
  judge_prompt: '智能配图判断提示词',
}

const presets = [
  { label: '768×512', width: 768, height: 512 },
  { label: '768×768', width: 768, height: 768 },
  { label: '1024×1024', width: 1024, height: 1024 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1600×1200', width: 1600, height: 1200 },
  { label: '1920×1080', width: 1920, height: 1080 },
]

// ── LLM API ──
const llmPreview = ref({ provider: 'deepseek', hasApiKey: false, preview: '', model: 'deepseek-chat' })
const llmApiKey = ref('')
const llmBaseURL = ref('https://api.deepseek.com')
const llmModel = ref('deepseek-chat')
const isCustomBaseURL = computed(() => {
  const presets = ['https://api.deepseek.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://api.moonshot.cn/v1', 'https://api.openai.com/v1']
  return !presets.includes(llmBaseURL.value)
})
const showApiKey = ref(false)
const llmDirty = ref(false)
const llmSaved = ref(false)
function markLlmDirty() { llmDirty.value = true; llmSaved.value = false }

onMounted(async () => {
  try {
    const data = await getConfig()
    form.value = {
      artist: data.comfy.artist, width: data.comfy.width, height: data.comfy.height,
      momentsArtist: data.comfy.momentsArtist || data.comfy.artist,
      momentsWidth: data.comfy.momentsWidth || 1600,
      momentsHeight: data.comfy.momentsHeight || 1200,
    }
    comfyUrl.value = data.comfy.url || 'http://localhost:8188'
    settingsStore.setComfySize(data.comfy.width, data.comfy.height)
    Object.assign(features, data.features)
    llmPreview.value = { ...data.llm }
    llmBaseURL.value = data.llm.baseURL || 'https://api.deepseek.com'
    llmModel.value = data.llm.model || 'deepseek-chat'
  } catch {}
  await checkHealth()
  await loadRules()
})

function markDirty() { dirty.value = true; saved.value = false }
function markConnDirty() { connDirty.value = true; connSaved.value = false }

async function saveComfy() {
  await updateComfyConfig({
    artist: form.value.artist, width: form.value.width, height: form.value.height,
    momentsArtist: form.value.momentsArtist, momentsWidth: form.value.momentsWidth, momentsHeight: form.value.momentsHeight,
  })
  settingsStore.setComfySize(form.value.width, form.value.height)
  dirty.value = false; saved.value = true
  setTimeout(() => saved.value = false, 2000)
}

async function saveComfyUrl() {
  await updateComfyConfig({ url: comfyUrl.value })
  connDirty.value = false; connSaved.value = true
  setTimeout(() => connSaved.value = false, 2000)
}

async function saveLlmConfig() {
  try {
    const payload = {}
    if (llmApiKey.value.trim()) payload.apiKey = llmApiKey.value.trim()
    if (llmBaseURL.value) payload.baseURL = llmBaseURL.value
    if (llmModel.value) payload.model = llmModel.value
    const result = await updateLlmConfig(payload)
    if (result.ok) {
      llmPreview.value = { ...result }
      llmBaseURL.value = result.baseURL || llmBaseURL.value
      llmModel.value = result.model || llmModel.value
      if (payload.apiKey) llmApiKey.value = ''
      llmDirty.value = false
      llmSaved.value = true
      setTimeout(() => llmSaved.value = false, 2000)
    }
  } catch (err) {
    console.error('[llm] save failed:', err)
  }
}

function applyPreset(p, mode = 'chat') {
  if (mode === 'moments') {
    form.value.momentsWidth = p.width; form.value.momentsHeight = p.height;
  } else {
    form.value.width = p.width; form.value.height = p.height;
  }
  dirty.value = true; saved.value = false;
}

async function saveFeature(key, val) {
  await updateFeatureFlag(key, val)
}

async function checkHealth() { health.value = await comfyuiHealth() }

// ── 全局规则 ──
async function loadRules() {
  try {
    const data = await getGlobalRules()
    rules.value = (data.rules || []).map(r => ({
      ...r,
      _content: r.rule_content,
    }))
  } catch {}
}

function markRuleDirty(key) { rulesDirty.value[key] = true; rulesSaved.value[key] = false }
async function saveRule(rule) {
  try {
    const result = await updateGlobalRule(rule.rule_key, {
      rule_content: rule._content,
    })
    if (result.ok) {
      rule.rule_content = rule._content
      rule.updated_at = result.rule?.updated_at || new Date().toISOString()
      rulesDirty.value[rule.rule_key] = false
      rulesSaved.value[rule.rule_key] = true
      setTimeout(() => rulesSaved.value[rule.rule_key] = false, 2000)
    }
  } catch (err) {
    console.error('[rules] save failed:', err)
  }
}

// ── 测试画风 ──
const testMode = ref('chat')  // 'chat' | 'moments'
const styleTesting = ref(false)
const styleError = ref('')
const styleImages = ref([])
const styleElapsed = ref(null)  // ms

// Lightbox
const lightboxVisible = ref(false)
const lightboxIndex = ref(0)
const lightboxImgs = computed(() => styleImages.value.map(i => i.base64))

function openLightbox(index) {
  lightboxIndex.value = index
  lightboxVisible.value = true
}

function formatElapsed(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = ((ms % 60000) / 1000).toFixed(0)
  return `${min}min ${sec}s`
}

async function runStyleTest() {
  styleTesting.value = true
  styleError.value = ''
  styleImages.value = []
  styleElapsed.value = null

  try {
    const result = await testStyle(
      testMode.value === 'moments' ? form.value.momentsArtist : form.value.artist,
      testMode.value === 'moments' ? form.value.momentsWidth : form.value.width,
      testMode.value === 'moments' ? form.value.momentsHeight : form.value.height,
      testMode.value,
      testPrompts.value[testMode.value] || '',
    )
    if (result.elapsed != null) styleElapsed.value = result.elapsed
    if (result.success && result.images?.length > 0) {
      styleImages.value = result.images
    } else {
      styleError.value = result.error || '生成失败，请检查 ComfyUI 连接'
    }
  } catch (err) {
    styleError.value = '请求失败: ' + (err.message || '网络错误')
  } finally {
    styleTesting.value = false
  }
}

// ── 测试提示词编辑器 ──
const TEST_PROMPTS_KEY = 'test-style-prompts'
const DEFAULT_TEST_PROMPTS = {
  chat: `1girl, solo, kiana kaslana(honkai impact 3rd), herrscher of finality, voluminous white hair, gradient hair, blue eyes with purple cross-shaped pupils, side ahoge, ponytail, floating hair, white cat ears, cat tail, soft breasts, hair ornament, sailor uniform, one hand on hip, other hand making peace sign near face, classroom, open window, cherry blossoms, cherry blossom petals drifting indoors, direct eye contact, facing viewer, kiana kaslana (honkai impact 3rd) as the herrscher of finality, with voluminous, glossy white hair and blue eyes featuring purple cross-shaped pupils like a starry sky, side ahoge, gradient hair, nekomusume, white cat ears, cat tail, ponytail, floating hair, soft breasts, hair ornament, background is a classroom with an open window, cherry blossom tree outside, petals drifting into the classroom, kiana standing with one hand on her hip and the other making a peace sign near her face, wearing a sailor uniform`,
  moments: `2girls, Kiana Kaslana(honkai impact 3rd), white hair in twin braids, blue eyes, wearing a casual outfit, sitting at a cozy café table with a giant strawberry cake in front of her, laughing joyfully. Raiden Mei(honkai impact 3rd) is sitting across from her, smiling softly, two pudding cups on the table. Warm afternoon sunlight streaming through the window, soft bokeh, cute and heartwarming atmosphere, anime style, high quality illustration.`,
}

function loadTestPrompts() {
  try {
    const raw = localStorage.getItem(TEST_PROMPTS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { ...DEFAULT_TEST_PROMPTS }
}

const testPrompts = ref(loadTestPrompts())
const showPromptEditor = ref(false)

function openPromptEditor() {
  showPromptEditor.value = true
}

function saveTestPrompts() {
  localStorage.setItem(TEST_PROMPTS_KEY, JSON.stringify(testPrompts.value))
  showPromptEditor.value = false
}

function resetTestPrompts() {
  testPrompts.value = { ...DEFAULT_TEST_PROMPTS }
}

</script>

<style scoped>
.settings-view { padding: 32px; overflow-y: auto; height: 100vh; height: 100dvh; flex: 1; }
.page-header {
  margin-bottom: 28px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.page-header.header-hidden { transform: translateY(-100%); margin-bottom: 0; }
.page-header h2 { font-size: 24px; color: var(--text-bright); font-weight: 700; }
.is-clickable { cursor: pointer; }
.hint { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }

.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* ── 毛玻璃卡片 ── */
.card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--glass-shadow);
  transition: box-shadow 0.2s ease;
}
.card:hover { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06); }
.card-full { grid-column: 1 / -1; margin-top: 16px; }
.rules-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card h3 { font-size: 15px; color: var(--text-bright); margin-bottom: 12px; font-weight: 600; }
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 2px; }
.fd { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.fi { width: 100%; padding: 9px 12px; font-size: 13px; margin-bottom: 14px; border-radius: 8px; background: rgba(255,255,255,0.9); border: 1px solid #e2d6c7; color: var(--text-bright); outline: none; }
.moments-subsection { margin-bottom: 4px; }
.subsection-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; }
.moments-divider { height: 1px; background: var(--glass-border); margin: 16px 0; }
.fi:focus { border-color: var(--accent); }
.fr { display: flex; gap: 14px; }
.fh { flex: 1; }
.fpresets { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 4px 0 16px; }
.pl { font-size: 11px; color: var(--text-secondary); }
.pbtn { font-size: 11px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--glass-bg-strong); color: var(--text-primary); cursor: pointer; transition: all 0.15s; }
.pbtn:hover { border-color: var(--accent); color: var(--accent-hover); }
.sa { display: flex; align-items: center; gap: 12px; }
.smsg { color: var(--success); font-size: 13px; }

.toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--glass-border); }
.toggle-row:last-child { border-bottom: none; }
.tl { font-size: 14px; font-weight: 500; color: var(--text-bright); }
.td { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

.switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: var(--bg-hover); border-radius: 24px; cursor: pointer; transition: 0.2s; }
.slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.switch input:checked + .slider { background: var(--accent); }
.switch input:checked + .slider::before { transform: translateX(20px); }

.sr { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.sd { width: 9px; height: 9px; border-radius: 50%; }
.sd.on { background: var(--success); }
.sd.off { background: var(--danger); }

/* ── 全局规则 ── */
.rule-block {
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
}
.rule-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
}
.rule-label { font-size: 14px; font-weight: 600; color: var(--text-bright); }
.rule-textarea {
  width: 100%;
  padding: 10px 12px;
  font-size: 12px; line-height: 1.6;
  border: 1px solid #d5d0ca;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-primary);
  resize: vertical; min-height: 120px;
  font-family: inherit;
}
.rule-textarea:focus { border-color: var(--accent); outline: none; }
.rule-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.btn-sm { font-size: 12px; padding: 5px 14px; border-radius: 6px; }

.sp-btn-small { padding:6px 14px; font-size:12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg-strong); color:var(--text-primary); cursor:pointer; margin-right:6px; transition: all 0.15s; }
.sp-btn-small:hover { border-color:var(--accent); }

/* ── LLM API ── */
.apikey-row { display: flex; gap: 8px; align-items: center; }
.key-status { margin-top: 8px; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.key-ok { color: var(--success); }
.key-missing { color: var(--danger); padding: 6px 10px; border-radius: 6px; background: rgba(255, 77, 79, 0.06); }
.key-preview { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: var(--glass-bg-strong); border: 1px solid var(--glass-border); color: var(--text-secondary); }

/* ── 测试画风 ── */
.style-test-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.style-test-btn { border-radius: 8px; margin: 0; }
.test-mode-btn {
  padding: 7px 14px; font-size: 12px; font-weight: 500;
  border-radius: 8px; border: 1px solid var(--glass-border);
  background: transparent; color: var(--text-secondary);
  cursor: pointer; transition: all 0.2s ease;
}
.test-mode-btn:hover { border-color: var(--accent); color: var(--accent-hover); }
.test-mode-btn.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}
.test-mode-btn:disabled { opacity: 0.5; pointer-events: none; }
.test-prompt-btn {
  margin-left: auto; padding: 0; font-size: 12px;
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
  transition: color 0.15s;
}
.test-prompt-btn:hover { color: var(--accent); }
.style-error { padding: 8px 12px; border-radius: 8px; background: rgba(255, 77, 79, 0.06); color: var(--danger); font-size: 13px; margin-bottom: 12px; }
.style-loading { display: flex; align-items: center; gap: 10px; padding: 12px 0; color: var(--text-secondary); font-size: 13px; }
.style-spinner { width: 18px; height: 18px; border: 2px solid var(--glass-border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
.style-result { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; align-items: flex-start; flex-direction: column; }
.style-elapsed { font-size: 13px; color: var(--text-secondary); padding: 4px 10px; border-radius: 6px; background: var(--glass-bg-strong); border: 1px solid var(--glass-border); }
.style-preview-img { max-width: 480px; max-height: 480px; border-radius: 12px; border: 1px solid var(--glass-border); cursor: pointer; object-fit: contain; background: var(--glass-bg-strong); transition: transform 0.2s ease; }
.style-preview-img:hover { transform: scale(1.03); }

/* ── 测试提示词弹窗 ── */
.prompt-editor-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex;
  align-items: center; justify-content: center; z-index: 10000;
}
.prompt-editor-modal {
  background: var(--bg-primary); border-radius: 16px; padding: 24px;
  width: min(640px, 90vw); max-height: 80vh; display: flex; flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.prompt-editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.prompt-editor-header h3 { font-size: 16px; font-weight: 600; color: var(--text-bright); }
.prompt-editor-close {
  width: 28px; height: 28px; border-radius: 50%; border: none;
  background: var(--glass-bg-strong); color: var(--text-secondary);
  font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.prompt-editor-body { flex: 1; overflow-y: auto; }
.prompt-editor-field { margin-bottom: 16px; }
.prompt-textarea { min-height: 100px; resize: vertical; font-family: inherit; margin-bottom: 0; }
.prompt-editor-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

/* ── 移动端：卡片单列 + 间距收缩 ── */
@media (max-width: 767px) {
  .settings-view { padding: 16px; }
  .page-header {
    position: sticky; top: 0; z-index: 20;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    padding: 8px 0; margin-bottom: 20px;
  }
  .settings-grid { grid-template-columns: 1fr; }
  .rules-grid { grid-template-columns: 1fr; }
  .fr { flex-direction: column; gap: 10px; }
  .style-preview-img { max-width: 100%; }
}
</style>
