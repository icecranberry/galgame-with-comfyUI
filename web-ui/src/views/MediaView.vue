<template>
  <div class="media-view">
    <div class="media-shell">
      <section class="media-deck" aria-label="传媒导航">
        <header class="media-deck-header">
          <div class="media-heading">
            <media-game-button
              v-if="isMobile"
              variant="icon"
              aria-label="打开导航"
              @click="toggleMobileSidebar?.()"
            >
              ‹
            </media-game-button>
            <div class="media-brand">
              <span class="media-kicker">邻舍情报站 / LOCAL SIGNAL</span>
              <h1>
                大新闻
                <span aria-hidden="true">!!</span>
              </h1>
              <span class="media-brand-caption">不是，这也能上新闻？</span>
            </div>
            <span class="media-sticker" aria-hidden="true">
              街巷
              <br />
              新鲜事
              <span>✦</span>
            </span>
          </div>
          <div class="media-console">
            <div class="console-topline">
              <span class="console-label">
                <span aria-hidden="true">◈</span>
                选择你的信息频道
              </span>
              <div class="header-actions">
                <media-game-button variant="ghost" @click="showSettings = true">
                  媒体设置
                </media-game-button>
                <media-game-button
                  v-if="activeCategory !== 'traditional'"
                  variant="primary"
                  :loading="refreshing"
                  @click="onRefresh"
                >
                  <span v-if="!refreshing" aria-hidden="true">↻</span>
                  {{ refreshing ? '收集中…' : '刷新内容' }}
                </media-game-button>
              </div>
            </div>
            <div class="media-category">
              <linshe-tabs
                variant="comic"
                :model-value="activeCategory"
                :options="categoryOptions"
                aria-label="内容分类"
                @update:model-value="onCategoryChange"
              />
            </div>
          </div>
        </header>
        <div v-if="activeCategory !== 'traditional'" class="media-deck-channels">
          <span class="channel-label">
            {{ activeCategory === 'traditional' ? '今日读物' : '收听频道' }}
          </span>
          <div v-if="activeCategory !== 'traditional'" class="tabs-scroll" @wheel="scrollChannelTabs">
            <linshe-tabs
              variant="comic"
              size="sm"
              :model-value="activeOutlet ?? 'all'"
              :options="outletOptions"
              aria-label="选择媒体"
              @update:model-value="
                onOutletChange($event === 'all' ? null : $event)
              "
            />
          </div>
          <span v-else class="daily-caption">邻舍日报 · 每天零点印发</span>
          <media-game-button
            v-if="activeCategory !== 'traditional'"
            class="auto-action"
            size="sm"
            variant="ghost"
            :aria-expanded="freqOpen"
            aria-controls="media-frequency"
            @click="freqOpen = !freqOpen"
          >
            自动 · {{ autoLabel }} {{ freqOpen ? '⌃' : '⌄' }}
          </media-game-button>
        </div>
        <div
          v-if="activeCategory !== 'traditional' && boards.length"
          class="media-deck-boards"
        >
          <span class="filter-label">话题分区</span>
          <div class="tabs-scroll">
            <linshe-tabs
              variant="comic"
              size="sm"
              :model-value="activeBoard ?? 'all'"
              :options="boardOptions"
              aria-label="选择板块"
              @update:model-value="
                onBoardChange($event === 'all' ? null : $event)
              "
            />
          </div>
        </div>
        <Transition name="media-fade">
          <section
            v-if="freqOpen && activeCategory !== 'traditional'"
            id="media-frequency"
            class="frequency-panel"
          >
            <div class="frequency-intro">
              <span class="frequency-kicker">AUTO TUNE / 收讯节奏</span>
              <h2>
                自动更新频率
                <span aria-hidden="true">↻</span>
              </h2>
              <p>给情报站设个节奏，新消息按时送达。</p>
              <span class="frequency-status">
                {{ auto.minutes === 0 ? '手动收讯' : '自动收讯中' }}
              </span>
            </div>
            <div class="frequency-controls" :aria-busy="freqSaving">
              <div
                class="frequency-presets"
                role="group"
                aria-label="自动更新频率"
              >
                <media-game-button
                  v-for="(step, i) in steps"
                  :key="step.minutes"
                  size="sm"
                  :variant="stepIdx === i ? 'primary' : 'secondary'"
                  :aria-pressed="stepIdx === i"
                  :disabled="freqSaving"
                  :title="step.hint"
                  @click="applyFreq(i)"
                >
                  <span v-if="stepIdx === i" aria-hidden="true">✓</span>
                  {{ step.label }}
                </media-game-button>
              </div>
              <div class="frequency-note" role="status">
                <span class="frequency-note-label">
                  {{ freqSaving ? '保存中' : '当前档位' }}
                </span>
                <p>{{ currentStep?.hint }}</p>
                <span
                  v-if="auto.minutes > 0 && nextInText"
                  class="frequency-countdown"
                >
                  {{
                    nextInText === '即将'
                      ? '即将更新'
                      : '下次约 ' + nextInText + '后'
                  }}
                </span>
              </div>
            </div>
          </section>
        </Transition>
      </section>
      <div v-if="activeCategory !== 'traditional'" class="list-toolbar">
        <template v-if="!batchMode">
          <div class="toolbar-note">
            <h2 class="toolbar-heading">
              <span aria-hidden="true">✦</span>
              {{ activeCategory === 'digital' ? '本期刊物' : '街巷热议' }}
            </h2>
            <span v-if="!loading" class="toolbar-count">
              <b>{{ total }}</b>
              篇
            </span>
            <span class="toolbar-rule" aria-hidden="true" />
          </div>
          <media-game-button
            size="sm"
            variant="ghost"
            :disabled="!posts.length || loading"
            @click="enterBatchMode"
          >
            批量管理
          </media-game-button>
        </template>
        <template v-else>
          <span class="batch-count">
            已选
            <b>{{ selectedPostIds.size }}</b>
            项
          </span>
          <media-game-button
            size="sm"
            variant="ghost"
            :disabled="batchBusy"
            @click="selectAllVisible"
          >
            {{ allVisibleSelected ? '取消全选' : '全选本页' }}
          </media-game-button>
          <div class="toolbar-spacer"></div>
          <media-game-button
            size="sm"
            :disabled="batchBusy || !selectedPostIds.size"
            @click="batchRegenerate"
          >
            重新生图
          </media-game-button>
          <media-game-button
            size="sm"
            variant="danger"
            :disabled="batchBusy || !selectedPostIds.size"
            @click="batchDelete"
          >
            删除
          </media-game-button>
          <media-game-button
            size="sm"
            variant="ghost"
            :disabled="batchBusy"
            @click="exitBatchMode"
          >
            完成
          </media-game-button>
        </template>
      </div>
      <Transition name="media-fade" mode="out-in">
        <section
          :key="activeCategory + ':' + activeOutlet + ':' + activeBoard"
          class="media-content"
          :aria-busy="loading"
        >
          <NewspaperFeed
            v-if="activeCategory === 'traditional'"
            :today-paper="newspaperStore.todayPaper"
            :unread="newspaperUnread"
            :refresh-key="newspaperRefreshKey"
            @open="openNewspaper"
          />
          <div
            v-else-if="loading"
            class="post-grid"
            role="status"
            aria-label="正在加载内容"
          >
            <div v-for="i in 6" :key="i" class="post-skeleton">
              <div class="skeleton skeleton-cover"></div>
              <div class="skeleton skeleton-line"></div>
              <div class="skeleton skeleton-line short"></div>
            </div>
          </div>
          <template v-else>
            <!-- ── 周刊 / 海报：全宽版式，不参与瀑布流列布局 ──
         （选中这类媒体时 feedPosts 为空，页面上就只有下面这一块） -->
            <div
              v-if="activeCategory !== 'traditional' && specialPosts.length"
              class="special-list"
            >
              <div
                v-for="p in specialPosts"
                :key="p.id"
                class="special-wrap"
                :class="[
                  `is-${postKind(p)}`,
                  {
                    'is-selecting': batchMode,
                    'is-picked': selectedPostIds.has(p.id)
                  }
                ]"
              >
                <!-- 批量模式：整幅版式外左侧一个勾选行（版式本身不适合在图上贴勾选框） -->
                <button
                  v-if="batchMode"
                  type="button"
                  class="special-pick"
                  :class="{ on: selectedPostIds.has(p.id) }"
                  @click="togglePick(p.id)"
                >
                  <span
                    class="pick-box"
                    :class="{ on: selectedPostIds.has(p.id) }"
                    aria-hidden="true"
                  >
                    <svg
                      v-if="selectedPostIds.has(p.id)"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <span class="special-pick-title">
                    {{ p.title || kindLabel(p) }}
                  </span>
                </button>
                <component
                  :is="componentFor(p)"
                  :openable="!batchMode"
                  @open="openPost(p)"
                  :post="p"
                  @zoom="zoomSrc = $event"
                  @section-loaded="onSectionLoaded"
                  @section-error="onSectionError"
                />

              </div>
            </div>

            <!-- ── 帖子流：瀑布流 ── -->
            <div
              v-if="activeCategory !== 'traditional' && feedPosts.length"
              class="masonry"
            >
              <div
                v-for="(column, index) in feedColumns"
                :key="index"
                class="masonry-column"
              >
                <article
                  v-for="p in column"
                  :key="p.id"
                  class="post-card"
                  :class="{
                    'is-char': p.author_type === 'character',
                    'is-selecting': batchMode,
                    'is-picked': selectedPostIds.has(p.id)
                  }"
                  role="button"
                  tabindex="0"
                  :aria-label="(batchMode ? '选择：' : '阅读：') + p.title"
                  @keydown.enter.self.prevent="onCardClick(p)"
                  @keydown.space.self.prevent="onCardClick(p)"
                  @click="onCardClick(p)"
                >
                  <!-- 批量模式：卡片左上角勾选框。整卡可点（拿不到鼠标的触屏也好用），
               所以这里只做视觉，不单独绑事件。 -->
                  <span
                    v-if="batchMode"
                    class="pick-box"
                    :class="{ on: selectedPostIds.has(p.id) }"
                    aria-hidden="true"
                  >
                    <svg
                      v-if="selectedPostIds.has(p.id)"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <!-- 封面：有图用图，没图用渐变占位（配图由后台补印） -->
                  <div class="post-cover">
                    <img
                      v-if="p.image"
                      :src="bustUrlIfOverwritten(p.image)"
                      loading="lazy"
                      decoding="async"
                      alt=""
                    />
                    <div v-else class="cover-ph">
                      <span v-if="p.outlet_name" class="cover-ph-outlet">
                        {{ p.outlet_name }}
                      </span>
                      <span class="cover-ph-title">{{ p.title }}</span>
                    </div>
                    <span class="cover-likes">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 21s-7.5-4.7-9.6-9A5.6 5.6 0 0 1 12 6.1 5.6 5.6 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z"
                        />
                      </svg>
                      {{ formatNum(p.likes) }}
                    </span>
                    <span v-if="p.board_name" class="cover-board">
                      {{ p.board_name }}
                    </span>
                    <!-- 悬浮操作：重新生图 / 删除（@click.stop 防止连带打开详情） -->
                    <div class="cover-ops">
                      <button
                        type="button"
                        class="cover-op"
                        title="重新生图"
                        :disabled="busyPostId !== null"
                        @click.stop="regenerateImage(p)"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                          <path d="M21 3v5h-5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="cover-op is-danger"
                        title="删除"
                        :disabled="busyPostId !== null"
                        @click.stop="removePost(p)"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path
                            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                          />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                  </div>
  
                  <div class="post-body">
                    <div class="post-author">
                      <span
                        class="author-avatar"
                        :class="{ 'is-char': p.author_type === 'character' }"
                      >
                        <img
                          v-if="p.author_avatar"
                          :src="p.author_avatar"
                          alt=""
                        />
                        <span v-else>{{ (p.author_name || '?').charAt(0) }}</span>
                      </span>
                      <span
                        class="author-name"
                        :class="{ 'is-char': p.author_type === 'character' }"
                      >
                        {{ p.author_name }}
                      </span>
                    </div>
                    <h3 class="post-title">{{ p.title }}</h3>
                    <p class="post-excerpt">{{ p.content }}</p>
                    <div v-if="p.tags.length" class="post-tags">
                      <span v-for="t in p.tags" :key="t" class="tag">
                        #{{ t }}
                      </span>
                    </div>
                    <div class="post-foot">
                      <span class="foot-item">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          aria-hidden="true"
                        >
                          <path
                            d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"
                          />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        {{ formatNum(p.views) }}
                      </span>
                      <span class="foot-item">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          aria-hidden="true"
                        >
                          <path
                            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                          />
                        </svg>
                        {{ p.comments.length }}
                      </span>
                    </div>
                  </div>
                </article>
              </div>
            </div>

            <div
              v-if="!posts.length"
              class="media-empty"
              :class="{ 'is-error': !!loadError }"
            >
              <div class="empty-art" aria-hidden="true">
                <span class="empty-art-spark">✦</span>
                <span class="empty-art-sheet" />
                <span class="empty-symbol">{{ loadError ? '!' : '…' }}</span>
                <span class="empty-stamp">
                  {{ loadError ? '收讯中断' : '故事待续' }}
                </span>
              </div>
              <div class="empty-copy">
                <span class="empty-kicker">
                  {{
                    loadError
                      ? 'SIGNAL LOST / 收讯异常'
                      : 'STAY TUNED / 等待新消息'
                  }}
                </span>
                <h3 v-if="loadError">
                  内容暂时没有送达
                  <span class="empty-punctuation" aria-hidden="true">!</span>
                </h3>
                <h3 v-else>
                  新的故事，
                  <br />
                  还在路上
                  <span class="empty-punctuation" aria-hidden="true">!!</span>
                </h3>
                <p>
                  {{
                    loadError ||
                    (refreshing
                      ? '正在收集邻里的新鲜事，稍候就来。'
                      : '这里还没有帖子，刷新内容，收听邻里的新鲜事。')
                  }}
                </p>
                <media-game-button
                  v-if="loadError"
                  size="sm"
                  @click="reloadAll"
                >
                  重新加载
                  <span aria-hidden="true">↗</span>
                </media-game-button>
                <media-game-button
                  v-else
                  size="sm"
                  :loading="refreshing"
                  @click="onRefresh"
                >
                  <span v-if="!refreshing" aria-hidden="true">↻</span>
                  {{ refreshing ? '收集中…' : '刷新内容' }}
                </media-game-button>
              </div>
            </div>
            <div v-if="posts.length" class="list-end">
              <media-game-button
                v-if="hasMore"
                :loading="loadingMore"
                @click="loadMore"
              >
                加载更多
              </media-game-button>
              <span v-else>已经读到这里的最后一篇了</span>
            </div>
          </template>
        </section>
      </Transition>
    </div>
    <MediaPostDetail
      :visible="detailVisible"
      :post="detailPost"
      :kind="postKind(detailPost)"
      :busy="busyPostId !== null"
      :regenerating="!!detailPost && regeneratingId === detailPost.id"
      @close="detailVisible = false"
      @delete="removePost"
      @regenerate="regenerateImage"
      @zoom="zoomSrc = $event"
    >
      <component
        v-if="detailPost && postKind(detailPost) !== 'feed'"
        :is="componentFor(detailPost)"
        :key="detailPost.id"
        :post="detailPost"
        @zoom="zoomSrc = $event"
        @section-loaded="onSectionLoaded"
        @section-error="onSectionError"
      />
    </MediaPostDetail>
    <Teleport to="body">
      <div style="--vel-z-index: 14000">
        <ImageLightbox
          :visible="!!zoomSrc"
          :imgs="zoomSrc ? [zoomSrc] : []"
          :show-regenerate="true"
          :show-upscale="true"
          :show-delete="false"
          @hide="zoomSrc = ''"
        />
      </div>
    </Teleport>
    <MediaSettingsModal
      v-model="showSettings"
      :outlets="outlets"
      @changed="reloadAll"
    />
    <NewspaperModal
      v-model="showNewspaper"
      :initial-date="newspaperDate"
      @read="onNewspaperRead"
      @close="newspaperRefreshKey++"
    />
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import * as api from '../api/index.js'
import MediaGameButton from '../components/media/MediaGameButton.vue'
import LinsheTabs from '../components/ui/LinsheTabs.vue'
import MediaPostDetail from '../components/media/MediaPostDetail.vue'
import MediaSettingsModal from '../components/MediaSettingsModal.vue'
import NewspaperModal from '../components/NewspaperModal.vue'
import MediaWeekly from '../components/media/MediaWeekly.vue'
import MediaPoster from '../components/media/MediaPoster.vue'
import MediaPortal from '../components/media/MediaPortal.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import { bustUrlIfOverwritten } from '../utils/imageUrlRefresh.js'
import { onEvent } from '../stores/unifiedStream.js'
import { applyMediaImageUpdate, applyMediaPortalReady } from '../utils/mediaImageUpdates.js'
import { scrollHorizontalOnWheel as scrollChannelTabs } from '../utils/horizontalScroll.js'
import { readMediaSeen, markMediaSeen, mediaCategoryUnread, chooseMediaCategory } from '../utils/mediaCategoryEntry.js'
import NewspaperFeed from '../components/media/NewspaperFeed.vue'
import { useNewspaperStore } from '../stores/newspaper.js'

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const toastFn = inject('toast')
/** 删除确认用（全站统一的确认弹窗） */
const confirmFn = inject('confirm', null)

