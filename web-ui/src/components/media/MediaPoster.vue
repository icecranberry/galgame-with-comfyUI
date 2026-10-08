<template>
  <!-- 海报版式（「官方传媒」分类下的 poster 形态通用组件）
       ── 横版小报头版（2026-10-05 由竖版窄栏改版）──
       ① 通栏热点速报条 →
       ② 左主图舞台（爆炸气泡贴在图上）＋ 右侧信息栏（编号刊头 / 大标题 / 旁白 / 小图组 / 落款）。

       ★ 为什么不再一条条往下堆：
         旧版把零件按生成提示词里的清单顺序（热点条→大标题→主图→气泡→文案→小图组→落款）
         自上而下排成一列，宽屏下被压在 880px 窄栏居中、两侧各空 ~500px，既浪费版面
         又显得是"照着提示词清单逐条落地"。横版把零件按海报的阅读层级重新编排：
         图与标题并置、气泡贴图、小图组降为图注条、落款沉底。

       纯 CSS 排版（不用 AI 生整张图），所以文字可读、可选中、可随数据变。
       容器窄于 860px（详情弹窗 / 手机）由 container query 自动退回竖版堆叠。 -->
  <article class="poster" v-if="data">
    <!-- ① 通栏热点速报条 -->
    <header class="po-hotbar">
      <span class="po-hotbar-tag">热点速报</span>
      <span class="po-hotbar-text">{{ data.hotline || '本期瓜已上桌' }}</span>
    </header>

    <div class="po-body">
      <!-- ② 左：主图舞台 + 爆炸气泡 -->
      <div class="po-stage">
        <div class="po-main-wrap">
          <img
            v-if="post.image"
            :src="post.image"
            class="po-main po-zoomable"
            alt=""
            title="点击放大"
            @click.stop="emit('zoom', post.image)"
          />
          <div v-else class="po-main po-main--ph"><span class="po-spinner"></span>头图拍摄中…</div>
        </div>
        <!-- 气泡叠在主图边缘，像贴上去的爆炸贴纸 -->
        <div class="po-bubbles">
          <span
            v-for="(b, i) in data.bubbles"
            :key="i"
            class="po-bubble"
            :class="`po-bubble--${i % 3}`"
          >{{ b }}</span>
        </div>
      </div>

      <!-- ③ 右：刊头 → 大标题 → 旁白 → 小图组 → 落款 -->
      <div class="po-side">
        <!-- 刊头：编号卡 + 刊徽（刊名取自媒体本身，别硬编码 ——
             否则新建的海报媒体会顶着别人的刊名出刊） -->
        <div class="po-head">
          <div class="po-issue">
            <span class="po-issue-brand">{{ post.outlet_name || '官方传媒' }}</span>
            <span class="po-issue-no">{{ issueNo }}</span>
          </div>
          <div class="po-emblem" aria-hidden="true">
            <span class="po-emblem-line">SPECIAL</span>
            <span class="po-emblem-mid">特刊</span>
            <span class="po-emblem-line po-emblem-line--sub">ISSUE</span>
          </div>
        </div>

        <h1 class="po-title">{{ data.bigTitle }}</h1>

        <div class="po-caption">
          <p v-for="(line, i) in data.caption" :key="i">{{ line }}</p>
        </div>

        <!-- 小图组：横排图注条（不再是竖着排到最后一段） -->
        <div v-if="data.panels.length" class="po-panels" :style="{ '--n': Math.min(data.panels.length, 3) }">
          <figure v-for="(panel, i) in data.panels" :key="i" class="po-panel">
            <div class="po-panel-img">
              <img
                v-if="panel.image"
                :src="panel.image"
                class="po-zoomable"
                alt=""
                loading="lazy"
                title="点击放大"
                @click.stop="emit('zoom', panel.image)"
              />
              <span v-else class="po-spinner"></span>
            </div>
            <figcaption class="po-panel-label">{{ panel.label }}</figcaption>
          </figure>
        </div>

        <footer class="po-credits">
          <span v-if="data.credits.reporter">记者：{{ data.credits.reporter }}</span>
          <span v-if="data.credits.editor">编辑：{{ data.credits.editor }}</span>
        </footer>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** media_posts 行（payload 为海报结构） */
  post: { type: Object, required: true },
})
/** 点图片 → 交给父级开 lightbox（与《邻舍日报》详情同口径） */
const emit = defineEmits(['zoom'])

