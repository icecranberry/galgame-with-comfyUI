<template>
  <linshe-modal
    :model-value="visible"
    :title="CHANGELOG_TITLE"
    wide
    @update:model-value="onModelUpdate"
  >
    <div class="cl-topline">
      <span class="cl-latest">
        <span class="cl-dot" aria-hidden="true"></span>
        最新 {{ latest?.version || '—' }}
      </span>
      <span class="cl-count">
        {{ entries.length > 1 ? `向下滚动可看历史` : '本次更新内容' }}
      </span>
    </div>

    <ol v-if="entries.length" class="cl-list">
      <li
        v-for="(entry, index) in entries"
        :key="entry.version + entry.date + index"
        class="cl-entry"
        :class="{ 'is-latest': index === 0 }"
      >
        <div class="cl-entry-head">
          <span class="cl-ver">{{ entry.version }}</span>
          <time class="cl-date">{{ entry.date }}</time>
        </div>
        <h4 v-if="entry.title" class="cl-entry-title">{{ entry.title }}</h4>
        <p v-if="entry.summary" class="cl-entry-summary">{{ entry.summary }}</p>
        <ul class="cl-items">
          <li v-for="(item, i) in entry.items" :key="i">{{ item }}</li>
        </ul>
      </li>
    </ol>

    <div v-else class="cl-empty">
      <p class="cl-empty-title">还没有写更新说明</p>
      <p class="cl-empty-hint">
        编辑 <code>web-ui/src/data/changelog.js</code> 里的 <code>CHANGELOG_ENTRIES</code>，
        下次执行 <code>npm run tag</code> 时会自动刷新标志位。
      </p>
    </div>

    <template #footer>
      <div class="cl-foot">
        <!-- 交流渠道：群号 / 仓库 / 主页，整块可点 -->
        <div class="cl-links">
          <a
            v-for="link in COMMUNITY_LINKS"
            :key="link.key"
            class="cl-link"
            :href="link.url"
            :title="link.title"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="cl-link-ico" aria-hidden="true">
              <svg v-if="link.key === 'qq'" viewBox="0 0 24 24">
                <path d="M21 11.6c0 4.2-4 7.4-9 7.4a10.6 10.6 0 0 1-3.6-.6L4 20.4l1.4-3.6A7 7 0 0 1 3 11.6C3 7.4 7 4.2 12 4.2s9 3.2 9 7.4Z" />
              </svg>
              <svg v-else-if="link.key === 'github'" viewBox="0 0 16 16" class="cl-ico-fill">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <rect x="2.5" y="7" width="19" height="13.5" rx="3.5" />
                <path d="m7.5 3 4.5 4 4.5-4M7.5 13.5h.01M16.5 13.5h.01" />
              </svg>
            </span>
            <span class="cl-link-label">{{ link.label }}</span>
            <span class="cl-link-text">{{ link.text }}</span>
          </a>
        </div>

        <!-- 特别鸣谢：标题做成品牌渐变徽标，姓名做成带底色的彩色标签 -->
        <div v-if="thanksRows.length" class="cl-thanks">
          <div class="cl-thanks-head">
            <span class="cl-thanks-badge sparkle">特别鸣谢</span>
            <span class="cl-thanks-rule" aria-hidden="true"></span>
          </div>
          <div class="cl-thanks-body">
            <div v-for="row in thanksRows" :key="row.label" class="cl-thanks-row">
              <span class="cl-thanks-label">{{ row.label }}</span>
              <span class="cl-thanks-names stagger">
                <span
                  v-for="name in row.names"
                  :key="name.text"
                  class="cl-name sheen"
                  :class="`cl-t-${name.tone}`"
                >{{ name.text }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="cl-foot-actions">
          <linshe-button variant="primary" class="cl-ok" @click="close">我知道了</linshe-button>
        </div>
      </div>
    </template>
  </linshe-modal>
</template>

<script setup>
/**
 * ChangelogDialog —— 更新说明弹窗
 *
 * 正文内容全部来自 src/data/changelog.js（手动维护），本组件只负责渲染。
 * 页脚的交流渠道与特别鸣谢来自 src/data/community.js ——
 * 刻意与 changelog.js 分开：改群号/名单不该触发 CHANGELOG_FLAG 变化、把弹窗重推给所有人。
 *
 * 由 App.vue 在「首次启动」或「CHANGELOG_FLAG 变化」时调用 open() 弹出；
 * 用户关闭时 emit('close')，App.vue 据此把当前标志位记进 localStorage，
 * 于是同一个标志位只会弹一次，直到下次更新说明内容变化。
 */
import { computed, ref } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import { CHANGELOG_ENTRIES, CHANGELOG_TITLE } from '../data/changelog.js'
import { COMMUNITY_LINKS, SPECIAL_THANKS } from '../data/community.js'

const emit = defineEmits(['close'])

const visible = ref(false)

/** 容错归一化：容忍缺字段 / items 写成字符串 / entries 不是数组等手滑情况 */
const entries = computed(() => {
  const raw = Array.isArray(CHANGELOG_ENTRIES) ? CHANGELOG_ENTRIES : []
  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      version: String(entry.version ?? '').trim() || '未命名版本',
      date: String(entry.date ?? '').trim(),
      title: String(entry.title ?? '').trim(),
      summary: String(entry.summary ?? '').trim(),
      items: (Array.isArray(entry.items) ? entry.items : [entry.items])
        .filter((item) => item !== null && item !== undefined && String(item).trim() !== '')
        .map((item) => String(item).trim()),
    }))
})

