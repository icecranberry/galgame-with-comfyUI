<template>
  <!-- 门户版式（数字报刊 · 两层生成）
       ── 对齐游戏内原设 UI ──
       左侧**竖排章节**（深色条 + 当前项白色浮起 pill），右侧**一整条可滚动的长正文**，
       图片**内嵌**在正文流里（首个段落后），而不是卡片缩略图。

       ── 成本设计保持不变 ──
       出刊只跑 1 次短 LLM（标题 + 各块 name/lead），正文按块**点开才生成**；
       配图由后台串行补（补一张亮一张）。未生成的块在正文流里显示占位 + 生成按钮，
       所以左栏能一眼看出哪几块还没写。 -->
  <article class="portal" v-if="data">
    <!-- ── 刊头 ── -->
    <header class="po-head">
      <div class="po-head-meta">
        <span class="po-issue">第 {{ data.issue }} 期</span>
        <span class="po-brand">{{ post.outlet_name || '数字报刊' }}</span>
      </div>
      <h1 class="po-title">{{ data.title }}</h1>
      <p v-if="data.lead" class="po-lead">{{ data.lead }}</p>
    </header>

    <div class="po-main">
      <!-- ── 左：竖排章节 ── -->
      <aside class="po-nav" aria-label="章节">
        <button
          v-for="s in sections"
          :key="s.key"
          type="button"
          class="po-nav-item"
          :class="{ active: activeKey === s.key, done: !!bodyOf(s) }"
          :title="s.name"
          @click="goSection(s.key)"
        >
          <span class="po-nav-name">{{ s.name }}</span>
          <span class="po-nav-dot" :class="{ on: !!bodyOf(s) }" aria-hidden="true"></span>
        </button>
      </aside>

      <!-- ── 右：长滚动正文 ── -->
      <div class="po-read" ref="readEl" @scroll.passive="onScroll">
        <section
          v-for="s in sections"
          :key="s.key"
          class="po-sec"
          :data-key="s.key"
        >
          <!-- 黄色横幅章节头（游戏原设样式） -->
          <h2 class="po-banner"><span class="po-banner-text">{{ s.name }}</span></h2>

          <p v-if="s.lead" class="po-sec-lead">{{ s.lead }}</p>

          <!-- 已生成正文：按块渲染，图片内嵌在首个段落后 -->
          <template v-if="bodyOf(s)">
            <template v-for="(b, i) in withImage(s)" :key="i">
              <p v-if="b.type === 'p'" class="po-p">{{ b.text }}</p>

              <!-- 内嵌图：独占一行、居中、圆角，点开可放大 -->
              <figure v-else-if="b.type === '__img'" class="po-figure">
                <img :src="b.src" alt="" loading="lazy" @click="emit('zoom', b.src)" title="点击放大" />
              </figure>

              <div v-else-if="b.type === 'qa'" class="po-qa">
                <p class="po-qa-q">
                  <span class="po-qa-q-label">Q：</span>{{ b.q }}
                  <span v-if="b.asker" class="po-qa-asker">——@{{ b.asker }}</span>
                </p>
                <div class="po-qa-body">
                  <p class="po-qa-a-label">A：</p>
                  <div class="po-qa-answers">
                    <p v-for="(a, j) in b.answers" :key="j" class="po-qa-a">
                      <span class="po-qa-speaker">@{{ a.speaker }}：</span>{{ a.text }}
                    </p>
                  </div>
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
                  <span class="po-reply-author">{{ r.author }}：</span>{{ r.text }}
                </p>
              </div>

              <div v-else-if="b.type === 'caption'" class="po-caption">
                <p v-for="(l, j) in b.lines" :key="j">{{ l }}</p>
              </div>
            </template>
          </template>

          <!-- 未生成正文：占位 + 生成按钮（图可能已经补好了，一并显示） -->
          <template v-else>
            <figure v-if="s.image" class="po-figure">
              <img :src="s.image" alt="" loading="lazy" @click="emit('zoom', s.image)" title="点击放大" />
            </figure>
            <div class="po-pending">
              <button
                type="button"
                class="po-gen"
                :disabled="!!loadingKey"
                @click="loadSection(s)"
              >
                <template v-if="loadingKey === s.key">
                  <span class="po-spinner"></span>正在写这一块…
                </template>
                <template v-else>写这一块 ›</template>
              </button>
              <p class="po-pending-hint">正文按块生成，只为真正想看的那几块花这一次。</p>
            </div>
          </template>
        </section>

        <!-- 落款 -->
        <footer class="po-credits">
          <span v-if="data.credits?.reporter">记者：{{ data.credits.reporter }}</span>
          <span v-if="data.credits?.editor">编辑：{{ data.credits.editor }}</span>
        </footer>
      </div>
    </div>
  </article>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import * as api from '../../api/index.js'

