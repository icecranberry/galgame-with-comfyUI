<template>
  <linshe-modal :model-value="modelValue" title="宿舍安排" full :transition-ms="300" body-class="cohabitation-body" @update:model-value="emit('update:modelValue', $event)">
    <template #header-extra><span class="residence-count">房间 <b>{{ rooms.length }}</b></span></template>
    <div class="residence-content">
      <CollapseTransition :show="pendingChanges">
        <div class="residence-notice">
          <div class="residence-notice-card" role="status">
            <span class="residence-notice-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>
            <p>变更将在下一次自动/手动全体日程变更时生效</p>
          </div>
        </div>
      </CollapseTransition>
    <div class="residence-layout" :aria-busy="busy || loading">
      <section class="residence-main" aria-label="房间">
        <div class="residence-toolbar">
          <h4 class="residence-section-title">房间</h4>
          <div v-if="selected" class="selection-status" role="status">
            <span>{{ selected.display_name }} · 选择房间</span>
            <linshe-button variant="link" tone="muted" size="sm" @click="selectedId = null">取消</linshe-button>
          </div>
        </div>
        <div v-if="loading" class="residence-empty" role="status">正在加载房间…</div>
        <div v-else-if="loadError" class="residence-empty" role="alert">
          <span>{{ loadError }}</span><linshe-button size="sm" @click="load">重试</linshe-button>
        </div>
        <TransitionGroup v-else name="residence" tag="div" class="residence-grid">
          <section
            v-for="room in rooms" :key="room.id" class="residence-room"
            :class="{ 'is-target': dragTarget === room.id, 'has-selection': selected && !busy }"
            @dragover.prevent="over($event, room.id)" @dragleave="leave" @drop.prevent="drop($event, room.id)"
          >
            <header class="residence-heading">
              <span class="residence-emblem" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7" /></svg>
              </span>
              <div class="residence-name-area">
                <Transition name="residence-title" mode="out-in" @after-enter="focusName">
                  <div v-if="editingId === room.id" key="editing" class="residence-name-editor">
                    <linshe-input
                      :ref="el => { if (el) nameEditor = el }" v-model="draftNames[room.id]" size="sm" maxlength="60"
                      :aria-label="`${room.name}的名称`" :disabled="busy" :invalid="Boolean(nameErrors[room.id])"
                      :aria-describedby="nameErrors[room.id] ? `residence-error-${room.id}` : undefined"
                      @blur="rename(room)" @keydown.enter="finishName($event)" @keydown.esc.stop.prevent="cancelRename(room)"
                    />
                    <span v-if="nameErrors[room.id]" :id="`residence-error-${room.id}`" class="residence-name-error" role="alert">{{ nameErrors[room.id] }}</span>
                  </div>
                  <!-- 原位编辑的标题热区：保留正文门牌样式，不另做一套表单按钮。 -->
                  <div
                    v-else key="title" class="residence-title" role="button" tabindex="0" :aria-disabled="busy"
                    :aria-label="`修改${room.name}的名称`" title="点击修改名称"
                    @click="beginRename(room)" @keydown.enter.prevent="beginRename(room)" @keydown.space.prevent="beginRename(room)"
                  >
                    <span class="residence-title-text">{{ room.name }}</span>
                    <svg class="residence-edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z" /></svg>
                  </div>
                </Transition>
              </div>
              <span class="residence-delete-action">
              <linshe-button variant="link" tone="muted" size="sm" touch-target :hover-motion="false" :disabled="busy" :aria-label="`删除${room.name}，成员移回未安排`" title="删除房间" @click="remove(room)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></svg>
              </linshe-button>
              </span>
            </header>
            <div
              class="residence-occupants" role="button" tabindex="0" :aria-label="`将选中的角色移入${room.name}`"
              :aria-disabled="busy || !selected" :class="{ 'can-place': selected && !busy }"
              @click="moveSelected(room.id)" @keydown.enter.self.prevent="moveSelected(room.id)" @keydown.space.self.prevent="moveSelected(room.id)"
            >
              <div
                v-for="character in roomCharacters(room)" :key="character.id" class="resident-avatar"
                :class="{ 'is-selected': selectedId === character.id, 'is-disabled': busy }"
                role="button" tabindex="0" :draggable="!busy" :aria-disabled="busy" :aria-pressed="selectedId === character.id" :aria-label="`选择${character.display_name}`"
                @dragstart="startDrag($event, character.id)" @dragend="dragTarget = null" @click.stop="select(character.id)" @keydown.enter.stop.prevent="select(character.id)" @keydown.space.stop.prevent="select(character.id)"
              >
                <span class="resident-portrait"><img v-if="character.avatar_path" :src="character.avatar_path" alt="" draggable="false" /><span v-else class="resident-fallback">{{ character.display_name.slice(0, 1) }}</span></span>
                <span class="resident-name">{{ character.display_name }}</span>
              </div>
              <span v-if="!room.memberIds.length" class="residence-drop-label">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                {{ selected ? '安置到这里' : '拖入头像' }}
              </span>
            </div>
            <footer class="residence-room-footer"><span>{{ room.memberIds.length }} 人</span><span v-if="dragTarget === room.id" class="residence-drop-state">松开入住</span></footer>
          </section>
          <div
            key="new" class="residence-new" role="button" tabindex="0" :aria-disabled="busy" :class="{ 'is-target': dragTarget === 'new', 'is-disabled': busy }"
            aria-label="新建房间，拖入头像可同时入住" @click="create(selectedId)" @keydown.enter.prevent="create(selectedId)" @keydown.space.prevent="create(selectedId)"
            @dragover.prevent="over($event, 'new')" @dragleave="leave" @drop.prevent="drop($event, 'new')"
          >
            <span class="residence-new-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 4v16M4 12h16" /></svg></span>
            <span>{{ dragTarget === 'new' ? '松开新建并入住' : '新建房间' }}</span>
            <span class="residence-new-hint">拖到这里，新建并入住</span>
          </div>
        </TransitionGroup>
      </section>
      <aside
        class="residence-pool" :class="{ 'is-target': dragTarget === 'pool' }" aria-label="未安排角色"
        @dragover.prevent="over($event, 'pool')" @dragleave="leave" @drop.prevent="drop($event, null)"
      >
        <div class="residence-pool-heading">
          <h4 class="residence-section-title">未安排 <span class="residence-pool-count">{{ unassigned.length }}</span></h4>
          <linshe-button v-if="selected && assignedIds.has(selectedId)" variant="link" tone="muted" size="sm" :disabled="busy" @click="moveSelected(null)">移出房间</linshe-button>
        </div>
        <p class="residence-guide"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg><span>拖动头像到房间，也可点选安排</span></p>
        <linshe-input v-model="search" size="md" placeholder="搜索角色" aria-label="搜索未安排角色" />
        <div class="residence-pool-avatars">
          <div
            v-for="character in filteredUnassigned" :key="character.id" class="resident-avatar"
            :class="{ 'is-selected': selectedId === character.id, 'is-disabled': busy }"
            role="button" tabindex="0" :draggable="!busy" :aria-disabled="busy" :aria-pressed="selectedId === character.id" :aria-label="`选择${character.display_name}`"
            @dragstart="startDrag($event, character.id)" @dragend="dragTarget = null" @click="select(character.id)" @keydown.enter.prevent="select(character.id)" @keydown.space.prevent="select(character.id)"
          >
            <span class="resident-portrait"><img v-if="character.avatar_path" :src="character.avatar_path" alt="" draggable="false" /><span v-else class="resident-fallback">{{ character.display_name.slice(0, 1) }}</span></span>
            <span class="resident-name">{{ character.display_name }}</span>
          </div>
          <span v-if="!loading && !filteredUnassigned.length" class="residence-pool-empty">{{ search ? '没有匹配的角色' : '都已安排妥当' }}</span>
        </div>
      </aside>
    </div>
    </div>
  </linshe-modal>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import CollapseTransition from './CollapseTransition.vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import * as api from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'room-count-change'])
