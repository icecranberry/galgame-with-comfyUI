<template>
  <Teleport to="body">
    <div class="admin-mask" @click.self="$emit('close')">
      <div class="admin-panel" role="dialog" aria-label="小镇管理">
        <div class="ap-head">
          <span class="ap-title">小镇管理</span>
          <linshe-button variant="icon" size="sm" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
        </div>

        <div class="ap-tabs">
          <linshe-button variant="chip" size="sm" :active="tab === 'npcs'" @click="tab = 'npcs'">居民</linshe-button>
          <linshe-button variant="chip" size="sm" :active="tab === 'chars'" @click="tab = 'chars'">角色素材</linshe-button>
          <linshe-button variant="chip" size="sm" :active="tab === 'settings'" @click="tab = 'settings'">设置</linshe-button>
        </div>

        <!-- ── 居民管理 ── -->
        <div v-if="tab === 'npcs'" class="ap-body">
          <div class="ap-actions">
            <linshe-button variant="secondary" size="sm" :loading="batchSprites" @click="generateAllMissingNpcSprites">
              一键补齐缺失精灵
            </linshe-button>
          </div>
          <div v-if="npcs.length === 0" class="ap-empty">镇上还没有居民，先完成世界初始化吧。</div>
          <div v-for="npc in npcs" :key="npc.id" class="ap-npc">
            <div class="ap-npc-sprites">
              <div v-for="dir in ['down', 'up', 'left', 'right']" :key="dir" class="ap-sprite">
                <img v-if="npc.sprites?.[dir]?.status === 'ready'" :src="npc.sprites[dir].image_path" :alt="dir">
                <span v-else class="ap-sprite-missing">·</span>
              </div>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">
                {{ npc.displayName }}
                <span v-if="npc.job" class="ap-npc-job">{{ npc.job }}</span>
              </div>
              <div class="ap-npc-persona">{{ npc.persona || '（还没有人设）' }}</div>
              <div class="ap-npc-meta">
                作息 {{ npc.routine?.length || 0 }} 段 · 精灵 {{ spriteCount(npc) }}/4
              </div>
            </div>
            <div class="ap-npc-ops">
              <linshe-switch v-model="npc.townEnabled" size="sm" :aria-label="`${npc.displayName} 启停`" @change="v => toggleNpc(npc, v)" />
              <span class="ap-op" role="button" title="重新生成精灵" @click="regenSprites(npc)">🎨</span>
              <span class="ap-op" role="button" title="重掷人设与作息" @click="rerollNpc(npc)">🎲</span>
              <span class="ap-op is-danger" role="button" title="删除居民" @click="removeNpc(npc)">🗑️</span>
            </div>
          </div>

          <div class="ap-add">
            <div class="ap-add-title">新增居民</div>
            <div class="ap-add-grid">
              <linshe-input v-model="newNpc.name" size="sm" placeholder="名字" />
              <linshe-input v-model="newNpc.job" size="sm" placeholder="职业（如 面包师）" />
            </div>
            <linshe-input v-model="newNpc.persona" type="textarea" :rows="2" size="sm" placeholder="一句话人设（可选，AI 也会帮你补）" />
            <linshe-button variant="secondary" size="sm" :disabled="!newNpc.name.trim()" :loading="adding" @click="addNpc">
              加入小镇
            </linshe-button>
          </div>
        </div>

        <!-- ── 角色素材 ── -->
        <div v-if="tab === 'chars'" class="ap-body">
          <div class="ap-actions">
            <linshe-button variant="primary" size="sm" :loading="batchChars" @click="generateAllMissingCharSprites">
              一键生成所有缺失素材
            </linshe-button>
          </div>
          <div v-for="c in chars" :key="c.id" class="ap-npc">
            <div class="ap-npc-sprites">
              <div v-for="dir in ['down', 'up', 'left', 'right']" :key="dir" class="ap-sprite">
                <img v-if="c.sprites?.[dir]" :src="c.sprites[dir]" :alt="dir">
                <span v-else class="ap-sprite-missing">·</span>
              </div>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">{{ c.displayName }}</div>
              <div class="ap-npc-meta">精灵 {{ c.spriteCount }}/4 · {{ c.townEnabled ? '已入住' : '未入住' }}</div>
            </div>
            <div class="ap-npc-ops">
              <linshe-switch v-model="c.townEnabled" size="sm" :aria-label="`${c.displayName} 入住`" @change="v => toggleChar(c, v)" />
              <span class="ap-op" role="button" title="重新生成精灵" @click="regenCharSprites(c)">🎨</span>
            </div>
          </div>
        </div>

        <!-- ── 小镇设置 ── -->
        <div v-if="tab === 'settings'" class="ap-body">
          <div v-for="f in SETTING_FIELDS" :key="f.key" class="ap-setting">
            <span class="ap-setting-label">{{ f.label }}</span>
            <linshe-input v-model.number="settings[f.key]" size="sm" type="number" :min="f.min" :max="f.max" :step="f.step" />
          </div>
          <linshe-button variant="primary" size="sm" :loading="savingSettings" @click="saveSettings">保存设置</linshe-button>

          <div class="ap-danger-zone">
            <div class="ap-danger-title">危险区</div>
            <p class="ap-danger-desc">重新初始化会清除当前地图、地点与所有居民（相遇历史保留）。</p>
            <linshe-button variant="danger" size="sm" :loading="resetting" @click="resetting = true">
              重新初始化世界
            </linshe-button>
            <div v-if="resetting" class="ap-confirm">
              <span>确定要推倒重来吗？</span>
              <linshe-button variant="danger" size="sm" @click="doReset">确认清除</linshe-button>
              <linshe-button variant="ghost" size="sm" @click="resetting = false">手滑了</linshe-button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import * as api from '../../api/index.js'
