<template>
  <Teleport to="body">
    <div class="gift-overlay" @click.self="loading ? null : $emit('close')">
      <div class="gift-panel">
        <div class="gift-header">
          <span class="gift-title">
            <svg class="gift-title-icon" viewBox="0 0 1138 1024" width="18" height="16" fill="var(--accent, #e07b6c)"><path d="M57.242236 626.030169l397.969831 0 0 397.969831-397.969831 0 0-397.969831zM683.272405 626.030169l397.969831 0 0 397.969831-397.969831 0 0-397.969831zM0 284.393966l455.212067 0 0 284.393966-455.212067 0 0-284.393966zM1137.575865 284.393966l0 284.393966-454.303461 0 0-284.393966 454.303461 0zM512.454303 284.393966l113.575865 0 0 739.606034-113.575865 0 0-739.606034zM683.272405 228.060337l-228.060337 0 0-170.818101 228.060337 0 0 170.818101zM1024 228.060337l-284.393966 0 111.758651-228.060337 172.635315 0 0 228.060337zM398.878438 228.060337l-284.393966 0 0-228.060337 169.909494 0z"/></svg>
            送个礼物
          </span>
          <div class="gift-header-actions">
            <button class="gift-reset" @click="resetCd" title="重置冷却（调试）">🔄</button>
            <button class="gift-close" :disabled="loading" @click="$emit('close')">✕</button>
          </div>
        </div>

        <div class="gift-options">
          <!-- 小礼物 -->
          <button
            class="gift-card"
            :class="{ cooldown: cooldowns.small > 0, selected: selectedType === 'small' }"
            :disabled="cooldowns.small > 0 || loading"
            @click="selectGift('small')"
          >
            <span class="gift-emoji">🌸</span>
            <span class="gift-label">带了个小东西</span>
            <span class="gift-bonus">+8 好感</span>
            <span v-if="cooldowns.small > 0" class="gift-cd">
              冷却 {{ formatCd(cooldowns.small) }}
            </span>
            <span v-else class="gift-ready">可用</span>
          </button>

          <!-- 大礼物 -->
          <button
            class="gift-card"
            :class="{ cooldown: cooldowns.large > 0, selected: selectedType === 'large' }"
            :disabled="cooldowns.large > 0 || loading"
            @click="selectGift('large')"
          >
            <span class="gift-emoji">💎</span>
            <span class="gift-label">特意备了心意</span>
            <span class="gift-bonus">+15 好感</span>
            <span v-if="cooldowns.large > 0" class="gift-cd">
              冷却 {{ formatCd(cooldowns.large) }}
            </span>
            <span v-else class="gift-ready">可用</span>
          </button>
        </div>

        <div v-if="error" class="gift-error">{{ error }}</div>

        <button
          v-if="selectedType"
          class="gift-send-btn"
          :disabled="loading"
          @click="doSend"
        >
          {{ loading ? '准备礼物中...' : '确认送出' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { sendGift, getGiftCooldowns, resetGiftCooldowns } from '../api/index.js'

const props = defineProps({
  characterId: { type: Number, required: true },
  characterName: { type: String, default: '' },
})

const emit = defineEmits(['close', 'sent'])

const cooldowns = reactive({ small: 0, large: 0 })
const selectedType = ref(null)
const loading = ref(false)
const error = ref('')
let countdownTimer = null

onMounted(async () => {
  try {
    const res = await getGiftCooldowns()
    if (res.cooldowns) {
      cooldowns.small = res.cooldowns.small || 0
      cooldowns.large = res.cooldowns.large || 0
    }
  } catch {}
  startCountdown()
})

onUnmounted(() => {
  clearInterval(countdownTimer)
})

function startCountdown() {
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    if (cooldowns.small > 0) cooldowns.small = Math.max(0, cooldowns.small - 1)
    if (cooldowns.large > 0) cooldowns.large = Math.max(0, cooldowns.large - 1)
  }, 1000)
}

function formatCd(seconds) {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':')
}

async function resetCd() {
  try {
    const res = await resetGiftCooldowns()
    if (res.cooldowns) {
      cooldowns.small = 0
      cooldowns.large = 0
    }
  } catch {}
}

function selectGift(type) {
  if (cooldowns[type] > 0) return
  selectedType.value = type
}

async function doSend() {
  if (!selectedType.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await sendGift(props.characterId, selectedType.value)
    if (res.success) {
      cooldowns.small = res.cooldowns?.small ?? cooldowns.small
      cooldowns.large = res.cooldowns?.large ?? cooldowns.large
      emit('sent', res)
      emit('close')
    } else {
      error.value = res.error || '送礼失败'
      if (res.cooldowns) {
        cooldowns.small = res.cooldowns.small || 0
        cooldowns.large = res.cooldowns.large || 0
      }
    }
  } catch (err) {
    error.value = '网络错误，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.gift-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.3);
  display: flex; align-items: flex-end; justify-content: center;
  padding-bottom: 100px;
}
.gift-panel {
  background: rgba(255,255,255,0.97);
  border-radius: 18px;
  padding: 20px;
  width: 320px;
  max-width: calc(100vw - 32px);
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  animation: giftUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes giftUp {
  from { opacity: 0; transform: translateY(24px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.gift-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.gift-title { font-size: 16px; font-weight: 600; color: #2c2c2c; display: flex; align-items: center; gap: 6px; }
.gift-title-icon { flex-shrink: 0; }
.gift-header-actions { display: flex; align-items: center; gap: 6px; }
.gift-reset {
  width: 24px; height: 24px; border-radius: 6px;
  border: none; background: transparent;
  font-size: 12px; color: #bbb; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.gift-reset:hover { background: rgba(0,0,0,0.06); color: #666; }
.gift-close {
  width: 28px; height: 28px; border-radius: 10px;
  border: none; background: transparent;
  font-size: 16px; color: #999; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.gift-close:hover { background: rgba(0,0,0,0.06); color: #333; }
.gift-close:disabled { opacity: 0.3; cursor: not-allowed; }

.gift-options { display: flex; gap: 12px; margin-bottom: 16px; }

.gift-card {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 10px;
  border-radius: 14px;
  border: 2px solid #e8e8e8;
  background: #fafafa;
  cursor: pointer;
  transition: all 0.2s;
}
.gift-card:not(:disabled):hover { border-color: var(--accent, #e07b6c); background: #fff5f3; }
.gift-card:not(:disabled):active { transform: scale(0.96); }
.gift-card.selected { border-color: var(--accent, #e07b6c); background: #fff0ed; }

.gift-card.cooldown { opacity: 0.45; cursor: not-allowed; }

.gift-emoji { font-size: 28px; }
.gift-label { font-size: 14px; font-weight: 600; color: #333; }
.gift-bonus { font-size: 12px; color: var(--accent, #e07b6c); font-weight: 500; }
.gift-cd { font-size: 11px; color: #aaa; }
.gift-ready { font-size: 11px; color: #4caf84; }

.gift-error {
  background: #fef2f2; color: #d1522c;
  border-radius: 10px; padding: 10px 14px;
  font-size: 13px; margin-bottom: 14px;
}

.gift-send-btn {
  width: 100%; padding: 12px;
  border-radius: 12px; border: none;
  background: linear-gradient(135deg, #e07b6c, #d06e5e);
  color: #fff; font-size: 15px; font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.gift-send-btn:not(:disabled):hover { box-shadow: 0 4px 16px rgba(224,123,108,0.3); transform: translateY(-1px); }
.gift-send-btn:not(:disabled):active { transform: scale(0.97); }
.gift-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
