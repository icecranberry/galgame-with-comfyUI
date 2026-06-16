<template>
  <div class="tavern-view" @scroll="onScroll">
    <div class="page-header" :class="{ 'header-hidden': isMobile && !headerVisible }">
      <h2 @click="isMobile && toggleMobileSidebar?.()" :class="{ 'is-clickable': isMobile }">🏮 酒馆</h2>
    </div>

    <!-- ═══════════════════════════════════════════
         用户信息行
         ═══════════════════════════════════════════ -->
    <div class="user-row card">
      <div
        class="user-avatar clickable"
        :style="userAvatarStyle"
        @click="showUserAvatarPicker = true"
      >{{ userAvatar ? '' : '我' }}</div>
      <div class="user-info">
        <div class="user-nickname-row">
          <input
            v-if="editingNickname"
            ref="nicknameInput"
            v-model="userNicknameInput"
            class="inline-input nickname-input"
            @blur="saveNickname"
            @keydown.enter="saveNickname"
          />
          <span v-else class="user-nickname-text" @click="startEditNickname">{{ userNickname || '给自己起个名字' }}</span>
          <button v-if="!editingNickname" class="edit-pen" @click="startEditNickname" title="编辑昵称">✎</button>
        </div>
        <div class="user-persona-row">
          <textarea
            v-if="editingPersona"
            ref="personaInput"
            v-model="userPersonaInput"
            class="inline-input persona-input"
            rows="2"
            @blur="savePersona"
            @keydown.escape="cancelEditPersona"
          ></textarea>
          <span v-else class="user-persona-text" @click="startEditPersona">{{ userPersona || '写一段自画像，告诉角色你是谁...' }}</span>
          <button v-if="!editingPersona" class="edit-pen" @click="startEditPersona" title="编辑自画像">✎</button>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         角色卡片网格
         ═══════════════════════════════════════════ -->
    <div class="section-title">角色</div>
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
          :style="c.avatar_path ? { backgroundImage: `url(${c.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: c.avatar_color || '#e07b6c' }"
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
            <div v-if="recruit.step === 'input'" class="modal-body">
              <p class="modal-hint">描述你想招募的角色——可以是知名 IP 角色，也可以是原创设定。</p>
              <textarea
                v-model="recruit.desc"
                class="fi recruit-textarea"
                rows="4"
                placeholder="例：芙宁娜（原神）/ 御坂美琴（某科学的超电磁炮）/ 傲娇的猫娘女仆 / 我的野蛮女友"
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
            </div>

            <!-- 步骤 1：预览确认 -->
            <div v-if="recruit.step === 'preview'" class="modal-body" style="position:relative">
              <div class="preview-card">
                <input
                  v-model="recruit.result.display_name"
                  class="preview-name-input"
                  placeholder="角色名称"
                />
                <div class="preview-prompt-label">人格提示词</div>
                <textarea v-model="recruit.result.base_prompt" class="fi prompt-textarea" rows="12"></textarea>

                <!-- 朋友圈开关 -->
                <div class="toggle-row" style="margin-top:12px">
                  <span class="toggle-label">不看ta的朋友圈</span>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="recruit.result.momentsDisabled" />
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
                <div class="scan-text">正在重新招募...</div>
              </div>
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
            <div class="modal-body">
              <!-- 头像 -->
              <div class="detail-avatar-row">
                <div
                  class="detail-avatar clickable"
                  :style="detail.char?.avatar_path ? { backgroundImage: `url(${detail.char.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: detail.char?.avatar_color || '#e07b6c' }"
                  @click="openCharAvatarEditor"
                >{{ detail.char?.avatar_path ? '' : detail.char?.display_name?.charAt(0) }}</div>
                <div>
                  <button class="sp-btn-small" @click="openCharAvatarEditor">更换头像</button>
                  <button v-if="detail.char?.avatar_path" class="sp-btn-small sp-btn-subtle" @click="removeCharAvatar">移除</button>
                </div>
              </div>

              <!-- 白色内容卡片 — 与招募预览一致 -->
              <div class="preview-card">
                <!-- 展示名 -->
                <label class="fl">展示名</label>
                <input v-model="detail.editName" class="fi" @input="detail.dirty = true" />

                <!-- 人格提示词 -->
                <label class="fl" style="margin-top:12px">人格提示词</label>
                <textarea
                  v-model="detail.editPrompt"
                  class="fi prompt-textarea"
                  rows="12"
                  @input="detail.dirty = true"
                ></textarea>

                <!-- 朋友圈开关 -->
                <div class="toggle-row" style="margin-top:12px">
                  <span class="toggle-label">不看ta的朋友圈</span>
                  <label class="toggle-switch">
                    <input type="checkbox" v-model="detail.momentsDisabled" @change="detail.dirty = true" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="detail-actions">
                <button class="btn-ghost danger" @click="deleteChar">🗑 删除角色</button>
                <div class="detail-actions-right">
                  <button class="btn-primary" :disabled="!detail.dirty" @click="saveCharDetail">保存</button>
                </div>
              </div>
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
        :show-recent-tab="false"
        @close="showCharAvatarPicker = false"
        @save="onCharAvatarSave"
      />
    </Teleport>

    <!-- 用户头像裁剪器 -->
    <Teleport to="body">
      <AvatarCropper
        v-if="showUserAvatarPicker"
        title="设置我的头像"
        :show-recent-tab="false"
        @close="showUserAvatarPicker = false"
        @save="onUserAvatarSave"
      />
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat.js'
import { userAvatar, loadUserAvatar, uploadUserAvatar, userNickname, userPersona, loadUserConfig, saveUserConfig } from '../userConfig.js'
import * as api from '../api/index.js'
import AvatarCropper from '../components/AvatarCropper.vue'

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
const personaInput = ref(null)

