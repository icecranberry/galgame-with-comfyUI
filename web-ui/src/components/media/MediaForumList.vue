<template>
  <!-- 论坛主题列表（版聊列表：标题 / 作者 / 回复·浏览 / 最后回复） -->
  <div class="mforum">
    <!-- 顶部：站点栏 + 分区导航（参考 NGA 的版头） -->
    <header class="mforum-head">
      <div class="mforum-brand">
        <span class="mforum-logo">{{ currentOutlet?.icon || '🧵' }}</span>
        <div class="mforum-brand-text">
          <h3 class="mforum-name">{{ currentOutlet?.name || '论坛' }}</h3>
          <p class="mforum-tagline">{{ currentOutlet?.tagline || '有事上论坛，没事也上论坛' }}</p>
        </div>
      </div>
      <div class="mforum-stat">
        <span>主题 <b>{{ posts.length }}</b></span>
        <span>分区 <b>{{ boardNav.length }}</b></span>
      </div>
    </header>

    <!-- 分区导航：**固定显示该站点的全部板块**，不随"当前有没有帖子"增减。
         ★ 曾经这里用的是「从 posts 反推有哪些分区」，有两个后果：
           ① 没发过帖的板块直接不显示（站点有 6 个区，界面上只看到 2 个）；
           ② **点了某个分区之后，其余分区标签全部消失** —— 因为 `posts` 已被后端
              按该分区过滤，反推出来就只剩它自己，用户再也点不回别的区。
         现在改成读该媒体的板块清单（`GET /outlets/:id/boards`），与帖子过滤无关。 -->
    <nav v-if="boardNav.length" class="mforum-nav">
      <button
        type="button" class="mf-nav-item" :class="{ on: !activeBoardId }"
        @click="emit('board', null)"
      >全部<span v-if="totalCount" class="mf-nav-num">{{ totalCount }}</span></button>
      <button
        v-for="b in boardNav" :key="b.id"
        type="button" class="mf-nav-item" :class="{ on: activeBoardId === b.id }"
        @click="emit('board', b.id)"
      >{{ b.name }}<span class="mf-nav-num">{{ b.count }}</span></button>
    </nav>

    <!-- 主题列表 -->
    <div class="mforum-list">
      <button
        v-for="p in posts" :key="p.id"
        type="button" class="mf-row"
        :class="{ 'is-char': p.author_type === 'character', 'is-picked': isPicked(p.id) }"
        @click="onRowClick(p)"
      >
        <!-- 批量模式：行首勾选框（行的右侧被"回复/浏览"占着，所以放左边）。
             整行可点，这里只做视觉。 -->
        <span v-if="batchMode" class="mf-pick" :class="{ on: isPicked(p.id) }" aria-hidden="true">
          <svg v-if="isPicked(p.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <span class="mf-row-av" :class="{ 'is-char': p.author_type === 'character' }">
          <img v-if="p.author_avatar" :src="p.author_avatar" alt="" />
          <span v-else>{{ (p.author_name || '?').charAt(0) }}</span>
        </span>
        <span class="mf-row-body">
          <span class="mf-row-title">
            <span v-if="p.board_name" class="mf-row-board">{{ p.board_name }}</span>
            {{ p.title }}
            <span v-if="p.image" class="mf-row-img" title="本贴有配图">🖼</span>
          </span>
          <span class="mf-row-sub">
            <span class="mf-row-author">{{ p.author_name }}</span>
            <span v-if="p.author_type === 'character'" class="mf-row-badge">角色</span>
            <span class="mf-row-time">{{ fmtTime(p.created_at) }}</span>
          </span>
        </span>
        <span class="mf-row-nums">
          <span class="mf-num"><b>{{ replyCount(p) }}</b>回复</span>
          <span class="mf-num"><b>{{ fmtNum(p.views) }}</b>浏览</span>
        </span>
      </button>

      <p v-if="!posts.length" class="mforum-empty">这个分区还没有主题帖</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  posts: { type: Array, default: () => [] },
  /** 该分类下的媒体（用来显示站点名与分区） */
  outlets: { type: Array, default: () => [] },
  /** 当前选中的媒体 id（null = 全部） */
  activeOutlet: { type: [Number, null], default: null },
  /** 当前选中的板块 id（null = 全部） */
  activeBoardId: { type: [Number, null], default: null },
  /**
   * 该站点的**全部板块**（含每区总贴数）。
   * ★ 分区标签必须用它、而不是从当前 posts 反推 —— 否则点进某个分区后其余标签会消失。
   */
  boards: { type: Array, default: () => [] },
  /** 批量选择模式：行首出勾选框，整行点击 = 切换勾选 */
  batchMode: { type: Boolean, default: false },
  /** 已选中的帖子 id（Set） */
  selectedIds: { type: Object, default: () => new Set() },
})
const emit = defineEmits(['open', 'board', 'pick'])

/** 该行是否已被勾选 */
function isPicked(id) {
  return props.selectedIds instanceof Set ? props.selectedIds.has(id) : false
}
/** 批量模式下点行 = 切换勾选；否则打开主题帖（与瀑布流卡片同一口径） */
function onRowClick(p) {
  if (props.batchMode) emit('pick', p.id)
  else emit('open', p)
}

const currentOutlet = computed(() => {
  if (props.activeOutlet) return props.outlets.find(o => o.id === props.activeOutlet) || null
  return props.outlets[0] || null
})

