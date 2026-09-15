import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getAppVersion } from '../api/index.js'
import { checkForUpdate, getSeenVersion, markUpdateSeen, shouldNotify } from '../utils/githubUpdate.js'

/**
 * 版本更新状态：系统设置页「有更新噢」标签与侧边栏设置项红点共用同一份数据。
 *
 * 分两步：本地版本问后端（GET /api/version，读仓库根目录 VERSION，只读本地文件），
 * 远端 tag 由浏览器直连 GitHub 拉（不是后端 Node 转发）—— 后端的 Node 进程常常
 * 连不上 github，浏览器走的是用户自己的代理 / 系统设置，通常能通。
 * 一次会话只查一次（utils 里另有 30 分钟缓存）；失败静默 —— 离线、代理不通时
 * 不该反复弹错，只是不显示标签而已。
 *
 * 提醒只出现一次：hasUpdate 同时要求「远端有更高的 tag」和「这个版本没被看过」，
 * 用户在标签上停留看过之后 markSeen() 记下版本号，标签与红点一起消失；
 * 直到远端又发布比本地版本更高的新 tag 才再次提醒。
 */
export const useUpdateStore = defineStore('updateInfo', () => {
  const info = ref(null)
  const loading = ref(false)
  const failed = ref(false)
  const seen = ref(getSeenVersion())
  let inflight = null

  const hasUpdate = computed(() => shouldNotify(info.value, seen.value))

  /** 记下当前远端版本已读：调用方是设置页的「有更新噢」标签 */
  function markSeen() {
    if (info.value?.latest) seen.value = markUpdateSeen(info.value.latest)
  }

  async function check({ force = false } = {}) {
    if (inflight) return inflight
    if (!force && (info.value || failed.value)) return info.value

    loading.value = true
    inflight = (async () => {
      try {
        // 先问后端「我这装的是哪版」，再拿它去比 GitHub 上的 tag
        const current = await getAppVersion()
        if (!current) throw new Error('后端没给出版本号（VERSION 文件缺失？）')
        info.value = await checkForUpdate({ force, currentVersion: current })
        failed.value = false
      } catch (err) {
        failed.value = true
        console.warn('[update] 检查更新失败：', err.message)
      } finally {
        loading.value = false
        inflight = null
      }
      return info.value
    })()
    return inflight
  }

  return { info, loading, failed, hasUpdate, check, markSeen }
})