const latest = computed(() => entries.value[0] || null)

/** 鸣谢名单的标签配色：轮转项目现成的 --fun-* 功能色，保证同一名字永远同一个颜色 */
const NAME_TONES = ['orange', 'teal', 'blue', 'pink', 'violet', 'gold', 'purple']

/** 归一化鸣谢名单，并把每个名字拆成独立标签（配色跨行连续轮转） */
const thanksRows = computed(() => {
  const rows = Array.isArray(SPECIAL_THANKS) ? SPECIAL_THANKS : []
  let index = 0
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      label: String(row.label ?? '').trim(),
      names: (Array.isArray(row.names) ? row.names : [row.names])
        .filter((name) => name !== null && name !== undefined && String(name).trim() !== '')
        .map((name) => ({
          text: String(name).trim(),
          tone: NAME_TONES[index++ % NAME_TONES.length],
        })),
    }))
    .filter((row) => row.names.length > 0)
})

function open() {
  visible.value = true
}

function close() {
  if (!visible.value) return
  visible.value = false
  emit('close')
}

// LinsheModal 内部关闭（Esc / 点遮罩 / ✕）会回传 false，统一走 close() 收口
function onModelUpdate(value) {
  if (!value) close()
}

defineExpose({ open, close })
</script>

<style scoped>
/* ── 顶部摘要行 ── */
.cl-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.cl-latest {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 4px 10px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-hover);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.cl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.18);
}

.cl-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ── 条目列表 ── */
.cl-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 18px;
}

.cl-entry {
  position: relative;
  padding: 14px 16px 16px;
  border-radius: 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}

/* 最新一版：主题色描边 + 左侧色条，一眼看出「这次更新了什么」 */
.cl-entry.is-latest {
  border-color: rgba(var(--accent-rgb), 0.35);
  background: linear-gradient(
    180deg,
    rgba(var(--accent-rgb), 0.07) 0%,
    var(--bg-secondary) 62%
  );
}
.cl-entry.is-latest::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}

.cl-entry-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}

.cl-ver {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

.cl-date {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.cl-entry-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-bright);
}

.cl-entry-summary {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* ── 改动条目 ── */
.cl-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.cl-items li {
  position: relative;
  padding-left: 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}

.cl-items li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 9px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(var(--accent-rgb), 0.55);
}

.cl-entry.is-latest .cl-items li::before {
  background: var(--accent);
}

/* ── 空状态 ── */
.cl-empty {
  padding: 26px 18px;
  border-radius: 14px;
  border: 1px dashed var(--border-strong);
  text-align: center;
}

.cl-empty-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
}

.cl-empty-hint {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--text-secondary);
}

.cl-empty-hint code {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-hover);
  font-size: 12px;
}

/* ── 页脚：交流渠道 + 特别鸣谢 + 操作 ──
   页脚是 flex-shrink:0 的固定区，所以这块要尽量扁，
   否则会把上面的正文挤压成一条缝。 */
.cl-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

/* ── 交流渠道（群号 / 仓库 / 主页）── */
.cl-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cl-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 11px 5px 9px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.3;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.cl-link:hover {
  background: rgba(var(--accent-rgb), 0.16);
  border-color: rgba(var(--accent-rgb), 0.45);
}
.cl-link:focus-visible {
  outline: 2px solid rgba(var(--accent-rgb), 0.45);
  outline-offset: 2px;
}

.cl-link-ico {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--accent-hover);
}
.cl-link-ico svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cl-link-ico svg.cl-ico-fill {
  fill: currentColor;
  stroke: none;
}

