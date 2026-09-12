<template>
  <TownPaperPanel :open="open" :title="`${displayName} · 交易`" :busy="!!busy" :refreshing="loading"
    :refresh-disabled="loading || !!busy" @refresh="refresh" @close="$emit('close')">
        <p v-if="error" class="tnt-error" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <div class="tnt-body">
          <p v-if="loading && !catalog" role="status">正在读取货摊…</p>
          <template v-if="catalog">
            <section aria-labelledby="tnt-sells">
              <h3 id="tnt-sells">TA 手上的货</h3>
              <p v-if="!catalog.sells.length" class="tnt-muted">暂时没有上架商品。</p>
              <article v-for="spec in catalog.sells" :key="`s:${spec.templateId}`" class="tnt-row">
                <div><strong>{{ spec.name }}</strong><p class="tnt-muted">{{ spec.price }} 邻币一件</p></div>
                <linshe-button variant="secondary" size="sm" :disabled="!!busy || loading || spec.price <= 0" :loading="busy === spec.templateId"
                  @click="buy(spec)">买一件</linshe-button>
              </article>
            </section>
            <p class="tnt-muted">只卖不收：付钱后物品直接放进背包。</p>
          </template>
        </div>
  </TownPaperPanel>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import TownPaperPanel from './TownPaperPanel.vue'
import { fetchTownTargetTrade, createTownTargetTradeCommand, executeTownLifeCommand } from '../../api/townLife.js'
import { useBackpackStore } from '../../stores/backpack.js'

const props = defineProps({ npcId: Number, actorKey: String, displayName: String,
  worldId: String, worldEpoch: Number, open: Boolean })
const emit = defineEmits(['close', 'traded', 'service'])
const catalog = ref(null), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('')
let generation = 0
const target = () => props.actorKey || `npc:${props.npcId}`
const backpack = useBackpackStore()
const displayName = computed(() => catalog.value?.displayName || props.displayName || '邻居')
function message(e) {
  return ({ INSUFFICIENT_FUNDS: '可用邻币不足，暂时买不了。',
    INSUFFICIENT_STOCK: 'TA手上的货暂时不够。', INVALID_TRADE_ITEM: '这里不做这件物品的生意。',
    NOT_A_TRADER: 'TA这里不做买卖。', TEMPLATE_NOT_FOUND: '这件商品的模板还没准备好，请稍后再来。',
    STALE_EPOCH: '小镇已更新，请重新打开。' })[e.code] || e.message || '交易没有完成。'
}
async function refresh() {
  if (!props.open) return
  const current = generation
  loading.value = true; error.value = ''
  try {
    const data = await fetchTownTargetTrade(target())
    if (current !== generation) return
    catalog.value = data
    backpack.fetchItems().catch(() => {})
  } catch (e) { if (current === generation) error.value = message(e) }
  finally { if (current === generation) loading.value = false }
}
async function buy(spec) {
  if (!props.open || busy.value || loading.value || !props.worldId || !Number.isSafeInteger(props.worldEpoch)) return
  const current = generation
  busy.value = spec.templateId; error.value = ''; notice.value = ''
  try {
    const command = createTownTargetTradeCommand(target(), { worldId: props.worldId, worldEpoch: props.worldEpoch,
      templateId: spec.templateId })
    const result = await executeTownLifeCommand(command)
    if (current !== generation) return
    notice.value = `买下了「${spec.name}」，花了 ${result.price} 邻币，已放进背包。`
    backpack.fetchItems().catch(() => {})
    emit('traded')
    await refresh()
  } catch (e) { if (current === generation) error.value = message(e) }
  finally { if (current === generation) busy.value = false }
}
watch(() => [props.open, props.npcId, props.actorKey, props.worldId, props.worldEpoch], ([open]) => {
  generation++; busy.value = false; loading.value = false
  catalog.value = null; notice.value = ''; error.value = ''
  if (open) refresh()
}, { immediate: true })
onBeforeUnmount(() => { generation++ })
</script>

<style scoped>
h3 { font-size: 15px; margin: 14px 0 6px; font-weight: 600; }
/* overflow-x clip：行内按钮贴右缘，果冻动画 scale(1.04) 会把横向滚动条闪出来（同 TownResidentActions） */
.tnt-body { overflow-y: auto; overflow-x: clip; overflow-clip-margin: 6px; min-height: 0; }
.tnt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.tnt-row:last-of-type { border-bottom: 0; }
.tnt-row strong { font-size: 14px; font-weight: 500; }
.tnt-muted { opacity: .8; font-size: 12px; margin: 2px 0 0; }
.tnt-error { color: var(--accent); font-size: 13px; }
p { margin: 6px 0; overflow-wrap: anywhere; font-size: 13px; }
section { margin-bottom: 14px; }
</style>
