<template>
  <!-- 角色立绘：桌面端是主面板左侧的悬浮窗（默认），手机端内联在详情卡正文末尾（inline） -->
  <div class="detail-standing" :class="{ 'is-inline': inline }">
    <div class="standing-panel">
      <div
        class="standing-panel-header"
        role="button"
        tabindex="0"
        :title="ctl.funcOpen ? '收起立绘操作' : '展开立绘操作'"
        @click="ctl.toggleFunc"
        @keydown.enter.prevent="ctl.toggleFunc"
        @keydown.space.prevent="ctl.toggleFunc"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
        </svg>
        角色立绘
        <svg class="standing-chevron" :class="{ open: ctl.funcOpen }" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div
        class="standing-stage"
        role="button"
        tabindex="0"
        :title="ctl.funcOpen && character?.standing_url ? '再点一次查看大图' : '点击展开立绘操作'"
        @click="ctl.onStageClick"
        @keydown.enter.prevent="ctl.onStageClick"
        @keydown.space.prevent="ctl.onStageClick"
      >
        <img v-if="character?.standing_url" :src="ctl.displayUrl" class="standing-img" alt="" />
        <div v-else-if="!ctl.busyForChar" class="standing-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <p class="standing-empty-title">尚未生成立绘</p>
          <p class="standing-empty-hint"></p>
        </div>
        <!-- 生成中：扫描线 + 轮播趣语（与角色招募同款） -->
        <div v-if="ctl.busyForChar" class="standing-loading">
          <div class="standing-scan-line"></div>
          <div class="standing-spinner"></div>
          <span class="standing-loading-text">{{ ctl.reimageing ? '正在重绘立绘…' : '正在生成立绘…' }}</span>
          <span class="standing-loading-tip">{{ ctl.tip }}</span>
        </div>
      </div>
      <Transition name="standing-func">
        <div v-if="ctl.funcOpen" class="standing-func">
          <div class="standing-func-input-row">
            <div
              class="standing-mode-badge"
              role="button"
              tabindex="0"
              :class="[ctl.mode, { 'is-disabled': ctl.busy }]"
              :aria-disabled="ctl.busy || undefined"
              title="切换立绘姿势风格（全局设置）"
              @click="ctl.toggleMode"
              @keydown.enter.prevent="ctl.toggleMode"
              @keydown.space.prevent="ctl.toggleMode"
            >{{ ctl.mode === 'dynamic' ? '张力！' : '普通' }}</div>
            <linshe-input
              v-model="ctl.requirement"
              :size="controlSize"
              placeholder="额外立绘需求"
              @keyup.enter="ctl.generate"
            />
          </div>
          <div class="standing-func-btns">
            <template v-if="ctl.hasPrompt">
              <linshe-button variant="secondary" :size="controlSize" :loading="ctl.generating" :disabled="ctl.busy" @click="ctl.generate">重新生成提示词</linshe-button>
              <linshe-button variant="primary" :size="controlSize" :loading="ctl.reimageing" :disabled="ctl.busy" @click="ctl.regenerate">再次Roll图</linshe-button>
            </template>
            <template v-else>
              <linshe-button variant="primary" :size="controlSize" :loading="ctl.generating" :disabled="ctl.busy" @click="ctl.generate">生成立绘</linshe-button>
            </template>
          </div>
          <div class="standing-manage-btns">
            <linshe-button variant="secondary" :size="controlSize" :disabled="ctl.busy || ctl.uploading" @click="pickFile">上传立绘</linshe-button>
            <linshe-button v-if="character?.standing_url" variant="ghost" :size="controlSize" :disabled="ctl.busy" @click="ctl.remove">删除立绘</linshe-button>
          </div>
        </div>
      </Transition>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFileChange" />
    </div>
  </div>
</template>
<script setup>
// 角色立绘面板：桌面端是主面板左侧的悬浮窗（默认），手机端内联在详情卡正文末尾（inline）。
// 面板自身不持有状态与请求逻辑 —— 全部由父组件通过 ctl 传入（见 CharacterDetailModal 的
// 立绘接口）：详情弹窗会因打开 LoRA / 外观设置而整体重建，状态留在弹窗里才不会丢。
import { computed, ref } from 'vue'

import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'

const props = defineProps({
  character: { type: Object, default: null },
  /** 父组件的立绘接口：{ funcOpen, requirement, hasPrompt, generating, reimageing, busy, busyForChar, uploading, tip, displayUrl, mode, ...动作 } */
  ctl: { type: Object, required: true },
  /** true = 内联在正文里（手机端）；false = 悬浮在主面板左侧（桌面端） */
  inline: { type: Boolean, default: false },
})

// 手机端内联时控件用 md（点按更稳），桌面端悬浮窗保持 sm
const controlSize = computed(() => (props.inline ? 'md' : 'sm'))

// 隐藏的 file input 是面板唯一的自有 DOM：选到文件后交给 ctl.uploadFile 校验 / 上传
const fileInput = ref(null)
function pickFile() {
  if (props.ctl.busy || props.ctl.uploading) return
  fileInput.value?.click()
}
function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file) props.ctl.uploadFile(file)
}
</script>

<style scoped>
/* ═══ 立绘面板 ═══
   默认（桌面端）：主面板左侧的悬浮窗，与右侧 float 面板镜像；
   .is-inline（手机端）：收进详情卡正文末尾，换成与正文卡片同款的玻璃卡。 */
