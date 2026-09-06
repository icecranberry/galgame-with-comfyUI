<template>
  <Teleport to="body">
    <div class="admin-mask" @click.self="$emit('close')">
      <div class="admin-panel" role="dialog" aria-label="小镇管理">
        <div class="ap-head">
          <linshe-button v-if="detail" variant="ghost" size="sm" @click="detail = null">← 返回</linshe-button>
          <span class="ap-title">{{ detail ? (detail.type === 'npc' ? detailName : detailName) : '小镇管理' }}</span>
          <linshe-button v-if="!detail" variant="icon" size="sm" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
          <linshe-button v-else variant="icon" size="sm" aria-label="关闭" @click="$emit('close')">✕</linshe-button>
        </div>

        <div v-if="!detail" class="ap-tabs">
          <linshe-button variant="chip" size="sm" :active="tab === 'npcs'" @click="tab = 'npcs'">居民</linshe-button>
          <linshe-button variant="chip" size="sm" :active="tab === 'chars'" @click="tab = 'chars'">角色素材</linshe-button>
          <linshe-button variant="chip" size="sm" :active="tab === 'settings'" @click="tab = 'settings'">设置</linshe-button>
        </div>

        <!-- ── 居民列表 ── -->
        <div v-if="!detail && tab === 'npcs'" class="ap-body">
          <div class="ap-row" role="button" tabindex="0" @click="detail = { type: 'player' }" @keydown.enter="detail = { type: 'player' }">
            <div class="ap-row-thumb is-portrait">
              <img v-if="playerKit.portrait?.status === 'ready'" :src="playerKit.portrait.image_path + '?v=' + (playerKit.portrait.meta?.updatedAt ?? 0)" alt="">
              <img v-else-if="playerKit.sprites?.down?.status === 'ready'" :src="playerKit.sprites.down.image_path" alt="">
              <span v-else class="ap-thumb-missing">·</span>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">我（玩家）</div>
              <div class="ap-npc-meta">确认我的立绘与像素小人形象</div>
            </div>
            <span class="ap-row-arrow">›</span>
          </div>
          <div class="ap-actions">
            <linshe-button variant="secondary" size="sm" :loading="batchSprites" @click="generateAllMissingNpcSprites">
              一键补齐缺失精灵
            </linshe-button>
          </div>
          <div v-if="npcs.length === 0" class="ap-empty">镇上还没有居民，先完成世界初始化吧。</div>
          <div
            v-for="npc in npcs" :key="npc.id"
            class="ap-row" role="button" tabindex="0"
            @click="detail = { type: 'npc', id: npc.id }"
            @keydown.enter="detail = { type: 'npc', id: npc.id }"
          >
            <div class="ap-row-thumb is-portrait">
              <img v-if="npc.portrait?.status === 'ready'" :src="npc.portrait.image_path + '?v=' + (npc.portrait.meta?.updatedAt ?? 0)" alt="">
              <img v-else-if="npc.sprites?.down?.status === 'ready'" :src="npc.sprites.down.image_path" alt="">
              <span v-else class="ap-thumb-missing">·</span>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">
                {{ npc.displayName }}
                <span v-if="npc.job" class="ap-npc-job">{{ npc.job }}</span>
              </div>
              <div class="ap-npc-meta">
                {{ npc.townEnabled ? (npc.sleepingHint || '在镇上活动') : '已暂停' }} · 精灵 {{ spriteCount(npc) }}/2
                <template v-if="npc.characterId"> · 已入邻舍</template>
                <template v-else> · 未邀请</template>
              </div>
            </div>
            <span class="ap-row-arrow">›</span>
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

        <!-- ── NPC 详情页 ── -->
        <div v-if="detail && detail.type === 'npc'" class="ap-body">
          <div v-if="detailNpc" class="ap-detail">
            <div class="ap-detail-media">
              <div class="ap-portrait-box">
                <img v-if="detailNpc.portrait?.status === 'ready'" :src="detailNpc.portrait.image_path + '?v=' + (detailNpc.portrait.meta?.updatedAt ?? 0)" alt="立绘">
                <span v-else class="ap-thumb-missing is-big">还没有立绘</span>
              </div>
              <linshe-button variant="secondary" size="sm" :loading="busyFlags[`portrait${detailNpc.id}`]" @click="makePortrait(detailNpc)">
                {{ detailNpc.portrait?.status === 'ready' ? '重生成立绘' : '生成 900×1600 立绘' }}
              </linshe-button>
            </div>

            <div class="ap-detail-name">
              {{ detailNpc.displayName }}
              <span v-if="detailNpc.job" class="ap-npc-job">{{ detailNpc.job }}</span>
              <linshe-switch
                class="ap-detail-switch"
                v-model="detailNpc.townEnabled"
                size="sm"
                :aria-label="`${detailNpc.displayName} 启停`"
                @change="v => toggleNpc(detailNpc, v)"
              />
            </div>

            <div class="ap-section">
              <div class="ap-section-title">像素小人（正面 / 背面）</div>
              <div class="ap-sprite-row">
                <div v-for="dir in ['down', 'up']" :key="dir" class="ap-sprite">
                  <img v-if="detailNpc.sprites?.[dir]?.status === 'ready'" :src="detailNpc.sprites[dir].image_path" :alt="dir">
                  <span v-else class="ap-sprite-missing">·</span>
                </div>
                <linshe-button variant="secondary" size="sm" :loading="busyFlags[`sprites${detailNpc.id}`]" @click="regenSprites(detailNpc)">
                  生成 / 重生成（600×800）
                </linshe-button>
              </div>
            </div>

            <div class="ap-section">
              <div class="ap-section-title">人设</div>
              <p class="ap-persona">{{ detailNpc.persona || '（还没有人设）' }}</p>
              <p class="ap-appearance" v-if="detailNpc.appearanceDesc">{{ detailNpc.appearanceDesc }}</p>
            </div>

            <div class="ap-section">
              <div class="ap-section-title">作息（本地自动执行）</div>
              <div v-if="(detailNpc.routine || []).length === 0" class="ap-empty is-small">还没有作息，重掷一次人设即可生成。</div>
              <div v-for="(slot, i) in detailNpc.routine" :key="i" class="ap-routine-row">
                <span class="ap-routine-time">{{ slot.start }}~{{ slot.end }}</span>
                <span class="ap-routine-act">{{ slot.activity }}</span>
              </div>
            </div>

            <div class="ap-actions is-column">
              <linshe-button
                v-if="!detailNpc.characterId"
                variant="primary" size="sm" :loading="busyFlags[`invite${detailNpc.id}`]"
                @click="invite(detailNpc)"
              >邀请入邻舍（成为聊天角色）</linshe-button>
              <div v-else class="ap-invited">已邀请入邻舍（角色 #{{ detailNpc.characterId }}，在聊天侧边栏可见）</div>
              <linshe-button variant="secondary" size="sm" :loading="busyFlags[`reroll${detailNpc.id}`]" @click="rerollNpc(detailNpc)">
                重掷人设与作息
              </linshe-button>
              <linshe-button variant="danger" size="sm" @click="removeNpc(detailNpc)">删除居民</linshe-button>
            </div>
          </div>
        </div>

        <!-- ── 「我」详情页：立绘 + 像素小人确认与编辑 ── -->
        <div v-if="detail && detail.type === 'player'" class="ap-body">
          <div class="ap-detail">
            <div class="ap-detail-name">我（玩家）的形象</div>
            <div class="ap-section">
              <div class="ap-section-title">立绘（900×1600，白底抠白）</div>
              <TownImageEditor
                v-if="playerKit.portrait?.status === 'ready'"
                :src="playerKit.portrait.image_path + '?v=' + (playerKit.portrait.meta?.updatedAt ?? 0)"
                :asset-id="playerKit.portrait.id"
                :fit-height="300"
                hint="点击白色继续抠白 · 拖动检查"
              />
              <div v-else class="ap-empty is-small">还没有立绘，点下方生成。</div>
            </div>
            <div class="ap-section">
              <div class="ap-section-title">像素小人（正面 / 背面）</div>
              <div class="ap-sprite-row">
                <template v-if="playerKit.sprites?.down?.status === 'ready'">
                  <div class="ap-player-sprite">
                    <TownImageEditor :src="playerKit.sprites.down.image_path + '?v=' + (playerKit.sprites.down.meta?.updatedAt ?? 0)" :asset-id="playerKit.sprites.down.id" :fit-height="170" hint="正面：脚底贴底" />
                  </div>
                  <div class="ap-player-sprite" v-if="playerKit.sprites?.up?.status === 'ready'">
                    <TownImageEditor :src="playerKit.sprites.up.image_path + '?v=' + (playerKit.sprites.up.meta?.updatedAt ?? 0)" :asset-id="playerKit.sprites.up.id" :fit-height="170" hint="背面" />
                  </div>
                </template>
                <div v-else class="ap-empty is-small">还没有像素小人。</div>
              </div>
            </div>
            <div class="ap-actions is-column">
              <linshe-button variant="primary" size="sm" :loading="playerKitBusy" @click="regenPlayerKit">
                重新生成整套形象（按我的用户配置）
              </linshe-button>
            </div>
          </div>
        </div>

        <!-- ── 角色列表 ── -->
        <div v-if="!detail && tab === 'chars'" class="ap-body">
          <div class="ap-actions">
            <linshe-button variant="primary" size="sm" :loading="batchChars" @click="generateAllMissingCharSprites">
              一键生成所有缺失素材
            </linshe-button>
          </div>
          <div
            v-for="c in chars" :key="c.id"
            class="ap-row" role="button" tabindex="0"
            @click="detail = { type: 'char', id: c.id }"
            @keydown.enter="detail = { type: 'char', id: c.id }"
          >
            <div class="ap-row-thumb is-portrait">
              <img v-if="c.portraitUrl || c.standingUrl" :src="c.portraitUrl || c.standingUrl" alt="">
              <img v-else-if="c.sprites?.down" :src="c.sprites.down" alt="">
              <span v-else class="ap-thumb-missing">·</span>
            </div>
            <div class="ap-npc-info">
              <div class="ap-npc-name">{{ c.displayName }}</div>
              <div class="ap-npc-meta">精灵 {{ c.spriteCount }}/2 · {{ c.townEnabled ? '已入住' : '未入住' }}</div>
            </div>
            <span class="ap-row-arrow">›</span>
          </div>
        </div>

        <!-- ── 角色详情页 ── -->
        <div v-if="detail && detail.type === 'char'" class="ap-body">
          <div v-if="detailChar" class="ap-detail">
            <div class="ap-detail-media">
              <div class="ap-portrait-box">
                <img v-if="detailChar.portraitUrl || detailChar.standingUrl" :src="detailChar.portraitUrl || detailChar.standingUrl" alt="立绘">
                <span v-else class="ap-thumb-missing is-big">还没有立绘</span>
              </div>
              <linshe-button variant="secondary" size="sm" :loading="busyFlags[`charportrait${detailChar.id}`]" @click="makeCharPortrait(detailChar)">
                {{ detailChar.standingUrl ? '复用已有立绘 ✓' : (detailChar.portraitUrl ? '重生成 900×1600 立绘' : '生成 900×1600 立绘') }}
              </linshe-button>
            </div>

            <div class="ap-detail-name">
              {{ detailChar.displayName }}
              <linshe-switch
                class="ap-detail-switch"
                v-model="detailChar.townEnabled"
                size="sm"
                :aria-label="`${detailChar.displayName} 入住`"
                @change="v => toggleChar(detailChar, v)"
              />
            </div>

            <div class="ap-section">
              <div class="ap-section-title">像素小人（正面 / 背面）</div>
              <div class="ap-sprite-row">
                <div v-for="dir in ['down', 'up']" :key="dir" class="ap-sprite">
                  <img v-if="detailChar.sprites?.[dir]" :src="detailChar.sprites[dir]" :alt="dir">
                  <span v-else class="ap-sprite-missing">·</span>
                </div>
                <linshe-button variant="secondary" size="sm" :loading="busyFlags[`charsprites${detailChar.id}`]" @click="regenCharSprites(detailChar)">
                  生成 / 重生成（600×800）
                </linshe-button>
              </div>
            </div>

            <div class="ap-actions is-column">
              <linshe-button variant="primary" size="sm" @click="$emit('close')">去小镇看看</linshe-button>
            </div>
          </div>
        </div>

        <!-- ── 小镇设置 ── -->
        <div v-if="!detail && tab === 'settings'" class="ap-body">
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
import { ref, reactive, computed, onMounted } from 'vue'
import * as api from '../../api/index.js'
import { useTownStore } from '../../stores/town.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSwitch from '../ui/LinsheSwitch.vue'
import TownImageEditor from './TownImageEditor.vue'

