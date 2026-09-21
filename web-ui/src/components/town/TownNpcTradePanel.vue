<template>
  <TownPaperPanel
:open="open" :title="`${displayName}  ${isNpc ? '货摊' : '交易'}`" :busy="!!busy" :refreshing="loading"
    :refresh-disabled="loading || !!busy" @refresh="refresh" @close="$emit('close')"
>
    <p v-if="error" class="tnt-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="tnt-notice" role="status">{{ notice }}</p>
    <div class="tnt-body">
      <p v-if="loading && !loaded" role="status">正在读取货摊</p>

      <!-- 居民：格子货架，每 3 天由后台自动换一批并预生成图标 -->
      <template v-if="isNpc && stock">
        <div class="tnt-favor">
          <span v-if="wallet" class="tnt-balance">我的金币 <b>{{ wallet.available }}</b></span>
          <span class="tnt-muted">买下的东西会放进酒馆背包，可以送给角色</span>
        </div>
        <p v-if="rolling" class="tnt-rolling" role="status">正在后台补货，稍等一下</p>
        <p v-else-if="!stock.goods.length" class="tnt-muted">货架空了，等下一批货，或去服务管理里刷新货品。</p>
        <div class="tnt-grid">
          <article
v-for="good in stock.goods" :key="good.id" class="tnt-good" :class="{ 'is-sold': good.sold }"
            role="button" tabindex="0" @click="openDetail(good)" @keydown.enter.prevent="openDetail(good)"
>
            <div class="tnt-thumb">
              <img v-if="good.imageUrl" :src="good.imageUrl" :alt="good.title" @error="onImageError(good)" />
              <span v-else class="tnt-thumb-pending">{{ good.imageStatus === 'failed' ? '无图' : '绘制中' }}</span>
            </div>
            <div class="tnt-good-body">
              <div class="tnt-good-head">
                <b>{{ good.title }}</b>
                <span class="tnt-price">{{ good.price }} 金币</span>
              </div>
              <p class="tnt-desc">{{ good.description }}</p>
              <div class="tnt-good-foot">
                <span class="tnt-view">查看详情</span>
                <linshe-button
variant="secondary" size="sm" :disabled="!!busy || loading || good.sold || !canAfford(good)"
                  :title="!canAfford(good) && !good.sold ? '可用金币不够' : ''"
                  :loading="busy === good.id" @click="buy(good)"
>
{{ good.sold ? '已售出' : (canAfford(good) ? '买下' : '金币不够') }}
</linshe-button>
              </div>
            </div>
          </article>
        </div>
      </template>

      <!-- 建筑：沿用店内模板货品 -->
      <template v-else-if="!isNpc && catalog">
        <section aria-labelledby="tnt-sells">
          <h3 id="tnt-sells">这里的商品</h3>
          <p v-if="!catalog.sells.length" class="tnt-muted">暂时没有上架商品。</p>
          <article v-for="spec in catalog.sells" :key="`s:${spec.templateId}`" class="tnt-row">
            <div><strong>{{ spec.name }}</strong><p class="tnt-muted">{{ spec.price }} 金币一件</p></div>
            <linshe-button
variant="secondary" size="sm" :disabled="!!busy || loading || spec.price <= 0"
              :loading="busy === spec.templateId" @click="buyTemplate(spec)"
>
买一件
</linshe-button>
          </article>
        </section>
        <p class="tnt-muted">只卖不收：付钱后物品直接放进背包。</p>
      </template>
    </div>

    <!-- 商品详情：样式对齐酒馆背包里的道具详情 -->
    <Transition name="detail-fade">
      <div v-if="detailGood" class="item-detail-overlay" @click.self="detailGood = null">
        <div class="item-detail-dialog">
          <div class="detail-header">
            <span>商品详情</span>
            <linshe-button variant="icon" size="sm" aria-label="关闭详情" @click="detailGood = null">&times;</linshe-button>
          </div>
          <div class="detail-body">
            <div class="detail-image">
              <img v-if="detailGood.imageUrl" :src="detailGood.imageUrl" :alt="detailGood.title" @error="onImageError(detailGood)" />
              <span v-else class="detail-image-empty">{{ detailGood.imageStatus === 'failed' ? '无图' : '绘制中' }}</span>
            </div>
            <div class="detail-name-row"><span class="detail-name">{{ detailGood.title }}</span></div>
            <div class="detail-kind">{{ detailGood.price }} 金币</div>
            <p class="detail-desc">{{ detailGood.description }}</p>
            <div class="detail-actions">
              <linshe-button variant="secondary" @click="detailGood = null">关闭</linshe-button>
              <linshe-button
variant="primary" :disabled="!!busy || loading || detailGood.sold || !canAfford(detailGood)"
                :loading="busy === detailGood.id" @click="buyFromDetail"
>
{{ detailGood.sold ? '已售出' : (canAfford(detailGood) ? '买下' : '金币不够') }}
</linshe-button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </TownPaperPanel>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPaperPanel from './TownPaperPanel.vue'
import { fetchTownTargetTrade, createTownTargetTradeCommand, executeTownLifeCommand,
  fetchNpcStock, buyNpcStock, getTownWallet } from '../../api/townLife.js'
