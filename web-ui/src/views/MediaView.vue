<template>
  <div class="media-view">
    <!-- 顶栏 -->
    <div class="media-header">
      <!-- 移动端：侧栏入口。
           原先靠「传媒」标题点击唤出，标题去掉后改成一个图标按钮，
           否则手机上这一页就没有回导航的路了。 -->
      <linshe-button
        v-if="isMobile"
        variant="icon"
        class="btn-mobile-back"
        title="导航"
        @click="toggleMobileSidebar?.()"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </linshe-button>

      <!-- 分类分页：占原来「传媒」标题的位置。
           报刊类不混进「社交平台」（社交平台 = 瀑布流帖子流）——
           《邻舍日报》是整版报纸、周刊/海报是按期出刊，三者形态完全不同，
           混在一个流里既乱又难找。 -->
      <div class="cat-bar" role="tablist" aria-label="内容分类">
        <button
          v-for="c in CATEGORIES"
          :key="c.key"
          type="button"
          role="tab"
          :aria-selected="activeCategory === c.key"
          class="cat-tab"
          :class="{ active: activeCategory === c.key }"
          :title="c.hint"
          @click="onCategoryChange(c.key)"
        >
          <span class="cat-icon">{{ c.icon }}</span>{{ c.label }}
          <span class="cat-num">{{ categoryCount(c.key) }}</span>
        </button>
      </div>

      <div class="header-right">
        <span class="media-count" v-if="activeCategory !== 'traditional' && total > 0">共 {{ total }} 帖</span>
        <!-- 自动抓帖频率：常显当前档位，点开就地调（不塞进设置页，传媒自己管自己的节奏）
             传统报纸分类下隐藏 —— 《邻舍日报》由镇口公告站零点自动印发，没有"抓帖"一说 -->
        <button
          v-if="activeCategory !== 'traditional'"
          type="button"
          class="auto-chip"
          :class="{ active: freqOpen, off: auto.minutes === 0 }"
          :title="auto.minutes === 0 ? '自动抓帖已关闭，只能手动刷新' : `每 ${autoLabel}自动抓一批`"
          @click="freqOpen = !freqOpen"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>
          </svg>
          自动 · {{ auto.minutes === 0 ? '关闭' : autoLabel }}
          <svg class="chip-caret" :class="{ open: freqOpen }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </button>
        <linshe-button class="btn-op" variant="secondary" @click="showSettings = true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>媒体设置
        </linshe-button>
        <linshe-button
          v-if="activeCategory !== 'traditional'"
          class="btn-refresh" variant="primary" :loading="refreshing" @click="onRefresh"
        >
          <svg v-if="!refreshing" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px">
            <polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>{{ refreshing ? '刷新中…' : '刷新' }}
        </linshe-button>
      </div>
    </div>

    <!-- 频率面板：就地展开在顶栏下方，不遮挡内容、不引弹层定位问题 -->
    <Transition name="freq">
      <div v-if="freqOpen" class="freq-panel">
        <div class="freq-row">
          <span class="freq-label">自动抓帖频率</span>
          <input
            class="freq-range"
            type="range"
            min="0"
            :max="Math.max(0, steps.length - 1)"
            step="1"
            :value="stepIdx"
            @input="onFreqInput($event.target.value)"
          />
          <span class="freq-val" :class="{ off: auto.minutes === 0 }">{{ autoLabel }}</span>
        </div>
        <div class="freq-ticks">
          <button
            v-for="(s, i) in steps"
            :key="s.minutes"
            type="button"
            class="freq-tick"
            :class="{ on: i === stepIdx }"
            @click="applyFreq(i)"
          >{{ s.label }}</button>
        </div>
        <div class="freq-hint">
          {{ currentStep?.hint || '' }}
          <template v-if="auto.minutes > 0 && nextInText">
            · <b v-if="nextInText === '即将'">马上开抓</b>
            <b v-else>下次约 {{ nextInText }}后</b>
          </template>
        </div>
      </div>
    </Transition>

    <!-- 媒体标签页（跟随分类筛选） -->
    <div class="outlet-bar">
      <!-- 《传统报纸》分类：只有《邻舍日报》。它有自己的整版排版（报头/三栏/期号切换），
           不按帖子流展示，所以做成一个入口按钮，点开就是原来的报纸界面。 -->
      <template v-if="activeCategory === 'traditional'">
        <button
          type="button"
          class="outlet-tab is-newspaper"
          title="《邻舍日报》· 每天零点印发"
          @click="showNewspaper = true"
        >
          <span class="outlet-icon">📰</span>邻舍日报
          <span v-if="newspaperUnread" class="outlet-dot" aria-label="今天的报纸还没读"></span>
        </button>
      </template>

      <template v-else>
        <button
          type="button"
          class="outlet-tab"
          :class="{ active: activeOutlet === null }"
          @click="onOutletChange(null)"
        >全部<span class="outlet-num">{{ categoryTotal }}</span></button>
        <button
          v-for="o in filteredOutlets"
          :key="o.id"
          type="button"
          class="outlet-tab"
          :class="{ active: activeOutlet === o.id }"
          :title="o.tagline || o.name"
          @click="onOutletChange(o.id)"
        >
          <span v-if="o.icon" class="outlet-icon">{{ o.icon }}</span>{{ o.name }}
          <!-- 形态标记：这一类不是帖子流，而是按「期」出刊 -->
          <span v-if="o.layout === 'weekly'" class="outlet-kind is-weekly">刊</span>
          <span v-else-if="o.layout === 'poster'" class="outlet-kind is-poster">报</span>
          <span class="outlet-num">{{ o.post_count }}</span>
        </button>
      </template>
    </div>

    <!-- 传统报纸：只有一个《邻舍日报》，内容是整版报纸不在帖子流里 —— 给张入口卡 -->
    <div v-if="activeCategory === 'traditional'" class="np-entry-wrap">
      <button type="button" class="np-entry" @click="showNewspaper = true">
        <span class="np-entry-icon">📰</span>
        <span class="np-entry-main">
          <span class="np-entry-title">
            邻舍日报
            <span v-if="newspaperUnread" class="outlet-dot" aria-label="今天的报纸还没读"></span>
          </span>
          <span class="np-entry-sub">二相乐园唯一持牌报纸 · 每天零点由镇口公告站印发</span>
        </span>
        <span class="np-entry-go">阅读本期 ›</span>
      </button>
      <p class="np-entry-hint">
        《邻舍日报》是整版报纸（报头 / 三栏排版 / 人物特稿 / 期号切换），不按帖子流展示。
      </p>
    </div>

    <!-- 板块筛选（选中某个媒体后才出现） -->
    <div v-if="activeCategory !== 'traditional' && boards.length" class="board-bar">
      <linshe-button
        v-for="b in boardChips"
        :key="b.id ?? 'all'"
        variant="chip"
        :active="activeBoard === b.id"
        @click="onBoardChange(b.id)"
      >
        <span class="board-label">{{ b.name }}</span>
        <span class="board-count">{{ b.post_count }}</span>
      </linshe-button>
    </div>

    <!-- ── 周刊 / 海报：全宽版式，不参与瀑布流列布局 ──
         （选中这类媒体时 feedPosts 为空，页面上就只有下面这一块） -->
    <div v-if="activeCategory !== 'traditional' && specialPosts.length" class="special-list">
      <div v-for="p in specialPosts" :key="p.id" class="special-wrap">
        <component
          :is="p.layout === 'poster' ? MediaPoster : MediaWeekly"
          :post="p"
          @zoom="zoomSrc = $event"
        />
        <!-- 周刊/海报是整幅版式，不适合在图上贴按钮 → 操作放在版式下方 -->
        <div class="special-ops">
          <linshe-button
            size="sm" variant="secondary"
            :loading="regeneratingId === p.id"
            :disabled="busyPostId !== null"
            @click="regenerateImage(p)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
            </svg>重新生图
          </linshe-button>
          <span class="special-open" role="button" tabindex="0" @click="openPost(p)" @keydown.enter.prevent="openPost(p)">查看详情 ›</span>
          <span style="flex:1"></span>
          <linshe-button
            size="sm" variant="ghost" tone="danger"
            :disabled="busyPostId !== null"
            title="删除这一期"
            @click="removePost(p)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>删除
          </linshe-button>
        </div>
      </div>
    </div>

    <!-- ── 帖子流：瀑布流 ── -->
    <div v-if="activeCategory !== 'traditional' && feedPosts.length" class="masonry">
      <article
        v-for="p in feedPosts"
        :key="p.id"
        class="post-card"
        :class="{ 'is-char': p.author_type === 'character' }"
        @click="openPost(p)"
      >
        <!-- 封面：有图用图，没图用渐变占位（配图由后台补印） -->
        <div class="post-cover">
          <img v-if="p.image" :src="bustUrlIfOverwritten(p.image)" loading="lazy" decoding="async" alt="" />
          <div v-else class="cover-ph">
            <span v-if="p.outlet_name" class="cover-ph-outlet">{{ p.outlet_name }}</span>
            <span class="cover-ph-title">{{ p.title }}</span>
          </div>
          <span class="cover-likes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21s-7.5-4.7-9.6-9A5.6 5.6 0 0 1 12 6.1 5.6 5.6 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z"/>
            </svg>{{ formatNum(p.likes) }}
          </span>
          <span v-if="p.board_name" class="cover-board">{{ p.board_name }}</span>
          <!-- 悬浮操作：重新生图 / 删除（@click.stop 防止连带打开详情） -->
          <div class="cover-ops">
            <button
              type="button" class="cover-op" title="重新生图"
              :disabled="busyPostId !== null"
              @click.stop="regenerateImage(p)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
              </svg>
            </button>
            <button
              type="button" class="cover-op is-danger" title="删除"
              :disabled="busyPostId !== null"
              @click.stop="removePost(p)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="post-body">
          <div class="post-author">
            <span class="author-avatar" :class="{ 'is-char': p.author_type === 'character' }">
              <img v-if="p.author_avatar" :src="p.author_avatar" alt="" />
              <span v-else>{{ (p.author_name || '?').charAt(0) }}</span>
            </span>
            <span class="author-name" :class="{ 'is-char': p.author_type === 'character' }">{{ p.author_name }}</span>
            <span v-if="p.author_type === 'character'" class="author-badge">角色</span>
          </div>
          <h3 class="post-title">{{ p.title }}</h3>
          <p class="post-excerpt">{{ p.content }}</p>
          <div v-if="p.tags.length" class="post-tags">
            <span v-for="t in p.tags" :key="t" class="tag">#{{ t }}</span>
          </div>
          <div class="post-foot">
            <span class="foot-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>
              </svg>{{ formatNum(p.views) }}
            </span>
            <span class="foot-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>{{ p.comments.length }}
            </span>
          </div>
        </div>
      </article>
    </div>

    <!-- 空状态：注意要基于 posts（而非 feedPosts）——
         选中的是周刊/海报时 feedPosts 本就为空，不能因此误报"没有内容"；
         传统报纸分类也不适用（内容在整版报纸里） -->
    <div v-if="activeCategory !== 'traditional' && !posts.length && !loading" class="media-empty">
      <!-- ★ 加载失败必须与"真的没有内容"区分开。
           踩过的坑：后端 listPosts 的 COUNT 查询缺 JOIN → 接口报错 → catch 里静默置空 posts
           → 页面显示「还没有任何帖子」，看起来像"内容被清空了"，实际是请求挂了。 -->
      <template v-if="loadError">
        <p class="empty-title">内容加载失败</p>
        <p class="empty-hint">{{ loadError }}</p>
        <linshe-button variant="secondary" size="sm" class="empty-retry" @click="reloadAll()">重试</linshe-button>
      </template>
      <template v-else>
        <p class="empty-title">{{ activeOutlet === null ? '还没有任何帖子' : '这个媒体还没有内容' }}</p>
        <p class="empty-hint">点右上角「刷新」抓一批新帖；内容由该媒体的提示词 + 世界观生成，活跃角色会随机出现在帖子里。</p>
      </template>
    </div>

    <div v-if="loading" class="media-loading"><span class="spinner"></span> 加载中…</div>
    <div v-if="!loading && hasMore && posts.length" class="load-more" @click="loadMore">
      {{ loadingMore ? '加载中…' : '加载更多' }}
    </div>
    <div v-else-if="!loading && posts.length" class="load-more is-end">— 共 {{ total }} 帖 —</div>

    <!-- 帖子详情 -->
    <linshe-modal
      :visible="!!detailPost"
      :title="detailPost?.title || ''"
      wide
      panel-class="mp-detail-panel"
      @close="detailPost = null"
    >
      <div v-if="detailPost" class="post-detail">
        <!-- 顶部操作条：重新生图 / 删除（对三种形态都适用） -->
        <div class="detail-ops">
          <linshe-button
            size="sm" variant="secondary"
            :loading="regeneratingId === detailPost.id"
            :disabled="busyPostId !== null"
            title="为这条内容重新生成配图"
            @click="regenerateImage(detailPost)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
            </svg>重新生图
          </linshe-button>
          <span style="flex:1"></span>
          <linshe-button
            size="sm" variant="ghost" tone="danger"
            :disabled="busyPostId !== null"
            title="删除这条内容"
            @click="removePost(detailPost)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>删除
          </linshe-button>
        </div>

        <!-- ★ 周刊 / 海报：直接渲染版式本体，而不是把结构化内容摊成纯文本。
             这样「小图组」才会显示成图片 + 图注（同《邻舍日报》的详情排版口径）。
             图片可点击放大。 -->
        <template v-if="detailPost.layout === 'weekly' && detailPost.payload">
          <MediaWeekly :post="detailPost" @zoom="zoomSrc = $event" />
        </template>
        <template v-else-if="detailPost.layout === 'poster' && detailPost.payload">
          <MediaPoster :post="detailPost" @zoom="zoomSrc = $event" />
        </template>

        <template v-else>
          <div class="detail-meta">
            <span class="detail-author">
              <span class="author-avatar" :class="{ 'is-char': detailPost.author_type === 'character' }">
                <img v-if="detailPost.author_avatar" :src="detailPost.author_avatar" alt="" />
                <span v-else>{{ (detailPost.author_name || '?').charAt(0) }}</span>
              </span>{{ detailPost.author_name }}
              <span v-if="detailPost.author_type === 'character'" class="author-badge">角色</span>
            </span>
            <span class="detail-stats">{{ detailPost.outlet_name }}<template v-if="detailPost.board_name"> · {{ detailPost.board_name }}</template></span>
          </div>
          <img
            v-if="detailPost.image"
            :src="bustUrlIfOverwritten(detailPost.image)"
            class="detail-img"
            alt=""
            @click="zoomSrc = bustUrlIfOverwritten(detailPost.image)"
          />
          <p class="detail-content">{{ detailPost.content }}</p>
        </template>

        <!-- 标签 / 数据 / 评论：三种形态共用 -->
        <div v-if="detailPost.tags.length" class="post-tags">
          <span v-for="t in detailPost.tags" :key="t" class="tag">#{{ t }}</span>
        </div>
        <div class="detail-stats-row">
          <span>♥ {{ formatNum(detailPost.likes) }}</span>
          <span>👁 {{ formatNum(detailPost.views) }}</span>
          <span>💬 {{ detailPost.comments.length }}</span>
        </div>
        <div class="comment-list">
          <div v-for="(c, i) in detailPost.comments" :key="i" class="comment-item">
            <span class="comment-author">{{ c.author }}</span>
            <span class="comment-text">{{ c.content }}</span>
          </div>
          <div v-if="!detailPost.comments.length" class="comment-empty">还没有评论</div>
        </div>
      </div>
    </linshe-modal>

    <!-- 图片放大（与《邻舍日报》详情同口径：点图放大） -->
    <ImageLightbox :visible="!!zoomSrc" :imgs="zoomSrc ? [zoomSrc] : []" @hide="zoomSrc = ''" />

    <!-- 媒体设置 -->
    <MediaSettingsModal v-model="showSettings" :outlets="outlets" @changed="reloadOutlets" />

    <!-- 《邻舍日报》：沿用原有整版报纸界面（报头 / 三栏 / 期号切换 / 新闻详情） -->
    <NewspaperModal v-model="showNewspaper" @read="onNewspaperRead" />
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import MediaSettingsModal from '../components/MediaSettingsModal.vue'
import NewspaperModal from '../components/NewspaperModal.vue'
import MediaWeekly from '../components/media/MediaWeekly.vue'
import MediaPoster from '../components/media/MediaPoster.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import { bustUrlIfOverwritten } from '../utils/imageUrlRefresh.js'
import { onEvent } from '../stores/unifiedStream.js'
import { useNewspaperStore } from '../stores/newspaper.js'

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const toastFn = inject('toast')
/** 删除确认用（全站统一的确认弹窗） */
const confirmFn = inject('confirm', null)