.cl-link-label {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.cl-link-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

/* ── 特别鸣谢 ──
   整块做成一枚「奖状卡」：波点纹理 + 暖纸渐变底 + 顶部品牌色高光条 + cel 硬底。
   纹理与底渐变都走主题 token（--dot-color / --grad-card-ending），
   深浅两套主题自动适配，不需要写两份。 */
.cl-thanks {
  position: relative;
  overflow: hidden;
  padding: 12px 14px 13px;
  border-radius: 14px;
  background-color: var(--bg-sunken);
  background-image: radial-gradient(var(--dot-color) 1px, transparent 1.2px), var(--grad-card-ending);
  background-size: 10px 10px, cover;
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  box-shadow: 0 3px 0 rgba(var(--accent-rgb), 0.1);
}


.cl-thanks-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

/* 标题徽标：品牌渐变 + 缓慢流动（复用全局 cel-waterflow 关键帧，不另造动画），
   右上角的 ✦ 由全局 .sparkle 提供微闪 */
.cl-thanks-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 2px 11px;
  border-radius: 999px;
  background: var(--grad-brand);
  background-size: 200% 100%;
  color: #fff;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.6;
  box-shadow: 0 2px 0 rgba(var(--accent-rgb), 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  animation: cel-waterflow 4s linear infinite;
}

/* 徽标右侧引线：向右淡出 */
.cl-thanks-rule {
  flex: 1;
  min-width: 12px;
  height: 1px;
  border-radius: 1px;
  background: linear-gradient(90deg, rgba(var(--accent-rgb), 0.5), rgba(var(--accent-rgb), 0));
}

/* 两行共用一套网格列 —— 标签列宽度按最宽的那个自动对齐，不用写死像素。
   .cl-thanks-row 用 display:contents 把自己的两个子元素提升到这套网格里。
   标签本身没有底色，靠自身那条笔锋下划线做视觉锚点，行距仍比列距大一点，
   两组之间有留白呼吸。 */
.cl-thanks-body {
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 9px 10px;
}
.cl-thanks-row {
  display: contents;
}

/* 分类标签：纯字体 + 一笔自己画出来的「笔锋」下划线。
   文字依旧不加底色，层级靠排版拉开 —— 略大字号 + 700 字重 + 宽字距 + 行色相。
   文字色往 --text-bright 混：暖色下 text-bright 是深色、暗夜下是浅色，
   所以两种主题都能得到足够对比度的彩色字。
   （注意别照搬「深底白字」那版往 --cel-outline 混 —— 那是给背景用的深色锚点，
     用它混文字色会在暗夜主题得到深色字压深色底，直接看不清。） */
.cl-thanks-label {
  --lb: var(--accent);
  --ink-draw: 0ms;               /* 落笔延迟，第二组错峰写成 */
  position: relative;
  align-self: center;
  justify-self: start;
  padding: 0 0 4px 1px;          /* 底部留出笔锋的高度 */
  color: color-mix(in srgb, var(--lb) 70%, var(--text-bright));
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.5;
  white-space: nowrap;
}

/* ── 笔锋下划线 ──
   不用一根等宽直角线，而是拆成两段「写」出来：
   ::before 是压得实的主笔（粗、实色，覆盖前 68%），
   ::after 是收锋（细一档、向右淡出，压在最后 40%）。
   两段重叠 8%，接缝处不留白；::after 比 ::before 晚 190ms 落笔，
   于是入场时先看到重重一笔、再提笔收锋，读起来有书写的节奏。
   两段统一 skewX(-10deg)，整条笔锋带一点手写倾角。 */
.cl-thanks-label::before,
.cl-thanks-label::after {
  content: '';
  position: absolute;
  bottom: 0;
  transform-origin: left center;
  animation: cl-ink-lead 0.42s var(--ease-out) var(--ink-draw) backwards;
}

/* 主笔：实色 + 一道缓慢流过的光（复用全局 cel-waterflow 关键帧，不另造动画）。
   cel-waterflow 一个循环把 background-position 从 0% 拉到 200%，
   配合 background-size:200% 100%，窗口正好平移半个渐变周期。
   所以渐变必须做成「周期 0.5」—— 同一组高光在 0/18/25/32% 与 50/68/75/82%
   各放一份，循环首尾才严丝合缝；只放一份的话扫完会空一段再突然跳回起点。 */
.cl-thanks-label::before {
  left: 0;
  width: 68%;
  height: 3.5px;
  border-radius: 2px 1px 3px 1px;   /* 四角给不同值，模拟手绘的不规则收口 */
  background: linear-gradient(90deg,
    var(--lb) 0%,
    var(--lb) 18%,
    color-mix(in srgb, var(--lb) 62%, #fff) 25%,
    var(--lb) 32%,
    var(--lb) 50%,
    var(--lb) 68%,
    color-mix(in srgb, var(--lb) 62%, #fff) 75%,
    var(--lb) 82%,
    var(--lb) 100%);
  background-size: 200% 100%;
  animation: cl-ink-lead 0.42s var(--ease-out) var(--ink-draw) backwards,
    cel-waterflow 5s linear infinite;
}

/* 收锋：比主笔细，底边抬 1px 对齐主笔中线，向右淡出成飞白 */
.cl-thanks-label::after {
  left: 60%;
  width: 40%;
  height: 1.5px;
  bottom: 1px;
  border-radius: 1px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--lb) 80%, transparent),
    color-mix(in srgb, var(--lb) 18%, transparent));
  animation: cl-ink-tail 0.34s var(--ease-out) calc(var(--ink-draw) + 190ms) backwards;
}