const toast = inject('toast', null)
const rooms = ref([]), characters = ref([]), draftNames = ref({}), nameErrors = ref({})
const selectedId = ref(null), search = ref(''), dragTarget = ref(null), editingId = ref(null)
const nameEditor = shallowRef(null)
const busy = ref(false), loading = ref(false), loadError = ref('')
const pendingChanges = ref(false)
let pendingRequest = 0
let pendingRefreshQueued = false
const assignedIds = computed(() => new Set(rooms.value.flatMap(r => r.memberIds)))
const unassigned = computed(() => characters.value.filter(c => !assignedIds.value.has(c.id)))
const filteredUnassigned = computed(() => unassigned.value.filter(c => c.display_name.toLowerCase().includes(search.value.trim().toLowerCase())))
const selected = computed(() => characters.value.find(c => c.id === selectedId.value))
const roomCharacters = room => characters.value.filter(c => room.memberIds.includes(c.id))
function applyRooms(next) {
  rooms.value = next.map(room => ({ ...room, name: room.name === '新居室' ? '新房间' : room.name }))
  emit('room-count-change', rooms.value.length)
  for (const room of rooms.value) if (!nameErrors.value[room.id]) draftNames.value[room.id] = room.name
}
async function load() {
  pendingRequest++
  loading.value = true; loadError.value = ''
  try { const data = await api.getCohabitation(); characters.value = data.characters; applyRooms(data.rooms); pendingChanges.value = Boolean(data.pendingChanges) }
  catch (error) { loadError.value = error.message }
  finally { loading.value = false; if (pendingRefreshQueued) refreshPendingChanges() }
}
watch(() => props.modelValue, open => {
  if (open) load()
  else { selectedId.value = null; dragTarget.value = null; editingId.value = null }
}, { immediate: true })
async function refreshPendingChanges() {
  if (!props.modelValue) return
  if (busy.value || loading.value) { pendingRefreshQueued = true; return }
  pendingRefreshQueued = false
  const request = ++pendingRequest
  try {
    const data = await api.getCohabitation()
    if (props.modelValue && request === pendingRequest) pendingChanges.value = Boolean(data.pendingChanges)
  } catch { /* 读取失败保留已知状态，重新打开时再读取。 */ }
}
const unsubscribeBatch = onEvent('schedule_reset_progress', data => {
  if (data.phase === 'complete' && data.status === 'done') refreshPendingChanges()
})
const unsubscribeConnected = onEvent('connected', refreshPendingChanges)
onBeforeUnmount(() => { pendingRequest++; unsubscribeBatch(); unsubscribeConnected() })
function select(id) { if (!busy.value) selectedId.value = selectedId.value === id ? null : id }
function startDrag(event, id) {
  if (busy.value) { event.preventDefault(); return }
  selectedId.value = id
  event.dataTransfer.setData('application/x-linshe-character', String(id)); event.dataTransfer.effectAllowed = 'move'
}
function over(event, target) {
  if (!busy.value && [...event.dataTransfer.types].includes('application/x-linshe-character')) dragTarget.value = target
}
function leave(event) { if (!event.currentTarget.contains(event.relatedTarget)) dragTarget.value = null }
async function mutate(action, { clearSelection = false } = {}) {
  if (busy.value || loading.value) return false
  pendingRequest++
  busy.value = true
  try { const data = await action(); applyRooms(data.rooms); pendingChanges.value = Boolean(data.pendingChanges); if (clearSelection) selectedId.value = null; return true }
  catch (error) { toast?.(error.message, 'error'); return false }
  finally { busy.value = false; dragTarget.value = null; if (pendingRefreshQueued) refreshPendingChanges() }
}
async function create(id = null) {
  await mutate(() => api.createResidence({ name: '新房间', ...(id ? { characterId: id } : {}) }), { clearSelection: true })
}
async function moveSelected(roomId) {
  if (!selectedId.value) return
  await mutate(() => api.moveResidenceMember(selectedId.value, roomId), { clearSelection: true })
}
async function drop(event, roomId) {
  dragTarget.value = null
  const id = Number(event.dataTransfer.getData('application/x-linshe-character'))
  if (!characters.value.some(c => c.id === id) || busy.value) return
  selectedId.value = id
  if (roomId === 'new') await create(id)
  else await moveSelected(roomId)
}
function focusName() { if (editingId.value !== null) { nameEditor.value?.focus(); nameEditor.value?.select() } }
async function beginRename(room) {
  if (busy.value) return
  if (!nameErrors.value[room.id]) draftNames.value[room.id] = room.name
  editingId.value = room.id
  await nextTick(); focusName()
}
function finishName(event) { if (!event.isComposing) { event.preventDefault(); event.target.blur() } }
function cancelRename(room) {
  editingId.value = null
  draftNames.value[room.id] = room.name
  nameErrors.value[room.id] = ''
}
async function rename(room) {
  if (editingId.value !== room.id || busy.value) return
  const name = (draftNames.value[room.id] || '').trim()
  if (name === room.name) { editingId.value = null; return }
  if (!name) { nameErrors.value[room.id] = '名称不能为空'; return }
  nameErrors.value[room.id] = ''
  if (await mutate(() => api.renameResidence(room.id, name))) editingId.value = null
  else nameErrors.value[room.id] = '未保存，请重试'
}
async function remove(room) { await mutate(() => api.deleteResidence(room.id)) }
</script>