const props = defineProps({
  /** media_posts 行（payload 为门户结构） */
  post: { type: Object, required: true },
})
/** 点图片 → 交给父级开 lightbox（与《邻舍日报》详情同口径） */
const emit = defineEmits(['zoom', 'section-loaded', 'section-error'])

const data = computed(() => props.post?.payload || null)
const sections = computed(() => data.value?.sections || [])

/** 本次会话内已取回的正文（与 payload 合并，避免父级不刷新时看不到） */
const localBodies = ref({})
const loadingKey = ref('')
const activeKey = ref('')
const readEl = ref(null)

/** 正文：payload 里的优先，其次用本次取回的 */
function bodyOf(s) {
  return s?.body || localBodies.value[s?.key] || null
}

/**
 * 把该块的正文块排成渲染序列，并把**图片内嵌进正文流**（首个段落后）。
 *
 * 游戏原设里配图是夹在段落之间的，不是独立缩略图；
 * 若这块没有段落（全是问答/榜单），就放在正文开头，保证图仍有位置。
 */
function withImage(s) {
  const blocks = bodyOf(s) || []
  const out = []
  let placed = false
  for (const b of blocks) {
    out.push(b)
    if (!placed && b.type === 'p' && s.image) { out.push({ type: '__img', src: s.image }); placed = true }
  }
  if (!placed && s.image) out.splice(0, 0, { type: '__img', src: s.image })
  return out
}

async function loadSection(s) {
  if (loadingKey.value || bodyOf(s)) return
  loadingKey.value = s.key
  try {
    const r = await api.generateMediaSection(props.post.id, s.key)
    if (r?.section?.body) {
      localBodies.value = { ...localBodies.value, [s.key]: r.section.body }
      emit('section-loaded', { postId: props.post.id, section: r.section })
    }
  } catch (err) {
    console.error('[MediaPortal] 生成板块正文失败:', err)
    emit('section-error', { postId: props.post.id, sectionKey: s.key, error: err?.message || '生成失败' })
  } finally {
    loadingKey.value = ''
  }
}

/** 左栏点击 → 右侧滚到该章（只滚动，不触发生成；生成由正文流里的按钮负责，成本可控） */
async function goSection(key) {
  const host = readEl.value
  if (!host) return
  const el = host.querySelector(`.po-sec[data-key="${key}"]`)
  if (!el) return
  // 相对滚动，别用 scrollIntoView —— 它会把**外层页面**也一起滚走
  host.scrollTo({ top: el.offsetTop - host.offsetTop, behavior: 'smooth' })
  activeKey.value = key
}

/**
 * 滚动联动左栏高亮：取「已越过视口顶部」的最后一章。
 * 用「离顶部最近」而不是 IntersectionObserver —— 章节高度差异大，
 * 观察器在多章同时可见时给出的"当前章"经常不符合直觉。
 */
function onScroll() {
  const host = readEl.value
  if (!host) return
  const top = host.scrollTop + host.offsetTop + 8
  let cur = sections.value[0]?.key || ''
  for (const s of sections.value) {
    const el = host.querySelector(`.po-sec[data-key="${s.key}"]`)
    if (el && el.offsetTop <= top) cur = s.key
  }
  if (cur !== activeKey.value) activeKey.value = cur
}

/** 父级刷新 payload 后，保证高亮不空 */
nextTick(() => { activeKey.value = sections.value[0]?.key || '' })
</script>

