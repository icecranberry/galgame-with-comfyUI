<template>
  <section class="god-work" :aria-label="event.title">
    <div class="work-heading">
      <span class="work-seal" aria-hidden="true">✦</span>
      <div class="work-title"><span class="work-eyebrow">{{ event.kind === 'world' ? '神谕已落下' : '天使的工作' }}</span><h3>{{ event.title }}</h3></div>
      <span class="work-count"><strong>{{ completed }}</strong> / {{ event.deliveries.length }} 已回应</span>
    </div>
    <p class="work-fact">{{ event.fact }}</p>
    <div class="work-deliveries">
      <div v-for="delivery in event.deliveries" :key="delivery.id" class="work-delivery">
        <span class="delivery-mark" :class="{ pending: ['pending', 'running'].includes(delivery.status) }" aria-hidden="true">{{ delivery.status === 'done' ? '✓' : delivery.status === 'failed' ? '!' : '·' }}</span>
        <span class="delivery-name">{{ delivery.target_name || '对象已移除' }}<small>{{ delivery.kind === 'moment' ? '朋友圈' : '群聊' }}</small></span>
        <router-link v-if="delivery.status === 'done' && delivery.result?.href" class="delivery-link" :to="delivery.result.href">{{ delivery.result.partial ? '部分回应 ↗' : '查看回应 ↗' }}</router-link>
        <span v-else class="delivery-state" :title="delivery.error || ''">{{ statusText[delivery.status] || delivery.status }}</span>
      </div>
    </div>
    <p v-if="!event.deliveries.length" class="work-note">{{ event.kind === 'world' ? '事件已记录，当前没有需要主动回应的对象。' : '当前没有待执行的工作。' }}</p>
    <div class="work-footer">
      <span>{{ event.kind === 'world' ? event.active ? '正在影响邻舍世界' : '已成为过去的见闻' : '按实际执行结果记录' }}</span>
      <linshe-button v-if="hasFailed" variant="link" size="sm" :loading="retrying" @click="retry">重试未完成的回应</linshe-button>
    </div>
    <p v-if="failure" class="work-error" role="alert">{{ failure }}</p>
    <p v-if="uncertain" class="work-note">服务中断时有工作尚未收尾，请先查看目标页面核对；不会自动重复发布。</p>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { retryGodWorldEvent } from '../../api/index.js'
const props = defineProps({ event: { type: Object, required: true } })
const emit = defineEmits(['updated'])
const retrying = ref(false)
const failure = ref('')
const statusText = { pending: '等待回应', running: '正在回应', failed: '暂未完成', cancelled: '已停止', uncertain: '需要核对' }
const completed = computed(() => props.event.deliveries.filter(d => d.status === 'done').length)
const hasFailed = computed(() => props.event.deliveries.some(d => d.status === 'failed'))
const uncertain = computed(() => props.event.deliveries.some(d => d.status === 'uncertain'))
async function retry() {
  if (retrying.value) return
  retrying.value = true; failure.value = ''
  try { emit('updated', await retryGodWorldEvent(props.event.id)) }
  catch (err) { failure.value = err.message }
  finally { retrying.value = false }
}
</script>
<style scoped>
.god-work { margin:18px 0; padding:18px 20px 12px; border:1px solid var(--border-strong); border-radius:var(--radius-lg); background:var(--bg-secondary); box-shadow:var(--shadow-xs); }
.work-heading { display:flex; align-items:center; gap:12px; }
.work-seal { font-size:26px; color:var(--fun-gold); }
.work-title { flex:1; min-width:0; }
.work-eyebrow { color:var(--text-secondary); font-size:var(--fs-xs); }
.work-title h3 { margin:3px 0 0; color:var(--text-primary); font-size:var(--fs-base); line-height:1.5; overflow-wrap:anywhere; }
.work-count { flex-shrink:0; font-size:var(--fs-xs); color:var(--text-secondary); }
.work-count strong { color:var(--text-primary); font-size:var(--fs-base); }
.work-fact { margin:12px 0; font-size:var(--fs-sm); color:var(--text-secondary); line-height:1.75; white-space:pre-wrap; overflow-wrap:anywhere; }
.work-delivery { display:flex; gap:8px; align-items:center; min-height:42px; border-top:1px solid var(--border); font-size:var(--fs-sm); }
.delivery-mark { color:var(--accent); width:14px; flex-shrink:0; }
.delivery-mark.pending { animation:cel-spin 2s linear infinite; }
.delivery-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.delivery-name small { color:var(--text-secondary); margin-left:8px; font-size:var(--fs-xs); }
.delivery-link { color:var(--accent); text-decoration:none; flex-shrink:0; padding:8px 0; }
.delivery-state { color:var(--text-secondary); flex-shrink:0; }
.work-footer { display:flex; justify-content:space-between; gap:8px; align-items:center; margin-top:10px; font-size:var(--fs-xs); color:var(--text-secondary); flex-wrap:wrap; }
.work-note,.work-error { margin:10px 0 0; font-size:var(--fs-sm); line-height:1.7; color:var(--text-secondary); }
.work-error { color:var(--danger); }
@media(max-width:600px) { .god-work { padding:14px 12px 10px; } .work-heading { flex-wrap:wrap; gap:8px; } .work-count { margin-left:auto; } }
</style>
