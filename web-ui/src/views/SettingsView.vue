<template>
  <div ref="scrollEl" class="settings-view" @scroll="onSettingsScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar()" :class="{ 'is-clickable': isMobile }">系统参数</h2>
      <span class="hint">修改即时生效，无需重启</span>
    </div>

    <div class="settings-grid">
      <!-- ComfyUI params: 对话配图 / 朋友圈配图 / 奇遇配图（Tab 切换） -->
      <div class="card comfy-params-card">
        <h3>画师串 & 分辨率</h3>
        <p class="fd">直接描述画面风格 或者 选择0~2个画风，英文逗号分隔，参考来源：<a href="https://anima.mooshieblob.com/" target="_blank" rel="noopener" class="ext-link">https://anima.mooshieblob.com/</a> · 分辨率越高出图越精细，代价是变慢。参考：5070ti 768×512 base约 7s/图|turbo 约2.5s/图</p>

        <div class="comfy-tabs">
          <div v-for="t in comfyTabs" :key="t.mode"
            role="button"
            tabindex="0"
            :class="['comfy-tab', { active: comfyTab === t.mode }]"
            @click="switchComfyTab(t.mode)"
            @keydown.enter.prevent="switchComfyTab(t.mode)"
            @keydown.space.prevent="switchComfyTab(t.mode)"
          >{{ t.label }}</div>
        </div>

        <div class="comfy-form-stage">
          <Transition :name="'tab-slide-' + tabSlideDir" mode="out-in">
            <div :key="comfyTab" class="comfy-form-inner">
              <div class="fav-input-row">
                <input v-model="form[activeFields.artist]" class="fi fav-input" @input="markDirty" placeholder="画师串"/>
                <div
                  role="button"
                  tabindex="0"
                  class="fav-star-btn"
                  :class="{ 'is-disabled': !form[activeFields.artist].trim() }"
                  :aria-disabled="!form[activeFields.artist].trim()"
                  title="收藏当前画师串"
                  @click="addToFavorites(comfyTab)"
                  @keydown.enter.prevent="addToFavorites(comfyTab)"
                  @keydown.space.prevent="addToFavorites(comfyTab)"
                >☆</div>
              </div>
              <template v-if="artistFavorites.length">
                <div class="fav-section-title">收藏的画师 / 风格</div>
                <div class="fav-chips">
                <linshe-button v-for="fav in artistFavorites" :key="fav.id" class="fav-chip" variant="chip" :active="fav.artist === form[activeFields.artist]" @click="applyFavorite(fav, comfyTab)" :title="fav.artist">
                  {{ fav.label }}
                  <span class="fav-chip-x" @click.stop="removeFavorite(fav.id)">×</span>
                </linshe-button>
                </div>
              </template>
              <div class="fr">
                <div class="fh"><label class="fl">宽度</label><linshe-input v-model.number="form[activeFields.width]" type="number" min="256" max="4096" @input="markDirty" /></div>
                <div class="fh"><label class="fl">高度</label><linshe-input v-model.number="form[activeFields.height]" type="number" min="256" max="4096" @input="markDirty" /></div>
              </div>
              <div class="fpresets-head">
                <span class="resolution-title">分辨率</span>
                <span class="resolution-hint">不建议超过 1536×1536 个像素，人体崩坏概率会上升</span>
              </div>
              <div class="fpresets">
                <span class="pl">预设：</span>
                <linshe-button v-for="p in presets" :key="p.label" class="pbtn" variant="chip" :active="isPresetActive(p)" @click="applyPreset(p, comfyTab)">{{ p.label }}</linshe-button>
              </div>
            </div>
          </Transition>
        </div>

        <div class="hiresfix-section">
          <div class="hiresfix-header">
            <span class="hiresfix-title">HiresFix 细化</span>
          </div>
          <div class="hiresfix-row">
            <div class="hiresfix-copy">
              <div class="hiresfix-desc">图片进一步高清细化设置</div>
            </div>
            <span class="hiresfix-summary">最长边 {{ hiresMaxSize }} · {{ hiresSteps }} 步 · 重绘 {{ hiresDenoise }} · CFG {{ hiresCfg }}{{ hiresLoraCount > 0 ? ` · LoRA ${hiresLoraCount}` : '' }}</span>
            <linshe-button class="hiresfix-link" variant="link" @click="openHiresFixSettings">设置 →</linshe-button>
          </div>
        </div>
        <div class="quality-section">
          <div class="quality-row">
            <div class="quality-copy">
              <div class="quality-subtitle">质量提示词</div>
              <div class="quality-desc">生图时注入的画质增强词，留空使用系统默认</div>
            </div>
            <span class="quality-summary" :class="{ 'is-default': !qualityPrompt }" :title="qualityPrompt || '使用工作流内置的质量提示词'">{{ qualityPrompt ? qualityPrompt : '系统默认' }}</span>
            <linshe-button class="quality-link" variant="link" @click="openQualityDialog">更改 →</linshe-button>
          </div>
        </div>
        <div class="sa">
          <linshe-button variant="primary" :disabled="!dirty" @click="saveComfy">保存</linshe-button>
          <span v-if="saved" class="smsg">已保存</span>
          <div class="sa-spacer"></div>
          <linshe-button class="wf-action-btn wf-lora-btn" variant="secondary" @click="openGlobalLora">
            全局LoRA
            <span v-if="globalLoraCount > 0" class="float-badge active">已生效 {{ globalLoraCount }}</span>
          </linshe-button>
          <linshe-button class="wf-action-btn wf-mode-btn" variant="secondary" :disabled="wfResetting" @click="doWorkflowReset2">{{ wfResetting ? '重置中...' : '重置工作流' }}</linshe-button>
          <linshe-button class="wf-action-btn wf-mode-btn" variant="secondary" @click="openWfModeDialog">切换工作流模式</linshe-button>
        </div>
      </div>

      <GlobalLoraModal v-model="globalLoraModalVisible" :initialLoras="globalLoras" @saved="onGlobalLoraSaved" />
      <HiresFixModal v-model="hiresFixModalVisible" :initial-loras="hiresLoras" :initial-steps="hiresSteps" :initial-cfg="hiresCfg" :initial-denoise="hiresDenoise" :initial-max-size="hiresMaxSize" :initial-artist-mode="hiresArtistMode" :initial-artist="hiresArtist" @saved="onHiresFixSaved" />


      <!-- 测试画风：自由画面描述（LLM 完善提示词）或固定提示词测试 -->
      <div class="card">
        <h3>图片实验室</h3>
        <p class="fd">可测试ComfyUI是否正常，使用对应画师串和分辨率发送生图请求，图片仅作预览不保存</p>
        <p class="fd">Anima文生图模型的数据库大约在2025年9月，过新的角色不识别，越久的角色特征越稳定</p>
        <p class="fd">切换模型之后首次生图需要加载模型所以会慢一点</p>

        <div class="free-scene-row">
          <div class="free-scene-input-wrap">
            <textarea
              ref="sceneDescRef"
              v-model="freeSceneDesc"
              class="free-scene-textarea"
              placeholder="（置空使用默认）自由描述任意画面"
              @focus="sceneDescFocused = true"
              @blur="onSceneDescBlur"
            ></textarea>
            <!-- 收起态的单行省略展示（textarea 不支持 ellipsis，用覆盖层实现），点击展开编辑 -->
            <div
              v-if="freeSceneDesc && !sceneDescFocused"
              class="free-scene-ellipsis"
              title="点击展开编辑"
              @mousedown.prevent="focusSceneDesc"
            >{{ freeSceneDesc }}</div>
          </div>
          <!-- 有输入内容时才出现，渐入渐出 -->
          <Transition name="gen-btn-fade">
            <linshe-button
              v-if="freeSceneDesc.trim() || styleTesting"
              class="free-scene-btn"
              variant="primary"
              :disabled="styleTesting || !freeSceneDesc.trim()"
              @click="runFreeSceneTest"
            >
              {{ styleTesting ? '生成中...' : generatedPrompt ? '重新生成提示词' : '生成提示词' }}
            </linshe-button>
          </Transition>
        </div>

        <div
          v-if="generatedPrompt && !promptEditing"
          class="generated-prompt-box editable"
          title="点击编辑提示词"
          @click="startPromptEdit"
        >{{ generatedPrompt }}</div>
        <textarea
          v-else-if="generatedPrompt"
          ref="promptEditRef"
          v-model="generatedPrompt"
          class="generated-prompt-box generated-prompt-editor"
          rows="3"
          @keydown.esc="promptEditing = false"
          @blur="promptEditing = false"
        ></textarea>

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

        <div class="style-test-row">
          <linshe-button
            class="style-test-btn"
            variant="primary"
            :disabled="styleTesting"
            @click="runStyleTest"
          >
            {{ styleTesting ? '生成中...' : '🎨 生成画面' }}
          </linshe-button>
          <div class="test-mode-segmented">
            <div
              role="button"
              tabindex="0"
              :class="['test-mode-btn', { active: testMode === 'chat', 'is-disabled': styleTesting }]"
              :aria-disabled="styleTesting"
              @click="!styleTesting && (testMode = 'chat')"
              @keydown.enter.prevent="!styleTesting && (testMode = 'chat')"
              @keydown.space.prevent="!styleTesting && (testMode = 'chat')"
            >对话参数</div>
            <div
              role="button"
              tabindex="0"
              :class="['test-mode-btn', { active: testMode === 'moments', 'is-disabled': styleTesting }]"
              :aria-disabled="styleTesting"
              @click="!styleTesting && (testMode = 'moments')"
              @keydown.enter.prevent="!styleTesting && (testMode = 'moments')"
              @keydown.space.prevent="!styleTesting && (testMode = 'moments')"
            >朋友圈参数</div>
            <div
              role="button"
              tabindex="0"
              :class="['test-mode-btn', { active: testMode === 'event', 'is-disabled': styleTesting }]"
              :aria-disabled="styleTesting"
              @click="!styleTesting && (testMode = 'event')"
              @keydown.enter.prevent="!styleTesting && (testMode = 'event')"
              @keydown.space.prevent="!styleTesting && (testMode = 'event')"
            >奇遇参数</div>
          </div>
          <linshe-button
            class="style-test-btn hires-test-btn"
            variant="primary"
            :disabled="hireTesting"
            @click="runHiresTest"
          >
            {{ hireTesting ? '细化中...' : '测试HiresFix细化' }}
          </linshe-button>
          <linshe-button class="test-prompt-btn" variant="link" @click="openPromptEditor">默认测试提示词</linshe-button>
        </div>

        <div v-if="hiresError" class="style-error">{{ hiresError }}</div>

        <div v-if="hireTesting" class="style-loading">
          <span class="style-spinner"></span>
          <span>正在按 HiresFix 参数细化最近一张图...</span>
        </div>

        <div v-if="hiresCompare" class="style-result">
          <div class="style-elapsed">细化耗时 {{ formatElapsed(hiresCompare.elapsed) }}</div>
          <BeforeAfterSlider :before="hiresCompare.original" :after="hiresCompare.refined" />
        </div>

        <!-- 全屏预览（纯预览，无删除/重生成/放大操作栏） -->
        <Teleport to="body">
          <ImageLightbox
            :visible="lightboxVisible"
            :imgs="lightboxImgs"
            :index="lightboxIndex"
            :show-delete="false"
            :show-regenerate="false"
            :show-upscale="false"
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
              <linshe-button class="prompt-editor-close" variant="icon" @click="showPromptEditor = false">✕</linshe-button>
            </div>
            <div class="prompt-editor-body">
              <div class="prompt-editor-field">
                <label class="fl">对话配图提示词</label>
                <linshe-input v-model="testPrompts.chat" class="fi prompt-textarea" type="textarea" rows="5" />
              </div>
              <div class="prompt-editor-field">
                <label class="fl">朋友圈配图提示词</label>
                <linshe-input v-model="testPrompts.moments" class="fi prompt-textarea" type="textarea" rows="5" />
              </div>
              <div class="prompt-editor-field">
                <label class="fl">奇遇配图提示词</label>
                <linshe-input v-model="testPrompts.event" class="fi prompt-textarea" type="textarea" rows="5" />
              </div>
            </div>
            <div class="prompt-editor-actions">
              <linshe-button variant="secondary" @click="resetTestPrompts">恢复默认</linshe-button>
              <linshe-button variant="primary" @click="saveTestPrompts">保存</linshe-button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- LLM API 设置 -->
      <div class="card">
        <div class="llm-card-header">
          <h3>LLM API 设置</h3>
          <!-- 每日免费鸡蛋：点击开启/关闭，免 Key 走 opencode zen 免费端点 -->
          <div
            ref="freeEggBtn"
            role="button"
            tabindex="0"
            :class="['free-egg-btn', { active: freeEgg, 'is-disabled': freeEggBusy }]"
            :aria-disabled="freeEggBusy"
            :title="freeEgg ? '点击关闭，恢复自有 LLM 配置' : '点击开启：免 Key 使用 opencode 免费模型，每5小时每IP限200次'"
            @click="onFreeEggClick"
            @keydown.enter.prevent="onFreeEggClick"
            @keydown.space.prevent="onFreeEggClick"
          >
            <span class="free-egg-label">{{ freeEgg ? '🥚 免费鸡蛋享用中' : '🥚 每日免费鸡蛋' }}</span>
            <span v-if="eggSplash" :key="eggSplash.id" class="egg-splash" aria-hidden="true">
              <i v-for="drop in eggSplash.drops" :key="drop.id" class="egg-drop" :style="drop.style"></i>
              <i v-for="shard in eggSplash.shards" :key="shard.id" class="egg-shard" :style="shard.style"></i>
            </span>
          </div>
        </div>

        <Transition name="egg-page" mode="out-in">
        <div v-if="!freeEgg" key="llm-custom" class="llm-api-switch-body">
        <p class="fd">配置 AI 对话和角色生成所使用的 LLM 接口</p>
        <p class="fd">deepseek的key获取地址：<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener" class="ext-link">https://platform.deepseek.com/api_keys</a> ，充多少用多少</p>

        <!-- LLM Profile 切换 -->
        <div class="llm-profiles-bar">
          <div v-for="p in llmProfiles" :key="p.id" class="profile-item-row">
            <div
              role="button"
              tabindex="0"
              :class="['profile-tag', { active: p.id === activeLlmProfileId }]"
              @click="switchProfile(p.id)"
              @keydown.enter.prevent="switchProfile(p.id)"
              @keydown.space.prevent="switchProfile(p.id)"
              :title="(p.preview || '未设置Key') + ' · ' + (p.model || '?')"
            >
              <span class="profile-name">{{ p.name }}</span>
              <span v-if="p.id === activeLlmProfileId" class="profile-dot"></span>
            </div>
            <div
              v-if="llmProfiles.length > 1 && p.id !== activeLlmProfileId"
              role="button"
              tabindex="0"
              class="profile-tag profile-delete-btn"
              @click="removeProfile(p.id)"
              @keydown.enter.prevent="removeProfile(p.id)"
              @keydown.space.prevent="removeProfile(p.id)"
              title="删除该配置"
            >
              <span class="profile-x">×</span>
            </div>
          </div>
          <div role="button" tabindex="0" class="profile-tag profile-add" @click="showAddProfile = true" @keydown.enter.prevent="showAddProfile = true" @keydown.space.prevent="showAddProfile = true">
            <span>+ 新增配置</span>
          </div>
        </div>

        <!-- 新增 Profile 弹窗 -->
        <Teleport to="body">
          <Transition name="add-profile-fade">
            <div v-if="showAddProfile" class="add-profile-overlay" @click.self="showAddProfile = false">
              <div class="add-profile-dialog">
                <h4>新增配置</h4>
                <p class="fd">将当前 LLM 配置（地址、模型、自定义开关等）保存为一个新的配置快照（不含 API Key）</p>
                <linshe-input
                  v-model="newProfileName"
                  class="fi"
                  placeholder="输入配置名称，如：我的OpenAI、本地LLM"
                  @keyup.enter="addProfile"
                  ref="newProfileInput"
                />
                <div class="add-profile-actions">
                  <linshe-button variant="secondary" @click="showAddProfile = false">取消</linshe-button>
                  <linshe-button variant="primary" :disabled="!newProfileName.trim()" @click="addProfile">确定</linshe-button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>

        <!-- API Key -->
        <label class="fl llm-label">API Key</label>
        <div class="apikey-row">
          <linshe-input
            v-model="llmApiKey"
            :type="showApiKey ? 'text' : 'password'"
            class="fi"
            style="margin-bottom:0"
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            @input="markLlmDirty"
          />
          <linshe-button class="sp-btn-small" size="sm" style="flex-shrink:0" title="复制完整 API Key" @click="copyLlmApiKey">复制</linshe-button>
          <linshe-button class="sp-btn-small" variant="ghost" size="sm" style="flex-shrink:0" @click="showApiKey = !showApiKey">
            {{ showApiKey ? '隐藏' : '显示' }}
          </linshe-button>
        </div>
        <div v-if="llmPreview.hasApiKey" class="key-status">
          <span class="key-ok">🔑 当前:</span>
          <code class="key-preview" role="button" tabindex="0" title="点击复制完整 API Key" @click="copyLlmApiKey" @keydown.enter="copyLlmApiKey">{{ llmPreview.preview }}</code>
        </div>
        <div v-else class="key-status key-missing">⚠️ 未设置，AI 对话功能不可用</div>

        <!-- API 地址 -->
        <label class="fl llm-label" style="margin-top:14px">API 地址</label>
        <linshe-select v-model="llmBaseURLSelectVal" :options="llmBaseURLOptions" placeholder="请选择API地址" style="margin-bottom:6px" />
        <linshe-input v-if="isCustomBaseURL" v-model="llmBaseURL" class="fi" placeholder="https://your-api-endpoint/v1" @input="markLlmDirty" />

        <!-- 模型 -->
        <label class="fl llm-label">模型（建议deepseek-v4-flash）</label>
        <div class="llm-model-row">
          <linshe-select
            ref="llmModelSelect"
            v-model="llmModelSelectVal"
            class="llm-model-select"
            :options="llmModelOptions"
            searchable
            allow-free-input
            placeholder="deepseek-v4-flash"
            aria-label="模型"
          />
          <linshe-button
            class="model-fetch-btn"
            variant="secondary"
            :disabled="llmModelsLoading || !llmBaseURL.trim()"
            @click="loadAvailableModels"
          >{{ llmModelsLoading ? '获取中…' : '自动获取' }}</linshe-button>
        </div>
        <p v-if="llmModelsError" class="model-fetch-error" role="alert">{{ llmModelsError }}</p>

        <div v-if="isCustomBaseURL" class="toggle-row thinking-setting">
          <div>
            <div class="tl llm-label">思考模式</div>
            <div class="td">“关”默认禁用思考；“不传”会从请求体中省略 thinking 参数</div>
          </div>
          <div :class="['thinking-options', `is-${llmThinkingMode}`]" role="radiogroup" aria-label="思考模式">
            <label v-for="option in thinkingModeOptions" :key="option.value" class="thinking-option">
              <input v-model="llmThinkingMode" type="radio" name="llm-thinking-mode" :value="option.value" @change="markLlmDirty" />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>

        <template v-if="isCustomBaseURL">
          <div
            role="button"
            tabindex="0"
            class="llm-advanced-toggle"
            :aria-expanded="llmAdvancedOpen"
            @click="toggleLlmAdvanced"
            @keydown.enter.prevent="toggleLlmAdvanced"
            @keydown.space.prevent="toggleLlmAdvanced"
          >
            <span class="llm-advanced-label llm-label">高级设置</span>
            <svg class="llm-advanced-chevron" :class="{ open: llmAdvancedOpen }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
          </div>
          <CollapseTransition :show="llmAdvancedOpen">
            <div class="llm-advanced-body">
              <!-- 自定义请求头（仅自定义API时显示，部分中转站如 OpenRouter 需要） -->
          <div class="toggle-row llm-custom-toggle">
            <div>
              <div class="tl">自定义请求头</div>
              <div class="td">为 OpenRouter 等中转服务附加 HTTP 请求头</div>
            </div>
            <linshe-switch v-model="llmHeadersEnabled" title="启用自定义请求头" aria-label="启用自定义请求头" @change="markLlmDirty" />
          </div>
          <div v-if="llmHeadersEnabled" class="llm-custom-editor">
            <label class="fl" for="llm-custom-headers">请求头 JSON</label>
            <linshe-input
              id="llm-custom-headers"
              v-model="llmHeadersText"
              class="fi llm-json-textarea"
              type="textarea"
              :invalid="!llmHeadersValid"
              placeholder='{"HTTP-Referer":"https://example.com","X-Title":"MyApp"}'
              @input="markLlmDirty"
            />
            <p v-if="!llmHeadersValid" class="gen-error" role="alert">JSON 格式无效</p>
          </div>

          <!-- 自定义请求体参数（仅自定义API时显示，用于注入 body 级参数如 thinking / agent 等） -->
          <div class="toggle-row llm-custom-toggle">
            <div>
              <div class="tl">自定义请求体</div>
              <div class="td">注入 agent 等额外 body 参数；同名字段会覆盖内置参数</div>
            </div>
            <linshe-switch v-model="llmExtraBodyEnabled" title="启用自定义请求体" aria-label="启用自定义请求体" @change="markLlmDirty" />
          </div>
          <div v-if="llmExtraBodyEnabled" class="llm-custom-editor">
            <label class="fl" for="llm-custom-body">请求体 JSON</label>
            <linshe-input
              id="llm-custom-body"
              v-model="llmExtraBodyText"
              class="fi llm-json-textarea"
              type="textarea"
              :invalid="!llmExtraBodyValid"
              placeholder='{"agent":"my-agent","agentName":"Nova"}'
              @input="markLlmDirty"
            />
            <p v-if="!llmExtraBodyValid" class="gen-error" role="alert">JSON 格式无效</p>
          </div>

          <!-- 后台 LLM 任务队列（仅自定义 API 时显示） -->
          <div class="toggle-row llm-option-row" style="padding-top:14px">
            <div>
              <div class="tl">后台 LLM 任务队列</div>
              <div class="td">限制LLM并发数量，避免本地 LLM 过载导致雪崩</div>
            </div>
            <linshe-switch v-model="features.serializeBackgroundLLM" @change="markLlmDirty()" />
          </div>
          <div v-if="features.serializeBackgroundLLM" class="toggle-row freq-row llm-option-row" style="margin-top:8px">
            <div>
              <div class="tl">最大并发后台请求数</div>
              <div class="td">同时运行的后台 LLM 任务数上限</div>
            </div>
            <div class="freq-control">
              <input type="range" min="1" max="10" step="1"
                v-model.number="backgroundConcurrency" @change="markLlmDirty()" />
              <span class="freq-val">{{ backgroundConcurrency }}</span>
            </div>
          </div>

          <div class="toggle-row llm-option-row" style="padding-bottom:4px">
            <div>
              <div class="tl">合并消息兼容更多llm模板</div>
              <div class="td">合并连续Assistant或User消息，解决 LM Studio本地模型或其他llm的模板冲突</div>
            </div>
            <linshe-switch v-model="features.mergeMessages" @change="markLlmDirty()" />
          </div>
            </div>
          </CollapseTransition>
        </template>

        <div class="sa" style="margin-top:12px">
          <linshe-button variant="primary" :disabled="!llmDirty || !llmHeadersValid || !llmExtraBodyValid" @click="saveLlmConfig">保存</linshe-button>
          <span v-if="llmSaved" class="smsg">已保存</span>
          <linshe-button class="llm-test-btn" variant="secondary" :disabled="llmTesting || !llmHeadersValid || !llmExtraBodyValid" @click="runLlmConnectionTest">
            {{ llmTesting ? '测试中…' : '测试连接' }}
          </linshe-button>
          <div
            role="button"
            tabindex="0"
            class="relay-intro-btn relay-intro-footer"
            @click="showRelayModal = true"
            @keydown.enter.prevent="showRelayModal = true"
            @keydown.space.prevent="showRelayModal = true"
          >推荐中转站</div>
        </div>
        </div>

        <!-- 免费鸡蛋模式：隐藏全部 LLM 配置项，仅显示说明 -->
        <div v-else key="llm-free" class="free-egg-notice">
          <span class="free-egg-icon" aria-hidden="true">🥚</span>
          <div class="free-egg-copy">
            <div class="free-egg-title">正在使用 opencode go 免费模型</div>
            <div class="free-egg-desc">每5小时每个IP限额200次请求</div>
            <div class="free-egg-hint">免费模型失败会自动切换；本轮全部失败会自动关闭鸡蛋，改用自有配置重试</div>
          </div>
        </div>
        </Transition>
      </div>

      <!-- 推荐中转站弹窗 -->
      <Teleport to="body">
        <Transition name="relay-modal-fade">
          <div v-if="showRelayModal" class="relay-modal-overlay" @click.self="showRelayModal = false">
            <div class="relay-modal" role="dialog" aria-modal="true" aria-label="推荐中转站">
              <div class="relay-modal-header">
                <h3>推荐中转站</h3>
                <linshe-button class="relay-modal-close" variant="icon" aria-label="关闭" @click="showRelayModal = false">✕</linshe-button>
              </div>
              <div class="relay-modal-body">
                <p class="relay-modal-tip">以下为第三方 LLM 中转站，API Key 请在其官网获取</p>
                <div v-for="station in relayStations" :key="station.name" class="relay-station">
                  <div class="relay-station-head">
                    <span class="relay-station-name">{{ station.name }}</span>
                    <linshe-button class="relay-quick-btn" variant="secondary" :disabled="relayConfigBusy" @click="applyRelayConfig(station)">
                      <svg class="relay-quick-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                      <span>{{ relayConfigBusy ? '新增中…' : '快速配置' }}</span>
                    </linshe-button>
                  </div>
                  <p class="relay-station-desc">{{ station.desc }}</p>
                  <p class="relay-station-line"><a :href="station.keysUrl" target="_blank" rel="noopener" class="ext-link relay-station-link">跳转官网→</a></p>
                </div>
                <p class="relay-sponsor-note">可以注意到以上中转均未支付赞助费，看到请及时支付 <strong>**广告位招租**</strong></p>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>


      <!-- 功能开关 -->
      <div class="card">
        <h3>功能开关</h3>

        <div class="toggle-row">
          <div>
            <div class="tl">好感度系统</div>
            <div class="td">每轮对话后评估 AI 情绪变化，影响回复语气</div>
          </div>
          <linshe-switch v-model="features.emotion" @change="saveFeature('emotion', features.emotion)" />
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">聊天候选词</div>
            <div class="td">LLM回复后预测用户接下来可能说的话，在输入框上方显示快捷候选</div>
          </div>
          <linshe-switch v-model="features.replyGuesses" @change="saveFeature('replyGuesses', features.replyGuesses)" />
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">实时显示好感度</div>
            <div class="td">在聊天顶部实时显示当前好感度数值和最近变化原因</div>
          </div>
          <linshe-switch v-model="features.realtimeAffinityDisplay" @change="saveFeature('realtimeAffinityDisplay', features.realtimeAffinityDisplay)" />
        </div>

        <div class="toggle-row">
          <div>
            <div class="tl">深度思考<span class="beta-tag">测试版</span></div>
            <div class="td">私聊回复前 AI 先在内心盘算用什么形式表达（文字/表情包/照片），思考过程默认折叠显示。</div>
          </div>
          <linshe-switch :model-value="deepThinkMode" @change="onDeepThinkChange" />
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
            <div class="td">0 关闭自动触发，1 为默认频率（约 30 分钟一次）。</div>
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
          ><gear-icon :size="17" /></div>
          <linshe-switch v-model="disturbMode" @change="onDisturbModeToggle" />
        </div>

        <!-- 实时天气 -->
        <div class="toggle-row">
          <div style="flex:1">
            <div class="tl">实时天气</div>
            <div class="td">你将和角色共享天气</div>
          </div>
          <div
            v-if="features.weather"
            class="disturb-setup-btn"
            title="设置城市"
            @click="openWeatherCityDialog"
          ><gear-icon :size="17" /></div>
          <linshe-switch v-model="features.weather" @change="saveFeature('weather', features.weather)" />
        </div>
      </div>

      <!-- ComfyUI 连接 -->
      <div class="card">
        <h3>ComfyUI 连接</h3>
        <p class="fd">ComfyUI 服务地址，默认 http://localhost:8188</p>
        <linshe-input v-model="comfyUrl" class="fi" placeholder="http://localhost:8188" @input="markConnDirty" />
        <label class="cb">
          <input type="checkbox" v-model="comfySkipTls" @change="markConnDirty" />
          <span>跳过 TLS 证书验证（连接云端 HTTPS ComfyUI 失败时勾选）</span>
        </label>
        <div class="sr">
          <span :class="['sd', health?.connected ? 'on' : 'off']"></span>
          <span>{{ health?.connected ? '已连接' : '未连接' }}</span>
        </div>
        <div class="sa" style="margin-top:12px">
          <linshe-button variant="primary" :disabled="!connDirty" @click="saveComfyUrl">保存</linshe-button>
          <span v-if="connSaved" class="smsg">已保存</span>
          <linshe-button variant="secondary" @click="checkHealth">刷新连接</linshe-button>
        </div>
      </div>

      <!-- 聊天记忆 -->
      <div class="card memory-settings-card">
        <div class="memory-settings-header">
          <div>
            <h3>聊天记忆</h3>
            <p>PAI风格记忆整理：让角色记住你们聊过的重要事情，并在之后的聊天中自然想起来</p>
          </div>
        </div>

        <div class="toggle-row memory-settings-row">
          <div class="memory-settings-copy">
            <div class="tl">启用聊天记忆</div>
          </div>
          <linshe-switch v-model="features.memory" title="启用聊天记忆" aria-label="启用聊天记忆" @change="saveFeature('memory', features.memory)" />
        </div>

        <div
          role="button"
          tabindex="0"
          class="memory-settings-entry"
          aria-label="管理聊天记忆：查看、删除记忆，调整查找方式"
          @click="router.push('/settings/memory')"
          @keydown.enter.prevent="router.push('/settings/memory')"
          @keydown.space.prevent="router.push('/settings/memory')"
        >
          <span class="memory-entry-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10M9 4v6M15 14v6" />
            </svg>
          </span>
          <span class="memory-entry-copy">
            <span class="memory-entry-title">管理聊天记忆</span>
            <span class="memory-entry-desc">查看、删除记忆，调整记忆的查找方式</span>
          </span>
          <span class="memory-entry-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </div>
      </div>

      <!-- MaiBot 桥接：入口卡片（复用「聊天记忆」入口样式） -->
      <div class="card memory-settings-card maibot-settings-card">
        <div class="memory-settings-header">
          <div>
            <h3>MaiBot 桥接（需要邻舍v3.0.0以上支持）</h3>
            <p>管理注入到 MaiBot 主聊天流的人格信息（角色卡 / 风格 / 记忆）与全部插件参数</p>
          </div>
        </div>

        <div
          role="button"
          tabindex="0"
          class="memory-settings-entry"
          aria-label="管理 MaiBot 桥接：连接设置、插件配置、人格信息与记忆整理"
          @click="router.push('/settings/maibot')"
          @keydown.enter.prevent="router.push('/settings/maibot')"
          @keydown.space.prevent="router.push('/settings/maibot')"
        >
          <span class="memory-entry-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 6h16v14H4zM9 3h6M10 3v3M14 3v3M7 11h2M7 14h4M15 11h2M15 14h2" />
            </svg>
          </span>
          <span class="memory-entry-copy">
            <span class="memory-entry-title">人格管理</span>
            <span class="memory-entry-desc">连接设置 · 插件配置 · 人格信息 · 最新记忆整理</span>
          </span>
          <span class="memory-entry-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </div>
      </div>

    </div>

    <!-- 收藏画师串弹窗 -->
    <Teleport to="body">
      <Transition name="fav-dialog-fade">
        <div v-if="favDialog.show" class="fav-dialog-overlay">
          <div class="fav-dialog">
            <div class="fav-dialog-header">
              <span>收藏画师串</span>
              <linshe-button class="fav-dialog-close" variant="icon" @click="cancelAddFavorite">✕</linshe-button>
            </div>
            <div class="fav-dialog-body">
              <p class="fav-dialog-desc">为当前画师串起个名字，方便以后快速识别：</p>
              <linshe-input
                ref="favDialogInput"
                v-model="favDialog.label"
                placeholder="输入收藏名称"
                maxlength="30"
                @keyup.enter="confirmAddFavorite"
              />
              <div class="fav-dialog-actions">
                <linshe-button variant="secondary" @click="cancelAddFavorite">取消</linshe-button>
                <linshe-button variant="primary" :disabled="!favDialog.label.trim()" @click="confirmAddFavorite">确认收藏</linshe-button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 质量提示词弹窗 -->
    <Teleport to="body">
      <Transition name="fav-dialog-fade">
        <div v-if="qualityDialog.show" class="fav-dialog-overlay">
          <div class="fav-dialog">
            <div class="fav-dialog-header">
              <span>质量提示词</span>
              <linshe-button class="fav-dialog-close" variant="icon" @click="qualityDialog.show = false">✕</linshe-button>
            </div>
            <div class="fav-dialog-body">
              <p class="fav-dialog-desc">填写英文质量提示词覆盖工作流默认值，留空则使用系统默认</p>
              <linshe-input
                v-model="qualityDialog.text"
                type="textarea"
                rows="4"
                maxlength="500"
                placeholder="masterpiece, best quality..."
              />
              <div class="fav-dialog-actions">
                <linshe-button variant="secondary" @click="qualityDialog.show = false">取消</linshe-button>
                <linshe-button variant="primary" :disabled="qualitySaving" @click="saveQualityPrompt">{{ qualitySaving ? '保存中…' : '保存' }}</linshe-button>
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
              <linshe-button class="fav-dialog-close" variant="icon" @click="cancelDisturbDialog">✕</linshe-button>
            </div>
            <div class="disturb-dialog-body">
              <!-- 时间段设置 -->
              <div class="disturb-dialog-section">
                <span class="disturb-dialog-label">⏰ 静默时段</span>
                <p class="disturb-dialog-hint">在此时段内自动禁用所选角色的朋友圈、主动聊天和奇遇。支持跨午夜（如 22:00 ~ 08:00）。</p>
                <div class="disturb-time-row">
                  <linshe-input type="time" v-model="disturbDialog.startTime" class="disturb-time-input" />
                  <span class="disturb-time-sep">—</span>
                  <linshe-input type="time" v-model="disturbDialog.endTime" class="disturb-time-input" />
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
                  <span class="disturb-option-hint">时段内暂时不向角色注入世界背景设定</span>
                  <linshe-switch v-model="disturbDialog.hideWorld" aria-label="隐藏世界观" />
                </label>
                <label class="disturb-option-row">
                  <span class="disturb-option-label">跳过周末</span>
                  <span class="disturb-option-hint">周六周日不执行防打扰，恢复全部互动</span>
                  <linshe-switch v-model="disturbDialog.skipWeekends" aria-label="跳过周末" />
                </label>
              </div>

              <div class="disturb-dialog-actions">
                <linshe-button variant="secondary" @click="cancelDisturbDialog">取消</linshe-button>
                <linshe-button variant="primary" @click="confirmDisturbDialog">保存设置</linshe-button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 天气城市设置弹窗 -->
    <Teleport to="body">
      <Transition name="disturb-dialog-fade">
        <div v-if="weatherCityDialog.show" class="disturb-dialog-overlay" @click.self="weatherCityDialog.show = false">
          <div class="disturb-dialog" style="max-width:360px;">
            <div class="disturb-dialog-header">
              <span>天气城市设置</span>
              <linshe-button class="fav-dialog-close" variant="icon" @click="weatherCityDialog.show = false">✕</linshe-button>
            </div>
            <div class="disturb-dialog-body" style="padding: 0 24px 16px;">
              <p class="disturb-dialog-hint">输入城市名（中文），留空则自动根据 IP 定位</p>
              <linshe-input type="text" v-model="weatherCityDialog.city" class="fi" placeholder="如：北京、上海、杭州" @keyup.enter="confirmWeatherCity" />
              <div class="disturb-dialog-footer" style="display: flex; margin-top: 16px; justify-content: flex-end;">
                <linshe-button variant="primary" @click="confirmWeatherCity">保存</linshe-button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 工作流模式弹窗 -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showWfModeDialog" class="wf-mode-overlay" @click.self="showWfModeDialog = false">
          <div class="wf-mode-modal">
            <h3>工作流模式</h3>
            <div class="wf-mode-options">
              <div v-for="m in workflowModeOptions" :key="m.value"
                role="button"
                tabindex="0"
                :class="['wf-mode-option', { active: wfModeDraft === m.value }]"
                @click="wfModeDraft = m.value"
                @keydown.enter.prevent="wfModeDraft = m.value"
                @keydown.space.prevent="wfModeDraft = m.value">
                <span class="wf-mo-title">{{ m.label }}</span>
                <span class="wf-mo-desc" v-html="m.desc"></span>
              </div>
            </div>

            <div class="wf-mode-downloads">
              <p class="wf-mode-dl-hint">整合包内一般只有一个模型（检查路径ComfyUI-aki-v3\ComfyUI\models\diffusion_models），如需额外下载：</p>
              <div class="wf-dl-item">
                <span class="wf-dl-label">Anima-turbo：</span>
                <a href="https://civitai.com/api/download/models/3108589?fileId=2988553" target="_blank" rel="noopener">Civitai 下载</a>
                <span class="wf-dl-sep">|</span>
                <a href="https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE" target="_blank" rel="noopener">网盘下载</a>
              </div>
              <div class="wf-dl-item">
                <span class="wf-dl-label">Anima-base：</span>
                <a href="https://civitai.com/api/download/models/2945208?fileId=2824391" target="_blank" rel="noopener">Civitai 下载</a>
                <span class="wf-dl-sep">|</span>
                <a href="https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE" target="_blank" rel="noopener">网盘下载</a>
              </div>
            </div>

            <Transition name="expand">
              <div v-if="wfModeDraft === 'hybrid'" class="wf-mode-scenes">
                <p class="wf-mode-hint">hybrid 模式下可为不同场景分配不同工作流，默认生图用 turbo</p>
                <div v-for="s in sceneOptions" :key="s.key" class="wf-scene-row-h">
                  <span class="wf-scene-name">{{ s.label }}</span>
                  <div class="wf-scene-toggle">
                    <linshe-button class="wf-toggle-btn" variant="chip" size="sm"
                      :active="wfSceneDraft[s.key] === 'turbo'"
                      @click="wfSceneDraft[s.key] = 'turbo'">turbo</linshe-button>
                    <linshe-button class="wf-toggle-btn" variant="chip" size="sm"
                      :active="wfSceneDraft[s.key] === 'base'"
                      @click="wfSceneDraft[s.key] = 'base'">base</linshe-button>
                  </div>
                </div>
              </div>
            </Transition>

            <div class="wf-mode-actions">
              <linshe-button variant="secondary" @click="showWfModeDialog = false">取消</linshe-button>
              <linshe-button variant="primary" :disabled="wfSaving" @click="saveWfModeDialog">{{ wfSaving ? '保存中...' : '保存' }}</linshe-button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { getConfig, updateComfyConfig, updateLlmConfig, testLlmConnection, setLlmFreeEgg, fetchLlmModels, fetchLlmApiKey, updateFeatureFlag, comfyuiHealth, testStyle, testHires, updateProactiveFreq, updateEventFreq, updateBackgroundConcurrency, updateDisturbMode, updateDisturbSettings, updateWeatherCity, getArtistFavorites, addArtistFavorite, deleteArtistFavorite, listCharacters, restoreWorkflow, updateWorkflowMode, updateWorkflowScene, getLlmProfiles, addLlmProfile, deleteLlmProfile, activateLlmProfile, syncActiveLlmProfile } from '../api/index.js'
