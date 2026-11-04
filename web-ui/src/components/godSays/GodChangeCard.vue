<template>
  <section class="god-change" :aria-label="work.title">
    <div class="heading"><h3>{{ work.title }}</h3><span>{{ statusText[work.status] || work.status }} · {{ done }} / {{ work.items.length }}</span></div>
    <p v-if="work.status === 'pending'" class="note">请核对原文与替换后的完整内容。确认后保存这一版。</p>
    <linshe-button variant="link" size="sm" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起内容' : '查看具体内容' }}</linshe-button>
    <CollapseTransition :show="expanded">
      <div class="items">
        <article v-for="(item, index) in work.items" :key="index" class="item">
          <div class="heading"><strong>{{ item.label || item.before?.display_name || item.before?.target?.name || item.args?.name || '变更内容' }}</strong><span>{{ statusText[item.status] || item.status }}</span></div>
          <div v-for="field in fields(item)" :key="field.key" class="field">
            <span class="field-label">{{ field.label }}</span>
            <p v-if="field.before != null" class="before">原文：{{ field.before }}</p>
            <p class="after"><span v-if="field.before != null" class="replacement-label">替换后：</span>{{ field.after }}</p>
          </div>
          <p v-if="item.error" class="error">{{ item.error }}</p>
          <p v-if="item.result?.note" class="note">{{ item.result.note }}</p>
        </article>
      </div>
    </CollapseTransition>
    <div v-if="work.version && work.status === 'pending'" class="actions">
      <linshe-button variant="primary" size="sm" :loading="busy" @click="decide('approve')">确认应用</linshe-button>
      <linshe-button size="sm" :disabled="busy" @click="decide('reject')">取消修改</linshe-button>
    </div>
    <linshe-button v-if="!work.version && work.status === 'running'" size="sm" :loading="busy" @click="stop">停止批量任务</linshe-button>
    <p v-if="['conflict', 'uncertain', 'interrupted', 'partial'].includes(work.status)" class="note">请查看逐项结果。需要调整内容时，重新提出修改要求；结果待核对的操作请先到对应页面核对。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import CollapseTransition from '../CollapseTransition.vue'
import { decideGodChange, stopGodBatch } from '../../api/index.js'
const props = defineProps({ work: { type: Object, required: true } })
const emit = defineEmits(['updated'])
const expanded = ref(props.work.items.length <= 5)
const busy = ref(false)
const error = ref('')
const statusText = { pending: '待确认', awaiting_confirmation: '待确认', applying: '正在应用', running: '处理中', done: '已完成', failed: '失败', partial: '部分完成', rejected: '已取消', cancelled: '已停止', conflict: '内容已变化', uncertain: '需要核对', interrupted: '已中断' }
const done = computed(() => props.work.items.filter(i => i.status === 'done').length)
const labels = { world_id: '世界观编号', outfit_id: '外观编号', set_id: '配置编号', group_id: '群聊编号', outlet_id: '媒体编号', name: '名称', display_name: '显示名称', base_prompt: '完整人设', description: '外观描述', content: '内容', relationship_text: '关系', topic: '话题', desc: '描述', prompt: '创作方向', tagline: '简介', enabled: '启用状态', emotion_baseline: '情绪基线', member_ids: '成员编号' }
function fields(item) {
  if (item.preview?.length) return item.preview.map((field, index) => ({ ...field, key: `replacement-${index}` }))
  if (item.name === 'activate_world_setting') return [{ key: 'world', label: '将启用的世界观', after: item.before?.target?.name + '\n' + item.before?.target?.content }]
  return Object.entries(item.args || {}).filter(([key]) => labels[key]).map(([key, value]) => ({ key, label: labels[key], before: item.before?.[key], after: typeof value === 'object' ? JSON.stringify(value) : typeof value === 'boolean' ? value ? '启用' : '停用' : value }))
}
async function stop() {
  if (busy.value) return
  busy.value = true
  try { await stopGodBatch(props.work.id); emit('updated') }
  catch (err) { error.value = err.message }
  finally { busy.value = false }
}
async function decide(decision) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await decideGodChange(props.work.id, props.work.version, decision); emit('updated') }
  catch (err) { error.value = err.message; emit('updated') }
  finally { busy.value = false }
}
</script>
<style scoped>
.god-change { margin:16px 0; padding:14px 16px; border:1px solid var(--border); border-left:2px solid var(--fun-gold); border-radius:var(--radius-md); background:color-mix(in srgb, var(--bg-secondary) 45%, transparent); }
.heading { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
h3 { margin:0; font-size:var(--fs-base); color:var(--text-primary); }
.heading span,.field-label { font-size:var(--fs-xs); color:var(--text-secondary); }
.item { padding:12px 0; border-top:1px solid var(--border); }
.items { margin-top:12px; }
.field { margin-top:10px; }
.note,.before,.after,.error { margin:8px 0 0; font-size:var(--fs-sm); line-height:1.75; white-space:pre-wrap; overflow-wrap:anywhere; }
.note,.before { color:var(--text-secondary); }
.after { color:var(--text-primary); }
.error { color:var(--danger); }
.actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
@media(max-width:600px) { .god-change { padding:14px 12px; } }
</style>