import { onEvent } from '../../stores/unifiedStream.js'
import { useBackpackStore } from '../../stores/backpack.js'

const props = defineProps({ npcId: Number, actorKey: String, displayName: String,
  worldId: String, worldEpoch: Number, open: Boolean })
const emit = defineEmits(['close', 'traded', 'service'])

const catalog = ref(null), stock = ref(null), detailGood = ref(null)
const loading = ref(false), busy = ref(null), error = ref(''), notice = ref(''), rolling = ref(false)
const wallet = ref(null)
const loaded = ref(false)
let generation = 0
const target = () => props.actorKey || `npc:${props.npcId}`
// 建筑目标（location:）即使有店员，也走店内货品目录；只有居民目标才看个人货架。
const isNpc = computed(() => {
  const key = String(props.actorKey || '')
  if (key.startsWith('location:')) return false
  if (key.startsWith('npc:')) return true
  return !!props.npcId
})
const backpack = useBackpackStore()
const displayName = computed(() => stock.value?.displayName || catalog.value?.displayName || props.displayName || '邻居')
// 余额未知时不拦人（避免误判），已知才禁用买不起的货。
function canAfford(good) { return !wallet.value || wallet.value.available >= good.price }
// 图标文件缺失 / 生图失败时别把破图留在货架上；补画完成后 SSE 会把状态改回 ready。
function onImageError(good) {
  good.imageStatus = 'failed'
  good.imageUrl = null
}

function message(e) {
  return ({ INSUFFICIENT_FUNDS: '可用金币不足，暂时买不了。',
    INSUFFICIENT_STOCK: 'TA手上的货暂时不够。', INVALID_TRADE_ITEM: '这里不做这件物品的生意。',
    NOT_A_TRADER: 'TA这里不做买卖。', TEMPLATE_NOT_FOUND: '这件商品的模板还没准备好，请稍后再来。',
    STOCK_NOT_FOUND: '这件货品已经不在货架上了。', STOCK_SOLD: '这件货品刚刚被买走了。',
    STALE_EPOCH: '小镇已更新，请重新打开。' })[e.code] || e.message || '交易没有完成。'
}

async function refresh() {
  if (!props.open) return
  const current = generation
  loading.value = true; error.value = ''
  try {
    if (isNpc.value && props.npcId) {
      const data = await fetchNpcStock(props.npcId, props.worldId)
      if (current !== generation) return
      stock.value = data
      rolling.value = !!data.rolling
      catalog.value = null
    } else {
      const data = await fetchTownTargetTrade(target())
      if (current !== generation) return
      catalog.value = data
      stock.value = null
    }
    loaded.value = true
    getTownWallet().then(data => { if (current === generation) wallet.value = data }).catch(() => {})
    backpack.fetchItems().catch(() => {})
  } catch (e) { if (current === generation) error.value = message(e) }
  finally { if (current === generation) loading.value = false }
}

async function buy(good) {
  if (!props.open || busy.value || loading.value || !props.worldId || !Number.isSafeInteger(props.worldEpoch)) return
  const current = generation
  busy.value = good.id; error.value = ''; notice.value = ''
  try {
    const result = await buyNpcStock(props.npcId, good.id, { worldId: props.worldId, worldEpoch: props.worldEpoch })
    if (current !== generation) return
    const spent = result.money?.amount ?? good.price
    notice.value = result.alreadyOwned
      ? `「${good.title}」已经在背包里了，这次没有重复扣款。`
      : `「${good.title}」已放进背包，花了 ${spent} 金币。可以在酒馆背包里把它送给角色。`
    backpack.fetchItems().catch(() => {})
    emit('traded')
    await refresh()
  } catch (e) { if (current === generation) error.value = message(e) }
  finally { if (current === generation) busy.value = null }
}

function openDetail(good) {
  if (!good) return
  detailGood.value = good
}
// 详情里的「买下」：走同一条购买链路，买完把详情关掉（货架会重新拉取）。
async function buyFromDetail() {
  const good = detailGood.value
  if (!good) return
  await buy(good)
  detailGood.value = null
}
async function buyTemplate(spec) {
  if (!props.open || busy.value || loading.value || !props.worldId || !Number.isSafeInteger(props.worldEpoch)) return
  const current = generation
  busy.value = spec.templateId; error.value = ''; notice.value = ''
  try {
    const command = createTownTargetTradeCommand(target(), { worldId: props.worldId, worldEpoch: props.worldEpoch,
      templateId: spec.templateId })
    const result = await executeTownLifeCommand(command)
    if (current !== generation) return
    notice.value = `买下了「${spec.name}」，花了 ${result.price} 金币，已放进背包。`
    backpack.fetchItems().catch(() => {})
    emit('traded')
    await refresh()
  } catch (e) { if (current === generation) error.value = message(e) }
  finally { if (current === generation) busy.value = null }
}