import { useSettingsStore } from '../stores/settings.js'
import ImageLightbox from '../components/ImageLightbox.vue'
import BeforeAfterSlider from '../components/BeforeAfterSlider.vue'
import LinsheSelect from '../components/ui/LinsheSelect.vue'
import CollapseTransition from '../components/CollapseTransition.vue'
import GlobalLoraModal from '../components/GlobalLoraModal.vue'
import HiresFixModal from '../components/HiresFixModal.vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheInput from '../components/ui/LinsheInput.vue'
import LinsheSwitch from '../components/ui/LinsheSwitch.vue'
import GearIcon from '../components/GearIcon.vue'

const settingsStore = useSettingsStore()
const router = useRouter()
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const toastFn = inject('toast')
const confirmFn = inject('confirm')

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
const globalLoras = ref([])
const globalLoraModalVisible = ref(false)
const hiresFixModalVisible = ref(false)
const globalLoraCount = computed(() => (globalLoras.value || []).filter(l => l.path && l.enabled !== false).length)
const hiresLoras = ref([])
const hiresSteps = ref(35)
const hiresCfg = ref(5)
const hiresDenoise = ref(0.35)
const hiresMaxSize = ref(2000)
const hiresArtistMode = ref('empty')
const hiresArtist = ref('')
const hiresLoraCount = computed(() => (hiresLoras.value || []).filter(l => l.path && l.enabled !== false).length)
// ── 质量提示词（非空覆盖工作流默认，留空不改） ──
const qualityPrompt = ref('')
const qualityDialog = reactive({ show: false, text: '' })
const qualitySaving = ref(false)
const comfyTab = ref('chat')
const comfyTabs = [
  { mode: 'chat', label: '对话配图' },
  { mode: 'moments', label: '朋友圈&信件配图' },
  { mode: 'event', label: '奇遇&日程配图' },
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
const comfySkipTls = ref(false)
const connDirty = ref(false)
const connSaved = ref(false)
const features = reactive({ emotion: false, memory: false, replyGuesses: false, realtimeAffinityDisplay: false, serializeBackgroundLLM: false, backgroundLLMMaxConcurrency: 3, mergeMessages: false, weather: true })
const freqSlider = ref(0.5)
const eventFreqSlider = ref(1)
const backgroundConcurrency = ref(3)

// ── 防打扰模式 ──
const disturbMode = ref(false)
const disturbStartTime = ref('22:00')
const disturbEndTime = ref('08:00')
const disturbCharacterIds = ref([])
const disturbHideWorld = ref(false)
const disturbSkipWeekends = ref(false)
const allCharacters = ref([]) // 全部角色列表（含头像）

// ── 天气 ──
const weatherCity = ref('')
const weatherCityDialog = reactive({ show: false, city: '' })

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

const presets = [
  { label: '768×512', width: 768, height: 512 },
  { label: '768×768', width: 768, height: 768 },
  { label: '1024×1024', width: 1024, height: 1024 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1200×900', width: 1200, height: 900 },
  { label: '1600×1200', width: 1600, height: 1200 },
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
    toastFn('已收藏过该画师串', 'warning')
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
const freeEgg = ref(false)
const llmApiKey = ref('')
const llmBaseURL = ref('https://api.deepseek.com')
const llmModel = ref('deepseek-chat')
const llmModels = ref([])
const llmModelsLoading = ref(false)
const llmModelsError = ref('')
const llmModelSelect = ref(null)
const llmModelOptions = computed(() => llmModels.value.map(model => ({ value: model, label: model })))
const llmModelSelectVal = computed({
  get: () => llmModel.value,
  set: (val) => {
    llmModel.value = val
    markLlmDirty()
  },
})
const llmThinkingMode = ref('disabled')
const thinkingModeOptions = [
  { value: 'enabled', label: '开' },
  { value: 'disabled', label: '关' },
  { value: 'omit', label: '不传' },
]
const isCustomBaseURL = ref(false)
const presetURLs = ['https://api.deepseek.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://api.moonshot.cn/v1', 'https://api.openai.com/v1']
const llmBaseURLOptions = computed(() => [
  { value: 'https://api.deepseek.com', label: 'DeepSeek' },
  { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '通义千问 (DashScope)' },
  { value: 'https://api.moonshot.cn/v1', label: 'Moonshot (Kimi)' },
  { value: 'https://api.openai.com/v1', label: 'OpenAI' },
  { value: '', label: '自定义…' },
])
const llmBaseURLSelectVal = computed({
  get: () => isCustomBaseURL.value ? '' : llmBaseURL.value,
  set: (val) => {
    if (val === '') {
      isCustomBaseURL.value = true
      llmBaseURL.value = ''
    } else {
      isCustomBaseURL.value = false
      llmBaseURL.value = val
      llmHeadersEnabled.value = false
      llmExtraBodyEnabled.value = false
      llmHeadersText.value = '{}'
      llmExtraBodyText.value = '{}'
      features.serializeBackgroundLLM = false
      backgroundConcurrency.value = 3
      features.mergeMessages = false
    }
    markLlmDirty()
  }
})
const llmHeadersEnabled = ref(false)
const llmHeadersText = ref('{}')
const llmHeadersValid = computed(() => {
  if (!llmHeadersEnabled.value) return true
  try { JSON.parse(llmHeadersText.value); return true } catch { return false }
})
const llmExtraBodyEnabled = ref(false)
const llmExtraBodyText = ref('{}')
const llmExtraBodyValid = computed(() => {
  if (!llmExtraBodyEnabled.value) return true
  try { JSON.parse(llmExtraBodyText.value); return true } catch { return false }
})
const showApiKey = ref(false)
const llmDirty = ref(false)
const llmSaved = ref(false)
const llmTesting = ref(false)
function markLlmDirty() { llmDirty.value = true; llmSaved.value = false }

// 高级设置抽屉
const llmAdvancedOpen = ref(false)
function toggleLlmAdvanced() { llmAdvancedOpen.value = !llmAdvancedOpen.value }

// 推荐第三方 LLM 中转站
const showRelayModal = ref(false)
const relayStations = [
  { name: '词元跳动', keysUrl: 'https://tokendance.space/keys', url: 'https://tokendance.space/gateway/v1', desc: '仍然提供v4flash预览版，所以没有涨价' },
  { name: '基元律动', keysUrl: 'https://tokenrhythm.studio/i/rf_tr_sFVpaGViDHbVQrjGtHKXT2in', url: 'https://tokenrhythm.studio/v1', desc: '注册即送68元，邀请还送68元，同样还有flash预览版，但是不够稳定' },
]

const relayConfigBusy = ref(false)

function uniqueProfileName(baseName) {
  const names = new Set(llmProfiles.value.map(p => p.name))
  if (!names.has(baseName)) return baseName
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  let candidate = `${baseName}-${date}`
  let index = 2
  while (names.has(candidate)) {
    candidate = `${baseName}-${date}-${index}`
    index += 1
  }
  return candidate
}

async function applyRelayConfig(station) {
  if (relayConfigBusy.value) return
  relayConfigBusy.value = true
  try {
    isCustomBaseURL.value = true
    llmBaseURL.value = station.url
    llmModel.value = 'deepseek-v4-flash'
    llmThinkingMode.value = 'disabled'
    llmHeadersEnabled.value = false
    llmHeadersText.value = '{}'
    llmExtraBodyEnabled.value = false
    llmExtraBodyText.value = '{}'
    const name = uniqueProfileName(station.name)
    const result = await addLlmProfile(name, {
      apiKey: '',
      baseURL: station.url,
      model: 'deepseek-v4-flash',
      thinkingMode: 'disabled',
      headers: {},
      extraBody: {},
      serializeBackgroundLLM: false,
      mergeMessages: false,
      backgroundConcurrency: 3,
    })
    if (!result.ok) throw new Error(result.error || '新增配置失败')
    const profiles = result.profiles || []
    llmProfiles.value = profiles
    const created = profiles.find(p => p.name === name)
    if (!created) throw new Error('未找到新增配置')
    await switchProfile(created.id)
    if (activeLlmProfileId.value !== created.id) throw new Error('启用新配置失败')
    showRelayModal.value = false
    toastFn?.(`已新增并启用「${name}」`, 'success')
  } catch (err) {
    toastFn?.('快速配置失败: ' + (err.message || '未知错误'), 'error')
  } finally {
    relayConfigBusy.value = false
  }
}

// 每日免费鸡蛋：点击按钮开/关；开 = 走 opencode zen 免费端点（免 Key、强制关思考），关 = 恢复自有配置
const freeEggBusy = ref(false)
const freeEggBtn = ref(null)
const eggSplash = ref(null)
let eggSplashSeq = 0

function burstEggSplash() {
  const btn = freeEggBtn.value
  if (btn) {
    btn.animate(
      [
        { transform: 'scale(1.02, 0.8) rotate(-2deg)', boxShadow: 'inset 0 0 0 5px rgba(255, 214, 70, 0.95)', filter: 'brightness(1.5)' },
        { transform: 'scale(1.12, 1.24) rotate(2deg)', boxShadow: 'inset 0 0 0 2px rgba(255, 214, 70, 0.45)', filter: 'brightness(1.2)', offset: 0.35 },
        { transform: 'scale(0.96, 1.04) rotate(0deg)', boxShadow: 'inset 0 0 0 0 rgba(255, 214, 70, 0)', filter: 'brightness(1.02)', offset: 0.68 },
        { transform: 'scale(1, 1) rotate(0deg)', boxShadow: 'inset 0 0 0 0 rgba(255, 214, 70, 0)', filter: 'brightness(1)' }
      ],
      { duration: 460, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1.35)' }
    )
  }

  const drops = []
  const dropColors = ['#ffd83d', '#ffc61a', '#fff3c4', '#ffb02e', '#ffe38a']
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.55
    const dist = 52 + Math.random() * 88
    const x = Math.cos(angle) * dist
    const y = Math.sin(angle) * dist
    const size = 4 + Math.random() * 7
    drops.push({
      id: i,
      style: {
        '--x': `${x.toFixed(1)}px`,
        '--y': `${y.toFixed(1)}px`,
        '--mx': `${(x * 0.6).toFixed(1)}px`,
        '--my': `${(y * 0.6).toFixed(1)}px`,
        '--fall': `${(16 + Math.random() * 44).toFixed(1)}px`,
        '--size': `${size.toFixed(1)}px`,
        '--rot': `${(angle * 180 / Math.PI + 90).toFixed(1)}deg`,
        '--dur': `${(540 + Math.random() * 340).toFixed(0)}ms`,
        '--delay': `${(Math.random() * 40).toFixed(0)}ms`,
        '--color': dropColors[i % dropColors.length]
      }
    })
  }

  const shards = []
  for (let i = 0; i < 7; i++) {
    const angle = (Math.PI * 2 * i) / 7 + (Math.random() - 0.5) * 0.7
    const dist = 66 + Math.random() * 60
    const x = Math.cos(angle) * dist
    const y = Math.sin(angle) * dist
    const size = 7 + Math.random() * 6
    shards.push({
      id: i,
      style: {
        '--x': `${x.toFixed(1)}px`,
        '--y': `${y.toFixed(1)}px`,
        '--mx': `${(x * 0.55).toFixed(1)}px`,
        '--my': `${(y * 0.55).toFixed(1)}px`,
        '--size': `${size.toFixed(1)}px`,
        '--rot': `${(angle * 180 / Math.PI).toFixed(1)}deg`,
        '--dur': `${(620 + Math.random() * 260).toFixed(0)}ms`,
        '--delay': `${(Math.random() * 35).toFixed(0)}ms`
      }
    })
  }

  eggSplash.value = { id: ++eggSplashSeq, drops, shards }
}

function onFreeEggClick() {
  if (freeEggBusy.value) return
  burstEggSplash()
  toggleFreeEgg()
}
async function toggleFreeEgg() {
  if (freeEggBusy.value) return
  freeEggBusy.value = true
  freeEgg.value = !freeEgg.value
  try {
    const result = await setLlmFreeEgg(freeEgg.value)
    if (result.ok) {
      llmPreview.value = { ...result }
      settingsStore.setHasApiKey(result.hasApiKey)
      llmApiKey.value = ''
      llmDirty.value = false
      llmSaved.value = false
      toastFn?.(freeEgg.value ? '已开启每日免费鸡蛋 🥚' : '已恢复自有 LLM 配置', 'success')
    }
  } catch (err) {
    freeEgg.value = !freeEgg.value
    toastFn?.('切换免费鸡蛋失败: ' + (err.message || '未知错误'), 'error')
  } finally {
    freeEggBusy.value = false
  }
}

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
  return Promise.resolve()
}

async function copyLlmApiKey() {
  let key = llmApiKey.value.trim()
  if (!key) {
    try {
      const data = await fetchLlmApiKey()
      key = data.apiKey || ''
    } catch (err) {
      const msg = err.message || '未知错误'
      toastFn?.(msg === '未设置 API Key' ? '暂无 API Key 可复制' : '获取 API Key 失败: ' + msg, msg === '未设置 API Key' ? 'warning' : 'error')
      return
    }
  }
  if (!key) {
    toastFn?.('暂无 API Key 可复制', 'warning')
    return
  }
  try {
    await copyTextToClipboard(key)
    toastFn?.('API Key 已复制', 'success')
  } catch (err) {
    toastFn?.('复制失败: ' + (err.message || '未知错误'), 'error')
  }
}

async function loadAvailableModels() {
  if (llmModelsLoading.value || !llmBaseURL.value.trim()) return
  if (llmHeadersEnabled.value && !llmHeadersValid.value) {
    llmModelsError.value = '请先修正自定义请求头 JSON'
    return
  }

  llmModelsLoading.value = true
  llmModelsError.value = ''
  llmModels.value = []
  try {
    const headers = llmHeadersEnabled.value ? JSON.parse(llmHeadersText.value) : {}
    const result = await fetchLlmModels({
      baseURL: llmBaseURL.value.trim(),
      apiKey: llmApiKey.value.trim() || undefined,
      headers,
    })
    llmModels.value = result.models || []
    if (llmModels.value.length) llmModelSelect.value?.open()
  } catch (error) {
    llmModelsError.value = error.message || '获取模型失败'
    toastFn?.(llmModelsError.value, 'error')
  } finally {
    llmModelsLoading.value = false
  }
}

// ── LLM Profile 切换 ──
const llmProfiles = ref([])
const activeLlmProfileId = ref('')
const showAddProfile = ref(false)
const newProfileName = ref('')
const newProfileInput = ref(null)
watch(() => showAddProfile.value, async (v) => {
  if (v) {
    newProfileName.value = ''
    await nextTick()
    newProfileInput.value?.focus()
  }
})

async function loadLlmProfiles(data) {
  if (data) {
    llmProfiles.value = data.llmProfiles || []
    activeLlmProfileId.value = data.activeLlmProfileId || ''
  } else {
    const res = await getLlmProfiles()
    llmProfiles.value = res.profiles || []
    activeLlmProfileId.value = res.activeProfileId || ''
  }
}

async function switchProfile(id) {
  if (id === activeLlmProfileId.value) return
  try {
    const result = await activateLlmProfile(id)
    if (result.ok) {
      activeLlmProfileId.value = result.activeProfileId
      llmProfiles.value = result.profiles || []
      if (result.llmConfig) {
        llmPreview.value = { ...result.llmConfig }
        llmBaseURL.value = result.llmConfig.baseURL || 'https://api.deepseek.com'
        llmModel.value = result.llmConfig.model || 'deepseek-chat'
        llmThinkingMode.value = result.llmConfig.thinkingMode || 'disabled'
        const hasCustom = (result.llmConfig.headers && Object.keys(result.llmConfig.headers).length > 0)
          || (result.llmConfig.extraBody && Object.keys(result.llmConfig.extraBody).length > 0)
        isCustomBaseURL.value = !presetURLs.includes(llmBaseURL.value) || hasCustom
        llmHeadersEnabled.value = Boolean(result.llmConfig.headers && Object.keys(result.llmConfig.headers).length)
        llmExtraBodyEnabled.value = Boolean(result.llmConfig.extraBody && Object.keys(result.llmConfig.extraBody).length)
        llmHeadersText.value = result.llmConfig.headers && Object.keys(result.llmConfig.headers).length
          ? JSON.stringify(result.llmConfig.headers, null, 2) : '{}'
        llmExtraBodyText.value = result.llmConfig.extraBody && Object.keys(result.llmConfig.extraBody).length
          ? JSON.stringify(result.llmConfig.extraBody, null, 2) : '{}'
        settingsStore.setHasApiKey(result.llmConfig.hasApiKey)
        llmApiKey.value = ''
        llmDirty.value = false
        llmSaved.value = false
        // 刷新完整的 features 和 concurrency（profile 切换会影响这些）
        const cfg = await getConfig()
        Object.assign(features, cfg.features)
        backgroundConcurrency.value = cfg.features.backgroundLLMMaxConcurrency ?? 3
        freqSlider.value = cfg.features.proactiveChatFreq ?? 0.5
        eventFreqSlider.value = cfg.features.eventFreq ?? 1
      }
    }
  } catch (err) {
    console.error('[llm] switch profile failed:', err)
  }
}

async function addProfile() {
  const name = newProfileName.value.trim()
  if (!name) return
  try {
    await addLlmProfile(name)
    showAddProfile.value = false
    newProfileName.value = ''
    await loadLlmProfiles()
  } catch (err) {
    console.error('[llm] add profile failed:', err)
  }
}

async function removeProfile(id) {
  const profile = llmProfiles.value.find(p => p.id === id)
  const name = profile?.name || '该配置'
  const title = `删除「${name}」`
  const body = llmProfiles.value.length <= 1
    ? '这是最后一套配置，不可删除'
    : `将删除该配置快照，当前正在使用的配置不受影响，此操作不可撤销`

  if (!confirmFn) {
    if (!window.confirm(`${title}\n\n${body}`)) return
  } else {
    const ok = await confirmFn({ title, message: body, danger: true, okText: '删除' })
    if (!ok) return
  }
  if (llmProfiles.value.length <= 1) return
  try {
    const result = await deleteLlmProfile(id)
    if (result.ok) {
      llmProfiles.value = result.profiles || []
      activeLlmProfileId.value = result.activeProfileId || ''
      // 如果删除的是激活的，需要刷新当前配置
      const cfg = await getConfig()
      llmPreview.value = { ...cfg.llm }
      llmBaseURL.value = cfg.llm.baseURL || 'https://api.deepseek.com'
      llmModel.value = cfg.llm.model || 'deepseek-chat'
      llmThinkingMode.value = cfg.llm.thinkingMode || 'disabled'
      const hasCustom = (cfg.llm.headers && Object.keys(cfg.llm.headers).length > 0)
        || (cfg.llm.extraBody && Object.keys(cfg.llm.extraBody).length > 0)
        || cfg.features?.mergeMessages
      isCustomBaseURL.value = !presetURLs.includes(llmBaseURL.value) || hasCustom
      llmHeadersEnabled.value = Boolean(cfg.llm.headers && Object.keys(cfg.llm.headers).length)
      llmExtraBodyEnabled.value = Boolean(cfg.llm.extraBody && Object.keys(cfg.llm.extraBody).length)
      llmHeadersText.value = cfg.llm.headers && Object.keys(cfg.llm.headers).length
        ? JSON.stringify(cfg.llm.headers, null, 2) : '{}'
      llmExtraBodyText.value = cfg.llm.extraBody && Object.keys(cfg.llm.extraBody).length
        ? JSON.stringify(cfg.llm.extraBody, null, 2) : '{}'
      Object.assign(features, cfg.features)
      backgroundConcurrency.value = cfg.features.backgroundLLMMaxConcurrency ?? 3
      settingsStore.setHasApiKey(cfg.llm.hasApiKey)
      llmApiKey.value = ''
      llmDirty.value = false
      llmSaved.value = false
    }
  } catch (err) {
    console.error('[llm] delete profile failed:', err)
  }
}

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
    globalLoras.value = data.comfy.globalLora || []
    hiresLoras.value = data.comfy.hiresLora || []
    hiresSteps.value = data.comfy.hiresSteps ?? 35
    hiresCfg.value = data.comfy.hiresCfg ?? 5
    hiresDenoise.value = data.comfy.hiresDenoise ?? 0.35
    hiresMaxSize.value = data.comfy.hiresMaxSize ?? 2000
    hiresArtistMode.value = data.comfy.hiresArtistMode ?? 'empty'
    hiresArtist.value = data.comfy.hiresArtist ?? ''
    qualityPrompt.value = data.comfy.qualityPrompt ?? ''
    comfyUrl.value = data.comfy.url || 'http://localhost:8188'
    comfySkipTls.value = data.comfy.tlsVerify === false
    settingsStore.setComfySize(data.comfy.width, data.comfy.height)
    Object.assign(features, data.features)
    freqSlider.value = features.proactiveChatFreq ?? 0.5
    eventFreqSlider.value = features.eventFreq ?? 1
    backgroundConcurrency.value = features.backgroundLLMMaxConcurrency ?? 3
    // 防打扰模式
    if (data.disturb) {
      disturbMode.value = features.disturbMode ?? false
      disturbStartTime.value = data.disturb.startTime || '22:00'
      disturbEndTime.value = data.disturb.endTime || '08:00'
      disturbCharacterIds.value = data.disturb.characterIds || []
      disturbHideWorld.value = data.disturb.hideWorld ?? false
      disturbSkipWeekends.value = data.disturb.skipWeekends ?? false
    }
    weatherCity.value = data.weather?.city || ''
    llmPreview.value = { ...data.llm }
    freeEgg.value = data.llm?.freeEgg === true
    llmBaseURL.value = data.llm.baseURL || 'https://api.deepseek.com'
    llmModel.value = data.llm.model || 'deepseek-chat'
    llmThinkingMode.value = data.llm.thinkingMode || 'disabled'
    const hasCustom = (data.llm.headers && Object.keys(data.llm.headers).length > 0)
      || (data.llm.extraBody && Object.keys(data.llm.extraBody).length > 0)
      || data.features?.mergeMessages
    isCustomBaseURL.value = !presetURLs.includes(llmBaseURL.value) || hasCustom
    llmHeadersEnabled.value = Boolean(data.llm.headers && Object.keys(data.llm.headers).length)
    llmExtraBodyEnabled.value = Boolean(data.llm.extraBody && Object.keys(data.llm.extraBody).length)
    llmHeadersText.value = data.llm.headers && Object.keys(data.llm.headers).length
      ? JSON.stringify(data.llm.headers, null, 2) : '{}'
    llmExtraBodyText.value = data.llm.extraBody && Object.keys(data.llm.extraBody).length
      ? JSON.stringify(data.llm.extraBody, null, 2) : '{}'
    if (data.workflow) {
      workflowMode.value = data.workflow.mode || 'turbo'
      workflowScene.value = { chat: 'turbo', group: 'base', moments: 'base', events: 'base', schedule: 'base', mailbox: 'base', ...data.workflow.scene }
    }
    loadLlmProfiles(data)
  } catch {}
  await checkHealth()
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
  settingsStore.setEventSize(form.value.eventWidth, form.value.eventHeight)
  dirty.value = false; saved.value = true
  setTimeout(() => saved.value = false, 2000)
}

