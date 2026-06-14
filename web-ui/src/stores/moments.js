import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

const PAGE_SIZE = 20

export const useMomentsStore = defineStore('moments', () => {
  const posts = ref([])           // 全量帖子数据
  const loading = ref(false)
  const page = ref(0)             // 当前渲染到第几批（0-based）

  // ── 红点通知状态（SSE 驱动）──
  const newPostCount = ref(0)
  const isViewingMoments = ref(false)   // 用户当前是否在朋友圈页面

  // 当前可见的帖子（前 page * PAGE_SIZE 条）
  const visiblePosts = computed(() => posts.value.slice(0, page.value * PAGE_SIZE))

  const hasMore = computed(() => posts.value.length > page.value * PAGE_SIZE)

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

  function _onNewPost() {
    // 用户正在朋友圈页面时，不需要红点（帖子会直接出现在列表中）
    if (isViewingMoments.value) return
    newPostCount.value++
  }

  function _createSSE() {
    _sseConn = api.connectMomentsStream(_onNewPost)
  }

  /** 连接 SSE 推送流，收到新帖时 newPostCount++；断线自动重连 */
  function connectSSE() {
    if (_sseConn && !_sseConn._closed) return
    _createSSE()

    if (_reconnectTimer) clearInterval(_reconnectTimer)
    _reconnectTimer = setInterval(() => {
      if (_sseConn && _sseConn._closed) {
        _createSSE()
      }
    }, 15000)
  }

  /** 断开 SSE */
  function disconnectSSE() {
    if (_reconnectTimer) { clearInterval(_reconnectTimer); _reconnectTimer = null }
    if (_sseConn) { _sseConn.close(); _sseConn = null }
  }

  /** 标记已读：newPostCount 归零 */
  function markSeen() {
    newPostCount.value = 0
  }

  return { posts, visiblePosts, loading, hasMore, page,
    newPostCount, isViewingMoments,
    loadPosts, loadMore, addComment, loadComments, toggleLike, generatePost, deletePost,
    connectSSE, disconnectSSE, markSeen }
})
