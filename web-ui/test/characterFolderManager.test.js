import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/CharacterFolderManager.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'folder-manager-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '')
  .replace('export default', 'return')

function fixture(t, overrides = {}) {
  const chat = Vue.reactive({ characters: [
    { id: 1, display_name: 'Alice', folder_id: 10 },
    { id: 2, display_name: 'Bob', folder_id: null },
    { id: 3, display_name: 'Carol', folder_id: 20 },
  ] })
  const moves = [], toasts = [], events = []
  const store = Vue.reactive({
    folders: [{ id: 10, name: '原创' }, { id: 20, name: '游戏' }],
    moveCharacter: async (...args) => { moves.push(args) },
    createFolder: async name => { const folder = { id: 30, name }; store.folders.push(folder); return folder },
    renameFolder: async (id, name) => { store.folders.find(folder => folder.id === id).name = name },
    removeFolder: async id => { store.folders = store.folders.filter(folder => folder.id !== id) },
    ...overrides,
  })
  const dependencies = { toast: (...args) => toasts.push(args), confirm: async () => true }
  const component = new Function('Vue', 'useChatStore', 'useCharacterFoldersStore', 'LinsheButton', 'LinsheInput', 'LinsheSelect', 'LinsheModal', code)(
    { ...Vue, inject: key => dependencies[key] }, () => chat, () => store,
  )
  const props = Vue.reactive({ modelValue: false, initialFolderId: 10 })
  const scope = Vue.effectScope()
  const state = scope.run(() => component.setup(props, { expose() {}, emit: (...args) => events.push(args) }))
  t.after(() => scope.stop())
  state.selectedId.value = 10
  return { state, chat, store, moves, toasts, events, props }
}

test('checking moves a character from another folder; unchecking returns it to uncategorized', async t => {
  const { state, chat, moves } = fixture(t)
  await state.toggleMember(chat.characters[2])
  assert.equal(chat.characters[2].folder_id, 10)
  assert.equal(state.memberCount.value, 2)
  await state.toggleMember(chat.characters[2])
  assert.equal(chat.characters[2].folder_id, null)
  assert.deepEqual(moves, [[3, 10], [3, null]])
})

test('a failed move rolls back and duplicate clicks while saving send only one request', async t => {
  let rejectMove, calls = 0
  const { state, chat, toasts } = fixture(t, { moveCharacter: () => { calls++; return new Promise((_, reject) => { rejectMove = reject }) } })
  const pending = state.toggleMember(chat.characters[2])
  await state.toggleMember(chat.characters[2])
  assert.equal(calls, 1)
  assert.equal(chat.characters[2].folder_id, 10)
  rejectMove(new Error('network unavailable'))
  await pending
  assert.equal(chat.characters[2].folder_id, 20)
  assert.equal(state.busy.value, false)
  assert.equal(toasts[0][1], 'error')
})

test('deleting a folder clears only its members and notifies the active page filter', async t => {
  const { state, chat, events, store } = fixture(t)
  await state.deleteFolder()
  await Vue.nextTick()
  assert.deepEqual(chat.characters.map(character => character.folder_id), [null, null, 20])
  assert.deepEqual(store.folders.map(folder => folder.id), [20])
  assert.equal(state.selectedId.value, 20)
  assert.deepEqual(events, [['deleted', 10]])
})

test('creation selects the new folder and rename preserves its members', async t => {
  const { state, chat, store } = fixture(t)
  await state.startEditor()
  state.name.value = '  星穹铁道  '
  await state.saveFolder()
  assert.equal(state.selectedId.value, 30)
  assert.equal(store.folders[2].name, '星穹铁道')
  await state.toggleMember(chat.characters[1])
  await state.startEditor(store.folders[2])
  state.name.value = '列车组'
  await state.saveFolder()
  assert.equal(chat.characters[1].folder_id, 30)
  assert.equal(state.categoryName(30), '列车组')
})

test('search includes characters in other categories and reopening follows the page filter', async t => {
  const { state, props } = fixture(t)
  state.search.value = '  CAR  '
  assert.deepEqual(state.filteredCharacters.value.map(character => character.id), [3])
  props.initialFolderId = 20
  props.modelValue = true
  await Vue.nextTick()
  assert.equal(state.search.value, '')
  assert.equal(state.selectedId.value, 20)
})
