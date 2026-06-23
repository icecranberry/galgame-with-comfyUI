<template>
  <div class="tavern-view" @scroll="onScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar?.()" :class="{ 'is-clickable': isMobile }">酒馆</h2>
    </div>

    <!-- ═══════════════════════════════════════════
         用户信息卡片
         ═══════════════════════════════════════════ -->
    <div class="user-row card">
      <div
        class="user-avatar clickable"
        :style="userAvatarStyle"
        @click="showUserAvatarPicker = true"
      >{{ userAvatar ? '' : '我' }}</div>
      <div class="user-info">
        <!-- 姓名 -->
        <div class="user-field-row">
          <span class="field-label">称呼</span>
          <div class="field-value-wrap">
            <input
              v-if="editingNickname"
              ref="nicknameInput"
              v-model="userNicknameInput"
              class="inline-input nickname-input"
              @blur="saveNickname"
              @keydown.enter="saveNickname"
              placeholder="给自己起个名字"
            />
            <span v-else class="field-value" @click="startEditNickname">{{ userNickname || '给自己起个名字' }}</span>
            <button v-if="!editingNickname" class="edit-pen" @click="startEditNickname" title="编辑称呼">✎</button>
          </div>
        </div>
        <!-- 性别 -->
        <div class="user-field-row">
          <span class="field-label">性别</span>
          <div class="field-value-wrap">
            <input
              v-if="editingGender"
              ref="genderInput"
              v-model="userGenderInput"
              class="inline-input field-input"
              @blur="saveGender"
              @keydown.enter="saveGender"
              placeholder="男 / 女 / ..."
            />
            <span v-else class="field-value" @click="startEditGender">{{ userGender || '点击设置性别...' }}</span>
            <button v-if="!editingGender" class="edit-pen" @click="startEditGender" title="编辑性别">✎</button>
          </div>
        </div>
        <!-- 外观特征 -->
        <div class="user-field-row">
          <span class="field-label">外观</span>
          <div class="field-value-wrap">
            <textarea
              v-if="editingAppearance"
              ref="appearanceInput"
              v-model="userAppearanceInput"
              class="inline-input field-textarea"
              rows="2"
              @blur="saveAppearance"
              @keydown.enter.exact="saveAppearance"
              @keydown.escape="cancelEditAppearance"
              placeholder="外观描述越紧密越不容易和其他角色串，示例：长着金色头发的贫乳大小姐，穿着白色蕾丝洛丽塔"
            ></textarea>
            <span v-else class="field-value" @click="startEditAppearance">{{ userAppearance || '点击描述你的外貌特征...' }}</span>
            <button v-if="!editingAppearance" class="edit-pen" @click="startEditAppearance" title="编辑外观">✎</button>
          </div>
        </div>
        <!-- 其他说明 -->
        <div class="user-field-row">
          <span class="field-label">其他</span>
          <div class="field-value-wrap">
            <textarea
              v-if="editingPersona"
              ref="personaInput"
              v-model="userPersonaInput"
              class="inline-input field-textarea"
              rows="2"
              @blur="savePersona"
              @keydown.enter.exact="savePersona"
              @keydown.escape="cancelEditPersona"
              placeholder="性格、身份、经历等补充信息"
            ></textarea>
            <span v-else class="field-value" @click="startEditPersona">{{ userPersona || '点击补充其他信息...' }}</span>
            <button v-if="!editingPersona" class="edit-pen" @click="startEditPersona" title="编辑其他说明">✎</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         用户关系图入口卡片
         ═══════════════════════════════════════════ -->
    <div class="relation-entry card" @click="showUserRelationGraph = true">
      <div class="relation-entry-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
          <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
        </svg>
      </div>
      <div class="relation-entry-text">
        <span class="relation-entry-title">我的关系图</span>
        <span class="relation-entry-hint">查看和管理你与所有角色的关系</span>
      </div>
      <span class="relation-entry-arrow">›</span>
    </div>

    <!-- ═══════════════════════════════════════════
         角色卡片网格
         ═══════════════════════════════════════════ -->
    <div class="section-title">角色</div>
    
    <!-- ═══════════════════════════════════════════
         世界观设置入口卡片
         ═══════════════════════════════════════════ -->
    <div class="relation-entry card" @click="openWorldSetting">
      <div class="relation-entry-icon world-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <ellipse cx="12" cy="12" rx="4" ry="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <line x1="12" y1="2" x2="12" y2="22"/>
        </svg>
      </div>
      <div class="relation-entry-text">
        <span class="relation-entry-title">世界观设置</span>
        <span class="relation-entry-hint">{{ worldSettingSummary }}</span>
      </div>
      <span class="relation-entry-arrow">›</span>
    </div>
    <div class="char-grid">
      <!-- 招募卡片：永远在第一格 -->
      <div class="char-card recruit-card" @click="openRecruit">
        <div class="recruit-plus">+</div>
        <span>招募</span>
      </div>

      <!-- 角色卡片 -->
      <div
        v-for="c in chat.characters"
        :key="c.id"
        class="char-card"
        @click="openCharDetail(c)"
      >
        <div
          class="char-card-avatar"
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
        >{{ c.avatar_path ? '' : c.display_name.charAt(0) }}</div>
        <div class="char-card-name">{{ c.display_name }}</div>
        <div class="char-card-status" :class="c.message_count > 0 ? 'active' : 'idle'">
          {{ c.message_count > 0 ? `${c.message_count} 条消息` : '待唤醒' }}
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         招募弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="recruit.show" class="modal-overlay">
          <div class="modal-panel modal-wide">
            <div class="modal-header">
              <h3>招募新角色</h3>
              <button class="modal-close" @click="closeRecruit">✕</button>
            </div>

            <!-- 步骤 0：输入描述 -->
            <div v-if="recruit.step === 'input'" class="modal-body" style="position:relative">
              <p class="modal-hint">描述你想招募的角色——可以是知名 IP 角色（尽可能输入全名+IP），也可以是原创设定。</p>
              <textarea
                v-model="recruit.desc"
                class="fi recruit-textarea"
                rows="4"
                placeholder="例：安比·德玛拉（绝区零）/ 芙宁娜（原神）/ 御坂美琴（某科学的超电磁炮）/ 傲娇的猫娘女仆 / 金发双马尾大小姐，品学兼优，爱好摇滚，穿着涩谷辣妹风"
                :disabled="recruit.loading"
                @keydown.enter.exact="doGenerate"
              ></textarea>
              <div class="modal-actions">
                <button class="btn-ghost" @click="closeRecruit">取消</button>
                <button
                  class="btn-primary"
                  :disabled="!recruit.desc.trim() || recruit.loading"
                  @click="doGenerate"
                >
                  {{ recruit.loading ? '正在酒馆招募...' : '✨ 招募角色' }}
                </button>
              </div>
              <div v-if="recruit.error" class="gen-error">{{ recruit.error }}</div>
              <!-- 招募加载遮罩 -->
              <div v-if="recruit.loading" class="scan-overlay">
                <div class="scan-line"></div>
                <div class="scan-text">{{ loadingTip }}</div>
              </div>
            </div>

            <!-- 步骤 1：预览确认 -->
            <div v-if="recruit.step === 'preview'" class="modal-body" style="position:relative">
              <div class="preview-card">
                <input
                  v-model="recruit.result.display_name"
                  class="preview-name-input"
                  placeholder="角色名称"
                />
                <div class="preview-prompt-label">人格提示词（——关于外观描述：若不准确自行纠正或传图给其他AI反推提示词）</div>
                <textarea v-model="recruit.result.base_prompt" class="fi prompt-textarea" rows="12"></textarea>

                <!-- 朋友圈开关 -->
                <div class="toggle-row" style="margin-top:12px">
                  <span class="toggle-label">不看ta的朋友圈</span>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="recruit.result.momentsDisabled" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <!-- 主动聊天开关 -->
                <div class="toggle-row" style="margin-top:12px">
                  <span class="toggle-label">不主动聊天</span>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="recruit.result.proactiveDisabled" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div class="modal-actions modal-actions-between">
                <button
                  class="btn-ghost"
                  :disabled="recruit.loading"
                  @click="doGenerate"
                >重新招募</button>
                <div class="modal-actions-right">
                  <button class="btn-ghost" @click="recruit.step = 'input'; recruit.error = ''">返回修改</button>
                  <button class="btn-primary" :disabled="recruit.saving" @click="confirmRecruit">
                    {{ recruit.saving ? '招募中...' : '确认招募' }}
                  </button>
                </div>
              </div>
              <div v-if="recruit.error" class="gen-error">{{ recruit.error }}</div>
              <!-- 扫描动画覆盖层 -->
              <div v-if="recruit.loading" class="scan-overlay">
                <div class="scan-line"></div>
                <div class="scan-text">{{ loadingTip }}</div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 搜索提示 Toast -->
    <Teleport to="body">
      <Transition name="toast-slide">
        <div v-if="toast.show" class="search-toast" :class="toast.type">
          <span class="toast-icon">{{ toast.type === 'success' ? '📚' : '🔍' }}</span>
          <span class="toast-msg">{{ toast.message }}</span>
          <button class="toast-close" @click="toast.show = false">✕</button>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
         世界观编辑弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showWorldModal" class="modal-overlay" @click.self="closeWorldSetting">
          <div class="modal-panel">
            <div class="modal-header">
              <h3>世界观设置</h3>
              <button class="modal-close" @click="closeWorldSetting">✕</button>
            </div>
            <div class="modal-body">
              <p class="modal-hint">定义角色们所处的共同世界背景，留空则不追加。</p>
              <textarea
                v-model="worldSetting"
                class="fi world-textarea"
                rows="10"
                placeholder="例如：这是一个低魔世界，魔法师必须养一只不会魔法的宠物当充电宝。/每天凌晨三点，全人类会共享同一个梦，醒后都能记住。"
                @input="worldDirty = true"
              ></textarea>
              <div class="modal-actions">
                <button class="btn-ghost" @click="closeWorldSetting">取消</button>
                <button
                  class="btn-primary"
                  :disabled="!worldDirty || worldSaving"
                  @click="saveWorldSetting"
                >
                  {{ worldSaving ? '保存中...' : '保存' }}
                </button>
              </div>
              <div v-if="worldSaved" class="world-saved-hint">✓ 已保存</div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══════════════════════════════════════════
         角色详情弹窗
         ═══════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="detail.show" class="modal-overlay">
          <div class="modal-panel modal-wide">
            <div class="modal-header">
              <h3>{{ detail.char?.display_name }}</h3>
              <button class="modal-close" @click="closeCharDetail">✕</button>
            </div>
            <!-- 移动端工具栏 -->
            <div class="mobile-detail-toolbar" v-if="isMobile">
              <div class="toolbar-item" @click="showRelationGraph = true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                  <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                </svg>
                <span>关系图</span>
              </div>
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
            </div>
            <div class="modal-body">
              <!-- 头像 -->
              <div class="detail-avatar-row">
                <div
                  class="detail-avatar clickable"
                  :style="detail.char?.avatar_path ? { backgroundImage: `url(${detail.char.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
                  @click="openCharAvatarEditor"
                >{{ detail.char?.avatar_path ? '' : detail.char?.display_name?.charAt(0) }}</div>
                <div>
                  <button class="sp-btn-small" @click="openCharAvatarEditor">更换头像</button>
                  <button v-if="detail.char?.avatar_path" class="sp-btn-small sp-btn-subtle" @click="removeCharAvatar">移除</button>
                </div>
              </div>
              <div class="preview-card">
                <label class="fl">展示名</label>
                <input v-model="detail.editName" class="fi" @input="detail.dirty = true" />
                <label class="fl" style="margin-top:12px">人格提示词</label>
                <textarea v-model="detail.editPrompt" class="fi prompt-textarea" rows="12" @input="detail.dirty = true"></textarea>
              </div>
            </div>
            <!-- 操作栏 sticky footer -->
            <div class="modal-footer">
              <div class="detail-actions">
                <button class="btn-ghost danger" @click="deleteChar">🗑 删除角色</button>
                <div class="detail-actions-right">
                  <button class="btn-primary" :disabled="!detail.dirty" @click="saveCharDetail">保存</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 悬浮侧边栏 -->
          <div class="detail-float" v-if="!isMobile">
            <div class="float-card" @click="showRelationGraph = true">
              <div class="float-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="17" r="3"/>
                  <line x1="9" y1="6" x2="11" y2="14"/><line x1="15" y1="6" x2="13" y2="14"/>
                </svg>
              </div>
              <span class="float-label">关系图</span>
            </div>
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
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 角色头像裁剪器 -->
    <Teleport to="body">
      <AvatarCropper
        v-if="showCharAvatarPicker"
        :title="`设置 ${detail.char?.display_name || ''} 头像`"
        :show-recent-tab="true"
        :show-generate-tab="true"
        :character-id="detail.char?.id"
        :character-base-prompt="detail.char?.base_prompt || ''"
        :recent-images="recentImages"
        :recent-loading="recentLoading"
        @close="showCharAvatarPicker = false"
        @save="onCharAvatarSave"
        @switch-to-recent="switchToRecent"
      />
    </Teleport>

    <!-- 用户头像裁剪器 -->
    <Teleport to="body">
      <AvatarCropper
        v-if="showUserAvatarPicker"
        title="设置我的头像"
        :show-recent-tab="false"
        :show-generate-tab="false"
        @close="showUserAvatarPicker = false"
        @save="onUserAvatarSave"
      />
    </Teleport>

    <!-- ═══════════════════════════════════════════
         角色关系图（独立全屏弹窗）
         ═══════════════════════════════════════════ -->
    <RelationshipGraph
      v-if="detail.char"
      :visible="showRelationGraph"
      :center-character="detail.char"
      :all-characters="chat.characters"
      @close="showRelationGraph = false"
    />

    <!-- ═══════════════════════════════════════════
         用户关系图（独立全屏弹窗）
         ═══════════════════════════════════════════ -->
    <UserRelationshipGraph
      :visible="showUserRelationGraph"
      :all-characters="chat.characters"
      @close="showUserRelationGraph = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { userAvatar, loadUserAvatar, uploadUserAvatar, userNickname, userGender, userAppearance, userPersona, loadUserConfig, saveUserConfig } from '../userConfig.js'
