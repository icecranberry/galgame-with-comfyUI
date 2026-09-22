<template>
  <TownPaperPanel
:open="open" fade title="服务管理" kicker="邻舍小镇"
    :busy="batchRunning" :refreshing="loading" :refresh-disabled="loading || batchRunning"
    footer-text="服务 = 居民出手、你付钱；打工 = 你出力、居民付钱"
    @close="$emit('close')" @refresh="load"
>
    <p class="sm-legend">
      <span class="sm-chip is-service">服务</span>居民动手帮你做事，你要付钱给 TA；
      <span class="sm-chip is-work">打工</span>你帮居民干活，TA 会付你工资。
    </p>

    <linshe-tabs class="sm-scope" v-model="scope" size="sm" :options="scopeOptions" />
    <div class="sm-toolbar">
      <linshe-button
variant="secondary" size="sm" :loading="batchRunning" :disabled="batchRunning || !overview.length"
        @click="generateAll"
>
逐个生成全部
</linshe-button>
      <span v-if="batchRunning" class="sm-progress" role="status">{{ batchProgress }}</span>
    </div>

    <p v-if="error" class="sm-error" role="alert">{{ error }}</p>
    <p v-if="loading && !overview.length" class="sm-muted" role="status">正在读取居民名单</p>
    <p v-else-if="!overview.length" class="sm-muted">镇上还没有拥有服务或打工职责的居民，可以在居民详情里给 TA 授权限。</p>
    <p v-else-if="!filtered.length" class="sm-muted">{{ scopeEmptyText }}</p>

    <div class="sm-list">
      <article v-for="npc in filtered" :key="npc.key" class="sm-card">
        <div
class="sm-head" role="button" tabindex="0" @click="toggle(npc)"
          @keydown.enter.prevent="toggle(npc)" @keydown.space.prevent="toggle(npc)"
>
          <div class="sm-name">
            <b>{{ npc.displayName }}</b>
            <span class="sm-job">{{ townJobLabel(npc) }}</span>
            <span v-if="npc.source === 'character'" class="sm-tag">酒馆角色</span>
            <span v-if="npc.pendingProfile" class="sm-tag is-pending">待建档案</span>
          </div>
          <div class="sm-counts">
            <span v-if="npc.capabilities.includes('service')" class="sm-count is-service">服务 {{ npc.serviceCount }}</span>
            <span v-if="npc.capabilities.includes('work')" class="sm-count is-work">打工 {{ npc.workCount }}</span>
            <span v-if="npc.capabilities.includes('trade')" class="sm-count is-trade">货架</span>
            <span class="sm-arrow">{{ expanded === npc.key ? '收起' : '展开' }}</span>
          </div>
        </div>

        <Transition
:css="false" @enter="expandEnter" @leave="expandLeave"
          @enter-cancelled="resetExpand" @leave-cancelled="resetExpand"
>
          <div v-if="expanded === npc.key" class="sm-body">
            <div class="sm-body-inner">
            <template v-if="npc.pendingProfile">
              <p class="sm-muted">这位酒馆角色还没有镇上的档案。服务 / 打工项目要以居民档案落库，先建一份：它不进居民名单、不派岗、也不发朋友圈。</p>
              <div class="sm-actions">
                <linshe-button variant="secondary" size="sm" :loading="busy[`profile:${npc.key}`]" :disabled="batchRunning" @click="createProfile(npc)">建立镇上档案</linshe-button>
              </div>
              <p v-if="errors[npc.key]" class="sm-error" role="alert">{{ errors[npc.key] }}</p>
            </template>
            <template v-else>
            <div class="sm-actions">
              <linshe-button
v-for="kind in kindsOf(npc)" :key="kind" variant="secondary" size="sm"
                :loading="busy[`gen:${npc.key}:${kind}`]" :disabled="batchRunning" @click="generate(npc, kind)"
>
                {{ kindLabel(kind) }}  {{ hasOffers(npc, kind) ? '重新生成' : '生成' }}
              </linshe-button>
              <linshe-button
v-if="npc.capabilities.includes('trade')" variant="ghost" size="sm"
                :loading="busy[`stock:${npc.key}`]" :disabled="batchRunning" @click="refreshStock(npc)"
