import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useNewspaperFeed } from '../src/composables/useNewspaperFeed.js'

function fixture(count = 13) {
  let editions = Array.from({ length: count }, (_, i) => ({
    publish_date: `2026-10-${String(count - i).padStart(2, '0')}`,
    edition: count - i,
  }))
  const requested = []
  const client = {
    listNewspaperEditions: async () => ({ editions }),
    getNewspaperByDate: async date => {
      requested.push(date)
      return { newspaper: editions.find(e => e.publish_date === date) }
    },
  }
  return { client, requested, setEditions: value => { editions = value } }
}

test('首批只取五期，后续每批五期，最后不足五期后停止请求', async () => {
  const { client, requested } = fixture()
  const feed = useNewspaperFeed(client)
  await feed.loadMore()
  assert.equal(requested.length, 5)
  assert.deepEqual(feed.papers.value.map(p => p.edition), [13, 12, 11, 10, 9])
  await feed.loadMore()
  assert.equal(feed.papers.value.length, 10)
  await feed.loadMore()
  assert.equal(feed.papers.value.length, 13)
  assert.equal(feed.hasMore.value, false)
  await feed.loadMore()
  assert.equal(requested.length, 13)
})

test('同一批不重复请求；局部失败后重试不跳过任何一期', async () => {
  const { client } = fixture()
  const feed = useNewspaperFeed(client)
  await feed.loadMore()
  const get = client.getNewspaperByDate
  let rejectPage
  let calls = 0
  client.getNewspaperByDate = () => {
    calls++
    return new Promise((resolve, reject) => { rejectPage = reject })
  }
  const loading = feed.loadMore()
  await feed.loadMore()
  assert.equal(calls, 5)
  rejectPage(new Error('断线'))
  await loading
  assert.equal(feed.papers.value.length, 5)
  assert.equal(feed.error.value, '断线')
  client.getNewspaperByDate = get
  await feed.loadMore()
  assert.deepEqual(feed.papers.value.map(p => p.edition), [13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
  assert.equal(feed.error.value, '')
})

test('刷新保留已加载的范围，并移除已删除期次', async () => {
  const { client, setEditions } = fixture()
  const feed = useNewspaperFeed(client)
  await feed.loadMore()
  await feed.loadMore()
  setEditions([{ publish_date: '2026-10-14', edition: 14 },
    ...feed.papers.value.filter(p => p.edition !== 12)])
  await feed.refresh()
  assert.equal(feed.papers.value.length, 10)
  assert.equal(feed.papers.value[0].edition, 14)
  assert.equal(feed.papers.value.some(p => p.edition === 12), false)
})

test('空目录不请求正文；卸载后的迟到响应不写回列表', async () => {
  const { client, requested } = fixture(0)
  const emptyFeed = useNewspaperFeed(client)
  await emptyFeed.loadMore()
  assert.equal(emptyFeed.empty.value, true)
  assert.equal(emptyFeed.hasMore.value, false)
  assert.equal(requested.length, 0)

  let resolveDirectory
  client.listNewspaperEditions = () => new Promise(resolve => { resolveDirectory = resolve })
  const feed = useNewspaperFeed(client)
  const pending = feed.loadMore()
  feed.dispose()
  resolveDirectory({ editions: [] })
  await pending
  assert.equal(feed.initialized.value, false)
})
