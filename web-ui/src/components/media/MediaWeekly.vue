<template>
  <!-- 狸狸通讯社 · 周刊版式
       还原游戏内《狸狸周刊》的结构：
       刊头（Vol.X【刊别】+ 大标题 + 引言）→ 开场白 → 多栏目问答 → 尾部板块（榜单/跟帖）→ 落款 -->
  <article class="weekly" v-if="data">
    <!-- ── 刊头 ── -->
    <header class="wk-masthead">
      <div class="wk-mast-top">
        <span class="wk-vol">Vol.{{ data.volume }}</span>
        <span class="wk-kind">【{{ data.kind }}】</span>
      </div>
      <h1 class="wk-headline">
        <span
          :class="{ 'issue-title-link': openable }"
          :role="openable ? 'button' : undefined"
          :tabindex="openable ? 0 : undefined"
          :title="openable ? '查看当期报刊详情' : undefined"
          @click.stop="openable && emit('open')"
          @keydown.enter.prevent="openable && emit('open')"
          @keydown.space.prevent="openable && emit('open')"
        >{{ data.headline }}</span>
      </h1>
      <p v-if="data.intro" class="wk-intro">{{ data.intro }}</p>
      <img
        v-if="post.image"
        :src="bustUrlIfOverwritten(post.image)"
        class="wk-hero wk-zoomable"
        alt=""
        title="点击放大"
        @click.stop="emit('zoom', post.image)"
      />
      <div v-else class="wk-hero wk-hero--ph"><span class="wk-spinner"></span>头版配图印刷中…</div>
    </header>

    <!-- ── 开场白 ── -->
    <section v-if="data.preface.length" class="wk-preface">
      <p v-for="(para, i) in data.preface" :key="i">{{ para }}</p>
    </section>

    <!-- ── 栏目（每个栏目 = 名字 + 若干组 Q/A）── -->
    <section v-for="(col, ci) in data.columns" :key="ci" class="wk-column">
      <h2 class="wk-col-name">{{ col.name }}</h2>
      <div v-for="(item, qi) in col.items" :key="qi" class="wk-qa">
        <p class="wk-q">
          <span class="wk-q-mark">Q{{ qi + 1 }}</span>
          <span class="wk-q-text">{{ item.q }}</span>
          <span v-if="item.asker" class="wk-asker">——@{{ item.asker }}</span>
        </p>
        <div class="wk-a">
          <p v-for="(a, ai) in item.answers" :key="ai" class="wk-a-line">
            <span class="wk-speaker">{{ a.speaker }}：</span>{{ a.text }}
          </p>
        </div>
      </div>
    </section>

    <!-- ── 尾部板块 ── -->
    <section v-for="(t, ti) in data.tail" :key="'t' + ti" class="wk-tail">
      <!-- 榜单 -->
      <template v-if="t.kind === 'rank'">
        <h2 class="wk-tail-title">{{ t.title }}</h2>
        <p v-if="t.notice" class="wk-rank-notice">❗ {{ t.notice }}</p>
        <ol class="wk-rank">
          <li v-for="(row, ri) in t.rows" :key="ri" class="wk-rank-row">
            <span class="wk-rank-pos">{{ row.rank }}</span>
            <span class="wk-rank-mask">{{ row.mask }}</span>
            <span class="wk-rank-change" :class="changeClass(row.change)">{{ row.change }}</span>
            <span class="wk-rank-bearer">谒者：{{ row.bearer }}</span>
          </li>
        </ol>
      </template>

      <!-- 跟帖区 -->
      <template v-else>
        <h2 class="wk-tail-title">{{ t.title }}</h2>
        <p v-if="t.stat" class="wk-thread-stat">{{ t.stat }}</p>
        <div class="wk-threads">
          <p v-for="(r, ri) in t.replies" :key="ri" class="wk-thread">
            <span class="wk-thread-author">{{ r.author }}</span>
            <span class="wk-thread-text">{{ r.text }}</span>
          </p>
        </div>
      </template>
    </section>

    <!-- ── 落款 ── -->
    <footer class="wk-credits">
      <span v-if="data.credits.interview">采访：{{ data.credits.interview }}</span>
      <span v-if="data.credits.editor">编辑：{{ data.credits.editor }}</span>
    </footer>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { bustUrlIfOverwritten } from '../../utils/imageUrlRefresh.js'

const props = defineProps({
  /** media_posts 行（payload 为周刊结构） */
  post: { type: Object, required: true },
  openable: { type: Boolean, default: false },
})
/** 点图片 → 交给父级开 lightbox（与《邻舍日报》详情同口径） */
const emit = defineEmits(['open', 'zoom'])

const data = computed(() => props.post?.payload || null)

/** 名次变化标记的配色：上升红、下降绿（本站涨红跌绿的惯例） */
function changeClass(change) {
  const c = String(change || '')
  if (c.includes('▲')) return 'is-up'
  if (c.includes('▼')) return 'is-down'
  if (/NEW/i.test(c)) return 'is-new'
  return ''
}
</script>

<style scoped>
.issue-title-link { cursor: pointer; }
.issue-title-link:active { opacity: 0.7; }
/* 周刊也是"印刷品"，固定浅色纸感，不跟随应用主题 */
.weekly {
  background: #fbf9f2;
  color: #2a2620;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
  font-family: var(--font-serif, ui-serif, Georgia, serif);
}