// ── 《邻舍日报》入口 ──
// 预览复用当期日报缓存；真正打开整版后才消费未读状态。
const newspaperStore = useNewspaperStore()
const showNewspaper = ref(false)
const newspaperDate = ref('')
const newspaperRefreshKey = ref(0)
const newspaperUnread = computed(() => newspaperStore.unread)
function openNewspaper(paper) {
  newspaperDate.value = paper?.publish_date || ''
  showNewspaper.value = true
}
function onNewspaperRead(paper) {
  try {
    newspaperStore.markRead(paper)
  } catch {
    /* 失败不阻塞，轮询会兜底 */
  }
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
const detailVisible = ref(false)
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
  {
    key: 'traditional',
    label: '传统报纸',
    icon: '📰',
    hint: '《邻舍日报》—— 整版报纸，每天零点印发'
  },
  {
    key: 'digital',
    label: '数字报刊',
    icon: '📸',
    hint: '周刊 / 海报 —— 按期出刊的数字刊物'
  },
  {
    key: 'social',
    label: '社交平台',
    icon: '💬',
    hint: '瀑布流社交平台 —— 论坛/职场/暗网等'
  }
]
// 等待更新状态后只选择一次入口，避免先闪到随机分类；用户手动选择优先。
const activeCategory = ref('')
const seenMedia = ref(readMediaSeen())
const latestMedia = ref({ digital: 0, social: 0 })
const categoryUnread = computed(() => mediaCategoryUnread(latestMedia.value, seenMedia.value, newspaperUnread.value))

