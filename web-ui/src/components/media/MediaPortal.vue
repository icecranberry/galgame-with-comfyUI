<template>
  <!-- 门户版式（数字报刊·两层生成）
       横版卡片网格：出刊即可读（文字先落库），配图由后台串行补（补一张亮一张）。
       点某块右下角 › 才生成该块正文 —— 用户只为真正想看的那几块付第二次 LLM。
       纯 CSS 排版，文字可选中、可随数据变。 -->
  <article class="portal" v-if="data">
    <!-- 刊头 -->
    <header class="po-head">
      <div class="po-head-left">
        <span class="po-brand">{{ post.outlet_name || '数字报刊' }}</span>
        <span class="po-issue">第 {{ data.issue }} 期</span>
      </div>
      <h1 class="po-title">{{ data.title }}</h1>
      <p v-if="data.lead" class="po-lead">{{ data.lead }}</p>
    </header>

    <!-- 板块卡片网格：auto-fill 吃满宽屏（旧的 880px 居中单列在 1920 屏两侧各空 520px） -->
    <div class="po-grid">
      <div
        v-for="s in data.sections"
        :key="s.key"
        class="po-card"
        :class="{ 'is-open': openKey === s.key, 'is-loading': loadingKey === s.key }"
      >
        <div class="po-thumb" @click.stop="s.image && emit('zoom', s.image)">
          <img
            v-if="s.image"
            :src="s.image"
            alt=""
            loading="lazy"
            class="po-thumb-img"
            title="点击放大"
          />
          <div v-else class="po-thumb-ph">
            <span class="po-spinner"></span>
            <span class="po-thumb-ph-text">配图中…</span>
          </div>
        </div>

        <div class="po-card-body">
          <h3 class="po-card-name">{{ s.name }}</h3>
          <p class="po-card-lead">{{ s.lead }}</p>

          <!-- 展开后的正文（块数组渲染） -->
          <div v-if="openKey === s.key" class="po-blocks">
            <template v-for="(b, i) in (s.body || [])" :key="i">
              <p v-if="b.type === 'p'" class="po-p">{{ b.text }}</p>

              <div v-else-if="b.type === 'qa'" class="po-qa">
                <p class="po-qa-q">
                  <span v-if="b.asker" class="po-qa-asker">@{{ b.asker }}</span>{{ b.q }}
                </p>
                <div v-for="(a, j) in b.answers" :key="j" class="po-qa-a">
                  <span class="po-qa-speaker">{{ a.speaker }}</span>
                  <span class="po-qa-text">{{ a.text }}</span>
                </div>
              </div>

              <div v-else-if="b.type === 'rank'" class="po-rank">
                <p v-if="b.title" class="po-rank-title">{{ b.title }}</p>
                <p v-if="b.notice" class="po-rank-notice">{{ b.notice }}</p>
                <div v-for="(r, j) in b.rows" :key="j" class="po-rank-row">
                  <span class="po-rank-pos">{{ r.rank }}</span>
                  <span class="po-rank-mask">{{ r.mask }}</span>
                  <span class="po-rank-change">{{ r.change }}</span>
                  <span class="po-rank-bearer">{{ r.bearer }}</span>
                </div>
              </div>

              <div v-else-if="b.type === 'replies'" class="po-replies">
                <p class="po-replies-head">
                  <span v-if="b.title">{{ b.title }}</span>
                  <span v-if="b.stat" class="po-replies-stat">{{ b.stat }}</span>
                </p>
                <p v-for="(r, j) in b.replies" :key="j" class="po-reply">
                  <span class="po-reply-author">{{ r.author }}</span>{{ r.text }}
                </p>
              </div>

              <div v-else-if="b.type === 'caption'" class="po-caption">
                <p v-for="(l, j) in b.lines" :key="j">{{ l }}</p>
              </div>
            </template>
          </div>

          <!-- 展开 / 收起 按钮：右下角，符合「点具体板块的右下角 ›」的设计 -->
          <button
            type="button"
            class="po-more"
            :disabled="loadingKey === s.key"
            @click.stop="toggleSection(s)"
          >
            <template v-if="loadingKey === s.key">
              <span class="po-spinner"></span> 生成中…
            </template>
            <template v-else-if="openKey === s.key">收起 ‹</template>
            <template v-else>{{ s.body ? '展开' : '看这块' }} ›</template>
          </button>
        </div>
      </div>
    </div>

    <!-- 落款 -->
    <footer class="po-credits">
      <span v-if="data.credits?.reporter">记者：{{ data.credits.reporter }}</span>
      <span v-if="data.credits?.editor">编辑：{{ data.credits.editor }}</span>
    </footer>
  </article>
