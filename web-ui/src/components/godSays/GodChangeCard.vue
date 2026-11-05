<template>
  <section class="god-change" :aria-label="work.title">
    <div class="heading"><h3>{{ work.title }}</h3><span>{{ statusLabel(work) }} · {{ done }} / {{ work.items.length }}</span></div>
    <p v-if="work.status === 'pending'" class="note">请核对以下内容。确认后保存这一版。</p>
    <div class="items">
      <article v-for="({ item, name, characterId, avatar }, index) in displayItems" :key="index" class="item">
        <div class="heading">
          <div class="item-identity">
            <template v-if="characterId != null">
              <img v-if="avatar && !failedAvatars.has(avatar)" :key="avatar" :src="avatar" class="avatar item-avatar" alt="" loading="lazy" @error="failedAvatars.add(avatar)" />
              <span v-else class="avatar-fallback item-avatar" aria-hidden="true">{{ Array.from(name)[0] }}</span>
            </template>
            <strong>{{ name }}</strong>
          </div>
          <span>{{ statusLabel(item) }}</span>
        </div>
        <div v-for="field in godChangeFields(item)" :key="field.key" class="field">
          <span class="field-label">{{ field.label }}</span>
          <template v-if="field.kind === 'image'">
            <p v-if="field.before" class="before">原图</p>
            <GodMessageImages v-if="field.before" :images="[{ url: field.before }]" />
            <p class="after">替换后</p>
            <GodMessageImages :images="[{ url: field.after }]" />
          </template>
          <template v-else>
          <p v-if="field.before != null" class="before">原文：{{ field.before }}</p>
          <p class="after"><span v-if="field.before != null" class="replacement-label">替换后：</span>{{ field.after }}</p>
          </template>
        </div>
        <p v-if="item.error" class="error">{{ item.error }}</p>
        <p v-if="item.result?.note" class="note">{{ item.result.note }}</p>
      </article>
    </div>
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
import GodMessageImages from './GodMessageImages.vue'
import { decideGodChange, stopGodBatch } from '../../api/index.js'
import { useChatStore } from '../../stores/chat.js'
import { godChangeFields } from '../../utils/godChangeFields.js'
const props = defineProps({ work: { type: Object, required: true } })
const emit = defineEmits(['updated'])
const chat = useChatStore()
const failedAvatars = ref(new Set())
const displayItems = computed(() => {
  const characters = new Map(chat.characters.map(character => [String(character.id), character]))
  return props.work.items.map(item => {
    const characterId = item.args?.character_id
    const character = characterId == null ? null : characters.get(String(characterId))
    return {
      item, characterId,
      name: item.label || item.before?.display_name || character?.display_name || item.before?.target?.name || item.args?.name || '变更内容',
      avatar: character?.avatar_path || '',
    }
  })
})
const busy = ref(false)
const error = ref('')
const statusText = { pending: '待确认', awaiting_confirmation: '待确认', applying: '正在应用', running: '处理中', done: '已完成', failed: '失败', partial: '部分完成', rejected: '已取消', cancelled: '已停止', conflict: '内容已变化', uncertain: '需要核对', interrupted: '已中断' }
function statusLabel(entry) {
  if (entry.status === 'done' && (entry.result?.status === 'accepted' || entry.items?.some(item => item.result?.status === 'accepted'))) return '已提交'
  return statusText[entry.status] || entry.status
}
const done = computed(() => props.work.items.filter(i => i.status === 'done').length)
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
.item-identity { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
.item-identity strong { overflow-wrap:anywhere; min-width:0; }
.item-avatar { width:32px; height:32px; flex-shrink:0; }
h3 { margin:0; font-size:var(--fs-base); color:var(--text-primary); }
.heading > span,.field-label { font-size:var(--fs-xs); color:var(--text-secondary); }
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
