<template>
  <!-- 点击整条评论 → 针对它回复（谁发的评论谁来回评） -->
  <div
    class="comment-item"
    :class="{ 'is-character': isPostAuthor, 'is-clickable': true }"
    role="button"
    tabindex="0"
    :aria-label="`回复 ${authorName} 的评论`"
    @click="$emit('reply', comment)"
    @keydown.enter.prevent="$emit('reply', comment)"
    @keydown.space.prevent="$emit('reply', comment)"
  >
    <!-- 评论人头像：角色取 char_avatar_path，用户取本地用户头像；都缺失时回退首字 -->
    <div class="comment-avatar" :class="{ 'is-user': isUser }" :style="avatarStyle">
      <img v-if="showImg" :src="avatarPath" alt="" @error="imgFailed = true" />
      <span v-else>{{ fallbackText }}</span>
    </div>

    <div class="comment-body">
      <template v-if="comment.author_type === 'character'">
        <span class="comment-char-name">{{ comment.char_display_name || post.display_name }}</span>
        <template v-if="comment.auto_trigger && !comment.reply_to_name">
          <!-- AI 互动首轮评论：无需"回复"前缀 -->
        </template>
        <template v-else>
          <!-- X 回复 Y：Y 的名字前也带小头像 -->
          <span class="comment-reply-to"> 回复 </span>
          <span class="comment-reply-to-name">
            <span class="comment-mini-avatar" :style="replyAvatarStyle">
              <img v-if="showReplyImg" :src="replyAvatarPath" alt="" @error="replyImgFailed = true" />
              <span v-else>{{ replyInitial }}</span>
            </span>
            <span class="comment-user-name">{{ replyName }}</span>
          </span>
        </template>
      </template>
      <template v-else>
        <span class="comment-user-name">{{ userNickname || '我' }}</span>
        <template v-if="comment.reply_to_name || comment.reply_to_comment_id">
          <!-- 用户楼中楼回复：同样带「回复 X」前缀 -->
          <span class="comment-reply-to"> 回复 </span>
          <span class="comment-reply-to-name">
            <span class="comment-mini-avatar" :style="replyAvatarStyle">
              <img v-if="showReplyImg" :src="replyAvatarPath" alt="" @error="replyImgFailed = true" />
              <span v-else>{{ replyInitial }}</span>
            </span>
            <span class="comment-user-name">{{ replyName }}</span>
          </span>
        </template>
      </template>
      <span>：</span>
      <span class="comment-content">{{ comment.content }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { userAvatar, userNickname } from '../userConfig.js'

const props = defineProps({
  comment: { type: Object, required: true },
  post: { type: Object, required: true },
})

defineEmits(['reply'])

const imgFailed = ref(false)
const replyImgFailed = ref(false)

const isUser = computed(() => props.comment.author_type !== 'character')
const isPostAuthor = computed(() => (
  props.comment.author_type === 'character' && props.comment.author_id === props.post.character_id
))

// 评论人名字（用于 aria 与点击回复语义）
const authorName = computed(() => (
  isUser.value ? (userNickname.value || '我') : (props.comment.char_display_name || props.post.display_name || 'ta')
))

// ── 评论人（X）头像 ──
const avatarPath = computed(() => (
  isUser.value ? (userAvatar.value || '') : (props.comment.char_avatar_path || '')
))
const showImg = computed(() => !!avatarPath.value && !imgFailed.value)

const fallbackText = computed(() => {
  if (isUser.value) return '我'
  const name = props.comment.char_display_name || props.post.display_name || ''
  return name.charAt(0) || '?'
})

// ── 被回复人（Y）头像 ──
// reply_to_author_type 由后端给出（'character' | 'user'）；缺字段时按「有名字=角色，无名字=回退用户昵称」判断
const replyName = computed(() => props.comment.reply_to_name || userNickname.value || '我')
const replyIsUser = computed(() => {
  const type = props.comment.reply_to_author_type
  if (type) return type === 'user'
  // 兼容没有 author_type 的旧数据：有名字按角色算，完全没名字才回退成用户
  return !props.comment.reply_to_name
})
const replyAvatarPath = computed(() => (
  replyIsUser.value ? (userAvatar.value || '') : (props.comment.reply_to_avatar_path || '')
))
const showReplyImg = computed(() => !!replyAvatarPath.value && !replyImgFailed.value)
const replyInitial = computed(() => (
  replyIsUser.value ? '我' : (replyName.value.charAt(0) || '?')
))

// 评论复用同一个组件实例时（如评论数组 splice 替换）重置图片错误态
watch(avatarPath, () => { imgFailed.value = false })
watch(replyAvatarPath, () => { replyImgFailed.value = false })
watch(() => props.comment, () => {
  imgFailed.value = false
  replyImgFailed.value = false
})

const avatarStyle = computed(() => (
  showImg.value
    ? { backgroundImage: `url(${avatarPath.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
))
const replyAvatarStyle = computed(() => (
  showReplyImg.value
    ? { backgroundImage: `url(${replyAvatarPath.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
))
</script>

<style scoped>
.comment-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.45);
  font-size: 13px; line-height: 1.6;
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
  user-select: none;
}
.comment-item:hover { background: rgba(var(--accent-rgb), 0.1); }
.comment-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.comment-item.is-character {
  background: rgba(var(--accent-rgb), 0.06);
  border: 1px solid rgba(var(--accent-rgb), 0.12);
}

.comment-avatar {
  width: 26px; height: 26px; border-radius: 50%;
  flex-shrink: 0;
  margin-top: 1px;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  color: #fff; font-size: 12px; font-weight: 600;
  user-select: none;
}
.comment-avatar img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.comment-avatar.is-user {
  box-shadow: 0 0 0 1.5px rgba(var(--accent-rgb), 0.35);
}

.comment-body {
  flex: 1; min-width: 0;
  word-break: break-word;
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

/* 「回复」后的被回复人名：名字前带 18px 小头像，整体行内对齐 */
.comment-reply-to-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
}
.comment-mini-avatar {
  width: 18px; height: 18px; border-radius: 50%;
  flex-shrink: 0;
  background: var(--accent);
  display: inline-flex; align-items: center; justify-content: center;
  overflow: hidden;
  color: #fff; font-size: 10px; font-weight: 600;
  user-select: none;
}
.comment-mini-avatar img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
</style>
