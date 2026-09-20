<template>
  <div class="moment-card">
    <!-- 头部：作者信息（角色 / 镇民 / 用户自己） -->
    <div class="moment-header">
      <div
        class="moment-avatar avatar-wiggle"
        :class="{ 'is-user': isUserPost }"
        @click="goToChat"
      >
        <img
          v-if="headerAvatar"
          :src="headerAvatar"
          class="moment-avatar-img"
          :class="{ 'is-npc-portrait': post.author_type === 'npc' }"
          alt=""
          @error="headerAvatarFailed = true"
        />
        <span v-else>{{ headerName?.charAt(0) }}</span>
      </div>
      <div class="moment-header-info">
        <span class="moment-name">{{ headerName }}</span>
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
            <div class="moment-dropdown-item" role="button" tabindex="0" @click.stop="startEdit" @keydown.enter.prevent="startEdit" @keydown.space.prevent="startEdit">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
              编辑
            </div>
            <div class="moment-dropdown-item danger" role="button" tabindex="0" @click.stop="onDelete" @keydown.enter.prevent="onDelete" @keydown.space.prevent="onDelete">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              删除
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 正文（编辑时切换为文本域 + 保存 / 取消） -->
    <div v-if="!editing && visibleContent" class="moment-content">{{ visibleContent }}</div>
    <div v-else class="moment-edit-area">
      <linshe-input
        ref="editInput"
        v-model="editText"
        type="textarea"
        :rows="4"
        maxlength="2000"
        placeholder="编辑朋友圈文字..."
        :disabled="savingEdit"
        @keydown.escape.prevent="cancelEdit"
      />
      <div class="moment-edit-actions">
        <linshe-button variant="ghost" size="sm" :disabled="savingEdit" @click="cancelEdit">取消</linshe-button>
        <linshe-button variant="primary" size="sm" :disabled="canSaveEdit" :loading="savingEdit" @click="saveEdit">保存</linshe-button>
      </div>
    </div>

    <!-- 配图：用户纯文字帖不显示；角色帖无图给缺省遮罩（生图失败可原地补图）；单图普通卡片；多图扇形堆成一摞相片，滚轮 / 滑动 / 点左右翻看 -->
    <div v-if="visibleImages.length === 0 && !isUserPost" class="moment-images-empty">
      <div class="moment-empty-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
      <span class="moment-empty-text">图片没生成出来</span>
      <linshe-button
        v-if="canRegenerateImage"
        variant="secondary"
        size="sm"
        :loading="regenerating"
        @click="regenerateImage"
      >
        重新生成图片
      </linshe-button>
    </div>
    <div v-else-if="visibleImages.length === 1" class="moment-images">
      <img
        :src="visibleImages[0].url"
        class="moment-img"
        @click="onPreviewImg(0)"
        @error="onImgError(visibleImages[0].idx)"
        loading="lazy"
        alt="朋友圈配图"
      />
    </div>
    <div
      v-else-if="visibleImages.length > 1"
      class="moment-deck"
      :style="{ '--deck-ar': deckAspect }"
      role="group"
      tabindex="0"
      aria-label="朋友圈配图，可左右翻看"
      @keydown.left.prevent="flipDeck(-1)"
      @keydown.right.prevent="flipDeck(1)"
      @wheel="onDeckWheel"
      @touchstart.passive="onDeckTouchStart"
      @touchend="onDeckTouchEnd"
    >
      <div
        v-for="(item, i) in visibleImages"
        :key="item.idx"
        class="deck-card"
        :class="deckCardClass(i)"
        :style="deckCardStyle(i)"
        role="button"
        :tabindex="i === deckIndex ? 0 : -1"
        :aria-label="i === deckIndex ? `查看第 ${i + 1} 张配图` : `翻到第 ${i + 1} 张配图`"
        @click="onDeckCardClick(i)"
        @keydown.enter.prevent="onDeckCardClick(i)"
        @keydown.space.prevent="onDeckCardClick(i)"
      >
        <img
          :src="item.url"
          class="deck-img"
          :alt="`朋友圈配图 ${i + 1}`"
          @load="onDeckImgLoad"
          @error="onImgError(item.idx)"
          loading="lazy"
        />
      </div>

      <!-- 翻页箭头：悬停 / 键盘聚焦时才浮现，触屏走滑动翻页 -->
      <linshe-button
        variant="icon"
        size="md"
        class="deck-nav deck-nav--prev"
        aria-label="上一张"
        tabindex="-1"
        @click.stop="flipDeck(-1)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </linshe-button>
      <linshe-button
        variant="icon"
        size="md"
        class="deck-nav deck-nav--next"
        aria-label="下一张"
        tabindex="-1"
        @click.stop="flipDeck(1)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </linshe-button>

      <div class="deck-counter">{{ deckIndex + 1 }} / {{ visibleImages.length }}</div>
    </div>

    <!-- 底部操作栏 -->
    <div class="moment-actions">
      <div class="action-btn like-btn" :class="{ active: post.liked, 'like-burst': likeBursting }" role="button" tabindex="0" @click="onLike" @keydown.enter.prevent="onLike" @keydown.space.prevent="onLike">
        <svg viewBox="0 0 24 24" width="18" height="18" :fill="post.liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <!-- <span v-if="post.like_count > 0">{{ post.like_count }}</span> -->
      </div>
      <div class="action-btn" :class="{ active: showReplyInput }" role="button" tabindex="0" @click="onReplyClick" @keydown.enter.prevent="onReplyClick" @keydown.space.prevent="onReplyClick">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span v-if="(post.comment_count || 0) > 0">{{ post.comment_count }}</span>
      </div>
      <div class="action-btn share-btn" role="button" tabindex="0" @click="onShare" @keydown.enter.prevent="onShare" @keydown.space.prevent="onShare">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </div>
    </div>

    <!-- 评论区域：点某条评论可针对它回复（被回复的作者会回评），输入 @ 可点名角色 -->
    <div v-if="comments.length > 0" class="comments-section">
      <!-- 始终可见：最早 2 条 -->
      <div class="comments-list">
        <div v-for="group in visibleThreads" :key="group.comment.id" class="comment-group">
          <moment-comment-item :comment="group.comment" :post="post" @reply="onReplyToComment" />
          <div v-if="group.replies.length > 0" class="comment-replies">
            <moment-comment-item
              v-for="reply in group.replies"
              :key="reply.id"
              :comment="reply"
              :post="post"
              @reply="onReplyToComment"
            />
          </div>
        </div>
      </div>

      <!-- 超出部分：max-height 动画展开 -->
      <div class="expand-wrapper" :class="{ open: expanded }">
        <div v-if="hiddenCount > 0" class="comments-list">
          <div v-for="group in hiddenThreads" :key="group.comment.id" class="comment-group">
            <moment-comment-item :comment="group.comment" :post="post" @reply="onReplyToComment" />
            <div v-if="group.replies.length > 0" class="comment-replies">
              <moment-comment-item
                v-for="reply in group.replies"
                :key="reply.id"
                :comment="reply"
                :post="post"
                @reply="onReplyToComment"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 展开按钮：点它 = 展开评论区 + 打开输入框 -->
      <div
        v-if="hiddenCount > 0 && !expanded"
        class="comment-expand-btn"
        role="button"
        tabindex="0"
        @click="expandAndReply"
        @keydown.enter.prevent="expandAndReply"
        @keydown.space.prevent="expandAndReply"
      >展开剩余 {{ hiddenCount }} 条评论</div>
    </div>

    <!-- 回复输入：楼中楼回复时顶部显示目标；@ 按钮或手打 @ 唤起角色点名面板 -->
    <div class="reply-input-wrapper" :class="{ open: showReplyInput, 'mention-open': mentionOpen }">
      <div v-if="replyTarget" class="reply-target-chip">
        <span class="chip-label">回复 {{ replyTargetName }}</span>
        <div
          class="chip-cancel"
          role="button"
          tabindex="0"
          aria-label="取消回复"
          @click="clearReplyTarget"
          @keydown.enter.prevent="clearReplyTarget"
          @keydown.space.prevent="clearReplyTarget"
        >
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </div>
      </div>
      <div class="comment-input-row">
        <linshe-button
          variant="icon"
          size="md"
          class="comment-mention-btn"
          aria-label="点名角色"
          title="点名角色"
          :disabled="sending"
          @click="onMentionButton"
        >
          @
        </linshe-button>
        <linshe-input
          ref="commentInput"
          v-model="commentText"
          class="comment-input"
          :placeholder="replyTarget ? `回复 ${replyTargetName}...` : '写评论...'"
          @keydown.enter.exact.prevent="onEnterKey"
          @keydown.up.exact.prevent="mentionOpen && mention.move(-1)"
          @keydown.down.exact.prevent="mentionOpen && mention.move(1)"
          @keydown.escape.exact="onEscapeKey"
          :disabled="sending"
        />
        <linshe-button
          variant="primary"
          size="sm"
          class="comment-send"
          :disabled="!commentText.trim()"
          :loading="sending"
          @click="sendComment"
        >
          <template v-if="!sending">发送</template>
        </linshe-button>
      </div>

      <!-- @ 点名候选面板：锚在输入框上方 -->
      <div v-if="mentionOpen" class="mention-panel" role="listbox" aria-label="选择要点名的角色">
        <div
          v-for="(opt, i) in mention.options.value"
          :key="opt.key"
          class="mention-option"
          :class="{ active: i === mention.index.value }"
          role="option"
          :aria-selected="i === mention.index.value"
          @mousedown.prevent="applyMentionOption(opt)"
          @mousemove="mention.index.value = i"
        >
          <div class="mention-avatar" :style="opt.avatar_path ? { backgroundImage: `url(${opt.avatar_path})`, backgroundSize: 'cover', backgroundPosition: 'center top' } : {}">
            <span v-if="!opt.avatar_path">{{ opt.display_name?.charAt(0) || '?' }}</span>
          </div>
          <span class="mention-name">{{ opt.display_name }}</span>
        </div>
        <div v-if="mention.options.value.length === 0" class="mention-empty">没有匹配的角色</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, inject, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMomentsStore } from '../stores/moments.js'