import * as api from '../api/index.js'
import AvatarCropper from '../components/AvatarCropper.vue'
import RelationshipGraph from '../components/RelationshipGraph.vue'
import UserRelationshipGraph from '../components/UserRelationshipGraph.vue'

const router = useRouter()
const chat = useChatStore()
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const confirmFn = inject('confirm')

// ── 移动端滚动标题隐藏 ──
const headerVisible = ref(true)
let lastScroll = 0
function onScroll(e) {
  if (!isMobile) return
  const top = e.target.scrollTop
  if (top > 40 && top - lastScroll > 8) headerVisible.value = false
  else if (top - lastScroll < -4) headerVisible.value = true
  lastScroll = top
}

// ═══════════════════════════════════════
// 用户信息
// ═══════════════════════════════════════
const showUserAvatarPicker = ref(false)
const nicknameInput = ref(null)
const appearanceInput = ref(null)
const personaInput = ref(null)

const userAvatarStyle = computed(() => {
  if (userAvatar.value) return { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: '#e07b6c' }
})

async function onUserAvatarSave(base64) {
  await uploadUserAvatar(base64)
  showUserAvatarPicker.value = false
}

// ── 姓名 ──
const editingNickname = ref(false)
const userNicknameInput = ref('')

function startEditNickname() {
  userNicknameInput.value = userNickname.value
  editingNickname.value = true
  nextTick(() => nicknameInput.value?.focus())
}

