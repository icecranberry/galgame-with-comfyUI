import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

const PAGE_SIZE = 20

export const useMomentsStore = defineStore('moments', () => {
  const posts = ref([])           // 全量帖子数据
  const loading = ref(false)
  const page = ref(0)             // 当前渲染到第几批（0-based）
  const filterCharacterId = ref(null)  // null = 全部
  const filterLiked = ref(false)        // 是否只显示赞过的

  // ── 红点通知状态（SSE 驱动）──
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
      .map(({ _latestPostAt, ...rest }) => rest) // 去掉内部字段
  })

  // 加载全部帖子（页面首次挂载时调用）
  async function loadPosts() {
    if (loading.value) return
    loading.value = true
    try {
      const data = await api.listMoments()
      posts.value = data.posts || []
      page.value = 1   // 首屏显示第一批
      // 自动标记为已读
      markSeen()
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
    // 更新本地数据
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
      // 插入到列表最前面
      posts.value.unshift({
        ...result,
        comment_count: 0,
        like_count: 0,
        liked: false,
      })
      // 仍在朋友圈页面 → 帖子已直接可见，抵消 SSE 刚推送的红点计数
      // 已离开朋友圈 → 保留红点，让用户知道生成已完成
      if (isViewingMoments.value) markSeen()
    }
    return result
  }

  // 删除帖子
  async function deletePost(postId) {
    await api.deleteMoment(postId)
    posts.value = posts.value.filter(p => p.id !== postId)
  }

  // ── SSE 推送 ──
  let _sseConn = null
  let _reconnectTimer = null
  let _sseStarted = false   // 同步 flag：防止重复建立 SSE

  function _onNewPost() {
    // SSE 推送始终累加计数——即使在朋友圈页面，自动生成的帖子也不自动刷新列表
    newPostCount.value++
  }

  function _createSSE() {
    if (_sseConn && !_sseConn._closed) _sseConn.close()
    _sseConn = api.connectMomentsStream(_onNewPost)
  }

  /** 连接 SSE 推送流，收到新帖时 newPostCount++；断线自动重连 */
  async function connectSSE() {
    if (_sseStarted) return
    if (_sseConn && !_sseConn._closed) return
    _sseStarted = true

    // 先从 DB 加载持久化的未读计数作为初始值
    try {
      const { count } = await api.getMomentsUnread()
      newPostCount.value = count || 0
    } catch { /* 非关键 */ }

    _createSSE()

    if (_reconnectTimer) clearInterval(_reconnectTimer)
    _reconnectTimer = setInterval(async () => {
      if (_sseConn && _sseConn._closed) {
        // 重连前同步 DB 计数（覆盖断线期间的遗漏）
        try {
          const { count } = await api.getMomentsUnread()
          newPostCount.value = count || 0
        } catch { /* 非关键 */ }
        _createSSE()
      }
    }, 15000)
  }

  /** 断开 SSE */
  function disconnectSSE() {
    _sseStarted = false
    if (_reconnectTimer) { clearInterval(_reconnectTimer); _reconnectTimer = null }
    if (_sseConn) { _sseConn.close(); _sseConn = null }
  }

  /** 标记已读：清零本地计数 + 调 API 清零 DB 计数 */
  async function markSeen() {
    newPostCount.value = 0
    try { await api.markMomentsRead() } catch { /* 非关键 */ }
  }

  return { posts, visiblePosts, loading, hasMore, page, filterCharacterId, filterLiked, filteredPosts, charactersWithPosts,
    newPostCount, isViewingMoments,
    loadPosts, setFilter, toggleFilterLiked, resetFilters, loadMore, addComment, loadComments, toggleLike, generatePost, deletePost,
    connectSSE, disconnectSSE, markSeen }
})
