<template>
  <town-paper-panel :open="open" title="钱袋" :busy="loading || sending" :refreshing="loading"
    :refresh-disabled="loading || sending" @close="$emit('close')" @refresh="refresh">
    <div class="tl-notice" aria-live="polite">
      <p v-if="error" class="tl-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="loading && !economy" role="status">正在读取小镇生活…</p>
    </div>
    <div v-if="pending" class="tl-pending">
      <p>有一笔「{{ commandNames[pending.kind] || '操作' }}」等待确认。重试会沿用同一次操作。</p>
      <div class="tl-actions">
        <linshe-button size="sm" :disabled="loading || sending || !economy || !fresh" :loading="sending" @click="run(pending)">重试同一次操作</linshe-button>
        <linshe-button v-if="rejected" variant="link" size="sm" :disabled="loading || sending" @click="discardRejected">使用最新状态</linshe-button>
      </div>
    </div>
    <template v-if="economy">
      <section class="tl-wallet" aria-label="我的钱包">
        <span>我的邻币</span><strong>{{ money(economy.wallet?.available) }}<small>可用</small></strong>
        <p>余额 {{ money(economy.wallet?.balance) }} <span>·</span> 预留 {{ money(economy.wallet?.reserved) }}</p>
      </section>
      <!-- <section v-if="economy.liquidity" aria-labelledby="tl-liquidity-title">
        <h3 id="tl-liquidity-title">公共基金</h3>
        <p>{{ economy.liquidity.availableFund == null ? '基金尚未配置' : `可用 ${money(economy.liquidity.availableFund)} 邻币` }} · 有限保障{{ economy.liquidity.enabled ? '已开启' : '未开启' }}</p>
        <p class="tl-muted">本镇累计补助 {{ money(economy.liquidity.grossIssued) }}，剩余额度 {{ money(economy.liquidity.remainingWorldBudget) }}。过去 24 小时发行 {{ money(economy.liquidity.issued24h) }}，过去 7 天发行 {{ money(economy.liquidity.issued7d) }}。</p>
        <p class="tl-muted">补助只进入公共基金，完成配送后才支付报酬。没有原料时不会发行；重建不重置额度。</p>
        <p v-if="economy.liquidity.limits" class="tl-muted">每24小时上限 {{ money(economy.liquidity.limits.rolling24h) }}，滚动7天上限 {{ money(economy.liquidity.limits.rolling7d) }}，本镇累计上限 {{ money(economy.liquidity.limits.grossWorld) }}，流通总量上限 {{ money(economy.liquidity.limits.circulation) }}。开启需可用准备金 {{ money(economy.liquidity.limits.reserve) }} 邻币。</p>
      </section>
      <template v-if="!economy.configured">
        <section aria-labelledby="tl-setup-title">
          <h3 id="tl-setup-title">一起开始小镇生活</h3>
          <p class="tl-muted">为第一条配送路线选好居民和地点；咖啡馆、酒馆、裁缝铺、客栈、书斋可以一并指定经营者和店址，留空则暂不开张。完成配送可获得 30 邻币，无需垫付。</p>
          <div class="tl-setup-grid">
            <div v-for="role in setupRoles" :key="role.actor" class="tl-role">
              <h4>{{ role.title }}<span v-if="role.optional" class="tl-optional">（可选）</span></h4>
              <label>{{ role.personLabel }}</label>
              <linshe-select v-model="chosenActors[role.actor]" :options="participantOptions" :aria-label="role.personLabel" placeholder="选择居民" :disabled="locked" />
              <label>{{ role.placeLabel }}</label>
              <linshe-select v-model="chosenLocations[role.place]" :options="locationOptions" :aria-label="role.placeLabel" placeholder="选择地点" :disabled="locked" />
            </div>
          </div>
          <p class="tl-muted tl-help">每一处开店的居民和地点都要互不相同；带「可选」的可以留空，之后再到店里开张。</p>
          <linshe-button variant="primary" :disabled="locked || !canSetup" :loading="sending" @click="submit('setup')">开启配送生活</linshe-button>
        </section>
      </template>
      <section v-else aria-labelledby="tl-where-title">
        <h3 id="tl-where-title">镇上的事，到地方办</h3>
        <p class="tl-muted">走到店门口点一下那栋房子，或者点一下掌柜本人，就能进店帮忙、点单、投宿或学一手。这里只管钱袋子。</p>
        <p v-if="shopLine" class="tl-muted">镇上开着的：{{ shopLine }}。</p>
        <p class="tl-muted">配送委托、工坊备料和邻居回访都在公告站；一家店去过几次，店里会记得你。</p>
      </section> -->
    </template>
  </town-paper-panel>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import TownPaperPanel from './TownPaperPanel.vue'