import { useChatStore } from '../stores/chat.js'
import { userAvatar, userNickname } from '../userConfig.js'
import { useMentionPicker, applyMention as applyMentionText } from '../composables/useMentionPicker.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import MomentCommentItem from './MomentCommentItem.vue'
import { groupMomentComments } from '../utils/momentComments.js'
import { extractMomentImageRequest, stripMomentImageRequest, appendMomentImageRequest } from '../utils/momentImageRequest.js'

const props = defineProps({
  post: { type: Object, required: true },
})

const emit = defineEmits(['preview', 'share'])

const router = useRouter()
const moments = useMomentsStore()
const chat = useChatStore()
const isMobile = inject('isMobile')
const confirmFn = inject('confirm')
const toastFn = inject('toast', null)

const MAX_VISIBLE = 2
const showReplyInput = ref(false)
const expanded = ref(true)
const showMenu = ref(false)
const imgErrors = reactive(new Set())

// ── 作者展示：角色 / 镇民取 DB 字段，用户帖取本地用户配置 ──
const isUserPost = computed(() => props.post.author_type === 'user')
const headerAvatarFailed = ref(false)
const headerAvatar = computed(() => {
  if (props.post.avatar_path) return props.post.avatar_path
  if (isUserPost.value && !headerAvatarFailed.value) return userAvatar.value || ''
  return ''
})
const headerName = computed(() => (
  props.post.display_name || (isUserPost.value ? (userNickname.value || '我') : '')
))
// 点击菜单外自动关闭
watch(showMenu, (v) => {
  if (v) setTimeout(() => document.addEventListener('click', closeMenuOnOutside, { once: true }))
})
function closeMenuOnOutside(e) {
  showMenu.value = false
}