/* ── 刊头 ── */
.wk-masthead {
  padding: 18px 20px 16px;
  background: linear-gradient(180deg, #fffdf7, #f5f0e4);
  border-bottom: 3px double #2a2620;
  text-align: center;
}
.wk-mast-top { display: flex; align-items: baseline; justify-content: center; gap: 8px; margin-bottom: 8px; }
.wk-vol {
  font-size: 12px; font-weight: 700; letter-spacing: 1px;
  padding: 2px 9px; border-radius: 4px;
  background: #2a2620; color: #fbf9f2;
}
.wk-kind { font-size: 13px; font-weight: 700; color: #b03a2e; letter-spacing: 1px; }
.wk-headline {
  margin: 0 0 8px;
  font-size: 23px; font-weight: 800; line-height: 1.35;
  letter-spacing: 0.5px;
  color: #1a1712;
}
.wk-intro {
  margin: 0 0 12px;
  font-size: 12.5px; line-height: 1.75; color: #6b6255;
  font-style: italic;
}
.wk-hero { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: var(--bg-sunken); border-radius: 8px; border: 1px solid #d8d0bd; }
.wk-zoomable { cursor: zoom-in; }
.wk-hero--ph {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #f0ecdf; color: #8a8070; font-size: 12px;
  font-family: var(--font-sans);
}
.wk-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(138, 128, 112, 0.3); border-top-color: #8a8070;
  animation: wk-spin 0.7s linear infinite;
}
@keyframes wk-spin { to { transform: rotate(360deg); } }

/* ── 开场白 ── */
.wk-preface {
  padding: 16px 20px;
  border-bottom: 1px dashed #d8d0bd;
}
.wk-preface p {
  margin: 0 0 8px;
  font-size: 13px; line-height: 1.95;
  text-indent: 2em;
  color: #3a352c;
}
.wk-preface p:last-child { margin-bottom: 0; }

/* ── 栏目 ── */
.wk-column { padding: 16px 20px; border-bottom: 1px dashed #d8d0bd; }
.wk-col-name {
  margin: 0 0 12px;
  font-size: 15px; font-weight: 800; letter-spacing: 0.5px;
  color: #1a1712;
  padding-left: 10px;
  border-left: 4px solid #b03a2e;
  line-height: 1.4;
}
.wk-qa { margin-bottom: 14px; }
.wk-qa:last-child { margin-bottom: 0; }
.wk-q {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px;
  margin: 0 0 6px;
  font-size: 13px; font-weight: 700; line-height: 1.7;
  color: #1a1712;
}
.wk-q-mark {
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: 11px; font-weight: 800;
  padding: 1px 7px; border-radius: 4px;
  background: #b03a2e; color: #fff;
}
.wk-q-text { flex: 1; min-width: 0; }
.wk-asker { font-size: 11.5px; font-weight: 500; color: #8a8070; font-family: var(--font-sans); }
.wk-a {
  padding-left: 12px;
  border-left: 2px solid #e6dfcd;
}
.wk-a-line {
  margin: 0 0 4px;
  font-size: 12.5px; line-height: 1.85;
  color: #3a352c;
}
.wk-a-line:last-child { margin-bottom: 0; }
.wk-speaker { font-weight: 700; color: #2f5d8a; }

/* ── 尾部板块 ── */
.wk-tail { padding: 16px 20px; border-bottom: 1px dashed #d8d0bd; }
.wk-tail-title {
  margin: 0 0 10px;
  font-size: 15px; font-weight: 800; letter-spacing: 0.5px;
  color: #1a1712;
  text-align: center;
  padding-bottom: 8px;
  border-bottom: 2px solid #2a2620;
}
.wk-rank-notice {
  margin: 0 0 10px;
  padding: 6px 10px;
  font-size: 11.5px; line-height: 1.7;
  font-family: var(--font-sans);
  color: #8a4b1e;
  background: #fdf3e3;
  border-radius: 6px;
  border-left: 3px solid #d99a3c;
}
.wk-rank { list-style: none; margin: 0; padding: 0; }
.wk-rank-row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
  padding: 6px 8px;
  font-size: 12.5px;
  border-radius: 6px;
}
.wk-rank-row:nth-child(odd) { background: #f4f0e5; }
.wk-rank-pos { flex-shrink: 0; width: 46px; font-weight: 700; color: #6b6255; font-family: var(--font-sans); font-size: 11.5px; }
.wk-rank-mask { font-weight: 700; color: #1a1712; }
.wk-rank-change {
  font-family: var(--font-sans); font-size: 11px; font-weight: 700;
  padding: 0 6px; border-radius: 4px;
}
/* 涨红跌绿（本站惯例） */
.wk-rank-change.is-up { color: #c0392b; background: #fbeaea; }
.wk-rank-change.is-down { color: #1e8449; background: #e8f6ee; }
.wk-rank-change.is-new { color: #8e44ad; background: #f4eafb; }
.wk-rank-bearer { margin-left: auto; color: #6b6255; font-size: 12px; }

.wk-thread-stat {
  margin: 0 0 10px; text-align: center;
  font-size: 12px; color: #8a8070; font-family: var(--font-sans);
}
.wk-threads { display: flex; flex-direction: column; gap: 5px; }
.wk-thread {
  margin: 0;
  font-size: 12.5px; line-height: 1.75;
  font-family: var(--font-sans);
  color: #3a352c;
}
.wk-thread-author { font-weight: 700; color: #2f5d8a; margin-right: 8px; }
.wk-thread-text { color: #4a4438; }

/* ── 落款 ── */
.wk-credits {
  display: flex; justify-content: center; gap: 20px;
  padding: 12px 20px;
  background: #f0ecdf;
  border-top: 3px double #2a2620;
  font-size: 11.5px; color: #6b6255;
  font-family: var(--font-sans);
}

@media (max-width: 767px) {
  .wk-masthead, .wk-preface, .wk-column, .wk-tail { padding-left: 14px; padding-right: 14px; }
  .wk-headline { font-size: 18px; }
  .wk-a { padding-left: 8px; }
  .wk-rank-bearer { margin-left: 0; width: 100%; }
}
</style>
