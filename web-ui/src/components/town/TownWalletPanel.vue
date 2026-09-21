<template>
  <town-paper-panel :open="open" fade hide-footer title="钱袋" :busy="loading" @close="$emit('close')">
    <div class="tl-notice" aria-live="polite">
      <p v-if="error" class="tl-error" role="alert">{{ error }}</p>
      <p v-if="loading && !wallet" role="status">正在读取钱袋…</p>
    </div>
    <template v-if="wallet">
      <section class="tl-wallet" aria-label="我的钱包">
        <span>我的金币</span><strong>{{ money(wallet.available) }}<small>可用</small></strong>
        <p>余额 {{ money(wallet.balance) }} <span v-if="wallet.reserved">·</span> <template v-if="wallet.reserved">预留 {{ money(wallet.reserved) }}</template></p>
      </section>
      <section v-if="wallet.receipts?.length" aria-label="最近的账目">
        <h3>最近的账目</h3>
        <article v-for="(receipt, index) in wallet.receipts" :key="index" class="tl-receipt">
          <span>{{ receiptLabel(receipt) }}</span>
          <em>{{ receipt.amount > 0 ? `+${money(receipt.amount)}` : receipt.amount < 0 ? money(receipt.amount) : '—' }} 金币</em>
        </article>
      </section>
      <p class="tl-muted">金币来自邻居的买卖与心意；在居民对话里发起「交易」或收下赠礼都会记在这里。</p>
    </template>
  </town-paper-panel>
</template>

<script setup>
import { ref, watch } from 'vue'
import TownPaperPanel from './TownPaperPanel.vue'
import { getTownWallet } from '../../api/index.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const wallet = ref(null), loading = ref(false), error = ref('')
const money = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
// 账目标题：能认出是谁、做了什么事，就写具体一点，别只剩「付出一笔」。
function receiptLabel(receipt) {
  const who = receipt.npcName || '邻居'
  switch (receipt.reasonCode) {
    case 'TOWN_NPC_SERVICE_PAYMENT':
      return receipt.offerTitle ? `请${who}提供「${receipt.offerTitle}」` : `请${who}提供服务`
    case 'TOWN_NPC_WORK_WAGE':
      return receipt.offerTitle ? `帮${who}做「${receipt.offerTitle}」的工钱` : `帮${who}打工的工钱`
    case 'NPC_STOCK_PURCHASE':
      return receipt.itemName ? `在${who}的货摊买下「${receipt.itemName}」` : `在${who}的货摊买了东西`
    case 'NPC_TRADE_PURCHASE':
      return `向${who}买了一件东西`
    case 'NPC_TRADE':
      return `和${who}做了一笔买卖`
    case 'NPC_GIFT':
      return `收到${who}的心意`
    case 'NPC_STARTING_GRANT':
    case 'NPC_TRADE_SEED':
      return `${who}的启动资金`
    case 'TOWN_OPENING_GRANT':
      return '开镇补贴'
    case 'delivery.initial_budget':
      return '初始预算'
    default:
      break
  }
  if (receipt.command === 'seed') return receipt.amount > 0 ? '获得金币' : '账目变动'
  if (receipt.command === 'transfer') return receipt.amount > 0 ? '收到一笔' : '付出一笔'
  return '账目变动'
}
let reads = 0, alive = true
async function refresh() {
  if (!props.open) return
  const read = ++reads
  loading.value = true
  try {
    const data = await getTownWallet()
    if (!alive || read !== reads) return
    wallet.value = data
    error.value = ''
  } catch { if (alive && read === reads) error.value = '暂时读不到钱袋，请稍后再试。' }
  finally { if (alive && read === reads) loading.value = false }
}
watch(() => props.open, open => { if (open) refresh() }, { immediate: true })
</script>

<style scoped>
.tl-notice:empty { display: none; }.tl-notice { font-size: 13px; }.tl-error { color: #b8574f; }
h3 { font-size: 16px; margin: 0; font-weight: 600; }
p { margin: 8px 0; overflow-wrap: anywhere; }
section { margin-bottom: 24px; }
.tl-wallet { background: #fffaf5; border-radius: 16px; padding: 20px 24px; margin-bottom: 26px; }
.tl-wallet > span { font-size: 13px; color: #8d7b70; }
.tl-wallet strong { display: block; color: #b76c59; font-size: 34px; font-weight: 600; line-height: 1.5; }
.tl-wallet small { color: #99877a; font-size: 12px; margin-left: 10px; font-weight: 400; }
.tl-wallet p { font-size: 12px; color: #928276; margin: 0; }.tl-wallet p span { padding: 0 8px; }
.tl-receipt { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 6px 0; border-top: 1px dashed #e5d9cc; }
.tl-receipt em { font-style: normal; color: #918278; overflow-wrap: anywhere; }
.tl-muted { color: #918278; font-size: 13px; }
</style>
