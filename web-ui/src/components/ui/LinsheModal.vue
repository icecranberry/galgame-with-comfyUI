<template>
  <Teleport :to="anchor || 'body'" defer>
    <!-- 首次直达页面时，anchor 宿主与弹窗同批挂载；等宿主插入后再解析目标。 -->
    <Transition name="modal-fade" :duration="transitionMs" @after-leave="afterLeave">
      <div v-if="isOpen" ref="overlay" class="modal-overlay linshe-modal-overlay" :class="{ 'is-host-anchored': isAnchored, 'is-floating': floating, 'is-full-height': fullHeight }" :style="overlayStyle" @pointerdown="onBackdropPointerDown" @click.self="onBackdropClick">
        <div ref="panel" class="modal-panel linshe-modal" :class="[{ 'modal-wide': wide, 'modal-full': full, 'modal-comic': variant === 'comic', 'modal-film': variant === 'film' }, panelClass]" role="dialog" :aria-modal="floating ? undefined : true" :aria-label="title || undefined" tabindex="-1" @click.stop>
          <div class="modal-header">
            <slot name="title"><h3 class="modal-title">{{ title }}</h3></slot>
            <span v-if="$slots['header-extra']" class="modal-header-extra"><slot name="header-extra" /></span>
            <slot v-if="showClose" name="close" :close="close" :disabled="closeDisabled || checkingClose">
              <linshe-close-button :disabled="closeDisabled || checkingClose" @click="close()" />
            </slot>
          </div>
          <!-- 白色内衬：浮于暖纸外壳之上，标题栏留在外壳上（与 LoRA 设置窗一致） -->
          <div class="linshe-modal-lining" :class="{ 'has-footer': !!$slots.footer }">
            <div class="modal-body" :class="bodyClass">
              <slot />
            </div>
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
// 统一弹窗基座（Linshe 基础窗体组件）：Teleport + 遮罩 + 面板 + 头部/关闭键，
// 视觉走全局 modal 家族类 + 本组件的白色内衬（--modal-lining-*）。
// 暖色沿用 v3.2 人物详情卡口径（暖纸外壳 + 白色内衬），暗夜保持 Cel Glow 深色玻璃。
// 内容用 #default 插槽；需要自定义底部操作区时用 #footer；头部右侧附加内容用 #header-extra。
import { computed, ref, watch, nextTick, onBeforeUnmount, provide } from 'vue'

import LinsheCloseButton from './LinsheCloseButton.vue'
import { registerModal, nextModalLayer } from './modalStack.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 旧用法仍可传 visible；新用法优先 v-model */
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  variant: { type: String, default: 'default' },
  transitionMs: { type: Number, default: undefined },
  wide: { type: Boolean, default: false },   // 面板加宽（.modal-wide）
  full: { type: Boolean, default: false },   // 大型管理面板（.modal-full）
  fullHeight: { type: Boolean, default: false }, // 撑满可用高度，宽度仍由原尺寸档位控制
  floating: { type: Boolean, default: false }, // 右下角无阻挡工具窗，复用统一面板皮肤
  panelClass: { type: [String, Array, Object], default: '' },
  bodyClass: { type: [String, Array, Object], default: '' },
  showClose: { type: Boolean, default: true },
  closeDisabled: { type: Boolean, default: false },
  closeOnBackdrop: { type: Boolean, default: true },
  closeOnEscape: { type: Boolean, default: true },
  /** 返回 false 可拒绝关闭；允许异步确认。业务清理仍在 @close 处理。 */
  beforeClose: { type: Function, default: null },
  /** 被独立灯箱等特殊浮层覆盖时，暂停键盘处理。 */
  suspended: { type: Boolean, default: false },
  zIndex: { type: Number, default: undefined },
  /**
   * 宿主选择器（如 '.page-modal-host'）：遮罩 Teleport 进该元素并铺满它，面板相对宿主居中，
   * 而不是相对整个视口居中（页面两侧有导航 / 侧栏时，视口居中的面板看着是偏的）。
   * 宿主需要是定位元素（position 非 static），并与路由内容隔开，避免卸载时移除路由插入锚点。
   * 留空＝旧口径：Teleport 到 body、相对视口居中。
   */
  anchor: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'close', 'after-leave', 'close-error'])