function goToChat() {
  if (props.post.character_id) {
    router.push('/chat/' + props.post.character_id)
  }
}
const comments = computed(() => props.post._comments || [])
const visibleContent = computed(() => stripMomentImageRequest(props.post.content || ''))
const commentsLoading = ref(false)
const commentText = ref('')
const sending = ref(false)
const commentInput = ref(null)

// ── 楼中楼回复目标：点某条评论后，输入框针对该评论 ──
const replyTarget = ref(null)
const replyTargetName = computed(() => {
  const t = replyTarget.value
  if (!t) return ''
  if (t.author_type === 'character') return t.char_display_name || props.post.display_name || 'ta'
  return userNickname.value || '我'
})

function onReplyToComment(comment) {
  if (!comment) return
  // 点自己（用户）的评论不再嵌套指定目标，回复帖主/评论区的上下文由后端兜底
  replyTarget.value = comment
  openAll()
}

function clearReplyTarget() {
  replyTarget.value = null
  if (!isMobile) commentInput.value?.focus()
}

// ── @ 点名：输入末尾「@过滤词」时唤起候选面板（朋友圈不提供 @全体）──
const mention = useMentionPicker(() => chat.characters, { includeAll: false })
const mentionOpen = computed(() => mention.open.value)
watch(commentText, (t) => { mention.sync(t) })