defineEmits(['close'])

const town = useTownStore()
const tab = ref('npcs')
const npcs = ref([])
const chars = ref([])
const settings = ref({})
const detail = ref(null) // { type: 'npc' | 'char', id }
const busyFlags = reactive({})
const savingSettings = ref(false)
const adding = ref(false)
const batchSprites = ref(false)
const batchChars = ref(false)
const resetting = ref(false)
const newNpc = reactive({ name: '', job: '', persona: '' })
const playerKit = reactive({ sprites: {}, portrait: null })
const playerKitBusy = ref(false)

async function loadPlayerKit() {
  try {
    const kit = await api.fetchTownPlayerKit()
    playerKit.sprites = kit.sprites || {}
    playerKit.portrait = kit.portrait || null
  } catch (err) {
    console.warn('[town-admin] player kit load failed:', err?.message)
  }
}

async function regenPlayerKit() {
  playerKitBusy.value = true
  try {
    const data = await api.regenerateTownPlayerKit()
    playerKit.sprites = data.kit?.sprites || {}
    playerKit.portrait = data.kit?.portrait || null
  } catch (err) {
    console.warn('[town-admin] player kit regen failed:', err?.message)
  } finally {
    playerKitBusy.value = false
  }
}

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

const detailNpc = computed(() => {
  if (detail.value?.type !== 'npc') return null
  return npcs.value.find(n => n.id === detail.value.id) || null
})

