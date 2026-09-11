<template>
  <div
    class="town-asset-thumb"
    :class="{
      'is-selected': selected,
      'is-pending': state === 'pending',
      'is-failed': state === 'failed',
      'is-empty': state === 'empty',
      'is-fill': fill,
    }"
    role="button"
    tabindex="0"
    :title="stateTitle"
    @click="emit('click', asset)"
    @keydown.enter.prevent="emit('click', asset)"
  >
    <div class="tat-media">
      <img v-if="state === 'ready'" :src="imageUrl" :alt="asset?.name || ''">
      <span v-else-if="state === 'pending'" class="tat-state is-spin" aria-label="生成中">⏳</span>
      <span v-else-if="state === 'failed'" class="tat-state" aria-label="生成失败">⚠️</span>
      <span v-else class="tat-blank" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="3.2" />
          <circle cx="8.6" cy="9.6" r="1.7" />
          <path d="M3.8 17.4l4.9-4.3 3.6 3.2 3-2.6 4.9 4.1" />
        </svg>
      </span>

      <linshe-button
        v-if="state === 'ready' && editable"
        class="tat-edit"
        variant="icon"
        size="sm"
        title="打开图片管理"
        :aria-label="`打开 ${asset?.name || '图片'} 管理`"
        @click.stop="emit('edit', asset)"
      >✎</linshe-button>
    </div>

    <div v-if="showName" class="tat-info">
      <span v-if="showName" class="tat-name">{{ asset?.name }}</span>
    </div>
    <linshe-button v-if="deletable && state === 'ready'" variant="ghost" size="sm" class="tat-delete" title="删除" @click.stop="emit('delete', asset)">删除</linshe-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'

const props = defineProps({
  asset: { type: Object, default: null },
  selected: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
  showName: { type: Boolean, default: false },
  deletable: { type: Boolean, default: false },
  clickTitle: { type: String, default: '' },
  /** 宿主已给固定画框（立绘 / 小人位）时让画面铺满整框，避免按 1:1 留出一条底色带 */
  fill: { type: Boolean, default: false },
})

const emit = defineEmits(['click', 'edit', 'delete'])

const imageUrl = computed(() => props.asset?.image_path
  ? `${props.asset.image_path}?v=${props.asset.meta?.updatedAt ?? 0}`
  : props.asset?.src || '')

// ready / pending / failed / empty（还没生成过）四种状态分开，缺省不再借用失败的红黄警示
const state = computed(() => {
  const asset = props.asset
  if (!asset) return 'empty'
  if (asset.status === 'pending') return 'pending'
  if (asset.status === 'failed') return 'failed'
  return imageUrl.value ? 'ready' : 'empty'
})

const stateTitle = computed(() => {
  if (state.value === 'ready') return props.clickTitle || '点击选用'
  if (state.value === 'pending') return '生成中…'
  if (state.value === 'failed') return '生成失败'
  return '暂无图片'
})

</script>

<style scoped>
.town-asset-thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  cursor: pointer;
}

.tat-media {
 position: relative;
 width: 100%;
 flex: 0 0 auto;
 aspect-ratio: 1 / 1;
 border-radius: 10px;
  overflow: hidden;
  background: #fbf8f3;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
  border: 1.5px solid var(--border);
}

.town-asset-thumb:hover .tat-media,
.town-asset-thumb:focus-visible .tat-media {
  border-color: rgba(224, 123, 108, 0.45);
  box-shadow: 0 6px 18px rgba(54, 42, 38, 0.1);
}

.town-asset-thumb.is-selected .tat-media {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(224, 123, 108, 0.24);
}

/* 宿主画框（立绘 / 小人位 / 玩家位）不是正方形时，让画面铺满整个框，别按 1:1 留出一条底色带 */
.town-asset-thumb.is-fill .tat-media {
  flex: 1 1 auto;
  aspect-ratio: auto;
  height: 100%;
  min-height: 0;
  border-radius: inherit;
}

.town-asset-thumb.is-pending { opacity: 0.62; }
.town-asset-thumb.is-failed .tat-media { background: #fdf5f2; }
.tat-delete { margin-top: -2px; font-size: 10px; }

.tat-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom center;
}

.tat-state { color: #b8a996; font-size: 18px; }
.tat-state.is-spin { display: inline-block; animation: tat-spin 1.1s linear infinite; }
@keyframes tat-spin { to { transform: rotate(360deg); } }

/* 缺省占位：暖纸底上一枚淡淡的相框小插图，不用警示符号 */
.tat-blank {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d5c8b6;
}
.tat-blank svg {
  width: 46%;
  min-width: 16px;
  max-width: 44px;
  aspect-ratio: 1 / 1;
}

.tat-edit {
  position: absolute !important;
  top: 6px;
  right: 6px;
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.town-asset-thumb:hover .tat-edit,
.town-asset-thumb:focus-visible .tat-edit {
  opacity: 1;
  transform: translateY(0);
}

.tat-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.tat-name {
  font-size: 11px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