const data = computed(() => props.post?.payload || null)
const issueNo = computed(() => String(data.value?.issueNo || 1).padStart(2, '0'))
</script>

<style scoped>
/* ── 海报整体：固定浅色视觉（海报是"印刷品"，不跟随应用主题变来变去）── */
.poster {
  --po-ink: #1b1d3a;
  --po-blue: #2f4bd8;
  --po-cyan: #29c8e0;
  --po-pink: #ff4d9d;
  --po-yellow: #ffd43b;
  background: #f2f4ff;
  color: var(--po-ink);
  border-radius: 14px;
  overflow: hidden;
  /* 斜切网格底纹：小报的廉价印刷感 */
  background-image:
    repeating-linear-gradient(135deg, rgba(47, 75, 216, 0.05) 0 10px, transparent 10px 20px);
  box-shadow: var(--shadow-md);
  /* ★ 让窄容器（详情弹窗 / 手机）能查询自身宽度并退回竖版，
     而不是靠视口媒体查询（弹窗在宽视口下也只有千把像素）。 */
  container-type: inline-size;
}

/* ── ① 热点速报条（通栏）── */
.po-hotbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  background: var(--po-ink);
  color: #fff;
}
.po-hotbar-tag {
  flex-shrink: 0;
  font-size: 12px; font-weight: 700;
  padding: 2px 8px; border-radius: 4px;
  background: var(--po-yellow); color: var(--po-ink);
  transform: skewX(-8deg);
}
.po-hotbar-text { font-size: 12.5px; line-height: 1.5; }

/* ── ② 主体：左图右文（横版的核心）── */
.po-body {
  display: flex;
  align-items: stretch;
}

/* 主图舞台：宽度占比固定，高度按 4:3 撑开；右栏更高时再被拉伸填满 */
.po-stage {
  position: relative;
  flex: 0 0 58%;
  min-width: 0;
  aspect-ratio: 4 / 3;
  background: #fff;
}
.po-main-wrap { position: absolute; inset: 0; }
.po-main { display: block; width: 100%; height: 100%; object-fit: cover; }
/* 可放大的图：给个手型光标提示可点 */
.po-zoomable { cursor: zoom-in; }
.po-main--ph {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: linear-gradient(135deg, #e8ecff, #f6f0ff);
  color: var(--po-blue); font-size: 13px; font-weight: 600;
}
.po-spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(47, 75, 216, 0.25); border-top-color: var(--po-blue);
  animation: po-spin 0.7s linear infinite;
}
@keyframes po-spin { to { transform: rotate(360deg); } }

/* ── 爆炸气泡：叠在主图下半部 ── */
.po-bubbles {
  position: absolute;
  left: 12px; right: 12px; bottom: 12px;
  display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end;
}
.po-bubble {
  font-size: 18px; font-weight: 900; line-height: 1.25;
  padding: 6px 15px;
  border-radius: 10px;
  color: #fff;
  /* 厚白边 + 硬投影 = 贴纸感 */
  border: 3px solid #fff;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.28);
  transform: skewX(-6deg) rotate(-1.5deg);
}
.po-bubble--0 { background: var(--po-blue); }
.po-bubble--1 { background: var(--po-pink); transform: skewX(-6deg) rotate(1.5deg); }
.po-bubble--2 { background: var(--po-cyan); color: var(--po-ink); }