>
刷新货品种类
</linshe-button>
            </div>
            <p v-if="errors[npc.key]" class="sm-error" role="alert">{{ errors[npc.key] }}</p>
            <p v-if="stockInfo[npc.key]" class="sm-stock" role="status">{{ stockInfo[npc.key] }}</p>

            <div v-for="kind in kindsOf(npc)" :key="`list:${kind}`" class="sm-group">
              <div class="sm-group-title">{{ kindLabel(kind) }}项目</div>
              <p v-if="!offersOf(npc, kind).length" class="sm-muted">还没有项目，点上面的按钮生成。</p>
              <div v-for="offer in offersOf(npc, kind)" :key="offer.id" class="sm-offer">
                <div class="sm-offer-main">
                  <b>{{ offer.title }}</b>
                  <span class="sm-price">{{ kind === 'work' ? `工资 ${offer.price}` : `收费 ${offer.price}` }} 金币</span>
                  <p>{{ offer.description }}</p>
                </div>
                <linshe-button
variant="ghost" size="sm" :loading="busy[`reroll:${offer.id}`]" :disabled="batchRunning"
                  @click="reroll(npc, offer)"
>
换一个
</linshe-button>
              </div>
            </div>
            </template>
            </div>
          </div>
        </Transition>
      </article>
    </div>
  </TownPaperPanel>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useTownStore } from '../../stores/town.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheTabs from '../ui/LinsheTabs.vue'
import TownPaperPanel from './TownPaperPanel.vue'
import {
  fetchNpcOfferOverview, fetchNpcOffers, generateNpcOffers, rerollNpcOffer, refreshNpcStock,
  ensureTownCharacterProfile,
} from '../../api/townLife.js'

const props = defineProps({ open: Boolean, worldId: String })
defineEmits(['close'])

const overview = ref([])
const town = useTownStore()
const offers = reactive({})
const busy = reactive({})
const errors = reactive({})
const stockInfo = reactive({})
const loading = ref(false)
const error = ref('')
const expanded = ref(null)
const batchRunning = ref(false)
const batchProgress = ref('')

// 筛查口径：居民名单里混着原生居民和「酒馆角色」接管的居民，按来源分段筛选
const scope = ref('all')
const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '小镇NPC', value: 'npc' },
  { label: '酒馆角色', value: 'character' },
]
const filtered = computed(() => {
  const list = scope.value === 'all'
    ? overview.value
    : overview.value.filter(item => item.source === scope.value)
  if (town.currentMapId == null) return list
  const isCurrentTown = item => item.mapId != null && Number(item.mapId) === Number(town.currentMapId)
  return [...list].sort((a, b) => Number(isCurrentTown(b)) - Number(isCurrentTown(a)))
})
const scopeEmptyText = computed(() => scope.value === 'character'
  ? '还没有酒馆角色接管的居民拥有服务或打工职责。'
  : '这些居民里没有拥有服务或打工职责的。')

function kindsOf(npc) { return ['service', 'work'].filter(kind => npc.capabilities.includes(kind)) }
function townJobLabel(npc) {
  const townName = npc.mapId == null
    ? '尚未分配小镇'
    : town.maps.find(map => Number(map.id) === Number(npc.mapId))?.name || `小镇 #${npc.mapId}`
  return npc.job ? `${townName}-${npc.job}` : townName
}
function kindLabel(kind) { return kind === 'work' ? '打工' : '服务' }
function hasOffers(npc, kind) { return kind === 'work' ? npc.workCount > 0 : npc.serviceCount > 0 }
function offersOf(npc, kind) { return offers[`${npc.key}:${kind}`] || [] }

