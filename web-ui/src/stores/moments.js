import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
// unifiedStream 不依赖 moments store，无循环依赖；统一静态导入（消除构建警告）
import { onEvent as onStreamEvent } from './unifiedStream.js'

const PAGE_SIZE = 20

export const useMomentsStore = defineStore('moments', () => {
  const posts = ref([])           // 全量帖子数据
  const loading = ref(false)
  const page = ref(0)             // 当前渲染到第几批（0-based）
  const filterCharacterId = ref(null)  // null = 全部
  const filterLiked = ref(false)        // 是否只显示赞过的

  // ── 红点通知状态 ──
  const newPostCount = ref(0)
  const isViewingMoments = ref(false)   // 用户当前是否在朋友圈页面

  // ── 滚动到顶部信号 ──
  const scrollToTopSignal = ref(0)
  function requestScrollToTop() {
    scrollToTopSignal.value++
  }

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
      // 保留已有帖子的运行时状态：页面切换回来时，_comments / liked 不会因对象替换而丢失
      const prevMap = new Map(posts.value.map(p => [p.id, p]))
      posts.value = (data.posts || []).map(p => {
        const prev = prevMap.get(p.id)
        if (prev) {
          if (prev._comments) p._comments = prev._comments
          if (prev.liked !== undefined) p.liked = prev.liked
        }
        return p
      })
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
  // 注意：组件侧（MomentCard）已做乐观更新 + 数组操作，store 只负责 comment_count 统计
  async function addComment(postId, content) {
    const result = await api.commentMoment(postId, content)
    const post = posts.value.find(p => p.id === postId)
    if (post) {
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

  // ── 未读计数：统一 SSE 订阅 + poll timer 兜底 ──
  let _sseStarted = false
  let _unsubNewPost = null
  let _unsubNewComment = null

  /** 从 DB 拉取最新未读计数（唯一数据源） */
  async function refreshUnreadCount() {
    try {
      const { count } = await api.getMomentsUnread()
      newPostCount.value = count || 0
    } catch { /* 非关键 */ }
  }

  /** 连接统一 SSE 推送流 + 启动 polling */
  async function connectSSE() {
    if (_sseStarted) return
    _sseStarted = true

    // 从 DB 加载初始未读计数
    await refreshUnreadCount()

    _unsubNewPost = onStreamEvent('new_post', (_post) => {
      newPostCount.value++
    })

    // 监听关系网互动产生的新评论，实时追加到帖子评论区
    _unsubNewComment = onStreamEvent('new_comment', (data) => {
      if (!data?.post_id || !data?.comment) return
      const post = posts.value.find(p => p.id === data.post_id)
      if (post) {
        if (!post._comments) post._comments = []
        // 防重复（按 id 去重）
        if (!post._comments.some(c => c.id === data.comment.id)) {
          post._comments.push(data.comment)
          post.comment_count = (post.comment_count || 0) + 1
        }
      }
    })

  }

  /** 断开 SSE 订阅 */
  function disconnectSSE() {
    _sseStarted = false
    if (_unsubNewPost) { _unsubNewPost(); _unsubNewPost = null }
    if (_unsubNewComment) { _unsubNewComment(); _unsubNewComment = null }

  }

  /** 标记已读：更新 last_moments_seen_at 为当前时间 */
  async function markSeen() {
    try { await api.markMomentsRead() } catch { /* 非关键 */ }
    newPostCount.value = 0
  }

  return { posts, visiblePosts, loading, hasMore, page, filterCharacterId, filterLiked, filteredPosts, charactersWithPosts,
    newPostCount, isViewingMoments, scrollToTopSignal, requestScrollToTop,
    loadPosts, setFilter, toggleFilterLiked, resetFilters, loadMore, addComment, loadComments, toggleLike, generatePost, deletePost,
    connectSSE, disconnectSSE, markSeen, refreshUnreadCount }
})