const detailChar = computed(() => {
  if (detail.value?.type !== 'char') return null
  return chars.value.find(c => c.id === detail.value.id) || null
})

const detailName = computed(() => detailNpc.value?.displayName || detailChar.value?.displayName || '详情')

function spriteCount(npc) {
  return ['down', 'up'].filter(d => npc.sprites?.[d]?.status === 'ready').length
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
  busyFlags[`sprites${npc.id}`] = true
  try {
    await api.generateTownNpcSprites(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] sprites failed:', err?.message)
  } finally {
    busyFlags[`sprites${npc.id}`] = false
  }
}

async function makePortrait(npc) {
  busyFlags[`portrait${npc.id}`] = true
  try {
    await api.generateTownNpcPortrait(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] portrait failed:', err?.message)
  } finally {
    busyFlags[`portrait${npc.id}`] = false
  }
}

async function makeCharPortrait(c) {
  if (c.standingUrl) return // 已有立绘直接复用
  busyFlags[`charportrait${c.id}`] = true
  try {
    await api.generateTownCharacterPortrait(c.id)
    await loadChars()
  } catch (err) {
    console.warn('[town-admin] char portrait failed:', err?.message)
  } finally {
    busyFlags[`charportrait${c.id}`] = false
  }
}

async function invite(npc) {
  busyFlags[`invite${npc.id}`] = true
  try {
    await api.inviteTownNpc(npc.id)
    await loadNpcs()
    await loadChars()
  } catch (err) {
    console.warn('[town-admin] invite failed:', err?.message)
  } finally {
    busyFlags[`invite${npc.id}`] = false
  }
}