async function refreshMediaUnread() {
  await Promise.all(['digital', 'social'].map(async category => {
    try {
      const data = await api.listMediaPosts({ category, limit: 1 })
      latestMedia.value[category] = data.posts?.[0]?.id || 0
    } catch { /* 查询失败不覆盖已有更新状态，也不阻塞其他分类 */ }
  }))
}

/** 当前分类下的媒体（普通用户自建媒体） */
/**
 * 媒体是否属于「数字报刊」。
 *
 * ★ 必须与后端 `listPosts` 的分类口径**逐字对齐**（`services/mediaService.js`）：
 *     digital → `o.layout IN ('weekly','poster','portal')`
 *     social  → `o.layout IS NULL OR o.layout = 'feed'`
 *
 * ⚠️ 这两处曾经各自硬编码 `layout === 'weekly' || layout === 'poster'`。
 *    portal 迁移（周刊/海报 → 门户）时只改了后端、**漏了前端**，结果两个刊
 *    在后端分类里属「数字报刊」，前端标签栏却把它们判定成"非数字"→ 归进社交平台。
 *    新增 layout 形态时，**后端 listPosts 与这里必须一起改**。
 */
function isDigitalOutlet(o) {
  const layout = o.layout || 'feed'
  return layout === 'weekly' || layout === 'poster' || layout === 'portal'
}

const filteredOutlets = computed(() => {
  if (activeCategory.value === 'traditional') return []
  const wantDigital = activeCategory.value === 'digital'
  return outlets.value.filter((o) => isDigitalOutlet(o) === wantDigital)
})

/** 「全部」标签上的数字：当前分类下所有媒体的帖子数之和 */
const categoryTotal = computed(() =>
  filteredOutlets.value.reduce((s, o) => s + (o.post_count || 0), 0)
)

async function onCategoryChange(key) {
  if (activeCategory.value === key) return
  // 换分类 = 整批内容都换了 → 退出批量模式（传统报纸没有帖子流，批量也不适用）
  if (batchMode.value) exitBatchMode()
  activeCategory.value = key
  activeOutlet.value = null
  activeBoard.value = null
  boards.value = []
  loadError.value = ''
  freqOpen.value = false
  if (key === 'traditional') {
    ++loadSeq
    loading.value = false
    posts.value = []
    total.value = 0
    return
  }
  await loadPage(0)
}

