<template>
  <VueEasyLightbox
    :key="lightboxKey"
    :visible="visible"
    :imgs="cachedImgs"
    :index="index"
    :max-zoom="maxZoom"
    :min-zoom="minZoom"
    :zoom-scale="zoomScale"
    :loop="loop"
    :scroll-disabled="scrollDisabled"
    :esc-disabled="escDisabled"
    :move-disabled="moveDisabled"
    :rotate-disabled="rotateDisabled"
    :zoom-disabled="zoomDisabled"
    :pinch-disabled="pinchDisabled"
    :mask-closable="maskClosable"
    :dblclick-disabled="dblclickDisabled"
    :swipe-tolerance="swipeTolerance"
    :rtl="rtl"
    :z-index="zIndex"
    @hide="onHide"
    @on-prev="(old, n) => $emit('on-prev', old, n)"
    @on-next="(old, n) => $emit('on-next', old, n)"
    @on-index-change="(old, n) => $emit('on-index-change', old, n)"
    @on-error="(e) => $emit('on-error', e)"
    @on-rotate="(deg) => $emit('on-rotate', deg)"
  />
</template>

<script setup>
import { ref, computed, watch, nextTick, inject, onMounted, onUnmounted } from 'vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'
import { regenerateImage, upscaleImage, deleteImage } from '../api/index.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  imgs: { type: [String, Array, Object], default: '' },
  index: { type: Number, default: 0 },
  showRegenerate: { type: Boolean, default: true },
  showUpscale: { type: Boolean, default: true },
  showDelete: { type: Boolean, default: true },
  maxZoom: { type: Number, default: 6 },
  minZoom: { type: Number, default: 0.1 },
  zoomScale: { type: Number, default: 0.12 },
  loop: { type: Boolean, default: false },
  scrollDisabled: { type: Boolean, default: true },
  escDisabled: { type: Boolean, default: false },
  moveDisabled: { type: Boolean, default: false },
  rotateDisabled: { type: Boolean, default: false },
  zoomDisabled: { type: Boolean, default: false },
  pinchDisabled: { type: Boolean, default: false },
  maskClosable: { type: Boolean, default: true },
  dblclickDisabled: { type: Boolean, default: false },
  swipeTolerance: { type: Number, default: 50 },
  rtl: { type: Boolean, default: false },
  zIndex: { type: Number, default: null },
})

const emit = defineEmits(['hide', 'update:visible', 'regenerated', 'upscaled', 'deleted'])
const toastFn = inject('toast', null)
const confirmFn = inject('confirm', null)

const cacheBump = ref(0)
const lightboxKey = ref(0)
const regenerating = ref(false)
const upscaling = ref(false)
const deleting = ref(false)

// 响应式布局：手机端 = 底部居中一行圆形按钮；电脑端 = 遮罩右侧竖排操作栏
const isMobile = ref(false)
let _mql = null
const _onMqlChange = (e) => {
  isMobile.value = e.matches
  if (props.visible) {
    removeActionBar()
    nextTick().then(() => setTimeout(injectActionBar, 80))
  }
}

onMounted(() => {
  _mql = window.matchMedia('(max-width: 767px)')
  isMobile.value = _mql.matches
  _mql.addEventListener('change', _onMqlChange)
})

// ── 操作按钮：注入到 .vel-modal 内部（与 vel-toolbar 同层级策略）──
// 作为遮罩的子元素天然高于遮罩背景；插入在 .vel-img-wrapper 之前且不带 z-index，
// 因此层级低于图片——放大/拖动图片时按钮会被图片盖住，符合 vel-toolbar 的层叠关系。
let _actionBar = null

const BTN_SVGS = {
  delete: '<svg class="vel-del-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  regen: '<svg class="vel-reg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>',
  ups: '<svg class="vel-ups-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
}

function removeActionBar() {
  _actionBar?.remove()
  _actionBar = null
}

function injectActionBar() {
  if (_actionBar || !props.visible) return
  const modal = document.querySelector('.vel-modal')
  if (!modal) return

  const bar = document.createElement('div')
  const mobile = isMobile.value
  bar.className = mobile ? 'vel-action-row' : 'vel-action-rail'

  const mkBtn = (key, cls, attrs, label, onClick) => {
    const btn = document.createElement('button')
    for (const [k, v] of Object.entries(attrs)) btn.setAttribute(k, v)
    if (cls) btn.className = cls
    btn.innerHTML = BTN_SVGS[key] + (label != null ? `<span>${label}</span>` : '')
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
    return btn
  }

  if (mobile) {
    if (props.showDelete) bar.appendChild(mkBtn('delete', '', { 'data-vel-delete': '', title: '删除图片' }, null, onDelete))
    if (props.showRegenerate) bar.appendChild(mkBtn('regen', '', { 'data-vel-regenerate': '', title: '重新生成' }, null, onRegenerate))
    if (props.showUpscale) bar.appendChild(mkBtn('ups', '', { 'data-vel-upscale': '', title: '放大细化（高清放大重绘）' }, null, onUpscale))
  } else {
    if (props.showDelete) bar.appendChild(mkBtn('delete', 'vel-rail-btn danger', { type: 'button' }, '删除', onDelete))
    if (props.showRegenerate) bar.appendChild(mkBtn('regen', 'vel-rail-btn', { type: 'button' }, '重新生成', onRegenerate))
    if (props.showUpscale) bar.appendChild(mkBtn('ups', 'vel-rail-btn accent', { type: 'button' }, '放大细化', onUpscale))
  }

  // 插入在图片节点之前 → 层级低于图片；容器本身不带 z-index
  const imgWrap = modal.querySelector('.vel-img-wrapper')
  modal.insertBefore(bar, imgWrap || null)
  _actionBar = bar
  syncActionBar()
}