async function saveNickname() {
  editingNickname.value = false
  const val = userNicknameInput.value.trim()
  if (val !== (userNickname.value || '')) {
    await saveUserConfig({ nickname: val })
  }
}

// ── 性别 ──
const editingGender = ref(false)
const userGenderInput = ref('')
const genderInput = ref(null)

function startEditGender() {
  userGenderInput.value = userGender.value
  editingGender.value = true
  nextTick(() => genderInput.value?.focus())
}

async function saveGender() {
  editingGender.value = false
  const val = userGenderInput.value.trim()
  if (val !== (userGender.value || '')) {
    await saveUserConfig({ gender: val })
  }
}

// ── 外观 ──
const editingAppearance = ref(false)
const userAppearanceInput = ref('')

function startEditAppearance() {
  userAppearanceInput.value = userAppearance.value
  editingAppearance.value = true
  nextTick(() => appearanceInput.value?.focus())
}

async function saveAppearance() {
  editingAppearance.value = false
  const val = userAppearanceInput.value.trim()
  if (val !== (userAppearance.value || '')) {
    await saveUserConfig({ appearance: val })
  }
}

function cancelEditAppearance() {
  editingAppearance.value = false
  userAppearanceInput.value = userAppearance.value
}

// ── 其他说明 ──
const editingPersona = ref(false)
const userPersonaInput = ref('')