// ── 自动抓帖频率 ──
// 档位表以后端下发的 MEDIA_AUTO_STEPS 为准（前后端口径唯一）；
// 这里留一份**兜底副本**：后端还没重启 / 接口临时不通时，控件至少是可用的、不显示空白。
// 改档位时记得两边一起改（后端口径在 services/mediaService.js）。
const FALLBACK_AUTO_STEPS = [
  { minutes: 0, label: '关闭', hint: '不自动抓帖，只有你点「刷新」时才生成。' },
  { minutes: 720, label: '12 小时', hint: '一天两批，几乎不占算力。' },
  { minutes: 240, label: '4 小时', hint: '一天六批，内容慢慢积累。' },
  { minutes: 120, label: '2 小时', hint: '一天十几批。' },
  { minutes: 60, label: '1 小时', hint: '每小时一批（每批 3 条）。' },
  { minutes: 20, label: '20 分钟', hint: '默认节奏，社区一直有新鲜感。' },
  { minutes: 10, label: '10 分钟', hint: '比较频繁，LLM 消耗明显上升。' },
  {
    minutes: 5,
    label: '5 分钟',
    hint: '最频繁档；每批 3 条要调一次 LLM，烧 token 很快。'
  }
]

const freqOpen = ref(false)
const freqSaving = ref(false)
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
  const exact = list.findIndex((s) => s.minutes === m)
  if (exact >= 0) return exact
  let best = 0,
    bestDiff = Infinity
  list.forEach((s, i) => {
    const d = Math.abs(s.minutes - m)
    if (d < bestDiff) {
      bestDiff = d
      best = i
    }
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
    if (d.auto) {
      auto.value = d.auto
      _autoSyncAt = Date.now()
    }
  } catch (err) {
    // 后端未重启/接口不通：保留兜底档位表，控件仍可操作
    console.warn(
      '[media] 读取自动频率失败（用兜底档位表）:',
      err?.message || err
    )
  }
}

async function applyFreq(i) {
  if (freqSaving.value) return
  const s = steps.value[i]
  if (!s || s.minutes === auto.value.minutes) {
    freqOpen.value = true
    return
  }
  const prev = auto.value.minutes
  freqSaving.value = true
  auto.value = { ...auto.value, minutes: s.minutes }
  try {
    const d = await api.setMediaAuto(s.minutes)
    if (d.auto) {
      auto.value = d.auto
      _autoSyncAt = Date.now()
    }
    if (d.steps) steps.value = d.steps
    toastFn?.(
      s.minutes === 0
        ? '已关闭自动抓帖（仍可手动刷新）'
        : `自动抓帖已设为每 ${s.label}一批`,
      'success'
    )
  } catch (err) {
    console.error('[media] 保存自动频率失败:', err)
    auto.value = { ...auto.value, minutes: prev }
    // 404 = 后端还没重启（这条路由是新增的），提示要说清楚，别让用户以为是网络问题
    toastFn?.('保存失败' + '：' + (err?.message || ''), 'error')
  } finally {
    freqSaving.value = false
  }
}

const categoryOptions = computed(() =>
  CATEGORIES.map((c, index) => ({
    value: c.key,
    label: c.label,
    eyebrow: '0' + (index + 1) + ' / ' + ['PAPER', 'MAGAZINE', 'SOCIAL'][index],
    badge: categoryUnread.value[c.key] ? '更新' : '',
    title: c.hint
  }))
)
const outletOptions = computed(() => [
  { value: 'all', label: '全部 · ' + categoryTotal.value },
  ...filteredOutlets.value.map((o) => ({
    value: o.id,
    label: (o.icon ? o.icon + ' ' : '') + o.name + ' · ' + (o.post_count || 0),
    title: o.tagline || o.name
  }))
])
const boardOptions = computed(() =>
  boardChips.value.map((b) => ({
    value: b.id ?? 'all',
    label: b.name + ' · ' + b.post_count
  }))
)
// 板块 chip：首位「全部」，其余为当前媒体的板块
const boardChips = computed(() => {
  const sum = boards.value.reduce((s, b) => s + (b.post_count || 0), 0)
  return [{ id: null, name: '全部', post_count: sum }, ...boards.value]
})

const hasMore = computed(() => posts.value.length < total.value)

/**
 * 帖子版式类型 —— **按 payload 形态判定，不看 outlet.layout**。
 *
 * ★ 为什么必须这样：`layout` 来自 outlet（listPosts 里 `o.layout AS layout`）。
 *   狸狸通讯社/八卦从 weekly/poster 迁成 portal 之后，**它们已有的老帖也会被标成 portal**，
 *   按 layout 分派就会把老周刊丢给门户组件渲染 → `payload.sections` 不存在 → 一片**空白**。
 *   按 payload 形态判定天然兼容：有 sections 才是门户。
 *
 * ⚠️ 同时要求 payload 存在：早期版本（layout 还没引入时）生成的狸狸八卦帖子只有
 *   title/content、没有 payload_json。若只看 outlet.layout，版式组件会因 `v-if="data"`
 *   不通过而渲染成空白；这里退回 feed 卡片，正常显示标题与正文。
 */
function postKind(p) {
  const pl = p?.payload
  if (!pl) return 'feed'
  if (pl.portal && Array.isArray(pl.sections)) return 'portal'
  if (Array.isArray(pl.columns)) return 'weekly'
  if (Array.isArray(pl.panels)) return 'poster'
  return 'feed'
}
/** 整幅版式（不是瀑布流卡片）：周刊 / 海报 / 门户 */
function isSpecialPost(p) {
  return postKind(p) !== 'feed'
}
const feedPosts = computed(() => posts.value.filter((p) => !isSpecialPost(p)))

// 与历史奇遇一致：轮流分配到显式列，避免 CSS 多列平衡后整列留空。
const feedViewportWidth = ref(window.innerWidth)
function updateFeedViewportWidth() {
  feedViewportWidth.value = window.innerWidth
}
const feedColumns = computed(() => {
  const width = feedViewportWidth.value
  const count = width > 1500 ? 4 : width > 1050 ? 3 : width > 700 ? 2 : 1
  const columns = Array.from({ length: count }, () => [])
  feedPosts.value.forEach((post, index) => columns[index % count].push(post))
  return columns
})
onMounted(() => window.addEventListener('resize', updateFeedViewportWidth))
onUnmounted(() => window.removeEventListener('resize', updateFeedViewportWidth))

const specialPosts = computed(() => posts.value.filter(isSpecialPost))

/** 版式组件：按 payload 形态挑 */
const KIND_COMPONENT = {
  portal: MediaPortal,
  weekly: MediaWeekly,
  poster: MediaPoster
}
function kindLabel(p) {
  return (
    { portal: '报刊', weekly: '周刊', poster: '海报' }[postKind(p)] || '内容'
  )
}
function componentFor(p) {
  return KIND_COMPONENT[postKind(p)] || MediaWeekly
}
// ── 门户：板块正文取回后同步回本地列表 ──
// 门户组件内部已经用本地缓存显示，这里再把结果写回 posts 数组，
// 这样**关掉详情/刷新列表前**都不会丢；下次进来也少一次请求（payload 已落库）。
function onSectionLoaded({ postId, section }) {
  const target = posts.value.find((p) => p.id === postId)
  if (!target?.payload?.sections) return
  const hit = target.payload.sections.find((s) => s.key === section.key)
  if (hit) hit.body = section.body
}