// 展开/收拢：子项内容高度是动态的，纯 CSS 做不到，用 scrollHeight 驱动 height 过渡。
function expandEnter(el, done) { runExpand(el, done, 'in') }
function expandLeave(el, done) { runExpand(el, done, 'out') }
function runExpand(el, done, direction) {
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    resetExpand(el)
    done()
  }
  el.style.overflow = 'hidden'
  el.style.transition = 'height .22s ease, opacity .22s ease'
  if (direction === 'in') {
    el.style.height = '0px'
    el.style.opacity = '0'
    void el.offsetHeight // 强制回流，让 0 起点生效
    el.style.height = `${el.scrollHeight}px`
    el.style.opacity = '1'
  } else {
    el.style.height = `${el.scrollHeight}px`
    el.style.opacity = '1'
    void el.offsetHeight
    el.style.height = '0px'
    el.style.opacity = '0'
  }
  el.addEventListener('transitionend', event => {
    if (event.target === el && event.propertyName === 'height') finish()
  })
  // 兜底：过渡事件偶尔不来（内容零高、被中断等），别让元素卡住
  setTimeout(finish, 320)
}
function resetExpand(el) {
  el.style.height = ''
  el.style.overflow = ''
  el.style.opacity = ''
  el.style.transition = ''
}

function messageFor(err) {
  return ({
    OFFER_JSON_MISSING: '这次没能生成出项目，请再试一次。',
    OFFER_EMPTY: '这次没有生成出可用的项目，请再试一次。',
    STOCK_JSON_MISSING: '这次没能生成出货品，请再试一次。',
    STOCK_EMPTY: '这次没有生成出可用的货品，请再试一次。',
    NPC_NOT_FOUND: '这位居民已经不在镇上了。',
    STALE_EPOCH: '小镇已更新，请刷新后重试。',
  })[err?.code] || err?.message || '操作没有完成。'
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const [list] = await Promise.all([fetchNpcOfferOverview(props.worldId), town.fetchMaps()])
    // 名单里既有居民也有酒馆角色：统一给一个稳定 key（待建档案的角色还没有 npcId）
    overview.value = (Array.isArray(list) ? list : []).map(item => ({
      ...item,
      key: item.npcId != null ? `npc:${item.npcId}` : `char:${item.characterId}`,
    }))
  } catch (err) {
    error.value = messageFor(err)
  } finally {
    loading.value = false
  }
}

async function loadOffers(npc) {
  try {
    const [service, work] = await Promise.all([
      fetchNpcOffers(npc.npcId, { worldId: props.worldId, kind: 'service' }),
      fetchNpcOffers(npc.npcId, { worldId: props.worldId, kind: 'work' }),
    ])
    offers[`${npc.key}:service`] = service.offers || []
    offers[`${npc.key}:work`] = work.offers || []
  } catch (err) {
    errors[npc.key] = messageFor(err)
  }
}

function toggle(npc) {
  if (expanded.value === npc.key) { expanded.value = null; return }
  expanded.value = npc.key
  errors[npc.key] = ''
  if (npc.pendingProfile) return
  if (!offers[`${npc.key}:service`] && !offers[`${npc.key}:work`]) loadOffers(npc)
}

function syncCounts(npc, kind, list) {
  const target = overview.value.find(item => item.key === npc.key)
  if (target) target[kind === 'work' ? 'workCount' : 'serviceCount'] = list.length
}

async function generate(npc, kind) {
  busy[`gen:${npc.key}:${kind}`] = true; errors[npc.key] = ''
  try {
    const result = await generateNpcOffers(npc.npcId, kind, props.worldId)
    offers[`${npc.key}:${kind}`] = result.offers || []
    syncCounts(npc, kind, result.offers || [])
  } catch (err) {
    errors[npc.key] = messageFor(err)
  } finally {
    busy[`gen:${npc.key}:${kind}`] = false
  }
}

/** 待建档案的酒馆角色：先补一份托管居民档案，服务 / 打工项目才有地方落库 */
async function createProfile(npc) {
  busy[`profile:${npc.key}`] = true; errors[npc.key] = ''
  try {
    const result = await ensureTownCharacterProfile(npc.characterId)
    await load()
    if (result?.npcId) {
      const key = `npc:${result.npcId}`
      expanded.value = key
      stockInfo[key] = '镇上档案已建好，现在可以生成服务 / 打工项目了。'
    }
  } catch (err) {
    errors[npc.key] = messageFor(err)
  } finally {
    busy[`profile:${npc.key}`] = false
  }
}