</template>

<script setup>
import { ref, computed } from 'vue'
import * as api from '../../api/index.js'

const props = defineProps({
  /** media_posts 行（payload 为门户结构） */
  post: { type: Object, required: true },
})
/** 点图片 → 交给父级开 lightbox（与《邻舍日报》详情同口径） */
const emit = defineEmits(['zoom', 'section-loaded'])

const data = computed(() => props.post?.payload || null)

// 展开的是哪一块、正在加载的是哪一块
const openKey = ref('')
const loadingKey = ref('')
const localBodies = ref({})   // 本次会话内已取回的正文（与 payload 合并，避免父级不刷新时看不到）

/** 带本地缓存的板块列表：父级传下来的 payload 优先，其次用本地已取回的正文 */
const sections = computed(() => data.value?.sections || [])
function bodyOf(s) {
  return s.body || localBodies.value[s.key] || null
}

async function toggleSection(s) {
  if (loadingKey.value) return
  // 已展开 → 收起
  if (openKey.value === s.key) { openKey.value = ''; return }

  openKey.value = s.key
  // 已有正文（payload 里的，或本次取回的）→ 直接展开，不再请求
  if (bodyOf(s)) return

  loadingKey.value = s.key
  try {
    const r = await api.generateMediaSection(props.post.id, s.key)
    if (r?.section?.body) {
      localBodies.value = { ...localBodies.value, [s.key]: r.section.body }
      emit('section-loaded', { postId: props.post.id, section: r.section })
    }
  } catch (err) {
    console.error('[MediaPortal] 生成板块正文失败:', err)
    openKey.value = ''
    emit('section-error', { postId: props.post.id, sectionKey: s.key, error: err?.message || '生成失败' })
  } finally {
    loadingKey.value = ''
  }
}
</script>

<style scoped>
/* ── 整体：报刊是"印刷品"，固定浅色视觉，不跟随深色主题（与周刊/海报同口径）── */
.portal {
  --po-ink: #23253f;
  --po-accent: #c2452f;
  --po-line: #e2ddd6;
  background: #fbf8f4;
  color: var(--po-ink);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

/* ── 刊头 ── */
.po-head {
  padding: 18px 22px 16px;
  border-bottom: 3px double var(--po-line);
}
.po-head-left { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.po-brand {
  font-size: 11.5px; font-weight: 700; letter-spacing: 1px;
  padding: 2px 9px; border-radius: 4px;
  background: var(--po-accent); color: #fff;
}
.po-issue { font-size: 12px; color: #7d746c; font-variant-numeric: tabular-nums; }
.po-title {
  margin: 0 0 6px;
  font-size: 25px; font-weight: 800; line-height: 1.3;
  letter-spacing: 0.3px;
}
.po-lead { margin: 0; font-size: 13px; line-height: 1.7; color: #5f5851; }

/* ── 卡片网格：auto-fill 吃满宽屏（旧版 880px 居中单列，1920 屏两侧各空 520px）── */
.po-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 14px;
  padding: 16px 22px;
}
.po-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--po-line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  transition: box-shadow 0.18s, border-color 0.18s;
}
.po-card:hover { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08); }
/* ★ 展开时**就地展开**（不跨列）：
   原先写的是 `grid-column: 1 / -1`（跨整行），结果缩略图被拉到整行宽、
   配图占位区变成一大片空白，视觉很糟。改成就地展开，
   正文内部用两栏排版来保证可读性（见 .po-blocks 的 column-count）。 */
.po-card.is-open { border-color: var(--po-accent); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.10); }
.po-card.is-loading { opacity: 0.85; }

/* ── 缩略图（出刊时为空位，后台补一张亮一张）── */
/* 缩略图（出刊时为空位，后台补一张亮一张）
   展开时压矮，让正文成为主角 —— 否则 16:9 的图占掉半屏，正文要滚很久才看到 */