function onGlobalLoraSaved(globalList) {
  if (Array.isArray(globalList)) globalLoras.value = globalList
}

function onHiresFixSaved({ loras, steps, cfg, denoise, maxSize, artistMode, artist }) {
  if (Array.isArray(loras)) hiresLoras.value = loras
  if (steps !== undefined) hiresSteps.value = steps
  if (cfg !== undefined) hiresCfg.value = cfg
  if (denoise !== undefined) hiresDenoise.value = denoise
  if (maxSize !== undefined) hiresMaxSize.value = maxSize
  if (artistMode !== undefined) hiresArtistMode.value = artistMode
  if (artist !== undefined) hiresArtist.value = artist
}

function openGlobalLora() {
  globalLoraModalVisible.value = true
}

function openHiresFixSettings() {
  hiresFixModalVisible.value = true
}

function openQualityDialog() {
  qualityDialog.text = qualityPrompt.value
  qualityDialog.show = true
}

async function saveQualityPrompt() {
  qualitySaving.value = true
  try {
    const text = qualityDialog.text.trim()
    await updateComfyConfig({ qualityPrompt: text })
    qualityPrompt.value = text
    qualityDialog.show = false
    toastFn(text ? '质量提示词已更新，下张图生效' : '已恢复系统默认质量提示词', 'success')
  } catch (e) {
    console.error('saveQualityPrompt failed:', e)
    toastFn(e.message || '保存失败', 'error')
  } finally {
    qualitySaving.value = false
  }
}