/** 按状态刷新按钮（禁用/动画/文字/提示） */
function syncActionBar() {
  if (!_actionBar) return
  const mobile = isMobile.value
  const set = (selector, busy, busyTitle, idleTitle, busyLabel, idleLabel) => {
    const btn = _actionBar.querySelector(selector)
    if (!btn) return
    btn.disabled = busy
    btn.title = busy ? busyTitle : idleTitle
    const svg = btn.querySelector('svg')
    if (svg) {
      if (svg.classList.contains('vel-del-svg')) svg.classList.toggle('vel-del-spinning', busy)
      else if (svg.classList.contains('vel-reg-svg')) svg.classList.toggle('vel-reg-spinning', busy)
      else if (svg.classList.contains('vel-ups-svg')) svg.classList.toggle('vel-ups-pulsing', busy)
    }
    const label = btn.querySelector('span')
    if (label && !mobile) label.textContent = busy ? busyLabel : idleLabel
  }
  set('[data-vel-delete], .vel-rail-btn.danger', deleting.value, '删除中...', '删除图片', '删除中…', '删除')
  set('[data-vel-regenerate], .vel-rail-btn:not(.danger):not(.accent)', regenerating.value, '重新生成中...', '重新生成', '重新生成中…', '重新生成')
  set('[data-vel-upscale], .vel-rail-btn.accent', upscaling.value, '放大细化中（高清重绘，可能需要几分钟）...', '放大细化（高清放大重绘）', '细化中…', '放大细化')
}

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    setTimeout(injectActionBar, 80)
  } else {
    removeActionBar()
  }
})

watch([regenerating, upscaling, deleting], syncActionBar)

onUnmounted(() => {
  removeActionBar()
  _mql?.removeEventListener('change', _onMqlChange)
})

function bumpUrl(url) {
  if (!url || !cacheBump.value) return url
  return url.replace(/\?.*$/, '') + `?_t=${cacheBump.value}`
}

const cachedImgs = computed(() => {
  const v = props.imgs
  if (!cacheBump.value) return v
  if (typeof v === 'string') return bumpUrl(v)
  if (Array.isArray(v)) {
    return v.map(i => (typeof i === 'string' ? bumpUrl(i) : i?.src ? { ...i, src: bumpUrl(i.src) } : i))
  }
  if (v && typeof v === 'object' && v.src) {
    return { ...v, src: bumpUrl(v.src) }
  }
  return v
})

function getCurrentUrl() {
  const v = props.imgs
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.length > 0) {
    const item = v[Math.min(props.index, v.length - 1)]
    return typeof item === 'string' ? item : item?.src || ''
  }
  if (v && typeof v === 'object' && v.src) return v.src
  return ''
}

/** 扫描页面上所有 img / background-image，把旧图 URL 替换为带 cache-bust 的新 URL */
function refreshAllThumbnails(oldUrl) {
  if (!cacheBump.value) return
  const base = oldUrl.replace(/\?.*$/, '')
  const busted = base + `?_t=${cacheBump.value}`

  // 1. <img> 元素
  document.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || ''
    if (src.replace(/\?.*$/, '') === base) {
      img.setAttribute('src', busted)
    }
  })

  // 2. background-image 元素（画廊缩略图）
  document.querySelectorAll('*').forEach(el => {
    const bg = el.style.backgroundImage
    if (bg && bg.includes(base)) {
      el.style.backgroundImage = bg
        .replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?[^)\'"]*)?', 'g'), busted)
    }
  })
}

onUnmounted(() => {
  _mql?.removeEventListener('change', _onMqlChange)
})

function onHide() {
  emit('hide')
  emit('update:visible', false)
}

async function onRegenerate() {
  if (regenerating.value) return
  const url = getCurrentUrl()
  if (!url) return
  regenerating.value = true
  try {
    const result = await regenerateImage(url)
    if (result.success) {
      cacheBump.value = Date.now()
      lightboxKey.value++
      refreshAllThumbnails(url)
      emit('regenerated', result.url)
    }
  } catch (err) {
    console.error('[ImageLightbox] regenerate failed:', err.message)
    toastFn?.('重新生成失败: ' + err.message, 'error')
  } finally {
    regenerating.value = false
  }
}

