<template>
  <div class="moment-card">
    <!-- 头部：角色信息 -->
    <div class="moment-header">
      <div
        class="moment-avatar"
        :style="avatarStyle"
      ><span v-if="!post.avatar_path">{{ post.display_name?.charAt(0) }}</span></div>
      <div class="moment-header-info">
        <span class="moment-name">{{ post.display_name }}</span>
        <span class="moment-time">{{ formatTime(post.created_at) }}</span>
      </div>
      <!-- ⋮ 菜单按钮 -->
      <div class="moment-more-wrap">
        <div class="moment-more-btn" @click.stop="showMenu = !showMenu">
          <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
            <path d="M427.976 206.117c0.728 46.398 38.94 83.429 85.337 82.701 46.406-0.717 83.438-38.928 82.71-85.326-0.726-46.407-38.927-83.438-85.334-82.71-46.41 0.728-83.43 38.928-82.713 85.335z m0 614.402c0.728 46.396 38.94 83.427 85.337 82.7 46.406-0.718 83.438-38.929 82.71-85.327-0.726-46.407-38.927-83.438-85.334-82.71-46.41 0.73-83.43 38.928-82.713 85.337z m0-307.206c0.728 46.407 38.94 83.438 85.337 82.71 46.406-0.73 83.438-38.927 82.71-85.336-0.726-46.396-38.927-83.428-85.334-82.71-46.41 0.73-83.43 38.929-82.713 85.336z" />
          </svg>
        </div>
        <Transition name="menu-pop">
          <div v-if="showMenu" class="moment-dropdown">
            <button class="moment-dropdown-item danger" @click.stop="onDelete">🗑️ 删除</button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 正文 -->
    <div class="moment-content">{{ post.content }}</div>

    <!-- 配图 -->
    <div v-if="post.images?.length > 0" class="moment-images" :class="{ 'single': post.images.length === 1 }">
      <img
        v-for="(img, i) in post.images"
        :key="i"
        :src="img"
        class="moment-img"
        @click="$emit('preview', { images: post.images, index: i })"
        loading="lazy"
        alt="朋友圈配图"
      />
    </div>

    <!-- 底部操作栏 -->
    <div class="moment-actions">
      <button class="action-btn" :class="{ active: post.liked }" @click="onLike">
        <svg viewBox="0 0 24 24" width="18" height="18" :fill="post.liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <span v-if="post.like_count > 0">{{ post.like_count }}</span>
      </button>
      <button class="action-btn" :class="{ active: showReplyInput }" @click="onReplyClick">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span v-if="(post.comment_count || 0) > 0">{{ post.comment_count }}</span>
      </button>
      <button class="action-btn share-btn" @click="$emit('share', post)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>
    </div>

    <!-- 评论区域 -->
    <div v-if="comments.length > 0" class="comments-section">
      <!-- 始终可见：最早 2 条 -->
      <div class="comments-list">
        <div
          v-for="c in alwaysVisible"
          :key="c.id"
          class="comment-item"
          :class="{ 'is-character': c.author_type === 'character' }"
        >
          <template v-if="c.author_type === 'character'">
            <span class="comment-char-name">{{ c.char_display_name || post.display_name }}</span>
            <span class="comment-reply-to"> 回复 </span>
          </template>
          <span class="comment-user-name">{{ userNickname || '我' }}</span>
          <span>：</span>
          <span class="comment-content">{{ c.content }}</span>
        </div>
      </div>

      <!-- 超出部分：max-height 动画展开 -->
      <div class="expand-wrapper" :class="{ open: expanded }">
        <div v-if="hiddenCount > 0" class="comments-list">
          <div
            v-for="c in hiddenComments"
            :key="c.id"
            class="comment-item"
            :class="{ 'is-character': c.author_type === 'character' }"
          >
            <template v-if="c.author_type === 'character'">
              <span class="comment-char-name">{{ c.char_display_name || post.display_name }}</span>
              <span class="comment-reply-to"> 回复 </span>
            </template>
            <span class="comment-user-name">{{ userNickname || '我' }}</span>
            <span>：</span>
            <span class="comment-content">{{ c.content }}</span>
          </div>
        </div>
      </div>

      <!-- 展开按钮：点它 = 展开评论区 + 打开输入框 -->
      <button
        v-if="hiddenCount > 0 && !expanded"
        class="comment-expand-btn"
        @click="expandAndReply"
      >展开剩余 {{ hiddenCount }} 条评论</button>
    </div>

    <!-- 回复输入 -->
    <div class="reply-input-wrapper" :class="{ open: showReplyInput }">
      <div class="comment-input-row">
        <input
          ref="commentInput"
          v-model="commentText"
          class="comment-input"
          placeholder="写评论..."
          @keydown.enter.exact.prevent="sendComment"
          @keydown.escape.exact="closeReplyInput"
          :disabled="sending"
        />
        <button
          class="comment-send"
          :class="{ waiting: sending }"
          :disabled="!commentText.trim() || sending"
          @click="sendComment"
        >
          <template v-if="!sending">发送</template>
          <svg v-else class="waiting-dots" viewBox="0 0 24 6" width="24" height="6">
            <circle cx="3" cy="3" r="2" fill="#fff" class="wdot wdot-0"/>
            <circle cx="12" cy="3" r="2" fill="#fff" class="wdot wdot-1"/>
            <circle cx="21" cy="3" r="2" fill="#fff" class="wdot wdot-2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, inject, watch } from 'vue'
