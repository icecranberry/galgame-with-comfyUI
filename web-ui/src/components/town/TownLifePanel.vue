<template>
  <Teleport to="body">
    <div v-if="open && !workshopOpen" class="tl-overlay" @click.self="close" @keydown.stop="onKeydown" @keyup.stop
      @pointerdown.stop @mousedown.stop @click.stop @wheel.stop @touchstart.stop @touchmove.stop>
      <section ref="panel" class="tl-panel" role="dialog" aria-modal="true" aria-label="小镇生活" tabindex="-1" :style="viewportStyle">
        <header class="tl-header">
          <div><span class="tl-kicker">邻舍小镇</span><h2>生活与委托</h2></div>
          <linshe-button variant="icon" size="sm" aria-label="关闭生活面板" @click="close">✕</linshe-button>
        </header>
        <div class="tl-content" :aria-busy="loading || sending">
          <div class="tl-notice" aria-live="polite">
            <p v-if="error" class="tl-error" role="alert">{{ error }}</p>
            <p v-if="notice" role="status">{{ notice }}</p>
            <p v-if="loading && !economy" role="status">正在读取小镇生活…</p>
          </div>
          <div v-if="pending" class="tl-pending">
            <p>有一笔「{{ commandNames[pending.kind] }}」等待确认。重试会沿用同一次操作。</p>
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
            <section v-if="economy.liquidity" aria-labelledby="tl-liquidity-title">
              <h3 id="tl-liquidity-title">公共基金</h3>
              <p>{{ economy.liquidity.availableFund == null ? '基金尚未配置' : `可用 ${money(economy.liquidity.availableFund)} 邻币` }} · 有限保障{{ economy.liquidity.enabled ? '已开启' : '未开启' }}</p>
              <p class="tl-muted">本镇累计补助 {{ money(economy.liquidity.grossIssued) }}，剩余额度 {{ money(economy.liquidity.remainingWorldBudget) }}。过去 24 小时发行 {{ money(economy.liquidity.issued24h) }}，过去 7 天发行 {{ money(economy.liquidity.issued7d) }}。</p>
              <p class="tl-muted">补助只进入公共基金，完成配送后才支付报酬。没有原料时不会发行；重建不重置额度。</p>
              <p v-if="economy.liquidity.limits" class="tl-muted">每24小时上限 {{ money(economy.liquidity.limits.rolling24h) }}，滚动7天上限 {{ money(economy.liquidity.limits.rolling7d) }}，本镇累计上限 {{ money(economy.liquidity.limits.grossWorld) }}，流通总量上限 {{ money(economy.liquidity.limits.circulation) }}。开启需可用准备金 {{ money(economy.liquidity.limits.reserve) }} 邻币。</p>
            </section>
            <template v-if="!economy.configured">
              <section aria-labelledby="tl-setup-title">
                <h3 id="tl-setup-title">一起开始小镇生活</h3>
                <p class="tl-muted">为第一条配送路线选好三位居民和三个地点。完成配送可获得 30 邻币，无需垫付。</p>
                <div class="tl-setup-grid">
                  <div v-for="role in setupRoles" :key="role.actor" class="tl-role">
                    <h4>{{ role.title }}</h4>
                    <label>{{ role.personLabel }}</label>
                    <linshe-select v-model="chosenActors[role.actor]" :options="participantOptions" :aria-label="role.personLabel" placeholder="选择居民" :disabled="locked" />
                    <label>{{ role.placeLabel }}</label>
                    <linshe-select v-model="chosenLocations[role.place]" :options="locationOptions" :aria-label="role.placeLabel" placeholder="选择地点" :disabled="locked" />
                  </div>
                </div>
                <p class="tl-muted tl-help">请选择三位不同的居民、三个不同的地点。</p>
                <linshe-button variant="primary" :disabled="locked || !canSetup" :loading="sending" @click="submit('setup')">开启配送生活</linshe-button>
              </section>
            </template>
            <template v-else>
              <p v-if="!economy.enabled" class="tl-muted" role="status">新委托与新服务已暂停。已接配送仍可领取、交付或取消，已接受的服务可以继续完成或取消。</p>
              <section aria-labelledby="tl-route-title">
                <div class="tl-section-heading"><h3 id="tl-route-title">一趟配送，三站小路</h3><span class="tl-reward">{{ money(economy.slice?.reward ?? 30) }} 邻币</span></div>
                <ol class="tl-route">
                  <li v-for="(step, index) in routeSteps" :key="step.key">
                    <span class="tl-step-number">{{ index + 1 }}</span><div><strong>{{ step.title }}</strong><p>{{ locationName(economy.slice?.locationKeys?.[step.key]) }}</p></div>
                    <linshe-button variant="link" size="sm" :disabled="!economy.slice?.locationKeys?.[step.key]" @click="go(economy.slice.locationKeys[step.key])">前往</linshe-button>
                  </li>
                </ol>
                <p class="tl-muted">无需垫付邻币。先到公告站接单，再领材料、送往工坊；走到对应地点后确认。</p>
              </section>
              <section v-if="economy.service" aria-labelledby="tl-workshop-title">
                <div class="tl-section-heading"><h3 id="tl-workshop-title">工坊制作</h3><span class="tl-reward">30 邻币</span></div>
                <p v-if="typeof economy.service.open === 'boolean' || economy.service.hours" class="tl-muted">
                  <span v-if="typeof economy.service.open === 'boolean'">{{ economy.service.open ? '营业中' : '新服务暂未开放，请稍后再来；已接受的服务可继续' }}</span>
                  <span v-if="economy.service.hours"> · {{ economy.service.hours }}</span>
                </p>
                <p class="tl-muted">心情修复贴 / 波波头发型卡 · 每次制作使用 1 份材料。</p>
                <p class="tl-muted">制作前取消全退；开始制作后收 10 退 20；系统失败全退。</p>
                <div class="tl-actions">
                  <linshe-button size="sm" :disabled="locked || !economy.enabled" @click="openWorkshop()">了解工坊服务</linshe-button>
                  <linshe-button variant="link" size="sm" @click="go(economy.service.locationKey)">前往服务工坊</linshe-button>
                </div>
                <div v-for="item in economy.service.sessions || []" :key="item.sessionId" class="tl-session">
                  <span>{{ serviceStatuses[item.status] || '状态待确认' }}</span>
                  <linshe-button variant="link" size="sm" :disabled="loading || sending" @click="openWorkshop(item.sessionId)">{{ ['completed', 'cancelled', 'failed', 'expired'].includes(item.status) ? '查看服务收据' : '继续本次服务' }}</linshe-button>
                </div>
              </section>
              <section v-if="economy.production" aria-labelledby="tl-production-title">
                <div class="tl-section-heading"><h3 id="tl-production-title">工坊备料</h3></div>
                <p>备料中 {{ money(productionTotals.reserved) }} 份 · 已补货 {{ money(productionTotals.completed) }} 份</p>
                <p v-if="economy.production.resource" class="tl-muted">剩余采集容量 {{ money(economy.production.resource.remaining) }} / {{ money(economy.production.resource.capacity) }}，其中 {{ money(economy.production.resource.reserved) }} 已预留；可采集 {{ money(economy.production.resource.available) }}。</p>
                <p class="tl-muted">每完成一次服务，两位居民工作后补回 1 份原料，受剩余采集容量限制。</p>
              </section>
              <section aria-labelledby="tl-appointments-title">
                <h3 id="tl-appointments-title">再来坐坐</h3>
                <p class="tl-muted">和已入住的工坊邻居约一次免费回访，时间由你确认。</p>
                <linshe-button variant="secondary" size="sm" :disabled="loading || sending" @click="$emit('appointments')">查看回访邀请与预约</linshe-button>
              </section>
              <section v-if="economy.cafe" aria-labelledby="tl-cafe-title">
                <div class="tl-section-heading"><h3 id="tl-cafe-title">咖啡馆 · 打工</h3><span class="tl-reward">{{ economy.cafe.catalog?.find(item => item.serviceKey === 'town.cafe.work_shift')?.wage ?? 24 }} 邻币/班</span></div>
                <p class="tl-muted">不需要接配送单；到店当班，完成固定小任务后由咖啡馆付工资。</p>
                <p v-if="economy.cafe.stock" class="tl-muted">咖啡豆 {{ economy.cafe.stock.available }} 份 · 可接 {{ economy.cafe.open ? '营业中' : '暂未营业' }}</p>
                <div class="tl-actions">
                  <linshe-button size="sm" :disabled="locked || !economy.enabled" @click="openCafe()">去咖啡馆打工</linshe-button>
                  <linshe-button variant="link" size="sm" :disabled="!economy.cafe.locationKey" @click="go(economy.cafe.locationKey)">前往咖啡馆</linshe-button>
                </div>
                <div v-for="item in economy.cafe.sessions || []" :key="item.sessionId" class="tl-session">
                  <span>{{ serviceStatuses[item.status] || '状态待确认' }}</span>
                  <linshe-button variant="link" size="sm" :disabled="locked" @click="openCafe(item.sessionId)">{{ ['completed','cancelled','failed','expired'].includes(item.status) ? '查看结算' : '继续这班打工' }}</linshe-button>
                </div>
              </section>
              <section v-if="!economy.cafe" aria-labelledby="tl-orders-title">
                <div class="tl-section-heading"><h3 id="tl-orders-title">配送委托</h3>
                  <linshe-button :variant="activeOrders.length ? 'ghost' : 'primary'" size="sm" :disabled="locked || !economy.enabled" @click="submit('publish')">发布配送委托</linshe-button>
                </div>
                <p v-if="!orders.length" class="tl-empty">还没有委托。发布后，就能到公告站接取。</p>
                <article v-for="order in orders" :key="order.orderId" class="tl-order">
                  <div class="tl-order-heading"><strong>工坊材料配送</strong><span class="tl-status" :class="{ done: order.status === 'completed' }">{{ statuses[order.status] || '状态待确认' }}</span></div>
                  <p class="tl-muted">报酬 {{ money(order.config?.reward ?? economy.slice?.reward ?? 30) }} 邻币<span v-if="order.expiresAt"> · 截止 {{ deadline(order.expiresAt) }}</span></p>
                  <p v-if="nextStep(order)">{{ nextStep(order).hint }} · {{ locationName(order.config?.locationKeys?.[nextStep(order).place]) }}</p>
                  <p v-else-if="order.status === 'completed'" class="tl-muted">配送已完成，报酬以钱包最新余额为准。</p>
                  <div v-if="nextStep(order)" class="tl-actions">
                    <linshe-button :variant="order.orderId === activeOrders[0]?.orderId ? 'primary' : 'secondary'" size="sm" :disabled="locked || (order.status === 'open' && !economy.enabled)" @click="submit(nextStep(order).action, order)">{{ nextStep(order).label }}</linshe-button>
                    <linshe-button variant="ghost" size="sm" :disabled="!order.config?.locationKeys?.[nextStep(order).place]" @click="go(order.config.locationKeys[nextStep(order).place])">前往{{ nextStep(order).placeName }}</linshe-button>
                    <linshe-button v-if="['accepted', 'picked_up'].includes(order.status)" variant="link" size="sm" :disabled="locked" @click="cancelId = order.orderId">取消委托</linshe-button>
                  </div>
                  <div v-if="cancelId === order.orderId" class="tl-cancel" role="group" aria-label="确认取消委托">
                    <p>取消后，这份委托将结束，预留材料由小镇收回。</p>
                    <div class="tl-actions"><linshe-button variant="danger" size="sm" :disabled="locked" @click="submit('cancel', order)">确认取消</linshe-button><linshe-button variant="ghost" size="sm" @click="cancelId = null">继续配送</linshe-button></div>
                  </div>
                </article>
              </section>
            </template>
          </template>
        </div>
        <footer class="tl-footer"><span>{{ sending ? '正在确认操作…' : '钱物与到达状态以小镇确认为准' }}</span><linshe-button variant="ghost" size="sm" :disabled="loading || sending" @click="refresh">{{ loading ? '读取中…' : '重新读取' }}</linshe-button></footer>
      </section>
    </div>
  </Teleport>
  <town-workshop-service v-if="open && workshopOpen && economy" :world-id="economy.worldId" :world-epoch="economy.worldEpoch"
    :session-id="workshopSessionId" :provider-name="workshopProvider" @close="closeWorkshop" />
  <town-cafe-work-panel v-if="open && cafeOpen && economy" :world-id="economy.worldId" :world-epoch="economy.worldEpoch"
    :session-id="cafeSessionId" :provider-name="cafeProvider" @close="closeCafe" />
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import TownWorkshopService from './TownWorkshopService.vue'
import TownCafeWorkPanel from './TownCafeWorkPanel.vue'
import { getTownEconomy, createTownLifeCommand, executeTownLifeCommand, getPendingTownLifeCommand, savePendingTownLifeCommand } from '../../api/index.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'move-to', 'appointments'])
const panel = ref(null), economy = ref(null), loading = ref(false), sending = ref(false), fresh = ref(false)
const error = ref(''), notice = ref(''), pending = ref(getPendingTownLifeCommand()), rejected = ref(false), cancelId = ref(null)
const workshopOpen = ref(false), workshopSessionId = ref(null), cafeOpen = ref(false), cafeSessionId = ref(null)
const serviceStatuses = { offered: '等待接受报价', active: '服务进行中', resolving: '正在处理', settling: '正在结算', completed: '已完成', cancelled: '已取消', failed: '服务未完成', expired: '已结束' }
const workshopProvider = computed(() => economy.value?.participants?.find(p => p.actorId === economy.value?.service?.providerActorId)?.displayName || '邻居')
const cafeProvider = computed(() => economy.value?.participants?.find(p => p.actorId === economy.value?.cafe?.providerActorId)?.displayName || '咖啡师')
const chosenActors = reactive({ commissioner: '', supplier: '', workshop: '', cafe: '' })
const chosenLocations = reactive({ board: '', supplier: '', workshop: '', cafe: '' })
const baseSetupRoles = [
  { actor: 'commissioner', place: 'board', title: '发布委托', personLabel: '委托居民', placeLabel: '公告站地点' },
  { actor: 'supplier', place: 'supplier', title: '准备材料', personLabel: '供货居民', placeLabel: '领取材料地点' },
  { actor: 'workshop', place: 'workshop', title: '接收配送', personLabel: '工坊居民', placeLabel: '工坊地点' },
]
const routeSteps = [{ key: 'board', title: '到公告站接单' }, { key: 'supplier', title: '领取配送材料' }, { key: 'workshop', title: '交付并领取报酬' }]
const commandNames = { setup: '开启配送生活', publish: '发布配送委托', accept: '接取委托', pickup: '领取材料', complete: '交付材料', cancel: '取消委托' }
const statuses = { open: '待接取', accepted: '待领取材料', picked_up: '配送中', completed: '已完成', cancelled: '已取消', expired: '已过期' }
const steps = {
  open: { action: 'accept', label: '接取委托', place: 'board', placeName: '公告站', hint: '先到公告站接取委托' },
  accepted: { action: 'pickup', label: '领取材料', place: 'supplier', placeName: '原料点', hint: '到原料点领取材料' },
  picked_up: { action: 'complete', label: '交付材料', place: 'workshop', placeName: '工坊', hint: '到工坊交付材料，领取报酬' },
}
const nextStep = order => steps[order.status]
const participantOptions = computed(() => (economy.value?.participants || []).map(p => ({ label: p.displayName, value: p.actorId })))
const locationOptions = computed(() => (economy.value?.locations || []).map(p => ({ label: p.name, value: p.key })))
const hasCafeSetup = computed(() => participantOptions.value.length >= 4 && locationOptions.value.some(option => option.value === 'cafe'))
const setupRoles = computed(() => hasCafeSetup.value ? [...baseSetupRoles,
  { actor: 'cafe', place: 'cafe', title: '咖啡馆', personLabel: '咖啡馆经营者', placeLabel: '咖啡馆地点' }] : baseSetupRoles)
