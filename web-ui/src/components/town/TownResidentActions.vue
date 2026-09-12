<template>
  <section class="resident-actions" :aria-label="building ? '场所功能' : '与居民互动'">
    <div class="resident-options">
      <linshe-button v-if="!building" variant="ghost" size="sm" :disabled="locked" @click="$emit('talk', '最近过得怎么样？')">聊聊近况</linshe-button>
      <!-- 这位居民已有进行中的奇遇时，入口只留「继续」：特殊奇遇与服务线索都走同一条生成管线，再开只会撞 STORY_BUSY -->
      <linshe-button v-if="data?.capabilities?.includes('service') && !data?.activeStory" variant="ghost" size="sm" :disabled="locked" @click="menu = menu === 'story' ? '' : 'story'">特殊奇遇</linshe-button>
      <linshe-button v-if="services.length && !data?.activeStory" variant="ghost" size="sm" :disabled="locked" @click="menu = menu === 'service' ? '' : 'service'">店里能办什么</linshe-button>
      <linshe-button v-if="canTrade" variant="ghost" size="sm" :disabled="locked" @click="openTrade">交易</linshe-button>
      <linshe-button v-if="data?.activeStory" variant="ghost" size="sm" :disabled="locked" @click="$emit('story', data.activeStory.id)">继续「{{ data.activeStory.title }}」</linshe-button>
    </div>
    <p v-if="data && data.serviceHint">{{ data.serviceHint }}</p>
    <div v-if="menu" class="resident-menu">
      <template v-if="choices.length">
        <div v-for="item in choices" :key="item.key" class="resident-choice">
          <span>{{ item.title }}<small v-if="item.price != null"> · {{ item.wage > 0 ? `工资 ${item.wage}` : item.price }} 邻币</small></span>
          <linshe-button variant="ghost" size="sm" :disabled="locked" @click="offer(item)">问问详情</linshe-button>
        </div>
      </template>
      <p v-else>{{ data?.storyHint || '暂时没有可展开的剧情线索。' }}</p>
    </div>
    <div v-if="invitation && !receiptMatchesActiveStory" class="resident-invitation" aria-live="polite">
      <strong>{{ invitation.title }}</strong>
      <p>{{ invitation.description }}</p>
      <div v-if="invitation.status === 'offered'" class="resident-options">
        <linshe-button variant="secondary" size="sm" :loading="busy" :disabled="locked" @click="respond('accept')">{{ invitation.kind === 'service' ? '展开这段奇遇' : invitation.kind === 'story' ? '沿着线索展开奇遇' : `支付 ${invitation.price} 邻币购买` }}</linshe-button>
        <linshe-button variant="ghost" size="sm" :disabled="locked" @click="respond('decline')">暂时不了</linshe-button>
      </div>
      <p v-else-if="invitation.status === 'generating'" role="status">故事正在展开，可以稍后重新读取，或先回到小镇。</p>
      <div v-else-if="invitation.status === 'accepted'" class="resident-options">
        <span>{{ invitation.kind === 'trade' ? '交易已完成，钱物已结算。' : '这段奇遇已经展开。' }}</span>
        <linshe-button v-if="invitation.result?.kind === 'story'" variant="secondary" size="sm" :disabled="locked" @click="$emit('story', invitation.result.eventId)">继续这段奇遇</linshe-button>
      </div>
      <p v-else>{{ invitation.status === 'declined' ? '已婉拒，今天先聊点别的吧。' : '这份邀请已过期，改天再来聊聊。' }}</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy && (invitation?.kind === 'story' || invitation?.kind === 'service')" role="status">正在展开故事，需要一点时间。可以先关闭对话，稍后回来继续。</p>
    <div v-if="error || invitation?.status === 'generating'" class="resident-options">
      <linshe-button variant="link" size="sm" :disabled="busy || loading" @click="refresh">重新读取邀请</linshe-button>
    </div>
  </section>
  <TownNpcTradePanel v-if="tradeOpen" :npc-id="data?.npcId" :actor-key="actorKey" :display-name="data?.name" :world-id="worldId" :world-epoch="worldEpoch"
    :open="tradeOpen" @close="tradeOpen = false" @traded="refresh" />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import TownNpcTradePanel from './TownNpcTradePanel.vue'
import { fetchTownInteractions, offerTownInteraction, respondTownInteraction } from '../../api/townLife.js'
const props = defineProps({ actorKey: String, worldId: String, worldEpoch: Number, blocked: Boolean, revision: [Number, String] })
const emit = defineEmits(['talk', 'story', 'busy'])
const tradeOpen = ref(false)
const building = computed(() => props.actorKey?.startsWith('location:'))
// 居民要有真实货品才开交易面板；建筑（location）保留入口，因为店内购买项挂在面板里。
const canTrade = computed(() => !!data.value?.capabilities?.includes('trade')
  && (building.value || (data.value?.catalog || []).some(item => item.kind === 'trade')))
