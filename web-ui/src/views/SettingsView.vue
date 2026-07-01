<template>
  <div ref="scrollEl" class="settings-view" @scroll="onSettingsScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar()" :class="{ 'is-clickable': isMobile }">系统参数</h2>
      <span class="hint">修改即时生效，无需重启</span>
    </div>

    <div class="settings-grid">
      <!-- ComfyUI params: 对话配图 / 朋友圈配图 / 奇遇配图（Tab 切换） -->
      <div class="card">
        <h3>画师串 & 分辨率</h3>
        <p class="fd">直接描述画面风格 或者 选择0~2个画风，英文逗号分隔，参考来源：<a href="https://anima.mooshieblob.com/" target="_blank" rel="noopener" class="ext-link">https://anima.mooshieblob.com/</a> · 分辨率越高出图越精细，代价是变慢。5070ti 768×512 约 7s/图</p>

        <div class="comfy-tabs">
          <button v-for="t in comfyTabs" :key="t.mode"
            :class="['comfy-tab', { active: comfyTab === t.mode }]"
            @click="switchComfyTab(t.mode)">{{ t.label }}</button>
        </div>

        <div class="comfy-form-stage">
          <Transition :name="'tab-slide-' + tabSlideDir" mode="out-in">
            <div :key="comfyTab" class="comfy-form-inner">
              <div class="fav-input-row">
                <input v-model="form[activeFields.artist]" class="fi fav-input" @input="markDirty" placeholder="画师串"/>
                <button class="fav-star-btn" title="收藏当前画师串" @click="addToFavorites(comfyTab)" :disabled="!form[activeFields.artist].trim()">☆</button>
              </div>
              <div v-if="artistFavorites.length" class="fav-chips">
                <button v-for="fav in artistFavorites" :key="fav.id" class="fav-chip" :class="{ active: fav.artist === form[activeFields.artist] }" @click="applyFavorite(fav, comfyTab)" :title="fav.artist">
                  {{ fav.label }}
                  <span class="fav-chip-x" @click.stop="removeFavorite(fav.id)">×</span>
                </button>
              </div>
              <div class="fr">
                <div class="fh"><label class="fl">宽度</label><input v-model.number="form[activeFields.width]" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
                <div class="fh"><label class="fl">高度</label><input v-model.number="form[activeFields.height]" type="number" class="fi" min="256" max="4096" @input="markDirty" /></div>
              </div>
              <div class="fpresets">
                <span class="pl">预设：</span>
                <button v-for="p in presets" :key="p.label" class="pbtn" @click="applyPreset(p, comfyTab)">{{ p.label }}</button>
              </div>
            </div>
          </Transition>
        </div>

        <div class="sa">
          <button class="btn-primary" :disabled="!dirty" @click="saveComfy">保存</button>
          <span v-if="saved" class="smsg">已保存</span>
        </div>
      </div>



      <!-- 测试画风：选择对话配图/朋友圈配图，发送固定提示词测试 -->
      <div class="card">
        <h3>测试画风&速度</h3>
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
          <button
            :class="['test-mode-btn', { active: testMode === 'event' }]"
            :disabled="styleTesting"
            @click="testMode = 'event'"
          >奇遇配图</button>
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
            <span v-if="styleTiming" class="style-timing-breakdown">
              · ComfyUI {{ formatElapsed(styleTiming.comfyui_ms) }}
              · 下载 {{ formatElapsed(styleTiming.download_ms) }}
              <span v-if="styleTiming.ws_setup_ms != null" title="WebSocket 建连 + ComfyUI 预热">
                · 连接预热 {{ formatElapsed(styleTiming.ws_setup_ms) }}
              </span>
            </span>
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
              <div class="prompt-editor-field">
                <label class="fl">奇遇配图提示词</label>
                <textarea v-model="testPrompts.event" class="fi prompt-textarea" rows="5"></textarea>
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
        <p class="fd">配置 AI 对话和角色生成所使用的 LLM 接口(deepseek官方之外不保证有效)</p>
        <p class="fd">deepseek的key获取地址：<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener" class="ext-link">https://platform.deepseek.com/api_keys</a> ，充多少用多少，邻舍.EXE玩一整天大概五六毛</p>

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
        <label class="fl" style="margin-top:14px">模型(建议deepseek-v4-flash)</label>
        <input v-model="llmModel" class="fi" placeholder="deepseek-v4-flash" @input="markLlmDirty" />

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
            <div class="tl">好感度系统</div>
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
            <input type="checkbox" v-model="features.memory" @change="saveFeature('memory', features.memory)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">Anima 提示词优化</div>
            <div class="td">画面描述将携带Anima提示词助手多请求一次LLM，画面将更加精准</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.promptOptimize" @change="saveFeature('promptOptimize', features.promptOptimize)" />
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

        <div class="toggle-row">
          <div>
            <div class="tl">实时显示好感度</div>
            <div class="td">在聊天顶部实时显示当前好感度数值和最近变化原因</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="features.realtimeAffinityDisplay" @change="saveFeature('realtimeAffinityDisplay', features.realtimeAffinityDisplay)" />
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row freq-row">
          <div>
            <div class="tl">主动聊天频率</div>
            <div class="td">0 关闭，越大越频繁。</div>
          </div>
          <div class="freq-control">
            <input type="range" min="0" max="1" step="0.1"
              v-model.number="freqSlider"
              @change="onFreqChange"
            />
            <span class="freq-val">{{ freqSlider.toFixed(1) }}</span>
          </div>
        </div>

        <div class="toggle-row freq-row">
          <div>
            <div class="tl">奇遇触发频率</div>
            <div class="td">0 关闭自动触发，1 为默认频率（约 10 分钟一次）。</div>
          </div>
          <div class="freq-control">
            <input type="range" min="0" max="1" step="0.1"
              v-model.number="eventFreqSlider"
              @change="onEventFreqChange"
            />
            <span class="freq-val">{{ eventFreqSlider.toFixed(1) }}</span>
          </div>
        </div>

        <!-- 防打扰模式 -->
        <div class="toggle-row">
          <div style="flex:1">
            <div class="tl">防打扰模式</div>
            <div class="td">在指定时间段内自动禁用勾选角色的朋友圈、主动聊天和奇遇</div>
          </div>
          <div
            v-if="disturbMode"
            class="disturb-setup-btn"
            title="防打扰设置"
            @click="openDisturbDialog"
          >⚙</div>
          <label class="switch">
            <input type="checkbox" v-model="disturbMode" @change="onDisturbModeToggle" />
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

    <!-- 全局规则 — 跨满宽，整体折叠 -->
    <div class="card card-full" :class="{ 'card-collapsed': !rulesExpanded }" @click="!rulesExpanded && (rulesExpanded = true)">
      <h3 class="collapsible-header" @click.stop="rulesExpanded = !rulesExpanded">
        <span>全局规则</span>
      </h3>
      <p class="fd">追加到每个角色 system prompt 末尾的通用指令，修改即时生效</p>

      <svg v-if="!rulesExpanded" class="collapse-arrow" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
        <path d="M534.826667 935.466667a47.36 47.36 0 0 1-66.986667-66.773334L835.413333 501.333333 467.84 133.973333a47.36 47.36 0 1 1 66.986667-66.773333l400.64 400.64a47.36 47.36 0 0 1 0 66.986667z" fill="currentColor"/>
      </svg>

      <Transition name="rules-expand">
        <div v-if="rulesExpanded" class="rules-grid">
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
            <button class="btn-ghost btn-sm btn-reset" @click="confirmResetRule(rule)">重置默认</button>
          </div>
        </div>
      </div>
      </Transition>
    </div>

  </div>

  <!-- 重置规则确认弹窗 -->
  <Teleport to="body">
    <Transition name="fav-dialog-fade">
      <div v-if="resetDialog.show" class="fav-dialog-overlay" @click.self="cancelResetRule">
        <div class="fav-dialog">
          <div class="fav-dialog-header">
            <span>重置全局规则</span>
            <button class="fav-dialog-close" @click="cancelResetRule">✕</button>
          </div>
          <div class="fav-dialog-body">
            <p class="fav-dialog-desc">
              确定要将 <strong>{{ ruleLabels[resetDialog.key] || resetDialog.key }}</strong> 重置为默认值吗？当前修改将丢失。
            </p>
            <div v-if="resetDialog.preview" class="reset-preview">
              <div class="reset-preview-label">默认值预览：</div>
              <pre class="reset-preview-content">{{ resetDialog.preview }}</pre>
            </div>
            <div class="fav-dialog-actions">
              <button class="btn-ghost" @click="cancelResetRule">取消</button>
              <button class="btn-danger" @click="doResetRule">确认重置</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 收藏画师串弹窗 -->
  <Teleport to="body">
    <Transition name="fav-dialog-fade">
      <div v-if="favDialog.show" class="fav-dialog-overlay">
        <div class="fav-dialog">
          <div class="fav-dialog-header">
            <span>收藏画师串</span>
            <button class="fav-dialog-close" @click="cancelAddFavorite">✕</button>
          </div>
          <div class="fav-dialog-body">
            <p class="fav-dialog-desc">为当前画师串起个名字，方便以后快速识别：</p>
            <input
              ref="favDialogInput"
              v-model="favDialog.label"
              class="fav-dialog-input"
              placeholder="输入收藏名称"
              maxlength="30"
              @keyup.enter="confirmAddFavorite"
            />
            <div class="fav-dialog-actions">
              <button class="btn-ghost" @click="cancelAddFavorite">取消</button>
              <button class="btn-primary" :disabled="!favDialog.label.trim()" @click="confirmAddFavorite">确认收藏</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 防打扰模式设置弹窗 -->
  <Teleport to="body">
    <Transition name="disturb-dialog-fade">
      <div v-if="disturbDialog.show" class="disturb-dialog-overlay" @click.self="cancelDisturbDialog">
        <div class="disturb-dialog">
          <div class="disturb-dialog-header">
            <span>防打扰设置</span>
            <button class="fav-dialog-close" @click="cancelDisturbDialog">✕</button>
          </div>
          <div class="disturb-dialog-body">
            <!-- 时间段设置 -->
            <div class="disturb-dialog-section">
              <span class="disturb-dialog-label">⏰ 静默时段</span>
              <p class="disturb-dialog-hint">在此时段内自动禁用所选角色的朋友圈、主动聊天和奇遇。支持跨午夜（如 22:00 ~ 08:00）。</p>
              <div class="disturb-time-row">
                <input type="time" v-model="disturbDialog.startTime" class="disturb-time-input" />
                <span class="disturb-time-sep">—</span>
                <input type="time" v-model="disturbDialog.endTime" class="disturb-time-input" />
              </div>
            </div>

            <!-- 角色选择 -->
            <div class="disturb-dialog-section disturb-char-scroll">
              <span class="disturb-dialog-label">👤 适用角色</span>
              <p class="disturb-dialog-hint">勾选需要在静默时段内暂停互动通知的角色</p>
              <div v-if="allCharacters.length === 0" class="disturb-no-chars">暂无角色，请先创建角色</div>
              <div v-else class="disturb-char-grid">
                <label
                  v-for="ch in allCharacters"
                  :key="ch.id"
                  class="disturb-char-chip"
                  :class="{ selected: disturbDialog.characterIds.includes(ch.id) }"
                  @click="toggleDisturbDialogChar(ch.id)"
                >
                  <div
                    class="disturb-char-avatar"
                    :style="ch.avatar_path
                      ? { backgroundImage: `url(${ch.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : { background: '#e07b6c' }"
                  >{{ ch.avatar_path ? '' : ch.display_name.charAt(0) }}</div>
                  <span class="disturb-char-name">{{ ch.display_name }}</span>
                </label>
              </div>
            </div>

            <!-- 额外选项 -->
            <div class="disturb-dialog-section disturb-dialog-toggles">
              <label class="disturb-option-row">
                <span class="disturb-option-label">隐藏世界观</span>
                <span class="disturb-option-hint">时段内暂时不向 AI 注入世界背景设定</span>
                <label class="switch">
                  <input type="checkbox" v-model="disturbDialog.hideWorld" />
                  <span class="slider"></span>
                </label>
              </label>
              <label class="disturb-option-row">
                <span class="disturb-option-label">跳过周末</span>
                <span class="disturb-option-hint">周六周日不执行防打扰，恢复全部互动</span>
                <label class="switch">
                  <input type="checkbox" v-model="disturbDialog.skipWeekends" />
                  <span class="slider"></span>
                </label>
              </label>
            </div>

            <div class="disturb-dialog-actions">
              <button class="btn-ghost" @click="cancelDisturbDialog">取消</button>
              <button class="btn-primary" @click="confirmDisturbDialog">保存设置</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject, watch, nextTick } from 'vue'
import { getConfig, updateComfyConfig, updateLlmConfig, updateFeatureFlag, comfyuiHealth, getGlobalRules, updateGlobalRule, getDefaultRule, resetGlobalRule, testStyle, updateProactiveFreq, updateEventFreq, updateDisturbMode, updateDisturbSettings, getArtistFavorites, addArtistFavorite, deleteArtistFavorite, listCharacters } from '../api/index.js'
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

const form = ref({ artist: '', width: 1600, height: 1200, momentsArtist: '', momentsWidth: 1600, momentsHeight: 1200, eventArtist: '', eventWidth: 1600, eventHeight: 1200 })
const comfyTab = ref('chat')
const comfyTabs = [
  { mode: 'chat', label: '对话配图' },
  { mode: 'moments', label: '朋友圈配图' },
  { mode: 'event', label: '奇遇配图' },
]
const activeFields = computed(() => {
  if (comfyTab.value === 'moments') return { artist: 'momentsArtist', width: 'momentsWidth', height: 'momentsHeight' }
  if (comfyTab.value === 'event') return { artist: 'eventArtist', width: 'eventWidth', height: 'eventHeight' }
  return { artist: 'artist', width: 'width', height: 'height' }
})
const tabSlideDir = ref('forward')
const comfyTabOrder = { chat: 0, moments: 1, event: 2 }
function switchComfyTab(mode) {
  const prev = comfyTabOrder[comfyTab.value] ?? 0
  const next = comfyTabOrder[mode] ?? 0
  tabSlideDir.value = next > prev ? 'forward' : 'back'
  comfyTab.value = mode
}
const comfyUrl = ref('')
const connDirty = ref(false)
const connSaved = ref(false)
const features = reactive({ emotion: false, memory: false, promptOptimize: false, replyGuesses: false, realtimeAffinityDisplay: false })
const freqSlider = ref(0.5)
const eventFreqSlider = ref(1)

// ── 防打扰模式 ──
const disturbMode = ref(false)
const disturbStartTime = ref('22:00')
const disturbEndTime = ref('08:00')
const disturbCharacterIds = ref([])
const disturbHideWorld = ref(false)
const disturbSkipWeekends = ref(false)
const allCharacters = ref([]) // 全部角色列表（含头像）

// 弹窗状态（编辑期间使用独立副本，确认后才同步）
const disturbDialog = reactive({
  show: false,
  startTime: '22:00',
  endTime: '08:00',
  characterIds: [],
  hideWorld: false,
  skipWeekends: false,
})
const dirty = ref(false)
const saved = ref(false)
const health = ref(null)
const rules = ref([])
const rulesDirty = ref({})
const rulesSaved = ref({})
const rulesExpanded = ref(false)
const ruleLabels = {
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

// ── 画师串收藏夹 ──
const artistFavorites = ref([])
const favDialog = reactive({
  show: false,
  mode: 'chat',
  label: '',
})

async function loadArtistFavorites() {
  try {
    const data = await getArtistFavorites()
    artistFavorites.value = data.favorites || []
  } catch {}
}

function addToFavorites(mode) {
  const artist = (mode === 'moments' ? form.value.momentsArtist : mode === 'event' ? form.value.eventArtist : form.value.artist).trim()
  if (!artist) return
  if (artistFavorites.value.some(f => f.artist === artist)) {
    alert('已收藏过该画师串')
    return
  }
  favDialog.mode = mode
  favDialog.label = artist.length > 20 ? artist.slice(0, 20) + '…' : artist
  favDialog.show = true
}

async function confirmAddFavorite() {
  const artist = (favDialog.mode === 'moments' ? form.value.momentsArtist : favDialog.mode === 'event' ? form.value.eventArtist : form.value.artist).trim()
  const label = favDialog.label.trim() || artist
  try {
    const result = await addArtistFavorite({ label, artist })
    if (result.ok) {
      artistFavorites.value.push(result.favorite)
    }
  } catch (err) {
    console.error('[favorites] add failed:', err)
  }
  favDialog.show = false
}

function cancelAddFavorite() {
  favDialog.show = false
}

const favDialogInput = ref(null)
watch(() => favDialog.show, async (v) => {
  if (v) {
    await nextTick()
    favDialogInput.value?.focus()
    favDialogInput.value?.select()
  }
})

function applyFavorite(fav, mode) {
  if (mode === 'moments') {
    form.value.momentsArtist = fav.artist
  } else if (mode === 'event') {
    form.value.eventArtist = fav.artist
  } else {
    form.value.artist = fav.artist
  }
  markDirty()
}

async function removeFavorite(id) {
  try {
    await deleteArtistFavorite(id)
    artistFavorites.value = artistFavorites.value.filter(f => f.id !== id)
  } catch {}
}

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
      eventArtist: data.comfy.eventArtist || data.comfy.momentsArtist || data.comfy.artist,
      eventWidth: data.comfy.eventWidth || 1600,
      eventHeight: data.comfy.eventHeight || 1200,
    }
    comfyUrl.value = data.comfy.url || 'http://localhost:8188'
    settingsStore.setComfySize(data.comfy.width, data.comfy.height)
    Object.assign(features, data.features)
    freqSlider.value = features.proactiveChatFreq ?? 0.5
    eventFreqSlider.value = features.eventFreq ?? 1
    // 防打扰模式
    if (data.disturb) {
      disturbMode.value = features.disturbMode ?? false
      disturbStartTime.value = data.disturb.startTime || '22:00'
      disturbEndTime.value = data.disturb.endTime || '08:00'
      disturbCharacterIds.value = data.disturb.characterIds || []
      disturbHideWorld.value = data.disturb.hideWorld ?? false
      disturbSkipWeekends.value = data.disturb.skipWeekends ?? false
    }
    llmPreview.value = { ...data.llm }
    llmBaseURL.value = data.llm.baseURL || 'https://api.deepseek.com'
    llmModel.value = data.llm.model || 'deepseek-chat'
  } catch {}
  await checkHealth()
  await loadRules()
  await loadArtistFavorites()
})

function markDirty() { dirty.value = true; saved.value = false }
function markConnDirty() { connDirty.value = true; connSaved.value = false }

async function saveComfy() {
  await updateComfyConfig({
    artist: form.value.artist, width: form.value.width, height: form.value.height,
    momentsArtist: form.value.momentsArtist, momentsWidth: form.value.momentsWidth, momentsHeight: form.value.momentsHeight,
    eventArtist: form.value.eventArtist, eventWidth: form.value.eventWidth, eventHeight: form.value.eventHeight,
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
      settingsStore.setHasApiKey(result.hasApiKey)
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
  } else if (mode === 'event') {
    form.value.eventWidth = p.width; form.value.eventHeight = p.height;
  } else {
    form.value.width = p.width; form.value.height = p.height;
  }
  dirty.value = true; saved.value = false;
}

async function saveFeature(key, val) {
  await updateFeatureFlag(key, val)
}

// 滑块松手时触发，持久化到后端并更新 features
async function onFreqChange() {
  const v = freqSlider.value
  features.proactiveChatFreq = v
  try { await updateProactiveFreq(v) } catch { /* 非关键 */ }
}

async function onEventFreqChange() {
  const v = eventFreqSlider.value
  features.eventFreq = v
  try { await updateEventFreq(v) } catch { /* 非关键 */ }
}

// ── 防打扰模式 ──

async function onDisturbModeToggle() {
  try {
    await updateDisturbMode(disturbMode.value)
    features.disturbMode = disturbMode.value
  } catch { /* 非关键 */ }
}

function openDisturbDialog() {
  // 复制当前已保存的设置到弹窗副本
  disturbDialog.startTime = disturbStartTime.value
  disturbDialog.endTime = disturbEndTime.value
  disturbDialog.characterIds = [...disturbCharacterIds.value]
  disturbDialog.hideWorld = disturbHideWorld.value
  disturbDialog.skipWeekends = disturbSkipWeekends.value
  disturbDialog.show = true
  // 按需加载角色列表
  if (allCharacters.value.length === 0) {
    loadAllCharacters()
  }
}

function cancelDisturbDialog() {
  disturbDialog.show = false
}

async function confirmDisturbDialog() {
  try {
    await updateDisturbSettings({
      startTime: disturbDialog.startTime,
      endTime: disturbDialog.endTime,
      characterIds: [...disturbDialog.characterIds],
      hideWorld: disturbDialog.hideWorld,
      skipWeekends: disturbDialog.skipWeekends,
    })
    // 同步到外层状态
    disturbStartTime.value = disturbDialog.startTime
    disturbEndTime.value = disturbDialog.endTime
    disturbCharacterIds.value = [...disturbDialog.characterIds]
    disturbHideWorld.value = disturbDialog.hideWorld
    disturbSkipWeekends.value = disturbDialog.skipWeekends
    disturbDialog.show = false
  } catch (err) {
    console.error('[disturb] save failed:', err)
  }
}

function toggleDisturbDialogChar(id) {
  const idx = disturbDialog.characterIds.indexOf(id)
  if (idx >= 0) {
    disturbDialog.characterIds.splice(idx, 1)
  } else {
    disturbDialog.characterIds.push(id)
  }
}

async function loadAllCharacters() {
  try {
    const data = await listCharacters()
    allCharacters.value = data.characters || []
  } catch { /* 非关键 */ }
}

async function checkHealth() { health.value = await comfyuiHealth() }

// ── 全局规则 ──
async function loadRules() {
  try {
    const data = await getGlobalRules()
    rules.value = (data.rules || [])
      .filter(r => r.rule_key !== 'world_setting')
      .map(r => ({
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

// ── 重置规则 ──
const resetDialog = reactive({
  show: false,
  key: '',
  preview: '',
})

async function confirmResetRule(rule) {
  resetDialog.key = rule.rule_key
  resetDialog.preview = '加载中…'
  resetDialog.show = true
  try {
    const data = await getDefaultRule(rule.rule_key)
    if (data.ok) {
      resetDialog.preview = data.rule_content
    } else {
      resetDialog.preview = '(无法获取默认值)'
    }
  } catch {
    resetDialog.preview = '(无法获取默认值)'
  }
}

function cancelResetRule() {
  resetDialog.show = false
  resetDialog.key = ''
  resetDialog.preview = ''
}

async function doResetRule() {
  try {
    const result = await resetGlobalRule(resetDialog.key)
    if (result.ok) {
      // 用返回的 rule 内容更新本地
      const idx = rules.value.findIndex(r => r.rule_key === resetDialog.key)
      if (idx !== -1) {
        rules.value[idx].rule_content = result.rule.rule_content
        rules.value[idx]._content = result.rule.rule_content
        rules.value[idx].updated_at = result.rule.updated_at
      }
      rulesDirty.value[resetDialog.key] = false
      rulesSaved.value[resetDialog.key] = true
      setTimeout(() => rulesSaved.value[resetDialog.key] = false, 2000)
    }
  } catch (err) {
    console.error('[rules] reset failed:', err)
  }
  cancelResetRule()
}



// ── 测试画风 ──
const testMode = ref('chat')  // 'chat' | 'moments'
const styleTesting = ref(false)
const styleError = ref('')
const styleImages = ref([])
const styleElapsed = ref(null)  // ms
const styleTiming = ref(null)  // { comfyui_ms, download_ms, overhead_ms }

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
      testMode.value === 'moments' ? form.value.momentsArtist : testMode.value === 'event' ? form.value.eventArtist : form.value.artist,
      testMode.value === 'moments' ? form.value.momentsWidth : testMode.value === 'event' ? form.value.eventWidth : form.value.width,
      testMode.value === 'moments' ? form.value.momentsHeight : testMode.value === 'event' ? form.value.eventHeight : form.value.height,
      testMode.value,
      testPrompts.value[testMode.value] || '',
    )
    if (result.elapsed != null) styleElapsed.value = result.elapsed
    if (result.timing) styleTiming.value = result.timing
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
  chat: `Hatsune Miku (VOCALOID), 1girl, close-up shot, teal twin-tailed hair, blue eyes, black school uniform with tie, holding a fork, looking happily at a matcha mille crepe cake on a white plate, matcha latte with musical note latte art beside it, soft natural lighting, shallow depth of field, cafe background with wooden tables, warm and cozy atmosphere, 1girl, teal-haired Hatsune Miku smiling while eating matcha cake`,
  moments: `2girls, Kiana Kaslana(honkai impact 3rd), white hair in twin braids, blue eyes, wearing a casual outfit, sitting at a cozy café table with a giant strawberry cake in front of her, laughing joyfully. Raiden Mei(honkai impact 3rd) is sitting across from her, smiling softly, two pudding cups on the table. Warm afternoon sunlight streaming through the window, soft bokeh, cute and heartwarming atmosphere, anime style, high quality illustration.`,
  event: `1girl, Hatsune Miku (VOCALOID), teal twin-tailed hair, blue eyes, standing alone on a dimly lit rooftop at dusk, looking over her shoulder with a mysterious expression, one hand reaching toward a glowing floating envelope in the air, city skyline in the distance, warm orange sky fading into deep purple, cinematic lighting, atmospheric, anime style, high quality illustration.`,
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
.page-header.header-hidden { transform: translateY(-200%); margin-bottom: 0; }
.page-header h2 { font-size: 24px; color: var(--text-bright); font-weight: 700; }
.is-clickable { cursor: pointer; }
.hint { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }

.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* ── 保存按钮加宽 ── */
.btn-primary { padding-left: 28px; padding-right: 28px; }

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
/* ── 画师串 Tab 切换：暗轨道 + 亮滑块（iOS 风格） ── */
.comfy-tabs {
  display: flex; gap: 0; margin-bottom: 18px;
  border-radius: 12px;
  background: #e8e2d8;
  padding: 4px;
  box-shadow: inset 0 1px 4px rgba(0,0,0,0.08);
}
.comfy-tab {
  flex: 1; padding: 11px 0; font-size: 13px; font-weight: 600;
  text-align: center; cursor: pointer;
  border-radius: 9px;
  background: transparent; color: #8b8479;
  border: none;
  font-family: inherit;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.comfy-tab:hover:not(.active) {
  color: #6b6459;
}
.comfy-tab.active {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 10px rgba(224, 123, 108, 0.35);
}

/* ── Tab 切换滑动动画 ── */
.comfy-form-stage {
  overflow: hidden;
  position: relative;
}
/* forward: 新内容从右侧滑入，旧内容向左滑出 */
.tab-slide-forward-enter-active,
.tab-slide-forward-leave-active {
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.tab-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.tab-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

/* back: 新内容从左侧滑入，旧内容向右滑出 */
.tab-slide-back-enter-active,
.tab-slide-back-leave-active {
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.tab-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}
.tab-slide-back-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.fi:focus { border-color: var(--accent); }
.fr { display: flex; gap: 14px; }
.fh { flex: 1; }
.fpresets { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 4px 0 16px; }
.pl { font-size: 11px; color: var(--text-secondary); }
.pbtn { font-size: 11px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--glass-border); background: var(--glass-bg-strong); color: var(--text-primary); cursor: pointer; transition: all 0.15s; }
.pbtn:hover { border-color: var(--accent); color: var(--accent-hover); }

/* ── 外部链接高亮 ── */
.ext-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  font-weight: 500;
  transition: color 0.15s;
}
.ext-link:hover { color: var(--accent-hover); }

/* ── 画师串收藏夹 ── */
.fav-input-row { display: flex; gap: 8px; align-items: flex-start; }
.fav-input { flex: 1; margin-bottom: 8px; }
.fav-star-btn {
  width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong); color: var(--text-secondary); cursor: pointer;
  font-size: 16px; line-height: 1; padding: 0; transition: all 0.15s; flex-shrink: 0;
}
.fav-star-btn:hover:not(:disabled) { border-color: #e2a83e; color: #e2a83e; }
.fav-star-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.fav-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.fav-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; padding: 4px 8px; border-radius: 14px;
  border: 1px solid var(--glass-border); background: var(--glass-bg-strong);
  color: var(--text-primary); cursor: pointer; transition: all 0.15s;
}
.fav-chip:hover { border-color: var(--accent); }
.fav-chip.active { border-color: var(--accent); background: rgba(239, 137, 74, 0.1); color: var(--accent); }
.fav-chip-x {
  font-size: 14px; line-height: 1; color: var(--text-secondary); margin-left: 2px;
}
.fav-chip-x:hover { color: var(--danger); }

/* ── 收藏弹窗 ── */
.fav-dialog-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.fav-dialog {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
  width: 400px; max-width: 90vw;
  overflow: hidden;
}
.fav-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 0;
  font-size: 15px; font-weight: 600; color: var(--text-bright);
}
.fav-dialog-close {
  width: 28px; height: 28px; border-radius: 50%;
  background: transparent; color: var(--text-secondary); font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.fav-dialog-close:hover { background: rgba(0,0,0,0.06); color: #333; }
.fav-dialog-body { padding: 12px 20px 20px; }
.fav-dialog-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
.fav-dialog-input {
  width: 100%; padding: 10px 12px; font-size: 14px;
  border-radius: 8px; border: 1px solid #d5d0ca; outline: none;
  transition: border-color 0.2s;
}
.fav-dialog-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }
.fav-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

/* ── 弹窗过渡动画 ── */
.fav-dialog-fade-enter-active { transition: opacity 0.2s ease; }
.fav-dialog-fade-leave-active { transition: opacity 0.15s ease; }
.fav-dialog-fade-enter-active .fav-dialog { animation: fav-pop 0.25s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
.fav-dialog-fade-leave-active .fav-dialog { transition: transform 0.15s ease, opacity 0.15s ease; }
.fav-dialog-fade-enter-from,
.fav-dialog-fade-leave-to { opacity: 0; }
.fav-dialog-fade-leave-to .fav-dialog { transform: scale(0.95); opacity: 0; }

@keyframes fav-pop {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.sa { display: flex; align-items: center; gap: 12px; }
.smsg { color: var(--success); font-size: 13px; }

.toggle-row { display: flex; gap: 14px; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--glass-border); }
.toggle-row:last-child { border-bottom: none; }
.tl { font-size: 14px; font-weight: 500; color: var(--text-bright); }
.td { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

.freq-control {
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
}
.freq-control input[type="range"] {
  border: none;
  width: 100px; accent-color: var(--accent);
  -webkit-appearance: none; appearance: none;
  background: transparent;
}
.freq-control input[type="range"]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px; background: #ffffff;box-shadow: 0 0 2px 1px lightcoral;
}
.freq-control input[type="range"]::-moz-range-track {
  height: 4px; border-radius: 2px; background: #fff;
}
.freq-control input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); margin-top: -6px; cursor: pointer;
}
.freq-control input[type="range"]::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); border: none; cursor: pointer;
}
.freq-val {
  font-size: 14px; font-weight: 600; color: var(--accent); min-width: 28px; text-align: right;
}

/* ── 防打扰模式 ── */
.disturb-setup-btn {
  width: 30px; height: 30px; border-radius: 50%;
  background: transparent; color: var(--text-secondary);
  border: 1px solid transparent;
  cursor: pointer; transition: all 0.2s ease;
  display: flex; align-items: center; justify-content: center;
  margin-right: 6px; flex-shrink: 0;
  font-size: 17px; line-height: 1;
}
.disturb-setup-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: rotate(60deg);
}

/* ── 防打扰弹窗 ── */
.disturb-dialog-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.disturb-dialog {
  background: #fff;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
  width: 640px; max-width: calc(100vw - 48px); max-height: 85vh;
  display: flex; flex-direction: column;
}
/* PC 端圆角弹窗 */
@media (min-width: 768px) {
  .disturb-dialog { border-radius: 16px; }
}
/* 手机端全屏 */
@media (max-width: 767px) {
  .disturb-dialog {
    width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh;
    border-radius: 0;
  }
  .disturb-dialog-overlay { backdrop-filter: none; background: rgba(0, 0, 0, 0.5); }
  .disturb-dialog-header { padding-top: 20px; }
  .disturb-dialog-body { padding-bottom: 32px; }
}
.disturb-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 0;
  font-size: 16px; font-weight: 600; color: var(--text-bright);
  flex-shrink: 0;
}
.disturb-dialog-body {
  padding: 14px 22px 20px;
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
}
.disturb-dialog-section { margin-bottom: 18px; flex-shrink: 0; }
.disturb-dialog-section.disturb-char-scroll {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  margin-bottom: 0;
}
.disturb-dialog-label {
  font-size: 14px; font-weight: 600; color: var(--text-bright);
}
.disturb-dialog-hint {
  font-size: 12px; color: var(--text-secondary); margin: 4px 0 10px;
}
.disturb-time-row {
  display: flex; align-items: center; gap: 10px;
}
.disturb-time-input {
  font-family: inherit;
  padding: 8px 12px;
  border: 1px solid #d5d0ca;
  border-radius: 8px;
  background: #fff;
  color: var(--text-bright);
  font-size: 14px;
  width: 130px;
  outline: none;
  transition: border-color 0.2s;
}
.disturb-time-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }
.disturb-time-sep { color: var(--text-secondary); }
.disturb-no-chars {
  font-size: 13px; color: var(--text-secondary); margin: 8px 0;
}
.disturb-char-grid {
  display: flex; flex-wrap: wrap; gap: 10px;
  overflow-y: auto; flex: 1; min-height: 0;
  align-content: flex-start;
}
.disturb-char-chip {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 12px; border-radius: 12px;
  border: 2px solid transparent;
  background: #f5f3ef;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  min-width: 70px;
}
.disturb-char-chip:hover {
  border-color: #d5d0ca;
  background: #eeebe5;
}
.disturb-char-chip.selected {
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.08);
}
.disturb-char-avatar {
  width: 42px; height: 42px; border-radius: 50%;
  background-size: cover; background-position: center;
  border: 2px solid transparent;
  transition: border-color 0.15s;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 13px; font-weight: 700;
  user-select: none;
}
.disturb-char-chip.selected .disturb-char-avatar {
  border-color: var(--accent);
}
.disturb-char-name {
  font-size: 11px; color: var(--text-secondary); text-align: center;
  max-width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.disturb-char-chip.selected .disturb-char-name {
  color: var(--accent); font-weight: 500;
}
.disturb-dialog-toggles {
  padding-top: 10px; border-top: 1px solid #eee;
  flex-shrink: 0;
}
.disturb-option-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0;
  cursor: pointer; user-select: none;
  flex-wrap: wrap;
}
.disturb-option-label {
  font-size: 13px; font-weight: 500; color: var(--text-bright);
}
.disturb-option-hint {
  flex: 1; min-width: 140px; font-size: 11px; color: var(--text-secondary);
}
.disturb-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; padding-top: 12px;
  border-top: 1px solid #eee;
  flex-shrink: 0;
}

/* ── 弹窗过渡动画 ── */
.disturb-dialog-fade-enter-active { transition: opacity 0.2s ease; }
.disturb-dialog-fade-leave-active { transition: opacity 0.15s ease; }
.disturb-dialog-fade-enter-active .disturb-dialog { animation: disturb-pop 0.25s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
.disturb-dialog-fade-leave-active .disturb-dialog { transition: transform 0.15s ease, opacity 0.15s ease; }
.disturb-dialog-fade-enter-from,
.disturb-dialog-fade-leave-to { opacity: 0; }
.disturb-dialog-fade-leave-to .disturb-dialog { transform: scale(0.95); opacity: 0; }

@keyframes disturb-pop {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.sr { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.sd { width: 9px; height: 9px; border-radius: 50%; }
.sd.on { background: var(--success); }
.sd.off { background: var(--danger); }

/* ── 全局规则折叠 ── */
.card-collapsed {
  cursor: pointer;
  position: relative;
  padding-right: 48px; /* 为右侧箭头留空间，避免文字重叠 */
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.card-collapsed:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(239, 137, 74, 0.12);
}
.collapsible-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: color 0.15s;
}
.collapsible-header:hover { color: var(--accent); }
.collapse-arrow {
  position: absolute;
  top: 50%;
  right: 24px;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  color: var(--text-secondary);
  opacity: 0.6;
  pointer-events: none;
}

/* 展开/合拢过渡 */
.rules-expand-enter-active,
.rules-expand-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.rules-expand-enter-from,
.rules-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.rules-expand-enter-to,
.rules-expand-leave-from {
  opacity: 1;
  max-height: 2000px;
}

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
.btn-reset { margin-left: auto; }
.btn-danger {
  padding: 8px 20px; font-size: 13px; font-weight: 500;
  border-radius: 8px; border: none; cursor: pointer;
  background: var(--danger); color: #fff;
  transition: all 0.15s;
}
.btn-danger:hover { opacity: 0.85; }

/* ── 重置确认弹窗 ── */
.reset-preview {
  margin-top: 12px; padding: 10px 12px;
  border-radius: 8px; background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  max-height: 340px; overflow-y: auto;
}
.reset-preview-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.reset-preview-content {
  font-size: 12px; line-height: 1.6; color: var(--text-primary);
  white-space: pre-wrap; overflow-wrap: break-word; margin: 0;
  font-family: inherit;
}

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
.style-timing-breakdown { font-size: 12px; color: var(--text-muted, #999); }
.style-timing-breakdown::before { content: ' '; }
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
