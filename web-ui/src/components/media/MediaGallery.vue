<template>
  <!-- 规则34：成人图片站 —— 左侧标签栏 + 主区「一排 4 张」网格 -->
  <div class="mgallery">
    <!-- 左侧：标签检索栏（按站点惯例放在左边，像 rule34 那类图站） -->
    <aside class="mg-side">
      <div class="mg-side-block">
        <h4 class="mg-side-title">标签检索</h4>
        <!-- ★ 按**维度分组**渲染，而不是把所有标签混在一起按次数取前 N。
             原因：体位名（中文）天然高频，混排会被它整体占满 —— 新加的场景/光影/
             视角等维度一个都露不出来，用户看上去还是"标签很少"。
             分组后每组独立排序 + 独立截断，维度一眼可见。 -->
        <div v-for="g in tagGroups" :key="g.key" class="mg-taggroup">
          <div class="mg-taggroup-head">
            <span class="mg-taggroup-name">{{ g.label }}</span>
            <span v-if="g.total > g.items.length" class="mg-taggroup-more">共 {{ g.total }}</span>
          </div>
          <div class="mg-taglist">
            <button
              v-for="t in g.items" :key="t.name"
              type="button" class="mg-tag" :class="{ on: activeTags.includes(t.name) }"
              :title="`${t.name} · ${t.count} 张`"
              @click="toggleTag(t.name)"
            >
              {{ t.name }}<span class="mg-tag-n">{{ t.count }}</span>
            </button>
          </div>
        </div>
        <p v-if="!tagGroups.length" class="mg-side-empty">还没有标签</p>
        <button v-if="activeTags.length" type="button" class="mg-clear" @click="activeTags = []">清空筛选</button>
      </div>

      <div class="mg-side-block">
        <h4 class="mg-side-title">分区</h4>
        <div class="mg-taglist">
          <button type="button" class="mg-tag" :class="{ on: !activeBoardId }" @click="emit('board', null)">全部</button>
          <button
            v-for="b in boards" :key="b.id"
            type="button" class="mg-tag" :class="{ on: activeBoardId === b.id }"
            @click="emit('board', b.id)"
          >{{ b.name }}<span class="mg-tag-n">{{ b.count }}</span></button>
        </div>
      </div>

      <div class="mg-side-block mg-side-stat">
        <span>共 <b>{{ filtered.length }}</b> 张</span>
        <span v-if="activeTags.length">已筛 {{ activeTags.length }} 个标签</span>
      </div>
    </aside>

    <!-- 主区：等宽 4 列瀑布流，每张按**自己的**比例完整展示 -->
    <div class="mg-main">
      <div v-if="filtered.length" class="mg-grid" :style="{ '--mg-cols': colCount }">
        <div v-for="(col, ci) in columns" :key="ci" class="mg-col">
          <article
            v-for="p in col" :key="p.id"
            class="mg-cell" :class="{ 'is-noimg': !p.image, 'is-selecting': batchMode, 'is-picked': isPicked(p.id) }"
            @click="onCellClick(p)"
          >
            <!-- ★ 比例写在容器上（取服务端下发的真实像素），图片 object-fit:contain
                 → 任何比例都**完整展示**，不裁切；同时预留了高度，不会加载时抖一下。 -->
            <div class="mg-thumb" :style="{ '--mg-ar': ratioOf(p) }">
              <img v-if="p.image" :src="p.image" alt="" loading="lazy" decoding="async" />
              <div v-else class="mg-thumb-ph">
                <span class="mg-ph-icon">{{ isSfwStation ? '📷' : '🔞' }}</span>
                <span class="mg-ph-text">{{ p.image_status === 'failed' ? '生成失败' : '排队生图中…' }}</span>
              </div>
              <!-- 批量模式：右上角勾选框。**整卡可点**（触屏也好用），这里只做视觉、不单独绑事件。
                   放右上是因为左上已被体位贴纸占用。 -->
              <span v-if="batchMode" class="mg-pick" :class="{ on: isPicked(p.id) }" aria-hidden="true">
                <svg v-if="isPicked(p.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
              <!-- 体位名：左上角贴纸（每条随机，所以要看得到） -->
              <span v-if="poseOf(p)" class="mg-cell-pose">{{ poseOf(p) }}</span>
              <!-- 画幅比例：**画面元信息，不是标签** —— 贴在图上，别混进下面的标签行
                   （用户口径：标签里不要出现 1:1 / 4:3 这类比例尺）。 -->
              <span v-if="aspectOf(p)" class="mg-thumb-ratio">{{ aspectOf(p) }}</span>
              <span class="mg-cell-likes">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 21s-7.5-4.7-9.6-9A5.6 5.6 0 0 1 12 6.1 5.6 5.6 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z"/>
                </svg>{{ fmtNum(p.likes) }}
              </span>
            </div>
            <h5 class="mg-cell-title">{{ p.title }}</h5>
            <div class="mg-cell-tags">
              <span v-for="t in (p.tags || []).slice(0, 3)" :key="t" class="mg-cell-tag">#{{ t }}</span>
            </div>
          </article>
        </div>
      </div>
      <p v-else class="mg-empty">
        {{ activeTags.length ? '没有同时带这些标签的作品' : '这个图片站还没有内容' }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { colsForWidth, distributeColumns, imageRatioOf, imageMetaOf } from '../../utils/galleryMasonry.js'
import { buildTagGroups } from '../../utils/galleryEnvelopeLabels.js'

const props = defineProps({
  posts: { type: Array, default: () => [] },
  /** 该分类下的媒体（取图标/名称用） */
  outlets: { type: Array, default: () => [] },
  activeOutlet: { type: [Number, null], default: null },
  activeBoardId: { type: [Number, null], default: null },
  /** 批量选择模式：卡片右上角出勾选框，整卡点击 = 切换勾选 */
  batchMode: { type: Boolean, default: false },
  /** 已选中的帖子 id（Set） */
  selectedIds: { type: Object, default: () => new Set() },
})
const emit = defineEmits(['open', 'board', 'pick'])

const activeTags = ref([])

// 换媒体/换分区时清掉标签筛选，免得筛出空列表看着像坏了
watch(() => [props.activeOutlet, props.activeBoardId], () => { activeTags.value = [] })

const boards = computed(() => {
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

/**
 * 标签云：**按维度分组**（分组逻辑在 `utils/galleryEnvelopeLabels.js`，单一真源）。
 *
 * 分组依据是 `payload.gallery.env[].dim`（后端随条目下发），
 * 所以左栏能分成「场景 / 光影 / 视角 / 焦点 / 摄影效果 / 表情 / 状态 / 道具」+「体位 / 主题」，
 * 而不是一堆混排的标签。每组截断 12 个，避免单个维度把左栏撑爆。
 */
const tagGroups = computed(() => buildTagGroups(props.posts, 12))

const filtered = computed(() => {
  if (!activeTags.value.length) return props.posts
  return props.posts.filter(p => activeTags.value.every(t => (p.tags || []).includes(t)))
})

/**
 * 列数：**唯一**的定义在 `utils/galleryMasonry.js` 的 `colsForWidth()`。
 * CSS 里不再写 media query 定列数 —— 两处各写一份必然改一处漏一处。
 */
const colCount = ref(colsForWidth(typeof window === 'undefined' ? 1600 : window.innerWidth))
function syncCols() { colCount.value = colsForWidth(window.innerWidth) }
onMounted(() => {
  syncCols()
  window.addEventListener('resize', syncCols)
})
onBeforeUnmount(() => window.removeEventListener('resize', syncCols))

/** 瀑布流分列（塞最短列，配平高度）—— 顺序只在这里定，模板不做判断 */
const columns = computed(() => distributeColumns(filtered.value, colCount.value))

function toggleTag(name) {
  const i = activeTags.value.indexOf(name)
  activeTags.value = i >= 0 ? activeTags.value.filter(x => x !== name) : [...activeTags.value, name]
}
/** 该条目是否已被勾选（selectedIds 是 Set；缺省空集） */
function isPicked(id) {
  return props.selectedIds instanceof Set ? props.selectedIds.has(id) : false
}
/**
 * 批量模式下点卡片 = 切换勾选；否则照旧打开详情。
 * 与瀑布流卡片的 `onCardClick` 同一口径（整卡可点，触屏也好用）。
 */
function onCellClick(p) {
  if (props.batchMode) emit('pick', p.id)
  else emit('open', p)
}
/** 该条目图片的宽高比（容器用它预留高度，见 `imageRatioOf` 的取值优先级） */
function ratioOf(p) {
  return imageRatioOf(p)
}
/** 该条目的**题材贴纸**（图片站随机分配的题材名，存在 payload 里）。
 *  规则34 是体位名、哈托比亚是题材名（城市风光 / 美少女自拍 / 美食打卡 / 宣传海报）。 */
function poseOf(p) {
  const m = imageMetaOf(p)
  return m?.pose || m?.categoryLabel || ''
}
/** 该条目的画幅比例（服务端随机分配的） */
function aspectOf(p) {
  return imageMetaOf(p)?.aspect || ''
}
/** 是否 SFW 图片站（哈托比亚）—— 决定占位图标与文案，避免在无图时显示 🔞 */
const isSfwStation = computed(() => props.posts.some(p => p?.payload?.photos) || false)
function fmtNum(n) {
  const v = Number(n) || 0
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}
</script>

<style scoped>
.mgallery { flex: 1; min-height: 0; display: flex; gap: 14px; overflow: hidden; }

/* ── 左栏：标签检索 ── */
.mg-side {
  flex: 0 0 208px; min-width: 0;
  display: flex; flex-direction: column; gap: 14px;
  padding: 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow-y: auto;
}
.mg-side-block { display: flex; flex-direction: column; gap: 8px; }
.mg-side-title {
  margin: 0; font-size: var(--fs-xs); font-weight: 700;
  color: var(--text-secondary); letter-spacing: .06em;
}
/* ── 标签云的维度分组（每组一个小标题 + 自己的标签行）── */
.mg-taggroup { display: flex; flex-direction: column; gap: 5px; }
.mg-taggroup + .mg-taggroup { margin-top: 4px; }
.mg-taggroup-head {
  display: flex; align-items: baseline; gap: 6px;
  padding-bottom: 3px;
  border-bottom: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
}
.mg-taggroup-name {
  font-size: 10px; font-weight: 700; letter-spacing: .04em;
  color: var(--text-secondary);
}
.mg-taggroup-more { font-size: 9px; color: var(--text-secondary); opacity: .6; margin-left: auto; }
.mg-taglist { display: flex; flex-wrap: wrap; gap: 5px; }
.mg-tag {
  padding: 2px 8px; border-radius: var(--radius-full);
  border: 1px solid var(--border); background: var(--glass-bg);
  color: var(--text-secondary); font-size: 11px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  transition: all var(--dur-fast) var(--ease-out);
}
.mg-tag:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
.mg-tag.on {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--text-primary); font-weight: 600;
}
.mg-tag-n { font-size: 9px; opacity: .6; }
.mg-side-empty, .mg-side-stat { font-size: var(--fs-xs); color: var(--text-secondary); margin: 0; }
.mg-side-stat { margin-top: auto; gap: 2px; display: flex; flex-direction: column; }
.mg-side-stat b { color: var(--text-primary); }
.mg-clear {
  align-self: flex-start; border: 0; background: transparent; padding: 0;
  font-size: var(--fs-xs); color: var(--accent); text-decoration: underline; cursor: pointer;
}

/* ── 主区：等宽多列瀑布流（列数由 JS 定，见 colsForWidth）── */
.mg-main { flex: 1; min-width: 0; overflow-y: auto; }
.mg-grid {
  display: grid;
  /* 列数来自 JS 的 --mg-cols，用 minmax(0,1fr) 保证各列等宽且能被压缩
     （否则一条长标题会把那一列顶宽，列就不齐了）。 */
  grid-template-columns: repeat(var(--mg-cols, 4), minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
/* 每一列内部是竖向 flex 流 —— 格子高度各随其图，不强行对齐 */
.mg-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.mg-cell { display: flex; flex-direction: column; gap: 6px; cursor: pointer; min-width: 0; }
.mg-thumb {
  position: relative;
  width: 100%;
  /* ★ 按**本条自己的**比例预留高度（--mg-ar 由 payload 的真实像素算出，缺省 3/4）。
     不同比例的图因此得到不同高度的卡片 —— 这正是"随机比例"应有的样子。 */
  aspect-ratio: var(--mg-ar, 3 / 4);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
}
.mg-cell:hover .mg-thumb { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
/* ★ contain 而非 cover：**完整展示**整张图，绝不裁掉两侧/上下。
   容器比例与成图比例一致（同一个数下发下去的），所以正常情况没有留边。 */
.mg-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.mg-thumb-ph {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-secondary);
}
.mg-ph-icon { font-size: 1.5rem; opacity: .5; }
.mg-ph-text { font-size: 10px; }
.mg-cell-likes {
  position: absolute; right: 6px; bottom: 6px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; border-radius: var(--radius-full);
  background: color-mix(in srgb, #000 55%, transparent);
  color: #fff; font-size: 10px;
}
/* 体位名：左上角贴纸（每条随机，所以要看得到） */
.mg-cell-pose {
  position: absolute; left: 6px; top: 6px;
  max-width: calc(100% - 12px);
  padding: 1px 7px; border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent) 82%, #000);
  color: #fff; font-size: 10px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 画幅比例：**贴在图上**（与点赞数一样是画面元信息），不进标签行 ——
   标签行只放真正的检索标签（体位名 / 人数 / 英文 NSFW 词）。
   ★ 批量模式下让位给右上角勾选框，所以这时藏起来。 */
.mg-thumb-ratio {
  position: absolute; left: 6px; bottom: 6px;
  padding: 1px 6px; border-radius: var(--radius-full);
  background: color-mix(in srgb, #000 55%, transparent);
  color: #fff; font-size: 10px;
}
.mg-cell.is-selecting .mg-thumb-ratio { display: none; }

/* ── 批量模式 ── */
/* 右上角勾选框（左上被体位贴纸占了）。只做视觉 —— 点击由整卡负责。 */
.mg-pick {
  position: absolute; right: 6px; top: 6px; z-index: 3;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  backdrop-filter: blur(3px);
  transition: background 0.15s, border-color 0.15s;
}
.mg-pick.on { background: var(--accent); border-color: var(--accent); }
/* 勾选中/悬停时给整格一个明确外框，避免"点没点上"看不出来 */
.mg-cell.is-selecting { cursor: pointer; }
.mg-cell.is-picked .mg-thumb {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
}
.mg-cell.is-picked .mg-cell-title { color: var(--accent); }
.mg-cell-title {
  margin: 0; font-size: 0.8rem; font-weight: 600; color: var(--text-primary);
  line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.mg-cell-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mg-cell-tag { font-size: 10px; color: var(--accent-3); }
.mg-empty { text-align: center; color: var(--text-secondary); font-size: var(--fs-xs); padding: 60px 0; margin: 0; }
</style>
