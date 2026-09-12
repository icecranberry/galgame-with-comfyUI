<template>
  <Teleport to="body">
    <div class="tnt-overlay" @keydown.stop @keyup.stop @pointerdown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <div class="tnt-panel" role="dialog" aria-modal="true" :aria-label="`${displayName}的小买卖`">
        <header>
          <div><span class="tnt-kicker">小镇 · 买卖</span><h2>{{ displayName }}的小买卖</h2></div>
          <linshe-button variant="icon" size="sm" aria-label="关闭交易" @click="$emit('close')">✕</linshe-button>
        </header>
        <p v-if="error" class="tnt-error" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <div class="tnt-body">
          <p v-if="loading && !catalog" role="status">正在读取货摊…</p>
          <template v-if="catalog">
            <section aria-labelledby="tnt-sells">
              <h3 id="tnt-sells">TA 手上的货</h3>
              <p v-if="!catalog.sells.length" class="tnt-muted">货摊空着，改天再来。</p>
              <article v-for="spec in catalog.sells" :key="`s:${spec.templateId}`" class="tnt-row">
                <div><strong>{{ spec.name }}</strong><p class="tnt-muted">{{ spec.price }} 邻币一件</p></div>
                <linshe-button variant="primary" size="sm" :disabled="busy || spec.price <= 0" :loading="busy === `buy:${spec.templateId}`"
                  @click="trade('buy', spec)">买一件</linshe-button>
              </article>
            </section>
            <section aria-labelledby="tnt-buys">
              <h3 id="tnt-buys">TA 想收的货</h3>
              <p v-if="!catalog.buys.length" class="tnt-muted">暂时不收东西。</p>
              <article v-for="spec in catalog.buys" :key="`b:${spec.templateId}`" class="tnt-row">
                <div><strong>{{ spec.name }}</strong><p class="tnt-muted">回收价 {{ spec.price }} 邻币 · 你有 {{ spec.holds }} 件</p></div>
                <template v-if="sellable(spec).length">
                  <linshe-button variant="secondary" size="sm" :disabled="busy" :loading="busy === `sell:${spec.templateId}`"
                    @click="trade('sell', spec, sellable(spec)[0])">卖一件</linshe-button>
                </template>
                <span v-else class="tnt-muted">背包里没有</span>
              </article>
            </section>
            <p class="tnt-muted">成交都要面对面：先走到{{ displayName }}身边再操作。价格由镇上定价，不还价。</p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import * as api from '../../api/index.js'
import { useBackpackStore } from '../../stores/backpack.js'

const props = defineProps({ npcId: { type: Number, required: true }, displayName: String,
  worldId: String, worldEpoch: Number, open: Boolean })
const emit = defineEmits(['close', 'traded'])
const catalog = ref(null), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('')
const backpack = useBackpackStore()
const displayName = computed(() => catalog.value?.displayName || props.displayName || '邻居')
/** 只列能卖的：ready、未退休、未上锁、没被用掉效果的模板匹配项。 */
function sellable(spec) {
  return (backpack.items || []).filter(item => (item.templateId ?? item.template_id) === spec.templateId
    && item.status === 'ready' && !item.retiredAt && !item.lockedBy
    && Number.isSafeInteger(item.id) && Number.isSafeInteger(item.version ?? item.expectedVersion))
}
function message(e) {
  return ({ NOT_ARRIVED: '先走到TA身边再交易。', INSUFFICIENT_FUNDS: '可用邻币不足，暂时买不了。',
    INSUFFICIENT_STOCK: 'TA手上的货暂时不够。', INVALID_TRADE_ITEM: '这里不做这件物品的生意。',
    ITEM_NOT_TRADABLE: '这件物品不能交易。', GIFT_COOLDOWN: '今天已经送过了，改天再来。',
    TEMPLATE_NOT_FOUND: '这件商品的模板还没准备好，请稍后再来。', STALE_EPOCH: '小镇已更新，请重新打开。',
    VERSION_CONFLICT: '物品状态已变化，请重新读取背包。' })[e.code] || e.message || '交易没有完成。'
}
async function refresh() {
  if (!props.open) return
  loading.value = true; error.value = ''
  try {
    const data = await api.fetchTownNpcTrade(props.npcId)
    catalog.value = data
    backpack.fetchItems().catch(() => {})
  } catch (e) { error.value = message(e) }
  finally { loading.value = false }
}
async function trade(direction, spec, item = null) {
  if (busy.value || !props.worldId || !Number.isSafeInteger(props.worldEpoch)) return
  const tag = `${direction}:${spec.templateId}`
  busy.value = tag; error.value = ''; notice.value = ''
  try {
    const result = await api.tradeWithTownNpc(props.npcId, {
      worldEpoch: props.worldEpoch, direction, templateId: spec.templateId,
      ...(direction === 'sell' && item ? { itemId: item.id, expectedVersion: item.version ?? item.expectedVersion } : {}),
    })
    notice.value = direction === 'buy'
      ? `买下了「${spec.name}」，花了 ${result.price} 邻币，已放进背包。`
      : `卖出了「${spec.name}」，收回 ${result.price} 邻币。`
    backpack.fetchItems().catch(() => {})
    emit('traded')
    await refresh()
  } catch (e) { error.value = message(e) }
  finally { busy.value = false }
}
watch(() => [props.open, props.npcId], ([open]) => {
  catalog.value = null; notice.value = ''; error.value = ''
  if (open) refresh()
}, { immediate: true })
</script>

<style scoped>
.tnt-overlay { position: fixed; inset: 0; z-index: 10040; background: rgba(0,0,0,.45); color: #574a40; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
.tnt-panel { background: #fffaf1; border: 1px solid #8d7968; border-radius: 16px; width: min(480px, 100%); max-height: min(640px, 100%); display: flex; flex-direction: column; padding: 20px 24px; box-shadow: 0 12px 32px #362a3833; box-sizing: border-box; }
header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.tnt-kicker { color: #a1846e; font-size: 10px; letter-spacing: .15em; }
h2 { color: #59483d; font-size: 18px; font-weight: 700; margin: 4px 0; }
h3 { font-size: 15px; margin: 14px 0 6px; font-weight: 600; }
.tnt-body { overflow-y: auto; min-height: 0; }
.tnt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #eee5db; }
.tnt-row:last-of-type { border-bottom: 0; }
.tnt-row strong { font-size: 14px; font-weight: 500; }
.tnt-muted { color: #918278; font-size: 12px; margin: 2px 0 0; }
.tnt-error { color: #b8574f; font-size: 13px; }
p { margin: 6px 0; overflow-wrap: anywhere; font-size: 13px; }
section { margin-bottom: 14px; }
</style>
