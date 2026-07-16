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
import { ref, computed, watch, nextTick, inject, onUnmounted } from 'vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'
import { regenerateImage } from '../api/index.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  imgs: { type: [String, Array, Object], default: '' },
  index: { type: Number, default: 0 },
  showRegenerate: { type: Boolean, default: true },
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

const emit = defineEmits(['hide', 'update:visible', 'regenerated'])
const toastFn = inject('toast', null)

const cacheBump = ref(0)
const lightboxKey = ref(0)
const regenerating = ref(false)
let _velToolbarBtn = null

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

function createRegenerateBtn() {
  const btn = document.createElement('button')
  btn.setAttribute('data-vel-regenerate', '')
  btn.innerHTML = '<svg class="vel-reg-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>'
  btn.addEventListener('click', onRegenerate)
  return btn
}

function injectBtn() {
  if (!props.showRegenerate) return
  setTimeout(() => {
    const toolbars = document.querySelectorAll('.vel-toolbar')
    for (const tb of toolbars) {
      if (document.querySelector('[data-vel-regenerate]')) return
      const rect = tb.getBoundingClientRect()
      _velToolbarBtn = createRegenerateBtn()
      _velToolbarBtn.style.position = 'fixed'
      _velToolbarBtn.style.top = rect.top + 'px'
      const offset = Math.min(window.innerWidth * 0.05, 50)
      _velToolbarBtn.style.left = (rect.right + offset) + 'px'
      _velToolbarBtn.style.zIndex = '1200'
      tb.after(_velToolbarBtn)
      return
    }
  }, 80)
}

function syncBtnState(v) {
  if (!_velToolbarBtn) return
  _velToolbarBtn.disabled = v
  _velToolbarBtn.style.opacity = v ? '0.7' : ''
  _velToolbarBtn.title = v ? '重新生成中...' : '重新生成'
  const svg = _velToolbarBtn.querySelector('.vel-reg-svg')
  if (svg) svg.classList.toggle('vel-reg-spinning', v)
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

watch(() => props.visible, async (v) => {
  if (!v) return
  await nextTick()
  injectBtn()
})

watch(regenerating, syncBtnState)

onUnmounted(() => { _velToolbarBtn = null })

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
</script>

<style>
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
</style>