/**
 * 分区标签：**固定取该站点的全部板块**，不随"当前有没有帖子"增减。
 *
 * 数据源优先级：
 *   ① `props.boards` —— 该媒体的板块清单（`GET /outlets/:id/boards`，含每区总贴数）。
 *      **与帖子过滤无关**，所以点了某个分区之后其余标签仍在。
 *   ② 拿不到 boards（接口失败 / 旧后端）时才退回"从当前 posts 反推"，
 *      至少不会把导航整块弄没。
 */
const boardNav = computed(() => {
  const fromApi = Array.isArray(props.boards) ? props.boards : []
  if (fromApi.length) {
    return fromApi.map(b => ({ id: b.id, name: b.name, count: b.post_count || 0 }))
  }
  const map = new Map()
  for (const p of props.posts) {
    if (!p.board_name) continue
    const key = p.board_id ?? p.board_name
    const hit = map.get(key) || { id: p.board_id ?? null, name: p.board_name, count: 0 }
    hit.count++
    map.set(key, hit)
  }
  return [...map.values()]
})

/** 「全部」上的总数：优先用板块清单求和（完整），退回当前已加载的帖子数 */
const totalCount = computed(() => {
  const fromApi = Array.isArray(props.boards) ? props.boards : []
  if (fromApi.length) return fromApi.reduce((s, b) => s + (b.post_count || 0), 0)
  return props.posts.length
})

function replyCount(p) {
  return (p?.payload?.forum?.replies || []).length
}
function fmtNum(n) {
  const v = Number(n) || 0
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}
function fmtTime(t) {
  if (!t) return ''
  return String(t).slice(5, 16)
}
</script>

<style scoped>
.mforum { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 0; overflow: hidden; }

/* ── 版头 ── */
.mforum-head {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 18px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-bottom: 0;
}
.mforum-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mforum-logo { font-size: 1.9rem; line-height: 1; }
.mforum-name { margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--text-bright); }
.mforum-tagline { margin: 2px 0 0; font-size: var(--fs-xs); color: var(--text-secondary); }
.mforum-stat {
  margin-left: auto; display: flex; gap: 16px;
  font-size: var(--fs-xs); color: var(--text-secondary);
}
.mforum-stat b { color: var(--text-primary); font-size: 0.9rem; }

/* ── 分区导航 ── */
.mforum-nav {
  display: flex; flex-wrap: wrap; gap: 2px;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.mf-nav-item {
  border: 0; background: transparent; cursor: pointer;
  padding: 9px 12px; font-size: var(--fs-xs); color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  transition: color var(--dur-fast) var(--ease-out);
  display: inline-flex; align-items: center; gap: 5px;
}
.mf-nav-item:hover { color: var(--text-primary); }
.mf-nav-item.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 700; }
.mf-nav-num { font-size: 9px; opacity: .75; }

/* ── 主题列表 ── */
.mforum-list {
  flex: 1; min-height: 0; overflow-y: auto;
  border: 1px solid var(--border); border-top: 0;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  background: var(--bg-secondary);
}
/* 用「表格行」而不是卡片：论坛的阅读方式是扫标题列，卡片会把行高撑起来、一屏看不到几条 */
.mf-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 16px; border: 0; border-bottom: 1px solid var(--border);
  background: transparent; cursor: pointer; text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}
.mf-row:last-child { border-bottom: 0; }
.mf-row:hover { background: var(--glass-bg-hover); }
.mf-row.is-char { background: color-mix(in srgb, var(--accent-3) 5%, transparent); }
.mf-row.is-char:hover { background: color-mix(in srgb, var(--accent-3) 10%, transparent); }
/* 批量模式：行首勾选框（只做视觉，整行可点） */
.mf-pick {
  flex: 0 0 auto;
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--glass-border);
  border-radius: 5px;
  color: transparent;
  transition: background .15s, border-color .15s, color .15s;
}
.mf-pick.on { background: var(--accent-solid); border-color: var(--accent); color: #fff; }
.mf-row.is-picked { background: color-mix(in srgb, var(--accent) 8%, transparent); }

.mf-row-av {
  flex: 0 0 30px; width: 30px; height: 30px; border-radius: 50%;
  display: grid; place-items: center; overflow: hidden;
  background: var(--bg-hover); color: var(--text-secondary);
  font-size: var(--fs-xs); font-weight: 700;
}
.mf-row-av img { width: 100%; height: 100%; object-fit: cover; }
.mf-row-av.is-char { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-3) 45%, transparent); }

.mf-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mf-row-title {
  font-size: 0.9rem; color: var(--text-bright); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mf-row-board {
  font-size: 10px; padding: 0 6px; margin-right: 6px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); font-weight: 600;
}
.mf-row-img { font-size: 11px; margin-left: 4px; }
.mf-row-sub { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); color: var(--text-secondary); }
.mf-row-author { color: var(--text-secondary); }
.mf-row-badge {
  font-size: 9px; padding: 0 5px; border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent-3) 22%, transparent);
  color: var(--accent-3); font-weight: 700;
}
.mf-row-time { opacity: .8; }

.mf-row-nums { display: flex; gap: 14px; flex-shrink: 0; font-size: var(--fs-xs); color: var(--text-secondary); }
.mf-num { display: inline-flex; gap: 3px; }
.mf-num b { color: var(--text-primary); font-weight: 600; }

.mforum-empty { text-align: center; color: var(--text-secondary); font-size: var(--fs-xs); padding: 40px 0; margin: 0; }
</style>
