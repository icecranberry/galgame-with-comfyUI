import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

const PAGE_SIZE = 20

// 轮询未读计数间隔（ms）
const POLL_INTERVAL = 30_000

export const useMomentsStore = defineStore('moments', () => {
  const posts = ref([])           // 全量帖子数据
  const loading = ref(false)
  const page = ref(0)             // 当前渲染到第几批（0-based）
  const filterCharacterId = ref(null)  // null = 全部
  const filterLiked = ref(false)        // 是否只显示赞过的

  // ── 红点通知状态 ──
  const newPostCount = ref(0)
  const isViewingMoments = ref(false)   // 用户当前是否在朋友圈页面

  // 按角色筛选后的帖子
  const filteredPosts = computed(() => {
    let result = posts.value
    if (filterCharacterId.value !== null) {
      result = result.filter(p => p.character_id === filterCharacterId.value)
    }
    if (filterLiked.value) {
      result = result.filter(p => p.liked)
    }
    return result
  })

  // 当前可见的帖子（前 page * PAGE_SIZE 条）
  const visiblePosts = computed(() => filteredPosts.value.slice(0, page.value * PAGE_SIZE))

  const hasMore = computed(() => filteredPosts.value.length > page.value * PAGE_SIZE)

  // 有帖子的角色列表（按最新帖子时间降序）
  const charactersWithPosts = computed(() => {
    const map = new Map()
    for (const p of posts.value) {
      const id = p.character_id
      if (!id) continue
      const existing = map.get(id)
      const postTime = new Date(p.created_at || 0).getTime()
      if (!existing || postTime > existing._latestPostAt) {
        map.set(id, {
          character_id: id,
          display_name: p.display_name || '未知',
          avatar_path: p.avatar_path || '',
          avatar_color: p.avatar_color || '#e07b6c',
          _latestPostAt: postTime,
        })
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b._latestPostAt - a._latestPostAt)
      .map(({ _latestPostAt, ...rest }) => rest)
  })

  // 加载全部帖子（页面首次挂载时调用）
  async function loadPosts() {
    if (loading.value) return
    loading.value = true
    try {
      const data = await api.listMoments()
      posts.value = data.posts || []
      page.value = 1
      await markSeen()
    } catch (err) {
      console.error('[moments] loadPosts error:', err)
    } finally {
      loading.value = false
    }
  }

  // 设置筛选角色（null = 全部）
  function setFilter(id) {
    filterCharacterId.value = id
    page.value = 1
  }

  // 切换「赞过」筛选
  function toggleFilterLiked() {
    filterLiked.value = !filterLiked.value
    page.value = 1
  }

  // 重置所有筛选条件（进入页面时调用）
  function resetFilters() {
    filterCharacterId.value = null
    filterLiked.value = false
    page.value = 1
  }

  // 加载更多（滚动到底部 → 前端 slice 多展示一批，无网络请求）
  function loadMore() {
    if (!hasMore.value) return
    page.value++
  }

  // 发评论 → 返回 { comment, reply }
  async function addComment(postId, content) {
    const result = await api.commentMoment(postId, content)
    const post = posts.value.find(p => p.id === postId)
    if (post) {
      if (!post._comments) post._comments = []
      if (result.comment) post._comments.push(result.comment)
      if (result.reply) post._comments.push(result.reply)
      post.comment_count = (post.comment_count || 0) + (result.comment ? 1 : 0) + (result.reply ? 1 : 0)
    }
    return result
  }

  // 加载单个帖子的评论
  async function loadComments(postId) {
    const data = await api.getMoment(postId)
    const post = posts.value.find(p => p.id === postId)
    if (post) {
      post._comments = data.comments || []
      post.comment_count = (data.comments || []).length
    }
    return data.comments || []
  }

  // 切换点赞
  async function toggleLike(postId) {
    const { liked } = await api.likeMoment(postId)
    const post = posts.value.find(p => p.id === postId)
    if (post) {
      post.liked = liked
      post.like_count = Math.max(0, (post.like_count || 0) + (liked ? 1 : -1))
    }
    return liked
  }

  // 手动触发某角色发帖
  async function generatePost(characterId) {
    const result = await api.generateMoment(characterId)
    if (result.id) {
      posts.value.unshift({
        ...result,
        comment_count: 0,
        like_count: 0,
        liked: false,
      })
      if (isViewingMoments.value) await markSeen()
    }
    return result
  }

  // 删除帖子
  async function deletePost(postId) {
    await api.deleteMoment(postId)
    posts.value = posts.value.filter(p => p.id !== postId)
  }

  // ── 未读计数：时序方案，DB 为单一数据源 ──
  let _sseConn = null
  let _pollTimer = null
  let _sseStarted = false

  /** 从 DB 拉取最新未读计数（唯一数据源） */
  async function refreshUnreadCount() {
    try {
      const { count } = await api.getMomentsUnread()
      newPostCount.value = count || 0
    } catch { /* 非关键 */ }
  }

  /** SSE 新帖事件 → 立即触发一次 DB 轮询 */
  function _onNewPost(_post) {
    refreshUnreadCount()
  }

  function _createSSE() {
    if (_sseConn && !_sseConn._closed) _sseConn.close()
    _sseConn = api.connectMomentsStream(_onNewPost)
  }

  /** SSE 断线重连定时器 */
  function _startReconnectTimer() {
    if (_pollTimer) clearInterval(_pollTimer)
    _pollTimer = setInterval(async () => {
      if (!_sseStarted) return

      // 检查 SSE 是否断线，是则重连
      if (!_sseConn || _sseConn._closed) {
        _createSSE()
      }

      // 每次 tick 都从 DB 刷新真实计数（单一数据源）
      await refreshUnreadCount()
    }, POLL_INTERVAL)
  }

  /** 连接 SSE 推送流 + 启动轮询 */
  async function connectSSE() {
    if (_sseStarted) return
    _sseStarted = true

    // 从 DB 加载初始未读计数
    await refreshUnreadCount()

    _createSSE()
    _startReconnectTimer()
  }

  /** 断开 SSE + 停止轮询 */
  function disconnectSSE() {
    _sseStarted = false
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
    if (_sseConn) { _sseConn.close(); _sseConn = null }
  }

  /** 标记已读：更新 last_moments_seen_at 为当前时间 */
  async function markSeen() {
    try { await api.markMomentsRead() } catch { /* 非关键 */ }
    newPostCount.value = 0
  }

  return { posts, visiblePosts, loading, hasMore, page, filterCharacterId, filterLiked, filteredPosts, charactersWithPosts,
    newPostCount, isViewingMoments,
    loadPosts, setFilter, toggleFilterLiked, resetFilters, loadMore, addComment, loadComments, toggleLike, generatePost, deletePost,
    connectSSE, disconnectSSE, markSeen }
})