async function saveComfyUrl() {
  comfyUrl.value = comfyUrl.value.replace(/\/+$/, '')
  await updateComfyConfig({ url: comfyUrl.value, tlsVerify: !comfySkipTls.value })
  connDirty.value = false; connSaved.value = true
  setTimeout(() => connSaved.value = false, 2000)
  // 保存后立即刷新连接状态
  await checkHealth()
}

function buildLlmPayload() {
  const payload = {}
  if (llmApiKey.value.trim()) payload.apiKey = llmApiKey.value.trim()
  if (llmBaseURL.value) payload.baseURL = llmBaseURL.value
  if (llmModel.value) payload.model = llmModel.value
  payload.thinkingMode = llmThinkingMode.value
  payload.headers = isCustomBaseURL.value && llmHeadersEnabled.value
    ? JSON.parse(llmHeadersText.value)
    : {}
  payload.extraBody = isCustomBaseURL.value && llmExtraBodyEnabled.value
    ? JSON.parse(llmExtraBodyText.value)
    : {}
  return payload
}

async function runLlmConnectionTest() {
  if (llmTesting.value) return
  if (!llmHeadersValid.value || !llmExtraBodyValid.value) {
    toastFn?.('请先修正 LLM 自定义请求头或请求体 JSON', 'warning')
    return
  }
  if (!llmBaseURL.value.trim()) {
    toastFn?.('请先填写 API 地址', 'warning')
    return
  }

  llmTesting.value = true
  try {
    const result = await testLlmConnection(buildLlmPayload())
    const parts = ['LLM 连接成功']
    if (result.model) parts.push(result.model)
    if (result.latencyMs != null) parts.push(`${result.latencyMs}ms`)
    toastFn?.(parts.join(' · '), 'success')
  } catch (err) {
    toastFn?.('LLM 连接失败: ' + (err.message || '未知错误'), 'error')
  } finally {
    llmTesting.value = false
  }
}