const isOpen = computed(() => props.modelValue || props.visible)
const isAnchored = computed(() => !!props.anchor)
const overlay = ref(null), panel = ref(null), checkingClose = ref(false)
const activeLayer = ref(undefined)
// Teleport 到 body 的附属工具仍需跟随本窗口的动态栈层级。
provide('linsheModalLayer', computed(() => activeLayer.value ?? props.zIndex ?? 10000))
const overlayStyle = computed(() => ({
  ...(props.transitionMs !== undefined ? { '--linshe-modal-duration': `${props.transitionMs}ms` } : {}),
  ...(activeLayer.value !== undefined ? { zIndex: activeLayer.value } : {}),
}))
let unregister = null, previousFocus = null, opening = 0, backdropStarted = false, disposed = false

async function close(reason = 'button') {
  if (!isOpen.value || props.closeDisabled || checkingClose.value || props.suspended) return
  const version = opening
  checkingClose.value = true
  try {
    if (props.beforeClose && await props.beforeClose(reason) === false) return
    if (disposed || version !== opening || !isOpen.value || props.closeDisabled) return
    emit('update:modelValue', false)
    emit('close', reason)
  } catch (error) {
    emit('close-error', error)
  } finally {
    checkingClose.value = false
  }
}

function onBackdropPointerDown(event) { backdropStarted = event.target === event.currentTarget }
function onBackdropClick(event) {
  if ((backdropStarted || event.detail === 0) && props.closeOnBackdrop && !props.floating) void close('backdrop')
  backdropStarted = false
}
function afterLeave() {
  if (isOpen.value) return
  unregister?.(); unregister = null
  const doc = previousFocus?.ownerDocument
  if (previousFocus?.isConnected && (doc.activeElement === doc.body || !doc.activeElement?.isConnected)) previousFocus.focus({ preventScroll: true })
  previousFocus = null
  emit('after-leave')
}
watch(isOpen, async value => {
  const version = ++opening
  if (!value) return // 退出动画完成前保留栈位，不让 Esc 穿透到底层。
  activeLayer.value = undefined
  previousFocus = panel.value?.ownerDocument?.activeElement || globalThis.document?.activeElement
  await nextTick()
  if (disposed || version !== opening || !panel.value?.ownerDocument) return
  unregister?.()
  activeLayer.value = nextModalLayer(panel.value.ownerDocument, props.zIndex ?? (Number.parseInt(getComputedStyle(overlay.value).zIndex) || 10000))
  unregister = registerModal({
    panel: panel.value,
    floating: props.floating,
    layer: () => activeLayer.value || 0,
    suspended: () => props.suspended,
    escape: () => { if (props.closeOnEscape) void close('escape') },
  })
  if (!props.floating) panel.value.focus({ preventScroll: true })
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => {
  disposed = true
  unregister?.()
})
</script>

<style scoped>
.modal-fade-enter-active { transition-duration:var(--linshe-modal-duration,300ms); }
.modal-fade-leave-active { transition-duration:var(--linshe-modal-duration,300ms); }
.modal-fade-enter-active .modal-panel { animation-duration:var(--linshe-modal-duration,300ms); }
.modal-header { gap: 12px; }
:slotted(.modal-heading-content) { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 1; min-width: 0; flex-wrap: wrap; }
.modal-title { min-width: 0; overflow-wrap: anywhere; }
.linshe-modal:focus { outline: none; }
.linshe-modal .modal-body.modal-workspace-body { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.linshe-modal .modal-body.modal-form-body { display: flex; flex-direction: column; gap: 12px; }
.modal-form-body > :deep(*) { flex-shrink: 0; }
.modal-header-extra {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 12px;
  min-width: 0;
  margin-left: auto;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
/* 统计内容只提供语义标记，排版与主题统一由弹窗维护。 */
.modal-header-extra :deep(.modal-header-stat) {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}
.modal-header-extra :deep(.modal-header-stat-value) {
  color: var(--text-primary);
  font-size: var(--fs-base);
  font-weight: 700;
}
.modal-header-extra :deep(.modal-header-stat-value.is-active) {
  color: color-mix(in srgb, var(--accent) 55%, var(--text-primary));
}

.linshe-modal-lining {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin: var(--modal-lining-margin);
  background: var(--modal-lining-bg);
  border: var(--modal-lining-border);
  border-radius: var(--modal-lining-radius);
}

/* 留白交给 body（对齐 LoRA 设置窗的 .lora-body-card 内边距），页面 body-class 可安全覆盖 */
.linshe-modal .modal-body {
  padding: var(--modal-lining-pad);
  /* 滚动条走主题色淡化，替代 base.css 的固定灰紫 */
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--accent-rgb), 0.28) transparent;
}
.linshe-modal .modal-body::-webkit-scrollbar { width: 6px; height: 6px; }
.linshe-modal .modal-body::-webkit-scrollbar-track { background: transparent; }
.linshe-modal .modal-body::-webkit-scrollbar-thumb {
  background: rgba(var(--accent-rgb), 0.28);
  border-radius: 999px;
}
.linshe-modal .modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--accent-rgb), 0.45);
}