const orders = computed(() => economy.value?.orders || [])
const productionTotals = computed(() => (economy.value?.production?.batches || []).reduce((totals, batch) => {
  if (batch.status === 'reserved' || batch.status === 'completed') {
    const quantity = batch.config?.recipe?.quantity
    totals[batch.status] += Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1
  }
  return totals
}, { reserved: 0, completed: 0 }))
const activeOrders = computed(() => orders.value.filter(order => nextStep(order)))
const locked = computed(() => loading.value || sending.value || !!pending.value || !fresh.value)
const canSetup = computed(() => {
  const roles = setupRoles.value
  const actorIds = roles.map(role => chosenActors[role.actor]), locationKeys = roles.map(role => chosenLocations[role.place])
  return new Set(actorIds).size === roles.length && new Set(locationKeys).size === roles.length
    && actorIds.every(id => participantOptions.value.some(o => o.value === id))
    && locationKeys.every(key => locationOptions.value.some(o => o.value === key))
})
const locationName = key => economy.value?.locations?.find(l => l.key === key)?.name || '地点待确认'
const money = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
function deadline(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '待确认' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）'
}
function message(e) {
  return ({ NOT_ARRIVED: '还没有到达对应地点。请先在地图上走过去，再确认。', VERSION_CONFLICT: '委托状态已变化，请重新读取后使用最新状态。',
    ORDER_EXPIRED: '这份委托已过期，请重新读取最新委托。', STALE_EPOCH: '小镇已更新，请重新读取状态。',
    LOCATION_UNAVAILABLE: '这个地点暂时不可用，请重新读取状态。' })[e.code] || e.message || '操作未完成，请重新读取状态。'
}
let readSequence = 0, lifecycle = 0, alive = true, previousFocus
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
function submit(kind, order) {
  if (locked.value || !economy.value || (['publish', 'accept'].includes(kind) && !economy.value.enabled) || (kind === 'setup' && !canSetup.value)) return
  const command = createTownLifeCommand(kind, { worldId: economy.value.worldId, worldEpoch: economy.value.worldEpoch,
    orderId: order?.orderId, expectedVersion: order?.version, npcActorIds: chosenActors, locationKeys: chosenLocations })
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
    // Clear only this exact acknowledged operation, even if panel was closed.
    if (getPendingTownLifeCommand()?.body.idempotencyKey === command.body.idempotencyKey) savePendingTownLifeCommand(null)
    if (current()) { pending.value = null; notice.value = '操作已确认。'; cancelId.value = null }
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
function close() { emit('close') }
function go(key) { if (key) emit('move-to', key) }
function openWorkshop(sessionId = null) {
  if (!sessionId && !economy.value?.enabled) return
  workshopSessionId.value = sessionId || economy.value?.service?.sessions?.find(s => ['offered', 'active', 'resolving', 'settling'].includes(s.status))?.sessionId || null
  workshopOpen.value = true
}
async function closeWorkshop() {
  workshopOpen.value = false; refresh(); await nextTick(); panel.value?.focus({ preventScroll: true })
}
function openCafe(sessionId = null) {
  if (!sessionId && !economy.value?.enabled) return
  cafeSessionId.value = sessionId || economy.value?.cafe?.sessions?.find(s => ['offered', 'active', 'resolving', 'settling'].includes(s.status))?.sessionId || null
  cafeOpen.value = true
}
async function closeCafe() {
  cafeOpen.value = false; refresh(); await nextTick(); panel.value?.focus({ preventScroll: true })
}
function onKeydown(event) {
  if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const elements = [...panel.value.querySelectorAll('button:not(:disabled), [role="combobox"]:not([aria-disabled="true"]), [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = elements[0], last = elements.at(-1)
  if (!elements.length) { event.preventDefault(); panel.value.focus() }
  else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
const viewportStyle = ref({})
watch([loading, sending, pending, economy, cancelId], async () => {
  await nextTick()
  if (props.open && !workshopOpen.value && document.activeElement === document.body) panel.value?.focus({ preventScroll: true })
})
function resize() {
  const viewport = window.visualViewport
  viewportStyle.value = viewport ? { maxHeight: `${Math.max(120, viewport.height - 24)}px` } : {}
}
watch(() => props.open, async open => {
  lifecycle++; readSequence++; loading.value = false; sending.value = false; fresh.value = false
  if (open) {
    previousFocus = document.activeElement; pending.value = getPendingTownLifeCommand(); rejected.value = false
    refresh(); await nextTick(); resize(); panel.value?.focus({ preventScroll: true })
  } else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
}, { immediate: true })
onMounted(() => { window.visualViewport?.addEventListener('resize', resize) })
onBeforeUnmount(() => {
  alive = false; lifecycle++; readSequence++; window.visualViewport?.removeEventListener('resize', resize)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<style scoped>
.tl-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 12px; background: rgba(0,0,0,.45); box-sizing: border-box; }
.tl-panel { width: min(640px, 100%); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; background: #f4f1eeed; color: #554a43; border-radius: 22px; box-shadow: 0 12px 36px #352a231f; overflow: hidden; font-size: 14px; line-height: 1.65; text-align: left; outline: none; }
.tl-header, .tl-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; flex-shrink: 0; }
.tl-kicker { color: #9b8c80; font-size: 12px; letter-spacing: .12em; }
.tl-panel h2 { font-size: 22px; margin: 2px 0 0; font-weight: 600; }
.tl-panel h3 { font-size: 16px; margin: 0; font-weight: 600; }
.tl-panel h4 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
.tl-panel p { margin: 8px 0; overflow-wrap: anywhere; }
.tl-content { padding: 0 24px 12px; overflow-y: auto; overscroll-behavior: contain; min-height: 0; }
.tl-content > section, .tl-content > template { margin-bottom: 24px; }
.tl-wallet { background: #fffaf5; border-radius: 16px; padding: 20px 24px; margin-bottom: 26px; }
.tl-wallet > span { font-size: 13px; color: #8d7b70; }
.tl-wallet strong { display: block; color: #b76c59; font-size: 34px; font-weight: 600; line-height: 1.5; }
.tl-wallet small { color: #99877a; font-size: 12px; margin-left: 10px; font-weight: 400; }
.tl-wallet p { font-size: 12px; color: #928276; margin: 0; }.tl-wallet p span { padding: 0 8px; }
.tl-muted, .tl-help { color: #918278; font-size: 13px; }.tl-help { margin: 14px 0 !important; }
.tl-setup-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 18px; margin-top: 20px; }
.tl-role { min-width: 0; }.tl-role label { display: block; font-size: 12px; color: #8c7e73; margin: 12px 0 5px; }
.tl-section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin: 24px 0 12px; }
.tl-reward { color: #b76c59; white-space: nowrap; font-size: 13px; }.tl-route { list-style: none; margin: 10px 0; padding: 0; }
.tl-route li { display: flex; align-items: center; gap: 12px; padding: 10px 0; }.tl-route li > div { flex: 1; min-width: 0; }
.tl-route strong { font-size: 14px; font-weight: 500; }.tl-route p { font-size: 12px; color: #948579; margin: 0; }
.tl-step-number { border-radius: 50%; width: 28px; height: 28px; display: grid; place-items: center; background: #eadfd6; color: #9b7665; font-size: 12px; flex-shrink: 0; }
.tl-order { padding: 18px 0; border-bottom: 1px solid #e8dfd7; }.tl-order:last-child { border-bottom: 0; }
.tl-order-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.tl-order-heading strong { font-weight: 500; }
.tl-status { font-size: 12px; color: #ad8066; }.tl-status.done { color: #779078; }.tl-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
.tl-session { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; color: #947f6d; }
.tl-notice:empty { display: none; }.tl-notice { font-size: 13px; }.tl-error { color: #b8574f; }.tl-pending, .tl-cancel { background: #eee5db; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; font-size: 13px; }.tl-cancel { margin: 12px 0 0; }
.tl-empty { color: #918278; padding: 18px 0; }.tl-footer { color: #9a8c80; font-size: 11px; padding-top: 12px; padding-bottom: max(16px,env(safe-area-inset-bottom)); }
@media (max-width: 520px) { .tl-panel { border-radius: 18px; }.tl-header, .tl-footer { padding-left: 18px; padding-right: 18px; }.tl-content { padding: 0 18px 8px; }.tl-setup-grid { grid-template-columns: 1fr; gap: 20px; }.tl-role { display: grid; grid-template-columns: 1fr; }.tl-wallet { padding: 16px 20px; }.tl-header { padding-top: 16px; padding-bottom: 16px; }.tl-section-heading { align-items: flex-start; }.tl-footer { gap: 8px; } }
</style>