function startEditPersona() {
  userPersonaInput.value = userPersona.value
  editingPersona.value = true
  nextTick(() => personaInput.value?.focus())
}

async function savePersona() {
  editingPersona.value = false
  const val = userPersonaInput.value.trim()
  if (val !== (userPersona.value || '')) {
    await saveUserConfig({ persona: val })
  }
}

function cancelEditPersona() {
  editingPersona.value = false
  userPersonaInput.value = userPersona.value
}

// ═══════════════════════════════════════
// 招募弹窗
// ═══════════════════════════════════════
const recruit = reactive({
  show: false,
  step: 'input',   // 'input' | 'preview'
  desc: '',
  loading: false,
  saving: false,
  error: '',
  result: null,    // 生成结果
})

// 招募加载提示语轮播
const LOADING_TIPS = [
  '正在酒馆发布公告…',
  '正在审核冒险者资格…',
  '正在翻阅冒险者公会档案…',
  '正在筛查简历…',
  '正在办理冒险者资格证…',
  '正在调取异世界档案…',
  '正在向公会会长请示…',
  '正在检查悬赏令真伪…',
  '正在鉴定勇者血统…',
  '正在占卜命运之线…',
]
const loadingTip = ref(LOADING_TIPS[0])
let _tipTimer = null

function startLoadingTips() {
  loadingTip.value = LOADING_TIPS[0]
  let idx = 0
  _tipTimer = setInterval(() => {
    idx = (idx + 1) % LOADING_TIPS.length
    loadingTip.value = LOADING_TIPS[idx]
  }, 2200)
}

function stopLoadingTips() {
  if (_tipTimer) { clearInterval(_tipTimer); _tipTimer = null }
}

// Toast 冒泡提示
const toast = reactive({
  show: false,
  message: '',
  type: 'info', // 'info' | 'success'
  timer: null,
})

function showToast(message, type = 'info') {
  if (toast.timer) clearTimeout(toast.timer)
  toast.message = message
  toast.type = type
  toast.show = true
  toast.timer = setTimeout(() => {
    toast.show = false
  }, 5000)
}

function openRecruit() {
  recruit.show = true
  recruit.step = 'input'
  recruit.desc = ''
  recruit.error = ''
  recruit.result = null
  recruit.loading = false
  recruit.saving = false
}

function closeRecruit() {
  recruit.show = false
  stopLoadingTips()
}

async function doGenerate() {
  const desc = recruit.desc.trim()
  if (!desc || recruit.loading) return

  recruit.loading = true
  recruit.error = ''
  startLoadingTips()

  try {
    const result = await api.generateCharacterPreview(desc)
    if (result.error) {
      recruit.error = result.error
      return
    }
    recruit.result = { ...result, momentsDisabled: false, proactiveDisabled: false }
    recruit.step = 'preview'
    // 冒泡提示搜索结果
    if (result.search_found) {
      showToast('已在网络上找到详细角色资料', 'success')
    } else {
      showToast('未找到相关资料，请检查IP角色名字输入是否正确，如果是原创设定则无视本条提示', 'info')
    }
  } catch (err) {
    recruit.error = '生成失败: ' + (err.message || '网络错误')
  } finally {
    recruit.loading = false
    stopLoadingTips()
  }
}

async function confirmRecruit() {
  if (!recruit.result || recruit.saving) return
  recruit.saving = true
  recruit.error = ''

  try {
    const r = await api.createCharacter({
      name: recruit.result.name,
      display_name: recruit.result.display_name,
      base_prompt: recruit.result.base_prompt,
      emotion_baseline: recruit.result.emotion_baseline,
      moments_disabled: recruit.result.momentsDisabled ? 1 : 0,
      proactive_disabled: recruit.result.proactiveDisabled ? 1 : 0,
    })
    if (r.error) {
      recruit.error = r.error
      return
    }
    // 成功：关闭弹窗，刷新角色列表
    recruit.show = false
    await chat.loadCharacters()
  } catch (err) {
    recruit.error = '入库失败: ' + (err.message || '网络错误')
  } finally {
    recruit.saving = false
  }
}

