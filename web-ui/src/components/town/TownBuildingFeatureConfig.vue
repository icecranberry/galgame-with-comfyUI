<template>
  <!-- 从管理面板（body 层抽屉）打开：不能锚定 .page-host——#app 是 z-index:1 的层叠上下文，
       锚进去会被面板的 z:900 整体压住；去掉 anchor 走 body 层 z:var(--z-modal)，盖在面板上 -->
  <LinsheModal v-model="open" title="特殊建筑功能" wide>
    <!-- 顶部批量动作：都逐栋走单栋生成接口，一栋失败不影响其余；停用中的建筑不参与 -->
    <template #header-extra>
      <linshe-button
        variant="secondary" size="sm"
        :loading="batchMode === BATCH_ALL"
        :disabled="batchBlocked"
        @click="requestBatchAll"
      >{{ batchArmed === BATCH_ALL ? `确认重新生成 ${batchAllCount} 栋` : '全部重新生成' }}</linshe-button>
      <linshe-button
        variant="secondary" size="sm"
        :loading="batchMode === BATCH_MISSING"
        :disabled="batchBlocked"
        @click="requestBatchMissing"
      >补齐空缺店铺功能</linshe-button>
    </template>
    <div class="bfc-body">
      <p class="bfc-intro">只收录特殊建筑；同名建筑共享同一份功能，操作一处即整组生效。按建筑自己的用途描述生成一个最贴合的可执行功能（两段式：选模板 + 生成参数）。生成结果用右上角系统通知反馈；浏览与确定性玩法零模型调用。</p>
      <div v-if="loading" class="bfc-state" role="status">正在读取建筑清单…</div>
      <p v-else-if="error" class="bfc-error" role="alert">{{ error }}
        <linshe-button variant="link" size="sm" @click="load">重新读取</linshe-button>
      </p>
      <p v-else-if="!buildings.length" class="bfc-state">这张地图上还没有特殊建筑。</p>
      <div v-else class="bfc-list">
        <div v-for="building in buildings" :key="building.locationKey" class="bfc-item" :class="{ 'is-stale': building.status === 'stale', 'is-disabled': building.status === 'disabled' }">
          <div class="bfc-item-head">
            <span class="bfc-name">{{ building.title }}</span>
            <span class="bfc-status" :data-status="building.status">{{ statusLabel(building) }}</span>
            <span v-if="building.manual" class="bfc-tag">手工维护</span>
          </div>
          <p class="bfc-desc">
            <template v-if="building.descriptionMissing"><span class="bfc-desc-missing">还没有用途描述——置空就用店名当用途描述，生成功能照常可用；补一句它做什么用会更贴合。</span></template>
            <template v-else>{{ building.description }}</template>
            <span class="bfc-desc-source">（来源：{{ sourceLabel(building) }}）</span>
          </p>
          <div v-if="building.features.length" class="bfc-features">
            <div v-for="feature in building.features" :key="feature.featureId" class="bfc-feature">
              <strong>{{ feature.title }}</strong>
              <span class="bfc-feature-price">{{ priceLabel(feature.priceTier) }}</span>
              <p>{{ feature.presentation?.opening }}</p>
            </div>
          </div>
          <p v-if="building.unsupported?.length" class="bfc-unsupported">
            暂不支持：{{ building.unsupported.map(u => u.sourceText).join('；') }}
          </p>
          <p v-if="building.status === 'failed' && building.lastError" class="bfc-unsupported">上次生成失败：{{ building.lastError }}</p>
          <div class="bfc-actions">
            <linshe-input
              v-if="editing === building.locationKey" v-model="editingText" type="textarea" :rows="2" size="sm"
              :maxlength="1000" placeholder="这栋建筑是做什么用的？（留空就用店名；10—200 字效果最好）" class="bfc-edit-input"
            />
            <div class="bfc-actions-row">
              <linshe-button v-if="editing !== building.locationKey" variant="ghost" size="sm" @click="beginEdit(building)">改用途描述</linshe-button>
              <template v-else>
                <linshe-button variant="primary" size="sm" :loading="saving === building.locationKey" @click="saveDescription(building)">保存描述</linshe-button>
                <linshe-button variant="ghost" size="sm" @click="cancelEdit">取消</linshe-button>
              </template>
              <linshe-button
                variant="secondary" size="sm" :loading="generating === building.locationKey"
                :disabled="building.status === 'generating' || !!batchMode"
                @click="generate(building)"
              >{{ building.status === 'unconfigured' || building.status === 'failed' ? '生成功能' : '重新生成' }}</linshe-button>
              <linshe-button v-if="['ready', 'partial', 'stale'].includes(building.status)" variant="danger" size="sm" @click="setEnabled(building, false)">停用</linshe-button>
              <linshe-button v-else-if="building.status === 'disabled'" variant="secondary" size="sm" @click="setEnabled(building, true)">启用</linshe-button>
            </div>
            <p v-if="itemError === building.locationKey" class="bfc-error" role="alert">{{ itemErrorText }}</p>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <span class="bfc-footer-hint">{{ footerHint }}</span>
      <linshe-button variant="secondary" size="sm" @click="open = false">关闭</linshe-button>
    </template>
  </LinsheModal>
