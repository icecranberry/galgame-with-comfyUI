<template>
  <!-- 论坛主题帖：主楼 + 楼层回复（版聊） -->
  <div class="mforum-thread">
    <!-- 主楼 -->
    <article class="mf-floor is-op">
      <div class="mf-side">
        <span class="mf-av" :class="{ 'is-char': post.author_type === 'character' }">
          <img v-if="post.author_avatar" :src="post.author_avatar" alt="" />
          <span v-else>{{ (post.author_name || '?').charAt(0) }}</span>
        </span>
        <span class="mf-side-name">{{ post.author_name }}</span>
        <span v-if="post.author_type === 'character'" class="mf-badge">角色</span>
        <span class="mf-side-sub">楼主</span>
      </div>
      <div class="mf-main">
        <header class="mf-op-head">
          <h4 class="mf-op-title">{{ post.title }}</h4>
          <div class="mf-op-meta">
            <span v-if="post.board_name" class="mf-board">{{ post.board_name }}</span>
            <span>{{ fmtTime(post.created_at) }}</span>
            <span>浏览 {{ fmtNum(post.views) }}</span>
          </div>
        </header>
        <p class="mf-op-body">{{ post.content }}</p>
        <div v-if="post.tags?.length" class="mf-tags">
          <span v-for="t in post.tags" :key="t" class="mf-tag">#{{ t }}</span>
        </div>
        <div v-if="post.image" class="mf-op-img">
          <img :src="post.image" alt="" loading="lazy" @click="$emit('zoom', post.image)" />
        </div>
      </div>
    </article>

    <!-- 楼层 -->
    <article
      v-for="r in replies" :key="r.floor"
      class="mf-floor" :class="{ 'is-char': replyIsChar(r) }"
    >
      <div class="mf-side">
        <span class="mf-av" :class="{ 'is-char': replyIsChar(r) }">
          <img v-if="avatarOf(r)" :src="avatarOf(r)" alt="" />
          <span v-else>{{ (r.author || '?').charAt(0) }}</span>
        </span>
        <span class="mf-side-name">{{ r.author }}</span>
        <span v-if="replyIsChar(r)" class="mf-badge">角色</span>
      </div>
      <div class="mf-main">
        <div class="mf-floor-head">
          <span class="mf-floor-no">{{ r.floor }} 楼</span>
        </div>
        <!-- ★ 楼层的赞 / 踩（2026-10-06 按用户期望补）。
             数值由**服务端确定性生成**（见 mediaService 的 normalizeForumDraft），
             不是模型写的 —— 模型写的会全楼差不多、还可能自相矛盾。
             有踩表示这层有争议（杠精/被戳痛处/版主拉架）。 -->
        <div v-if="r.likes != null" class="mf-vote" aria-hidden="true">
          <span class="mf-vote-btn"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z"/><path d="M7 10l4.5-7a2 2 0 0 1 3.5 1.3V9h4.6a2 2 0 0 1 2 2.4l-1.2 7A2 2 0 0 1 18.4 20H7"/></svg>{{ r.likes }}</span>
          <span v-if="r.dislikes" class="mf-vote-btn is-down"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3Z"/><path d="M17 14l-4.5 7a2 2 0 0 1-3.5-1.3V15H4.4a2 2 0 0 1-2-2.4l1.2-7A2 2 0 0 1 5.6 4H17"/></svg>{{ r.dislikes }}</span>
        </div>
        <blockquote v-if="r.quote" class="mf-quote">
          <span class="mf-quote-who">{{ quotedAuthor(r.quote) }}</span>
          <span class="mf-quote-text">{{ quotedText(r.quote) }}</span>
        </blockquote>
        <p class="mf-reply-body">{{ r.content }}</p>
      </div>
    </article>

    <p v-if="!replies.length" class="mf-empty">这条帖子还没有回复</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  post: { type: Object, required: true },
})
defineEmits(['zoom'])

const replies = computed(() => props.post?.payload?.forum?.replies || [])

function fmtNum(n) {
  const v = Number(n) || 0
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}
function fmtTime(t) {
  if (!t) return ''
  // 后端给的是 'YYYY-MM-DD HH:MM:SS'（本地时间），原样截断即可，不做时区换算
  return String(t).slice(5, 16)
}