// ── 《邻舍日报》入口 ──
// 报纸有独立的整版排版，不在帖子流里展示；这里只做入口 + 未读点。
const newspaperStore = useNewspaperStore()
const showNewspaper = ref(false)
const newspaperUnread = computed(() => newspaperStore.unread)
function onNewspaperRead(paper) {
  try { newspaperStore.markRead(paper) } catch { /* 失败不阻塞，轮询会兜底 */ }
}

const PAGE_SIZE = 24

const outlets = ref([])
const boards = ref([])
const posts = ref([])
const total = ref(0)
const loading = ref(true)
/** 帖子列表加载失败的原因（空串=正常）。用于把"请求失败"与"真的没有内容"区分开 */
const loadError = ref('')
const loadingMore = ref(false)
const refreshing = ref(false)
const showSettings = ref(false)
const detailPost = ref(null)
/** 图片放大（点版式里的图 → 与《邻舍日报》详情同口径） */
const zoomSrc = ref('')
/** 正在重新生图的帖子 id（按钮转圈用） */
const regeneratingId = ref(null)
/** 有操作在进行中（防止并发点） */
const busyPostId = ref(null)

const activeOutlet = ref(null)
const activeBoard = ref(null)

// ── 顶栏分类分页 ──
// 报刊类不混进「社交平台」（社交平台 = 瀑布流帖子流）：《邻舍日报》是整版报纸、
// 周刊/海报是按期出刊，三者形态完全不同，混在一个流里既乱又难找。
// 分类由 layout 推导（weekly/poster → 数字报刊；feed → 社交平台），加新媒体时自动归类。
const CATEGORIES = [
  { key: 'traditional', label: '传统报纸', icon: '📰', hint: '《邻舍日报》—— 整版报纸，每天零点印发' },
  { key: 'digital', label: '数字报刊', icon: '📸', hint: '周刊 / 海报 —— 按期出刊的数字刊物' },
  { key: 'social', label: '社交平台', icon: '💬', hint: '瀑布流社交平台 —— 论坛/职场/暗网等' },
]
const activeCategory = ref('social')   // 默认落在内容最多的社交平台