</template>

<script setup>
import { computed, inject, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheModal from '../ui/LinsheModal.vue'
import {
  fetchBuildingFeatureOverview, generateBuildingFeatures, updateBuildingDescription, setBuildingFeatureEnabled,
} from '../../api/townBuildingFeatures.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'changed'])

const open = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})
const buildings = ref([])
const loading = ref(false)
const error = ref('')
const generating = ref('')
const saving = ref('')
const toast = inject('toast')
const editing = ref('')
const editingText = ref('')
const itemError = ref('')
const itemErrorText = ref('')

// 批量动作（顶部两个按钮）
const BATCH_ALL = 'all'
const BATCH_MISSING = 'missing'
const batchMode = ref('')
const batchArmed = ref('')
const batchProgress = ref({ done: 0, total: 0 })
/** 批量目标：停用中的建筑不参与（显式停用优先于批量）；「空缺」= 从未成功配置过 */
function batchTargets(mode) {
  if (mode === BATCH_ALL) return buildings.value.filter(b => b.status !== 'disabled')
  return buildings.value.filter(b => b.status === 'unconfigured' || b.status === 'failed')
}
const batchAllCount = computed(() => batchTargets(BATCH_ALL).length)
const batchBlocked = computed(() => !!batchMode.value || loading.value || !!generating.value
  || !buildings.value.length)
const footerHint = computed(() => {
  if (batchMode.value) {
    const { done, total } = batchProgress.value
    return `批量生成中 ${done}/${total} 栋：每栋先选模板（1 次调用），再为选中模板生成参数（各 1 次）。`
  }
  if (generating.value) return '生成中：先选模板（1 次调用），再为每个选中模板生成参数（各 1 次）；每段失败最多补一次修复。'
  return `共 ${buildings.value.length} 栋特殊建筑`
})

const STATUS_LABELS = {
  unconfigured: '未配置', generating: '生成中', ready: '已配置', partial: '部分支持',
  unsupported: '不支持', failed: '生成失败', stale: '描述已变更，需重新生成', disabled: '已停用',
}
const statusLabel = building => STATUS_LABELS[building.status] || building.status
const SOURCE_LABELS = {
  'location.feature_desc': '建筑用途', 'asset.meta.desc': '素材描述',
  'asset.meta.featureDescription': '初始化用途',
}
/** 描述来源：生成时用店名回填的那份，与玩家手填区分开，避免被当成用户写过的内容 */
const sourceLabel = building => {
  if (building.descriptionSource === 'location.feature_desc' && building.description
    && building.description === building.title) return '自动取店名'
  return SOURCE_LABELS[building.descriptionSource] || '缺失'
}
const TIER_PRICES = { free: '免费', basic: '5 金币', standard: '15 金币', premium: '40 金币' }
const priceLabel = tier => TIER_PRICES[tier] || tier

function showError(err) {
  return ({
    FEATURE_MANUAL_LOCKED: '这份配置是手工维护的，重新生成前请先确认覆盖。',
    GENERATION_INVALID: '生成结果未通过校验，请重试。',
    STALE_EPOCH: '小镇已更新，请重新打开面板。',
  })[err?.code] || err?.message || '这次操作没有完成，请稍后再试。'
}

async function load() {
  batchArmed.value = ''
  loading.value = true; error.value = ''
  try {
    const result = await fetchBuildingFeatureOverview()
    buildings.value = result.buildings || []
  } catch (err) { error.value = showError(err) }
  finally { loading.value = false }
}

watch(() => props.open, value => { if (value) load() })

function beginEdit(building) {
  editing.value = building.locationKey
  editingText.value = building.description || ''
}
function cancelEdit() { editing.value = '' }
async function saveDescription(building) {
  saving.value = building.locationKey; itemError.value = ''
  try {
    // 显式带 mapId：不依赖玩家当前所在图（玩家可能不在被管理的镇里）
    await updateBuildingDescription(building.locationKey, { mapId: building.mapId, description: editingText.value })
    editing.value = ''
    await load()
    emit('changed')
  } catch (err) { itemError.value = building.locationKey; itemErrorText.value = showError(err) }
  finally { saving.value = '' }
}
/** 单栋生成：单人点按钮时给 toast 摘要；批量时静默，由批量收尾统一汇报 */
async function generateOne(building, { force, silent = false } = {}) {
  generating.value = building.locationKey; itemError.value = ''
  try {
    await generateBuildingFeatures(building.locationKey, { force: force === true })
    await load()
    const row = buildings.value.find(b => b.locationKey === building.locationKey)
    if (!silent) {
      // 右上角系统 toast 反馈生成结果（列出功能名与价格）
      const list = (row?.features || []).map(f => `${f.title}（${priceLabel(f.priceTier)}）`).join('、')
      const unsupported = row?.unsupported?.length ? `；另有 ${row.unsupported.length} 项目录外用途未实现` : ''
      toast(`「${row?.title || building.title}」生成功能：${list || '无可用功能'}${unsupported}。到镇上点击这栋建筑即可使用`, 'success', 6000)
    }
    emit('changed')
    return row
  } catch (err) {
    itemError.value = building.locationKey; itemErrorText.value = showError(err)
    throw err
  } finally { generating.value = '' }
}