import { useTownStore } from '../../stores/town.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSwitch from '../ui/LinsheSwitch.vue'

defineEmits(['close'])

const town = useTownStore()
const tab = ref('npcs')
const npcs = ref([])
const chars = ref([])
const settings = ref({})
const savingSettings = ref(false)
const adding = ref(false)
const batchSprites = ref(false)
const batchChars = ref(false)
const resetting = ref(false)
const newNpc = reactive({ name: '', job: '', persona: '' })

const SETTING_FIELDS = [
  { key: 'tickSeconds', label: '模拟步长（秒）', min: 20, max: 300, step: 5 },
  { key: 'npcSpeed', label: '居民速度（格/秒）', min: 0.1, max: 4, step: 0.1 },
  { key: 'playerSpeed', label: '玩家速度（格/秒）', min: 0.2, max: 6, step: 0.1 },
  { key: 'maxActiveEncounters', label: '同时相遇上限', min: 0, max: 6, step: 1 },
  { key: 'encounterMinStartGapMin', label: '相遇最小间隔（分）', min: 1, max: 120, step: 1 },
  { key: 'encounterCooldownHours', label: '同对相遇冷却（时）', min: 0.5, max: 24, step: 0.5 },
  { key: 'encounterRelatedProb', label: '熟人相遇概率', min: 0, max: 1, step: 0.01 },
  { key: 'encounterStrangerProb', label: '陌生人相遇概率', min: 0, max: 1, step: 0.01 },
  { key: 'statusBubbleIntervalMin', label: '状态气泡间隔（分）', min: 5, max: 240, step: 5 },
]

function spriteCount(npc) {
  return ['down', 'up', 'left', 'right'].filter(d => npc.sprites?.[d]?.status === 'ready').length
}

async function loadNpcs() {
  try {
    const data = await api.fetchTownNpcs()
    npcs.value = data.npcs || []
  } catch (err) {
    console.warn('[town-admin] npcs load failed:', err?.message)
  }
}

async function loadChars() {
  try {
    const data = await api.fetchTownCharacters()
    chars.value = data.characters || []
  } catch (err) {
    console.warn('[town-admin] chars load failed:', err?.message)
  }
}

async function loadSettings() {
  try {
    settings.value = await api.fetchTownSettings()
  } catch (err) {
    console.warn('[town-admin] settings load failed:', err?.message)
  }
}

async function toggleNpc(npc, enabled) {
  try {
    await api.updateTownNpc(npc.id, { townEnabled: enabled })
  } catch (err) {
    npc.townEnabled = !enabled
    console.warn('[town-admin] toggle npc failed:', err?.message)
  }
}

async function toggleChar(c, enabled) {
  try {
    await api.setTownCharacterEnabled(c.id, enabled)
  } catch (err) {
    c.townEnabled = !enabled
    console.warn('[town-admin] toggle char failed:', err?.message)
  }
}

async function regenSprites(npc) {
  npc.spriteReady = false
  try {
    await api.generateTownNpcSprites(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] sprites failed:', err?.message)
  }
}

async function rerollNpc(npc) {
  try {
    await api.rerollTownNpc(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] reroll failed:', err?.message)
  }
}

async function removeNpc(npc) {
  try {
    await api.deleteTownNpc(npc.id)
    npcs.value = npcs.value.filter(n => n.id !== npc.id)
  } catch (err) {
    console.warn('[town-admin] delete failed:', err?.message)
  }
}