function openTrade() {
  if (locked.value) return
  if (canTrade.value) tradeOpen.value = true
}
const data = ref(null), invitation = ref(null), menu = ref(''), error = ref(''), loading = ref(false), busy = ref(false)
const locked = computed(() => props.blocked || loading.value || busy.value)
const services = computed(() => (data.value?.catalog || []).filter(item => item.kind === 'service' && item.capability !== 'trade'))
// 已接受的奇遇回执和顶部「继续『标题』」指向同一段奇遇时，只保留顶部按钮。
const receiptMatchesActiveStory = computed(() => invitation.value?.status === 'accepted'
  && invitation.value.result?.kind === 'story' && !!data.value?.activeStory
  && String(invitation.value.result.eventId) === String(data.value.activeStory.id))
const choices = computed(() => menu.value === 'service' ? services.value : (data.value?.catalog || []).filter(item => item.kind === menu.value))
const scope = () => ({ worldId: props.worldId, worldEpoch: props.worldEpoch })
let generation = 0, reads = 0
function showError(err) {
  error.value = ({
    INSUFFICIENT_FUNDS: '可用邻币不足，暂时买不了这一件。', REQUEST_EXPIRED: '邀请已过期，请重新读取。',
    REQUEST_UNAVAILABLE: '这件事的条件已变化，请重新读取邀请。', STORY_BUSY: '这位角色的故事正在生成，稍后再来。',
    STALE_EPOCH: '小镇已变化，请关闭对话后重新进入。' })[err.code] || (err.uncertain ? '结果尚未确认。可以重新读取；再次确认同一份邀请不会重复结算。' : '这件事暂时没办成，请稍后重试。')
}
async function refresh() {
  const current = generation, read = ++reads
  loading.value = true
  try {
    const result = await fetchTownInteractions(props.actorKey)
    if (current !== generation || read !== reads) return
    if (result.worldId !== props.worldId || result.worldEpoch !== props.worldEpoch) throw Object.assign(new Error(), { code: 'STALE_EPOCH' })
    data.value = result
    invitation.value = result.requests.find(item => item.requestId === invitation.value?.requestId)
      || result.requests.find(item => ['offered', 'generating'].includes(item.status))
      || result.requests.find(item => item.status === 'accepted') || null
    error.value = ''
  } catch (err) { if (current === generation && read === reads) showError(err) }
  finally { if (current === generation && read === reads) loading.value = false }
}
async function offer(item) {
  if (locked.value) return
  const current = generation
  busy.value = true; error.value = ''; emit('busy', true)
  try {
    const result = await offerTownInteraction(props.actorKey, item.key, scope())
    if (current === generation) { invitation.value = result; menu.value = '' }
  } catch (err) { if (current === generation) showError(err) }
  finally { if (current === generation) { busy.value = false; emit('busy', false) } }
}
async function respond(decision) {
  if (locked.value || !invitation.value) return
  const current = generation, id = invitation.value.requestId
  busy.value = true; error.value = ''; emit('busy', true)
  try {
    const result = await respondTownInteraction(props.actorKey, id, decision, scope())
    if (current !== generation) return
    invitation.value = result
    if (result.status === 'accepted' && result.result?.kind === 'story') emit('story', result.result.eventId)
  } catch (err) { if (current === generation) showError(err) }
  finally { if (current === generation) { busy.value = false; emit('busy', false) } }
}
watch(() => [props.actorKey, props.worldId, props.worldEpoch], () => {
  generation++; data.value = null; invitation.value = null; menu.value = ''; tradeOpen.value = false; busy.value = false; emit('busy', false); refresh()
}, { immediate: true })
watch(() => props.revision, () => { if (!busy.value) { invitation.value = null; refresh() } })
watch([busy, tradeOpen], ([working, trading]) => emit('busy', working || trading))
onBeforeUnmount(() => { generation++; emit('busy', false) })
</script>

<style scoped>
/* overflow-y:auto 会把 overflow-x 一并算成 auto；按钮 hover 的果冻动画 scale(1.04)
   会把贴边按钮推出容器 1~2px，横向滚动条随之闪现——经典滚动条还会挤占布局高度，
   把按钮顶离鼠标再弹回来，形成灰条疯狂抖动的循环。横向直接 clip，果冻余量交给 clip-margin。 */
.resident-actions { font-size: var(--fs-xs); margin-top: 8px; max-height: 32vh; overflow-y: auto; overflow-x: clip; overflow-clip-margin: 6px; }
.resident-options { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.resident-menu { margin-top: 8px; max-height: 150px; overflow-y: auto; overflow-x: clip; overflow-clip-margin: 6px; }
.resident-choice { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
.resident-invitation { padding: 8px 0; border-top: 1px solid var(--border-strong); margin-top: 8px; }
.resident-actions p { margin: 5px 0; line-height: 1.5; }
.resident-actions [role='alert'] { color: #ad5147; }
</style>