/** 生成功能：缺用途描述不再拦，服务端会先用建筑名回填 feature_desc 再生成 */
function generate(building) {
  return generateOne(building, { force: building.manual === true }).catch(() => {})
}

/** 批量生成：逐栋调单栋接口，一栋失败不打断后续；停用中的建筑不参与 */
async function runBatch(mode) {
  batchArmed.value = ''
  const targets = batchTargets(mode)
  if (!targets.length) {
    toast(mode === BATCH_ALL ? '这张地图上还没有可以生成的建筑。' : '没有空缺的建筑功能，每栋都已经配置过了。', 'info', 4000)
    return
  }
  batchMode.value = mode
  batchProgress.value = { done: 0, total: targets.length }
  const failed = []
  try {
    for (const building of targets) {
      try {
        await generateOne(building, { force: mode === BATCH_ALL || building.manual === true, silent: true })
      } catch {
        failed.push(building.title || building.locationKey)
      }
      batchProgress.value = { done: batchProgress.value.done + 1, total: targets.length }
    }
  } finally {
    batchMode.value = ''
    batchProgress.value = { done: 0, total: 0 }
  }
  const ok = targets.length - failed.length
  toast(failed.length
    ? `批量生成结束：${ok} 栋成功，${failed.length} 栋失败（${failed.join('、')}），失败的可在列表里单独重试。`
    : `批量生成结束：${ok} 栋建筑都已配置好，到镇上点击建筑即可使用。`,
  failed.length ? 'error' : 'success', 8000)
}

/** 「全部重新生成」会覆盖现有配置，第一次点击变成确认态，再点一次才真的开始 */
function requestBatchAll() {
  if (batchArmed.value === BATCH_ALL) return runBatch(BATCH_ALL)
  batchArmed.value = BATCH_ALL
}

function requestBatchMissing() {
  batchArmed.value = ''
  return runBatch(BATCH_MISSING)
}

async function setEnabled(building, enabled) {
  itemError.value = ''
  try {
    await setBuildingFeatureEnabled(building.locationKey, { enabled })
    await load()
    emit('changed')
  } catch (err) { itemError.value = building.locationKey; itemErrorText.value = showError(err) }
}
</script>

<style scoped>
.bfc-body { display: flex; flex-direction: column; gap: 12px; }
.bfc-intro { font-size: 13px; opacity: 0.75; line-height: 1.6; }
.bfc-state, .bfc-error { font-size: 13px; }
.bfc-error { color: #b4443c; }
.bfc-list { display: flex; flex-direction: column; gap: 10px; }
.bfc-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
.bfc-item.is-stale { border-color: #c07f2f; }
.bfc-item.is-disabled { opacity: 0.6; }
.bfc-item-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bfc-name { font-weight: 600; font-size: 14px; }
.bfc-status { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--tint-subtle); }
.bfc-status[data-status='ready'], .bfc-status[data-status='partial'] { background: rgba(97, 139, 85, 0.18); }
.bfc-status[data-status='stale'], .bfc-status[data-status='failed'] { background: rgba(192, 127, 47, 0.2); }
.bfc-tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid currentColor; opacity: 0.8; }
.bfc-desc { font-size: 12px; line-height: 1.6; opacity: 0.8; }
.bfc-desc-missing { color: #b4443c; }
.bfc-desc-source { opacity: 0.7; }
.bfc-features { display: flex; flex-direction: column; gap: 6px; }
.bfc-feature { font-size: 12px; padding: 6px 8px; border-radius: 8px; background: var(--tint-subtle); }
.bfc-feature p { margin: 2px 0 0; opacity: 0.8; }
.bfc-feature-price { margin-left: 6px; opacity: 0.7; }
.bfc-unsupported { font-size: 12px; color: #8a6a2f; }
.bfc-actions { display: flex; flex-direction: column; gap: 6px; }
.bfc-actions-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.bfc-edit-input { width: 100%; }
.bfc-footer-hint { font-size: 12px; opacity: 0.7; margin-right: auto; }
@media (prefers-reduced-motion: reduce) {
}
</style>