import { useMomentsStore } from '../stores/moments.js'
import { userNickname } from '../userConfig.js'

const props = defineProps({
  post: { type: Object, required: true },
})

const emit = defineEmits(['preview', 'share'])

const moments = useMomentsStore()
const isMobile = inject('isMobile')
const confirmFn = inject('confirm')

const MAX_VISIBLE = 2
const showReplyInput = ref(false)
const expanded = ref(false)
const showMenu = ref(false)
// 点击菜单外自动关闭
watch(showMenu, (v) => {
  if (v) setTimeout(() => document.addEventListener('click', closeMenuOnOutside, { once: true }))
})
function closeMenuOnOutside(e) {
  showMenu.value = false
}
const comments = ref([...(props.post._comments || [])])
const commentsLoading = ref(false)
const commentText = ref('')
const sending = ref(false)
const commentInput = ref(null)

const alwaysVisible = computed(() => comments.value.slice(0, MAX_VISIBLE))
const hiddenComments = computed(() => comments.value.slice(MAX_VISIBLE))
const hiddenCount = computed(() => Math.max(0, comments.value.length - MAX_VISIBLE))

const avatarStyle = computed(() => {
  const p = props.post
  if (p.avatar_path) return { backgroundImage: `url(${p.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return { background: '#e07b6c' }
})

// 首次加载评论
if (comments.value.length === 0) {
  commentsLoading.value = true
  moments.loadComments(props.post.id).then(c => {
    comments.value.length = 0
    comments.value.push(...c)
    commentsLoading.value = false
  })
}

// 💬 按钮：toggle——展开时同时开评论区+输入框，收起时全关
async function onReplyClick() {
  if (showReplyInput.value) {
    closeAll()
  } else {
    openAll()
  }
}

// "展开剩余 N 条" 按钮：展开 + 打开输入框
async function expandAndReply() {
  openAll()
}

async function openAll() {
  expanded.value = true
  showReplyInput.value = true
  if (!isMobile) {
    await nextTick()
    commentInput.value?.focus()
  }
}

function closeAll() {
  expanded.value = false
  showReplyInput.value = false
  commentText.value = ''
}

function closeReplyInput() {
  closeAll()
}

async function sendComment() {
  const text = commentText.value.trim()
  if (!text || sending.value) return
  sending.value = true

  const tempId = 'temp_' + Date.now()
  comments.value.push({
    id: tempId,
    author_type: 'user',
    content: text,
    created_at: new Date().toISOString(),
  })
  commentText.value = ''
  if (!isMobile) commentInput.value?.focus()

  expanded.value = true
  try {
    const result = await moments.addComment(props.post.id, text)
    const idx = comments.value.findIndex(c => c.id === tempId)
    if (idx >= 0 && result.comment) {
      comments.value.splice(idx, 1, result.comment)
    }
    if (result.reply) {
      comments.value.push(result.reply)
    }
  } catch (err) {
    console.error('[MomentCard] comment error:', err)
    comments.value = comments.value.filter(c => c.id !== tempId)
  } finally {
    sending.value = false
  }
}

async function onDelete() {
  showMenu.value = false
  const ok = await confirmFn({ title: '删除朋友圈', message: '确定要删除这条朋友圈吗？', okText: '删除', danger: true })
  if (!ok) return
  await moments.deletePost(props.post.id)
}

async function onLike() {
  await moments.toggleLike(props.post.id)
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) {
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  if (diff < 172800000) return '昨天'
  if (diff < 259200000) return '前天'
  return (d.getMonth() + 1) + '/' + d.getDate()
}
</script>

<style scoped>
.moment-card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--glass-shadow);
  transition: box-shadow 0.2s ease;
}
.moment-card:hover { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06); }

.moment-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.moment-avatar {
  width: 50px; height: 50px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; font-weight: 700; flex-shrink: 0;
}
.moment-header-info {
  display: flex; flex-direction: column; gap: 2px;
}
.moment-name {
  font-size: 15px; font-weight: 600; color: var(--text-bright);
}

/* 右上角 ⋮ 菜单 */
.moment-more-wrap { margin-left: auto; position: relative; }
.moment-more-btn {
  width: 32px; height: 32px;
  border-radius: 8px; border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.moment-more-btn:hover { background: rgba(0,0,0,0.06); color: var(--text-bright); }
.moment-dropdown {
  position: absolute; top: 100%; right: 0;
  margin-top: 4px;
  min-width: 120px;
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  overflow: hidden; z-index: 30;
}
.moment-dropdown-item {
  display: block; width: 100%;
  padding: 10px 14px;
  border: none; border-radius: 0;
  background: transparent;
  font-size: 13px; color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s;
  text-align: left;
}
.moment-dropdown-item:hover { background: rgba(0,0,0,0.05); }
.moment-dropdown-item.danger { color: var(--danger); }
.moment-dropdown-item.danger:hover { background: rgba(255,77,79,0.06); }

/* 下拉动画 */
.menu-pop-enter-active { transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); }
.menu-pop-leave-active { transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1); }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: translateY(-4px); }

.moment-time {
  font-size: 12px; color: var(--text-secondary);
}

.moment-content {
  font-size: 14px; line-height: 1.8; color: var(--text-primary);
  white-space: pre-wrap; word-break: break-word;
}

.moment-images {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
  border-radius: 12px;
  overflow: hidden;
}
.moment-images.single {
  grid-template-columns: 1fr;
}
.moment-img {
  width: 100%;
  max-height: 400px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 15px;
  transition: transform 0.2s ease;
}
.moment-img:hover { transform: scale(1.02); }

.moment-actions {
  display: flex; gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--glass-border);
}
.action-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.action-btn:hover { background: rgba(255, 255, 255, 0.28); color: var(--text-bright); }
.action-btn.active { color: var(--accent); }
.action-btn.share-btn { margin-left: auto; }

.comments-section {
  border-top: 1px solid var(--glass-border);
}
.comments-list {
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 12px;
}
.comment-item {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.45);
  font-size: 13px; line-height: 1.6;
  color: var(--text-primary);
}
.comment-item.is-character {
  background: rgba(224, 123, 108, 0.06);
  border: 1px solid rgba(224, 123, 108, 0.12);
}
.comment-char-name {
  font-size: 12px; font-weight: 600;
  color: var(--accent);
}
.comment-user-name {
  font-size: 12px; font-weight: 600;
  color: var(--text-bright);
}
.comment-reply-to {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 评论展开动画：max-height 过渡 */
.expand-wrapper {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.32s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0;
}
.expand-wrapper.open {
  max-height: 600px;
  opacity: 1;
}

.comment-expand-btn {
  display: block; width: 100%;
  padding: 6px 0; margin-top: 4px;
  border: none; border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px; cursor: pointer;
  transition: all 0.15s;
}
.comment-expand-btn:hover { color: var(--accent); background: rgba(224, 123, 108, 0.05); }

.comment-input-row {
  display: flex; gap: 8px; align-items: center;
}
.comment-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  color: var(--text-bright);
  outline: none;
  transition: border-color 0.15s;
}
.comment-input:focus { border-color: var(--accent); }
.comment-send {
  padding: 8px 16px;
  height: 36px;
  border-radius: 10px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.comment-send:hover:not(:disabled) { background: var(--accent-hover); }
.comment-send:disabled { opacity: 0.4; cursor: not-allowed; }

.reply-input-wrapper {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1),
              margin-top 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  margin-top: 0;
}
.reply-input-wrapper.open {
  max-height: 56px;
  opacity: 1;
  margin-top: 12px;
}

.waiting-dots { display: block; }
.wdot { animation: dotBounce 1.0s ease-in-out infinite; }
.wdot-1 { animation-delay: 0.15s; }
.wdot-2 { animation-delay: 0.30s; }
@keyframes dotBounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}
</style>