function applyMentionOption(opt) {
  if (!opt || opt.isAll) return
  commentText.value = applyMentionText(commentText.value, opt.display_name)
  mention.close()
  if (!isMobile) commentInput.value?.focus()
}

// @ 按钮：在输入末尾补一个「@」唤起点名面板；已有「@过滤词」时只重开面板不重复追加
function onMentionButton() {
  if (!/@[^\s@]*$/.test(commentText.value)) {
    const base = commentText.value.replace(/\s+$/, '')
    commentText.value = base ? `${base} @` : '@'
  }
  mention.sync(commentText.value)
  if (!isMobile) commentInput.value?.focus()
}

function onEnterKey() {
  if (mentionOpen.value && mention.current.value && !mention.current.value.isAll) {
    applyMentionOption(mention.current.value)
    return
  }
  sendComment()
}

function onEscapeKey() {
  if (mentionOpen.value) {
    mention.close()
    return
  }
  closeReplyInput()
}

const commentThreads = computed(() => groupMomentComments(comments.value))
const visibleThreads = computed(() => commentThreads.value.slice(0, MAX_VISIBLE))
const hiddenThreads = computed(() => commentThreads.value.slice(MAX_VISIBLE))
const hiddenCount = computed(() => hiddenThreads.value.reduce(
  (count, group) => count + 1 + group.replies.length,
  0
))


// 带原始下标的可见配图：加载失败按下标剔除，多图翻看与灯箱都基于这个顺序
const visibleImages = computed(() => {
  return (props.post.images || [])
    .map((url, idx) => ({ url, idx }))
    .filter(({ idx }) => !imgErrors.has(idx))
})

function onImgError(idx) {
  imgErrors.add(idx)
}

// 生图失败（多半是 ComfyUI 掉线）导致的无图帖：按帖子原本的提示词原地补图
const regenerating = ref(false)
const canRegenerateImage = computed(() => props.post.character_id != null)

async function regenerateImage() {
  regenerating.value = true
  try {
    await moments.regeneratePostImage(props.post.id)
    imgErrors.clear()
  } catch (err) {
    toastFn?.(err.message, 'error')
  } finally {
    regenerating.value = false
  }
}

function onPreviewImg(i) {
  emit('preview', { images: visibleImages.value.map(e => e.url), index: i })
}

// ── 多图：一摞摊开的相片（滚轮 / 手指滑动 / 点左右翻看）──
const deckIndex = ref(0)
// 舞台高度按相片原始宽高比来（首张加载完就量），默认 4:3
const deckAspect = ref('4 / 3')
// 翻页动画：记下这一拍在飞的那张 —— next 是顶张甩出去，prev 是最底下那张被抽上来
const deckFly = ref(null)
// 飞出去的那张只在“甩出去”的半程压在整摞上面，回落时要把层级交回去
const deckFlyFront = ref(false)
let deckFlyTimer = null
let deckFlyFrontTimer = null
let deckWheelLock = 0
let deckTouchStart = null

// 扇形层叠参数：每深一层多转一点、往右上错开一点。
// 旋转原点是底边中点，所以后一张的右上角会翘到顶张上面、左下角从底下露出来一点
const DECK_LAYERS = [
  { x: 0, y: 0, r: 0 },
  { x: 4, y: -7, r: -3.8 },
  { x: 7, y: -11, r: -5.6 },
  { x: 9, y: -14, r: -7 },
]

// 图片数量变化（加载失败被剔除 / 帖子换图）后把翻页位置收回范围内
watch(() => visibleImages.value.length, (n) => {
  if (deckIndex.value >= n) deckIndex.value = 0
})

