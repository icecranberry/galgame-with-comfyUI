<template>
  <Teleport to="body">
    <Transition name="tpd-fade">
      <div v-if="visible" class="tpd-mask" @click.self="close">
        <div class="tpd-panel" role="dialog" aria-label="编辑提示词并重生成">
          <div class="tpd-head">
            <span class="tpd-title">{{ title || '编辑提示词并重生成' }}</span>
            <linshe-button variant="icon" size="sm" aria-label="关闭" @click="close">✕</linshe-button>
          </div>

          <div class="tpd-current" v-if="currentPrompt">
            <div class="tpd-label">当前生效的完整提示词</div>
            <div class="tpd-current-text">{{ currentPrompt }}</div>
          </div>

          <div class="tpd-field">
            <div class="tpd-label">
              新提示词（留空 = 沿用上面的当前提示词重新生成）
              <span class="tpd-hint">留空重试常用于换随机种子；改动后完全按新提示词出图并覆盖替换</span>
            </div>
            <linshe-input
              v-model="draft"
              type="textarea"
              :rows="6"
              size="sm"
              placeholder="留空 = 沿用当前提示词"
            />
          </div>

          <div class="tpd-error" v-if="error">{{ error }}</div>
          <div class="tpd-field">
            <div class="tpd-label">按要求重写提示词</div>
            <linshe-input
              v-model="requirement"
              type="textarea"
              :rows="3"
              size="sm"
              placeholder="例如：把屋檐改成青色，加一串小灯笼"
            />
            <div class="tpd-rewrite">
              <linshe-button
                variant="secondary"
                size="sm"
                :loading="rewriting"
                @click="rewritePrompt"
              >按上面要求改写提示词</linshe-button>
              <span class="tpd-hint">结果填入新提示词，可继续修改后再重生成图片</span>
            </div>
          </div>

          <div class="tpd-actions">
            <linshe-button variant="ghost" size="sm" @click="close">取消</linshe-button>
            <linshe-button variant="primary" size="sm" :loading="busy" @click="regen">
              {{ draft.trim() ? '按新提示词重生成并覆盖' : '按当前提示词重生成' }}
            </linshe-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import * as api from '../../api/index.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  assetId: { type: Number, default: null },
  title: { type: String, default: '' },
})
const emit = defineEmits(['close', 'regenerated'])

const currentPrompt = ref('')
const draft = ref('')
const requirement = ref('')
const busy = ref(false)
const rewriting = ref(false)
const error = ref('')

watch(() => props.visible, async (v) => {
  if (!v || !props.assetId) return
  currentPrompt.value = ''
  draft.value = ''
  requirement.value = ''
  error.value = ''
  try {
    const data = await api.fetchTownAsset(props.assetId)
    currentPrompt.value = data.asset?.source_prompt || ''
  } catch { /* 拉不到就允许直接输入 */ }
})

function close() {
  if (busy.value) return
  emit('close')
}

async function rewritePrompt() {
  if (!props.assetId || rewriting.value) return
  rewriting.value = true
  error.value = ''
  try {
    const prompt = await api.regenerateTownAssetPrompt(props.assetId, requirement.value.trim())
    draft.value = prompt.prompt || ''
  } catch (err) {
    error.value = err?.message || '提示词改写失败'
  } finally {
    rewriting.value = false
  }
}
async function regen() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const prompt = draft.value.trim()
    // verbatim: true → 后端原样使用这段手写提示词出图，不再补固定前缀 / chibi、big head 等硬 tag
    await api.regenerateTownAsset(props.assetId, prompt ? { prompt, verbatim: true } : {})
    emit('regenerated')
    close()
  } catch (err) {
    error.value = err?.message || '重生成失败'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.tpd-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1150;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tpd-panel {
  width: min(540px, calc(100vw - 40px));
  max-height: min(84vh, 720px);
  overflow-y: auto;
  background: #f4f1eeed;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.25);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tpd-head { display: flex; align-items: center; justify-content: space-between; }
.tpd-title { font-size: 14px; font-weight: 700; color: var(--text-bright); }

.tpd-label { font-size: 11px; color: var(--text-primary); display: flex; flex-direction: column; gap: 2px; }
.tpd-hint { font-size: 10px; color: var(--text-secondary); font-weight: 400; }

.tpd-current-text {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
  background: #fbf8f3;
  border-radius: 8px;
  padding: 8px 10px;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}

.tpd-error {
  font-size: 12px;
  color: #c0564a;
  background: rgba(192, 86, 74, 0.08);
  border-radius: 8px;
  padding: 6px 10px;
}

.tpd-actions { display: flex; gap: 8px; justify-content: flex-end; }
.tpd-rewrite {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.tpd-fade-enter-active, .tpd-fade-leave-active { transition: opacity 0.2s ease; }
.tpd-fade-enter-from, .tpd-fade-leave-to { opacity: 0; }
</style>