async function addNpc() {
  if (!newNpc.name.trim() || adding.value) return
  adding.value = true
  try {
    await api.createTownNpc({
      displayName: newNpc.name.trim(),
      job: newNpc.job.trim(),
      persona: newNpc.persona.trim(),
    })
    newNpc.name = ''
    newNpc.job = ''
    newNpc.persona = ''
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] add npc failed:', err?.message)
  } finally {
    adding.value = false
  }
}

async function generateAllMissingNpcSprites() {
  batchSprites.value = true
  try {
    for (const npc of npcs.value.filter(n => spriteCount(n) < 4)) {
      try { await api.generateTownNpcSprites(npc.id) } catch (err) { console.warn('[town-admin]', err?.message) }
      await loadNpcs()
    }
  } finally {
    batchSprites.value = false
  }
}

async function regenCharSprites(c) {
  try {
    await api.generateTownCharacterSprites(c.id)
    await loadChars()
  } catch (err) {
    console.warn('[town-admin] char sprites failed:', err?.message)
  }
}

async function generateAllMissingCharSprites() {
  batchChars.value = true
  try {
    for (const c of chars.value.filter(x => x.spriteCount < 4)) {
      try { await api.generateTownCharacterSprites(c.id) } catch (err) { console.warn('[town-admin]', err?.message) }
      await loadChars()
    }
  } finally {
    batchChars.value = false
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await api.updateTownSettings(settings.value)
  } catch (err) {
    console.warn('[town-admin] save settings failed:', err?.message)
  } finally {
    savingSettings.value = false
  }
}

async function doReset() {
  try {
    await api.resetTownWorld()
    resetting.value = false
    town.fetchState().catch(() => {})
  } catch (err) {
    console.warn('[town-admin] reset failed:', err?.message)
    resetting.value = false
  }
}

onMounted(() => {
  loadNpcs()
  loadChars()
  loadSettings()
})
</script>

<style scoped>
.admin-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 900;
  display: flex;
  justify-content: flex-end;
}

.admin-panel {
  width: 420px;
  max-width: 100vw;
  height: 100%;
  background: #f4f1eeed;
  box-shadow: -12px 0 48px rgba(54, 42, 38, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 8px;
}

.ap-title { font-size: 16px; font-weight: 700; color: var(--text-bright); }

.ap-tabs { display: flex; gap: 6px; padding: 6px 18px 10px; }

.ap-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ap-actions { display: flex; gap: 8px; }

.ap-empty {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  padding: 30px 0;
}

.ap-npc {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fbf8f3;
  border-radius: 14px;
  padding: 10px 12px;
}

.ap-npc-sprites {
  display: grid;
  grid-template-columns: repeat(2, 26px);
  gap: 3px;
  flex-shrink: 0;
}

.ap-sprite {
  width: 26px;
  height: 34px;
  border-radius: 6px;
  background: #f1ebe1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ap-sprite img {
  height: 100%;
  image-rendering: pixelated;
}

.ap-sprite-missing { color: #cfc4b4; font-size: 12px; }

.ap-npc-info { flex: 1; min-width: 0; }

.ap-npc-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-bright);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ap-npc-job {
  font-size: 10px;
  font-weight: 400;
  color: var(--accent-hover);
  background: rgba(224, 123, 108, 0.12);
  padding: 1px 8px;
  border-radius: 999px;
}

.ap-npc-persona {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ap-npc-meta { font-size: 10px; color: var(--text-secondary); margin-top: 3px; opacity: 0.8; }

.ap-npc-ops {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ap-op {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
}

.ap-op:hover { background: #fff; }
.ap-op.is-danger:hover { background: rgba(192, 86, 74, 0.12); }

.ap-add {
  margin-top: 8px;
  padding: 12px;
  border-radius: 14px;
  border: 1px dashed rgba(200, 186, 166, 0.7);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-add-title { font-size: 12px; font-weight: 700; color: var(--text-secondary); }
.ap-add-grid { display: flex; gap: 8px; }
.ap-add-grid > * { flex: 1; }
.ap-add > :last-child { align-self: flex-end; }

.ap-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ap-setting-label { font-size: 12px; color: var(--text-primary); }
.ap-setting .ap-setting-label { flex: 1; }
.ap-setting > :last-child { width: 90px; }

.ap-danger-zone {
  margin-top: 16px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(192, 86, 74, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ap-danger-title { font-size: 12px; font-weight: 700; color: #c0564a; }
.ap-danger-desc { font-size: 11px; color: var(--text-secondary); margin: 0; }
.ap-danger-zone > :nth-child(3) { align-self: flex-start; }

.ap-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-primary);
}
</style>