.po-thumb { position: relative; aspect-ratio: 16 / 9; background: #efe9e2; overflow: hidden; }
.po-card.is-open .po-thumb { aspect-ratio: 21 / 6; }
.po-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.po-thumb-ph {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
  color: #9a9089; font-size: 11.5px;
}
.po-spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(194, 69, 47, 0.22); border-top-color: var(--po-accent);
  animation: po-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes po-spin { to { transform: rotate(360deg); } }

/* ── 卡片文字 ── */
.po-card-body { display: flex; flex-direction: column; gap: 7px; padding: 12px 14px 12px; flex: 1; }
.po-card-name { margin: 0; font-size: 15px; font-weight: 700; }
.po-card-lead { margin: 0; font-size: 12.5px; line-height: 1.75; color: #5f5851; }

/* 展开按钮：右下角 */
.po-more {
  display: inline-flex; align-items: center; gap: 5px;
  align-self: flex-end;
  margin-top: auto;
  padding: 4px 11px;
  border: 1px solid var(--po-line);
  border-radius: 8px;
  background: none;
  color: var(--po-accent);
  font-family: inherit;
  font-size: 12px; font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.po-more:hover:not(:disabled) { background: var(--po-accent); color: #fff; border-color: var(--po-accent); }
.po-more:disabled { opacity: 0.6; cursor: default; }

/* ── 正文块 ── */
.po-blocks {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px dashed var(--po-line);
  display: flex; flex-direction: column; gap: 12px;
  /* 展开后整行宽，正文按两栏排更接近报纸阅读节奏 */
  column-count: 2; column-gap: 26px;
}
.po-p { margin: 0; font-size: 13px; line-height: 1.85; text-align: justify; break-inside: avoid; }

.po-qa { break-inside: avoid; }
.po-qa-q {
  margin: 0 0 6px; font-size: 13px; font-weight: 600; line-height: 1.7;
  padding-left: 9px; border-left: 3px solid var(--po-accent);
}
.po-qa-asker { color: var(--po-accent); margin-right: 5px; font-weight: 700; }
.po-qa-a { margin: 0 0 5px 12px; font-size: 12.5px; line-height: 1.8; }
.po-qa-speaker { font-weight: 700; margin-right: 6px; color: #4a453f; }

.po-rank { break-inside: avoid; }
.po-rank-title { margin: 0 0 4px; font-size: 13px; font-weight: 700; }
.po-rank-notice { margin: 0 0 6px; font-size: 11.5px; color: #7d746c; line-height: 1.6; }
.po-rank-row {
  display: grid; grid-template-columns: 54px 1fr 44px 1fr;
  gap: 8px; align-items: baseline;
  padding: 4px 0; border-bottom: 1px solid #f0ebe5; font-size: 12.5px;
}
.po-rank-pos { font-weight: 700; }
.po-rank-change { color: var(--po-accent); font-variant-numeric: tabular-nums; }
.po-rank-bearer { color: #5f5851; }

.po-replies { break-inside: avoid; }
.po-replies-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin: 0 0 6px; font-size: 13px; font-weight: 700;
}
.po-replies-stat { font-size: 11px; font-weight: 400; color: #8d847c; }
.po-reply { margin: 0 0 4px; font-size: 12.5px; line-height: 1.75; color: #4a453f; }
.po-reply-author { font-weight: 700; margin-right: 6px; color: var(--po-accent); }

.po-caption { break-inside: avoid; }
.po-caption p { margin: 0 0 4px; font-size: 13px; line-height: 1.8; }
.po-caption p:last-child { margin-bottom: 0; }

/* ── 落款 ── */
.po-credits {
  display: flex; justify-content: flex-end; gap: 18px;
  padding: 10px 22px;
  border-top: 1px solid var(--po-line);
  background: #f5f0ea;
  font-size: 11.5px; color: #6f665f;
}

/* ── 响应式 ── */
@media (max-width: 900px) {
  .po-blocks { column-count: 1; }
}
@media (max-width: 767px) {
  .po-head { padding: 14px 16px 12px; }
  .po-title { font-size: 20px; }
  .po-grid { grid-template-columns: 1fr; gap: 12px; padding: 12px 16px; }
  .po-credits { padding: 8px 16px; }
  /* 窄屏：卡片已展开时不占整行也无所谓（本来就是单列），去掉跨列声明即可 */
  .po-card.is-open { grid-column: auto; }
}
</style>