async function reroll(npc, offer) {
  busy[`reroll:${offer.id}`] = true; errors[npc.key] = ''
  try {
    const result = await rerollNpcOffer(npc.npcId, offer.id, props.worldId)
    const list = offers[`${npc.key}:${offer.kind}`] || []
    const index = list.findIndex(item => item.id === offer.id)
    if (index >= 0) list.splice(index, 1, result.offer)
  } catch (err) {
    errors[npc.key] = messageFor(err)
  } finally {
    busy[`reroll:${offer.id}`] = false
  }
}

async function refreshStock(npc) {
  busy[`stock:${npc.key}`] = true; errors[npc.key] = ''
  try {
    const result = await refreshNpcStock(npc.npcId, props.worldId)
    const pending = (result.goods || []).filter(good => good.imageStatus !== 'ready').length
    stockInfo[npc.key] = `货架已换新：${(result.goods || []).length} 件货品${pending ? `，${pending} 张图还在后台画` : ''}。`
  } catch (err) {
    errors[npc.key] = messageFor(err)
  } finally {
    busy[`stock:${npc.key}`] = false
  }
}

async function generateAll() {
  batchRunning.value = true
  const list = [...filtered.value]
  let done = 0
  try {
    for (const npc of list) {
      batchProgress.value = `正在处理 ${npc.displayName}（${++done}/${list.length}）`
      for (const kind of kindsOf(npc)) await generate(npc, kind)
      if (npc.capabilities.includes('trade')) await refreshStock(npc)
    }
    batchProgress.value = `全部完成，共 ${list.length} 位居民。`
  } finally {
    batchRunning.value = false
  }
}

watch(() => props.open, open => {
  if (!open) { expanded.value = null; batchProgress.value = ''; return }
  error.value = ''
  load()
}, { immediate: true })
</script>

<style scoped>
.sm-legend { margin: 0 0 12px; font-size: 12px; color: #7d6f64; line-height: 1.7; }
.sm-chip { display: inline-block; padding: 0 8px; border-radius: 999px; border: 1px solid currentColor; font-size: 11px; margin-right: 4px; }
.sm-chip.is-service { color: #b8874f; }
.sm-chip.is-work { color: #4f83a8; }
.sm-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.sm-progress { font-size: 12px; color: #7d6f64; }
.sm-muted { font-size: 12px; color: #9b8c80; margin: 6px 0; }
.sm-error { font-size: 12px; color: #b8574f; margin: 6px 0; }
.sm-stock { font-size: 12px; color: #4f8a5f; margin: 4px 0; }
.sm-list { display: flex; flex-direction: column; gap: 8px; }
.sm-card { border: 1px solid #e0d8d0; border-radius: 14px; background: #fbf8f5; overflow: hidden; }
.sm-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; cursor: pointer; }
.sm-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
.sm-name b { font-size: 14px; }
.sm-job { font-size: 12px; color: #9b8c80; }
.sm-tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid #cbb9a6; color: #a08363; }
.sm-tag.is-pending { border-color: #d9b3ae; color: #b8574f; }
.sm-scope { margin-bottom: 10px; }
.sm-counts { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.sm-count { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: #f0e9e2; color: #7d6f64; }
.sm-count.is-service { color: #b8874f; }
.sm-count.is-work { color: #4f83a8; }
.sm-count.is-trade { color: #4f8a5f; }
.sm-arrow { font-size: 12px; color: #b0a396; }
/* 展开/收拢：height 由 JS 按 scrollHeight 驱动（内联 transition），这里只留容器 */
.sm-body { overflow: hidden; }
.sm-body-inner { padding: 0 14px 14px; border-top: 1px solid #eee6df; }
.sm-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
.sm-group { margin-top: 10px; }
.sm-group-title { font-size: 12px; color: #9b8c80; margin-bottom: 4px; }
.sm-offer { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #eee6df; }
.sm-offer:last-child { border-bottom: 0; }
.sm-offer-main { min-width: 0; }
.sm-offer-main b { font-size: 13px; }
.sm-offer-main p { margin: 3px 0 0; font-size: 12px; color: #7d6f64; line-height: 1.6; }
.sm-price { margin-left: 8px; font-size: 12px; color: #b8874f; }
</style>