@keyframes cl-ink-lead {
  from { transform: skewX(-10deg) scaleX(0); }
  to { transform: skewX(-10deg) scaleX(1); }
}
@keyframes cl-ink-tail {
  from { transform: skewX(-10deg) scaleX(0); opacity: 0; }
  to { transform: skewX(-10deg) scaleX(1); opacity: 1; }
}

/* 第二组换个色相，一眼能分出两组；落笔再晚一拍，两行不是齐刷刷同时写完 */
.cl-thanks-row:nth-child(2) .cl-thanks-label {
  --lb: var(--accent-3);
  --ink-draw: 140ms;
}

.cl-thanks-names {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

/* ── 姓名标签 ──
   底色 / 描边 / 文字全部由 --tone 派生，并统一向 --text-bright 偏移：
   暖色下 text-bright 是深色、暗夜下是浅色，所以一套规则两套主题都有对比度，
   不用维护两份色表（与 components.css 里 .icon-tile.t-* 的取色同源）。 */
.cl-name {
  --tone: var(--fun-orange);
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  padding: 1px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tone) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
  color: color-mix(in srgb, var(--tone) 60%, var(--text-bright));
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  user-select: none;
  white-space: nowrap;
  /* 赛璐璐贴纸质感：同色硬底 + 顶部高光 */
  box-shadow: 0 1.5px 0 color-mix(in srgb, var(--tone) 30%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  transition: transform 0.16s var(--ease-out), box-shadow 0.16s ease, background-color 0.16s ease;
}
.cl-name:hover {
  transform: translateY(-1.5px);
  background: color-mix(in srgb, var(--tone) 26%, transparent);
  box-shadow: 0 3.5px 0 color-mix(in srgb, var(--tone) 42%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.cl-t-orange { --tone: var(--fun-orange); }
.cl-t-teal   { --tone: var(--fun-teal); }
.cl-t-blue   { --tone: var(--fun-blue); }
.cl-t-pink   { --tone: var(--fun-pink); }
.cl-t-violet { --tone: var(--fun-violet); }
.cl-t-gold   { --tone: var(--fun-gold); }
.cl-t-purple { --tone: var(--fun-purple); }

.cl-foot-actions {
  display: flex;
  justify-content: flex-end;
}

/* 皮肤交给 LinsheButton，这里只调尺寸 */
.cl-ok {
  min-width: 112px;
  min-height: 38px;
}

@media (max-width: 640px) {
  .cl-entry {
    padding: 12px 13px 14px;
  }
  .cl-topline {
    margin-bottom: 12px;
  }
  /* 窄屏放不下就换行显示完整内容，别截断成「icecranberry/galg…」 */
  .cl-link-text {
    white-space: normal;
    overflow: visible;
  }
  .cl-link {
    font-size: 11.5px;
    padding: 4px 10px 4px 8px;
  }
  .cl-thanks {
    padding: 11px 12px 12px;
  }
  .cl-thanks-head {
    margin-bottom: 8px;
  }
  .cl-thanks-body {
    gap: 8px 8px;
  }
  .cl-thanks-badge {
    padding: 2px 9px;
    font-size: 11px;
  }
}

/* 减弱动效：流光/扫光/入场都由 base.css 的全局规则压掉了，
   但它只改 animation-duration，不清 animation-delay ——
   .stagger 的错峰延迟会让后几个标签先空白一小会儿，这里显式清零。
   笔锋下划线同理：延迟期间它还停在 scaleX(0)，不清零的话标签底下会先空一拍。
   （::after 的延迟是 calc 出来的，所以得直接覆盖 animation-delay，
     只把 --ink-draw 归零是不够的。） */
@media (prefers-reduced-motion: reduce) {
  .cl-thanks-names.stagger > * {
    animation-delay: 0ms;
  }
  .cl-thanks-label::before,
  .cl-thanks-label::after {
    animation-delay: 0ms;
  }
}
</style>