// 换了一批图就重新量宽高比
watch(() => (props.post.images || []).join('|'), () => { deckAspect.value = '4 / 3' })

function onDeckImgLoad(e) {
  const img = e?.target
  if (!img?.naturalWidth || !img?.naturalHeight) return
  if (deckAspect.value !== '4 / 3') return
  deckAspect.value = `${img.naturalWidth} / ${img.naturalHeight}`
}

function markDeckFly(idx, dir) {
  deckFly.value = { idx, dir }
  clearTimeout(deckFlyFrontTimer)
  if (dir > 0) {
    deckFlyFront.value = true
    // 480ms 的甩出动画在 40%（192ms）到最远点，之后开始回落，就在这时候钻回后面
    deckFlyFrontTimer = setTimeout(() => { deckFlyFront.value = false }, 200)
  } else {
    // prev 是下层那张抽到最上面，本来就是顶张，不用额外抬层级
    deckFlyFront.value = false
  }
  clearTimeout(deckFlyTimer)
  deckFlyTimer = setTimeout(() => { deckFly.value = null }, 520)
}

function flipDeck(step) {
  const n = visibleImages.value.length
  if (n < 2) return
  const dir = step > 0 ? 1 : -1
  // 下一张 = 顶张飞出去落回最下面；上一张 = 最下面那张从后面被抽到最上面
  const flyingIdx = dir > 0 ? deckIndex.value : (deckIndex.value - 1 + n) % n
  deckIndex.value = (deckIndex.value + step + n) % n
  markDeckFly(flyingIdx, dir)
}

// 堆叠深度：0 = 最上面一张，数字越大越靠后
function deckDepth(i) {
  const n = visibleImages.value.length
  return (i - deckIndex.value + n) % n
}