/** 当前分类下的媒体（普通用户自建媒体） */
const filteredOutlets = computed(() => {
  if (activeCategory.value === 'traditional') return []
  const wantDigital = activeCategory.value === 'digital'
  return outlets.value.filter(o => {
    const isDigital = o.layout === 'weekly' || o.layout === 'poster'
    return isDigital === wantDigital
  })
})

/** 「全部」标签上的数字：当前分类下所有媒体的帖子数之和 */
const categoryTotal = computed(() => filteredOutlets.value.reduce((s, o) => s + (o.post_count || 0), 0))

/** 分类分页上的数字 */
function categoryCount(key) {
  if (key === 'traditional') return newspaperStore.unread ? 1 : 0   // 只表示"有未读"
  const wantDigital = key === 'digital'
  return outlets.value
    .filter(o => ((o.layout === 'weekly' || o.layout === 'poster') === wantDigital))
    .reduce((s, o) => s + (o.post_count || 0), 0)
}

async function onCategoryChange(key) {
  if (activeCategory.value === key) return
  activeCategory.value = key
  activeOutlet.value = null
  activeBoard.value = null
  boards.value = []
  loadError.value = ''
  if (key === 'traditional') { posts.value = []; total.value = 0; return }
  await loadPage(0)
}

// ── 自动抓帖频率 ──
// 档位表以后端下发的 MEDIA_AUTO_STEPS 为准（前后端口径唯一）；
// 这里留一份**兜底副本**：后端还没重启 / 接口临时不通时，控件至少是可用的、不显示空白。
// 改档位时记得两边一起改（后端口径在 services/mediaService.js）。
const FALLBACK_AUTO_STEPS = [
  { minutes: 0,   label: '关闭',    hint: '不自动抓帖，只有你点「刷新」时才生成。' },
  { minutes: 720, label: '12 小时', hint: '一天两批，几乎不占算力。' },
  { minutes: 240, label: '4 小时',  hint: '一天六批，内容慢慢积累。' },
  { minutes: 120, label: '2 小时',  hint: '一天十几批。' },
  { minutes: 60,  label: '1 小时',  hint: '每小时一批（每批 3 条）。' },
  { minutes: 20,  label: '20 分钟', hint: '默认节奏，社区一直有新鲜感。' },
  { minutes: 10,  label: '10 分钟', hint: '比较频繁，LLM 消耗明显上升。' },
  { minutes: 5,   label: '5 分钟',  hint: '最频繁档；每批 3 条要调一次 LLM，烧 token 很快。' },
]