/* 宿主居中模式（传了 anchor）：遮罩被 Teleport 进宿主元素，fixed 改 absolute 铺满宿主，
   面板因此相对宿主左右居中，而不是相对视口居中。 */
.linshe-modal-overlay.is-host-anchored { position: absolute; }
.linshe-modal-overlay.is-floating { background:transparent; pointer-events:none; align-items:flex-end; justify-content:flex-end; }
.linshe-modal-overlay.is-floating .modal-panel { pointer-events:auto; width:min(420px,100%); }
/* 面板宽度上限改按宿主宽度算：基座的 94vw/96vw 是视口口径，宿主被侧栏占去一块后会顶出边界 */
.linshe-modal-overlay.is-host-anchored .modal-panel { max-width: 100%; }

/* 社交帖子与数字报刊共用阅读窗尺寸，移动端继续使用下方统一适配。 */
.linshe-modal-overlay.is-full-height > .modal-panel {
  height: 100%;
  max-height: 100%;
}
@media (min-width: 768px) {
  .linshe-modal-overlay.is-full-height { padding-block: 0; }
  .linshe-modal-overlay:has(> .media-reader-panel) {
    padding-block: 10px;
  }
  .media-reader-panel {
    height: 100dvh;
    max-height: 100%;
  }
}

/* 移动端：保留 PC 的「圆角浮层」观感 —— 面板圆角、描边、白色内衬一律不动，
   只把遮罩留白从 20px 收紧到 8px，并把刘海 / 挖孔 / 手势条的安全区让给遮罩
   （面板靠遮罩内边距避开异形屏，因此头部不再需要单独加 safe-area 上内边距）。
   历史写法是 full 面板 100vw/100dvh + border-radius: 0，会让面板被遮罩内边距
   推向一侧、贴边裁切并丢掉圆角，与 PC 观感完全不一致，已废弃。 */
