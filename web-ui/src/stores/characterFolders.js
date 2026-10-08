/**
 * 角色文件夹 store
 *
 * 单层分类：一个角色只属于一个文件夹，`folder_id` 为 null 表示「未分类」。
 *
 * 为什么收在 store 而不是各自 fetch：左侧会话栏（Sidebar）和酒馆页（TavernView）
 * 是同屏可见的，在酒馆页把角色挪进文件夹，侧栏的分组要立刻跟着变 —— 两边共用
 * 同一份 folders 与计数，才能天然同步，也省掉重复请求。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'

/** 未分类分组在前端的统一 key（后端对应 folder_id = null） */
export const UNCATEGORIZED_KEY = 'uncategorized'

/** 单个文件夹分组的 key（与未分类区分开） */
export function folderGroupKey(folderId) {
  return `f${folderId}`
}

export const useCharacterFoldersStore = defineStore('characterFolders', () => {
  const folders = ref([])
  const uncategorizedCount = ref(0)
  /** 接口就绪前不渲染分组 UI，避免后端未更新时出现半坏状态 */
  const ready = ref(false)

  let inflight = null

  /** 拉取文件夹列表（含各组成员数）；并发调用合并成一次请求 */
  function load() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const data = await api.listCharacterFolders()
        folders.value = data.folders || []
        uncategorizedCount.value = data.uncategorized || 0
        ready.value = true
      } catch {
        // 接口不可用（例如后端还是旧版本）时保持上一次状态，列表退化为平铺
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  /** 把角色移入文件夹（folderId 传 null = 移回未分类），成功后刷新计数 */
  async function moveCharacter(characterId, folderId) {
    await api.moveCharacterToFolder(characterId, folderId)
    await load()
  }

  async function createFolder(name) {
    const created = await api.createCharacterFolder(name)
    await load()
    return created
  }

  async function renameFolder(id, name) {
    await api.renameCharacterFolder(id, name)
    await load()
  }

  async function removeFolder(id) {
    await api.deleteCharacterFolder(id)
    await load()
  }

  /**
   * 拖拽重排文件夹。
   * 先乐观更新本地顺序（拖完立刻见效果），失败再回滚 —— 顺序是纯观感数据，
   * 没必要等接口回来才动。ids 之外没提到的文件夹保留在末尾，避免界面凭空丢项。
   */
  async function reorderFolders(ids) {
    const prev = folders.value
    const byId = new Map(prev.map(f => [f.id, f]))
    const next = ids.map(id => byId.get(id)).filter(Boolean)
    for (const f of prev) if (!ids.includes(f.id)) next.push(f)
    folders.value = next
    try {
      await api.reorderCharacterFolders(ids)
    } catch (err) {
      folders.value = prev      // 回滚，避免本地顺序与库里不一致
      throw err
    }
  }

  return {
    folders, uncategorizedCount, ready,
    load, moveCharacter, createFolder, renameFolder, removeFolder, reorderFolders,
  }
})

/**
 * 按文件夹把角色分组，供侧栏渲染。
 * 返回 `[{ key, id, name, characters }]`；「未分类」永远排最后，空文件夹也保留
 * （分类体系本身要完整，哪怕某组暂时是空的）。
 */
export function groupCharactersByFolder(characters, folders) {
  const groups = folders.map(f => ({
    key: folderGroupKey(f.id),
    id: f.id,
    name: f.name,
    characters: characters.filter(c => c.folder_id === f.id),
  }))
  const uncategorized = characters.filter(c => !c.folder_id)
  if (uncategorized.length) {
    groups.push({ key: UNCATEGORIZED_KEY, id: null, name: '未分类', characters: uncategorized })
  }
  return groups
}
