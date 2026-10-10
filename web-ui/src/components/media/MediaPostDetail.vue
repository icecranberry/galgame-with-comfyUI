<template>
  <linshe-modal
    :visible="visible"
    :title="kind === 'feed' ? '帖子详情' : '报刊阅读'"
    variant="comic"
    wide
    :transition-ms="300"
    @close="emit('close')"
  >
    <template #close="{ close }">
      <media-game-button
        variant="icon"
        aria-label="关闭帖子详情"
        @click="close"
      >
        ×
      </media-game-button>
    </template>
    <article v-if="post" class="reader">
      <template v-if="kind === 'feed'">
        <header class="reader-head">
          <div class="reader-source">
            <span class="reader-edition">LOCAL / 现场来稿</span>
            <span>{{ post.outlet_name || '社区' }}</span>
            <span v-if="post.board_name">{{ post.board_name }}</span>
          </div>
          <h1>{{ post.title }}</h1>
          <span class="reader-head-mark" aria-hidden="true">“</span>
          <div class="reader-byline">
            <span class="reader-avatar">
              <img v-if="post.author_avatar" :src="post.author_avatar" alt="" />
              <span v-else>{{ (post.author_name || '匿').slice(0, 1) }}</span>
            </span>
            <div>
              <strong>{{ post.author_name || '匿名用户' }}</strong>
              <span v-if="post.author_type !== 'character'" class="reader-author-note">
                社区来稿
              </span>
            </div>
            <span class="reader-length">约 {{ readingMinutes }} 分钟阅读</span>
          </div>
        </header>
        <figure v-if="post.image" class="reader-figure">
          <div
            role="button"
            tabindex="0"
            class="reader-image"
            aria-label="放大帖子配图"
            @click="zoom"
            @keydown.enter.prevent="zoom"
            @keydown.space.prevent="zoom"
          >
            <img
              :src="bustUrlIfOverwritten(post.image)"
              :alt="post.title || '帖子配图'"
            />
          </div>
          <figcaption>配图 · 点击查看大图</figcaption>
        </figure>
        <div class="reader-story">
          <div class="story-label" aria-hidden="true">
            <span>01</span>
            正文现场
          </div>
          <div class="reader-copy">
            <p v-for="(paragraph, i) in paragraphs" :key="i">{{ paragraph }}</p>
          </div>
        </div>
      </template>
      <slot v-else />

      <div v-if="post.tags?.length" class="reader-tags">
        <span v-for="tag in post.tags" :key="tag"># {{ tag }}</span>
      </div>
      <div class="reader-stats" aria-label="帖子数据">
        <span>
          <b>{{ formatNum(post.likes) }}</b>
          喜欢
        </span>
        <span>
          <b>{{ formatNum(post.views) }}</b>
          阅读
        </span>
        <span>
          <b>{{ post.comments?.length || 0 }}</b>
          讨论
        </span>
      </div>

      <section
        class="reader-discussion"
        aria-labelledby="media-discussion-title"
      >
        <div class="discussion-heading">
          <h2 id="media-discussion-title">
            <span aria-hidden="true">02 /</span>
            大家在聊
            <span class="discussion-bang" aria-hidden="true">!!</span>
          </h2>
          <span>{{ post.comments?.length || 0 }} 条讨论</span>
        </div>
        <ol v-if="post.comments?.length" class="discussion-list">
          <li
            v-for="(comment, i) in post.comments"
            :key="i"
            class="discussion-item"
          >
            <span class="comment-avatar" aria-hidden="true">
              {{ (comment.author || '匿').slice(0, 1) }}
            </span>
            <div class="comment-main">
              <div class="comment-heading">
                <strong>{{ comment.author || '匿名用户' }}</strong>
                <span>{{ String(i + 1).padStart(2, '0') }} 楼</span>
              </div>
              <p>{{ comment.content }}</p>
            </div>
          </li>
        </ol>
        <p v-else class="discussion-empty">这里还很安静，暂时没有讨论。</p>
      </section>
    </article>
    <template #footer>
      <div class="reader-actions">
        <media-game-button
          size="sm"
          variant="danger"
          :disabled="busy"
          @click="emit('delete', post)"
        >
          删除帖子
        </media-game-button>
        <div class="reader-actions-right">
          <media-game-button
            size="sm"
            :loading="regenerating"
            :disabled="busy"
            @click="emit('regenerate', post)"
          >
            重新生图
          </media-game-button>
          <media-game-button size="sm" variant="primary" @click="emit('close')">
            关闭阅读
          </media-game-button>
        </div>
      </div>
    </template>
  </linshe-modal>
