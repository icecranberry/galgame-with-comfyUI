<template>
  <Teleport :to="anchor || 'body'" defer>
    <!-- 首次直达页面时，anchor 宿主与弹窗同批挂载；等宿主插入后再解析目标。 -->
    <Transition name="modal-fade" :duration="transitionMs">
      <div v-if="isOpen" class="modal-overlay linshe-modal-overlay" :class="{ 'is-host-anchored': isAnchored }" :style="transitionMs ? {'--linshe-modal-duration':`${transitionMs}ms`} : undefined" @click.self="close">
        <div class="modal-panel linshe-modal" :class="[{ 'modal-wide': wide, 'modal-full': full, 'modal-comic': variant === 'comic' }, panelClass]" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">{{ title }}</h3>
            <span v-if="$slots['header-extra']" class="modal-header-extra"><slot name="header-extra" /></span>
            <slot name="close" :close="close"><linshe-button variant="icon" aria-label="关闭" @click="close">✕</linshe-button></slot>
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
import { computed, watch, onBeforeUnmount } from 'vue'

import LinsheButton from './LinsheButton.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 旧用法仍可传 visible；新用法优先 v-model */
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  variant: { type: String, default: 'default' },
  transitionMs: { type: Number, default: undefined },
  wide: { type: Boolean, default: false },   // 面板加宽（.modal-wide）
  full: { type: Boolean, default: false },   // 大型管理面板（.modal-full）
  panelClass: { type: [String, Array, Object], default: '' },
  bodyClass: { type: [String, Array, Object], default: '' },
  /**
   * 宿主选择器（如 '.page-modal-host'）：遮罩 Teleport 进该元素并铺满它，面板相对宿主居中，
   * 而不是相对整个视口居中（页面两侧有导航 / 侧栏时，视口居中的面板看着是偏的）。
   * 宿主需要是定位元素（position 非 static），并与路由内容隔开，避免卸载时移除路由插入锚点。
   * 留空＝旧口径：Teleport 到 body、相对视口居中。
   */
  anchor: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'close'])
const isOpen = computed(() => props.modelValue || props.visible)
const isAnchored = computed(() => !!props.anchor)

function close() {
  emit('update:modelValue', false)
  emit('close')
}

// Esc 关闭
function onKeydown(e) {
  if (e.key === 'Escape' && isOpen.value) close()
}
watch(isOpen, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.modal-fade-enter-active { transition-duration:var(--linshe-modal-duration,250ms); }
.modal-fade-leave-active { transition-duration:var(--linshe-modal-duration,180ms); }
.modal-fade-enter-active .modal-panel { animation-duration:var(--linshe-modal-duration,340ms); }
.modal-header-extra {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  margin-right: 10px;
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
/* 面板宽度上限改按宿主宽度算：基座的 94vw/96vw 是视口口径，宿主被侧栏占去一块后会顶出边界 */
.linshe-modal-overlay.is-host-anchored .modal-panel { max-width: 100%; }

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
}

/* 操作区自带底部留白；有 footer 时不再叠加内衬的底部间距。 */
.linshe-modal-lining.has-footer { margin-bottom: 0; }
/* 传媒的漫画阅读变体；默认弹窗不受影响。 */
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