async function onUpscale() {
  if (upscaling.value) return
  const url = getCurrentUrl()
  if (!url) return
  upscaling.value = true
  try {
    const result = await upscaleImage(url)
    if (result.success) {
      cacheBump.value = Date.now()
      lightboxKey.value++
      refreshAllThumbnails(url)
      toastFn?.('放大细化完成，已覆盖原图', 'success')
      emit('upscaled', result.url)
    }
  } catch (err) {
    console.error('[ImageLightbox] upscale failed:', err.message)
    toastFn?.('放大细化失败: ' + err.message, 'error')
  } finally {
    upscaling.value = false
  }
}

async function onDelete() {
  if (deleting.value) return
  const url = getCurrentUrl()
  if (!url) return
  const ok = confirmFn
    ? await confirmFn({ message: '确定要删除这张图片吗？', okText: '删除', danger: true })
    : window.confirm('确定要删除这张图片吗？')
  if (!ok) return
  deleting.value = true
  try {
    await deleteImage(url)
    emit('deleted', url)
    emit('hide')
    emit('update:visible', false)
  } catch (err) {
    console.error('[ImageLightbox] delete failed:', err.message)
    toastFn?.('删除失败: ' + err.message, 'error')
  } finally {
    deleting.value = false
  }
}
</script>

<style>
/* ── 电脑端：遮罩右侧竖排操作栏（z-index 由内联样式动态设定，高于遮罩） ── */
.vel-action-rail {
  position: fixed;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vel-rail-btn {
  display: flex; align-items: center; gap: 9px;
  padding: 11px 18px 11px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(28,28,30,0.82);
  color: #d6d6d6; font-size: 13px; font-weight: 500;
  cursor: pointer; white-space: nowrap;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.15s;
}
.vel-rail-btn:hover:not(:disabled) {
  background: rgba(48,48,52,0.92);
  color: #fff;
  transform: translateX(-2px);
}
.vel-rail-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.vel-rail-btn.accent { color: #8db6f9; border-color: rgba(96,165,250,0.32); }
.vel-rail-btn.accent:hover:not(:disabled) { color: #b3d0fc; }
.vel-rail-btn.danger { color: #f87a7a; border-color: rgba(239,68,68,0.3); }
.vel-rail-btn.danger:hover:not(:disabled) { color: #fda4a4; }
.vel-rail-btn svg { width: 17px; height: 17px; flex-shrink: 0; }

/* ── 手机端：底部居中一行圆形按钮（bottom:70px，z-index 由内联样式动态设定） ── */
.vel-action-row {
  position: fixed;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 16px;
}
.vel-action-row [data-vel-delete],
.vel-action-row [data-vel-regenerate],
.vel-action-row [data-vel-upscale] {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(45,45,45,0.88);
  color: #ccc; cursor: pointer; padding: 8px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  transition: background 0.2s, color 0.2s, opacity 0.2s;
}
.vel-action-row [data-vel-upscale] { color: #60a5fa; border-color: rgba(96,165,250,0.3); }
.vel-action-row [data-vel-delete] { color: #ef4444; border-color: rgba(239,68,68,0.3); }
.vel-action-row button:hover:not(:disabled) { background: rgba(60,60,60,0.92); color: #fff; }
.vel-action-row [data-vel-upscale]:hover:not(:disabled) { color: #93c5fd; }
.vel-action-row [data-vel-delete]:hover:not(:disabled) { color: #f87171; }
.vel-action-row button:disabled { cursor: not-allowed; opacity: 0.7; }
.vel-action-row svg { width: 24px; height: 24px; }

[data-vel-regenerate] {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.2); background: #2d2d2d;
  color: #ccc; cursor: pointer;
  padding: 10px;
  transition: background 0.2s, color 0.2s;
}
[data-vel-regenerate]:hover:not(:disabled) { background: rgba(45,45,45,0.7); color: #fff; }
[data-vel-regenerate]:disabled { cursor: not-allowed; }

.vel-reg-spinning {
  animation: vel-reg-spin 1s linear infinite;
  transform-origin: center;
}
@keyframes vel-reg-spin { to { transform: rotate(360deg); } }

[data-vel-upscale] {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid rgba(96,165,250,0.3); background: #2d2d2d;
  color: #60a5fa; cursor: pointer;
  padding: 10px;
  transition: background 0.2s, color 0.2s;
}
[data-vel-upscale]:hover:not(:disabled) { background: rgba(45,45,45,0.7); color: #93c5fd; }
[data-vel-upscale]:disabled { cursor: not-allowed; }

.vel-ups-pulsing {
  animation: vel-ups-pulse 1.2s ease-in-out infinite;
  transform-origin: center;
}
@keyframes vel-ups-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.82); opacity: 0.55; }
}

[data-vel-delete] {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid rgba(239,68,68,0.3); background: #2d2d2d;
  color: #ef4444; cursor: pointer;
  padding: 10px;
  transition: background 0.2s, color 0.2s;
}
[data-vel-delete]:hover:not(:disabled) { background: rgba(45,45,45,0.7); color: #f87171; }
[data-vel-delete]:disabled { cursor: not-allowed; }

.vel-del-spinning {
  animation: vel-del-spin 1s linear infinite;
  transform-origin: center;
}
@keyframes vel-del-spin { to { transform: rotate(360deg); } }
</style>