<style scoped>
/* ── 整体：报刊是"印刷品"，固定浅色视觉，不跟随深色主题（与周刊/海报同口径）── */
.portal {
  --po-ink: #23253f;
  --po-accent: #c2452f;
  --po-line: #e2ddd6;
  --po-amber: #ffcf3f;      /* 章节横幅黄（对齐游戏原设） */
  --po-amber-ink: #7a4a00;
  background: #fbf8f4;
  color: var(--po-ink);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

/* ── 刊头 ── */
.po-head { padding: 18px 22px 16px; border-bottom: 3px double var(--po-line); }
.po-head-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.po-issue {
  font-size: 12px; font-weight: 700; letter-spacing: 0.5px;
  padding: 2px 8px; border-radius: 4px;
  background: #efe7dc; color: #6f665f;
  font-variant-numeric: tabular-nums;
}
.po-brand {
  font-size: 11.5px; font-weight: 700; letter-spacing: 1px;
  padding: 2px 9px; border-radius: 4px;
  background: var(--po-accent); color: #fff;
}
.po-title { margin: 0 0 6px; font-size: 25px; font-weight: 800; line-height: 1.3; letter-spacing: 0.3px; }
.po-lead { margin: 0; font-size: 13px; line-height: 1.7; color: #5f5851; }

/* ── 两栏主体：左竖排 + 右长滚动 ── */
.po-main { display: flex; align-items: stretch; min-height: 0; }

/* 左：深色竖排章节条（游戏原设） */
.po-nav {
  flex: 0 0 208px;
  display: flex; flex-direction: column; gap: 4px;
  padding: 16px 10px 16px 14px;
  background: #3b3a3a;
  overflow-y: auto;
  /* 自身可滚（章节多时），但不抢主体的滚动 */
  max-height: 74vh;
}
.po-nav-item {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  /* 右侧刻意留出 -10px：当前项要"浮"出深色条，贴着正文区（游戏原设的 popover 感） */
  margin-right: -10px;
  padding: 9px 12px;
  border: none; border-radius: 8px;
  background: none;
  color: #e6e2de;
  font: inherit; font-size: 12.5px; font-weight: 600;
  line-height: 1.45; text-align: left;
  cursor: pointer;
  transition: background 0.16s, color 0.16s, transform 0.16s;
  -webkit-tap-highlight-color: transparent;
}
.po-nav-item:hover { background: rgba(255, 255, 255, 0.08); }
/* 当前项：白色浮起 pill + 硬阴影，且向右探出一点 */
.po-nav-item.active {
  background: #fff;
  color: #2a2724;
  transform: translateX(4px);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  z-index: 1;
}
.po-nav-name {
  flex: 1; min-width: 0;
  /* 长标题两行截断（游戏原设里也是省略号） */
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.po-nav-dot {
  flex-shrink: 0;
  width: 6px; height: 6px; border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.45);
}
.po-nav-dot.on { background: #7ee0a6; border-color: #7ee0a6; }
.po-nav-item.active .po-nav-dot { border-color: rgba(0, 0, 0, 0.3); }
.po-nav-item.active .po-nav-dot.on { background: #1f9d55; border-color: #1f9d55; }

/* 右：一整条长正文，自身滚动（游戏原设的弹窗内滚动） */
.po-read {
  flex: 1; min-width: 0;
  max-height: 74vh;
  overflow-y: auto;
  padding: 20px 26px 18px;
  background: #fff;
  scroll-behavior: smooth;
}
.po-sec { padding-bottom: 6px; }
.po-sec + .po-sec { margin-top: 22px; }

/* ── 黄色横幅章节头（对齐游戏原设）── */
.po-banner {
  position: relative;
  margin: 0 0 12px;
  padding: 7px 40px;
  background: var(--po-amber);
  color: var(--po-amber-ink);
  font-size: 15px; font-weight: 800; letter-spacing: 1.5px;
  text-align: center;
  /* 两端作出阶梯状装饰块 */
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
}
/* 两端的小方块装饰：实心 + 空心各一，模仿原设的棋盘角 */
.po-banner::before,
.po-banner::after {
  content: '';
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 14px; height: 14px;
  background:
    linear-gradient(var(--po-amber-ink) 0 0) 0 0 / 6px 6px no-repeat,
    linear-gradient(var(--po-amber-ink) 0 0) 8px 8px / 6px 6px no-repeat;
  opacity: 0.75;
}
.po-banner::before { left: 14px; }
.po-banner::after { right: 14px; }
.po-banner-text { position: relative; z-index: 1; }
.po-sec-lead {
  margin: 0 0 12px; padding-left: 10px;
  border-left: 3px solid var(--po-line);
  font-size: 12.5px; line-height: 1.8; color: #6f665f;
}

/* ── 正文段落 ── */
.po-p { margin: 0 0 11px; font-size: 13.5px; line-height: 1.95; text-align: justify; }

/* ── 内嵌图 ── */
.po-figure { margin: 14px 0 16px; text-align: center; }
.po-figure img {
  max-width: 100%; max-height: 320px;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  cursor: zoom-in;
  vertical-align: middle;
}

/* ── 问答块（Q 灰气泡 + A 逐条）── */
.po-qa { margin: 0 0 16px; }
.po-qa-q {
  margin: 0 0 10px; padding: 9px 14px;
  border-radius: 12px;
  background: #f2efeb;
  font-size: 13px; font-weight: 600; line-height: 1.8; color: #4a453f;
}
.po-qa-q-label { color: #9a9089; font-weight: 800; margin-right: 2px; }
.po-qa-asker { display: block; margin-top: 2px; text-align: right; font-size: 12px; font-weight: 400; color: #9a9089; }
.po-qa-body { padding-left: 4px; }
.po-qa-a-label { margin: 0 0 6px; font-size: 13px; font-weight: 800; color: #b07a12; }
.po-qa-answers { display: flex; flex-direction: column; gap: 7px; }
.po-qa-a { margin: 0; font-size: 13px; line-height: 1.85; color: #3d3833; }
.po-qa-speaker { font-weight: 700; color: #2f6fb5; }

/* ── 榜单 ── */
.po-rank { margin: 0 0 16px; }
.po-rank-title { margin: 0 0 4px; font-size: 13.5px; font-weight: 800; }
.po-rank-notice { margin: 0 0 8px; font-size: 11.5px; color: #7d746c; line-height: 1.7; }
.po-rank-row {
  display: grid; grid-template-columns: 52px 1fr 46px 1fr;
  gap: 8px; align-items: baseline;
  padding: 5px 0; border-bottom: 1px solid #f0ebe5; font-size: 12.5px;
}
.po-rank-pos { font-weight: 800; color: #b07a12; }
.po-rank-change { color: var(--po-accent); font-variant-numeric: tabular-nums; }
.po-rank-bearer { color: #5f5851; }

/* ── 网友评论 ── */
.po-replies { margin: 0 0 16px; }
.po-replies-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin: 0 0 8px; font-size: 13.5px; font-weight: 800;
}
.po-replies-stat { font-size: 11px; font-weight: 400; color: #8d847c; }
.po-reply { margin: 0 0 7px; font-size: 13px; line-height: 1.85; color: #3d3833; }
.po-reply-author { font-weight: 700; color: #2f6fb5; }

/* ── 图注 ── */
.po-caption { margin: 0 0 14px; }
.po-caption p { margin: 0 0 5px; font-size: 13px; line-height: 1.85; color: #4a453f; }
.po-caption p:last-child { margin-bottom: 0; }

/* ── 未生成正文的占位 ── */
.po-pending {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  margin: 6px 0 4px; padding: 20px;
  border: 1px dashed var(--po-line); border-radius: 12px;
  background: #fdfbf8;
}
.po-gen {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px;
  border: none; border-radius: 9px;
  background: var(--po-amber); color: var(--po-amber-ink);
  font: inherit; font-size: 13px; font-weight: 800;
  cursor: pointer;
  transition: filter 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.po-gen:hover:not(:disabled) { filter: brightness(1.05); }
.po-gen:disabled { opacity: 0.7; cursor: default; }
.po-pending-hint { margin: 0; font-size: 11.5px; color: #9a9089; }
.po-spinner {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(122, 74, 0, 0.25); border-top-color: var(--po-amber-ink);
  animation: po-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes po-spin { to { transform: rotate(360deg); } }

/* ── 落款 ── */
.po-credits {
  display: flex; justify-content: flex-end; gap: 18px;
  margin: 22px -26px 0; padding: 10px 26px;
  border-top: 1px solid var(--po-line);
  background: #faf7f3;
  font-size: 11.5px; color: #6f665f;
}

/* ── 响应式 ── */
@media (max-width: 860px) {
  /* 窄屏：左栏改为顶部横向条，右侧正文占满（不宜再并排挤成两窄列） */
  .po-main { flex-direction: column; }
  .po-nav {
    flex: none; flex-direction: row; gap: 6px;
    max-height: none; padding: 10px;
    overflow-x: auto; overflow-y: hidden;
  }
  .po-nav-item {
    margin-right: 0; flex-shrink: 0; max-width: 46vw;
    background: rgba(255, 255, 255, 0.08);
  }
  .po-nav-item.active { transform: none; }
  .po-nav-name { -webkit-line-clamp: 1; white-space: nowrap; }
  .po-read { max-height: 68vh; padding: 16px 16px 14px; }
  .po-credits { margin: 18px -16px 0; padding: 9px 16px; }
}
@media (max-width: 767px) {
  .po-head { padding: 14px 16px 12px; }
  .po-title { font-size: 20px; }
  .po-banner { font-size: 13.5px; padding: 6px 32px; letter-spacing: 1px; }
  .po-banner::before, .po-banner::after { width: 10px; height: 10px; background-size: 5px 5px, 5px 5px; background-position: 0 0, 5px 5px; }
  .po-figure img { max-height: 240px; }
  .po-rank-row { grid-template-columns: 44px 1fr 40px 1fr; font-size: 12px; }
}
</style>