/** 该回复是不是某个角色本人（回复里目前只记名字，命中马甲/真名即算） */
const charNames = computed(() => {
  const names = new Set()
  const p = props.post
  if (p?.author_type === 'character' && p.author_name) names.add(p.author_name)
  return names
})
function replyIsChar(r) {
  return charNames.value.has(r.author)
}
function avatarOf() {
  // 回复者没有头像字段（后端 payload 里只存名字）。保留函数便于以后扩展。
  return ''
}

function floorOf(n) {
  return replies.value.find(x => x.floor === n) || null
}
function quotedAuthor(n) {
  const f = floorOf(n)
  return f ? f.author : '未知楼层'
}
function quotedText(n) {
  const f = floorOf(n)
  if (!f) return ''
  const t = f.content || ''
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}
</script>

<style scoped>
.mforum-thread { display: flex; flex-direction: column; gap: 10px; }

.mf-floor {
  display: flex; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
}
.mf-floor.is-op { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 5%, var(--bg-secondary)); }
.mf-floor.is-char { border-color: color-mix(in srgb, var(--accent-3) 40%, var(--border)); }

.mf-side {
  flex: 0 0 84px; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-align: center;
}
.mf-av {
  width: 40px; height: 40px; border-radius: 50%;
  display: grid; place-items: center; overflow: hidden;
  background: var(--bg-hover); color: var(--text-secondary);
  font-weight: 700; font-size: 0.95rem;
  border: 2px solid var(--border);
}
.mf-av.is-char { border-color: color-mix(in srgb, var(--accent-3) 55%, transparent); }
.mf-av img { width: 100%; height: 100%; object-fit: cover; }
.mf-side-name { font-size: var(--fs-xs); color: var(--text-primary); font-weight: 600; word-break: break-all; line-height: 1.25; }
.mf-side-sub { font-size: 10px; color: var(--text-secondary); }
.mf-badge {
  font-size: 9px; padding: 0 5px; border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent-3) 22%, transparent);
  color: var(--accent-3); font-weight: 700;
}

.mf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.mf-op-head { display: flex; flex-direction: column; gap: 4px; }
.mf-op-title { margin: 0; font-size: 1.02rem; font-weight: 700; color: var(--text-bright); line-height: 1.4; }
.mf-op-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: var(--fs-xs); color: var(--text-secondary); align-items: center; }
.mf-board {
  padding: 1px 7px; border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); font-weight: 600;
}
.mf-op-body { margin: 0; font-size: 0.9rem; line-height: 1.75; color: var(--text-primary); white-space: pre-wrap; }
.mf-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.mf-tag { font-size: var(--fs-xs); color: var(--accent-3); }
.mf-op-img { margin-top: 2px; }
.mf-op-img img {
  max-width: 100%; max-height: 380px; border-radius: var(--radius-md);
  border: 1px solid var(--border); cursor: zoom-in; display: block;
}

.mf-floor-head { display: flex; align-items: center; gap: 8px; }
.mf-floor-no { font-size: var(--fs-xs); color: var(--text-secondary); font-weight: 600; }
/* 楼层赞/踩（浅色胶囊，像论坛的投票条） */
.mf-vote { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; }
.mf-vote-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 999px;
  background: var(--bg-sunken); color: var(--text-secondary);
  font-size: var(--fs-xs); font-variant-numeric: tabular-nums;
}
.mf-vote-btn.is-down { color: color-mix(in srgb, var(--text-secondary) 80%, transparent); }
.mf-quote {
  margin: 0; padding: 6px 10px;
  border-left: 3px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--bg-sunken);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: var(--fs-xs); color: var(--text-secondary);
  display: flex; flex-direction: column; gap: 2px;
}
.mf-quote-who { color: var(--accent); font-weight: 600; }
.mf-quote-text { opacity: .9; }
.mf-reply-body { margin: 0; font-size: 0.88rem; line-height: 1.7; color: var(--text-primary); white-space: pre-wrap; }
.mf-empty { text-align: center; color: var(--text-secondary); font-size: var(--fs-xs); padding: 12px 0; margin: 0; }
</style>
