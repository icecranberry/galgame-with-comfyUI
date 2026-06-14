import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'

export const useMomentsStore = defineStore('moments', () => {
  const posts = ref([])
  const loading = ref(false)
  const hasMore = ref(true)

  // 加载帖子（refresh=true 从头加载）
  async function loadPosts({ refresh } = {}) {
    if (loading.value) return
    loading.value = true
    try {
      if (refresh) {
        posts.value = []
        hasMore.value = true
      }
      const data = await api.listMoments({ limit: 20 })
      posts.value = data.posts || []
      hasMore.value = !!data.hasMore
    } catch (err) {
      console.error('[moments] loadPosts error:', err)
    } finally {
      loading.value = false
    }
  }

  // 加载更多（滚动到底部）
  async function loadMore() {
    if (loading.value || !hasMore.value || posts.value.length === 0) return
    loading.value = true
    try {
      const oldest = posts.value[posts.value.length - 1]
      const data = await api.listMoments({ limit: 20, before: oldest.id })
      const newPosts = data.posts || []
      if (newPosts.length > 0) {
        posts.value.push(...newPosts)
      }
      hasMore.value = !!data.hasMore
    } catch (err) {
      console.error('[moments] loadMore error:', err)
    } finally {
      loading.value = false
    }
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

  return { posts, loading, hasMore, loadPosts, loadMore, addComment, loadComments, toggleLike, generatePost, deletePost }
})