.detail-standing {
  position: absolute;
  right: calc(50% + min(450px, 48.5vw) + 16px);
  top: 2.5vh;
  width: 300px;
  z-index: 0;
}
.standing-panel {
  display: flex; flex-direction: column;
  padding: 12px;
  border-radius: 18px;
  background: var(--side-panel-bg);
  border: var(--side-panel-border);
  box-shadow: var(--side-panel-shadow);
  /* 主面板 modal-pop(0.28s) 结束后再延迟 0.5s，与右侧 float-emerge 镜像向左弹出；
     初始多藏 60px，避免面板 0.92 缩放阶段露出左缘 */
  animation: standing-emerge 0.5s cubic-bezier(0.3, 1.35, 0.55, 1) 0.5s both;
}
@keyframes standing-emerge {
  0%   { transform: translateX(calc(100% + 60px)); }
  100% { transform: translateX(0); }
}
.standing-panel-header {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; letter-spacing: 1px;
  color: var(--text-secondary);
  margin: 2px 2px 10px;
  cursor: pointer; user-select: none;
  border-radius: 8px; padding: 2px 4px;
  transition: color 0.15s, background 0.15s;
}
.standing-panel-header:hover { color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
.standing-chevron { margin-left: auto; transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.standing-chevron.open { transform: rotate(180deg); }
.standing-stage {
  position: relative;
  aspect-ratio: 1 / 2;
  max-height: calc(95vh - 250px);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.standing-stage:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.standing-img { width: 100%; height: 100%; object-fit: contain; display: block; }
.standing-empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 16px 14px; text-align: center;
  color: var(--text-secondary);
}
.standing-empty svg { opacity: 0.3; color: var(--text-secondary); flex-shrink: 0; }
.standing-empty-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin: 0; }
.standing-empty-hint { font-size: 11px; line-height: 1.6; color: var(--text-secondary); margin: 0; }
/* 生成中遮罩：扫描线 + 轮播趣语（与角色招募同款） */
.standing-loading {
  position: absolute; inset: 0; z-index: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 16px; text-align: center;
  background: var(--glass-bg);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow: hidden;
}
.standing-scan-line {
  position: absolute; left: 10%; right: 10%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: standing-scan-sweep 2s ease-in-out infinite;
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.6), 0 0 8px rgba(var(--accent-rgb), 0.3);
}
@keyframes standing-scan-sweep {
  0%   { top: 10%; opacity: 0.2; }
  25%  { top: 90%; opacity: 1; }
  50%  { top: 90%; opacity: 0.2; }
  75%  { top: 10%; opacity: 1; }
  100% { top: 10%; opacity: 0.2; }
}
.standing-spinner {
  width: 22px; height: 22px;
  border: 2.5px solid rgba(var(--accent-rgb), 0.2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: standing-spin 0.7s linear infinite;
}
@keyframes standing-spin { to { transform: rotate(360deg); } }
.standing-loading-text {
  font-size: 13px; font-weight: 700; color: var(--accent);
  animation: standing-tip-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.3);
}
.standing-loading-tip {
  font-size: 11px; line-height: 1.6; color: var(--text-secondary);
  animation: standing-tip-pulse 1.2s ease-in-out infinite;
}
@keyframes standing-tip-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.97); }
  50%      { opacity: 1;   transform: scale(1); }
}
.standing-func { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; }
.standing-func-input-row { display: flex; align-items: center; gap: 8px; }
.standing-func-input-row .ls-input { flex: 1; width: auto; min-width: 0; }
/* 姿势风格切换徽标：与表情包管理 emoji-mode-badge 同款双色胶囊 */
.standing-mode-badge {
  flex-shrink: 0;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  text-align: center;
  -webkit-tap-highlight-color: transparent;
}
.standing-mode-badge.normal { background: color-mix(in srgb, var(--fun-teal) 12%, transparent); color: var(--fun-teal); }
.standing-mode-badge.dynamic { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); }
.standing-mode-badge:hover:not(.is-disabled) { transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.standing-mode-badge:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.standing-mode-badge.is-disabled { opacity: 0.5; cursor: default; }
.standing-func-btns { display: flex; align-items: center; gap: 8px; }
.standing-func-btns > :first-child { flex: 1; }
/* 上传 / 删除立绘并排各占一半 */
.standing-manage-btns { display: flex; align-items: center; gap: 8px; }
.standing-manage-btns > * { flex: 1; min-width: 0; }
.standing-func-enter-active { transition: all 0.32s cubic-bezier(0.3, 1.35, 0.55, 1); overflow: hidden; }
.standing-func-leave-active { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.standing-func-enter-from, .standing-func-leave-to { opacity: 0; max-height: 0; transform: translateY(-8px); }
.standing-func-enter-to, .standing-func-leave-from { opacity: 1; max-height: 150px; transform: translateY(0); }

/* ── 内联变体（手机端）：正文里的普通卡片，不做悬浮入场 ── */
.detail-standing.is-inline {
  position: static;
  width: auto;
  margin-top: 14px;
}
.detail-standing.is-inline .standing-panel {
  padding: 10px;
  border-radius: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: none;
  animation: none;
}
.detail-standing.is-inline .standing-panel-header {
  margin: 2px 4px 10px;
  padding: 6px 4px;
  font-size: 12px;
}
/* 手机端按 2:3 竖图展示，并给一张图设上限，避免立绘吃掉整屏 */
.detail-standing.is-inline .standing-stage {
  aspect-ratio: 2 / 3;
  max-height: 58vh;
}
</style>
