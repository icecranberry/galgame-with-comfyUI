import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'
import { useChatStore } from './chat.js'
import { useEventsStore } from './events.js'
import { refreshImageUrls, recordOverwriteBust } from '../utils/imageUrlRefresh.js'

function normalizeTask(data, existing = null) {
  return {
    id: data.id,
    action: data.action || 'regenerate',
    url: data.url || '',
    status: data.status || 'running',
    previewUrl: data.previewUrl || null,
    token: data.token || '',
    progress: data.progress ?? null,
    error: data.error || '',
    createdAt: data.createdAt || Date.now(),
    characterId: data.characterId ?? existing?.characterId ?? null,
  }
}

export const useImageEditTasksStore = defineStore('imageEditTasks', () => {
  const tasks = ref([])
  let _unsubs = []
  let _connected = false

  function _upsert(data) {
    if (!data?.id) return
    const idx = tasks.value.findIndex(t => t.id === data.id)
    const item = normalizeTask(data, idx >= 0 ? tasks.value[idx] : null)
    if (idx >= 0) tasks.value.splice(idx, 1, item)
    else tasks.value.push(item)
  }

  function _remove(id) {
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx >= 0) tasks.value.splice(idx, 1)
  }

  function connect() {
    if (_connected) return
    _connected = true
    _unsubs = [
      onEvent('image_edit_task_start', _upsert),
      onEvent('image_edit_task_progress', _upsert),
      onEvent('image_edit_task_done', _upsert),
      onEvent('image_edit_task_error', _upsert),
    ]
    refresh()
  }

  function disconnect() {
    for (const un of _unsubs) un()
    _unsubs = []
    _connected = false
  }

  async function refresh() {
    try {
      const { tasks: list } = await api.listImageEditTasks()
      const prev = new Map(tasks.value.map(t => [t.id, t]))
      tasks.value = (list || []).map(d => normalizeTask(d, prev.get(d.id)))
    } catch (err) {
      console.warn('[imageEditTasks] refresh failed:', err.message)
    }
  }

  async function start(action, url, opts = {}) {
    let res
    if (action === 'standing') {
      const body = opts.prompt ? { prompt: opts.prompt } : { requirement: opts.requirement || '' }
      res = await api.generateStandingTask(opts.characterId, body)
      if (res?.task_id) {
        _upsert({
          id: res.task_id, action, url, status: 'running',
          createdAt: Date.now(), characterId: opts.characterId,
        })
      }
    } else {
      const submit = action === 'upscale' ? api.upscaleImage : api.regenerateImage
      res = await submit(url)
      if (res?.task_id) {
        _upsert({ id: res.task_id, action, url, status: 'running', createdAt: Date.now() })
      }
    }
    refresh()
    return res
  }

  async function apply(task) {
    const res = await api.applyImageEditTask(task.id, task.token)
    _remove(task.id)
    if (task.action === 'standing') {
      window.dispatchEvent(new CustomEvent('standing-overwritten', {
        detail: { characterId: task.characterId, url: res.url },
      }))
      return res
    }
    const base = (task.url || '').replace(/\?.*$/, '')
    const url = res.url || (base + '?t=' + Date.now())
    // 先登记 cache-bust：详情卡/灯箱可能已关闭（实例销毁），登记表留到下次重开时取用
    recordOverwriteBust(base, Date.now())
    window.dispatchEvent(new CustomEvent('image-overwritten', {
      detail: { url, base, action: task.action },
    }))
    useChatStore().bumpImageUrls(base, url)
    useEventsStore().bumpImageUrls(base, url)
    refreshImageUrls(base)
    return res
  }

  async function rerun(task) {
    const res = await api.rerunImageEditTask(task.id, task.token)
    _remove(task.id)
    if (res?.task_id) {
      _upsert({
        id: res.task_id, action: task.action, url: task.url, status: 'running',
        createdAt: Date.now(), characterId: task.characterId,
      })
    }
    refresh()
    return res
  }

  async function discard(task) {
    await api.discardImageEditTask(task.id, task.token)
    _remove(task.id)
  }

  return { tasks, connect, disconnect, refresh, start, apply, rerun, discard }
})