<style scoped>
.residence-content {
  --residence-muted: color-mix(in srgb, var(--text-primary) 48%, var(--text-secondary));
  --residence-line: color-mix(in srgb, var(--border-strong) 75%, var(--border));
  --residence-candy-edge: color-mix(in srgb, var(--accent-hover) 52%, var(--bg-secondary));
  --residence-candy-lip: color-mix(in srgb, var(--accent-hover) 62%, var(--bg-secondary));
  --residence-candy-highlight: color-mix(in srgb, var(--accent-light) 30%, var(--bg-secondary));
  --residence-candy-face: color-mix(in srgb, var(--accent) 14%, var(--bg-secondary));
  --residence-candy-ink: color-mix(in srgb, var(--accent) 22%, var(--text-primary));
  display: flex; flex-direction: column; min-height: 380px; height: min(72dvh, 720px); color: var(--text-primary);
}
.residence-notice { flex-shrink: 0; padding: 0 2px 16px; }
.residence-notice-card { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1.5px solid var(--residence-candy-edge); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--accent) 23%, var(--bg-secondary)); box-shadow: 0 3px 0 var(--residence-candy-lip), inset 0 1px 0 var(--residence-candy-highlight); }
.residence-notice-icon { display: grid; place-items: center; flex: 0 0 34px; height: 34px; border-radius: var(--radius-md); color: var(--on-accent); background: var(--accent); box-shadow: var(--shadow-hard-sm); }
.residence-notice p { margin: 0; color: var(--text-primary); font-size: var(--fs-md); font-weight: 600; line-height: 1.6; }
.residence-layout {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 38%); gap: 28px;
  flex: 1; min-height: 0;
}
.residence-main { min-width: 0; overflow: auto; padding: 6px 6px 8px; }
.residence-toolbar, .residence-pool-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; margin-bottom: 16px; }
.residence-section-title { margin: 0; display: flex; align-items: center; gap: 10px; font-size: var(--fs-lg); font-weight: 650; line-height: 1.5; }
.selection-status { display: flex; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; font-size: var(--fs-base); line-height: 1.5; color: var(--residence-muted); }
.selection-status > span { overflow-wrap: anywhere; }
.residence-count { color: color-mix(in srgb, var(--text-primary) 48%, var(--text-secondary)); font-size: var(--fs-base); }
.residence-count b { margin-left: 6px; color: var(--text-primary); font-weight: 600; }
.residence-pool-count { font-size: var(--fs-md); font-weight: 500; color: var(--residence-muted); font-variant-numeric: tabular-nums; }
.residence-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 20px; }
.residence-room {
  position: relative; isolation: isolate; display: flex; flex-direction: column; min-width: 0;
  border: 1.5px solid var(--residence-candy-edge); border-radius: var(--radius-lg); background: var(--bg-secondary);
  box-shadow: 0 3px 0 var(--residence-candy-lip); transition: transform var(--dur-interaction) var(--ease-standard);
}
.residence-room::before, .residence-new::before {
  content: ''; position: absolute; inset: -1px; z-index: -1; border-radius: inherit; pointer-events: none; opacity: 0;
  box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--border-strong); transition: opacity var(--dur-interaction) var(--ease-standard);
}
.residence-room:hover::before, .residence-room:focus-within::before, .residence-new:hover::before, .residence-new:focus-visible::before { opacity: 1; }
.residence-room:hover, .residence-new:hover { transform: translateY(-2px); }
.residence-heading {
  display: flex; align-items: flex-start; gap: 10px; min-height: 64px; padding: 12px 12px 10px 16px;
  background: var(--residence-candy-face); border-radius: calc(var(--radius-lg) - 2px) calc(var(--radius-lg) - 2px) 0 0;
  border-bottom: 1px solid color-mix(in srgb, var(--accent-hover) 24%, var(--bg-secondary));
}
.residence-emblem { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; margin-block: 4px; border: 1px solid var(--accent); border-radius: var(--radius-md); color: var(--on-accent); background: var(--accent); box-shadow: var(--shadow-hard-sm); }
.residence-name-area { flex: 1; min-width: 0; }
.residence-title { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: text; text-align: left; border-radius: var(--radius-sm); }
.residence-title-text { min-width: 0; overflow-wrap: anywhere; font-size: var(--fs-lg); font-weight: 600; line-height: 1.5; }
.residence-edit-icon { flex-shrink: 0; color: var(--residence-muted); }
.residence-delete-action { display: inline-flex; flex-shrink: 0; }
.residence-edit-icon, .residence-delete-action { transition: opacity var(--dur-interaction) var(--ease-standard); }
@media (hover: hover) and (pointer: fine) {
  .residence-edit-icon, .residence-delete-action { opacity: 0; }
  .residence-delete-action { pointer-events: none; }
  .residence-room:hover .residence-edit-icon, .residence-room:focus-within .residence-edit-icon,
  .residence-room:hover .residence-delete-action, .residence-room:focus-within .residence-delete-action { opacity: 1; pointer-events: auto; }
}
.residence-title[aria-disabled="true"] { cursor: default; opacity: .6; }
.residence-name-editor { display: flex; flex-direction: column; justify-content: center; min-height: 42px; gap: 6px; }
.residence-name-editor > :first-child { width: 100%; }
.residence-name-error { color: color-mix(in srgb, var(--danger) 70%, var(--text-primary)); font-size: var(--fs-base); line-height: 1.5; }
.residence-occupants { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 12px 8px; min-height: 130px; flex: 1; padding: 18px 16px 8px; text-align: left; cursor: default; border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
.residence-occupants.can-place { cursor: pointer; }
.resident-avatar { position: relative; width: 72px; display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 5px 2px; text-align: center; cursor: grab; border-radius: var(--radius-md); transition: transform var(--dur-interaction) var(--ease-standard); }
.resident-avatar:hover { transform: translateY(-2px); }
.resident-avatar:active { cursor: grabbing; }
.resident-portrait { position: relative; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; }
.resident-portrait::after { content: ''; position: absolute; inset: -4px; border: 2px solid var(--border-strong); border-radius: inherit; opacity: 0; transition: opacity var(--dur-interaction) var(--ease-standard), transform var(--dur-interaction) var(--ease-standard); transform: scale(.92); }
.resident-avatar:hover .resident-portrait::after { opacity: 1; transform: scale(1); }
.resident-avatar.is-selected .resident-portrait::after { border-color: var(--accent); opacity: 1; transform: scale(1); }
.resident-avatar.is-selected .resident-portrait::before { content: '✓'; position: absolute; right: -5px; bottom: -2px; z-index: 1; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--text-primary); color: var(--bg-secondary); font-size: var(--fs-sm); font-weight: 700; }
.resident-avatar img, .resident-fallback { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: var(--bg-sunken); box-shadow: var(--shadow-xs); }
.resident-fallback { display: grid; place-items: center; color: var(--residence-muted); font-size: var(--fs-lg); }
.resident-name { width: 100%; font-size: var(--fs-base); line-height: 1.5; overflow-wrap: anywhere; }
.residence-room-footer { display: flex; align-items: center; justify-content: space-between; min-height: 30px; gap: 12px; padding: 0 18px 12px; color: var(--residence-muted); font-size: var(--fs-base); line-height: 1.5; font-variant-numeric: tabular-nums; }
.residence-drop-state { color: var(--text-primary); font-weight: 600; }
.residence-new {
  position: relative; isolation: isolate; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  min-height: 226px; border: 1.5px dashed var(--residence-candy-edge); border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-secondary)); color: var(--residence-candy-ink); font-size: var(--fs-md); font-weight: 600; text-align: center; cursor: pointer;
  transition: transform var(--dur-interaction) var(--ease-standard);
}
.residence-new-icon { display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--accent-hover); border-radius: var(--radius-lg); color: var(--bg-secondary); background: var(--grad-cel); box-shadow: 0 3px 0 var(--btn-lip), inset 0 1px 0 var(--accent-light); }
.residence-new-hint { font-size: var(--fs-base); font-weight: 400; color: var(--residence-muted); }
.residence-new:active { transform: translateY(1px) scale(.99); }
.residence-room.is-target, .residence-new.is-target, .residence-pool.is-target { outline: 2px solid var(--accent); outline-offset: 2px; }
.residence-room.is-target::before, .residence-new.is-target::before { opacity: 1; box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--accent); }
.residence-drop-label { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--residence-muted); font-size: var(--fs-base); line-height: 1.6; margin: auto; padding: 8px 0; }
.residence-drop-label svg { opacity: .65; }
.residence-pool { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 16px 18px 8px; border: 1px solid var(--residence-candy-edge); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--accent) 6%, var(--bg-secondary)); }
.residence-pool-heading { margin-bottom: 14px; min-height: 28px; }
.residence-guide { display: flex; align-items: flex-start; gap: 6px; margin: -4px 0 12px; color: var(--residence-candy-ink); font-size: var(--fs-base); line-height: 1.6; }
.residence-guide svg { flex-shrink: 0; margin-top: 1px; }
.residence-pool-avatars { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); align-content: start; justify-items: center; gap: 18px 8px; overflow: auto; padding: 18px 4px 12px; margin-top: 4px; }
.residence-pool-empty { grid-column: 1/-1; padding: 28px 0; color: var(--residence-muted); font-size: var(--fs-base); line-height: 1.6; text-align: center; }
.residence-empty { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 200px; color: var(--residence-muted); font-size: var(--fs-md); line-height: 1.6; }
.is-disabled { cursor: default; opacity: .6; }
.residence-move, .residence-enter-active, .residence-leave-active, .residence-title-enter-active, .residence-title-leave-active { transition: opacity var(--dur-interaction) var(--ease-standard), transform var(--dur-interaction) var(--ease-standard); }
.residence-enter-from, .residence-leave-to { opacity: 0; transform: translateY(8px); }
.residence-title-enter-from, .residence-title-leave-to { opacity: 0; transform: translateY(2px); }
@media (max-width: 1050px) and (min-width: 768px) {
  .residence-layout { grid-template-columns: minmax(0, 1fr) minmax(300px, 40%); gap: 20px; }
}
@media (max-width: 767px) {
  .residence-content { height: calc(100dvh - 128px); min-height: 0; }
  .residence-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(170px, 1fr) minmax(220px, 40dvh); gap: 16px; }
  .residence-main { overflow: auto; }
  .residence-toolbar { flex-wrap: wrap; }
  .selection-status { justify-content: flex-start; }
  .residence-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .residence-heading { padding-left: 12px; }
  .residence-occupants { min-height: 110px; padding: 14px 12px 8px; }
  .residence-new { min-height: 150px; gap: 10px; }
  .residence-pool { min-height: 220px; padding: 14px 12px 8px; }
  .residence-pool-heading { margin-bottom: 10px; }
  .residence-guide { margin-bottom: 8px; }
  .residence-pool .resident-avatar { gap: 6px; }
  .residence-pool-avatars { min-height: 0; gap: 8px; padding: 10px 4px 8px; }
}
</style>
