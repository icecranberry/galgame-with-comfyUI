import { computed, ref } from 'vue'
import * as api from '../api/index.js'

const PAGE_SIZE = 5

/** 复用轻量期次目录，正文和配图信息每次只取五期。失败时保留游标，重试不漏期。 */
export function useNewspaperFeed(client = api) {
  const papers = ref([])
  const loading = ref(false)
  const error = ref('')
  const initialized = ref(false)
  const hasMore = ref(true)
  let editions = []
  let cursor = 0
  let generation = 0

  async function load(refresh = false) {
    if (loading.value || (!refresh && !hasMore.value)) return
    const requestGeneration = generation
    loading.value = true
    error.value = ''
    try {
      const reload = refresh || !initialized.value
      const directory = reload
        ? (await client.listNewspaperEditions()).editions || []
        : editions
      const start = reload ? 0 : cursor
      const count = refresh ? Math.max(PAGE_SIZE, cursor) : PAGE_SIZE
      const batch = directory.slice(start, start + count)
      const results = await Promise.all(batch.map(async (edition) => {
        const result = await client.getNewspaperByDate(edition.publish_date)
        return result?.newspaper || null
      }))
      if (requestGeneration !== generation) return
      editions = directory
      cursor = start + batch.length
      const merged = [...(reload ? [] : papers.value), ...results.filter(Boolean)]
      papers.value = [...new Map(merged.map(p => [p.publish_date, p])).values()]
      hasMore.value = cursor < editions.length
      initialized.value = true
    } catch (err) {
      if (requestGeneration === generation) error.value = err.message || '报纸加载失败，请重试'
    } finally {
      if (requestGeneration === generation) loading.value = false
    }
  }

  return {
    papers, loading, error, initialized, hasMore,
    empty: computed(() => initialized.value && !papers.value.length),
    loadMore: () => load(),
    refresh: () => load(true),
    dispose: () => { generation++ },
  }
}