let unsubscribers = []
function subscribe() {
  unsubscribers.push(onEvent('town_npc_stock_ready', d => {
    if (!d || d.npcId !== props.npcId || !stock.value) return
    const good = stock.value.goods.find(item => item.id === d.stockId)
    if (good) { good.imageUrl = d.imageUrl || null; good.imageStatus = d.imageUrl ? 'ready' : 'failed' }
  }))
  // 后台换货完成  面板开着就重新读取，玩家不需要手动刷新。
  unsubscribers.push(onEvent('town_npc_stock_rolled', d => {
    if (!d || d.npcId !== props.npcId) return
    if (props.open) refresh()
  }))
}
function unsubscribe() { for (const off of unsubscribers.splice(0)) off() }

watch(() => [props.open, props.npcId, props.actorKey, props.worldId, props.worldEpoch], ([open]) => {
  generation++; busy.value = null; loading.value = false; loaded.value = false
  catalog.value = null; stock.value = null; notice.value = ''; error.value = ''; rolling.value = false
  unsubscribe()
  if (open) { subscribe(); refresh() }
}, { immediate: true })
onBeforeUnmount(() => { generation++; unsubscribe() })
</script>

<style scoped>
h3 { font-size: 15px; margin: 14px 0 6px; font-weight: 600; }
/* overflow-x clip：行内按钮贴右缘，果冻动画 scale(1.04) 会把横向滚动条闪出来（同 TownResidentActions） */
.tnt-body { overflow-y: auto; overflow-x: clip; overflow-clip-margin: 6px; min-height: 0; }
.tnt-favor { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 2px 0 8px; flex-wrap: wrap; }
.tnt-favor b { font-size: 14px; color: var(--accent); font-variant-numeric: tabular-nums; }
.tnt-balance { font-size: 12px; color: #7d6f64; }
.tnt-balance b { font-size: 13px; color: #4f8a5f; }
.tnt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 7px; }
@media (max-width: 560px) { .tnt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tnt-good { border: 1px solid var(--border, rgba(255,255,255,.12)); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; background: rgba(255,255,255,.03); }
.tnt-good.is-sold { opacity: .5; }
.tnt-thumb { aspect-ratio: 1 / 1; background: rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; }
.tnt-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tnt-thumb-pending { font-size: 11px; opacity: .55; }
.tnt-good-body { padding: 6px 7px 7px; display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.tnt-good-head { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; min-width: 0; }
.tnt-good-head b { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tnt-price { font-size: 11px; color: var(--accent); flex-shrink: 0; }
.tnt-desc { font-size: 11px; opacity: .72; line-height: 1.4; margin: 0; flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tnt-good-foot { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.tnt-favor-chip { font-size: 10px; padding: 0 6px; border-radius: 999px; background: rgba(224, 168, 107, .16); color: #e0a86b; white-space: nowrap; }
.tnt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.tnt-row:last-of-type { border-bottom: 0; }
.tnt-row strong { font-size: 14px; font-weight: 500; }
.tnt-muted { opacity: .8; font-size: 12px; margin: 2px 0 0; }
.tnt-error { color: #e0896f; font-size: 13px; }
.tnt-notice { color: #9ad18f; font-size: 13px; }
.tnt-rolling { color: var(--accent); font-size: 12px; margin: 4px 0; }
.tnt-view { font-size: 10px; opacity: .6; }
.tnt-good[role='button'] { cursor: pointer; }
.tnt-good[role='button']:hover { border-color: var(--accent); }
.tnt-good[role='button']:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* 商品详情：口径与酒馆背包的道具详情一致（暖纸底 + 白色圆角面板 + 208 大方图） */
.item-detail-overlay {
  position: fixed; inset: 0; z-index: 1300; background: #f6f2eef1;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.item-detail-dialog {
  background: #fffdf9; border-radius: 16px; padding: 16px; width: min(430px, 92%);
  max-height: 84%; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0, 0, 0, .12);
}
.detail-header { display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: var(--text-bright); margin-bottom: 8px; }
.detail-body { overflow-y: auto; display: flex; flex-direction: column; align-items: center; padding: 12px; }
.detail-image {
  width: 208px; height: 208px; border-radius: 16px; background: #f5efe7; overflow: hidden;
  display: flex; align-items: center; justify-content: center; margin-bottom: 12px;
}
.detail-image img { width: 100%; height: 100%; object-fit: cover; }
.detail-image-empty { font-size: 12px; color: var(--text-secondary); }
.detail-name-row { display: flex; align-items: center; gap: 8px; }
.detail-name { font-weight: 700; font-size: 16px; color: var(--text-bright); }
.detail-kind { margin-top: 6px; font-size: 12px; color: var(--accent); font-weight: 600; }
.detail-desc { margin: 10px 0 0; font-size: 13px; line-height: 1.7; color: var(--text-primary); text-align: center; }
.detail-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: center; }
.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity .22s ease; }
.detail-fade-enter-active .item-detail-dialog, .detail-fade-leave-active .item-detail-dialog { transition: transform .22s ease; }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; }
.detail-fade-enter-from .item-detail-dialog, .detail-fade-leave-to .item-detail-dialog { transform: scale(.95) translateY(12px); }
p { margin: 6px 0; overflow-wrap: anywhere; font-size: 13px; }
section { margin-bottom: 14px; }
</style>