function deckCardStyle(i) {
  const depth = deckDepth(i)
  const layer = DECK_LAYERS[Math.min(depth, DECK_LAYERS.length - 1)]
  const fly = deckFly.value
  const flying = !!fly && fly.idx === i
  const style = {
    '--deck-x': `${layer.x}px`,
    '--deck-y': `${layer.y}px`,
    '--deck-r': `${layer.r}deg`,
    // 相片本体自己按原始比例缩放到舞台内，这里只负责摆它所在的那一层
    transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.r}deg)`,
    // 甩出去的那张在半程内压到整摞上面，回落时自动交回层级
    zIndex: flying && deckFlyFront.value ? 30 : 10 - depth,
    opacity: depth > DECK_LAYERS.length ? 0 : 1,
  }
  if (flying && fly.dir < 0) {
    // 从它原来那一层（最底下可见层）的位置抽上来
    const from = DECK_LAYERS[Math.min(visibleImages.value.length - 1, DECK_LAYERS.length - 1)]
    style['--fly-x'] = `${from.x}px`
    style['--fly-y'] = `${from.y}px`
    style['--fly-r'] = `${from.r}deg`
  }
  return style
}

function deckCardClass(i) {
  const fly = deckFly.value
  const flying = !!fly && fly.idx === i
  return {
    'is-top': i === deckIndex.value,
    'is-flying': flying,
    'fly-next': flying && fly.dir > 0,
    'fly-prev': flying && fly.dir < 0,
  }
}

// 摊在最上面的那张（翻页后跟着变）：分享按这张出图，且只出一张
const frontImageUrl = computed(() => visibleImages.value[deckIndex.value]?.url || '')

function onShare() {
  emit('share', props.post, frontImageUrl.value)
}

function onDeckCardClick(i) {
  if (i === deckIndex.value) onPreviewImg(i)
  else {
    deckIndex.value = i
    markDeckFly(i, -1)
  }
}

function onDeckWheel(e) {
  if (visibleImages.value.length < 2) return
  const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  if (!delta) return
  // 悬停在卡片上时滚轮只翻图，不进页面滚动；加冷却避免一次滑动连翻
  e.preventDefault()
  const now = Date.now()
  if (now - deckWheelLock < 300) return
  deckWheelLock = now
  flipDeck(delta > 0 ? 1 : -1)
}

function onDeckTouchStart(e) {
  const t = e.changedTouches?.[0]
  deckTouchStart = t ? { x: t.clientX, y: t.clientY } : null
}

function onDeckTouchEnd(e) {
  const start = deckTouchStart
  deckTouchStart = null
  const t = e.changedTouches?.[0]
  if (!start || !t) return
  const dx = t.clientX - start.x
  const dy = t.clientY - start.y
  // 横向滑动且够长才翻，纵向留给页面滚动
  if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
  flipDeck(dx < 0 ? 1 : -1)
}

// 首次加载评论（store.loadComments 直接设置 post._comments，computed 自动同步）
if (comments.value.length === 0) {
  commentsLoading.value = true
  moments.loadComments(props.post.id).finally(() => {
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
  replyTarget.value = null
  mention.close()
}

function closeReplyInput() {
  closeAll()
}

async function sendComment() {
  const text = commentText.value.trim()
  if (!text || sending.value) return
  sending.value = true

  const target = replyTarget.value
  const tempId = 'temp_' + Date.now()
  if (!props.post._comments) props.post._comments = []
  props.post._comments.push({
    id: tempId,
    author_type: 'user',
    content: text,
    reply_to_name: target ? replyTargetName.value : undefined,
    reply_to_author_type: target ? (target.author_type || 'user') : undefined,
    reply_to_avatar_path: target && target.author_type === 'character'
      ? (target.char_avatar_path || null)
      : undefined,
    reply_to_comment_id: target ? target.id : null,
    thread_root_id: target ? (target.thread_root_id ?? target.id) : null,
    created_at: new Date().toISOString(),
  })
  commentText.value = ''
  replyTarget.value = null
  mention.close()
  if (!isMobile) commentInput.value?.focus()

  expanded.value = true
  try {
    const result = await moments.addComment(props.post.id, text, target?.id ?? null)
    const idx = props.post._comments.findIndex(c => c.id === tempId)
    if (idx >= 0 && result.comment) {
      // 乐观数据已带「回复谁」；合并返回值，避免楼中楼被薄响应覆盖
      props.post._comments.splice(idx, 1, { ...props.post._comments[idx], ...result.comment })
    }
    // 兼容两种返回形态：replies 数组（支持 @ 多人 / 楼中楼）与旧版单个 reply
    const replies = result.replies || (result.reply ? [result.reply] : [])
    for (const reply of replies) {
      props.post._comments.push(reply)
    }
  } catch (err) {
    console.error('[MomentCard] comment error:', err)
    if (props.post._comments) {
      const filteredVal = props.post._comments.filter(c => c.id !== tempId)
      props.post._comments.length = 0
      props.post._comments.push(...filteredVal)
    }
    toastFn?.(err.message || '评论发送失败', 'error')
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

// ── 编辑文字 ──
const editing = ref(false)
const editText = ref('')
const savingEdit = ref(false)
const editInput = ref(null)
const storedImageRequest = ref('')
const canSaveEdit = computed(() => savingEdit.value || (!editText.value.trim() && !storedImageRequest.value) || editText.value === visibleContent.value)

async function startEdit() {
  showMenu.value = false
  storedImageRequest.value = extractMomentImageRequest(props.post.content || '')
  editText.value = visibleContent.value
  editing.value = true
  await nextTick()
  editInput.value?.focus()
}

function cancelEdit() {
  editing.value = false
  editText.value = ''
}

async function saveEdit() {
  const text = editText.value.trim()
  if (savingEdit.value || (!text && !storedImageRequest.value)) return
  savingEdit.value = true
  try {
    await moments.updatePost(props.post.id, appendMomentImageRequest(text, storedImageRequest.value))
    editing.value = false
    editText.value = ''
  } catch (err) {
    console.error('[MomentCard] edit error:', err)
  } finally {
    savingEdit.value = false
  }
}

const likeBursting = ref(false)
let burstTimer = null
async function onLike() {
  await moments.toggleLike(props.post.id)
  // 点赞成功：爱心爆心动画（粒子环扩散），600ms 后复位
  if (props.post.liked) {
    likeBursting.value = false
    requestAnimationFrame(() => {
      likeBursting.value = true
      clearTimeout(burstTimer)
      burstTimer = setTimeout(() => { likeBursting.value = false }, 650)
    })
  }
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (d >= todayStart) {
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  if (d >= yesterdayStart) {
    return '昨天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  const twoDaysAgoStart = new Date(todayStart.getTime() - 2 * 86400000)
  if (d >= twoDaysAgoStart) {
    return '前天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
    d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
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

@media (max-width: 767px) {
  .moment-card { padding: 15px; }
}
.moment-card:hover { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06); }

.moment-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.moment-avatar {
  width: 55px; height: 55px; border-radius: 50%;
  background: #e07b6c;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700; flex-shrink: 0;
  cursor: pointer;
  overflow: hidden; /* 镇民立绘放大裁头时在圆框内裁切 */
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.moment-avatar:hover {
  transform: scale(1.08);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.25);
}
/* 用户自己的帖子：头像走本地配置，加一圈主题描边与评论区「我」同口径 */
.moment-avatar.is-user { box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.3); }

.moment-avatar-img {
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
}
/* 镇民没有专用头像，只有 900×1600 整张立绘：基准取顶 + 放大，圆框里只露头部 */
.moment-avatar-img.is-npc-portrait {
  object-position: top;
  transform: scale(2.5);
  transform-origin: 50% 0;
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
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none; border-radius: 0;
  background: transparent;
  font-size: 13px; font-weight: 500; color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s;
  text-align: left;
  user-select: none;
}
.moment-dropdown-item svg { flex-shrink: 0; color: var(--text-secondary); }
.moment-dropdown-item.danger svg { color: var(--danger); }
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

/* 内联编辑文字 */
.moment-edit-area { display: flex; flex-direction: column; gap: 10px; }
.moment-edit-actions {
  display: flex; justify-content: flex-end; gap: 8px;
}

/* 无图（生图失败）：虚线相框 + 补图入口 */
.moment-images-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 15px;
  margin-bottom: 14px;
  padding: 26px 16px;
  border: 1.5px dashed var(--border-strong);
  border-radius: 12px;
  background: var(--glass-bg);
  color: var(--text-secondary);
}
.moment-empty-icon { display: flex; opacity: 0.65; }
.moment-empty-text { font-size: 13px; }

/* 单图 */
.moment-images {
  margin-bottom: 14px;
  border-radius: 12px;
  overflow: hidden;
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

/* 多图：一摞摊开的相片 —— 后一张从右上角翘出来一点、左下角从底下露一点，
   滚轮 / 手指滑动 / 点左右箭头翻看；翻页时顶张甩出去、再落回最下面。
   舞台吃满原来单图的位置（宽度撑满，高度按相片比例、上限 520px） */
.moment-deck {
  position: relative;
  width: 100%;
  aspect-ratio: var(--deck-ar, 4 / 3);
  max-height: 520px;
  margin-top: 15px;
  /* 底部给沉到相片下方的张数角标留出血空间 */
  margin-bottom: 34px;
  touch-action: pan-y;
}
/* 舞台只负责定位和翻页动画：底面透明、不拦指针（露在外面的那张也能点到），
   圆角 / 阴影都挂在相片本体上，所以相片多大、看起来的卡片就多大 */
.deck-card {
  position: absolute;
  inset: 22px 12px 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transform-origin: 50% 100%;
  transition: transform var(--dur-base) var(--ease-spring), opacity var(--dur-base) var(--ease-standard);
  will-change: transform;
}
/* 相片：按原始比例缩放到舞台内（完整不裁切），尺寸由 max-width/height 决定 */
/* 相纸白边让堆叠中每张相片的边缘都清晰可辨，白底固定色与 deck-counter 同理（照片纸质感）；
   直角 + 黑色重投影走实体照片风 */
.deck-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  border: 4px solid #fff;
  border-radius: 0;
  background: var(--bg-tertiary);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  transition: box-shadow var(--dur-base) var(--ease-standard);
}
.deck-card.is-top .deck-img { box-shadow: 0 8px 22px rgba(0, 0, 0, 0.38); }
/* 翻页中飞的那张影子拉深一点（层级由 deckCardStyle 顶到 30） */
.deck-card.is-flying .deck-img { box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45); }

/* 下一张：顶张往右上甩出去，再落回最底下那一层 */
.deck-card.fly-next { animation: deck-throw-out 480ms var(--ease-out) both; }
@keyframes deck-throw-out {
  0% { transform: translate(0, 0) rotate(0deg) scale(1); }
  40% { transform: translate(26px, -6px) rotate(6deg) scale(0.94); }
  100% { transform: translate(var(--deck-x), var(--deck-y)) rotate(var(--deck-r)) scale(1); }
}
/* 上一张：最底下那张从后面被抽上来，落定时带一点回弹 */
.deck-card.fly-prev { animation: deck-pull-in 480ms var(--ease-spring) both; }
@keyframes deck-pull-in {
  0% { transform: translate(var(--fly-x), var(--fly-y)) rotate(var(--fly-r)) scale(0.97); }
  100% { transform: translate(0, 0) rotate(0deg) scale(1); }
}
/* 翻页箭头：默认隐藏，悬停 / 聚焦到 deck 时浮现；皮肤归 LinsheButton，这里只补定位与显隐
   （md 圆形图标钮 30px，故上移 15px 居中） */
.moment-deck .deck-nav {
  position: absolute;
  top: calc(50% - 15px);
  z-index: 40;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-standard);
}
.moment-deck:hover .deck-nav,
.moment-deck:focus-within .deck-nav {
  opacity: 1;
  pointer-events: auto;
}
.moment-deck .deck-nav--prev { left: 8px; }
.moment-deck .deck-nav--next { right: 8px; }
/* 角标沉到相片下方靠右，不压图；stage 需要留出这段出血高度 */
.deck-counter {
  position: absolute;
  right: 12px;
  bottom: -26px;
  z-index: 40;
  padding: 2px 10px;
  border-radius: 999px;
  /* 压在照片上的小标签，沿用灯箱遮罩的黑底白字口径，任何画面上都看得清 */
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  pointer-events: none;
}

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
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
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
/* 单条评论（含评论人头像）皮肤在 MomentCommentItem.vue */
.comment-group + .comment-group { margin-top: 8px; }
.comment-replies {
  display: flex; flex-direction: column; gap: 4px;
  margin-top: 4px; padding-left: 16px;
  border-left: 1px solid var(--glass-border);
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
  max-height: 2600px;
  opacity: 1;
}

.comment-expand-btn {
  display: block; width: 100%;
  padding: 6px 0; margin-top: 4px;
  border: none; border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
  text-align: center; user-select: none;
}
.comment-expand-btn:hover { color: var(--accent); background: rgba(var(--accent-rgb), 0.05); }

.comment-input-row {
  display: flex; gap: 8px; align-items: center;
}
.comment-input {
  flex: 1;
  padding: 8px 12px;
}
/* @ 按钮皮肤由 LinsheButton(variant="icon") 提供，这里只保留布局属性 */
.comment-mention-btn {
  flex-shrink: 0;
}
/* 发送按钮皮肤由 LinsheButton(variant="primary" size="sm") 提供，这里只保留布局属性 */
.comment-send {
  flex-shrink: 0;
}

.reply-input-wrapper {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.22s cubic-bezier(0.2, 1, 0.2, 1),
              margin-top 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  margin-top: 0;
  position: relative;
}
.reply-input-wrapper.open {
  max-height: 92px;
  opacity: 1;
  margin-top: 12px;
}
/* @ 候选面板浮出输入框上方：打开期间放开裁切，面板锚定在输入行上沿 */
.reply-input-wrapper.mention-open { overflow: visible; }
.reply-input-wrapper.mention-open.open { max-height: 92px; }

/* 楼中楼回复目标 chip */
.reply-target-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 3px 6px 3px 10px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.08);
  font-size: 12px;
  color: var(--accent-hover);
}
.reply-target-chip .chip-label {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reply-target-chip .chip-cancel {
  width: 16px; height: 16px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all var(--dur-fast) var(--ease-standard);
}
.reply-target-chip .chip-cancel:hover { color: var(--danger); background: rgba(255, 77, 79, 0.1); }

/* @ 点名候选面板：悬浮在输入框上方 */
.mention-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 220px;
  overflow-y: auto;
  background: var(--popover-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
  padding: 4px;
}
.mention-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}
.mention-option.active { background: rgba(var(--accent-rgb), 0.1); }
.mention-avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.mention-name {
  font-size: 13px;
  color: var(--text-primary);
}
.mention-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}
</style>
