<template>
  <linshe-modal :model-value="modelValue" title="分类管理" wide :transition-ms="300" @update:model-value="emit('update:modelValue', $event)">
    <div class="folder-manager">
      <p class="manager-hint">按来源或喜好整理邻居。每个角色归入一个分类，勾选后自动保存。</p>
      <div class="manager-toolbar">
        <linshe-select v-model="selectedId" class="manager-select" :options="folderOptions" :disabled="busy || !folders.length" aria-label="选择要管理的分类" placeholder="先新建一个文件夹" />
        <div class="manager-actions">
          <linshe-button size="sm" :disabled="busy" @click="startEditor()">＋ 新建文件夹</linshe-button>
          <linshe-button size="sm" variant="ghost" :disabled="busy || !selectedFolder" @click="startEditor(selectedFolder)">重命名</linshe-button>
          <linshe-button size="sm" variant="danger" :disabled="busy || !selectedFolder" @click="deleteFolder">删除</linshe-button>
        </div>
      </div>

      <Transition name="manager-fade">
        <form v-if="editorOpen" class="manager-editor" @submit.prevent="saveFolder">
          <label for="manager-folder-name">{{ editingId === null ? '新建文件夹' : '重命名文件夹' }}</label>
          <div class="manager-editor-fields">
            <linshe-input id="manager-folder-name" ref="nameInput" v-model="name" :maxlength="20" :disabled="saving" placeholder="例：原创角色 / 绝区零 / 高冷系" />
            <linshe-button type="submit" variant="primary" size="sm" :loading="saving" :disabled="busy || !name.trim()">{{ editingId === null ? '创建' : '保存' }}</linshe-button>
            <linshe-button size="sm" variant="ghost" :disabled="saving" @click="editorOpen = false">取消</linshe-button>
          </div>
        </form>
      </Transition>

      <div class="member-toolbar">
        <div class="member-summary" aria-live="polite">
          <strong>{{ selectedFolder?.name || '还没有分类' }}</strong>
          <span>{{ selectedFolder ? `已归入 ${memberCount} 位角色` : '新建文件夹后，即可勾选角色' }}</span>
        </div>
        <linshe-input v-model="search" size="sm" class="member-search" placeholder="搜索角色名" aria-label="搜索待分类的角色" />
      </div>
      <p class="manager-hint">勾选会从原分类移入这里；取消勾选会回到「未分类」。</p>

      <Transition name="manager-fade" mode="out-in">
        <div :key="selectedId ?? 'empty'" class="member-list" role="group" :aria-label="`${selectedFolder?.name || '分类'}的角色`" :aria-busy="pendingIds.size > 0">
          <div
            v-for="character in filteredCharacters"
            :key="character.id"
            class="member-card"
            :class="{ 'is-selected': isMember(character), 'is-disabled': saving || pendingIds.has(character.id) || !selectedFolder }"
            role="checkbox"
            tabindex="0"
            :aria-checked="isMember(character)"
            :aria-disabled="saving || pendingIds.has(character.id) || !selectedFolder"
            :aria-label="`${character.display_name}，${categoryName(character.folder_id)}`"
            @click="toggleMember(character)"
            @keydown.enter.prevent="toggleMember(character)"
            @keydown.space.prevent="toggleMember(character)"
          >
            <img v-if="character.avatar_path" :src="character.avatar_path" class="member-avatar" alt="" loading="lazy" />
            <span v-else class="member-avatar avatar-fallback">{{ character.display_name?.charAt(0) }}</span>
            <span class="member-info">
              <strong>{{ character.display_name }}</strong>
              <span>{{ pendingIds.has(character.id) ? '保存中…' : categoryName(character.folder_id) }}</span>
            </span>
            <span class="member-check" aria-hidden="true">{{ isMember(character) ? '✓' : '＋' }}</span>
          </div>
          <p v-if="!filteredCharacters.length" class="member-empty">{{ search.trim() ? '没有找到匹配的角色，换个名字试试。' : '还没有角色，去酒馆招募一位邻居吧。' }}</p>
        </div>
      </Transition>
    </div>
    <template #footer>
      <span class="manager-save-state" role="status">{{ busy ? '正在保存…' : '分类修改会同步到酒馆和会话栏' }}</span>
      <linshe-button @click="emit('update:modelValue', false)">完成</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat.js'
import { useCharacterFoldersStore } from '../stores/characterFolders.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheSelect from './ui/LinsheSelect.vue'
import LinsheModal from './ui/LinsheModal.vue'

const props = defineProps({
  modelValue: Boolean,
  initialFolderId: { type: [String, Number], default: 'all' },
})
const emit = defineEmits(['update:modelValue', 'deleted'])
const chat = useChatStore()
const folderStore = useCharacterFoldersStore()
const toast = inject('toast')
const confirm = inject('confirm')
const folders = computed(() => folderStore.folders)
const selectedId = ref(null)
const selectedFolder = computed(() => folders.value.find(folder => folder.id === selectedId.value))
const memberCount = computed(() => chat.characters.filter(isMember).length)
const folderOptions = computed(() => folders.value.map(folder => ({ label: folder.name, value: folder.id })))
const search = ref('')
const filteredCharacters = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return chat.characters.filter(character => (character.display_name || '').toLocaleLowerCase().includes(keyword))
})
const pendingIds = ref(new Set())
const saving = ref(false)
const busy = computed(() => saving.value || pendingIds.value.size > 0)
const editorOpen = ref(false)
const editingId = ref(null)
const name = ref('')
const nameInput = ref(null)