const freqOpen = ref(false)
const steps = ref(FALLBACK_AUTO_STEPS)
const auto = ref({ minutes: 20, nextInMs: null, generating: false })
/** 倒计时每秒刷新用的时间戳（只用来触发 nextInText 重算） */
const nowTick = ref(Date.now())
let tickTimer = null

/** 当前 minutes 对应的档位下标（找不到时取最接近的） */
const stepIdx = computed(() => {
  const list = steps.value
  if (!list.length) return 0
  const m = auto.value.minutes
  const exact = list.findIndex(s => s.minutes === m)
  if (exact >= 0) return exact
  let best = 0, bestDiff = Infinity
  list.forEach((s, i) => {
    const d = Math.abs(s.minutes - m)
    if (d < bestDiff) { bestDiff = d; best = i }
  })
  return best
})

const currentStep = computed(() => steps.value[stepIdx.value] || null)
const autoLabel = computed(() => {
  const s = currentStep.value
  if (!s) return '—'
  return s.minutes === 0 ? '关闭' : s.label
})

/** 距下次自动抓帖的倒计时文案 */
const nextInText = computed(() => {
  const ms = auto.value.nextInMs
  if (ms == null) return ''
  // 服务刚启动（lastAutoAt=0）或刚到点时 nextInMs=0 → 马上就会抓，别显示「0 秒」
  if (ms <= 0) return '即将'
  // 依赖 nowTick 让文案每秒重算
  const left = Math.max(0, ms - (nowTick.value - _autoSyncAt))
  if (left <= 1000) return '即将'
  const min = Math.floor(left / 60000)
  if (min >= 60) return `${(min / 60).toFixed(1)} 小时`
  if (min >= 1) return `${min} 分钟`
  return `${Math.round(left / 1000)} 秒`
})
let _autoSyncAt = Date.now()

async function loadAuto() {
  try {
    const d = await api.getMediaAuto()
    // 后端下发的档位表优先；为空则保留兜底副本，避免滑块变成空的
    if (Array.isArray(d.steps) && d.steps.length) steps.value = d.steps
    if (d.auto) { auto.value = d.auto; _autoSyncAt = Date.now() }
  } catch (err) {
    // 后端未重启/接口不通：保留兜底档位表，控件仍可操作
    console.warn('[media] 读取自动频率失败（用兜底档位表）:', err?.message || err)
  }
}