async function rerollNpc(npc) {
  busyFlags[`reroll${npc.id}`] = true
  try {
    await api.rerollTownNpc(npc.id)
    await loadNpcs()
  } catch (err) {
    console.warn('[town-admin] reroll failed:', err?.message)
  } finally {
    busyFlags[`reroll${npc.id}`] = false
  }
}

async function removeNpc(npc) {
  try {
    await api.deleteTownNpc(npc.id)
    detail.value = null
    await loadNpcs()
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
    for (const npc of npcs.value.filter(n => spriteCount(n) < 2)) {
      try { await api.generateTownNpcSprites(npc.id) } catch (err) { console.warn('[town-admin]', err?.message) }
      await loadNpcs()
    }
  } finally {
    batchSprites.value = false
  }
}

async function regenCharSprites(c) {
  busyFlags[`charsprites${c.id}`] = true
  try {
    await api.generateTownCharacterSprites(c.id)
    await loadChars()
  } catch (err) {
    console.warn('[town-admin] char sprites failed:', err?.message)
  } finally {
    busyFlags[`charsprites${c.id}`] = false
  }
}

async function generateAllMissingCharSprites() {
  batchChars.value = true
  try {
    for (const c of chars.value.filter(x => x.spriteCount < 2)) {
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
    detail.value = null
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
  loadPlayerKit()
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
  width: 440px;
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
  gap: 8px;
  padding: 16px 18px 8px;
}

.ap-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text-bright); }

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
.ap-actions.is-column { flex-direction: column; }