/* ── ③ 右侧信息栏 ── */
.po-side {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

/* 刊头：编号卡 + 刊徽，两端分布 */
.po-head {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 18px;
  background: linear-gradient(120deg, var(--po-blue), #6a3fd8 60%, var(--po-pink));
}
.po-issue {
  flex-shrink: 0;
  width: 46px; height: 52px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.22);
  transform: rotate(-4deg);
}
.po-issue-brand { font-size: 9px; font-weight: 700; color: var(--po-blue); letter-spacing: 0.5px; }
.po-issue-no { font-size: 22px; font-weight: 900; line-height: 1; color: var(--po-ink); }

.po-emblem {
  flex-shrink: 0;
  width: 62px; height: 62px; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  border: 3px solid #fff;
  box-shadow: 0 0 0 2px var(--po-cyan), 0 3px 8px rgba(0, 0, 0, 0.25);
  transform: rotate(8deg);
}
.po-emblem-line { font-size: 8px; font-weight: 700; color: var(--po-blue); letter-spacing: 0.5px; }
.po-emblem-mid { font-size: 15px; font-weight: 900; color: var(--po-pink); line-height: 1.1; }

/* 大标题：横版里独占一行，墨字 + 黄色描影，像小报头版 */
.po-title {
  margin: 0;
  padding: 12px 18px 11px;
  font-size: 34px; font-weight: 900; letter-spacing: 4px; line-height: 1.25;
  color: var(--po-ink);
  background: #fff;
  text-shadow: 2px 2px 0 var(--po-yellow);
  border-bottom: 3px solid var(--po-ink);
  overflow-wrap: anywhere;
}

/* 旁白：吸收右侧剩余高度（flex:1），不至于把下方图条与落款顶飞。
   ★ 故意**不设 overflow:hidden** —— 旁白行数由 LLM 定（最多 6 行），
     一旦超出左图高度，让它把右栏撑高、由主图 object-fit:cover 去裁，
     而不是把用户还没读到的旁白裁掉。（丢图角比丢字轻。） */
.po-caption {
  flex: 1 1 auto;
  padding: 12px 18px;
  background: #fff;
  display: flex; flex-direction: column; gap: 5px;
}
.po-caption p {
  margin: 0;
  font-size: 13.5px; line-height: 1.8;
  color: #2a2d4a;
}

/* ── 小图组：横排图注条 ── */
.po-panels {
  display: grid;
  grid-template-columns: repeat(var(--n, 2), 1fr);
  gap: 8px;
  padding: 10px 14px;
  background: #eef1fb;
  border-top: 2px solid rgba(27, 29, 58, 0.12);
}
.po-panel { margin: 0; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.po-panel-img {
  aspect-ratio: 4 / 3;
  border-radius: 8px; overflow: hidden;
  background: #dfe4f7;
  border: 2px solid #fff;
  display: flex; align-items: center; justify-content: center;
  transform: rotate(-1deg);
}
.po-panel:nth-child(even) .po-panel-img { transform: rotate(1deg); }
.po-panel-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.po-panel-label {
  font-size: 10.5px; font-weight: 700;
  padding: 3px 8px; border-radius: 999px;
  background: var(--po-blue); color: #fff;
  align-self: flex-start;
  max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 落款：沉在右栏底部 ── */
.po-credits {
  display: flex; justify-content: flex-end; gap: 16px;
  padding: 8px 18px;
  background: var(--po-ink);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
}

/* ── 窄容器（详情弹窗 / 手机）：退回竖版堆叠 ──
   容器查询按 .poster 自身宽度判断，弹窗在宽屏视口下宽度有限也能正确降级。 */
@container (max-width: 860px) {
  .po-body { flex-direction: column; }
  .po-stage { flex: none; }
  .po-title { font-size: 26px; letter-spacing: 2px; }
  .po-issue { width: 40px; height: 46px; }
  .po-issue-no { font-size: 19px; }
  .po-emblem { width: 54px; height: 54px; }
  .po-bubble { font-size: 15px; padding: 5px 12px; }
  .po-caption { flex: none; }
  .po-panels { grid-template-columns: repeat(2, 1fr); }
}

/* 不支持容器查询的环境兜底：视口本身很窄时同样退回竖版 */
@media (max-width: 767px) {
  .po-body { flex-direction: column; }
  .po-stage { flex: none; }
  .po-title { font-size: 24px; letter-spacing: 1px; }
  .po-issue { width: 40px; height: 46px; }
  .po-issue-no { font-size: 19px; }
  .po-emblem { width: 52px; height: 52px; }
  .po-bubble { font-size: 14px; padding: 5px 11px; }
  .po-caption { flex: none; }
  .po-panels { grid-template-columns: repeat(2, 1fr); }
}
</style>