/** 拖动时先本地更新（跟手），松手才写库 */
function onFreqInput(rawIdx) {
  const i = Number(rawIdx)
  const s = steps.value[i]
  if (!s) return
  auto.value = { ...auto.value, minutes: s.minutes, nextInMs: s.minutes === 0 ? null : auto.value.nextInMs }
}

async function applyFreq(i) {
  const s = steps.value[i]
  if (!s || s.minutes === auto.value.minutes) { freqOpen.value = true; return }
  const prev = auto.value.minutes
  auto.value = { ...auto.value, minutes: s.minutes }
  try {
    const d = await api.setMediaAuto(s.minutes)
    if (d.auto) { auto.value = d.auto; _autoSyncAt = Date.now() }
    if (d.steps) steps.value = d.steps
    toastFn?.(s.minutes === 0 ? '已关闭自动抓帖（仍可手动刷新）' : `自动抓帖已设为每 ${s.label}一批`, 'success')
  } catch (err) {
    console.error('[media] 保存自动频率失败:', err)
    auto.value = { ...auto.value, minutes: prev }
    // 404 = 后端还没重启（这条路由是新增的），提示要说清楚，别让用户以为是网络问题
    const hint = /404/.test(err?.message || '') ? '（后端未重启，新接口还没生效）' : ''
    toastFn?.('保存失败' + hint + '：' + (err?.message || ''), 'error')
  }
}

const totalAllOutlets = computed(() => outlets.value.reduce((s, o) => s + (o.post_count || 0), 0))

// 板块 chip：首位「全部」，其余为当前媒体的板块
const boardChips = computed(() => {
  const sum = boards.value.reduce((s, b) => s + (b.post_count || 0), 0)
  return [{ id: null, name: '全部', post_count: sum }, ...boards.value]
})

const hasMore = computed(() => posts.value.length < total.value)

/**
 * 按形态分组：
 *   feedPosts    = 帖子流（走瀑布流卡片）
 *   specialPosts = 周刊 / 海报（走全宽版式组件）
 * 之所以拆开渲染：周刊与海报是全宽版式，塞进多列瀑布流会排版崩坏。
 *
 * ⚠️ **必须同时要求 payload 存在**：早期版本（layout 还没引入时）生成的狸狸八卦帖子
 * 只有 title/content 而没有 payload_json。若只按 layout 判定，版式组件会因为
 * `v-if="data"` 不通过而渲染成**空白**。带上 payload 判定后，这类旧数据会退回
 * 卡片渲染，正常显示标题与正文。
 */
function isSpecialPost(p) {
  const layout = p.layout || 'feed'
  return layout !== 'feed' && !!p.payload
}
const feedPosts = computed(() => posts.value.filter(p => !isSpecialPost(p)))
const specialPosts = computed(() => posts.value.filter(isSpecialPost))

function formatNum(n) {
  const v = Number(n) || 0
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(v)
}

function openPost(p) {
  detailPost.value = p
}

/**
 * 重新生图：清掉这条内容已有的图、重新排队生成。
 * 周刊/海报会连同小图一起重出（后端按 payload 结构一并清空）。
 */
async function regenerateImage(p) {
  if (busyPostId.value !== null) return
  busyPostId.value = p.id
  regeneratingId.value = p.id
  try {
    await api.regenerateMediaPostImage(p.id)
    toastFn?.('已重新排队生图，稍候…', 'success')
  } catch (err) {
    const hint = /404/.test(err?.message || '') ? '（后端未重启，新接口还没生效）' : ''
    toastFn?.('重新生图失败' + hint + '：' + (err?.message || ''), 'error')
  } finally {
    regeneratingId.value = null
    busyPostId.value = null
  }
}

/** 删除这条内容（含其图片文件）。破坏性操作 → 二次确认 */
async function removePost(p) {
  if (busyPostId.value !== null) return
  const isIssue = (p.layout || 'feed') !== 'feed'
  const label = isIssue ? (p.layout === 'poster' ? '这一期海报' : '这一期周刊') : '这条内容'
  const msg = `确定删除${label}吗？\n\n「${p.title}」\n\n配图文件会一并删除，且不可恢复。`
  const ok = confirmFn
    ? await confirmFn({ title: '删除', message: msg, okText: '删除', danger: true })
    : window.confirm(msg)
  if (!ok) return

  busyPostId.value = p.id
  try {
    await api.deleteMediaPost(p.id)
    // 本地移除，不必整页重载
    posts.value = posts.value.filter(x => x.id !== p.id)
    total.value = Math.max(0, total.value - 1)
    if (detailPost.value?.id === p.id) detailPost.value = null
    await reloadOutlets()   // 标签上的计数要跟着变
    toastFn?.('已删除', 'success')
  } catch (err) {
    const hint = /404/.test(err?.message || '') ? '（后端未重启，新接口还没生效）' : ''
    toastFn?.('删除失败' + hint + '：' + (err?.message || ''), 'error')
  } finally {
    busyPostId.value = null
  }
}

// ── 数据加载 ──

let loadSeq = 0

async function reloadOutlets() {
  try {
    const d = await api.listMediaOutlets()
    outlets.value = d.outlets || []
    // 当前选中的媒体被删了就回到「全部」
    if (activeOutlet.value && !outlets.value.some(o => o.id === activeOutlet.value)) {
      activeOutlet.value = null
      await reloadBoards()
    }
  } catch (err) {
    console.error('[media] 读取媒体失败:', err)
  }
}

async function reloadBoards() {
  if (!activeOutlet.value) { boards.value = []; return }
  try {
    const d = await api.listMediaBoards(activeOutlet.value)
    boards.value = d.boards || []
  } catch (err) {
    console.error('[media] 读取板块失败:', err)
    boards.value = []
  }
}