function onSectionError({ sectionKey, error }) {
  toastFn?.(`「${sectionKey}」正文生成失败：${error}`, 'error')
}

function formatNum(n) {
  const v = Number(n) || 0
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(v)
}

function openPost(p) {
  detailPost.value = p
  detailVisible.value = true
}

// ── 批量操作 ──
// selectedPostIds 存帖子 id。注意：**每次修改都替换成新的 Set** ——
// ref 包 Set 时直接 .add() 不会触发视图更新（与相册的 selected 同一处理）。
const batchMode = ref(false)
const batchBusy = ref(false)
const selectedPostIds = ref(new Set())

/** 当前页（含周刊/海报）可见的全部帖子 —— 「全选本页」的作用域 */
const visiblePosts = computed(() => posts.value)

const allVisibleSelected = computed(
  () =>
    visiblePosts.value.length > 0 &&
    visiblePosts.value.every((p) => selectedPostIds.value.has(p.id))
)

function enterBatchMode() {
  if (!posts.value.length) return
  batchMode.value = true
  selectedPostIds.value = new Set()
}

function exitBatchMode() {
  batchMode.value = false
  selectedPostIds.value = new Set()
}

function togglePick(id) {
  const next = new Set(selectedPostIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedPostIds.value = next
}

function selectAllVisible() {
  selectedPostIds.value = allVisibleSelected.value
    ? new Set()
    : new Set(visiblePosts.value.map((p) => p.id))
}

/** 批量模式下点卡片 = 切换勾选；否则照旧打开详情 */
function onCardClick(p) {
  if (batchMode.value) togglePick(p.id)
  else openPost(p)
}

async function batchDelete() {
  const ids = [...selectedPostIds.value]
  if (!ids.length || batchBusy.value) return
  const message = `确定删除选中的 ${ids.length} 条内容吗？\n其中的文章与配图会一并删除，且不可恢复。`
  const ok = confirmFn
    ? await confirmFn({
        title: '批量删除',
        message,
        okText: '删除',
        danger: true
      })
    : window.confirm(message)
  if (!ok) return
  batchBusy.value = true
  try {
    const r = await api.deleteMediaPosts(ids)
    if (r?.failed) {
      toastFn?.(`已删除 ${r.deleted} 条，${r.failed} 条失败`, 'warning')
    } else {
      toastFn?.(`已删除 ${r?.deleted ?? ids.length} 条`, 'success')
    }
    exitBatchMode()
    // 必须重载：本地移除会让 loadMore 的 offset 基准失真（与相册同因）
    await reloadAll()
  } catch (err) {
    toastFn?.('批量删除失败' + '：' + (err?.message || ''), 'error')
  } finally {
    batchBusy.value = false
  }
}

async function batchRegenerate() {
  const ids = [...selectedPostIds.value]
  if (!ids.length || batchBusy.value) return
  batchBusy.value = true
  try {
    const r = await api.regenerateMediaPostImages(ids)
    if (r?.failed) {
      toastFn?.(`已排队 ${r.queued} 条，${r.failed} 条失败`, 'warning')
    } else {
      toastFn?.(
        `已排队重新生图 ${r?.queued ?? ids.length} 条，稍候…`,
        'success'
      )
    }
    exitBatchMode()
    await loadPage(0)
  } catch (err) {
    toastFn?.('批量重新生图失败' + '：' + (err?.message || ''), 'error')
  } finally {
    batchBusy.value = false
  }
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
    toastFn?.('重新生图失败' + '：' + (err?.message || ''), 'error')
  } finally {
    regeneratingId.value = null
    busyPostId.value = null
  }
}

/** 删除这条内容（含其图片文件）。破坏性操作 → 二次确认 */
async function removePost(p) {
  if (busyPostId.value !== null) return
  // 用 postKind 而不是裸 layout：迁移后两个刊的 layout 都是 portal，
  // 拿 layout 判断会把所有刊都说成「周刊」（海报也不例外）。
  const kind = postKind(p)
  const label =
    kind === 'feed'
      ? '这条内容'
      : kind === 'poster'
        ? '这一期海报'
        : kind === 'portal'
          ? '这一期刊物'
          : '这一期周刊'
  const msg = `确定删除${label}吗？\n\n「${p.title}」\n\n配图文件会一并删除，且不可恢复。`
  const ok = confirmFn
    ? await confirmFn({
        title: '删除',
        message: msg,
        okText: '删除',
        danger: true
      })
    : window.confirm(msg)
  if (!ok) return

  busyPostId.value = p.id
  try {
    await api.deleteMediaPost(p.id)
    // 本地移除，不必整页重载
    posts.value = posts.value.filter((x) => x.id !== p.id)
    total.value = Math.max(0, total.value - 1)
    if (detailPost.value?.id === p.id) detailVisible.value = false
    await reloadOutlets() // 标签上的计数要跟着变
    toastFn?.('已删除', 'success')
  } catch (err) {
    toastFn?.('删除失败' + '：' + (err?.message || ''), 'error')
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
    const selected = outlets.value.find((o) => o.id === activeOutlet.value)
    if (selected) activeCategory.value = isDigitalOutlet(selected) ? 'digital' : 'social'
    // 当前选中的媒体被删了就回到「全部」
    if (
      activeOutlet.value &&
      !outlets.value.some((o) => o.id === activeOutlet.value)
    ) {
      activeOutlet.value = null
      await reloadBoards()
    }
  } catch (err) {
    console.error('[media] 读取媒体失败:', err)
  }
}

async function reloadBoards() {
  if (!activeOutlet.value) {
    boards.value = []
    return
  }
  try {
    const d = await api.listMediaBoards(activeOutlet.value)
    boards.value = d.boards || []
  } catch (err) {
    console.error('[media] 读取板块失败:', err)
    boards.value = []
  }
}

