import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

const PAGE_SIZE = 20

export const useMomentsStore = defineStore('moments', () => {
  const posts = ref([])           // 全量帖子数据
  const loading = ref(false)
  const page = ref(0)             // 当前渲染到第几批（0-based）

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

  return { posts, visiblePosts, loading, hasMore, page,
    loadPosts, loadMore, addComment, loadComments, toggleLike, generatePost, deletePost }
})