async function loadPage(offset = 0) {
  const seq = ++loadSeq
  try {
    // 没选具体媒体时按分类过滤 —— 否则「全部」会把报刊也混进来
    const d = await api.listMediaPosts({
      outlet: activeOutlet.value,
      board: activeBoard.value,
      category: activeOutlet.value ? null : (activeCategory.value === 'traditional' ? null : activeCategory.value),
      limit: PAGE_SIZE,
      offset,
    })
    if (seq !== loadSeq) return
    loadError.value = ''
    if (offset === 0) posts.value = d.posts || []
    else posts.value.push(...(d.posts || []))
    total.value = d.total || 0
  } catch (err) {
    console.error('[media] 读取帖子失败:', err)
    if (seq !== loadSeq) return
    // 不能只是清空 posts —— 那会让"请求失败"看起来像"这里真的没有内容"。
    // 记下错误，交给空状态渲染成「加载失败 + 重试」。
    loadError.value = err?.message || '请求失败'
    if (offset === 0) { posts.value = []; total.value = 0 }
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  await loadPage(posts.value.length)
  loadingMore.value = false
}

async function onOutletChange(id) {
  if (activeOutlet.value === id) return
  activeOutlet.value = id
  activeBoard.value = null
  await reloadBoards()
  await loadPage(0)
}

async function onBoardChange(id) {
  if (activeBoard.value === id) return
  activeBoard.value = id
  await loadPage(0)
}

// ── 刷新：抓一批新帖（异步，靠 SSE 事件得知完成）──
let refreshTimer = null

async function onRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await api.refreshMediaPosts({ outletId: activeOutlet.value, count: 6 })
    toastFn?.('正在抓取新帖，稍候…', 'success')
    // 兜底轮询：即使 SSE 没连上，也能在 60s 内看到结果
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshing.value = false; reloadAll() }, 60_000)
  } catch (err) {
    console.error('[media] 刷新失败:', err)
    toastFn?.('刷新失败：' + (err?.message || ''), 'error')
    refreshing.value = false
  }
}

async function reloadAll() {
  await Promise.all([reloadOutlets(), loadPage(0)])
}

// ── SSE ──
let unsubNew = null
let unsubImg = null

onMounted(async () => {
  newspaperStore.startPolling()
  await Promise.all([reloadOutlets(), loadAuto()])
  await loadPage(0)
  loading.value = false

  // 兜底补图：把上次没出图的帖子补上（生成失败 / 当时 ComfyUI 没开）。
  // **只在打开页面时补一次**，不做后台定时扫描 —— 否则会持续占用 ComfyUI。
  api.fillMediaImages(6).catch(() => { /* 后端未重启时 404，忽略 */ })

  // 倒计时每秒重算（只在展开面板时才有视觉意义，但开销可忽略）
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)

  unsubNew = onEvent('media_new_posts', async () => {
    refreshing.value = false
    clearTimeout(refreshTimer)
    await reloadAll()
    loadAuto()   // 自动批次刚跑过 → 倒计时归零重算
    toastFn?.('新帖已到', 'success')
  })
  // 配图就绪：只替换那一张，不整页重载
  unsubImg = onEvent('media_image_ready', ({ postId, image }) => {
    const p = posts.value.find(x => x.id === postId)
    if (p) p.image = image
    if (detailPost.value?.id === postId) detailPost.value.image = image
  })
})

onUnmounted(() => {
  clearTimeout(refreshTimer)
  if (tickTimer) clearInterval(tickTimer)
  newspaperStore.stopPolling()
  if (unsubNew) unsubNew()
  if (unsubImg) unsubImg()
})
</script>

<style scoped>
.media-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  padding: 0 0 24px;
}

/* ── 顶栏 ── */
.media-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 20px;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 6;
}
/* 移动端侧栏入口（原来靠「传媒」标题点击，标题去掉后换成图标按钮） */
.btn-mobile-back {
  width: 40px; height: 40px; flex-shrink: 0;
  background: transparent;
}
.header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.media-count { font-size: 13px; color: var(--text-secondary); }
.btn-op, .btn-refresh { padding: 8px 18px; }

/* ── 自动抓帖频率 chip ── */
.auto-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px; font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.auto-chip:hover { color: var(--text-primary); }
.auto-chip.active { border-color: var(--accent); color: var(--accent); background: rgba(var(--accent-rgb), 0.1); }
/* 关闭态压暗一点，提示「现在不会自动更新」 */
.auto-chip.off { opacity: 0.62; }
.chip-caret { transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.chip-caret.open { transform: rotate(180deg); }

/* ── 频率面板 ── */
.freq-panel {
  flex-shrink: 0;
  padding: 12px 20px 14px;
  background: rgba(var(--accent-rgb), 0.05);
  border-bottom: 1px solid var(--border);
}
.freq-row { display: flex; align-items: center; gap: 14px; }
.freq-label { flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--text-bright); }
.freq-range { flex: 1; min-width: 0; accent-color: var(--accent); cursor: pointer; }
.freq-val {
  flex-shrink: 0; min-width: 62px; text-align: right;
  font-size: 13px; font-weight: 700; color: var(--accent);
}
.freq-val.off { color: var(--text-secondary); }