async function loadPage(offset = 0) {
  if (disposed) return
  const seq = ++loadSeq
  // 传统报纸由 NewspaperFeed 自行加载，不请求数字报刊 / 社交帖列表。
  if (activeCategory.value === 'traditional') {
    posts.value = []
    total.value = 0
    loadError.value = ''
    loading.value = false
    return
  }
  if (offset === 0) loading.value = true
  try {
    // 没选具体媒体时按分类过滤 —— 否则「全部」会把报刊也混进来
    const d = await api.listMediaPosts({
      outlet: activeOutlet.value,
      board: activeBoard.value,
      category: activeOutlet.value ? null : activeCategory.value,
      limit: PAGE_SIZE,
      offset
    })
    if (seq !== loadSeq) return
    loadError.value = ''
    if (offset === 0) posts.value = d.posts || []
    else posts.value.push(...(d.posts || []))
    total.value = d.total || 0
    // 浏览「全部」的首页才消费该分类的更新；筛选单个媒体/板块不误清其他内容。
    if (offset === 0 && !activeOutlet.value && !activeBoard.value) {
      const latestId = Math.max(0, ...posts.value.map(post => post.id))
      latestMedia.value[activeCategory.value] = latestId
      seenMedia.value = markMediaSeen(seenMedia.value, activeCategory.value, latestId)
    }
  } catch (err) {
    console.error('[media] 读取帖子失败:', err)
    if (seq !== loadSeq) return
    // 不能只是清空 posts —— 那会让"请求失败"看起来像"这里真的没有内容"。
    // 记下错误，交给空状态渲染成「加载失败 + 重试」。
    loadError.value = err?.message || '请求失败'
    if (offset === 0) {
      posts.value = []
      total.value = 0
    }
  } finally {
    if (seq === loadSeq && offset === 0) loading.value = false
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
  // 换了媒体，之前勾选的内容已经不在列表里 → 退出批量模式，避免残留 id 指向不存在的内容
  if (batchMode.value) exitBatchMode()
  activeOutlet.value = id
  activeBoard.value = null
  await reloadBoards()
  await loadPage(0)
}

async function onBoardChange(id) {
  if (activeBoard.value === id) return
  if (batchMode.value) exitBatchMode()
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
    refreshTimer = setTimeout(() => {
      refreshing.value = false
      reloadAll()
    }, 60_000)
  } catch (err) {
    console.error('[media] 刷新失败:', err)
    toastFn?.('刷新失败：' + (err?.message || ''), 'error')
    refreshing.value = false
  }
}

async function reloadAll() {
  await reloadOutlets()
  await loadPage(0)
}

// ── SSE ──
let unsubNew = null
let unsubImg = null
let unsubPortal = null
let disposed = false

onMounted(async () => {
  // Subscribe before loading data or starting image generation.
  unsubImg = onEvent('media_image_ready', (event) => {
    for (const post of new Set([...posts.value, detailPost.value])) {
      applyMediaImageUpdate(post, event)
    }
  })
  unsubPortal = onEvent('media_portal_ready', (event) => {
    for (const post of new Set([...posts.value, detailPost.value])) {
      applyMediaPortalReady(post, event)
    }
  })
  newspaperStore.startPolling()
  await Promise.all([reloadOutlets(), loadAuto(), newspaperStore.fetchToday(), refreshMediaUnread()])
  if (disposed) return
  if (!activeCategory.value) {
    activeCategory.value = chooseMediaCategory(CATEGORIES.map(c => c.key), categoryUnread.value)
  }
  await loadPage(0)
  if (disposed) return
  loading.value = false

  // 兜底补图：把上次没出图的帖子补上（生成失败 / 当时 ComfyUI 没开）。
  // **只在打开页面时补一次**，不做后台定时扫描 —— 否则会持续占用 ComfyUI。
  api.fillMediaImages(6).catch(() => {
    /* 后端未重启时 404，忽略 */
  })

  // 倒计时每秒重算（只在展开面板时才有视觉意义，但开销可忽略）
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)

  unsubNew = onEvent('media_new_posts', async () => {
    refreshing.value = false
    clearTimeout(refreshTimer)
    await refreshMediaUnread()
    await reloadAll()
    loadAuto() // 自动批次刚跑过 → 倒计时归零重算
    toastFn?.('新帖已到', 'success')
  })
})

onUnmounted(() => {
  disposed = true
  ++loadSeq
  clearTimeout(refreshTimer)
  if (tickTimer) clearInterval(tickTimer)
  newspaperStore.stopPolling()
  if (unsubNew) unsubNew()
  if (unsubImg) unsubImg()
  if (unsubPortal) unsubPortal()
})
</script>