@media (max-width: 767px) {
  .linshe-modal-overlay {
    /* 只收内边距，不动 inset:0（写死 100dvh 会让遮罩底部在手机浏览器里露一条缝） */
    padding: calc(8px + env(safe-area-inset-top, 0px))
             calc(8px + env(safe-area-inset-right, 0px))
             calc(8px + env(safe-area-inset-bottom, 0px))
             calc(8px + env(safe-area-inset-left, 0px));
  }
  /* 三档尺寸在窄屏统一铺满可用宽度（.modal-wide/.modal-full 的 PC 宽度对手机没意义），
     高度仍受遮罩内容区约束，避免顶进安全区 */
  .linshe-modal.modal-panel {
    width: 100%;
    max-width: 100%;
    max-height: 100%;
  }
  /* full 面板撑满可用高度，但保持留边与圆角 */
  .linshe-modal.modal-full { height: 100%; }
  /* 内衬留白收紧；底部安全区已由遮罩内边距让出，不再叠加 */
  .linshe-modal-lining { margin: var(--modal-lining-margin-mobile); }
  /* 神说日志在窄屏压缩两侧留白，正文只由日志列表承载总滚动。 */
  .god-logs-modal {
    --modal-lining-margin-mobile: 0 6px 6px;
    --modal-lining-pad: 8px 6px;
  }
  .god-logs-modal .god-logs-body {
    display: flex;
    overflow: hidden;
  }
}

@media (max-width: 480px) {
  .modal-header:has(.modal-header-extra) { flex-wrap: wrap; row-gap: 8px; }
  .modal-header-extra { order: 1; flex-basis: 100%; }
}

/* 操作区自带底部留白；有 footer 时不再叠加内衬的底部间距。 */
.linshe-modal-lining.has-footer { margin-bottom: 0; }
/* 传媒的漫画阅读变体；默认弹窗不受影响。 */
.modal-film {
  --modal-bg: var(--studio-paper);
  --modal-border: 1px solid var(--studio-ink);
  --modal-radius: 4px;
  --modal-shadow: 6px 6px 0 var(--studio-shadow);
  --modal-backdrop: none;
  --modal-lining-bg: var(--studio-paper);
  --modal-lining-border: none;
  --modal-lining-radius: 0;
  --modal-lining-margin: 0 12px 12px;
  --modal-lining-margin-mobile: 0 6px 6px;
  --modal-lining-pad: 12px;
  color: var(--studio-ink);
}
.modal-film .modal-header { padding:16px 24px; border-bottom:2px solid var(--studio-ink); background:url('../../assets/studio-photocopy.svg'),var(--studio-paper); }
.modal-film .modal-title { color:var(--studio-ink); font-size:24px; font-weight:900; letter-spacing:-.04em; }
.modal-film .modal-title::before { content:'✳'; color:var(--studio-tag); margin-right:10px; }
.modal-film .modal-footer { border-top:1px dashed var(--studio-ink); padding:12px 24px; }
.modal-film .modal-body { scrollbar-color:var(--studio-muted) transparent; }
@media(max-width:600px) { .modal-film .modal-header,.modal-film .modal-footer { padding:12px; }.modal-film .modal-title { font-size:20px; } }
.modal-comic {
  --modal-bg: var(--media-paper);
  --modal-border: 3px solid var(--media-ink);
  --modal-radius: 4px;
  --modal-shadow: 8px 8px 0 var(--media-ink);
  --modal-backdrop: none;
  --modal-lining-bg: var(--media-paper);
  --modal-lining-border: none;
  --modal-lining-radius: 0;
  --modal-lining-margin: 0;
  --modal-lining-margin-mobile: 0;
  --modal-lining-pad: 0;
}
.modal-comic .modal-header { background: var(--media-ink); color: var(--media-light); padding: 10px 18px; }
.modal-comic .modal-title { color: var(--media-light); font-size: 14px; letter-spacing: .16em; }
.modal-comic .modal-title::before { content: '✦'; color: var(--accent); font-size: 24px; }
.modal-comic .modal-footer { border-top: 3px solid var(--media-ink); padding: 14px 20px; }
@media (max-width: 600px) { .modal-comic .modal-footer { padding: 12px; } }
</style>