// ═══════════════════════════════════════
// 角色详情弹窗
// ═══════════════════════════════════════
const detail = reactive({
  show: false,
  char: null,
  editName: '',
  editPrompt: '',
  momentsDisabled: false,
  proactiveDisabled: false,
  dirty: false,
  momentsToggling: false,
  proactiveToggling: false,
})

const showRelationGraph = ref(false)
const showUserRelationGraph = ref(false)

// ═══════════════════════════════════════
// 世界观设置
// ═══════════════════════════════════════
const WORLD_TAG_RE = /^<world_setting>\s*([\s\S]*?)\s*<\/world_setting>$/;
const showWorldModal = ref(false)
const worldSetting = ref('')
const worldDirty = ref(false)
const worldSaving = ref(false)
const worldSaved = ref(false)

const worldSettingSummary = computed(() => {
  const v = worldSetting.value.trim()
  if (!v) return '定义所有角色共处的世界背景'
  const firstLine = v.split('\n')[0].slice(0, 40)
  return firstLine + (firstLine.length >= 40 || v.includes('\n') ? '…' : '')
})

function unwrapWorldSetting(raw) {
  const m = raw?.match(WORLD_TAG_RE)
  return m ? m[1] : (raw || '')
}

async function loadWorldSetting() {
  try {
    const data = await api.getGlobalRules()
    const world = (data.rules || []).find(r => r.rule_key === 'world_setting')
    worldSetting.value = unwrapWorldSetting(world?.rule_content)
  } catch {}
}

function openWorldSetting() {
  worldDirty.value = false
  worldSaved.value = false
  showWorldModal.value = true
}

function closeWorldSetting() {
  showWorldModal.value = false
}

async function saveWorldSetting() {
  if (worldSaving.value) return
  worldSaving.value = true
  try {
    const raw = worldSetting.value.trim()
    const content = raw ? `<world_setting>\n${raw}\n</world_setting>` : ''
    const result = await api.updateGlobalRule('world_setting', { rule_content: content })
    if (result.ok) {
      worldDirty.value = false
      worldSaved.value = true
      setTimeout(() => worldSaved.value = false, 2000)
    }
  } catch (err) {
    console.error('[world_setting] save failed:', err)
  } finally {
    worldSaving.value = false
  }
}

function openCharDetail(c) {
  detail.char = c
  detail.editName = c.display_name || ''
  detail.editPrompt = c.base_prompt || ''
  detail.momentsDisabled = !!c.moments_disabled
  detail.proactiveDisabled = !!c.proactive_disabled
  detail.dirty = false
  detail.show = true
}

function closeCharDetail() {
  detail.show = false
  detail.char = null
}

async function saveCharDetail() {
  if (!detail.char || !detail.dirty) return
  const c = detail.char
  await api.updateCharacter(c.id, {
    display_name: detail.editName,
    base_prompt: detail.editPrompt,
    moments_disabled: detail.momentsDisabled,
    proactive_disabled: detail.proactiveDisabled,
  })
  detail.dirty = false
  await chat.loadCharacters()
  // 更新本地引用
  const updated = chat.characters.find(x => x.id === c.id)
  if (updated) detail.char = updated
}

// 不看朋友圈 toggle — 即时持久化，无需等"保存"按钮
async function toggleMomentsDisabled() {
  const c = detail.char
  if (!c) return
  detail.momentsToggling = true
  try {
    await api.updateCharacter(c.id, { moments_disabled: detail.momentsDisabled })
    // 同步更新本地角色列表中的值，避免 reload 全部角色
    c.moments_disabled = detail.momentsDisabled
    const inList = chat.characters.find(x => x.id === c.id)
    if (inList) inList.moments_disabled = detail.momentsDisabled
  } catch (e) {
    // 失败时回弹 toggle
    detail.momentsDisabled = !detail.momentsDisabled
    console.error('toggleMomentsDisabled failed:', e)
  } finally {
    detail.momentsToggling = false
  }
}