<style scoped>
.media-view {
  flex: 1;
  height: 100dvh;
  min-width: 0;
  overflow-y: auto;
  /* 长短频道切换及内容淡出时保留滚动条占位，避免导航宽度随之抖动。 */
  scrollbar-gutter: stable;
  color: var(--text-primary);
}
.media-shell {
  container-type: inline-size;
  container-name: media-shell;
  padding: 20px 0 32px;
}
/* 专属漫画频道台；列表卡片保持原有版式。 */
.media-deck {
  container-type: inline-size;
  container-name: media-deck;
  margin: 0 20px 24px;
  border: 3px solid var(--media-ink);
  background: var(--media-paper);
  box-shadow: 6px 6px 0 var(--media-ink);
}
.media-deck-header {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) minmax(440px, 1.2fr);
  background: var(--media-ink);
}
.media-heading {
  display: flex;
  align-items: center;
  position: relative;
  gap: 12px;
  padding: 22px 28px;
  background: var(--accent);
  color: var(--media-ink);
  overflow: hidden;
}
.media-heading::after {
  content: '';
  position: absolute;
  height: 12px;
  width: 100px;
  right: -15px;
  bottom: 0;
  transform: skewX(-30deg);
  background: repeating-linear-gradient(
    90deg,
    var(--media-ink) 0 9px,
    transparent 9px 16px
  );
}
.media-brand {
  position: relative;
  z-index: 1;
}
.media-kicker {
  display: block;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  font-weight: 700;
}
.media-heading h1 {
  margin: 3px 0 7px;
  color: var(--media-ink);
  font-size: clamp(48px, 5vw, 70px);
  font-weight: 950;
  font-style: italic;
  line-height: 1.15;
  letter-spacing: -0.08em;
  transform: rotate(-3deg);
}
.media-heading h1 > span {
  display: inline-block;
  margin-left: 8px;
  color: var(--media-light);
  -webkit-text-stroke: 2px var(--media-ink);
  text-shadow: 3px 3px 0 var(--media-ink);
}
.media-brand-caption {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.media-sticker {
  position: absolute;
  right: 24px;
  top: 36px;
  display: grid;
  place-content: center;
  width: 76px;
  height: 76px;
  background: var(--media-light);
  border: 3px solid var(--media-ink);
  color: var(--media-ink);
  box-shadow: 4px 4px 0 var(--media-ink);
  font-weight: 900;
  font-size: 18px;
  line-height: 1.25;
  transform: rotate(10deg);
}
.media-sticker > span {
  position: absolute;
  top: -19px;
  right: -15px;
  font-size: 36px;
}
.media-console {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px 24px 16px;
  gap: 18px;
}
.console-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.console-label {
  color: var(--media-light);
  font-size: 12px;
  letter-spacing: 0.06em;
}
.console-label > span {
  color: var(--accent);
  padding-right: 4px;
}
.header-actions {
  display: flex;
  gap: 12px;
  color: var(--media-light);
}
.media-category {
  min-width: 0;
}
.media-deck-channels {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-top: 3px solid var(--media-ink);
}
.channel-label {
  font-size: 12px;
  font-weight: 900;
  flex-shrink: 0;
  writing-mode: vertical-rl;
  letter-spacing: 0.16em;
  border-right: 2px solid var(--media-rule);
  padding-right: 12px;
}
.tabs-scroll {
  overflow-x: auto;
  min-width: 0;
  scrollbar-width: thin;
  padding: 3px 0;
  touch-action: pan-x pan-y pinch-zoom;
  overscroll-behavior-x: contain;
}
.tabs-scroll > * {
  width: max-content;
}
.auto-action {
  margin-left: auto;
  flex-shrink: 0;
}
.media-deck-boards {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 20px 12px;
}
.filter-label,
.daily-caption {
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  flex-shrink: 0;
}
.frequency-panel {
  display: grid;
  grid-template-columns: minmax(200px, 0.7fr) minmax(0, 2fr);
  gap: 24px;
  padding: 24px;
  border-top: 3px solid var(--media-rule);
  background: var(--bg-sunken);
}
.frequency-intro {
  min-width: 0;
  border-left: 5px solid var(--accent);
  padding-left: 16px;
}
.frequency-kicker {
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.frequency-intro h2 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
  color: var(--text-bright);
  font-size: 22px;
  font-weight: 900;
}
.frequency-intro h2 > span {
  color: var(--accent);
  font-size: 30px;
  line-height: 1;
}
.frequency-intro p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  margin: 0;
}
.frequency-status {
  display: inline-block;
  margin-top: 14px;
  padding: 4px 9px;
  background: var(--media-ink);
  color: var(--media-light);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  transform: rotate(-2deg);
}
.frequency-controls {
  min-width: 0;
  align-self: center;
}
.frequency-presets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 0 3px 3px 0;
}
.frequency-presets > * {
  min-width: 0;
}
.frequency-note {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--media-rule);
  font-size: 12px;
  line-height: 1.7;
}
.frequency-note-label {
  flex-shrink: 0;
  font-weight: 800;
  color: var(--text-bright);
}
.frequency-note p {
  flex: 1 1 200px;
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.frequency-countdown {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.list-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 20px 12px;
}
.toolbar-note {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
}
.toolbar-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 9px 18px 10px 14px;
  margin: 0;
  background: var(--media-ink);
  color: var(--media-light);
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.04em;
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
}
.toolbar-heading > span {
  color: var(--accent);
  font-size: 22px;
  line-height: 1;
}
.toolbar-count {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  flex-shrink: 0;
  color: var(--text-primary);
  font-size: 12px;
}
.toolbar-count b {
  color: var(--text-bright);
  font-size: 24px;
  font-family: monospace;
  font-style: italic;
  font-weight: 900;
}
.toolbar-rule {
  flex: 1;
  min-width: 12px;
  height: 3px;
  margin-right: 8px;
  background: var(--media-rule);
  opacity: 0.45;
}
.toolbar-spacer {
  flex: 1;
}
.batch-count {
  font-size: var(--fs-sm);
}
.batch-count b {
  color: var(--accent-hover);
}
.media-fade-enter-active,
.media-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.media-fade-enter-from,
.media-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.media-empty {
  position: relative;
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  align-items: center;
  gap: 38px;
  max-width: 740px;
  margin: 44px auto 56px;
  padding: 36px 40px;
  border: 3px solid var(--media-rule);
  background: var(--media-paper);
  box-shadow: 8px 8px 0 var(--media-ink);
}
.media-empty::after {
  content: '';
  position: absolute;
  right: 16px;
  bottom: -3px;
  width: 80px;
  height: 10px;
  background: repeating-linear-gradient(
    -55deg,
    var(--media-rule) 0 6px,
    transparent 6px 12px
  );
}
.empty-art {
  position: relative;
  height: 186px;
}
.empty-art-sheet {
  position: absolute;
  inset: 24px 22px 30px 12px;
  background: var(--bg-sunken);
  border: 3px solid var(--media-rule);
  transform: rotate(-12deg);
}
.empty-art-sheet::before,
.empty-art-sheet::after {
  content: '';
  position: absolute;
  height: 3px;
  background: var(--media-rule);
  left: 14px;
  right: 14px;
  bottom: 16px;
}
.empty-art-sheet::after {
  bottom: 27px;
  right: 36px;
}
.empty-symbol {
  position: absolute;
  inset: 12px 6px 58px 30px;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--media-ink);
  border: 3px solid var(--media-ink);
  box-shadow: 5px 5px 0 var(--media-ink);
  font-size: 70px;
  font-weight: 900;
  line-height: 1;
  transform: rotate(6deg);
}
.empty-symbol::after {
  content: '';
  position: absolute;
  bottom: -12px;
  left: 20px;
  width: 18px;
  height: 18px;
  background: var(--accent);
  border-right: 3px solid var(--media-ink);
  border-bottom: 3px solid var(--media-ink);
  transform: skewY(-35deg);
}
.empty-art-spark {
  position: absolute;
  z-index: 1;
  right: -10px;
  top: -18px;
  font-size: 50px;
  line-height: 1;
  color: var(--text-bright);
}
.empty-stamp {
  position: absolute;
  bottom: 6px;
  left: 36px;
  padding: 5px 12px;
  background: var(--media-ink);
  color: var(--media-light);
  border: 2px solid var(--media-ink);
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0.1em;
  transform: rotate(-7deg);
}
.empty-copy {
  min-width: 0;
}
.empty-kicker {
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--text-secondary);
}
.media-empty h3 {
  margin: 12px 0;
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 950;
  line-height: 1.4;
  letter-spacing: -0.025em;
  color: var(--text-bright);
}
.empty-punctuation {
  display: inline-block;
  margin-left: 8px;
  color: var(--accent);
  font-style: italic;
  transform: rotate(8deg);
}
.media-empty p {
  margin: 0 0 20px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
@container media-shell (max-width: 780px) {
  .media-empty {
    margin: 32px 20px 48px;
    gap: 24px;
    padding: 28px;
    grid-template-columns: 160px minmax(0, 1fr);
  }
}
@container media-shell (max-width: 520px) {
  .media-empty {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    margin: 28px 14px 40px;
    padding: 24px;
    text-align: center;
    box-shadow: 5px 5px 0 var(--media-ink);
  }
  .empty-art {
    width: 160px;
    height: 155px;
    margin: 0 auto;
  }
  .empty-symbol {
    font-size: 56px;
  }
  .empty-stamp {
    font-size: 14px;
    bottom: 0;
    left: 22px;
  }
  .media-empty h3 {
    font-size: 28px;
  }
  .toolbar-note {
    gap: 8px;
  }
  .toolbar-heading {
    font-size: 15px;
    padding: 9px 14px 10px 10px;
    gap: 6px;
  }
  .toolbar-count b {
    font-size: 20px;
  }
  .toolbar-rule {
    display: none;
  }
}
.list-end {
  padding: 30px 0 10px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
}
.post-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 285px), 1fr));
  gap: 20px;
  padding: 0 20px;
}
.post-skeleton {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  padding: 16px;
}
.skeleton-cover {
  height: 150px;
  border-radius: var(--radius-sm);
}
.skeleton-line {
  height: 14px;
  margin-top: 16px;
}
.skeleton-line.short {
  width: 65%;
}
.special-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 0 20px;
  /* ★ 容器放开到整宽。原来这里是 max-width:880px 居中，门户的横版卡片网格被卡在
     880px 里只能排 2 列，1920 屏两侧各空 520px —— 正是这次改造要解决的问题。
     旧版式（周刊/海报）的窄栏改由 .special-wrap.is-weekly/.is-poster 自己守。 */
  width: 100%;
  box-sizing: border-box;
}

/* ── 瀑布流：显式等宽列，按帖子顺序横向分配 ── */
.masonry {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 0 20px;
}
.masonry-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.post-card {
  border-radius: 14px;
  overflow: hidden;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}