import { getTownEconomy, createTownLifeCommand, executeTownLifeCommand, getPendingTownLifeCommand, savePendingTownLifeCommand } from '../../api/index.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const economy = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false)
const error = ref(''), notice = ref(''), pending = ref(getPendingTownLifeCommand()), rejected = ref(false)
const commandNames = { setup: '开启配送生活' }
const chosenActors = reactive({ commissioner: '', supplier: '', workshop: '', cafe: '', tavern: '', clothing_shop: '', inn: '', study: '' })
const chosenLocations = reactive({ board: '', supplier: '', workshop: '', cafe: '', tavern: '', clothing_shop: '', inn: '', study: '' })
const baseSetupRoles = [
  { actor: 'commissioner', place: 'board', title: '发布委托', personLabel: '委托居民', placeLabel: '公告站地点' },
  { actor: 'supplier', place: 'supplier', title: '准备材料', personLabel: '供货居民', placeLabel: '领取材料地点' },
  { actor: 'workshop', place: 'workshop', title: '接收配送', personLabel: '工坊居民', placeLabel: '工坊地点' },
]
const participantOptions = computed(() => (economy.value?.participants || []).map(p => ({ label: p.displayName, value: p.actorId })))
const locationOptions = computed(() => (economy.value?.locations || []).map(p => ({ label: p.name, value: p.key })))
const hasCafeSetup = computed(() => participantOptions.value.length >= 4 && locationOptions.value.some(option => option.value === 'cafe'))
const requiredSetupRoles = computed(() => [...baseSetupRoles,
  ...(hasCafeSetup.value ? [{ actor: 'cafe', place: 'cafe', title: '咖啡馆', personLabel: '咖啡馆经营者', placeLabel: '咖啡馆地点' }] : [])])