// 不主动聊天 toggle — 即时持久化，无需等"保存"按钮
async function toggleProactiveDisabled() {
  const c = detail.char
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

async function deleteChar() {
  const c = detail.char
  if (!c) return
  if (c.name === 'default') {
    alert('默认角色不能删除')
    return
  }
  const ok = await confirmFn({
    title: '删除角色',
    message: `确定要删除「${c.display_name}」吗？\n聊天记录和朋友圈内容也将一并删除。`,
    okText: '删除', danger: true,
  })
  if (!ok) return
  await api.deleteCharacter(c.id)
  detail.show = false
  detail.char = null
  await chat.loadCharacters()
}

// ── 角色头像 ──
const showCharAvatarPicker = ref(false)
const recentImages = ref([])
const recentLoading = ref(false)

function openCharAvatarEditor() {
  recentImages.value = []
  showCharAvatarPicker.value = true
}

async function switchToRecent() {
  if (recentImages.value.length > 0) return
  if (!detail.char?.id) return
  recentLoading.value = true
  try {
    const d = await api.getRecentImages(detail.char.id)
    recentImages.value = d.images || []
  } catch {} finally { recentLoading.value = false }
}

async function onCharAvatarSave(base64) {
  if (!detail.char) return
  await api.uploadAvatar(detail.char.id, base64 || '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === detail.char.id)
  if (updated) detail.char = updated
  showCharAvatarPicker.value = false
}

async function removeCharAvatar() {
  if (!detail.char) return
  const ok = await confirmFn({
    title: '移除头像',
    message: `确定要移除「${detail.char.display_name}」的头像吗？`,
    okText: '移除',
    danger: true,
  })
  if (!ok) return
  await api.uploadAvatar(detail.char.id, '')
  await chat.loadCharacters()
  const updated = chat.characters.find(x => x.id === detail.char.id)
  if (updated) detail.char = updated
}

// ── 初始化 ──
onMounted(async () => {
  await loadUserAvatar()
  await loadUserConfig()
  loadWorldSetting()
  userNicknameInput.value = userNickname.value
  userGenderInput.value = userGender.value
  userAppearanceInput.value = userAppearance.value
  userPersonaInput.value = userPersona.value
  if (chat.characters.length === 0) await chat.loadCharacters()
})
</script>

<style scoped>
.tavern-view {
  padding: 32px;
  overflow-y: auto;
  height: 100vh; height: 100dvh;
  flex: 1;
}

.page-header {
  margin-bottom: 24px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform, opacity;
}
.page-header.header-hidden { transform: translateY(-100%); margin-bottom: 0; opacity: 0; pointer-events: none; }
.page-header h2 { font-size: 24px; color: var(--text-bright); font-weight: 700; }
.is-clickable { cursor: pointer; }

/* ── 卡片共用 ── */
.card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: var(--glass-shadow);
}

/* ── 用户行 ── */
.user-row {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 28px;
}

.user-avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700;
  flex-shrink: 0;
}
.user-avatar.clickable { cursor: pointer; transition: opacity 0.15s; }
.user-avatar.clickable:hover { opacity: 0.85; }

.user-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

.user-field-row {
  display: flex; align-items: baseline; gap: 10px;
}
.field-label {
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
  min-width: 32px; padding-top: 4px; flex-shrink: 0;
  user-select: none;
}
.field-value-wrap {
  flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0;
}
.field-value {
  font-size: 13px; color: var(--text-secondary);
  cursor: pointer; padding: 2px 0; line-height: 1.5;
  flex: 1; min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.user-field-row:first-child .field-value {
  font-size: 15px; font-weight: 600; color: var(--text-bright);
}
.field-value:hover { color: var(--accent); }

.edit-pen {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; font-size: 14px; padding: 2px 4px;
  opacity: 0; transition: opacity 0.15s;
  flex-shrink: 0;
}
.user-field-row:hover .edit-pen { opacity: 1; }
.edit-pen:hover { color: var(--accent); }

/* ── 文本输入框 ── */
.field-textarea {
  width: 100%; resize: none;
  font-size: 13px; line-height: 1.5;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 6px 10px;
  color: var(--text-bright);
}
.field-textarea:focus { outline: none; border-color: var(--accent); }
.field-input {
  font-size: 13px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 4px 10px;
  color: var(--text-bright); width: 120px;
}
.field-input:focus { outline: none; border-color: var(--accent); }
.nickname-input {
  font-size: 15px; font-weight: 600;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 4px 10px;
  color: var(--text-bright); width: 160px;
}
.nickname-input:focus { outline: none; border-color: var(--accent); }

/* ── 关系图入口卡片 ── */
.relation-entry {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-bottom: 20px;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.relation-entry:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(224, 123, 108, 0.2);
  box-shadow: 0 2px 16px rgba(224, 123, 108, 0.08);
}

.relation-entry-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: rgba(224, 123, 108, 0.1);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  flex-shrink: 0;
}

.relation-entry-text {
  flex: 1;
  display: flex; flex-direction: column;
  gap: 2px;
}
.relation-entry-title {
  font-size: 15px; font-weight: 600; color: var(--text-bright);
}
.relation-entry-hint {
  font-size: 12px; color: var(--text-secondary);
}

.relation-entry-arrow {
  font-size: 22px; color: var(--text-secondary);
  flex-shrink: 0;
}

/* ── 世界观入口卡片 ── */
.world-icon {
  background: rgba(120, 140, 200, 0.1);
  color: #788cc8;
}

/* ── 世界观编辑弹窗 ── */
.world-textarea {
  min-height: 200px;
  resize: vertical;
  font-family: inherit;
}

.world-saved-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #4caf84;
  font-weight: 500;
}

.inline-input {
  background: rgba(255,255,255,0.9);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 13px;
  color: var(--text-bright);
  outline: none;
  font-family: inherit;
}
/* ── 角色网格 ── */
.section-title {
  font-size: 15px; font-weight: 600; color: var(--text-secondary);
  margin-bottom: 14px;
}

.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}