.ap-empty {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  padding: 30px 0;
}

.ap-empty.is-small { padding: 10px 0; font-size: 12px; }

/* ── 列表行（整行热区 → 详情页） ── */
.ap-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fbf8f3;
  border-radius: 14px;
  padding: 10px 12px;
  cursor: pointer;
  border: 1.5px solid transparent;
}

.ap-row:hover { border-color: rgba(224, 123, 108, 0.3); }

.ap-row-thumb {
  width: 44px;
  height: 56px;
  border-radius: 8px;
  background: #f1ebe1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.ap-row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
  image-rendering: pixelated;
}

.ap-row-thumb.is-portrait img { image-rendering: auto; }

.ap-thumb-missing { color: #cfc4b4; font-size: 14px; padding-bottom: 8px; }
.ap-thumb-missing.is-big { font-size: 13px; }

.ap-row-arrow { color: #c9bda9; font-size: 18px; flex-shrink: 0; }

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

.ap-npc-meta { font-size: 10px; color: var(--text-secondary); margin-top: 3px; opacity: 0.85; }

/* ── 详情页 ── */
.ap-detail { display: flex; flex-direction: column; gap: 14px; }

.ap-detail-media { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }

.ap-portrait-box {
  width: 100%;
  height: 300px;
  border-radius: 14px;
  background: #efe9de;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
}

.ap-portrait-box img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
}

.ap-detail-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-bright);
}

.ap-detail-switch { margin-left: auto; }

.ap-section { display: flex; flex-direction: column; gap: 8px; }
.ap-section-title { font-size: 12px; font-weight: 700; color: var(--text-secondary); }

.ap-sprite-row { display: flex; align-items: center; gap: 10px; }

.ap-sprite {
  width: 44px;
  height: 58px;
  border-radius: 8px;
  background: #f1ebe1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ap-sprite img { height: 100%; image-rendering: pixelated; }
.ap-sprite-missing { color: #cfc4b4; font-size: 12px; }
.ap-sprite-row > :last-child { margin-left: auto; }

.ap-player-sprite { width: 130px; }

.ap-persona, .ap-appearance {
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.7;
  margin: 0;
  background: #fbf8f3;
  border-radius: 10px;
  padding: 8px 10px;
}

.ap-appearance { color: var(--text-secondary); font-style: italic; }

.ap-routine-row {
  display: flex;
  gap: 10px;
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 8px;
  background: #fbf8f3;
}

.ap-routine-time { color: var(--accent-hover); min-width: 84px; font-variant-numeric: tabular-nums; }
.ap-routine-act { color: var(--text-primary); }

.ap-invited {
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(124, 176, 116, 0.12);
  border-radius: 10px;
  padding: 8px 12px;
}

/* ── 新增居民 ── */
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

/* ── 设置 ── */
.ap-setting { display: flex; align-items: center; gap: 12px; }
.ap-setting-label { flex: 1; font-size: 12px; color: var(--text-primary); }
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