</template>

<script setup>
import { computed } from 'vue'
import LinsheModal from '../ui/LinsheModal.vue'
import MediaGameButton from './MediaGameButton.vue'
import { bustUrlIfOverwritten } from '../../utils/imageUrlRefresh.js'

const props = defineProps({
  visible: Boolean,
  post: { type: Object, default: null },
  kind: { type: String, default: 'feed' },
  busy: Boolean,
  regenerating: Boolean
})
const emit = defineEmits(['close', 'delete', 'regenerate', 'zoom'])
const paragraphs = computed(() =>
  String(props.post?.content || '')
    .split(/\n+/)
    .filter((p) => p.trim())
)
const readingMinutes = computed(() =>
  Math.max(1, Math.ceil(String(props.post?.content || '').length / 400))
)
function formatNum(n) {
  const value = Number(n) || 0
  return value >= 10000
    ? `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`
    : String(value)
}
function zoom() {
  emit('zoom', bustUrlIfOverwritten(props.post.image))
}
</script>

<style scoped>
.reader {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.reader-head {
  position: relative;
  isolation: isolate;
  padding: 26px 36px 24px;
  border-bottom: 3px solid var(--media-ink);
  background: var(--accent);
  color: var(--media-ink);
  overflow: hidden;
}
.reader-source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 800;
}
.reader-source > span {
  padding: 5px 9px;
  border: 1px solid var(--media-ink);
}
.reader-source .reader-edition {
  background: var(--media-ink);
  color: var(--media-light);
  font-family: monospace;
  letter-spacing: 0.05em;
}
.reader-head h1 {
  position: relative;
  max-width: 650px;
  margin: 20px 0 24px;
  color: var(--media-ink);
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1.35;
  font-weight: 950;
  letter-spacing: -0.035em;
  text-wrap: pretty;
}
.reader-head-mark {
  position: absolute;
  z-index: -1;
  right: 10px;
  top: 15px;
  font-family: Georgia, serif;
  font-size: 250px;
  line-height: 1;
  color: color-mix(in srgb, var(--media-light) 35%, transparent);
  transform: rotate(-12deg);
}
.reader-byline {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.reader-avatar,
.comment-avatar {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border: 2px solid var(--media-ink);
  border-radius: 2px;
  background: var(--media-light);
  color: var(--media-ink);
  box-shadow: 3px 3px 0 var(--media-ink);
  overflow: hidden;
  font-weight: 900;
  transform: rotate(-4deg);
}
.reader-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.reader-byline strong {
  font-size: 20px;
}
.reader-author-note {
  display: block;
  margin-top: 3px;
  font-size: 12px;
}
.reader-length {
  margin-left: auto;
  font-family: monospace;
  font-size: 12px;
  border-bottom: 2px solid var(--media-ink);
  padding: 6px 0;
}
.reader-figure {
  position: relative;
  margin: 28px 36px 0;
}
.reader-image {
  cursor: zoom-in;
  overflow: hidden;
  border: 3px solid var(--media-rule);
  box-shadow: 5px 5px 0 var(--media-ink);
  background: var(--bg-sunken);
  text-align: center;
}
.reader-image img {
  display: block;
  width: 100%;
  max-height: 440px;
  object-fit: contain;
}
.reader-figure figcaption {
  display: table;
  margin: -2px 0 0 auto;
  position: relative;
  padding: 5px 10px;
  color: var(--media-light);
  background: var(--media-ink);
  font-size: 12px;
  transform: rotate(-2deg);
}
.reader-story {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 24px;
  margin: 32px 36px 0;
}
.story-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  border-top: 3px solid var(--media-rule);
  padding-top: 5px;
}
.story-label span {
  display: block;
  font-size: 34px;
  font-weight: 900;
  font-style: italic;
  font-family: monospace;
  line-height: 1.4;
}
.reader-copy {
  font-size: 16px;
  line-height: 2;
  letter-spacing: 0.025em;
}
.reader-copy p {
  margin: 0 0 1.25em;
  white-space: pre-wrap;
}
.reader-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 20px 36px;
}
.reader-tags span {
  padding: 4px 10px;
  border: 1px solid var(--media-rule);
  background: var(--bg-sunken);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
}
.reader-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 24px 36px 32px;
  border: 2px solid var(--media-rule);
  background: var(--bg-sunken);
}
.reader-stats > span {
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 8px;
  font-size: 12px;
}
.reader-stats > span + span {
  border-left: 2px solid var(--media-rule);
}
.reader-stats b {
  color: var(--text-bright);
  font-size: 26px;
  font-weight: 900;
  font-family: monospace;
  font-style: italic;
}
.reader-discussion {
  padding: 26px 36px 32px;
  border-top: 3px solid var(--media-rule);
  background-color: var(--bg-sunken);
  background-image: radial-gradient(var(--dot-color) 0.7px, transparent 0.7px);
  background-size: 8px 8px;
}
.discussion-heading,
.comment-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.discussion-heading h2 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 26px;
  margin: 0;
  color: var(--text-bright);
  font-weight: 950;
  transform: rotate(-2deg);
}
.discussion-heading h2 > span:first-child {
  font-size: 13px;
  font-family: monospace;
}
.discussion-bang {
  color: var(--accent);
  font-size: 34px;
  font-style: italic;
}
.discussion-heading > span,
.comment-heading > span {
  font-size: 12px;
  flex-shrink: 0;
  color: var(--text-primary);
}
.discussion-list {
  list-style: none;
  margin: 24px 0 0;
  padding: 0;
}
.discussion-item {
  display: flex;
  gap: 18px;
  margin-top: 20px;
}
.discussion-item:nth-child(even) {
  margin-left: 28px;
}
.comment-avatar {
  width: 36px;
  height: 36px;
  font-size: 14px;
  background: var(--accent);
}
.comment-main {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 14px 18px;
  border: 2px solid var(--media-rule);
  background: var(--media-paper);
  box-shadow: 3px 3px 0 var(--media-ink);
  border-radius: 0 12px 12px 12px;
}
.comment-main::before {
  content: '';
  position: absolute;
  width: 9px;
  height: 9px;
  top: 12px;
  left: -7px;
  border-left: 2px solid var(--media-rule);
  border-bottom: 2px solid var(--media-rule);
  background: var(--media-paper);
  transform: rotate(45deg);
}
.comment-heading strong {
  font-size: 14px;
  color: var(--text-bright);
}
.comment-main p {
  font-size: 14px;
  line-height: 1.85;
  white-space: pre-wrap;
  margin: 8px 0 0;
}
.discussion-empty {
  padding: 24px 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.reader-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.reader-actions-right {
  display: flex;
  gap: 12px;
}
@media (max-width: 600px) {
  .reader-head {
    padding: 20px 18px;
  }
  .reader-head h1 {
    margin: 18px 0 22px;
    font-size: 29px;
  }
  .reader-length {
    display: none;
  }
  .reader-figure {
    margin: 22px 18px 0;
  }
  .reader-story {
    grid-template-columns: 1fr;
    gap: 14px;
    margin: 24px 18px 0;
  }
  .story-label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .story-label span {
    font-size: 20px;
  }
  .reader-tags {
    margin: 16px 18px;
  }
  .reader-stats {
    margin: 22px 18px;
  }
  .reader-stats b {
    font-size: 23px;
  }
  .reader-discussion {
    padding: 22px 18px 28px;
  }
  .discussion-heading {
    gap: 6px;
  }
  .discussion-heading h2 {
    gap: 5px;
    font-size: 22px;
  }
  .discussion-item {
    gap: 12px;
  }
  .discussion-item:nth-child(even) {
    margin-left: 0;
  }
  .comment-main {
    padding: 12px;
  }
  .comment-heading {
    flex-wrap: wrap;
    gap: 4px;
  }
  .reader-actions,
  .reader-actions-right {
    gap: 8px;
  }
}
</style>