watch(() => props.modelValue, open => {
  if (!open) return
  selectedId.value = folders.value.find(folder => folder.id === props.initialFolderId)?.id ?? folders.value[0]?.id ?? null
  search.value = ''
  editorOpen.value = false
})

watch(folders, list => {
  if (!list.some(folder => folder.id === selectedId.value)) selectedId.value = list[0]?.id ?? null
})

function isMember(character) {
  return selectedId.value !== null && character.folder_id === selectedId.value
}

function categoryName(id) {
  return folders.value.find(folder => folder.id === id)?.name || '未分类'
}

async function startEditor(folder = null) {
  if (busy.value) return
  editingId.value = folder?.id ?? null
  name.value = folder?.name ?? ''
  editorOpen.value = true
  await nextTick()
  nameInput.value?.focus()
}

async function saveFolder() {
  const trimmed = name.value.trim()
  if (!trimmed || busy.value) return
  saving.value = true
  try {
    if (editingId.value !== null) {
      await folderStore.renameFolder(editingId.value, trimmed)
    } else {
      const created = await folderStore.createFolder(trimmed)
      selectedId.value = created.id
    }
    editorOpen.value = false
    toast?.('分类已保存', 'success')
  } catch (error) {
    toast?.(error?.message || '保存失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteFolder() {
  const folder = selectedFolder.value
  if (!folder || busy.value) return
  saving.value = true
  try {
    const ok = await confirm({ title: '删除文件夹', message: `确定删除「${folder.name}」吗？里面的 ${memberCount.value} 个角色会回到「未分类」，角色本身不会被删除。`, okText: '删除', danger: true })
    if (!ok) return
    await folderStore.removeFolder(folder.id)
    // 文件夹 store 更新计数；共享角色数据也要同步，避免侧栏和未分类筛选残留旧归属。
    chat.characters.forEach(character => {
      if (character.folder_id === folder.id) character.folder_id = null
    })
    editorOpen.value = false
    emit('deleted', folder.id)
    toast?.(`已删除文件夹「${folder.name}」`, 'success')
  } catch (error) {
    toast?.(error?.message || '删除失败，请重试', 'error')
  } finally {
    saving.value = false
  }
}

async function toggleMember(character) {
  if (!selectedFolder.value || saving.value || pendingIds.value.has(character.id)) return
  const previous = character.folder_id ?? null
  const target = isMember(character) ? null : selectedId.value
  pendingIds.value.add(character.id)
  character.folder_id = target
  try {
    await folderStore.moveCharacter(character.id, target)
    const current = chat.characters.find(item => item.id === character.id)
    if (current) current.folder_id = target
  } catch (error) {
    character.folder_id = previous
    const current = chat.characters.find(item => item.id === character.id)
    if (current) current.folder_id = previous
    toast?.(error?.message || '分类保存失败，请重试', 'error')
  } finally {
    pendingIds.value.delete(character.id)
  }
}
</script>

<style scoped>
.folder-manager { display: flex; flex-direction: column; gap: 16px; }
.manager-hint { margin: 0; color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.7; }
.manager-toolbar, .manager-actions, .manager-editor-fields, .member-toolbar { display: flex; align-items: center; gap: 10px; }
.manager-toolbar, .member-toolbar { flex-wrap: wrap; }
.manager-select { flex: 1; min-width: 160px; }
.manager-actions { flex-wrap: wrap; }
.manager-editor { padding: 14px; background: var(--bg-sunken); border-radius: var(--radius-md); }
.manager-editor label { display: block; margin-bottom: 10px; font-size: var(--fs-xs); color: var(--text-secondary); }
.manager-editor-fields > :first-child { flex: 1; min-width: 0; }
.member-toolbar { justify-content: space-between; padding-top: 4px; }
.member-summary { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.member-summary strong { color: var(--text-bright); overflow-wrap: anywhere; }
.member-summary > span, .member-info > span { font-size: var(--fs-xs); color: var(--text-secondary); }
.member-search { width: 210px; max-width: 100%; }
.member-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 10px; max-height: 42vh; min-height: 140px; overflow-y: auto; padding: 3px; }
.member-card { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-secondary); color: var(--text-bright); cursor: pointer; text-align: left; }
.member-card:hover, .member-card.is-selected { border-color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }
.member-card.is-disabled { opacity: 0.6; cursor: default; }
.member-avatar { width: 38px; height: 38px; flex-shrink: 0; object-fit: cover; border-radius: var(--radius-full); }
.avatar-fallback { display: grid; place-items: center; background: var(--accent-light); color: var(--accent); }
.member-info { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.member-info > * { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.member-info strong { font-size: var(--fs-sm); font-weight: 600; }
.member-check { display: grid; place-items: center; width: 22px; height: 22px; flex-shrink: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-secondary); }
.is-selected .member-check { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.member-empty { grid-column: 1 / -1; align-self: center; text-align: center; color: var(--text-secondary); font-size: var(--fs-sm); }
.manager-save-state { margin-right: auto; color: var(--text-secondary); font-size: var(--fs-xs); }
.manager-fade-enter-active, .manager-fade-leave-active { transition: opacity 0.3s var(--ease-standard), transform 0.3s var(--ease-standard); }
.manager-fade-enter-from, .manager-fade-leave-to { opacity: 0; transform: translateY(4px); }
@media (max-width: 540px) {
  .manager-select, .member-search { width: 100%; flex-basis: 100%; }
  .manager-editor-fields { flex-wrap: wrap; }
  .manager-editor-fields > :first-child { flex-basis: 100%; }
  .member-list { grid-template-columns: minmax(0, 1fr); max-height: 38vh; }
  .manager-save-state { max-width: 65%; }
}
</style>