.char-card {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 20px 12px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.char-card:hover {
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

.char-card-avatar {
  width: 64px; height: 64px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24px; font-weight: 700;
  flex-shrink: 0;
}

.char-card-name {
  font-size: 14px; font-weight: 600; color: var(--text-bright);
  text-align: center;
  line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.char-card-status {
  font-size: 11px; color: var(--text-secondary);
}
.char-card-status.active { color: var(--accent); }
.char-card-status.idle { color: var(--text-secondary); }

/* ── 招募卡片 ── */
.recruit-card {
  border-style: dashed;
  border-color: rgba(224, 123, 108, 0.35);
  justify-content: center;
  min-height: 160px;
}
.recruit-card:hover {
  border-color: var(--accent);
  background: rgba(224, 123, 108, 0.06);
}

.recruit-plus {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: rgba(224, 123, 108, 0.12);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 300;
}
.recruit-card span {
  font-size: 13px; color: var(--accent); font-weight: 500;
}

/* ── 弹窗共用 ── */
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
  overflow: hidden;backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal-wide { width: min(760px, 97vw); }

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

.modal-hint { font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.5; }

.modal-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;
}
.modal-actions-between {
  justify-content: space-between;
}
.modal-actions-right {
  display: flex;
  gap: 10px;
}

.recruit-textarea { width: 100%; resize: vertical; min-height: 80px; font-family: inherit; }
.fi { width: 100%; padding: 9px 12px; font-size: 13px; border-radius: 8px; background: rgba(255,255,255,0.9); border: 1px solid #d5d0ca; color: var(--text-bright); outline: none; }
.fi:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.12); }

.gen-error { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: rgba(255,77,79,0.06); color: var(--danger); font-size: 13px; }

/* ── 扫描动画覆盖层 ── */
.scan-overlay {
  position: absolute; inset: 0;
  background: transparent;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 0 0 18px 18px;
  display: flex; align-items: center; justify-content: center;
  z-index: 10; overflow: hidden;
}
.scan-line {
  position: absolute; left: 10%; right: 10%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: scan-sweep 2s ease-in-out infinite;
  box-shadow: 0 0 24px rgba(224,123,108,0.6), 0 0 8px rgba(224,123,108,0.3);
}
@keyframes scan-sweep {
  0%   { top: 10%; opacity: 0.2; }
  25%  { top: 90%; opacity: 1; }
  50%  { top: 90%; opacity: 0.2; }
  75%  { top: 10%; opacity: 1; }
  100% { top: 10%; opacity: 0.2; }
}
.scan-text {
  font-size: 14px; color: var(--accent); font-weight: 600;
  animation: scan-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 12px rgba(224,123,108,0.3);
}
@keyframes scan-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.97); }
  50%      { opacity: 1;   transform: scale(1); }
}

/* ── 预览姓名可编辑 ── */
.preview-name-input {
  font-size: 20px; font-weight: 700; color: var(--text-bright);
  background: #f0ece8;
  border: 1px dashed rgba(224, 123, 108, 0.25);
  border-radius: 8px; padding: 4px 10px;
  width: 100%; outline: none; font-family: inherit;
  transition: border-color 0.2s, background 0.2s;
  cursor: text;
}
.preview-name-input:hover  { border-color: rgba(224, 123, 108, 0.45); background: rgba(224, 123, 108, 0.07); }
.preview-name-input:focus  { border-color: var(--accent); background: rgba(255,255,255,0.5); }

/* ── 预览卡片 ── */
.preview-card {
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 14px; padding: 18px;
}

.preview-name {
  font-size: 20px; font-weight: 700; color: var(--text-bright);
  margin-bottom: 8px;
}

.preview-prompt-label { font-size: 12px; color: var(--text-secondary); margin: 6px 0; }
.preview-prompt {
  padding: 12px; border-radius: 10px;
  background: var(--bg-primary); border: 1px solid var(--glass-border);
  font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
  max-height: 500px; overflow-y: auto; color: var(--text-primary); font-family: inherit;
}

/* ── Toggle Switch ── */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
}
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
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
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
}

/* ── 角色详情弹窗 ── */
.fl { font-size: 13px; font-weight: 600; color: var(--text-bright); display: block; margin-bottom: 4px; }

.detail-avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.detail-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 26px; font-weight: 700; flex-shrink: 0;
}
.detail-avatar.clickable { cursor: pointer; transition: opacity 0.15s; }
.detail-avatar.clickable:hover { opacity: 0.85; }

/* ── 悬浮侧边栏 ── */
.detail-float {
  position: absolute;
  left: calc(50% + min(380px, 48.5vw) + 16px);
  top: 70px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 20px;
}
.float-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  transition: all 0.15s;
  width: 220px;
}
.float-card:first-child {
  cursor: pointer;
}
.float-card:first-child:hover {
  background: rgba(251, 233, 222, 0.85);
  border-color: rgba(224,123,108,0.2);
  box-shadow: 0 4px 20px rgba(224,123,108,0.1);
}
.float-card-toggle {
  justify-content: space-between;
  gap: 0;
}
.float-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  background: rgba(224,123,108,0.1);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
}
.float-label {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  white-space: nowrap;
}
.float-switch {
  flex-shrink: 0;
}

/* override old layout styles */
.detail-layout { display: block; }
.detail-sidebar { display: none; }

.sp-btn-small { padding: 6px 14px; font-size: 12px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-bg-strong); color: var(--text-primary); cursor: pointer; margin-right: 6px; transition: all 0.15s; }
.sp-btn-small:hover { border-color: var(--accent); }
.sp-btn-subtle { color: var(--text-secondary); border-color: transparent; background: transparent; }
.sp-btn-subtle:hover { color: var(--danger); border-color: transparent; }