const userAvatarStyle = computed(() => {
  if (userAvatar.value) return { backgroundImage: `url(${userAvatar.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: '#e07b6c' }
})

async function onUserAvatarSave(base64) {
  await uploadUserAvatar(base64)
  showUserAvatarPicker.value = false
}

// 昵称
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
    await saveUserConfig({ nickname: val, persona: undefined })
  }
}

// 自画像
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
    await saveUserConfig({ nickname: undefined, persona: val })
  }
}

function cancelEditPersona() {
  editingPersona.value = false
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
}

async function doGenerate() {
  const desc = recruit.desc.trim()
  if (!desc || recruit.loading) return

  recruit.loading = true
  recruit.error = ''

  try {
    const result = await api.generateCharacterPreview(desc)
    if (result.error) {
      recruit.error = result.error
      return
    }
    recruit.result = { ...result, momentsDisabled: false }
    recruit.step = 'preview'
  } catch (err) {
    recruit.error = '生成失败: ' + (err.message || '网络错误')
  } finally {
    recruit.loading = false
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
  dirty: false,
})

function openCharDetail(c) {
  detail.char = c
  detail.editName = c.display_name || ''
  detail.editPrompt = c.base_prompt || ''
  detail.momentsDisabled = !!c.moments_disabled
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
  })
  detail.dirty = false
  await chat.loadCharacters()
  // 更新本地引用
  const updated = chat.characters.find(x => x.id === c.id)
  if (updated) detail.char = updated
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

function openCharAvatarEditor() {
  showCharAvatarPicker.value = true
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
  userNicknameInput.value = userNickname.value
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
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.page-header.header-hidden { transform: translateY(-100%); margin-bottom: 0; }
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
  align-items: center;
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

.user-info { flex: 1; min-width: 0; }

.user-nickname-row, .user-persona-row {
  display: flex; align-items: center; gap: 8px;
}
.user-nickname-text {
  font-size: 17px; font-weight: 600; color: var(--text-bright);
  cursor: pointer; padding: 2px 0;
}
.user-persona-text {
  font-size: 13px; color: var(--text-secondary);
  cursor: pointer; padding: 2px 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.user-persona-text:hover, .user-nickname-text:hover { color: var(--accent); }

.edit-pen {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; font-size: 14px; padding: 2px 4px;
  opacity: 0; transition: opacity 0.15s;
  flex-shrink: 0;
}
.user-nickname-row:hover .edit-pen, .user-persona-row:hover .edit-pen { opacity: 1; }
.edit-pen:hover { color: var(--accent); }

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
.nickname-input { font-size: 17px; font-weight: 600; width: 200px; }
.persona-input { width: 100%; resize: none; }

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
  background: transparent; border: 1px dashed transparent;
  border-radius: 8px; padding: 4px 10px; margin: -4px -10px;
  width: 100%; outline: none; font-family: inherit;
  transition: border-color 0.2s;
}
.preview-name-input:hover  { border-color: var(--glass-border); }
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

.detail-actions {
  display: flex; align-items: center; margin-top: 18px; gap: 10px;
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
    padding: 14px 16px;
  }
  .modal-header h3 {
    font-size: 16px;
  }
  .modal-body {
    padding: 0 16px 16px;
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
  .detail-avatar {
    width: 52px; height: 52px; font-size: 22px;
  }
  .detail-actions {
    flex-wrap: wrap; gap: 8px;
  }
  .detail-actions-right {
    margin-left: 0; flex-wrap: wrap; gap: 8px;
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
</style>