// 可选功能建筑由后端 venueKinds 下发；新增建筑只改注册表，页面不再硬编码名单。
const venueSetupRoles = computed(() => {
  const kinds = economy.value?.venueKinds
  const list = Array.isArray(kinds) && kinds.length ? kinds
    : [{ businessKey: 'tavern', displayName: '酒馆', operatorLabel: '酒馆掌柜' },
      { businessKey: 'clothing_shop', displayName: '裁缝铺', operatorLabel: '裁缝' }]
  return list.map(kind => ({ actor: kind.businessKey, place: kind.businessKey, title: kind.displayName,
    personLabel: kind.operatorLabel || '店主', placeLabel: `${kind.displayName}地点`, optional: true }))
})
const setupRoles = computed(() => [...requiredSetupRoles.value, ...venueSetupRoles.value])
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value)
const canSetup = computed(() => {
  const filled = role => !!chosenActors[role.actor] && !!chosenLocations[role.place]
  // 可选建筑要么整行留空，要么两项都选好，避免只填一半提交。
  if (venueSetupRoles.value.some(role => !!chosenActors[role.actor] !== !!chosenLocations[role.place])) return false
  const roles = [...requiredSetupRoles.value, ...venueSetupRoles.value.filter(filled)]
  const actorIds = roles.map(role => chosenActors[role.actor]), locationKeys = roles.map(role => chosenLocations[role.place])
  return actorIds.every(Boolean) && locationKeys.every(Boolean)
    && new Set(actorIds).size === roles.length && new Set(locationKeys).size === roles.length
    && actorIds.every(id => participantOptions.value.some(o => o.value === id))
    && locationKeys.every(key => locationOptions.value.some(o => o.value === key))
})
const shopLine = computed(() => {
  const names = [economy.value?.cafe?.displayName || (economy.value?.cafe ? '咖啡馆' : null),
    ...(economy.value?.venues || []).map(item => item.displayName)]
  return names.filter(Boolean).join('、')
})
const money = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
function message(e) {
  return ({ VERSION_CONFLICT: '委托状态已变化，请重新读取后使用最新状态。', STALE_EPOCH: '小镇已更新，请重新读取状态。',
    LOCATION_UNAVAILABLE: '这个地点暂时不可用，请重新读取状态。' })[e.code] || e.message || '操作未完成，请重新读取状态。'
}
let readSequence = 0, lifecycle = 0, alive = true
async function refresh() {
  if (!props.open) return
  const sequence = ++readSequence, generation = lifecycle
  const current = () => alive && props.open && generation === lifecycle && sequence === readSequence
  if (!pending.value) error.value = ''
  loading.value = true; fresh.value = false
  try {
    const data = await getTownEconomy()
    if (!current()) return
    if (!data || typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.worldEpoch)) throw new Error('小镇状态不完整，请稍后重新读取。')
    economy.value = data
    fresh.value = true
    if (pending.value && (pending.value.worldId !== data.worldId || pending.value.body.worldEpoch !== data.worldEpoch)) {
      pending.value = null; savePendingTownLifeCommand(null); rejected.value = false
      notice.value = '小镇已更新，旧操作已停止。请按当前状态重新选择。'
    }
  } catch (e) { if (current()) error.value = message(e) }
  finally { if (current()) loading.value = false }
}
function submit(kind) {
  if (locked.value || !economy.value || (kind === 'setup' && !canSetup.value)) return
  const command = createTownLifeCommand(kind, { worldId: economy.value.worldId, worldEpoch: economy.value.worldEpoch,
    npcActorIds: chosenActors, locationKeys: chosenLocations })
  pending.value = command; savePendingTownLifeCommand(command)
  run(command)
}
async function run(command) {
  if (!props.open || !fresh.value || sending.value || loading.value || !command || command.body.idempotencyKey !== pending.value?.body.idempotencyKey
    || command.worldId !== economy.value?.worldId || command.body.worldEpoch !== economy.value?.worldEpoch) return
  const generation = lifecycle
  const current = () => alive && props.open && generation === lifecycle
  sending.value = true; error.value = ''; notice.value = ''; rejected.value = false
  try {
    await executeTownLifeCommand(command)
    if (getPendingTownLifeCommand()?.body.idempotencyKey === command.body.idempotencyKey) savePendingTownLifeCommand(null)
    if (current()) { pending.value = null; notice.value = '操作已确认。' }
  } catch (e) {
    if (current()) { error.value = message(e); rejected.value = !e.uncertain }
  } finally {
    if (current()) { await refresh(); if (current()) sending.value = false }
  }
}
function discardRejected() {
  if (!rejected.value || sending.value || loading.value) return
  pending.value = null; savePendingTownLifeCommand(null); rejected.value = false; error.value = ''
}
watch(() => props.open, open => {
  lifecycle++; readSequence++; loading.value = false; sending.value = false; fresh.value = false
  if (open) { pending.value = getPendingTownLifeCommand(); rejected.value = false; refresh() }
}, { immediate: true })
onBeforeUnmount(() => { alive = false; lifecycle++; readSequence++ })
</script>

<style scoped>
.tl-notice:empty { display: none; }.tl-notice { font-size: 13px; }.tl-error { color: #b8574f; }
.tl-pending { background: #eee5db; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; font-size: 13px; }
.tl-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
h3 { font-size: 16px; margin: 0; font-weight: 600; }
h4 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
p { margin: 8px 0; overflow-wrap: anywhere; }
section { margin-bottom: 24px; }
.tl-wallet { background: #fffaf5; border-radius: 16px; padding: 20px 24px; margin-bottom: 26px; }
.tl-wallet > span { font-size: 13px; color: #8d7b70; }
.tl-wallet strong { display: block; color: #b76c59; font-size: 34px; font-weight: 600; line-height: 1.5; }
.tl-wallet small { color: #99877a; font-size: 12px; margin-left: 10px; font-weight: 400; }
.tl-wallet p { font-size: 12px; color: #928276; margin: 0; }.tl-wallet p span { padding: 0 8px; }
.tl-muted, .tl-help { color: #918278; font-size: 13px; }.tl-help { margin: 14px 0 !important; }
.tl-setup-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 18px; margin-top: 20px; }
.tl-role { min-width: 0; }.tl-role label { display: block; font-size: 12px; color: #8c7e73; margin: 12px 0 5px; }
.tl-optional { color: #b09a8a; font-size: 12px; font-weight: 400; }
@media (max-width: 520px) { .tl-setup-grid { grid-template-columns: 1fr; gap: 20px; }.tl-wallet { padding: 16px 20px; } }
</style>