/* 档位刻度：直接点某一档跳过去，比拖滑块精准 */
.freq-ticks { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 7px; }
.freq-tick {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: inherit; font-size: 11px; font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.freq-tick:hover { color: var(--text-primary); }
.freq-tick.on {
  background: rgba(var(--accent-rgb), 0.14);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}
.freq-hint { font-size: 11px; color: var(--text-secondary); line-height: 1.6; }
.freq-hint b { color: var(--accent); }

.freq-enter-active { transition: all 0.25s cubic-bezier(0.3, 1.2, 0.5, 1); overflow: hidden; }
.freq-leave-active { transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.freq-enter-from, .freq-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
.freq-enter-to, .freq-leave-from { opacity: 1; max-height: 200px; }

/* ── 分类分页：占据原「传媒」标题的位置（在顶栏左侧） ──
   窄屏时三档放不下 → 横向滚动，不换行、不挤压右侧按钮 */
.cat-bar {
  display: flex;
  gap: 2px;
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.cat-bar::-webkit-scrollbar { display: none; }
.cat-tab {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border: none;
  border-radius: 10px;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.cat-tab:hover:not(.active) { color: var(--text-primary); background: var(--bg-tertiary); }
.cat-tab.active { color: var(--accent); background: rgba(var(--accent-rgb), 0.12); }
.cat-icon { font-size: 14px; }
.cat-num {
  font-size: 11px; font-weight: 500; opacity: 0.65;
  padding: 1px 6px; border-radius: 999px;
  background: var(--bg-tertiary);
}
.cat-tab.active .cat-num { background: rgba(var(--accent-rgb), 0.16); opacity: 1; }

/* ── 传统报纸：日报入口卡 ── */
.np-entry-wrap { padding: 16px 20px; }
.np-entry {
  display: flex; align-items: center; gap: 16px;
  width: 100%;
  padding: 20px 22px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  backdrop-filter: blur(8px);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.np-entry:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--accent); }
.np-entry-icon { font-size: 34px; flex-shrink: 0; }
.np-entry-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.np-entry-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 17px; font-weight: 700; color: var(--text-bright);
}
.np-entry-sub { font-size: 12px; color: var(--text-secondary); }
.np-entry-go { flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--accent); }
.np-entry-hint { margin: 12px 2px 0; font-size: 11.5px; line-height: 1.7; color: var(--text-secondary); opacity: 0.8; }

/* ── 媒体标签页 ── */
.outlet-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px 20px 10px;
  scrollbar-width: none;
  flex-shrink: 0;
}
.outlet-bar::-webkit-scrollbar { display: none; }
.outlet-tab {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.outlet-tab:hover:not(.active) { color: var(--text-primary); }
.outlet-tab.active {
  background: rgba(var(--accent-rgb), 0.12);
  border-color: var(--accent);
  color: var(--accent);
}
.outlet-icon { font-size: 14px; }
.outlet-num { font-size: 11px; opacity: 0.65; font-weight: 500; }
/* 形态标记：周刊 / 海报不是帖子流，按「期」出刊 */
.outlet-kind {
  font-size: 9px; font-weight: 800; line-height: 1;
  padding: 2px 4px; border-radius: 4px;
}
.outlet-kind.is-weekly { background: rgba(176, 58, 46, 0.14); color: #b03a2e; }
.outlet-kind.is-poster { background: rgba(47, 75, 216, 0.14); color: #2f4bd8; }
/* 日报入口：外观同其他媒体标签，但它打开的是整版报纸
   —— 用左侧竖线把它与用户自建媒体区隔开，暗示「官方印刷品」 */
.outlet-tab.is-newspaper {
  position: relative;
  border-color: rgba(var(--accent-rgb), 0.32);
  color: var(--text-primary);
}
.outlet-tab.is-newspaper::after {
  content: '';
  position: absolute;
  right: -5px; top: 18%;
  width: 1px; height: 64%;
  background: var(--glass-border);
}
.outlet-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--danger);
  flex-shrink: 0;
}

/* ── 板块 chip ── */
.board-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 20px 12px;
  flex-shrink: 0;
}
.board-label { font-weight: 500; }
.board-count { font-size: 11px; opacity: 0.7; }

/* ── 周刊 / 海报：全宽版式列表 ──
   限宽居中 —— 这两类版式是"印刷品"排版，铺满 1920px 会极难读 */
.special-list {
  display: flex; flex-direction: column; gap: 18px;
  padding: 0 20px;
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

/* ── 瀑布流（CSS 多列，卡片高度自然错落）── */
.masonry {
  column-count: 4;
  column-gap: 14px;
  padding: 0 20px;
}
@media (max-width: 1500px) { .masonry { column-count: 3; } }
@media (max-width: 1050px) { .masonry { column-count: 2; } }
@media (max-width: 700px)  { .masonry { column-count: 1; } }

.post-card {
  break-inside: avoid;
  margin-bottom: 14px;
  border-radius: 14px;
  overflow: hidden;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.post-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
/* 角色本人的帖子描一圈主题色，一眼区分 */
.post-card.is-char { border-color: rgba(var(--accent-rgb), 0.4); }

/* 封面统一 3:2。
   原来用原图比例（height:auto），生图是 4:3 → 封面 272px 比列宽（约 247px）还高，
   整页被拉得极长；而没图的帖子只有 132px，两者差 140px，多列布局下参差不齐。
   统一比例后：①卡片高度一致 ②一屏能看到更多 ③横版更像信息流。
   3:2 而非 16:9 —— 只裁掉约 11%，AI 插画的主体基本不会丢。 */
.post-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  background: var(--bg-tertiary);
}
.post-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* 无图占位：与图片封面同尺寸，内容垂直居中（否则字挤在顶部、下面一大片空） */
.cover-ph {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; justify-content: center; gap: 8px;
  padding: 20px 16px;
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.16), rgba(var(--accent-rgb), 0.04));
}
.cover-ph-outlet { font-size: 11px; color: var(--accent); font-weight: 600; }
.cover-ph-title {
  font-size: 15px; font-weight: 700; color: var(--text-bright); line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
}
.cover-likes {
  position: absolute;
  top: 8px; left: 8px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px; font-weight: 700;
  backdrop-filter: blur(4px);
}
.cover-board {
  position: absolute;
  right: 8px; bottom: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 10px; font-weight: 600;
  backdrop-filter: blur(4px);
}