.post-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}
/* 角色本人的帖子描一圈主题色，一眼区分 */
.post-card.is-char {
  border-color: rgba(var(--accent-rgb), 0.4);
}

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
.post-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 无图占位：与图片封面同尺寸，内容垂直居中（否则字挤在顶部、下面一大片空） */
.cover-ph {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 20px 16px;
  background: linear-gradient(
    135deg,
    rgba(var(--accent-rgb), 0.16),
    rgba(var(--accent-rgb), 0.04)
  );
}
.cover-ph-outlet {
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
}
.cover-ph-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-bright);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cover-likes {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  backdrop-filter: blur(4px);
}
.cover-board {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  backdrop-filter: blur(4px);
}

/* ── 卡片悬浮操作（重新生图 / 删除）── */
.cover-ops {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.post-card:hover .cover-ops,
.post-card:focus-within .cover-ops {
  opacity: 1;
  transform: translateY(0);
}
/* 触屏没有 hover → 常显，否则按不到 */
@media (hover: none) {
  .cover-ops {
    opacity: 1;
    transform: none;
  }
}
.cover-op {
  width: 30px;
  height: 30px;
  /* ★ 必须显式清掉全局 `button { padding: 7px 14px }`（styles/base.css）。
     配合 `* { box-sizing: border-box }`，26px 宽的按钮减去左右各 14px 内边距后
     内容宽度正好是 0 —— 图标会被压成 0 宽彻底看不见，只剩一个空白方块。 */
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition:
    background 0.15s,
    transform 0.15s;
  -webkit-tap-highlight-color: transparent;
}
/* 图标给足尺寸并禁止收缩：flex 容器里 svg 默认 flex-shrink:1，容器一紧就被压扁 */
.cover-op svg {
  width: 17px;
  height: 17px;
  flex: none;
}
.cover-op:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.08);
}
.cover-op.is-danger:hover:not(:disabled) {
  background: rgba(198, 52, 52, 0.95);
}
.cover-op:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ── 卡片勾选框（批量模式） ── */
.pick-box {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  backdrop-filter: blur(3px);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.pick-box.on {
  background: var(--accent);
  border-color: var(--accent);
}
.post-card .pick-box {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
}
/* 批量模式下卡片右上角的单条操作藏起来，避免与批量操作混淆 */
.post-card.is-selecting .cover-ops {
  display: none;
}
.post-card.is-selecting {
  cursor: pointer;
}
.post-card.is-picked {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.post-card.is-picked .post-cover {
  opacity: 0.82;
}

/* ── 周刊/海报的勾选行（整幅版式不适合在图上贴勾选框） ── */
.special-pick {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  max-width: 100%;
  padding: 5px 11px;
  border: 1px solid var(--glass-border);
  border-radius: 9px;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.special-pick:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.special-pick.on {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
}
/* 这里的勾选框在浅色卡片外，用主题描边而不是白色描边 */
.special-pick .pick-box {
  background: none;
  border-color: var(--glass-border);
  color: var(--accent);
}
.special-pick .pick-box.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.special-pick-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.special-wrap.is-picked {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 14px;
}

/* ── 周刊/海报：整幅版式 + 下方操作条 ── */
.special-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 旧版式（周刊/海报）保持原来的窄栏居中——它们按 880px 宽度设计的排版，
   拉满宽屏会显得空；门户则吃满宽度（见下）。 */
.special-wrap.is-weekly,
.special-wrap.is-poster {
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
}
/* 门户：横版卡片网格吃满宽屏 */
.special-wrap.is-portal {
  max-width: none;
}
.post-body {
  padding: 10px 12px 12px;
}
.post-author {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.author-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.author-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.author-avatar.is-char {
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.35);
}
.author-name {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.author-name.is-char {
  color: var(--accent);
  font-weight: 600;
}

.post-title {
  margin: 0 0 5px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-bright);
  line-height: 1.45;
}
/* 摘要 3 行（原 4 行）：与固定比例封面配合，让整列卡片高度更接近，减少参差 */
.post-excerpt {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.tag {
  font-size: 10px;
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
  padding: 1px 6px;
  border-radius: 5px;
}
.post-foot {
  display: flex;
  gap: 12px;
  margin-top: 9px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.75;
}
.foot-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

@container media-deck (max-width: 680px) {
  .frequency-panel {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 1250px) {
  .media-deck-header {
    grid-template-columns: minmax(245px, 0.75fr) minmax(380px, 1.25fr);
  }
  .media-heading {
    padding: 22px 20px;
  }
  .media-sticker {
    display: none;
  }
  .console-label {
    display: none;
  }
  .console-topline {
    justify-content: flex-end;
  }
  .media-deck-channels {
    flex-wrap: wrap;
    gap: 10px;
  }
  .media-deck-channels > .tabs-scroll {
    flex: 1;
  }
}
@media (max-width: 767px) {
  .media-shell {
    padding-top: 12px;
  }
  .media-deck {
    margin: 0 14px 22px;
    box-shadow: 4px 4px 0 var(--media-ink);
  }
  .media-deck-header {
    grid-template-columns: 1fr;
  }
  .media-heading {
    padding: 14px 12px;
    gap: 12px;
  }
  .media-heading > .media-game-button {
    flex-shrink: 0;
  }
  .media-brand {
    min-width: 0;
  }
  .media-heading h1 {
    font-size: clamp(32px, 9vw, 48px);
    white-space: nowrap;
  }
  .media-kicker {
    font-size: 9px;
    letter-spacing: 0.03em;
  }
  .media-sticker {
    display: grid;
    width: 58px;
    height: 58px;
    font-size: 15px;
    right: 22px;
    top: 24px;
  }
  .media-brand-caption {
    font-size: 11px;
  }
  .media-console {
    padding: 12px 10px 10px;
    gap: 10px;
  }
  .console-label {
    display: none;
  }
  .header-actions {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    width: 100%;
    gap: 8px;
  }
  .console-topline {
    gap: 8px;
    justify-content: stretch;
  }
  .media-deck-channels {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 8px;
    padding: 8px 10px 4px;
  }
  .channel-label {
    display: block;
    writing-mode: horizontal-tb;
    border: 0;
    padding: 0;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }
  .auto-action {
    grid-column: 2;
    grid-row: 1;
  }
  .media-deck-channels > .tabs-scroll {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .tabs-scroll {
    width: 100%;
    overscroll-behavior-x: contain;
  }
  .media-deck-boards {
    flex-direction: column;
    align-items: stretch;
    padding: 4px 10px 8px;
    gap: 2px;
  }
  .frequency-panel {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    padding: 18px 14px;
  }
  .frequency-intro {
    position: relative;
    padding-left: 12px;
  }
  .frequency-intro h2 {
    font-size: 20px;
  }
  .frequency-status {
    margin-top: 10px;
  }
  .frequency-presets {
    gap: 10px 8px;
  }
  .list-toolbar {
    padding: 0 14px 12px;
  }
  .masonry,
  .special-list {
    padding: 0 14px;
  }
}
@media (max-width: 480px) {
  .media-sticker {
    display: none;
  }
}
</style>
