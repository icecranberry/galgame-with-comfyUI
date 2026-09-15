<template>
  <div
    v-if="visible"
    class="update-tag"
    tabindex="0"
    :aria-label="ariaLabel"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="onEnter"
    @focusout="onLeave"
  >
    <span class="update-tag-label">有更新噢</span>

    <div class="update-popover">
      <div class="up-panel">
        <div class="up-head">
          <span class="up-title">有新版本 {{ info.latestTag }}</span>
          <span class="up-sub">当前 v{{ info.current }} · 落后 {{ info.tagCount }} 个版本</span>
          <span class="up-tip">请去启动器里更新或下载完整包噢~</span>
        </div>

        <div v-if="tags.length" class="up-body">
          <div v-for="group in tags" :key="group.tag" class="up-group">
            <span class="up-group-tag">{{ group.tag }}</span>
            <p v-if="group.annotation" class="up-annotation">{{ group.annotation }}</p>
          </div>

          <p v-if="info.annotationsTrimmed" class="up-note">版本比较多，这里只列了最新的一批 tag。</p>
          <!-- 注释一条都没拿到（网络抖动 / 限流）时不装没事，直接说明白 -->
          <p v-if="!hasAnnotation" class="up-note">这次没取到版本注释（网络不通或 GitHub 限流），点下面的链接去 GitHub 看。</p>
        </div>

        <p v-else class="up-note">这次没取到远端 tag 列表，去 GitHub 看吧。</p>

        <a class="up-link" :href="info.compareUrl" target="_blank" rel="noopener">在 GitHub 查看完整对比 ↗</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useUpdateStore } from '../stores/updateInfo.js'

/**
 * 系统设置页标题旁的「有更新噢」标签：只在远端出现比本地更高的新 tag 时出现，
 * 悬停展开这次更新包含的每个 tag 及其注释（浏览器直连 GitHub 拉取）。
 *
 * 看过一次就不再打扰：悬停停留够 SEEN_DWELL_MS 即记下这个版本。
 * 侧边栏红点立刻消失；标签本人留在原地不走，等切到别的页面（设置页卸载、
 * 组件跟着销毁）再回来时才不见 —— 免得刚看清就「啪」地一下没了。
 * 直到远端又发布比本地更高的新 tag 才会再次出现。
 */
const SEEN_DWELL_MS = 1200

const update = useUpdateStore()
const { info, hasUpdate } = storeToRefs(update)

// 本次已标记过已读：红点已经没了，但标签要留到离开这一页为止
const acked = ref(false)
const visible = computed(() => hasUpdate.value || acked.value)
const tags = computed(() => info.value?.tags || [])
const hasAnnotation = computed(() => tags.value.some(group => group.annotation))

const ariaLabel = computed(() => (info.value
  ? `有新版本 ${info.value.latestTag}，当前 v${info.value.current}，悬停查看更新内容`
  : ''))

let dwellTimer = null

function clearDwell() {
  if (dwellTimer) {
    clearTimeout(dwellTimer)
    dwellTimer = null
  }
}

function onEnter() {
  if (dwellTimer || acked.value || !hasUpdate.value) return
  // 停留够久才算看过：鼠标一扫而过不算，免得红点和标签被误关掉
  dwellTimer = setTimeout(() => {
    dwellTimer = null
    acked.value = true
    update.markSeen()   // 侧边栏红点即时消失，标签留到切页
  }, SEEN_DWELL_MS)
}

function onLeave() {
  clearDwell()
}

onBeforeUnmount(clearDwell)
</script>

<style scoped>
.update-tag {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  font-size: var(--fs-xs);
  font-weight: 700;
  line-height: 1.7;
  white-space: nowrap;
  user-select: none;
  cursor: help;
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 44%, transparent);
  /* 底色 + 一道扫过的高光。高光走 background 而不是伪元素，圆角会自动裁掉超出部分，
     不需要给标签加 overflow:hidden（那会把下面的弹层一起剪掉） */
  background-color: color-mix(in srgb, var(--danger) 12%, transparent);
  background-image: linear-gradient(100deg, transparent 38%, rgba(255, 255, 255, 0.72) 50%, transparent 62%);
  background-size: 260% 100%;
  background-repeat: no-repeat;
  /* 入场弹一下 → 之后外圈呼吸光 + 高光反复扫过：只出现一次的东西，得让人一眼看见 */
  animation:
    update-tag-pop 560ms var(--ease-spring) both,
    update-tag-glow 2.4s ease-out 560ms infinite,
    update-tag-shine 2.8s linear 560ms infinite;
  transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}

/* 只改 background-color：用 background 简写会把高光那张渐变图一起清掉 */
.update-tag:hover,
.update-tag:focus-within {
  background-color: color-mix(in srgb, var(--danger) 20%, transparent);
  border-color: color-mix(in srgb, var(--danger) 66%, transparent);
}

.update-tag:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@keyframes update-tag-pop {
  0% { transform: scale(0.84); opacity: 0; }
  60% { transform: scale(1.07); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes update-tag-glow {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 55%, transparent); }
  100% { box-shadow: 0 0 0 9px transparent; }
}

@keyframes update-tag-shine {
  0% { background-position: 190% 0; }
  55%, 100% { background-position: -90% 0; }
}

/* 悬停桥：8px 内边距让鼠标从标签滑到面板时不穿过空隙掉出 hover */
.update-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: var(--z-popover);
  padding-top: 8px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-4px);
  transition:
    opacity var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard),
    visibility 0s linear var(--dur-fast);
}
.update-tag:hover .update-popover,
.update-tag:focus-within .update-popover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: none;
  transition:
    opacity var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard),
    visibility 0s;
}

.up-panel {
  display: flex;
  flex-direction: column;
  width: min(430px, calc(100vw - 110px));
  max-height: min(62vh, 460px);
  padding: 12px 14px;
  text-align: left;
  white-space: normal;
  background: var(--popover-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.up-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}
.up-title { font-size: var(--fs-md); font-weight: 700; color: var(--danger); }
.up-sub { font-size: var(--fs-xs); font-weight: 400; color: var(--text-secondary); }
.up-tip { font-size: var(--fs-xs); font-weight: 600; color: var(--accent); }

.up-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.up-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.up-group-tag { font-size: var(--fs-sm); font-weight: 700; color: var(--accent); }
.up-annotation {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
}

.up-note {
  margin: 10px 0 0;
  font-size: var(--fs-xs);
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-secondary);
}
.up-body .up-note { margin: 0; }

.up-link {
  margin-top: 10px;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
}
.up-link:hover { text-decoration: underline; }

@media (max-width: 767px) {
  .up-panel { width: calc(100vw - 48px); max-height: 52vh; }
}
</style>