async function saveLlmConfig() {

  try {
    const payload = buildLlmPayload()
    const result = await updateLlmConfig(payload)
    if (result.ok) {
      settingsStore.setHasApiKey(result.hasApiKey)
      llmPreview.value = { ...result }
      llmBaseURL.value = result.baseURL || llmBaseURL.value
      llmModel.value = result.model || llmModel.value
      llmThinkingMode.value = result.thinkingMode || 'disabled'
      llmHeadersEnabled.value = Boolean(result.headers && Object.keys(result.headers).length)
      llmExtraBodyEnabled.value = Boolean(result.extraBody && Object.keys(result.extraBody).length)
      llmHeadersText.value = result.headers && Object.keys(result.headers).length
        ? JSON.stringify(result.headers, null, 2) : '{}'
      llmExtraBodyText.value = result.extraBody && Object.keys(result.extraBody).length
        ? JSON.stringify(result.extraBody, null, 2) : '{}'
      if (payload.apiKey) llmApiKey.value = ''

      // 保存后台 LLM 任务队列设置（仅自定义 API 时有效，否则强制关闭）
      if (isCustomBaseURL.value) {
        await updateFeatureFlag('serializeBackgroundLLM', features.serializeBackgroundLLM)
        if (features.serializeBackgroundLLM) {
          await updateBackgroundConcurrency(backgroundConcurrency.value)
        }
        await updateFeatureFlag('mergeMessages', features.mergeMessages)
      } else {
        features.serializeBackgroundLLM = false
        backgroundConcurrency.value = 3
        await updateFeatureFlag('serializeBackgroundLLM', false)
        features.mergeMessages = false
        await updateFeatureFlag('mergeMessages', false)
      }

      await syncActiveLlmProfile()

      llmDirty.value = false
      llmSaved.value = true
      setTimeout(() => llmSaved.value = false, 2000)
    }
  } catch (err) {
    console.error('[llm] save failed:', err)
  }
}

