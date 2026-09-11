<template>
  <section v-if="items.length || nextCursor || error" class="town-mailbox-tasks" aria-label="小镇委托">
    <header><h2>小镇委托</h2><linshe-button variant="link" size="sm" :disabled="loading" @click="read(false)">重新读取</linshe-button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-else>
      <p class="task-hint">公告板上的正式配送任务。需在小镇实际领取和交付，完成后获得报酬。</p>
      <article v-for="item in items" :key="item.orderId">
        <div><h3>{{ statusText[item.status] || '配送委托' }}</h3><p>{{ item.locations?.supplier?.name || '原料点' }} → {{ item.locations?.workshop?.name || '工坊' }}</p><p class="task-hint">交付报酬 {{ item.reward }} 邻币 · {{ time(item.expiresAt) }} 前完成</p></div>
        <linshe-button size="sm" @click="emit('open-town')">去小镇查看</linshe-button>
      </article>
      <p class="task-hint">打开后可在生活面板查看最新状态，前往指定地点继续任务。</p>
      <linshe-button v-if="nextCursor" variant="ghost" size="sm" :disabled="loading" @click="read(true)">查看更多委托</linshe-button>
    </template>
  </section>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import { getTownMailboxTasks } from '../../api/index.js'
const emit = defineEmits(['open-town'])
const items = ref([]), nextCursor = ref(null), loading = ref(false), error = ref('')
const statusText = { open: '原料配送 · 可领取', accepted: '原料配送 · 待取货', picked_up: '原料配送 · 待交付' }
let controller, generation = 0, worldKey = null
function time(value) {
  return Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）' : '有效期'
}
async function read(append = false) {
  controller?.abort(); controller = new AbortController()
  const token = ++generation
  loading.value = true; error.value = ''
  try {
    const data = await getTownMailboxTasks({ cursor: append ? nextCursor.value : null, signal: controller.signal })
    if (token === generation) {
      const scope = JSON.stringify([data.worldId, data.worldEpoch])
      const combined = append && scope === worldKey ? [...items.value, ...data.items] : data.items
      items.value = [...new Map(combined.map(item => [item.orderId, item])).values()]
      nextCursor.value = data.nextCursor; worldKey = scope
    }
  } catch (e) {
    if (token === generation && e.name !== 'AbortError') { items.value = []; nextCursor.value = null; error.value = '小镇委托暂时无法读取，请稍后再试。' }
  } finally { if (token === generation) loading.value = false }
}
onMounted(() => read())
onBeforeUnmount(() => { generation++; controller?.abort() })
</script>

<style scoped>
.town-mailbox-tasks{margin:12px 20px 6px;padding:16px 4px;color:#5a4a3a}.town-mailbox-tasks header{display:flex;align-items:center;justify-content:space-between;gap:12px}.town-mailbox-tasks h2{font-size:15px;margin:0}.town-mailbox-tasks h3{font-size:14px;margin:0 0 6px}.town-mailbox-tasks p{font-size:13px;line-height:1.6;margin:5px 0;overflow-wrap:anywhere}.town-mailbox-tasks .task-hint{font-size:12px;color:#8a7a6a}.town-mailbox-tasks article{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0}.town-mailbox-tasks [role=alert]{color:#a44338}@media(max-width:480px){.town-mailbox-tasks{margin:8px 16px}.town-mailbox-tasks article{align-items:flex-start;flex-direction:column;gap:8px}}
</style>