/* ── 卡片悬浮操作（重新生图 / 删除）── */
.cover-ops {
  position: absolute;
  top: 8px; right: 8px;
  display: flex; gap: 5px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.post-card:hover .cover-ops,
.post-card:focus-within .cover-ops { opacity: 1; transform: translateY(0); }
/* 触屏没有 hover → 常显，否则按不到 */
@media (hover: none) {
  .cover-ops { opacity: 1; transform: none; }
}
.cover-op {
  width: 30px; height: 30px;
  /* ★ 必须显式清掉全局 `button { padding: 7px 14px }`（styles/base.css）。
     配合 `* { box-sizing: border-box }`，26px 宽的按钮减去左右各 14px 内边距后
     内容宽度正好是 0 —— 图标会被压成 0 宽彻底看不见，只剩一个空白方块。 */
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 9px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.15s, transform 0.15s;
  -webkit-tap-highlight-color: transparent;
}
/* 图标给足尺寸并禁止收缩：flex 容器里 svg 默认 flex-shrink:1，容器一紧就被压扁 */
.cover-op svg {
  width: 17px; height: 17px;
  flex: none;
}
.cover-op:hover:not(:disabled) { background: rgba(0, 0, 0, 0.8); transform: scale(1.08); }
.cover-op.is-danger:hover:not(:disabled) { background: rgba(198, 52, 52, 0.95); }
.cover-op:disabled { opacity: 0.45; cursor: default; }

/* ── 周刊/海报：整幅版式 + 下方操作条 ── */
.special-wrap { display: flex; flex-direction: column; gap: 8px; }
.special-ops {
  display: flex; align-items: center; gap: 10px;
  padding: 0 2px;
}
.special-open {
  font-size: 12px; color: var(--text-secondary); cursor: pointer;
  padding: 4px 8px; border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.special-open:hover { color: var(--accent); background: rgba(var(--accent-rgb), 0.08); }

/* ── 详情弹窗顶部操作条 ── */
.detail-ops {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
/* 详情里的版式：去掉外投影（弹窗内已经有层次了） */
.mp-detail-panel :deep(.weekly),
.mp-detail-panel :deep(.poster) { box-shadow: none; border-radius: 10px; }

.post-body { padding: 10px 12px 12px; }
.post-author { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.author-avatar {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex-shrink: 0;
  background: var(--accent); color: #fff;
  font-size: 11px; font-weight: 700;
}
.author-avatar img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.author-avatar.is-char { box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.35); }
.author-name { font-size: 12px; color: var(--text-secondary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.author-name.is-char { color: var(--accent); font-weight: 600; }
.author-badge {
  flex-shrink: 0;
  font-size: 9px; font-weight: 700;
  padding: 1px 5px; border-radius: 4px;
  background: rgba(var(--accent-rgb), 0.16); color: var(--accent);
}

.post-title { margin: 0 0 5px; font-size: 14px; font-weight: 700; color: var(--text-bright); line-height: 1.45; }
/* 摘要 3 行（原 4 行）：与固定比例封面配合，让整列卡片高度更接近，减少参差 */
.post-excerpt {
  margin: 0; font-size: 12px; line-height: 1.65; color: var(--text-secondary);
  display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.post-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.tag { font-size: 10px; color: var(--accent); background: rgba(var(--accent-rgb), 0.08); padding: 1px 6px; border-radius: 5px; }
.post-foot { display: flex; gap: 12px; margin-top: 9px; font-size: 11px; color: var(--text-secondary); opacity: 0.75; }
.foot-item { display: inline-flex; align-items: center; gap: 3px; }

/* ── 空 / 加载 ── */
.media-empty { padding: 60px 24px; text-align: center; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin: 0 0 8px; }
.empty-hint { font-size: 12px; color: var(--text-secondary); opacity: 0.75; line-height: 1.7; margin: 0 auto; max-width: 460px; }
.empty-retry { margin-top: 14px; }
.media-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 50px; font-size: 13px; color: var(--text-secondary); }
.spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(var(--accent-rgb), 0.2); border-top-color: var(--accent);
  animation: media-spin 0.7s linear infinite;
}
@keyframes media-spin { to { transform: rotate(360deg); } }
.load-more { text-align: center; padding: 20px; font-size: 12px; color: var(--accent); cursor: pointer; }
.load-more.is-end { color: var(--text-secondary); opacity: 0.6; cursor: default; }

/* ── 帖子详情 ── */
.post-detail { display: flex; flex-direction: column; gap: 12px; }
.detail-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.detail-author { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-bright); }
.detail-stats { font-size: 12px; color: var(--text-secondary); }
.detail-img { width: 100%; border-radius: 12px; display: block; }
.detail-content { margin: 0; font-size: 13px; line-height: 1.85; color: var(--text-primary); white-space: pre-wrap; }
.detail-stats-row { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); }
.comment-list { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); }
.comment-item { display: flex; gap: 8px; font-size: 12px; line-height: 1.7; }
.comment-author { flex-shrink: 0; font-weight: 600; color: var(--accent); }
.comment-text { color: var(--text-secondary); }
.comment-empty { font-size: 12px; color: var(--text-secondary); opacity: 0.7; }

@media (max-width: 767px) {
  .media-header { padding: 8px 12px; gap: 8px; }
  .btn-mobile-back { width: 34px; height: 34px; }
  .btn-op, .btn-refresh { padding: 6px 12px; }
  /* 窄屏顶栏挤：帖子总数去掉（分类标签上已有数字） */
  .media-count { display: none; }
  /* 频率 chip 只留档位文字 */
  .auto-chip { padding: 6px 10px; font-size: 11px; }
  .auto-chip svg:first-child { display: none; }
  .freq-panel { padding: 10px 14px 12px; }
  .freq-row { gap: 10px; }
  .freq-label { font-size: 12px; }
  .freq-val { min-width: 52px; font-size: 12px; }
  /* 分类三档放不下 → 缩小 + 去掉图标，横向滚动 */
  .cat-bar { gap: 0; }
  .cat-tab { padding: 7px 9px; font-size: 12px; gap: 4px; }
  .cat-icon { display: none; }
  .cat-num { padding: 1px 5px; font-size: 10px; }
  .outlet-bar { padding: 10px 14px 8px; }
  .np-entry-wrap { padding: 12px 14px; }
  .np-entry { padding: 16px; gap: 12px; }
  .np-entry-icon { font-size: 26px; }
  .np-entry-title { font-size: 15px; }
  .np-entry-go { display: none; }
  .board-bar { padding: 0 14px 10px; }
  .masonry { padding: 0 14px; }
  .special-list { padding: 0 14px; gap: 14px; }
}
</style>