function isPresetActive(p) {
  const f = activeFields.value
  return form.value[f.width] === p.width && form.value[f.height] === p.height
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

// ── 深度思考（测试版）：开关在 settings store 持久化，聊天页实时读取 ──
const deepThinkMode = computed(() => settingsStore.deepThinkMode)
function onDeepThinkChange(v) {
  settingsStore.setDeepThinkMode(v)
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

// ── 天气城市设置 ──

function openWeatherCityDialog() {
  weatherCityDialog.city = weatherCity.value
  weatherCityDialog.show = true
}

async function confirmWeatherCity() {
  try {
    await updateWeatherCity(weatherCityDialog.city || '')
    weatherCity.value = weatherCityDialog.city
    settingsStore.setWeatherCity(weatherCity.value)
    weatherCityDialog.show = false
  } catch (err) {
    console.error('[weather] save city failed:', err)
  }
}

async function loadAllCharacters() {
  try {
    const data = await listCharacters()
    allCharacters.value = data.characters || []
  } catch { /* 非关键 */ }
}

async function checkHealth() { health.value = await comfyuiHealth() }



// ── 测试画风 ──
const testMode = ref('chat')  // 'chat' | 'moments'
const styleTesting = ref(false)
const styleError = ref('')
const styleImages = ref([])
const styleElapsed = ref(null)  // ms
const styleTiming = ref(null)  // { comfyui_ms, download_ms, overhead_ms }
const freeSceneDesc = ref('')  // 自由画面描述（LLM 完善提示词）
const generatedPrompt = ref('')  // 自由画面描述生成的 prompt 展示
const promptEditing = ref(false)  // prompt 展示框的点击编辑态
const promptEditRef = ref(null)

// 点击 prompt 框进入编辑：textarea 保持点击前的展示高度，光标定位到末尾
async function startPromptEdit(e) {
  const boxHeight = e?.currentTarget?.offsetHeight
  promptEditing.value = true
  await nextTick()
  const el = promptEditRef.value
  if (el) {
    if (boxHeight) el.style.height = `${boxHeight}px`
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }
}

// 画面描述框：收起态单行省略展示 ↔ 聚焦展开编辑
const sceneDescFocused = ref(false)
const sceneDescRef = ref(null)

// 点击收起态的省略展示 → 展开编辑，光标到末尾
function focusSceneDesc() {
  const el = sceneDescRef.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

// 失焦收起：清掉手动拖高的内联高度，回到单行
function onSceneDescBlur(e) {
  sceneDescFocused.value = false
  e.target.style.height = ''
}
const hireTesting = ref(false)
const hiresError = ref('')
const hiresCompare = ref(null)

// ── 工作流 ──
const workflowModeOptions = [
  { value: 'turbo', label: 'turbo', desc: '只用 Anima_turbo 模型，<span class="wf-mo-highlight">速度提升300%+</span>，但代价是构图能力下降，画师串影响略微下降' },
  { value: 'base', label: 'base', desc: '只用 Anima_base 模型，泛用性最强的基底模型，构图能力强，画师串遵循强，速度较慢' },
  { value: 'hybrid', label: 'base+turbo', desc: 'turbo + base，切换时需要加载模型导致首图较慢' },
]
const sceneOptions = [
  { key: 'chat', label: '私聊' },
  { key: 'group', label: '群聊' },
  { key: 'moments', label: '朋友圈' },
  { key: 'events', label: '奇遇' },
  { key: 'schedule', label: '日程' },
  { key: 'mailbox', label: '信箱' },
]

const workflowMode = ref('turbo')
const workflowScene = ref({ chat: 'turbo', group: 'base', moments: 'base', events: 'base', schedule: 'base', mailbox: 'base' })
const wfResetting = ref(false)
const wfSaving = ref(false)
const showWfModeDialog = ref(false)

// 弹窗草稿状态
const wfModeDraft = ref('turbo')
const wfSceneDraft = ref({ chat: 'turbo', group: 'base', moments: 'base', events: 'base', schedule: 'base', mailbox: 'base' })

function openWfModeDialog() {
  wfModeDraft.value = workflowMode.value
  wfSceneDraft.value = { ...workflowScene.value }
  showWfModeDialog.value = true
}

async function saveWfModeDialog() {
  wfSaving.value = true
  try {
    const modeChanged = wfModeDraft.value !== workflowMode.value
    const sceneChanged = JSON.stringify(wfSceneDraft.value) !== JSON.stringify(workflowScene.value)

    if (modeChanged) await updateWorkflowMode(wfModeDraft.value)
    if (sceneChanged || modeChanged) await updateWorkflowScene({ ...wfSceneDraft.value })

    workflowMode.value = wfModeDraft.value
    workflowScene.value = { ...wfSceneDraft.value }
    showWfModeDialog.value = false
  } catch {} finally { wfSaving.value = false }
}

async function doWorkflowReset2() {
  const ok = await confirmFn({
    title: '重置工作流',
    message: '将用内置模板覆盖现有的\n制图工作流.json 和 制图工作流-pro.json',
    okText: '重置',
  })
  if (!ok) return
  wfResetting.value = true
  try {
    await restoreWorkflow()
  } catch {} finally { wfResetting.value = false }
}

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

async function executeStyleTest({ prompt = '', sceneDesc = '', reuseSceneLoras = false } = {}) {
  styleTesting.value = true
  styleError.value = ''
  styleImages.value = []
  styleElapsed.value = null
  styleTiming.value = null
  promptEditing.value = false

  try {
    const isMoments = testMode.value === 'moments'
    const isEvent = testMode.value === 'event'
    const result = await testStyle({
      artist: isMoments ? form.value.momentsArtist : isEvent ? form.value.eventArtist : form.value.artist,
      width: isMoments ? form.value.momentsWidth : isEvent ? form.value.eventWidth : form.value.width,
      height: isMoments ? form.value.momentsHeight : isEvent ? form.value.eventHeight : form.value.height,
      mode: testMode.value,
      prompt,
      sceneDesc,
      reuseSceneLoras,
    })
    if (sceneDesc && result.generatedPrompt) generatedPrompt.value = result.generatedPrompt
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

function runStyleTest() {
  // textarea 有内容且已生成过提示词 → 直接复用（含匹配角色 lora），不再走 LLM
  if (freeSceneDesc.value.trim() && generatedPrompt.value) {
    return executeStyleTest({ prompt: generatedPrompt.value, reuseSceneLoras: true })
  }
  generatedPrompt.value = ''
  return executeStyleTest({ prompt: testPrompts.value[testMode.value] || '' })
}

// 自由画面描述 → 后端分层 LLM 链路完善提示词后生图
function runFreeSceneTest() {
  const desc = freeSceneDesc.value.trim()
  if (!desc || styleTesting.value) return
  generatedPrompt.value = ''
  return executeStyleTest({ sceneDesc: desc })
}

async function runHiresTest() {
  hireTesting.value = true
  hiresError.value = ''
  hiresCompare.value = null
  try {
    const result = await testHires()
    if (result.success && result.original && result.refined) {
      hiresCompare.value = { original: result.original, refined: result.refined, elapsed: result.elapsed }
    } else {
      hiresError.value = result.error || '测试细化失败，请检查 ComfyUI 连接'
    }
  } catch (err) {
    hiresError.value = '请求失败: ' + (err.message || '网络错误')
  } finally {
    hireTesting.value = false
  }
}

// ── 测试提示词编辑器 ──
const TEST_PROMPTS_KEY = 'test-style-prompts'
const DEFAULT_TEST_PROMPTS = {
  chat: `Hatsune Miku (VOCALOID), 1girl, close-up shot, teal twin-tailed hair, blue eyes, black school uniform with tie, holding a fork, looking happily at a matcha mille crepe cake on a white plate, matcha latte with musical note latte art beside it, soft natural lighting, shallow depth of field, cafe background with wooden tables, warm and cozy atmosphere, 1girl, teal-haired Hatsune Miku smiling while eating matcha cake`,
  moments: `2girls, Kiana Kaslana(honkai impact 3rd), white hair in twin braids, blue eyes, wearing a casual outfit, sitting at a cozy café table with a giant strawberry cake in front of her, laughing joyfully. Raiden Mei(honkai impact 3rd) is sitting across from her, smiling softly, two pudding cups on the table. Warm afternoon sunlight streaming through the window, soft bokeh, cute and heartwarming atmosphere, anime style, high quality illustration.`,
  event: `Yae Miko (Genshin Impact), long pink hair in a high ponytail, M-shaped bangs, purple fox-like eyes with a sly expression, wearing a red and white shrine maiden outfit with exposed side breast, lying on a futon in the Grand Narukami Shrine's private sleeping quarters. She is half-asleep, one hand loosely holding a closed light novel on her chest, the other tucked under her cheek. Her posture is relaxed, legs slightly bent, bare feet peeking out from under the thin silk blanket. Around her, soft lantern light casts warm shadows on tatami mats, a half-eaten plate of fried tofu sits on a low wooden tray nearby, and a faint smile plays on her lips as she drifts into peaceful slumber. Camera angle: slightly elevated, looking down from a 45-degree angle, capturing her serene yet mischievous aura in the dim, cozy chamber.`,
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
.memory-settings-card { gap: 0; }
.memory-settings-header h3 { margin-bottom: 4px; }
.memory-settings-header p {
  max-width: 560px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.memory-settings-copy { flex: 1; min-width: 0; }
.memory-settings-row { margin-top: 6px; }
.memory-settings-entry {
  width: 100%; min-height: 68px; margin-top: auto; padding: 12px 14px;
  display: flex; align-items: center; gap: 12px;
  color: var(--text-primary); text-align: left;
  background: rgba(224, 123, 108, 0.07);
  border: 1px solid rgba(224, 123, 108, 0.16);
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.memory-settings-entry:hover {
  background: rgba(224, 123, 108, 0.12);
  border-color: rgba(224, 123, 108, 0.38);
  box-shadow: 0 4px 14px rgba(224, 123, 108, 0.1);
}
.memory-settings-entry:active { background: rgba(224, 123, 108, 0.16); }
.memory-settings-entry:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.memory-entry-icon {
  width: 40px; height: 40px; flex: 0 0 40px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent);
  background: rgba(224, 123, 108, 0.12);
  border-radius: 10px;
}
.memory-entry-icon svg,
.memory-entry-arrow svg {
  width: 20px; height: 20px;
  fill: none; stroke: currentColor; stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
}
.memory-entry-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 2px; }
.memory-entry-title { color: var(--text-bright); font-size: 14px; font-weight: 600; line-height: 1.4; }
.memory-entry-desc { color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.memory-entry-arrow {
  width: 32px; height: 40px; flex: 0 0 32px;
  display: inline-flex; align-items: center; justify-content: flex-end;
  color: var(--text-secondary);
  transition: color 0.2s ease, transform 0.2s ease;
}
.memory-settings-entry:hover .memory-entry-arrow { color: var(--accent); transform: translateX(2px); }

/* ── 保存为 Primary，工作流操作为 Secondary ── */
.comfy-params-card .sa { gap: 10px; }
.wf-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px; font-size: 12px; font-weight: 500;
  white-space: nowrap;
}
.float-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 10px;
  background: rgba(224, 123, 108, 0.10); color: #E07B6C; margin-left: 4px;
  white-space: nowrap;
}
.float-badge.active { background: rgba(224, 123, 108, 0.14); color: #E07B6C; }

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
  display: flex;
  flex-direction: column;
}
.card:hover { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06); }
.card-full { grid-column: 1 / -1; margin-top: 16px; }
.card h3 { font-size: 15px; color: var(--text-bright); margin-bottom: 12px; font-weight: 600; }
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 2px; }
.fd { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.fi { margin-bottom: 14px; }
/* ── 画师串参数卡：轻量 Tab + 紧凑表单节奏 ── */
.comfy-params-card { padding: 22px; }
.comfy-params-card h3 { margin-bottom: 18px; }
.comfy-params-card .fd { margin-bottom: 14px; line-height: 1.55; }
.comfy-params-card .fr { margin-bottom: 18px; }
.comfy-params-card .fpresets { margin: 0 0 24px; }

.comfy-tabs {
  display: flex; gap: 4px; margin-bottom: 20px;
  border-radius: 12px;
  background: #F5F1EC;
  padding: 3px;
}
.comfy-tab {
  flex: 1; min-width: 0;
  padding: 10px 6px 9px; font-size: 13px; font-weight: 500;
  text-align: center; cursor: pointer;
  border-radius: 9px;
  background: transparent; color: #8B8074;
  border: none;
  font-family: inherit;
  position: relative;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background-color 0.2s ease, color 0.2s ease;
  user-select: none;
}
.comfy-tab:hover:not(.active) {
  background: rgba(255, 255, 255, 0.55);
  color: #6F675F;
}
.comfy-tab.active {
  background: rgba(224, 123, 108, 0.10);
  color: #E07B6C;
  font-weight: 600;
}
.comfy-tab.active::after {
  content: '';
  position: absolute;
  left: 50%; bottom: 4px; width: 18px; height: 2px;
  border-radius: 2px; transform: translateX(-50%);
  background: #E07B6C;
}

.comfy-form-stage {
  overflow: hidden;
  position: relative;
}
/* ── Tab 切换过渡：0.25s 纯淡入淡出 ── */
.tab-slide-forward-enter-active,
.tab-slide-forward-leave-active,
.tab-slide-back-enter-active,
.tab-slide-back-leave-active {
  transition: opacity 0.25s ease;
}
.tab-slide-forward-enter-from,
.tab-slide-forward-leave-to,
.tab-slide-back-enter-from,
.tab-slide-back-leave-to {
  opacity: 0;
}

.gen-error { margin-top: 6px; font-size: 12px; color: var(--danger, #ff4d4f); }
.fr { display: flex; gap: 12px; }
.fh { flex: 1; min-width: 0; }
.fr .fl {
  display: block; margin-bottom: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-bright);
}
.fpresets { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fpresets-head {
  display: flex; align-items: baseline; flex-wrap: wrap;
  gap: 2px 10px; margin-bottom: 6px;
}
.resolution-title {
  font-size: 14px; font-weight: 600; color: var(--text-bright);
}
.resolution-hint {
  font-size: 12px; color: #9A9189;
}
/* ── 全局细化 / HiresFix 独立层级 ── */
.hiresfix-section {
  margin: 8px 0 0; padding: 16px 0;
  border-top: 1px solid #EDE5DC;
  border-bottom: 1px solid #EDE5DC;
}
.hiresfix-header {
  display: flex; align-items: baseline;
  justify-content: space-between; margin-bottom: 10px;
}
.hiresfix-title {
  font-size: 14px; font-weight: 600; color: var(--text-bright);
}
.hiresfix-tag {
  font-size: 12px; font-weight: 500; color: #8B8074;
  background: #F5F1EC; border-radius: 8px; padding: 3px 9px;
}
.hiresfix-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.hiresfix-copy { flex: 1; min-width: 200px; }
.hiresfix-desc {
  font-size: 12px; color: #9A9189; margin-top: 2px;
}
.hiresfix-summary { font-size: 12px; color: #6F675F; }
.hiresfix-link, .quality-link {
  font-size: 13px;
}
/* ── 质量提示词 ── */
.quality-section {
  margin: 0 0 20px; padding: 16px 0;
  border-bottom: 1px solid #EDE5DC;
}
.quality-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.quality-copy { flex: 1; min-width: 180px; }
.quality-subtitle { font-size: 13px; font-weight: 700; color: var(--text-bright); }
.quality-desc { font-size: 12px; color: #9A9189; margin-top: 2px; }
.quality-summary {
  font-size: 12px; color: #6F675F;
  max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.quality-summary.is-default { color: #9A9189; }
.pl { font-size: 12px; color: #9A9189; margin-right: 2px; }
.pbtn {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px;
  font-size: 12px;
}
.cb { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); margin: -6px 0 12px; cursor: pointer; user-select: none; }
.cb input { width: 14px; height: 14px; cursor: pointer; }

/* ── 外部链接高亮 ── */
.ext-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  font-weight: 500;
  transition: color 0.15s;
}
.ext-link:hover { color: var(--accent-hover); }

/* ── 画师串收藏夹：输入框一体 + 轻量文字标签 ── */
.fav-input-row {
  display: flex; align-items: center; gap: 2px;
  padding: 0 4px 0 12px; margin-bottom: 8px;
  background: #FFFEFC; border: 1px solid #E5D8CE; border-radius: 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.fav-input-row:focus-within {
  border-color: #E07B6C;
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.10);
}
.fav-input {
  flex: 1; min-width: 0; height: 38px; padding: 0; margin: 0;
  font-size: 13px; background: transparent; border: none; box-shadow: none;
}
.fav-input:focus { box-shadow: none; }
.fav-star-btn {
  width: 34px; height: 34px; flex-shrink: 0; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #A9A099;
  font-size: 16px; line-height: 1; cursor: pointer;
  transition: color 0.15s ease;
  user-select: none;
}
.fav-star-btn:hover:not(.is-disabled) { color: #E2A83E; }
.fav-star-btn.is-disabled { opacity: 0.35; cursor: not-allowed; }
.fav-section-title {
  font-size: 12px; color: #9A9189; margin-bottom: 6px;
}
.fav-chips {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px;
}
.fav-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px; font-size: 14px;
}
.fav-chip-x {
  font-size: 12px; line-height: 1; color: #A9A099;
}
.fav-chip-x:hover { color: #E07B6C; }

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
  width: 28px; height: 28px;
  font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.fav-dialog-body { padding: 12px 20px 20px; }
.fav-dialog-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
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

.sa { display: flex; align-items: center; gap: 12px; margin-top: auto; }
.sa-spacer { flex: 1; }
.smsg { color: var(--success); font-size: 13px; }

.toggle-row { display: flex; gap: 14px; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--glass-border); }
.toggle-row:last-child { border-bottom: none; }
.tl { font-size: 14px; font-weight: 500; color: var(--text-bright); }
/* 测试版小标签：珊瑚描边弱强调 */
.beta-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--accent);
  border: 1px solid var(--accent-light);
  vertical-align: 1px;
}
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
  font-size: 14px;
  width: 130px;
}
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
  font-size: 12px; color: var(--text-secondary); text-align: center;
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
  flex: 1; min-width: 140px; font-size: 12px; color: var(--text-secondary);
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

.sp-btn-small { padding:6px 14px; font-size:12px; margin-right:6px; }

/* ── LLM API ── */
.apikey-row { display: flex; gap: 8px; align-items: center; }
.apikey-row .fi { flex: 1; min-width: 0; }
.key-status { margin-top: 8px; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.key-ok { color: var(--success); }
.key-missing { color: var(--danger); padding: 6px 10px; border-radius: 6px; background: rgba(255, 77, 79, 0.06); }
.key-preview { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: var(--glass-bg-strong); border: 1px solid var(--glass-border); color: var(--text-secondary); cursor: pointer; transition: border-color 0.15s; }
.key-preview:hover { border-color: var(--accent); }

/* ── 每日免费鸡蛋（LLM 卡片右上角按钮） ── */
.llm-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.llm-card-header h3 { margin-bottom: 0; }
.free-egg-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 13px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  border: 2px solid rgba(250, 204, 21, 0.45);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
  flex-shrink: 0;
  white-space: nowrap;
  position: relative;
}
.free-egg-btn:hover:not(.is-disabled) { border-color: #facc15; background: rgba(250, 204, 21, 0.08); color: #facc15; }
.free-egg-btn.active { border-color: #facc15; background: rgba(250, 204, 21, 0.16); color: #facc15; }
.free-egg-btn.is-disabled { opacity: 0.6; cursor: wait; }
.free-egg-label { position: relative; z-index: 3; }

/* ── 推荐中转站入口与弹窗 ── */
.relay-intro-btn {
  padding: 0; border: none; background: none;
  font-size: 12px; font-weight: 500; color: var(--accent);
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: color 0.15s;
}
.relay-intro-btn:hover { color: var(--accent-hover); }
.relay-intro-footer { margin-left: auto; }
.relay-modal-overlay {
  position: fixed; inset: 0; z-index: 2100;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  padding: 20px;
}
.relay-modal {
  width: min(540px, 100%);
  max-height: min(660px, 90vh);
  overflow: auto;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 10px 44px rgba(0, 0, 0, 0.18);
}
.relay-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px 0;
}
.relay-modal-header h3 { margin: 0; font-size: 16px; color: var(--text-bright); }
.relay-modal-close {
  width: 28px; height: 28px;
  font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.relay-modal-body { padding: 10px 20px 18px; }
.relay-modal-tip { font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; }
.relay-station {
  border: 1px solid #eee3d9; border-radius: 12px; padding: 14px; margin-bottom: 12px;
  background: #fffcf9;
}
.relay-station-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px;
}
.relay-station-name { font-size: 14px; font-weight: 600; color: var(--text-bright); }
.relay-quick-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
}
.relay-quick-icon { flex-shrink: 0; }
.relay-station-desc {
  font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin: 0 0 10px;
}
.relay-station-line {
  font-size: 12px; color: var(--text-secondary); margin: 4px 0; line-height: 1.6;
  overflow-wrap: anywhere;
}
.relay-station-link { overflow-wrap: anywhere; }
.relay-sponsor-note {
  margin: 4px 0 0; text-align: right; font-size: 11px;
  color: var(--text-muted, #b3aca4); opacity: 0.55;
}
.relay-sponsor-note strong { font-weight: 600; color: var(--text-muted, #b3aca4); }
.relay-modal-fade-enter-active { transition: opacity 0.2s ease; }
.relay-modal-fade-leave-active { transition: opacity 0.15s ease; }
.relay-modal-fade-enter-active .relay-modal { animation: relay-pop 0.25s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
.relay-modal-fade-leave-active .relay-modal { transition: transform 0.15s ease, opacity 0.15s ease; }
.relay-modal-fade-enter-from,
.relay-modal-fade-leave-to { opacity: 0; }
.relay-modal-fade-leave-to .relay-modal { transform: scale(0.95); opacity: 0; }
@keyframes relay-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@media (max-width: 640px) {
  .relay-modal-overlay { padding: 12px; }
  .relay-station-head { align-items: flex-start; }
}

/* LLM API 面板切换：退出淡出上收，进入弹性下压 */
.egg-page-leave-active { transition: opacity 0.16s ease, transform 0.18s ease; }
.egg-page-enter-active { transition: opacity 0.22s ease, transform 0.38s cubic-bezier(0.2, 0.9, 0.3, 1.25); }
.egg-page-leave-to { opacity: 0; transform: translateY(-8px) scale(0.995); }
.egg-page-enter-from { opacity: 0; transform: translateY(14px) scale(0.98); }
.egg-splash {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  z-index: 2;
  pointer-events: none;
}
.egg-drop {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--size);
  height: calc(var(--size) * 1.35);
  margin: calc(var(--size) * -0.675) 0 0 calc(var(--size) * -0.5);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95) 0 10%, var(--color) 42%, rgba(190, 118, 10, 0.9) 100%);
  box-shadow: 0 0 6px rgba(255, 190, 40, 0.5);
  animation: egg-drop-fly var(--dur) cubic-bezier(0.14, 0.62, 0.36, 1) var(--delay) both;
}
@keyframes egg-drop-fly {
  0% { transform: translate(0, 0) rotate(var(--rot)) scale(0.15, 0.15); opacity: 0; }
  8% { opacity: 1; }
  32% { transform: translate(var(--mx), var(--my)) rotate(var(--rot)) scale(0.85, 1.45); }
  68% { transform: translate(var(--x), var(--y)) rotate(var(--rot)) scale(0.6, 0.9); opacity: 0.95; }
  100% { transform: translate(var(--x), calc(var(--y) + var(--fall))) rotate(var(--rot)) scale(1.3, 0.08); opacity: 0; }
}
.egg-shard {
  position: absolute;
  left: 0;
  top: 0;
  width: calc(var(--size) * 1.7);
  height: var(--size);
  margin: calc(var(--size) * -0.5) 0 0 calc(var(--size) * -0.85);
  background: linear-gradient(135deg, #fffdf5 0%, #ead9b0 55%, #cbb177 100%);
  clip-path: polygon(18% 0, 100% 28%, 84% 100%, 0 74%, 10% 22%);
  box-shadow: inset 0 0 2px rgba(255, 255, 255, 0.75);
  animation: egg-shard-fly var(--dur) cubic-bezier(0.18, 0.7, 0.28, 1) var(--delay) both;
}
@keyframes egg-shard-fly {
  0% { transform: translate(0, 0) rotate(0deg) scale(0.2); opacity: 0; }
  12% { opacity: 1; }
  55% { transform: translate(var(--mx), var(--my)) rotate(calc(var(--rot) + 150deg)) scale(1.05); }
  100% { transform: translate(var(--x), var(--y)) rotate(calc(var(--rot) + 290deg)) scale(0.5); opacity: 0; }
}
.free-egg-notice {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  margin-top: 0;
  border-radius: 10px;
  border: 1px solid rgba(250, 204, 21, 0.28);
  background: rgba(250, 204, 21, 0.07);
}
.free-egg-icon { font-size: 30px; line-height: 1; flex-shrink: 0; }
.free-egg-copy { min-width: 0; }
.free-egg-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.free-egg-desc { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.free-egg-hint { font-size: 11px; color: var(--text-secondary); opacity: 0.75; margin-top: 2px; }
.llm-model-row { display: flex; align-items: stretch; gap: 8px; margin-bottom: 14px; }
.llm-model-row .ls-select-wrapper { flex: 1; min-width: 0; }
.model-fetch-btn {
  min-width: 82px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.model-fetch-error { margin-top: -8px; margin-bottom: 14px; color: var(--danger); font-size: 12px; line-height: 1.5; }
.thinking-setting { min-width: 0; }
.thinking-options {
  position: relative;
  width: 144px;
  flex: 0 0 144px;
  display: inline-grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 2px;
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  background: var(--glass-bg-strong);
}
.thinking-options::before {
  content: '';
  position: absolute;
  z-index: 0;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc((100% - 4px) / 3);
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 1px 4px rgba(224, 123, 108, 0.2);
  transform: translateX(100%);
  transition: transform 0.2s ease;
}
.thinking-options.is-enabled::before { transform: translateX(0); }
.thinking-options.is-disabled::before { transform: translateX(100%); }
.thinking-options.is-omit::before { transform: translateX(200%); }
.thinking-option { position: relative; z-index: 1; cursor: pointer; }
.thinking-option input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.thinking-option span {
  min-height: 30px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  transition: color 0.18s ease;
}
.thinking-option:hover span { color: var(--text-bright); }
.thinking-option input:checked + span {
  color: #fff;
}
.thinking-option input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.thinking-setting,
.llm-custom-toggle,
.llm-option-row { border-bottom: none; }
.llm-custom-editor { padding: 4px 0 2px; }
.llm-json-textarea { min-height: 72px; font-family: monospace; font-size: 12px; resize: vertical; }
.llm-label { font-size: 13px; font-weight: 600; color: var(--text-bright); }
.llm-advanced-toggle {
  display: flex; align-items: center; justify-content: flex-start; gap: 6px;
  width: 100%; margin-top: 4px; padding: 12px 0 10px;
  border: none; border-bottom: 1px solid var(--glass-border);
  background: none; color: var(--text-bright);
  font-size: 13px; font-weight: 600; cursor: pointer;
  user-select: none;
  transition: color 0.15s;
}
.llm-advanced-label { min-width: 0; }
.llm-advanced-chevron { flex-shrink: 0; color: var(--text-secondary); transition: color 0.15s, transform 0.25s ease; }
.llm-advanced-toggle:hover .llm-advanced-chevron { color: var(--accent); }
.llm-advanced-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.llm-advanced-chevron.open { transform: rotate(180deg); }
.llm-advanced-body { padding-top: 2px; }

/* ── LLM Profile 切换 ── */
.llm-profiles-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: center; }
.profile-item-row { display: flex; align-items: center; gap: 0; }
.profile-tag {
  padding: 4px 12px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  border-radius: 8px;
  font-family: inherit;
  user-select: none;
}
.profile-item-row .profile-tag { border-radius: 0; }
.profile-item-row .profile-tag:first-child { border-radius: 9999px 0 0 9999px; }
.profile-item-row .profile-tag:last-child { border-radius: 0 9999px 9999px 0; }
.profile-item-row .profile-tag:first-child:last-child { border-radius: 9999px; }
.profile-item-row .profile-tag:first-child:not(:last-child) { padding-right: 8px; }
.profile-item-row .profile-tag:last-child:not(:first-child) { padding-left: 6px; }
.profile-tag:hover { border-color: var(--accent); color: var(--text-bright); }
.profile-tag.active {
  background: #e07b6c;
  border-color: #e07b6c;
  color: #fff;
  font-weight: 600;
}
.profile-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #fff;
  flex-shrink: 0;
}
.profile-delete-btn { padding: 4px 8px; min-width: unset; border: none; background: transparent; }
.profile-delete-btn:hover { background: rgba(255, 77, 79, 0.08); }
.profile-x { font-size: 14px; line-height: 1; color: var(--danger); }
.profile-add { border-radius: 20px; border-style: dashed; color: var(--text-muted); }
.profile-add:hover { border-color: var(--accent); color: var(--accent); }

.add-profile-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
}
.add-profile-dialog {
  background: #ffffffe3;
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 24px;
  min-width: 360px;
  max-width: 440px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.add-profile-dialog h4 { margin: 0 0 8px; font-size: 16px; color: var(--text-bright); }
.add-profile-dialog .fd { margin-bottom: 16px; }
.add-profile-dialog .fi { width: 100%; margin-bottom: 16px; }
.add-profile-actions { display: flex; gap: 10px; justify-content: flex-end; }

.add-profile-fade-enter-active { transition: opacity 0.2s ease; }
.add-profile-fade-leave-active { transition: opacity 0.15s ease; }
.add-profile-fade-enter-active .add-profile-dialog { animation: profile-pop 0.25s cubic-bezier(0.17, 0.89, 0.32, 1.25); }
.add-profile-fade-leave-active .add-profile-dialog { transition: transform 0.15s ease, opacity 0.15s ease; }
.add-profile-fade-enter-from,
.add-profile-fade-leave-to { opacity: 0; }
.add-profile-fade-leave-to .add-profile-dialog { transform: scale(0.95); opacity: 0; }

@keyframes profile-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* ── 测试画风 ── */
.style-test-row { display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 12px; flex-wrap: wrap; }
.free-scene-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
.free-scene-input-wrap { position: relative; flex: 1; min-width: 0; }
/* 折叠/展开输入框：独立设计（单行收起 + 省略覆盖层），皮肤与 LinsheInput 对齐 */
.free-scene-textarea {
  width: 100%; display: block; padding: 9px 12px; font-size: 13px; line-height: 1.5;
  font-family: inherit; border-radius: 10px; background: #fffdfb;
  border: 1.5px solid #e3dcd2; color: var(--text-bright); outline: none;
  caret-color: var(--accent);
  resize: none; overflow: hidden;
  height: 38px;  /* 默认单行，聚焦展开 */
  transition: height 0.18s ease, border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.free-scene-textarea:focus {
  height: 58px; min-height: 58px; resize: vertical; overflow: auto;
  border-color: var(--accent); background: #fff;
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.14);
}
.free-scene-ellipsis {
  position: absolute; inset: 0;
  display: flex; align-items: center;
  padding: 0 12px; font-size: 13px;
  border-radius: 10px; background: #fffdfb;
  border: 1.5px solid #e3dcd2; color: var(--text-bright);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  cursor: text; transition: border-color 0.15s;
}
.free-scene-ellipsis:hover { border-color: var(--accent); }
.free-scene-btn { margin: 0; flex-shrink: 0; }
/* 生成提示词按钮：随输入内容渐入渐出 */
.gen-btn-fade-enter-active, .gen-btn-fade-leave-active { transition: opacity 0.25s ease; }
.gen-btn-fade-enter-from, .gen-btn-fade-leave-to { opacity: 0; }
.generated-prompt-box {
  padding: 10px 14px; margin-bottom: 12px; border-radius: 12px;
  background: var(--glass-bg-strong); border: 1px solid var(--glass-border);
  color: var(--text-secondary); font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.generated-prompt-box.editable { cursor: text; transition: border-color 0.15s; }
.generated-prompt-box.editable:hover { border-color: var(--accent); }
.generated-prompt-editor {
  resize: vertical; overflow: auto; outline: none; font-family: inherit;
  color: var(--text-bright); margin-bottom: 12px;
}
.generated-prompt-editor:focus { border-color: var(--accent); }
.style-test-btn { margin: 0; }
.test-mode-segmented {
  display: inline-flex; gap: 3px;
  padding: 3px; background: #F5F1EC; border-radius: 10px;
}
.test-mode-btn {
  flex: 1;
  padding: 6px 14px; font-size: 12px; font-weight: 500;
  border-radius: 7px; border: none;
  background: transparent; color: #6F675F;
  cursor: pointer; transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  font-family: inherit; text-align: center; white-space: nowrap; user-select: none;
}
.test-mode-btn:hover { color: #E07B6C; }
.test-mode-btn.active {
  background: #FFFEFC; color: #E07B6C; font-weight: 600;
  box-shadow: 0 1px 4px rgba(125, 105, 85, 0.12);
}
.test-mode-btn.is-disabled { opacity: 0.5; pointer-events: none; }
.test-prompt-btn {
  margin-left: auto; padding: 0; font-size: 12px;
}
.style-error { padding: 8px 12px; border-radius: 8px; background: rgba(255, 77, 79, 0.06); color: var(--danger); font-size: 13px; margin-bottom: 12px; white-space: pre-wrap; line-height: 1.5; }
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
  width: 28px; height: 28px;
  font-size: 14px; display: flex; align-items: center; justify-content: center;
}
.prompt-editor-body { flex: 1; overflow-y: auto; }
.prompt-editor-field { margin-bottom: 16px; }
.prompt-textarea { min-height: 100px; resize: vertical; font-family: inherit; margin-bottom: 0; }
.prompt-editor-actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; }

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
  .fr { flex-direction: column; gap: 10px; }
  .style-preview-img { max-width: 100%; }
  /* 自由画面测试：textarea 与按钮纵向堆叠，输入区占满卡片宽度 */
  .free-scene-row { flex-direction: column; align-items: stretch; }
  .free-scene-input-wrap { width: 100%; }
  .free-scene-btn { width: 100%; }
  /* 图片实验室操作区：生成画面/细化按钮占满一行，三个参数切换共占一行 */
  .style-test-row .style-test-btn { width: 100%; }
  .style-test-row .test-mode-segmented { flex: 1 1 0; }
  .style-test-row .test-mode-btn { padding-left: 6px; padding-right: 6px; }
  .test-prompt-btn { margin-left: 0; }
  /* 画师串操作按钮行：允许换行，避免挤压 */
  .sa { flex-wrap: wrap; gap: 8px; }
  .sa .sa-spacer { flex-basis: 100%; height: 0; margin: 0; }
  .sa .wf-action-btn { flex: 1 1 0; justify-content: center; padding: 8px 6px; }
  /* 质量提示词行：窄屏摘要占满整行 */
  .quality-summary { max-width: 100%; flex-basis: 100%; order: 2; }
  .quality-row .quality-link { order: 3; margin-left: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .memory-settings-entry,
  .memory-entry-arrow,
  .thinking-option span,
  .thinking-options::before { transition: none; }
  .memory-settings-entry:hover .memory-entry-arrow { transform: none; }
}

/* ── 工作流模式弹窗 ── */
.wf-mode-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 10001;
}
.wf-mode-modal {
  background: var(--bg-secondary);
  border-radius: 16px; padding: 28px 32px;
  max-width: 600px; width: 90%;
  max-height: 85vh; overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  transition: max-height 0.35s ease, max-width 0.35s ease;
}
.wf-mode-modal h3 {
  font-size: 18px; margin-bottom: 16px; color: var(--text-bright);
  text-align: center;
}
.wf-mode-options {
  display: flex; gap: 12px; margin-bottom: 16px;
}
.wf-mode-option {
  flex: 1;
  background: rgba(255, 255, 255, 0.5);
  border: 2px solid var(--border);
  border-radius: 12px;
  padding: 14px 12px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
  display: flex; flex-direction: column; gap: 6px;
  text-align: center;
}
.wf-mode-option:hover { border-color: var(--accent); }
.wf-mode-option.active {
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.08);
}
.wf-mo-title {
  font-size: 14px; font-weight: 600; color: var(--text-bright);
}
.wf-mo-desc {
  font-size: 12px; color: var(--text-secondary); line-height: 1.4;
}
.wf-mo-desc:deep(.wf-mo-highlight) {
  color: var(--accent); font-weight: 700;
}
.wf-mode-downloads {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 4px;
}
.wf-mode-dl-hint {
  font-size: 12px; color: var(--text-secondary); margin: 0 0 6px;
}
.wf-dl-item {
  font-size: 12px; color: var(--text-secondary); line-height: 1.8;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.wf-dl-label { font-weight: 500; color: var(--text-bright); min-width: 40px; }
.wf-dl-item a { color: var(--accent); text-decoration: underline; }
.wf-dl-item a:hover { color: var(--accent-hover, var(--accent)); }
.wf-dl-sep { opacity: 0.4; margin: 0 2px; }
.wf-dl-alt { opacity: 0.5; }
.wf-mode-hint {
  font-size: 12px; color: var(--text-secondary);
  margin-bottom: 10px; text-align: center;
}
.wf-mode-scenes {
  background: rgba(224, 123, 108, 0.04);
  border: 1px solid rgba(224, 123, 108, 0.12);
  border-radius: 8px; padding: 12px 16px;
}
.wf-scene-row-h {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0;
}
.wf-scene-row-h + .wf-scene-row-h { border-top: 1px solid rgba(0,0,0,0.06); }
.wf-scene-name {
  font-size: 13px; color: var(--text-primary);
}
.wf-scene-toggle {
  display: flex; gap: 4px;
}
.wf-toggle-btn {
  padding: 3px 14px; font-size: 12px;
}
/* hybrid 场景展开/收起动画 */
.expand-enter-active, .expand-leave-active {
  transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease, border-width 0.3s ease;
  overflow: hidden;
}
.expand-enter-from, .expand-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0; padding-bottom: 0;
  border-top-width: 0; border-bottom-width: 0;
}
.expand-enter-to, .expand-leave-from {
  max-height: 300px;
  opacity: 1;
}
.wf-mode-actions {
  margin-top: 20px; display: flex; justify-content: center; gap: 10px;
}
.modal-fade-enter-active { transition: opacity 0.3s ease; }
.modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