.prompt-textarea { min-height: 500px; resize: vertical; font-family: inherit; }

/* 角色详情 input/textarea — 与招募预览卡片统一 */
.modal-wide .fi {
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.modal-wide .fi:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(224, 123, 108, 0.1);
}
.modal-wide .prompt-textarea {
  padding: 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-primary);
}

/* ── 操作栏 sticky footer ── */
.modal-footer {
  flex-shrink: 0;
  padding: 10px 22px 18px;
  border-top: 1px solid var(--glass-border);
  background: inherit;
}

.detail-actions {
  display: flex; align-items: center; margin-top: 0; gap: 10px;
}
.detail-actions-right { margin-left: auto; display: flex; gap: 10px; }
.btn-ghost.danger { color: var(--danger); }
.btn-ghost.danger:hover { background: rgba(255, 77, 79, 0.08); }

/* ── 弹窗动画 ── */
.modal-fade-enter-active { transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-leave-active { transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel { animation: modal-pop 0.28s cubic-bezier(0.17, 0.89, 0.32, 1.25); }

@keyframes modal-pop {
  0% { transform: scale(0.92); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

/* ── 移动端 ── */
@media (max-width: 767px) {
  .tavern-view { padding: 16px; }
  .page-header {
    position: sticky; top: 0; z-index: 20;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 8px 0; margin-bottom: 18px;
  }
  .char-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
  }
  .char-card { padding: 14px 8px 12px; }
  .char-card-avatar { width: 52px; height: 52px; font-size: 20px; }
  .char-card-name { font-size: 13px; }
  .recruit-plus { width: 40px; height: 40px; font-size: 24px; }
  .recruit-card { min-height: 132px; }

  /* ── 弹窗移动端适配 ── */
  .modal-panel {
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }
  .modal-header {
    padding-top: calc(14px + env(safe-area-inset-top, 0px));
    padding-bottom: 14px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
  }
  .modal-header h3 {
    font-size: 16px;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 8px;
  }
  .modal-close {
    flex-shrink: 0;
  }
  .modal-body {
    padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .modal-actions {
    flex-wrap: wrap; gap: 8px;
  }
  .modal-actions-between {
    flex-direction: column; gap: 10px;
  }
  .modal-actions-right {
    flex-wrap: wrap; gap: 8px; justify-content: flex-end;
  }

  /* 招募预览卡片 */
  .preview-card {
    padding: 14px;
  }
  .preview-name-input {
    font-size: 18px;
    padding: 4px 8px; margin: -4px -8px;
  }
  .preview-prompt {
    font-size: 14px;
    max-height: 350px;
  }

  /* 角色详情 */
  .detail-avatar-row {
    gap: 10px; margin-bottom: 12px;
  }
  .detail-layout { flex-direction: column; }

  /* 移动端详情工具栏 */
  .mobile-detail-toolbar {
    display: flex;
    gap: 4px;
    padding: 8px 8px;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(0, 0, 0, 0.02);
    flex-shrink: 0;
  }
  .toolbar-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 12px;
    border-radius: 8px;
    background: rgba(224, 123, 108, 0.08);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    flex: 1;
    justify-content: center;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .toolbar-item:active {
    background: rgba(224, 123, 108, 0.16);
  }
  .toolbar-item-toggle {
    cursor: default;
    justify-content: space-between;
    background: rgba(0, 0, 0, 0.04);
    color: var(--text-secondary);
    font-weight: 500;
  }
  .toolbar-switch {
    width: 34px;
    height: 18px;
    flex-shrink: 0;
  }
  .toolbar-switch .toggle-slider::before {
    height: 14px;
    width: 14px;
  }
  .toolbar-switch input:checked + .toggle-slider::before {
    transform: translateX(16px);
  }

  .detail-avatar {
    width: 52px; height: 52px; font-size: 22px;
  }
  .detail-actions {
    flex-wrap: wrap; gap: 8px;
  }
  .detail-actions-right {
    margin-left: 0; flex-wrap: wrap; gap: 8px;
  }
  .modal-footer {
    padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .prompt-textarea {
    min-height: 350px; font-size: 16px;
  }
  .modal-wide .prompt-textarea {
    font-size: 16px;
  }
  .modal-wide .fi {
    font-size: 16px;
  }
}

/* ═══════════════════════════════════════
   Toast 冒泡提示
   ═══════════════════════════════════════ */
.search-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10001;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  max-width: 520px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(12px);
  border: 1px solid;
}
.search-toast.info {
  background: rgba(30, 40, 60, 0.92);
  border-color: rgba(120, 140, 200, 0.3);
  color: #c8d6f8;
}
.search-toast.success {
  background: rgba(20, 50, 30, 0.92);
  border-color: rgba(80, 180, 100, 0.35);
  color: #b8e8c8;
}
.toast-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.toast-msg {
  flex: 1;
  line-height: 1.5;
}
.toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
.toast-close:hover {
  opacity: 1;
}

/* Toast transition */
.toast-slide-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast-slide-leave-active {
  transition: all 0.25s ease-in;
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px);
}
</style>
